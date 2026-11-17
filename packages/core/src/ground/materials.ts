import {
  Break,
  Fn,
  If,
  Loop,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  fract,
  fwidth,
  mat3,
  mat4,
  materialColor,
  mix,
  modelWorldMatrix,
  normalLocal,
  positionGeometry,
  positionLocal,
  screenCoordinate,
  screenDPR,
  smoothstep,
  varying,
  vec2,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'
import { uniform, uniformArray } from '../repaint.js'
import {
  BackSide,
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Vector4,
  type Material,
  type Node,
  type UniformNode,
} from 'three/webgpu'
import { arrived, overGround, stillUnder } from '../appear.js'
import { blendOverOpaque, pressToLand } from '../behind.js'
import { LEVEL } from './meshes.js'
import { marksLand } from '../classify.js'
import type { Projection } from '../projection.js'
import type { Sight } from '../sight.js'
import type { WorldBounds } from '../geo/mercator.js'
import { ThinLineMaterial } from '../thinLine.js'
import { MaskShader, type MaskArea } from '../mask.js'

import { LIGHT, type Palette } from '../theme.js'
import { facesUp, inFullDaylight, solid, type SolidMaterial } from '../lit.js'
import { beforeTheCurve } from '../tone.js'
import { type GroundLineName, type GroundPieceName, type GroundRibbonName } from './tileGeometry.js'
import { HULL_NORMAL, LEAFNESS, STAND, TINT } from './trees.js'

/** The least a real-width ribbon is drawn at, so it does not vanish with distance (screen pixels). */
const MIN_LINE_PIXELS = 1.1

/** What the shader pushes a ribbon sideways by. */
interface RibbonEntry {
  material: MeshStandardNodeMaterial
  /** What the half-width in metres is multiplied by: Mercator's stretch taken back out, and the scale applied. */
  scale: UniformNode<'float', number>
  /** The half-width it keeps however far away it is. */
  floor: UniformNode<'float', number>
  /** Railways only: the colour of the ballast the rails and sleepers lie on. */
  ballast?: UniformNode<'color', Color>
}

/** How far the bank shading reaches into the water, in metres. */
const BANK_WIDTH = 2
/** How dark it is right at the bank: what it is laid over the water at. */
const BANK_OPACITY = 0.6
/** Its colour: the water's, brought down to this much of itself in linear light. */
const BANK_DARKEN = 0.45

/** How thick the line round a tree is, in page pixels. */
const TREE_LINE_WIDTH = 1

/** What pushes the bank shading inland, and the material that draws it. */
interface BankEntry {
  material: MeshStandardNodeMaterial
  /** Its width in world units, with Mercator's stretch taken back out. */
  width: UniformNode<'float', number>
}

/**
 * How many patches may pulse at once. A shader's array has to have a size,
 * so it is given one. At zoom 18, even in a wide window, the tiles on their
 * way and the wards waiting on a catalog come to fewer than this together,
 * and what a corner walks is however many are arriving now rather than this
 * number. A patch past it simply does not pulse; its buildings still stand.
 */
const MAX_ARRIVING = 64
/**
 * How long one sweep takes to cross the screen, in seconds.
 *
 * Was 2.2, which was a minute's worth of patience said slowly. A band that
 * takes two seconds to cross is one a reader may look away from and never see
 * go by; at this it comes round twice in that time, and the ground reads as
 * working rather than as holding still.
 */
const SWEEP_SECONDS = 1.3
/**
 * How wide the band is, as a share of the screen.
 *
 * It sets off a width off the left edge and runs a width past the right, so
 * the light arrives and leaves rather than appearing at the edge. Half the
 * screen across, which leaves it no edge to speak of: what crosses is a
 * gradient rather than a bar, and the ground it is over is lit the way a room
 * is rather than the way a scanner is.
 */
const SWEEP_WIDTH = 0.5
/**
 * How far toward the band's colour the ground under its middle is carried.
 *
 * Short of the whole way, so the light lies over the plan rather than taking
 * its place: the blocks keep their own colour underneath and are tinted by
 * what passes.
 *
 * Was a quarter, chosen to be missed by anyone not already watching that part
 * of the screen. It was: over the plan at its deepest a quarter shifts some
 * thirty parts in the red and next to none in the blue, and against a plan
 * that is itself a whisper there was nothing to see. At this it is about fifty
 * in the red, a dozen in the green and five the other way in the blue — the
 * blocks still keep their own colour, and what crosses is now plainly a thing
 * crossing. (Worked out from the palette, not read off the screen.)
 */
const SWEEP_MOST = 0.45
/** How long the sweep takes to reach its full strength once fetching begins, in seconds. */
const SWEEP_FADE = 0.25
/**
 * The two colours the band runs between, leading edge first.
 *
 * Both are the one colour the map already carries — the water, a soft blue —
 * turned up and swung a little either side of it: the leading edge toward the
 * sky, the trailing edge toward ink. Nothing else on the ground is anywhere
 * near as saturated, so the band is read as the page at work rather than as
 * something in the city, and it is still of the same family as everything it
 * crosses.
 */
const SWEEP_HEAD = '#5ebbe8'
const SWEEP_TAIL = '#7d8fe8'

/** How far apart the sleepers are, in metres. Really about 60cm, which is too fine for a ribbon a few pixels wide. */
const SLEEPER_SPACING = 3
/** How much of that gap a sleeper takes up. */
const SLEEPER_SHARE = 0.28
/** How far across the ribbon the sleepers reach; ballast is left along both edges. */
const SLEEPER_REACH = 0.7
/** Where the two rails lie. */
const RAIL_OFFSET = 0.3
/** Half the width of one rail. */
const RAIL_HALF_WIDTH = 0.075

/**
 * LAID_ON_THE_LAND — how everything the ground draws stands to the depth buffer.
 *
 * The surface is the land: one sheet across the whole of the view, drawn
 * before anything else, and it both reads and writes. Everything laid on it —
 * the green, the water and its bank, the footprints, the rails, the roads,
 * the coastlines — reads and does not write.
 *
 * Reading is what hides what is behind a hill. Their corners are on the land
 * already (`drape.ts` writes the height into every one as the tile is built),
 * so a road on the far side of a ridge is, in truth, behind it; without the
 * test it was painted over the ridge all the same, and the slope came out
 * with roads and footprints lying across it like a decal.
 *
 * Not writing is what leaves the order to be said. They lie on the same land,
 * often to the same millimetre, so any of them could be said to be in front of
 * any other; none of them moves the mark the surface left, so all of them
 * measure against the land and none against each other, and which shows on top
 * is the number each carries — `GROUND_STACK`, as three's `renderOrder`.
 *
 * It has to be a number and cannot be left to the renderer. The renderer sorts,
 * and what it breaks a tie by is distance: the centre of a bounding sphere,
 * which for two drapes of one tile is two different points a hair apart, and
 * which of them is the nearer hair changes as the view turns. Left to it, the
 * overlaps flicker.
 *
 * The test has to be less-or-*equal*, three's own default, for exactly that
 * reason: a thing lying on the land is at the land's own depth, and a plain
 * less-than would throw all of it away. Equal is not something two meshes
 * ever quite are, though — the surface is a grid cut to the view and reads
 * the land at its own corners, while a road is cut to its own shape and reads
 * it at that shape's — so they are also pressed a little toward the camera.
 */

/**
 * CHANGING STEP — how the ground goes from one step of tiles to the next.
 *
 * The tiles the ground reads come in steps of one zoom, and crossing one the
 * whole floor is cut again from tiles twice as coarse — a quarter as many over
 * the same ground. Swapped between two frames that is a blink: measured when
 * the step was two zooms, at z16, ninety-two meshes became sixteen and a
 * hundred and forty thousand corners became seventy-eight, in one frame, with
 * nothing loading. Those two counts do not come out at the sixteenth that step
 * was in tiles, and are not meant to: the ratio is of tiles,
 * and these are what the screen was holding — a tile becomes a mesh for each
 * kind of thing in it, carries however many corners its own drawing needed,
 * and counts whole however little of it is on screen, which rounds up the
 * harder the coarser it is. It is not a wait — the coarse tiles were already
 * in hand — it is the change itself.
 *
 * So the two steps are on screen together for the quarter zoom before the
 * change, and the coarse one takes the screen a pixel at a time. Which pixel
 * is decided by an ordered pattern fixed to the screen: the coarse step keeps
 * the pixels under the share it has won, the fine step keeps the rest, and
 * the two are exactly complementary, so every pixel is drawn once by one of
 * them and there is neither a gap nor a double.
 *
 * **By the zoom, not by a clock.** It is the zoom that is changing, so the
 * zoom is what the share is read from — which is how terrain reads a morph
 * (off the camera's distance) and how a web map reads a width (off the zoom).
 * On a clock the same place would look different going in from going out, a
 * slow move would still be settling long after it stopped, and rocking over
 * the line would start the change again every time.
 *
 * **Thrown away, not blended.** These lie on the land, and what shows on top
 * of what is the number each of them carries (see LAID_ON_THE_LAND). Made
 * see-through they would leave the opaque half of the frame for the clear one,
 * and be drawn after every road and every bank rather than among them — the
 * split by `transparent` comes before any number. Cesium met the same wall for
 * the same reason and threw pixels away rather than blending them.
 */

/** The width of the change, in zoom. A wheel notch is about 0.4, so one notch crosses the whole of it. */
export const CHANGING_OVER = 0.25

/**
 * The Bayer order of a 2×2, [[0,2],[3,1]]. The 4×4 is it read twice: where a
 * pixel falls in its own 2×2 picks which quarter of the sixteen it is in, and
 * which 2×2 of the four it is places it inside that quarter.
 *
 * Not the raster order, x + 2y, which this was written with. That compiles
 * and it looks like a pattern, but it gives the two cells of a row
 * consecutive values, so every even row of the screen falls in the low half
 * of the sixteen and every odd row in the high — half way through a change
 * the even rows are kept whole and the odd ones dropped, a one-pixel comb
 * across the floor rather than the weave {@link ordered} is for. Written out
 * it was [[0,4,1,5],[8,12,9,13],[2,6,3,7],[10,14,11,15]]; this is
 * [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]].
 */
function bayer2(p: Node<'vec2'>): Node<'float'> {
  return p.x.add(p.y).mod(2).mul(2).add(p.y) as Node<'float'>
}

/**
 * The ordered pattern the change is read against: a 4×4 Bayer matrix, nought
 * to one, fixed to the screen.
 *
 * Ordered rather than noise. Noise at half a share is static over the whole
 * floor, and nothing here cleans it up afterwards; the matrix is a fine even
 * weave instead, and it is the same every frame so a pixel does not flicker
 * while the share stands still.
 */
function ordered(): Node<'float'> {
  const at = screenCoordinate.xy.floor()
  const fine = at.mod(2) as Node<'vec2'>
  const coarse = at.mod(4).mul(0.5).floor() as Node<'vec2'>
  const value = bayer2(fine).mul(4).add(bayer2(coarse))
  // Centred in its own step, so that a share of nought keeps nothing and a
  // share of one keeps everything
  return value.add(0.5).div(16) as Node<'float'>
}

/** Sets a material to lie on the land rather than to be it. See LAID_ON_THE_LAND. */
function layOnLand<T extends Material>(material: T): T {
  material.depthTest = true
  material.depthWrite = false
  // How far it is pressed, and why that much, is `behind.ts`: the ground is no
  // longer the only thing laid on the land, and both have to press alike.
  pressToLand(material)
  return material
}

/** No site at all, as an area: read for its pieces, of which it has none. */
const NOTHING_CLEARED: MaskArea = {
  parts: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  // No shape, so nothing to draw out and nothing to give back, and nothing
  // for the view to carry about
  field: null,
  follows: false,
  // No pieces, so none of them is waiting on the screen
  fetchesAll: true,
  moveTo: () => {},
  dispose: () => {},
}

/**
 * Holds one material per kind the ground draws.
 * Every tile shares them, so changing a colour or a width changes the whole
 * screen at once.
 */
export class GroundMaterials {
  /** @see setProjection */
  private projection: Projection | null = null
  /** @see setSight */
  private sight: Sight | null = null

  /**
   * The shape the ground is cut to, as every one of these materials reads it.
   *
   * Woven into each as it is made, whether or not there is a mask: a material
   * already drawn cannot be given a node it was not built with, and the
   * ground makes its materials the first time a tile of that kind lands,
   * which may be long after a page said where to cut.
   */
  private readonly mask = new MaskShader()
  /**
   * The sites a page has cleared, which the footprints alone read.
   *
   * A second shape rather than a second meaning for the first: the mask says
   * what was never fetched and this says what a page has taken down, and the
   * two are read the opposite way round — outside the one is not drawn, inside
   * the other is not. Sharing a shader between them would be sharing nothing
   * but the arithmetic.
   */
  private readonly cleared = new MaskShader()
  private readonly fills = new Map<GroundPieceName, MeshStandardNodeMaterial>()
  private readonly lines = new Map<GroundLineName, ThinLineMaterial>()
  private readonly ribbons = new Map<GroundRibbonName, RibbonEntry>()
  private banks: BankEntry | undefined
  /** The trees. The leaves take the material's colour, the trunks a uniform. */
  private trees: { material: SolidMaterial; trunk: UniformNode<'color', Color> } | undefined
  /** The line round them. Not lit: a line is ink and keeps the colour it is given. */
  private treeLines: MeshBasicNodeMaterial | undefined
  private treeLineOn = false
  /**
   * The patches of ground whose buildings are on their way: west, north, east
   * and south in world x and z. Only the first `arrivingCount` are read; the
   * rest are left as they were.
   */
  private readonly arriving = Array.from({ length: MAX_ARRIVING }, () => new Vector4())
  private readonly arrivingOf = uniformArray<'vec4'>(this.arriving, 'vec4')
  private readonly arrivingCount = uniform(0, 'int')
  /**
   * Seconds since the buildings began arriving. The wave rises from here, so
   * the footprints do not all darken the moment fetching starts. It is set
   * back once nothing is on its way, ready for the next time.
   */
  private readonly sweepTime = uniform(0)
  private sweepSince: number | null = null
  /** The two ends of the band that crosses what is on its way. */
  private readonly sweepHead = uniform(new Color(SWEEP_HEAD))
  private readonly sweepTail = uniform(new Color(SWEEP_TAIL))
  /** The surface colour. A pulsing footprint moves away from this. */
  private readonly surfaceColor = uniform(new Color(LIGHT.surface))
  /**
   * How far a footprint is carried out of the surface, along the line that
   * runs from the surface colour through the footprint's own.
   *
   * Its own colour is a whisper — one part in twenty from the ground it lies
   * on — and a plan drawn at it could not be made out until the view was
   * nearly on top of it. Two carries far enough to be read and stops well
   * short of the streets running through it, which lie five times out along
   * the same line.
   *
   * One number and not a uniform: the plan used to deepen as the view stepped
   * in, promising the buildings four zooms before they stood, and that promise
   * tied the ground to the zoom the city stands at — a number belonging to a
   * layer that may not even be in the scene. The plan is simply part of the
   * map now, drawn wherever the map is.
   *
   * Nothing but the surface lies under a footprint (see the order of
   * GROUND_PIECES), so falling back to the surface colour is the same as not
   * being there at all — no blending, and nothing behind to show through.
   */
  private static readonly PLAN_DEEPEST = 2

  /**
   * The finer of the two steps of tiles on screen, as a tile zoom.
   * A mesh cut coarser than this is the step being gone over to; see
   * CHANGING STEP.
   */
  private readonly finerStep = uniform(0)
  /** How much of the screen the coarser step has taken: nought to one. */
  private readonly goneOver = uniform(0)

  private palette: Palette = LIGHT
  /** What takes a world unit back to a real metre. */
  private stretch = 1
  private floor = 0

  /**
   * Whether the land carries its own light; see {@link GroundOptions.glows}.
   *
   * Taken in the constructor rather than told later, because it decides which
   * shader every material of this layer is woven with and a shader is settled
   * before the material is first drawn. The answer cannot change for the life
   * of the layer either, which is what makes that fair.
   *
   * The thicknesses come in as two lots because they are two units: a line's
   * is screen pixels and is the material's own width, a ribbon's multiplies
   * the real width each corner carries. Held here as well as on the pieces a
   * page writes them on, since a material is made the first time a tile of
   * its kind lands and has to be made at the width already asked for.
   */
  constructor(
    private readonly widths: Record<GroundLineName, number>,
    private readonly scales: Record<GroundRibbonName, number>,
    private readonly glowing: boolean,
  ) {
    // Said at once, because nothing else says it until a page clears a site —
    // and a fresh `MaskShader` stands at "no mask at all", which holds
    // everything. Left there, every footprint reads as standing on a site that
    // has been cleared and is thrown away: the plan of the city was never
    // drawn, at any zoom, on any page. See {@link setCleared}, which has
    // always known this and was only ever reached by `Ground.hide`.
    this.setCleared(null)
  }

  // ── What the outside changes ──────────────────────────────

  setPalette(palette: Palette): void {
    this.palette = palette
    // The hem goes over to what the scene is backed with, so what fades
    // reads as the far side of the guide rather than as a hole in it.
    this.mask.fadeInto(palette.backdrop)
    for (const [piece, material] of this.fills) material.color.set(palette[piece])
    for (const [layer, material] of this.lines) material.color.set(palette[layer])
    for (const [layer, entry] of this.ribbons) {
      entry.material.color.set(palette[layer])
      entry.ballast?.value.set(palette.ballast)
    }
    this.banks?.material.color.set(palette.river).multiplyScalar(BANK_DARKEN)
    if (this.trees) {
      this.trees.material.color.set(palette.leaf)
      this.trees.trunk.value.set(palette.trunk)
    }
    this.treeLines?.color.set(palette.treeLine)
    this.surfaceColor.value.set(palette.surface)
  }

  /**
   * The shape the ground is cut to, in world units, or null for none. One
   * value, read by every material that has been made and by every one made
   * afterwards.
   */
  setMask(area: MaskArea | null): void {
    this.mask.set(area)
  }

  /**
   * The patches whose buildings are on their way. The footprints inside them
   * pulse until those buildings land. Given as world rectangles.
   */
  setArriving(patches: readonly WorldBounds[]): void {
    const count = Math.min(patches.length, MAX_ARRIVING)
    for (let i = 0; i < count; i++) {
      const patch = patches[i]
      // Mercator y rises north and the world's z rises south
      if (patch) this.arriving[i]?.set(patch.minX, -patch.maxY, patch.maxX, -patch.minY)
    }
    this.arrivingCount.value = count

    const now = performance.now()
    if (count === 0) this.sweepSince = null
    else this.sweepSince ??= now
    this.sweepTime.value = this.sweepSince === null ? 0 : (now - this.sweepSince) / 1000
  }

  /**
   * Brings the ribbon widths back into line when the view changes.
   * The world is Mercator and stretches with latitude, so that is taken out,
   * and a floor is given for when a real width comes to less than a pixel.
   */
  setView(metersPerUnit: number, metersPerPixel: number): void {
    this.stretch = 1 / metersPerUnit
    this.floor = (MIN_LINE_PIXELS / 2) * metersPerPixel
    for (const layer of this.ribbons.keys()) this.applyWidth(layer)
    if (this.banks) this.banks.width.value = BANK_WIDTH * this.stretch
  }

  /**
   * Which two steps of tiles are on screen and how far the change has gone.
   * See CHANGING STEP.
   */
  setStep(finer: number, goneOver: number): void {
    this.finerStep.value = finer
    this.goneOver.value = Math.min(Math.max(goneOver, 0), 1)
  }

  /**
   * Whether this pixel belongs to the mesh drawing it, while two steps of
   * tiles are on screen at once.
   *
   * Handed to the mask, which already throws a pixel away for being outside
   * the shape the map is cut to — the same question asked twice is the same
   * `Discard`, so this costs no second branch.
   *
   * Standing still the share is nought, every mesh on screen is the finer
   * step, and the test is `pattern >= 0` — true everywhere, which is the
   * whole floor drawn as before.
   */
  private keptAtStep(): Node<'bool'> {
    const mine = attribute(LEVEL, 'float')
    const pattern = ordered()
    return mine
      .lessThan(this.finerStep)
      .select(pattern.lessThan(this.goneOver), pattern.greaterThanEqual(this.goneOver)) as Node<'bool'>
  }

  /** How thick a kind drawn as lines is, in screen pixels. */
  setWidth(layer: GroundLineName, value: number): void {
    this.widths[layer] = value
    const line = this.lines.get(layer)
    if (line) line.width = value
  }

  /** What a kind drawn as a ribbon multiplies its real width by. */
  setWidthScale(layer: GroundRibbonName, value: number): void {
    this.scales[layer] = value
    this.applyWidth(layer)
  }

  // ── The materials ─────────────────────────────────────────

  fill(piece: GroundPieceName): MeshStandardNodeMaterial {
    const hit = this.fills.get(piece)
    if (hit) return hit

    const material = solid({
      color: new Color(this.palette[piece]),
      // Depth read but not written; see LAID_ON_THE_LAND.
      depthWrite: false,
      depthTest: true,
      transparent: false,
      // Lying flat, so neither side is its back. The rings a vector tile hands
      // over do not wind one consistent way, and drawing one side only would
      // lose whole pieces.
      side: DoubleSide,
    })
    // Except the surface, which is the one that writes it: it is the land
    // itself, one sheet across the whole of the view drawn before any of the
    // rest, so the mark it leaves is the land's own shape and it is under all
    // of them. The screen-space shading reads that mark to know the ground is
    // there, and so does every kind laid on it.
    if (piece === 'surface') {
      material.depthWrite = true
      // And says so in the stencil, for a shape painted onto the ground alone
      marksLand(material)
    } else {
      layOnLand(material)
      // Everything but the surface is a drape with no normals of its own
      facesUp(material)
    }
    // The footprints are part of the map rather than a promise about the
    // city: they are drawn at every zoom, one depth out of the surface, and
    // they no longer deepen as a view closes on the zoom the buildings stand
    // at. Over ground still on its way a band of light crosses them, in a
    // colour the map has nowhere else
    if (piece === 'footprint') {
      const plan = mix(this.surfaceColor, materialColor, GroundMaterials.PLAN_DEEPEST)
      const crossing = this.sweep()
      const light = mix(this.sweepHead, this.sweepTail, crossing.y)
      material.colorNode = mix(plan, light, crossing.x) as Node<'vec3'>
    }
    // The green comes and goes with the trees standing on it. Before it is
    // fully in it sits close to the surface colour, and reads as ground with
    // nothing laid on it yet. Nothing but the surface lies under the green
    // (see the order of GROUND_PIECES), so falling back to the surface colour
    // is the same as showing what is beneath.
    if (piece === 'green') {
      material.colorNode = mix(this.surfaceColor, materialColor, arrived()) as Node<'vec3'>
    }
    // The footprints, and only they, also come out of the sites a page has
    // cleared — the buildings that stood in them are gone and their plan on
    // the ground would be all that was left of them
    //
    // And, for the pieces that come off the floor's tiles, which of the two
    // steps on screen this mesh belongs to; see CHANGING STEP. Two pieces are
    // on no step: the surface is one sheet cut to the view rather than a tile,
    // and the green is read at z16 whatever step the floor is on — it has an
    // entrance of its own, and dithering it away would take it twice.
    // Last of all, where the land carries its own light. Only the light goes:
    // every term of this colour is a reflectance — the palette's own, a field's,
    // a picture's — so what is left draws exactly what a flat lit land draws.
    // See `inFullDaylight`.
    if (this.glowing) inFullDaylight(material)
    const cleared = piece === 'footprint' ? this.notCleared() : undefined
    const step = piece === 'surface' || piece === 'green' ? undefined : this.keptAtStep()
    const also = cleared && step ? (cleared.and(step) as Node<'bool'>) : (step ?? cleared)
    this.mask.apply(material, also)
    this.fills.set(piece, material)
    return material
  }

  /**
   * Whether a footprint is still there: its own middle, not the pixel being
   * drawn, so a site takes whole footprints and never half of one.
   */
  private notCleared(): Node<'bool'> {
    const local = attribute('centre', 'vec2')
    const middle = modelWorldMatrix.mul(vec4(local.x, 0, local.y, 1))
    return this.cleared.holdsAt(vec2(middle.x, middle.z)).not() as Node<'bool'>
  }

  /** The sites cleared of their buildings, whose footprints go with them. */
  setCleared(area: MaskArea | null): void {
    // A mask of none holds everything, which is right for a mask and exactly
    // wrong here: no site cleared has to mean no footprint taken, so nothing
    // is handed over as an area with no pieces rather than as no area.
    //
    // Which makes passing through here once, with none, part of being built —
    // see the constructor. A shader never told stands where a mask would, and
    // holds every footprint to be on cleared ground.
    this.cleared.set(area ?? NOTHING_CLEARED)
  }

  /**
   * The line a kind is drawn as where it has no width: a coastline, a
   * boundary, a canal too narrow to come as a surface.
   *
   * **In the opaque half of the frame, as the bank is** ({@link blendOverOpaque}),
   * and not in the transparent one `ThinLineMaterial` puts itself in. A line
   * here is a piece of the map like a road, so its place is its number in
   * `GROUND_STACK`, and what a page lays on the land after the ground — a
   * picture, a painted area — goes over it. Left in the transparent half it
   * was drawn after every opaque thing whatever its number, which put the
   * map's own boundaries over a page's aerial photograph and through the plot
   * it had coloured. The fade at the edge is the same alpha and the same
   * blend; it is only drawn sooner. (2026-10-29.)
   */
  line(layer: GroundLineName): ThinLineMaterial {
    const hit = this.lines.get(layer)
    if (hit) return hit

    // Its edge is its own; see `ThinLineMaterial` for why three's is not used.
    const material = new ThinLineMaterial({
      color: new Color(this.palette[layer]),
      linewidth: this.widths[layer],
      worldUnits: false,
      // Read, not written; see LAID_ON_THE_LAND.
      depthWrite: false,
      depthTest: true,
    })
    blendOverOpaque(material)
    layOnLand(material)
    this.mask.apply(material, this.keptAtStep())
    this.lines.set(layer, material)
    return material
  }

  ribbon(layer: GroundRibbonName): MeshStandardNodeMaterial {
    const hit = this.ribbons.get(layer)
    if (hit) return hit.material

    const scale = uniform(1)
    const floor = uniform(0)
    const material = solid({
      color: new Color(this.palette[layer]),
      // Read, not written; see LAID_ON_THE_LAND.
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
    })
    facesUp(material)
    // Pushed out by its real half-width, brought up to the floor where distance
    // would leave it under a pixel
    const halfWidth = attribute('halfWidth', 'float').mul(scale).max(floor)
    const offset = attribute('offset', 'vec2')
    material.positionNode = positionLocal.add(vec3(offset.x, 0, offset.y).mul(halfWidth))

    const ballast = layer === 'rail' ? uniform(new Color(this.palette.ballast)) : undefined
    if (ballast) material.colorNode = railTrack(ballast)

    layOnLand(material)
    if (this.glowing) inFullDaylight(material)
    this.mask.apply(material, this.keptAtStep())
    this.ribbons.set(layer, { material, scale, floor, ...(ballast && { ballast }) })
    this.applyWidth(layer)
    return material
  }

  /**
   * The bank shading: the water's colour darkened, laid half-seen over it.
   *
   * In the opaque half of the frame; see {@link blendOverOpaque}. Its own
   * number in `GROUND_STACK`, right after the water, is what puts it above the
   * water and below whatever comes over that.
   */
  bank(): MeshStandardNodeMaterial {
    if (this.banks) return this.banks.material

    const width = uniform(BANK_WIDTH * this.stretch)
    const material = solid({
      color: new Color(this.palette.river).multiplyScalar(BANK_DARKEN),
      // Read, not written; see LAID_ON_THE_LAND.
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
    })
    blendOverOpaque(material)
    facesUp(material)
    // The corner on the bank stays put; only the inner one is pushed, by the
    // ribbon's width
    const across = attribute('across', 'float')
    const offset = attribute('offset', 'vec2')
    material.positionNode = positionLocal.add(vec3(offset.x, 0, offset.y).mul(across.mul(width)))
    material.opacityNode = bankShade(across)

    layOnLand(material)
    if (this.glowing) inFullDaylight(material)
    this.mask.apply(material, this.keptAtStep())
    this.banks = { material, width }
    return material
  }

  /**
   * The trees standing on the green.
   *
   * The leaves take the material's colour and the trunks a uniform; which of
   * the two a corner is, the corner says. So changing the palette carves
   * nothing again. One tree differs from the next because each carries its own
   * multiplier, applied to that colour.
   */
  tree(): SolidMaterial {
    if (this.trees) return this.trees.material

    const trunk = uniform(new Color(this.palette.trunk))
    const material = solid({ color: new Color(this.palette.leaf) })
    // A tree stands rather than lying, so it writes depth — but it grows where
    // it is rather than having been put there, so what it writes is the land's
    // own mark and a wash over a park covers its crown; see `paints.ts`.
    marksLand(material)
    // And a picture thrown over the map lands on it for the same reason: the
    // land's own sheet cannot reach a crown, and a picture that stopped at the
    // trunk would leave the trees out of the band they stand in.
    this.projection?.cast(material, 'ground')
    // And what an eye on the map can see, for the same reason: a crown is land
    // and no sheet laid on the land reaches it
    this.sight?.paint(material, 'ground')
    // The drop and the test that reads it come together; see `standing`
    const { stand, turn, under, aboveGround, root } = standing()
    material.positionNode = Fn(() => {
      // The normals are turned with it. Left alone, a tree turned about the
      // upright would be lit as though it had not been
      normalLocal.assign(turn.mul(normalLocal).normalize())
      // Still on its way up, or on its way back under: stood that much lower.
      // What has gone below the ground is thrown away rather than left to the
      // ground's own depth, which reaches only as far as the mask does
      return stand.mul(vec4(positionLocal, 1)).xyz.sub(vec3(0, under, 0))
    })()
    material.colorNode = mix(trunk, materialColor, attribute(LEAFNESS, 'float')).mul(attribute(TINT, 'vec3'))
    if (this.glowing) inFullDaylight(material)
    // Cut where it grows, not where its pixels land. A tree standing outside
    // would otherwise keep the part of its crown that leans back over the
    // line, in the air, since the ground it grew out of ends there too
    this.mask.apply(material, aboveGround, root)
    this.trees = { material, trunk }
    return material
  }

  /**
   * The line round a tree.
   *
   * The tree drawn once more, inside out and pushed out past itself, so that
   * only what sticks out behind it shows. A tree is a few folded faces, and a
   * line along every fold would come out as hatching.
   *
   * Its colour is held apart from the buildings' line. That one is a blue
   * grey, and round a green crown it lifts off the leaves.
   *
   * How far it is pushed is measured in page pixels: the projection is
   * orthographic, so one pixel is the same length anywhere on screen.
   */
  treeLine(): MeshBasicNodeMaterial {
    if (this.treeLines) return this.treeLines

    // Ink, not a surface: it keeps the colour it is given whatever the sun is
    // doing, so it is drawn unlit and written past the frame's tone curve.
    const material = new MeshBasicNodeMaterial({
      color: new Color(this.palette.treeLine),
      side: BackSide,
    })
    material.colorNode = beforeTheCurve(materialColor as unknown as Node<'vec3'>)
    // Land, like the tree it is drawn round. Left as a solid it would cut a
    // halo out of any wash the crown was painted with.
    marksLand(material)
    // What one screen pixel is worth in world units. The projection divides the
    // width it sees by two
    const across = cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x
    const perPixel = float(2).div(across.mul(viewport.z.div(screenDPR)))
    const { stand, turn, under, aboveGround, root } = standing()
    const away = turn.mul(attribute(HULL_NORMAL, 'vec3')).normalize()
    // The line comes and goes with the tree. It reads the same place the tree
    // does, so there is nothing to keep in step
    material.positionNode = stand
      .mul(vec4(positionLocal, 1))
      .xyz.add(away.mul(perPixel.mul(TREE_LINE_WIDTH)))
      .sub(vec3(0, under, 0))
    material.visible = this.treeLineOn
    // Cut where the tree it wraps is cut — the same node, not a second one
    // worked out the same way — so a line does not outline a crown whose trunk
    // is still underground, nor one whose tree the mask has taken
    this.mask.apply(material, aboveGround, root)
    this.treeLines = material
    return material
  }

  /**
   * The projector the viewer holds, where a page is throwing a picture down
   * over the map; see `projection.ts`.
   *
   * Handed in rather than reached for, and taken on attaching: a material's
   * nodes are settled at its first drawing and nothing has been drawn then.
   * Only the trees take it — what lies on the land is already wearing the
   * sheet, which is the same picture.
   */
  setProjection(projection: Projection | null): void {
    this.projection = projection
    if (this.trees && projection) projection.cast(this.trees.material, 'ground')
  }

  /**
   * What an eye a page has put on the map can see, for the trees to wear —
   * taken for the reason {@link setProjection} is, and by the trees alone
   * likewise: what lies on the land is painted by the sight's own sheet.
   */
  setSight(sight: Sight | null): void {
    this.sight = sight
    if (this.trees && sight) sight.paint(this.trees.material, 'ground')
  }

  /** Whether trees are drawn with a line round them. What stands stays standing; only the drawing stops. */
  setTreeLine(on: boolean): void {
    this.treeLineOn = on
    if (this.treeLines) this.treeLines.visible = on
  }

  dispose(): void {
    for (const material of this.fills.values()) material.dispose()
    for (const material of this.lines.values()) material.dispose()
    for (const entry of this.ribbons.values()) entry.material.dispose()
    this.banks?.material.dispose()
    this.trees?.material.dispose()
    this.treeLines?.dispose()
    this.trees = undefined
    this.treeLines = undefined
    this.fills.clear()
    this.lines.clear()
    this.ribbons.clear()
    this.banks = undefined
  }

  /**
   * The band of light crossing the ground whose buildings are on their way:
   * how much of it a footprint has, from nought to one, and where in it the
   * footprint stands, nought at the leading edge and one at the trailing.
   *
   * It sets off past the left of the screen and runs off the right, over and
   * over while anything is on its way, so the page is plainly at work rather
   * than plainly stopped. A footprint outside the band, or over ground with
   * nothing coming, has none of it and is left the colour the zoom drew it.
   *
   * Both where and when are measured from the footprint's own middle rather
   * than from the pixel. Every corner of one footprint carries the same middle,
   * so working it out once at the corner hands the whole footprint one value,
   * and the band steps from footprint to footprint rather than washing over
   * them. With nothing arriving, not one slot is walked.
   */
  private sweep(): Node<'vec2'> {
    return varying(
      Fn(() => {
        const local = attribute('centre', 'vec2')
        const centre = modelWorldMatrix.mul(vec4(local.x, 0, local.y, 1))
        const found = float(0).toVar()
        Loop({ start: 0, end: this.arrivingCount, type: 'int', condition: '<' }, ({ i }) => {
          const patch = this.arrivingOf.element(i)
          If(
            centre.x
              .greaterThanEqual(patch.x)
              .and(centre.z.greaterThanEqual(patch.y))
              .and(centre.x.lessThanEqual(patch.z))
              .and(centre.z.lessThanEqual(patch.w)),
            () => {
              found.assign(1)
              Break()
            },
          )
        })
        // Where it stands across the screen, 0 at the left edge and 1 at the right
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(centre)
        const across = clip.x.div(clip.w).mul(0.5).add(0.5)
        // Where the middle of the band is now, from a width off the left to a
        // width past the right
        const head = fract(this.sweepTime.div(SWEEP_SECONDS))
          .mul(1 + 2 * SWEEP_WIDTH)
          .sub(SWEEP_WIDTH)
        // How far into the band it stands: -1 at the leading edge, 1 at the trailing
        const into = across.sub(head).div(SWEEP_WIDTH).clamp(-1, 1)
        const lit = smoothstep(1, 0, into.abs())
          .mul(SWEEP_MOST)
          .mul(found)
          .mul(smoothstep(0, SWEEP_FADE, this.sweepTime))
        return vec2(lit, into.mul(0.5).add(0.5))
      })(),
    )
  }

  private applyWidth(layer: GroundRibbonName): void {
    const entry = this.ribbons.get(layer)
    if (!entry) return
    entry.scale.value = this.stretch * this.scales[layer]
    entry.floor.value = this.floor
  }
}

/**
 * Where each tree stands, carried on the corner as four attributes.
 * The turning part alone is kept aside, to turn the normals and the direction
 * the outline is pushed.
 *
 * `root` is the spot it grows out of, in the world: the last column is where
 * the stand puts it, and the tile's matrix carries that into the world's own
 * units. What reads it is the mask — a tree goes whole or it stays whole, and
 * that is decided where it stands and not where each of its pixels falls.
 *
 * `under` is how far the tree is still sunk, and `aboveGround` is whether this
 * corner has come up out of the ground yet. Handed back together with the rest
 * because they belong together: `appear.ts` asks that the test be given the
 * very node the corner was moved by, and the tree and the line round it both
 * want the one answer. Worked out twice they were two answers that happened to
 * agree, and the line's comment claimed the agreement.
 */
function standing() {
  const [a, b, c, d] = STAND.map((name) => attribute(name, 'vec4'))
  const grows = modelWorldMatrix.mul(vec4(d!.xyz, 1))
  // A tree is only ever turned about the upright, so nothing but the middle
  // column reaches its y: how far over its own ground a corner rests is its
  // own y scaled by how tall this one stands
  const tall = b!.y
  const under = stillUnder()
  return {
    stand: mat4(a!, b!, c!, d!),
    turn: mat3(a!.xyz, b!.xyz, c!.xyz),
    under,
    aboveGround: overGround(tall.mul(positionGeometry.y).sub(under)),
    root: vec2(grows.x, grows.z) as Node<'vec2'>,
  }
}

/**
 * How dark the bank shading is.
 * Darkest at the bank and soon gone, the way the corner shading is at the
 * foot of a wall.
 *
 * It fades out as distance narrows the ribbon to a pixel or two on screen.
 * Under a pixel it catches on some pixels and not on others, and flickers
 * along the bank like a dotted line. It is measured by how much of the ribbon
 * one pixel crosses, so under a tilt the far bank fades first.
 */
function bankShade(across: Node<'float'>) {
  const fall = across.oneMinus()
  const pace = fwidth(across)
  const shown = smoothstep(1, 0.5, pace)
  return fall.mul(fall).mul(shown).mul(BANK_OPACITY)
}

/**
 * The pattern along a railway.
 * Two rails running over ballast, with sleepers laid across them.
 * Every edge is softened by how fast the coordinate changes at that pixel, so
 * that once distance makes the pattern finer than the screen it melts into a
 * single band.
 */
function railTrack(ballast: UniformNode<'color', Color>) {
  const ribbon = attribute('along', 'vec2')

  const along = ribbon.x.div(SLEEPER_SPACING)
  const pace = fwidth(along).max(1e-5)
  // 0 at the middle of a sleeper, 1 at the middle of the gap after it
  const phase = fract(along).sub(0.5).abs().mul(2)
  const sleeperAlong = smoothstep(pace.mul(2).add(SLEEPER_SHARE), pace.mul(-2).add(SLEEPER_SHARE), phase)

  const across = ribbon.y.abs()
  const edge = fwidth(across).max(1e-5)
  const sleeper = sleeperAlong.mul(
    smoothstep(edge.add(SLEEPER_REACH), edge.negate().add(SLEEPER_REACH), across),
  )
  const rail = smoothstep(
    edge.add(RAIL_HALF_WIDTH),
    edge.negate().add(RAIL_HALF_WIDTH),
    across.sub(RAIL_OFFSET).abs(),
  )

  return mix(ballast, materialColor, sleeper.max(rail))
}
