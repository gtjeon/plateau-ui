import {
  Break,
  Fn,
  If,
  Loop,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraWorldMatrix,
  float,
  int,
  ivec2,
  mix,
  positionGeometry,
  positionWorld,
  transformNormalToView,
  vec3,
  vec4,
} from 'three/tsl'
import { uniform } from './repaint.js'
import {
  BoxGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGPUCoordinateSystem,
  type BufferGeometry,
  type Node,
  type NodeBuilder,
  type Texture,
} from 'three/webgpu'
import { marksSolid } from './classify.js'
import { TEXELS } from './elevation.js'
import { EARTH_RADIUS, WORLD_ORIGIN_Y, latToY, lonToX } from './geo/mercator.js'
import { metresOnCard, NO_CELLS, NO_TILES, type LandHeights } from './landHeights.js'
import { solid, type SolidMaterial } from './lit.js'
import { lookup } from './lookup.js'
import { MaskShader } from './mask.js'
import { farAlongAt, standsInAs } from './offscreen.js'
import { notPicked } from './pick.js'
import { colorFor, type ThemeColor } from './theme.js'
import type { Viewer } from './Viewer.js'

/**
 * A published picture stood up off the map by its legend: a colour on it
 * means a height, and the ground it covers is raised that high.
 *
 * Everything that is the same whichever way the picture arrives — what a
 * legend is, how the picture is read, how it is drawn. What is **not** here is
 * where the picture comes from: `ImageExtrusionTileLayer` stitches a window of
 * tiles (`tileWindow.ts`) and hands each square over as it lands. The split
 * `PictureSheet` makes for the two image layers, for the same reason.
 *
 * Nothing in the libraries that do the nearest thing reads a height off a
 * picture's colours by a table (surveyed 2026-11-05). deck.gl's `TerrainLayer`,
 * MapLibre's `raster-dem`, OpenLayers' band expressions and three's own
 * `displacementMap` all decode a height linearly from the channels — so many
 * metres a step of red, green and blue — and a legend of a handful of flat
 * colours is not a line through RGB. The table is what is new here.
 */

/**
 * One band of a published legend: the colour it is drawn in, exactly as the
 * picture holds it, and the height it stands for, in metres.
 *
 * The colour is matched to the picture's own bytes, all three of them, and
 * nothing near it counts: a band either is this colour or it is not. That is
 * the line QGIS's paletted renderer draws (a value with no class is not
 * drawn), and it leaves no allowance for a page to have to know about. Said
 * any way three reads a colour — `'#ff9191'`, `'rgb(255,145,145)'`, a number —
 * and read as the sRGB bytes it names. Not a {@link ThemeColor}: it is a
 * reading to match, not a colour to paint, and has no night of its own.
 *
 * What height a band stands for is the page's to say. A published legend
 * gives a band as a range — "0.5m to 3m" — and the same colours carry
 * different breakpoints on different sets of one portal, so no number here
 * would be the publisher's.
 */
export interface LegendEntry {
  readonly color: string | number
  readonly height: number
}

/**
 * The most bands a legend may have: what a byte a pixel holds, nought being
 * "no band". A published legend has a handful.
 */
const MOST_BANDS = 255

/**
 * How many pixels of the picture a look is walked across at most before it
 * gives up and draws nothing.
 *
 * A look only ever walks the stretch between where it comes into the box and
 * where it leaves through the box's floor, and that is short: the tallest band
 * and the rise of the land under the picture, laid over by the tilt. Fourteen
 * metres of band on flat land under the steepest tilt the view allows (70°) is
 * under forty pixels of a picture at about a metre a pixel. This is a backstop
 * for a look that never reaches the floor — one along the horizon of a cube's
 * face — and not a figure any look on the map is expected to come near.
 */
const MOST_STEPS = 2048

/**
 * Whatever a {@link ExtrusionBody} is made with, as its owner was told it.
 */
export interface ExtrusionBodyOptions {
  readonly picture: Texture
  /** How many squares the picture is stitched from, each way. */
  readonly squares: number
  readonly legend: readonly LegendEntry[]
  readonly grounded?: boolean
  readonly opacity?: number
  readonly color?: ThemeColor
  readonly castShadow?: boolean
  readonly masked?: boolean
  readonly visible?: boolean
}

/**
 * The picture itself, stood up: every pixel of it a column as high as its
 * band, with nothing between the picture and the shape to decide the shape.
 *
 * **Drawn by looking, not by corners.** The only shape handed to the card is
 * the box the picture can stand in — its ground, and as high as its tallest
 * band can reach over the land under it. Each pixel of the box walks its own
 * look through the picture a pixel at a time, from where the look comes into
 * the box until it meets a column (its top, or the side of it the look came
 * in through) or leaves the box. What it met is what
 * that pixel draws, and where: its colour is that pixel of the picture, its
 * depth is the depth of the place it met, and the sun's shadow and the mask
 * are read there. So a band's edge is the picture's own edge, pixel for
 * pixel, however it curves and however close the view comes in — the user's
 * call, 2026-11-06, over a grid of eight-metre cells the picture was read onto
 * before, whose cells, not the picture, drew the edges.
 *
 * The same look is walked in the passes that keep a depth (the sun's map, the
 * corner shading, a sight's cube), from their own cameras, by a stand-in
 * the passes are handed for it (`standsInAs`): drawn there as the box, it
 * would throw the shadow of a box.
 *
 * Stepped and only stepped: a column is one band's height across one pixel.
 * Carrying the heights smoothly between pixels was an option and was taken
 * out with the grid (the user's call): what a legend says is classes, and a
 * look walked against a slope rather than a step has to search inside each
 * pixel for where it meets it.
 *
 * **Lit**, as everything that stands is (`lit.ts`), so a column's side reads
 * as a side and the sun throws its shadow. Its colours are the picture's, as
 * reflectances — the same reading the projector gives a texel
 * (`projection.ts`) — so a band reads as its own colour on a face lying flat
 * in full daylight and darker on a side turned from the sun.
 */
export class ExtrusionBody {
  readonly root = new Group()
  /**
   * Which band each pixel of the picture is in, one byte a pixel, nought for
   * none: written by {@link stampSquare} on the processor, which is where the
   * legend's exact match is made, and read on the card as the look walks.
   */
  private bands = new Uint8Array(1)
  private readonly bandTexture = new DataTexture(this.bands, 1, 1, RedFormat, UnsignedByteType)
  /** Each band's height in metres, by its number. */
  private readonly heights = new Float32Array((MOST_BANDS + 1) * 4)
  private readonly heightTexture = new DataTexture(this.heights, MOST_BANDS + 1, 1, RGBAFormat, FloatType)
  private readonly mesh: Mesh<BufferGeometry, SolidMaterial>
  private readonly picture: Texture
  private readonly squares: number
  private readonly mask = new MaskShader()

  /** Where the picture stands: its north-west corner, in world units. */
  private readonly origin = new Vector2()
  /** The same, for the card. */
  private readonly originAt = uniform(new Vector2())
  /** How far the picture runs east and south, in world units. */
  private readonly span = uniform(new Vector2(1, 1))
  /** How many pixels the picture is, across and down. */
  private readonly pixels = uniform(new Vector2(1, 1))
  /** The box it stands in, from its floor to its roof, in world units. */
  private readonly box = uniform(new Vector2(0, 1))
  /** The Mercator angle at the picture's north edge, and how much a world unit south takes off it. */
  private readonly angle = uniform(new Vector2())
  /** Where the picture's corner falls on the land's window, in its readings, and readings to a world unit. */
  private readonly landAt = uniform(new Vector2())
  private readonly landPer = uniform(0)
  private readonly room = uniform(new Vector2(1, 1))
  /** One where the land carries its heights, nought where it lies at the sea. */
  private readonly landOn = uniform(0)
  /** One where a band is counted from the land, nought where from the sea. */
  private readonly counted = uniform(1)
  private readonly tilesRead = lookup(NO_TILES)
  private readonly cellsRead = lookup(NO_CELLS)
  private readonly bandsRead = lookup(this.bandTexture)
  private readonly heightsRead = lookup(this.heightTexture)
  private readonly pictureRead: ReturnType<typeof lookup>
  /** How much of it goes on. */
  private readonly shows = uniform(1)
  private readonly tint = uniform(new Color())
  private readonly tinted = uniform(0)

  private _legend: readonly LegendEntry[] = []
  /** The legend as bytes, for the read of a square: `0xrrggbb` to its band's number. */
  private table = new Map<number, number>()
  private lowestBand = 0
  private tallestBand = 0
  private _grounded: boolean
  private _opacity: number
  private _color: ThemeColor | undefined
  private _masked: boolean
  private viewer: Viewer | null = null
  private land: LandHeights | null = null
  /** What the box was last worked out against; see {@link keep}. */
  private boxedFor = ''
  /**
   * The materials woven so far, opaque and see-through; see {@link dress}.
   * Kept rather than let go of as the other is worn: three weaves a shader per
   * material at about a second apiece, and a page sliding the opacity past one
   * and back would otherwise pay that second on every crossing.
   */
  private readonly woven = new Map<string, SolidMaterial>()
  /** Which of {@link woven} is worn now; empty while the mesh still wears the placeholder it was made with. */
  private wovenFor = ''
  /** What the passes that keep a depth draw it as; see {@link standsInAs}. */
  private readonly twin = new MeshBasicNodeMaterial()
  /** Where each look meets the picture, and what it met; see {@link marched}. */
  private readonly look: Look

  constructor(options: ExtrusionBodyOptions) {
    this.picture = options.picture
    this.squares = options.squares
    this.pictureRead = lookup(options.picture)
    this._grounded = options.grounded ?? true
    this._opacity = unit(options.opacity ?? 1)
    this._masked = options.masked ?? true
    for (const texture of [this.bandTexture, this.heightTexture]) {
      texture.magFilter = NearestFilter
      texture.minFilter = NearestFilter
      texture.generateMipmaps = false
      texture.needsUpdate = true
    }
    // A row of a picture of any width, not only one of four bytes' multiple
    this.bandTexture.unpackAlignment = 1
    this.shows.value = this._opacity
    this.counted.value = this._grounded ? 1 : 0
    this.legend = options.legend
    this.look = this.marched()

    // The box, from nought to one each way; the card stretches it over the
    // picture's ground and from the floor to the roof (`boxAt`)
    const box = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
    this.mesh = new Mesh(box, solid())
    // Stretched on the card, so nothing three measures off the corners says
    // where it is; the same answer the land's own sheet gives
    this.mesh.frustumCulled = false
    this.mesh.geometry.boundingSphere = new Sphere(new Vector3(), Infinity)
    this.mesh.castShadow = options.castShadow ?? true
    this.mesh.receiveShadow = true
    // Not pointed at yet: nothing here answers a click, and found it would take
    // the clicks of the buildings standing in it. Out of three's `Raycaster`
    // with it, which would have found the box and not the columns in it
    // (`notPicked`)
    notPicked(this.mesh)
    this.mesh.visible = false
    this.dressTwin()
    this.dress()
    this.color = options.color
    this.root.add(this.mesh)
    this.root.visible = options.visible ?? true
  }

  /**
   * What each colour stands for; see {@link LegendEntry}. Written again, the
   * owner hands every square in hand over again ({@link stampSquare}): which
   * band a pixel is in is read as a square is, not as it is drawn.
   */
  get legend(): readonly LegendEntry[] {
    return this._legend
  }

  set legend(value: readonly LegendEntry[]) {
    if (value.length > MOST_BANDS) {
      throw new Error(`legend: at most ${MOST_BANDS} bands, got ${value.length}`)
    }
    const table = new Map<number, number>()
    this.heights.fill(0)
    let lowest = Infinity
    let tallest = -Infinity
    value.forEach((entry, at) => {
      if (!Number.isFinite(entry.height)) {
        throw new Error(`legend: a height is a number of metres, got ${entry.height}`)
      }
      const band = at + 1
      table.set(new Color(entry.color).getHex(), band)
      this.heights[band * 4] = entry.height
      lowest = Math.min(lowest, entry.height)
      tallest = Math.max(tallest, entry.height)
    })
    this.heightTexture.needsUpdate = true
    this._legend = Object.freeze(value.map((entry) => Object.freeze({ ...entry })))
    this.table = table
    this.lowestBand = value.length ? lowest : 0
    this.tallestBand = value.length ? tallest : 0
    this.boxedFor = ''
  }

  /** The tallest height the legend says, in metres. */
  get tallest(): number {
    return Math.max(0, this.tallestBand)
  }

  get grounded(): boolean {
    return this._grounded
  }

  set grounded(value: boolean) {
    this._grounded = value
    this.counted.value = value ? 1 : 0
    this.boxedFor = ''
  }

  get opacity(): number {
    return this._opacity
  }

  set opacity(value: number) {
    this._opacity = unit(value)
    this.shows.value = this._opacity
    // See-through is a material of its own (three settles a material's half of
    // the pass as it weaves it); a value either side of one is a uniform
    this.dress()
  }

  get color(): ThemeColor | undefined {
    return this._color
  }

  set color(value: ThemeColor | undefined) {
    this._color = value ?? undefined
    this.retint()
  }

  get castShadow(): boolean {
    return this.mesh.castShadow
  }

  set castShadow(value: boolean) {
    this.mesh.castShadow = value
  }

  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (value === this._masked) return
    this._masked = value
    this.mask.set(value ? (this.viewer?.maskArea ?? null) : null)
  }

  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    this.root.visible = value
  }

  /** Whether it is drawn this frame: the owner's to say, from what is in hand. */
  get drawn(): boolean {
    return this.mesh.visible
  }

  set drawn(value: boolean) {
    this.mesh.visible = value
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.mask.set(this._masked ? viewer.maskArea : null)
    this.mask.fadeInto(viewer.colors.backdrop)
    this.retint()
  }

  detach(): void {
    this.viewer = null
    this.land = null
    this.boxedFor = ''
    this.landOn.value = 0
    this.tilesRead.value = NO_TILES
    this.cellsRead.value = NO_CELLS
    this.drawn = false
  }

  /** The mask moved, or the palette turned over. */
  changed(what: 'mask' | 'colors'): void {
    if (what === 'mask') this.mask.set(this._masked ? (this.viewer?.maskArea ?? null) : null)
    else {
      if (this.viewer) this.mask.fadeInto(this.viewer.colors.backdrop)
      this.retint()
    }
  }

  /**
   * Says where the picture falls, in world units — its west-north corner and
   * how far it runs — and forgets every band, since the picture under them is
   * another one now.
   */
  place(originX: number, originY: number, spanX: number, spanY: number): void {
    this.origin.set(originX, originY)
    this.originAt.value.set(originX, originY)
    this.span.value.set(spanX, spanY)
    this.angle.value.set((originY + WORLD_ORIGIN_Y) / EARTH_RADIUS, 1 / EARTH_RADIUS)
    this.mesh.position.set(originX, 0, -originY)
    this.bands.fill(0)
    this.bandTexture.needsUpdate = true
    this.boxedFor = ''
  }

  /** Where a place on the map falls on the picture, nought to one each way; see `PictureSheet.spotOf`. */
  spotOf(at: readonly [number, number]): readonly [number, number] | null {
    const spanX = this.span.value.x
    const spanY = this.span.value.y
    if (spanX === 0 || spanY === 0) return null
    const u = (lonToX(at[0]) - this.origin.x) / spanX
    const v = (this.origin.y - latToY(at[1])) / spanY
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    return [u, v]
  }

  /**
   * Reads one square of the picture into its bands: every pixel looked up in
   * the legend. A pixel the picture left clear, or one whose colour the legend
   * does not have, is in no band — not raised, and not drawn.
   *
   * Null `data` is a square the set has nothing for; its pixels are cleared.
   */
  stampSquare(across: number, down: number, data: ImageData | null): void {
    if (data) this.fit(data.width * this.squares, data.height * this.squares)
    // Nothing has come yet to say how many pixels a square is, so there is
    // nothing to clear
    else if (this.pixels.value.x < this.squares) return
    const width = this.pixels.value.x
    const squareX = width / this.squares
    const squareY = this.pixels.value.y / this.squares
    const left = across * squareX
    const top = down * squareY
    for (let row = 0; row < squareY; row++) {
      const line = (top + row) * width + left
      if (!data) {
        this.bands.fill(0, line, line + squareX)
        continue
      }
      for (let column = 0; column < squareX; column++) {
        const texel = (row * data.width + column) * 4
        let band = 0
        if ((data.data[texel + 3] ?? 0) > 0) {
          const key =
            ((data.data[texel] ?? 0) << 16) | ((data.data[texel + 1] ?? 0) << 8) | (data.data[texel + 2] ?? 0)
          band = this.table.get(key) ?? 0
        }
        this.bands[line + column] = band
      }
    }
    this.bandTexture.needsUpdate = true
  }

  /**
   * Once a frame: aimed again at the land's window of heights where that has
   * moved, the way the land's own sheet keeps it (`Surface.keep`), and the box
   * worked out again where the land under it or the legend has changed.
   */
  keep(viewer: Viewer): void {
    const land = viewer.elevation ? viewer.landHeights : null
    const on = land?.on === true
    if (!on || !land) {
      if (this.landOn.value !== 0 || this.land) {
        this.land = null
        this.landOn.value = 0
        this.tilesRead.value = NO_TILES
        this.cellsRead.value = NO_CELLS
        this.boxedFor = ''
      }
    } else {
      if (this.land !== land) this.boxedFor = ''
      this.land = land
      if (this.tilesRead.value !== land.tiles) this.tilesRead.value = land.tiles
      if (this.cellsRead.value !== land.cells) this.cellsRead.value = land.cells
      const texel = land.texel
      this.landAt.value.set((this.origin.x - land.west) / texel, (land.north - this.origin.y) / texel)
      this.landPer.value = 1 / texel
      this.room.value.set(land.across * TEXELS, land.down * TEXELS)
      this.landOn.value = 1
    }
    const key = on && land ? `${land.placed}|${land.filled}` : 'flat'
    if (key !== this.boxedFor) {
      this.boxedFor = key
      this.boxIn(on ? land : null)
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    for (const material of this.woven.values()) material.dispose()
    this.woven.clear()
    this.twin.dispose()
    this.bandTexture.dispose()
    this.heightTexture.dispose()
    this.root.clear()
  }

  /**
   * Works out the box the picture can stand in: from the lowest it can go to
   * the highest it can reach, over the land the picture lies on.
   *
   * Never short. The land's own range over the picture comes from the tiles
   * it touches, whole ({@link LandHeights.extremes}), and a metre is taken at
   * the most world units it comes to anywhere between the picture's north and
   * south edges for a height above nought, and at the fewest for one below —
   * Mercator stretches a metre more the further north. A box short of a column
   * would cut its top off where the look came in under it.
   */
  private boxIn(land: LandHeights | null): void {
    const spanX = this.span.value.x
    const spanY = this.span.value.y
    let low = 0
    let high = 0
    if (land) {
      const texel = land.texel
      const u0 = (this.origin.x - land.west) / texel
      const v0 = (land.north - this.origin.y) / texel
      const range = land.extremes(u0, v0, u0 + spanX / texel, v0 + spanY / texel)
      if (range) [low, high] = range
    }
    const base = this._grounded ? [low, high] : [0, 0]
    const floor = Math.min(low, base[0]! + Math.min(0, this.lowestBand), 0)
    const roof = Math.max(base[1]! + Math.max(0, this.tallestBand), floor)
    const stretchAt = (y: number): number => Math.cosh((y + WORLD_ORIGIN_Y) / EARTH_RADIUS)
    const most = Math.max(stretchAt(this.origin.y), stretchAt(this.origin.y - spanY))
    const least = Math.min(stretchAt(this.origin.y), stretchAt(this.origin.y - spanY))
    const inWorld = (metres: number, up: boolean): number => metres * ((metres >= 0) === up ? most : least)
    this.box.value.set(inWorld(floor, false), inWorld(roof, true))
  }

  /** Makes the band and picture size match a picture of this many pixels, clearing the bands if it changed. */
  private fit(width: number, height: number): void {
    if (this.pixels.value.x === width && this.pixels.value.y === height && this.bands.length === width * height) return
    this.bands = new Uint8Array(width * height)
    this.bandTexture.image = { data: this.bands, width, height }
    // Made afresh on the card at the new size; the texture object, which the
    // materials hold, stays
    this.bandTexture.dispose()
    this.bandTexture.needsUpdate = true
    this.pixels.value.set(width, height)
  }

  /** Writes the page's colour into the tint, for the palette now standing. */
  private retint(): void {
    const color = this._color
    this.tinted.value = color === undefined ? 0 : 1
    if (color !== undefined) this.tint.value.set(colorFor(color, this.viewer?.night ?? false))
  }

  /**
   * The look each pixel of the box walks, and where it ends: built once and
   * shared by every material drawing the picture and by the twin the passes
   * draw it with. Read from whatever camera is drawing, so the same nodes
   * answer for the view, the sun and a sight's cube.
   */
  private marched(): Look {
    // Where the box's corner is in the world; every place below is measured
    // from it, east and up and south
    const corner = vec3(this.originAt.x, 0, this.originAt.y.negate())
    // A view drawn square-on to its own plane — the map's camera, the sun —
    // looks one way from every pixel; one drawn from a point looks out from it
    // — told apart by the projection's last column, which is (·, ·, ·, 1)
    // for the one and (0, 0, ·, 0) for the other
    const square = cameraProjectionMatrix.mul(vec4(0, 0, 0, 1)).w.greaterThan(0.5)
    const way = square
      .select(cameraWorldMatrix.mul(vec4(0, 0, -1, 0)).xyz, positionWorld.sub(cameraPosition))
      .normalize()
    // A look from a point inside the box starts at the point, not at the far
    // wall it is drawn on: a sight's eye standing in the water
    const eye = cameraPosition.sub(corner)
    const inside = square
      .not()
      .and(eye.x.greaterThanEqual(0))
      .and(eye.x.lessThanEqual(this.span.x))
      .and(eye.z.greaterThanEqual(0))
      .and(eye.z.lessThanEqual(this.span.y))
      .and(eye.y.greaterThanEqual(this.box.x))
      .and(eye.y.lessThanEqual(this.box.y))
    const from = inside.select(eye, positionWorld.sub(corner))

    const walked = Fn(() => {
      const start = from.toVar()
      const dir = way.toVar()
      const across = this.pixels.x
      const down = this.pixels.y
      const wide = this.span.x.div(across).toVar()
      const deep = this.span.y.div(down).toVar()
      const u = start.x.div(wide).toVar()
      const v = start.z.div(deep).toVar()
      const du = dir.x.div(wide).toVar()
      const dv = dir.z.div(deep).toVar()
      const i = u.floor().clamp(0, across.sub(1)).toInt().toVar()
      const j = v.floor().clamp(0, down.sub(1)).toInt().toVar()
      const stepU = du.greaterThanEqual(0).select(int(1), int(-1)).toVar()
      const stepV = dv.greaterThanEqual(0).select(int(1), int(-1)).toVar()
      const never = float(1e30)
      const movesU = du.abs().greaterThan(1e-12)
      const movesV = dv.abs().greaterThan(1e-12)
      // How far along the look the next edge between pixels is, each way, and
      // how far it is from one such edge to the next
      const nextU = movesU
        .select(
          i
            .toFloat()
            .add(stepU.greaterThan(0).select(float(1), float(0)))
            .sub(u)
            .div(du),
          never,
        )
        .toVar()
      const nextV = movesV
        .select(
          j
            .toFloat()
            .add(stepV.greaterThan(0).select(float(1), float(0)))
            .sub(v)
            .div(dv),
          never,
        )
        .toVar()
      const everyU = movesU.select(float(1).div(du.abs()), never)
      const everyV = movesV.select(float(1).div(dv.abs()), never)
      const t = float(0).toVar()
      /** Which way the look last crossed from one pixel into the next: none yet, east-west, north-south. */
      const crossed = int(0).toVar()
      const met = float(0).toVar()
      const at = float(0).toVar()
      const facingX = float(0).toVar()
      const facingZ = float(0).toVar()
      const columns = across.toInt()
      const rows = down.toInt()

      Loop({ start: int(0), end: int(MOST_STEPS), type: 'int', condition: '<' }, () => {
        // Out of the picture: nothing further along is in it
        If(i.lessThan(0).or(i.greaterThanEqual(columns)).or(j.lessThan(0)).or(j.greaterThanEqual(rows)), () => {
          Break()
        })
        const out = nextU.min(nextV)
        const inAt = start.y.add(dir.y.mul(t))
        const outAt = start.y.add(dir.y.mul(out))
        // The middle of this pixel, east and south of the corner
        const middleX = i.toFloat().add(0.5).mul(wide)
        const middleZ = j.toFloat().add(0.5).mul(deep)
        const band = this.bandsRead.load(ivec2(i, j)).x.mul(255).round().toInt()
        If(band.greaterThan(0), () => {
          // Metres into the world's units by Mercator's stretch where it
          // stands, as the land's own sheet works it out (`ground/surface.ts`)
          const angle = this.angle.x.sub(middleZ.mul(this.angle.y))
          const stretch = angle.exp().add(angle.negate().exp()).mul(0.5)
          // The land under the middle of this pixel: one height for the
          // pixel, so a column's top is flat. Read only where there is a
          // column to stand on it — the rest of the look is a byte a pixel
          const land = metresOnCard(
            this.tilesRead,
            this.cellsRead,
            this.landAt.x.add(middleX.mul(this.landPer)),
            this.landAt.y.add(middleZ.mul(this.landPer)),
            this.room,
          ).mul(this.landOn)
          const metres = this.heightsRead.load(ivec2(band, int(0))).x
          const top = land.mul(this.counted).add(metres).mul(stretch)
          If(inAt.lessThanEqual(top), () => {
            // Came in under the top: the side it crossed into this pixel
            // through, which faces back the way it came
            met.assign(1)
            at.assign(t)
            facingX.assign(crossed.equal(1).select(stepU.toFloat().negate(), float(0)))
            facingZ.assign(crossed.equal(2).select(stepV.toFloat().negate(), float(0)))
            Break()
          })
          If(outAt.lessThanEqual(top), () => {
            // Goes under the top inside this pixel: the top
            met.assign(1)
            at.assign(top.sub(start.y).div(dir.y))
            facingX.assign(0)
            facingZ.assign(0)
            Break()
          })
        })
        // Out of the box at its floor: nothing further on is in it. Not asked
        // of the land under each pixel, which would be a reading of the land a
        // pixel: a look that has gone under the land walks on to the floor,
        // and whatever it meets there is hidden by the land in front of it,
        // which is drawn and keeps its depth
        If(outAt.lessThan(this.box.x), () => {
          Break()
        })
        If(nextU.lessThan(nextV), () => {
          t.assign(nextU)
          nextU.addAssign(everyU)
          i.addAssign(stepU)
          crossed.assign(1)
        }).Else(() => {
          t.assign(nextV)
          nextV.addAssign(everyV)
          j.addAssign(stepV)
          crossed.assign(2)
        })
      })
      return vec4(at, facingX, facingZ, met)
    })

    const ended = walked().toVar('extrusionLook')
    const local = from.add(way.mul(ended.x))
    const world = local.add(corner)
    // A side met where the look came into the box faces the way that face of
    // the box does; one met further in faces the way it was crossed
    const facing = vec3(ended.y, float(1).sub(ended.y.abs()).sub(ended.z.abs()), ended.z)
    const onBox = ended.x.lessThanEqual(0).and(ended.y.abs().add(ended.z.abs()).lessThan(0.5))
    const boxFace = this.boxFaceAt(from)
    const normal = onBox.select(boxFace, facing)
    // Which pixel it met: half a pixel into the column from the face met, so
    // that a side, which lies on the edge between two pixels, reads the
    // column's own
    const pixel = ivec2(
      local.x
        .div(this.span.x.div(this.pixels.x))
        .sub(normal.x.mul(0.5))
        .floor()
        .clamp(0, this.pixels.x.sub(1))
        .toInt(),
      local.z
        .div(this.span.y.div(this.pixels.y))
        .sub(normal.z.mul(0.5))
        .floor()
        .clamp(0, this.pixels.y.sub(1))
        .toInt(),
    )
    const seen = cameraViewMatrix.mul(vec4(world, 1))
    const depth = Fn((builder: NodeBuilder) => {
      const clip = cameraProjectionMatrix.mul(seen)
      const flat = clip.z.div(clip.w)
      // Three's own two conventions: WebGPU's projection ends at nought to
      // one, WebGL's at minus one to one, and the depth written is nought to
      // one on both (`shadows.ts` reads the sun's map the same way)
      return builder.renderer.coordinateSystem === WebGPUCoordinateSystem ? flat : flat.mul(0.5).add(0.5)
    })()
    return {
      met: ended.w.greaterThan(0.5),
      world,
      normal,
      pixel,
      depth: depth as Node<'float'>,
      viewZ: seen.z,
    }
  }

  /** Which face of the box a place on it lies on, as that face's way out. */
  private boxFaceAt(place: Node<'vec3'>): Node<'vec3'> {
    // How far the place is from each face, the nearest being the one it is on
    const west = place.x
    const east = this.span.x.sub(place.x)
    const north = place.z
    const south = this.span.y.sub(place.z)
    const roof = this.box.y.sub(place.y)
    const sides = west.min(east).min(north).min(south)
    const side = west
      .lessThanEqual(sides)
      .select(
        vec3(-1, 0, 0),
        east.lessThanEqual(sides).select(vec3(1, 0, 0), north.lessThanEqual(sides).select(vec3(0, 0, -1), vec3(0, 0, 1))),
      )
    return roof.lessThanEqual(sides).select(vec3(0, 1, 0), side) as Node<'vec3'>
  }

  /** The box stretched over the picture's ground, from the floor to the roof. */
  private boxAt(): Node<'vec3'> {
    const at = positionGeometry
    return vec3(at.x.mul(this.span.x), mix(this.box.x, this.box.y, at.y), at.z.mul(this.span.y)) as Node<'vec3'>
  }

  /**
   * The twin the passes that keep a depth draw it with: the same box, the same
   * look from their own camera, the same cut, and the depth of what was met —
   * with how far along that camera's look it is written into the colour, as
   * every depth stand-in writes it (`farAlong`). Both sides, so that a sight's
   * eye inside the box finds it from within.
   */
  private dressTwin(): void {
    const twin = this.twin
    twin.side = DoubleSide
    twin.positionNode = this.boxAt()
    twin.depthNode = this.look.depth
    twin.colorNode = farAlongAt(this.look.viewZ)
  }

  /**
   * Wears the material for whether it is see-through, weaving it the first
   * time it is wanted. Anything else is a uniform and weaves nothing.
   */
  private dress(): void {
    const seeThrough = this._opacity < 1
    const key = seeThrough ? 'see-through' : 'opaque'
    if (key === this.wovenFor) return
    const first = this.wovenFor === ''
    this.wovenFor = key
    const had = this.woven.get(key)
    if (had) {
      this.mesh.material = had
      return
    }
    // One side: the map's camera and the sun are outside the box, and a look
    // drawn on the far side of it walks out of the picture at once
    const material = solid({ transparent: seeThrough, side: FrontSide })
    marksSolid(material)
    const look = this.look
    material.positionNode = this.boxAt()
    material.depthNode = look.depth
    material.normalNode = transformNormalToView(look.normal).normalize() as unknown as SolidMaterial['normalNode']
    // The sun's shadow is read where the look met the picture, not on the box
    ;(material as { receivedShadowPositionNode: Node | null }).receivedShadowPositionNode = look.world
    const read = this.pictureRead.load(look.pixel).rgb
    material.colorNode = vec4(mix(read, this.tint, this.tinted), 1) as unknown as SolidMaterial['colorNode']
    material.opacityNode = this.shows as unknown as SolidMaterial['opacityNode']
    // Cut where the look met the picture, and nothing drawn where it met none
    this.mask.apply(material, look.met, look.world.xz as Node<'vec2'>)
    // The twin cuts the same way
    this.twin.maskNode = material.maskNode
    standsInAs(material, this.twin)

    // The placeholder the mesh was made with is nobody's to keep
    if (first) this.mesh.material.dispose()
    this.mesh.material = material
    this.woven.set(key, material)
  }
}

/** Where a pixel's look ends; see {@link ExtrusionBody.marched}. */
interface Look {
  /** Whether it met a column at all. */
  readonly met: Node<'bool'>
  /** Where it met it, in the world. */
  readonly world: Node<'vec3'>
  /** The way the face it met looks out. */
  readonly normal: Node<'vec3'>
  /** The pixel of the picture that column stands on. */
  readonly pixel: Node<'ivec2'>
  /** The depth of the place met, as the camera drawing writes it. */
  readonly depth: Node<'float'>
  /** The place met along the drawing camera's look, as three's `positionView.z`. */
  readonly viewZ: Node<'float'>
}

function unit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
