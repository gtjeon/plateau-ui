import {
  Fn,
  If,
  attribute,
  cos,
  dFdx,
  dFdy,
  sin,
  float,
  fwidth,
  int,
  ivec2,
  vec2,
  mix,
  positionGeometry,
  smoothstep,
  varying,
  vec4,
} from 'three/tsl'
import { uniform } from '../repaint.js'
import {
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  type BufferAttribute,
  type Mesh,
  type Node,
} from 'three/webgpu'
import { colorFor, type ThemeColor } from '../theme.js'
import { DEFAULT_SHAPE_COLOR } from '../inks.js'
import { BATCH_ID, BUILDING_SLOTS } from './attributes.js'
import { DecalLayers, MOST_PICTURES, type DecalImage } from './decals.js'
import { aroundBox, boxAround } from './around.js'
import { feetOf, feetOn, footOf, fromFoot, type FootBox } from './foot.js'
import { maskArea, type MaskArea, type StandingShape } from '../mask.js'
import { DEFAULT_OUTLINE_GAP, DEFAULT_OUTLINE_WIDTH, WIDEST_OUTLINE, type Outlines } from '../outlines.js'
import type { Building } from './Buildings.js'
import type { BuildingRule } from './hidden.js'
import { BUILDING_FACTS, type BuildingFacts } from './tileContent.js'
import { northWall, storeysOn, wallUnder } from './standing.js'
import { lookup } from '../lookup.js'

/**
 * What a page has painted on a building of the city, and where the shaders
 * read it.
 *
 * A colour cannot ride on the material: every tile shares one, and three
 * weaves a shader for each — about a second apiece — so a building painted red
 * would stall the frame it was painted on. So it rides the way a move does. A
 * small table is kept, a column to a painted building, and every corner
 * carries the number of the column that holds its own. Column 0 is the plain
 * city, which is what all but a handful of corners say.
 *
 * A band round one storey is here rather than in a layer of its own for the
 * same reason a colour is: a strip of geometry cut round a building would be a
 * mesh apiece. The wall is one quad from the pavement to the roof, so where a
 * band falls is not something the corners can say — it is the fragment that
 * knows how high up the wall it is, and it is the fragment that compares.
 */

/** How much of a colour goes on where a page does not say, and what it is held to. */
function strengthOf(asked: number | undefined): number {
  return Math.min(Math.max(asked ?? 1, 0), 1)
}

/**
 * How many buildings a page can have painted at once, column 0 aside.
 *
 * A column is held by what a page asked for rather than by what is on screen,
 * so this is a count of wishes and not of buildings in sight. A page colouring
 * a ward by some value would ask for more than this; that wants a rule read as
 * the tiles land, which is not what this is.
 */
const STYLE_SLOTS = 1024

/** How many bands one building can carry. */
const BANDS = 2

/**
 * The last row of a column, after the whole and the bands: the slot the
 * building's line colour is in, and whether it carries its own light.
 *
 * Two unlike things on one texel because a texel is four wide and the line
 * wants one of the four. A row of its own for a single flag would be a
 * thousand texels to say one thing.
 */
const OUTLINE_ROW = 1 + BANDS * 2

/**
 * Where the roof's picture sits: the middle of it in the mesh's own metres,
 * then how far it reaches across and up the roof, also in metres.
 *
 * In the mesh's metres rather than in the world's because that is what a
 * corner carries. A building moved by a motion is moved after this, so a
 * picture written here goes with it rather than staying where the building was.
 */
const ROOF_WHERE = OUTLINE_ROW + 1

/**
 * Which layer the roof's picture is in, which way its top points, and the
 * height of the middle of its box and half how deep the box is — below nought
 * for a box that reaches every roof; see {@link RoofImage.depth}.
 */
const ROOF_HOW = ROOF_WHERE + 1

/**
 * The box the walls' picture is unrolled round: its middle, and half how far
 * it reaches each way; see `around.ts`. Mesh metres, for the reason above.
 */
const WALL_BOX = ROOF_HOW + 1

/**
 * Which way the box's first side looks out, then where along the strip round
 * it and how high up the walls the picture's middle is.
 */
const WALL_MIDDLE = WALL_BOX + 1

/** Which layer the walls' picture is in, which way it is turned, and how wide and tall it is. */
const WALL_HOW = WALL_MIDDLE + 1

/**
 * Texels down a column: the colour over the whole building, then a colour and
 * the metres it runs between for each band, then the line drawn round it, then
 * the two the roof's picture takes and the three the walls' does.
 */
const ROWS = WALL_HOW + 1

/**
 * The least a decal's rectangle is measured as, in metres.
 *
 * Where a decal lies is worked out for every pixel of every building, used or
 * not, so that the card can see how fast the reading moves across the screen;
 * see {@link BuildingStyles.decals}. A building with nothing cut into it
 * carries nought for its width, and nought divided into is an answer that runs
 * off to infinity — which would take the neighbouring pixels' answer with it,
 * since the card works that step out from all four pixels of a quad at once.
 */
const A_SLIVER = 0.001

/** One band of colour round a building, at a storey or over a run of them. */
export interface FloorStyle {
  /** Which storey, counted from 1 as 1階 is, or the first and last of a run. */
  readonly at: number | readonly [number, number]
  /**
   * The band's colour. Left out, {@link DEFAULT_SHAPE_COLOR} — the ink every
   * shape a page puts on the map is drawn in, so a band reads against any
   * wall at either hour.
   *
   * A band is there because it is in the list, not because it was given a
   * colour: `{ at: 3 }` is the third storey banded, in the default ink. The
   * same way CSS draws a `border-style` in `currentcolor` until it is told
   * otherwise, and for the same reason — a colour that turned the band on
   * would leave no way to ask for one in the default.
   */
  readonly color?: ThemeColor
  /**
   * How much of that colour goes on, 0 to 1. All of it by default.
   *
   * Not transparency: nothing behind the building shows through it. It is
   * paint thinned, so that what the band is laid over — the wall, and the
   * windows it crosses — reads through the colour instead of being buried by
   * it. Transparency would be the material's, and a building with a material
   * of its own is a shader of its own.
   */
  readonly strength?: number
}

/**
 * How one building is drawn, where it is drawn otherwise than the rest of the
 * city: what {@link Buildings.setStyle} takes, and what
 * {@link BuildingWanted.style} paints a building brought in with.
 *
 * One building's and never the city's. The layer's own look is its own
 * properties — `buildings.wallColor`, `buildings.edges`, `buildings.windows`
 * — and this is narrower than all of them, so where both say something this
 * wins (CLAUDE.md, contract 12, rule 4).
 *
 * The two were one type until 2026-10-27, and each side quietly ignored half
 * of it: a line round the whole city written on the layer, a roof colour
 * written on one building. Every field here is read.
 */
export interface BuildingStyle {
  /**
   * The walls. Left out, the building keeps the colour the layer draws them
   * in — {@link Buildings.wallColor}, or the palette's.
   *
   * Its roof goes the same colour. The layer tells roofs from walls
   * ({@link Buildings.roofColor}); one building's roof in a colour of its own,
   * or its glass, would be a thing this table cannot do yet rather than a
   * field it forgot to read, so neither is offered (CLAUDE.md, contract 12).
   *
   * Every colour here carries `Color`, whatever it belongs to: a style holds
   * things that are not colours — a strength, a list of bands — and a reader
   * should not have to know which is which to tell them apart.
   */
  readonly wallColor?: ThemeColor
  /**
   * How much of that colour goes on, 0 to 1. All of it by default; see
   * {@link FloorStyle.strength}.
   *
   * What it thins is `wallColor`. Where that is left out the building is
   * already the layer's colour, and that colour thinned over itself is itself.
   */
  readonly strength?: number
  /**
   * Whether it carries its own light. Left out, it does what the layer does —
   * {@link Buildings.glows}, which is `false` unless a page said otherwise —
   * so a city that glows with one shadowed landmark in it, and a shaded city
   * with one lit sign of a building, are each a line.
   *
   * Said `true`, the colours it is drawn in are the colours asked for — the
   * same on the wall the light is on and the wall it is not, at every hour,
   * and inside another building's shadow.
   *
   * This is the one glow in the library said with three's `emissive` rather
   * than with `material.lights`, and the reason is that it has to be said a
   * face at a time: the whole city is one material, so a switch on it could
   * only answer for all of them at once. What makes the emissive reachable
   * here is the table behind it — `glows` is two numbers on a column, read per
   * fragment, and nothing else in the library has such a table. See
   * `Buildings`, where the two halves are assembled.
   */
  readonly glows?: boolean
  /**
   * Bands round it, laid over whatever colour the building itself is drawn in.
   *
   * One building's, because where a band falls is a storey and how tall a
   * storey is belongs to the building — so a band said for the whole city
   * would land at a different height on every one of them, which is not a
   * band. Two at the most; a third is not drawn.
   */
  readonly floors?: readonly FloorStyle[]
  /**
   * A line round this building, to find it by. `false` by default.
   *
   * Not the fold lines, which are the city's ({@link Buildings.edges}): this
   * is the one CSS draws on `:focus`. Drawn whether or not the building can be
   * seen — through whatever stands in front of it, from any angle — since a
   * page that marks a building has marked it to be found; see {@link Outlines}.
   *
   * A switch, and the three below are what it is drawn in. `outlineColor`
   * alone turns nothing on: a colour that did would leave no way to ask for
   * the line in the default ink.
   *
   * One building's, or every building a rule picks. A rule may mark as many as
   * it likes: a page showing which houses stand in five metres of water marks
   * a thousand, and the line is what tells them from the rest. Not the whole
   * city's — a city pointed at is nothing pointed at.
   */
  readonly outline?: boolean
  /**
   * The colour of that line. Left out, {@link DEFAULT_SHAPE_COLOR}, the ink of
   * every shape a page puts on the map.
   */
  readonly outlineColor?: ThemeColor
  /**
   * How wide that line is, in pixels of the page. 3 by default, and
   * {@link WIDEST_OUTLINE} at the most.
   *
   * Per building, as the colour is. The line is found on the screen rather
   * than drawn along the building's own edges, so its width is a number the
   * sweep reads out of a table — not something standing on a material, where
   * a second width would have meant a second shader.
   */
  readonly outlineWidth?: number

  /**
   * How far off the building the line stands, in pixels of the page.
   * {@link WIDEST_OUTLINE} at the most, as the width is.
   *
   * Nought — against the building — is where a line round something belongs,
   * and is what a page gets for saying nothing. Set off, the line reads as a
   * halo round the building rather than as the building's own edge, which is
   * a thing a page may want and is the only reason this is here.
   */
  readonly outlineGap?: number

  /**
   * A picture painted into the roof; see {@link RoofImage}. Left out, none.
   *
   * One a roof, as there is one {@link Buildings.roofColor} a roof.
   */
  readonly roofImage?: RoofImage
  /**
   * A picture painted round the walls; see {@link WallImage}. Left out, none.
   *
   * One a building, laid round all of its walls the way {@link wallColor}
   * is: a small one stays on the wall it was put on, a wide one goes round
   * the corner, and one longer than the way round covers every wall.
   */
  readonly wallImage?: WallImage
}

/**
 * A picture painted into one building's roof: {@link BuildingStyle.roofImage}.
 *
 * Not a sign hung over it — a {@link Solid} wearing a picture is that, with a
 * thickness and a face that stands off the wall. This is paint: it lies in the
 * roof, takes the light the roof takes, and goes with the building wherever a
 * motion sends it. It goes over the colour and the bands, being the last thing
 * put on a building.
 *
 * What the picture is of is the page's business and nothing is asked of it: a
 * canvas it drew a moment ago, a photograph it fetched. A marking that is
 * round is round in the picture, with nothing round it — the library knows
 * only the rectangle the picture fills.
 */
export interface RoofImage {
  /** What is painted in. Held at one size whatever shape it came in; see {@link DecalLayers}. */
  readonly image: DecalImage
  /**
   * How far it reaches across the roof and up it, in metres. One alone takes
   * the other from the picture's own proportions; neither is a size fitted to
   * the roof, which is the page's to decide. One of the two has to be given,
   * or nothing is painted.
   */
  readonly width?: number
  readonly tall?: number
  /**
   * Where the middle of its box is: metres east, north and up from the middle
   * of the building's foot, on the ground it stands on — as the building was
   * surveyed, so they turn with it, and the same three a click hands back as
   * `anchor.offset`. Straight over the middle of the foot where nothing is said.
   *
   * Not a spot on the map, so the picture stays where it was put on the
   * building wherever the building is stood and however it is turned.
   *
   * Not on a style a rule or a piece of ground paints ({@link SharedStyle}):
   * a place is one building's.
   */
  readonly offset?: readonly [number, number, number]
  /**
   * How deep its box is, in metres: the picture is shone down onto the roofs
   * within half this above and below the box's middle, and onto no others.
   *
   * Three's decal box (`DecalGeometry`'s `size.z`), stood on end. Small, it
   * keeps to one roof: one put on a podium beside a tower stops at the
   * tower's foot rather than going on up its top, and one put on a step of a
   * terraced block stays on that step. As deep as a pitched roof rises, it
   * lies on all of the pitch. Left out, the box reaches every roof under it,
   * and the height of its middle says nothing.
   *
   * The page's to say, and nothing is forgiven past it: a roof a click hands
   * back sits a fraction of a millimetre off the height read off it, so a page
   * putting a picture where it was pressed gives a depth of its own choosing.
   *
   * _(2026-11-03: until today the height said which roof, within a millimetre
   * the library held, and no height meant every roof. The user chose the
   * decal's depth over that.)_
   */
  readonly depth?: number
  /**
   * Which way the top of the picture points: degrees clockwise from north,
   * as {@link Camera.heading} is. 0 where nothing is said.
   *
   * A helipad's H faces the way a helicopter comes in, and anything with words
   * on it is read from one side. It turns the picture where it lies and does
   * not move it. Measured in the building's own frame, so a picture goes round
   * with a building a page has turned ({@link BuildingPlace.facing}). The word
   * is Mapbox's (`icon-rotate`, degrees clockwise).
   */
  readonly rotate?: number
}

/**
 * A picture painted round one building's walls: {@link BuildingStyle.wallImage}.
 *
 * Paint, as the roof's is, over the colour, the bands and the glass. The walls
 * are taken as one strip running round the building, and the picture is laid
 * on the strip with its middle at the place given. Running right from there it
 * goes round the corner onto the next wall, and running left onto the one
 * before; a picture wider than the way round is cut where its two ends would
 * meet behind the building. What the strip runs round is the box the building
 * fits in, so on a building that is a box the picture is laid metre for metre
 * and on one that is not it runs a little long or short across a wall that
 * stands back; see `around.ts`.
 */
export interface WallImage {
  /** What is painted on. Held at one size whatever shape it came in; see {@link DecalLayers}. */
  readonly image: DecalImage
  /**
   * How far it reaches round the walls and up them, in metres. One alone takes
   * the other from the picture's own proportions. One of the two has to be
   * given, or nothing is painted.
   */
  readonly width?: number
  readonly tall?: number
  /**
   * Where its middle is: metres east, north and up from the middle of the
   * building's foot, on the ground it stands on — as the building was
   * surveyed, so they turn with it, and the same three a click hands back as
   * `anchor.offset`. Across the middle of the wall looking north, halfway up,
   * where nothing is said.
   *
   * The wall is the one the place lies on, found by the place: the wall a
   * click hit, the inside of an L as well as the outside. A place a little off
   * every wall goes to the nearest.
   *
   * Not a spot on the map, so the picture stays where it was put on the
   * building wherever the building is stood and however it is turned.
   *
   * Not on a style a rule or a piece of ground paints ({@link SharedStyle}):
   * a place is one building's.
   */
  readonly offset?: readonly [number, number, number]
  /**
   * How far the picture is turned from standing upright: degrees, clockwise as
   * the wall is looked at from outside. 0 where nothing is said.
   *
   * The same word as the roof's and the same rule: 0 is the picture the way
   * one who looks at the face reads it — from above with north at the top on
   * a roof, from in front with the sky at the top on a wall — and turning is
   * clockwise as that one sees it.
   */
  readonly rotate?: number
}

/**
 * What a rule or a piece of ground paints every building it picks in: a
 * {@link BuildingStyle} whose pictures are put nowhere in particular.
 *
 * A place on the map is one building's, and these are many buildings. So
 * their pictures go where each building's own lie by themselves — the middle
 * of the roof, the middle of the north wall — and a page wanting each one
 * somewhere of its own paints them one by one, by name.
 */
export type SharedStyle = Omit<BuildingStyle, 'roofImage' | 'wallImage'> & {
  readonly roofImage?: Omit<RoofImage, 'offset' | 'depth'> & {
    readonly offset?: never
    readonly depth?: never
  }
  readonly wallImage?: Omit<WallImage, 'offset'> & { readonly offset?: never }
}

/** Either picture a style may carry. */
type BuildingImage = RoofImage | WallImage

/**
 * Whether a corner's building is still in the city.
 *
 * Read half way rather than against nought, since the attribute only ever
 * holds one or the other and nothing should rest on the exact float. It is a
 * function of its own rather than a method because what reads it is the test
 * that cuts a building away, which is woven once into the one material every
 * building shares.
 */
export function notHidden(): Node<'bool'> {
  return attribute(BUILDING_SLOTS, 'vec4').y.lessThan(0.5) as Node<'bool'>
}

/**
 * The same answer, from one corner's number in hand rather than in a shader.
 *
 * For whoever has to leave out what the picture leaves out: a ray cast at the
 * city must not strike a building every fragment of which is thrown away. Read
 * against the same half as the test above, and beside it, so the two cannot
 * drift apart.
 */
export function notHiddenNow(saidOfTheCorner: number): boolean {
  return saidOfTheCorner < 0.5
}

/**
 * The table, and what a page has asked to be painted.
 *
 * One of these belongs to the buildings that read it, not to the page: the
 * material it is read through is that layer's, and a building painted in one
 * viewer is not painted in another.
 */
export class BuildingStyles {
  private readonly values = new Float32Array(STYLE_SLOTS * ROWS * 4)
  private readonly table = new DataTexture(this.values, STYLE_SLOTS, ROWS, RGBAFormat, FloatType)
  /** One read of the table, so every pass that reads it shares the binding. */
  private readonly read = lookup(this.table)
  /**
   * What a building nobody has painted does about the light, which is what the
   * layer says; see {@link Buildings.glows}.
   *
   * A uniform and not a value written down every column, so a page that
   * changes its mind about the whole city writes one number rather than a
   * thousand — and a building that said something of its own goes on saying it.
   */
  private readonly byDefault = uniform(0)
  /** Whether the sun is down, which a pair of colours is read against; see {@link night}. */
  private night_ = false
  /** What a page asked for, by the name PLATEAU gives the building. */
  private readonly asked = new Map<string, BuildingStyle>()
  /** Which column each of those was given. Held by the asking, not by the tile. */
  private readonly columns = new Map<string, number>()
  /** Which of the two that run out has been said to have run out, so it is said once. */
  private readonly saidFull = new Set<'columns' | 'pictures'>()
  /** Columns given back, handed out again before any fresh one. */
  private readonly freed: number[] = []
  private next = 1
  /**
   * What a page pointed at, in the order it pointed: a rule of its own, or a
   * piece of ground. The last one to pick a building is the one it wears, as
   * the last word wins anywhere else a page says two things about one thing —
   * which is why the two kinds lie in one list and not in two.
   */
  private readonly painters: Painter[] = []

  /**
   * Every picture a style carries, on one sheet, so a city wearing a hundred
   * of them is one texture and no extra material.
   *
   * Made whether or not a page paints a picture: the shader reads it where it
   * is woven, and a shader is settled before it is first drawn. An empty sheet
   * is one 512-pixel canvas.
   *
   * A picture is taken into it when a style carrying it is handed over — by
   * name, by rule or by shape — and let go when that style is, so one picture
   * in twenty styles is one layer.
   */
  private readonly sheet = new DecalLayers()
  /** One read of it, so every pass shares the binding; see {@link DecalLayers.texture}. */
  private readonly sheetRead = lookup(this.sheet.texture)

  /**
   * Where the lines round these buildings are drawn, once the layer is on a
   * viewer; see {@link Outlines}.
   *
   * The colour of a line is not kept here as the wall's is. A line is drawn
   * over the whole picture at once — buildings, models, everything together —
   * so the colours are the viewer's, and what is kept here is the slot each
   * painted column's line took in them.
   */
  private lines: Outlines | null = null
  /** Which slot of the viewer's own table each column's line is in. */
  private readonly lineSlots = new Map<number, number>()

  constructor(private readonly told: TellsOf) {
    this.table.minFilter = NearestFilter
    this.table.magFilter = NearestFilter
    this.table.generateMipmaps = false
    this.table.needsUpdate = true
  }

  /**
   * What was asked for that building by name, or null if nothing was.
   *
   * Frozen, and a copy of what was handed over rather than the page's own
   * object: a page that changed its object afterwards would otherwise be
   * changing what this says the building wears without the table hearing of
   * it, and a page writing into what comes back would be writing into nothing.
   */
  askedOf(building: string): Readonly<BuildingStyle> | null {
    return this.asked.get(building) ?? null
  }

  /**
   * Paints a building, or takes the paint off it with `null`.
   *
   * The building need not be in hand. What is painted over the whole of it can
   * be written now, since it is the same wherever the building stands; a band
   * is in storeys, and how tall a storey is belongs to the building, so the
   * bands are written when the tile carrying it is marked.
   */
  set(building: string, style: BuildingStyle | null): void {
    const had = this.asked.get(building)
    if (!style) {
      const column = this.columns.get(building)
      if (column !== undefined) {
        this.drop(column)
        this.columns.delete(building)
      }
      this.asked.delete(building)
      this.unwear(had)
      return
    }
    const frozen = frozenStyle(style)
    // The new pictures taken before the old are let go, so a picture in both
    // keeps its layer rather than being let go and drawn in again
    const missed = this.wear(frozen)
    this.unwear(had)
    this.wearLate(frozen, missed)
    this.asked.set(building, frozen)
    const column = this.columnFor(building)
    if (column === undefined) return
    this.writeWhole(column, style)
  }

  /**
   * Paints every building a rule picks, or takes that rule away with `null`.
   *
   * The buildings a rule picks wear one style, so they share one column —
   * unless the style has bands or pictures, which lie at a storey or a place
   * that is a different number of metres up or across every building. Then a
   * column apiece, and the 1024 there are may not be enough for a rule that
   * picks a ward.
   */
  setRule(rule: BuildingRule, style: BuildingStyle | null): void {
    this.paint(rule, style, null)
  }

  /**
   * Paints every building standing on a piece of ground, or clears it with
   * `null`.
   *
   * The shape itself is what a page hands back, as it is for
   * {@link Buildings.hide}, so it is what this is keyed by. It is read into
   * the world's own units the once, here: the judging walks a mesh's corners
   * and would otherwise read the shape afresh on every one of them.
   */
  setSite(site: StandingShape, style: BuildingStyle | null): void {
    this.paint(site, style, maskArea({ shape: site }))
  }

  /** One of the two, by whatever a page handed over. */
  private paint(by: BuildingRule | StandingShape, style: BuildingStyle | null, area: MaskArea | null): void {
    const at = this.painters.findIndex((held) => held.by === by)
    // Whoever made an area gives it back, and a painter dropped or written
    // over is where these are dropped; see CLAUDE.md's fifth contract. This
    // one is walked on the processor and so has no picture to give back
    // unless something has read one — but the door is the door.
    if (at >= 0) this.painters[at]?.area?.dispose()
    const had = at >= 0 ? this.painters[at]?.style : undefined
    if (!style) {
      if (at >= 0) this.painters.splice(at, 1)
      this.give(keyOf(by))
      this.unwear(had)
      return
    }
    // Copied for the reason `set` copies: what is held is what was said then
    const held = { by, area, style: frozenStyle(this.placeless(style)) }
    const missed = this.wear(held.style)
    this.unwear(had)
    this.wearLate(held.style, missed)
    if (at >= 0) this.painters[at] = held
    else this.painters.push(held)
  }

  /**
   * A style many buildings wear, with any place its pictures were given taken
   * off and that said once; see {@link SharedStyle}.
   *
   * The type keeps a page from writing one, and this is for a page the type
   * does not reach. A place on the map is one building's, and read on every
   * building a rule picks it would put each picture on whichever of that
   * building's walls is nearest a spot down some other street.
   */
  private placeless(style: BuildingStyle): BuildingStyle {
    const roof =
      style.roofImage?.offset || style.roofImage?.depth !== undefined
        ? { ...style.roofImage, offset: undefined, depth: undefined }
        : style.roofImage
    const wall = style.wallImage?.offset ? { ...style.wallImage, offset: undefined } : style.wallImage
    if (roof === style.roofImage && wall === style.wallImage) return style
    if (!this.saidPlaces) {
      this.saidPlaces = true
      console.warn(
        '[plateau-ui] Buildings: a picture painted by a rule or a piece of ground was given a place (`offset`, `depth`), ' +
          'which is one building’s, and the place is not read. ' +
          'Paint each building by name to put its picture somewhere of its own.',
      )
    }
    return { ...style, roofImage: roof, wallImage: wall }
  }

  /** Whether a rule's picture given a place has been said about; see {@link placeless}. */
  private saidPlaces = false

  /**
   * Takes into the sheet the pictures a style carries, and hands back the ones
   * there was no room for.
   *
   * A layer a picture, however many styles carry it; the sheet counts them.
   * What each held style took is kept beside it ({@link taken}), so that it
   * lets go of exactly that and paints only that: a style whose picture found
   * no room took nothing, and letting go of what it never took would count
   * down a layer another style still wears — the next new picture is then
   * drawn over it.
   */
  private wear(style: BuildingStyle): DecalImage[] {
    const took: DecalImage[] = []
    const missed: DecalImage[] = []
    for (const picture of picturesOf(style)) {
      if (this.sheet.take(picture.image) !== undefined) took.push(picture.image)
      else missed.push(picture.image)
    }
    this.taken.set(style, took)
    return missed
  }

  /**
   * Tries again the pictures a style found no room for, once the style it
   * replaced has let its own go — swapping one picture for another on a full
   * sheet frees the room the new one needs — and says once what still has
   * none: drawn as nothing with nothing said, a page could not tell the 257th
   * picture from a bug of its own.
   */
  private wearLate(style: BuildingStyle, missed: readonly DecalImage[]): void {
    const took = this.taken.get(style)
    for (const image of missed) {
      if (this.sheet.take(image) !== undefined) {
        took?.push(image)
        continue
      }
      if (this.saidFull.has('pictures')) continue
      this.saidFull.add('pictures')
      console.warn(
        `[plateau-ui] Buildings: ${MOST_PICTURES} different pictures are painted on buildings already, ` +
          "which is as many layers as the viewer's device gives an array texture by default, " +
          'and this one is not drawn. Take a style carrying one off to make room.',
      )
    }
  }

  /** Lets go of the pictures a style took; see {@link wear}. */
  private unwear(style: BuildingStyle | undefined): void {
    if (!style) return
    for (const image of this.taken.get(style) ?? []) this.sheet.release(image)
    this.taken.delete(style)
  }

  /** What each held style took into the sheet; see {@link wear}. */
  private readonly taken = new WeakMap<BuildingStyle, DecalImage[]>()

  /** Whether anything at all is painted; see {@link BuildingStyles.mark}. */
  get empty(): boolean {
    return this.asked.size === 0 && this.painters.length === 0
  }

  /**
   * Where the lines are drawn, or nothing once the layer is off its viewer.
   *
   * Every slot held is given back, since a slot is a number in one viewer's
   * table and means nothing in another's. Taken again here are only the
   * columns whose style can be named from where this stands — a building
   * painted by name, and the one column a rule or a shape shares out. Not the
   * column apiece a rule hands out for a style with bands or pictures, keyed by
   * the painter and the building together: which painter picked it was
   * answered off a mesh, and there is no mesh here. Those are
   * written when their tile is marked again, which is before any of them is
   * on screen — a layer leaves its viewer by letting go of every tile.
   */
  useOutlines(lines: Outlines | null): void {
    if (this.lines === lines) return
    for (const [column, slot] of [...this.lineSlots]) {
      this.lines?.give(slot)
      this.lineSlots.delete(column)
    }
    this.lines = lines
    for (const [key, column] of this.columns) {
      const style = this.asked.get(key) ?? this.painters.find((held) => keyOf(held.by) === key)?.style
      if (style) this.lineFor(column, style)
    }
    this.table.needsUpdate = true
  }

  /** Takes the paint off every building, leaving the city as the palette draws it. */
  clear(): void {
    for (const held of this.painters) {
      held.area?.dispose()
      this.unwear(held.style)
    }
    this.painters.length = 0
    for (const column of this.columns.values()) this.drop(column)
    this.columns.clear()
    for (const style of this.asked.values()) this.unwear(style)
    this.asked.clear()
  }

  /**
   * Says on a mesh's corners which column each reads, and writes the bands of
   * whichever of its buildings are painted.
   *
   * Called wherever the corners may have changed under it — a tile landing, a
   * mesh cut anew — since windows and parapets add corners and what they add
   * says nothing of its own. Every corner is written, unlike the motion slot:
   * this is the only thing writing here, so there is nothing to rub out.
   */
  mark(mesh: Mesh, storeyHeight: number, out: ReadonlySet<number> | null = null): void {
    const marks = mesh.geometry.attributes[BUILDING_SLOTS] as BufferAttribute | undefined
    const batch = mesh.geometry.attributes[BATCH_ID]
    if (!marks || !batch) return

    const painted = new Map<number, number>()
    const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
    // The one walk over the mesh's corners, taken only if a rule asks where a
    // building is; see `Building.position`
    let walked: Map<number, FootBox> | undefined
    const feet = (): Map<number, FootBox> => (walked ??= feetOf(mesh))
    // And one walk a shape, however many of the mesh's buildings are put to
    // it: the answer is about all of them at once; see {@link feetOn}
    const judged = new Map<MaskArea, Map<number, boolean>>()
    const stands = (area: MaskArea): Map<number, boolean> => {
      let had = judged.get(area)
      if (!had) {
        had = feetOn(mesh, area)
        judged.set(area, had)
      }
      return had
    }
    if (facts && !this.empty) {
      for (const [at, building] of facts.ids.entries()) {
        // Named beats picked: a page that pointed at this building said
        // something more particular than a rule that swept it up
        const named = this.asked.get(building)
        const found = named ? { style: named, key: building } : this.picked(mesh, at, feet, stands)
        if (!found) continue
        const column = this.columnFor(found.key)
        if (column === undefined) continue
        this.writeWhole(column, found.style)
        this.writeBands(column, found.style, mesh, at, storeyHeight)
        this.writeImages(column, found.style, mesh, at)
        painted.set(at, column)
      }
    }

    // Written only where it differs: a mesh with nothing painted on it is
    // walked over and left alone, and a remark costs no upload
    const base = numbered(mesh, facts?.ids.length ?? batch.count)
    const array = marks.array as Float32Array
    let moved = false
    for (let v = 0; v < batch.count && v * 4 + 2 < array.length; v++) {
      const building = batch.getX(v)
      const column = painted.get(building) ?? 0
      const gone = out?.has(building) ? 1 : 0
      if (array[v * 4] !== column) {
        array[v * 4] = column
        moved = true
      }
      if (array[v * 4 + 1] !== gone) {
        array[v * 4 + 1] = gone
        moved = true
      }
      // Which building the corner is of **in the scene**, written once and
      // never again: nothing about paint can change it. Not `_batchid`, which
      // only numbers a tile's own — number three is one building here and
      // another one street over — and a screen telling one outline from
      // another has the whole city in it.
      //
      // (That attribute used to be a second reason: it arrived in whatever
      // width the tile wrote it in. It is made floats as the tile lands now,
      // because a vertex format that changes from tile to tile breaks more
      // than this — see `sameWhicheverForm`.)
      const number = base + building
      if (array[v * 4 + 2] !== number) {
        array[v * 4 + 2] = number
        moved = true
      }
    }
    if (moved) marks.needsUpdate = true
  }

  /**
   * What a corner says about the line round its building, in the four bytes
   * {@link Outlines} reads: the slot its colour is in, then which building it
   * is, low byte first.
   *
   * Woven into the wall material and read only while the lines' own picture is
   * drawn. The number is what keeps a line between two buildings of one colour
   * standing wall to wall, and it is counted across the layer rather than
   * within a tile; see {@link numbered}.
   */
  outline(): Node<'vec4'> {
    const slot = attribute(BUILDING_SLOTS, 'vec4')
    const line = this.read.load(ivec2(slot.x.toInt(), int(OUTLINE_ROW))) as Node<'vec4'>
    const building = slot.z
    return vec4(
      line.x.div(255),
      building.mod(float(256)).div(255),
      building.div(float(256)).floor().mod(float(256)).div(255),
      building.div(float(65536)).floor().div(255),
    ) as Node<'vec4'>
  }

  /**
   * What a building is painted, under the windows: hand this the wall's own
   * colour, before the windows have had their say.
   *
   * Under them on purpose. Painting a wall leaves its windows windows — a
   * building given a colour and losing its glass with it reads as a silhouette
   * cut out of the city rather than as a building somebody painted.
   *
   * A corner saying column 0 reads nothing: the branch is on a number every
   * corner of a building carries alike, so a city with nothing painted on it
   * takes the one turn and leaves.
   */
  wall(colour: Node<'vec3'>): Node<'vec3'> {
    const column = attribute(BUILDING_SLOTS, 'vec4').x.toInt()
    return Fn(() => {
      const painted = colour.toVar()
      If(column.greaterThan(int(0)), () => {
        const whole = this.read.load(ivec2(column, int(0)))
        painted.assign(mix(painted, whole.rgb, whole.a))
      })
      return painted
    })() as Node<'vec3'>
  }

  /**
   * The bands, over the windows: hand this the colour the windows have already
   * had their say on.
   *
   * Over them, where the colour of the whole building goes under. A band is
   * drawn across the face of a building rather than on the wall behind it, and
   * paint drawn across a window covers it.
   */
  bands(colour: Node<'vec3'>): Node<'vec3'> {
    const column = attribute(BUILDING_SLOTS, 'vec4').x.toInt()
    // How high up the wall a place is, in the metres the building was cut
    // with — the same reading the windows are set out by, under the same name,
    // so the two share one varying.
    const up = varying(positionGeometry.y, 'plateauCutHeight')

    return Fn(() => {
      const painted = colour.toVar()
      // Half of what a pixel is worth up the wall, so an edge is drawn over
      // about one of them. Measured before anything branches: a pixel is
      // measured against its neighbours, and a neighbour that took the other
      // branch has nothing to be measured with. Told where a band begins and
      // ends and nothing else, an edge lands on whole pixels and the band
      // comes out with a staircase down either side of it.
      const soft = fwidth(up).mul(0.5).toVar()
      If(column.greaterThan(int(0)), () => {
        for (let band = 0; band < BANDS; band++) {
          const paint = this.read.load(ivec2(column, int(1 + band * 2)))
          If(paint.a.greaterThan(0), () => {
            const span = this.read.load(ivec2(column, int(2 + band * 2)))
            const over = smoothstep(span.x.sub(soft), span.x.add(soft), up)
            const under = smoothstep(span.y.sub(soft), span.y.add(soft), up).oneMinus()
            painted.assign(mix(painted, paint.rgb, paint.a.mul(over).mul(under)))
          })
        }
      })
      return painted
    })() as Node<'vec3'>
  }

  /**
   * The pictures, over everything else: hand this the colour the bands have
   * had their say on.
   *
   * Over them because a picture is the last thing put on a building. A page
   * that banded a tower and then painted a marking on its roof or a poster
   * round its walls meant the picture to be seen, glass and band and all.
   *
   * `facing` and `skyward` are handed in rather than worked out here. What
   * counts as a roof is one question with one answer — the viewer already
   * asks it to choose a roof's colour — and asking it twice is two places for
   * it to drift. A roof reads the roof's picture and every other face the
   * walls'.
   *
   * Both are read where the corner stands in the mesh's own metres, so a
   * building moved by a motion carries its pictures along: the move is put on
   * downstream of this, and these numbers never knew where the building was.
   */
  decals(colour: Node<'vec3'>, facing: Node<'vec3'>, skyward: Node<'bool'>): Node<'vec3'> {
    const column = attribute(BUILDING_SLOTS, 'vec4').x.toInt()
    // Carried across as varyings of their own. The picture is read where the
    // pixel is, and a corner's place is a vertex thing. The height is the one
    // the bands and the windows are set out by, under the same name, so the
    // three share one varying.
    const eastOf = varying(positionGeometry.x, 'plateauCutEast')
    const southOf = varying(positionGeometry.z, 'plateauCutSouth')
    const upOf = varying(positionGeometry.y, 'plateauCutHeight')
    return Fn(() => {
      const painted = colour.toVar()
      // Where to read is worked out before anything is decided, and only the
      // reading itself waits on what was found. Which of the shrunken copies
      // of the picture to read is chosen from how far the reading moves from
      // this pixel to the one beside it, and that step is only there to be had
      // where every pixel of a quad walked the same way. Worked out under the
      // `If` below there is no step to go on, so the card reads a copy shrunk
      // to nothing however close the camera stands, and the marking's ink,
      // smeared flat at that size, comes out as a pale square the whole width
      // of the rectangle (measured).
      //
      // So both pictures' places are worked out on every face, and the roof's
      // or the walls' is taken by which the face is before the step is
      // measured. Loads, not samples: the table is read where it is wanted.
      const roofWhere = this.read.load(ivec2(column, int(ROOF_WHERE))).toVar()
      const roofHow = this.read.load(ivec2(column, int(ROOF_HOW))).toVar()
      const box = this.read.load(ivec2(column, int(WALL_BOX))).toVar()
      const middle = this.read.load(ivec2(column, int(WALL_MIDDLE))).toVar()
      const wallHow = this.read.load(ivec2(column, int(WALL_HOW))).toVar()

      // On a roof: east and south of the picture's middle, as a reader looking
      // down at the map sees it. North is where the world's z is least.
      const roofRight = eastOf.sub(roofWhere.x).toVar()
      const roofDown = southOf.sub(roofWhere.y).toVar()

      // On a wall: how far along the strip round the box from the picture's
      // middle, and how far down from it. The strip is `aroundBox` in
      // `around.ts`, which put the middle on it; the two are the same
      // arithmetic and have to stay so.
      const fromX = eastOf.sub(box.x).toVar()
      const fromZ = southOf.sub(box.y).toVar()
      // Right of the box's first side, as `rightOf` turns it
      const out = fromX.mul(middle.x).add(fromZ.mul(middle.y)).toVar()
      const across = fromX.mul(middle.y).sub(fromZ.mul(middle.x)).toVar()
      const alongOut = facing.x.mul(middle.x).add(facing.z.mul(middle.y)).abs()
      const alongAcross = facing.x.mul(middle.y).sub(facing.z.mul(middle.x)).abs()
      const a = box.z
      const b = box.w
      const strip = alongOut
        .greaterThanEqual(alongAcross)
        .select(
          out.greaterThanEqual(float(0)).select(across.add(b), b.mul(3).add(a.mul(2)).sub(across)),
          across.greaterThanEqual(float(0)).select(b.mul(2).add(a).sub(out), b.mul(4).add(a.mul(3)).add(out)),
        )
        .toVar()
      // The way round, held off nought for the reason `wide` is below
      const round = a.add(b).mul(4).max(float(A_SLIVER)).toVar()
      // From the middle, the short way round: half the strip either side of
      // it, so a picture wider than the building meets itself behind it
      const along = strip.sub(middle.z).toVar()
      const wallRight = along.sub(round.mul(along.div(round).add(float(0.5)).floor())).toVar()
      const wallDown = middle.w.sub(upOf).toVar()

      // Which face this is decides which picture, and everything after is
      // said once for either
      const right = skyward.select(roofRight, wallRight).toVar()
      const down = skyward.select(roofDown, wallDown).toVar()
      const layer = skyward.select(roofHow.x, wallHow.x).toVar()
      const spin = skyward.select(roofHow.y, wallHow.y).toVar()
      // Held off nought because a building with no picture carries a width of
      // nought, and a reading run off to infinity would carry its neighbours'
      // step off with it — the pixel beside this one is what the step is
      // measured against, picture or no picture.
      const wideAsked = skyward.select(roofWhere.z, wallHow.z).toVar()
      const wide = wideAsked.max(float(A_SLIVER)).toVar()
      const tall = skyward.select(roofWhere.w, wallHow.w).max(float(A_SLIVER)).toVar()
      // Turned about the middle before it is measured, so the picture stands
      // the way the page said rather than always north, or always upright
      const turnedRight = right
        .mul(cos(spin))
        .sub(down.mul(sin(spin)))
        .toVar()
      const turnedDown = right
        .mul(sin(spin))
        .add(down.mul(cos(spin)))
        .toVar()
      // Where this corner falls across the picture, nought to one from its
      // near corner
      const acrossPicture = turnedRight.div(wide).add(float(0.5)).toVar()
      const downPicture = turnedDown.div(tall).add(float(0.5)).toVar()
      const spot = vec2(acrossPicture, downPicture).toVar()
      const stepAcross = dFdx(spot).toVar()
      const stepDown = dFdy(spot).toVar()
      const inside = acrossPicture
        .greaterThanEqual(float(0))
        .and(acrossPicture.lessThanEqual(float(1)))
        .and(downPicture.greaterThanEqual(float(0)))
        .and(downPicture.lessThanEqual(float(1)))
      // A roof picture with a depth lies on the roofs within half of it above
      // and below its middle, and on no other; with none, on every roof under
      // it (`RoofImage.depth`). The walls are not asked: their picture's
      // height is its middle's.
      const onItsRoof = skyward
        .not()
        .or(roofHow.w.lessThan(float(0)))
        .or(upOf.sub(roofHow.z).abs().lessThanEqual(roofHow.w))
      // Nothing painted on this building leaves the rows at nought, and a
      // picture of no width is one nobody can see
      If(
        column
          .greaterThan(int(0))
          .and(wideAsked.greaterThan(float(0)))
          .and(inside)
          .and(onItsRoof),
        () => {
          // The layer the picture is in; every one of them fills its own layer
          // corner to corner, so the reading is the plain nought to one
          const ink = this.sheetRead.depth(layer.toInt()).grad(stepAcross, stepDown).sample(spot)
          painted.assign(mix(painted, ink.rgb, ink.a))
        },
      )
      return painted
    })() as Node<'vec3'>
  }

  /** A page has drawn on a picture a style carries; see {@link DecalLayers.refresh}. */
  refreshImage(image: DecalImage): void {
    this.sheet.refresh(image)
  }

  /**
   * Says on a column where its building's pictures lie, how big they are, and
   * which layers they are in — or nought across for one it does not carry.
   *
   * Every place in the mesh's own metres, which is what a corner carries and
   * what a motion is put on after, so a building takes its pictures with it.
   * An offset a page gave is already in those metres, counted from the middle
   * of the foot (`footOf`, the same middle a click's offset is counted from),
   * so it is written as it is however the building has been stood since.
   *
   * The roof's middle is the place, or the middle of the building's foot. The
   * shader reads the last two numbers of its row: the height of the middle of
   * the box, and half its depth — below nought for a box reaching every roof.
   *
   * The walls' middle is the place put on the wall it lies on (`wallUnder`),
   * or the middle of the north wall (`northWall`), put on the strip round the
   * box the building fits in (`around.ts`); the shader measures every pixel of
   * every wall along the same strip.
   */
  private writeImages(column: number, style: BuildingStyle, mesh: Mesh, at: number): void {
    const roofWhere = (ROOF_WHERE * STYLE_SLOTS + column) * 4
    const roofHow = (ROOF_HOW * STYLE_SLOTS + column) * 4
    // Nought across is what the shader reads as nothing painted here
    this.values[roofWhere + 2] = 0
    const roof = style.roofImage
    const roofSize = roof ? sizeOf(roof) : null
    // Only what this style took: a layer it found no room for may hold another
    // style's picture, or none
    const took = this.taken.get(style)
    const roofLayer = roof && took?.includes(roof.image) ? this.sheet.layerOf(roof.image) : undefined
    if (roof && roofSize && roofLayer !== undefined) {
      const foot = footOf(mesh, at)
      if (foot) {
        const middle = fromFoot(foot, roof.offset)
        this.values[roofWhere] = middle.x
        this.values[roofWhere + 1] = middle.z
        this.values[roofWhere + 2] = roofSize.width
        this.values[roofWhere + 3] = roofSize.tall
        this.values[roofHow] = roofLayer
        this.values[roofHow + 1] = spinOf(roof.rotate)
        this.values[roofHow + 2] = middle.y
        this.values[roofHow + 3] = roof.depth === undefined ? -1 : roof.depth / 2
      }
    }

    const box = (WALL_BOX * STYLE_SLOTS + column) * 4
    const middle = (WALL_MIDDLE * STYLE_SLOTS + column) * 4
    const wallHow = (WALL_HOW * STYLE_SLOTS + column) * 4
    this.values[wallHow + 2] = 0
    const wall = style.wallImage
    const wallSize = wall ? sizeOf(wall) : null
    const wallLayer = wall && took?.includes(wall.image) ? this.sheet.layerOf(wall.image) : undefined
    const around = wall && wallSize && wallLayer !== undefined ? boxAround(mesh, at) : undefined
    const place = wall && around ? this.wallMiddle(mesh, at, wall, around) : null
    if (wallSize && wallLayer !== undefined && around && place) {
      this.values[box] = around.x
      this.values[box + 1] = around.z
      this.values[box + 2] = around.halfOut
      this.values[box + 3] = around.halfAcross
      this.values[middle] = around.outX
      this.values[middle + 1] = around.outZ
      this.values[middle + 2] = aroundBox(around, place.x, place.z, place.outX, place.outZ)
      this.values[middle + 3] = place.y
      this.values[wallHow] = wallLayer
      this.values[wallHow + 1] = spinOf(wall?.rotate)
      this.values[wallHow + 2] = wallSize.width
      this.values[wallHow + 3] = wallSize.tall
    }
    this.table.needsUpdate = true
  }

  /**
   * Where a wall picture's middle is in the mesh's own metres, and which way
   * out the wall under it looks; see {@link writeImages}.
   *
   * A place on no wall of the building — its walls unread, a mesh the survey
   * drew without them — keeps the place and takes its way out from the box's
   * middle, which puts it on the side of the box it is nearest square to.
   */
  private wallMiddle(
    mesh: Mesh,
    at: number,
    wall: WallImage,
    around: { readonly x: number; readonly z: number },
  ): { x: number; y: number; z: number; outX: number; outZ: number } | null {
    const foot = footOf(mesh, at)
    if (!wall.offset || !foot) return northWall(mesh, at)
    const { x, y, z } = fromFoot(foot, wall.offset)
    const on = wallUnder(mesh, at, x, y, z)
    if (on) return { ...on, y }
    return { x, y, z, outX: x - around.x, outZ: z - around.z }
  }

  dispose(): void {
    for (const held of this.painters) held.area?.dispose()
    this.painters.length = 0
    this.table.dispose()
    this.sheet.dispose()
  }

  // ── The table ─────────────────────────────────────────────

  /**
   * The last thing to pick this building, and the column its paint goes in.
   *
   * What one rule or one shape picks wears one style, so they share one column
   * — keyed by what the page handed over rather than by any of the buildings.
   * Bands and pictures are the exception: where they fall is the building's
   * own (a storey, a place on its roof or round its walls), so a style carrying
   * them takes a column each.
   *
   * A rule is asked about the building; a shape is asked about its foot, which
   * is a question about the mesh and is answered for all of its buildings at
   * once.
   */
  private picked(
    mesh: Mesh,
    at: number,
    feet: () => Map<number, FootBox>,
    stands: (area: MaskArea) => Map<number, boolean>,
  ): { style: BuildingStyle; key: string } | undefined {
    if (this.painters.length === 0) return undefined
    const told = this.told(mesh, at, feet)
    if (!told) return undefined
    for (let i = this.painters.length - 1; i >= 0; i--) {
      const held = this.painters[i]
      if (!held) continue
      const picks =
        typeof held.by === 'function'
          ? held.by(told)
          : held.area !== null && stands(held.area).get(at) === true
      if (!picks) continue
      // A column apiece where what is written down it is the building's own:
      // a band's metres, or where a picture lies on this roof or round these
      // walls. Shared, the last building of the tile would lend its numbers
      // to every building the rule swept up.
      const own = held.style.floors || held.style.roofImage || held.style.wallImage
      const key = own ? `${keyOf(held.by)}\u0000${told.id}` : keyOf(held.by)
      return { style: held.style, key }
    }
    return undefined
  }

  /**
   * Hands back the column a key took, and every column taken under it.
   *
   * A rule usually holds one column for all the buildings it picks, and then
   * the key is the rule's own. A rule whose style has bands or pictures holds
   * one apiece, keyed by the rule's and the building's together — so a rule
   * taken away has to give back however many of those it had gathered, not
   * just the one named here. Giving back only the first left them allocated
   * for good: two sweeps of a banded rule across a ward spent all 1,024, after
   * which every colour a page asked for anywhere was quietly dropped.
   */
  private give(key: string): void {
    for (const [held, column] of [...this.columns]) {
      if (held !== key && !held.startsWith(`${key}\u0000`)) continue
      this.drop(column)
      this.columns.delete(held)
    }
  }

  /**
   * Hands one column back: its line to the viewer, its paint to nothing, and
   * the column itself to whoever asks next.
   *
   * The one place a column is let go of, because there are three ways to lose
   * one — a building unpainted, a painter taken away, the lot cleared — and
   * two of them let go of the paint without the line. A slot held by nothing
   * is never handed out again and never falls to nought, so
   * {@link Outlines.drawn} stays true for the life of the viewer: the scene is
   * drawn a second time and swept every frame to find no line anywhere.
   */
  private drop(column: number): void {
    const slot = this.lineSlots.get(column)
    if (slot !== undefined) {
      this.lines?.give(slot)
      this.lineSlots.delete(column)
    }
    this.wipe(column)
    this.freed.push(column)
  }

  /**
   * The column a building reads, taken the first time it is painted.
   *
   * Nothing where they are all spoken for. The building is then drawn as the
   * rest of the city is, which is the one answer that cannot mislead — the
   * other would be to paint it in somebody else's colour.
   */
  private columnFor(building: string): number | undefined {
    const had = this.columns.get(building)
    if (had !== undefined) return had
    const column = this.freed.pop() ?? (this.next < STYLE_SLOTS ? this.next++ : undefined)
    if (column === undefined) {
      // Said once: drawn as the city is drawn and nothing said, the 1,025th
      // building painted by name looked like a fault in the page's own code
      if (!this.saidFull.has('columns')) {
        this.saidFull.add('columns')
        console.warn(
          `[plateau-ui] Buildings: ${STYLE_SLOTS} buildings are painted by name already, and no more fit. ` +
            'This one is drawn as the rest of the city. A rule — `setStyle((building) => …, style)` — paints any number.',
        )
      }
      return undefined
    }
    this.columns.set(building, column)
    return column
  }

  private writeWhole(column: number, style: BuildingStyle): void {
    const colour = style.wallColor === undefined ? null : new Color(colorFor(style.wallColor, this.night_))
    this.put(column, 0, colour, strengthOf(style.strength))
    this.lineFor(column, style)
    this.table.needsUpdate = true
  }

  /** What a building nobody has painted does about the light. */
  set glowing(on: boolean) {
    this.byDefault.value = on ? 1 : 0
  }

  /**
   * Which half of a {@link ThemeColor} pair the table is written from.
   *
   * Held rather than asked for, because the table is written a building at a
   * time and deep inside a walk of the corners — handing the viewer down
   * there would be handing it to every row. Set where the palette changes,
   * and the rows are written again from the same walk that rewrites them for
   * a rule (`Buildings.remarkAll`).
   */
  set night(down: boolean) {
    this.night_ = down
  }

  /**
   * How much of the light the building at this corner takes: all of it, or
   * none where it glows.
   *
   * Woven into the wall material once, and read a fragment at a time. An
   * unpainted building reads column 0, whose texels are all noughts and stay
   * that way — so nought already says "said nothing of its own", and the
   * layer's answer is taken without anything having to ask whether the
   * building was painted at all.
   */
  lit(): Node<'float'> {
    const slot = attribute(BUILDING_SLOTS, 'vec4')
    const aside = this.read.load(ivec2(slot.x.toInt(), int(OUTLINE_ROW))) as Node<'vec4'>
    return mix(this.byDefault, aside.z, aside.y).oneMinus() as Node<'float'>
  }

  /**
   * Says on a column which line its buildings wear and what they do about the
   * light: the slot the viewer keeps that colour in, and whether the building
   * glows.
   *
   * The same colour and width asked for twice is one slot, so a rule that
   * paints a thousand buildings takes one — see {@link Outlines.take}. Taken
   * again whenever the style changes, and given back with the column.
   */
  private lineFor(column: number, style: BuildingStyle): void {
    const had = this.lineSlots.get(column)
    if (had !== undefined) {
      this.lines?.give(had)
      this.lineSlots.delete(column)
    }
    // The switch and nothing else turns the line on; a colour left out is the
    // shapes' ink, read for whichever palette stands
    const slot =
      style.outline !== true || !this.lines
        ? 0
        : this.lines.take(
            colorFor(style.outlineColor ?? DEFAULT_SHAPE_COLOR, this.night_),
            style.outlineWidth ?? DEFAULT_OUTLINE_WIDTH,
            style.outlineGap ?? DEFAULT_OUTLINE_GAP,
          )
    if (slot > 0) this.lineSlots.set(column, slot)
    // The slot alone, for the line. Everything else about how it looks — its
    // colour, its width, how far off it stands — is kept by the viewer under
    // that number.
    //
    // Then the light, said as two numbers rather than one: whether this
    // building has an opinion, and what the opinion is. A single flag could
    // not tell "glows" from "says nothing", and a building that says nothing
    // has to be able to follow the layer — which is a value it must not carry
    // a copy of, or a page changing the whole city would leave every painted
    // building behind.
    const at = (OUTLINE_ROW * STYLE_SLOTS + column) * 4
    this.values[at] = slot
    this.values[at + 1] = style.glows === undefined ? 0 : 1
    this.values[at + 2] = style.glows ? 1 : 0
    this.values[at + 3] = 0
  }

  /**
   * Where each band runs, in metres over the ground its building stands on.
   *
   * A storey is the building's own: how high it reaches divided by the storeys
   * it is drawn in — {@link storeysOn}, the count a click divides too, so the
   * two land on the same floor. It is not the ceiling the windows were
   * cut under, so a band can run a row off the glass where something small
   * stands on the roof.
   */
  private writeBands(
    column: number,
    style: BuildingStyle,
    mesh: Mesh,
    at: number,
    storeyHeight: number,
  ): void {
    // How many storeys a building is drawn in is read off its corners, so
    // asking is a walk over the mesh. A style with no bands has nothing to do
    // with the answer, and most have none — a rule painting a ward one colour
    // would otherwise pay that walk once for every building it picked.
    const shape = style.floors ? storeysOn(mesh, at, storeyHeight) : null
    for (let band = 0; band < BANDS; band++) {
      const floors = style.floors?.[band]
      // Being in the list is what draws a band; its colour may be left out
      if (!shape || !floors) {
        this.put(column, 1 + band * 2, null, 0)
        continue
      }
      const [first, last] = typeof floors.at === 'number' ? [floors.at, floors.at] : floors.at
      const storey = shape.top / shape.storeys
      const lowest = Math.max(1, Math.min(first, last))
      const highest = Math.min(shape.storeys, Math.max(first, last))
      this.put(
        column,
        1 + band * 2,
        new Color(colorFor(floors.color ?? DEFAULT_SHAPE_COLOR, this.night_)),
        strengthOf(floors.strength),
      )
      this.put(column, 2 + band * 2, null, 0, (lowest - 1) * storey, highest * storey)
    }
    this.table.needsUpdate = true
  }

  /** One texel of a column. A colour and how much of it, or two plain numbers. */
  private put(column: number, row: number, colour: Color | null, alpha: number, x = 0, y = 0): void {
    const at = (row * STYLE_SLOTS + column) * 4
    this.values[at] = colour ? colour.r : x
    this.values[at + 1] = colour ? colour.g : y
    this.values[at + 2] = colour ? colour.b : 0
    this.values[at + 3] = colour ? alpha : 0
  }

  private wipe(column: number): void {
    for (let row = 0; row < ROWS; row++) this.put(column, row, null, 0)
    this.table.needsUpdate = true
  }
}

/** Where a mesh keeps the run of numbers its buildings answer with. */
const NUMBERED = 'plateauNumbered'

/**
 * How many numbers there are to hand out: three bytes of the lines' own
 * picture; see {@link Outlines}.
 */
const NUMBERS_MOST = 0xffffff

/** The next run to hand out. Nought is kept for "nothing stands here". */
let nextNumber = 1

/**
 * The first number this mesh's buildings answer with, taken once and kept on
 * the mesh.
 *
 * A run a mesh rather than a number a building, since a mesh numbers its own
 * buildings 0 upwards already and the run is what makes those numbers the
 * layer's instead of the tile's. Two buildings standing wall to wall across a
 * tile's edge were the twelfth of each before this: one number, read as one
 * thing, and no line drawn between them.
 *
 * Kept on the mesh so that cutting it anew — a parapet resized, a window
 * opened — does not renumber it. A tile let go of never gives its run back;
 * there are sixteen million and a screen holds tens of thousands, so the
 * counter is simply wound back to the start when it reaches the end. What
 * that costs is that two meshes alive at once could share a run after sixteen
 * million buildings have been shaped, which is a session nobody has had.
 */
function numbered(mesh: Mesh, count: number): number {
  const had = mesh.userData[NUMBERED] as number | undefined
  if (had !== undefined) return had
  if (nextNumber + count > NUMBERS_MOST) nextNumber = 1
  const base = nextNumber
  nextNumber += count
  mesh.userData[NUMBERED] = base
  return base
}

/**
 * A copy of a style, frozen with its bands; see {@link BuildingStyles.askedOf}.
 *
 * The colours are left as they came. A `Color` handed over is three's own
 * object and is read, not kept as part of the style's shape, and freezing it
 * would break the page's hold on it.
 */
function frozenStyle(style: BuildingStyle): Readonly<BuildingStyle> {
  const floors = style.floors?.map((floor) =>
    Object.freeze({
      ...floor,
      at: typeof floor.at === 'number' ? floor.at : Object.freeze([floor.at[0], floor.at[1]] as const),
    }),
  )
  const copy: { -readonly [K in keyof BuildingStyle]: BuildingStyle[K] } = { ...style }
  if (floors) copy.floors = Object.freeze(floors)
  // The pictures copied as the bands are, the picture itself by reference: it
  // is the page's canvas to draw on again, and frozen it could not be
  if (style.roofImage) copy.roofImage = frozenImage(style.roofImage)
  if (style.wallImage) copy.wallImage = frozenImage(style.wallImage)
  return Object.freeze(copy)
}

/** A copy of a picture's place and size, frozen, holding the same picture; see {@link frozenStyle}. */
function frozenImage<T extends BuildingImage>(picture: T): T {
  const copy: T = { ...picture }
  // A copy of the offset, so a page writing into the array it handed over
  // afterwards does not move a picture nobody was told had moved
  if (picture.offset) Object.assign(copy, { offset: Object.freeze([...picture.offset]) })
  return Object.freeze(copy)
}

/**
 * How wide and how tall a picture really is, in its own pixels.
 *
 * An `<img>` is measured by `naturalWidth`, which is what the file holds:
 * `width` is the layout's, and an image still on its way is nought by nought
 * there. Nought divided into is NaN, which the card reads as a rectangle of no
 * size — and nothing comes back to write the row again when the picture lands,
 * since {@link BuildingStyles.refreshImage} redraws the layer and not the
 * table. Anything still reading nought is taken as square, so a page that gave
 * one measure gets the other rather than an empty roof.
 */
function sizedAs(picture: DecalImage): { wide: number; high: number } {
  const wide = ('naturalWidth' in picture ? picture.naturalWidth : 0) || picture.width
  const high = ('naturalHeight' in picture ? picture.naturalHeight : 0) || picture.height
  return { wide: wide || 1, high: high || 1 }
}

/**
 * How wide and tall a picture is painted, in metres: what the page gave, the
 * other taken from the picture's own proportions — or nothing where the page
 * gave neither, which paints nothing.
 *
 * Both are optional on the type because either one alone is enough, not
 * because neither is. The shader tells a painted face from a plain one by the
 * width it reads off the column, so a picture of no size draws nothing.
 */
function sizeOf(picture: BuildingImage): { width: number; tall: number } | null {
  if (picture.width === undefined && picture.tall === undefined) return null
  const { wide, high } = sizedAs(picture.image)
  const proportions = high / wide
  const width = picture.width ?? (picture.tall ?? 0) / proportions
  return { width, tall: picture.tall ?? width * proportions }
}

/**
 * A picture's `rotate` as the shader turns by it, in radians.
 *
 * Turned the other way about, because what the shader turns is where it reads
 * rather than the picture: swinging the reading clockwise swings what comes
 * back counter-clockwise. A page says which way the picture is turned, so the
 * sign is settled here and once (measured on a roof: a turn of 15 leaned the H
 * the wrong way before this). A wall is read right and down as a roof is east
 * and south, so the one sign serves both.
 */
function spinOf(rotate: number | undefined): number {
  return (-(rotate ?? 0) * Math.PI) / 180
}

/** The pictures a style carries that are painted: those given a size; see {@link sizeOf}. */
function picturesOf(style: BuildingStyle | undefined): BuildingImage[] {
  const found: BuildingImage[] = []
  for (const picture of [style?.roofImage, style?.wallImage]) {
    if (picture && sizeOf(picture)) found.push(picture)
  }
  return found
}

/**
 * What a rule's column is remembered by.
 *
 * A function is not a map key here — the columns are keyed by string, since
 * the buildings a page names are — so each rule is given a number the first
 * time it is seen and answers with it after.
 */
const painterKeys = new WeakMap<BuildingRule | StandingShape, string>()
let nextPainterKey = 0

function keyOf(by: BuildingRule | StandingShape): string {
  const had = painterKeys.get(by)
  if (had !== undefined) return had
  const key = `\u0000rule${nextPainterKey++}`
  painterKeys.set(by, key)
  return key
}

/**
 * One thing a page painted by: a rule it wrote, or a shape it drew.
 *
 * A shape carries the area it was read into; a rule has none. Both are held by
 * the object the page handed over, which is what it has to hand back.
 */
interface Painter {
  readonly by: BuildingRule | StandingShape
  readonly area: MaskArea | null
  readonly style: BuildingStyle
}

/** What describes one of a mesh's buildings; handed in, to import nothing of Buildings. */
type TellsOf = (mesh: Mesh, at: number, feet?: () => Map<number, FootBox>) => Building | null
