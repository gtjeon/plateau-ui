import { readVectorTile } from '../mvt.js'
import { yToLat, type WorldBounds } from '../geo/mercator.js'
import { tileBounds, tileKey, tilesCovering, type TileId } from '../geo/tiles.js'
import { ROADS, vectorTileUrl } from '../vectorTiles.js'
import { transient } from '../transient.js'
import { crossingAlong, endsOf, PROBES, type Wall } from './wallPlan.js'
import { ASK_PLAINLY, type Ask } from '../requests.js'

/**
 * The roads, as far as a wall is concerned.
 *
 * A building shows its face to the street and keeps its back to the next
 * building along, and that is what decides where the windows go. PLATEAU says
 * nothing about it — its buildings stand alone, with no notion of what is
 * around them — so the streets are read from the same vector tiles the ground
 * is drawn from, and each wall is asked whether one lies in front of it.
 *
 * The tiles are the ones the ground has already fetched, so the second reader
 * is served from the browser's cache; what is kept here is the parse, which
 * neither of us would otherwise share.
 */

/**
 * The zoom the roads are read at, which is the most detailed there is.
 *
 * Buildings only stand at zooms finer than this (see BUILDINGS_MIN_ZOOM in
 * Buildings.ts), so there is never a coarser view to match, and a coarser tile
 * drops the narrow streets that decide which way a house faces.
 */
const ROAD_ZOOM = 16

/**
 * How far a wall may stand back from a road and still be said to face it, in
 * metres.
 *
 * Wide enough for the forecourt an office tower keeps between itself and the
 * street, which is what the number is really measuring: a house sits right on
 * the lane, and anything that would take in the house but not the tower leaves
 * half the city centre blank.
 */
export const DEFAULT_REACH = 20

/** How many parsed tiles to hold on to. */
const KEEP = 256

/** How wide a cell of a tile's lookup grid is, as a share of the tile. */
const GRID = 32

/** One tile's roads, in world units, with a grid over them. */
interface RoadTile {
  /** Two ends per road piece: x1, z1, x2, z2. */
  readonly ends: Float64Array
  /** Half the width of each piece's road, in metres. */
  readonly halves: Float32Array
  /** Where the tile lies, and how big its cells are. */
  readonly minX: number
  readonly minZ: number
  readonly cell: number
  /** Where each cell's pieces begin in `within`. */
  readonly starts: Int32Array
  /** The pieces of every cell, one run after another. */
  readonly within: Int32Array
}

/**
 * Asked once per tile, then held on to. A tile with no roads is remembered as
 * one, and one that could not be read is not remembered at all.
 */
const parsed = new Map<string, Promise<RoadTile | null>>()

/**
 * The roads of the tiles a building tile stands on, and of the ground just
 * beyond it.
 *
 * A building tile is far smaller than a road tile, so this is nearly always
 * one tile, and the one its neighbours asked for too. The reach is widened by
 * the widest road there is, since a road is held by its centre line: the near
 * edge of a motorway can be at the wall while its middle is a tile away.
 *
 * There is no signal to call it off. The tile is shared, and read to the end
 * even when the tile that asked first has gone: called off for that one, it
 * would come back empty for every other tile waiting on the same reading, and
 * their walls would be dressed as if no road were near.
 */
export async function roadsUnder(
  bounds: WorldBounds,
  reach: number,
  ask: Ask = ASK_PLAINLY,
): Promise<RoadsNearby> {
  // World units run long the further north they are, and a reach is in metres.
  const lat = yToLat((bounds.minY + bounds.maxY) / 2)
  const margin = (reach + WIDEST_ROAD) / Math.cos((lat * Math.PI) / 180)
  const around = {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  }
  const wanted = tilesCovering(ROAD_ZOOM, around, 16)
  const tiles = await Promise.all(wanted.map((tile) => roadTile(tile, ask)))
  return new RoadsNearby(tiles.filter((tile): tile is RoadTile => tile !== null))
}

function roadTile(id: TileId, ask: Ask): Promise<RoadTile | null> {
  const key = tileKey(id)
  const hit = parsed.get(key)
  if (hit) return hit

  // A tile that could not be read is not remembered: this asker goes without,
  // and the next one tries again
  const task: Promise<RoadTile | null> = read(id, ask).catch(() => {
    if (parsed.get(key) === task) parsed.delete(key)
    return null
  })
  parsed.set(key, task)
  // Oldest first, since a Map remembers the order things went in. What a tile
  // costs to keep is its road pieces, and what it costs to lose is a parse.
  if (parsed.size > KEEP) {
    const oldest = parsed.keys().next().value
    if (oldest !== undefined) parsed.delete(oldest)
  }
  return task
}

async function read(id: TileId, ask: Ask): Promise<RoadTile | null> {
  const res = await ask(vectorTileUrl(id), 'mapTile')
  if (transient(res.status)) throw new Error(`${res.status}`)
  if (!res.ok) return null
  const tile = readVectorTile(new Uint8Array(await res.arrayBuffer()))

  // The same layer, widths and exclusions the ground draws its roads by, so
  // a wall faces what is actually on screen rather than a road drawn nowhere.
  const spec = ROADS
  const bounds = tileBounds(id)
  const ends: number[] = []
  const halves: number[] = []

  for (const source of spec.sources) {
    const layer = tile.layers[source]
    if (!layer) continue
    const scale = bounds.size / layer.extent
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      if (spec.skip(feature.properties)) continue
      const half = (spec.widthBy(feature.properties) ?? spec.width) / 2
      for (const line of feature.loadGeometry()) {
        for (let k = 1; k < line.length; k++) {
          const a = line[k - 1]
          const b = line[k]
          if (!a || !b) continue
          ends.push(
            bounds.minX + a.x * scale,
            -bounds.maxY + a.y * scale,
            bounds.minX + b.x * scale,
            -bounds.maxY + b.y * scale,
          )
          halves.push(half)
        }
      }
    }
  }
  if (halves.length === 0) return null
  return grid(new Float64Array(ends), new Float32Array(halves), bounds)
}

/**
 * Sorts a tile's road pieces into a grid of cells.
 *
 * A wall asks what is in front of it, and a city tile holds thousands of road
 * pieces; without this every wall would be compared against all of them, which
 * on a screen of buildings is tens of millions of comparisons a tile.
 */
function grid(
  ends: Float64Array,
  halves: Float32Array,
  bounds: { minX: number; maxY: number; size: number },
): RoadTile {
  const cell = bounds.size / GRID
  const minX = bounds.minX
  const minZ = -bounds.maxY
  const count = halves.length
  const cells = GRID * GRID

  /** Which cells a piece reaches, clamped to the tile. */
  const spread = (i: number, visit: (c: number) => void): void => {
    const x0 = Math.min(ends[i * 4] ?? 0, ends[i * 4 + 2] ?? 0)
    const z0 = Math.min(ends[i * 4 + 1] ?? 0, ends[i * 4 + 3] ?? 0)
    const x1 = Math.max(ends[i * 4] ?? 0, ends[i * 4 + 2] ?? 0)
    const z1 = Math.max(ends[i * 4 + 1] ?? 0, ends[i * 4 + 3] ?? 0)
    const cx0 = clamp(Math.floor((x0 - minX) / cell))
    const cz0 = clamp(Math.floor((z0 - minZ) / cell))
    const cx1 = clamp(Math.floor((x1 - minX) / cell))
    const cz1 = clamp(Math.floor((z1 - minZ) / cell))
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) visit(cz * GRID + cx)
    }
  }

  const held = new Int32Array(cells)
  for (let i = 0; i < count; i++) spread(i, (c) => (held[c] = (held[c] ?? 0) + 1))
  const starts = new Int32Array(cells + 1)
  for (let c = 0; c < cells; c++) starts[c + 1] = (starts[c] ?? 0) + (held[c] ?? 0)
  const within = new Int32Array(starts[cells] ?? 0)
  const filled = new Int32Array(cells)
  for (let i = 0; i < count; i++) {
    spread(i, (c) => {
      within[(starts[c] ?? 0) + (filled[c] ?? 0)] = i
      filled[c] = (filled[c] ?? 0) + 1
    })
  }
  return { ends, halves, minX, minZ, cell, starts, within }
}

function clamp(c: number): number {
  return c < 0 ? 0 : c > GRID - 1 ? GRID - 1 : c
}

/** The roads around a building tile, ready to be asked about its walls. */
export class RoadsNearby {
  private readonly tiles: readonly RoadTile[]

  constructor(tiles: readonly RoadTile[]) {
    this.tiles = tiles
  }

  /** Whether any roads were found at all, so a tile with none can be told. */
  get empty(): boolean {
    return this.tiles.length === 0
  }

  /**
   * Whether a road lies on the line a wall looks along, as far as it sees.
   *
   * How far that is comes from `sight`, in metres, for each point along the
   * wall it is asked at: the reach, or less where a building stands in the way
   * and the road beyond it is that building's. The wall's own metres are turned
   * into world units by `stretch`, which is what the tile they belong to is
   * standing on the ground by — Mercator runs long this far north, and a road's
   * width is in real metres.
   */
  inFrontOf(
    wall: Wall,
    sight: (share: number) => number,
    origin: { x: number; z: number },
    stretch: number,
  ): boolean {
    if (this.tiles.length === 0) return false
    const { x0, z0, x1, z1 } = endsOf(wall)

    for (const share of PROBES) {
      const far = sight(share) * stretch
      const x = origin.x + (x0 + (x1 - x0) * share) * stretch
      const z = origin.z + (z0 + (z1 - z0) * share) * stretch
      for (const tile of this.tiles) {
        if (this.near(tile, x, z, wall, far, stretch)) return true
      }
    }
    return false
  }

  /**
   * Whether any road piece of a tile is crossed by the line a point on a wall
   * looks along, as far as it sees.
   *
   * A wall looks straight out, and the road is across that line or it is not.
   * What is merely near it does not count: a corner shop stands within a few
   * metres of its street on all four walls, and asking only how close the
   * street is would put windows on its back and its party wall as readily as
   * on its front. Nor does a road running the same way the wall looks, beside
   * the line rather than across it: that is a side street the end wall faces,
   * or a road passing under the building — under the station, where two
   * platform roofs face each other across the tracks over it.
   *
   * A road is held by its centre line, so the line is followed past what the
   * wall sees by half the road's width: the near half of a wide road is in view
   * though its middle is not.
   */
  private near(tile: RoadTile, x: number, z: number, wall: Wall, far: number, stretch: number): boolean {
    const { ends, halves, minX, minZ, cell, starts, within } = tile
    // As far as the wall sees, and on by as much as the widest road could
    // bring its centre line past that.
    const out = far + WIDEST_ROAD * stretch
    const ex = x + wall.normalX * out
    const ez = z + wall.normalZ * out
    // Two lines that cross do so inside a cell they are both in.
    const cx0 = clamp(Math.floor((Math.min(x, ex) - minX) / cell))
    const cz0 = clamp(Math.floor((Math.min(z, ez) - minZ) / cell))
    const cx1 = clamp(Math.floor((Math.max(x, ex) - minX) / cell))
    const cz1 = clamp(Math.floor((Math.max(z, ez) - minZ) / cell))

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * GRID + cx
        for (let k = starts[c] ?? 0; k < (starts[c + 1] ?? 0); k++) {
          const i = within[k] ?? 0
          const crossed = crossingAlong(
            x,
            z,
            ex,
            ez,
            ends[i * 4] ?? 0,
            ends[i * 4 + 1] ?? 0,
            ends[i * 4 + 2] ?? 0,
            ends[i * 4 + 3] ?? 0,
          )
          if (crossed * out <= far + (halves[i] ?? 0) * stretch) return true
        }
      }
    }
    return false
  }
}

/**
 * The widest a road is taken to be when looking for one, in metres.
 *
 * Roads are held by their centre lines, so a search that reached only as far
 * as a wall can see would miss a motorway whose near edge is right there and
 * whose middle is twelve metres further on. This is the widest the ground
 * draws (19.5m 以上, drawn at 24), so nothing is missed.
 */
const WIDEST_ROAD = 24
