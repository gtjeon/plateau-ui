import type { Object3D } from 'three/webgpu'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type LoadFailure } from './events.js'
import { latToY, lonToX, type MapBounds, type WorldBounds } from './geo/mercator.js'
import { ExtrusionBody, type LegendEntry } from './imageExtrusion.js'
import { maskIn } from './mask.js'
import { OnePicture } from './onePicture.js'
import type { Texel } from './pictureSheet.js'
import { ASK_PLAINLY } from './requests.js'
import type { ThemeColor } from './theme.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'

/**
 * One picture somebody published, stood up off the map by its legend over the
 * rectangle it covers: each colour on it is a height, and the ground it covers
 * is raised that high, a pixel of the picture a column.
 *
 * The other half of {@link ImageExtrusionTileLayer}, as {@link ImageLayer} is
 * of `ImageTileLayer`: what a set of tiles delivers in pieces, this delivers
 * in one — a ward's hazard map published as a PNG, a picture of contour bands
 * out of a report. Everything past where the picture comes from is the same
 * words for both (`imageExtrusion.ts`), and where it lies is said the way
 * `ImageLayer` says it: two corners, north up and square to the meridians;
 * see {@link MapBounds}.
 *
 * **Not pointed at yet.** Nothing here answers a click, and the pointer goes
 * through it to the buildings standing in it.
 */
export interface ImageExtrusionLayerOptions {
  /** Where the picture is. */
  readonly url: string
  /** What ground it covers, as the two corners of a rectangle; see `ImageLayerOptions.bounds`. */
  readonly bounds: MapBounds
  /** Whose picture it is, said as their terms ask; see `ImageLayerOptions.credit`. */
  readonly credit: Credits
  /** What each colour of the picture stands for; see `ImageExtrusionTileLayerOptions.legend`. */
  readonly legend: readonly LegendEntry[]
  /** Whether a height is counted from the land or from the sea; see `ImageExtrusionTileLayerOptions.grounded`. */
  readonly grounded?: boolean
  /** How much of it goes on, 0 to 1; see `ImageExtrusionTileLayerOptions.opacity`. */
  readonly opacity?: number
  /** What it is drawn in, where not the picture's own colours; see `ImageExtrusionTileLayerOptions.color`. */
  readonly color?: ThemeColor
  /** Whether it throws the sun's shadow. `true` by default; see `ImageExtrusionTileLayerOptions.castShadow`. */
  readonly castShadow?: boolean
  /** Drawn at all. */
  readonly visible?: boolean
  /** Whether the viewer's mask cuts it. On by default. */
  readonly masked?: boolean
}

export interface ImageExtrusionLayerEvents {
  /** The picture could not be fetched, or could not be read. */
  error: LoadFailure
  /** Everything it was waiting for has arrived, or failed for good; see `ImageLayerEvents.loaded`. */
  loaded: { readonly tiles: number }
  /** The picture in hand changed: it landed, or it was let go of; see `ImageLayerEvents.changed`. */
  changed: { readonly tiles: number }
}

export class ImageExtrusionLayer implements Layer {
  readonly stage: Stage = 'structure'
  private viewer: Viewer | null = null
  private readonly events = new Events<ImageExtrusionLayerEvents>()
  private _bounds: MapBounds
  private _credit: Credits
  private readonly picture: OnePicture
  private readonly body: ExtrusionBody
  /** The rectangle in world units, worked out from {@link bounds} as it is set. */
  private where: WorldBounds

  constructor(options: ImageExtrusionLayerOptions) {
    this._bounds = copied(options.bounds)
    this._credit = options.credit
    this.picture = new OnePicture({
      url: options.url,
      ask: () => this.viewer?.request ?? ASK_PLAINLY,
      told: (failure) => this.told(failure),
      landed: () => {
        this.stamp()
        this.events.emit('changed', { tiles: 1 })
      },
      gone: () => {
        this.body.stampSquare(0, 0, null)
        this.stir()
        this.events.emit('changed', { tiles: 0 })
      },
    })
    this.body = new ExtrusionBody({
      picture: this.picture.texture,
      // One picture, read as one square
      squares: 1,
      legend: options.legend,
      grounded: options.grounded,
      opacity: options.opacity,
      color: options.color,
      castShadow: options.castShadow,
      masked: options.masked,
      visible: options.visible,
    })
    this.where = this.seat()
  }

  /** What is drawn, which the viewer seats. */
  get root(): Object3D {
    return this.body.root
  }

  /** Where the picture is. Handing it another address swaps one picture for another; see `ImageLayer.url`. */
  get url(): string {
    return this.picture.url
  }

  set url(value: string) {
    this.picture.url = value
    this.heard()
  }

  /** What ground it covers; see {@link ImageExtrusionLayerOptions.bounds}. */
  get bounds(): MapBounds {
    return copied(this._bounds)
  }

  set bounds(value: MapBounds) {
    this._bounds = copied(value)
    this.where = this.seat()
    // Placed afresh, the bands are forgotten; the picture in hand is read again
    this.stamp()
  }

  get credit(): Credits {
    return this._credit
  }

  set credit(value: Credits) {
    this._credit = value
  }

  /**
   * What each colour stands for; see {@link ImageExtrusionLayerOptions.legend}.
   * Written again, the picture in hand is read again — nothing is fetched.
   */
  get legend(): readonly LegendEntry[] {
    return this.body.legend
  }

  set legend(value: readonly LegendEntry[]) {
    this.body.legend = value
    this.stamp()
  }

  get grounded(): boolean {
    return this.body.grounded
  }

  set grounded(value: boolean) {
    this.body.grounded = value
    this.stir()
  }

  get opacity(): number {
    return this.body.opacity
  }

  set opacity(value: number) {
    this.body.opacity = value
  }

  get color(): ThemeColor | undefined {
    return this.body.color
  }

  set color(value: ThemeColor | undefined) {
    this.body.color = value
  }

  get castShadow(): boolean {
    return this.body.castShadow
  }

  set castShadow(value: boolean) {
    this.body.castShadow = value
    this.stir()
  }

  get visible(): boolean {
    return this.body.visible
  }

  set visible(value: boolean) {
    this.body.visible = value
    this.stir()
  }

  get masked(): boolean {
    return this.body.masked
  }

  set masked(value: boolean) {
    this.body.masked = value
  }

  on<K extends keyof ImageExtrusionLayerEvents>(
    type: K,
    listener: (event: ImageExtrusionLayerEvents[K]) => void,
  ): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ImageExtrusionLayerEvents>(
    type: K,
    listener: (event: ImageExtrusionLayerEvents[K]) => void,
  ): void {
    this.events.off(type, listener)
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.body.attach(viewer)
    this.picture.attach()
    this.heard()
  }

  detach(): void {
    this.viewer = null
    this.picture.detach()
    this.body.detach()
  }

  /** The mask, and the palette turning over for a pair given as {@link color}; see {@link Change}. */
  changed(what: Change): void {
    if (what === 'mask' || what === 'colors') this.body.changed(what)
  }

  /** Whether it was busy the last frame, to tell the turn to idle once. */
  private wasBusy = false

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
   * Once a frame: a picture that failed asked for again when its wait is up,
   * and drawn only where it has landed and the view — cut to the mask where
   * the mask reaches this — touches the ground it covers.
   */
  frame(): void {
    this.sayIfLoaded()
    const viewer = this.viewer
    if (!viewer || !this.body.visible) return
    this.picture.frame()
    const laid = maskIn(this.body.masked ? viewer.maskArea : null, viewer.visibleBounds)
    this.body.drawn = this.picture.showing && laid !== null && overlaps(laid, this.where)
    this.body.keep(viewer)
  }

  /** What the published picture says at a place, as published; see `ImageLayer.colorAt`. */
  colorAt(at: readonly [number, number]): Texel | null {
    const spot = this.body.spotOf(at)
    return spot ? this.picture.colorAt(spot) : null
  }

  busy(): boolean {
    return this.picture.busy
  }

  /** How high it stands, for the sun's view: the legend's tallest band. */
  tallest(): number {
    return this.body.visible && this.body.drawn ? this.body.tallest : 0
  }

  /** Named only while some of it is on screen; see contract 6. */
  credits(): readonly Credit[] {
    if (!this.picture.showing || !this.body.visible || !this.body.drawn) return []
    return creditsOf(this._credit)
  }

  dispose(): void {
    this.picture.dispose()
    this.body.dispose()
  }

  /** Says where the rectangle falls on the body, and hands it back in world units for {@link where}. */
  private seat(): WorldBounds {
    const west = lonToX(this._bounds.southWest[0])
    const east = lonToX(this._bounds.northEast[0])
    const south = latToY(this._bounds.southWest[1])
    const north = latToY(this._bounds.northEast[1])
    this.body.place(west, north, east - west, north - south)
    return { minX: west, minY: south, maxX: east, maxY: north }
  }

  /** Reads the picture in hand into the body's bands, whole. */
  private stamp(): void {
    const texels = this.picture.texels()
    if (!texels) return
    this.body.stampSquare(0, 0, texels)
    this.stir()
  }

  /** The sun's map holds this as it was last drawn; see `Viewer.stirShadows`. */
  private stir(): void {
    this.viewer?.stirShadows()
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
function copied(bounds: MapBounds): MapBounds {
  return {
    southWest: [bounds.southWest[0], bounds.southWest[1]],
    northEast: [bounds.northEast[0], bounds.northEast[1]],
  }
}

/** Whether two rectangles have any ground in common. */
function overlaps(one: WorldBounds, other: WorldBounds): boolean {
  return one.minX <= other.maxX && one.maxX >= other.minX && one.minY <= other.maxY && one.maxY >= other.minY
}
