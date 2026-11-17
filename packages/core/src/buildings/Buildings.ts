import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  float,
  materialColor,
  modelWorldMatrix,
  normalLocal,
  positionGeometry,
  positionLocal,
  vec4,
} from 'three/tsl'
import { uniform } from '../repaint.js'
import {
  BufferAttribute,
  Color,
  Group,
  LoaderUtils,
  LoadingManager,
  Matrix3,
  Matrix4,
  Mesh,
  Vector3,
  type ColorRepresentation,
  type Node,
  type Object3D,
} from 'three/webgpu'
import { LIGHT, colorFor, type ThemeColor } from '../theme.js'
import { FINEST_HEIGHTS, heightsInHand, heightsUnder, positionFromWorld, type Heights } from '../elevation.js'
import { solid, type SolidMaterial } from '../lit.js'
import { beforeTheCurve } from '../tone.js'
import { GSI_CREDIT, PLATEAU_CREDIT, type Credit } from '../credits.js'
import { Events, type Anchor, type Hit, type LoadFailure, type Position } from '../events.js'
import { geodeticOf, orientationAt } from '../geo/ecef.js'
import { latToY, lonToX, metersPerUnit, xToLon, yToLat, type WorldBounds } from '../geo/mercator.js'
import { drop, TileSet } from '../tileSet.js'
import { boundsRound, type MaskArea, type MaskShape, maskBoxesIn, MaskShader, maskTouches } from '../mask.js'
import { marksSolid } from '../classify.js'
import { inStage } from '../order.js'
import { drawsOutline } from '../outlines.js'
import { citiesIn, type PlateauCity } from '../plateau/cities.js'
import { transient, Unreadable } from '../transient.js'
import {
  ASK_AGAIN_AFTER,
  ASK_FAILED,
  tilesetFailure,
  buildingTileset,
  tilesetInHand,
  worldBoundsOf,
  type BuildingLod,
  type BuildingTile,
} from '../plateau/tileset.js'
import { BATCH_ID, BUILDING_HEIGHTS, BUILDING_SLOTS, copyAhead } from './attributes.js'
import { answersRays } from './casting.js'
import { HiddenBuildings, type BuildingRule } from './hidden.js'
import {
  deeper,
  hang,
  leaveOne,
  namingOne,
  samePlace,
  standsAt,
  tileHolds,
  type BuildingPlace,
  type BuildingWanted,
} from './named.js'
import { feetOf, feetOn, footOf, stoodOf, type Foot, type FootBox } from './foot.js'
import { groundUnder, letDown } from './hem.js'
import { hemBelow, hemOf, layUnderfoot, standAgain, standOn } from './underfoot.js'
import { BuildingMotions } from './motions.js'
import { facingMoved, placeMoved } from './slots.js'
import { facingAt, offsetOnBuilding, pointAtRest, seatOnAnchor, storeyAt } from './standing.js'
import { APPEAR, appearStagger, appearTakes, doneBy, overGround, stillUnder, turnBack } from '../appear.js'
import type { BuildingKeyframe } from './pose.js'
import { stampAppear } from './rising.js'
import { readB3dm } from './b3dm.js'
import { readGltfTile } from './gltfTile.js'
import { BUILDING_FACTS, isGltf, type BuildingAttributes, type BuildingFacts } from './tileContent.js'
import { pixels, positiveMetres } from './lengths.js'
import { cityMinZoomOf, cityStands, DEFAULT_CITY_MIN_ZOOM } from './zooms.js'
import { Parapet, parapetSize, type ParapetOptions, type RoofTally } from './parapets.js'
import { carve, carveMesh, roofTallyOf } from './recut.js'
import { WallsNearby } from './neighbours.js'
import { Crowds, shapeOf, type CrowdKeyframe, type CrowdOptions } from './crowd.js'
import { roadsUnder } from './roads.js'
import { planningRoofs, type RoofPlan } from './roofPlan.js'
import type { Steps } from './steps.js'
import { SHAPE_FOR } from '../shaping.js'
import { planWalls, type Wall } from './wallPlan.js'
import { WindowPaint } from './windowPaint.js'
import { BuildingStyles, notHidden, type BuildingStyle, type SharedStyle } from './styles.js'
import { ReplicaBuilding } from './replica.js'
import type { DecalImage } from './decals.js'
import { LIBRARY_WINDOW_COLOURS, windowColour, type BuildingUsage } from './windowStyle.js'
import { Windows, type WindowsOptions } from './windowSettings.js'
import { fittingWindows, type WindowTally } from './windows.js'
import { DEFAULT_EDGE_WIDTH, Edges } from './edges.js'
import type { Animation, Timing } from '../motion/motion.js'
import { DRACO_PATH, decoderFrom } from '../draco.js'
import type { BuildingSeat } from '../onBuildings.js'
import type { Change, Layer, Viewer } from '../Viewer.js'
import { ASK_PLAINLY, addressThrough, type Ask } from '../requests.js'
import { setOccludes } from '../passes.js'

// The windows' own part lives in a file of its own, and is said from here as
// well so that whoever reaches for the layer finds its parts beside it.
export { Windows, type WindowsOptions } from './windowSettings.js'

/** Where a mesh keeps how its walls took to the windows. */
const WINDOW_FITTING = 'plateauWindowFitting'

/** Where a mesh keeps which of its buildings the mask's edge runs through. */
const ON_THE_LINE = 'plateauOnTheLine'

/** Where a tile keeps how high its tallest building reaches, in metres. */
const STANDS_TO = 'plateauStandsTo'

/**
 * Where a mesh says it was cut down to one building and hung on its own — a
 * building a page brought, or a city building a page moved — rather than
 * being a tile of the city.
 *
 * A moved city building keeps its name, so two meshes carry it: the one on
 * its own and the tile it came in. Everything that looks a building up by
 * name asks this to know which is meant; see {@link Buildings.movedOutOf}.
 */
const STOOD_ALONE = 'plateauStoodAlone'

/**
 * How many building tiles may be on their way at once.
 *
 * A leaf runs from half a megabyte to five, and a screenful is a dozen of
 * them. Asked for together they share the line a dozen ways and all land at
 * the end of it, so the city arrives in one late lump; a few at a time, in
 * the order they were wanted, the middle of the screen stands while the
 * edges are still coming. Six keeps the line full without spreading it so
 * thin that nothing finishes.
 */
const TILES_AT_ONCE = 6

/**
 * How many tiles of buildings a shape standing on the map may ask for before
 * it is worth saying so out loud.
 *
 * A tile of central 東京 measured 2.5MB of geometry, so two hundred is half a
 * gigabyte held for as long as the mask is. Not refused — a page asking for a
 * district is right to get a district — but said once, with the number, since
 * the only other sign is a page that never finishes.
 */
const TILES_WORTH_SAYING = 200

/**
 * How tall a storey is taken to be where a building does not say how many it
 * has, in metres.
 *
 * The middle of what the buildings that do say work out to: height over
 * storeys comes to 3.5 m in the newer wards and a little more in the older
 * ones, where the ground floor is often a shop.
 */
const STOREY_HEIGHT = 3.5

/**
 * Which buildings a page has the city fetch: every one the view covers, or
 * only the ones the page named itself.
 *
 * Two reasons a building stands here, and this picks between them. `'all'` is
 * both — a page may have the city and stand buildings of its own in it — and
 * `'brought'` is the second alone; see {@link BuildingsOptions.load}.
 */
export type BuildingsLoad = 'all' | 'brought'

export interface BuildingsOptions {
  /**
   * The walls. Left out, the viewer's palette — `theme.wall`, or the library's.
   *
   * Given, it holds through a change of palette: a page that asked for a navy
   * city meant navy, not navy until the sun goes down. A {@link ThemeColor}
   * pair is the way to say a colour for each palette.
   *
   * The same names, and the same kinds, as the properties of the running layer
   * ({@link Buildings.wallColor} and the rest), so a page that wrote one can
   * change it later by the name it already wrote (CLAUDE.md, contract 12,
   * rule 2).
   */
  wallColor?: ThemeColor
  /**
   * The roofs: the faces that look up, which is everything within 45° of the
   * sky. Left out, they are the colour the walls are.
   */
  roofColor?: ThemeColor
  /**
   * Whether the city carries its own light rather than taking the sun's.
   * Defaults to `false`; see {@link Buildings.glows}.
   */
  glows?: boolean
  /**
   * Whether the city throws the sun's shadows — three's word, as a solid and
   * a model have it. On by default. Off, for a page whose own towers stand in
   * a city it wants to say nothing about. A property afterwards.
   *
   * The whole city or none of it: a tile is one mesh, so one building cannot
   * be told apart from its neighbours here.
   */
  castShadow?: boolean
  /**
   * Whether the city takes part in the shading of corners, as `occludes` on
   * a solid and a model: off, it neither darkens the corners round it nor is
   * darkened by them. On by default. A property afterwards.
   */
  occludes?: boolean
  /**
   * Draw a line along every edge where a building folds: the rim of a roof,
   * the corner where two walls turn, the foot of a wall. Defaults to `false`.
   */
  edges?: boolean
  /** The colour of those lines. Left out, the palette's `edge`. */
  edgeColor?: ThemeColor
  /** How wide those lines are drawn, in pixels of the page. Defaults to 1. */
  edgeWidth?: number
  /**
   * How tall a storey is taken to be where a building does not say how many
   * it has, in metres. Defaults to 3.5.
   *
   * The windows set their rows by it and the bands round a storey count their
   * storeys by it, so it is the layer's and not the windows'.
   */
  storeyHeight?: number
  /** The windows set into the walls; see {@link Windows}. Drawn by default. */
  windows?: WindowsOptions
  /** The parapet cut into every flat roof; see {@link Parapet}. Cut by default. */
  parapet?: ParapetOptions
  /**
   * How much detail to ask for. 2 gives the roof shapes a city has surveyed,
   * 1 plain boxes. A city asked for 2 without having it falls back to 1 on its
   * own.
   *
   * The shapes by default, since they are what the survey went and measured.
   *
   * A page that would rather have boxes asks for 1, and there is a reason to:
   * a surveyed roof is a model of a roof rather than a photograph of one, so
   * plant rooms, lift overruns and stair heads come through as stacked blocks
   * that break a top into faces a few metres across, and anything the page
   * stands up there has to find its way among them. A box has one top.
   */
  lod?: BuildingLod
  /**
   * Where to fetch the Draco decoder from. PLATEAU's tiles are Draco
   * compressed, and three fetches the decoder rather than bundling it.
   */
  dracoPath?: string
  /**
   * Whether the city is drawn at all. On by default.
   *
   * Turned off it chooses no tiles and so fetches none; what it already had it
   * keeps, hidden, for being turned back on. A viewer always has one of these,
   * so this is how a page that wants no city says so.
   *
   * It lands on `root.visible`, which three answers, and is kept because the
   * fetching is the half three knows nothing about: the flag is read here as a
   * question and not only obeyed as a drawing.
   */
  visible?: boolean
  /**
   * How close the view must be for the city to stand: the zoom the buildings
   * rise at.
   *
   * 18 by default, which is where the work of shaping a tile stops being paid
   * for by what it shows — a step out asks for five times the tiles, two steps
   * for fifty. It is held at 16, which is as coarse as that count survives;
   * `false` turns the limit off and the city stands at every zoom, which is
   * worth doing only behind a mask small enough to hold what that lets in, or
   * where `load` is `'brought'` and the view decides nothing anyway.
   *
   * It was `ViewerOptions.cityMinZoom` until 2026-10-09, when the ground
   * stopped reading it: its plan is part of the map at any zoom now, and its
   * parks come with the land use they stand on. A threshold one layer reads
   * belongs to that layer.
   */
  minZoom?: number | false
  /**
   * Which buildings are fetched. `'all'` by default.
   *
   * `'all'` takes the view's as well: whatever it covers arrives as it is
   * looked at and leaves as it is looked away from, held back under
   * {@link BuildingsOptions.minZoom} so that a wide view does not ask for half
   * a prefecture.
   *
   * `'brought'` leaves those where they are, and what stands is whatever the
   * page stood itself with {@link Buildings.bring}. A page showing five towers
   * side by side wants that; so does one showing a single house. The two are
   * not exclusive — a page may have the city and stand buildings of its own in
   * it — which is why this is a word of its own rather than something a list
   * of names turns off.
   *
   * Said as fetching and not as showing, which is the one place in here a page
   * is handed that word. What it settles is not a look: nothing is drawn
   * faintly or left out of a picture it was in. The tiles are never asked for.
   * A page told `show` instead would read it as the city standing there
   * unseen, and one that wrote it to tidy a view would find a prefecture on
   * the wire. The mask still says *where* (contract 4); this says whether the
   * view gets to ask at all.
   */
  load?: BuildingsLoad
  /**
   * Buildings to take out of the city from the start; see {@link Buildings.hide}.
   *
   * The same things that method takes, in a list, and the difference is the
   * one a page cares about: **said here, nothing is ever seen to go.** The
   * first tile to land arrives with them already out.
   *
   * Called instead, they sink out of sight the way a city does when a view
   * leaves it, because something was standing and now is not and a reader who
   * was looking at it deserves to be told. A page clearing the plots its own
   * proposal stands on means neither — those houses are not being demolished,
   * they were never part of what this page is about — so it says it here.
   */
  hide?: readonly (string | MaskShape | BuildingRule)[]
}

/**
 * What the tile set is asked to fetch: a patch of the view, or a building a
 * page named and the tilesets to look down for it.
 *
 * A named one is keyed by its own name rather than by a tile's address, since
 * which tile holds it is the thing being looked for — and two buildings that
 * turn out to share a tile are still two of these, each with the rest of that
 * tile thrown away.
 */
interface Fetch {
  readonly key: string
  /** Where it is about: the tile itself, or the tileset a search starts at. */
  readonly tile: BuildingTile
  readonly find?: { readonly wanted: BuildingWanted; readonly roots: readonly BuildingTile[] }
}

/** A building of PLATEAU, as its tile tells of it. */
export interface Building {
  /**
   * What PLATEAU calls it, a gml:id. It stays the same from one tile to the
   * next, so a building picked out can be held on to as tiles come and go.
   */
  readonly id: string
  /**
   * What the survey calls it, or '' where it does not say — which is most of
   * them. The landmarks carry a name; the block of flats next door does not.
   */
  readonly name: string
  /** What it is for, in PLATEAU's own words, or '' where it does not say. */
  readonly usage: string
  /** How many storeys it stands above ground, or 0 where it does not say. */
  readonly storeys: number
  /**
   * Everything else the survey wrote about this one, or null where it wrote
   * nothing readable.
   *
   * The four above are the facts every building has. This is the rest, as the
   * tile publishes it — the publisher's own keys, in their own Japanese,
   * differing by city and by the year the model was made. The one worth
   * knowing about is the water: measured on 鎌倉 2024, a building carries its
   * own assessed flood depth, the band that depth falls in and how long the
   * water stays, one set per river system, plus tsunami, storm surge, inland
   * flooding and the landslide zones it stands in.
   *
   * So a page colouring a town by how deep the water would get over it has
   * nothing to fetch and no picture to read: the buildings came with the
   * answer. What a key means is the publisher's, as a tile set's colours are.
   *
   * Read on asking and held after that, so a page that never asks pays
   * nothing; see {@link BuildingFacts.attributesAt}.
   *
   * @example
   * // Paint the town by the deepest water any river would put over each house
   * buildings.on('click', ({ building }) => {
   *   const said = building.attributes
   *   const deep = Object.entries(said ?? {}).find(([key]) => key.endsWith('_浸水深'))
   *   console.log(deep)
   * })
   */
  readonly attributes: BuildingAttributes | null
  /**
   * How tall its shape stands, in metres: its highest corner over its lowest,
   * as the survey drew it.
   *
   * `tall` rather than `height` because {@link Building.position} carries one
   * of those already, and the two are different kinds of thing — this is the
   * building's own size, that is how high off the ground it stands.
   *
   * They do not add up to the roof. A building's `position.height` is nought
   * and stays nought: `seat` drops every corner so the lowest sits at 0 and
   * the land goes on at the last moment, in the shader, off `plateauUnderfoot`
   * — so what {@link Building.position} reports is the foot of the shape, not
   * where that foot is standing. A reader wanting the roof above sea level
   * asks the land for the height under the foot and adds this to it; see
   * {@link heightsInHand}. (It read the other way here until it was measured.)
   *
   * Not `bldg:measuredHeight`, which is the building without what stands on
   * it. The two differ by the mast, and at 押上 that is 355m against 635m. A
   * page ranking buildings by what they look like wants this one.
   */
  readonly tall: number
  /**
   * The middle of its foot, on the map.
   *
   * Worked out when it is read and not before. Finding a foot is a walk over
   * every corner of the tile's mesh, and most of what asks about a building —
   * what it is called, what it is for, how many storeys — asks nothing about
   * where it is. A rule that only reads `id` pays nothing for this.
   */
  readonly position: Position
  /**
   * The corners of its foot, on the map.
   *
   * What {@link position} cannot say. A building bent round a yard has the
   * middle of its foot out in that yard, and the box round the foot takes the
   * yard in as well — so a page asking about the ground a building stands on
   * asks at these and not at the middle. It is what the library itself judges
   * a building by wherever a shape is drawn round one; see `feetOn`.
   *
   * Every corner is on the building. They are in no order round it: a mesh is
   * triangles, and the line round the foot would have to be put back together
   * from them. A reader wanting the worst of something takes the worst of
   * these; a reader wanting to draw the outline wants a shape nobody here has.
   *
   * Worked out when read, as {@link position} is, and the walk is shared by
   * every building of the same tile.
   */
  readonly corners: readonly Position[]
}

/**
 * How far a face may lean from straight up and still be a roof: 45°.
 *
 * Read off the normal because nothing else says. PLATEAU draws a building as
 * one shape and does not mark which part of it is the top, so a roof is the
 * part that looks at the sky — which is also what a reader means by one.
 */
const ROOF_FACES_UP = Math.SQRT1_2

/**
 * Which face of a building the pointer found: one that stands up, or one that
 * looks up. The survey draws no others worth telling apart — a sloped roof is
 * a roof, and what a page does with either answer is the same.
 */
export type BuildingFace = 'wall' | 'roof'

/**
 * Where the pointer is on a building: which one, where on it, and which way
 * the face it is on looks.
 *
 * What a click gives back, bar the storey, and given again as often as the
 * pointer moves — see {@link BuildingEvents.pointing}.
 */
export interface PointedAt {
  readonly building: Building
  readonly position: Position
  /** The same place held to the building; see {@link BuildingEvents.click}. */
  readonly anchor: AnchorOnBuilding
  readonly face: BuildingFace
  /** Which way that face looks, where it is a wall; see {@link BuildingEvents.click}. */
  readonly facing?: number
}

export interface BuildingEvents {
  /**
   * A tile of buildings, or the catalog that says where they stand, could not
   * be fetched.
   *
   * With nobody listening it goes to the console once instead, rather than
   * vanishing.
   */
  error: LoadFailure
  /**
   * Everything the city was waiting for has arrived, or has failed for good.
   *
   * Told on the turn from fetching to having it all, so a page hears it again
   * every time the view asks for more and gets it. Behind a mask that stands
   * on the map that turn is "every building in the shape is here", which is
   * what a page counting what it found waits for.
   *
   * Later than the listing: a city has to say where its buildings stand
   * before any of them can be asked for, so this waits on the catalog as well
   * as on the tiles.
   *
   * Arrived and not yet standing: what has just landed comes up out of the
   * ground for a moment more (`viewer.appear`), and {@link idle} is told once
   * it is up. _(2026-11-03: this said "is standing", which it never waited for.)_
   */
  loaded: { readonly tiles: number }
  /**
   * The city has come to rest: everything it was waiting for has arrived, and
   * no building is still coming up out of the ground or going back under it.
   *
   * Mapbox's word for a map at rest, said of the city alone — the view may
   * still be moving. Told on the turn into rest, so a page hears it again
   * every time the city comes up somewhere new: after {@link loaded} by as long
   * as the buildings take to come up, or straight after it where they are told
   * to stand at once (`viewer.appear.enabled = false`).
   *
   * What a page waits on to put something on a building that has to be up
   * first. A mark stands where it is put and rides nothing (see
   * `AnnotationPlace.at`), so one put on a building still coming up stands
   * over a roof that is not there yet. A building a page set moving
   * (`animate`, `animateAll`) is the page's own and is not waited on.
   */
  idle: { readonly tiles: number }
  /**
   * The city in hand changed: a tile of buildings is standing that was not,
   * or one has been let go of.
   *
   * For a page that reads the buildings themselves rather than waiting on the
   * ones it named — counting them, asking something of each; see
   * {@link Buildings.each}. A count taken once is wrong a moment later, and
   * the arriving stops without saying so.
   *
   * `tiles` is how many are up now, which is not {@link Buildings.tileCount}:
   * that counts what is in hand, the ones still on their way among them.
   *
   * Named as every fetching layer names it. What changed differs from layer to
   * layer — tiles of city here, answers about places in an {@link ImageTileLayer} —
   * and a page that has to learn a word apiece learns the wrong one.
   */
  changed: { readonly tiles: number }
  /** A building was clicked, and where on it. */
  click: {
    readonly building: Building
    readonly position: Position
    /**
     * The place clicked, held to the building: the way from the middle of its
     * foot to the click, east, north and up as it was surveyed. What a mark
     * that goes with the building is put at (see {@link Anchor}), and it leads
     * back to the click; `position` is the same place as a spot on the map,
     * which stays there.
     */
    readonly anchor: AnchorOnBuilding
    /**
     * Which storey was clicked, counted from 1 as 1階 is — the same way
     * {@link FloorStyle.at} counts.
     *
     * Something to read, and not a way of putting anything there: a thing is
     * put back at the click by `position`, which says the height outright.
     *
     * How many storeys they are divided from is {@link Building.storeys} where
     * the survey says a number the shape can bear, and the building's height
     * over a storey where it does not. The height divided is the building's
     * own, to its highest corner — so where something small stands on the roof
     * the storeys come out a little tall, and a click high up a wall can answer
     * the row below the one a reader is pointing at.
     *
     * A click on the highest part of the building answers the last storey. A
     * wall carried down a slope, below the ground its building was seated on,
     * answers the first.
     */
    readonly storey: number
    /**
     * Which face was clicked: one that stands up, or the roof — which is
     * anything that does not, so the top of a rim round a roof is roof too.
     */
    readonly face: BuildingFace
    /**
     * Which way that face looks, where it is a wall: degrees, 0 north, as
     * {@link Camera.heading} is. Nothing on a roof, which looks up.
     *
     * The bearing in the world, so it goes straight into whatever is turned by
     * one — a panel stood facing out of the wall clicked, the ground a sign
     * there is read from. Something to read, as the storey is: `position` puts
     * a thing back at the click without it.
     *
     * It is the wall's own bearing and not the pointer's line, so two clicks
     * on one wall answer alike.
     */
    readonly facing?: number
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * Where the pointer is on the city, every time the viewer looks under it —
   * which is every time it moves — and null once it is on no building.
   *
   * The other half of {@link hover}, and the one a page wants when it draws
   * something that follows the pointer: a board hanging where a click would
   * put it, say. `hover` answers "which building", and answers once; this
   * answers "where, exactly", and answers while the pointer moves along one
   * wall. Nothing is fetched or drawn again for it — the viewer is looking
   * already, for the cursor and for the click — so a page pays only for what
   * it does with the answer.
   *
   * It comes a frame or two after the pointer, since the look is read back off
   * the card; something that follows it trails by that much.
   */
  pointing: PointedAt | null
  /**
   * The pointer came onto a building, or onto another face of it, or off the
   * last one onto none — null, as every other layer says it. It was
   * `{ building: null }` here alone, and a page clearing on `!event` for every
   * layer it listened to never cleared over the city.
   */
  hover: {
    readonly building: Building
    /**
     * Which face it is on. A page that only lets something be put on a wall
     * says so with the cursor by reading this.
     */
    readonly face: BuildingFace
    /** Which way that face looks, as the click event gives it. */
    readonly facing?: number
  } | null
}

/**
 * The buildings of PLATEAU, as 3D Tiles.
 *
 * Each tile carries a batch of buildings measured from a centre point of its
 * own (CESIUM_RTC), in earth-centred metres. We turn that centre into a place
 * on the Mercator ground and stand the batch there, so the vertices stay small
 * and the group they hang from carries the Mercator stretch.
 *
 * The vertices themselves are worked over once as the tile arrives: turned to
 * face the sky, brought down building by building onto the ground, marked up
 * for windows, and cut for parapets. All of that is the CPU's, and it is the
 * price of a tile landing; nothing moves again while the view does.
 */
export class Buildings implements Layer {
  /** How this layer fetches: through its viewer's `transformRequest`, or plainly before it has one. */
  private get ask(): Ask {
    return this.viewer?.request ?? ASK_PLAINLY
  }

  private viewer: Viewer | null = null
  /**
   * When a look that came back with nothing is worth taking again, or
   * Infinity. Set when the city list could not be fetched, and when a city
   * could not be asked about. Neither is an answer and neither is kept for
   * good — the listing drops its failure at once and a city's is let go of
   * after a while — and nothing else comes back to ask once they have been.
   */
  private askAgainAt = Infinity
  /** Everything the buildings draw. The viewer seats it; see {@link Layer.root}. */
  readonly root = new Group()
  /** Things that stand up off the ground, drawn over it. */
  readonly stage = 'structure' as const
  private readonly tiles: TileSet<Fetch>
  /** What the set had counted when that was last told; see {@link BuildingEvents.tiles}. */
  private tilesTold = 0
  /**
   * Which buildings are fetched; see {@link BuildingsOptions.load}.
   *
   * Read-only: it settles which of two ways the layer asks for tiles, and a
   * page that wants the other one makes the layer the other way.
   */
  readonly load: BuildingsLoad
  private _minZoom: number | false
  /**
   * What the page has stood, by its own name; see {@link bring}.
   *
   * Held rather than kept as it was given, since {@link place} writes back
   * into it.
   */
  private readonly replicas = new Map<string, ReplicaBuilding>()
  /**
   * What each {@link bring} is waiting on, by the name of the replica.
   *
   * A name is in here from the moment it is brought until the survey has
   * answered for it one way or the other — see {@link settled}. Keyed by the
   * name and not by the replica because every one of the three answers is
   * already holding the name.
   */
  private readonly bringing = new Map<string, (stood: boolean) => void>()
  /** What those want fetched, and what the view wants, kept apart and handed over together. */
  private byName: Fetch[] = []
  private covering: Fetch[] = []
  /** Each named building once it is up: what its tile said, and how to hang it. */
  private readonly placed = new Map<string, { group: Group; foot: Foot; surveyed: [number, number] }>()
  /** What the survey turned out to say about each, and which it does not have. */
  private readonly told = new Map<string, Building>()
  /** The building and face the last hover told of, so that moving onto another face of it is told too; see {@link pointed}. */
  private hoveredFace: { readonly id: string; readonly face: BuildingFace; readonly facing?: number } | null =
    null
  /** Which failure of each city's catalog has been told of; see {@link sayCatalogFailed}. */
  private readonly catalogSaid = new Map<string, unknown>()
  private readonly absent = new Set<string>()
  /**
   * Buildings on their way under because a page took them out, and the moment
   * the last corner of each is beneath the ground.
   *
   * Held apart from {@link hidden} rather than written into it, because the
   * two say different things: `hidden` is what a page has decided, and this is
   * what the picture is still catching up on. A building here is still drawn —
   * {@link notDrawn} takes it back out of the answer — until its moment comes
   * and the frame marks the meshes afresh without it.
   */
  private readonly sinking = new Map<string, { mesh: Mesh; of: Set<number>; until: number }>()
  /** Where each building asked about was last found, good while that mesh is in the scene. */
  private readonly stood = new Map<string, { mesh: Mesh; at: number }>()
  /** City buildings `place` was given and could not move, said about once each. */
  private readonly saidNotInHand = new Set<string>()
  /** Meshes whose lines are held back until their buildings have finished growing. */
  private readonly growing = new Map<Mesh, number>()
  /**
   * When the last building will be back under the ground, or null while they
   * stand. The tiles are held until then, and let go together.
   */
  private leaving: number | null = null
  /** The motions playing on single buildings (see {@link animate}). */
  private readonly motions = new BuildingMotions({
    standing: (id) => this.standing(id),
    lineUp: (mesh, moves) => this.folds.move(mesh, moves),
    remark: (mesh) => this.remark(mesh),
  })
  /**
   * What each look is still waiting on. Until the cities are known nothing
   * says where buildings may stand, so the whole view is on its way; then,
   * until a city's tileset is in, nothing says which of its tiles are on
   * screen, so all of that city is.
   */
  private readonly asking = new Set<WorldBounds[]>()
  /**
   * Cities on screen whose tilesets have not answered yet, as of the last
   * look. Their ground is on its way as much as a tile in flight is, and
   * {@link arriving} says so.
   */
  private citiesComing: WorldBounds[] = []
  /**
   * The tiles a shape standing on the map asks for, kept between looks.
   *
   * Which of them lie inside the shape turns on the shape and on the trees
   * the catalog has answered with, and on nothing the camera does — behind a
   * standing mask the screen is not asked at all; see {@link Viewer.screenPicks}.
   * Walked afresh on every look, that was every city's tree walked to its
   * leaves on every frame of a drag, for a list identical to the last one.
   *
   * Only ever a complete answer. A look that left a city still coming, or one
   * it could not ask about, has an answer that will change by itself, and the
   * asking again is done by the very walk this would skip.
   */
  private maskTiles: { area: MaskArea; tiles: BuildingTile[] } | null = null
  /**
   * Cities already asked about and not yet answered.
   *
   * A look happens on every frame the view moves, and each one would hang
   * another listener on the same promise; by the time a slow city answered,
   * hundreds would fire at once.
   */
  private readonly awaited = new Set<string>()
  /** How many looks have been begun, and the latest of them whose tiles went on screen. */
  private looksBegun = 0
  private lookShown = 0
  /**
   * Reads a tile's glTF, with a manager of its own: whatever a tile names
   * beside itself — a buffer, a picture — is fetched from where the tile came
   * from and goes through the page's `transformRequest` as the tile did
   * (`'building'`). Read against no address at all, as it was, such a name
   * landed on the page's own origin and went there with its cookies (found in
   * review). PLATEAU's tiles hold everything inside them, so this is for a tile
   * that does not, and changes nothing for one that does.
   */
  private readonly loader = new GLTFLoader(this.namesBeside())
  private readonly material: SolidMaterial
  /** What the faces looking up are painted, held on the wall's colour until a page parts them. */
  private readonly roofColour = uniform(new Color('#ffffff'))
  /**
   * How much detail is asked for; see {@link BuildingsOptions.lod}.
   *
   * Read-only, since every tile in hand was fetched at it: another would be
   * another city, and is another layer.
   */
  readonly lod: BuildingLod
  /**
   * Where the Draco decoder is fetched from; see {@link BuildingsOptions.dracoPath}.
   *
   * Read-only: three's loader takes its decoder once, and the decoder is the
   * same program wherever it is fetched from.
   */
  readonly dracoPath: string
  /** What the windows look like, and whether they are drawn at all. */
  private readonly paint = new WindowPaint()
  /** What a page has painted on buildings of its own choosing. */
  private readonly styles = new BuildingStyles(toldOf)
  private readonly hidden = new HiddenBuildings(toldOf)
  /**
   * The windows set into the walls, and every setting they are drawn by.
   *
   * A part of the layer rather than a value of it, the way three's
   * `light.shadow` is: a page writes `buildings.windows.visible = false` and
   * the rest of it stays as it was. Never replaced, so a page may hold it.
   */
  readonly windows: Windows
  /**
   * The parapet cut into every flat roof, and how big it is; a part of the
   * layer as {@link windows} is.
   */
  readonly parapet: Parapet
  private _storeyHeight: number
  /**
   * Whether every tile now standing was read for its windows.
   *
   * A tile that lands while the windows are off is not read for them and its
   * roads are never fetched, so turning them on afterwards has nothing to
   * draw. False says so, and the tiles are stood again.
   *
   * Also what {@link credits} goes by, which is why it says only that the
   * roads were read and not that they were read with today's numbers; that
   * is {@link refitDue}.
   */
  private glazed = true
  /**
   * Whether what the walls were read with has changed since the tiles now
   * standing were read: a setting of {@link windows} that decides where a
   * window may be cut, or {@link storeyHeight}, changed while the windows were
   * off. Nobody can see the difference until they are turned on, so the tiles
   * are stood again then and not before.
   */
  private refitDue = false
  /**
   * The shape the buildings are cut to, as the one material every tile shares
   * reads it. Woven in as that material is made, whether or not a mask is
   * set: it is made once, in the constructor, and a page may cut the scene
   * long afterwards.
   */
  private readonly mask = new MaskShader()
  /**
   * How many masks have been set, which is what tells a kept answer from a
   * stale one. Counted rather than compared, since a page may hand over an
   * area equal to the last one and mean a new question.
   */
  private masksSeen = 0
  /** Read where a footprint corner is turned into a place on the map, and thrown away after. */
  private readonly corner = new Vector3()
  /**
   * The meshes that were asked about before they hung anywhere, to be asked
   * again next frame; see {@link onTheLine}.
   *
   * The meshes and not a flag. A flag said only that somebody somewhere had
   * asked too early, and the answer to that was to walk every mesh of every
   * tile on screen — a walk of every corner of the city for a handful of
   * meshes, and quadratic in the tiles of one load while they were still
   * landing. Held by name, the next frame pays for exactly what asked.
   */
  private readonly linesDue = new Set<Mesh>()
  /**
   * The strikes travelling through the city, which every corner reads.
   *
   * Apart from the motions on purpose: a motion is a building moved, and this
   * is the ground moving under all of them. Two strikes over one building add
   * up, where two motions would be the second taking the first's place.
   *
   * Before the lines, which are drawn along the walls and so have to read it.
   */
  private readonly crowds = new Crowds()
  /** The lines along the buildings' folds, and whether they are drawn. */
  private readonly folds = new Edges(this.crowds)
  private _edges: boolean
  /** What a page said the city is drawn in, each left out where it said nothing. */
  private _wallColor: ThemeColor | undefined
  private _roofColor: ThemeColor | undefined
  private _edgeColor: ThemeColor | undefined
  private _edgeWidth: number
  private _glows: boolean
  private dirty = true
  private readonly events = new Events<BuildingEvents>()
  /** Whether anything was still coming when last looked, for telling the turn to `loaded`. */
  private wasBusy = false
  /**
   * Whether the city was at rest when last looked, for telling the turn to
   * `idle`. At rest to begin with, so the first one told follows something
   * having come.
   */
  private wasIdle = true
  /** The standing mask already spoken about, so a size is said once and not every frame. */
  private spokeOf: MaskArea | null = null
  /**
   * Tiles fetched and waiting for a frame of their own to take their next step
   * of shaping in, first come first served. Shaping holds the main thread for
   * some 30 to 70ms a tile, and two or three landing together stalled a frame
   * for over 100ms.
   */
  private readonly landing: { go: () => void; signal: AbortSignal }[] = []

  constructor(options: BuildingsOptions = {}) {
    this.lod = options.lod ?? 2
    this.dracoPath = options.dracoPath ?? DRACO_PATH
    this._edges = options.edges ?? false
    this.folds.visible = this._edges
    this._wallColor = options.wallColor
    this._roofColor = options.roofColor
    this._edgeColor = options.edgeColor
    this._edgeWidth = pixels(options.edgeWidth ?? DEFAULT_EDGE_WIDTH, 'edgeWidth')
    this.folds.width = this._edgeWidth
    this._glows = options.glows ?? false
    this._castShadow = options.castShadow ?? true
    this._occludes = options.occludes ?? true
    this.styles.glowing = this._glows
    this._storeyHeight = positiveMetres(options.storeyHeight ?? STOREY_HEIGHT, 'storeyHeight')

    // The two parts, each told how to reach back into the layer. Nothing they
    // say is acted on until the layer is made, so the first settings are
    // written here by hand
    this.windows = new Windows(options.windows ?? {}, {
      repaint: () => this.repaintWindows(),
      reread: (changed) => void this.reread(changed),
      colorOf: (usage, part) => '#' + new Color(this.windowColorOf(usage, part)).getHexString(),
    })
    this.parapet = new Parapet(options.parapet ?? {}, () => this.recut())
    this.repaintWindows()
    this.paint.parapetDepth = parapetSize(this.parapet)?.depth ?? 0

    this.loader.setDRACOLoader(decoderFrom(this.dracoPath))

    // Before the material, which is woven differently either way

    this.root.visible = options.visible ?? true
    // One material for the whole city; see the traps in CLAUDE.md. What differs
    // between buildings rides the corners and the styles table.
    this.material = solid({ color: new Color('#ffffff') })
    // A building stands on the ground rather than lying on it, so it takes the
    // land's own mark off whatever it covers; see `classify.ts`
    marksSolid(this.material)
    // A building a page has painted is painted under its windows and banded
    // over them: paint on a wall leaves the glass glass, and a band drawn
    // across the face of a building covers what it crosses.
    //
    // A roof is not something the survey names; it is whatever part of the
    // shape ended up looking at the sky. So it is told by which way the face
    // points, and the seam is woven in always rather than when a page first
    // asks for one — a shader is settled before it is first drawn, and the
    // uniform sits on the wall's own colour until a page says otherwise.
    const facing = normalLocal as unknown as Node<'vec3'>
    const skyward = facing.y.greaterThan(float(ROOF_FACES_UP)) as Node<'bool'>
    const base = skyward.select(
      this.roofColour as unknown as Node<'vec3'>,
      materialColor as unknown as Node<'vec3'>,
    ) as Node<'vec3'>
    // And the pictures over all of it, since they are the last thing put on
    // a building: a page that banded a tower and then painted a marking on
    // its roof or a poster round its walls meant the picture to be seen. They
    // are told which faces are roof by the same test the roof's own colour is
    // chosen by, rather than asking again — see {@link BuildingStyles.decals}.
    const albedo = this.styles.decals(
      this.styles.bands(this.paint.over(this.styles.wall(base))),
      facing,
      skyward,
    ) as Node<'vec3'>
    /*
     * And then the one thing a face says about the light: whether it carries
     * its own.
     *
     * A face at a time, because the whole city is one material and which of
     * its buildings glow is the page's to say one by one; see
     * {@link BuildingStyles.lit}. So it cannot be the material's own `lights`
     * switch, which is what every other glowing thing in this library uses
     * (`lit.ts`). It is said instead as the two halves a lit renderer already
     * has: what the light falls on, and what shines by itself.
     *
     * The glowing half goes through the frame's tone curve backwards, since a
     * page that said a building is this colour whatever the sun does means
     * that colour on the screen. The lit half does not: it is a reflectance,
     * and what the curve does to it is what the curve does to the whole city.
     */
    const takes = this.styles.lit()
    this.material.colorNode = albedo.mul(takes) as Node<'vec3'>
    this.material.emissiveNode = beforeTheCurve(albedo).mul(takes.oneMinus()) as Node<'vec3'>
    // How far a building on its way is still under its own ground: worked out
    // once and given to both what moves it and what cuts it, so the vertex
    // stage writes it once
    const under = stillUnder()
    // A building a motion moves is moved here, where the sun, the corner
    // shading and the pointer all see it. One that stands still reads nothing.
    //
    // And then lifted by whatever strikes are crossing the ground under it.
    // Last, and by its own place on the world rather than by anything written
    // on it: a wave is a thing of the ground, so what a corner is thrown by is
    // where it stands, and a building the wave has not reached reads nought
    // without anything having to be said about it.
    this.material.positionNode = placeMoved(under).add(this.thrown(under))
    // ...and which way its faces point with it, read where normals are read
    this.material.normalNode = facingMoved()
    // A wall the mask crosses is cut down its face, so the city ends in the
    // shape rather than on the tile boundary the shape happened to fall on.
    //
    // And with it, whatever of a building on its way is still below the ground
    // it stands on. `seat` puts every building's lowest corner at nought of its
    // own, so its own y is how far over that ground a corner rests — less its
    // hem, which is the one part carried below that nought on purpose and the
    // very part that fills the gap on a slope. Read without it, a hem is a
    // thing that exists and is never drawn.
    //
    // And with it, whatever a page has taken out of the city. It rides the
    // mask's own test rather than one of its own: both throw a fragment away,
    // both are read on every corner of every building, and two tests are two
    // branches where one `and` is none.
    //
    // The hem is the one part of this that the ground itself used to answer
    // for. It is carried below the building's own nought on purpose and buried
    // in the hillside, and what kept it out of sight was the land's depth — so
    // where a mask ends the land, it hangs in the open and the building reads
    // as starting under the ground. What the viewer keeps of the uncut land
    // puts that back, and is taken on as the layer is; see `underground.ts`.
    this.own = overGround(positionGeometry.y.add(hemBelow()).sub(under)).and(notHidden()) as Node<'bool'>
    this.cutTo(null)
    // And what the viewer's own pass reads when it draws the picture the lines
    // round buildings are found in: which line this corner's building wears,
    // and which building it is. Read by nothing else; see `outlines.ts`.
    drawsOutline(this.material, this.styles.outline())

    this.tiles = new TileSet<Fetch>({
      // Nothing is kept once it leaves the screen. A tile brought back is
      // fetched and shaped again, and the shaping is the long half — 29 to
      // 45ms a tile and up to 67, measured at 高円寺 — but a page that wanders
      // has no edge to its wandering, and a city held tile by tile along the
      // way is a tab that grows until it is closed. What is held is only ever
      // what is seen.
      retain: 0,
      atOnce: TILES_AT_ONCE,
      keyOf: (fetch) => fetch.key,
      load: (fetch, signal) =>
        fetch.find
          ? this.findNamed(fetch.find.wanted, fetch.key, fetch.find.roots, signal)
          : this.loadTile(fetch.tile, signal),
      onError: (cause, key, retrying) => this.failed({ what: 'tile', key, retrying, cause }),
    })

    this.load = options.load ?? 'all'
    this._minZoom = cityMinZoomOf(options.minZoom ?? DEFAULT_CITY_MIN_ZOOM)
    // Before anything has landed, so nothing is marked and nothing is seen to
    // go; see {@link BuildingsOptions.hide}
    for (const what of options.hide ?? []) this.hidden.hide(what)
  }

  /** A building a page named that the survey does not have where it said. */
  private lost(id: string): void {
    if (this.absent.has(id)) return
    this.absent.add(id)
    this.failed({
      what: 'building',
      key: id,
      retrying: false,
      cause: new Error('no tile covering it holds this building'),
    })
    this.settled(id, false)
  }

  /**
   * Tells whoever is listening that something could not be fetched, and says
   * it out loud where nobody is.
   *
   * A library that swallows its failures leaves a page with holes it cannot
   * explain; one that only writes to the console leaves an app unable to say
   * anything to the person using it. So: the event where it is heard, the
   * console where it is not.
   */
  private failed(failure: LoadFailure): void {
    if (this.events.has('error')) {
      this.events.emit('error', failure)
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[plateau-ui] Buildings: ${failure.what} ${failure.key} failed`, failure.cause)
  }

  /**
   * Writes a mesh's corners afresh, both halves of what they say: where the
   * mesh stands, and what a page has decided about its buildings.
   *
   * A motion ending is what wants the pair, and is the one caller left. Its
   * row cannot be rubbed out on its own — a crowd may have written on the
   * same corners — so {@link restand} writes every corner's row again.
   *
   * The marking half writes what a page has decided — the paint, what is
   * hidden, the lines — and takes the mask's answer as it was left rather
   * than working it out afresh: that answer is kept on the mesh against the
   * count of masks seen and the mesh's own matrix, and a motion changes
   * neither of them, what it writes being a row of the table and a matrix of
   * its own. So the pair costs a walk over the corners and, where nothing
   * differs, no upload.
   *
   * A tile landing and a mesh cut anew take the two halves apart instead:
   * each has work of its own to do between them.
   */
  private remark(mesh: Mesh): void {
    this.restand(mesh)
    this.mark(mesh)
    // A motion ending is the one caller, and the building it ends is back in
    // its resting pose in this very frame: `restand` writes 0 into the motion
    // row of every corner, which the vertex stage reads as standing still. By
    // then the motion is out of `#running`, so `motions.any` is false and the
    // frame below says nothing — and the sun's map, held between frames, kept
    // the shadow where the building was when it last moved. The same trade
    // {@link remarkAll} takes: one redraw where something actually moved.
    this.viewer?.stirShadows()
  }

  /**
   * The half of {@link remark} that is about where the mesh stands: back onto
   * its own land, and its rows of the moving table cleared.
   *
   * Apart from the marking because the two want different moments. This half
   * reads nothing but the mesh, so it can be done the instant a shape
   * changes. The other reads where the tile hangs — a footprint is in the
   * tile's own metres and the mask is in the world's — so it is worth doing
   * only once the tile is under the root, and doing it earlier is a full walk
   * of every corner thrown away. That is what a landing tile did: marked
   * before it was hung and marked again after, with the early walk deciding
   * nothing, setting a flag that asked the next frame to walk every mesh of
   * every tile on screen, and being overwritten in the same function.
   */
  private restand(mesh: Mesh): void {
    standAgain(mesh)
    const marks = mesh.geometry.attributes[BUILDING_SLOTS] as BufferAttribute | undefined
    if (!marks) return
    // The motion row alone, which is the fourth of the four a corner carries.
    // The other three are the paint's, written by another hand, and a mesh
    // stood again is still painted the way it was; see {@link BUILDING_SLOTS}.
    const array = marks.array as Float32Array
    for (let at = 3; at < array.length; at += 4) array[at] = 0
    marks.needsUpdate = true
    this.motions.mark(mesh)
  }

  /**
   * Says on a mesh what a page has taken out of the city: on its corners, which
   * the walls read, and on its lines, which are their own geometry and read
   * nothing of the building they were cut from.
   *
   * Both in the one place, so a building cannot be hidden in one and left in
   * the other — which is what it did: the lines carried no such test, and a
   * page that hid a building was left with its plan drawn on the ground.
   */
  private mark(mesh: Mesh): void {
    const out = this.notDrawn(mesh)
    this.styles.mark(mesh, this.storeyHeight, out)
    this.folds.mark(mesh, out)
  }

  /**
   * Which of a mesh's buildings are not drawn: the ones a page has taken out,
   * and the ones the mask's edge runs through.
   *
   * Two reasons, one answer, because the corners carry one bit. They are kept
   * apart everywhere else — a page that shows a building back has said nothing
   * about the mask — and only added up here, where the bit is written.
   */
  private notDrawn(mesh: Mesh): ReadonlySet<number> | null {
    const byPage = this.stillGoing(mesh, this.hidden.outOf(mesh))
    const byEdge = this.onTheLine(mesh)
    // And the ones moved out of this tile to stand on their own; see
    // {@link movedOutOf}. A third reason with the same answer
    const byMove = this.movedOutOf(mesh)
    const sets = [byPage, byEdge, byMove].filter((set): set is ReadonlySet<number> => set !== null)
    if (sets.length <= 1) return sets[0] ?? null
    const all = new Set<number>()
    for (const set of sets) for (const building of set) all.add(building)
    return all
  }

  /**
   * The ones a page has taken out, less the ones still going under.
   *
   * A building sinks out of sight before it stops being drawn, so for the
   * second or so of its way it is both taken out and on the screen. This is
   * where those two are told apart, and it is the only place: everywhere else
   * {@link hidden} is the whole answer.
   */
  private stillGoing(mesh: Mesh, out: ReadonlySet<number> | null): ReadonlySet<number> | null {
    if (!out || this.sinking.size === 0) return out
    const going = this.sinking.get(mesh.uuid)
    if (!going) return out
    const left = new Set(out)
    for (const building of going.of) left.delete(building)
    return left.size > 0 ? left : null
  }

  /**
   * Sets the buildings a page has just taken out on their way under, and says
   * when the last of them is there.
   *
   * Whole tiles went this way long before one building could; see
   * {@link beginLeaving}. What is different here is that the tile around them
   * is standing still, so only the corners of these are stamped and the rest
   * are left saying their way is behind them.
   *
   * Nothing is stamped where there is no coming and going at all: a page that
   * asked for none means a city that stands up and vanishes where it is, and
   * taking one building out is that too.
   */
  private beginSinking(at: number, before: Map<string, ReadonlySet<number>>): void {
    if (appearTakes() <= 0) return
    const stagger = appearStagger()
    const takes = appearTakes()
    this.onScreen((mesh) => {
      const out = this.hidden.outOf(mesh)
      if (!out || out.size === 0) return
      // Only the ones that were being drawn a moment ago. One already out, or
      // already on its way, is left where its own clock has it rather than
      // sent off again from the top
      const was = before.get(mesh.uuid)
      const off = new Set<number>()
      for (const building of out) if (was?.has(building) !== true) off.add(building)
      if (off.size === 0) return
      stampAppear(mesh, at, stagger, 'down', off)
      // ...and the lines go down with the walls they are drawn along
      this.folds.follow(mesh)
      const until = doneBy(at, takes, stagger)
      const had = this.sinking.get(mesh.uuid)
      if (had) {
        for (const building of off) had.of.add(building)
        had.until = Math.max(had.until, until)
      } else {
        this.sinking.set(mesh.uuid, { mesh, of: off, until })
      }
    })
    if (this.sinking.size > 0) this.dirty = true
  }

  /**
   * Brings back up the ones a page has just put back.
   *
   * The other half of {@link beginSinking}, and simpler for it: nothing has to
   * be held while it comes, because a building on its way up is already being
   * drawn. One still on its way down turns round where it stands rather than
   * dropping the rest of the way first.
   */
  private beginRising(at: number, before: Map<string, ReadonlySet<number>>): void {
    if (appearTakes() <= 0) return
    const stagger = appearStagger()
    this.onScreen((mesh) => {
      const was = before.get(mesh.uuid)
      if (!was || was.size === 0) return
      const out = this.hidden.outOf(mesh)
      const back = new Set<number>()
      for (const building of was) if (out?.has(building) !== true) back.add(building)
      if (back.size === 0) return
      const going = this.sinking.get(mesh.uuid)
      if (going) {
        for (const building of back) going.of.delete(building)
        if (going.of.size === 0) this.sinking.delete(mesh.uuid)
      }
      stampAppear(mesh, at, stagger, 'up', back)
      this.folds.follow(mesh)
    })
    this.dirty = true
  }

  /**
   * Which buildings are out of each mesh on screen, as things stand.
   *
   * Taken before a page's word changes anything, so that what it changed can
   * be worked out by difference afterwards. The sets are the ones
   * {@link HiddenBuildings.outOf} made and are not written to.
   */
  private whatIsOut(): Map<string, ReadonlySet<number>> {
    const out = new Map<string, ReadonlySet<number>>()
    this.onScreen((mesh) => {
      const hidden = this.hidden.outOf(mesh)
      if (hidden) out.set(mesh.uuid, hidden)
    })
    return out
  }

  /**
   * Lets go of the ones that have finished going under, and marks their meshes
   * so they stop being drawn.
   *
   * Once a frame, from {@link frame}. Nothing walks here while nothing is on
   * its way down, which is nearly always.
   */
  private forgetSunk(seconds: number): void {
    if (this.sinking.size === 0) return
    for (const [key, going] of this.sinking) {
      if (seconds < going.until && going.mesh.parent) continue
      this.sinking.delete(key)
      this.mark(going.mesh)
    }
    this.viewer?.stirShadows()
  }

  /**
   * Which of a mesh's buildings the mask does not hold whole.
   *
   * A building goes if any corner of its foot falls outside, which takes out
   * both the ones past the shape and the ones the line runs through: the city
   * stops a little inside the line rather than being cut down the face of a
   * wall, which reads as damage rather than as an edge. The corners themselves
   * are walked, by {@link feetOn}, which is the one place this question is
   * answered.
   *
   * The ground is not asked — it is a sheet, and a sheet ends where it ends.
   * What is cut at the line and what goes whole is settled by what a thing is,
   * so there is nothing here for a page to choose between.
   *
   * Worked out once per mask and kept on the mesh. Reading the feet is a walk
   * over every corner, and this is asked again every time a mesh is marked —
   * a motion ending, a style or a rule changing, a building hidden or shown,
   * the parapets cut. Nothing asks at a motion's start: starting one writes
   * the rows and no more.
   *
   * What says the kept answer still stands is the mask in hand *and* where the
   * tile hangs. The feet are carried through the mesh's own matrix, so the
   * answer is about the place the tile stood when it was taken — and a named
   * building {@link place} moves is a mesh that went somewhere else under an
   * unchanged mask. Kept on the count alone, a building carried into the
   * middle of the shape stayed cut away, with every fragment of it discarded
   * while it stood plainly inside.
   */
  private onTheLine(mesh: Mesh): ReadonlySet<number> | null {
    const area = this.viewer?.maskArea ?? null
    if (!area || area.parts.length === 0) return null

    mesh.updateWorldMatrix(true, false)
    const kept = mesh.userData[ON_THE_LINE] as { at: number; stood: Matrix4; out: Set<number> } | undefined
    if (kept?.at === this.masksSeen && kept.stood.equals(mesh.matrixWorld)) {
      return kept.out.size > 0 ? kept.out : null
    }

    // A footprint is in the tile's own metres and the mask is in the world's,
    // so the answer wants the matrix that carries one to the other — and that
    // is only worth reading once the tile hangs under this layer's root. A
    // tile is marked as it is shaped, which is before it is hung, so the first
    // ask comes too early: nothing is decided, nothing is kept, and the frame
    // below asks again with everything in place.
    if (!seated(mesh, this.root)) {
      this.linesDue.add(mesh)
      return null
    }

    const out = new Set<number>()
    for (const [building, held] of feetOn(mesh, area)) if (!held) out.add(building)
    mesh.userData[ON_THE_LINE] = { at: this.masksSeen, stood: mesh.matrixWorld.clone(), out }
    return out.size > 0 ? out : null
  }

  /** What this throws away for reasons of its own, before the viewer adds its. */
  private own: Node<'bool'> | undefined

  /**
   * Sets what the walls throw away: their own reasons, and what the viewer
   * knows about the land under them.
   *
   * Through the mask's own test rather than beside it — both throw a fragment
   * away, both are read on every corner of every building, and two tests are
   * two branches where one `and` is none.
   */
  private cutTo(underLand: Node<'bool'> | null): void {
    const own = this.own
    if (!own) return
    this.mask.apply(this.material, underLand ? (own.and(underLand) as Node<'bool'>) : own)
  }

  // ── Layer ────────────────────────────────────────────────

  attach(viewer: Viewer): void {
    this.viewer = viewer
    // What the land would have hidden, where a mask has taken the land away.
    // Told here rather than in the constructor because it is the viewer's, and
    // read in time because a material's nodes are settled at its first drawing
    // and nothing has been drawn yet
    this.cutTo(viewer.underground.overLand())
    // And the picture a page may be throwing down over the map, taken here
    // for the same reason and in the same breath; see `projection.ts`.
    viewer.projection.cast(this.material, 'buildings')
    // And what an eye a page has put on the map can see; see `sight.ts`
    viewer.sight.paint(this.material, 'buildings')
    // The colours of the lines are the viewer's, since one pass draws the
    // lines round everything on screen. What is taken here is a slot in them.
    this.styles.useOutlines(viewer.outlines)
  }

  /**
   * Gives back the tiles and stops what was moving. The one material every
   * tile shares, and the outlines' own, are kept — they are made once and
   * woven into shaders that cost about a second apiece, and the same
   * buildings may be put on a viewer again. They go in {@link dispose}.
   */
  detach(): void {
    this.styles.useOutlines(null)
    // The land it was reading was that viewer's. Put back to its own reasons,
    // so a Buildings taken on elsewhere is not testing against a dead picture
    this.cutTo(null)
    this.leaving = null
    this.stood.clear()
    this.growing.clear()
    // The fourth map holding a tile's mesh, and the one that used to be left
    // behind: a layer taken off kept whole geometries alive for as long as the
    // page kept the layer
    this.sinking.clear()
    // Each of these hangs from the group its tile was cut down to, holding the
    // one building, and the tiles go just below — with their geometry. Kept
    // past that, `place` would be moving a group already out of the scene and
    // stripped of its shapes, instead of the one standing after the tiles land
    // again.
    this.placed.clear()
    this.motions.clear()
    this.crowds.clear()
    this.tiles.clear()
    // Every tile waiting its turn was just given up on, and no frame comes to let it through
    for (const { go } of this.landing.splice(0)) go()
    this.root.clear()
    this.citiesComing = []
    this.maskTiles = null
    this.dirty = true
    this.viewer = null
  }

  /** For buildings that will not be used again. Take them off their viewer first. */
  dispose(): void {
    // Nothing is going to stand now, so whoever is still waiting on one hears
    // that rather than waiting for the life of the tab. `drop` says it, and
    // takes the name off the lists with it
    for (const id of [...this.replicas.keys()]) this.drop(id)
    this.detach()
    this.material.dispose()
    this.folds.dispose()
    this.styles.dispose()
    // The shapes a page cleared were read into areas of this layer's making,
    // so they go back with it; see CLAUDE.md's fifth contract
    this.hidden.show()
  }

  /** The city answers every one of the words; see {@link Change}. */
  changed(what: Change): void {
    switch (what) {
      case 'view':
        // What a page stood does not change as the page is moved. The look
        // that finds those runs once and again when a catalog answers, and
        // taking it on every frame of a drag would walk the city boundaries
        // for nothing.
        if (this.load === 'brought') return
        this.dirty = true
        return
      case 'colors': {
        if (!this.viewer) return
        // The layer's own colours, each over the palette's where the page said
        // one, and the windows' with them
        this.repaint()
        this.repaintWindows()
        // What the mask's hem goes over to: whatever the scene is backed with,
        // so that a wall on its way out reads as the far side of the shape.
        const { backdrop } = this.viewer.colors
        this.mask.fadeInto(backdrop)
        this.folds.fadeInto = backdrop
        // And the buildings a page painted one by one. Their colours are baked
        // into the paint table rather than read a frame at a time, so a pair
        // among them only turns over when the table is written again — the
        // same walk a rule change goes through, and the same cost (6~13 ms for
        // 1,933 buildings, measured). Once as the sun crosses, not per frame.
        this.styles.night = this.viewer.night
        this.remarkAll()
        return
      }
      case 'elevation':
        // What each building stands on is written onto its corners as its tile
        // is shaped, so the tiles are let go of and shaped again — the b3dm is
        // still in the browser's hands, so what is paid for is the shaping.
        // They come back the way they first arrived, rising out of the ground,
        // which is the truthful picture of what just happened: the city is
        // standing up somewhere else.
        this.standAgain()
        return
      case 'mask': {
        // The shape goes to the material and to the outlines, and the tiles
        // are chosen again on the next frame. Nothing is shaped afresh: what a
        // mask changes is which fragments survive and which tiles are worth
        // fetching, neither of which is built into a tile.
        const area = this.viewer?.maskArea ?? null
        this.mask.set(area)
        // The buildings on the line are gone before the shader sees them, and
        // the cut still catches whatever the footprint did not, since a foot
        // read at the ankle is not the shape of everything standing on it.
        this.folds.mask = area
        this.masksSeen++
        // What the last shape asked for was the last shape's answer; see {@link maskTiles}
        this.maskTiles = null
        // The corners have to be written again: which buildings the line runs
        // through is the mask's answer, and the mask has just changed.
        this.remarkAll()
        this.dirty = true
        return
      }
      case 'appear':
        // What is on its way is finished rather than handed over to the new
        // pace; see {@link settle}
        this.settle()
        return
    }
  }

  /**
   * Finishes at once whatever is coming or going, and stamps every corner as
   * having got where it was going long ago, for a pace that has just been
   * written.
   *
   * What is held about a trip — {@link growing}, {@link sinking},
   * {@link leaving} — was worked out from the pace it set off at, and the
   * shader reads the new one from this frame on. Each deadline worked out
   * again would still leave the picture jumping, since the shader measures
   * every trip against the new duration, so the trips end here instead, the
   * way each would have ended: risen, or under and let go of.
   *
   * Every corner and not only the ones on their way. One that got there a
   * second ago is on its way again under a longer pace, being measured against
   * it; and one a page put back while the coming and going was off was never
   * stamped up, so it still says it went down — which reads as standing only
   * while the pace is nought.
   */
  private settle(): void {
    if (this.leaving !== null) {
      // Under and let go of, as the frame does once the old deadline comes
      this.leaving = null
      this.letCityGo()
    }
    this.growing.clear()
    const sunk = [...this.sinking.values()]
    this.sinking.clear()
    // Long enough ago, at this pace, for every corner to read as arrived: the
    // moment a mesh cut long after it landed is stamped from (see `refresh`)
    const over = -appearStagger() - appearTakes()
    this.eachMesh((mesh) => {
      stampAppear(mesh, over, appearStagger(), 'up')
      // ...and the lines with the walls they are drawn along
      this.folds.follow(mesh)
    })
    // The ones a page took out stop being drawn now, as `forgetSunk` has them
    // stop once they are under
    for (const going of sunk) this.mark(going.mesh)
  }

  /**
   * Lets every tile go, so the city is fetched and shaped from the start.
   *
   * For a change a tile carries in its corners rather than in a uniform. The
   * one writer of that, so that whatever asks for it asks the same way.
   */
  private standAgain(): void {
    this.leaving = null
    this.growing.clear()
    this.sinking.clear()
    // The groups these hang from go with the tiles; each named building is
    // hung again as its tile lands
    this.placed.clear()
    this.tiles.clear()
    this.dirty = true
  }

  frame(): void {
    // Whether or not the view moved, one tile waiting to be shaped lands now.
    // Let through even turned off: one already on its way is waiting here, and
    // would otherwise wait for good
    this.letOneLand()
    this.sayIfStood()
    this.sayIfIdle()
    if (!this.root.visible) return
    // What is standing, said once it is. Tiles are taken on and let go of in
    // half a dozen places inside the set that holds them, so the change is
    // noticed here, on the one pass that sees every frame, rather than told
    // from each of them. A number compared is the whole cost where nothing
    // changed.
    //
    // The set's own count of comings and goings, and not how many groups hang
    // from the root: the commonest change of all leaves that number exactly
    // where it was — one tile lands in the very frame another is let go of —
    // and a page counting the buildings for itself was left holding the tally
    // it took before either happened.
    if (this.tiles.changes !== this.tilesTold) {
      this.tilesTold = this.tiles.changes
      this.events.emit('changed', { tiles: this.root.children.length })
    }
    // A tile marked before it was hung could not be judged against the mask,
    // since its corners were still in its own metres. Everything is where it
    // belongs by now, so those meshes are marked again.
    if (this.linesDue.size > 0) {
      const asked = [...this.linesDue]
      this.linesDue.clear()
      // Still hanging: a tile let go of between the asking and now is one
      // whose meshes have been taken apart, and nothing is owed to those
      for (const mesh of asked) if (seated(mesh, this.root)) this.mark(mesh)
    }
    const seconds = performance.now() / 1000
    // The strikes travel on their own clock, which is this one. Written before
    // anything here can turn back: a city that is not being fetched or shaped
    // is exactly the city a wave should still be crossing
    this.crowds.tick(seconds, metersPerUnit(this.viewer?.camera.center[1] ?? 0))
    this.forgetGrown(seconds)
    // ...and the ones a page took out, which go under one at a time out of a
    // tile that is standing still
    this.forgetSunk(seconds)
    // Held on to while they sank; once the last is under, the tiles go together
    if (this.leaving !== null && seconds >= this.leaving) {
      this.leaving = null
      this.letCityGo()
    }
    const moved = this.motions.frame()
    // Four ways the city moves without a tile landing or the view turning, and
    // all four move it **in the shader** — a building on its way up off the
    // appear clock, a whole city on its way down off the same clock, a motion
    // playing off the slot table, a crowd's wave off its own. Nothing outside
    // would know, so it is said here, and the sun's map is drawn again for it;
    // see `Viewer.stirShadows`.
    //
    // The leaving is counted apart from `growing` because it is not in it:
    // `beginLeaving` takes each mesh out of that map on the way to stamping it
    // downwards. Left out, the city sank into its own shadows — the view has
    // stopped by then, so the aiming is the same and nothing else would have
    // the map drawn again. It is the line `Ground` writes for its parks going
    // under.
    //
    // A motion is counted while it moves a building, not while it holds one
    // where it ended (`fill`): held, the city stands still, and a frame drawn
    // for it is the map drawn again for nothing (`repaint.ts`).
    if (this.growing.size > 0 || this.leaving !== null || moved || this.crowds.stirring) {
      this.viewer?.stirShadows()
    }
    const viewer = this.viewer
    if (!viewer) return
    // The view standing still is not the same as there being nothing to do:
    // tiles that failed, and cities the catalog could not answer for, come
    // due on their own clock
    const due = this.tiles.due || performance.now() >= this.askAgainAt
    if (!this.dirty && !due) return
    this.dirty = false
    if (due) this.askAgainAt = Infinity

    // The zoom the city stands up at guards against how many tiles a wide
    // view asks for. A page that named its buildings asks for those and no
    // more, however far out it stands, so there is nothing for the guard to
    // hold back — and a row of towers seen from far enough away to hold them
    // all is exactly the view it would have taken them down at.
    // Not what the page has stood of its own. The city sinks and its tiles
    // go, which is right for a city that is only there for being looked at;
    // the five towers a page put in a row stay standing, since the zoom that
    // shows all five is the zoom that takes the city down. They were once
    // told apart by not leaving at all where a page had stood one, and the
    // city froze in place below the zoom it stands at — the last screenful
    // of it standing however far the view went.
    if (this.load === 'all' && !cityStands(viewer.camera.zoom, this._minZoom)) {
      this.beginLeaving()
      if (this.replicas.size > 0) void this.syncReplicas(viewer)
      return
    }
    this.comeBack()
    void this.sync(viewer)
  }

  /**
   * How high the tallest building of the tiles on screen reaches, in metres.
   *
   * The viewer casts its shadows over this much more than the ground in view:
   * a tall roof on screen stands well off the ground it is seen against.
   */
  tallest(): number {
    // Nothing of it is drawn, so nothing of it stands: three leaves the whole
    // subtree out at a `visible` of false, and a viewer told there is still a
    // city here aims the sun's box at it and keeps the map alive.
    if (!this.root.visible) return 0
    let top = 0
    for (const group of this.root.children) {
      if (group.visible) top = Math.max(top, (group.userData[STANDS_TO] as number | undefined) ?? 0)
    }
    return top
  }

  /**
   * Every building the city has in hand, one at a time.
   *
   * What a rule is handed as a tile lands, handed instead when a page asks.
   * The two are for different questions: a rule answers about a building the
   * moment it arrives and the city keeps the answer, and this answers about
   * all of them at once — how many there are, how many of them are something.
   * A page counting what is on the map cannot hang a rule on the tiles and
   * hope to be told when the arriving has stopped.
   *
   * What a tile holds is walked once for all its buildings, so reading
   * {@link Building.position} or {@link Building.corners} of every one of them
   * costs one walk a tile and not one a building.
   *
   * Hidden buildings are handed over too. They are the city's, and a page that
   * took some out knows which.
   */
  each(visit: (building: Building) => void): void {
    this.eachMesh((mesh) => {
      const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
      if (!facts) return
      let walked: Map<number, FootBox> | undefined
      const feet = (): Map<number, FootBox> => (walked ??= feetOf(mesh))
      // Not the one a page moved out of this tile: it is handed over where it
      // stands now, from the tile it stands in on its own
      const moved = this.movedOutOf(mesh)
      for (let at = 0; at < facts.ids.length; at++) {
        if (moved?.has(at)) continue
        const building = toldOf(mesh, at, feet)
        if (building) visit(building)
      }
    })
  }

  /**
   * The patches of the tiles on screen still being fetched or shaped, and of
   * the cities whose tiles are not known yet.
   */
  arriving(): WorldBounds[] {
    // Below the zooms buildings stand at, nothing is on its way, whatever is still in flight
    if (!this.viewer) return []
    if (this.load === 'all' && !cityStands(this.viewer.camera.zoom, this._minZoom)) return []
    // A building a page stood is looked for down a whole city's tileset, so the
    // patch it is coming into is that city — which is not what the hatching on
    // the ground is for. Nothing of a page's five towers is worth shading in,
    // so the ones being looked for by name are left out of this.
    const patches = this.tiles.loading
      .filter((fetch) => !fetch.find)
      .map((fetch) => worldBoundsOf(fetch.tile))
    for (const cities of this.asking) patches.push(...cities)
    patches.push(...this.citiesComing)
    return patches
  }

  listens(type: 'click' | 'hover' | 'pointing'): boolean {
    // A page hearing `hover` is handed every move, as one hearing `pointing`
    // is: the viewer tells a layer the pointer came onto another of its
    // things, and a wall and the roof over it are one thing. Told only then,
    // the face a hover carried was the first face the pointer met, however
    // far over the building it went after
    if (type === 'pointing') return this.events.has('pointing') || this.events.has('hover')
    return this.events.has(type)
  }

  clicked(hit: Hit): void {
    const building = buildingAt(hit)
    if (!building) return
    const { x, y, original } = hit
    // A mesh is what the look came back with, and the only thing that knows how
    // its buildings were seated. It answers nothing only for a mesh whose
    // corners cannot be read at all, which the building found above says is not
    // this one — and a building that is drawn has a ground floor either way.
    const storey = storeyAt(hit.object as Mesh, hit.item, hit.point, this.storeyHeight) ?? 1
    const where = faceOf(hit, this.viewer)
    const position = this.landedAt(hit, building)
    const anchor = anchoredAt(hit, building)
    this.events.emit('click', { building, position, anchor, storey, ...where, x, y, original })
  }

  pointed(hit: Hit | null): void {
    const building = hit ? buildingAt(hit) : null
    if (!building || !hit) {
      if (this.events.has('pointing')) this.events.emit('pointing', null)
      return
    }
    const where = faceOf(hit, this.viewer)
    // Onto another face of the building it is already over: a hover of its
    // own, since the face is what a hover says and the building alone is what
    // the viewer can tell changed
    const was = this.hoveredFace
    if (was && was.id === building.id && (was.face !== where.face || was.facing !== where.facing)) {
      this.hoveredFace = { id: building.id, ...where }
      this.events.emit('hover', { building, ...where })
    }
    if (this.events.has('pointing')) {
      this.events.emit('pointing', {
        building,
        position: this.landedAt(hit, building),
        anchor: anchoredAt(hit, building),
        ...where,
      })
    }
  }

  /**
   * The place a hit landed on, with the building at rest, held to the building.
   *
   * At rest rather than where the card drew it: a building still coming up out
   * of the ground, or sent somewhere by a motion, is drawn short of where it
   * stands. The place handed back is put back held to the building, and held,
   * it is taken as the building has it at rest, so a place read off the
   * picture would land away from the click by however far the building still
   * had to go. Put back without the building, it is that same spot on the map.
   *
   * The height is counted from the land under the place, as every place the
   * viewer hands back is (see `Position.height`).
   */
  private landedAt(hit: Hit, building: Building): Position {
    const rest = pointAtRest(hit.object as Mesh, hit.item, hit.point, AT_REST)
    if (!rest) return { ...hit.position, building: building.id }
    return { ...positionFromWorld(rest.x, rest.y, rest.z, !!this.viewer?.elevation), building: building.id }
  }

  hovered(hit: Hit | null): void {
    const building = hit ? buildingAt(hit) : null
    if (!building || !hit) {
      this.hoveredFace = null
      this.events.emit('hover', null)
      return
    }
    const where = faceOf(hit, this.viewer)
    this.hoveredFace = { id: building.id, ...where }
    this.events.emit('hover', { building, ...where })
  }

  // ── Moving them ───────────────────────────────────────────

  /**
   * Moves one building, picked out by the name PLATEAU gives it (`gml_id`),
   * the way the keyframes say and timed the way the timing says.
   *
   * A building can be moved, grown about the middle of its foot, and leaned
   * over the edge of its foot as a thing pushed tips. What comes back is
   * played with as the browser's `Animation` is: paused, reversed, run at
   * another speed, jumped to its end or dropped.
   *
   * Every pass moves it alike — its shadow, the shading where its faces meet,
   * and what a click or the pointer finds. What a motion takes under the
   * ground the ground hides, whether or not one is drawn there.
   *
   * A building takes one motion at a time; starting another takes it from the
   * one before. A motion outlives the tile it started on: a tile thrown out
   * for memory and fetched again stands its building where the motion has got
   * to. At most 255 buildings move at once; past that this throws.
   *
   * @example
   * // Pushed on the side that was clicked, the building tips away and comes back
   * buildings.on('click', ({ building }) => {
   *   buildings.animate(building.id, [{}, { tilt: [90, 8], offset: 0.3, easing: 'ease-out' }, {}], {
   *     duration: 800,
   *   })
   * })
   *
   * @example
   * // Grows while the pointer is on it, and shrinks back from wherever it got to
   * let grown
   * buildings.on('hover', ({ building }) => {
   *   grown?.reverse()
   *   grown = building
   *     ? buildings.animate(building.id, [{}, { scale: 1.3 }], { duration: 300, fill: 'forwards' })
   *     : undefined
   * })
   */
  animate(id: string, keyframes: readonly BuildingKeyframe[], timing: Timing): Animation {
    return this.motions.animate(id, keyframes, timing)
  }

  /**
   * Plays one motion over every building at once — a city rising together, or,
   * given a place to spread from, a wave running out through it.
   *
   * Nothing is kept about the buildings. What is written down is the motion
   * itself and where and when it started, in a short list every corner reads,
   * and a corner adds up whatever is still running — so two of these land on
   * top of one another the way waves do, and a page may send them as fast as
   * it likes. A building caught by a second while it is halfway up is not
   * dropped by it; it is carried further.
   *
   * A building can be moved, can stand taller or shorter about its own foot,
   * and can be pushed out from the place the motion spreads from. It is not
   * widened: that would want the middle of every foot in the city carried on
   * every corner of it.
   *
   * Where it differs from place to place is a {@link CrowdField}: a square of
   * ground stamped down where the motion starts, saying when a building there
   * begins and how much of the keyframes it takes. Both are written as
   * functions and read once, so a ring, a line rolling across, a spiral or a
   * checkerboard are all the page's to write and none of them is a feature
   * here. Left out, every building moves together.
   *
   * Both readings are the layer's, not the motion's: sending another of a
   * different shape while one is still running changes the one running too. A
   * page that wants two shapes at once wants two cities.
   *
   * Nothing is handed back and nothing chooses which buildings take part: what
   * moves is not the buildings but the ground under them, and the ground is
   * finished with a motion the moment it has passed. A page that wants one
   * building to do something of its own wants {@link Buildings.animate}.
   *
   * @example
   * // The whole city ducking, all together
   * buildings.animateAll([{}, { translate: [0, 0, -12] }, {}], { duration: 700 })
   *
   * @example
   * // A ring running out from where the ground was clicked
   * ground.on('click', ({ position }) => {
   *   buildings.animateAll([{}, { translate: [0, 0, 20] }, {}], {
   *     from: [position.lng, position.lat],
   *     duration: 900,
   *     field: {
   *       radius: 400,
   *       delay: ([east, north]) => Math.hypot(east, north) / 250,
   *       strength: ([east, north]) => 1 - Math.hypot(east, north) / 400,
   *     },
   *   })
   * })
   */
  animateAll(keyframes: readonly CrowdKeyframe[], options: CrowdOptions = {}): void {
    this.crowds.shape = shapeOf(keyframes, options)
    this.crowds.field = options.field
    const from = options.from
    const at = from ? { x: lonToX(from[0]), z: -latToY(from[1]) } : undefined
    this.crowds.strike(at, performance.now() / 1000, 1)
  }

  /**
   * How far a corner is moved by the motions still running.
   *
   * Asked where the corner stands on the world rather than where it stands in
   * its tile, since a motion that spreads does so from a place on the world.
   * The corner's own resting place is what is asked about — the matrix is the
   * mesh's, and the corner has not been moved yet — so a building already up
   * in the air is not thrown from where the air is.
   *
   * How high it stands over its own foot is that same resting height, less
   * whatever of it is still under the ground on the way up: the one a `rise`
   * in the keyframes is measured against.
   */
  private thrown(under: Node<'float'>): Node<'vec3'> {
    const onWorld = modelWorldMatrix.mul(vec4(positionLocal, 1))
    return this.crowds.movedBy(onWorld.xz as Node<'vec2'>, positionLocal.y.sub(under) as Node<'float'>)
  }

  // ── Events ────────────────────────────────────────────────

  /**
   * Listens for a building being clicked, or the pointer coming onto one.
   * Hands back the way to stop.
   *
   * Nothing on screen changes for either: what a click or a hover shows is
   * the listener's to decide.
   */
  on<K extends keyof BuildingEvents>(type: K, listener: (event: BuildingEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof BuildingEvents>(type: K, listener: (event: BuildingEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /**
   * Whose data is standing at the moment: PLATEAU's buildings, and the GSI's
   * tiles with them — the roads a wall is turned to decide where its windows
   * go, so they are used even though they are not drawn here.
   *
   * The GSI only where those roads were read. A city asked for without windows
   * never fetches them, and naming a source it did not use is as wrong as
   * leaving out one it did.
   */
  credits(): readonly Credit[] {
    // Turned off, what it holds is hidden and names nobody: the count on
    // screen is the last one taken before the frames stopped looking
    if (!this.root.visible || this.tiles.onScreen === 0) return []
    return this.glazed ? [PLATEAU_CREDIT, GSI_CREDIT] : [PLATEAU_CREDIT]
  }

  /**
   * How many tiles the city holds, standing or on their way, and how many of
   * those are on screen — the same two the land counts ({@link Ground.tileCount}).
   */
  get tileCount(): { readonly held: number; readonly onScreen: number } {
    return { held: this.tiles.size, onScreen: this.tiles.onScreen }
  }

  /**
   * Whether anything is still on its way; see {@link Layer.busy}.
   *
   * Three things to wait on and not one. A tile may be fetching; a city may
   * not have said yet where its buildings are, and until it does nothing can
   * even be asked for; and a tile that has arrived is shaped one a frame, so
   * the last of them is still not standing when the set says it is done.
   */
  busy(): boolean {
    return this.tiles.busy || this.citiesComing.length > 0 || this.landing.length > 0
  }

  /**
   * Says how much city a shape standing on the map has asked for, where it is
   * more than anyone is likely to have meant. Once per mask.
   */
  private sayIfVast(viewer: Viewer, tiles: number): void {
    const area = viewer.maskArea
    if (viewer.screenPicks || !area) return
    if (this.spokeOf === area) return
    this.spokeOf = area
    if (tiles <= TILES_WORTH_SAYING) return
    console.warn(
      `[plateau-ui] The mask stands on the map, so the whole of it is fetched: ${tiles} tiles of buildings. ` +
        'Every one is held for as long as the mask is. Make the shape smaller, let it ride the camera, ' +
        "or give the mask `fetch: 'onScreen'` to have it come as the view reaches it.",
    )
  }

  /** Tells the turn from fetching to having it all, once; see {@link Ground.sayIfLanded}. */
  private sayIfStood(): void {
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy) this.events.emit('loaded', { tiles: this.tiles.size })
  }

  /**
   * Tells the turn into rest, once; see {@link BuildingEvents.idle}.
   *
   * By the clock each trip was set to rather than by the maps the frame
   * empties as trips end: those are emptied only while the city is shown, and
   * a page that turned the city off and waits on this would wait for good.
   */
  private sayIfIdle(): void {
    const seconds = performance.now() / 1000
    const idle = !this.busy() && !this.underWay(seconds)
    if (idle === this.wasIdle) return
    this.wasIdle = idle
    if (idle) this.events.emit('idle', { tiles: this.tiles.size })
  }

  /**
   * Whether any building is still coming up or going back under: a tile
   * landing, the whole city leaving, or one building a page took out.
   */
  private underWay(seconds: number): boolean {
    if (this.leaving !== null && seconds < this.leaving) return true
    for (const until of this.growing.values()) if (seconds < until) return true
    for (const { until } of this.sinking.values()) if (seconds < until) return true
    return false
  }

  /**
   * Cuts the parapets on screen again, to the size {@link parapet} now says or
   * away altogether. What the part calls whenever a page writes to it.
   *
   * Each mesh kept the plan of its roofs and the shape they came in, so a new
   * size is cut from the roofs as they were rather than from the last carving.
   */
  private recut(): void {
    // The top row of windows hangs from the building's ceiling, less whatever
    // parapet stands on a flat one, so it follows the size without the walls
    // being read again.
    this.paint.parapetDepth = parapetSize(this.parapet)?.depth ?? 0
    this.refresh()
  }

  /**
   * Writes everything {@link windows} says that the paint reads: whether they
   * are drawn, how they melt, their sizes, and the colour of every usage's
   * glass and bars.
   *
   * All of it on every change, from the one place: twenty usages of numbers is
   * nothing to write, and one writer cannot leave half of it behind. The
   * colours want the viewer's palette and are left until it is on one; the
   * viewer tells a layer its colours as it takes it on.
   */
  private repaintWindows(): void {
    const windows = this.windows
    this.paint.on = windows.visible
    this.paint.melt = windows.melt
    this.paint.styles = windows.styles
    this.paint.highRise = { storeys: windows.highRiseStoreys, padTop: windows.highRisePadTop }
    if (!this.viewer) return
    this.paint.paintColours(
      (usage) => this.windowColorOf(usage, 'glass'),
      (usage) => this.windowColorOf(usage, 'mullion'),
    )
  }

  /**
   * The colour one usage's glass or bars is drawn in, from the one order every
   * hand is taken in; see `windowColour`. What the paint is written from and
   * what `windows.colorOf` answers, so the two cannot part. Before there is a
   * viewer, against the day's palette.
   */
  private windowColorOf(usage: BuildingUsage, part: 'glass' | 'mullion'): ColorRepresentation {
    const windows = this.windows
    const viewer = this.viewer
    const night = viewer?.night ?? false
    const palette = viewer?.colors ?? LIGHT
    const themed = viewer ? viewer.theme[part === 'glass' ? 'window' : 'mullion'] !== undefined : false
    const style = windows.styles[usage]
    const library = LIBRARY_WINDOW_COLOURS[usage]
    return part === 'glass'
      ? windowColour(style.color, windows.color, themed, library?.color, palette.window, night)
      : windowColour(
          style.mullionColor,
          windows.mullionColor,
          themed,
          library?.mullionColor,
          palette.mullion,
          night,
        )
  }

  /**
   * Stands the tiles again where what their walls were read with is out of
   * date and the windows are there to show it, and says whether it did.
   *
   * `changed` is a setting that decides where a window may be cut, which every
   * tile standing was read with; without it, this is the windows being turned
   * on, which is only worth a trip where the tiles were not read for them.
   * Either way nothing is stood again while the windows are off — the walls
   * would be read for nobody to see — and it is remembered for when they come
   * on. The same trip the land's heights ask for, and the same picture: the
   * city standing up where it already was.
   */
  private reread(changed: boolean): boolean {
    if (changed) this.refitDue = true
    if (!this.windows.visible) return false
    if (this.glazed && !this.refitDue) return false
    this.glazed = true
    this.refitDue = false
    this.standAgain()
    return true
  }

  /**
   * Writes what the city is drawn in where it is not the same everywhere the
   * palette is: the walls, the roofs, the fold lines. Each a page left out
   * follows the palette; each it said holds through a change of palette, and
   * a {@link ThemeColor} pair is read for the one now standing.
   *
   * Left until the layer is on a viewer, since the palette is the viewer's;
   * the viewer tells a layer its colours as it takes it on.
   */
  private repaint(): void {
    const viewer = this.viewer
    if (!viewer) return
    const { night, colors: palette } = viewer
    const wall = this._wallColor === undefined ? palette.wall : colorFor(this._wallColor, night)
    this.material.color.set(wall)
    this.roofColour.value.set(this._roofColor === undefined ? wall : colorFor(this._roofColor, night))
    this.folds.colour = this._edgeColor === undefined ? palette.edge : colorFor(this._edgeColor, night)
  }

  /**
   * The walls, or nothing for the palette's `wall`. Written, the walls of the
   * city change before the next frame; see {@link BuildingsOptions.wallColor}.
   *
   * A building a page painted with {@link setStyle} keeps its own colour over
   * this one: that is said of one building, and this of all of them.
   */
  get wallColor(): ThemeColor | undefined {
    return this._wallColor
  }

  set wallColor(value: ThemeColor | undefined) {
    this._wallColor = value
    this.repaint()
  }

  /** The roofs, or nothing for whatever the walls are drawn in; see {@link BuildingsOptions.roofColor}. */
  get roofColor(): ThemeColor | undefined {
    return this._roofColor
  }

  set roofColor(value: ThemeColor | undefined) {
    this._roofColor = value
    this.repaint()
  }

  /**
   * Whether the city carries its own light: drawn in the colours asked for on
   * every face, at every hour, in every shadow. `false` by default, so the sun
   * shades it.
   *
   * What every building does unless it said otherwise itself
   * ({@link BuildingStyle.glows}), so a glowing city with one shaded landmark
   * in it is this and one {@link setStyle}. One number, read a fragment at a
   * time, so it changes nothing compiled.
   */
  get glows(): boolean {
    return this._glows
  }

  /** Whether the city throws the sun's shadows; see {@link BuildingsOptions.castShadow}. */
  get castShadow(): boolean {
    return this._castShadow
  }

  set castShadow(on: boolean) {
    if (on === this._castShadow) return
    this._castShadow = on
    this.eachMesh((mesh) => (mesh.castShadow = on))
    this.viewer?.stirShadows()
  }

  /** Whether the city takes part in the shading of corners; see {@link BuildingsOptions.occludes}. */
  get occludes(): boolean {
    return this._occludes
  }

  set occludes(on: boolean) {
    if (on === this._occludes) return
    this._occludes = on
    this.eachMesh((mesh) => setOccludes(mesh, on))
  }

  private _castShadow: boolean
  private _occludes: boolean

  set glows(on: boolean) {
    this._glows = on
    this.styles.glowing = on
  }

  /** The colour of the fold lines, or nothing for the palette's `edge`. */
  get edgeColor(): ThemeColor | undefined {
    return this._edgeColor
  }

  set edgeColor(value: ThemeColor | undefined) {
    this._edgeColor = value
    this.repaint()
  }

  /**
   * How wide the fold lines are drawn, in pixels of the page. 1 by default.
   *
   * Pixels rather than metres because a fold line is drawn to be read, not to
   * be measured: it stays as fine stepping out as it is stepping in, where a
   * line in metres would thicken into a smear over the city and vanish up
   * close. One width for every line, since they are one shape read by one
   * material.
   */
  get edgeWidth(): number {
    return this._edgeWidth
  }

  set edgeWidth(value: number) {
    this._edgeWidth = pixels(value, 'edgeWidth')
    this.folds.width = this._edgeWidth
  }

  /**
   * How tall a storey is taken to be where a building does not say how many
   * it has, in metres; see {@link BuildingsOptions.storeyHeight}.
   *
   * The windows are set out by it as a tile lands, so changing it stands the
   * tiles again while they are drawn — and while they are not, waits for them
   * to be turned on. The bands round a storey read it as a building is marked,
   * and are marked again at once. Which storey a click lands on is worked out
   * when asked, and follows by itself.
   */
  get storeyHeight(): number {
    return this._storeyHeight
  }

  set storeyHeight(value: number) {
    const next = positiveMetres(value, 'storeyHeight')
    if (next === this._storeyHeight) return
    this._storeyHeight = next
    // A city stood again marks every tile as it lands, bands and all
    if (!this.reread(true)) this.remarkAll()
  }

  /**
   * How close the view must be for the city to stand, or false where no zoom
   * is too far out; see {@link BuildingsOptions.minZoom}.
   */
  get minZoom(): number | false {
    return this._minZoom
  }

  set minZoom(value: number | false) {
    const held = cityMinZoomOf(value)
    if (held === this._minZoom) return
    this._minZoom = held
    // What is fetched and what stands both turn on this, so the tiles are
    // chosen again from where the view happens to be
    this.dirty = true
  }

  /** Drawn at all. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (this.root.visible === value) return
    this.root.visible = value
    // The sun's map is held from one frame to the next and only redrawn where
    // something it holds has moved, so a city taken off screen without a word
    // leaves its shadow printed on the land — nothing else about the frame
    // changes, and nothing asks for the map again
    this.viewer?.stirShadows()
    // Nothing was chosen while it was off, and the view may have gone anywhere
    if (value) this.dirty = true
  }

  /**
   * Whether a mesh is worth reading for its lines.
   *
   * The city's own fold lines and nothing else. The line round a building a
   * page pointed at is not cut from the shape at all: it is found on the
   * screen, over the finished picture; see {@link Outlines}.
   */
  private get linesWanted(): boolean {
    return this._edges
  }

  /**
   * Whether a line is drawn along the edges where the buildings fold; see
   * {@link BuildingsOptions.edges}. Their colour and width are
   * {@link edgeColor} and {@link edgeWidth}, kept while they are off.
   *
   * Not the line round a building a page points at, which is one building's
   * and is {@link BuildingStyle.outline}.
   */
  get edges(): boolean {
    return this._edges
  }

  /**
   * Draws the fold lines or leaves them off.
   *
   * Like the parapets, a mesh is only read for its folds while the lines are
   * on, so a city that never shows them never pays for them. Turning them on
   * traces the meshes on screen there and then, up to a tenth of a second
   * for a screen of twelve tiles.
   * Turning them off only hides the lines, and turning them on again shows
   * them as they were.
   */
  set edges(on: boolean) {
    this._edges = on
    this.folds.visible = on
    if (on) this.refresh()
  }

  /**
   * How the walls on screen took to the windows: how many were dressed, and
   * how many were passed over for looking at nothing, for being shut in by a
   * neighbour, or for being too small to hold one.
   */
  get windowTally(): WindowTally {
    let dressed = 0
    let blind = 0
    let small = 0
    let crowded = 0
    this.onScreen((mesh) => {
      const tally = mesh.userData[WINDOW_FITTING] as WindowTally | undefined
      if (!tally) return
      dressed += tally.dressed
      blind += tally.blind
      small += tally.small
      crowded += tally.crowded
    })
    return { dressed, blind, small, crowded }
  }

  /**
   * How the roofs on screen took to the parapet: how many were cut, and how
   * many were passed over for being too small or too narrow to hold one.
   *
   * A roof passed over looks like one that was never found, so without this
   * a size that quietly carves nothing cannot be told from a view with no
   * flat roofs in it.
   */
  get parapetTally(): RoofTally {
    let cut = 0
    let tooSmall = 0
    let tooNarrow = 0
    this.onScreen((mesh) => {
      const tally = roofTallyOf(mesh)
      if (!tally) return
      cut += tally.cut
      tooSmall += tally.tooSmall
      tooNarrow += tally.tooNarrow
    })
    return { cut, tooSmall, tooNarrow }
  }

  /**
   * Brings every mesh on screen up to the settings: cut to the parapet size
   * asked for now, and traced where the fold lines are on.
   */
  private refresh(): void {
    this.onScreen((mesh) => {
      let changed = false
      // A shape cut again leaves the lines along the old one behind, and the
      // corners it adds say nothing about the motions moving their building
      if (carveMesh(mesh, parapetSize(this.parapet))) {
        this.folds.clear(mesh)
        // The standing only; the marking waits for the foot of this callback
        this.restand(mesh)
        // The corners carving adds say nothing of when they move either, and
        // a mesh cut long after it landed has come, or gone, already
        const over = -appearStagger() - appearTakes()
        stampAppear(mesh, over, appearStagger(), this.leaving === null ? 'up' : 'down')
        // Its lines went with the shape they were cut from, and the ones cut
        // from the new shape are told below, as they are made
        changed = true
      }
      if (this.linesWanted) {
        this.folds.trace(mesh, this.hidden.outOf(mesh))
        changed = true
      }
      // Once, after whatever changed has changed. The corners a carve added
      // and the lines a trace made both read what a page decided, and marking
      // between the two is a walk of every corner for half an answer — which
      // is what turning the parapets with the fold lines on used to pay twice.
      if (changed) this.mark(mesh)
    })
  }

  /**
   * Sets a tile's buildings rising out of the ground as it lands, and its
   * lines with them.
   *
   * The lines follow rather than waiting: they are their own geometry and
   * carry their own copy of what the corners were just told, which `follow`
   * writes from those very corners. Held back, as they were, a tile landed
   * with its buildings coming up bare and their folds drawn on a second later.
   */
  private beginGrowing(meshes: readonly Mesh[]): void {
    if (appearTakes() <= 0) return
    const at = performance.now() / 1000
    for (const mesh of meshes) {
      stampAppear(mesh, at, appearStagger(), 'up')
      this.folds.follow(mesh)
      this.growing.set(mesh, doneBy(at, appearTakes(), appearStagger()))
    }
  }

  /**
   * Lets go of the meshes that have finished rising.
   *
   * What is kept while they rise is which of them can still be turned round
   * where they stand rather than stamped afresh; see {@link beginLeaving}.
   */
  private forgetGrown(seconds: number): void {
    if (this.growing.size === 0) return
    for (const [mesh, until] of this.growing) {
      if (seconds < until && mesh.parent) continue
      this.growing.delete(mesh)
    }
  }

  /**
   * Sends every building back under the ground, the way it came, and holds
   * its tile until it is there.
   *
   * A view stepping out of the zooms buildings stand at would otherwise take a
   * whole city off between two frames — the more jarring for the ground being
   * left behind, so that the city alone blinks out. Sunk, they leave the way
   * they arrived and the ground is bare by the time the tiles are let go.
   *
   * Nothing more is fetched for a view on its way out: a tile still coming
   * would land alone into a city that is leaving, and rise as the rest sank.
   */
  private beginLeaving(): void {
    if (this.leaving !== null) return
    if (appearTakes() <= 0 || this.tiles.size === 0) {
      this.letCityGo()
      return
    }
    this.tiles.dropLoading()

    const at = performance.now() / 1000
    let until = 0
    this.eachCityMesh((mesh) => {
      // One still on its way up turns round where it stands rather than
      // standing the rest of the way up only to fall
      let done: number
      if (this.growing.delete(mesh)) {
        done = turnBack(mesh, at)
      } else {
        stampAppear(mesh, at, appearStagger(), 'down')
        done = doneBy(at, appearTakes(), appearStagger())
      }
      until = Math.max(until, done)
      // ...and the lines go down with the walls they are drawn along
      this.folds.follow(mesh)
    })
    if (until === 0) {
      this.letCityGo()
      return
    }
    this.leaving = until
  }

  /**
   * Lets the city's tiles go once it has gone under. All of them where the
   * page stood nothing of its own; where it did, only the city's, and what
   * the page named is held on to.
   */
  private letCityGo(): void {
    // A city building a page moved went under with the city, and goes with it:
    // it is fetched again where it was put when the city comes back
    this.byName = this.byName.filter((fetch) => !this.replicas.get(fetch.key)?.ofCity)
    if (this.byName.length === 0 && ![...this.replicas.values()].some((replica) => !replica.ofCity)) {
      this.tiles.clear()
      return
    }
    this.covering = []
    this.handOver()
  }

  /** Every mesh of the city's own tiles: everything but the buildings a page stood; see {@link placed}. */
  private eachCityMesh(visit: (mesh: Mesh) => void): void {
    if (this.placed.size === 0) {
      this.eachMesh(visit)
      return
    }
    // A city building a page moved goes with the city; one a page brought stays
    const replicas = new Set<Object3D>()
    for (const [id, { group }] of this.placed) if (!this.replicas.get(id)?.ofCity) replicas.add(group)
    this.eachMesh((mesh) => {
      let at: Object3D | null = mesh
      while (at && at !== this.root) {
        if (replicas.has(at)) return
        at = at.parent
      }
      visit(mesh)
    })
  }

  /**
   * Turns the buildings round again, where the view came back to the zooms
   * they stand at before the last of them was under.
   */
  private comeBack(): void {
    if (this.leaving === null) return
    this.leaving = null
    const at = performance.now() / 1000
    this.eachCityMesh((mesh) => {
      this.growing.set(mesh, turnBack(mesh, at))
      // Time was folded about this moment on the corners; the lines are told
      // by reading them, so a fold is written the once
      this.folds.follow(mesh)
    })
  }

  /** Every building mesh of every tile being shown. */
  private onScreen(visit: (mesh: Mesh) => void): void {
    this.eachMesh(visit, true)
  }

  /**
   * Paints some of the buildings, or takes the paint off them with `null`.
   *
   * Three ways to say which: the name PLATEAU gives one building, a rule asked
   * of every building, or a shape to stand on. A page may paint a building
   * whose tile has yet to land — the paint is held by name, so it stays on it
   * when that tile is thrown out for memory and fetched again as a mesh of its
   * own, and a rule is asked again of every tile that lands.
   *
   * What is painted is written into a table the shaders read, so this costs
   * neither a shape nor a material: a building can be painted as the pointer
   * passes over it. See {@link BuildingStyle}.
   *
   * The whole of what that building wears, replaced: what the style leaves out
   * goes back to what the layer draws every building in, not to what was
   * there before. To change one field, spread what is there —
   * `buildings.setStyle(id, { ...buildings.getStyle(id), outline: true })`.
   *
   * A method because it takes a key — which buildings — where the layer's own
   * look is properties (`buildings.wallColor`), which say what every building
   * is drawn in. This is about fewer of them than those are, so where both
   * say something, this wins.
   *
   * A building a page stood itself ({@link bring}) is painted through here
   * too, under its own {@link ReplicaBuilding.id}. It is drawn in the city's
   * material and table as the city's own are, so the door is the same.
   */
  setStyle(building: string, style: BuildingStyle | null): this
  setStyle(rule: BuildingRule, style: SharedStyle | null): this
  setStyle(site: MaskShape, style: SharedStyle | null): this
  setStyle(a: string | BuildingRule | MaskShape, b: BuildingStyle | null): this {
    // One building, by the name PLATEAU gives it
    if (typeof a === 'string') {
      this.styles.set(a, b ?? null)
      const found = this.standing(a)
      if (found) this.mark(found.mesh)
      return this
    }
    // Whichever buildings a rule picks, asked again as tiles land
    if (typeof a === 'function') {
      this.styles.setRule(a, b ?? null)
      this.remarkAll()
      return this
    }
    // Every building standing on a shape — the same shapes `hide` takes, a
    // circle, a box or a ring of corners — judged the same way, by every
    // corner of a building's foot; see {@link feetOn}.
    //
    // A page that has a district already has its outline; telling the layer
    // that outline is less to write and more to read than a rule that says
    // the same thing in arithmetic.
    if (isSite(a)) {
      this.styles.setSite(a, b ?? null)
      this.remarkAll()
      return this
    }
    return this
  }

  /**
   * What was asked of one building by name, or null if nothing was — the
   * other half of {@link setStyle}, pictures and all.
   *
   * A frozen copy: what is written into it goes nowhere, and says so by
   * throwing in a module rather than by doing nothing. The pictures are the
   * page's own, by reference. Only what was named — a building a rule or a
   * shape picked is answered by the rule, which the page already holds.
   *
   * `get` because it takes a key, as Mapbox's `getStyle`, `getFilter` and
   * `getPaintProperty` pair with their `set`s. It was `styleOf` until
   * 2026-10-29.
   */
  getStyle(building: string): Readonly<BuildingStyle> | null {
    return this.styles.askedOf(building)
  }

  /**
   * Says that a picture a style carries has been drawn on again.
   *
   * A page with a clock on a roof redraws its canvas every second, and nothing
   * here can see that it changed — the picture was taken into a layer of its
   * own when the style was handed over. A picture no style carries is ignored.
   */
  refreshImage(image: DecalImage): this {
    this.styles.refreshImage(image)
    return this
  }

  /**
   * Every building whose foot falls inside a rectangle of the canvas, in
   * pixels from its top left.
   *
   * What a rectangle over the picture holds is a question only the layer that
   * drew the things can answer. Drawing the rectangle is not: which button and
   * which key pick several things out is a page's to settle, and the viewer
   * takes no modifier of its own so that a page may. So the page says where
   * its rectangle landed and this says what was inside it.
   *
   * Judged by the middle of a building's foot rather than by the whole of it,
   * which is the one place in the layer that is: a building is picked when
   * the place it stands is inside, which is what a rectangle dragged over a
   * plan is understood to mean, and a tower leaning half over the line is in
   * or out by its feet. A shape a page hands over is judged the other way —
   * see {@link feetOn} — because there the line is drawn on the ground and
   * means the ground, where a rectangle is drawn on the picture and means
   * what the reader can see in it.
   *
   * Only what is standing, and only what is drawn. A tile still on its way
   * holds buildings nobody can see, and so does a tile whose buildings a page
   * hid or the mask took out — their fragments are thrown away in the shader,
   * so a rectangle dragged over bare ground inside the mask's own box would
   * otherwise come back full of buildings the reader cannot see.
   *
   * The land is added before the foot is projected. A building's corners are
   * metres above its own ground and the ground goes on at the last moment, in
   * the shader (see `underfoot.ts`) — so a foot taken off the mesh and
   * projected as it stands is a foot at sea level. In 御殿場 that is 500m
   * under the building anybody drew a rectangle round, which at a tilt is
   * most of a screen: every building answered that it was somewhere else
   * (measured: 28 of 354 on screen).
   */
  within(x0: number, y0: number, x1: number, y1: number): Building[] {
    const viewer = this.viewer
    // Only what is drawn, and turned off nothing is
    if (!viewer || !this.root.visible) return []
    const { width, height } = viewer.canvasSize
    if (width === 0 || height === 0) return []
    const land = viewer.elevation ? heightsInHand() : null
    const found: Building[] = []
    this.eachMesh((mesh) => {
      mesh.updateWorldMatrix(true, false)
      const out = this.notDrawn(mesh)
      const feet = feetOf(mesh)
      for (const [building, foot] of feet) {
        if (out?.has(building)) continue
        this.corner.set(foot.x, 0, foot.z).applyMatrix4(mesh.matrixWorld)
        if (land) {
          const lat = yToLat(-this.corner.z)
          this.corner.y += land.at(this.corner.x, -this.corner.z) / metersPerUnit(lat)
        }
        this.corner.project(viewer.threeCamera)
        const x = ((this.corner.x + 1) / 2) * width
        const y = ((1 - this.corner.y) / 2) * height
        if (x < x0 || x > x1 || y < y0 || y > y1) continue
        const told = toldOf(mesh, building, () => feet)
        if (told) found.push(told)
      }
    })
    return found
  }

  /**
   * Asks every rule again.
   *
   * A rule is a function, and what it reads is the page's own: a set of ids
   * that grew, a switch that was thrown. The layer cannot know when that
   * changed, so this is how a page says so — the rules stay as they are and
   * every building on screen is put to them afresh.
   */
  restyle(): this {
    this.remarkAll()
    return this
  }

  /** Takes the paint off every building, leaving the city as the palette draws it. */
  clearStyles(): this {
    this.styles.clear()
    this.remarkAll()
    return this
  }

  /** Writes what a page has decided onto every mesh on screen, afresh. */
  private remarkAll(): void {
    this.eachMesh((mesh) => this.mark(mesh))
    // What a corner is marked with is what the sun's map draws too: a building
    // a page has taken out is dropped from the map's pass by the same slot,
    // and a parapet cut away changes the shape that casts. The map is held
    // between frames, so without a word here a hidden building goes on casting
    // on a still view. Called from the handles and the mask, never from the
    // frame, so saying it here costs one redraw where a page asked for one.
    this.viewer?.stirShadows()
  }

  /**
   * Stands a building somewhere else, or turns it to look another way; `null`
   * puts it back where the survey has it. What is left out is left as it is,
   * so a page may move one without turning it.
   *
   * Any building: one of the city's, by the name PLATEAU gives it, or one a
   * page brought ({@link bring}), by the name it was given. What is put on it —
   * a mark, a solid, a model, a picture, its paint — goes with it.
   *
   * **A city building has to be in hand** — one whose tile has landed, on the
   * screen or held — and one that is not is said so once and left: a gml:id
   * says nothing about where the building is, so there is nowhere to look for
   * one that has never been seen (`bring` takes a clue for that, `findAt`).
   * Moved, it is taken out of the tile it came in and stood on its own, under
   * its own name, as a brought one is; the one left in the tile is not drawn
   * from the moment it stands. It stays where it was put while the view goes
   * elsewhere, and goes under with the rest of the city when the view steps out
   * of the zooms buildings stand at, and comes back up where it was put.
   * `null` puts it back in the tile it came in.
   *
   * _(2026-11-03, the user's design. Only a brought building could be moved,
   * through `tower.place(…)`, and a city building's name was ignored here.)_
   *
   * A brought one may be moved before it is up: where it is to stand is kept
   * with the name and read when its tile lands.
   *
   * A building moved once it is standing has the land read again under where it
   * is going and is stood on that, so it lands on the hill it is moved to
   * rather than on the one it came from. It only shows where the viewer carries
   * the land's heights, which it does not by default.
   *
   * Moved onto ground nobody has read yet, it stands on what is in hand — over
   * ground nobody has read, nought — until the reading arrives and lifts it.
   * Moved to somewhere in view it is already in hand, since whoever draws the
   * ground has read it.
   *
   * The hem does not follow it: that is the slope of the place it was surveyed
   * on, cut into its corners. One already cut cannot be taken back out, so what
   * was let down stays drawn and is simply no longer measuring anything; a
   * building that was moved before its tile was shaped never had one.
   */
  place(building: string, where: BuildingPlace | null): this {
    const replica = this.replicas.get(building)
    if (!replica) {
      if (where !== null) this.moveCity(building, where)
      return this
    }
    if (where === null && replica.ofCity) {
      this.putBack(building)
      return this
    }
    const wanted = replica.wanted()
    replica.moved(where)
    const next = replica.wanted()
    const standing = this.placed.get(building)
    if (!standing) return this
    hang(standing.group, standing.foot, next.at ?? standing.surveyed, next.facing ?? 0)
    // Moved where nothing else can see it: the sun's map is held between frames
    // and kept while the view and everything in it stay put, so unsaid, the
    // shadow stayed where the building had been until the view next moved —
    // the map was drawn 0 times for a building in hand moved a second time
    // (counted, 2026-11-04). A turn as much as a move, so said before the
    // early return below
    this.viewer?.stirShadows()
    // Only where it has gone somewhere else. Turning a building moves it about
    // the point it stands on, so the ground under it is the ground it already
    // had, and reading the land again for every turn of a spinning building
    // would be a tile of readings a frame.
    const to = next.at ?? standing.surveyed
    if (samePlace(wanted.at ?? standing.surveyed, to)) return this
    const found = this.standing(building)
    if (found) {
      // The mask judges a building by where it stands, so one that has just
      // been carried somewhere else is put to it again — whether or not the
      // land carries heights, which is all `reground` is about
      this.mark(found.mesh)
      this.reground(found.mesh, found.at, to, building)
    }
    return this
  }

  /**
   * Takes a city building out of its tile to stand it somewhere else; see
   * {@link place}.
   *
   * Through the same door as `bring`: a replica under the building's own name,
   * which fetches its tile for it alone and hangs it on its own. Where to look
   * is where the building stands now, which is why it has to be in hand. The
   * tile it came in goes on drawing it until the one on its own stands
   * ({@link movedOutOf}), so it does not blink out for the fetch.
   */
  private moveCity(building: string, where: BuildingPlace): void {
    const found = this.standing(building)
    const told = found ? toldOf(found.mesh, found.at) : null
    if (!told) {
      if (!this.saidNotInHand.has(building)) {
        this.saidNotInHand.add(building)
        console.warn(
          `[plateau-ui] Buildings: \`place\` was given ${building}, which is not in hand, so it is not moved. ` +
            'A city building can be moved once its tile has landed — after `loaded`, or from a click.',
        )
      }
      return
    }
    const findAt: [number, number] = [told.position.lng, told.position.lat]
    const replica = new ReplicaBuilding(this, { id: building, findAt, ...where }, true)
    this.replicas.set(building, replica)
    this.dirty = true
  }

  /**
   * Puts a city building a page moved back in the tile it came in: lets go of
   * the one standing on its own and draws the one in the tile again. What was
   * put on it stays — its paint is kept by its name, which it never stopped
   * having.
   */
  private putBack(building: string): void {
    this.replicas.delete(building)
    this.placed.delete(building)
    this.told.delete(building)
    this.stood.delete(building)
    this.absent.delete(building)
    this.byName = this.byName.filter((fetch) => fetch.key !== building)
    this.handOver()
    this.markWhereItCameFrom(building)
  }

  /**
   * Marks again the meshes of the city that carry a building a page moved, so
   * the one in its tile is drawn or not as the move now says; see
   * {@link movedOutOf}.
   *
   * The motion rows as well as the paint, which is {@link remark} rather than
   * the paint's own {@link mark}. While the building stood on its own, what
   * moved it was written on that one's corners; the ones in its tile kept
   * whatever row they last had, which may since have gone back to the table
   * and be another building's. Put back with only the paint marked, it stood
   * still under a motion still playing (seen, 2026-11-04). Written afresh,
   * its corners read the row of whatever moves it now, and nothing else.
   */
  private markWhereItCameFrom(building: string): void {
    this.eachMesh((mesh) => {
      if (mesh.userData[STOOD_ALONE]) return
      const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
      if (facts?.ids.includes(building)) this.remark(mesh)
    })
  }

  /**
   * The buildings of a city mesh a page moved out of it: drawn in a tile of
   * their own now, and not here. Only once that one stands — until then the
   * tile goes on drawing it, so a building being moved does not blink out
   * while its own tile is fetched.
   */
  private movedOutOf(mesh: Mesh): ReadonlySet<number> | null {
    if (mesh.userData[STOOD_ALONE]) return null
    const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
    if (!facts) return null
    let out: Set<number> | null = null
    for (const [id, replica] of this.replicas) {
      if (!replica.ofCity || !this.placed.has(id)) continue
      const at = facts.ids.indexOf(id)
      if (at >= 0) (out ??= new Set()).add(at)
    }
    return out
  }

  /**
   * Stands a named building on the ground under the place it has just been
   * moved to.
   *
   * Twice, because {@link place} is synchronous and asking for a tile of
   * readings is not. What is already in hand is written at once, which is the
   * whole answer in the ordinary case — a page moves a building to where it is
   * looking, and whoever draws the ground has read the land there — and the ask
   * that follows corrects it where the place is one nobody has read yet.
   *
   * Nothing is fetched or shaped again: what a building stands on rides beside
   * its corners rather than in them (see `underfoot.ts`), so this is a write.
   */
  private reground(mesh: Mesh, at: number, to: readonly [number, number], building: string): void {
    if (!this.viewer?.elevation) return
    const x = lonToX(to[0])
    const y = latToY(to[1])
    this.standMovedOn(mesh, at, heightsInHand().at(x, y))
    void this.readGround(building, to, x, y)
  }

  /**
   * Stands one building of a cut-down mesh on a height, and cuts its lines
   * again.
   *
   * The lines do not ride the attribute the walls do. A line is its own
   * geometry carrying its own copy of what its building's corners knew, and the
   * land is worked into its ends as it is traced rather than added as it is
   * drawn (see `Edges.trace`) — so a building stood on other ground would
   * keep its outline drawn on the old.
   */
  private standMovedOn(mesh: Mesh, at: number, height: number): void {
    standOneOn(mesh, at, height)
    // Lifted or lowered onto the ground it was moved to, which the sun's map,
    // held between frames, cannot see for itself; see {@link place}
    this.viewer?.stirShadows()
    this.folds.clear(mesh)
    if (this.linesWanted) {
      this.folds.trace(mesh, this.hidden.outOf(mesh))
      this.mark(mesh)
    }
  }

  /**
   * Waits for the readings under a place and stands the building on them.
   *
   * Hung on the viewer's own life, and it writes nothing once that is over or
   * once the heights have been turned off — which lets every tile go and shapes
   * them again, so the mesh this was called for is not the one standing.
   *
   * Nor once the building has been moved again: the later call read the land
   * under its own place and this one's answer is about somewhere the building
   * no longer is. A reading that cannot be fetched at all leaves it standing on
   * whatever was in hand, and says so.
   */
  private async readGround(
    building: string,
    to: readonly [number, number],
    x: number,
    y: number,
  ): Promise<void> {
    const signal = this.viewer?.signal
    if (!signal) return
    let land: Heights
    try {
      land = await heightsUnder(justAt({ x, y }), FINEST_HEIGHTS, signal, this.ask)
    } catch (cause) {
      // A tile of heights, named by the building it was wanted under: which of
      // them failed is `elevation.ts`'s business and it hands back no address.
      //
      // Not asked again from here. The same readings are what whoever draws the
      // ground is fetching over the same patch, and one that fails is forgotten
      // there, so the next draw of that ground asks afresh; a page that wants
      // this building tried again moves it again.
      this.failed({ what: 'tile', key: building, retrying: false, cause })
      return
    }
    if (signal.aborted || !this.viewer?.elevation) return
    const standing = this.placed.get(building)
    if (!standing || !samePlace(this.replicas.get(building)?.at ?? standing.surveyed, to)) return
    const found = this.standing(building)
    if (found) this.standMovedOn(found.mesh, found.at, land.at(x, y))
  }

  /**
   * Stands a building of PLATEAU's, named by what it is called and a clue to
   * where to look for it; see {@link ReplicaBuilding}.
   *
   * What comes back is the page's own, with a name of its own, and stays until
   * it is taken away — wherever the view goes, and whether or not the city is
   * fetched beside it — or nothing where the survey turns out not to have it
   * there, which `error` says more about. Asked twice for the one building,
   * two of them stand, each moved and painted on its own.
   *
   * The coordinate is spent on finding the tile, not on drawing: a gml:id
   * alone does not say which dataset to open, since a building id carries the
   * 市's code while the data is published per 区.
   *
   * A mask still cuts it. It is woven into the one material every building
   * shares and throws away every fragment outside the shape, whether the
   * building was stood here or came with its city.
   */
  bring(wanted: BuildingWanted): Promise<ReplicaBuilding | null> {
    const replica = new ReplicaBuilding(this, wanted)
    this.replicas.set(replica.id, replica)
    const stood = new Promise<boolean>((settle) => this.bringing.set(replica.id, settle))
    this.dirty = true
    // Before the tile is so much as asked for, so it lands wearing it: nothing
    // is marked yet, so neither is anything to be seen happening
    if (wanted.style) this.setStyle(replica.id, wanted.style)
    return stood.then((had) => (had ? replica : null))
  }

  /**
   * Tells whoever brought a building how the looking ended, once, and forgets
   * it.
   *
   * Three ways in, and this layer is at all three: the tile landed with it,
   * the tile landed without it, or the name was dropped before either. The
   * last is what keeps the promise from outliving the thing — a name taken
   * away mid-flight would otherwise leave a page awaiting it for the life of
   * the tab, and `dispose` leans on it, since it drops every one it holds.
   *
   * Kept here and not on the replica because `bring` is the only thing that
   * ever waits, and because the looking is per building: one named in a city
   * whose catalog is slow is told when its own tile lands, not when the
   * slowest of five does.
   */
  private settled(id: string, stood: boolean): void {
    const settle = this.bringing.get(id)
    if (!settle) return
    this.bringing.delete(id)
    settle(stood)
  }

  /**
   * @internal Takes one away; see {@link ReplicaBuilding.remove}.
   *
   * Through here and not from the replica itself, because what has to be
   * forgotten is spread over the lists this holds — what the survey said, what
   * could not be found, and the tile the set is keeping for it.
   */
  drop(id: string): void {
    if (!this.replicas.delete(id)) return
    // The paint first, pictures and all, through the same door a page would
    // use. It is keyed by the name and kept for the life of the layer, and a
    // replica's name is minted once and never handed out again — so a page that
    // stood one, painted it and took it away again kept a style column and a
    // layer of the picture sheet for good. There are 1,024 of the first and
    // `MOST_PICTURES` of the second (the device's default limit), and running
    // out of either draws the colour or the picture as nothing.
    this.styles.set(id, null)
    this.told.delete(id)
    this.absent.delete(id)
    this.placed.delete(id)
    this.stood.delete(id)
    this.byName = this.byName.filter((fetch) => fetch.key !== id)
    this.handOver()
    // Nothing is going to stand under this name now. Whoever is waiting on it
    // hears that rather than waiting for the life of the tab — which is also
    // what `dispose` leans on, since it drops every one it holds
    this.settled(id, false)
  }

  /** What the survey said about one that is standing, or nothing until it is up. */
  said(id: string): Building | undefined {
    return this.told.get(id)
  }

  /**
   * Takes a building out of the city: by the name PLATEAU gives it, by a shape
   * named the way a mask is, or by a rule asked of every building.
   *
   * A shape rather than a list of names is what a proposal wants: a site is
   * whatever the survey happens to have put on the plots being cleared, and a
   * page drawing a site knows the ground it owns and not the ids on it. A
   * building is judged by the whole of its foot, by {@link feetOn}, so a
   * neighbour whose eaves lean over the line stays up.
   *
   * A rule says the other kind of thing, the kind no shape can: the sheds, the
   * factories, everything under three storeys. It is handed what the survey
   * says about each building, and `position` on it is worked out only if the
   * rule reads it — so a rule that goes by name or by storeys costs a call and
   * nothing else.
   *
   * ```ts
   * buildings.hide((b) => b.storeys < 3)
   * buildings.hide((b) => cleared.includes(b.id))
   * ```
   *
   * A rule is asked again whenever what is drawn changes. One reading state of
   * its own — a list a page is still adding to — is looked at again by handing
   * the same rule over once more, since nothing here can know the list moved.
   * Passing it twice does not hide anything twice.
   *
   * What is hidden is remembered rather than done once: a tile landing later,
   * or coming back after being thrown out for memory, arrives with its
   * buildings already out. Nothing is fetched the less for it — the tile is
   * one file however much of it is drawn.
   *
   * What the ground draws stays. A footprint is the ground's and not this
   * layer's, so the plan of the buildings taken out is still on the map under
   * whatever is put in their place.
   */
  hide(what: string | MaskShape | BuildingRule): this {
    const before = this.whatIsOut()
    this.hidden.hide(what)
    // Whatever was standing a line ago goes under the way a city does, rather
    // than being gone between two frames. A page that means them never to have
    // been there says so in `BuildingsOptions.hide` instead.
    this.beginSinking(performance.now() / 1000, before)
    this.remarkAll()
    return this
  }

  /**
   * Puts one back, or with nothing given, every building that was taken out.
   *
   * They come up out of the ground the way a tile's do as it lands, which is
   * the undoing of {@link hide} and reads as the undoing: a page stepping
   * through what it has cleared sees the same thing happen backwards.
   */
  show(what?: string | MaskShape | BuildingRule): this {
    const before = this.whatIsOut()
    this.hidden.show(what)
    // Marked first. A building still carrying "taken out" is thrown away by
    // the shader, and one thrown away cannot be seen to rise
    this.remarkAll()
    this.beginRising(performance.now() / 1000, before)
    return this
  }

  /**
   * Where a thing held to one of these buildings stands; see
   * {@link StandsOnBuildings.seatOnAnchor}.
   */
  seatOnAnchor(anchor: AnchorOnBuilding): BuildingSeat | null {
    const found = this.standing(anchor.building)
    return found && seatOnAnchor(found.mesh, found.at, anchor.offset)
  }

  /**
   * Which mesh holds a building and where in it, or nothing where no tile in
   * hand carries it.
   *
   * The building is looked for by the name PLATEAU gives it, which is the only
   * name that travels between tiles — the same name a motion holds its
   * building by, and for the same reason. Where it was last found is kept and
   * tried first; a tile thrown out and fetched again is a mesh of its own, so
   * what is kept is good only while that mesh is still in the scene.
   */
  private standing(building: string): { mesh: Mesh; at: number } | null {
    const had = this.stood.get(building)
    if (had && seated(had.mesh, this.root)) return had

    this.stood.delete(building)
    // One standing on its own answers for its name, where there is one: a
    // city building a page moved is in the tile it came in as well, not drawn
    const alone = this.placed.has(building)
    let found: { mesh: Mesh; at: number } | undefined
    this.eachMesh((mesh) => {
      if (found) return
      if (alone && !mesh.userData[STOOD_ALONE]) return
      const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
      const at = facts?.ids.indexOf(building) ?? -1
      if (at >= 0) found = { mesh, at }
    })
    if (!found) return null
    this.stood.set(building, found)
    return found
  }

  /** Every building mesh loaded, shown or not. */
  private eachMesh(visit: (mesh: Mesh) => void, shownOnly = false): void {
    for (const group of this.root.children) {
      if (shownOnly && !group.visible) continue
      group.traverse((object) => {
        const mesh = object as Mesh
        // The outline hangs off each mesh as a strip that is a Mesh too, and is no building
        if (mesh.isMesh && mesh.userData[BUILDING_FACTS] !== undefined) visit(mesh)
      })
    }
  }

  private async sync(viewer: Viewer): Promise<void> {
    // What the page stood is looked for by name and what the view covers is
    // looked for by where it is, and both end in the one set of tiles; see
    // {@link handOver}.
    if (this.replicas.size > 0) void this.syncReplicas(viewer)
    if (this.load === 'brought') {
      this.covering = []
      this.handOver()
      return
    }
    const look = ++this.looksBegun
    const wanted: BuildingTile[] = []

    // Nothing says where buildings may stand until the cities are known, so
    // the whole view is on its way until the listing is in.
    //
    // The cities are looked up over what the mask leaves of the view. The
    // catalog answers one question at a time, so a mask over one ward that
    // still asked about every ward on screen would leave its own buildings
    // waiting behind answers nothing will be drawn from.
    //
    // A piece held whole is asked about whole, however the camera is pointed:
    // a page counting what is inside it would otherwise be counting whichever
    // half it happened to be looking at. A piece told to wait for the screen
    // has handed that back, and is asked about as the view reaches it; see
    // {@link Mask.fetch} and {@link Viewer.screenPicks}.
    const area = viewer.maskArea
    // A box for each piece of the mask, each one as much of that piece as it
    // asked to have fetched: the whole of a piece held whole, and only what
    // the screen has reached of one told to wait for it. Where there is no
    // shape at all it is the screen, which is then the only thing that says
    // where to look.
    const boxes = maskBoxesIn(area, viewer.fetchBounds)
    // And the one box round them, which is what the catalog is asked over.
    // Not the box round the shape: behind a shape riding the camera that
    // reaches as far as the shape rather than as far as the screen, and every
    // city in the difference is a tileset fetched for tiles the frustum test
    // below then throws away — with `busy()` held true and `loaded` waiting on
    // all of them. Null where the pieces left nothing, which is the shape
    // being wholly off screen.
    const view = boundsRound(boxes)
    if (!view) {
      // Nothing of the cut is on screen. Said to be the look now shown, so a
      // look still in flight from before does not put its tiles up behind us
      this.lookShown = look
      this.citiesComing = []
      this.covering = []
      this.handOver()
      return
    }
    // The same shape asking the same question gets the same answer, so the
    // walk down every city's tree is done once and kept; see {@link maskTiles}
    const held = !viewer.screenPicks && this.maskTiles?.area === area ? this.maskTiles : null
    if (held) {
      this.lookShown = look
      this.cover(viewer, held.tiles)
      return
    }
    // A patch for each piece, so the ground shows the city coming where it is
    // coming rather than over the ground between the pieces
    const waiting: WorldBounds[] = [...boxes]
    this.asking.add(waiting)
    let cities: readonly PlateauCity[]
    try {
      cities = await citiesIn(view, this.ask)
    } catch (error) {
      // The cities could not be listed, and the list drops its own failure so
      // the next ask goes out afresh. Take that ask, rather than waiting for
      // the view to move
      this.askAgainAt = Math.min(this.askAgainAt, performance.now() + ASK_AGAIN_AFTER)
      this.failed({ what: 'catalog', key: 'cities', retrying: true, cause: error })
      return
    } finally {
      this.asking.delete(waiting)
    }
    // While it was in flight the view may have left the zooms buildings stand
    // at, or these buildings been taken off the viewer. Carrying on would
    // fill a view that asked for none.
    if (this.viewer !== viewer || !cityStands(viewer.camera.zoom, this._minZoom)) return
    // A look that waited on a listing still coming, while one begun after it
    // did not, only knows the cities of a view since left. Put on screen
    // last, it would take down the tiles of any city the view has moved onto.
    if (look < this.lookShown) return
    this.lookShown = look

    // The catalog answers one question at a time: one city took 1.2s, three
    // asked together took 2.7s each and eight took 7.9s each. So the order
    // they are asked in is the order they answer in, and the middle of the
    // view is worth asking about first.
    const ordered = cities
      .map((city) => ({ city, distance: viewer.measureOnScreen(city.bounds).distance }))
      .sort((a, b) => a.distance - b.distance)

    // None of them is waited for. Waiting on all put the whole screen behind
    // the slowest answer — a view over six wards stood empty for as long as
    // the sixth took. What is in hand goes up now; each city that lands asks
    // for a look of its own.
    const coming: WorldBounds[] = []
    let unanswered = false
    // How high the land is, as far as the tiles in hand can say, for judging
    // where a tile's buildings will stand. Nothing is fetched for it here:
    // this is a look taken every time the view moves, and the tile that is
    // chosen fetches its own heights and waits for them
    const land = viewer.elevation ? heightsInHand() : null
    for (const { city } of ordered) {
      const tileset = tilesetInHand(city.code, this.lod)
      if (tileset === undefined) {
        coming.push(city.bounds)
        this.askAbout(city.code)
        continue
      }
      // A city that could not be asked about is let go of after a while rather
      // than held for good the way an answer is, so it is worth coming back to:
      // asking again costs one look and fills a city that was merely unlucky.
      // One that answered with no dataset is not asked again — it has said all
      // it has to say.
      if (tileset === ASK_FAILED) {
        unanswered = true
        this.sayCatalogFailed(city.code)
      } else if (tileset) for (const root of tileset.roots) this.gather(viewer, root, wanted, land)
    }
    this.citiesComing = coming
    if (unanswered) {
      this.askAgainAt = Math.min(this.askAgainAt, performance.now() + ASK_AGAIN_AFTER)
    }
    // Kept only where the shape stands and every city has answered; see
    // {@link maskTiles}
    if (!viewer.screenPicks && area && coming.length === 0 && !unanswered) {
      this.maskTiles = { area, tiles: wanted }
    }
    this.cover(viewer, wanted)
  }

  /**
   * Puts what a look found in the order it goes out in, and hands it over.
   *
   * Only a few go out at a time, so the order they are handed over in is the
   * order the city arrives in. The tree gives them in its own order, which has
   * nothing to do with where they fall on screen; sorted by how far they sit
   * from the middle of the view, what is being looked at lands first. The
   * ground has picked its tiles this way all along.
   *
   * Apart from the walk that found them, because the walk is kept between
   * looks and this is not: which tile is nearest the middle is the one thing
   * here that the camera decides.
   */
  private cover(viewer: Viewer, wanted: readonly BuildingTile[]): void {
    const ranked = wanted.map((tile) => ({
      tile,
      distance: viewer.measureOnScreen(worldBoundsOf(tile)).distance,
    }))
    ranked.sort((a, b) => a.distance - b.distance)
    this.covering = ranked.map((row) => ({ key: row.tile.url, tile: row.tile }))
    this.sayIfVast(viewer, this.covering.length)
    this.handOver()
  }

  /**
   * Hands the set everything wanted: what the page stood first, then what the
   * view covers.
   *
   * Two lists because they are found two different ways — one by name, once,
   * and one by where the view is, on every look — and one call because the set
   * takes what is wanted and drops the rest. Handed over separately, each
   * would drop the other's tiles.
   *
   * The page's own go first: only a few are fetched at a time, and a page that
   * stood five towers wants those five before the street behind them.
   */
  /**
   * Tells of a city the catalog could not be asked about, once for each
   * failure. The answer was kept as a failure and looked at again after a
   * while, which was right, and said to nobody, which was not: a ward with a
   * catalog in trouble stood empty with no error and no line in the console,
   * and `loaded` came as though it were done.
   */
  private sayCatalogFailed(city: string): void {
    const cause = tilesetFailure(city, this.lod)
    if (cause === undefined || this.catalogSaid.get(city) === cause) return
    this.catalogSaid.set(city, cause)
    this.failed({ what: 'catalog', key: city, retrying: true, cause })
  }

  private handOver(): void {
    // While the city goes under, what the view covered is kept only where it
    // has landed, to go under with the rest: nothing more of it is fetched.
    // `beginLeaving` lets go of what was on its way, and the view's tiles are
    // forgotten only once the city is down (`letCityGo`), so until then a
    // handing over for anything else — a building a page moved or brought is
    // looked for again each time the view is — asked for them all again. They landed,
    // rose while the street around them sank, and were let go of half way
    // up (measured 2026-11-17 in the playground: a building moved, a fresh
    // place, the zoom taken under the city's at once — 21 of the 22 tiles
    // that came up came up while the city was going under)
    const covering =
      this.leaving === null ? this.covering : this.covering.filter((fetch) => this.tiles.holds(fetch.key))
    this.tiles.sync([...this.byName, ...covering])
  }

  /**
   * Where to look for the buildings a page named.
   *
   * Nothing here reads the view. What was asked for does not change as the
   * page is moved, so this settles once — and again when a city the catalog
   * was asked about answers, since that is what turns a name into a tileset
   * to walk down, and again when a city it could not be asked about is worth
   * asking about afresh.
   *
   * A place near a boundary falls in two cities' boxes, and only one of them
   * published the building. Both are handed over and looked in one after the
   * other; the walk stops at whichever has it.
   */
  private async syncReplicas(viewer: Viewer): Promise<void> {
    const wanted: Fetch[] = []
    // While the city is down, so is a city building a page moved: not asked
    // for until the city is, and kept while the city is still going under so
    // that it goes under with the rest rather than being let go of mid-way
    const cityDown =
      this.load === 'all' && !cityStands(viewer.camera.zoom, this._minZoom) && this.leaving === null
    for (const replica of this.replicas.values()) {
      if (replica.ofCity && cityDown) continue
      const ask = replica.wanted()
      const at = { minX: lonToX(ask.findAt[0]), minY: latToY(ask.findAt[1]) }
      let cities: readonly PlateauCity[]
      try {
        cities = await citiesIn({ ...at, maxX: at.minX, maxY: at.minY }, this.ask)
      } catch (error) {
        this.askAgainAt = Math.min(this.askAgainAt, performance.now() + ASK_AGAIN_AFTER)
        this.failed({ what: 'catalog', key: 'cities', retrying: true, cause: error })
        return
      }
      // Taken off the viewer while the listing was on its way
      if (this.viewer !== viewer) return

      const roots: BuildingTile[] = []
      let coming = false
      let unanswered = false
      for (const city of cities) {
        const tileset = tilesetInHand(city.code, this.lod)
        if (tileset === undefined) {
          coming = true
          this.askAbout(city.code)
          continue
        }
        // Not "no buildings here" but "nobody said": kept apart by the catalog
        // (see `ASK_FAILED`) because what follows turns on which it is
        if (tileset === ASK_FAILED) {
          unanswered = true
          this.sayCatalogFailed(city.code)
        } else if (tileset) {
          for (const root of tileset.roots) if (tileHolds(root, ask.findAt)) roots.push(root)
        }
      }
      // Asked about and not yet answered: the answer takes a look of its own
      if (coming) continue
      // One of the cities over the place could not be asked about, so these
      // roots are not all of the trees the building could be in. Handed over
      // anyway, `findNamed` would read the ones in hand, not find it and call
      // `lost` — a page told for good that the survey has no such building, on
      // the strength of one fetch that failed. Which is the boundary case
      // `findNamed` names: 横浜ランドマークタワー answers to 14103 and 14104 and
      // is in 14104. So it waits, and the failure being let go of after a while
      // is what this look comes back for.
      if (unanswered) {
        this.askAgainAt = Math.min(this.askAgainAt, performance.now() + ASK_AGAIN_AFTER)
        continue
      }
      const first = roots[0]
      if (!first) {
        // Nowhere to look, and every city over the place has answered. PLATEAU
        // publishes for a city or it does not, and this place is in none that
        // it does — said once, through `lost`, rather than asked about forever.
        this.lost(replica.id)
        continue
      }
      wanted.push({ key: replica.id, tile: first, find: { wanted: ask, roots } })
    }
    this.byName = wanted
    this.handOver()
  }

  /**
   * Asks the catalog about a city, once, and takes a look when it answers.
   *
   * Nothing waits on the answer, so without this the view would sit as it is
   * until something else moved it — the city would have landed with no frame
   * to put it on screen in.
   */
  private askAbout(city: string): void {
    const key = `${city}:${this.lod}`
    if (this.awaited.has(key)) return
    this.awaited.add(key)
    void buildingTileset(city, this.lod, this.ask).finally(() => {
      this.awaited.delete(key)
      // A tree to walk that was not there before, so what was kept of the
      // last walk is short of a city; see {@link maskTiles}
      this.maskTiles = null
      this.dirty = true
    })
  }

  /**
   * The tiles at the foot of the tree that are on screen.
   *
   * PLATEAU's tiles refine by replacing, as the files say. A parent holds the
   * tallest buildings of its patch and every one of them comes back in its
   * children, with the shorter ones added; siblings share nothing. So a parent
   * is never wanted: where a child is on screen it brings all of the parent
   * that is, and where none is, nothing the parent holds is on screen either,
   * only the box around it. Drawn alongside its children it would stand each
   * of those buildings twice, and the two copies do not land together: each
   * tile seats its batch from a centre of its own, and a metre of Mercator
   * stretch separates the results.
   */
  private gather(viewer: Viewer, tile: BuildingTile, into: BuildingTile[], land: Heights | null): void {
    // Each building is sat on the ground by its own lowest corner as the tile
    // lands, so none stands taller than the tile's heights span
    const lat = ((tile.region[1] + tile.region[3]) / 2) * (180 / Math.PI)
    const stretch = 1 / metersPerUnit(lat)
    const rise = (tile.region[5] - tile.region[4]) * stretch
    const bounds = worldBoundsOf(tile)
    // And where the land carries its heights, that span stands on the land
    // rather than on the sea. Read from what has arrived, which is what the
    // tile itself will be stood on; before any of it has, this is nought and
    // the patch is judged where it used to be
    const stands = land
      ? land.at((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2) * stretch
      : 0
    // One reading, in the middle, for a patch the land runs across. A tile at
    // 七里ヶ浜 covers 600m of hillside: the beach at 2m, the ridge at 70m, and
    // its middle answers 57m. So the box is opened downward by the same span
    // it is raised by — the ground inside a tile cannot leave the middle by
    // more than the tile's own rise, which is the ground's fall plus the
    // tallest thing standing on it.
    //
    // Closed, everything below the middle sat under the box, and the box only
    // met the screen because the screen was wide. Stepping in, it left the
    // screen entirely and the tile was judged gone: the nearer the camera, the
    // emptier the hill. What the room costs is a tile of the hillside's own
    // height either way, against 600m across — near enough nothing.
    const below = land ? rise : 0
    // Where a mask says how far the scene reaches, that is the whole of the
    // question and the screen is not asked; see {@link Viewer.screenPicks}
    if (viewer.screenPicks && !viewer.reachesScreen(bounds, rise + below, stands - below)) return
    // Outside the cut, and so is everything under it: a child's patch lies
    // inside its parent's
    if (!maskTouches(viewer.maskArea, bounds)) return

    if (tile.children.length === 0) into.push(tile)
    for (const child of tile.children) this.gather(viewer, child, into, land)
  }

  /**
   * Waits for a tile's next turn to be shaped: one a frame, let through by
   * `frame`. A tile already part way through goes `first`, ahead of those not
   * yet begun, so each is done a step at a time but still one after another.
   */
  private turn(signal: AbortSignal, first = false): Promise<void> {
    return new Promise((go) => {
      if (first) this.landing.unshift({ go, signal })
      else this.landing.push({ go, signal })
    })
  }

  /**
   * Lets the next tile still wanted through. Any given up on ahead of it go
   * too, and give up at once without holding the frame.
   */
  private letOneLand(): void {
    for (let next = this.landing.shift(); next; next = this.landing.shift()) {
      next.go()
      if (!next.signal.aborted) return
    }
  }

  /** A tile fetched and read: its shapes, where they are measured from, and what it says of them. */
  private async readTile(tile: BuildingTile, signal: AbortSignal): Promise<Read | null> {
    const res = await this.ask(tile.url, 'building', { signal })
    // A server in trouble is not a tile with nothing in it: thrown, it is asked for again later
    if (transient(res.status)) throw new Error(`${res.status}`)
    if (!res.ok) return null

    // Which form the tile came in is the file's to say, not the catalog's:
    // the dataset pages are worded the same either way (see `tileContent.ts`)
    const data = await res.arrayBuffer()
    // A file that arrived and will not read is not a file worth asking for
    // again, however it failed. The readers say so for the cases they check —
    // a magic that is neither form, a table that does not add up — but a
    // malformed buffer view or a truncated glTF throws whatever the arithmetic
    // threw, and that used to reach `worthAsking` as a plain Error and be
    // fetched over and over. Said here, where both readers are called, so
    // neither has to remember and neither can be the one that forgot.
    let read
    try {
      read = isGltf(data) ? readGltfTile(data) : readB3dm(data)
    } catch (cause) {
      throw cause instanceof Unreadable ? cause : new Unreadable(`${tile.url} would not read`, { cause })
    }
    const { glb, center, ...facts } = read
    if (!center) return null
    return { glb, center, facts }
  }

  private async loadTile(tile: BuildingTile, signal: AbortSignal): Promise<Object3D[] | null> {
    const read = await this.readTile(tile, signal)
    if (!read) return null
    return this.standTile(tile, read, signal, null)
  }

  /**
   * Walks a tileset down towards where a building stands, for the deepest tile
   * that holds it.
   *
   * The deepest and not the first. A tile stands in for everything under it,
   * and what it stands in for it has simplified: the tower at 西新宿 is 260m
   * of shape in the leaf and 196m in the root, its masts decimated away, and
   * 虎ノ門ヒルズ loses 38m of crown the same way. A page comparing buildings by
   * their shapes cannot be handed the stand-ins. So the path down to the place
   * is walked to its end, and the last tile along it that still names the
   * building is the one stood up — 0.7 to 2.2MB against the root's 0.1, paid
   * once per building.
   *
   * One path down, since a child's patch lies inside its parent's, and more
   * than one tileset across, since a place near a boundary falls in two
   * cities' boxes while only one of them published the building —
   * 横浜ランドマークタワー answers to 14103 and 14104, and is in 14104.
   */
  private async findNamed(
    wanted: BuildingWanted,
    as: string,
    roots: readonly BuildingTile[],
    signal: AbortSignal,
  ): Promise<Object3D[] | null> {
    for (const root of roots) {
      let found: { tile: BuildingTile; read: Read; at: number } | undefined
      for (let tile: BuildingTile | undefined = root; tile; tile = deeper(tile, wanted.findAt)) {
        const read = await this.readTile(tile, signal)
        if (signal.aborted) return null
        // No tile there, so nothing below it either
        if (!read) break
        // Walked past a tile that does not name it rather than stopped at one.
        // The files refine by replacing: a tile holds the tallest buildings of
        // its patch and its children add the shorter ones, so a house is absent
        // from every tile above the depth it is first written at, and absence
        // means "not added yet" rather than "gone". Nothing is lost by carrying
        // on — `deeper` only ever steps into a child covering the same place.
        //
        // And the deepest that names it is the one kept, because a shallower
        // one carries a stand-in it has simplified (see this method's own note).
        const at = read.facts.ids.indexOf(wanted.id)
        if (at >= 0) found = { tile, read, at }
      }
      if (found) return this.standTile(found.tile, found.read, signal, { wanted, at: found.at, as })
    }
    // Every tile over the place has been read and none of them holds it. Not
    // a failure to be tried again: the survey does not have this building.
    this.lost(as)
    return null
  }

  /** The manager {@link loader} fetches what a tile names beside itself through; see there. */
  private namesBeside(): LoadingManager {
    const manager = new LoadingManager()
    manager.setURLModifier((url) => addressThrough(this.viewer?.transformRequest, url, 'building'))
    return manager
  }

  private async standTile(
    tile: BuildingTile,
    read: Read,
    signal: AbortSignal,
    only: { readonly wanted: BuildingWanted; readonly at: number; readonly as: string } | null,
  ): Promise<Object3D[] | null> {
    const { glb, center, facts } = read
    const gltf = await this.loader.parseAsync(glb, LoaderUtils.extractUrlBase(tile.url))
    if (signal.aborted) return null

    // Which walls look at a street, which is what decides where windows go.
    // Fetched alongside the tile rather than before it: the ground has asked
    // for the same tiles already, so this is served from the browser's cache.
    //
    // Nothing is asked for while the windows are off. They are the only thing
    // the roads are read for, and a page that never shows one should not be
    // fetching a second set of tiles to decide where it would have put them.
    const roads = this.windows.visible
      ? await roadsUnder(worldBoundsOf(tile), this.windows.reach, this.ask)
      : null
    if (signal.aborted) return null

    // How high the ground is under them, if the land carries its heights.
    // Always at the finest the elevation tiles go to, which is what the
    // ground reads too at any zoom a building stands at — so a building and
    // the road at its door are standing on the same numbers.
    //
    // Over the tile's own patch for a tile standing where it was surveyed, and
    // over the one place it is going for a building being moved: the patch it
    // came out of says nothing about the hill it lands on, and the one reading
    // under its destination is the whole of what it needs.
    //
    // What is wanted is read here rather than taken from what was wanted when
    // the tile was asked for: a page may move a building while its tile is
    // still on its way, and what it said last is what holds. A move that comes
    // in later than this is caught at the foot of this method, where the group
    // the tile hangs from is made and `place` first has something to move.
    const live = only ? (this.replicas.get(only.as)?.wanted() ?? only.wanted) : null
    const moved = live?.at ? { x: lonToX(live.at[0]), y: latToY(live.at[1]) } : null
    const land = this.viewer?.elevation
      ? await heightsUnder(moved ? justAt(moved) : worldBoundsOf(tile), FINEST_HEIGHTS, signal, this.ask)
      : null
    if (signal.aborted) return null

    // What follows holds the main thread, so it waits for a frame to itself
    await this.turn(signal)
    if (signal.aborted) return null

    // And from here it is shaped a share of a frame at a time: what is long is
    // written in steps (see `steps.ts`), and when this tile has had its share
    // the rest waits for its next turn. Either comes back null once the tile is
    // given up on, which is all a caller has to check.
    let since = performance.now()
    const shaped = async <T>(steps: Steps<T>): Promise<T | null> => {
      for (;;) {
        const step = steps.next()
        if (step.done) return step.value
        if (performance.now() - since < SHAPE_FOR) continue
        await this.turn(signal, true)
        if (signal.aborted) return null
        since = performance.now()
      }
    }
    const breathe = async (): Promise<void> => {
      if (performance.now() - since < SHAPE_FOR) return
      await this.turn(signal, true)
      since = performance.now()
    }

    // The one walk over the tile: everything after this works from the list.
    const found: Mesh[] = []
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.material = this.material
      // Each vertex carries a _batchid; this says which building that is
      mesh.userData[BUILDING_FACTS] = facts satisfies BuildingFacts
      sameWhicheverForm(mesh)
      // The page's two words over the default sameWhicheverForm writes, on
      // every tile as it lands; see `castShadow` and `occludes`
      mesh.castShadow = this._castShadow
      setOccludes(mesh, this._occludes)
      found.push(mesh)
    })

    // A tile fetched for one building is cut down to that building here, before
    // anything is laid on its corners: what arrived is the district the
    // building stands in, and every step from here on walks whatever corners
    // it is handed. The numbers the tile calls its buildings by are kept — they
    // are what everything asks a building by, this one included — while the
    // names of the ones it no longer draws are blanked out, so nothing looking
    // a building up by its name lands on a mesh holding no corner of it. Why
    // blanked rather than dropped is in `namingOne`.
    const meshes = only ? leaveOne(found, only.at) : found
    const one = only ? meshes[0] : undefined
    // Named for the replica and not for the building it was taken from, which
    // is what lets ten of the one building stand apart: every list in here is
    // keyed by this name, so each of them has its own paint, its own row of
    // the motion table and its own answer to a click.
    if (only && one) {
      one.userData[BUILDING_FACTS] = namingOne(facts, only.at, only.as)
      one.userData[STOOD_ALONE] = true
    }

    for (const mesh of meshes) {
      // What has been decided for each corner's building: the column of the
      // paint table, whether it is taken out, which building it is, and the
      // row of the motion table it moves by. Laid here, where every building
      // mesh passes exactly once: added later it would miss the meshes nothing
      // is cut from, and a mesh without it is a shader of its own. All four on
      // one attribute; see {@link BUILDING_SLOTS}.
      const corners = mesh.geometry.attributes['position']?.count ?? 0
      mesh.geometry.setAttribute(BUILDING_SLOTS, new BufferAttribute(new Float32Array(corners * 4), 4))
      // How high the ground under its building is, laid here for the same
      // reason and left at nought while the land is drawn flat
      layUnderfoot(mesh, corners)
      // When each of its buildings starts to rise and how far under it starts.
      // Nought means long ago and nowhere below, which is a building standing.
      mesh.geometry.setAttribute(APPEAR, new BufferAttribute(new Float32Array(corners * 2), 2))
      // And so that a page's own `Raycaster` finds this tile where the card
      // draws it rather than where the survey drew it. Here for the same
      // reason as the three above: every building mesh passes once. Nothing is
      // read off the mesh until a ray actually arrives; see `casting.ts`.
      answersRays(mesh)
    }

    // The vertices are metres from the tile's centre, in the tile's own frame:
    // z up, as 3D Tiles has it, while glTF measures with y up. Standing the
    // tile back up and turning it to face the sky is one matrix.
    const { lon, lat } = geodeticOf(center[0], center[1], center[2])
    const upright = orientationAt(lon, lat).multiply(new Matrix4().makeRotationX(Math.PI / 2))

    const stretch = 1 / metersPerUnit(lat)
    const origin = { x: lonToX(lon), z: -latToY(lat) }

    // TODO: Shape the tiles off the main thread, once there is a need.
    //
    // Everything from here to the outline runs on the main thread: some 24ms
    // a tile, and 100-130ms when several land together (12 tiles at 中野, on
    // the Mac it was measured on, 2026-09). It only shows while dragging into
    // a part of town not yet loaded, and the shaping still changes too often
    // to be walled off behind a worker. So it waits for phones to be taken
    // seriously, for buildings to show further out than z18, or for the
    // shaping to settle before release.
    //
    // Then in two steps: make this chain plain functions of arrays and check
    // on the main thread that the parapet and window tallies hold, then move
    // it into a worker that keeps each mesh's uncut shape for recutting.
    // Until then it is done a share of a frame at a time (see `SHAPE_FOR`).
    // Measured again at 高円寺, a tile took 29-45ms and up to 67ms, nearly half
    // of it windows; it was split three ways once, and a frame then held the
    // longest of the three.
    stand(meshes, upright)
    seat(meshes)
    // How far each building's walls are carried below its foot, worked out
    // where the ground is read and let down further on; see `letDown`.
    const hems = land && !moved ? standOnLand(meshes, land, origin, stretch) : null
    // A moved building instead stands on the single reading under where it is
    // going, and wears no hem: the hem is the slope it was surveyed on, and
    // that slope stays behind with the place it came from.
    if (land && moved && only && one) standOneOn(one, only.at, land.at(moved.x, moved.y))
    // Where the flat roofs are, read the once. The windows take a building's
    // own roof for its ceiling and the parapets are cut into the same roofs,
    // and finding them is the long half of either.
    const roofs: (RoofPlan | null)[] = []
    for (const mesh of meshes) roofs.push((await shaped(planningRoofs(mesh.geometry))) ?? null)
    if (signal.aborted) return null
    await breathe()
    if (signal.aborted) return null
    if (roads) {
      // A tile whose roads could not be read at all would stand a city of
      // blank walls, which is further from the truth than windows all round.
      // A wall sees as far as the buildings around it let it.
      const faces = (wall: Wall, around: WallsNearby): boolean =>
        roads.empty ||
        roads.inFrontOf(wall, (share) => around.sight(wall, share, this.windows.reach), origin, stretch)
      await shaped(
        glaze(meshes, roofs, facts, this.storeyHeight, faces, this.windows.clearance, this.windows.tall),
      )
      if (signal.aborted) return null
      await breathe()
      if (signal.aborted) return null
    } else {
      // Nothing was read into these walls, so the windows cannot be turned on
      // over them; see {@link Buildings.windows}
      this.glazed = false
    }
    // Here and not with the seating: a wall is planned from the corners and
    // takes its lowest for its foot, so a hem let down first would have the
    // windows set out from it. See `letDown`.
    if (hems) {
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i]
        const hem = hems[i]
        if (mesh && hem) letDown(mesh, hem)
      }
    }
    await shaped(carve(meshes, roofs, parapetSize(this.parapet)))
    if (signal.aborted) return null
    // The corners carving adds say nothing of their own, so anything moving
    // a building of this tile — and the growing it comes in with — writes
    // itself onto them now. The standing only: what a page has decided is
    // written once the tile hangs, at the foot of this function, and written
    // here as well it would be a walk of every corner for an answer that
    // cannot be right yet; see {@link restand}.
    for (const mesh of meshes) this.restand(mesh)
    // Last, so the lines follow the parapets as they were cut. A tile that
    // lands while nothing wants lines is traced once something does and it is
    // in view.
    if (this.linesWanted) {
      for (const mesh of meshes) this.folds.trace(mesh, this.hidden.outOf(mesh))
    }

    const group = new Group()
    // A group is where three takes the stage from, and from the nearest one —
    // so a tile says again what the viewer wrote on the root. It comes to the
    // number a fresh group already carries, `structure` being the stage whose
    // number is nought, and is written all the same: the rule is the rule, and
    // the city reading it by accident is not the city reading it. See
    // `order.ts`.
    inStage(group, this.stage)
    group.userData[STANDS_TO] = topOf(meshes)
    group.add(gltf.scene)
    group.position.set(origin.x, 0, origin.z)
    group.scale.setScalar(stretch)
    // Woven while the tile is still off the scene, which is the only moment
    // there is room for it: once it hangs, the first frame to draw it is the
    // frame that pays for the shader. See {@link Viewer.weave}. Here rather
    // than at the foot of this function so that nothing a page is waiting on
    // — `finish`, and what it answers — is held up behind it.
    await this.viewer?.weave(group)
    // Gone while the weaving was in flight. The tile set frees what is handed
    // back and this hands back nothing, so the group it never hung is let go
    // of here — every mesh of the tile is under it.
    if (signal.aborted) {
      drop([group])
      return null
    }
    // The rise is timed from here, once the tile is woven and about to hang,
    // and not from when it was shaped. It was started before the weaving
    // until 2026-11-17, and on a card building its shaders for the first time
    // the weaving outlasted the rise: the tile hung with its buildings already
    // standing, a whole street popping up at once (filmed: the public
    // simple-map, opened cold). The clock is written into the corners the
    // shader reads, which are there already, so writing it now changes no
    // shader.
    this.beginGrowing(meshes)

    if (only) {
      const foot = one ? footOf(one, only.at) : undefined
      const told = one ? toldOf(one, only.at) : null
      if (one && foot && told) {
        // Where the survey has it, which is not quite where the page said to
        // look: a building left at home is hung on its own place, and one
        // being moved is turned about that same point.
        const surveyed = standsAt(origin, foot, stretch)
        this.placed.set(told.id, { group, foot, surveyed })
        // Read again, now that the line above has left `place` a group to move
        // by itself. A re-hang rather than a second opinion: a call that came
        // between `live` and here wrote where it wanted the building into the
        // replica and found nothing in `placed` to move, so without this it is
        // the one `place` a page made that did nothing at all.
        const wanted = this.replicas.get(only.as)?.wanted() ?? live
        hang(group, foot, wanted?.at ?? surveyed, wanted?.facing ?? 0)
        // Its other half: the land was read under where the building was going
        // when `live` was read, so a call that came after that has to have the
        // ground read under the place it named. Given the mesh rather than
        // looked up, since the group is not on the root until below.
        if (!samePlace(wanted?.at, live?.at)) {
          this.reground(one, only.at, wanted?.at ?? surveyed, told.id)
        }
        // What the shadows are cast over is the one building left standing
        group.userData[STANDS_TO] = told.tall
        this.told.set(told.id, told)
        // A city building a page moved: the one in the tile it came in is not
        // drawn from here on, and what looks it up by name looks again
        if (this.replicas.get(told.id)?.ofCity) {
          this.stood.delete(told.id)
          this.markWhereItCameFrom(told.id)
        }
        // The one it was asked for is standing, and whoever asked hears so.
        // Said here and not at the foot of this function because a page's
        // `.then` runs in the breath after, by which time the tile hangs
        this.settled(told.id, true)
      } else {
        // The tile names it and has nothing to stand: nobody is going to be
        // told about this building, so whoever is waiting on the promise
        // {@link Buildings.bring} handed back is told that rather than left
        // waiting for the life of the tab.
        //
        // By the name this layer minted and not by the survey's, which is the
        // name every list in here is keyed by — `bringing`, `absent`, and what
        // `failed` reports. Said the other way round it looked up nothing,
        // found nothing to settle, and left the page awaiting a building the
        // tile had already said it would not draw; the sibling arm above
        // settles under `told.id`, which `namingOne` has just made the minted
        // name as well.
        this.lost(only.as)
      }
    }

    this.root.add(group)
    // Marked here and nowhere earlier, now the tile hangs where it belongs.
    //
    // A rule may read `Building.position`, and a shape may be asked which feet
    // it holds; both go through the mesh's own world matrix — which until the
    // line above was the matrix of a mesh hanging from nothing, so every
    // reading before this one landed in the wrong city (measured: a tile of
    // 御殿場 answered 138.25, 35.87). Everything else a rule reads is on the
    // tile itself and was already right; this is the one fact that waits on
    // where the tile was put, and it is the reason the marking is not done
    // alongside the tracing above.
    for (const mesh of meshes) this.mark(mesh)
    return [group]
  }
}

/** A tile as it was fetched, before anything has been made of it. */
interface Read {
  readonly glb: ArrayBuffer
  readonly center: readonly [number, number, number]
  readonly facts: BuildingFacts
}

/**
 * Leaves a mesh saying the same thing whichever form its tile came in.
 *
 * Three things differ, and all of them are names or frames rather than facts,
 * so they are settled here — once, as the tile lands — and nothing after this
 * asks which form it was.
 *
 * The number saying which building a corner belongs to is `_BATCHID` in a
 * b3dm and `_FEATURE_ID_0` in 3D Tiles 1.1, which glTF readers lowercase; it
 * is moved to the one name the windows, the parapets and the styles read.
 *
 * That number also arrives in whatever width the tile felt like — a tile of a
 * hundred buildings numbers them 0 to 99 in a `Uint8Array` — so the vertex
 * format changes from one tile to the next. It is made floats here, which is
 * not tidiness: on the WebGL 2 backend a material reading such an attribute as
 * a float draws **nothing at all**, with no error and no warning. The pick
 * pass is the one material that reads it, so every building was missing from
 * the pointer's picture there and the ground answered every click (traps).
 * Three bytes a vertex, and what is built from it downstream keeps the kind
 * through `sameWidthAs`.
 *
 * And the centre the vertices are measured from is a CESIUM_RTC extension in
 * a b3dm, which a glTF reader does not know and so leaves the vertices where
 * they are, against an ordinary node translation in 1.1, which it does know
 * and applies. Read out as `center` either way, it would otherwise be counted
 * twice and put the tile a planet's radius from where it belongs.
 */
function sameWhicheverForm(mesh: Mesh): void {
  const feature = mesh.geometry.attributes[FEATURE_ID]
  if (feature && !mesh.geometry.attributes[BATCH_ID]) {
    mesh.geometry.setAttribute(BATCH_ID, feature)
    mesh.geometry.deleteAttribute(FEATURE_ID)
  }
  const batch = mesh.geometry.attributes[BATCH_ID]
  // Interleaved counts as another format and is unpacked too: Draco hands
  // some attributes back a stride apart, and the whole point here is that
  // nothing downstream has to ask how this one is laid out
  const plain =
    (batch as BufferAttribute | undefined)?.isBufferAttribute === true &&
    batch?.array instanceof Float32Array &&
    !batch.normalized
  if (batch && !plain) {
    // Through `copyAhead` for what it already knows about both
    const floats = new Float32Array(batch.count)
    copyAhead(floats, batch, batch.count, 1)
    mesh.geometry.setAttribute(BATCH_ID, new BufferAttribute(floats, 1))
  }
  mesh.position.set(0, 0, 0)
  mesh.quaternion.identity()
  mesh.scale.set(1, 1, 1)
  mesh.updateMatrix()
  /*
   * A building casts and takes a shadow, said in three's own two words.
   *
   * Three's default is off for both, and this is the one walk every mesh of
   * every tile goes through — so said here, and not where the tile is hung,
   * which a tile fetched for a single building goes through twice.
   *
   * They have to agree across the whole city, and not only because a city of
   * buildings that shadow each other and buildings that do not is nonsense:
   * `receiveShadow` is part of three's shader cache key
   * (`RenderObject.getCacheKey`), so two tiles that disagree are two shaders
   * woven off the one material at about a second each. See `CLAUDE.md`, 함정.
   */
  mesh.castShadow = true
  mesh.receiveShadow = true
}

/** What 3D Tiles 1.1 calls the batch id, once a glTF reader has lowercased it. */
const FEATURE_ID = '_feature_id_0'

/**
 * Turn a tile's vertices to face the sky, rather than turning the group they
 * hang from.
 *
 * Everything after this asks which way is up — seating a building, finding its
 * flat roofs, sinking one — and a vertex that carries the answer in its own y
 * is cheaper to ask than one that must be turned first. The shader that sinks
 * a roof would need the matrix handed to it otherwise. The vertices stay in
 * metres; the Mercator stretch is still the group's to apply.
 */
function stand(meshes: readonly Mesh[], upright: Matrix4): void {
  // A rotation is its own normal matrix, so faces turn by the same one
  const facing = new Matrix3().setFromMatrix4(upright)

  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes['position']
    if (positions) {
      positions.applyMatrix4(upright)
      positions.needsUpdate = true
    }
    const normals = mesh.geometry.attributes['normal']
    if (normals) {
      normals.applyNormalMatrix(facing)
      normals.needsUpdate = true
    }
  }
}

/**
 * Sets windows into the walls of a tile, a piece at a time; see `steps.ts`.
 *
 * Only while the windows are on: what says where they go is the roads, and
 * those are not fetched for nobody to see. A tile read this way can then be
 * drawn with windows or without them without being read again — turning them
 * off is a switch in the shader — and a tile stood while they were off is
 * stood again when they come on (`reread`). One that never was carries no
 * window attributes, and the shader put together for it leaves the windows out
 * (`WindowPaint.over`).
 */
function* glaze(
  meshes: readonly Mesh[],
  roofs: readonly (RoofPlan | null)[],
  facts: BuildingFacts,
  storeyHeight: number,
  faces: (wall: Wall, around: WallsNearby) => boolean,
  clearance: number,
  tall: number,
): Steps<void> {
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]
    if (!mesh) continue
    const plan = planWalls(mesh.geometry)
    if (!plan) continue
    yield
    // What stands in front of a wall is the mesh's own buildings, so this is
    // built here rather than passed in: a tile is one batch of them. It is
    // asked both whether one shuts a wall in and how far the wall sees.
    const neighbours = new WallsNearby(plan.walls)
    const fitted = yield* fittingWindows(mesh.geometry, plan, roofs[i] ?? null, facts, {
      storeyHeight,
      tall,
      faces: (wall) => faces(wall, neighbours),
      crowded: (wall) => neighbours.crowded(wall, clearance),
    })
    mesh.userData[WINDOW_FITTING] = {
      dressed: fitted.dressed,
      blind: fitted.blind,
      small: fitted.small,
      crowded: fitted.crowded,
    } satisfies WindowTally
    if (!fitted.geometry) continue
    const plain = mesh.geometry
    mesh.geometry = fitted.geometry
    plain.dispose()
  }
}

/** Where the camera stands, as a direction out of the screen. Held, since it is asked per click. */
const TOWARDS = new Vector3()
/** Held between clicks: where a point on a building stands with the building at rest. */
const AT_REST = new Vector3()

/**
 * Which face a hit landed on, and which way it looks.
 *
 * The walls of a tile are read off its corners the first time one is asked for
 * and kept; a place that is on none of the building's walls is on its roof.
 * Said as one thing because the two answers are one reading.
 *
 * The camera comes into it because the survey's own normals do not say which
 * side of a wall is the outside; see {@link facingAt}.
 */
function faceOf(hit: Hit, viewer: Viewer | null): FaceFound {
  const towards = viewer ? viewer.threeCamera.getWorldDirection(TOWARDS).negate() : null
  const facing = facingAt(hit.object as Mesh, hit.item, hit.point, towards)
  return facing === undefined ? { face: 'roof' } : { face: 'wall', facing }
}

/**
 * The place a hit landed on, held to its building by the building itself; see
 * {@link BuildingEvents.click}. Where the mesh's corners say nothing of the
 * building, no offset: the middle of its foot on the ground it stands on,
 * which is what an anchor with nothing to add stands at.
 */
function anchoredAt(hit: Hit, building: Building): AnchorOnBuilding {
  const offset = offsetOnBuilding(hit.object as Mesh, hit.item, hit.point)
  return offset ? { building: building.id, offset } : { building: building.id }
}

/** An {@link Anchor} on a building. */
type AnchorOnBuilding = Extract<Anchor, { readonly building: string }>

/** Which face a hit landed on, and the bearing in the world where it is a wall. */
interface FaceFound {
  readonly face: BuildingFace
  readonly facing?: number
}

/** The building a hit landed on, from what its tile said of it. */
function buildingAt(hit: Hit): Building | null {
  return toldOf(hit.object as Mesh, hit.item)
}

/**
 * What a tile says about one of its buildings.
 *
 * `feet` is how the feet of this mesh are come by, for whoever is about to ask
 * after several buildings of it: the walk is over the whole mesh either way,
 * so a caller holding one answer hands it in rather than paying for it per
 * building. Left out, one is read for this building alone.
 */
function toldOf(mesh: Mesh, at: number, feet?: () => Map<number, FootBox>): Building | null {
  const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
  const id = facts?.ids[at]
  if (!facts || !id) return null
  const heights = mesh.userData[BUILDING_HEIGHTS] as Map<number, number> | undefined
  // Kept for as long as the tile stands where it stood when they were read. A
  // building a page stood is moved by moving its tile's group, and kept for
  // good the answer read before the move was the answer after it
  let standing: Position | undefined
  let stood: readonly Position[] | undefined
  const standingFor = new Matrix4()
  const stoodFor = new Matrix4()
  const moved = (since: Matrix4, had: unknown) => {
    mesh.updateWorldMatrix(true, false)
    if (had !== undefined && since.equals(mesh.matrixWorld)) return false
    since.copy(mesh.matrixWorld)
    return true
  }
  let said: BuildingAttributes | null | undefined
  return {
    id,
    name: facts.names[at] ?? '',
    usage: facts.usages[at] ?? '',
    storeys: facts.storeys[at] ?? 0,
    tall: heights?.get(at) ?? 0,
    get attributes(): BuildingAttributes | null {
      return (said ??= facts.attributesAt(at))
    },
    get position(): Position {
      if (moved(standingFor, standing)) standing = positionOf(mesh, at, feet ? feet() : feetOf(mesh))
      return standing!
    },
    get corners(): readonly Position[] {
      if (moved(stoodFor, stood)) stood = cornersOn(mesh, at)
      return stood!
    },
  }
}

/** Whether what a page handed the painter is a piece of ground rather than a style. */
function isSite(what: BuildingStyle | MaskShape): what is MaskShape {
  return 'shape' in what
}

/** Held between readings: a foot is turned into a place and the vector thrown away. */
const STANDS = new Vector3()

/**
 * Where a building's foot falls on the map.
 *
 * The foot is in the tile's own metres and where the tile stands is carried by
 * the group it hangs from, so the mesh's own matrix turns the one into the
 * other — the same step `HiddenBuildings.outOf` takes to judge a site.
 *
 * A building whose foot is not in the map has no corner low enough to have made
 * one, which the survey does not draw; it answers with the tile's own origin
 * rather than with nought, so that a rule reading it is at least in the right
 * city.
 */
function positionOf(mesh: Mesh, at: number, feet: Map<number, FootBox>): Position {
  const foot = feet.get(at)
  mesh.updateWorldMatrix(true, false)
  STANDS.set(foot?.x ?? 0, 0, foot?.z ?? 0).applyMatrix4(mesh.matrixWorld)
  const lat = yToLat(-STANDS.z)
  return { lat, lng: xToLon(STANDS.x), height: STANDS.y * metersPerUnit(lat) }
}

/** Held between readings, as {@link STANDS} is. */
const CORNER = new Vector3()

/**
 * The corners of one building's foot, on the map.
 *
 * The step {@link positionOf} takes, taken once a corner. A building with no
 * corner low enough to have been read as a foot answers with none rather than
 * with the tile's origin: one place that is not on the building is something a
 * reader can mistake for an answer, and no places is not.
 */
function cornersOn(mesh: Mesh, at: number): readonly Position[] {
  const corners = stoodOf(mesh).get(at)
  if (!corners) return []
  mesh.updateWorldMatrix(true, false)
  const places: Position[] = []
  for (let i = 0; i < corners.length; i += 2) {
    CORNER.set(corners[i] ?? 0, 0, corners[i + 1] ?? 0).applyMatrix4(mesh.matrixWorld)
    const lat = yToLat(-CORNER.z)
    places.push({ lat, lng: xToLon(CORNER.x), height: CORNER.y * metersPerUnit(lat) })
  }
  return places
}

/** How high the tallest thing in a set of seated meshes reaches, in metres. */
function topOf(meshes: readonly Mesh[]): number {
  let top = 0
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes['position']
    if (!positions) continue
    for (let i = 0; i < positions.count; i++) top = Math.max(top, positions.getY(i))
  }
  return top
}

/**
 * Says how high the land is under each building of a tile.
 *
 * Taken under the middle of each building's own foot, not the tile's — a
 * batch covers a couple of hundred metres and a hillside moves by tens of
 * them across that, so a tile stood as one would have its uphill buildings
 * buried and its downhill ones in the air, which is the very thing
 * {@link seat} was written to stop.
 *
 * The reading comes from the elevation tiles rather than from the heights the
 * buildings themselves arrive with. Those are above the ellipsoid and these
 * are above sea level, and in Japan the two are 31 to 43 metres apart by a
 * figure that moves from place to place and is published nowhere a browser
 * can reach. Reading the ground under the foot needs none of it: a building
 * stands on the ground that is actually drawn, whatever that ground is.
 *
 * What comes back is the other half of the same reading: how far below that
 * middle the lowest ground under each foot lies, which is how far its walls
 * are carried down once its windows are in. A mesh with no feet to read
 * answers nothing.
 */
function standOnLand(
  meshes: readonly Mesh[],
  land: Heights,
  origin: { x: number; z: number },
  stretch: number,
): (Float32Array | null)[] {
  return meshes.map((mesh) => {
    const footing = groundUnder(mesh, land, origin, stretch)
    if (!footing) return null
    standOn(mesh, footing.under, footing.hem)
    return footing.hem
  })
}

/**
 * Says how high the land is under one building of a mesh, and leaves the rest
 * of the mesh as it was.
 *
 * For a building a page has moved. Only ever a mesh cut down to that one
 * building ({@link leaveOne}), which is why the other readings are simply
 * dropped: a mesh with a city in it stands on the land under each of its own
 * feet and nothing moves it.
 *
 * The hem is kept as it was found. It is the slope the building was surveyed
 * on and it has no business following it anywhere — but it is cut into the
 * corners rather than carried beside them, and a cut cannot be taken back: read
 * as nought, the very corners that were let down would be the ones thrown away
 * as under the ground, and the gap the hem was cut to fill would open again.
 */
function standOneOn(mesh: Mesh, building: number, height: number): void {
  const under = new Float32Array(building + 1)
  under[building] = height
  standOn(mesh, under, hemOf(mesh) ?? new Float32Array(under.length))
}

/**
 * The patch to read the heights over for one place: the place and no width.
 *
 * {@link heightsUnder} opens what it asks for out by a reading on every side,
 * which is what brings in the four the place is read between — so a patch of
 * nothing is enough, and asking for more would fetch tiles nobody reads.
 */
function justAt({ x, y }: { readonly x: number; readonly y: number }): WorldBounds {
  return { minX: x, minY: y, maxX: x, maxY: y }
}

/**
 * Sit each building in the tile on the ground.
 *
 * A tile holds some twenty buildings standing on ground of its own height.
 * Seating the tile as one leaves all but the lowest hanging in the air, by as
 * much as the ground rises across it, so each comes down by its own lowest
 * corner instead. Which vertex belongs to which building is on the vertex.
 */
function seat(meshes: readonly Mesh[]): void {
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes['position']
    const batch = mesh.geometry.attributes[BATCH_ID]
    if (!positions || !batch) continue

    const bottom = new Map<number, number>()
    const top = new Map<number, number>()
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i)
      const building = batch.getX(i)
      const low = bottom.get(building)
      if (low === undefined || y < low) bottom.set(building, y)
      const high = top.get(building)
      if (high === undefined || y > high) top.set(building, y)
    }
    // How tall each stands, while its corners are in hand: the walk is here
    // and nothing later keeps the shape the survey drew — windows and
    // parapets both move the roof.
    const heights = new Map<number, number>()
    for (const [building, low] of bottom) heights.set(building, (top.get(building) ?? low) - low)
    mesh.userData[BUILDING_HEIGHTS] = heights

    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, positions.getY(i) - (bottom.get(batch.getX(i)) ?? 0))
    }
    positions.needsUpdate = true
    mesh.geometry.computeBoundingSphere()
  }
}

/**
 * Whether a thing hangs, however deep, under the layer's own root.
 *
 * Walked up to the root rather than asked for a parent. A tile is dropped by
 * its whole group being taken off the root, and the meshes stay children of
 * what is inside that group — so a dropped tile's mesh has a parent for the
 * rest of its life, and anything testing for one holds on to a mesh whose
 * geometry has already been let go.
 */
function seated(thing: Object3D, root: Object3D): boolean {
  for (let up: Object3D | null = thing; up; up = up.parent) if (up === root) return true
  return false
}
