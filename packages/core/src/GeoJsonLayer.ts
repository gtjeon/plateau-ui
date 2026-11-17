import type { Object3D } from 'three/webgpu'
import type { Behind } from './behind.js'
import {
  Circle,
  Polygon,
  Polyline,
  ShapeLayer,
  type ShapeBase,
  type ShapeLayerOptions,
  type ShapeOptions,
  type ShapeSticks,
} from './ShapeLayer.js'
import { creditsOf, type Credit, type Credits } from './credits.js'
import { Events, type Hit, type Position } from './events.js'
import type { MapBounds } from './geo/mercator.js'
import type { PaintedKind } from './paints.js'
import type { Shape } from './ShapeLayer.js'
import type { ThemeColor } from './theme.js'
import type { Change, Layer, Stage, Viewer } from './Viewer.js'

/**
 * A GeoJSON file drawn on the land.
 *
 * Not a renderer of its own. GeoJSON is a way of writing shapes down, not a
 * kind of picture, and what it writes down is what a {@link ShapeLayer}
 * already draws — so this holds one and fills it from the file.
 *
 * It draws what the file says and nothing else. Holding the group rather than
 * being one is what buys that: there is no `add` here, no `remove`, no
 * `clear`. A page that wants a shape of its own paints it into a
 * {@link ShapeLayer}, where taking it off again is that page's business — and
 * this layer, holding nothing it did not read, answers a new `data`, `filter`
 * or `style` by throwing the whole lot away and drawing the features again.
 *
 * Which is also why the reading is worth having here rather than in a page.
 * The file says its polygons by their loops and its lines by their corners;
 * turning that into shapes is thirty lines every page that reads one would
 * write the same way, and getting the loop order wrong is a hole drawn as an
 * island.
 *
 * **Points are shapes, like the rest.** A file's point is a {@link Circle} in
 * the same group as its lines and areas — Mapbox's circle layer, deck.gl's
 * `pointType: 'circle'` — so every word a style says of a feature (`glows`,
 * `paints`, `behind`, `pickable`, `height`) is said of its points too, and a
 * click on one is a click on the feature. A point that means more than a dot —
 * a station that wants its name, a place that wants a pin — is a mark rather
 * than a circle, and a mark is the page's to make: a style saying
 * `point: false` leaves it undrawn and hands it back by
 * {@link GeoJsonLayer.points}.
 *
 * _(Until 2026-10-27 a point was a `Marker` handed to the viewer, to stand
 * among the other marks. Half of a style meant nothing to it — a mark has no
 * `glows`, no `paints`, no `pickable` — and what it was clicked with had to be
 * relayed back here by an ear hung on every one.)_
 *
 * Nothing is fetched here. A URL would make this asynchronous, and with that
 * comes everything a layer that fetches has to carry — the viewer's own life
 * to hang the request on, a failure to tell the page about, a policy for
 * asking again. A page that has already called `fetch` carries none of it and
 * has written one more line.
 */

/** A place in a GeoJSON file: longitude, then latitude, then whatever else it says. */
export type GeoJsonPlace = readonly number[]

/**
 * A geometry as GeoJSON writes one.
 *
 * Declared here rather than taken from `@types/geojson` so that what this
 * library publishes stands on nothing but itself. TypeScript compares shapes
 * rather than names, so a page holding the real thing — from that package or
 * from `JSON.parse` — passes it in unchanged.
 *
 * `coordinates` is left unread on purpose: what it holds depends on `type`,
 * and a file in the wild gets that wrong often enough that it is walked
 * defensively rather than trusted by its declaration.
 */
export interface GeoJsonGeometry {
  readonly type:
    | 'Point'
    | 'MultiPoint'
    | 'LineString'
    | 'MultiLineString'
    | 'Polygon'
    | 'MultiPolygon'
    | 'GeometryCollection'
  readonly coordinates?: unknown
  readonly geometries?: readonly GeoJsonGeometry[]
}

/** One feature: a geometry, and whatever the file says about it. */
export interface GeoJsonFeature {
  readonly type: 'Feature'
  readonly geometry: GeoJsonGeometry | null
  readonly properties?: Readonly<Record<string, unknown>> | null
  readonly id?: string | number
}

export interface GeoJsonFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly GeoJsonFeature[]
}

/** Whatever a page has in hand: a whole file, one feature, or one shape. */
export type GeoJsonData =
  GeoJsonFeatureCollection | GeoJsonFeature | GeoJsonGeometry | readonly GeoJsonFeature[]

/**
 * How one feature is drawn: what a `style` hands back, here and on a
 * `VectorTileLayer` alike.
 *
 * Named as the shapes are named, because what a feature is drawn as is those
 * shapes — its areas a {@link Polygon} apiece, its lines a {@link Polyline},
 * its points a {@link Circle} — and one object of colours can go to either.
 * The names are deck.gl's GeoJsonLayer's (`getLineColor`, `getFillColor`,
 * `getPointRadius`) without the `get`. The circle's size is `pointRadius` here
 * and `radius` on a circle made by hand, as deck.gl parts its GeoJsonLayer
 * from its ScatterplotLayer: here it is one word among an area's and a line's,
 * and has to say which of the three it is about.
 *
 * **A word left out is the shapes' own default**, kind by kind: an area filled
 * and ringed, a line drawn, a point a filled and ringed circle, all in
 * {@link DEFAULT_SHAPE_COLOR}. So `{}` draws a feature plainly, and a style
 * never decides whether a feature is drawn at all — which ones are is
 * `filter`'s to say. What the switches turn off is a part: the inside, the
 * line, the point as a circle. That is Leaflet's split between `filter` and
 * `style`, with its `fill` and `stroke` spelled `fill` and `line`.
 *
 * **A word a kind has nothing to say to is passed over for that kind**, and
 * only for it: `fill`, `fillColor` and `fillOpacity` on a line, `point` and
 * `pointRadius` on a line or an area. One style is handed back for a file
 * that mixes all three, so a word one kind cannot take is not a mistake.
 *
 * _(Until 2026-10-27 a part was drawn only where a colour or a width was said
 * for it. "Draw it in the usual colour" could not be said, a file's polygon
 * was drawn unlike one made by hand (`new Polygon({ points })` fills itself),
 * and a style with nothing in it drew nothing. A point was a mark, with
 * `pointColor`, `pointSize` and `pointSymbol`, and those went with it: the
 * circle's colours are an area's, and a pin is a mark a page makes itself.)_
 */
export type FeatureStyle = {
  /**
   * Whether the inside is coloured — an area's, and a point's circle's. On by
   * default, as a {@link Polygon}'s and a {@link Circle}'s are.
   */
  readonly fill?: boolean
  /** What the inside is coloured. {@link DEFAULT_SHAPE_COLOR} where it says nothing — not the line's. */
  readonly fillColor?: ThemeColor
  /** How much of the inside goes on, 0 to 1. Half by default; see {@link DEFAULT_FILL_OPACITY}. */
  readonly fillOpacity?: number
  /**
   * Whether the line is drawn: a line's run, the loops round an area and
   * round each of its holes, the ring round a point. On by default.
   *
   * On a line feature it is the whole of what is drawn, so `false` there
   * draws nothing of it — which is what Leaflet's `stroke: false` does to a
   * polyline.
   */
  readonly line?: boolean
  /** What the line is drawn in. {@link DEFAULT_SHAPE_COLOR} where it says nothing. */
  readonly lineColor?: ThemeColor
  /**
   * How thick the line is, in pixels of the page. {@link DEFAULT_LINE_WIDTH}
   * by default; see {@link PolylineOptions.lineWidth} for why not metres.
   */
  readonly lineWidth?: number
  /**
   * How much of the line goes on, 0 to 1. One by default; see
   * {@link PolylineOptions.lineOpacity}. Mapbox's `line-opacity` for a
   * tileset's roads, and an area's loop and a point's ring alike.
   */
  readonly lineOpacity?: number
  /**
   * Whether a point is drawn as a circle. On by default.
   *
   * `false` leaves it undrawn. A `GeoJsonLayer` hands it back by
   * {@link GeoJsonLayer.points}, for a page that means more by it than a dot
   * — a label, a pin of its own. A `VectorTileLayer` has nowhere to hand it,
   * so there it is only not drawn.
   */
  readonly point?: boolean
  /**
   * How far out a point's circle reaches, in pixels of the page.
   * {@link DEFAULT_CIRCLE_RADIUS} by default; see {@link CircleOptions.radius}.
   */
  readonly pointRadius?: number
  /**
   * Whether a line or a point turns to face the eye, as one made by hand
   * does: deck.gl's word, read the way {@link PolylineOptions.billboard} and
   * {@link CircleOptions.billboard} read it, with the default each of those
   * has. An area takes no part in it. Here so that the same options may be
   * handed to a shape made by hand and to a file's style; left out, a style
   * could lay no point on the land without painting it.
   */
  readonly billboard?: boolean
  /**
   * Whether the pointer may find what this feature is drawn as; see
   * {@link ShapeBase.pickable}. It may by default, as everywhere else.
   *
   * Here as well as on a shape because a page reading a file does not hold the
   * shapes — this layer makes them — so this is the only place it could say
   * so. A boundary drawn to be read rather than clicked says `false`, and the
   * land under it answers as it did. A point's circle takes it like the rest.
   */
  readonly pickable?: boolean
  /** How far off the land, in metres. On it by default. */
  readonly height?: number
  /** Whether it carries its own light; see {@link ShapeBase.glows}. */
  readonly glows?: boolean
} & ShapeSticks

/** What a page hands over; see {@link GeoJsonLayer}. */
export interface GeoJsonLayerOptions extends ShapeLayerOptions {
  /**
   * The file, a feature of it, or a bare geometry. Nothing is fetched here.
   * Written again later through {@link GeoJsonLayer.data}.
   */
  readonly data: GeoJsonData
  /**
   * Which features are drawn. Every one by default.
   *
   * What to draw, where {@link style} is how. Asked once a feature, and again
   * for every one whenever {@link GeoJsonLayer.data}, {@link GeoJsonLayer.filter}
   * or {@link GeoJsonLayer.style} is written — not once a frame.
   *
   * _(Until 2026-10-27 there was none: a page holding a parsed file holds an
   * array and `Array.filter`. It is here so that a file and a tileset are
   * asked the same two questions in the same two words — a tileset hands the
   * page no array to filter — and a page that has learnt one has learnt the
   * other.)_
   */
  readonly filter?: (feature: GeoJsonFeature) => boolean
  /**
   * How each feature the filter took is drawn. Left out, every one is drawn in
   * the shapes' own defaults; see {@link FeatureStyle}.
   *
   * Asked as often as {@link filter}, and only of the features it took.
   */
  readonly style?: (feature: GeoJsonFeature) => FeatureStyle
  /**
   * Drawn at all. On by default. Written again later through
   * {@link GeoJsonLayer.visible}.
   *
   * The layer's own word and not a style's: whether a feature is drawn is
   * {@link filter}'s to say, and this is the whole file on or off — the word a
   * `VectorTileLayer` takes, so that a page that has learnt one has learnt the
   * other.
   */
  readonly visible?: boolean
  /**
   * Whose data this is, to be named under the map for as long as it is drawn.
   *
   * The one thing here a page is asked for rather than offered. Every other
   * layer knows where its data came from — the ground and the buildings fetch
   * theirs and name their sources themselves — and this one cannot: a page
   * hands it a parsed file and nothing in a parsed file says who made it. So
   * the page says, and the viewer draws the line the same way it draws the
   * rest, where a reader will see it and where nobody has to remember to put
   * it. Left out for a page's own drawing, which is nobody else's to credit.
   */
  readonly credit?: Credits
}

/**
 * What a file tells the page about.
 *
 * In features, which is what every map library answers a click on a file with:
 * Mapbox hands back `e.features`, deck.gl the feature as `info.object`, Leaflet
 * the layer it made for one. A feature is what the page wrote the file in and
 * what carries the properties it means to read — and it is not a shape: a
 * MultiPolygon is a shape an island, an area carries its loops besides, and a
 * MultiPoint is a circle a point. So the pointer finds one piece of a feature
 * and the page is told the feature.
 *
 * On this layer and not on the shapes, unlike {@link ShapeEvents}. The shapes
 * here are the layer's own and are never handed out (see {@link GeoJsonLayer}),
 * so there is nothing else to listen to.
 */
export interface GeoJsonEvents {
  /** A feature was clicked, and where on the map. */
  click: {
    readonly feature: GeoJsonFeature
    readonly position: Position
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto a feature, or left it.
   *
   * Told on the change, so a page naming the ward under the pointer is told
   * once as it crosses the boundary rather than on every frame.
   */
  hover: {
    readonly feature: GeoJsonFeature
    readonly position: Position
  } | null
}

/**
 * A point the file carried which this layer did not draw, because the style
 * said `point: false` of its feature; see {@link GeoJsonLayer.points}.
 */
export interface GeoJsonPoint {
  readonly at: readonly [number, number]
  readonly feature: GeoJsonFeature
}

/**
 * What a feature is drawn as where the page says nothing: nothing said, so
 * every word is the shapes' own.
 *
 * Something rather than nothing. A page handing over a file and no style means
 * "show me what is in it", and the answer to that is the shapes drawn plainly
 * — filled, ringed and dotted the way one made by hand is — rather than a rule
 * that asked for a colour before it drew anything and answered an unstyled
 * file with a blank map. Frozen, since every feature shares it.
 */
const PLAIN: FeatureStyle = Object.freeze({})

/** What decides which features are drawn where the page says nothing: all of them. */
const EVERY = (): boolean => true

/** What a layer with nothing on the map credits. */
const NOTHING_DRAWN: readonly Credit[] = []

/** A line of a feature, as corners on the map. */
type Run = readonly (readonly [number, number])[]

/** One feature read out: what it holds, in the terms the shapes are made from. */
interface Read {
  readonly feature: GeoJsonFeature
  /** One entry a polygon, each holding its outside loop and then its holes. */
  readonly polygons: readonly (readonly Run[])[]
  /** Its LineStrings. A polygon's loops are the polygon's own and are not here. */
  readonly runs: readonly Run[]
  /** Its Points, each a circle or handed back, as the style says. */
  readonly points: Run
}

export class GeoJsonLayer implements Layer {
  /**
   * The shapes it made, drawn as one.
   *
   * Held rather than inherited. Inherited, `add`, `remove` and `clear` stood on
   * this layer's own surface — three ways for a page to put a shape somewhere a
   * restyle would later throw away — so a restyle had to keep a list of which
   * shapes were its own and take off only those. Held, everything in here came
   * from the file and a restyle clears the lot.
   */
  private readonly shapes: ShapeLayer
  private read: Read[] = []
  private readonly events = new Events<GeoJsonEvents>()
  /** Which feature each shape was made for, so that what the pointer finds has a name. */
  private readonly drawnFor = new Map<Shape, GeoJsonFeature>()
  /** The feature the pointer is on, so that crossing to the next tells of both. */
  private hovering: GeoJsonFeature | null = null
  /** The points the style left undrawn; see {@link points}. */
  private handedBack: GeoJsonPoint[] = []
  private _credit: Credits | undefined
  private named: readonly Credit[]
  private box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity }
  private _data: GeoJsonData
  private _filter: (feature: GeoJsonFeature) => boolean
  private _style: (feature: GeoJsonFeature) => FeatureStyle

  constructor(options: GeoJsonLayerOptions) {
    this.shapes = new ShapeLayer(options)
    this.shapes.root.visible = options.visible ?? true
    this._filter = options.filter ?? EVERY
    this._style = options.style ?? (() => PLAIN)
    this._credit = options.credit
    this.named = creditsOf(options.credit)
    this._data = options.data
    this.take(options.data)
    this.draw()
  }

  /**
   * Everything it drew; see {@link Layer.root}. The group's own, handed
   * straight out — there is nothing of this layer in the scene but the shapes.
   *
   * A getter and not a field: the group is made in the constructor body, and a
   * field reading it would be initialised before that ran.
   */
  get root(): Object3D {
    return this.shapes.root
  }

  /** Where the shapes are drawn, which is the only place they can be: see {@link root}. */
  get stage(): Stage {
    return this.shapes.stage
  }

  // ── What a page turns ────────────────────────────────────

  /**
   * Drawn at all; see {@link GeoJsonLayerOptions.visible}.
   *
   * The group's root, as a `VectorTileLayer`'s is. Nothing is made afresh
   * either way: the shapes stay cut while hidden and come back as they were,
   * and with nothing fetched here there are no tiles to choose again. Hidden,
   * the pointer finds none of it (see {@link ShapeLayer.covers}) and the
   * credit goes from under the map.
   *
   * _(Until 2026-10-27 there was none, and a page turned a file off by taking
   * the layer off the viewer, or by writing `root.visible`, which left the
   * credit standing under a map that no longer showed the file.)_
   */
  get visible(): boolean {
    return this.shapes.root.visible
  }

  set visible(value: boolean) {
    this.shapes.root.visible = value
  }

  /**
   * What it was handed: the file, a feature of it, or a bare geometry.
   *
   * Written, the new data is read in its place — {@link features},
   * {@link bounds} and {@link points} with it — and every shape is made afresh,
   * the way Mapbox's `source.setData` replaces what a source holds. The
   * `filter` and `style` stand and are put to the new features.
   */
  get data(): GeoJsonData {
    return this._data
  }

  set data(value: GeoJsonData) {
    this._data = value
    this.take(value)
    this.redraw()
  }

  /**
   * Which features are drawn; see {@link GeoJsonLayerOptions.filter}.
   * Written, every feature is asked again and the shapes made afresh.
   */
  get filter(): (feature: GeoJsonFeature) => boolean {
    return this._filter
  }

  set filter(value: (feature: GeoJsonFeature) => boolean) {
    this._filter = value
    this.redraw()
  }

  /**
   * How each feature is drawn; see {@link GeoJsonLayerOptions.style}.
   *
   * Written, every feature the filter takes is drawn again by the new rule.
   * The file is not read again — the features are still here — but every shape
   * is made afresh, because what a style changes is which shapes there are at
   * all: a feature whose `fill` was off has an inside now and did not before.
   *
   * _(Until 2026-10-27 this was `setStyle(fn)`. A rule is a value a page hands
   * over, and handing over a value is writing a property, as `filter` and
   * `data` are.)_
   */
  get style(): (feature: GeoJsonFeature) => FeatureStyle {
    return this._style
  }

  set style(value: (feature: GeoJsonFeature) => FeatureStyle) {
    this._style = value
    this.redraw()
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

  /** Whose data this is, as the page said it; see {@link GeoJsonLayerOptions.credit}. */
  get credit(): Credits | undefined {
    return this._credit
  }

  /** Set it with {@link data} where the file changes hands. */
  set credit(value: Credits | undefined) {
    this._credit = value
    this.named = creditsOf(value)
  }

  /**
   * Reads the data out into what the shapes are made from, in place of
   * whatever was read before.
   *
   * Every feature, whatever the filter says: the filter can be written again,
   * and a feature it leaves out now may be one it takes next.
   */
  private take(data: GeoJsonData): void {
    this.read = []
    this.box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity }
    for (const feature of featuresOf(data)) {
      const polygons: Run[][] = []
      const runs: Run[] = []
      const points: (readonly [number, number])[] = []
      readInto(feature.geometry, polygons, runs, (at) => {
        points.push(at)
        this.widen(at[0], at[1])
      })
      for (const run of runs) for (const [lon, lat] of run) this.widen(lon, lat)
      for (const loops of polygons) for (const [lon, lat] of loops[0] ?? []) this.widen(lon, lat)
      this.read.push({ feature, polygons, runs, points })
    }
  }

  /** The rectangle round what has been read, widened a corner at a time as it is. */
  private widen(lon: number, lat: number): void {
    if (lon < this.box.minLon) this.box.minLon = lon
    if (lon > this.box.maxLon) this.box.maxLon = lon
    if (lat < this.box.minLat) this.box.minLat = lat
    if (lat > this.box.maxLat) this.box.maxLat = lat
  }

  /**
   * Whose data this is, for the line the viewer draws under the map; see
   * {@link GeoJsonLayerOptions.credit}. Given nothing, it claims nothing.
   */
  credits(): readonly Credit[] {
    // Only while something of it is on the map. A name under a map is a claim
    // about what the reader is looking at, and a file that turned out to hold
    // nothing this layer could draw — or that the filter took nothing of —
    // puts nothing there to be credited. A file of points alone counts: its
    // points are shapes in the group like the rest. A layer turned off puts
    // nothing there either, whatever it holds.
    //
    // And the points handed back (`point: false`) count too, while the layer
    // is on. The page draws those itself, as pins or labels of its own, and
    // they are this file's data on the map all the same; a mark has no line
    // of its own to name them in, so a file of stations drawn as pins went
    // with no name under it at all
    if (!this.shapes.root.visible) return NOTHING_DRAWN
    return this.shapes.items.length > 0 || this.handedBack.length > 0 ? this.named : NOTHING_DRAWN
  }

  /**
   * The features the data held, in the order it gave them.
   *
   * All of them, drawn or not: the filter decides what is drawn, not what was
   * read, and a filter written later may take what this one left out. So a
   * page naming its features by their properties takes the names once, and
   * they outlive every restyle and refilter.
   */
  get features(): readonly GeoJsonFeature[] {
    return this.read.map((held) => held.feature)
  }

  /**
   * The points the style said `point: false` of, in the order the file gave
   * them — of the features the filter took, since a feature it left out is
   * neither drawn nor handed back.
   *
   * Handed back rather than drawn for a page that means something more
   * particular by a point than a dot: these are stations and want labels,
   * these are places and want pins. A label or a pin is a mark, which stands
   * among every other mark on the map and is laid out with them, so the page
   * makes it — a circle is the one thing this layer draws a point as.
   *
   * Changes when `data`, `filter` or `style` is written, and at no other time.
   */
  get points(): readonly GeoJsonPoint[] {
    return this.handedBack
  }

  /**
   * The rectangle round everything the data held, in the shape
   * {@link Viewer.fitBounds} asks for — so a page looks at what it just loaded
   * in one line. Round what was read rather than what is drawn, as
   * {@link features} is.
   *
   * Every corner at infinity where nothing was taken — which is what the
   * rectangle round nothing is. `fitBounds` stays where it is when handed one,
   * so a page need not check first; it is worth knowing all the same, since a
   * view that did not move is how an empty file shows.
   *
   * Measured as the file is read rather than when it is asked for: a file of a
   * thousand plots is walked once either way, and a page fitting the view on
   * every frame of a motion would otherwise walk it on every one of them.
   */
  get bounds(): MapBounds {
    return {
      southWest: [this.box.minLon, this.box.minLat],
      northEast: [this.box.maxLon, this.box.maxLat],
    }
  }

  /**
   * Throws every shape away and draws the features again, by whatever is
   * written now.
   *
   * Everything it holds goes, with nothing to tell apart first. It holds
   * nothing but what the file said — which is what sealing it bought: the list
   * that remembered which shapes were its own is gone, and so is the question
   * of what a restyle owes a shape a page had added.
   */
  private redraw(): void {
    this.shapes.clear()
    this.drawnFor.clear()
    this.draw()
    // The feature the pointer is on is left alone where it is still drawn: the
    // features outlive a restyle — the file is not read again — and the pointer
    // has not moved.
    //
    // It used to be put down unconditionally, on the grounds that a feature
    // drawn by the old rule may not be drawn by the new one. That turned a page
    // that restyles *from* its hover into one that put its own hover out.
    // Measured on `wards`, where every crossing came back as a pair —
    // `hover 13101`, then `hover null` — and the ward lit and went dark again.
    // Where the feature really is gone — the filter dropped it, or the data it
    // came from was replaced — the pointer has left it, and nothing but this
    // layer knows it yet.
    if (this.hovering && !this.stillDrawn(this.hovering)) this.cameOnto(null, null)
  }

  /** Whether any shape in hand was made for a feature. */
  private stillDrawn(feature: GeoJsonFeature): boolean {
    for (const drawn of this.drawnFor.values()) if (drawn === feature) return true
    return false
  }

  /**
   * Turns what the filter took into shapes: every polygon first, then every
   * line, then every point.
   *
   * In that order and not feature by feature. Nothing a group draws writes
   * depth, so within it the order shapes were added is the order they are
   * drawn — and feature by feature, the second plot's colour would be washed
   * over the first plot's run of road wherever the two meet, and over the dot
   * standing in it. Every map library keeps fills under lines and points over
   * both for the same reason; here it falls out of the order rather than out of
   * a second layer.
   *
   * A polygon's own loops are not in that order and need not be: it carries
   * them, and a group draws every loop after every fill it holds.
   */
  private draw(): void {
    this.handedBack = []
    const drawn: (Read & { readonly style: FeatureStyle })[] = []
    for (const held of this.read) {
      if (this._filter(held.feature)) drawn.push({ ...held, style: this._style(held.feature) })
    }
    for (const { feature, polygons, style } of drawn) {
      for (const loops of polygons) this.standsFor(feature, areaOf(loops, style))
    }
    for (const { feature, runs, style } of drawn) {
      // These are the file's own LineStrings and nothing else — a polygon's
      // loops went with the polygon.
      for (const run of runs) this.standsFor(feature, lineOf(run, style))
    }
    for (const { feature, points, style } of drawn) {
      for (const at of points) {
        if (style.point === false) this.handedBack.push({ at, feature })
        else this.standsFor(feature, circleOf(at, style))
      }
    }
  }

  /** Paints a shape made for a feature, and remembers which feature it was. */
  private standsFor(feature: GeoJsonFeature, shape: Shape | null): void {
    if (!shape) return
    this.drawnFor.set(shape, feature)
    this.shapes.add(shape)
  }

  // ── Under the pointer ─────────────────────────────────────

  /**
   * Listens for a feature being clicked or pointed at. Hands back the way to
   * stop; see {@link GeoJsonEvents}.
   */
  on<K extends keyof GeoJsonEvents>(type: K, listener: (event: GeoJsonEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof GeoJsonEvents>(type: K, listener: (event: GeoJsonEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /**
   * Whether a page is listening, which is what the viewer asks before it looks
   * under the pointer for this layer.
   *
   * Not the shapes' own answer. `ShapeLayer.listens` asks each shape whether
   * anybody is listening to *it*, and nobody can be: the shapes here are made
   * from the file and never handed out. What a page listens to is this layer.
   */
  listens(type: 'click' | 'hover' | 'pointing' | 'drag'): boolean {
    return (type === 'click' || type === 'hover') && this.events.has(type)
  }

  /**
   * Which feature's paint covers what the pointer found; see
   * {@link Layer.covers}. The shapes' own answer, since the shapes are what
   * was painted.
   */
  covers(hit: Hit, on: PaintedKind): number | null {
    return this.shapes.covers(hit, on)
  }

  clicked(hit: Hit): void {
    const feature = this.featureAt(hit)
    if (!feature) return
    const { position, x, y, original } = hit
    this.events.emit('click', { feature, position, x, y, original })
  }

  hovered(hit: Hit | null): void {
    this.cameOnto(hit ? this.featureAt(hit) : null, hit?.position ?? null)
  }

  /**
   * Tells the page the pointer came onto a feature or left one, where that has
   * changed.
   *
   * Compared here as well as by the group, because two shapes may be one
   * feature: crossing from one island of a ward to the next, or from a ward's
   * fill onto its own loop, is a crossing down there and none up here.
   */
  private cameOnto(feature: GeoJsonFeature | null, position: Position | null): void {
    if (feature === this.hovering) return
    this.hovering = feature
    this.events.emit('hover', feature && position ? { feature, position } : null)
  }

  /**
   * Which feature the pointer found: the shape it is on, and then what that
   * shape was made for. A point's circle as much as an area or a line, since
   * all three are shapes in the one group.
   */
  private featureAt(hit: Hit): GeoJsonFeature | null {
    const shape = this.shapes.shapeFor(hit)
    return (shape ? this.drawnFor.get(shape) : undefined) ?? null
  }

  attach(viewer: Viewer): void {
    this.shapes.attach(viewer)
  }

  detach(): void {
    // Nothing of it is on the screen, so nothing of it is under the pointer.
    // Not told as a leaving: what left is the map, and a page taking its own
    // layer off is not waiting to hear that the pointer is no longer on it.
    this.hovering = null
    this.shapes.detach()
  }

  /**
   * The rest of what a viewer tells a layer, passed on to the shapes.
   *
   * Written out rather than inherited, which is what sealing costs: inheriting
   * brought these for nothing and brought `add`, `remove` and `clear` along
   * with them. The answer is the shapes' own every time, since everything this
   * layer draws is theirs — so this hands the word on whatever it is and
   * cannot fall behind a word the viewer learns to say, which three methods in
   * a row could and did. The palette turning over at dusk is one such word:
   * a colour a style said twice is the shapes' to cut again.
   */
  changed(what: Change): void {
    this.shapes.changed(what)
  }

  frame(): void {
    this.shapes.frame()
  }

  /** The shapes go, and with them everything this layer remembered about them. */
  dispose(): void {
    this.drawnFor.clear()
    this.hovering = null
    this.handedBack = []
    this.shapes.dispose()
  }
}

/**
 * What every shape of a feature takes alike.
 *
 * The two ways a shape can be stuck to the scene are kept apart here as they
 * are in the type: a painted feature says what its colour lands on, and one
 * standing at its place says what happens in front of it. One answer for the
 * fill, the line and the point together — they are parts of one feature, and a
 * page that held the wash to the ground while the boundary went on climbing
 * the walls would be saying two things about one ward.
 */
function stuck(style: FeatureStyle): ShapeOptions {
  const base: ShapeBase = { height: style.height, glows: style.glows, pickable: style.pickable }
  return style.paints !== undefined ? { ...base, paints: style.paints } : { ...base, behind: style.behind }
}

/**
 * @internal One polygon of a feature, as the style draws it: the outside loop
 * first and its holes after, which is the order GeoJSON writes them in. Nothing
 * where there is no outside, or where the style turned off both the inside and
 * the line and left nothing to draw.
 *
 * One polygon, and only one: every loop after the first is a hole, since
 * `Polygon` winds them so by their order. A feature of several — a
 * MultiPolygon here, or a tile's feature with more than one outside — comes
 * through once a polygon. A vector tile does not say it by the order: its
 * features run outside, holes, outside, holes, and only the winding tells which
 * is which, so `VectorTileLayer` parts them by that before they come here.
 *
 * This and the two beside it are what every word of a {@link FeatureStyle}
 * means, written once. `VectorTileLayer` draws its features through them, so
 * a file and a tileset cannot come to mean two things by one style.
 */
export function areaOf(loops: readonly Run[], style: FeatureStyle): Polygon | null {
  const [outside, ...holes] = loops
  if (!outside || (style.fill === false && style.line === false)) return null
  return new Polygon({
    points: outside,
    holes,
    fill: style.fill,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    line: style.line,
    lineColor: style.lineColor,
    lineWidth: style.lineWidth,
    lineOpacity: style.lineOpacity,
    ...stuck(style),
  })
}

/** @internal One line of a feature, as the style draws it; nothing where its `line` is off. See {@link areaOf}. */
export function lineOf(run: Run, style: FeatureStyle): Polyline | null {
  if (style.line === false) return null
  return new Polyline({
    points: run,
    lineColor: style.lineColor,
    lineWidth: style.lineWidth,
    lineOpacity: style.lineOpacity,
    billboard: style.billboard,
    ...stuck(style),
  })
}

/**
 * @internal One point of a feature, as the style draws it: a circle, or
 * nothing where `point` is off — the caller hands that one back, if it has
 * anywhere to — or where both its inside and its ring are. See {@link areaOf}.
 */
export function circleOf(at: readonly [number, number], style: FeatureStyle): Circle | null {
  if (style.point === false || (style.fill === false && style.line === false)) return null
  return new Circle({
    at,
    radius: style.pointRadius,
    billboard: style.billboard,
    fill: style.fill,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    line: style.line,
    lineColor: style.lineColor,
    lineWidth: style.lineWidth,
    lineOpacity: style.lineOpacity,
    ...stuck(style),
  })
}

/**
 * Whatever a page handed over, as a list of features.
 *
 * A bare geometry is given a feature of its own with nothing said about it, so
 * that a style rule is asked the same question whichever way the data arrived.
 */
function featuresOf(data: GeoJsonData): GeoJsonFeature[] {
  // What came off the network is what it is, whatever the types say: a file
  // with a null where a feature should be, or no list where the features
  // should be, threw out of the setter and took the page's own code with it
  // (found in review). What is not a feature is left out
  const features = (list: unknown): GeoJsonFeature[] =>
    Array.isArray(list) ? (list as unknown[]).filter((one): one is GeoJsonFeature => isObject(one)) : []
  if (Array.isArray(data)) return features(data)
  if (!isObject(data)) return []
  const one = data as GeoJsonFeatureCollection | GeoJsonFeature | GeoJsonGeometry
  if (one.type === 'FeatureCollection') return features((one as GeoJsonFeatureCollection).features)
  if (one.type === 'Feature') return [one as GeoJsonFeature]
  return [{ type: 'Feature', geometry: one as GeoJsonGeometry, properties: null }]
}

/** Whether a value read off a file is an object to read a field of. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Reads one geometry out into the shapes it will be made from, following a
 * GeometryCollection down into whatever it holds.
 *
 * Walked rather than trusted. `coordinates` is whatever the file put there,
 * and a file in the wild leaves out a latitude, writes a string, or nests one
 * level too few often enough that a reader which assumed its own declaration
 * would throw on somebody's export. What cannot be read is passed over: a page
 * is better off with the nine plots that were written properly than with
 * nothing and a stack trace.
 */
function readInto(
  geometry: GeoJsonGeometry | null,
  polygons: Run[][],
  runs: Run[],
  stands: (at: readonly [number, number]) => void,
): void {
  if (!isObject(geometry)) return
  const held = geometry.coordinates
  switch (geometry.type) {
    case 'Point': {
      const at = placeOf(held)
      if (at) stands(at)
      return
    }
    case 'MultiPoint':
      for (const at of runOf(held)) stands(at)
      return
    case 'LineString': {
      const run = runOf(held)
      if (run.length >= 2) runs.push(run)
      return
    }
    case 'MultiLineString':
      for (const part of listOf(held)) {
        const run = runOf(part)
        if (run.length >= 2) runs.push(run)
      }
      return
    case 'Polygon':
      keep(ringsOf(held), polygons)
      return
    case 'MultiPolygon':
      for (const part of listOf(held)) keep(ringsOf(part), polygons)
      return
    case 'GeometryCollection':
      for (const inner of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
        readInto(inner, polygons, runs, stands)
      }
      return
  }
}

/**
 * Keeps one polygon.
 *
 * The loops go over as the file wrote them — which loop is the outside is the
 * order, not the winding, and {@link Polygon} settles the winding itself. It
 * also closes them for the loop it draws round itself, so a file that left the
 * last corner off is drawn whole.
 *
 * They used to be pushed into the runs as well, to be drawn as lines of their
 * own. That was this file working out for itself what a polygon's edge is, and
 * a polygon now carries its own.
 */
function keep(loops: Run[], polygons: Run[][]): void {
  if (loops.length === 0) return
  polygons.push(loops)
}

/** One place, or nothing where what is there is not one. */
function placeOf(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value)) return null
  const [lon, lat] = value as unknown[]
  if (typeof lon !== 'number' || typeof lat !== 'number') return null
  // The third number is a height above the ellipsoid, which is not a height
  // over the land: the two differ by the geoid, 31 to 43 m across Japan. A
  // page that wants a shape lifted says so in metres over the ground it lies on.
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
}

/** A run of places, with whatever could not be read left out. */
function runOf(value: unknown): Run {
  const out: (readonly [number, number])[] = []
  for (const at of listOf(value)) {
    const place = placeOf(at)
    if (place) out.push(place)
  }
  return out
}

/**
 * The loops of one polygon, the outside first.
 *
 * Nothing where the outside itself has too few corners to enclose anything:
 * the holes of a shape with no outside are not a shape. Judged before the
 * short loops are dropped, since dropping first would move whatever loop came
 * next to the front — and a hole read as an outside is filled in, which draws
 * exactly the ground the file asked to be left out.
 */
function ringsOf(value: unknown): Run[] {
  const loops = listOf(value).map(runOf)
  const outside = loops[0]
  if (!outside || outside.length < 3) return []
  return [outside, ...loops.slice(1).filter((loop) => loop.length >= 3)]
}

/** Whatever is there, as a list. Nothing, where it is not one. */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : []
}
