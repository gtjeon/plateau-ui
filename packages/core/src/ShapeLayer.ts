import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  Group,
  Mesh,
  type NodeMaterial,
  type Object3D,
} from 'three/webgpu'
import { answersNoRays, notPicked, PICKED_ITEM } from './pick.js'
import { DRAWN_BY, dimming, type Behind, type Draws } from './behind.js'
import { heightsChangedSince, heightsInHand, heightsVersion, type Heights } from './elevation.js'
import { Events, type Hit, type Position } from './events.js'
import { latToY, lonToX, metersPerUnit, yToLat, type WorldBounds } from './geo/mercator.js'
import { SAGS, cutRunToLand } from './ground/drape.js'
import { DEFAULT_SHAPE_COLOR } from './inks.js'
import { buildDisc } from './shapes/disc.js'
import { buildFill } from './shapes/fill.js'
import { VOLUME_OFFSET, buildDiscVolume, buildRunVolume, buildVolume } from './shapes/volume.js'
import { paintsOn, type PaintedKind, type Paints } from './paints.js'
import { insideLoops, worldLoop, type Point } from './polygons.js'
import { nearRun } from './polylines.js'
import { painted, ShapeMaterials } from './shapes/paint.js'
import { buildRibbon } from './shapes/ribbon.js'
import { colorFor, type ThemeColor } from './theme.js'
import type { Change, PutsItselfOn, Layer, Viewer } from './Viewer.js'

/**
 * What a page's shape is drawn in where it says no colour, for each of the two
 * sets. Kept with the other inks (`inks.ts`), since the city's outline reads it
 * too; said again here so that a page reaching for the shapes' constants finds
 * it beside the rest of them.
 */
export { DEFAULT_SHAPE_COLOR }

/**
 * How thick a line is drawn where it does not say, in pixels of the page —
 * a line, the loop round an area and the ring round a circle alike.
 */
export const DEFAULT_LINE_WIDTH = 4

/**
 * How much of a filled shape goes on where a page does not say, 0 to 1. The
 * same for an area and a circle, as it is in Leaflet and in deck.gl.
 *
 * Half. An area is drawn to say *this ground*, and ground a reader cannot see
 * is ground they cannot place — the streets under a coloured plot are how they
 * know where the plot is. Half is enough to read the colour at a glance and
 * enough to leave the map under it legible.
 */
export const DEFAULT_FILL_OPACITY = 0.5

/**
 * How far out a circle's edge is where a page does not say, in pixels of the
 * page.
 *
 * Six, which is twelve across: the size a file's point was drawn before points
 * were circles, kept so that a map drawn from a file looks the size it did.
 * Mapbox's default is five and Leaflet's ten, so it sits between the two.
 */
export const DEFAULT_CIRCLE_RADIUS = 6

/**
 * What an area does where something stands in front of it, unless the page
 * says otherwise: it keeps behind.
 *
 * The one place a shape does not take the group's answer. `'dim'` is right for
 * a line — a way drawn faint through the block it passes behind is still a way
 * a reader can follow, and the alternative is a route that vanishes — and for
 * a circle, which is a point to be found. An area is not followed, it is
 * covered ground, and half of its colour laid over every building standing on
 * it is not a hint but a fog: the city inside a coloured plot comes out
 * tinted, and a reader reads that as the buildings being coloured rather than
 * the ground under them.
 *
 * A page that does want the buildings tinted — a heat map over a district, say
 * — asks for `'dim'` and gets exactly that.
 */
const POLYGON_BEHIND: Behind = 'hide'

/**
 * What every shape a page paints has in common, whichever way it is drawn.
 *
 * The colours are not here, since what a shape has to colour is its own — a
 * line has a line, an area an inside and a loop, a circle an inside and a
 * ring — and they are named for the part they colour (`lineColor`,
 * `fillColor`), the way Mapbox and deck.gl name them, so that one object of
 * colours reads the same on a shape made by hand and on a file's style.
 *
 * None of them is `material.color`. The materials are shared by kind — one for
 * lines, one for areas, one for circles, one for the faint half — so the
 * colour rides on the corners, and the number means the colour the shape shows
 * in full daylight rather than a reflectance the light is multiplied over.
 * `shapes/paint.ts` has the whole of why, and what it cost to find out.
 *
 * Every colour is a {@link ThemeColor}: one value is that colour at every
 * hour, and `{ light, dark }` is a colour for each of the two sets, parted the
 * moment the sun crosses the horizon. Left out, a colour is
 * {@link DEFAULT_SHAPE_COLOR}, which is such a pair, and written `undefined` on
 * a live shape it goes back to that, as a solid's does — what a property takes
 * is what its option takes (contract 12, rule 2). A colour never takes
 * `null`: what turns a part off is that part's own switch (`fill`, `line`), so
 * that "draw it in the usual colour" is something a page can still say.
 *
 * Everything here and on each kind but where it stands (`points`, `holes`,
 * `at`) can be written on a live shape, and the shape is cut again. What rides
 * on the corners — a colour, a width, an opacity, a part turned on or off, a
 * radius — costs that cut and nothing more. What says how a shape is drawn
 * rather than in what — `glows`, `behind`, `billboard`, `paints`, and a `height`
 * that takes a painted shape off the land or lays it back — picks another of
 * the group's materials, and the first shape in a group to ask for one weaves
 * it: a shader, at about a second (CLAUDE.md, 주의할 점), and kept for every
 * shape after. One material and not the group's all, which contract 12's
 * rule 7 allows. See {@link ShapeLayer}.
 */
export interface ShapeBase {
  /** How far it is lifted off the land, in metres. On it by default. */
  readonly height?: number
  /**
   * Whether it carries its own light. `false` by default, so the shadows that
   * fall on the land fall on it too.
   *
   * Paint on a road is under whatever the road is under, and a line that
   * stayed bright through the shadow of the block beside it reads as a thing
   * hanging over the street rather than as a mark on it. `true` for a line
   * that has to be followed wherever it runs — a way through streets the
   * towers keep in shade all afternoon.
   *
   * It comes down to `material.lights`, which a page cannot write for the
   * reason the colours are on the corners: the material is shared by every
   * shape of its kind, and it is read as the shader is woven rather than at a
   * pixel. So it is another material rather than a flag — the answer is part
   * of the key those are kept under — made the first time a shape asks.
   *
   * **Not read where the shape is painted** (`paints` on a shape lying on the
   * land; see {@link ShapeSticks}), and both answers paint the same pixels
   * there. Paint goes over a picture the land was already lit and shaded in,
   * and takes no light of its own — lit again it would be darkened twice. So
   * at an opacity of one the colour covers the shade under it and shows as it
   * would in full daylight, which a painted line and a circle's ring always
   * are, and below one the shade shows through by the share the opacity
   * leaves. A page that wants the shadows to fall on its colour the way they
   * fall on a road leaves `paints` out and has the shape drawn at its place.
   * Read off the code (`classify` in `shapes/paint.ts`), not measured.
   */
  readonly glows?: boolean
  /**
   * Whether the pointer may find it. `true` by default, as it is in every map
   * library: a shape a page put on the map is a thing on the map, and a click
   * on it is a click on it rather than on the land it lies over.
   *
   * Written rather than worked out from whether anyone is listening. Leaflet
   * has `interactive`, deck.gl `pickable`, the browser `pointer-events`, and
   * all three are words a page says — because the question is not "does
   * somebody want to hear about this one" but "is this thing in the way", and
   * a thing in the way takes the click whoever is listening. Read off the
   * listeners it would be action at a distance: hanging one on a plot would
   * quietly change what the ground reports everywhere that plot lies.
   *
   * `false` is for the decoration — a route drawn over the streets, a boundary
   * there to be read — and for anything a page wants the pointer to go
   * straight through. Three's own `Raycaster` goes through every shape
   * whatever this says, since a ray asks about things in the world and a
   * shape is paint on the map; see `answersNoRays`.
   */
  readonly pickable?: boolean
  /**
   * Whether it is drawn at all. `true` by default.
   *
   * The same word as the property, as three's material takes `{ color }` and
   * has `material.color` (contract 12, rule 2). Until 2026-10-27 it was the
   * property alone, so a shape a page meant to show later — the next leg of a
   * walk, a plot not yet chosen — had to be made, written off and then added,
   * and one added before the write was cut onto the land for nothing.
   *
   * A hidden shape is not cut at all, so it costs nothing on the land until it
   * is shown, and the pointer passes through it whether it is painted or drawn
   * at its place: what is not on the picture is not in the way.
   */
  readonly visible?: boolean
}

/**
 * The one choice every shape makes, and the two questions that follow from it:
 * is this paint on the picture, or a thing standing at a place?
 *
 * They are two ways of drawing and not two settings of one way, and what each
 * can be asked is different — so they are told apart in the type rather than
 * in a sentence nobody reads. A page that says where its colour lands cannot
 * also say what happens behind it, because there is no behind; a page that
 * leaves it out cannot say what the colour lands on, because it lands where
 * it is.
 *
 * **{@link Paints} said** paints it onto the picture. It follows the ground a
 * pixel at a time, climbs whatever stands on that ground, and is never cut
 * again when a tile of heights lands — it holds no ground of its own. What it
 * cannot do is be anywhere: paint has no place, so nothing can be in front of
 * it, and a corner carrying a height has nothing to carry it to. A shape given
 * a `height` as well, or a line whose corners stand in the air, or one told to
 * face the eye, is drawn at its place instead, and what it said of the paint
 * waits until it is back on the ground.
 *
 * **Left out** draws it where it is, as a strip or a fan of its own. Whatever
 * stands in front of it hides it, dims it or is ignored — {@link Behind} — its
 * corners may stand off the land, and its edge is worked out to a share of a
 * pixel. What it cannot do is climb: a strip covers the screen where the strip
 * is, and the wall of a building it passes is not there.
 *
 * Cesium draws the line in the same place and calls the two
 * `GroundPolylinePrimitive` and `PolylinePrimitive`; deck.gl calls them
 * `terrainDrawMode: 'drape'` and `'offset'`. It is one word here because the
 * rest of a shape is the same either way — but for `glows`, which paint has no
 * light to answer with (see {@link ShapeBase.glows}).
 *
 * _(Until 2026-10-13 it was two: a `clamp` that turned the painting on and a
 * `paints` that said where the paint landed. `paints` was its own word
 * because three things shared it — a shape, a field colouring the city, a
 * picture laid on walls — and the day the other two went it was one word
 * written as two, which the type already had to bolt together. Writing it is
 * now the whole of saying it.)_
 */
export type ShapeSticks =
  | {
      /**
       * What its colour lands on: the land, what was built on it, or both.
       * Saying any of the three is what asks for the paint at all.
       *
       * Painted onto the picture wherever what it covers was drawn, which is
       * what lets it follow a kerb or a ridge to the pixel (see
       * `classify.ts`) — and where a tower stands on the ground it covers,
       * that leaves a question nobody else has to answer: does the colour
       * climb the tower, or stop at its foot?
       *
       * `'all'` is the one to reach for over a district: a ward drawn on a
       * city is a fact about the blocks as much as about the ground between
       * them, and a ward whose towers stay the colour of every other ward's
       * reads as a hole in it. A page colouring the ground itself — a flood, a
       * soil, a plot of land — says `'ground'`.
       *
       * The paint takes no light of its own, so while a shape is painted its
       * {@link ShapeBase.glows} is not read: the shade under it shows only
       * through what its opacity leaves.
       */
      readonly paints: Paints
      readonly behind?: never
    }
  | {
      readonly paints?: never
      /** What it does where something stands in front of it; see {@link Behind}. */
      readonly behind?: Behind
    }

/** What every shape a page paints on the land has in common. */
export type ShapeOptions = ShapeBase & ShapeSticks

/**
 * A corner of a line: where it is, and — if the page says so — how high it
 * stands there.
 *
 * The third number is metres over the land at that corner — over the land, not
 * over the sea, so nought is on the ground wherever the ground happens to be
 * and a hillside needs nothing said about it. It means what
 * {@link ShapeBase.height} means for the whole shape, and the two add.
 *
 * Two numbers and three-with-a-nought are the same corner and are drawn the
 * same way. What decides whether a line is paint on the land or a line through
 * the air is where its corners stand, not whether the page bothered to write
 * the nought down.
 *
 * Said on the corner rather than as a second list beside `points`, because
 * that is where every library that draws these puts it — Cesium and deck.gl
 * and Google's 3D maps all take a position of three numbers, and Mapbox hangs
 * a value off each vertex. A line and its heights kept apart are two lists
 * that can end up different lengths.
 */
export type PolylinePoint = readonly [number, number] | readonly [number, number, number]

/**
 * A line a page paints along the land: a way through the streets, the run of
 * a wall, the edge of a patch.
 *
 * Named for what it is and not for what it is for. A route is a use of a path
 * and not a shape of its own, and the shapes here are named the way every
 * other library names them — the way, too, that this one names the shapes a
 * mask is cut to.
 *
 * It has no `line` switch, being a line: a page that wants it gone sets
 * `visible`.
 */
export type PolylineOptions = ShapeOptions & {
  /**
   * Where it runs: [longitude, latitude] a corner, or [longitude, latitude,
   * height] for a corner standing off the land; see {@link PolylinePoint}.
   *
   * One corner standing off the land makes the whole line a line through the
   * air, and that changes two things. It is no longer cut to follow the land between
   * its corners — what runs from one corner to the next is a straight piece of
   * air, and a hill under it is not something it should bend over. And it is
   * drawn rather than painted: a line lying on the ground can be painted onto
   * the picture through a curtain of stencil (see {@link Behind}), and there
   * is no ground under this one to paint.
   *
   * Handed over once. A page that wants another run makes another line.
   */
  readonly points: readonly PolylinePoint[]
  /** What it is drawn in. {@link DEFAULT_SHAPE_COLOR} where it says nothing; see {@link ShapeBase}. */
  readonly lineColor?: ThemeColor
  /**
   * How thick, in pixels of the page. {@link DEFAULT_LINE_WIDTH} by default.
   *
   * Not in metres. Paint on a map is read at the size it is drawn whatever the
   * zoom — a way marked two metres wide is a hair at the zoom that shows the
   * whole walk and a road at the one that shows a doorway, and neither is the
   * mark a page meant.
   *
   * It is paint lying on the land all the same, so it is that many pixels
   * wide as the land faces the eye and narrower as it turns away. A mark that
   * kept its width whatever the tilt would be a card standing up off the map.
   */
  readonly lineWidth?: number
  /**
   * How much of the line goes on, 0 to 1. One by default — a line is drawn
   * whole, as Leaflet's stroke `opacity` and Mapbox's `line-opacity` are by
   * default. Held between the two.
   *
   * The name is the part's and `Opacity`, as `fillOpacity` is an area's
   * (contract 12's grammar), and every line takes it: a line's, an area's loop
   * and a circle's ring. Carried on the corners beside the colour, so writing
   * it cuts the line again and weaves nothing. Blended where the line's own
   * soft edge is already blended, in the opaque half, so the order a line is
   * drawn in among the shapes stays as it was.
   *
   * The half drawn faint through what hides it (`behind: 'dim'`) is drawn at
   * this opacity too: the faintness is taken in its colour, towards the
   * backdrop, and this in its alpha, so the two do not stand in for each
   * other.
   */
  readonly lineOpacity?: number
  /**
   * Whether its width faces the eye. A line through the air does, a line on
   * the land does not, and this says otherwise.
   *
   * Left alone, the two answers are the right ones. Paint narrows with the
   * road it is painted on, and a line that kept its width whatever the tilt
   * would be a card standing off the map; a line in the air has no road to
   * narrow with, and laid flat it is seen edge-on wherever it runs across a
   * tilted view.
   *
   * `true` on a line lying on the land is for one that has to be read at one
   * weight all the way round whatever the tilt — a loop measuring something,
   * rather than paint marking the ground. The name is deck.gl's, whose paths
   * take the same switch, rather than `facing`: everywhere else in this
   * library `facing` is a bearing in degrees (a solid, a model, a mark), and
   * one name with two meanings is what contract 12's rule 5 rules out. It is a
   * strip of its own, then, rather than paint, whatever `paints` says: a
   * curtain is cut flat and could not turn with the eye.
   *
   * So the default differs by kind (a circle faces the eye unless painted;
   * see {@link CircleOptions.billboard}).
   */
  readonly billboard?: boolean
}

/**
 * A piece of ground a page colours in: a plot, a site, a ward, a zone of a
 * park.
 *
 * Where a {@link Polyline} says *along here*, an area says *this ground*. It is
 * the one shape that can say a thing about the land rather than about a way
 * across it, and the one with an inside for a hole to be cut out of.
 *
 * Its two parts are the inside and the loop round it, each turned on by its
 * own name and coloured by that name with `Color` after it — Leaflet's `fill`
 * and `fillColor`, and `line` where Leaflet says `stroke`. Both are on by
 * default, as Leaflet's `stroke` and deck.gl's `filled` and `stroked` are.
 */
export type PolygonOptions = ShapeOptions & {
  /**
   * Its boundary, as [longitude, latitude] corners.
   *
   * The way a loop winds decides nothing. A winding is what a vector tile has
   * to be read by, since a tile says nothing else — but a page knows which
   * loop it meant, and says so by which of the two it is written in.
   *
   * A loop need not be closed: the last corner is joined to the first. Handed
   * over once, holes and all; a page that wants another outline makes another
   * area.
   */
  readonly points: readonly (readonly [number, number])[]
  /**
   * The loops taken out of it, if any: a courtyard, a lake on an island.
   *
   * Left out, the shape is whole. Each is its own loop of corners, read the
   * same way as {@link points} and cut out of it rather than drawn over it.
   */
  readonly holes?: readonly (readonly (readonly [number, number])[])[]
  /**
   * Whether the inside is coloured at all. Filled by default.
   *
   * `false` is a shape drawn as its loops alone — a boundary, a plot being
   * picked out, a district whose streets have to stay as legible as the ones
   * outside it. Said as a word rather than as an opacity of nought, so that a
   * page asking for nothing to be drawn and a page asking for a wash too faint
   * to see are telling the library two different things.
   */
  readonly fill?: boolean
  /** What the inside is coloured. {@link DEFAULT_SHAPE_COLOR} where it says nothing — not the line's. */
  readonly fillColor?: ThemeColor
  /**
   * How much of the inside goes on, 0 to 1. Half by default; see
   * {@link DEFAULT_FILL_OPACITY}.
   *
   * Really see-through, unlike a building's `strength` — the city under it
   * shows through rather than being mixed towards a colour. It is blended
   * where the ground's own water bank is blended, before the transparent
   * things are drawn, so an area still keeps its place in the order and a line
   * painted over it is still on top.
   */
  readonly fillOpacity?: number
  /**
   * Whether the loop round it is drawn. Drawn by default.
   *
   * Every loop takes one, the outside and the holes alike: a hole is an edge of
   * the shape as much as the outside is, and a plot whose courtyard went
   * unmarked would read as two shapes.
   *
   * _(Until 2026-10-27 there was no loop unless a colour or a width for it was
   * written, so naming a colour was what turned it on — and "draw the loop in
   * the usual colour" could not be said. Leaflet's `stroke` and deck.gl's
   * `stroked` are on by default, and so is this.)_
   */
  readonly line?: boolean
  /** What the loop is drawn in. {@link DEFAULT_SHAPE_COLOR} where it says nothing. */
  readonly lineColor?: ThemeColor
  /** How thick the loop is, in pixels of the page; see {@link PolylineOptions.lineWidth}. */
  readonly lineWidth?: number
  /** How much of the loop goes on, 0 to 1. One by default; see {@link PolylineOptions.lineOpacity}. */
  readonly lineOpacity?: number
}

/**
 * A circle a page puts at a point: a reading, a stop, a point out of a file.
 *
 * Where an area says *this ground* and a line *along here*, a circle says
 * *here*, and it is the size it is drawn at whatever the zoom — its radius is
 * in pixels of the page, the way Mapbox's circle and deck.gl's scatterplot
 * take theirs, since a point is read as a mark rather than as a stretch of
 * ground. A point that should cover so many metres is an area.
 *
 * Its parts are an area's: an inside and a ring round it, both on by default,
 * coloured and turned off by the same names. A pin or a label is not a circle
 * but a mark (`Marker`, `Label`), which stands among the other marks and is
 * laid out with them.
 */
export type CircleOptions = ShapeOptions & {
  /** Where it stands: [longitude, latitude]. Handed over once. */
  readonly at: readonly [number, number]
  /**
   * How far out its edge is, in pixels of the page. {@link DEFAULT_CIRCLE_RADIUS}
   * by default.
   *
   * The ring is centred on the edge, half inside and half out, as an area's
   * loop is on its boundary — so this is where the circle ends whatever its
   * ring, and a page drawing one to a size draws it to this.
   */
  readonly radius?: number
  /** Whether the inside is coloured. Filled by default; see {@link PolygonOptions.fill}. */
  readonly fill?: boolean
  /** What the inside is coloured. {@link DEFAULT_SHAPE_COLOR} where it says nothing. */
  readonly fillColor?: ThemeColor
  /** How much of the inside goes on, 0 to 1. Half by default, as an area's. */
  readonly fillOpacity?: number
  /** Whether the ring round it is drawn. Drawn by default. */
  readonly line?: boolean
  /** What the ring is drawn in. {@link DEFAULT_SHAPE_COLOR} where it says nothing. */
  readonly lineColor?: ThemeColor
  /** How thick the ring is, in pixels of the page. {@link DEFAULT_LINE_WIDTH} by default. */
  readonly lineWidth?: number
  /** How much of the ring goes on, 0 to 1. One by default; see {@link PolylineOptions.lineOpacity}. */
  readonly lineOpacity?: number
  /**
   * Whether it faces the eye on a tilted map, or lies on the land and narrows
   * with it.
   *
   * It faces the eye by default — what Mapbox's `circle-pitch-alignment` does
   * by default, and what a file's points did before they were circles. deck.gl,
   * whose name this is, leaves it false by default instead; this kept the look
   * a map already had. `false` lays it on the land, an ellipse on a tilted map, for a circle
   * that is a fact about the ground rather than a mark over it.
   *
   * **Except where it is painted** (`paints`, and no `height`). Paint lies on
   * what it lands on, so a painted circle lies on the land unless this says
   * `true` — and then it is drawn at its place instead, as a line told to face
   * the eye is. Left to the usual default, writing `paints` alone would have
   * asked for paint and quietly got a circle drawn over it.
   */
  readonly billboard?: boolean
}

/**
 * What a shape tells the page about.
 *
 * On the shape rather than on the group holding it, the way a solid's are: a
 * page that painted a plot already holds the plot, and asking it about its own
 * clicks saves a second table from whatever came back to what it means. A file
 * read by {@link GeoJsonLayer} is the other way round — the shapes there are
 * the layer's own and it is asked about features instead.
 */
export interface ShapeEvents {
  /** This shape was clicked, and where on the map. */
  click: {
    readonly shape: Shape
    readonly position: Position
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto this shape, or left it.
   *
   * Told on the change and not while the pointer travels over one shape.
   * Nothing is drawn or fetched again for it — the viewer is already looking,
   * for the cursor and for the click.
   */
  hover: {
    readonly shape: Shape
    readonly position: Position
  } | null
}

/** The lines round a shape that has none: a line, or a circle, whose ring is its own. */
const NO_LINES: readonly Polyline[] = []

/** The boxes of a shape that is not painted, or has nothing to paint. */
const NO_BOXES: readonly BufferGeometry[] = []

/**
 * One thing painted on the land, held on to.
 *
 * Not a {@link Layer}, for the reason a `Marker` is not one: what draws these
 * has to be few materials, and a hundred shapes are not a hundred things for
 * the viewer to seat. It is handed to the viewer all the same, and finds its
 * group itself; see {@link Held}. This is the handle, so that a page can keep
 * something it has painted, change it and take it away again.
 *
 * Every word a shape was made with is a property of the same name, and all of
 * them but where it is — `points`, `holes`, `at` — can be written while it is
 * on the map. Writing one cuts the shape again through the group holding it
 * ({@link ShapeLayer.restyled}), which is what changing a colour has always
 * done: most of what a shape looks like is on its corners, so most of a new
 * look is a new cut and nothing more. The words that say how it is drawn
 * rather than in what pick another material, woven the first time anything in
 * the group asks for it; see {@link ShapeBase}.
 *
 * `Shape` is the word for what a `ShapeLayer` holds. It is also what
 * `annotations/picture.ts` calls the symbol a mark is drawn with, which is a
 * different thing in a different corner of the library and never leaves it.
 */
abstract class Shape implements PutsItselfOn {
  private readonly events = new Events<ShapeEvents>()

  /**
   * Listens for this shape being clicked or pointed at. Hands back the way to
   * stop.
   *
   * Listening changes nothing about the drawing or about what the pointer
   * finds: whether the pointer finds this shape is {@link ShapeBase.pickable},
   * which the page says. So a shape may be in the way and tell nobody, and a
   * page may listen to a shape it has told the pointer to pass through — and
   * hear nothing, which is what it asked for.
   */
  on<K extends keyof ShapeEvents>(type: K, listener: (event: ShapeEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ShapeEvents>(type: K, listener: (event: ShapeEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /** @internal Whether anyone is listening, so the group can tell the viewer whether to look. */
  listens(type: keyof ShapeEvents): boolean {
    return this.events.has(type)
  }

  /** @internal Told by the group that holds it, which is the one the viewer speaks to. */
  clicked(hit: Hit): void {
    const { position, x, y, original } = hit
    this.events.emit('click', { shape: this, position, x, y, original })
  }

  /** @internal Told by the group, the same way as {@link clicked}. */
  hovered(hit: Hit | null): void {
    this.events.emit('hover', hit ? { shape: this, position: hit.position } : null)
  }

  /** The shapes holding it, so that changing it can ask them to draw again. */
  private owner: ShapeLayer | null = null
  private _height: number
  private _glows: boolean
  private _pickable: boolean
  private _behind: Behind | undefined
  private _paints: Paints | undefined
  private _visible: boolean

  protected constructor(options: ShapeOptions) {
    this._height = options.height ?? 0
    this._glows = options.glows ?? false
    this._behind = options.behind
    this._paints = options.paints
    this._pickable = options.pickable ?? true
    this._visible = options.visible ?? true
  }

  /**
   * @internal Cuts it afresh onto the land, or nothing where there is not
   * enough of it to draw.
   *
   * "Build" here means cut a geometry, and nothing else — not the seating on
   * the land that `Buildings` and `Model` call by a name of their own. The
   * land is handed in rather than read, since a group lays every shape it
   * holds from one reading; so is which of the two sets stands, since that is
   * the viewer's to say and every colour on the corners is read through it.
   */
  abstract build(land: Heights | null, night: boolean): BufferGeometry | null

  /**
   * @internal The paint it is drawn with in one half of the depth, from the
   * group's materials: a line's, an area's, or a circle's.
   *
   * Asked of the shape rather than worked out by the group, so that the kinds
   * a group draws are said where the kinds are.
   */
  abstract paintedWith(paint: ShapeMaterials, draws: Draws): NodeMaterial

  /**
   * @internal The closed volumes over it, for drawing it by classification —
   * a box over a filled shape, a curtain over a line, a column over a
   * circle and another over its ring; see `shapes/volume.ts`.
   *
   * More than one only where it has two colours to paint: a box carries one
   * colour on its corners and what paints a marked pixel is one face of it,
   * so two colours over one patch of ground are two boxes drawn one after the
   * other. An area's loops are lines of their own and carry their own.
   *
   * Cut the once and kept, which is the whole of what classification buys:
   * nothing in them depends on the land, so no tile of heights can stale them.
   * The draped geometry beside them is built again every time one lands. What
   * does stale them is the page changing how the shape looks, and the palette
   * turning over under a colour it said twice; both go through
   * {@link ShapeLayer.restyled}.
   */
  volumes(night: boolean): readonly BufferGeometry[] {
    this.boxes ??= this.cutVolumes(night)
    return this.boxes
  }

  /**
   * @internal Whether it covers a place, in the world's own units, as it is
   * drawn where the colour goes onto the finished picture.
   *
   * Asked of the shapes painted that way and no others: what is drawn at a
   * place of its own is found by the pointer itself, at its own depth, and
   * nothing here has to work out where it ended up. See
   * {@link ShapeLayer.covers}.
   *
   * `perPixel` is what one pixel of the page is worth there, because a line's
   * width is in pixels and this is not.
   */
  abstract covers(x: number, z: number, perPixel: number): boolean

  /**
   * @internal Whether any of it stands off the land on its own account —
   * which is to say, whether it is in the air rather than on the ground.
   *
   * Not the same as {@link ShapeBase.height}, which lifts the whole shape
   * and leaves it a shape of the ground lifted off it. This asks whether the
   * thing has a shape in the air at all, and only a line's corners can say so.
   *
   * Asked of where the corners stand and not of how they were written: every
   * corner at nought is a line on the ground, whether the noughts were spelled
   * out or left off.
   */
  get aloft(): boolean {
    return false
  }

  /**
   * @internal Whether it is turned towards the eye rather than laid flat; see
   * {@link PolylineOptions.billboard} and {@link CircleOptions.billboard}. An area
   * has nothing to turn, so it never is.
   */
  get billboard(): boolean {
    return false
  }

  /**
   * @internal Whether it is painted onto the picture rather than laid on the
   * land; see `classify.ts`.
   *
   * Only where what it was asked for can be said in paint. Drawn faint through
   * what hides it, there is nothing to be faint against — the colour lands
   * where the ground was drawn and nowhere else. Lifted off the land by
   * `height`, there is nothing to lift: paint has no height of its own. And a
   * line whose corners are in the air has no ground under it to paint on.
   *
   * Nor one turned towards the eye. What paints a shape onto the picture is a
   * box stood over it, and a box is pushed out along the ground — it could not
   * turn with the eye. The two ways of drawing are also two ways of smoothing
   * an edge: the box is counted in a stencil, which is in or out a pixel at a
   * time, where a strip or a fan works out what share of a pixel it covers. A
   * shape asked to hold one shape whatever the tilt has asked for the second.
   *
   * That last one is asked rather than forbidden in the type: `billboard` sits
   * beside `paints` in the options, so a page could write both, typecheck, and
   * have the turning quietly dropped — a word bought and nothing delivered.
   *
   * Read off the words as they stand now and not as the shape was made, since
   * every one of them may be written afresh: what was said of the paint is
   * kept while the shape is lifted, and comes back when it is laid down again.
   *
   * Asked of the shape rather than worked out by the group, because all the
   * words it reads are the shape's own. That is what leaves
   * {@link ShapeLayer.covers} reading nothing but what a page said: were this
   * the group's to decide, the natural thing to write beside it would be a
   * look at what the group has drawn — the one thing that answer must not turn
   * on.
   */
  get classified(): boolean {
    return this._paints !== undefined && this._height === 0 && !this.aloft && !this.billboard
  }

  /**
   * @internal Whether the palette turning over at dusk changes how it is cut:
   * whether any colour it draws is a pair, its own or the default.
   *
   * Asked by putting each colour to both sets rather than by its shape, so
   * that a pair is any value the two sets read differently and one colour
   * said once is never cut again for the sun.
   */
  abstract get turnsAtDusk(): boolean

  /** @internal Whether a geometry is one of the volumes it keeps, which are not to be let go of. */
  holdsBox(geometry: BufferGeometry): boolean {
    return this.boxes?.includes(geometry) ?? false
  }

  /** @internal Lets the volumes go. They outlive a laying, but not the shape. */
  unbox(): void {
    for (const box of this.boxes ?? NO_BOXES) box.dispose()
    this.boxes = null
  }

  /** @internal Cuts the volumes. Called once a look, by {@link volumes}. */
  protected abstract cutVolumes(night: boolean): readonly BufferGeometry[]

  /**
   * @internal Lets go of whatever was cut for the look it had, so that the
   * next cut makes it afresh for the look it has: its volumes, and an area's
   * loop lines, which are made from the area's words.
   *
   * Nothing is disposed here: what was drawn from them is still in the scene
   * until the shape is cut again, and {@link ShapeLayer.cut} lets go of what
   * the shape was drawn as before it asks for the new volumes — a volume the
   * shape has stopped claiming is disposed there. So this is for a shape
   * something is drawn from, and the group is what knows that; see
   * {@link ShapeLayer.restyled}.
   */
  forget(): void {
    this.boxes = null
  }

  private boxes: readonly BufferGeometry[] | null = null

  /**
   * @internal The lines round it, drawn after it: an area's loops where its
   * `line` is on, and none for a line, which is one already, or for a circle,
   * whose ring is drawn with it.
   *
   * Lines of their own rather than a loop cut here, so that what draws the edge
   * of an area is exactly what draws a line a page painted — one width, one way
   * of smoothing that width to a share of a pixel, one answer about what hides
   * it. deck.gl settles it the same way: its `PolygonLayer` is a composite over
   * a `SolidPolygonLayer` and a `PathLayer` rather than a filler that also
   * strokes.
   */
  get outlines(): readonly Polyline[] {
    return NO_LINES
  }

  /**
   * @internal The rectangle it lies in, in world units.
   *
   * So that a tile of heights landing can find whose land it moved. Worked
   * out once as the shape is made, which it can be because what a shape
   * covers is settled then: `points`, `holes` and `at` are handed over and
   * never changed, and a page that wants a different outline makes a
   * different shape.
   */
  abstract readonly where: WorldBounds

  /**
   * @internal How many corners it was given.
   *
   * Not how many it is drawn with — that is the land's business and is only
   * known once it has been cut. This is what a group has to go on when it is
   * working out whether a shape it has never cut will fit in what is left of
   * a frame.
   */
  abstract readonly corners: number

  /**
   * @internal Whether three may leave it out when the ball round its corners
   * falls off the screen; see {@link painted}.
   */
  abstract readonly culled: boolean

  /** How far it is lifted off the land, in metres; see {@link ShapeBase.height}. */
  get height(): number {
    return this._height
  }

  set height(value: number) {
    if (this._height === value) return
    this._height = value
    this.restyle()
  }

  /** Whether it carries its own light; see {@link ShapeBase.glows}. */
  get glows(): boolean {
    return this._glows
  }

  set glows(value: boolean) {
    if (this._glows === value) return
    this._glows = value
    this.restyle()
  }

  /**
   * What it does where something stands in front of it, or nothing where it
   * takes the answer of the group holding it; see {@link Behind}.
   *
   * An area that said nothing reads `'hide'`, which is its own answer rather
   * than the group's (see `POLYGON_BEHIND`). Written back as nothing, a line or
   * a circle goes back to the group's.
   *
   * Read and written whether or not it is painted, since a painted shape has
   * no behind to be asked about but may be laid down again later; what is
   * written waits until then.
   */
  get behind(): Behind | undefined {
    return this._behind ?? this.usualBehind
  }

  set behind(value: Behind | undefined) {
    if (this._behind === value) return
    this._behind = value
    this.restyle()
  }

  /**
   * What its colour lands on where it is painted onto the picture, or nothing
   * where it is drawn at its own place; see {@link ShapeSticks}.
   *
   * What the page said, kept as it said it. Whether the shape is painted at
   * the moment also turns on its `height` and on whether it faces the eye.
   */
  get paints(): Paints | undefined {
    return this._paints
  }

  set paints(value: Paints | undefined) {
    if (this._paints === value) return
    this._paints = value
    this.restyle()
  }

  /** Whether it is drawn at all; see {@link ShapeBase.visible}. */
  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    if (this._visible === value) return
    this._visible = value
    // Cut again rather than restyled: hiding changes whether anything is drawn
    // from the cut, not the look baked into it, so the boxes are kept for the
    // shape coming back (see restyle).
    this.owner?.redraw(this)
  }

  /** Whether the pointer may find it; see {@link ShapeBase.pickable}. */
  get pickable(): boolean {
    return this._pickable
  }

  set pickable(value: boolean) {
    if (this._pickable === value) return
    this._pickable = value
    // Cut into the mesh as it is built — a material already woven keeps the
    // shader it was woven with — so the shape is built again for it. Only on a
    // real turn, since a page writing the value it already had has asked for
    // nothing.
    this.owner?.redraw(this)
  }

  /** The answer it gives to what stands in front where the page said none; the group's, unless overridden. */
  protected get usualBehind(): Behind | undefined {
    return undefined
  }

  /**
   * Asks for it to be cut again with its new look.
   *
   * Through the group, which is the one that can tell whether what was cut
   * for the old look can be disposed now or is still being drawn from; see
   * {@link ShapeLayer.restyled}. With no group there is nothing to dispose: a
   * volume is only ever cut for a shape one holds, and a group gives it back as
   * it lets the shape go. What is left is only forgotten (below).
   *
   * Let go of here and not where the shape is cut again: `visible` asks for
   * that too, and a shape hidden and shown would pay for a box drawing the
   * look it had.
   */
  protected restyle(): void {
    if (this.owner) this.owner.restyled(this)
    // With no group, nothing is drawn from what was cut and its boxes are
    // already given back, but an area's loop lines are still held: they are
    // made from the area's words and kept until it forgets them. Left, an
    // area taken off, changed and put back is drawn with the loops of the look
    // it had — the old colour, or `paints` on a ring round an area now lifted.
    else this.forget()
  }

  /** @internal Which shapes hold it, so that no two sets hold the same one. */
  get heldBy(): ShapeLayer | null {
    return this.owner
  }

  /** @internal Told by {@link ShapeLayer} as it takes the shape on and lets it go. */
  held(by: ShapeLayer | null): void {
    this.owner = by
  }

  /** @internal Handed to a viewer bare, a shape goes into that viewer's own group of them. */
  putOn(viewer: Viewer): void {
    viewer.ownGroup('shapes', () => new ShapeLayer()).add(this)
  }

  /** @internal Taken off a viewer, a shape leaves whichever group is holding it. */
  takeOff(): void {
    this.owner?.remove(this)
  }
}

/**
 * The name of the family, for a page that wants to say it. The class
 * itself stays in: everything on it is this library's own, so there is
 * nothing out here to extend it against.
 */
export type { Shape }

/** One painted line, held on to; see {@link PolylineOptions}. */
export class Polyline extends Shape {
  private _points: readonly PolylinePoint[]
  private inAir: boolean
  private _lineColor: ThemeColor
  private _lineWidth: number
  private _lineOpacity: number
  /** What the page said of turning it, or nothing where it is left to where its corners stand. */
  private _billboard: boolean | undefined
  /** @internal Its width is pushed on in the shader, so its corners do not say what it covers. */
  readonly culled = false

  /** @internal Not widened by the line's own width: that is pixels, and this is the world. */
  where: WorldBounds
  /** @internal */
  corners: number

  constructor(options: PolylineOptions) {
    super(options)
    this._points = options.points
    this._lineColor = options.lineColor ?? DEFAULT_SHAPE_COLOR
    this._lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH
    this._lineOpacity = unit(options.lineOpacity ?? 1)
    this._billboard = options.billboard
    this.inAir = false
    this.where = boxRound([this._points])
    this.corners = 0
    this.reread()
  }

  /**
   * Its corners, as handed over. Changeable, as everything a page gave a
   * shape is (rule 2): a route that grows as a vehicle drives it is the same
   * line given more corners, and it was taken off and made again — with
   * every listener the page had hung on it.
   */
  get points(): readonly PolylinePoint[] {
    return this._points
  }

  set points(value: readonly PolylinePoint[]) {
    this._points = value
    this.reread()
    this.restyle()
  }

  /** What is worked out from the corners, worked out again. */
  private reread(): void {
    // Read off what the heights say, not off whether they were written down:
    // a corner put at nought is on the land, and a page that spelled it out
    // should get the line a page that left it off gets. One corner standing
    // off is enough — a line half on the ground and half in the air is a line
    // in the air with some of its corners resting on it
    this.inAir = this._points.some((point) => (point[2] ?? 0) !== 0)
    this.where = boxRound([this._points])
    this.corners = this._points.length
    this.run = null
  }

  /** What it is drawn in; see {@link PolylineOptions.lineColor}. */
  get lineColor(): ThemeColor {
    return this._lineColor
  }

  set lineColor(value: ThemeColor | undefined) {
    this._lineColor = value ?? DEFAULT_SHAPE_COLOR
    this.restyle()
  }

  /** How thick, in pixels of the page; see {@link PolylineOptions.lineWidth}. */
  get lineWidth(): number {
    return this._lineWidth
  }

  set lineWidth(value: number) {
    if (this._lineWidth === value) return
    this._lineWidth = value
    this.restyle()
  }

  /** How much of it goes on, held between 0 and 1; see {@link PolylineOptions.lineOpacity}. */
  get lineOpacity(): number {
    return this._lineOpacity
  }

  set lineOpacity(value: number) {
    const held = unit(value)
    if (this._lineOpacity === held) return
    this._lineOpacity = held
    this.restyle()
  }

  /** @internal See {@link ShapeBase.aloft}. */
  override get aloft(): boolean {
    return this.inAir
  }

  /**
   * Whether its width faces the eye; see {@link PolylineOptions.billboard}. Reads
   * the answer standing — its own corners' where the page said nothing — and
   * written back as nothing, goes back to theirs.
   */
  override get billboard(): boolean {
    return this._billboard ?? this.inAir
  }

  override set billboard(value: boolean | undefined) {
    if (this._billboard === value) return
    this._billboard = value
    this.restyle()
  }

  /** @internal */
  get turnsAtDusk(): boolean {
    return twoFaced(this._lineColor)
  }

  /** @internal */
  paintedWith(paint: ShapeMaterials, draws: Draws): NodeMaterial {
    return paint.line(draws, this.glows, this.billboard)
  }

  /** @internal */
  protected cutVolumes(night: boolean): readonly BufferGeometry[] {
    const box = buildRunVolume(this.points, inkOf(this._lineColor, night), this._lineOpacity, this._lineWidth)
    return box ? [box] : NO_BOXES
  }

  /** @internal */
  build(land: Heights | null, night: boolean): BufferGeometry | null {
    if (this.points.length < 2) return null
    return buildRibbon(
      walkOf(this, land),
      this._lineWidth / 2,
      inkOf(this._lineColor, night),
      this._lineOpacity,
      this.billboard,
    )
  }

  /**
   * @internal The band it paints: within half its width of the run it follows.
   *
   * Only ever asked of a line lying on the ground — a line in the air is drawn
   * at its place and found there — so the heights its corners may carry are
   * not read, exactly as the curtain cut for it does not read them.
   */
  covers(x: number, z: number, perPixel: number): boolean {
    const half = (this._lineWidth / 2) * perPixel
    if (!inBox(this.where, x, z, half)) return false
    this.run ??= this.points.map(([lon, lat]) => ({ x: lonToX(lon), z: -latToY(lat) }))
    return nearRun(this.run, x, z, half)
  }

  /**
   * Where it runs, in the world's own units, held between looks.
   *
   * Worked out once and kept for good, which it can be because `points` is
   * handed over and never changed — a page wanting another run makes another
   * line. The pointer asks on every look, and a file of a thousand roads would
   * otherwise turn every corner of every one of them into Mercator sixty times
   * a second.
   */
  private run: { x: number; z: number }[] | null = null
}

/** One piece of coloured ground, held on to; see {@link PolygonOptions}. */
export class Polygon extends Shape {
  private _points: readonly (readonly [number, number])[]
  private _holes: readonly (readonly (readonly [number, number])[])[]
  /** @internal The outside first, then whatever is taken out of it. */
  loops: readonly (readonly (readonly [number, number])[])[]
  private _fill: boolean
  private _fillColor: ThemeColor
  private _fillOpacity: number
  private _line: boolean
  private _lineColor: ThemeColor
  private _lineWidth: number
  private _lineOpacity: number
  /** The loops as lines, made from what the area says now and let go of when it says otherwise. */
  private rings: readonly Polyline[] | null = null
  /** @internal It is filled exactly where its corners say, so the ball round them tells the truth. */
  readonly culled = true

  /** @internal Its outside loop alone: a hole is inside that, so it widens nothing. */
  where: WorldBounds

  constructor(options: PolygonOptions) {
    super(options)
    this._points = options.points
    this._holes = options.holes ?? []
    this.loops = [options.points, ...this._holes]
    this._fill = options.fill ?? true
    this._fillColor = options.fillColor ?? DEFAULT_SHAPE_COLOR
    this._fillOpacity = unit(options.fillOpacity ?? DEFAULT_FILL_OPACITY)
    this._line = options.line ?? true
    this._lineColor = options.lineColor ?? DEFAULT_SHAPE_COLOR
    this._lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH
    this._lineOpacity = unit(options.lineOpacity ?? 1)
    this.where = boxRound(this.loops.slice(0, 1))
  }

  /**
   * Its outside loop, as it was handed over; see {@link PolygonOptions.points}.
   * Changeable, as a line's corners are.
   */
  get points(): readonly (readonly [number, number])[] {
    return this._points
  }

  set points(value: readonly (readonly [number, number])[]) {
    this._points = value
    this.reloop()
  }

  /** What is taken out of it; empty where nothing is. Changeable, as {@link points} is. */
  get holes(): readonly (readonly (readonly [number, number])[])[] {
    return this._holes
  }

  set holes(value: readonly (readonly (readonly [number, number])[])[]) {
    this._holes = value
    this.reloop()
  }

  /** What is worked out from the loops, worked out again, and the area drawn afresh. */
  private reloop(): void {
    this.loops = [this._points, ...this._holes]
    this.where = boxRound(this.loops.slice(0, 1))
    this.world = null
    this.restyle()
  }

  /** Whether the inside is coloured; see {@link PolygonOptions.fill}. */
  get fill(): boolean {
    return this._fill
  }

  set fill(value: boolean) {
    if (this._fill === value) return
    this._fill = value
    this.restyle()
  }

  /** What the inside is coloured; see {@link PolygonOptions.fillColor}. */
  get fillColor(): ThemeColor {
    return this._fillColor
  }

  set fillColor(value: ThemeColor | undefined) {
    this._fillColor = value ?? DEFAULT_SHAPE_COLOR
    this.restyle()
  }

  /** How much of the inside goes on, held between 0 and 1; see {@link PolygonOptions.fillOpacity}. */
  get fillOpacity(): number {
    return this._fillOpacity
  }

  set fillOpacity(value: number) {
    const held = unit(value)
    if (this._fillOpacity === held) return
    this._fillOpacity = held
    this.restyle()
  }

  /** Whether the loop round it is drawn; see {@link PolygonOptions.line}. */
  get line(): boolean {
    return this._line
  }

  set line(value: boolean) {
    if (this._line === value) return
    this._line = value
    this.restyle()
  }

  /** What the loop is drawn in; see {@link PolygonOptions.lineColor}. */
  get lineColor(): ThemeColor {
    return this._lineColor
  }

  set lineColor(value: ThemeColor | undefined) {
    this._lineColor = value ?? DEFAULT_SHAPE_COLOR
    this.restyle()
  }

  /** How thick the loop is, in pixels of the page. */
  get lineWidth(): number {
    return this._lineWidth
  }

  set lineWidth(value: number) {
    if (this._lineWidth === value) return
    this._lineWidth = value
    this.restyle()
  }

  /** How much of the loop goes on, held between 0 and 1; see {@link PolygonOptions.lineOpacity}. */
  get lineOpacity(): number {
    return this._lineOpacity
  }

  set lineOpacity(value: number) {
    const held = unit(value)
    if (this._lineOpacity === held) return
    this._lineOpacity = held
    this.restyle()
  }

  /**
   * @internal How many corners it was given, counted once for each half that
   * is cut: the fill, and a line a loop.
   */
  get corners(): number {
    const given = this.loops.reduce((all, loop) => all + loop.length, 0)
    return (this._fill ? given : 0) + (this._line ? given : 0)
  }

  /** @internal One a loop, the outside and the holes alike; see {@link Shape.outlines}. */
  override get outlines(): readonly Polyline[] {
    return (this.rings ??= this.loopLines())
  }

  /** @internal */
  get turnsAtDusk(): boolean {
    return (this._fill && twoFaced(this._fillColor)) || (this._line && twoFaced(this._lineColor))
  }

  /** @internal The loops' lines are made from the area's words, so a new look makes new ones. */
  override forget(): void {
    super.forget()
    this.rings = null
  }

  /** @internal And the curtains cut for the loops, which are the area's too. */
  override unbox(): void {
    super.unbox()
    for (const line of this.rings ?? NO_LINES) line.unbox()
  }

  protected override get usualBehind(): Behind | undefined {
    return POLYGON_BEHIND
  }

  /**
   * The loops as lines, told what the area is told: drawn where the fill is
   * drawn, stuck the way it is stuck, hidden by whatever hides it.
   *
   * Closed here and not in the line. A loop handed over need not be closed and
   * a line never closes itself, so the first corner is put on the end — without
   * it an outlined plot wears a gap where its loop began.
   *
   * Made afresh whenever the area's look changes rather than kept in step,
   * since every word they take is the area's and a line made from them now is
   * the whole of keeping them in step.
   */
  private loopLines(): readonly Polyline[] {
    if (!this._line) return NO_LINES
    // Said as one object rather than two spreads: `paints` and `behind` are
    // the two halves of {@link ShapeSticks} and cannot both be written.
    //
    // Chosen by whether the area is painted now, not by whether it said
    // `paints`. A lifted area keeps what it said of the paint for later and is
    // drawn at its place meanwhile, hidden by what its own `behind` says; a
    // loop handed that `paints` would be drawn at its place too (it is lifted
    // with the area) but with no `behind` of its own, so it would fall to the
    // group's — `'dim'` by default — and show faint through the towers the
    // fill keeps behind. Nor would a `behind` written on the area ever reach
    // it. The rings are made afresh on every write of `height`, `paints` and
    // `behind` (see {@link forget}), so this is read again whenever it can
    // change.
    const paints = this.paints
    const sticks =
      paints !== undefined && this.classified ? ({ paints } as const) : ({ behind: this.behind } as const)
    const lines: Polyline[] = []
    for (const loop of this.loops) {
      const first = loop[0]
      if (!first) continue
      lines.push(
        new Polyline({
          points: [...loop, first],
          lineColor: this._lineColor,
          lineWidth: this._lineWidth,
          lineOpacity: this._lineOpacity,
          height: this.height,
          glows: this.glows,
          ...sticks,
        }),
      )
    }
    return lines
  }

  /** @internal */
  paintedWith(paint: ShapeMaterials, draws: Draws): NodeMaterial {
    return paint.fill(draws, this.glows)
  }

  /** @internal Nothing to count a pixel into where the inside is not coloured. */
  protected cutVolumes(night: boolean): readonly BufferGeometry[] {
    if (!this._fill) return NO_BOXES
    const box = buildVolume(this.loops, inkOf(this._fillColor, night), this._fillOpacity)
    return box ? [box] : NO_BOXES
  }

  /** @internal */
  build(land: Heights | null, night: boolean): BufferGeometry | null {
    if (!this._fill) return null
    return buildFill(this.loops, land, this.height, inkOf(this._fillColor, night), this._fillOpacity)
  }

  /**
   * @internal The ground it paints: inside its loops where it is filled, and
   * under the loops themselves where they are drawn.
   *
   * Both, and not one or the other, because both are what a reader sees: an
   * unfilled area is its edge and nothing else, and a filled one still has a
   * band of ink standing a few pixels outside its own corners.
   */
  covers(x: number, z: number, perPixel: number): boolean {
    // The rectangle round its outside loop first, which is the one thing here
    // that was worked out when the shape was made. A hole lies inside it, and
    // so does every loop drawn round it.
    const slack = this._line ? (this._lineWidth / 2) * perPixel : 0
    if (!inBox(this.where, x, z, slack)) return false
    if (this._fill) {
      this.world ??= this.loops.map(worldLoop)
      if (insideLoops(this.world, x, z)) return true
    }
    return this.outlines.some((line) => line.covers(x, z, perPixel))
  }

  /** Its loops in the world's own units, held between looks; see {@link Polyline}'s. */
  private world: Point[][] | null = null
}

/** One circle at a point, held on to; see {@link CircleOptions}. */
export class Circle extends Shape {
  private _at: readonly [number, number]
  private _radius: number
  private _fill: boolean
  private _fillColor: ThemeColor
  private _fillOpacity: number
  private _line: boolean
  private _lineColor: ThemeColor
  private _lineWidth: number
  private _lineOpacity: number
  /** What the page said of turning it, or nothing where it is left to whether it is painted. */
  private _billboard: boolean | undefined
  /** @internal Its fan is pushed out in the shader, so its one corner says nothing of what it covers. */
  readonly culled = false

  /** @internal The point alone. Its radius is pixels, and this is the world. */
  where: WorldBounds
  /** @internal One: everything else about it is pushed out from there. */
  readonly corners = 1

  constructor(options: CircleOptions) {
    super(options)
    this._at = options.at
    this._radius = Math.max(options.radius ?? DEFAULT_CIRCLE_RADIUS, 0)
    this._fill = options.fill ?? true
    this._fillColor = options.fillColor ?? DEFAULT_SHAPE_COLOR
    this._fillOpacity = unit(options.fillOpacity ?? DEFAULT_FILL_OPACITY)
    this._line = options.line ?? true
    this._lineColor = options.lineColor ?? DEFAULT_SHAPE_COLOR
    this._lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH
    this._lineOpacity = unit(options.lineOpacity ?? 1)
    this._billboard = options.billboard
    this.where = boxRound([[this._at]])
  }

  /** Where it stands, as it was handed over. Changeable, as a line's corners are. */
  get at(): readonly [number, number] {
    return this._at
  }

  set at(value: readonly [number, number]) {
    this._at = value
    this.where = boxRound([[value]])
    this.restyle()
  }

  /** How far out its edge is, in pixels of the page; see {@link CircleOptions.radius}. */
  get radius(): number {
    return this._radius
  }

  set radius(value: number) {
    const held = Math.max(value, 0)
    if (this._radius === held) return
    this._radius = held
    this.restyle()
  }

  /** Whether the inside is coloured. */
  get fill(): boolean {
    return this._fill
  }

  set fill(value: boolean) {
    if (this._fill === value) return
    this._fill = value
    this.restyle()
  }

  /** What the inside is coloured. */
  get fillColor(): ThemeColor {
    return this._fillColor
  }

  set fillColor(value: ThemeColor | undefined) {
    this._fillColor = value ?? DEFAULT_SHAPE_COLOR
    this.restyle()
  }

  /** How much of the inside goes on, held between 0 and 1. */
  get fillOpacity(): number {
    return this._fillOpacity
  }

  set fillOpacity(value: number) {
    const held = unit(value)
    if (this._fillOpacity === held) return
    this._fillOpacity = held
    this.restyle()
  }

  /** Whether the ring round it is drawn. */
  get line(): boolean {
    return this._line
  }

  set line(value: boolean) {
    if (this._line === value) return
    this._line = value
    this.restyle()
  }

  /** What the ring is drawn in. */
  get lineColor(): ThemeColor {
    return this._lineColor
  }

  set lineColor(value: ThemeColor | undefined) {
    this._lineColor = value ?? DEFAULT_SHAPE_COLOR
    this.restyle()
  }

  /** How thick the ring is, in pixels of the page. */
  get lineWidth(): number {
    return this._lineWidth
  }

  set lineWidth(value: number) {
    if (this._lineWidth === value) return
    this._lineWidth = value
    this.restyle()
  }

  /** How much of the ring goes on, held between 0 and 1; see {@link CircleOptions.lineOpacity}. */
  get lineOpacity(): number {
    return this._lineOpacity
  }

  set lineOpacity(value: number) {
    const held = unit(value)
    if (this._lineOpacity === held) return
    this._lineOpacity = held
    this.restyle()
  }

  /**
   * Whether it faces the eye; see {@link CircleOptions.billboard}. Reads the
   * answer standing — towards the eye unless it is painted, where the page
   * said nothing — and written back as nothing, goes back to that.
   */
  override get billboard(): boolean {
    return this._billboard ?? !(this.paints !== undefined && this.height === 0)
  }

  override set billboard(value: boolean | undefined) {
    if (this._billboard === value) return
    this._billboard = value
    this.restyle()
  }

  /** @internal */
  get turnsAtDusk(): boolean {
    return (this._fill && twoFaced(this._fillColor)) || (this._line && twoFaced(this._lineColor))
  }

  /** @internal */
  paintedWith(paint: ShapeMaterials, draws: Draws): NodeMaterial {
    return paint.circle(draws, this.glows, this.billboard)
  }

  /** The ring's half-width in pixels of the page, or nought where there is none. */
  private get halfLine(): number {
    return this._line ? Math.max(this._lineWidth, 0) / 2 : 0
  }

  /**
   * @internal A column over the inside and a band over the ring, the inside
   * first, so that the ring is painted over it the way it is drawn over it.
   */
  protected cutVolumes(night: boolean): readonly BufferGeometry[] {
    const boxes: BufferGeometry[] = []
    if (this._fill) {
      const inside = buildDiscVolume(this.at, this._radius, 0, inkOf(this._fillColor, night), this._fillOpacity)
      if (inside) boxes.push(inside)
    }
    const half = this.halfLine
    if (half > 0) {
      const ring = buildDiscVolume(
        this.at,
        this._radius + half,
        this._radius - half,
        inkOf(this._lineColor, night),
        this._lineOpacity,
      )
      if (ring) boxes.push(ring)
    }
    return boxes
  }

  /**
   * @internal Its fan, standing at the point on the land: the land's height
   * there and whatever the page lifted it by, and nothing else, as a line's
   * corner is (see {@link walkOf}).
   */
  build(land: Heights | null, night: boolean): BufferGeometry | null {
    const x = lonToX(this.at[0])
    const z = -latToY(this.at[1])
    // North is where the world's z is least, which is where Mercator's y is
    // most, so the one is asked for as the other's negative
    const ground = land?.at(x, -z) ?? 0
    const y = (ground + this.height) / metersPerUnit(this.at[1])
    return buildDisc(x, y, z, {
      radius: this._radius,
      fill: this._fill ? { colour: inkOf(this._fillColor, night), shows: this._fillOpacity } : null,
      line: this._line
        ? { colour: inkOf(this._lineColor, night), shows: this._lineOpacity, width: this._lineWidth }
        : null,
    })
  }

  /**
   * @internal The ground it paints: within its radius where it is filled, and
   * the band of its ring where that is drawn.
   *
   * Measured in the world and turned into pixels by what one is worth there,
   * which is what the column cut for it does in the other direction — it is
   * pushed out along the ground by the very same number.
   */
  covers(x: number, z: number, perPixel: number): boolean {
    if (!(perPixel > 0)) return false
    const half = this.halfLine
    if (!inBox(this.where, x, z, (this._radius + half) * perPixel)) return false
    const off = Math.hypot(x - lonToX(this.at[0]), z + latToY(this.at[1])) / perPixel
    if (this._fill && off <= this._radius) return true
    return half > 0 && Math.abs(off - this._radius) <= half
  }
}

/**
 * Whether a colour is two colours: whether the two sets read it differently.
 *
 * A pair said with the same colour twice is one colour, and is not cut again
 * at dusk for nothing.
 */
function twoFaced(colour: ThemeColor): boolean {
  return colorFor(colour, false) !== colorFor(colour, true)
}

/** A page's colour as it stands in the set now standing, ready for a corner. */
function inkOf(colour: ThemeColor, night: boolean): Color {
  return new Color(colorFor(colour, night))
}

/** A share held between nought and one. */
function unit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * What one shape is drawn as, kept in two halves.
 *
 * Apart because they go into the scene at different times: every fill, line
 * and circle a page painted, and then every loop round an area; see
 * {@link ShapeLayer.seat}.
 */
interface Drawn {
  /** The shape itself — its fill, the line it is, or the circle and its ring. */
  readonly own: readonly Object3D[]
  /** The lines round it; see {@link Shape.outlines}. */
  readonly lines: readonly Object3D[]
  /**
   * Whether the pointer may find what was cut, as the shape said it at that
   * cut.
   *
   * Kept with the meshes rather than read off the shape when they are seated:
   * a page writing `pickable` asks for the shape to be cut again, and the
   * group seats what it has between cuts, so for a frame or two the shape says
   * one thing and its meshes the other. A run is joined by what its meshes
   * are; see {@link ShapeLayer.run}.
   */
  readonly found: boolean
}

export interface ShapeLayerOptions {
  /**
   * What a shape does where something hides it, for the shapes that say
   * nothing of their own. `'dim'` by default; an area keeps its own answer
   * (see {@link PolygonOptions}).
   */
  readonly behind?: Behind
  /**
   * How much of a shape left to `'dim'` shows through what hides it, 0 to 1.
   * `DEFAULT_DIMMED` by default.
   */
  readonly dimmed?: number
  /**
   * Drawn at all. On by default. A property of the layer afterwards, by the
   * same name: the one way to take everything in it off the map at once and
   * put it back, as every other layer has it. Writing `root.visible` instead
   * hid what three draws and left the rest — a page's own markup standing,
   * a shadow printed where solids had been.
   */
  readonly visible?: boolean
}

/**
 * A group of painted shapes, drawn as one.
 *
 * A page need not make one. Handed a bare {@link Polyline}, {@link Polygon} or
 * {@link Circle}, the viewer keeps a group of its own and paints it in there.
 * This is for a page that wants a group it can name: to give everything in it
 * one answer, or to take them all off the map at once.
 *
 * Drawn after the city and deciding for itself what hides it, the way the
 * marks do: a shape told to keep behind what stands in front of it is depth
 * tested against the buildings, and one told to show is not. Laid in the
 * ground's own stage instead it would be hidden by every building whatever it
 * asked for, and which of it showed would turn on the order a page called
 * `add` in.
 *
 * Within the group that order is exactly what decides. Nothing here writes
 * depth and everything here is drawn in the one pass, so a line added after an
 * area is drawn over it — which is how a page outlines a plot it has just
 * filled, and why they are kept in one list rather than one list a kind.
 *
 * What it draws is baked as it is given — the corners are laid on the land at
 * the height the land has there, and carry the colours and widths the shape
 * was given — so a shape is built when a page paints it, again when the land
 * itself changes, again when the page changes how it looks, and again for a
 * colour said twice when the palette turns over at dusk; not every frame.
 */
export class ShapeLayer implements Layer {
  /**
   * @internal Whether the viewer's mask cuts what this draws. The vector
   * tiles' `masked` says it of the group they draw into; a page's own group
   * is always cut.
   */
  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (this._masked === value) return
    this._masked = value
    this.paint.setMask(value ? (this.viewer?.maskArea ?? null) : null)
  }

  private _masked = true
  /** Everything painted here. The viewer seats it; see {@link Layer.root}. */
  readonly root = new Group()
  /** After the city, judging for itself what stands in front of it. */
  readonly stage = 'overlay' as const

  private viewer: Viewer | null = null
  private readonly shapes: Shape[] = []
  private readonly paint: ShapeMaterials
  private _behind: Behind
  private _dimmed: number
  /**
   * Which of the two sets the shapes were last cut for, so that the palette
   * turning over can tell whether it turned over under them.
   *
   * Kept rather than read off the viewer at each cut, because a box is cut
   * once and kept: what has to be known is not which set stands now but which
   * set the boxes in hand were cut for.
   */
  private night = false
  /** That everything painted here wants building again. The work happens on the next frames. */
  private dirty = true
  /** Whether {@link lowest} has to be read again: the shapes moved, or the land did. */
  private floorStale = true
  /** The lowest ground under any of the shapes, in metres; see {@link lowestUnder}. */
  private lowest = 0
  /**
   * The shapes waiting to be cut again, a few at a time.
   *
   * Held as a set rather than done at once because cutting a shape to follow
   * the land is not small: over the twenty-three wards of 東京 the whole set
   * came to 296ms, which is a quarter of a second the reader watches nothing
   * move. Spread over the frames it takes, the same work is a map that keeps
   * going.
   */
  private readonly waiting = new Set<Shape>()
  /** What each shape is drawn as, so that one of them can be cut again without the rest. */
  private readonly drawn = new Map<Shape, Drawn>()
  /** Which shape each mesh belongs to, so that what the pointer finds has a name. */
  private readonly whose = new Map<Object3D, Shape>()
  /**
   * The geometries {@link seat} poured runs of shapes into.
   *
   * This layer's own, unlike every other geometry here, which belongs to the
   * shape it was cut for. Let go of and made afresh whenever the shapes are
   * seated again, since a run that gained or lost one is another run.
   */
  private readonly joined: BufferGeometry[] = []
  /** The shape the pointer is on, so that the one it leaves can be told. */
  private hovering: Shape | null = null
  /**
   * What cutting each shape took last time, in milliseconds.
   *
   * So that one is not begun in the last millisecond of a frame. Its own last
   * cut rather than an average over them all, because they are nothing like
   * each other — of the 118 filled shapes the twenty-three wards come to,
   * most are a pier or an islet and cost nothing to speak of, while the widest
   * took 23.8ms by itself.
   */
  private readonly cost = new Map<Shape, number>()
  /**
   * What a corner has been costing to cut, in milliseconds.
   *
   * So that a shape never cut before can still be judged against what is left
   * of the frame. A flat rate over all of them rather than nothing, because
   * they are nothing like each other in size and very like each other in what
   * a corner costs: of the 118 filled shapes the twenty-three wards come to,
   * most are a pier or an islet and the widest took 23.8ms, and the difference
   * is almost all in how many corners went in.
   */
  private perCorner = 0
  /** Which land the shapes were last laid on; nothing where they were laid flat. */
  private laidOn: number | null = null
  /** When the tiles in hand last became a different set. */
  private landMovedAt = 0
  /** When the shapes first fell behind the land, for the ceiling on waiting. */
  private staleSince = 0
  /**
   * That what is waiting was put there by the page rather than by the land.
   *
   * A page adding a shape or changing its colour has said what it wants and
   * nothing more is coming; the land says so over and over while a zoom
   * fetches, and there is no sense cutting to a reading about to be replaced.
   */
  private urgent = false

  constructor(options: ShapeLayerOptions = {}) {
    this._behind = options.behind ?? 'dim'
    this._dimmed = dimming(options.dimmed)
    this.paint = new ShapeMaterials(this._dimmed)
    this.root.visible = options.visible ?? true
  }

  /** Drawn at all; see {@link ShapeLayerOptions.visible}. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    this.root.visible = value
  }

  /**
   * What a shape does where something hides it, for the shapes that say
   * nothing of their own; see {@link ShapeLayerOptions.behind}.
   *
   * Written on a live layer, the shapes that take this answer are cut again
   * and the rest are left alone — an area answers for itself, and a shape
   * painted onto the picture has no behind.
   */
  get behind(): Behind {
    return this._behind
  }

  set behind(value: Behind) {
    if (this._behind === value) return
    this._behind = value
    for (const shape of this.shapes) {
      if (shape.behind === undefined && !shape.classified) this.redraw(shape)
    }
  }

  /**
   * How much of a shape left to `'dim'` shows through what hides it, held
   * between 0 and 1; see {@link ShapeLayerOptions.dimmed}.
   *
   * A uniform the faint half reads as it draws, so writing it cuts nothing
   * and weaves nothing.
   */
  get dimmed(): number {
    return this._dimmed
  }

  set dimmed(value: number) {
    this._dimmed = dimming(value)
    this.paint.setDimmed(this._dimmed)
  }

  /** What is painted here, in the order it was painted. */
  get items(): readonly Shape[] {
    return this.shapes
  }

  /** Paints a shape. One already painted stays where it is rather than doubling. */
  add(shape: Shape): this {
    if (this.shapes.includes(shape)) return this
    if (shape.heldBy && shape.heldBy !== this) {
      throw new Error(
        'ShapeLayer.add: this shape is already in another ShapeLayer. Take it out of that one first.',
      )
    }
    this.shapes.push(shape)
    shape.held(this)
    this.waiting.add(shape)
    this.urgent = true
    this.floorStale = true
    return this
  }

  /** Takes a shape off, leaving it as it was made, to be painted again later if wanted. */
  remove(shape: Shape): this {
    const at = this.shapes.indexOf(shape)
    if (at < 0) return this
    this.shapes.splice(at, 1)
    this.floorStale = true
    shape.held(null)
    this.waiting.delete(shape)
    this.cost.delete(shape)
    if (this.hovering === shape) this.hovering = null
    this.drop(shape)
    shape.unbox()
    this.seat()
    return this
  }

  /**
   * @internal Takes many shapes off at once, and seats what is left the once.
   *
   * What {@link remove} does for each of them, less the seating after each.
   * Seating pours every joined run in the group again, so a batch let go of
   * one at a time is the whole group poured once a shape — and a tile of a
   * tileset given nothing but its `url` is about 1,400 shapes, poured against
   * everything else in hand. `VectorTileLayer` lets go of its shapes a tile at
   * a time and comes this way; a page's own come off by {@link remove}, or all
   * together by {@link clear}.
   *
   * Internal rather than published: a page taking many of its own shapes off
   * has not asked for it, and the fewer ways in the better (contract 8).
   */
  removeAll(gone: readonly Shape[]): void {
    const leaving = new Set<Shape>()
    for (const shape of gone) {
      // Held here is in here: `add` and `remove` keep the two together
      if (shape.heldBy !== this || leaving.has(shape)) continue
      leaving.add(shape)
      shape.held(null)
      this.waiting.delete(shape)
      this.cost.delete(shape)
      if (this.hovering === shape) this.hovering = null
      this.drop(shape)
      shape.unbox()
    }
    if (leaving.size === 0) return
    // One pass over what is held rather than a splice a shape, which is the
    // same walk again for every one of them
    let kept = 0
    for (const shape of this.shapes) if (!leaving.has(shape)) this.shapes[kept++] = shape
    this.shapes.length = kept
    this.floorStale = true
    this.seat()
  }

  /** Takes every shape off. */
  clear(): void {
    for (const shape of this.shapes) {
      shape.held(null)
      shape.unbox()
    }
    this.shapes.length = 0
    this.waiting.clear()
    this.cost.clear()
    // As `remove` does, and for the same reason: the floor is the lowest of
    // what is held, and what is held has just become nothing. Left unsaid, an
    // emptied group keeps the floor of the shapes it no longer has, and the
    // next one laid on it is measured against a height nothing stands at.
    this.floorStale = true
    this.strip()
  }

  /** @internal A shape it holds was changed and wants building again. */
  redraw(shape: Shape): void {
    this.waiting.add(shape)
    this.urgent = true
  }

  /**
   * @internal A shape it holds was given another look — a colour, a width, a
   * part turned on or off, a word about how it is stuck — or the palette
   * turned over under a colour it said twice. So whatever was cut for the old
   * look goes: the boxes with it baked into their corners, and an area's loop
   * lines, which were made from it.
   *
   * Which way they go is the group's to say, because it turns on whether a
   * mesh is still drawn from them. Drawn: the shape lets go of them and
   * {@link drop} disposes them at the next cut, where they no longer answer to
   * {@link Shape.holdsBox}. Not drawn — hidden, where {@link cut} returns
   * before it asks for a box, or let go of by {@link strip} on detach — no cut
   * is coming to dispose anything, so they are handed back here and now rather
   * than left claimed with nothing pointing at them.
   *
   * Every word a page can write on a live shape comes this way but `visible`
   * and `pickable`, which change what is drawn from the cut and not the cut.
   * The cost is the shape being cut again, which is what a colour has always
   * cost. What rides on the corners weaves nothing. What picks a material —
   * `glows`, `behind`, `billboard`, `paints`, and a `height` that takes a painted
   * shape off the land or lays it back — weaves one the first time this group
   * is asked for it (`ShapeMaterials` makes them on demand and keeps them), so
   * the first such write on a live map can cost a shader; every one after
   * finds it kept. One material, not the group's all (contract 12, rule 7).
   */
  restyled(shape: Shape): void {
    if (!this.drawn.has(shape)) shape.unbox()
    shape.forget()
    this.redraw(shape)
  }

  // ── Under the pointer ─────────────────────────────────────

  listens(type: 'click' | 'hover' | 'pointing'): boolean {
    if (type === 'pointing') return false
    return this.shapes.some((shape) => shape.listens(type))
  }

  clicked(hit: Hit): void {
    this.shapeFor(hit)?.clicked(hit)
  }

  /**
   * Hands the hover to the shape under the pointer, and tells the one it just
   * left; see {@link SolidLayer.hovered} for why the one before is kept.
   */
  hovered(hit: Hit | null): void {
    const onto = hit ? this.shapeFor(hit) : null
    if (onto === this.hovering) return
    this.hovering?.hovered(null)
    this.hovering = onto
    if (onto && hit) onto.hovered(hit)
  }

  /**
   * Which shape's paint covers what the pointer found, or null where none
   * does; see {@link Layer.covers}.
   *
   * Only the shapes painted onto the picture are asked, because only they are
   * somewhere other than where the pointer looked: the colour lands on the
   * pixels the land and the city were drawn in, so the pointer finds *them*
   * and this says who was painted over them. What is drawn at a place of its
   * own needs none of it — it stands in the picture at a depth of its own and
   * the pointer finds it there.
   *
   * The last painted is asked first, since nothing here writes depth and the
   * order the shapes were painted in is the whole of what decides which shows
   * on top (see the class doc). So the shape a reader sees is the shape that
   * answers.
   *
   * A shape a page has told the pointer to pass through is passed over here
   * too ({@link ShapeBase.pickable}), which is the one line both ways of
   * finding a shape are drawn on.
   */
  covers(hit: Hit, on: PaintedKind): number | null {
    // A group turned off as a whole paints nothing, so it covers nothing. The
    // viewer asks every layer that can answer, hidden or not, and three only
    // leaves a hidden root out of the pixel the pointer reads — which finds the
    // shapes drawn at a place of their own and not the paint, whose pixels are
    // the land's. `GeoJsonLayer.visible` and `VectorTileLayer.visible` both
    // come down to this root.
    if (!this.root.visible) return null
    const perPixel = this.worldPerPixel()
    for (let at = this.shapes.length - 1; at >= 0; at--) {
      const shape = this.shapes[at]!
      // Every word read in this walk is one a page said, and not one of them
      // is about what has been drawn. A group drops what it had drawn and cuts
      // it again over the following frames — on a restyle, and whenever the
      // land moves — so a shape asked for a mesh during that window would say
      // the pointer had left it and come back. A page that restyles on the
      // hover then never settles: it is told the pointer is on a ward, cuts
      // afresh for it, is told the pointer is on nothing, cuts back. Measured
      // on `wards`, where every crossing came out as a pair — `hover 13101`,
      // `hover null` — and the ward lit for a frame and went out. Where the
      // paint falls is answered by the corners, cut or not.
      if (!shape.visible || !shape.classified) continue
      // Classified says it has one; the type does not carry that across.
      const paints = shape.paints ?? 'all'
      if (!shape.pickable || !paintsOn(paints, on)) continue
      if (shape.covers(hit.point.x, hit.point.z, perPixel)) return at
    }
    return null
  }

  /**
   * @internal Which shape the pointer found, by whichever of the two ways it
   * was found: the mesh it is drawn as, or — where it is paint on the picture
   * and the mesh belongs to whatever the paint landed on — the number
   * {@link covers} gave back, which the viewer carries in the hit's item.
   *
   * One or the other and never both: the viewer hands a hit to this layer only
   * where this layer drew what was found, or where this layer claimed it.
   */
  shapeFor(hit: Hit): Shape | null {
    return this.whose.get(hit.object) ?? this.shapes[hit.item] ?? null
  }

  /**
   * What one pixel of the page is worth in world units, for the width of a
   * painted line; see {@link Viewer.worldPerPixel}.
   *
   * The same number the paint works out for itself as it pushes a line's
   * corners apart (`shapes/paint.ts`), which it has to do from the projection
   * matrix because a shader cannot read a getter. Nought with no viewer: a
   * group off the map covers nothing.
   */
  private worldPerPixel(): number {
    const viewer = this.viewer
    return viewer ? viewer.worldPerPixel : 0
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.paint.readLandOf(viewer.underground)
    this.paint.setMask(this._masked ? viewer.maskArea : null)
    this.paint.fadeInto(viewer.colors.backdrop)
    this.dirty = true
    this.urgent = true
  }

  detach(): void {
    this.viewer = null
    this.strip()
  }

  /**
   * Shapes answer three of the seven words; see {@link Change}. The view is
   * not one of them — a shape stands where the page put it, whatever is on
   * screen.
   */
  changed(what: Change): void {
    switch (what) {
      case 'colors': {
        const viewer = this.viewer
        if (!viewer) return
        // The hem and the faint half both go over to the backdrop, and both
        // read it as they draw.
        this.paint.fadeInto(viewer.colors.backdrop)
        // And a colour said twice is the other of its two now, which is on
        // the corners of whatever was cut for it. Asked of the viewer rather
        // than worked out from the sun, since the viewer's answer is the one
        // the palette was turned over on. Told on every change of the
        // palette and on being added, so the shapes are cut again only where
        // the set they were cut for is not the one standing — once at dusk
        // and once at dawn, and never for a page that never said a pair. Only
        // the shapes holding one: a colour said once is the same either side.
        const night = viewer.night
        if (night === this.night) return
        this.night = night
        for (const shape of this.shapes) if (shape.turnsAtDusk) this.restyled(shape)
        return
      }
      case 'mask':
        // The shape is read where a shape is drawn, not where it is built, so
        // nothing is built again.
        this.paint.setMask(this._masked ? (this.viewer?.maskArea ?? null) : null)
        return
      case 'elevation':
        // The land has risen or gone flat, so every shape is laid on it again.
        //
        // Where a shape lies is baked into what was built, as the ground's own
        // tiles are, so the answer to the land moving is the same one the
        // ground gives: build it again.
        this.dirty = true
        this.urgent = true
        return
    }
  }

  /**
   * The land has to be asked whether it has arrived, and who it arrived under.
   *
   * The heights are fetched by whoever draws the ground rather than here, so
   * they land after the shapes do — and a shape laid on the land as it was
   * first known lies at sea level under a city thirty metres up, which is to
   * say under the ground, which is to say nowhere. What says they have landed
   * is `elevation.ts`'s count of how often the tiles in hand have changed,
   * which is one comparison however many corners a page has painted, and which
   * notices a tile let go of as well as one arriving.
   *
   * The count says that something moved; `heightsChangedSince` says where. A
   * tile is two kilometres across and a page may paint something twenty
   * kilometres across, so most of what is painted did not move — measured over
   * the twenty-three wards of 東京, a tile landing fell under two of the 118
   * filled shapes and brought all 118 round, at 296ms the time. Asking where
   * turns that into the two.
   *
   * Further behind than `elevation.ts` remembers, the answer is that it cannot
   * say, and then everything comes round. That is a zoom's worth of tiles
   * having turned over, by which point little of it has not moved anyway.
   */
  frame(): void {
    const viewer = this.viewer
    if (!viewer) return
    const now = performance.now()
    const land = viewer.elevation ? heightsVersion() : null
    if (land !== this.laidOn) {
      const moved = this.laidOn === null || land === null ? null : heightsChangedSince(this.laidOn)
      // Nothing to compare against where the land has just been turned on or
      // off: what changed is every corner of every shape, not a patch of it
      if (!moved) this.dirty = true
      else
        for (const rect of moved)
          for (const shape of this.shapes) {
            // A classified area carries none of the land in it, so no tile of
            // heights can stale it. That is the whole of what this buys.
            if (shape.classified) continue
            if (meets(shape.where, rect)) this.waiting.add(shape)
          }
      if (this.waiting.size > 0 && this.staleSince === 0) this.staleSince = now
      this.landMovedAt = now
      this.laidOn = land
      this.floorStale = true
    }
    if (this.dirty) {
      this.dirty = false
      for (const shape of this.shapes) this.waiting.add(shape)
      if (this.staleSince === 0) this.staleSince = now
    }
    // The boxes stand between the land and the eye. The ceiling is held under
    // the camera's own height: the camera here is orthographic and set with a
    // near plane thousands of metres behind itself, so nothing of the city is
    // ever clipped by it — but a box whose ceiling rose past the camera would
    // be, and a box cut open counts wrong.
    if (this.floorStale) {
      this.floorStale = false
      this.lowest = this.lowestUnder(viewer)
    }
    const stretch = metersPerUnit(viewer.camera.center[1])
    this.paint.standBetween(
      Math.min(this.lowest, viewer.landHeight * stretch),
      viewer.threeCamera.position.y * stretch,
    )
    if (this.waiting.size === 0) {
      this.staleSince = 0
      return
    }
    if (!this.urgent && !this.ripe(now)) return
    // Made for this pass and thrown away, as it is meant to be: it remembers
    // the tile it last read, and the corners of one shape walk across a tile in
    // a long run. Nothing to read where the land is drawn flat.
    this.lay(viewer, viewer.elevation ? heightsInHand() : null)
  }

  dispose(): void {
    this.strip()
    // The shapes themselves are the page's and outlive this, so let go of
    // them: one left saying it is held by a group that is gone can never be
    // painted anywhere again. The boxes outlive a laying but not the group —
    // they were cut for it.
    for (const shape of this.shapes) {
      shape.held(null)
      shape.unbox()
    }
    this.shapes.length = 0
    this.waiting.clear()
    this.cost.clear()
    this.paint.dispose()
  }

  /**
   * Cuts as many of the waiting shapes as this frame has room for, in the
   * order they were painted.
   *
   * One of them whatever the frame has left, so that something is always
   * finished and a page whose every shape is dear still gets there. After
   * that, a shape is begun only where the frame has room for what it took
   * last time — a frame cannot be undone once a cut has been started, and the
   * widest ward measured took 23.8ms by itself, so the only way to hold a
   * frame is to not begin one that will not fit.
   */
  private lay(viewer: Viewer, land: Heights | null): void {
    // One of them whatever the frame has left, so that something is always
    // finished; after that, only what there is room for. A shape that will not
    // fit is passed over rather than stopping the walk, since the ones behind
    // it may be the piers and the islets and those fit in anything.
    let spent = false
    for (const shape of this.shapes) {
      if (!this.waiting.has(shape)) continue
      // The worse of what it cost last time and what a corner is costing now.
      // Its own last figure goes stale upwards: the finer the land under it
      // comes to be known, the more finely it is cut, so a shape that took
      // 5ms over a coarse reading takes 24ms over the reading that replaces
      // it — and a frame begun on the old figure overruns by the difference.
      const mine = this.cost.get(shape) ?? 0
      const rate = this.perCorner * shape.corners
      if (spent && viewer.frameLeft < Math.max(mine, rate)) continue
      if (spent && viewer.frameLeft <= 0) break
      const at = performance.now()
      this.waiting.delete(shape)
      this.cut(shape, land)
      const took = performance.now() - at
      this.cost.set(shape, took)
      // Leant on the last few rather than kept as a true mean: what a corner
      // costs moves with how finely the land under it has come to be known.
      if (shape.corners > 0) {
        const rate = took / shape.corners
        this.perCorner = this.perCorner === 0 ? rate : this.perCorner * 0.75 + rate * 0.25
      }
      spent = true
    }
    if (this.waiting.size === 0) {
      this.urgent = false
      this.staleSince = 0
    }
    this.seat()
  }

  /**
   * The lowest ground any of these shapes lies on, in metres above the sea, or
   * nought where the land is drawn flat.
   *
   * What the boxes' floor is held under. The reading at the middle of the view
   * cannot answer for it: a page centred on a hillside with a shape painted in
   * the valley puts the floor above the ground that shape has to be straddled
   * against, and a box floating clear of its own ground counts nought
   * everywhere — the fill simply does not appear, and where a tower's roof
   * does fall inside the box the colour lands on the tower instead.
   *
   * Read at the middle and the four corners of each shape's own rectangle.
   * Five readings cannot speak for a hillside, and they do not have to:
   * {@link UNDER_THE_LAND} is the room left over for what they missed.
   *
   * Worked out when the shapes change or when a tile of heights lands, and
   * kept between. A page of a hundred shapes would otherwise pay five hundred
   * readings a frame for a number that only moves when one of those two does.
   */
  private lowestUnder(viewer: Viewer): number {
    if (!viewer.elevation) return 0
    const land = heightsInHand()
    let low = Infinity
    for (const shape of this.shapes) {
      const { minX, maxX, minY, maxY } = shape.where
      const midX = (minX + maxX) / 2
      const midY = (minY + maxY) / 2
      for (const [x, y] of [
        [midX, midY],
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [maxX, maxY],
      ] as const) {
        low = Math.min(low, land.at(x, y))
      }
    }
    return low === Infinity ? 0 : low
  }

  /**
   * Whether the land has stood still long enough to be worth cutting to.
   *
   * A zoom fetches tiles for as long as it lasts, and each one that lands
   * moves the reading under whatever it covers — at the zoom a city is looked
   * at from, one elevation tile is twenty kilometres across and covers the
   * whole of what a page has painted. Cutting to each of them in turn is
   * cutting to a reading that is about to be replaced: measured over the
   * twenty-three wards of 東京, it was a cut of 20 to 40ms in every frame of
   * the zoom, where waiting costs one catch-up at the end of it.
   *
   * With a ceiling, because the tiles do not always stop: a long drag across
   * the city keeps them coming, and shapes lying on land that has moved on
   * are shapes in the wrong place. Past {@link WAITS_AT_MOST} they are cut
   * whatever is still arriving.
   */
  private ripe(now: number): boolean {
    return now - this.landMovedAt >= SETTLES_AFTER || now - this.staleSince >= WAITS_AT_MOST
  }

  /** Cuts one shape and the loops round it, letting go of whatever it was drawn as before. */
  private cut(shape: Shape, land: Heights | null): void {
    this.drop(shape)
    if (!shape.visible) return
    // The shape's own word, and the loops round it take it too: a loop is
    // drawn for the shape and a click on one is a click on the shape, so the
    // two cannot differ about whether the pointer finds them.
    const found = shape.pickable
    const own: Object3D[] = []
    this.cutInto(shape, land, own, found)
    // Kept apart from the fill rather than pushed on after it, because where a
    // line goes into the scene is not settled shape by shape; see {@link seat}.
    const lines: Object3D[] = []
    for (const line of shape.outlines) this.cutInto(line, land, lines, found)
    if (own.length === 0 && lines.length === 0) return
    this.drawn.set(shape, { own, lines, found })
    // Which mesh belongs to which shape, so that the pointer finding one of
    // them finds the shape and not the loop it happened to land on
    for (const mesh of own) this.whose.set(mesh, shape)
    for (const mesh of lines) this.whose.set(mesh, shape)
  }

  /**
   * Cuts one piece of a shape — its fill, its line, a circle, or a line round
   * an area — into `into`.
   *
   * What is cut reads the set standing as this group last heard it, which is
   * the set the colours on its corners are for; see {@link night}.
   */
  private cutInto(shape: Shape, land: Heights | null, into: Object3D[], found: boolean): void {
    if (shape.classified) {
      // Classified says it has one; the type does not carry that across.
      const paints = shape.paints ?? 'all'
      // One box a colour, each counted and painted before the next, so the
      // ring round a painted circle lands over its inside.
      for (const box of shape.volumes(this.night)) {
        // A line's curtain and a circle's columns stand at their points and
        // are pushed out in pixels; an area's box stands where its corners
        // say. Read off the box rather than the kind, since the push is what
        // the paint has to know about and the box is what carries it.
        const pushed = box.hasAttribute(VOLUME_OFFSET)
        // Never culled: a corner of the box carries where it stands on the map
        // and which of the two heights it belongs to, and its y is put on in the
        // shader — so the ball three works out from the corners is a flat one on
        // the sea, and anything judged against it would be dropped.
        // None of the three is ever found by the pointer, pickable or not:
        // the box stands between the land and the eye and what it counts lands
        // on the ground far below its ceiling. {@link covers} answers for these.
        into.push(
          painted(box, this.paint.count(FrontSide, paints, pushed), false, false),
          painted(box, this.paint.count(BackSide, paints, pushed), false, false),
          painted(box, this.paint.classify(pushed), false, false),
        )
      }
      return
    }
    const geometry = shape.build(land, this.night)
    if (!geometry) return
    // A dimmed shape goes into both halves: the one that draws what nothing
    // hides, and the one that draws the rest through whatever does. One
    // geometry between the two, since only the paint differs.
    for (const draws of DRAWN_BY[shape.behind ?? this._behind]) {
      into.push(painted(geometry, shape.paintedWith(this.paint, draws), shape.culled, found))
    }
  }

  /** Lets go of what one shape was drawn as. Its paint outlives it and is left alone. */
  private drop(shape: Shape): void {
    const drawn = this.drawn.get(shape)
    if (!drawn) return
    this.drawn.delete(shape)
    const meshes = [...drawn.own, ...drawn.lines]
    for (const mesh of meshes) this.whose.delete(mesh)
    // A shape drawn in more than one pass is several meshes of one geometry, so
    // each is let go of once — and an outlined area is more than one geometry,
    // its fill and a line apiece. What is kept is the boxes over a classified
    // piece, which nothing about the land can stale: the shape holds its own,
    // and each loop holds the curtain cut for it. A box the shape has stopped
    // claiming — let go of by {@link restyled} for a look it no longer has —
    // is disposed here like the rest.
    const seen = new Set<BufferGeometry>()
    for (const mesh of meshes) {
      const geometry = (mesh as { geometry?: BufferGeometry }).geometry
      if (!geometry || seen.has(geometry)) continue
      seen.add(geometry)
      if (shape.holdsBox(geometry)) continue
      if (shape.outlines.some((line) => line.holdsBox(geometry))) continue
      geometry.dispose()
    }
  }

  /**
   * Puts what is drawn into the scene in the order the shapes were painted.
   *
   * Written out afresh rather than added to, because a shape cut again would
   * otherwise go to the back of the group and be drawn over the outlines of
   * everything painted after it. Nothing here writes depth, so that order is
   * the whole of what decides which shows on top; see the class doc.
   *
   * Every loop after every fill, and not each loop after the fill it loops. Two
   * plots that share an edge would otherwise have the second one's wash laid
   * over the first one's loop, and a page reading the map would see one plot
   * outlined and its neighbour not. `GeoJsonLayer` worked this out for itself —
   * it draws every fill it read before any of its lines — and this is that
   * same answer, given once for every page that outlines what it paints.
   *
   * A circle's ring is not one of these loops. It is drawn with its circle,
   * since a point is one mark (`shapes/disc.ts`): two that overlap have the
   * second one over the first, ring and all, as Mapbox and deck.gl draw them.
   */
  private seat(): void {
    this.root.clear()
    for (const geometry of this.joined) geometry.dispose()
    this.joined.length = 0
    // Written on each mesh and not left to where it sits in the group. The
    // renderer sorts, and nothing here writes depth, so two of these are at
    // one distance and the sorter would break the tie by the centre of a
    // bounding sphere — which is not an answer about which was painted first.
    // The stage comes off the root; this is the order inside this layer, and
    // it starts at nought again in the next one — so a page wanting an order
    // between two of these on one stage puts the shapes in one of them. See
    // `order.ts`.
    let order = 0
    const put = (mesh: Object3D): void => {
      mesh.renderOrder = order++
      this.root.add(mesh)
    }
    this.run((drawn) => drawn.own, put)
    this.run((drawn) => drawn.lines, put)
  }

  /**
   * Walks the shapes in order, joining the runs that can be drawn as one.
   *
   * A mesh apiece is a word to the card apiece, and a tileset puts thousands
   * of shapes in here — measured over 中野, 2,530 of them from one view of the
   * GSI's own tiles. Joined, that view is a handful.
   *
   * **Runs rather than kinds.** Every shape sharing a material could be
   * gathered into one mesh, and that would join more; it would also move them,
   * since what shows on top here is the order they were painted and nothing
   * else. So only neighbours are joined, and the order is exactly what it was.
   * Tiles make long runs by themselves — a tileset's roads arrive together —
   * so little is lost.
   *
   * **A shape is still found by the pointer.** The joined mesh writes each
   * corner's shape number under {@link PICKED_ITEM}, and the pointer hands
   * that back as `hit.item`; {@link shapeFor} reads it where the mesh is not
   * one shape's own. The same answer `AnnotationLayer` gives for its marks and
   * PLATEAU's tiles give for their buildings.
   *
   * **And a shape the pointer may not find stays unfound.** Whether it may is
   * a word on the mesh (`notPicked`), not on the material, so two shapes drawn
   * in the same paint can still differ about it — and a joined mesh is one
   * answer for every shape poured into it. So a run breaks where that answer
   * turns, and {@link join} gives the joined mesh the run's answer. Left to the
   * materials alone, two neighbouring points a file styled `pickable: false`
   * would be poured into a mesh the pointer finds,
   * and the click on the land under them would go to the points (contract 6).
   * Read off the code; not measured on screen.
   */
  private run(of: (drawn: Drawn) => readonly Object3D[], put: (mesh: Object3D) => void): void {
    let waiting: { at: number; meshes: readonly Object3D[]; found: boolean }[] = []
    const flush = (): void => {
      if (waiting.length === 0) return
      if (waiting.length === 1) for (const mesh of waiting[0]!.meshes) put(mesh)
      else for (const mesh of this.join(waiting)) put(mesh)
      waiting = []
    }

    for (let at = 0; at < this.shapes.length; at++) {
      const shape = this.shapes[at]
      if (!shape) continue
      const drawn = this.drawn.get(shape)
      if (!drawn) continue
      const meshes = of(drawn)
      if (meshes.length === 0) continue
      // A painted shape stands alone. Its box is a column from under the land
      // to just below the eye, so two of them overlap on screen wherever the
      // view is tilted at all — and poured into one geometry the count they
      // leave is shared and the colour comes from whichever back face happens
      // to rasterise last. Measured on `wards`: three wards came out one
      // colour over the whole screen.
      if (shape.classified) {
        flush()
        for (const mesh of meshes) put(mesh)
        continue
      }
      const last = waiting[waiting.length - 1]
      if (last && (last.found !== drawn.found || !alike(last.meshes, meshes))) flush()
      waiting.push({ at, meshes, found: drawn.found })
    }
    flush()
  }

  /**
   * One run of shapes as one set of meshes.
   *
   * Their materials match by the test above, so the pattern of the first is
   * the pattern of all: for every place in it, the geometries at that place
   * are poured into one. A dimmed shape's two halves share one geometry, so
   * the places that held the same geometry hold the same joined one — poured
   * once and handed to both, as it was before.
   *
   * Every shape in a run said one thing about the pointer (see {@link run}),
   * so the first one's answer is the run's.
   */
  private join(run: readonly { at: number; meshes: readonly Object3D[]; found: boolean }[]): Object3D[] {
    const first = run[0]!.meshes
    const found = run[0]!.found
    const made: Object3D[] = []
    const already = new Map<BufferGeometry, BufferGeometry>()
    for (let place = 0; place < first.length; place++) {
      const head = first[place] as Mesh
      const was = head.geometry
      let joined = already.get(was)
      if (!joined) {
        joined = pourInto(run.map((one) => ({ at: one.at, mesh: one.meshes[place] as Mesh })))
        already.set(was, joined)
        this.joined.push(joined)
      }
      const mesh = new Mesh(joined, head.material)
      mesh.frustumCulled = head.frustumCulled
      mesh.receiveShadow = head.receiveShadow
      mesh.layers.mask = head.layers.mask
      // A new mesh, so the word `painted` put on the ones it was poured from is
      // not on it; said again here, or the run is found whatever it said
      if (!found) notPicked(mesh)
      // Nor is what `painted` told three's `Raycaster`, so that is said again too
      answersNoRays(mesh)
      made.push(mesh)
    }
    return made
  }

  /** Lets go of every mesh built, keeping the paint, which outlives them. */
  private strip(): void {
    for (const shape of [...this.drawn.keys()]) this.drop(shape)
    this.root.clear()
    this.whose.clear()
    for (const geometry of this.joined) geometry.dispose()
    this.joined.length = 0
    // Nothing of it is on the screen, so nothing of it is under the pointer.
    // The shape is not told it was left: what left is the drawing, and a page
    // taking its own map down is not waiting to hear that the pointer is off it.
    this.hovering = null
  }
}

/**
 * How long the tiles in hand must stand still before what is laid on them is
 * cut again, in milliseconds.
 *
 * Long enough to cover the gap between two tiles of one zoom landing, short
 * enough that a reader who has stopped does not see the shapes catch up. Tiles
 * of a zoom arrive within a few frames of each other once the first is in.
 */
const SETTLES_AFTER = 120

/** How long shapes may lie on land that has moved on, however busy the tiles are. */
const WAITS_AT_MOST = 1000

/**
 * Whether a place falls in a rectangle of the world, or within `slack` of it.
 *
 * `slack` is for what a line's width adds: the rectangle round a shape is its
 * corners alone, and a line is drawn a few pixels either side of them.
 *
 * North is where the world's z is least and where Mercator's y is most, so the
 * one is asked for as the other's negative; see {@link walkOf}.
 */
function inBox(box: WorldBounds, x: number, z: number, slack: number): boolean {
  const y = -z
  return x >= box.minX - slack && x <= box.maxX + slack && y >= box.minY - slack && y <= box.maxY + slack
}

/** Whether two rectangles of the world touch at all. */
function meets(a: WorldBounds, b: WorldBounds): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY
}

/** The rectangle round a set of loops or runs, in world units. Heights are not in it. */
function boxRound(loops: readonly (readonly PolylinePoint[])[]): WorldBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of loops) {
    for (const [lon, lat] of loop) {
      const x = lonToX(lon)
      const y = latToY(lat)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Where a line runs, in the world's own units, laid on the land.
 *
 * The height a corner stands at is the land's under it, plus whatever the
 * corner carries of its own, plus whatever the page lifted the whole line by,
 * and nothing else —
 * all in metres, and all brought into world units by Mercator's stretch at
 * that corner's own latitude, which is read a corner at a time since a line
 * may run further north and south than a building does.
 */
function walkOf(path: Polyline, land: Heights | null): Float32Array {
  const corners = path.points.map(([lon, lat]) => ({ x: lonToX(lon), z: -latToY(lat) }))
  // North is where the world's z is least, which is where Mercator's y is
  // most, so the one is asked for as the other's negative.
  const metresAt = (x: number, z: number): number => land?.at(x, -z) ?? 0

  // A line is a run of straight pieces and the land under it is not, so a
  // piece long enough cuts through whatever rises between its ends — and only
  // then. Nothing is cut where the land is drawn flat: there is nothing
  // between two corners to follow.
  // Nothing is cut for a line in the air either, and there the reason is the
  // other way round: what runs between two of its corners is air, and a hill
  // it passes over is not something for it to bend around. Which also keeps
  // this run one corner to a point, so a corner's own height is still the
  // corner's when it is written on below.
  const run =
    path.aloft || !land
      ? corners.map(({ x, z }) => ({ x, z, up: metresAt(x, z) }))
      : cutRunToLand(corners, metresAt, SAGS)

  const out = new Float32Array(run.length * 3)
  for (let at = 0; at < run.length; at++) {
    const { x, z, up } = run[at]!
    // Nothing added. A line used to be stood a metre over the land so that it
    // would not be swallowed by it, and that put it a metre from where the
    // page said — wrong for anything measured off it, and enough to part two
    // lines the page put at one height. Being swallowed is a question about
    // depth, so it is answered in depth; see `pressToLand`
    const stands = path.points[at]?.[2] ?? 0
    out[at * 3] = x
    out[at * 3 + 1] = (up + stands + path.height) / metersPerUnit(yToLat(-z))
    out[at * 3 + 2] = z
  }
  return out
}

/**
 * Whether two shapes were drawn the same way, so that they may be poured into
 * one mesh.
 *
 * The materials, in order. Most of what a mesh says besides its material —
 * whether it is culled, which layer it draws on, whether it takes a shadow —
 * follows from the material it was given, so two that match here match there
 * too; see `painted`. The one thing that does not is whether the pointer may
 * find it, which is the shape's own word and not the paint's: two shapes in
 * one material may say it differently, so {@link ShapeLayer.run} asks it
 * beside this.
 */
function alike(a: readonly Object3D[], b: readonly Object3D[]): boolean {
  if (a.length !== b.length) return false
  for (let at = 0; at < a.length; at++) {
    if ((a[at] as Mesh).material !== (b[at] as Mesh).material) return false
  }
  return true
}

/**
 * Many geometries as one, with each corner saying which shape it came from.
 *
 * Every attribute of the first is poured, so whatever a kind carries comes
 * along — a fill's `paint`, a ribbon's offsets, a circle's spots and ring —
 * without this having to know what they are. A painted shape's boxes never get
 * here; see {@link ShapeLayer.run}. An attribute the first has and a later one
 * does not is left at nought there rather than dropped, since dropping it
 * would strand every corner that did have it.
 */
function pourInto(run: readonly { at: number; mesh: Mesh }[]): BufferGeometry {
  const first = run[0]!.mesh.geometry
  let corners = 0
  let indices = 0
  for (const one of run) {
    corners += one.mesh.geometry.getAttribute('position')?.count ?? 0
    indices += one.mesh.geometry.getIndex()?.count ?? 0
  }

  const into = new BufferGeometry()
  for (const name of Object.keys(first.attributes)) {
    const head = first.getAttribute(name)
    const wide = head.itemSize
    const poured = new Float32Array(corners * wide)
    let at = 0
    for (const one of run) {
      const from = one.mesh.geometry.getAttribute(name)
      const held = one.mesh.geometry.getAttribute('position')?.count ?? 0
      if (from) poured.set(from.array as Float32Array, at * wide)
      at += held
    }
    into.setAttribute(name, new BufferAttribute(poured, wide))
  }

  // Which shape each corner is, for the pointer; see {@link ShapeLayer.run}
  const item = new Float32Array(corners)
  let at = 0
  for (const one of run) {
    const held = one.mesh.geometry.getAttribute('position')?.count ?? 0
    item.fill(one.at, at, at + held)
    at += held
  }
  into.setAttribute(PICKED_ITEM, new BufferAttribute(item, 1))

  if (indices > 0) {
    const joined = new Uint32Array(indices)
    let wrote = 0
    let moved = 0
    for (const one of run) {
      const from = one.mesh.geometry.getIndex()
      const held = one.mesh.geometry.getAttribute('position')?.count ?? 0
      if (from) {
        for (let i = 0; i < from.count; i++) joined[wrote++] = (from.array[i] as number) + moved
      }
      moved += held
    }
    into.setIndex(new BufferAttribute(joined, 1))
  }

  // The corners of a ribbon and of a circle move in the shader, so what three
  // works out from them is not what is drawn. Each of these was already left
  // unculled for that reason and the joined one is too; `join` carries the
  // flag over from the mesh it was poured from.
  into.computeBoundingSphere()
  return into
}
