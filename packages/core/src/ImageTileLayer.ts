import { texture } from './repaint.js'
import type { Object3D } from 'three/webgpu'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type LoadFailure } from './events.js'
import type { Paints } from './paints.js'
import { PictureSheet, type Texel } from './pictureSheet.js'
import type { ThemeColor } from './theme.js'
import { TileWindow } from './tileWindow.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'
import { ASK_PLAINLY } from './requests.js'

/**
 * A picture somebody else publishes as tiles, laid over the map.
 *
 * The web's map tiles are all the same address — a zoom, a column and a row,
 * and a picture 256 pixels square — so a hazard map, an aerial photograph, an
 * old survey and a country's own base map are one kind of thing to a page.
 * This draws any of them on the land.
 *
 * **A picture**, which is what the name is for. `VectorTileLayer` answers the
 * same addresses and what comes back there is the shapes themselves, to be
 * drawn in the page's own colours. Here what comes back is already drawn, by
 * whoever published it, and what a colour means is theirs to say — so a page
 * that wants to colour a road by a number in its properties wants the other
 * one, and a page that wants the published map as published wants this.
 *
 * It lies on the land rather than floating over it: the sheet follows the
 * heights, so a picture over a hillside runs up the hillside, and it is cut by
 * the viewer's mask like everything else.
 *
 * Drawn, a tile whose colours are a number rather than a picture — the GSI's
 * heights are a 24-bit integer in three bytes — is the noise it looks like.
 * Reading that one set has its own answer; see `elevation.ts`.
 */

export interface ImageTileLayerOptions {
  /**
   * Where the tiles are, with `{z}`, `{x}` and `{y}` in it. The web's usual
   * order — row counted from the north, as the GSI, OSM and everyone else
   * count it.
   */
  readonly url: string
  /**
   * Whose tiles they are, said as their terms ask. Not optional: the line
   * under the map is how a page meets those terms, and a picture drawn with
   * nobody named is a page that has quietly stopped meeting them.
   */
  readonly credit: Credits
  /**
   * The zooms the set holds, 0 to 22 by default. Past the finest the finest
   * is drawn bigger; wider than the coarsest can cover nothing is drawn.
   */
  readonly minZoom?: number
  readonly maxZoom?: number
  /**
   * How many pixels a tile of the set is each way: 256 by default, which is
   * the GSI's and most of the web's, or 512 for a set published at that size
   * (Mapbox's `tileSize`, by its name). Said rightly, a tile is laid at its
   * own size — not squeezed into 256 and blurred, with `colorAt` reading the
   * blend of four texels where the file has one — and chosen at the zoom a
   * tile of that size suits, as Mapbox chooses it. A property afterwards.
   */
  readonly tileSize?: number
  /**
   * How much of the picture goes on, 0 to 1. All of it by default.
   *
   * The word a shape uses for the same number, so that a page thinning a
   * hazard map over the town and a page thinning a ward it painted itself
   * write the same thing.
   */
  readonly opacity?: number
  /**
   * What the sheet is drawn in, where the page would rather it were not the
   * picture's own colours.
   *
   * Only the colour changes. Where the sheet is and how high it stands are
   * still the picture's to say — a water surface read off a hazard map and
   * drawn in water's colour is the map's shape in a colour a reader already
   * knows the meaning of, and the legend is still there to be read beside it.
   *
   * Left out, the sheet wears the picture, which is the plain thing to do
   * with a picture. There is no switch beside it: this says what the picture
   * is drawn in, not whether it is drawn.
   *
   * A pair of colours is one for each of the two palettes, told apart as the
   * sun crosses the horizon. A water colour chosen against the day's pale land
   * may be lost against the night's dark one.
   *
   * Not `material.color`, and not reachable as one: three multiplies its
   * `color` over the map rather than standing in for it. This is a tint and a
   * switch, held as uniforms. **Wherever the picture lands**: the trees and
   * walls it is thrown over (`paints`) wear the same colour as the sheet, and
   * a pair turns over on them at the same moment.
   */
  readonly color?: ThemeColor
  /**
   * Drawn at all.
   *
   * It lands on `root.visible`, and the layer reads it as well as being drawn
   * by it: a picture turned off stitches no window, is taken off the walls
   * that were wearing it (the picture asked for before it goes back on), and
   * is not named in the credits. Nothing three
   * knows about — three would only have stopped drawing the sheet, and left
   * the city painted by a picture that is not there and a line crediting it.
   */
  readonly visible?: boolean
  /**
   * Whether the viewer's mask cuts this picture. On by default, as it is for
   * everything the map itself draws.
   *
   * Off, the sheet is laid over the whole of what the view covers while the
   * city beside it is still cut to the shape — a page showing one district
   * modelled and the country's own map around it. The land under it is cut
   * to the shape unless it is told otherwise too (`ground.masked`).
   *
   * Nothing in three says this, for the reason given on a solid's own
   * `masked`: the shape is a page's ring or polygon baked to a grid and read
   * per fragment, not a plane to clip against.
   */
  readonly masked?: boolean
  /**
   * What the picture lands on. `'ground'` where it is left out.
   *
   * `'ground'` lays it on the land, the trees in it included, and whatever was
   * built there covers it. `'buildings'` and `'all'` throw it down over the
   * map as well, so a wall wears the colour of the ground it stands on all the
   * way up — which is the answer for a published legend (this depth of water
   * here) and a smear for a likeness (one point of tarmac dragged five
   * storeys). Nothing in an address tells the two apart, so the page says
   * which it has. See `projection.ts`.
   *
   * The same word a shape uses, meaning the same thing — but left out it does
   * not mean what it means for a shape. A shape left unpainted is drawn at its
   * own place; a picture has no place of its own to be drawn at, so it is
   * always paint and the word only says where.
   *
   * Every picture on the map and turned on is thrown, one over another in the
   * order they went on (2026-10-29), as their sheets lie on the land: two sets
   * on one map — an aerial photograph under a hazard map — are both on the
   * walls and the trees, the later over the earlier, each at its own
   * `opacity` and in its own {@link color}. Turning one off takes it off the
   * walls and leaves the rest; taking it off the map and putting it back puts
   * it on top. See `projection.ts`.
   */
  readonly paints?: Paints
}

export interface ImageTileLayerEvents {
  /** A tile could not be fetched or could not be read. */
  error: LoadFailure
  /**
   * Everything it was waiting for has arrived, or has failed for good —
   * told on the turn from busy to idle, as the land and the city tell it. A
   * page counting what it holds counts here, once, rather than on every
   * `changed` while more is on its way. `tiles` is how many it holds.
   */
  loaded: { readonly tiles: number }
  /**
   * The picture in hand changed: a piece of it landed, or the whole of it was
   * turned over to cover somewhere else.
   *
   * For a page that reads the picture rather than only looking at it — asking
   * {@link colorAt} of a place, or of every building it has. A reading taken
   * once is wrong a moment later, and the arriving stops without saying so.
   *
   * `tiles` is how many pieces of it are in hand. Named as every fetching
   * layer names it, and meaning here what `Buildings.changed` means there: a
   * page that has to learn a word apiece learns the wrong one.
   *
   * Told at most once a frame, however many pieces landed in it.
   */
  changed: { readonly tiles: number }
}

export class ImageTileLayer implements Layer {
  private viewer: Viewer | null = null
  private readonly events = new Events<ImageTileLayerEvents>()
  private _credit: Credits

  /**
   * The sheet the picture is worn on, and everything that is the same here as
   * for a page's one image; see {@link PictureSheet}.
   */
  private readonly sheet: PictureSheet
  /**
   * Which tiles, holding them, and the picture they are stitched into; see
   * `tileWindow.ts`. In this file until 2026-11-05, when the picture came to
   * be wanted lifted by its legend as well as laid (`ImageExtrusionTileLayer`).
   */
  private readonly window: TileWindow

  constructor(options: ImageTileLayerOptions) {
    this._credit = options.credit
    this.window = new TileWindow({
      url: options.url,
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      tileSize: options.tileSize,
      owner: 'ImageTileLayer',
      ask: () => this.viewer?.request ?? ASK_PLAINLY,
      told: (failure) => this.told(failure),
      placed: (x, y, spanX, spanY) => this.sheet.place(x, y, spanX, spanY),
      holding: (value) => {
        this.sheet.holding = value
      },
    })
    const coming = this.window.comingTexture
    this.sheet = new PictureSheet({
      picture: this.window.picture,
      // How far the square this place falls in has come in. One texel a tile,
      // read nearest, so a square is a square — read smoothly, a tile would
      // bleed into its neighbours and the thing meant to arrive square by
      // square would arrive as a wash.
      upAt: (at) => texture(coming, at).r,
      opacity: options.opacity,
      color: options.color,
      visible: options.visible,
      masked: options.masked,
      paints: options.paints,
    })
  }

  /** The sheet, which the viewer seats; see {@link PictureSheet}. */
  get root(): Object3D {
    return this.sheet.root
  }

  /** Laid on the land, under whatever stands on it; see {@link Stage}. */
  get stage(): Stage {
    return this.sheet.stage
  }

  /**
   * Where the tiles are. Handing it another address is how a page swaps one
   * set for another — the hazard portal publishes a dozen at the same
   * addresses, and a page offering the reader a choice between them is
   * changing this and nothing else.
   *
   * What was fetched is let go of: another set's tiles are another picture at
   * the same addresses, and holding them would draw the old set at the new
   * one's name.
   */
  get url(): string {
    return this.window.url
  }

  set url(value: string) {
    this.window.url = value
  }

  /** Whose tiles they are. Set it with {@link url} where the set changes hands. */
  get credit(): Credits {
    return this._credit
  }

  set credit(value: Credits) {
    this._credit = value
  }

  /** How many pixels a tile of the set is each way; see {@link ImageTileLayerOptions.tileSize}. */
  get tileSize(): number {
    return this.window.tileSize
  }

  set tileSize(value: number) {
    this.window.tileSize = value
  }

  /**
   * The zooms the set holds; see {@link ImageTileLayerOptions.minZoom}.
   *
   * They say what the set at {@link url} publishes, so they change with it:
   * read only, a page moving to a set published to z16 from one published to
   * z17 kept asking for z17 and drew nothing.
   */
  get minZoom(): number {
    return this.window.minZoom
  }

  set minZoom(value: number) {
    this.window.minZoom = value
  }

  get maxZoom(): number {
    return this.window.maxZoom
  }

  set maxZoom(value: number) {
    this.window.maxZoom = value
  }

  /**
   * What the picture is drawn in, or nothing to wear its own, as the page said
   * it; see {@link ImageTileLayerOptions.color}.
   */
  get color(): ThemeColor | undefined {
    return this.sheet.color
  }

  set color(value: ThemeColor | undefined) {
    this.sheet.color = value
  }

  /** Drawn at all. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    this.sheet.visible = value
  }

  /** How much of the picture goes on, 0 to 1. */
  get opacity(): number {
    return this.sheet.opacity
  }

  set opacity(value: number) {
    this.sheet.opacity = value
  }

  on<K extends keyof ImageTileLayerEvents>(
    type: K,
    listener: (event: ImageTileLayerEvents[K]) => void,
  ): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ImageTileLayerEvents>(
    type: K,
    listener: (event: ImageTileLayerEvents[K]) => void,
  ): void {
    this.events.off(type, listener)
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.sheet.attach(viewer)
  }

  detach(): void {
    this.viewer = null
    this.window.clear()
    this.sheet.detach()
  }

  /**
   * A sheet answers two of the words: the mask, and the palette turning over,
   * which is when a pair given as {@link color} changes halves; see
   * {@link Change}. Where it lies is laid again every frame rather than on a
   * word, since a height tile landing moves the land without the view having
   * moved — see {@link frame}.
   */
  changed(what: Change): void {
    this.sheet.changed(what)
  }

  /** What the picture lands on, `'ground'` unless said; see {@link ImageTileLayerOptions.paints}. */
  get paints(): Paints {
    return this.sheet.paints
  }

  set paints(value: Paints) {
    this.sheet.paints = value
  }

  /** Whether the viewer's mask cuts it; see {@link ImageTileLayerOptions.masked}. */
  get masked(): boolean {
    return this.sheet.masked
  }

  set masked(value: boolean) {
    this.sheet.masked = value
  }

  /** Whether it was busy the last frame, to tell the turn to idle once; see {@link sayIfLoaded}. */
  private wasBusy = false

  /** Tells `loaded` on the turn from busy to idle. */
  private sayIfLoaded(): void {
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy && this.events.has('loaded')) this.events.emit('loaded', { tiles: this.window.count })
  }

  /**
   * Once a frame: the sheet laid on the land again, and the window moved if
   * the view has left it.
   *
   * Laid every frame rather than when the view moves, because a height tile
   * landing changes where the land is without the view having moved at all —
   * the same reason the ground lays its own sheet here.
   */
  frame(): void {
    this.sayIfLoaded()
    const viewer = this.viewer
    if (!viewer || !this.sheet.visible) return
    const laid = this.sheet.lay(viewer)
    // Wider than the set can say anything about at its coarsest: nothing drawn
    if (laid && !this.window.frame(laid, viewer.camera.zoom)) this.sheet.drawn = false
    // Once a frame however many squares landed in it: a window filling up
    // would otherwise tell a page sixty-four times that it had changed, and
    // whoever is reading the picture would read it sixty-four times over.
    if (this.window.takeMoved()) this.events.emit('changed', { tiles: this.window.count })
  }

  /**
   * What the published picture says at a place: one texel, as published.
   *
   * **Not what is on the screen.** The screen's colour has been through the
   * light, the tone curve, the mask and whatever was drawn over it, and a
   * page measuring a band against a legend can use none of that. This is the
   * file's own byte.
   *
   * **Null where the picture cannot answer**, which is three cases and all
   * three mean one thing to a page: the view has put no window here, the tile
   * covering the place has not landed, or the set has nothing there. None of
   * them is "clear" — a published legend leaves clear ground at alpha nought,
   * and a page reading "no answer" as "nothing here" would read a hole in the
   * set as ground the water does not reach.
   *
   * **Read off the picture in hand, which is the one being shown**, so a page
   * asking about a place it can see is answered about the very texels drawn
   * there. It costs a read back from a canvas, so it is for a place or a few.
   * A grid of ten thousand of them wants the picture's own grid and one call,
   * which this is not: laid out in metres it samples a raster of roughly
   * metre texels wherever it happens to land, and the bands come back with
   * their edges moved.
   */
  colorAt(at: readonly [number, number]): Texel | null {
    if (!this.window.standing) return null
    const spot = this.sheet.spotOf(at)
    return spot ? this.window.texelAt(spot) : null
  }

  /**
   * Whether tiles are on their way; see {@link Layer.busy}. Without it the
   * viewer's `loaded` came before the picture did, and a page that counted
   * on it read nulls from {@link colorAt} where tiles were still coming.
   */
  busy(): boolean {
    return this.window.busy
  }

  /** Named only while some of the picture is on screen; see contract 6. */
  credits(): readonly Credit[] {
    if (!this.window.showing || !this.sheet.visible) return []
    return this.sheet.drawn || this.sheet.casting ? creditsOf(this._credit) : []
  }

  // No `arriving`, deliberately. That channel is for things that stand on the
  // ground and have not stood up yet — the ground shows a patch at work until
  // its buildings land. A picture is not a thing standing on the ground, and
  // answering it with the tiles on their way filled every one of the ground's
  // sixty-four patches with the window (measured: 64 of 64 on the frame a
  // window moves), so every footprint in view was marked as coming and the
  // whole town went pale while a tile was in the air — and the buildings,
  // which the channel is for, had no slot left to say anything in.
  //
  // There is nothing to announce in any case: the picture in hand stays on
  // screen until its replacement has landed.

  dispose(): void {
    this.window.dispose()
    this.sheet.dispose()
  }

  /** Told to whoever is listening, or said once on the console; see contract 7. */
  private told(failure: LoadFailure): void {
    if (this.events.has('error')) {
      this.events.emit('error', failure)
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[plateau-ui] image tile ${failure.key} could not be fetched`, failure.cause)
  }
}
