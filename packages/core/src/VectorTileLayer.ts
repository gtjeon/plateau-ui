/**
 * Somebody else's vector tiles, drawn in the page's own colours.
 *
 * A vector tile is not a picture. It holds the shapes themselves — a road as
 * a line, a flood zone as a polygon, a place as a point — with whatever the
 * publisher wrote about each, and nothing at all about how they should look.
 * So this fetches them, hands each feature to the page, and draws what the
 * page says. The same tiles make a pale map or a loud one, and a page may
 * colour a feature by a number in its own properties, which a picture of
 * tiles can never do.
 *
 * **It is `GeoJsonLayer` fed by tiles.** A page writes the same `filter` and
 * the same {@link FeatureStyle} here as there, meaning the same things by
 * every word of them, and what is drawn is the same `Polygon`, `Polyline` and
 * `Circle` — made by the same few lines, which are `GeoJsonLayer`'s
 * (`areaOf` and the two beside it). The two differ in where the features come
 * from and in nothing else: one is handed a file a page already fetched, the
 * other fetches tiles as the view moves and lets them go as it leaves them. A
 * page that has learnt one has learnt the other.
 *
 * **It draws every feature unless the page says otherwise.** `filter` says
 * which, told the feature and the name of the tile layer it came from; `style`
 * says how, and every word it leaves out is the shapes' own. A `url` and a
 * `credit` alone draw the lot, which is what a page that named a tileset and
 * said nothing more has asked to see.
 *
 * _(Until 2026-10-27 nothing was drawn until the page said so: `style`
 * returning `null` left a feature unread, and a feature given no colour for
 * its kind was left alone. That made "draw it in the usual colour" something
 * no page could say, and it meant a file and a tileset took one style two
 * ways.)_
 *
 * **Each tile draws its own square and nothing past it.** A tile carries a
 * margin past its edge and the next tile carries that ground again, so drawn
 * as it comes every area, line and point in the margin is drawn twice: a wash
 * at half strength laid twice is a darker band down every seam, and a point
 * there is two circles. So areas and lines
 * are cut to the square (the same cut the ground makes, `clipLoopToSquare`),
 * and a point is drawn by the one tile whose square it is in. And where the
 * cut has given an area a side along the tile's edge, that side is not
 * stroked: it is where the tile ends and not where the area does, and a loop
 * drawn round it would grid the map with the tiles' own seams. Mapbox leaves
 * the same sides out (`isBoundaryEdge` in its fill bucket). Such an area draws
 * its inside as a {@link Polygon} with its loop off, and the rest of its loop
 * as {@link Polyline}s told every word the area's own loop would have been.
 *
 * _(Until 2026-10-27 the margin was drawn. A page that said nothing of a loop
 * had none, so only the double wash showed; once an area's loop was on by
 * default, every area crossing an edge wore a straight line along it, and an
 * area wider than the tile — a ward — a square round the whole tile. Found by
 * reading the code and a decoded tile, not on screen.)_
 *
 * **A feature answers the pointer.** A click or a hover is told with the
 * feature it landed on and the name of the tile layer it came from — the two
 * things `style` was handed — so a page that coloured a road by a number in
 * its properties can name that road when the reader presses it. A point is
 * told the same way, being a circle among the shapes like the rest.
 *
 * **What a tileset costs is the page's to spend.** A tile carries about 1,400
 * features over a Japanese city, and each one drawn is a shape the viewer
 * draws — a painted one three times, since the count its box leaves must be
 * read and wiped before the next is counted. Nothing here holds that back on
 * the page's behalf; a page that wants fewer says which with `filter`.
 */
import type { Object3D } from 'three/webgpu'
import type { Behind } from './behind.js'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type Hit, type LoadFailure, type Position } from './events.js'
import { tileBounds, tileKey, tilesCovering, type TileId } from './geo/tiles.js'
import { xToLon, yToLat, type WorldBounds } from './geo/mercator.js'
import { boundsRound, maskBoxesIn } from './mask.js'
import { Polyline, ShapeLayer, type Polygon, type Shape, type ShapeLayerOptions } from './ShapeLayer.js'
import { areaOf, circleOf, lineOf, type FeatureStyle } from './GeoJsonLayer.js'
import { readVectorTile, type VectorTile, type VectorTileFeature } from './mvt.js'
import { clipLoopToSquare, signedArea, type Point } from './polygons.js'
import { transient } from './transient.js'
import { TileSet } from './tileSet.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'
import { ASK_PLAINLY, type Ask } from './requests.js'

/** How many tiles are held, drawn or not. */
const MOST_HELD = 48

/** How many go out at once, so a page flying across the map does not ask for a county. */
const AT_ONCE = 6

/**
 * The most tiles a view riding the camera asks for. A wider view steps the
 * zoom down until it fits, as the picture tiles do, rather than leaving its
 * edges empty: 36 at the view's own zoom was a screen six tiles across, and a
 * screen 1920 pixels wide is seven and a half. The land holds the same number.
 */
const MOST_WANTED = 64

/** What a vector tile calls each kind of shape. */
const POINT = 1
const LINE = 2
const POLYGON = 3

/**
 * What a feature is drawn as where the page says nothing: every word the
 * shapes' own. Frozen, since every feature of every tile shares it.
 */
const PLAIN: FeatureStyle = Object.freeze({})

/** Which features are drawn where the page says nothing: all of them. */
const EVERY = (): boolean => true

/** What a page hands over; see {@link VectorTileLayer}. */
export interface VectorTileLayerOptions extends ShapeLayerOptions {
  /** Where the tiles are, with `{z}`, `{x}` and `{y}` in it. */
  readonly url: string
  /**
   * Whose tiles they are, said as their terms ask.
   *
   * Not optional, unlike `GeoJsonLayer`'s: there a page may be drawing its
   * own work, and here it is always somebody else's — the layer went and
   * fetched it. The line under the map is how a page meets those terms.
   */
  readonly credit: Credits
  /**
   * Which features are drawn. Every one by default.
   *
   * Told which of the tile's layers the feature came from, since a tileset
   * keeps its roads and its water apart by name and that name is most of what
   * a page decides by. Asked once a feature as its tile lands — not once a
   * frame — and again for every tile in hand whenever
   * {@link VectorTileLayer.filter} or {@link VectorTileLayer.style} is written.
   *
   * Every one by default even though that is about 1,400 a tile, since a page
   * that said nothing about which has asked for all of them. The cost is the
   * page's; see the class doc.
   */
  readonly filter?: (feature: VectorTileFeature, layer: string) => boolean
  /**
   * How each feature the filter took is drawn. Left out, every one is drawn in
   * the shapes' own defaults.
   *
   * The same {@link FeatureStyle} `GeoJsonLayer` takes, word for word: the
   * line's colour and its width in pixels of the page, an area's or a point's
   * inside, the switches for each part, and `paints` to have it painted onto
   * the picture instead of laid on the land. A `point: false` here leaves the
   * point undrawn and nothing more, since there is nowhere to hand it back to.
   *
   * Never `null`. Whether a feature is drawn is {@link filter}'s question, and
   * asked here as well it was two ways of saying one thing.
   */
  readonly style?: (feature: VectorTileFeature, layer: string) => FeatureStyle
  /** The zooms the set holds. 0 to 14 by default, which is what most vector sets publish. */
  readonly minZoom?: number
  readonly maxZoom?: number
  /** Drawn at all. On by default. */
  readonly visible?: boolean
  /**
   * Whether the viewer's mask cuts what this draws. On by default, as it is
   * for everything the map itself draws — the meaning `masked` has on the
   * picture layers and on a solid (rule 5).
   *
   * Off, the features are drawn over the whole of what the view covers, and
   * the tiles asked for are the view's rather than the mask's. It used to say
   * only which tiles were asked for, while every shape was cut by the mask
   * regardless: a page that turned it off fetched the tiles past the edge and
   * drew none of them.
   */
  readonly masked?: boolean
}

/**
 * One feature out of a tile, as the publisher wrote it: its kind, and its own
 * keys and values. What a click or a hover hands over.
 *
 * It is what `style` was handed, less `loadGeometry` — and either of two
 * reasons would be enough for leaving that off. A feature reads the tile's
 * bytes where they lie (see `mvt.ts`), so keeping one keeps the whole tile: a
 * GSI tile over 中野 is 100 kB at z14, which is 4.70 MB across the 48 this
 * layer holds (measured). This layer holds those bytes itself while a tile is
 * in hand (see {@link Tile}) and lets them go with it; a page that kept a
 * feature out of a click would keep them for as long as it kept that. And
 * what it hands back is the tile's own grid counted from its north-west
 * corner, which a page has no way to make places of — what turns those numbers
 * into degrees is this layer's own and is not published. So what is handed
 * over is what a page can use.
 */
export type TiledFeature = Omit<VectorTileFeature, 'loadGeometry'>

export interface VectorTileEvents {
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
   * What this layer has on the map changed: a tile's shapes landed, a tile's
   * were taken off, or a new `filter` or `style` drew the tiles in hand again.
   *
   * For a page that counts what it found rather than only looking at it. A
   * count taken once is wrong a moment later, and the arriving stops without
   * saying so.
   *
   * `tiles` is how many tiles have something of theirs on the map — one whose
   * features the filter took none of is not among them. Named as every
   * fetching layer names it, and meaning here what `Buildings.changed` and
   * `ImageTileLayer.changed` mean there: a page that has to learn a word
   * apiece learns the wrong one.
   *
   * Told at most once a frame, however many tiles turned over in it.
   */
  changed: { readonly tiles: number }
  /** A feature was clicked, and where on the map. */
  click: {
    readonly feature: TiledFeature
    /** Which of the tile's layers it came from — the name `style` was told. */
    readonly layer: string
    readonly position: Position
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto a feature, or left it.
   *
   * Told on the change, so a page naming the road under the pointer is told
   * once as it crosses onto it rather than on every frame. A feature whose
   * tile is let go of while the pointer is on it — or that a new `filter`
   * leaves out — comes out as a leaving: what went is this layer's doing and
   * nothing else would say so.
   */
  hover: {
    readonly feature: TiledFeature
    readonly layer: string
    readonly position: Position
  } | null
}

/** Which feature a shape was made for, and which tile layer it came from. */
interface Held {
  readonly feature: TiledFeature
  readonly layer: string
}

/**
 * One tile in hand: what it was read as, and what it drew.
 *
 * The tile is kept as it was read, bytes and all, so that a new `filter` or
 * `style` can be put to every feature it carries — the ones the filter in
 * force left out as much as the ones it took. That costs the tile's bytes for
 * as long as the tile is held, which is bounded by {@link MOST_HELD}: 4.70 MB
 * over 中野 at z14 (see {@link TiledFeature}). Read out into corners instead it
 * would cost many times its bytes, and every feature a filter left out would
 * be paid for again in corners nobody draws. Fetching the tile again would
 * cost nothing held, and the map would go blank under the page's own word
 * while it came.
 */
interface Tile {
  readonly read: VectorTile
  readonly bounds: WorldBounds
  /** What it drew, in the order it went into the group; see {@link VectorTileLayer.drawTile}. */
  shapes: Shape[]
  /**
   * Which feature each drawn one was, by its place in its layer and the
   * layer's name. Kept across a restyle, because the hover is told by which
   * feature the pointer is on — and the same road made afresh by a new style
   * would otherwise be a new feature, told as a crossing onto it.
   */
  readonly held: Map<string, Held>
}

export class VectorTileLayer implements Layer {
  /** How this layer fetches: through its viewer's `transformRequest`, or plainly before it has one. */
  private get ask(): Ask {
    return this.viewer?.request ?? ASK_PLAINLY
  }

  /**
   * The shapes, and nothing else: there is nothing of this layer in the scene
   * but what the page asked to be drawn.
   *
   * Handed straight out of the group that holds them, as `GeoJsonLayer` does
   * — which also settles the stage, since paint and shapes belong where that
   * group puts them.
   */
  get root(): Object3D {
    return this.shapes.root
  }

  get stage(): Stage {
    return this.shapes.stage
  }

  private viewer: Viewer | null = null
  private readonly events = new Events<VectorTileEvents>()
  private _url: string
  private _credit: Credits
  private _minZoom: number
  private _maxZoom: number
  private _filter: (feature: VectorTileFeature, layer: string) => boolean
  private _style: (feature: VectorTileFeature, layer: string) => FeatureStyle
  private _masked: boolean

  private readonly shapes: ShapeLayer
  /** Every tile in hand, drawn or not, by that tile's key; see {@link letGo}. */
  private readonly inHand = new Map<string, Tile>()
  private readonly tiles: TileSet<TileId>
  /** Whether the tiles have to be chosen afresh: the view or the mask moved. */
  private dirty = true
  /** Which feature each shape was made for; see {@link featureAt}. */
  private readonly forShape = new Map<Shape, Held>()
  /** The feature the pointer is on, so that leaving one is told once. */
  private hovering: Held | null = null
  /** Whether what is on the map changed this frame, told once at the end of it. */
  private stirred = false

  constructor(options: VectorTileLayerOptions) {
    this._url = options.url
    this._credit = options.credit
    this._minZoom = options.minZoom ?? 0
    this._maxZoom = options.maxZoom ?? 14
    this._filter = options.filter ?? EVERY
    this._style = options.style ?? (() => PLAIN)
    this._masked = options.masked ?? true
    this.shapes = new ShapeLayer(options)
    this.shapes.masked = this._masked
    this.shapes.root.visible = options.visible ?? true

    this.tiles = new TileSet<TileId>({
      keyOf: tileKey,
      retain: MOST_HELD,
      atOnce: AT_ONCE,
      load: (tile, signal) => this.load(tile, signal),
      onDrop: (key) => this.letGo(key),
      onError: (cause, key, retrying) => this.failed({ what: 'tile', key, retrying, cause }),
    })
  }

  /** Starts listening, and hands back the stop. */
  on<K extends keyof VectorTileEvents>(type: K, listener: (event: VectorTileEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  /** Stops listening, as every other layer's `off` does. */
  off<K extends keyof VectorTileEvents>(type: K, listener: (event: VectorTileEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  // ── Layer ────────────────────────────────────────────────

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.shapes.attach(viewer)
    this.dirty = true
  }

  detach(): void {
    this.putDown()
    this.shapes.detach()
    this.viewer = null
  }

  dispose(): void {
    this.putDown()
    this.shapes.dispose()
  }

  /**
   * Lets go of every tile, with the group emptied first.
   *
   * Emptied first because letting the tiles go one by one would take their
   * shapes off one tile at a time ({@link letGo}), and each tile taken off
   * seats everything left in the group again — the whole map poured once a
   * tile, for a group about to be thrown away in one go anyway. Emptied, the
   * set's telling of each tile finds nothing in hand and returns.
   *
   * The pointer put down before anything goes, so that the tiles going does
   * not come out as the pointer leaving a feature: what left is the map, and
   * a page taking its own layer off is not waiting to hear that the pointer is
   * no longer on it.
   */
  private putDown(): void {
    this.hovering = null
    // What a page counting is told on the next frame, as when a tile goes
    if (this.shapes.items.length > 0) this.stirred = true
    this.shapes.clear()
    this.forShape.clear()
    this.inHand.clear()
    this.tiles.clear()
  }

  /** Whether it was busy the last frame, to tell the turn to idle once; see {@link sayIfLoaded}. */
  private wasBusy = false

  /** Tells `loaded` on the turn from busy to idle. */
  private sayIfLoaded(): void {
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy && this.events.has('loaded')) this.events.emit('loaded', { tiles: this.drawnTiles() })
  }

  /**
   * Passed on to the shapes, and the view and the mask besides: those two move
   * which tiles are wanted. The palette turning over at dusk is the shapes'
   * alone — a colour a style said twice is on the corners they cut.
   */
  changed(what: Change): void {
    this.shapes.changed(what)
    if (what === 'view' || what === 'mask') this.dirty = true
  }

  frame(): void {
    this.sayIfLoaded()
    this.shapes.frame()
    // Said once for however many tiles turned over, and before the choosing
    // below so that what a page is told is what is on the map now
    if (this.stirred) {
      this.stirred = false
      if (this.events.has('changed')) this.events.emit('changed', { tiles: this.drawnTiles() })
    }
    const viewer = this.viewer
    if (!viewer || !this.shapes.root.visible || !this.dirty) return
    this.dirty = false
    // Chosen as the city chooses (contract 4): a box for each piece of the
    // mask, the whole of one held whole and as much of one riding the camera
    // as the screen and its margin reach. Chosen off the screen alone, a shape
    // standing on the map was never fetched past the edge of the view, so a
    // page counting what it holds counted half of it
    const area = this._masked ? viewer.maskArea : null
    const laid = boundsRound(maskBoxesIn(area, viewer.fetchBounds))
    this.tiles.sync(laid ? this.wanted(laid, viewer.camera.zoom, area !== null && !viewer.screenPicks) : [])
  }

  busy(): boolean {
    return this.tiles.busy
  }

  /**
   * Named only while something of it is on the map; see contract 6.
   *
   * A page that put a tileset on and flew somewhere it does not cover is
   * showing nothing of it, and a line naming a publisher over a map none of
   * whose shapes are theirs is a claim about what the reader is seeing. A tile
   * in hand whose features the filter took none of is the same: held, and
   * nothing of it shown.
   */
  credits(): readonly Credit[] {
    return this.shapes.root.visible && this.shapes.items.length > 0 ? creditsOf(this._credit) : []
  }

  covers(
    hit: Parameters<NonNullable<Layer['covers']>>[0],
    on: Parameters<NonNullable<Layer['covers']>>[1],
  ): number | null {
    return this.shapes.covers(hit, on)
  }

  /**
   * Whether a page is listening, which is what the viewer asks before it looks
   * under the pointer for this layer.
   *
   * Not the shapes' own answer. `ShapeLayer.listens` asks each shape whether
   * anybody is listening to *it*, and nobody can be: the shapes here are made
   * as the tiles land and are never handed out, so a page has nothing to hang
   * a listener on. What a page listens to is this layer.
   */
  listens(type: 'click' | 'hover' | 'pointing' | 'drag'): boolean {
    return (type === 'click' || type === 'hover') && this.events.has(type)
  }

  clicked(hit: Hit): void {
    const held = this.featureAt(hit)
    if (!held) return
    const { position, x, y, original } = hit
    this.events.emit('click', { feature: held.feature, layer: held.layer, position, x, y, original })
  }

  hovered(hit: Hit | null): void {
    this.cameOnto(hit ? this.featureAt(hit) : null, hit?.position ?? null)
  }

  // ── What a page turns ────────────────────────────────────

  get visible(): boolean {
    return this.shapes.root.visible
  }

  set visible(value: boolean) {
    if (this.shapes.root.visible === value) return
    this.shapes.root.visible = value
    // Turned back on it chooses its tiles again: the view has moved since
    if (value) this.dirty = true
  }

  /**
   * Which features are drawn; see {@link VectorTileLayerOptions.filter}.
   *
   * Written, every tile in hand is drawn again by it — the tiles are kept as
   * they were read, so nothing is fetched — and every tile that lands after
   * is drawn by it as well.
   */
  get filter(): (feature: VectorTileFeature, layer: string) => boolean {
    return this._filter
  }

  set filter(value: (feature: VectorTileFeature, layer: string) => boolean) {
    this._filter = value
    this.redrawAll()
  }

  /** How each feature is drawn; see {@link VectorTileLayerOptions.style}. Written, as {@link filter} is. */
  get style(): (feature: VectorTileFeature, layer: string) => FeatureStyle {
    return this._style
  }

  set style(value: (feature: VectorTileFeature, layer: string) => FeatureStyle) {
    this._style = value
    this.redrawAll()
  }

  /**
   * Whether the viewer's mask cuts what this draws; see
   * {@link VectorTileLayerOptions.masked}. Written, the tiles are chosen again
   * on the next frame.
   */
  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (this._masked === value) return
    this._masked = value
    this.shapes.masked = value
    this.dirty = true
  }

  /**
   * What a line or a circle does where something hides it, for the features
   * whose style says nothing of their own; see {@link ShapeLayer.behind}. An
   * area keeps its own answer.
   */
  get behind(): Behind {
    return this.shapes.behind
  }

  set behind(value: Behind) {
    this.shapes.behind = value
  }

  /** How much of what is left to `'dim'` shows through what hides it; see {@link ShapeLayer.dimmed}. */
  get dimmed(): number {
    return this.shapes.dimmed
  }

  set dimmed(value: number) {
    this.shapes.dimmed = value
  }

  /**
   * The tileset's address. Changeable, as a picture layer's is: what is held
   * of the old set is let go of and the new one fetched — the same addresses
   * under another host would otherwise draw the old set at the new one's name.
   * A set that holds other zooms says so with {@link minZoom} and
   * {@link maxZoom} beside it.
   */
  get url(): string {
    return this._url
  }

  set url(value: string) {
    if (this._url === value) return
    this._url = value
    this.putDown()
    this.dirty = true
  }

  /** Whose tiles they are; see {@link VectorTileLayerOptions.credit}. */
  get credit(): Credits {
    return this._credit
  }
  /** Set it with {@link url} where the set changes hands. */
  set credit(value: Credits) {
    this._credit = value
  }

  /** The coarsest zoom the set holds; see {@link VectorTileLayerOptions.minZoom}. Changeable with {@link url}. */
  get minZoom(): number {
    return this._minZoom
  }

  set minZoom(value: number) {
    if (value === this._minZoom) return
    this._minZoom = value
    this.dirty = true
  }

  /** The finest zoom the set holds. A view closer in than this is drawn from it. Changeable with {@link url}. */
  get maxZoom(): number {
    return this._maxZoom
  }

  set maxZoom(value: number) {
    if (value === this._maxZoom) return
    this._maxZoom = value
    this.dirty = true
  }

  // ── Fetching ─────────────────────────────────────────────

  /** Which tiles the view wants, at the finest zoom the set holds for it. */
  private wanted(laid: WorldBounds, viewZoom: number, whole: boolean): readonly TileId[] {
    let z = Math.max(this._minZoom, Math.min(this._maxZoom, Math.floor(viewZoom)))
    // Every one, where the shape is held whole: a list cut short does not say
    // which part of it is missing, which is a wrong answer and not a slow one
    if (whole) return tilesCovering(z, laid, Infinity)
    while (z > this._minZoom && tilesCovering(z, laid, Infinity).length > MOST_WANTED) z--
    return tilesCovering(z, laid, MOST_WANTED)
  }

  /**
   * One tile: fetched, read, kept, and drawn as whatever the page asked for.
   *
   * Nothing goes back to the tile set: a shape is not an `Object3D` it could
   * drop. What is drawn is kept here by the tile's key and taken off by
   * {@link letGo}, which the set calls for every way a tile goes.
   *
   * Kept even where the filter took nothing of it, which is what an empty
   * list to the set says — a filter written later may take something, and
   * a tile the set had been told was not there would never be asked for again.
   * Only a tile with no features at all is "not there": no filter can make it
   * draw anything.
   */
  private async load(tile: TileId, signal: AbortSignal): Promise<Object3D[] | null> {
    const res = await this.ask(this.addressOf(tile), 'tile', { signal })
    if (!res.ok) {
      // A set covers what it covers: outside it, "not there" is the answer and
      // not a failure. Only what `transient` calls temporary is asked again.
      if (transient(res.status)) throw new Error(`HTTP ${res.status}`)
      return null
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Checked here, past the last wait, and not again: everything from here to
    // the end is said without letting go of the thread, so nothing can be
    // dropped between this and the tile being in hand.
    if (signal.aborted) return null

    const read = readVectorTile(bytes)
    if (Object.keys(read.layers).length === 0) return null
    const held: Tile = { read, bounds: tileBounds(tile), shapes: [], held: new Map() }
    // Drawn before it is put in hand, and drawing puts nothing in the group
    // until every feature has been asked: a page's rule that throws halfway
    // through a tile then leaves nothing of it registered, where the set —
    // which takes the throw as the tile failing — would never say to let go.
    this.drawTile(held)
    this.inHand.set(tileKey(tile), held)
    // Something of this layer's landed. Said at the end of the frame rather
    // than here, so that a tile apiece is one telling
    if (held.shapes.length > 0) this.stirred = true
    // Nothing for the set to hold: what this tile drew is held above, and the
    // set's part is only to say when the tile is no longer wanted
    return []
  }

  /**
   * Puts the filter and the style to every feature of one tile, and paints
   * what they ask for into the group.
   *
   * Areas first, then lines, then points, as a file is drawn
   * (`GeoJsonLayer`'s `draw`), and not feature by feature: nothing in the
   * group writes depth, so the order shapes go in is the order they are drawn,
   * and an area painted after a road would wash over it. A tile writes its
   * layers in whatever order its publisher chose, which is no answer to that.
   * The order runs a tile at a time rather than across the whole map, since
   * the tiles keep arriving and each one's shapes go in as it does.
   *
   * And last of all the loops of the areas the tile's edge cut, which are
   * lines of their own here (see the class doc). Last because an area's own
   * loop is drawn after everything else in the group (`ShapeLayer.seat`), over
   * the roads and the points; these come as near to that as a shape that is
   * not an area's own loop can.
   *
   * Everything is read in the tile's own grid and cut to its square there, and
   * only what is kept is turned into degrees: the square is 0 to the extent in
   * the grid, so whether a side lies along its edge is a comparison there, and
   * in degrees it would be a guess.
   */
  private drawTile(tile: Tile): void {
    const areas: [Shape, Held][] = []
    const lines: [Shape, Held][] = []
    const circles: [Shape, Held][] = []
    const edges: [Shape, Held][] = []
    for (const name of Object.keys(tile.read.layers)) {
      const layer = tile.read.layers[name]
      if (!layer) continue
      const extent = layer.extent
      const degrees = (run: readonly Point[]) => inDegrees(run, tile.bounds, extent)
      for (let at = 0; at < layer.length; at++) {
        const feature = layer.feature(at)
        if (!this._filter(feature, name)) continue
        const kind = feature.type
        if (kind !== POINT && kind !== LINE && kind !== POLYGON) continue
        const style = this._style(feature, name)
        const rings = feature.loadGeometry()
        const made: [Shape, [Shape, Held][]][] = []
        if (kind === POINT) {
          for (const ring of rings) {
            for (const point of ring) {
              if (!inSquare(point, extent)) continue
              const circle = circleOf(degrees([point])[0]!, style)
              if (circle) made.push([circle, circles])
            }
          }
        } else if (kind === LINE) {
          for (const ring of rings) {
            for (const run of cutRun(ring, extent)) {
              const line = lineOf(degrees(run), style)
              if (line) made.push([line, lines])
            }
          }
        } else {
          for (const polygon of polygonsOf(rings)) {
            const loops = cutToSquare(polygon, extent)
            if (!loops) continue
            const area = areaOf(loops.map(degrees), style)
            if (!area) continue
            if (area.line && loops.some((loop) => runsAlongTheEdge(loop, extent))) {
              for (const loop of loops) {
                for (const run of strokesOf(loop, extent)) made.push([edgeOf(area, degrees(run)), edges])
              }
              area.line = false
            }
            if (area.fill || area.line) made.push([area, areas])
          }
        }
        if (made.length === 0) continue
        const held = this.heldFor(tile, name, at, feature)
        for (const [shape, into] of made) into.push([shape, held])
      }
    }
    for (const [shape, held] of [...areas, ...lines, ...circles, ...edges]) {
      tile.shapes.push(shape)
      this.forShape.set(shape, held)
      this.shapes.add(shape)
    }
  }

  /**
   * What a page is told of one feature of a tile: made the first time the
   * feature is drawn and kept with the tile, so that drawing it again under a
   * new style names the same feature; see {@link Tile.held}.
   *
   * The feature itself is not kept, only the two things of it a page can use:
   * it reads the tile's bytes where they lie, and the page would be holding
   * the tile through it. See {@link TiledFeature}.
   */
  private heldFor(tile: Tile, layer: string, at: number, feature: VectorTileFeature): Held {
    const key = `${at}:${layer}`
    let held = tile.held.get(key)
    if (!held) {
      held = { feature: { type: feature.type, properties: feature.properties }, layer }
      tile.held.set(key, held)
    }
    return held
  }

  /**
   * Draws every tile in hand again, by the filter and the style written now.
   *
   * The whole group cleared at once and painted afresh, rather than each
   * tile's shapes taken off one at a time: a group seats what is left after
   * every shape it lets go of, and a map's worth of shapes let go of one by one
   * is that map seated once a shape.
   */
  private redrawAll(): void {
    this.shapes.clear()
    this.forShape.clear()
    for (const tile of this.inHand.values()) {
      tile.shapes = []
      this.drawTile(tile)
    }
    this.stirred = true
    // The feature the pointer is on is left alone where it is still drawn: it
    // is the same feature, since what names it outlives the shapes, and the
    // pointer has not moved. A page restyling from its own hover would
    // otherwise put its hover out. Where the filter dropped it, the pointer
    // has left it, and nothing but this layer knows that yet.
    if (this.hovering && !this.stillDrawn(this.hovering)) this.cameOnto(null, null)
  }

  /** Whether any shape in hand was made for a feature. */
  private stillDrawn(held: Held): boolean {
    for (const drawn of this.forShape.values()) if (drawn === held) return true
    return false
  }

  /** How many tiles have something of theirs on the map; see {@link VectorTileEvents.changed}. */
  /**
   * What the tiles in hand have drawn: every feature the filter took, with
   * the tile layer it came from — the same pair `filter` and `style` are
   * handed. As {@link GeoJsonLayer.features} is for a file.
   *
   * Read afresh each time, since tiles come and go; `changed` says when. A
   * feature that crosses a tile edge is in each tile it crosses, and is here
   * once for each. `changed` handed a page a count of tiles and nothing to
   * count in them.
   */
  get features(): readonly { readonly feature: TiledFeature; readonly layer: string }[] {
    const all: { readonly feature: TiledFeature; readonly layer: string }[] = []
    for (const tile of this.inHand.values()) for (const held of tile.held.values()) all.push(held)
    return all
  }

  private drawnTiles(): number {
    let count = 0
    for (const tile of this.inHand.values()) if (tile.shapes.length > 0) count += 1
    return count
  }

  /**
   * Takes one tile's shapes off the map and lets go of the tile; see
   * {@link TileSetOptions.onDrop}.
   *
   * The shapes come off together and not one by one: the group seats what is
   * left after every removal, and a tile's 1,400 or so removals were the whole
   * map poured that many times over, every time a tile was let go of to stay
   * under {@link MOST_HELD}. Read in the code, not timed.
   */
  private letGo(key: string): void {
    const tile = this.inHand.get(key)
    if (!tile) return
    this.inHand.delete(key)
    /** Whether what the pointer was on went with it. */
    let lost = false
    for (const shape of tile.shapes) {
      if (this.forShape.get(shape) === this.hovering) lost = true
      this.forShape.delete(shape)
    }
    this.shapes.removeAll(tile.shapes)
    // Said here because nothing else would. The pointer has not moved, so the
    // viewer has no reason to ask again — and a tile goes without the view
    // moving at all, the set holding only so many.
    if (lost) this.cameOnto(null, null)
    if (tile.shapes.length > 0) this.stirred = true
  }

  // ── Pointing ─────────────────────────────────────────────

  /**
   * Which feature the pointer found: the shape it is on, and then what that
   * shape was made for. A point's circle as much as an area or a line, since
   * all three are shapes in the one group.
   */
  private featureAt(hit: Hit): Held | null {
    const shape = this.shapes.shapeFor(hit)
    return (shape ? this.forShape.get(shape) : undefined) ?? null
  }

  /**
   * Tells the page the pointer came onto a feature or left one, where that has
   * changed.
   *
   * Compared here as well as by the group, because two shapes may be one
   * feature: an area's fill and its loop, or the two strokes of one road. A
   * tile let go of from under the pointer comes through here too.
   */
  private cameOnto(held: Held | null, position: Position | null): void {
    if (held === this.hovering) return
    this.hovering = held
    this.events.emit(
      'hover',
      held && position ? { feature: held.feature, layer: held.layer, position } : null,
    )
  }

  // ── Addressing ───────────────────────────────────────────

  /** Where one tile of the set is, with the place written into the address. */
  private addressOf(tile: TileId): string {
    return this._url
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y))
  }

  /** Told to whoever is listening, or said once on the console; see contract 7. */
  private failed(failure: LoadFailure): void {
    if (this.events.has('error')) {
      this.events.emit('error', failure)
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[plateau-ui] vector tile ${failure.key} could not be read`, failure.cause)
  }
}

/**
 * A tile's ring as degrees, which is what a shape is written in.
 *
 * The grid is the tile's square counted from its north-west corner, so a step
 * across is the tile's width over its extent and a step down runs south.
 */
function inDegrees(
  ring: readonly Point[],
  bounds: WorldBounds,
  extent: number,
): (readonly [number, number])[] {
  const scale = (bounds.maxX - bounds.minX) / extent
  return ring.map(
    (point) => [xToLon(bounds.minX + point.x * scale), yToLat(bounds.maxY - point.y * scale)] as const,
  )
}

/**
 * How near the tile's edge a corner has to be to count as on it, in the
 * tile's own steps.
 *
 * The cut puts the corners it makes on the edge by arithmetic, which can land
 * a hair to either side of it. A millionth of a step is far wider than that
 * hair, and far narrower than anything the survey's whole steps can say.
 */
const ON_THE_EDGE = 1e-6

/**
 * How little a cut loop may enclose and still be kept, in square steps.
 *
 * A loop cut down to where it only touches the square is corners along the
 * edge with nothing between them: no ground to fill, and every side of it a
 * side along the edge, which is not stroked.
 */
const ENCLOSES_NOTHING = 1e-6

/**
 * A tile's polygon feature as the polygons it holds: each outside, with the
 * holes that follow it.
 *
 * MVT lets one feature carry several outsides, each followed by its own
 * holes, and says which is which by the winding and nothing else: in the
 * tile's grid, where y runs down, an outside comes out positive by
 * {@link signedArea}. So it is asked here, and each polygon goes to `areaOf`
 * on its own. Handed over as one, the second outside would be wound as a hole
 * of the first — `Polygon` winds its loops by their order — and a hole lying
 * outside its outside is filled as nothing, while the pointer, counting every
 * loop, still finds it.
 *
 * The rule the ground reads the same tiles by (`PolygonBuilder.add`), down to
 * a loop that winds neither way being taken for a hole. Asked before the cut
 * rather than after: a loop cut to a sliver along the edge has no winding left
 * to ask, and the cut keeps the winding of whatever it does not cut away.
 */
function polygonsOf(rings: readonly Point[][]): Point[][][] {
  const polygons: Point[][][] = []
  let current: Point[][] | null = null
  for (const ring of rings) {
    if (ring.length < 3) continue
    if (signedArea(ring) > 0) polygons.push((current = [ring]))
    // A hole before any outside is cut out of nothing
    else if (current) current.push(ring)
  }
  return polygons
}

/**
 * One polygon cut to the tile's own square, the outside still first; nothing
 * where none of the outside is in the square. See the class doc.
 *
 * A hole cut away entirely is left out and the rest kept. The outside cut away
 * is the polygon gone, holes and all, since a hole lies inside its outside.
 */
function cutToSquare(polygon: readonly Point[][], extent: number): Point[][] | null {
  const kept: Point[][] = []
  for (const loop of polygon) {
    const cut = withoutRepeats(clipLoopToSquare(loop, extent))
    if (cut.length >= 3 && Math.abs(signedArea(cut)) > ENCLOSES_NOTHING) kept.push(cut)
    else if (kept.length === 0) return null
  }
  return kept
}

/**
 * A loop with no corner twice running, the closing one included.
 *
 * A tile closes a loop by writing its first corner again (`mvt.ts`), and the
 * cut writes a corner twice where it sits on a side being cut against. Either
 * is a side of no length, and one at a corner on the edge reads as a side
 * along the edge: the stroke round the loop would break there for nothing.
 */
function withoutRepeats(loop: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const point of loop) {
    const last = out[out.length - 1]
    if (last && last.x === point.x && last.y === point.y) continue
    out.push(point)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && first && last && first.x === last.x && first.y === last.y) out.pop()
  return out
}

/**
 * Whether one side of a cut loop runs along one of the tile's four edges:
 * where the tile ends, and not where the area does.
 */
function alongTheEdge(a: Point, b: Point, extent: number): boolean {
  const on = (value: number, edge: number): boolean => Math.abs(value - edge) <= ON_THE_EDGE
  return (
    (on(a.x, 0) && on(b.x, 0)) ||
    (on(a.x, extent) && on(b.x, extent)) ||
    (on(a.y, 0) && on(b.y, 0)) ||
    (on(a.y, extent) && on(b.y, extent))
  )
}

/** Whether any side of a cut loop runs along the tile's edge; see {@link alongTheEdge}. */
function runsAlongTheEdge(loop: readonly Point[], extent: number): boolean {
  for (let at = 0; at < loop.length; at++) {
    if (alongTheEdge(loop[at]!, loop[(at + 1) % loop.length]!, extent)) return true
  }
  return false
}

/**
 * A cut loop as the lines its edge is drawn with: every stretch of it but the
 * sides along the tile's own edge, each stretch a run of its own. The whole
 * loop, closed, where no side of it is along the edge — a hole in the middle
 * of the tile is stroked all the way round whatever became of its outside.
 *
 * Walked from just past a side along the edge, so that no stretch is broken
 * in two where the loop happened to be written from.
 */
function strokesOf(loop: readonly Point[], extent: number): Point[][] {
  const count = loop.length
  const after = (at: number): Point => loop[(at + 1) % count]!
  let start = -1
  for (let at = 0; at < count && start < 0; at++) if (alongTheEdge(loop[at]!, after(at), extent)) start = at
  if (start < 0) return [[...loop, loop[0]!]]
  const runs: Point[][] = []
  let run: Point[] = []
  // Every side once, the one at `start` last: it is along the edge, so it
  // closes whatever stretch is still open
  for (let step = 1; step <= count; step++) {
    const at = (start + step) % count
    const from = loop[at]!
    const to = after(at)
    if (alongTheEdge(from, to, extent)) {
      if (run.length >= 2) runs.push(run)
      run = []
      continue
    }
    if (run.length === 0) run.push(from)
    run.push(to)
  }
  return runs
}

/**
 * A line of a tile cut to the tile's own square: each stretch of it inside, as
 * a run of its own. A line that goes out over an edge and comes back in is two
 * runs, and what lies between is the next tile's to draw.
 */
function cutRun(line: readonly Point[], extent: number): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  const close = (): void => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  for (let at = 0; at + 1 < line.length; at++) {
    const a = line[at]!
    const b = line[at + 1]!
    const inside = withinSquare(a, b, extent)
    if (!inside) {
      close()
      continue
    }
    const [from, to] = inside
    // Come in over an edge, or the first side kept: a stretch begins here
    if (from > 0 || run.length === 0) {
      close()
      run.push(between(a, b, from))
    }
    run.push(between(a, b, to))
    // Gone out over an edge: the stretch ends here
    if (to < 1) close()
  }
  close()
  return runs
}

/**
 * How much of one side of a line lies in the tile's square, as the shares
 * along it where it comes in and where it goes out (Liang–Barsky); nothing
 * where none of it does.
 */
function withinSquare(a: Point, b: Point, extent: number): readonly [number, number] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let from = 0
  let to = 1
  // Each edge as how fast the side closes on it, and how far inside it starts
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x],
    [dx, extent - a.x],
    [-dy, a.y],
    [dy, extent - a.y],
  ]
  for (const [closing, room] of edges) {
    if (closing === 0) {
      if (room < 0) return null
      continue
    }
    const share = room / closing
    if (closing < 0) {
      if (share > to) return null
      if (share > from) from = share
    } else {
      if (share < from) return null
      if (share < to) to = share
    }
  }
  // Touching the square at a corner of it is a point, not a stretch of line
  if (from === to && (dx !== 0 || dy !== 0)) return null
  return [from, to]
}

/** The point a share of the way along one side; either end exactly, so that a kept corner is the corner the tile wrote. */
function between(a: Point, b: Point, share: number): Point {
  if (share === 0) return a
  if (share === 1) return b
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share }
}

/**
 * Whether a point is in the tile's own square. Half open — the west and north
 * edges in, the east and south out — so that a point on the line two tiles
 * share is drawn by one of them and not by both.
 */
function inSquare(point: Point, extent: number): boolean {
  return point.x >= 0 && point.x < extent && point.y >= 0 && point.y < extent
}

/**
 * A stretch of an area's loop as a line of its own, told every word the area's
 * own loop would be told (`Polygon`'s `loopLines`): its colour, width and
 * opacity, how high, whether it glows, whether the pointer finds it, and how it
 * is stuck.
 *
 * Read off the area rather than the style, so that what the style left out is
 * the area's default and the two cannot come to differ about it — `behind`
 * above all, which an area that said none answers for itself rather than
 * taking the group's, as a line would.
 */
function edgeOf(area: Polygon, points: readonly (readonly [number, number])[]): Polyline {
  // Painted only where the area is painted now, as the area's own loop is
  // (see `Polygon.loopLines`): one lifted off the ground keeps its `paints`
  // for later and is drawn at its place, and an edge handed that `paints`
  // with no `behind` fell to the group's `'dim'` — so of one area's outline,
  // the edges a tile cut showed faint through the towers and the rest hid
  const paints = area.paints
  const sticks =
    paints !== undefined && area.classified ? ({ paints } as const) : ({ behind: area.behind } as const)
  return new Polyline({
    points,
    lineColor: area.lineColor,
    lineWidth: area.lineWidth,
    lineOpacity: area.lineOpacity,
    height: area.height,
    glows: area.glows,
    pickable: area.pickable,
    ...sticks,
  })
}
