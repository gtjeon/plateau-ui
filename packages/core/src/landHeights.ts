import { float, ivec2, mix, vec2 } from 'three/tsl'
import {
  DataArrayTexture,
  DataTexture,
  FloatType,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  type Node,
  type TextureNode,
} from 'three/webgpu'
import {
  finestHeld,
  FINEST_HEIGHTS,
  heldAt,
  heightsUnder,
  heightsVersion,
  heightZoom,
  packed,
  TEXELS,
} from './elevation.js'
import { EARTH_CIRCUMFERENCE, WORLD_ORIGIN_X, WORLD_ORIGIN_Y, type WorldBounds } from './geo/mercator.js'
import type { Ask } from './requests.js'

/**
 * The land's heights where the card can read them, for the sheet that is the
 * land (`ground/surface.ts`) to read each corner of itself — and each pixel.
 *
 * ## Why the card reads them
 *
 * The sheet used to be raised on the processor: every corner read the tiles in
 * hand as the view moved, and the way the ground faced was worked out corner by
 * corner from those readings. So the land read no finer than the sheet was
 * cut, and the sheet is cut to about 160 cells across whatever is in view —
 * some six pixels a cell. The readings come about one to two pixels apart at
 * every zoom up to 14 (the ground asks for the tiles of its own zoom), so five
 * ridges out of six fell between two corners. Over the whole of Honshu (z7, a
 * 750-pixel canvas, measured) a cell was 8,192 world units where the readings
 * came every 1,223, and the country shaded as though it were smooth.
 *
 * Read here instead, every pixel of the land can say which way it faces from
 * the readings themselves, at whatever zoom the view is at.
 *
 * ## What is held
 *
 * A window of tiles at one zoom, at most {@link WINDOW} each way, over what is
 * in view: the zoom the ground itself reads at, or coarser where the view is
 * too wide for the window to cover at that one. Each tile is a layer of an
 * array texture, with two readings borrowed from each neighbour all round, so
 * a place near a tile's edge reads the readings around it out of one layer.
 * A small table says which layer each tile of the window reads. A tile not in
 * hand is pieced together from the finer tiles that are, up to {@link FINER}
 * zooms finer ({@link fromFiner}); failing that it reads the nearest coarser
 * tile that is, the way {@link Heights} does; and one with nothing in hand
 * reads sea level, which is also what {@link Heights.at} answers. A pieced tile
 * is put over by the tile itself when it lands.
 *
 * _(2026-10-29: the finer half is new. Until then a tile not in hand read the
 * coarser ones alone, so a view stepping out past a whole zoom drew the land
 * at whatever coarser tile was held — sea level, over ground not seen from
 * further out before — until the window's own tiles landed: measured at Aso,
 * z14.4 out to z11.6 at four zooms a second, the land under the middle of the
 * view read 0m for five to nine frames at each whole zoom crossed, where the
 * tiles stepped out of were in hand all along.)_
 *
 * A layer is 260×260 readings of four bytes: 270kB. It starts at
 * {@link FIRST_LAYERS} and doubles as the window asks for more, to {@link
 * MOST_LAYERS} — 17.3MB on the card at most, and the same again here, since
 * three uploads a layer out of an array it keeps. Measured on a 750×470
 * canvas: 中野 at z18.3 is one tile and keeps the first four layers (1.1MB);
 * 北アルプス at z10 is five tiles by four and grows to 32 (8.7MB).
 *
 * ## What reads it
 *
 * The card, through {@link metresOnCard}, and the processor through
 * {@link LandHeights.metresAt}: the same arithmetic on the same numbers, for
 * whatever has to answer where the sheet is drawn — three's `Raycaster`, and
 * how far the land in view rises.
 *
 * What it does not change is everything else that reads the heights. The city,
 * a page's marks, its shapes and the camera read {@link heightsInHand} as
 * before, and the ground's own roads and rivers the tiles of their own zoom.
 * From z14 in, the window is z14 and both are the same readings read the same
 * way. Further out the window is the ground's own zoom while what is in hand
 * may be finer where the view has been close before, and the two then part by
 * what lies between one reading of the window and the next. Measured at
 * 槍ヶ岳, looked at from z15 and then from z11.2: of the sheet's 16,641
 * corners, 552 read differently from the tiles in hand, by 25m at the most,
 * where a pixel there is 54m. Where nothing finer is in hand the two agree to
 * the last digit (361 corners over 北アルプス at z11.5, none apart).
 */

/** Tiles across and down the window, at most. */
export const WINDOW = 8

/**
 * How many zooms finer a window tile not in hand is pieced together from.
 *
 * Two, because a view steps out a zoom at a time and the tiles it stepped out
 * of are the ones in hand: one zoom covers a step, and the second covers a
 * view stepping out faster than the next zoom's tiles come back. Each zoom
 * finer is four times the tiles to look up and average, so it stops there —
 * a tile pieced from three zooms finer is sixty-four tiles' worth of work for
 * a picture that is about to be put over.
 */
const FINER = 2

/**
 * Readings borrowed from each neighbour, all round a layer.
 *
 * Two, because the way the land faces at a pixel is read from the four
 * readings around it and the one beyond each of those (see
 * {@link slopeOnCard}), and a pixel at a tile's very edge reaches two
 * readings into the next.
 */
const BORDER = 2

/** Readings across a layer: a tile, and {@link BORDER} of each neighbour either side. */
const SIDE = TEXELS + 2 * BORDER

/** Layers the texture is made with; it doubles from here as the window asks. */
const FIRST_LAYERS = 4

/** As many layers as the window has tiles, which is as many as it can ever ask for. */
const MOST_LAYERS = WINDOW * WINDOW

/**
 * How far short of the window's far edge a place is held, in readings.
 *
 * The sheet runs a little past what is in view, and past the window's edge
 * there is nothing to read; held just inside it, the last reading is drawn
 * out across what is off the screen anyway. A hair inside, so that the tile
 * found for it is the window's last and not one past it.
 */
const EDGE = 1 / 1024

/** What a layer holds. */
interface Slot {
  readonly key: number
  readonly z: number
  readonly x: number
  readonly y: number
  /**
   * Which of the eight neighbours its border was read from, a bit apiece. A
   * neighbour not in hand is stood in for by the tile's own edge, and read in
   * once it arrives.
   */
  real: number
  /** The fill it was last wanted by, so the one wanted longest ago goes first. */
  wanted: number
}

/** All eight neighbours read; see {@link LandHeights.edge}, which numbers them. */
const ALL_SIDES = 0b1111011110

/** What one tile of the window reads. */
interface Want {
  readonly key: number
  readonly z: number
  readonly x: number
  readonly y: number
  /** Its readings, where they have to be written into a layer; null where a layer holds them already. */
  readonly readings: Float32Array | null
  /** That the readings were pieced together from finer tiles; see {@link fromFiner}. */
  readonly pieced?: boolean
  /** That a layer holds a pieced copy of this tile, which these readings, its own, are to put over. */
  readonly overPieced?: boolean
}

/**
 * A layer that holds nothing, and a table that says so: what the sheet reads
 * before it is on a viewer, or with the heights turned off. The same shapes as
 * the real ones, so swapping them in weaves nothing again.
 */
export const NO_TILES = new DataArrayTexture(new Float32Array(SIDE * SIDE), SIDE, SIDE, 1)
export const NO_CELLS = new DataTexture(new Float32Array([-1, 1, 0, 0]), 1, 1, RGBAFormat, FloatType)
for (const empty of [NO_TILES, NO_CELLS]) readAsIs(empty)
NO_TILES.format = RedFormat

/** Readings rather than colours: no filtering, no mipmaps, no colour space. */
function readAsIs(texture: DataArrayTexture | DataTexture): void {
  texture.type = FloatType
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
}

/**
 * Where a place of the window falls on the card: the cell's entry in the
 * table, the place in the readings of the tile that cell reads, the reading
 * at or before it, and which layer holds that tile.
 *
 * The half of {@link metresOnCard} and {@link slopeOnCard} that finds the
 * readings, written once so that the two cannot come to read different ones.
 */
function placeOnCard(cells: TextureNode, u: Node<'float'>, v: Node<'float'>, room: Node<'vec2'>) {
  const across = u.clamp(0, room.x.sub(EDGE)).toVar()
  const down = v.clamp(0, room.y.sub(EDGE)).toVar()
  const entry = cells
    .load(ivec2(across.div(TEXELS).floor().toInt(), down.div(TEXELS).floor().toInt()))
    .toVar()
  // Where the place falls in the tile its cell reads, in that tile's own
  // readings — coarser ones where the cell reads a coarser tile — and half a
  // reading back, since a reading stands at the middle of its own square
  const x = across.sub(entry.z).mul(entry.y).sub(0.5).toVar()
  const y = down.sub(entry.w).mul(entry.y).sub(0.5).toVar()
  const left = x.floor()
  const top = y.floor()
  // In from the layer's own edge, which is the border borrowed from the tiles
  // beside it
  const at = ivec2(left.toInt().add(BORDER), top.toInt().add(BORDER)).toVar()
  const layer = entry.x.max(0).toInt().toVar()
  return { entry, x, y, left, top, at, layer }
}

/**
 * How high the land is at a place of the window, in metres, read on the card.
 *
 * `u` and `v` are where the place falls on the window, in readings of its
 * zoom, east and south from its north-west corner; `room` is how far the
 * window runs each way in the same. Between the four readings around the
 * place, as {@link Heights} reads it, so that a slope is a slope.
 *
 * Each reading is fetched rather than sampled. A float texture filters only
 * where the card says it may (`float32-filterable`), and where it does the
 * weights are held to a few bits, which is a step in every slope; fetched
 * four times and mixed here, the place is read as the processor reads it.
 */
export function metresOnCard(
  tiles: TextureNode,
  cells: TextureNode,
  u: Node<'float'>,
  v: Node<'float'>,
  room: Node<'vec2'>,
): Node<'float'> {
  const { entry, x, y, left, top, at, layer } = placeOnCard(cells, u, v, room)
  const a = tiles.load(at).depth(layer).x
  const b = tiles.load(at.add(ivec2(1, 0))).depth(layer).x
  const c = tiles.load(at.add(ivec2(0, 1))).depth(layer).x
  const d = tiles.load(at.add(ivec2(1, 1))).depth(layer).x
  const alongX = x.sub(left)
  const height = mix(mix(a, b, alongX), mix(c, d, alongX), y.sub(top))
  // A cell with nothing in hand is the sea, which is what the processor
  // answers for it too
  return entry.x.lessThan(0).select(float(0), height) as Node<'float'>
}

/**
 * Which way the land climbs at a place of the window: metres of rise for a
 * reading of the window eastward, and for one southward. Read on the card, for
 * the way a pixel faces; see `ground/surface.ts`.
 *
 * It is the rise between the readings either side of the place, a reading
 * away each way — what the processor would get by reading the height a
 * reading east and a reading west and taking the difference — but worked out
 * once a reading rather than once a place: the difference across each of the
 * four readings around the place, and those four mixed by where the place
 * falls between them. The two come to the same number, since mixing is what
 * reading between readings is. Twelve readings fetched rather than sixteen,
 * and one look at the table rather than four, which is what the pixels of a
 * whole screen of land pay for.
 */
export function slopeOnCard(
  tiles: TextureNode,
  cells: TextureNode,
  u: Node<'float'>,
  v: Node<'float'>,
  room: Node<'vec2'>,
): Node<'vec2'> {
  const { entry, x, y, left, top, at, layer } = placeOnCard(cells, u, v, room)
  const read = (i: number, j: number): Node<'float'> => tiles.load(at.add(ivec2(i, j))).depth(layer).x
  // The four around the place, and the ring beyond them less its corners
  const h00 = read(0, 0)
  const h10 = read(1, 0)
  const h01 = read(0, 1)
  const h11 = read(1, 1)
  const alongX = x.sub(left)
  const alongY = y.sub(top)
  // East over west, at each of the four, then mixed; half of it, since the
  // two either side are two readings apart
  const east = mix(
    mix(h10.sub(read(-1, 0)), read(2, 0).sub(h00), alongX),
    mix(h11.sub(read(-1, 1)), read(2, 1).sub(h01), alongX),
    alongY,
  ).mul(0.5)
  const south = mix(
    mix(h01.sub(read(0, -1)), h11.sub(read(1, -1)), alongX),
    mix(read(0, 2).sub(h00), read(1, 2).sub(h10), alongX),
    alongY,
  ).mul(0.5)
  // In readings of the window rather than of the tile read, which is coarser
  // where the cell reads a coarser tile; and level where it reads nothing
  return entry.x.lessThan(0).select(vec2(0, 0), vec2(east, south).mul(entry.y)) as Node<'vec2'>
}

/**
 * One tile's readings pieced together from the finer tiles in hand, or nothing
 * where any of the four quarters cannot be had within `depth` zooms.
 *
 * Each reading the mean of the four finer ones it covers: a reading stands at
 * the middle of its square (see {@link metresOnCard}), and the middle of a
 * square is the middle of the four squares a zoom finer that it is cut into.
 * A quarter not in hand is pieced the same way from the zoom below it, as far
 * as `depth` allows; one still missing leaves the whole tile to the coarser
 * walk, since a tile three quarters land and one quarter sea is a worse
 * picture than one a zoom coarser everywhere.
 *
 * For the window stepping out a zoom: what is in hand then is the tiles it
 * stepped out of, which are exactly these quarters. A readings' worth of new
 * memory, 256kB, held only by the layer it is written into.
 */
function fromFiner(z: number, x: number, y: number, depth: number): Float32Array | null {
  if (depth <= 0 || z >= FINEST_HEIGHTS) return null
  const quarters: Float32Array[] = []
  for (let q = 0; q < 4; q++) {
    const qx = 2 * x + (q & 1)
    const qy = 2 * y + (q >> 1)
    const quarter = heldAt(z + 1, qx, qy) ?? fromFiner(z + 1, qx, qy, depth - 1)
    if (!quarter) return null
    quarters.push(quarter)
  }
  const out = new Float32Array(TEXELS * TEXELS)
  const half = TEXELS / 2
  for (let q = 0; q < 4; q++) {
    const quarter = quarters[q]!
    const offsetX = (q & 1) * half
    const offsetY = (q >> 1) * half
    for (let j = 0; j < half; j++) {
      const top = 2 * j * TEXELS
      const bottom = top + TEXELS
      for (let i = 0; i < half; i++) {
        const left = 2 * i
        out[(offsetY + j) * TEXELS + offsetX + i] =
          (quarter[top + left]! + quarter[top + left + 1]! + quarter[bottom + left]! + quarter[bottom + left + 1]!) / 4
      }
    }
  }
  return out
}

/** What a viewer hands over each frame for the window to be chosen by. */
export interface LandWanted {
  /** Whether the land carries its heights at all. */
  readonly on: boolean
  readonly zoom: number
  /** What is in view, which every sheet laid on the land lies inside. */
  readonly bounds: WorldBounds
  readonly signal: AbortSignal
  readonly ask: Ask
}

export class LandHeights {
  /** The readings, a tile a layer. The same texture for life; growing swaps what is behind it. */
  readonly tiles: DataArrayTexture
  /** Which layer each tile of the window reads; see {@link metresOnCard}. */
  readonly cells: DataTexture

  /** The window's zoom, and its north-west tile at that zoom. */
  private zoom = 0
  private originX = 0
  private originY = 0
  /** Tiles across and down the window. */
  private _across = 1
  private _down = 1
  /** World units between two readings of the window. */
  private _texel = 1
  /** Where the window's west edge is, in world x, and its north edge, in world y. */
  private _west = 0
  private _north = 0
  private _on = false
  /** @see placed */
  private _placed = 0
  /** @see filled */
  private _filled = 0

  private data: Float32Array
  private depth = FIRST_LAYERS
  /** The table as it is written into {@link cells}: layer, scale, west, north. */
  private readonly entries: Float32Array
  private readonly slots: (Slot | null)[] = []
  private readonly layerOf = new Map<number, number>()
  /** Which of the tiles in a layer were pieced together from finer ones, and wait to be put over. */
  private readonly pieced = new Set<number>()
  /** The heights in hand when the window was last filled; see `heightsVersion`. */
  private seen = -1
  /** How many times it has been filled, which is what a layer's {@link Slot.wanted} counts in. */
  private fills = 0
  /** That the texture was made afresh this fill, and is sent whole rather than a layer at a time. */
  private grown = false
  /**
   * The lowest and highest reading each layer holds, its border included:
   * worked out as a layer is sent, so that {@link extremes} reads a number a
   * tile rather than every reading of it.
   */
  private readonly layerLow = new Float32Array(MOST_LAYERS)
  private readonly layerHigh = new Float32Array(MOST_LAYERS)

  constructor() {
    this.data = new Float32Array(SIDE * SIDE * FIRST_LAYERS)
    this.tiles = new DataArrayTexture(this.data, SIDE, SIDE, FIRST_LAYERS)
    this.tiles.format = RedFormat
    readAsIs(this.tiles)
    this.entries = new Float32Array(WINDOW * WINDOW * 4)
    this.clearEntries()
    this.cells = new DataTexture(this.entries, WINDOW, WINDOW, RGBAFormat, FloatType)
    readAsIs(this.cells)
    for (let i = 0; i < FIRST_LAYERS; i++) this.slots.push(null)
  }

  /** Whether the heights are on, and the window has anything to say. */
  get on(): boolean {
    return this._on
  }

  /**
   * How many times the window has moved or turned on or off. A sheet aims at
   * it by numbers worked out against where it is, and works them out again
   * when this changes.
   */
  get placed(): number {
    return this._placed
  }

  /** How many times what the window reads has changed. A sheet measures its rise again when this does. */
  get filled(): number {
    return this._filled
  }

  /** Tiles across and down the window. */
  get across(): number {
    return this._across
  }

  get down(): number {
    return this._down
  }

  /** World units between two readings of the window. */
  get texel(): number {
    return this._texel
  }

  /** The window's west edge in world x, and its north edge in world y. */
  get west(): number {
    return this._west
  }

  get north(): number {
    return this._north
  }

  /**
   * The lowest and highest the land can be anywhere over a stretch of the
   * window, in metres, or null with the heights off. The stretch is in
   * readings of the window from its corner, as {@link metresAt} takes a place.
   *
   * Never short of either: a place reads between four readings and never past
   * them, so what a tile can say anywhere lies between the lowest and the
   * highest it holds — and those are what is taken, for every tile the stretch
   * touches. A tile only partly inside gives its whole range, so the answer may
   * be wider than the stretch alone would need, never narrower. A tile of the
   * window not in hand reads as the sea, as {@link metresAt} has it.
   *
   * For a thing that stands on the land and has to know how high it can reach
   * before it is drawn, which is what a picture stood up by its legend is
   * (`imageExtrusion.ts`): the box it is drawn in has to hold it whole.
   */
  extremes(u0: number, v0: number, u1: number, v1: number): readonly [number, number] | null {
    if (!this._on) return null
    const last = (count: number): number => count * TEXELS - EDGE
    const cell = (value: number, count: number): number =>
      Math.floor(Math.min(Math.max(value, 0), last(count)) / TEXELS)
    const i0 = cell(Math.min(u0, u1), this._across)
    const i1 = cell(Math.max(u0, u1), this._across)
    const j0 = cell(Math.min(v0, v1), this._down)
    const j1 = cell(Math.max(v0, v1), this._down)
    let low = Infinity
    let high = -Infinity
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const layer = this.entries[(j * WINDOW + i) * 4]!
        const lo = layer < 0 ? 0 : this.layerLow[layer]!
        const hi = layer < 0 ? 0 : this.layerHigh[layer]!
        if (lo < low) low = lo
        if (hi > high) high = hi
      }
    }
    return [low, high]
  }

  /**
   * Chooses the window for what is in view and fills it from the tiles in
   * hand. Every frame, before the layers lay anything on the land: cheap where
   * nothing moved, which is a comparison of a few numbers and of the version
   * of the heights in hand.
   */
  update(wanted: LandWanted): void {
    if (!wanted.on) {
      if (this._on) {
        this._on = false
        this._placed++
        this._filled++
      }
      return
    }
    const moved = this.choose(wanted.zoom, wanted.bounds) || !this._on
    if (moved) {
      this._on = true
      this._placed++
      // The window's own tiles, asked for once where it lands. Mostly they are
      // the very tiles the ground has asked for already and nothing is fetched;
      // a window pushed a zoom coarser than the ground's by a wide view asks
      // for its own. Let run: what arrives lands in the one store everything
      // reads from, and the version moving brings the window round again.
      heightsUnder(wanted.bounds, this.zoom, wanted.signal, wanted.ask).catch(() => undefined)
    }
    const version = heightsVersion()
    if (moved || version !== this.seen) {
      this.seen = version
      this.fill()
    }
  }

  /**
   * How high the land is at a place of the window, in metres: {@link
   * metresOnCard}, on the processor. Sea level with the heights off.
   */
  metresAt(u: number, v: number): number {
    if (!this._on) return 0
    const across = Math.min(Math.max(u, 0), this._across * TEXELS - EDGE)
    const down = Math.min(Math.max(v, 0), this._down * TEXELS - EDGE)
    const at = (Math.floor(down / TEXELS) * WINDOW + Math.floor(across / TEXELS)) * 4
    const layer = this.entries[at]!
    if (layer < 0) return 0
    const scale = this.entries[at + 1]!
    const x = (across - this.entries[at + 2]!) * scale - 0.5
    const y = (down - this.entries[at + 3]!) * scale - 0.5
    const left = Math.floor(x)
    const top = Math.floor(y)
    const alongX = x - left
    const alongY = y - top
    const first = layer * SIDE * SIDE + (top + BORDER) * SIDE + left + BORDER
    const a = this.data[first]!
    const b = this.data[first + 1]!
    const c = this.data[first + SIDE]!
    const d = this.data[first + SIDE + 1]!
    const above = a + (b - a) * alongX
    const below = c + (d - c) * alongX
    return above + (below - above) * alongY
  }

  dispose(): void {
    this.tiles.dispose()
    this.cells.dispose()
  }

  /**
   * Settles the window for what is in view: the finest zoom, up to the
   * ground's own, at which {@link WINDOW} tiles each way cover it. Says
   * whether it moved.
   *
   * The ground's own zoom is what its readings are asked for at, so the
   * window holds exactly what the roads and rivers lying on the land were laid
   * on. Finer would be readings nobody has asked for; coarser only where the
   * view outruns the window, which is a wide canvas laid well back.
   */
  private choose(viewZoom: number, bounds: WorldBounds): boolean {
    const top = heightZoom(viewZoom)
    let zoom = top
    let x0 = 0
    let y0 = 0
    let x1 = 0
    let y1 = 0
    for (; zoom >= 1; zoom--) {
      const span = EARTH_CIRCUMFERENCE / 2 ** zoom
      const last = 2 ** zoom - 1
      const tile = (value: number): number => Math.min(last, Math.max(0, Math.floor(value / span)))
      x0 = tile(bounds.minX + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2)
      x1 = tile(bounds.maxX + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2)
      y0 = tile(EARTH_CIRCUMFERENCE / 2 - (bounds.maxY + WORLD_ORIGIN_Y))
      y1 = tile(EARTH_CIRCUMFERENCE / 2 - (bounds.minY + WORLD_ORIGIN_Y))
      if (x1 - x0 < WINDOW && y1 - y0 < WINDOW) break
    }
    zoom = Math.max(zoom, 1)
    const across = x1 - x0 + 1
    const down = y1 - y0 + 1
    if (
      zoom === this.zoom &&
      x0 === this.originX &&
      y0 === this.originY &&
      across === this._across &&
      down === this._down
    ) {
      return false
    }
    this.zoom = zoom
    this.originX = x0
    this.originY = y0
    this._across = across
    this._down = down
    const span = EARTH_CIRCUMFERENCE / 2 ** zoom
    this._texel = span / TEXELS
    this._west = x0 * span - WORLD_ORIGIN_X - EARTH_CIRCUMFERENCE / 2
    this._north = EARTH_CIRCUMFERENCE / 2 - y0 * span - WORLD_ORIGIN_Y
    return true
  }

  /**
   * Says what every tile of the window reads, writing into a layer whatever is
   * newly wanted and the borders of whatever has newly found its neighbour.
   *
   * Two passes, so that a layer a later tile of the window wants is never
   * handed to an earlier one and written twice: first what is wanted, then the
   * room for what no layer holds yet.
   */
  private fill(): void {
    this.fills++
    const fill = this.fills
    const z = this.zoom
    const wants: (Want | null)[] = []
    for (let j = 0; j < this._down; j++) {
      for (let i = 0; i < this._across; i++) {
        const x = this.originX + i
        const y = this.originY + j
        const own = packed(z, x, y)
        const held = finestHeld(z, x, y)
        const finer = held === null || held.z < z
        // A tile of the window's own zoom already in a layer is kept in it,
        // even where the store has let it go: what the layer holds is the same
        // land, and dropping to a coarser tile would flatten what is drawn
        // for nothing. That holds for one pieced together from finer tiles
        // too, until the tile itself lands and is written over it.
        const pieces = finer && !this.layerOf.has(own) ? fromFiner(z, x, y, FINER) : null
        if (finer && this.layerOf.has(own)) {
          wants.push({ key: own, z, x, y, readings: null })
        } else if (pieces) {
          wants.push({ key: own, z, x, y, readings: pieces, pieced: true })
        } else if (held && held.z === z && this.pieced.has(own)) {
          wants.push({ key: own, z, x, y, readings: held.readings, overPieced: true })
        } else if (held) {
          const key = packed(held.z, held.x, held.y)
          wants.push({
            key,
            z: held.z,
            x: held.x,
            y: held.y,
            readings: this.layerOf.has(key) ? null : held.readings,
          })
        } else {
          wants.push(null)
        }
      }
    }

    let wrote = false
    for (const want of wants) {
      if (!want) continue
      const layer = this.layerOf.get(want.key)
      const slot = layer === undefined ? undefined : this.slots[layer]
      if (slot) slot.wanted = fill
    }
    for (const want of wants) {
      if (!want || !want.readings) continue
      const had = this.layerOf.get(want.key)
      const slot = had === undefined ? undefined : this.slots[had]
      if (want.overPieced && had !== undefined && slot) {
        // The tile itself has landed: written over the copy pieced together
        // while it was on its way, in the layer that copy was in
        this.pieced.delete(want.key)
        this.write(had, slot, want.readings)
        wrote = true
        continue
      }
      if (had !== undefined) continue
      const layer = this.room(fill)
      const made: Slot = { key: want.key, z: want.z, x: want.x, y: want.y, real: 0, wanted: fill }
      this.slots[layer] = made
      this.layerOf.set(want.key, layer)
      if (want.pieced) this.pieced.add(want.key)
      this.write(layer, made, want.readings)
      wrote = true
    }
    // A layer whose border stood in for a neighbour not then in hand reads the
    // neighbour now it is: the readings either side of a tile's edge are read
    // together, and a stand-in there is a seam down the land
    for (let layer = 0; layer < this.slots.length; layer++) {
      const slot = this.slots[layer]
      if (!slot || slot.wanted !== fill || slot.real === ALL_SIDES) continue
      if (this.edge(layer, slot)) {
        this.sent(layer)
        wrote = true
      }
    }

    const was = this.entries.slice()
    this.clearEntries()
    for (let j = 0; j < this._down; j++) {
      for (let i = 0; i < this._across; i++) {
        const want = wants[j * this._across + i]
        const layer = want ? this.layerOf.get(want.key) : undefined
        if (!want || layer === undefined) continue
        const shift = 2 ** (z - want.z)
        const at = (j * WINDOW + i) * 4
        this.entries[at] = layer
        this.entries[at + 1] = 1 / shift
        // Where the tile it reads begins, in readings of the window from the
        // window's corner: its own corner where it is the window's zoom, a
        // coarser tile's further out
        this.entries[at + 2] = (want.x * shift - this.originX) * TEXELS
        this.entries[at + 3] = (want.y * shift - this.originY) * TEXELS
      }
    }
    let changed = wrote
    for (let k = 0; k < was.length; k++) {
      if (was[k] !== this.entries[k]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.cells.needsUpdate = true
    if (this.grown) {
      // Made afresh, so all of it goes over rather than the layers written
      this.grown = false
      this.tiles.clearLayerUpdates()
      this.tiles.needsUpdate = true
    }
    this._filled++
  }

  /** Nothing read anywhere. */
  private clearEntries(): void {
    for (let at = 0; at < this.entries.length; at += 4) {
      this.entries[at] = -1
      this.entries[at + 1] = 1
      this.entries[at + 2] = 0
      this.entries[at + 3] = 0
    }
  }

  /**
   * A layer for a tile no layer holds: one holding nothing, or the one wanted
   * longest ago of those this fill does not want, growing the texture where
   * every one of them is wanted.
   */
  private room(fill: number): number {
    let oldest = -1
    for (let layer = 0; layer < this.slots.length; layer++) {
      const slot = this.slots[layer]
      if (!slot) return layer
      if (slot.wanted === fill) continue
      if (oldest < 0 || slot.wanted < this.slots[oldest]!.wanted) oldest = layer
    }
    if (oldest >= 0) {
      this.layerOf.delete(this.slots[oldest]!.key)
      this.pieced.delete(this.slots[oldest]!.key)
      this.slots[oldest] = null
      return oldest
    }
    // Every layer is wanted, so the window has more tiles than there are
    // layers. It never has more than {@link MOST_LAYERS}, which is what the
    // texture grows to
    const layer = this.slots.length
    this.grow()
    return layer
  }

  /**
   * Doubles the layers, keeping what they hold.
   *
   * The same texture object, because a material was woven against this one
   * and reads no other afterwards; what three built on the card for it is
   * thrown away and made afresh at the new depth on the next frame. The way
   * `buildings/decals.ts` grows its pictures.
   */
  private grow(): void {
    const depth = Math.min(this.depth * 2, MOST_LAYERS)
    const data = new Float32Array(SIDE * SIDE * depth)
    data.set(this.data)
    this.data = data
    this.depth = depth
    while (this.slots.length < depth) this.slots.push(null)
    this.tiles.image.data = data
    this.tiles.image.depth = depth
    this.tiles.dispose()
    this.grown = true
  }

  /** Writes a tile's readings into a layer, and the borders round them. */
  private write(layer: number, slot: Slot, readings: Float32Array): void {
    const first = layer * SIDE * SIDE
    for (let row = 0; row < TEXELS; row++) {
      this.data.set(
        readings.subarray(row * TEXELS, (row + 1) * TEXELS),
        first + (row + BORDER) * SIDE + BORDER,
      )
    }
    slot.real = 0
    this.edge(layer, slot)
    this.sent(layer)
  }

  /**
   * Writes a layer's border from the tiles either side of it at the same zoom,
   * or from its own edge where a neighbour is not in hand. Says whether any
   * side was newly read from a neighbour.
   *
   * The neighbour at the same zoom and no other, as {@link Heights} reads
   * across an edge. Where one is missing its readings are stood in for by the
   * tile's own nearest: a flat step off the edge rather than the reading the
   * processor would stand in, which takes the first of the four around a
   * place that it has. The two only part over the width of that border, and
   * only until the neighbour lands.
   */
  private edge(layer: number, slot: Slot): boolean {
    const { z, x, y } = slot
    const first = layer * SIDE * SIDE
    const data = this.data
    const was = slot.real
    // The eight around it, by which way across and which way down: -1, 0, 1
    const around: (Float32Array | null)[] = []
    let real = 0
    for (let down = -1; down <= 1; down++) {
      for (let across = -1; across <= 1; across++) {
        const tile = down === 0 && across === 0 ? null : heldAt(z, x + across, y + down)
        around.push(tile)
        // A side read before and let go of by the store since is still that
        // neighbour's land, as the layer keeps its own tile: kept, on the
        // processor and on the card alike, rather than written over with a
        // stand-in only the processor would hold
        const side = 1 << around.length
        if (tile || was & side) real |= side
      }
    }
    const last = TEXELS - 1
    const put = (row: number, column: number): void => {
      const r = row - BORDER
      const c = column - BORDER
      const down = r < 0 ? -1 : r > last ? 1 : 0
      const across = c < 0 ? -1 : c > last ? 1 : 0
      const index = (down + 1) * 3 + across + 1
      const tile = around[index]
      if (!tile && was & (1 << (index + 1))) return
      data[first + row * SIDE + column] = tile
        ? tile[((r + TEXELS) % TEXELS) * TEXELS + ((c + TEXELS) % TEXELS)]!
        : data[
            first + (Math.min(Math.max(r, 0), last) + BORDER) * SIDE + Math.min(Math.max(c, 0), last) + BORDER
          ]!
    }
    for (let k = 0; k < BORDER; k++) {
      for (let column = 0; column < SIDE; column++) {
        put(k, column)
        put(SIDE - 1 - k, column)
      }
      for (let row = BORDER; row < SIDE - BORDER; row++) {
        put(row, k)
        put(row, SIDE - 1 - k)
      }
    }
    slot.real = real
    return (real & ~was) !== 0
  }

  /** Says a layer has to go over again: just that one, unless the texture is going over whole. */
  private sent(layer: number): void {
    let low = Infinity
    let high = -Infinity
    const data = this.data
    for (let at = layer * SIDE * SIDE, end = at + SIDE * SIDE; at < end; at++) {
      const reading = data[at]!
      if (reading < low) low = reading
      if (reading > high) high = reading
    }
    this.layerLow[layer] = low
    this.layerHigh[layer] = high
    if (!this.grown) this.tiles.addLayerUpdate(layer)
    this.tiles.needsUpdate = true
  }
}
