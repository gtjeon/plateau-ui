import { uniform } from './repaint.js'
import type { Object3D } from 'three/webgpu'
import { appearTakes } from './appear.js'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type LoadFailure } from './events.js'
import { latToY, lonToX, type MapBounds, type WorldBounds } from './geo/mercator.js'
import type { Paints } from './paints.js'
import { PictureSheet, type Texel } from './pictureSheet.js'
import type { ThemeColor } from './theme.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'
import { OnePicture } from './onePicture.js'
import { ASK_PLAINLY, type Ask } from './requests.js'

/**
 * One picture somebody published, laid on the land over the rectangle it
 * covers.
 *
 * The other half of {@link ImageTileLayer}, and the same thing once it is on
 * the screen: a plan drawing a ward published as a PNG, a scan of an old
 * survey, an aerial photograph of one morning, a figure out of a report. What
 * a set of tiles delivers in pieces, this delivers in one — and a page that
 * has learnt one has learnt the other, since what the picture is worn on,
 * what a colour may be swapped for, how much of it goes on and whether the
 * mask cuts it are the same words for both; see {@link PictureSheet}.
 *
 * **The page says where it goes.** An image is not a map until somebody says
 * which ground it covers, and nothing in a PNG says so. The rectangle is said
 * by two corners, each a `[longitude, latitude]` like every other place in
 * this library; see {@link MapBounds}.
 *
 * **North up, and square to the meridians.** The picture's top edge is the
 * north edge and its left edge is the west edge. That is what a world file,
 * a WMS answer and a georeferenced export all give, and it is what the
 * rectangle can say; a picture that has been turned, or that wants its four
 * corners put in four places, is not this.
 *
 * It lies on the land rather than floating over it, so a plan over a hillside
 * runs up the hillside, and it is cut by the viewer's mask like everything
 * else. The cost is the sheet it is worn on: that is cut to the **view** and
 * not to the picture, so one image over a single block is still a sheet
 * across the screen, drawing nothing outside the rectangle.
 */
export interface ImageLayerOptions {
  /** Where the picture is. */
  readonly url: string
  /**
   * What ground it covers, as the two corners of a rectangle.
   *
   * The picture's top-left corner goes at the north-west of it and its
   * bottom-right at the south-east — which is to say the picture is laid
   * north up and square to the meridians; see the class doc.
   */
  readonly bounds: MapBounds
  /**
   * Whose picture it is, said as their terms ask. Not optional: the line
   * under the map is how a page meets those terms, and a picture drawn with
   * nobody named is a page that has quietly stopped meeting them.
   */
  readonly credit: Credits
  /** How much of the picture goes on, 0 to 1. All of it by default. */
  readonly opacity?: number
  /**
   * What it is drawn in, where the page would rather it were not the
   * picture's own colours. Only the colour changes; where it lies is still
   * the picture's to say.
   *
   * Left out, it wears its own colours. No switch beside it: this says what
   * the picture is drawn in, not whether it is drawn. A pair of colours is
   * one for each of the two palettes, told apart as the sun crosses the
   * horizon — a plan's lines drawn in a navy chosen against the day's paper
   * are lost on the night's.
   *
   * The trees and walls it is thrown over wear it too; see {@link paints}.
   */
  readonly color?: ThemeColor
  /** Drawn at all. It lands on the root, and the layer reads it as well. */
  readonly visible?: boolean
  /** Whether the viewer's mask cuts it. On by default, as for everything. */
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
   * What is thrown is thrown in {@link color} where there is one, the same as
   * the sheet. And every picture on the map and turned on is thrown, one over
   * another in the order they went on (2026-10-29), as their sheets lie on the
   * land: turning one off takes it off the walls and leaves the rest, and
   * taking it off the map and putting it back puts it on top. See
   * `projection.ts`.
   */
  readonly paints?: Paints
}

export interface ImageLayerEvents {
  /** The picture could not be fetched, or could not be read. */
  error: LoadFailure
  /**
   * Everything it was waiting for has arrived, or has failed for good —
   * told on the turn from busy to idle, as the land and the city tell it. A
   * page counting what it holds counts here, once, rather than on every
   * `changed` while more is on its way. `tiles` is how many it holds.
   */
  loaded: { readonly tiles: number }
  /**
   * The picture in hand changed: it landed, or it was let go of.
   *
   * For a page that reads the picture rather than only looking at it — asking
   * {@link colorAt} of a place, or of every building it has. A reading taken
   * once is wrong a moment later, and the arriving stops without saying so.
   *
   * `tiles` is how many pieces of it are in hand, which for one picture is one or none. Named as every fetching
   * layer names it, and meaning here what `Buildings.changed` means there: a
   * page that has to learn a word apiece learns the wrong one.
   */
  changed: { readonly tiles: number }
}

export class ImageLayer implements Layer {
  /** How this layer fetches: through its viewer's `transformRequest`, or plainly before it has one. */
  private get requester(): Ask {
    return this.viewer?.request ?? ASK_PLAINLY
  }

  private readonly events = new Events<ImageLayerEvents>()
  private viewer: Viewer | null = null

  private _bounds: MapBounds
  private _credit: Credits

  /**
   * The picture, fetched whole and held on a canvas the sheet reads; see
   * {@link OnePicture}. Its texture is the one the sheet's shader holds for
   * good, so a picture arriving later is drawn into it rather than handed
   * over in its place; see {@link PictureSheetOptions.picture}.
   */
  private readonly picture: OnePicture
  private readonly sheet: PictureSheet

  /** The rectangle in world units, worked out from {@link bounds} as it is set. */
  private where: WorldBounds

  /** Whether the view touches the rectangle, as the last frame found; see {@link credits}. */
  private inView = false
  /** How far in the picture is, and when it started coming; see {@link fill}. */
  private readonly up = uniform(1)
  private from = 0
  private filling = false

  constructor(options: ImageLayerOptions) {
    this._bounds = where(options.bounds)
    this._credit = options.credit
    this.picture = new OnePicture({
      url: options.url,
      ask: () => this.requester,
      told: (failure) => this.told(failure),
      landed: () => this.landed(),
      gone: () => this.events.emit('changed', { tiles: 0 }),
    })

    this.sheet = new PictureSheet({
      picture: this.picture.texture,
      // One picture arrives at one moment, so how far in it is is one number
      // rather than a reading off a texture — which is what a window of tiles
      // coming in square by square needs.
      upAt: () => this.up,
      opacity: options.opacity,
      color: options.color,
      visible: options.visible,
      masked: options.masked,
      paints: options.paints,
    })
    this.where = this.seat()
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
   * Where the picture is. Handing it another address is how a page swaps one
   * picture for another — a reader choosing between this year's plan and last
   * year's is changing this and nothing else.
   */
  get url(): string {
    return this.picture.url
  }

  set url(value: string) {
    if (this.picture.url === value) return
    this.letGo()
    this.picture.url = value
    this.heard()
  }

  /** What ground it covers; see {@link ImageLayerOptions.bounds}. */
  get bounds(): MapBounds {
    return where(this._bounds)
  }

  set bounds(value: MapBounds) {
    this._bounds = where(value)
    this.where = this.seat()
  }

  /** Whose picture it is. Set it with {@link url} where the picture changes hands. */
  get credit(): Credits {
    return this._credit
  }

  set credit(value: Credits) {
    this._credit = value
  }

  /**
   * What it is drawn in, or nothing to wear its own, as the page said it; see
   * {@link ImageLayerOptions.color}.
   */
  get color(): ThemeColor | undefined {
    return this.sheet.color
  }

  set color(value: ThemeColor | undefined) {
    this.sheet.color = value
  }

  /** Drawn at all. */
  get visible(): boolean {
    return this.sheet.visible
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

  /** What the picture lands on, `'ground'` unless said; see {@link ImageLayerOptions.paints}. */
  get paints(): Paints {
    return this.sheet.paints
  }

  set paints(value: Paints) {
    this.sheet.paints = value
  }

  /** Whether the viewer's mask cuts it; see {@link ImageLayerOptions.masked}. */
  get masked(): boolean {
    return this.sheet.masked
  }

  set masked(value: boolean) {
    this.sheet.masked = value
  }

  on<K extends keyof ImageLayerEvents>(type: K, listener: (event: ImageLayerEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ImageLayerEvents>(type: K, listener: (event: ImageLayerEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.sheet.attach(viewer)
    this.picture.attach()
    this.heard()
  }

  detach(): void {
    this.viewer = null
    this.letGo()
    this.picture.detach()
    this.sheet.detach()
  }

  /**
   * A sheet answers two of the words: the mask, and the palette turning over,
   * which is when a pair given as {@link color} changes halves; see
   * {@link Change}.
   */
  changed(what: Change): void {
    this.sheet.changed(what)
  }

  /** Whether it was busy the last frame, to tell the turn to idle once; see {@link sayIfLoaded}. */
  private wasBusy = false

  /** Tells `loaded` on the turn from busy to idle. */
  /**
   * Notes that a fetch has just begun, so that the turn to idle is told even
   * where the picture lands before any frame has seen it on its way. A picture
   * the browser already holds can come back inside the frame it was asked for
   * in; read only once a frame, the layer was never seen busy, and `loaded`
   * never came (measured: a second layer asking for a picture the first had
   * fetched).
   */
  private heard(): void {
    if (this.busy()) this.wasBusy = true
  }

  private sayIfLoaded(): void {
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy && this.events.has('loaded')) this.events.emit('loaded', { tiles: this.picture.showing ? 1 : 0 })
  }

  /**
   * Once a frame: the sheet laid on the land again, the picture brought in,
   * and a picture that failed asked for again when its wait is up.
   *
   * Laid every frame rather than when the view moves, because a height tile
   * landing changes where the land is without the view having moved at all.
   */
  frame(): void {
    this.sayIfLoaded()
    const viewer = this.viewer
    if (!viewer || !this.sheet.visible) return
    this.picture.frame()
    const laid = this.sheet.lay(viewer)
    this.inView = laid !== null && overlaps(laid, this.where)
    if (!laid) return
    // Nothing to draw until the picture is here, and nothing to draw where
    // the view has left the ground it covers — the sheet would be a screen of
    // fragments thrown away one at a time.
    //
    // **Narrowed, not replaced.** `lay` has already said no for `'buildings'`
    // and so did not cut the sheet to the view; turning it back on here put
    // the last cut it had been given back on the land, standing still while
    // the view and the heights moved on — and, with `paints` changeable at
    // any time, a page that went from `'ground'` to `'buildings'` got exactly
    // that.
    this.sheet.drawn = this.sheet.drawn && this.picture.showing && overlaps(laid, this.where)
    this.fill()
  }

  /**
   * What the published picture says at a place: one texel, as published.
   *
   * **Not what is on the screen** — that colour has been through the light,
   * the tone curve, the mask and whatever was drawn over it. This is the
   * file's own byte, which is what a page measuring against a legend needs.
   *
   * Null outside the rectangle and null until the picture has landed. Alpha
   * nought is the picture's own answer for a place it leaves clear and is not
   * the same as no answer at all; see {@link Texel}.
   *
   * **As published only up to 8192 pixels a side.** A picture longer than
   * that on either side is drawn down to fit a card before anything reads it
   * (keeping its shape), and this reads the drawn-down copy: a pixel the
   * browser has blended out of several of the file's, so near the edge of a
   * band of colour it may be a colour the legend does not have. Read off the
   * code, not measured.
   */
  colorAt(at: readonly [number, number]): Texel | null {
    const spot = this.sheet.spotOf(at)
    return spot ? this.picture.colorAt(spot) : null
  }

  /**
   * Whether the picture is on its way; see {@link Layer.busy}. Without it the
   * viewer's `loaded` came before the picture did, and a page that counted
   * on it read nothing but nulls from {@link colorAt}.
   */
  busy(): boolean {
    return this.picture.busy
  }

  /**
   * Named only while some of the picture is on screen; see contract 6.
   *
   * `visible` is asked as well as `drawn`, because a layer the page has
   * turned off never reaches {@link frame} and so leaves `drawn` standing at
   * whatever it last was — and a line crediting a picture that is not being
   * drawn is the one thing this line must not do.
   */
  credits(): readonly Credit[] {
    if (!this.sheet.visible || !this.picture.showing) return []
    // Thrown over the walls only counts where the walls it is thrown on are in
    // view: being on the projector is not the same as being on screen, and a
    // plan of one block went on naming its maker ten kilometres away
    return this.sheet.drawn || (this.sheet.casting && this.inView) ? creditsOf(this._credit) : []
  }

  dispose(): void {
    this.picture.dispose()
    this.sheet.dispose()
  }

  /**
   * Writes where the rectangle falls in the world on the sheet, and hands the
   * same rectangle back for {@link where}.
   *
   * Handed back rather than written in two places: the sheet reads the corner
   * and the reach, and the frame asks whether the view touches the rectangle
   * at all. One of the two going stale would be a picture drawn in the wrong
   * place, or a credit that would not go away.
   */
  private seat(): WorldBounds {
    const west = lonToX(this._bounds.southWest[0])
    const east = lonToX(this._bounds.northEast[0])
    const south = latToY(this._bounds.southWest[1])
    const north = latToY(this._bounds.northEast[1])
    this.sheet.place(west, north, east - west, north - south)
    return { minX: west, minY: south, maxX: east, maxY: north }
  }

  /** The picture is on the canvas: the walls may wear it, a page reading it is told, and it is brought in. */
  private landed(): void {
    // And the walls may wear it now; see `PictureSheet.holding`
    this.sheet.holding = true
    this.events.emit('changed', { tiles: 1 })
    // Brought in at the page's own pace, which is the one the buildings rise
    // at: a page that asked for nothing to rise gets nothing brought in
    // either. One picture is one arrival, so there is nothing to stagger.
    this.filling = appearTakes() > 0
    this.from = performance.now()
    this.up.value = this.filling ? 0 : 1
  }

  /** Brings the picture along, and stops once it is all the way in. */
  private fill(): void {
    if (!this.filling) return
    const takes = appearTakes() * 1000
    const gone = takes > 0 ? (performance.now() - this.from) / takes : 1
    const up = Math.min(1, Math.max(0, gone))
    this.up.value = up
    this.filling = up < 1
  }

  /**
   * What the sheet holds of a picture that is being let go of: nothing on the
   * walls, nothing coming in, nothing drawn. `colorAt` has nothing to say from
   * here, and a page counting what it said is told so by the picture
   * ({@link OnePicture}'s `gone`), as it was told when the picture came.
   */
  private letGo(): void {
    this.sheet.holding = false
    this.filling = false
    this.sheet.drawn = false
  }

  /** Told to whoever is listening, or said once on the console; see contract 7. */
  private told(failure: LoadFailure): void {
    if (this.events.has('error')) {
      this.events.emit('error', failure)
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[plateau-ui] the picture at ${failure.key} could not be fetched`, failure.cause)
  }
}

/** A rectangle copied, so that a page's own array is nobody's to write on. */
function where(bounds: MapBounds): MapBounds {
  return {
    southWest: [bounds.southWest[0], bounds.southWest[1]],
    northEast: [bounds.northEast[0], bounds.northEast[1]],
  }
}

/** Whether two rectangles have any ground in common. */
function overlaps(one: WorldBounds, other: WorldBounds): boolean {
  return one.minX <= other.maxX && one.maxX >= other.minX && one.minY <= other.maxY && one.maxY >= other.minY
}
