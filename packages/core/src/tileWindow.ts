import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Object3D,
} from 'three/webgpu'
import { appearStagger, appearTakes } from './appear.js'
import type { LoadFailure } from './events.js'
import { EARTH_CIRCUMFERENCE, WORLD_ORIGIN_X, WORLD_ORIGIN_Y, type WorldBounds } from './geo/mercator.js'
import { tileKey, type TileId } from './geo/tiles.js'
import type { Texel } from './pictureSheet.js'
import { ReadBack } from './readBack.js'
import { TileSet } from './tileSet.js'
import { transient, Unreadable } from './transient.js'
import type { Ask } from './requests.js'

/**
 * A picture somebody publishes as tiles, fetched and stitched into one
 * picture over what is in view.
 *
 * Everything a layer that reads a published tile set does before it draws
 * anything: which tiles to ask for, holding them, stitching the window of them
 * into one canvas, when that canvas is turned over to cover somewhere new, and
 * reading a texel of it back. Taken out of `ImageTileLayer` on 2026-11-05, when
 * `ImageExtrusionTileLayer` came to want the same picture for another use —
 * the land wears it there, and here it is lifted by its legend — and a second
 * copy of the window would have been a second loading machine (contract 4).
 * What a layer does with the picture is the layer's: this is not a `Layer`.
 *
 * The web's map tiles are all the same address — a zoom, a column and a row,
 * and a picture 256 pixels square — so a hazard map, an aerial photograph, an
 * old survey and a country's own base map are one kind of thing here.
 */

/** How many texels a tile carries each way where the page says nothing: the GSI's, and most of the web's. */
export const TILE = 256

/**
 * How many tiles the picture is stitched from, each way.
 *
 * Eight is a picture 2048 across, which covers a 1440-pixel canvas at better
 * than a texel a pixel and costs 16MB on the card. Wider than this the zoom
 * steps down instead, so what is stitched is always the same size and the
 * card is handed the same picture however far out the view stands.
 */
export const WINDOW = 8

/** The most tiles held in hand, drawn or not. Each is 256KB once unpacked. */
const MOST_HELD = 96

export interface TileWindowOptions {
  /** Where the tiles are, with `{z}`, `{x}` and `{y}` in it; see `ImageTileLayerOptions.url`. */
  readonly url: string
  readonly minZoom?: number
  readonly maxZoom?: number
  /** How many pixels a tile is each way; see `ImageTileLayerOptions.tileSize`. */
  readonly tileSize?: number
  /** Whose window it is, for what it says when it cannot go on. */
  readonly owner: string
  /** How to fetch, asked afresh each time: the viewer's `transformRequest` once there is one. */
  readonly ask: () => Ask
  /** A tile could not be fetched or could not be read; see contract 7. */
  readonly told: (failure: LoadFailure) => void
  /**
   * The picture was turned over to cover somewhere else: its west-north
   * corner and how far it runs, in world units. The canvas is clear as this is
   * said, and what is in hand is drawn onto it straight after.
   */
  readonly placed: (originX: number, originY: number, spanX: number, spanY: number) => void
  /** Whether anything is on the picture yet; see `PictureSheet.holding`. */
  readonly holding: (value: boolean) => void
  /**
   * One square of the window was drawn onto the picture: which, across and
   * down from its north-west corner. For an owner that reads the picture
   * rather than only showing it, so it reads each square once, as it lands.
   */
  readonly stamped?: (across: number, down: number) => void
  /**
   * Whether the owner reads whole squares back off the canvas as they land
   * ({@link TileWindow.square}). Said so the browser keeps the canvas where a
   * read is cheap (`willReadFrequently`); a window only shown leaves the
   * canvas where it always was.
   */
  readonly readsBack?: boolean
}

/** One tile of the window, and whatever is known about it. */
interface Held {
  bitmap: ImageBitmap | null
  /** Set once it has been drawn into the picture in hand. */
  drawn: boolean
}

/** Where a stitched picture stands: a zoom, and the tile at its north-west corner. */
export interface Window {
  readonly z: number
  readonly x: number
  readonly y: number
}

export class TileWindow {
  private readonly options: TileWindowOptions
  private _url: string
  private _minZoom: number
  private _maxZoom: number

  /** The picture: the window's tiles, stitched. */
  private readonly canvas = new OffscreenCanvas(WINDOW * TILE, WINDOW * TILE)
  /** How many pixels a tile is each way; see `ImageTileLayerOptions.tileSize`. */
  private _tileSize = TILE
  private readonly paper: OffscreenCanvasRenderingContext2D
  /** The picture's pixels as read back, kept until it is drawn on again: for a window that {@link TileWindowOptions.readsBack}. */
  private readonly read: ReadBack
  /**
   * A copy of the picture kept on the processor for {@link texelAt}, made the
   * first time a texel is asked for and drawn into alongside the picture from
   * then on.
   *
   * The picture itself is kept where the browser draws it fastest, on the
   * card, and reading a pixel back from there stops the page while the card
   * catches up: the first texel the flood example asked for took 1.14 s
   * (measured), and it asks every time a tile lands. Drawn here from the
   * tiles in hand rather than copied off the picture, which would be that
   * same read. A window that reads whole squares back already keeps its
   * picture where reading is cheap, and reads that.
   */
  private mirror: { readonly canvas: OffscreenCanvas; readonly paper: OffscreenCanvasRenderingContext2D; readonly read: ReadBack } | null = null
  /** The picture as the card reads it. The object, for good: what is in it is swapped. */
  readonly picture = new CanvasTexture(this.canvas as unknown as HTMLCanvasElement)
  /**
   * How far each square of the window is in, one texel a tile.
   *
   * Sixty-four bytes, written here and read by whoever draws the picture.
   * Nearest, because a square is a square — read smoothly, a tile would bleed
   * into its neighbours and the thing meant to arrive square by square would
   * arrive as a wash.
   */
  private readonly coming = new Uint8Array(WINDOW * WINDOW * 4)
  readonly comingTexture = new DataTexture(this.coming, WINDOW, WINDOW, RGBAFormat, UnsignedByteType)
  /**
   * When each square starts coming in, or 0 for one that is up already.
   *
   * Ground the last window covered is up at once: there is nothing new on it,
   * and fading it in would say something arrived that did not.
   */
  private readonly from = new Float64Array(WINDOW * WINDOW)
  /** Whether anything is still on its way in, so the bytes are left alone once nothing is. */
  private filling = false

  /** Which tiles the picture in hand stands on: zoom, and its north-west tile. */
  private at: Window | null = null
  /**
   * The window being moved to, while the one in hand is still on screen.
   *
   * The picture is not cleared when the view leaves it. Cleared then, the
   * city went white for as long as a tile takes to come back — measured over
   * a zoom out from 17 to 13, the whole of it blanked at every step the tile
   * zoom changed. So the old picture is held until the new one is whole; see
   * {@link settled}.
   */
  private want: Window | null = null
  /**
   * What each tile carries, and whether it is on the picture in hand.
   *
   * Held here rather than by the set because what a tile of this one carries
   * is pixels, and a set holds meshes. The shape `VectorTileLayer` already
   * takes: {@link load} puts what it made where the window can find it again,
   * hands the set nothing, and the set says when the tile is let go of.
   */
  private readonly held = new Map<string, Held>()
  /**
   * Tiles the set is waiting out a backoff on, or has given up for good.
   *
   * Noted because {@link settled} has to tell a square still on its way from
   * one that is not coming — a tile the host keeps refusing must not hold the
   * picture back for ever. Which tiles those are is the set's own business and
   * it keeps it to itself, so each is written down here as it says so.
   */
  private readonly beaten = new Set<string>()
  /** Fetching the window's tiles, holding them, and letting them go. */
  private readonly tiles: TileSet<TileId>

  /** Whether anything of the window has landed, which is what a credit waits on. */
  private _showing = false
  /** Whether the window has to be picked afresh: the set changed under it. */
  private dirty = false
  /** Whether the picture moved on since it was last asked; see {@link takeMoved}. */
  private moved = false

  constructor(options: TileWindowOptions) {
    this.options = options
    this._url = options.url
    this._minZoom = options.minZoom ?? 0
    this._maxZoom = options.maxZoom ?? 22
    this.tiles = new TileSet<TileId>({
      retain: MOST_HELD,
      keyOf: tileKey,
      // No `atOnce`, on purpose, where the ground and the city both set one.
      // A window is sixty-four tiles and the picture does not turn over until
      // every one of them has answered, so letting six through at a time
      // would hold the last picture on screen for ten turns of the line
      // instead of one. Nothing here fills in square by square either: what
      // arrives first is drawn behind a whole picture that is already up.
      load: (tile, signal) => this.load(tile, signal),
      onDrop: (key) => this.letGo(key),
      onError: (cause, key, retrying) => {
        this.beaten.add(key)
        this.options.told({ what: 'tile', key, retrying, cause })
        // A square that is not coming must not hold the picture back; see
        // {@link settled}. Asked here because a tile that failed is the one
        // way a window can become settled without anything having landed.
        if (this.want && this.settled(this.want)) this.turnOver()
      },
    })

    const paper = this.canvas.getContext('2d', options.readsBack ? { willReadFrequently: true } : undefined)
    if (!paper) throw new Error(`${options.owner}: no 2d context`)
    this.paper = paper
    this.read = new ReadBack(paper)
    this.sizeTiles(options.tileSize ?? TILE)
    // Row nought is the north row, which is how a tile grid is counted; left
    // to itself three would turn the picture over to suit a model's own uv
    this.picture.flipY = false
    this.picture.colorSpace = SRGBColorSpace
    // Read a texel at a time, and never blended with the texels beside it.
    //
    // A tile set like this is a legend: bands of flat colour, with a clear
    // ground between them and outside them. Blending is averaging, and here
    // it has two ends to it. Across a band's edge it invents a colour the
    // legend does not have. And against the clear ground it averages with
    // nothing at all — which, the colour being kept apart from the alpha, is
    // a transparent *black*, so the band is pulled towards black wherever it
    // ends. Measured at 由比ヶ浜: the side of a step reads the edge, and it
    // came out 117,123,132 close to and a pale grey further off — a dark rim
    // round every band.
    this.picture.generateMipmaps = false
    this.picture.minFilter = NearestFilter
    this.picture.magFilter = NearestFilter
    this.comingTexture.magFilter = NearestFilter
    this.comingTexture.minFilter = NearestFilter
    this.comingTexture.wrapS = ClampToEdgeWrapping
    this.comingTexture.wrapT = ClampToEdgeWrapping
    this.comingTexture.generateMipmaps = false
    this.comingTexture.needsUpdate = true
  }

  /** Where the tiles are; changing it lets go of what was fetched. See `ImageTileLayer.url`. */
  get url(): string {
    return this._url
  }

  set url(value: string) {
    if (this._url === value) return
    this._url = value
    this.forget()
  }

  /** How many pixels a tile of the set is each way. */
  get tileSize(): number {
    return this._tileSize
  }

  set tileSize(value: number) {
    if (value === this._tileSize) return
    this.sizeTiles(value)
    this.forget()
  }

  /** The zooms the set holds; see `ImageTileLayer.minZoom`. */
  get minZoom(): number {
    return this._minZoom
  }

  set minZoom(value: number) {
    if (value === this._minZoom) return
    this._minZoom = value
    this.forget()
  }

  get maxZoom(): number {
    return this._maxZoom
  }

  set maxZoom(value: number) {
    if (value === this._maxZoom) return
    this._maxZoom = value
    this.forget()
  }

  /** How many tiles are in hand, drawn or not. */
  get count(): number {
    return this.held.size
  }

  /** Whether anything of the picture in hand has landed; see {@link credits}. */
  get showing(): boolean {
    return this._showing && this.at !== null
  }

  /** Where the picture in hand stands, or nothing before the first window has turned over. */
  get standing(): Window | null {
    return this.at
  }

  /** How many texels the stitched picture is each way. */
  get texels(): number {
    return this.canvas.width
  }

  /** Whether tiles are on their way; see `Layer.busy`. */
  get busy(): boolean {
    return this.tiles.busy
  }

  /**
   * Whether the picture moved on since this was last asked: a piece of it
   * landed, or it was turned over. Asked once a frame, so a window filling up
   * is told to a page once rather than sixty-four times.
   */
  takeMoved(): boolean {
    const moved = this.moved
    this.moved = false
    return moved
  }

  /**
   * Once a frame: the window moved to cover what is in view, if it does not
   * already, and the squares coming in brought along.
   *
   * False where what is in view is wider than the set can say anything about
   * at its coarsest, and nothing should be drawn of it.
   */
  frame(laid: WorldBounds, zoom: number): boolean {
    if (this.dirty) {
      this.dirty = false
      this.at = null
      this.want = null
    }
    const fits = this.window(laid, zoom)
    this.fill()
    if (this.tiles.due) this.askAll()
    return fits
  }

  /**
   * The texel a place falls on, as published, or null where the picture
   * cannot answer — see `ImageTileLayer.colorAt` for what null means. `spot`
   * is where on the picture the place falls, nought to one each way.
   */
  texelAt(spot: readonly [number, number]): Texel | null {
    const window = this.at
    if (!window) return null
    // Which square of the window it falls in, so that a square the host has
    // nothing for is told apart from a square whose picture is clear there
    const across = Math.min(WINDOW - 1, Math.floor(spot[0] * WINDOW))
    const down = Math.min(WINDOW - 1, Math.floor(spot[1] * WINDOW))
    const held = this.held.get(tileKey({ z: window.z, x: window.x + across, y: window.y + down }))
    if (!held?.bitmap || !held.drawn) return null
    const x = Math.min(this.canvas.width - 1, Math.floor(spot[0] * this.canvas.width))
    const y = Math.min(this.canvas.height - 1, Math.floor(spot[1] * this.canvas.height))
    return this.options.readsBack ? this.read.texel(x, y) : this.mirrored().read.texel(x, y)
  }

  /** The copy {@link texelAt} reads, made and filled from the tiles in hand the first time it is wanted. */
  private mirrored(): NonNullable<TileWindow['mirror']> {
    if (this.mirror) return this.mirror
    const canvas = new OffscreenCanvas(this.canvas.width, this.canvas.height)
    const paper = canvas.getContext('2d', { willReadFrequently: true })
    if (!paper) throw new Error(`${this.options.owner}: no 2d context`)
    this.mirror = { canvas, paper, read: new ReadBack(paper) }
    this.redrawMirror()
    return this.mirror
  }

  /** Draws the copy again from every tile the picture holds now; see {@link mirror}. */
  private redrawMirror(): void {
    const mirror = this.mirror
    if (!mirror) return
    if (mirror.canvas.width !== this.canvas.width || mirror.canvas.height !== this.canvas.height) {
      mirror.canvas.width = this.canvas.width
      mirror.canvas.height = this.canvas.height
    }
    mirror.paper.clearRect(0, 0, mirror.canvas.width, mirror.canvas.height)
    mirror.read.forget()
    const window = this.at
    if (!window) return
    const size = this._tileSize
    mirror.paper.imageSmoothingEnabled = false
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        const held = this.held.get(tileKey({ z: window.z, x: window.x + across, y: window.y + down }))
        if (held?.bitmap && held.drawn) mirror.paper.drawImage(held.bitmap, across * size, down * size, size, size)
      }
    }
  }

  /**
   * The texels of one square of the window, as published, or null where
   * that square has nothing in hand (not landed, or not in the set).
   */
  square(across: number, down: number): ImageData | null {
    const window = this.at
    if (!window) return null
    const held = this.held.get(tileKey({ z: window.z, x: window.x + across, y: window.y + down }))
    if (!held?.bitmap || !held.drawn) return null
    const size = this._tileSize
    return this.paper.getImageData(across * size, down * size, size, size)
  }

  /** Lets go of every tile and starts the window again. */
  forget(): void {
    this.tiles.clear()
    this.beaten.clear()
    this.restitch()
    this.dirty = true
  }

  /** Lets go of everything and leaves no picture: for an owner taken off its viewer. */
  clear(): void {
    this.tiles.clear()
    this.beaten.clear()
    // The whole picture goes, the window being moved to with it; see contract
    // 5. Left standing, `want` is a window a re-attached layer already sits
    // inside, so it asks for nothing, fetches nothing and credits nobody.
    this.restitch()
  }

  dispose(): void {
    // Every tile goes through `onDrop`, which is what closes the pictures
    this.tiles.clear()
    this.picture.dispose()
    this.comingTexture.dispose()
  }

  /**
   * Makes the canvas the window is stitched on as big as the window of tiles
   * of this size, and the card's picture of it afresh — three makes that once,
   * at the size the canvas was the first time it was read, and a canvas grown
   * under it is otherwise read a corner at a time.
   */
  private sizeTiles(value: number): void {
    if (!Number.isFinite(value) || value < 1)
      throw new Error(`${this.options.owner}: a tile is 1 pixel across or more, got ${value}`)
    this._tileSize = value
    const across = WINDOW * value
    if (this.canvas.width === across) return
    this.canvas.width = across
    this.canvas.height = across
    this.picture.dispose()
    this.read.forget()
    this.redrawMirror()
  }

  /**
   * Moves the window to cover what is in view, where it does not already.
   *
   * The zoom is the view's own, stepped down until what is in view fits in
   * {@link WINDOW} tiles each way. Stepping down rather than stitching more of
   * them keeps the picture on the card one size: a view that has stepped back
   * over a prefecture would otherwise ask for a thousand tiles and hold none
   * of them long enough to draw.
   */
  private window(bounds: WorldBounds, zoom: number): boolean {
    // A tile twice the size covers what four of the default do, so it is
    // chosen a zoom out, as Mapbox chooses a 512 tile
    const step = Math.log2(this._tileSize / TILE)
    let z = Math.min(this._maxZoom, Math.max(this._minZoom, Math.round(zoom - step)))
    while (z > this._minZoom && !fits(bounds, z)) z--
    // Wider than the set can say anything about at its coarsest
    if (!fits(bounds, z)) return false
    // The one in hand, or the one on its way, where either still has the view
    // inside it. A window is eight tiles and a view is three or four, so a
    // drag crosses several tiles before anything has to be asked for again.
    if (covers(this.at, bounds, z) || covers(this.want, bounds, z)) return true
    // Hung about the middle of the view rather than started at its corner, so
    // the slack is on all four sides instead of two — and held back to where
    // it still has the whole of the view, since a view eight tiles wide has
    // no middle to spare and hanging it there would leave a column out.
    const middleX = (bounds.minX + bounds.maxX) / 2
    const middleY = (bounds.minY + bounds.maxY) / 2
    const half = Math.floor(WINDOW / 2)
    this.want = {
      z,
      x: around(tileXAt(middleX, z) - half, tileXAt(bounds.minX, z), tileXAt(bounds.maxX, z)),
      y: around(tileYAt(middleY, z) - half, tileYAt(bounds.maxY, z), tileYAt(bounds.minY, z)),
    }
    this.askAll()
    return true
  }

  /**
   * Turns the picture over to the window that was being fetched.
   *
   * Called once the window on its way has everything that is coming to it,
   * so that what replaces the picture is a whole picture. The canvas is
   * cleared here, and a canvas cleared with tiles still in the air is a hole
   * the size of the view.
   */
  private turnOver(): void {
    const want = this.want
    if (!want) return
    this.setOut(this.at, want)
    this.at = want
    this.want = null
    const { z, x, y } = want
    this.paper.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.read.forget()
    for (const one of this.held.values()) one.drawn = false
    this.redrawMirror()
    this.picture.needsUpdate = true
    this.options.placed(
      worldXOf(x, z),
      worldYOf(y, z),
      worldXOf(x + WINDOW, z) - worldXOf(x, z),
      worldYOf(y, z) - worldYOf(y + WINDOW, z),
    )
    // What a reading answers has changed under the page whether or not any
    // square of the new window is drawn yet: told only when one was, a window
    // of nothing but 404s turned over and the page never heard
    this.moved = true
    // Nothing of the new window is on the canvas yet, so nothing of it is on
    // screen. Left standing from the window before — and a window of nothing
    // but 404s does turn over — the credit went on naming a publisher over a
    // blank canvas.
    this._showing = false
    this.options.holding(false)
    // And everything of the new window already in hand is drawn now. Left to
    // the tiles still coming, the picture was whatever had not landed yet
    // when it turned over — a few squares of colour with the town bare
    // between them.
    this.askAll()
  }

  /** Throws the picture away, for when there is to be no replacement. */
  private restitch(): void {
    this.at = null
    this.want = null
    this.paper.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.read.forget()
    this.redrawMirror()
    this._showing = false
    this.options.holding(false)
    for (const one of this.held.values()) one.drawn = false
    this.picture.needsUpdate = true
    // Nothing to answer with now, which the page is told as it is told of
    // squares landing; see {@link turnOver}
    this.moved = true
  }

  /**
   * Tells the set which tiles the window wants, and draws those already in
   * hand — turning the picture over first where the tiles of the window on
   * its way were all in hand already, which is what going back to a zoom
   * already looked at comes to.
   *
   * The whole window every time rather than what is missing from it. The set
   * is told what is wanted and works the rest out itself: what to fetch, what
   * is already on its way, what failed and is not due to be asked again yet,
   * and what has fallen out of the window and can go.
   */
  private askAll(): void {
    if (this.want && this.allHeld(this.want)) this.turnOver()
    const at = this.want ?? this.at
    if (!at) return
    const wanted: TileId[] = []
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        const tile = { z: at.z, x: at.x + across, y: at.y + down }
        wanted.push(tile)
        const key = tileKey(tile)
        const one = this.held.get(key)
        // Only into the picture in hand; a window still on its way has
        // nowhere to be drawn until it turns over
        if (one && !one.drawn && at === this.at) this.stamp(key, across, down)
      }
    }
    this.tiles.sync(wanted)
  }

  /**
   * Starts each square of the new window coming in.
   *
   * Ground the last window already covered is up at once — the same map was
   * there a frame ago, and fading it in would say something arrived that did
   * not. The rest sets off from what was already covered and spreads outward,
   * so the straight edge where the last picture stopped travels away instead
   * of vanishing.
   *
   * That is for a window that moved at one zoom. A window that changed zoom
   * comes up whole, for the same reason the covered ground does: it is the
   * ground that was already there, drawn in squares of another size.
   *
   * By the page's own pace, which is the one the buildings rise at: a page
   * that asked for nothing to rise gets nothing to fill in either.
   */
  private setOut(was: Window | null, want: Window): void {
    const takes = appearTakes()
    const now = performance.now()
    const held = was ? worldOf(was) : null
    const reach = Math.max(worldXOf(want.x + WINDOW, want.z) - worldXOf(want.x, want.z), 1)
    // A step of zoom is not an arrival. The same ground was on screen a
    // frame ago and all that changed is how big the squares it is drawn in
    // are, so bringing it in would say something came that was already
    // there. Measured on one step out, 44 of the 64 squares set off from
    // nothing and four of them were already painted — ground going dark and
    // coming back, which is the blink. The spread below is for a window that
    // moved at one zoom, where the land really is new.
    this.filling = takes > 0 && (!was || was.z === want.z)
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        const k = down * WINDOW + across
        if (!this.filling) {
          this.from[k] = 0
          this.upTo(k, 255)
          continue
        }
        const x = (worldXOf(want.x + across, want.z) + worldXOf(want.x + across + 1, want.z)) / 2
        const y = (worldYOf(want.y + down, want.z) + worldYOf(want.y + down + 1, want.z)) / 2
        const out = held ? outside(held, x, y) : reach
        if (out === 0) {
          // Already covered: up, and nothing to wait for
          this.from[k] = 0
          this.upTo(k, 255)
          continue
        }
        this.from[k] = now + appearStagger() * 1000 * Math.min(1, out / reach)
        this.upTo(k, 0)
      }
    }
    this.comingTexture.needsUpdate = true
  }

  /** Brings each square along, and stops once every one is up. */
  private fill(): void {
    if (!this.filling) return
    const takes = appearTakes() * 1000
    const now = performance.now()
    let waiting = false
    for (let k = 0; k < WINDOW * WINDOW; k++) {
      if (this.coming[k * 4] === 255) continue
      const gone = takes > 0 ? (now - (this.from[k] ?? 0)) / takes : 1
      const up = Math.round(Math.min(1, Math.max(0, gone)) * 255)
      this.upTo(k, up)
      if (up < 255) waiting = true
    }
    this.filling = waiting
    this.comingTexture.needsUpdate = true
  }

  /** Whether any square is still coming in. */
  get arriving(): boolean {
    return this.filling
  }

  /** How far one square is in, written where the card reads it. */
  private upTo(square: number, up: number): void {
    this.coming[square * 4] = up
    this.coming[square * 4 + 3] = 255
  }

  /**
   * Whether a window has everything it is going to get in the next breath:
   * each tile in hand, or else failed and waiting out its backoff.
   *
   * Not the same question as {@link allHeld}. A set with a hole in it — a
   * tile the host keeps refusing — would never be all in hand, and a picture
   * held back for it would be the last zoom's forever. What is asked here is
   * whether anything is still on its way.
   */
  private settled(window: Window): boolean {
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        const key = tileKey({ z: window.z, x: window.x + across, y: window.y + down })
        if (!this.held.has(key) && !this.beaten.has(key)) return false
      }
    }
    return true
  }

  /** Whether every tile of a window is in hand, drawn or not. */
  private allHeld(window: Window): boolean {
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        const key = tileKey({ z: window.z, x: window.x + across, y: window.y + down })
        if (!this.held.has(key)) return false
      }
    }
    return true
  }

  /** Draws one tile in hand into its place on the picture. */
  private stamp(key: string, across: number, down: number): void {
    const one = this.held.get(key)
    if (!one) return
    one.drawn = true
    if (!one.bitmap) return
    const size = this._tileSize
    // Laid at its own size, so nothing is resampled; and where a tile comes in
    // at another size than said, nearest keeps the colours the file's own.
    // Set each time, since a canvas given a new size forgets it
    this.paper.imageSmoothingEnabled = false
    this.paper.drawImage(one.bitmap, across * size, down * size, size, size)
    this.read.forget()
    if (this.mirror) {
      this.mirror.paper.imageSmoothingEnabled = false
      this.mirror.paper.drawImage(one.bitmap, across * size, down * size, size, size)
      this.mirror.read.forget()
    }
    this.picture.needsUpdate = true
    this._showing = true
    // And the walls may wear it now; see `PictureSheet.holding`
    this.options.holding(true)
    this.moved = true
    this.options.stamped?.(across, down)
  }

  /**
   * Fetches one tile, for the set; see `TileSetOptions.load`.
   *
   * A tile the server says is not there is held as nothing rather than asked
   * for again: a set covers what it covers, and the sea between two rivers is
   * a 404 every time. Only what {@link transient} calls temporary is thrown,
   * and the set is what reads a throw as worth coming back for and doubles
   * the wait; see contract 4 and 7.
   *
   * **Nothing is handed back for the set to hold.** What this makes is pixels,
   * and they go into {@link held} where {@link stamp} can find them again;
   * the set's part is to say when the tile is no longer wanted. An empty
   * square goes in by the same door rather than being handed back as nothing.
   * Handed back as nothing it would never be asked for again, which is right
   * — but the set would hold no place for it either, and then what is in hand
   * would be in two maps, one of them counted and dropped and the other not.
   */
  private async load(tile: TileId, signal: AbortSignal): Promise<Object3D[] | null> {
    const key = tileKey(tile)
    const answer = await this.options.ask()(this.addressOf(tile), 'tile', { signal })
    let bitmap: ImageBitmap | null = null
    if (answer.ok) {
      try {
        bitmap = await createImageBitmap(await answer.blob())
      } catch (cause) {
        // It came and is not a picture — a page of HTML a host at the wrong
        // address hands back as 200, say. The same bytes come back every time,
        // so the set is told to stop asking rather than back off and ask for
        // as long as the page is open (see `Unreadable`)
        if (signal.aborted) return null
        throw new Unreadable(`${this.addressOf(tile)} is not a picture: ${String(cause)}`)
      }
      if (signal.aborted) {
        bitmap.close()
        return null
      }
    } else if (transient(answer.status)) {
      throw new Error(`HTTP ${answer.status}`)
    }
    // Not there, which for a tile set is an answer and not a failure — and an
    // answer has to go on to the square below, the same as a tile that came.
    // Stopped here, a window with no tile anywhere in it never turned over,
    // and a set's fine zooms really do miss ground its coarse ones have: over
    // 由比ヶ浜, 17/116337/51778 answers 404 and so does 16/58168/25889, while
    // 15/29084/12944 answers 200. Patchy rather than a coastline, and not a
    // few squares either: of the sixty-four this page's own window asks for
    // at zoom 17, fourteen answer 404 (measured over x 116338 to 116345, y
    // 51775 to 51782).
    //
    // `stamp` takes a square with no bitmap; it marks it drawn and stops.
    this.beaten.delete(key)
    this.held.set(key, { bitmap, drawn: false })
    this.landed(tile)
    return []
  }

  /**
   * One square has answered.
   *
   * The window on its way turns the picture over once it is whole, not on its
   * first tile. Turned over on the first, the canvas was cleared with one
   * square drawn and sixty-three empty, and the picture was a hole for as
   * long as the rest took to land — on every step of a zoom, in both
   * directions. The old one is already on the canvas and costs nothing to
   * keep, so it is kept until there is a whole one to put in its place.
   *
   * With nothing in hand there is no picture to keep and nothing to blink
   * from, so the first tile shows at once and the rest fill in behind it.
   */
  private landed(tile: TileId): void {
    if (this.want && within(this.want, tile)) {
      if (!this.at || this.settled(this.want)) this.turnOver()
    }
    // And only where the window has not moved out from under it while it came
    const at = this.at
    if (at && within(at, tile)) this.stamp(tileKey(tile), tile.x - at.x, tile.y - at.y)
  }

  /** Takes one tile's picture out of hand; see `TileSetOptions.onDrop`. */
  private letGo(key: string): void {
    this.held.get(key)?.bitmap?.close()
    this.held.delete(key)
    this.beaten.delete(key)
  }

  /** Where one tile of the set is, with the place written into the address. */
  private addressOf(tile: TileId): string {
    return this._url
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y))
  }
}

// ── Where a tile is in the world ──────────────────────────
//
// The same arithmetic as `geo/tiles.ts`, said again as numbers in and numbers
// out. There it is reached through `tileBounds`, which builds a rectangle for
// one tile, and through an `axisToTile` that file keeps to itself; here it is
// asked for every window the view moves to.

/** How many tiles one world unit is worth at that zoom. */
function stepAt(z: number): number {
  return (1 << z) / EARTH_CIRCUMFERENCE
}

function tileXAt(worldX: number, z: number): number {
  return Math.floor((worldX + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2) * stepAt(z))
}

function tileYAt(worldY: number, z: number): number {
  return Math.floor((EARTH_CIRCUMFERENCE / 2 - (worldY + WORLD_ORIGIN_Y)) * stepAt(z))
}

function worldXOf(tileX: number, z: number): number {
  return tileX / stepAt(z) - WORLD_ORIGIN_X - EARTH_CIRCUMFERENCE / 2
}

function worldYOf(tileY: number, z: number): number {
  return EARTH_CIRCUMFERENCE / 2 - tileY / stepAt(z) - WORLD_ORIGIN_Y
}

/**
 * Where a window of eight starts, so that it holds the tiles from `first` to
 * `last` and sits as near `wanted` as that allows.
 *
 * {@link fits} is what says there is such a place: it has already turned the
 * zoom down until the view is fewer than eight tiles across.
 */
function around(wanted: number, first: number, last: number): number {
  return Math.min(first, Math.max(last - WINDOW + 1, wanted))
}

/** A window's reach in world units: west and east, and north and south. */
function worldOf(window: Window): { west: number; east: number; north: number; south: number } {
  return {
    west: worldXOf(window.x, window.z),
    east: worldXOf(window.x + WINDOW, window.z),
    north: worldYOf(window.y, window.z),
    south: worldYOf(window.y + WINDOW, window.z),
  }
}

/** How far a place lies outside a reach, in world units, and nought inside it. */
function outside(
  of: { west: number; east: number; north: number; south: number },
  x: number,
  y: number,
): number {
  const across = Math.max(of.west - x, 0, x - of.east)
  const down = Math.max(y - of.north, 0, of.south - y)
  return Math.hypot(across, down)
}

/** Whether a window is at that zoom and has the whole of what is in view inside it. */
function covers(window: Window | null, bounds: WorldBounds, z: number): boolean {
  if (!window || window.z !== z) return false
  return (
    tileXAt(bounds.minX, z) >= window.x &&
    tileXAt(bounds.maxX, z) < window.x + WINDOW &&
    tileYAt(bounds.maxY, z) >= window.y &&
    tileYAt(bounds.minY, z) < window.y + WINDOW
  )
}

/** Whether a tile is one of a window's squares. */
function within(window: Window, tile: TileId): boolean {
  return (
    tile.z === window.z &&
    tile.x >= window.x &&
    tile.x < window.x + WINDOW &&
    tile.y >= window.y &&
    tile.y < window.y + WINDOW
  )
}

/** Whether what is in view fits in one window at that zoom. */
function fits(bounds: WorldBounds, z: number): boolean {
  const across = tileXAt(bounds.maxX, z) - tileXAt(bounds.minX, z)
  const down = tileYAt(bounds.minY, z) - tileYAt(bounds.maxY, z)
  return across < WINDOW && down < WINDOW
}
