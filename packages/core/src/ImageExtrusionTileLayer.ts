import type { Object3D } from 'three/webgpu'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type LoadFailure } from './events.js'
import { ExtrusionBody, type LegendEntry } from './imageExtrusion.js'
import { maskIn } from './mask.js'
import type { Texel } from './pictureSheet.js'
import { ASK_PLAINLY } from './requests.js'
import type { ThemeColor } from './theme.js'
import { TileWindow, WINDOW } from './tileWindow.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'

/**
 * A picture somebody publishes as tiles, stood up off the map by its legend:
 * each colour on it is a height, and the ground it covers is raised that high.
 *
 * A hazard map's depth bands stand as water over the town, each band at the
 * depth the page gives it; a picture of contour bands stands as the hill it
 * was drawn from. The picture is the same thing `ImageTileLayer` lays on the
 * land — fetched and stitched the same way (`tileWindow.ts`) — read here as a
 * table of heights and drawn as a solid, lit like everything else that
 * stands, and wearing the picture's own colours.
 *
 * **A layer of its own, not a word on `ImageTileLayer`.** That one is a
 * picture on the map, whatever the picture is; this is a thing standing on
 * it, and what a page says to it — which colour is how high, from where it
 * is counted, stepped or smooth — is nothing a picture laid on the land could
 * take. One word turning a sheet into a solid would be a word choosing how to
 * draw (contract 8). Named for what comes in, what it does, and how it comes:
 * the picture, stood up the way Mapbox's `fill-extrusion` and deck.gl's
 * `extruded` stand a shape up, in tiles.
 *
 * **Not pointed at yet.** Nothing here answers a click, and the pointer goes
 * through it to the buildings standing in it.
 */
export interface ImageExtrusionTileLayerOptions {
  /** Where the tiles are, with `{z}`, `{x}` and `{y}` in it; see `ImageTileLayerOptions.url`. */
  readonly url: string
  /** Whose tiles they are, said as their terms ask; see `ImageTileLayerOptions.credit`. */
  readonly credit: Credits
  /** The zooms the set holds, 0 to 22 by default; see `ImageTileLayerOptions.minZoom`. */
  readonly minZoom?: number
  readonly maxZoom?: number
  /** How many pixels a tile of the set is each way; see `ImageTileLayerOptions.tileSize`. */
  readonly tileSize?: number
  /**
   * What each colour of the picture stands for: one entry a band, the colour
   * as the picture holds it and the height in metres; see {@link LegendEntry}.
   *
   * A colour the legend does not have is not raised and not drawn, and
   * neither is ground the picture leaves clear — QGIS's paletted renderer
   * draws the same line. No colour near a band counts as the band.
   */
  readonly legend: readonly LegendEntry[]
  /**
   * Whether a height is counted from the land under it or from the map's own
   * nought, the sea. On the land by default, as for a solid and a model.
   *
   * `true` for a depth — a flood's water stands so deep over the ground it
   * covers, over hill and hollow alike. `false` for a height above the sea —
   * contour bands, a water level — which would otherwise ride up the hills.
   * Only ever a question where the viewer reads the land at all; with the
   * land drawn flat both come to the same.
   *
   * The name `SolidOptions.grounded` already has, meaning the same; Mapbox's
   * `raster-elevation-reference` (`'ground' | 'sea'`) and ArcGIS's
   * `elevationInfo.mode` ask the same question.
   */
  readonly grounded?: boolean
  /**
   * How much of it goes on, 0 to 1. All of it by default.
   *
   * Below one it is see-through in three's own way, as a solid is
   * (`SolidOptions.fillOpacity`): drawn after everything opaque and blended
   * over it, still writing depth.
   */
  readonly opacity?: number
  /**
   * What it is drawn in, where the page would rather it were not the
   * picture's own colours: a water read off a hazard map, drawn in water's
   * colour. Taken as the picture's texels are, as a reflectance. A pair is one
   * for each palette; see `ImageTileLayerOptions.color`.
   */
  readonly color?: ThemeColor
  /**
   * Whether it throws the sun's shadow. `true` by default, as everything
   * standing does. A sheet of water standing over a street says `false`: its
   * shadow would darken the very ground a reader looks at through it.
   */
  readonly castShadow?: boolean
  /** Drawn at all. */
  readonly visible?: boolean
  /** Whether the viewer's mask cuts it. On by default. */
  readonly masked?: boolean
}

export interface ImageExtrusionTileLayerEvents {
  /** A tile could not be fetched or could not be read. */
  error: LoadFailure
  /** Everything it was waiting for has arrived, or failed for good; see `ImageTileLayerEvents.loaded`. */
  loaded: { readonly tiles: number }
  /** The picture in hand changed; see `ImageTileLayerEvents.changed`. */
  changed: { readonly tiles: number }
}

export class ImageExtrusionTileLayer implements Layer {
  readonly stage: Stage = 'structure'
  private viewer: Viewer | null = null
  private readonly events = new Events<ImageExtrusionTileLayerEvents>()
  private _credit: Credits
  private readonly window: TileWindow
  private readonly body: ExtrusionBody

  constructor(options: ImageExtrusionTileLayerOptions) {
    this._credit = options.credit
    this.window = new TileWindow({
      url: options.url,
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      tileSize: options.tileSize,
      owner: 'ImageExtrusionTileLayer',
      ask: () => this.viewer?.request ?? ASK_PLAINLY,
      told: (failure) => this.told(failure),
      placed: (x, y, spanX, spanY) => {
        this.body.place(x, y, spanX, spanY)
        this.stir()
      },
      holding: () => undefined,
      stamped: (across, down) => {
        this.body.stampSquare(across, down, this.window.square(across, down))
        this.stir()
      },
      readsBack: true,
    })
    this.body = new ExtrusionBody({
      picture: this.window.picture,
      squares: WINDOW,
      legend: options.legend,
      grounded: options.grounded,
      opacity: options.opacity,
      color: options.color,
      castShadow: options.castShadow,
      masked: options.masked,
      visible: options.visible,
    })
  }

  /** What is drawn, which the viewer seats. */
  get root(): Object3D {
    return this.body.root
  }

  /** Where the tiles are; see `ImageTileLayer.url`. */
  get url(): string {
    return this.window.url
  }

  set url(value: string) {
    this.window.url = value
  }

  get credit(): Credits {
    return this._credit
  }

  set credit(value: Credits) {
    this._credit = value
  }

  get tileSize(): number {
    return this.window.tileSize
  }

  set tileSize(value: number) {
    this.window.tileSize = value
  }

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
   * What each colour stands for; see {@link ImageExtrusionTileLayerOptions.legend}.
   * Written again, every square in hand is read again — nothing is fetched.
   */
  get legend(): readonly LegendEntry[] {
    return this.body.legend
  }

  set legend(value: readonly LegendEntry[]) {
    this.body.legend = value
    for (let down = 0; down < WINDOW; down++) {
      for (let across = 0; across < WINDOW; across++) {
        this.body.stampSquare(across, down, this.window.square(across, down))
      }
    }
    this.stir()
  }

  /** Whether a height is counted from the land; see {@link ImageExtrusionTileLayerOptions.grounded}. */
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

  on<K extends keyof ImageExtrusionTileLayerEvents>(
    type: K,
    listener: (event: ImageExtrusionTileLayerEvents[K]) => void,
  ): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ImageExtrusionTileLayerEvents>(
    type: K,
    listener: (event: ImageExtrusionTileLayerEvents[K]) => void,
  ): void {
    this.events.off(type, listener)
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.body.attach(viewer)
  }

  detach(): void {
    this.viewer = null
    this.window.clear()
    this.body.detach()
  }

  /** The mask, and the palette turning over for a pair given as {@link color}; see {@link Change}. */
  changed(what: Change): void {
    if (what === 'mask' || what === 'colors') this.body.changed(what)
  }

  /** Whether it was busy the last frame, to tell the turn to idle once. */
  private wasBusy = false

  private sayIfLoaded(): void {
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy && this.events.has('loaded')) this.events.emit('loaded', { tiles: this.window.count })
  }

  /**
   * Once a frame: the window moved to cover what is in view, and the land
   * under it read again where it has moved.
   */
  frame(): void {
    this.sayIfLoaded()
    const viewer = this.viewer
    if (!viewer || !this.body.visible) return
    // What the window is picked from: what is in view, cut to the mask where
    // the mask reaches this — the same question `PictureSheet.lay` asks
    const laid = maskIn(this.body.masked ? viewer.maskArea : null, viewer.visibleBounds)
    const fits = laid !== null && this.window.frame(laid, viewer.camera.zoom)
    this.body.drawn = fits && this.window.standing !== null
    this.body.keep(viewer)
    if (this.window.takeMoved()) this.events.emit('changed', { tiles: this.window.count })
  }

  /** What the published picture says at a place, as published; see `ImageTileLayer.colorAt`. */
  colorAt(at: readonly [number, number]): Texel | null {
    if (!this.window.standing) return null
    const spot = this.body.spotOf(at)
    return spot ? this.window.texelAt(spot) : null
  }

  busy(): boolean {
    return this.window.busy
  }

  /** How high it stands, for the sun's view: the legend's tallest band. */
  tallest(): number {
    return this.body.visible && this.body.drawn ? this.body.tallest : 0
  }

  credits(): readonly Credit[] {
    if (!this.window.showing || !this.body.visible || !this.body.drawn) return []
    return creditsOf(this._credit)
  }

  dispose(): void {
    this.window.dispose()
    this.body.dispose()
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
    console.warn(`[plateau-ui] extrusion tile ${failure.key} could not be fetched`, failure.cause)
  }
}
