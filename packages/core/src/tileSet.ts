import type { Object3D } from 'three/webgpu'

import { worthAsking } from './transient.js'

/**
 * How long a tile that failed waits before it is asked for again, in
 * milliseconds. Twice as long each time it fails, up to a limit. The list is
 * matched every frame the view moves, so without a wait a broken connection
 * would have every tile on screen asked for dozens of times a second.
 */
const RETRY_FIRST = 2_000
const RETRY_LONGEST = 60_000

export interface TileSetOptions<T> {
  /**
   * How many to hold on to once they have left the screen. Over that, the
   * longest unused go first. 0 lets each go as it leaves, the ones still
   * arriving among them.
   */
  retain: number
  /** What tells one tile from another. */
  keyOf: (tile: T) => string
  /**
   * How many may be on their way at once. Defaults to no limit.
   *
   * A dozen tiles asked for together share the line a dozen ways and land
   * together at the end of it; asked for a few at a time, in the order they
   * were wanted, the middle of the screen fills while the edges are still
   * coming. Worth setting only where a tile is big enough for that to show.
   */
  atOnce?: number
  /**
   * One failed. Swallowed, a hole in the map has nothing to explain it.
   *
   * `retrying` is whether this set means to come back for it. False is a tile
   * that arrived unreadable, which will read the same next time and so is let
   * go of for good; a page told otherwise would be waiting for a tile that is
   * never coming.
   */
  onError?: (error: unknown, key: string, retrying: boolean) => void
  /**
   * Fetches one tile and makes what goes in the scene from it.
   * null where there is nothing there, and that tile is never asked for again.
   */
  load: (tile: T, signal: AbortSignal) => Promise<Object3D[] | null>
  /**
   * That a tile has been let go of, for a set that holds more than meshes.
   *
   * What {@link load} hands back is this set's to drop, and dropping it is all
   * most layers need. One whose tiles also put something somewhere else — a
   * mark on the viewer, which is not in the layer's own group — has nothing
   * here to drop it by, and told nothing would leave a mark standing over
   * ground it no longer holds.
   *
   * Called for every way a tile goes: let go of to stay under the count,
   * dropped while it was still in the air, and cleared outright.
   */
  onDrop?: (key: string) => void
}

interface Entry<T> {
  tile: T
  meshes: Object3D[]
  controller: AbortController
  /** When it was last on screen. */
  usedAt: number
  onScreen: boolean
}

/**
 * Fetching one kind of tile, holding on to it, and letting it go.
 *
 * A tile leaving the screen is not dropped there and then. Dropped for a
 * small move it would be fetched straight back, and the gap shows as empty
 * map. It is kept, hidden, up to a limit; only over that limit does the
 * longest unused of the off-screen ones go.
 */
export class TileSet<T> {
  private readonly tiles = new Map<string, Entry<T>>()
  /**
   * Tiles there is nothing to be had from. Never asked for again.
   *
   * Two ways in, and they are the same answer: the server said the tile is not
   * there, or it arrived and would not read. Coming back for either brings the
   * same nothing, and the second is what {@link worthAsking} judges — see
   * `fetchTile`, which tells a page about it and then lets the tile go.
   */
  private readonly missing = new Set<string>()
  /** Tiles that failed: when, and how long to wait before asking again. */
  private readonly failed = new Map<string, { at: number; wait: number }>()
  private readonly retain: number
  private readonly atOnce: number
  /**
   * Wanted, not yet begun, in the order they were wanted.
   *
   * Built afresh by every {@link sync} rather than added to: a view that has
   * moved wants a different middle first, and a queue kept from before would
   * spend the line on what the last look cared about.
   */
  private readonly queue: T[] = []
  private running = 0
  private readonly keyOf: (tile: T) => string
  private readonly load: (tile: T, signal: AbortSignal) => Promise<Object3D[] | null>
  private readonly onError: ((error: unknown, key: string, retrying: boolean) => void) | undefined
  private readonly onDrop: ((key: string) => void) | undefined
  /**
   * When the soonest tile that failed is worth asking for again, or Infinity.
   *
   * The backoff above only says how long to wait; something has to come back
   * and ask. Nothing did — a layer only synced when the view moved, so a tile
   * that failed while the view stood still stayed a hole in the map until the
   * page was dragged. Whoever owns this set reads {@link due} every frame and
   * syncs when it says so.
   */
  private askAgainAt = Infinity
  private clock = 0
  /** @see changes */
  private counted = 0

  constructor(options: TileSetOptions<T>) {
    this.retain = options.retain
    this.atOnce = options.atOnce ?? Infinity
    this.keyOf = options.keyOf
    this.load = options.load
    this.onError = options.onError
    this.onDrop = options.onDrop
  }

  /**
   * Whether a tile that failed is worth asking for again now.
   *
   * Asked every frame by whoever owns this set, so that a map left with holes
   * in it fills itself back in without the page being touched.
   */
  get due(): boolean {
    return performance.now() >= this.askAgainAt
  }

  get size(): number {
    return this.tiles.size
  }

  /**
   * Whether anything is still on its way or waiting its turn.
   *
   * What it is not is "everything wanted has arrived" — a tile that failed for
   * good is let go of and never asked for again, and a set waiting on it would
   * wait forever. Nothing left to do is the end, whether or not every tile
   * made it; whoever failed has already said so through `onError`.
   */
  get busy(): boolean {
    return this.running > 0 || this.queue.length > 0
  }

  /**
   * How many times what this set has standing has changed: one up for every
   * tile whose meshes went into the scene, and one for every tile's that came
   * out of it.
   *
   * A count of comings and goings rather than a size, because the commonest
   * change of all leaves the size exactly as it was — one tile lands in the
   * very frame another is let go of — and whoever watches wants to hear about
   * that one as much as any. Whoever owns the set reads this and compares it
   * with what it last saw.
   */
  get changes(): number {
    return this.counted
  }

  get onScreen(): number {
    let count = 0
    for (const entry of this.tiles.values()) if (entry.onScreen) count += 1
    return count
  }

  /** Tiles on screen and still on their way. */
  get loading(): T[] {
    const tiles: T[] = []
    for (const entry of this.tiles.values()) if (entry.onScreen && isLoading(entry)) tiles.push(entry.tile)
    return tiles
  }

  /** Brings what is held into line with what should be shown now. */
  sync(wanted: readonly T[]): void {
    this.clock += 1
    const keep = new Set(wanted.map(this.keyOf))

    for (const [key, entry] of this.tiles) {
      const onScreen = keep.has(key)
      if (entry.onScreen !== onScreen) {
        entry.onScreen = onScreen
        for (const mesh of entry.meshes) mesh.visible = onScreen
      }
      if (onScreen) entry.usedAt = this.clock
    }

    const now = performance.now()
    // Worked out afresh over the tiles actually wanted: one that failed and
    // has since left the screen is nobody's business until it comes back
    let soonest = Infinity
    this.queue.length = 0
    for (const tile of wanted) {
      const key = this.keyOf(tile)
      if (this.tiles.has(key) || this.missing.has(key)) continue
      const failure = this.failed.get(key)
      if (failure) {
        const ready = failure.at + failure.wait
        if (now < ready) {
          soonest = Math.min(soonest, ready)
          continue
        }
      }
      this.queue.push(tile)
    }
    this.askAgainAt = soonest
    this.pump()

    this.evict()
  }

  /** Lets go of everything held. A tile that failed is asked for again at once. */
  clear(): void {
    for (const [key, entry] of this.tiles) {
      this.onDrop?.(key)
      entry.controller.abort()
      // Counted before it is dropped, which empties the list the count reads
      if (!isLoading(entry)) this.counted += 1
      drop(entry.meshes)
    }
    this.tiles.clear()
    this.missing.clear()
    this.failed.clear()
    this.queue.length = 0
    this.askAgainAt = Infinity
  }

  /** Lets go of what is still arriving, and keeps what has arrived. */
  dropLoading(): void {
    this.queue.length = 0
    for (const [key, entry] of this.tiles) {
      if (!isLoading(entry)) continue
      entry.controller.abort()
      this.tiles.delete(key)
    }
  }

  /** Starts as many of the queue as the limit allows, in the order they were wanted. */
  private pump(): void {
    while (this.running < this.atOnce) {
      const tile = this.queue.shift()
      if (!tile) return
      this.running += 1
      void this.fetchTile(tile, this.keyOf(tile)).finally(() => {
        this.running -= 1
        this.pump()
      })
    }
  }

  private async fetchTile(tile: T, key: string): Promise<void> {
    const controller = new AbortController()
    const entry: Entry<T> = { tile, meshes: [], controller, usedAt: this.clock, onScreen: true }
    this.tiles.set(key, entry)

    try {
      const meshes = await this.load(tile, controller.signal)
      // Dropped while it was in flight, or already being fetched again: let it go
      if (controller.signal.aborted || this.tiles.get(key) !== entry) {
        // Counted as a going like any other: what `load` hands over it has
        // already hung, since a tile's own metres mean nothing until it is
        // under the thing that carries it to its place. An empty list hung
        // nothing, so there is nothing to count as having left.
        if (meshes?.length) {
          drop(meshes)
          this.onDrop?.(key)
          this.counted += 1
        }
        return
      }
      if (!meshes) {
        this.missing.add(key)
        this.tiles.delete(key)
        return
      }
      entry.meshes = meshes
      // Only what actually arrived, because only that can come out again: a
      // tile with nothing on it — open sea, a ward with no roads in it —
      // hands back an empty list, and every way out reads the list to know
      // there is something to let go of. Counted here, that tile would be a
      // coming with no going to answer it, and the count would creep up by
      // one for every empty tile the view ever crossed.
      if (meshes.length > 0) this.counted += 1
      for (const mesh of meshes) mesh.visible = entry.onScreen
      this.failed.delete(key)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return
      // Dropped while it was in flight, or already being fetched again: not ours
      if (this.tiles.get(key) !== entry) return
      this.tiles.delete(key)
      // A tile that arrived and could not be read will read the same next
      // time, so it joins the ones there is nothing to be had from rather
      // than the ones worth waiting on. Left in the backoff it was asked for
      // every two seconds and then every minute, for as long as the page was
      // open: 台東区's tiles, in a form this could not yet read, put seventeen
      // hundred lines through the console before anybody counted them.
      const again = worthAsking(error)
      if (again) {
        const before = this.failed.get(key)
        const wait = before ? Math.min(RETRY_LONGEST, before.wait * 2) : RETRY_FIRST
        const at = performance.now()
        this.failed.set(key, { at, wait })
        this.askAgainAt = Math.min(this.askAgainAt, at + wait)
      } else {
        this.missing.add(key)
      }
      if (this.onError) this.onError(error, key, again)
    }
  }

  private evict(): void {
    if (this.tiles.size <= this.retain) return
    const spare = [...this.tiles.entries()]
      .filter(([, entry]) => !entry.onScreen)
      // What is still arriving goes last: cancelling only means fetching it
      // again shortly, so only once every arrived one has gone and it still spills
      .sort((a, b) => Number(isLoading(a[1])) - Number(isLoading(b[1])) || a[1].usedAt - b[1].usedAt)

    let over = this.tiles.size - this.retain
    for (const [key, entry] of spare) {
      if (over <= 0) break
      entry.controller.abort()
      if (!isLoading(entry)) this.counted += 1
      drop(entry.meshes)
      this.onDrop?.(key)
      this.tiles.delete(key)
      over -= 1
    }
  }
}

/** Whether it is still arriving, which is to say it has put nothing in the scene yet. */
function isLoading(entry: Entry<unknown>): boolean {
  return entry.meshes.length === 0
}

/**
 * Takes a thing out of whatever holds it and frees its geometry.
 *
 * A building tile comes as one group with its meshes under it. Freeing only
 * what was handed over would free nothing at all — a group carries no
 * geometry of its own — and the tile would vanish holding every byte of it.
 *
 * Shared with the layers because a tile can also go while its shaders are
 * being woven, and what is dropped then was never hung: this set frees what
 * `load` hands back, and that path hands back nothing. See `Viewer.weave`.
 */
export function drop(objects: Object3D[]): void {
  for (const object of objects) {
    object.removeFromParent()
    object.traverse((node) => {
      const geometry = (node as { geometry?: { dispose(): void } }).geometry
      geometry?.dispose()
    })
  }
  objects.length = 0
}
