import { Color, Group, type Mesh, Object3D } from 'three/webgpu'
import { appearStagger, appearTakes, doneBy, stampWhole, turnBack, type Way } from './appear.js'
import { GSI_CREDIT, PLATEAU_CREDIT, type Credit } from './credits.js'
import { heightsInHand, heightsUnder, type Heights } from './elevation.js'
import { Events, type Hit, type LoadFailure, type Position } from './events.js'
import { overlapsJapan } from './geo/japan.js'
import { metersPerUnit, type WorldBounds } from './geo/mercator.js'
import {
  maskArea,
  maskBoxesIn,
  maskIn,
  maskTouches,
  standsSomewhere,
  type MaskShape,
  type MaskArea,
} from './mask.js'
import { tileBounds, tileKey, tilesCovering, type TileId } from './geo/tiles.js'
import { cutToLand, drape, drapeTile, liftOver, stretchOver, type Lift } from './ground/drape.js'
import { CHANGING_OVER, GroundMaterials } from './ground/materials.js'
import { colorFor, type Palette, type ThemeColor } from './theme.js'
import { buildBankShade, buildFill, buildLines, buildRibbon } from './ground/meshes.js'
import { Surface } from './ground/surface.js'
import { LAND } from './passes.js'
import { coveredBy, hashText } from './ground/scatter.js'

import { drop, TileSet } from './tileSet.js'
import { ShapingTurns } from './shaping.js'
import { cutTrees, TALLEST_TREE, type TreeShape } from './ground/treeShapes.js'
import { eachWood, plant, stampTrees } from './ground/trees.js'
import {
  GROUND_PIECES,
  parseTile,
  parseFootprints,
  stackedAt,
  LINES_OVER_THEIR_KIND,
  type GroundAreaName,
  type GroundLineName,
  type GroundPieceName,
  type GroundRibbonName,
  type PolygonMesh,
  type RibbonMesh,
} from './ground/tileGeometry.js'
import { vectorTileUrl } from './vectorTiles.js'
import { citiesIn } from './plateau/cities.js'
import { luseTiles, LUSE_ZOOM, parseLuse } from './plateau/luse.js'
import { transient, Unreadable } from './transient.js'
import type { Change, Layer, Viewer } from './Viewer.js'
import { ASK_PLAINLY, type Ask } from './requests.js'

/**
 * Writes on a mesh where in the stack it is drawn, and hands it back.
 *
 * Three reads this off the mesh itself, and reads the stage off the ground's
 * root — the holders in between are not groups, so they pass it on; see
 * `Ground.groups` — so the two numbers are a stage and a place inside it and
 * never have to be added up; see `order.ts` and `GROUND_STACK`.
 *
 * `past` is a part of a step after the kind's own number, for the one kind
 * drawn two ways; see `LINES_OVER_THEIR_KIND`.
 */
function stacked<T extends Object3D>(mesh: T, what: GroundPieceName | 'bank' | 'tree', past = 0): T {
  mesh.renderOrder = stackedAt(what) + past
  return mesh
}

/** The zooms the vector tiles exist at. */
const MIN_ZOOM = 4
const MAX_ZOOM = 16

/**
 * The most tiles chosen at once, and the ceiling on how many are counted out
 * to choose from — `pickTiles` asks for eight times this many candidates.
 *
 * Not a page's to set. Whether 64 is right is settled by the window's size,
 * its tilt and the zoom, which the viewer knows and the page does not; the
 * finest ground tile is z16, some 500m square at 35°N, so this reaches about
 * 4km across before it bites.
 */
const MOST_TILES = 64

/**
 * How many tiles of the land may be on their way at once.
 *
 * Sixteen, against {@link MOST_TILES} of them wanted at the widest a view can
 * ask: four turns to fill a screen that is being filled from nothing, and the
 * nearest to the middle go first, so the middle fills while the corners are
 * still coming. The screen is the small case. A shape standing on the map has
 * no allowance — every tile inside it is wanted, which over a few kilometres
 * is thousands — and without a number here they all went out together, each
 * one holding up the others for ground nobody was looking at yet.
 *
 * Not measured against a slower line or a busier server; what it is here for
 * is the order they arrive in rather than how long they take altogether.
 */
const FLOOR_AT_ONCE = 16

/**
 * How many tiles of the green may be on their way at once: six.
 *
 * Fewer than the land's, because one of these is some ten times the weight —
 * six is already megabytes in flight — and because a shape standing on the map
 * asks for every one inside it at the single zoom the green is published at.
 */
const GREEN_AT_ONCE = 6

/**
 * How many tiles a shape standing on the map may ask for before it is worth
 * saying so out loud.
 *
 * Ten screenfuls. A mask that stands still has no allowance — cutting the
 * list would leave part of the shape never fetched and nothing would say
 * which part — so the only thing holding the download down is the size a page
 * wrote. A radius with a zero too many is a few thousand tiles, and all a
 * reader sees is a map that never finishes.
 *
 * Not refused: the page asked for it, and a page asking for a district is
 * right to get a district. Said once, with the number, so whoever reads the
 * console knows what they bought.
 */
const TILES_WORTH_SAYING = MOST_TILES * 10

/**
 * How many screen pixels thick the kinds drawn as lines are where nothing
 * says otherwise: the narrow water, the coastline and the boundaries.
 */
const DEFAULT_LINE_WIDTH = 1

/**
 * What the kinds laid as ribbons multiply their width by where nothing says
 * otherwise: one, which is the width the survey gives each road, and the one
 * double-track width every railway is laid at.
 */
const DEFAULT_WIDTH_SCALE = 1

/** How far apart trees stand where nothing says otherwise, in metres. */
const DEFAULT_TREE_SPACING = 11

/**
 * How many pixels of rise the land has to have on screen before it is worth
 * the sun's view and the corner shading; see {@link Ground.tallest}.
 *
 * Eight, which at the opening view of the whole country wants sixteen
 * kilometres of it — so nothing is drawn there — and by the zooms a mountain
 * is looked at takes six hundred metres, which Fuji has four times over.
 */
const RELIEF_PIXELS = 8

/**
 * How far under {@link RELIEF_PIXELS} the land is held on once it is drawn:
 * half, which is one step of zoom.
 *
 * One number against one threshold turns two whole passes over the scene on
 * and off, so the zoom it is crossed at is a line the whole screen changes
 * character on. With nothing to hold it, a reader rocking the wheel over that
 * zoom had the shadows and the corner shading switch with almost every notch
 * — measured at 鎌倉, where the land rises 61.5m and the line falls at z14.0:
 * seven changes in eight notches, with nothing else on the screen moving.
 * A notch is about 0.4 of a zoom — see what the wheel is worth in `Viewer.ts`
 * — so a hold of a whole one cannot be crossed both ways by one of them:
 * going there is a change, and rocking over it is not.
 */
const RELIEF_HOLD = 0.5

/** A green tile that failed because the catalog saying where it is did, and which catalog. */
class CatalogFailed extends Error {
  constructor(
    readonly key: string,
    override readonly cause: unknown,
  ) {
    super(`The catalog ${key} could not be fetched`)
  }
}

/**
 * Names a catalog's failure as the catalog's — except a fetch given up on,
 * and an answer that could not be read, which the tile set reads by their own
 * shape and would mistake for a failure worth asking again.
 */
function asCatalogs(key: string): (cause: unknown) => never {
  return (cause) => {
    if ((cause as Error)?.name === 'AbortError' || cause instanceof Unreadable) throw cause
    throw new CatalogFailed(key, cause)
  }
}

/**
 * One piece of the ground as a page writes it when the ground is made: the
 * same names, and the same types, the piece answers to afterwards — see
 * {@link GroundPiece}.
 */
export interface GroundPieceOptions {
  /**
   * What it is drawn in. Left out, the theme's colour of the same name —
   * `ground.road` is drawn in `theme.road` — and it follows the theme from
   * then on.
   *
   * Given, it comes over the theme, and goes on coming over it as the palette
   * turns at dusk: a page that asked for a sand coloured land meant sand, not
   * sand until the sun is down. A `{ light, dark }` pair is how a colour is
   * said for each of the two.
   */
  color?: ThemeColor
  /** Whether it is drawn. On by default. */
  visible?: boolean
}

/**
 * A piece laid as a ribbon: the roads, at the width the survey gives each, and
 * the railways, at the one width the library lays them all at — see
 * {@link GroundRailOptions}.
 */
export interface GroundRibbonOptions extends GroundPieceOptions {
  /**
   * What the width is multiplied by. 1 by default, which is the width the
   * survey gives a road and the one width every railway is laid at; 2 lays
   * every one twice as wide. However far off the view is, none is drawn
   * thinner than about a pixel.
   *
   * A scale and not a width because each road carries a width of its own: one
   * number of pixels would draw an expressway and a lane as the same line. The
   * railways carry none, so the scale is kept for them too and multiplies
   * their one width — one way to write it for both ribbons.
   */
  widthScale?: number
}

/**
 * The railways: a ribbon of two rails and their sleepers, laid on stones.
 *
 * The survey gives a railway no width, so every one is laid at about one
 * double track, a station no wider than open line, and `widthScale` multiplies
 * that one width. The gauge, the rails and how far the sleepers reach are
 * measured across the ribbon and widen with it; the sleepers stay as far
 * apart along it.
 */
export interface GroundRailOptions extends GroundRibbonOptions {
  /** The stones the rails and sleepers lie on. Left out, the theme's `ballast`. */
  ballastColor?: ThemeColor
}

/** A piece drawn as a line some screen pixels thick: the coastline, the boundaries. */
export interface GroundLineOptions extends GroundPieceOptions {
  /** How thick, in CSS pixels. 1 by default. */
  width?: number
}

/**
 * The water. The survey draws it two ways — a river wide enough to have banks
 * as an area, a canal or a culvert too narrow for one as its centre line — so
 * it is both, and its `width` is the narrow water's alone.
 */
export interface GroundRiverOptions extends GroundLineOptions {
  /**
   * Whether the water is shaded just inside its bank. On by default. Where
   * water meets land it goes a little into shade, as the foot of a wall does.
   *
   * The water's and not a piece of its own: it is drawn from the water's
   * outline and goes when the water does.
   */
  bank?: boolean
}

/**
 * The trees standing on the green, as a page writes them when the ground is
 * made; see {@link GroundTrees}.
 *
 * Not a piece like the rest. They are no kind of tile but what stands on the
 * green's, and what can be said of them is what can be said of a tree: its
 * crown, its trunk, the line round it and how far it stands from the next.
 */
export interface GroundTreesOptions {
  /**
   * Whether they stand. On by default.
   *
   * They show from the zoom their green arrives at (z16), which is the only
   * zoom PLATEAU publishes land use at — below it there is no park for a tree
   * to stand in. Crossing that zoom they come up out of the ground, and go
   * back under it, in step with the parks they stand on.
   *
   * Apart from the green's own switch: the green hidden, they still stand,
   * since the land use they are planted from is fetched while either shows.
   */
  visible?: boolean
  /**
   * How far apart they stand, in metres. Closer is denser. 11 by default, and
   * never under 1.
   *
   * Up to 1,200 trees to a green tile (z16, some 500m square), however close
   * the spacing. A tile mostly park or forest reaches that before it reaches
   * the spacing — at the default, once trees are planted over more than about
   * three fifths of it — and stands its trees further apart than its
   * neighbours do.
   */
  spacing?: number
  /** Their crowns. Left out, the theme's `leaf`. */
  leafColor?: ThemeColor
  /** Their trunks. Left out, the theme's `trunk`. */
  trunkColor?: ThemeColor
  /** Whether each is drawn with a line round it. Off by default. */
  line?: boolean
  /** That line. Left out, the theme's `treeLine`. Ink: drawn unlit, and the colour it says. */
  lineColor?: ThemeColor
}

/**
 * One piece of the ground as it stands: `ground.surface`, `ground.green` and
 * `ground.footprint` are this and no more, and every other piece is this and
 * something besides.
 *
 * A thing of its own rather than a row of fields on the ground, the way
 * three's `light.shadow` is one: the pieces carry different settings —
 * ballast on the railway alone, a bank on the water alone — and held apart,
 * each keeps the names it is written with when the ground is made. What is
 * written is drawn from the next frame on; no tile is fetched again for it.
 *
 * Except the green's switch, while the trees are off as well: nothing then
 * wants the land use, so turning the green off lets its tiles go, and turning
 * it on again fetches and cuts them afresh — the parks come back as their
 * tiles arrive, not on the next frame. With the trees on, the tiles are held
 * for them and the green comes straight back.
 */
export interface GroundPiece {
  /** See {@link GroundPieceOptions.color}. Undefined is the theme's colour, and writing it goes back there. */
  color: ThemeColor | undefined
  /** See {@link GroundPieceOptions.visible}. */
  visible: boolean
}

/** `ground.road`; see {@link GroundRibbonOptions}. */
export interface GroundRibbon extends GroundPiece {
  /** See {@link GroundRibbonOptions.widthScale}. */
  widthScale: number
}

/** `ground.rail`; see {@link GroundRailOptions}. */
export interface GroundRail extends GroundRibbon {
  /** See {@link GroundRailOptions.ballastColor}. Undefined is the theme's `ballast`. */
  ballastColor: ThemeColor | undefined
}

/** `ground.coastline` and `ground.boundary`; see {@link GroundLineOptions}. */
export interface GroundLine extends GroundPiece {
  /** See {@link GroundLineOptions.width}. */
  width: number
}

/** `ground.river`; see {@link GroundRiverOptions}. */
export interface GroundRiver extends GroundLine {
  /** See {@link GroundRiverOptions.bank}. */
  bank: boolean
}

/** `ground.trees`; see {@link GroundTreesOptions}. */
export interface GroundTrees {
  /** See {@link GroundTreesOptions.visible}. */
  visible: boolean
  /** See {@link GroundTreesOptions.spacing}. Reads back as it is stood, so never under 1. */
  spacing: number
  /** See {@link GroundTreesOptions.leafColor}. Undefined is the theme's `leaf`. */
  leafColor: ThemeColor | undefined
  /** See {@link GroundTreesOptions.trunkColor}. Undefined is the theme's `trunk`. */
  trunkColor: ThemeColor | undefined
  /** See {@link GroundTreesOptions.line}. What stands stays standing; only the line stops. */
  line: boolean
  /** See {@link GroundTreesOptions.lineColor}. Undefined is the theme's `treeLine`. */
  lineColor: ThemeColor | undefined
}

export interface GroundOptions {
  /** The land itself, the sheet everything else is laid on. */
  surface?: GroundPieceOptions
  /**
   * The parks, the fields, whatever PLATEAU's land use calls green. The data
   * is heavy, so it only shows in close (z16) and only over the cities PLATEAU
   * covers. It is fetched while this or {@link GroundOptions.trees} shows, so
   * hiding the green alone leaves the trees standing.
   */
  green?: GroundPieceOptions
  /** The rivers, the canals, the water. */
  river?: GroundRiverOptions
  /**
   * The footprints of the buildings, which the ground draws and the city
   * stands on.
   *
   * No width: they are areas and nothing else. A number for them stood in the
   * table of widths from the first, and no material ever read it.
   */
  footprint?: GroundPieceOptions
  /** The railways. */
  rail?: GroundRailOptions
  /** The roads. */
  road?: GroundRibbonOptions
  /** Where the land meets the sea. */
  coastline?: GroundLineOptions
  /** The lines between wards and prefectures. */
  boundary?: GroundLineOptions
  /** The trees standing on the green. */
  trees?: GroundTreesOptions
  /**
   * Whether the land carries its own light. Off by default, so the sun shades
   * it as it shades everything else.
   *
   * On, the colours asked for are the colours drawn: no shadow falls on the
   * land, no hillside turns from the sun, and the map reads as a printed plan
   * with a city standing on it.
   *
   * Read once, as the land is made, and not afterwards — the one setting of
   * the land that is. Every kind the land draws — the surface, the green, the
   * water, the roads, the rails, the trees — is a material of its own, and a
   * material's nodes are settled before it is first drawn; a page that changed
   * its mind here would be asking for all of them to be thrown away and woven
   * again. The things a page does change while it watches are single ones — a
   * building, a model, a block — and those can.
   *
   * Which is also why it is not written as three's `material.lights`: there is
   * no one material to write it on, and the land is not handed out. The land's
   * route is `inFullDaylight` rather than `glows`, since the palette's numbers
   * are reflectances already and only the light has to go; see `lit.ts`.
   */
  glows?: boolean
  /**
   * Whether the viewer's mask cuts the land. On by default, as it is for
   * everything the map itself draws — the word a solid and the picture
   * layers have (rule 5). Off, the land is drawn and fetched over the whole
   * of what the view covers, under a picture laid past the mask's edge, say,
   * while the city beside it is still cut to the shape. A property
   * afterwards, by the same name.
   */
  masked?: boolean
  /**
   * Whether the land is drawn at all. On by default.
   *
   * More than `root.visible`, which is where it lands: it is read rather than
   * only obeyed, and the land off chooses no tiles, so nothing is fetched for
   * a map that is not drawn. Each piece has a switch of its own besides.
   */
  visible?: boolean
}

/**
 * The land a viewer makes for itself: what any land takes, and the one word
 * that is the viewer's to hold.
 */
export interface ViewerGroundOptions extends GroundOptions {
  /**
   * Whether the land carries its real heights. Off by default, which draws
   * the whole country flat as a map is.
   *
   * On, the ground is cut to the shape of the land — hills, valleys, the side
   * of a mountain — and everything laid on it follows: the roads, the rivers,
   * the parks and the trees on them, and the buildings, each standing on the
   * ground under its own foot. The heights come from the GSI's elevation
   * tiles, a tile at a time alongside the map tiles that need them.
   *
   * Written here because the land is what carries them, but held by the
   * viewer and read from {@link Viewer.elevation}: a road and the building
   * beside it have to agree about where the ground is, and neither may ask
   * the other. So it is written on the viewer's own land and no other: a
   * page's own `new Ground({ elevation })` took the word and did nothing
   * with it, and is now not allowed to say it.
   */
  elevation?: boolean
}

/**
 * What the ground tells of: what failed to come, everything having come, and
 * the pointer coming onto it, leaving it and clicking it where nothing stands
 * in front.
 */
export interface GroundEvents {
  /**
   * A piece of the map could not be fetched.
   *
   * Told for every tile that fails, so a page showing "the map is having
   * trouble" hears about it. With nobody listening it goes to the console
   * once instead, rather than vanishing.
   */
  error: LoadFailure
  /**
   * Everything the ground was waiting for has arrived, or has failed for good.
   *
   * Told on the turn from busy to idle, so a page hears it again every time
   * the view asks for more and gets it. Behind a mask that stands on the map
   * that turn is "the whole shape is here", which is what a page counting
   * what it found waits for.
   */
  loaded: { readonly tiles: number }
  /**
   * What the land has standing changed: a tile came in, or went. Once a frame
   * however many turned over — the word every fetching layer has for it, and
   * a page showing how much of the map is in reads {@link Ground.tileCount}
   * here rather than on a clock of its own. `tiles` is how many stand now.
   */
  changed: { readonly tiles: number }
  /**
   * The pointer came onto the ground where nothing stands in front of it, or
   * left it: where it is, null where it has gone.
   *
   * Told on the change, so a page reading the place out loud is told once as
   * the pointer comes off a building and onto the street.
   */
  hover: { readonly position: Pick<Position, 'lng' | 'lat'> } | null
  /**
   * Where the pointer is on the land, every time the viewer looks under it —
   * which is every time it moves — and null once it is off the land: the
   * same word the city has (`Buildings`' `pointing`). `hover` answers once,
   * as the pointer comes onto the land; this answers while it travels over
   * it, for a page reading out the place under the pointer.
   */
  pointing: { readonly position: Pick<Position, 'lng' | 'lat'> } | null
  /** The ground was clicked where nothing stood in front of it, and where. */
  click: {
    readonly position: Pick<Position, 'lng' | 'lat'>
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
}

/**
 * The ground the buildings stand on.
 *
 * Water, footprints, railways, roads, coastlines and boundaries come from the
 * GSI's optimised vector tiles; the green alone comes from PLATEAU's land use.
 *
 * All of it lies flat on y=0 unless the viewer is asked for the land's
 * heights, and then all of it is laid on them instead, corner by corner, as
 * each tile is cut. Everything laid on the land reads depth and does not
 * write it: the reading is what leaves a road beyond a ridge behind the ridge
 * rather than painted across it, and not writing is what leaves which of the
 * laid kinds shows on top to be said rather than measured — which is what
 * `GROUND_STACK` says. Read the whole of why at LAID_ON_THE_LAND in
 * `ground/materials.ts`.
 *
 * Each piece it is made of is a property of its own, with the settings that
 * piece has and no others — `ground.road.color`, `ground.rail.ballastColor`,
 * `ground.trees.spacing` — named as {@link GroundOptions} names them, so what
 * a page wrote when the ground was made is what it reads and writes after.
 */
export class Ground implements Layer {
  /** How this layer fetches: through its viewer's `transformRequest`, or plainly before it has one. */
  private get ask(): Ask {
    return this.viewer?.request ?? ASK_PLAINLY
  }

  private viewer: Viewer | null = null
  /** Everything the ground draws. The viewer seats it; see {@link Layer.root}. */
  readonly root = new Group()
  /** Flat pieces, drawn under whatever stands on them. */
  readonly stage = 'ground' as const

  /** The land itself; see {@link GroundOptions.surface}. */
  readonly surface: GroundPiece
  /** The parks and fields; see {@link GroundOptions.green}. */
  readonly green: GroundPiece
  /** The water; see {@link GroundOptions.river}. */
  readonly river: GroundRiver
  /** The footprints of the buildings; see {@link GroundOptions.footprint}. */
  readonly footprint: GroundPiece
  /** The railways; see {@link GroundOptions.rail}. */
  readonly rail: GroundRail
  /** The roads; see {@link GroundOptions.road}. */
  readonly road: GroundRibbon
  /** Where the land meets the sea; see {@link GroundOptions.coastline}. */
  readonly coastline: GroundLine
  /** The lines between wards and prefectures; see {@link GroundOptions.boundary}. */
  readonly boundary: GroundLine
  /** The trees standing on the green; see {@link GroundOptions.trees}. */
  readonly trees: GroundTrees
  /**
   * One holder a kind, so that a kind can be turned off in one line.
   *
   * What stacks them is the number on each mesh (`GROUND_STACK`), not which
   * holder it is in: the renderer sorts, and a holder carries nothing but the
   * `visible` that turns its kind off.
   *
   * **A bare `Object3D`, not a `Group`** (2026-10-29). Three takes the stage
   * off the nearest `Group` above a mesh (`groupOrder`, in
   * `Renderer._projectObject`), so as groups these cut off the number the
   * viewer writes on the root and each said the stage again (`inStage`) — the
   * stage's first place, whatever the ground's own place among the layers of
   * its stage. Nothing on the land writes depth but its sheet, so that number
   * was the whole of its order: a ground a page put on after a picture of its
   * own laid its roads and lines under the picture. Three walks through an
   * `Object3D` without reading a number, so the root's — the ground's place
   * in its stage, written by the viewer — is what every mesh under it is
   * sorted by.
   */
  private readonly groups = new Map<GroundPieceName, Object3D>()
  /**
   * The bank shading, kept just above the water and below whatever comes over
   * it — by its own place in `GROUND_STACK`, right after the water.
   *
   * A holder of its own and not the water's, so that a later tile's water
   * cannot cover where an earlier tile's shading ended: the two now carry
   * different numbers, and a holder is what a kind is turned off by. A bare
   * `Object3D`, as the kinds' are; see {@link groups}.
   */
  private readonly banks = new Object3D()
  /**
   * The trees standing on the green, after every flat kind has been drawn.
   *
   * Where they come among the flat kinds decides nothing, and this is the one
   * place on the ground where that is so. Everything else here reads the
   * land's depth without writing it, so between two of them the later one
   * wins; a tree stands up and writes depth like anything solid, so a road
   * drawn after one is hidden behind it and a road drawn before is covered by
   * it, and either way the tree is in front.
   *
   * Measured rather than reasoned: moved to sit right after the green and
   * compared frame for frame — over a slope with the heights on, and again
   * with the line round each tree turned on — the picture did not change.
   * Last because that is where they were.
   *
   * A bare `Object3D` for all its name, as the kinds' holders are; see
   * {@link groups}.
   */
  private readonly treeGroup = new Object3D()
  /** The tree shapes, carved when the first tile lands with trees on. */
  private shapes: TreeShape[] | null = null
  /** Whether the parks are out. True while they are going back under, too. */
  private parkOut = false
  /** When the last of them will be under, in seconds. Null while they are out. */
  private parkGone: number | null = null
  /**
   * When the last of them will be up, in seconds. Null once they all are.
   *
   * The twin of {@link parkGone}, and here for the same one reason: what the
   * sun's map holds has to be drawn again while they travel. A rise is as
   * invisible from outside as a fall — the trees move in the shader off the
   * appear clock, nothing walking the scene would see it, and the view has
   * usually stopped by then — so without this the wood rose out of ground
   * whose shadows still had it buried.
   *
   * Two things set it, because a park rises two ways: the whole wood coming
   * back over the zoom it stands at ({@link showPark}), and one tile's worth
   * landing while the rest is already out ({@link comingNow}). The second is
   * the commoner — it is what panning onto fresh ground is — and the later of
   * the two moments wins, so a tile landing in the middle of a rise carries
   * the clock out to its own end.
   */
  private parkUp: number | null = null
  private readonly materials: GroundMaterials
  /**
   * What shows wherever nothing else covers it; see {@link Surface}. The sheet
   * the `surface` piece is drawn on, which is that piece's one mesh.
   */
  private readonly sheet = new Surface()
  /** Whether the land's rise is being drawn, which is what holds it on; see {@link RELIEF_HOLD}. */
  private reliefShown = false
  /** The sites a page has cleared, in the order they were given. */
  private readonly cleared: MaskShape[] = []
  /**
   * Those sites worked out, which carries the picture the card reads.
   *
   * Held rather than made and dropped, because the picture is a texture: the
   * one standing has to be given back before another takes its place, and
   * this is the only hand it passes through.
   */
  private clearedArea: MaskArea | null = null

  private readonly floor: TileSet<TileId>
  private readonly greenTiles: TileSet<TileId>
  /** The line the tiles that have arrived wait in to be read; see `shaping.ts`. */
  private readonly shaping = new ShapingTurns()

  /** That the view has changed. The work itself happens once, on the next frame. */
  private dirty = true
  /**
   * That the camera has moved since the tiles were last put in order.
   *
   * Apart from {@link dirty}, which a tile landing sets as well: what the
   * camera decides is only which tile is fetched first, so the order is left
   * alone where nothing but the tiles themselves has changed.
   */
  private viewMoved = true
  /**
   * Which tiles a standing mask asks for, by zoom; see {@link pickTiles}.
   *
   * Only ever a mask that stands on the map. Behind one that rides the camera
   * the tiles are chosen by the screen and change with it, and `screenPicks`
   * keeps that case out of here.
   */
  private readonly maskTiles = new Map<
    number,
    { area: MaskArea; inside: readonly TileId[]; ordered: TileId[] }
  >()
  private readonly events = new Events<GroundEvents>()
  /** Whether anything was still coming when last looked, for telling the turn to idle. */
  private wasBusy = false
  /** The standing mask already spoken about, so a size is said once and not every frame. */
  private spokeOf: MaskArea | null = null
  /** Whether the land carries its own light; see {@link GroundOptions.glows}. */
  private readonly _glows: boolean

  constructor(options: GroundOptions = {}) {
    // Settled before the materials, which are woven by it and are the only
    // thing that acts on it; the getter below is the same answer read back
    this._glows = options.glows ?? false
    // What a piece is told it hands on here, and this is the one place each
    // of those is done; see {@link PieceHost}. Arrows, so that they reach the
    // materials made just below by the time anything is written
    const host: PieceHost = {
      recolor: () => this.changed('colors'),
      reshow: (piece) => this.reshow(piece),
      rewidth: (layer, value) => this.materials.setWidth(layer, value),
      rescale: (layer, value) => this.materials.setWidthScale(layer, value),
      retree: () => this.retree(),
      respace: () => this.respace(),
      reline: (on) => this.materials.setTreeLine(on),
    }
    this.surface = new Piece(host, 'surface', options.surface)
    this.green = new Piece(host, 'green', options.green)
    this.river = new RiverPiece(host, options.river)
    this.footprint = new Piece(host, 'footprint', options.footprint)
    this.rail = new RailPiece(host, options.rail)
    this.road = new RibbonPiece(host, 'road', options.road)
    this.coastline = new LinePiece(host, 'coastline', options.coastline)
    this.boundary = new LinePiece(host, 'boundary', options.boundary)
    this.trees = new TreeSettings(host, options.trees)
    // Read off the pieces rather than off the options, so that the defaults
    // are said in one place: a material is made at the width its piece holds
    this.materials = new GroundMaterials(
      { river: this.river.width, coastline: this.coastline.width, boundary: this.boundary.width },
      { rail: this.rail.widthScale, road: this.road.widthScale },
      this._glows,
    )
    this.root.visible = options.visible !== false
    this._masked = options.masked ?? true
    for (const piece of GROUND_PIECES) {
      // A holder and not a group, so that the number the viewer writes on the
      // root reaches the meshes; see {@link groups}. Which piece it is goes on
      // the meshes; see {@link stacked}.
      const group = new Object3D()
      group.visible = this.visibleNow(piece)
      this.groups.set(piece, group)
      this.root.add(group)
      if (piece === 'river') this.root.add(this.banks)
    }
    this.banks.visible = this.river.visible && this.river.bank
    this.root.add(this.treeGroup)
    // The parks are not out yet, so none of this is drawn. Said here because
    // `dressPark` runs when they come and go, and until they first come the
    // trees would keep the visibility three gives a new group — which is on.
    this.dressPark()
    this.materials.setTreeLine(this.trees.line)

    this.floor = new TileSet<TileId>({
      keyOf: tileKey,
      retain: MOST_TILES * 3,
      atOnce: FLOOR_AT_ONCE,
      load: (tile, signal) => this.loadFloor(tile, signal),
      onError: (cause, key, retrying) => this.failed({ what: 'tile', key, retrying, cause }),
    })
    // A green tile is some ten times the weight, so more of them are held on to
    // and coming back to one does not fetch it again, and fewer go out at once
    this.greenTiles = new TileSet<TileId>({
      keyOf: tileKey,
      retain: 48,
      atOnce: GREEN_AT_ONCE,
      load: (tile, signal) => this.loadGreen(tile, signal),
      // Told apart from the floor's, which shares its addresses at z16 and comes
      // from another server: a page saying "the map is having trouble" and one
      // saying "PLATEAU is" need to know which. The catalogs that say where a
      // city's green is are not a tile at all, and are named as the city names
      // them (see `Buildings`)
      onError: (cause, key, retrying) =>
        cause instanceof CatalogFailed
          ? this.failed({ what: 'catalog', key: cause.key, retrying, cause: cause.cause })
          : this.failed({ what: 'tile', key: `green/${key}`, retrying, cause }),
    })
  }

  // ── Layer ────────────────────────────────────────────────

  attach(viewer: Viewer): void {
    this.viewer = viewer
    // The picture a page may be throwing down over the map, for the trees:
    // what lies on the land is already wearing the page's own sheet of it,
    // and a tree is land but is not something a sheet can reach. Taken here
    // because a material's nodes are settled at its first drawing and nothing
    // has been drawn yet; see `projection.ts`.
    this.materials.setProjection(viewer.projection)
    this.materials.setSight(viewer.sight)
    const land = this.materials.fill('surface')
    this.sheet.mesh.material = land
    // Raised by the card, and facing the way the land faces at each pixel; see
    // `ground/surface.ts`. Said here, before anything is drawn, because a
    // material's nodes are settled at its first drawing
    this.sheet.stand(land)
    this.sheet.shade(land)
    // The one sheet that is the land, and so the one thing the viewer draws
    // again on its own for what stands in it to hide its buried half against.
    // Nothing else here wears it: what lies on the land shares the land's
    // depth, and what stands on it — the trees — would hide the city behind
    // them; see `passes.ts`.
    this.sheet.mesh.layers.enable(LAND)
    /*
     * The land casts, and takes what is cast on it.
     *
     * Casting is only ever worth anything where the land has its heights — a
     * flat sheet throws nothing across itself — but it is said unconditionally
     * rather than following `elevation`, because `castShadow` is read as the
     * the sun's map is drawn and turning it over would mean drawing the sheet
     * into the map or not from one frame to the next. What `elevation: false`
     * already does is flatten the sheet, and a flat sheet in the map writes the
     * same depth the map is cleared to over the same pixels.
     *
     * Receiving is the whole point of the land: a street in the shadow of the
     * block beside it is most of what a shadow in this picture is for.
     */
    this.sheet.mesh.castShadow = true
    this.sheet.mesh.receiveShadow = true
    this.groups.get('surface')?.add(stacked(this.sheet.mesh, 'surface'))
  }

  /**
   * Gives back the tiles and what was built from them. What is kept for good
   * — the materials, the tree shapes carved — is let go of in {@link dispose},
   * so the same ground may be put on a viewer again.
   */
  detach(): void {
    this.materials.setProjection(null)
    this.materials.setSight(null)
    this.parkOut = false
    this.parkGone = null
    this.parkUp = null
    this.dressPark()
    this.floor.clear()
    this.greenTiles.clear()
    this.maskTiles.clear()
    for (const group of this.groups.values()) group.clear()
    this.treeGroup.clear()
    this.sheet.letGo()
    this.dirty = true
    this.viewer = null
  }

  /**
   * Whose data is on the ground at the moment: the GSI's tiles wherever any
   * of the map is drawn, and PLATEAU's as well wherever its green is — the
   * land use the parks are cut from is theirs.
   */
  credits(): readonly Credit[] {
    const named: Credit[] = []
    // Turned off, what it holds is hidden and names nobody. What it still
    // fetches does — the heights, which the city and everything stood on the
    // map stand on; see {@link keepHeights}
    if (!this.root.visible) {
      if (this.viewer?.elevation) named.push(GSI_CREDIT)
      return named
    }
    if (this.floor.onScreen > 0) named.push(GSI_CREDIT)
    if (this.greenTiles.onScreen > 0) named.push(PLATEAU_CREDIT)
    return named
  }

  /**
   * The heights under the view, where the land is turned off but the viewer
   * still carries them.
   *
   * The land is what fetches them. The city asks for the heights under its
   * own tiles, but everything else stood on the map reads only what has
   * arrived ({@link heightsInHand}) and asks for nothing. So a page that
   * turned the land off to lay a floor of its own and left the heights on had
   * its buildings on the real ground, and its picture, its shapes, its marks
   * and its models at sea level wherever no building tile was.
   *
   * Asked for as the view moves and let run: what arrives goes into the one
   * store everything reads from, and a tile already held is not fetched
   * again.
   */
  private keepHeights(viewer: Viewer): void {
    if (!viewer.elevation || !this.dirty) return
    this.dirty = false
    const bounds = maskIn(this.cutBy, viewer.fetchBounds)
    if (bounds) heightsUnder(bounds, viewer.camera.zoom, viewer.signal, viewer.request).catch(() => undefined)
  }

  /**
   * Says how much ground a shape standing on the map has asked for, where it
   * is more than anyone is likely to have meant. Once per mask.
   */
  private sayIfVast(viewer: Viewer, tiles: number): void {
    const area = this.cutBy
    if (viewer.screenPicks || !area) return
    if (this.spokeOf === area) return
    this.spokeOf = area
    if (tiles <= TILES_WORTH_SAYING) return
    console.warn(
      `[plateau-ui] The mask stands on the map, so the whole of it is fetched: ${tiles} ground tiles. ` +
        'Every one is held for as long as the mask is. Make the shape smaller, let it ride the camera, ' +
        "or give the mask `fetch: 'onScreen'` to have it come as the view reaches it.",
    )
  }

  /** Whether anything is still on its way; see {@link Layer.busy}. */
  busy(): boolean {
    return this.floor.busy || this.greenTiles.busy
  }

  /**
   * Tells the turn from busy to idle, once.
   *
   * Read at the top of the frame rather than where tiles are synced: a tile
   * finishes between frames, and the set is only asked for more when the view
   * has moved. Looked at here, the turn is caught whichever of the two put
   * the last piece in.
   */
  /** How many comings and goings the page has been told of; see {@link sayIfLanded}. */
  private tilesTold = 0

  private sayIfLanded(): void {
    const turned = this.floor.changes + this.greenTiles.changes
    if (turned !== this.tilesTold) {
      this.tilesTold = turned
      if (this.events.has('changed')) this.events.emit('changed', { tiles: this.tileCount.onScreen })
    }
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy) this.events.emit('loaded', { tiles: this.floor.size + this.greenTiles.size })
  }

  /**
   * How many tiles the ground holds, and how many of those are on screen.
   *
   * Both kinds counted together: the floor, and the green the trees stand on.
   * For a page that wants to say the map is still filling in.
   */
  get tileCount(): { readonly held: number; readonly onScreen: number } {
    return {
      held: this.floor.size + this.greenTiles.size,
      onScreen: this.floor.onScreen + this.greenTiles.onScreen,
    }
  }

  /**
   * How far the land in view rises from its lowest point, in metres, as the
   * ground is drawing it now. Nought while it is drawn flat.
   *
   * For a page that wants to say what the heights amount to here — and, at
   * nought with the heights turned on, that none of them have arrived yet.
   */
  get relief(): number {
    return this.sheet.relief
  }

  /** For a ground that will not be used again. Take it off its viewer first. */
  dispose(): void {
    this.detach()
    this.shapes = null
    this.clearedArea?.dispose()
    this.clearedArea = null
    this.sheet.dispose()
    this.materials.dispose()
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
    console.warn(`[plateau-ui] Ground: ${failure.what} ${failure.key} failed`, failure.cause)
  }

  /** The land answers every one of the words; see {@link Change}. */
  changed(what: Change): void {
    switch (what) {
      case 'view':
        // Dragging and zooming arrive many times in one frame, so this only
        // leaves a mark.
        this.dirty = true
        this.viewMoved = true
        return
      case 'colors': {
        // A change of colour swaps the materials and nothing else; no tile is
        // fetched again. A piece's colour written by a page comes here too, so
        // there is one way a colour reaches a material.
        //
        // What the page said comes over what the palette says, piece by piece,
        // and goes on saying it when the palette moves — a page that asked for
        // a sand coloured land meant sand, not sand until the page turns dark.
        //
        // Unless it said two colours. A {@link ThemeColor} pair is read for
        // the set now standing, which is why this runs again as the sun
        // crosses rather than being settled once.
        //
        // Each piece is named as the palette names its colour, so the piece's
        // own name is the key; the four that are not a piece's own colour are
        // said by name below.
        if (!this.viewer) return
        const night = this.viewer.night
        const asked: { -readonly [K in keyof Palette]?: Palette[K] } = {}
        const say = (name: keyof Palette, colour: ThemeColor | undefined): void => {
          if (colour !== undefined) asked[name] = new Color(colorFor(colour, night)).getStyle()
        }
        for (const piece of GROUND_PIECES) say(piece, this[piece].color)
        say('ballast', this.rail.ballastColor)
        say('leaf', this.trees.leafColor)
        say('trunk', this.trees.trunkColor)
        say('treeLine', this.trees.lineColor)
        this.materials.setPalette({ ...this.viewer.colors, ...asked })
        return
      }
      case 'elevation':
        // Where each corner lies was decided as its tile was cut, so every
        // tile is cut again. What was fetched is still in the browser's hands,
        // so nothing goes over the network for it.
        this.rebuild()
        return
      case 'mask':
        // The materials are told the new shape, and the tiles are chosen again
        // on the next frame. What now falls outside is not dropped here: it
        // stops being wanted, which hides it and lets it go the same way a tile
        // leaving the screen does, so a mask nudged back and forth does not
        // refetch.
        this.materials.setMask(this.cutBy)
        // What a standing mask asks for was worked out for the shape that is
        // now gone; see {@link maskTiles}
        this.maskTiles.clear()
        this.dirty = true
        return
      case 'appear':
        // What is on its way is finished rather than handed over to the new
        // pace; see {@link settlePark}
        this.settlePark()
        return
    }
  }

  /**
   * Finishes at once the parks' coming or going, and stamps every patch and
   * tree as having got there long ago, for a pace that has just been written.
   *
   * {@link parkGone} and {@link parkUp} were worked out from the pace the park
   * set off at, and the shader reads the new one from this frame on. Left as
   * they were, a longer pace had the wood still rising after the sun's map had
   * stopped following it, and turning the coming and going off stood a park
   * on its way under back up until the old deadline rolled it away. The same
   * as the city's (`Buildings.settle`) and for the same reasons, down to
   * stamping every corner and not only the ones on their way: one that has
   * just arrived is on its way again under a longer pace, and a park put out
   * while the coming and going was off was never stamped up.
   */
  private settlePark(): void {
    if (this.parkGone !== null) {
      // Under, and rolled away, as the frame does once the old deadline comes
      this.parkGone = null
      this.parkOut = false
      this.dressPark()
    }
    this.parkUp = null
    // Long enough ago, at this pace, for every corner to read as arrived: the
    // moment a tile landing among parks on their way under is stamped from
    // (see `comingNow`)
    this.stampPark(-appearStagger() - appearTakes(), 'up')
  }

  /**
   * Clears a site of the footprints drawn on it.
   *
   * What it is for is the other half of `Buildings.hide`: a page that takes
   * the buildings off a site is showing the site cleared, and the plan of
   * those buildings left on the ground would be the one thing still saying
   * they were there.
   *
   * The two are asked separately on purpose. A page writes the site once and
   * reads it twice, as a page standing a block under a circle of its mask
   * already does — which is what keeps a site a shape a page owns rather than
   * a thing one layer has to learn from another.
   *
   * A footprint goes whole or stays whole, judged by its own middle, so a site
   * drawn to the kerb does not leave half of the plot across the street. Only
   * a shape can be named and not a building, since what the ground draws comes
   * from the map's own tiles and carries none of PLATEAU's names.
   *
   * As many sites as a page cares to name: they are drawn out on a grid with
   * the rest of the mask, so a footprint asks one question however many were
   * cleared.
   *
   * A site stands somewhere: a circle or a box with no `center` rides the
   * camera, and is refused rather than quietly clearing nothing.
   */
  hide(what: MaskShape): this {
    standsSomewhere(what, 'Ground.hide')
    this.cleared.push(what)
    this.reclear()
    return this
  }

  /** Puts a site's footprints back, or with nothing given, every site's. */
  show(what?: MaskShape): this {
    if (what === undefined) this.cleared.length = 0
    else {
      const at = this.cleared.indexOf(what)
      if (at >= 0) this.cleared.splice(at, 1)
    }
    this.reclear()
    return this
  }

  /**
   * Works the cleared sites out anew and hands them to the materials, giving
   * back the picture the last lot left behind.
   *
   * No site left comes out as an area with no pieces, which holds nothing —
   * which is what `setCleared` wants, since it reads no area at all as no
   * site cleared.
   */
  private reclear(): void {
    this.clearedArea?.dispose()
    this.clearedArea = maskArea({ shapes: this.cleared })
    this.materials.setCleared(this.clearedArea)
  }

  /** Once, just before drawing. Tiles are only ever swapped here. */
  frame(): void {
    const viewer = this.viewer
    if (!viewer) return
    // The tiles that have arrived are read in turns, a share of each frame;
    // see `shaping.ts`. Before the switch below, so that what is already on its
    // way is let through to be held even while the ground is off
    this.shaping.frame()
    // Turned off it chooses no tiles and so fetches none; what it already had
    // it keeps, hidden, for being turned back on. The heights under the view
    // it goes on fetching, where the viewer carries them
    if (!this.root.visible) {
      this.keepHeights(viewer)
      return
    }
    this.sayIfLanded()
    // Buildings land whether or not the view moved, so this is read every frame,
    // mark or no mark
    this.materials.setArriving(viewer.arriving)

    // The same clock the buildings keep, so the two move in step. The viewer is
    // what brings it up
    const seconds = performance.now() / 1000
    // The wood on its way under — or back up — moves in the shader, like the
    // buildings', so the sun's map is drawn again while it does. Said before
    // the roll-up below, so that the frame the last tree arrives — and the
    // dressing that follows it — is one the map is drawn for as well
    if (this.parkGone !== null || this.parkUp !== null) viewer.stirShadows()
    // Only rolled up once the last is under. Until then they are on their way
    // down, however still the view is
    if (this.parkGone !== null && seconds >= this.parkGone) {
      this.parkGone = null
      this.parkOut = false
      this.dressPark()
    }
    if (this.parkUp !== null && seconds >= this.parkUp) this.parkUp = null

    // The window of heights the card reads may have moved under a sheet that
    // has not been laid afresh; aimed again where it has, and a comparison
    // where it has not
    this.sheet.keep()

    // The view standing still is not the same as there being nothing to do:
    // a tile that failed comes due on its own clock
    if (!this.dirty && !this.floor.due && !this.greenTiles.due) return
    this.dirty = false

    this.materials.setView(metersPerUnit(viewer.camera.center[1]), viewer.worldPerPixel)
    // Raised from whatever heights have arrived rather than waiting for them,
    // and by the card, so a tile landing changes what is drawn without this
    // being laid again; see `landHeights.ts`.
    //
    // Laid over the box round the mask rather than over the whole view. The
    // sheet belongs to no tile, so culling tiles does not shrink it; narrowed
    // here its shape also follows the land closer, since it is cut into the
    // same number of cells however wide it is
    const laid = maskIn(this.cutBy, viewer.visibleBounds)
    this.sheet.mesh.visible = laid !== null
    if (laid) this.sheet.follow(laid, viewer.elevation ? viewer.landHeights : null)
    // One reason the parks go under: below z16 there is no green to stand on
    // — the land use is published at that zoom and no other. A patch of park
    // that simply stopped being drawn as the wheel crossed the line read as a
    // blink, so crossing it they sink instead.
    this.showPark(viewer.camera.zoom >= LUSE_ZOOM, seconds)
    // One reading for choosing tiles, apart from the sheet's: both walk the
    // land, but the sheet walks a grid across one patch while this hops from
    // tile to tile, and a reading remembers the tile it last looked in
    const land = viewer.elevation ? heightsInHand() : null
    // Both steps where the floor is between two of them, so that the coarser
    // can take the screen a pixel at a time instead of all at once; see
    // CHANGING STEP in `materials.ts`. The steps are one zoom apart, so the
    // coarser is a quarter the tiles of the finer over the same ground and
    // asking for both is a few tiles more rather than twice as many.
    const step = this.steps(viewer.camera.zoom)
    this.materials.setStep(step.finer, step.goneOver)
    const fine = this.pickTiles(viewer, step.finer, MOST_TILES, false, land)
    // Joined into a list of their own rather than one pushed onto the other:
    // what a standing mask asks for is kept between frames and handed back as
    // it stands, so adding to it would be adding to what is kept; see
    // {@link maskTiles}.
    const wanted =
      step.coarser === null
        ? fine
        : [...fine, ...this.pickTiles(viewer, step.coarser, MOST_TILES, false, land, true)]
    this.floor.sync(wanted)
    this.sayIfVast(viewer, wanted.length)

    // The green is only ever read at z16: stepping out makes a tile heavier
    // rather than lighter (z12 runs past 100MB) and it cannot be fetched at
    // all. Below that zoom what has arrived is hidden and held, and only what
    // is still arriving is let go. Dropping the lot would fetch and cut some
    // 500KB a tile every time the view crossed 16.
    //
    // Asked for while the green or the trees show, since the trees are
    // planted from the same tiles: the green hidden, its patches are still
    // cut and kept, hidden, under the wood that stands on them
    if (this.greenWanted && viewer.camera.zoom >= LUSE_ZOOM) {
      this.greenTiles.sync(this.pickTiles(viewer, LUSE_ZOOM, MOST_TILES, true, land))
    } else if (this.greenTiles.size > 0) {
      // What is still arriving goes first, so that what has arrived has the
      // whole of what may be held
      this.greenTiles.dropLoading()
      // Taken off the screen only once the parks are under. The sinking is
      // drawn with the very meshes this would hide, so emptying the set while
      // they are still on their way down is the blink the sinking is for.
      if (!this.parkOut) this.greenTiles.sync([])
    }
    // Both sets have had their say about where the camera is, so the next
    // frame leaves the order alone unless it moves again; see {@link viewMoved}
    this.viewMoved = false
  }

  /**
   * Brings the parks up out of the ground, or sends them back under. The green
   * patch and the trees standing on it move as one.
   *
   * Crossing the zoom its land use arrives at, a park appearing and vanishing
   * between two frames would read as the park blinking. It goes by the same
   * clock and the same pace as anything else coming up or going under, so a
   * park and a building crossing their own lines in one wheel turn move
   * together. Asked back before the last of it is under, it turns round where
   * it stands.
   *
   * The green patch comes and goes with trees off, too: taking away the ground
   * trees stand on because there are no trees would leave where a park was as
   * nothing at all.
   */
  private showPark(wanted: boolean, at: number): void {
    const takes = appearTakes()
    // With the coming and going turned off, it is simply put out, or taken away
    if (takes <= 0) {
      this.parkGone = null
      this.parkUp = null
      this.parkOut = wanted
      this.dressPark()
      return
    }

    if (wanted) {
      if (this.parkGone !== null) {
        // On its way down: it turns round where it stands and comes back up.
        // `turnBack` hands back the moment that mesh is done, which is how far
        // down it had got, so the latest of them is when the wood is all up
        this.parkGone = null
        let last = at
        this.eachPark((mesh) => {
          last = Math.max(last, turnBack(mesh, at))
        })
        this.parkUp = last
        return
      }
      if (this.parkOut) return
      this.parkOut = true
      this.dressPark()
      this.stampPark(at, 'up')
      this.parkUp = doneBy(at, takes, appearStagger())
      return
    }

    if (!this.parkOut || this.parkGone !== null) return
    this.stampPark(at, 'down')
    this.parkUp = null
    this.parkGone = doneBy(at, takes, appearStagger())
  }

  /** Draws the green and the trees on it, or rolls them away, by whether the parks are out. */
  private dressPark(): void {
    this.treeGroup.visible = this.parkOut && this.trees.visible
    const green = this.groups.get('green')
    if (green) green.visible = this.visibleNow('green')
  }

  /** The green patches and the trees on them. The outline's shell, which shares their geometry, is left out. */
  private eachPark(visit: (mesh: Mesh) => void): void {
    for (const patch of this.groups.get('green')?.children ?? []) visit(patch as Mesh)
    eachWood(this.treeGroup.children, visit)
  }

  /** Says when the parks move, and which way. */
  private stampPark(at: number, way: Way): void {
    const stagger = appearStagger()
    // Coming out, the patch is laid first and the trees come up through it.
    // Going back, the other way round: the patch leaves once the last tree is
    // under
    const patchAt = way === 'up' ? at : at + stagger
    for (const patch of this.groups.get('green')?.children ?? []) {
      stampWhole(patch as Mesh, patchAt, way)
    }
    eachWood(this.treeGroup.children, (wood) => stampTrees(wood, at, stagger, way))
  }

  /** What a tile landing now should do. With the parks on their way under, it counts as already there. */
  private comingNow(): { at: number; way: Way } {
    if (this.parkGone !== null) return { at: -appearStagger() - appearTakes(), way: 'down' }
    const at = performance.now() / 1000
    // A tile landing while they are out travels from its own moment, and it
    // travels in the shader exactly as the toggle's wood does — so the sun's
    // map has to be drawn again while it does; see {@link parkUp}. This is the
    // commoner of the two rises by far: it is what panning onto fresh ground
    // is. Taken here because this is the one place a landing tile is told to
    // come up, so the patch and its trees are covered by the one line.
    const takes = appearTakes()
    if (takes > 0) this.parkUp = Math.max(this.parkUp ?? 0, doneBy(at, takes, appearStagger()))
    return { at, way: 'up' }
  }

  /**
   * How far the ground reaches above its own lowest point in view: the trees
   * standing on it, and the land itself where it carries its heights.
   *
   * With every layer answering 0 the frame draws neither shadows nor corner
   * shading, and on a screen of parks and no buildings the trees would be left
   * as flat blocks of colour — and a screen of hills, worse, a flat wash of
   * one colour with nothing in it but a skyline.
   *
   * The land's own answer is how far it rises rather than how high it stands:
   * a city a hundred metres up casts the same shadows as one at the shore,
   * and it is the rise that says how far a shadow runs.
   */
  tallest(): number {
    // Off is off: three leaves the whole subtree out, so a viewer told the
    // land still rises here keeps the sun's map and the shading alive over a
    // scene with nothing in it
    if (!this.root.visible) return 0
    const trees = this.treeGroup.visible && this.greenTiles.onScreen > 0 ? TALLEST_TREE : 0
    return Math.max(trees, this.reliefWorthDrawing())
  }

  /**
   * The land's rise, where a shadow of it would be worth seeing.
   *
   * Answering at all turns on two passes over the whole scene — the sun's
   * view and the shading of corners — and over the country at a glance both
   * buy nothing: Fuji's own shadow is two pixels long there, and the corner
   * shading reaches thirty metres, which is a fraction of one. Below a few
   * pixels of rise it says nothing, and nothing is drawn.
   *
   * The hillshading does not come from here. That is the way the ground
   * faces, which every material carries; it is on at every zoom.
   */
  private reliefWorthDrawing(): number {
    const viewer = this.viewer
    const relief = this.sheet.relief
    // The sheet hidden is the land hidden, as far as a shadow is concerned:
    // nothing else on the ground writes the depth a hillside would cast from
    if (!viewer || relief <= 0 || !this.surface.visible) {
      this.reliefShown = false
      return 0
    }
    const perPixel = viewer.worldPerPixel * metersPerUnit(viewer.camera.center[1])
    const wanted = perPixel * RELIEF_PIXELS
    // Held on below what turns it on; see RELIEF_HOLD
    this.reliefShown = relief >= (this.reliefShown ? wanted * RELIEF_HOLD : wanted)
    return this.reliefShown ? relief : 0
  }

  listens(type: 'click' | 'hover' | 'pointing'): boolean {
    return this.events.has(type)
  }

  clicked(hit: Hit): void {
    const { position, x, y, original } = hit
    this.events.emit('click', { position: { lng: position.lng, lat: position.lat }, x, y, original })
  }

  hovered(hit: Hit | null): void {
    this.events.emit('hover', hit ? { position: { lng: hit.position.lng, lat: hit.position.lat } } : null)
  }

  /** Told by the viewer every time it looks under a pointer on the land; see {@link GroundEvents.pointing}. */
  pointed(hit: Hit | null): void {
    this.events.emit('pointing', hit ? { position: { lng: hit.position.lng, lat: hit.position.lat } } : null)
  }

  // ── Events ────────────────────────────────────────────────

  /** Listens for one of {@link GroundEvents}. Hands back the way to stop. */
  on<K extends keyof GroundEvents>(type: K, listener: (event: GroundEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof GroundEvents>(type: K, listener: (event: GroundEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  // ── Settings ──────────────────────────────────────────────

  /**
   * Whether the land carries its own light; see {@link GroundOptions.glows}.
   *
   * Read only. What it decides is settled as the land is made — it is handed
   * to the materials in the constructor, and each of them is woven by it — so
   * there is nothing a setter could honestly do afterwards.
   */
  get glows(): boolean {
    return this._glows
  }

  /**
   * Whether PLATEAU's land use is wanted at all: for its green, or for the
   * trees planted from its plots.
   *
   * One question asked of two switches. The green alone was what fetched it,
   * and turning the green off took the trees with it — a second way to say
   * the trees' own switch, and no way at all to keep a wood on a page that
   * did not want the parks painted.
   */
  private get greenWanted(): boolean {
    return this.green.visible || this.trees.visible
  }

  /**
   * Puts a piece's switch to work, or the water's bank.
   *
   * Only ever a `visible` on groups held for good, so nothing is fetched or
   * cut for it — except where the last thing wanting the land use goes, and
   * then the land use goes with it; see {@link greenWanted}.
   */
  private reshow(piece: GroundPieceName): void {
    const group = this.groups.get(piece)
    if (group) group.visible = this.visibleNow(piece)
    // The shading is the water's, drawn from its outline, and goes when it does
    if (piece === 'river') this.banks.visible = this.river.visible && this.river.bank
    // The one piece that casts, and the sun's map is kept from frame to frame:
    // taken off a still view without a word, its shadow stays printed there
    if (piece === 'surface') this.viewer?.stirShadows()
    if (piece === 'green') {
      if (!this.greenWanted) this.greenTiles.clear()
      // Turned back on, it is chosen afresh; the view may have gone anywhere
      this.dirty = true
    }
  }

  /**
   * Stands the trees up or takes them down, once `trees.visible` is written.
   *
   * Turning them on builds the green tiles held again, because a tile that
   * arrived while they were off was never read for its plots and has nowhere
   * to stand a tree. Turning them off only hides the wood: the tiles carry
   * their trees still, and turning it on again shows them as they were — the
   * same shape `Buildings.edges` has, and for the same reason.
   *
   * Clearing both ways round is what it did, and the way back cost the whole
   * of the way there for nothing: up to 48 tiles parsed again, each green cut
   * to the land over eight halving passes, draped, and up to 1,200 trees
   * planted with four instance buffers apiece — for a change whose whole
   * visible effect is one `visible = false`. Nothing is fetched either way;
   * that much was already true.
   *
   * Off with the green hidden as well, nothing is left that the land use is
   * fetched for, and it is let go the way hiding the green alone once let it
   * go.
   */
  private retree(): void {
    this.dressPark()
    // Trees cast, and taking them off is a `visible` on their group — which
    // the map, held from the frame before, knows nothing about
    this.viewer?.stirShadows()
    if (this.trees.visible || !this.greenWanted) this.greenTiles.clear()
    this.dirty = true
  }

  /** Plants every green tile held again, once `trees.spacing` is written. */
  private respace(): void {
    this.greenTiles.clear()
    this.dirty = true
  }

  /** Drawn at all. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (this.root.visible === value) return
    this.root.visible = value
    // The land casts too, and the sun's map is kept from frame to frame: taken
    // off a still view without a word, its shadow stays printed under it
    this.viewer?.stirShadows()
    // Turned off it chose no tiles the whole time it was off, and the view may
    // have gone anywhere since; turned back on it chooses afresh
    if (value) this.dirty = true
  }
  /** Whether the viewer's mask cuts the land; see {@link GroundOptions.masked}. */
  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (value === this._masked) return
    this._masked = value
    this.materials.setMask(this.cutBy)
    this.maskTiles.clear()
    this.dirty = true
    this.viewer?.stirShadows()
  }

  private _masked: boolean

  /** The shape the land is cut to and fetched by: the viewer's, unless it is told not to be. */
  private get cutBy(): MaskArea | null {
    return this._masked ? (this.viewer?.maskArea ?? null) : null
  }

  /**
   * Which tile zoom a view zoom uses: the view's own, floored, and held to the
   * zooms the tiles are published at.
   *
   * Every zoom, rather than every second or third one. Stepping coarser saved
   * cutting the floor again as the view crossed a zoom, but it left the ground
   * a step behind the view at half of them, and no map this was weighed
   * against does it — they read every integer zoom and stop at the finest
   * their source has, which is what z16 does here: past it the last tile is
   * stretched rather than a finer one asked for.
   */
  tileZoom(viewZoom: number): number {
    return Math.floor(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewZoom)))
  }

  /**
   * The steps of tiles to have on screen, and how far the view has gone from
   * the finer to the coarser.
   *
   * {@link tileZoom} changes at whole zooms, so the change is read from how
   * near the view is to the next whole one below it: a quarter zoom out from
   * it the coarser step begins to come in, and by the time the view is on it
   * the coarser step has the whole screen and the change itself shows
   * nothing. One step out from there the two are the same again and there is
   * nothing to draw twice.
   *
   * Read off the zoom and nothing else, so the same view looks the same
   * whether it was come to from above or below, and however long it took; see
   * CHANGING STEP in `materials.ts`.
   */
  private steps(viewZoom: number): { finer: number; coarser: number | null; goneOver: number } {
    const finer = this.tileZoom(viewZoom)
    const coarser = this.tileZoom(viewZoom - CHANGING_OVER)
    if (coarser === finer) return { finer, coarser: null, goneOver: 0 }
    const changesAt = Math.ceil(viewZoom - CHANGING_OVER)
    return { finer, coarser, goneOver: (changesAt + CHANGING_OVER - viewZoom) / CHANGING_OVER }
  }

  /**
   * Whether a kind left on shows on screen now.
   *
   * Green alone waits on anything: it comes and goes with the trees standing
   * in it. The rest show wherever the page left them on, the footprints
   * among them — a plan of the city is part of the map at any zoom, and
   * where the buildings stand they stand on it.
   */
  private visibleNow(piece: GroundPieceName): boolean {
    // Green only while the parks are out with their trees. Read from whether
    // they are out rather than from the zoom, because on the way under it has
    // to stay until the last of it is
    if (piece === 'green') return this.green.visible && this.parkOut
    return this[piece].visible
  }

  /** Throws away everything held and builds it again as the settings now stand. */
  rebuild(): void {
    this.floor.clear()
    this.greenTiles.clear()
    this.dirty = true
  }

  // ── Choosing the tiles ────────────────────────────────────

  /**
   * Chooses the tiles to fetch at that zoom.
   *
   * What is in view is held as a square wide enough not to shift as the view
   * turns, so a good many of the candidates are off screen. They are put in
   * order of **where they fall on screen** before the list is cut to its limit.
   *
   * Whether one is on screen is worked out by putting its four corners on the
   * screen and asking whether they overlap it. Judged by its middle alone, a
   * tile covering the whole screen would drop out the moment the screen grew
   * as small as the tile, its middle having left.
   */
  private pickTiles(
    viewer: Viewer,
    z: number,
    limit: number,
    onlyVisible = false,
    land: Heights | null = null,
    stopgap = false,
  ): TileId[] {
    const area = this.cutBy
    // Where a mask says how far the land reaches, every tile inside it is
    // wanted and the screen has nothing to add; see {@link Viewer.screenPicks}.
    // The allowance goes with it: a list cut to a budget would leave part of
    // the shape never fetched, and nothing would say which part.
    //
    // A stopgap step is the exception. What it is for is holding the screen
    // while the finer tiles land, so what is wanted of it is what the screen
    // holds and nothing more: fetched over the whole shape it is a quarter as
    // many tiles again, every one of them a coarse stand-in for ground
    // nobody is looking at and that the fine tiles are coming for anyway.
    // Every piece in hand whole, which is what lets the list be kept and the
    // allowance let go. A shape with one piece waiting on the screen is not
    // it: that piece's tiles turn over as the view moves, and a kept list
    // would hand back the ones it had when the camera was elsewhere.
    const whole = !stopgap && area !== null && area.fetchesAll
    // A standing mask is asked the same question every frame and gives the
    // same answer: which tiles lie inside it turns on the shape and the zoom
    // alone, and on nothing the camera does. Worked out afresh each time, that
    // was every tile of the box round the shape counted out, laid against the
    // shape and sorted — tens of thousands of them over a shape kilometres
    // across, for a list identical to the last one. Kept by zoom, and thrown
    // away whenever the shape itself changes; a shape that rides the camera
    // never reaches here, since `screenPicks` is true behind one.
    //
    // By zoom and not by what is asking, because behind a standing mask the
    // allowance and the dropping of what is off screen are both off: the land
    // and the green asking the same zoom are asking the very same question,
    // and the second gets the first's answer.
    const kept = whole ? this.maskTiles.get(z) : undefined
    const held = kept && kept.area === area ? kept : null
    let candidates: readonly TileId[]
    if (held) candidates = held.inside
    else {
      // Narrowed before the tiles are counted rather than after: over a small
      // mask the view may cover a whole prefecture, and counting that many
      // tiles out only to throw them away is work the mask is meant to save.
      //
      // A box for each piece of the mask rather than one box round them all,
      // and each counted out on its own. `tilesCovering` keeps what is nearest
      // the middle of what it is given and drops the rest: over one box holding
      // four stations, that middle is the empty ground between them, and the
      // whole allowance would go on tiles the mask then throws away — leaving
      // nothing for the stations the box was drawn round
      // The screen is handed in whatever the mask does with it: a mask told
      // `fetch: 'onScreen'`, or one riding the camera, has every box cut down
      // to it, and one held whole ignores it; see {@link maskBoxesIn}.
      //
      // A stopgap step binds every piece to it whatever the mask was told, for the
      // reason the paragraph above gives: the coarse stand-in is thrown away
      // as the fine tiles land, so a shape held whole would have it fetched
      // over ground nobody will look at before it is gone.
      const boxes = maskBoxesIn(area, viewer.fetchBounds, stopgap)
      if (boxes.length === 0) return []
      const each = whole ? Infinity : Math.ceil((limit * 8) / boxes.length)
      const found = new Map<string, TileId>()
      for (const box of boxes) {
        for (const tile of tilesCovering(z, box, each)) {
          const bounds = tileBounds(tile)
          if (!overlapsJapan(bounds) || !maskTouches(area, bounds)) continue
          // Pieces that overlap reach the same tile, and a tile is fetched once
          found.set(`${tile.x},${tile.y}`, tile)
        }
      }
      candidates = [...found.values()]
    }
    // And the order they go out in only turns on the camera, so it is kept
    // too, and worked out again when the camera has moved. What it decides is
    // which of them is fetched first and nothing else, so a list that is a
    // frame out of date costs nothing — see the `'view'` arm of {@link changed}.
    if (held && !this.viewMoved) return held.ordered

    const ranked = candidates
      .map((tile) => {
        const bounds = tileBounds(tile)
        const seen = viewer.measureOnScreen(bounds)
        return {
          tile,
          distance: seen.distance,
          // Not worked out where nothing is dropped by it: reading the land
          // under every tile of a shape is a cost paid for an answer no one
          // then asks for
          visible: whole ? true : land ? this.reachesLifted(viewer, bounds, land) : seen.visible,
        }
      })
      .sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance)

    // Still sorted by where they fall on screen even when none is dropped:
    // they go out a few at a time, so the middle of the view fills first
    const rows = onlyVisible && !whole ? ranked.filter((row) => row.visible) : ranked
    const picked = (whole ? rows : rows.slice(0, limit)).map((row) => row.tile)
    if (whole && area) this.maskTiles.set(z, { area, inside: candidates, ordered: picked })
    return picked
  }

  /**
   * Whether a patch meets the screen, judged where the land actually puts it.
   *
   * {@link Viewer.measureOnScreen} judges a patch at sea level. In 東京 the
   * ground is within tens of metres of that; in 御殿場 it is 500m up, and at a
   * tilt a patch is drawn most of a screen away from where sea level would
   * have it. The green is the one thing chosen by that answer alone — it is
   * asked for {@link pickTiles}'s `onlyVisible`, which drops what it says is
   * off screen — so a tile in plain view was judged gone, its patch went out
   * between two frames, and a nudge of the view brought it back (measured at
   * 御殿場). Buildings already carry the land into the same question, in
   * `Buildings.gather`.
   *
   * Read at the middle and at the four corners, since one reading cannot
   * speak for 500m of hillside, and the box is then opened by the span
   * between those five either way: the ground between them can leave them by
   * as much again, and what the room costs is a hillside's own height against
   * half a kilometre across. Where no heights have arrived every reading is
   * sea level, which is the old answer — and heights landing set `dirty`, so
   * the question is asked again when they do.
   */
  private reachesLifted(viewer: Viewer, bounds: WorldBounds, land: Heights): boolean {
    const stretch = stretchOver(bounds)
    let low = Infinity
    let high = -Infinity
    for (const [x, y] of [
      [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2],
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.maxY],
    ] as const) {
      const at = land.at(x, y) * stretch
      low = Math.min(low, at)
      high = Math.max(high, at)
    }
    const span = high - low
    return viewer.reachesScreen(bounds, span * 3, low - span)
  }

  // ── Fetching them ─────────────────────────────────────────

  /**
   * Inside a tile the coordinates are small and start at 0; where the tile
   * itself goes is given to the mesh. Absolute Mercator on the corners would
   * lose its precision in float32.
   */
  private place(mesh: Object3D, bounds: { minX: number; maxY: number }): Object3D {
    mesh.position.set(bounds.minX, 0, -bounds.maxY)
    return mesh
  }

  /**
   * Hangs a tile's meshes, each under the group it is drawn with, once their
   * shaders are woven.
   *
   * Placing and hanging were one call until the weaving went in. They are two
   * now because the weaving has to happen while the meshes are still off the
   * scene: a mesh that is already hanging is drawn by the next frame, and that
   * frame is the one that pays for the shader. See {@link Viewer.weave}.
   *
   * Which holder a mesh goes under is what turns it off with its kind, so the
   * pairs are kept rather than the meshes alone. The order it is drawn in is
   * the number on it; see {@link stacked}.
   */
  private async hang(
    made: readonly (readonly [Object3D, Object3D | undefined])[],
    signal: AbortSignal,
  ): Promise<Object3D[] | null> {
    const meshes = made.map(([mesh]) => mesh)
    await this.viewer?.weave(...meshes)
    // Gone while the weaving was in flight. What is handed back is what the
    // tile set frees, and nothing is handed back here — so this is where the
    // geometry it never hung is let go of.
    if (signal.aborted) {
      drop(meshes)
      return null
    }
    for (const [mesh, into] of made) into?.add(mesh)
    return meshes
  }

  /**
   * How high the land is under a tile, or nothing while the ground is drawn
   * flat.
   *
   * Asked for alongside the tile itself rather than before it: neither waits
   * on the other. A tile of heights covers four of these each way, sixteen in
   * all, so this is one fetch for a screenful and nothing at all for the rest.
   *
   * A tile whose heights cannot be fetched fails with them rather than being
   * laid flat: flat, it would lie under everything else on that patch and
   * nothing would ever come back to put it right. Failed, it is a hole in the
   * map that the tile's own clock fills in — and the heights come from the
   * same server as the tiles, so in practice they are never the only thing
   * missing.
   */
  private async liftUnder(bounds: WorldBounds, zoom: number, signal: AbortSignal): Promise<Lift | null> {
    if (!this.viewer?.elevation) return null
    const heights = await heightsUnder(bounds, zoom, signal, this.ask)
    // The sheet in front of the camera is cut from whatever has arrived, so
    // heights landing are a reason to cut it again even with the view still
    this.dirty = true
    return liftOver(bounds, heights)
  }

  private async loadFloor(tile: TileId, signal: AbortSignal): Promise<Object3D[] | null> {
    const bounds = tileBounds(tile)
    const [res, lift] = await Promise.all([
      this.ask(vectorTileUrl(tile), 'mapTile', { signal }),
      this.liftUnder(bounds, tile.z, signal),
    ])
    if (!res.ok) {
      // Only a moment's trouble is worth asking about again. Anything else the
      // server refuses is its answer — there is no tile there — and would
      // otherwise be asked for forever, backing off to a minute
      if (transient(res.status)) throw new Error(`${res.status}`)
      return null
    }

    const data = await res.arrayBuffer()
    // Read, laid out and woven in a turn; see `shaping.ts`
    await this.shaping.wait(signal)
    if (signal.aborted) return null
    try {
      return this.layFloor(data, bounds, lift, tile, signal)
    } finally {
      this.shaping.done()
    }
  }

  /** What {@link loadFloor} does with a tile once it has its turn. */
  private layFloor(
    data: ArrayBuffer,
    bounds: ReturnType<typeof tileBounds>,
    lift: Lift | null,
    tile: TileId,
    signal: AbortSignal,
  ): Promise<Object3D[] | null> {
    const parsed = parseTile(data, bounds.size)
    // Laid on the land before any of it becomes a mesh, so that every corner
    // is where it will be drawn by the time anything is worked out from it
    if (lift) drapeTile(parsed, lift)

    const made: [Object3D, Object3D | undefined][] = []
    for (const [name, mesh] of Object.entries(parsed.polygons) as [GroundAreaName, PolygonMesh][]) {
      made.push([
        this.place(stacked(buildFill(mesh, this.materials.fill(name), tile.z), name), bounds),
        this.groups.get(name),
      ])
    }
    for (const [name, segments] of Object.entries(parsed.lines) as [GroundLineName, Float32Array][]) {
      made.push([
        this.place(
          // Past the kind's own surfaces; see LINES_OVER_THEIR_KIND
          stacked(buildLines(segments, this.materials.line(name), tile.z), name, LINES_OVER_THEIR_KIND),
          bounds,
        ),
        this.groups.get(name),
      ])
    }
    for (const [name, ribbon] of Object.entries(parsed.ribbons) as [GroundRibbonName, RibbonMesh][]) {
      made.push([
        this.place(stacked(buildRibbon(ribbon, this.materials.ribbon(name), tile.z), name), bounds),
        this.groups.get(name),
      ])
    }
    if (parsed.bank) {
      made.push([
        this.place(stacked(buildBankShade(parsed.bank, this.materials.bank(), tile.z), 'bank'), bounds),
        this.banks,
      ])
    }
    return this.hang(made, signal)
  }

  /**
   * One green tile.
   *
   * Which city's data it is cannot be known ahead of time, so the cities the
   * tile touches are asked in turn — every one of them. A tile over a city
   * line holds the green of both, each in its own city's set, and it was
   * stopping at the first city that had any: the park over the line was
   * never asked for, and neither were its trees.
   */
  private async loadGreen(tile: TileId, signal: AbortSignal): Promise<Object3D[] | null> {
    const bounds = tileBounds(tile)
    const [cities, lift] = await Promise.all([
      citiesIn(bounds, this.ask).catch(asCatalogs('cities')),
      this.liftUnder(bounds, tile.z, signal),
    ])
    if (signal.aborted) return null
    const made: [Object3D, Object3D | undefined][] = []
    // One moment for the whole tile, so the green of two cities comes up together.
    // A tile arriving late does whatever the parks are doing. On their way
    // under it counts as already there; out, it comes up from its own moment.
    // One that arrives while they are rolled away is written afresh when they
    // come back anyway
    const coming = this.comingNow()
    /** Where a tree may stand, fetched once for the tile as the first plot asks; see {@link clearOfBuildings}. */
    let clear: ((x: number, z: number) => boolean) | undefined
    // What one city made is let go of if a later one fails or the tile is
    // given up: nothing of it is hung yet, so nothing else would free it
    const abandon = () => {
      drop(made.map(([mesh]) => mesh))
      return null
    }
    try {
      for (const city of cities) {
        const template = await luseTiles(city.code, this.ask).catch(asCatalogs(city.code))
        if (signal.aborted) return abandon()
        if (!template) continue

        const url = template
          .replace('{z}', String(tile.z))
          .replace('{x}', String(tile.x))
          .replace('{y}', String(tile.y))
        const res = await this.ask(url, 'landUse', { signal })
        // Taking a server in a moment's trouble for a city with no green would
        // mean never asking for that tile again
        if (transient(res.status)) throw new Error(`${res.status}`)
        if (!res.ok) continue

        const data = await res.arrayBuffer()
        // Read and laid out in a turn; see `shaping.ts`
        await this.shaping.wait(signal)
        if (signal.aborted) return abandon()
        let planted: ReturnType<typeof parseLuse>['planted']
        try {
          const parsed = parseLuse(data, bounds.size, this.trees.visible)
          if (!parsed.green) continue

          // Cut to the land before it is laid on it: green arrives as a few wide
          // plots given by their outlines, and on a hillside a plot with nothing
          // inside it is drawn as a chord under the ground it belongs to
          if (lift) {
            cutToLand(parsed.green, lift, stretchOver(bounds))
            drape(parsed.green.positions, lift)
          }
          const patch = buildFill(parsed.green, this.materials.fill('green'), tile.z)
          // Written before it is ever drawn. Handing a drawn shape one more
          // attribute means telling the card again, and being told costs about a
          // second
          stampWhole(patch, coming.at, coming.way)
          made.push([this.place(stacked(patch, 'green'), bounds), this.groups.get('green')])
          planted = parsed.planted
        } finally {
          this.shaping.done()
        }

        if (planted) {
          // Fetched outside a turn, and the trees stood in one of their own
          clear ??= await this.clearOfBuildings(tile, bounds.size, signal)
          if (signal.aborted) return abandon()
          await this.shaping.wait(signal)
          if (signal.aborted) return abandon()
          try {
            const trees = this.plantTrees(planted, tile, lift, clear)
            eachWood(trees, (wood) => stampTrees(wood, coming.at, appearStagger(), coming.way))
            for (const tree of trees) made.push([this.place(stacked(tree, 'tree'), bounds), this.treeGroup])
          } finally {
            this.shaping.done()
          }
        }
      }
    } catch (error) {
      abandon()
      throw error
    }
    // None of the cities it touches had it
    if (made.length === 0) return null
    // Woven in a turn too: the weaving is the long half of hanging a tile
    await this.shaping.wait(signal)
    if (signal.aborted) return abandon()
    try {
      return this.hang(made, signal)
    } finally {
      this.shaping.done()
    }
  }

  /**
   * Stands trees on that tile's plots.
   *
   * A tree's height is in real metres and the world is Mercator, stretched
   * with latitude, so it is brought back by the latitude the tile stands at:
   * the same height in Hokkaido as in Kyushu.
   *
   * They are stood below z18 as well. Green tiles arrive from z16, and
   * skipping them there would mean cutting every tile held again on the way
   * in. A few hundred trees to a tile is cheap.
   */
  private plantTrees(
    lots: PolygonMesh,
    tile: TileId,
    lift: Lift | null,
    clear: (x: number, z: number) => boolean,
  ): Object3D[] {
    this.shapes ??= cutTrees()
    const bounds = tileBounds(tile)
    return plant(lots, {
      seed: hashText(tileKey(tile)),
      spacing: this.trees.spacing,
      stretch: stretchOver(bounds),
      shapes: this.shapes,
      material: this.materials.tree(),
      outline: this.materials.treeLine(),
      clear,
      ...(lift && { lift }),
    })
  }

  /**
   * Where on a green tile a tree may stand: anywhere but in a building.
   *
   * The land use draws a plot of open ground or of forest round whatever
   * stands on it — a school in its grounds, a temple in its wood — rather than
   * with a hole where each building is, so trees scattered over the plot came
   * up through the roofs. The footprints are the map's, from the tile of the
   * same address the floor is cut from; asked for here, it is usually one the
   * browser already holds.
   *
   * A tile with no footprints, or one that could not be had, keeps every
   * place: a few trees in a roof is a smaller fault than a park with none.
   */
  private async clearOfBuildings(
    tile: TileId,
    size: number,
    signal: AbortSignal,
  ): Promise<(x: number, z: number) => boolean> {
    const everywhere = () => true
    try {
      const res = await this.ask(vectorTileUrl(tile), 'mapTile', { signal })
      if (!res.ok) return everywhere
      const footprints = parseFootprints(await res.arrayBuffer(), size)
      if (!footprints) return everywhere
      const covered = coveredBy(footprints.positions, footprints.indices, size)
      return (x, z) => !covered(x, z)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
      return everywhere
    }
  }
}

/**
 * What a piece tells the ground it belongs to as a page writes on it.
 *
 * The pieces hold what a page wrote and the ground does what it means, so a
 * setting is kept in one place and acted on in one place. Each is said as a
 * fact rather than as a value to copy: the ground reads the value back off the
 * piece, which is where the next frame will read it too.
 */
interface PieceHost {
  /** A colour was written: the palette is read through again. */
  recolor(): void
  /** Whether a piece shows was written, or for the water whether its bank is shaded. */
  reshow(piece: GroundPieceName): void
  /** How many screen pixels thick a kind drawn as lines is. */
  rewidth(layer: GroundLineName, value: number): void
  /** What a kind laid as a ribbon multiplies its real width by. */
  rescale(layer: GroundRibbonName, value: number): void
  /** Whether the trees stand. */
  retree(): void
  /** How far apart they stand. */
  respace(): void
  /** Whether the line round them is drawn. */
  reline(on: boolean): void
}

/**
 * A piece's colour and switch, which every piece has; see {@link GroundPiece}.
 *
 * A class of this file and not of the library's: what a page holds is the
 * interface, and what it is made with is the ground's business.
 */
class Piece<N extends GroundPieceName = GroundPieceName> implements GroundPiece {
  private _color: ThemeColor | undefined
  private _visible: boolean

  constructor(
    protected readonly host: PieceHost,
    protected readonly name: N,
    options: GroundPieceOptions = {},
  ) {
    this._color = options.color
    this._visible = options.visible ?? true
  }

  get color(): ThemeColor | undefined {
    return this._color
  }

  set color(value: ThemeColor | undefined) {
    this._color = value
    this.host.recolor()
  }

  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    if (this._visible === value) return
    this._visible = value
    this.host.reshow(this.name)
  }
}

/** A piece laid as a ribbon; see {@link GroundRibbon}. */
class RibbonPiece extends Piece<GroundRibbonName> implements GroundRibbon {
  private _widthScale: number

  constructor(host: PieceHost, name: GroundRibbonName, options: GroundRibbonOptions = {}) {
    super(host, name, options)
    this._widthScale = options.widthScale ?? DEFAULT_WIDTH_SCALE
  }

  get widthScale(): number {
    return this._widthScale
  }

  set widthScale(value: number) {
    this._widthScale = value
    this.host.rescale(this.name, value)
  }
}

/** The railways; see {@link GroundRail}. */
class RailPiece extends RibbonPiece implements GroundRail {
  private _ballastColor: ThemeColor | undefined

  constructor(host: PieceHost, options: GroundRailOptions = {}) {
    super(host, 'rail', options)
    this._ballastColor = options.ballastColor
  }

  get ballastColor(): ThemeColor | undefined {
    return this._ballastColor
  }

  set ballastColor(value: ThemeColor | undefined) {
    this._ballastColor = value
    this.host.recolor()
  }
}

/** A piece drawn, wholly or in part, as lines; see {@link GroundLine}. */
class LinePiece extends Piece<GroundLineName> implements GroundLine {
  private _width: number

  constructor(host: PieceHost, name: GroundLineName, options: GroundLineOptions = {}) {
    super(host, name, options)
    this._width = options.width ?? DEFAULT_LINE_WIDTH
  }

  get width(): number {
    return this._width
  }

  set width(value: number) {
    this._width = value
    this.host.rewidth(this.name, value)
  }
}

/** The water; see {@link GroundRiver}. */
class RiverPiece extends LinePiece implements GroundRiver {
  private _bank: boolean

  constructor(host: PieceHost, options: GroundRiverOptions = {}) {
    super(host, 'river', options)
    this._bank = options.bank ?? true
  }

  get bank(): boolean {
    return this._bank
  }

  /** The shading stays as it was fetched; only whether it shows changes. */
  set bank(value: boolean) {
    if (this._bank === value) return
    this._bank = value
    this.host.reshow('river')
  }
}

/** The trees standing on the green; see {@link GroundTrees}. */
class TreeSettings implements GroundTrees {
  private _visible: boolean
  private _spacing: number
  private _leafColor: ThemeColor | undefined
  private _trunkColor: ThemeColor | undefined
  private _line: boolean
  private _lineColor: ThemeColor | undefined

  constructor(
    private readonly host: PieceHost,
    options: GroundTreesOptions = {},
  ) {
    this._visible = options.visible ?? true
    this._spacing = spacingOf(options.spacing)
    this._leafColor = options.leafColor
    this._trunkColor = options.trunkColor
    this._line = options.line ?? false
    this._lineColor = options.lineColor
  }

  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    if (this._visible === value) return
    this._visible = value
    this.host.retree()
  }

  get spacing(): number {
    return this._spacing
  }

  /** Every green tile held is planted again, since where each tree stands was decided as its tile was cut. */
  set spacing(value: number) {
    const next = spacingOf(value)
    if (this._spacing === next) return
    this._spacing = next
    this.host.respace()
  }

  get leafColor(): ThemeColor | undefined {
    return this._leafColor
  }

  set leafColor(value: ThemeColor | undefined) {
    this._leafColor = value
    this.host.recolor()
  }

  get trunkColor(): ThemeColor | undefined {
    return this._trunkColor
  }

  set trunkColor(value: ThemeColor | undefined) {
    this._trunkColor = value
    this.host.recolor()
  }

  get line(): boolean {
    return this._line
  }

  set line(value: boolean) {
    this._line = value
    this.host.reline(value)
  }

  get lineColor(): ThemeColor | undefined {
    return this._lineColor
  }

  set lineColor(value: ThemeColor | undefined) {
    this._lineColor = value
    this.host.recolor()
  }
}

/** How far apart trees stand, never under a metre: below that every tile runs into its own limit. */
function spacingOf(value: number | undefined): number {
  return Math.max(1, value ?? DEFAULT_TREE_SPACING)
}
