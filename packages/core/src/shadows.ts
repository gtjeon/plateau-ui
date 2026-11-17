import {
  Fn,
  If,
  dFdx,
  dFdy,
  dot,
  float,
  int,
  interleavedGradientNoise,
  normalWorld,
  renderGroup,
  screenCoordinate,
  shadowPositionWorld,
  vec2,
  vec4,
  vogelDiskSample,
} from 'three/tsl'
import { texture, uniform } from './repaint.js'
import {
  DepthTexture,
  type DirectionalLight,
  LessEqualCompare,
  LinearFilter,
  Matrix4,
  type Node,
  type NodeBuilder,
  NodeUpdateType,
  OrthographicCamera,
  RenderTarget,
  Scene,
  ShadowBaseNode,
  Vector3,
  WebGPUCoordinateSystem,
  type WebGPURenderer,
} from 'three/webgpu'
import { drawCasters } from './offscreen.js'

/** How wide the map is, in texels. Square. */
const SIZE = 2048

/** Drawn into the map to make its texture, and nothing else; see {@link SunShadow.prime}. */
const NOTHING = new Scene()

/**
 * How far a place is let be past what the map holds before it counts as shut
 * out, in the map's own depth.
 *
 * The small flat allowance under the normal offset, and little more than a
 * tie-breaker: a reading that lands exactly on the surface the map drew is two
 * equal numbers, and which way a tie falls is whichever way the last bit
 * rounded. {@link NORMAL_OFFSET} does the work this used to do alone, which is
 * why this is a tenth of what it was then.
 *
 * **Negative, and that is not a detail.** The test is `z + this <= stored`, so
 * a positive number pushes the place being read *away* from the light and a
 * face then fails against its own depth — every lit face, everywhere, not just
 * the grazing ones. Measured the hard way: with it positive the whole city came
 * out in full shade, which reads on screen as no shadow at all, because what is
 * missing is the sun rather than the shade. The flip happens exactly at nought,
 * which is also the proof that the map and the lookup agree to the bit.
 */
const BIAS = -0.00002

/**
 * How far off its own face a reading is lifted before the map is looked up, in
 * texels of that map.
 *
 * The normal offset, and the thing holding the stripes back. Rather than
 * letting a face off by a fixed amount of *depth* — which is the same allowance
 * for a face square to the sun and one it grazes, and the wrong allowance for
 * both — the place being read is moved along the face it sits on until it is
 * clear of the texel that holds it.
 *
 * Counted in texels because that is what it has to clear: one texel of this map
 * covers about half a world unit — some 0.4 m at 東京's latitude — at the zooms
 * this is drawn at, and more where the sun is low. A number in metres would be
 * too much when zoomed in and too little when zoomed out; this one follows the
 * map.
 *
 * Scaled by how far the face leans from the sun, as the sine of that angle
 * (`sqrt(1 - (N·L)²)`) — nought where the sun is square on and the texel holds
 * one depth for the whole face, one where the sun grazes and the texel holds a
 * long stretch of it. That is the published shape of this technique, and it is
 * what a flat allowance cannot do.
 *
 * What it costs is what every allowance costs: the reading is taken as if the
 * face stood a little nearer the sun, so a shadow starts a little late at the
 * foot of what throws it. A sideways step along the face moves the reading far
 * less than an equal step in depth does, which is why this carries nearly all
 * of the allowance and {@link BIAS} almost none.
 *
 * **And it cannot do the creases, which is measured and not guessed**
 * (2026-10-07). Where two faces meet at a right angle, a reading lifted off
 * either of them lands on the other — exactly on it, at the crease itself — so
 * the test is a tie and the texel grid breaks it one way or the other along the
 * fold. Lifting further only slides further along the neighbour, which is why
 * 2, 8 and 32 texels all drew the same saw tooth.
 *
 * Four, chosen on screen. This technique's own literature starts at two, and
 * Cesium gives its buildings 0.1 and its ground 0.5 of a different scale and
 * then shades grazing faces dark on top of it so that what is left cannot be
 * seen; it does not have to be matched number for number.
 */
const NORMAL_OFFSET = 4

/**
 * How far out the map is read around a place, as a radius in texels, and over
 * how many readings.
 *
 * **Three's own default filter, with its own count and a wider disk**
 * (`ShadowFilterNode.js`, `PCFShadowFilter`): five places on a disk, turned by
 * a different angle at every screen pixel so that five readings do not band,
 * and each of them a comparison the card weighs over its own four texels.
 * Three's comment calls it twenty filtered taps; its own radius
 * (`LightShadow.radius`) is 1 and this one is 3.
 *
 * **The two cost quite differently, and only one of them costs anything.** The
 * count is a reading apiece, on every pixel that receives, every frame — it is
 * the one number here that is multiplied by the whole screen. The radius is
 * free: the same five readings, taken further apart.
 *
 * What a wide disk and few readings buy instead is *sparseness*. The disk's
 * area goes with the square of the radius, so three texels over five points
 * leaves them about two texels apart while each covers about two, which is
 * barely touching: the edge is then built out of five steps rather than a
 * ramp. Turning the disk per pixel trades that from a pattern into a grain,
 * which is why the turning is not optional here.
 *
 * What it is for is the one thing the map cannot do by itself: where a shadow
 * really ends, the map can only answer on its own grid, so that line comes out
 * as steps one texel deep — two or three screen pixels at these zooms, which is
 * exactly the size the eye reads as a saw. Reading several places across that
 * line and averaging turns the step into a short ramp.
 *
 * **What it costs is what every kernel costs**, and it is worth writing down
 * rather than discovering: a reading that reaches sideways can land on a face
 * other than this one. Near a crease the neighbour is nearer the sun and votes
 * for shade, so a wider box wants a larger lift to stay off it. GPU Gems 3,
 * chapter 8 has the general form: a kernel "effectively requires the bias to be
 * proportional to the depth range over the entire filter region".
 * {@link NORMAL_OFFSET} is the lift that pays for this one, and the receiver
 * plane ({@link SunShadow.plane}) is what keeps that lift from having to grow
 * with the radius.
 */
const SPREAD = 3
const TAPS = 5

/**
 * The steepest the face's own plane is let be, as how much deeper it gets over
 * one width of the map, in the depth the map stores.
 *
 * {@link SunShadow.setup} works that slope out from the screen's own
 * derivatives, and on a face the sun nearly grazes it runs away — the plane is
 * then almost edge-on to the light and a texel of the map covers an unbounded
 * stretch of it. Held here, because a correction that large stops being a
 * correction: it carries the reading clean through whatever stands in front of
 * it and the shadow opens up.
 *
 * **A map width and not a texel**, which is worth saying because eight reads
 * absurd in texels and is not. What the derivatives are taken of is the map
 * coordinate, which runs nought to one across the whole map, so this bound is
 * 8/2048 of the stored depth per texel stepped, and a tap at {@link SPREAD} is
 * moved by under a fiftieth of that depth (3/2048 × 8 along either axis). As a
 * slope in the world it comes to `8 × (reach + height) / reach`, a ratio of the
 * light's own box, so it tightens as the view pulls back and loosens as it
 * closes in. Arithmetic off the code; the eight itself was chosen on screen, in
 * these units.
 */
const STEEPEST = 8

/**
 * The lowest the sun is taken to stand, as the sine of its height. About
 * fifteen degrees.
 *
 * It is the viewer that puts this floor under the sun, where it works out how
 * wide the light's box has to be to hold whatever casts into the view ({@link
 * SunShadow.aim}'s caller): that width goes with `1/tan` of the sun's height
 * and runs away as the sun reaches the horizon, where a shadow is longer than
 * the view anyway. It lives here because it is a fact about this map rather
 * than about the camera.
 */
export const LOWEST_SUN = 0.26

/**
 * What the sun can see, as one map over the view — and three's own shadow for
 * the sun.
 *
 * **One map, one aiming, one reading of five places.** No cascade, no shading
 * of grazing faces to cover what is left, and nothing in `ViewerOptions` that
 * says a word about any of it. Larger answers were built before this one and
 * taken out again; `CLAUDE.md`, 계약 11 has them.
 *
 * Four numbers are turnable all the same — the lift, the receiver plane, the
 * disk's radius and how many places are read. They are on the node, which is
 * where three keeps a shadow's own settings, so a page reaches them the way it
 * reaches any of three's (`sun.shadow.shadowNode`, or `viewer.lights.shadows`)
 * and never through an option of this library's. What they are for is the
 * panel: the numbers below were chosen by turning them and looking.
 *
 * **Two allowances hold the stripes back, and they are all there is.**
 * {@link NORMAL_OFFSET} lifts a reading off its own face before the map is
 * looked up — by texels of the map, and by how far the face leans from the sun
 * — and {@link BIAS} is a hair of flat allowance in depth under it. That is the
 * ordinary answer, the one Cesium and three and the literature all land on, and
 * it is here for the one thing it makes possible: **the reading carries one
 * depth, so it can be filtered.** The same number is right at every texel near
 * it, so the map may be read all round the place and the answers averaged —
 * which is {@link SPREAD}, and which is what takes the staircase off a shadow's
 * own edge. {@link plane} is the companion that keeps a wider reading honest.
 *
 * **What it gets wrong, and both are the texel showing through.** A shadow
 * starts a little late at the foot of what throws it, by the lift. And at a
 * crease — a wall foot, a roof lip — a reading lifted off either face lands on
 * the other, so the test is a tie and the grid breaks it along the fold.
 *
 * **What was measured against it and dropped**, all on screen, on 2026-10-07
 * and 10-08.
 * - *A flat allowance alone.* The fold wants half a texel's depth, some 0.5m at
 *   a winter sun; a flat 0.5m eats every shadow shorter than itself, and the
 *   plant standing on a roof lost its shadow outright. It is still here, at a
 *   fiftieth of that, as a tie-breaker and nothing else.
 * - *Comparing at the texel's own centre instead of lifting* — Dou, Yan,
 *   Kerzner, Dai and Wyman's adaptive depth bias (JCGT 3(4), 2014), which meets
 *   the light's ray through the texel centre with the fragment's own tangent
 *   plane. It is exact where the map really drew the face, so no lift is needed
 *   and a lit face cannot stripe itself at all; it was built, measured and kept
 *   for a day. What it cannot do is be filtered: the depth it hands over is a
 *   different number for each of the four texels, so the card's own weighing
 *   answers three wrong numbers out of four and the city came out under fine
 *   grain. Reading the four by hand instead costs four lookups, and widening
 *   that box past one texel put the fold's ripple straight back — a box two
 *   texels wide reaches the neighbouring face, which is nearer the sun and
 *   votes for shade. So it bought an exact lit face and gave up the staircase,
 *   and the staircase is what is actually seen at these zooms.
 * - *Writing the far faces into the map* (three's own `_shadowSide`, which is
 *   second-depth shadow mapping). The fold was untouched, and a roof lip's cast
 *   shadow lost its own thickness and broke into dashes. At a wall foot it
 *   cannot help at all: what the wall reads there is the land, and the land is
 *   one sheet with no far side.
 * - *Cascades, a screen-space contact march, and holding a map for several
 *   frames.* All three were built and turned on screen, and all three came out
 *   again — not because they do not work, but because at one map and these
 *   numbers none of them was earning the code it took. `CLAUDE.md`, 계약 11
 *   says what each bought, and the history has them.
 *
 * **Why it is a `ShadowBaseNode`.** Three asks for a shadow in one place —
 * `light.shadow.shadowNode`, which `AnalyticLightNode.setupShadow` reads and
 * multiplies into the light's own colour — and taking that place is what makes
 * three's two words mean what three says they mean. `mesh.receiveShadow` is the
 * gate on the reading: `AnalyticLightNode` weaves this node into a material
 * only where the object being woven receives, so a mesh that says no is lit by
 * an uncut sun. `mesh.castShadow` is the gate on the writing, asked of every
 * object as the map is drawn ({@link render}). Three judges both, for a page's
 * own mesh as for ours, and nothing here intercepts either.
 *
 * **The map is drawn by the viewer, not by three.** Three draws a
 * `ShadowNode`'s map from `updateBefore`, inside the render that reads it; this
 * one is aimed at *what is on screen* rather than at the light, and the only
 * thing that knows what is on screen is the viewer. So `updateBeforeType` is
 * off and `Viewer.castShadows` does the aiming and the drawing — which is also
 * contract 1, no render nested inside a render.
 *
 * `light.shadow` is therefore a half-used object: its `camera` is not the one
 * the map is drawn with, and `mapSize`, `bias` and `normalBias` are not read.
 * A page can reach all four and change none of them. Said here because
 * `viewer.lights.sun` is open and meant to be (계약 11), so `sun.shadow.*` is
 * open with it, and a reader who hangs a helper on that camera will find it
 * pointing at a ten-metre box round the world's nought.
 */
export class SunShadow extends ShadowBaseNode {
  private readonly depthTexture = new DepthTexture(SIZE, SIZE)
  private readonly target = new RenderTarget(SIZE, SIZE, { depthTexture: this.depthTexture })

  /**
   * The light's own eye. Not `light.shadow.camera`, which three makes and
   * nothing here uses; see the class comment.
   *
   * It sees the default layer alone, so nothing drawn only into the picture
   * casts — a building's fold lines, every mark, every outline shell is on
   * `PICTURE_ONLY` (`passes.ts`) and none of them would ever want to. The
   * land's own lines are on the default layer (since 2026-10-29) and cast
   * nothing all the same: three leaves `castShadow` off, nothing turns it on
   * for them, and `drawCasters` asks that before anything else.
   *
   * A thing a page said closes in no corner is still on that layer, and casts
   * here as its own `castShadow` says: being left out of the corner shading is
   * a different question from throwing a shadow (`setOccludes`).
   */
  readonly camera = new OrthographicCamera()

  /*
   * **Every uniform below says `renderGroup`, and that is not tidiness**
   * (2026-10-08).
   *
   * Three's `uniform()` lands in `objectGroup` when nothing says otherwise
   * (`UniformNode`'s own default), and three's word for that group is "uniform
   * buffer per object" — a copy apiece, filled when that object is reached.
   * `renderGroup` is "shared uniform buffer, updated once per render call".
   * These seven describe *the map*, not the thing reading it, so a copy apiece
   * is a copy apiece of one fact, and copies of one fact can disagree.
   *
   * They did. With a per-object copy, some receivers read the map through an
   * aim that was not this frame's — the map says where it is looking, so a
   * reader holding the wrong one looks up the wrong place and comes back with
   * whatever stands there. On screen it was a shadow belonging to nothing,
   * sliding across a model or a block as the view moved: the view moves, the
   * aim moves with it, and anything carrying the old aim is left behind by
   * exactly that much. It never showed on the city or the land. Found by
   * elimination — the file, the material, the normal map, the lift, the
   * receiver plane, the kernel, the spot and the land's heights were each
   * taken away on screen and none of them was it — and then by reading three,
   * which puts its own shadow matrix in the render group for this reason
   * (`nodes/accessors/Lights.js`: `uniform('mat4').setGroup(renderGroup)`).
   *
   * It costs nothing either way: one buffer instead of one per object.
   */

  /** The world to the map: three's convention, so this is projection × view. */
  private readonly toMap = uniform(new Matrix4()).setGroup(renderGroup)
  /** Whether the map holds anything worth reading, 1 or 0. */
  private readonly casting = uniform(0).setGroup(renderGroup)
  /**
   * Which way the sun is, and how much world one texel of the map covers.
   *
   * Both are for the lift alone — the one is what a face is measured against to
   * know how far it leans, the other is what the lift is counted in — and both
   * are written by {@link aim}.
   */
  private readonly toSun = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup)
  private readonly texel = uniform(1).setGroup(renderGroup)

  /**
   * The numbers above, held rather than written into the shader — so that the
   * playground can turn them and watch what each one buys.
   *
   * **Not a page's handles.** They are on the node, which a page reaches only
   * through three's own `sun.shadow.shadowNode` (or `viewer.lights.shadows`),
   * and nothing in `ViewerOptions` says a word about them; the defaults are the
   * constants and the library stands or falls on those. They are here because
   * the only way to know what a wider box or a longer lift is worth is to look
   * at it, and looking means turning it while the city is on screen.
   *
   * Three of them are free and one is not. {@link lift}, {@link plane} and
   * {@link spread} are uniforms, so they land on the next frame. {@link taps}
   * is the shape of the shader — a loop that is unrolled — so it lands only
   * once every render object is built again, which the viewer sees to when
   * {@link shape} moves.
   */
  private readonly lifting = uniform(NORMAL_OFFSET).setGroup(renderGroup)
  private readonly planing = uniform(1).setGroup(renderGroup)
  private readonly spreading = uniform(SPREAD / SIZE).setGroup(renderGroup)
  private tapping = TAPS

  /**
   * Bumped whenever a knob changes the **shape** of the shader rather than a
   * number in it, so that the viewer can have every render object built again.
   *
   * It has to be the viewer: what three keys a rebuild on is the renderer's own
   * context node, and this node has no renderer. A node's own version does not
   * travel — the lights' cache key carries each light's id and whether it casts
   * and nothing of what its shadow is made of (`LightsNode.customCacheKey`) —
   * so the knob says *that* it changed and `Viewer.castShadows` says *to whom*.
   */
  private shaping = 0

  /** Held between frames only so that aiming does not make them sixty times a second. */
  private readonly centre = new Vector3()
  private readonly axis = new Vector3()

  constructor(light: DirectionalLight) {
    super(light)
    /*
     * The card does the comparing, and the filtering with it.
     *
     * Both are free and both are wanted. A depth texture given a
     * `compareFunction` is read as *is this depth no deeper than what is
     * stored* — LessEqual, because a place no deeper than what the map holds
     * has nothing in front of it, and the renderer is not asked for a reversed
     * depth buffer, so its depths run the ordinary way. Linear on top of that
     * compares at the four texels round the reading and weighs the four answers
     * by where between them it fell, so one reading answers a fraction rather
     * than a yes or a no. It is the smallest filter there is and it costs
     * nothing; {@link SPREAD} is the rest of the filtering, and the class
     * comment on {@link SunShadow} has why a reading may be filtered at all.
     */
    this.depthTexture.compareFunction = LessEqualCompare
    this.depthTexture.minFilter = LinearFilter
    this.depthTexture.magFilter = LinearFilter
    // Nothing to prepare between frames; the viewer draws the map
    this.updateBeforeType = NodeUpdateType.NONE
    // Three's gate on the whole of it: with this off, `AnalyticLightNode` never
    // looks at `shadow.shadowNode` and no material reads a map
    light.castShadow = true
    light.shadow.shadowNode = this
  }

  /** @internal Says whether the map was drawn for this frame. Set before the picture, every frame. */
  set casts(on: boolean) {
    this.casting.value = on ? 1 : 0
  }

  /** How far a reading is lifted off its own face, in texels. Free; {@link NORMAL_OFFSET}. */
  get lift(): number {
    return this.lifting.value
  }

  set lift(texels: number) {
    this.lifting.value = Math.max(0, texels)
  }

  /**
   * How much of the receiver plane's own slope is taken off each reading of the
   * spread, 0 to 1. Free.
   *
   * **The companion a kernel asks for.** A reading taken a texel to one side is
   * a reading of *somewhere else on this face*, and that somewhere else is
   * deeper or shallower by however the face leans. Comparing it against this
   * place's depth is the mistake GPU Gems 3 names as the nature of a kernel —
   * the wider the box, the larger the allowance it needs. Here the face's own
   * plane is taken off instead, so each tap is compared against the depth this
   * face really has *there*, and the box can be widened without the lift
   * growing with it.
   *
   * The slope is read off the screen's own derivatives of the map coordinate,
   * which is what makes it cheap and what makes it only as good as a pixel
   * quad: at a silhouette the quad straddles two surfaces and the slope is
   * nonsense, so it is held at {@link STEEPEST}. Nought turns it off, which is
   * what it was before this existed.
   */
  get plane(): number {
    return this.planing.value
  }

  set plane(part: number) {
    this.planing.value = Math.min(Math.max(part, 0), 1)
  }

  /** How far out the map is read around a place, as a radius in texels. Free; {@link SPREAD}. */
  get spread(): number {
    return this.spreading.value * SIZE
  }

  set spread(texels: number) {
    this.spreading.value = Math.max(0, texels) / SIZE
  }

  /** How many readings the spread is made of. Needs every render object built again. */
  get taps(): number {
    return this.tapping
  }

  set taps(count: number) {
    const want = Math.max(1, Math.round(count))
    if (want === this.tapping) return
    this.tapping = want
    this.shaping++
  }

  /**
   * @internal How many times a knob has changed the shape of the shader; see
   * {@link shaping}.
   */
  get shape(): number {
    return this.shaping
  }

  /**
   * @internal How much world one texel of the map covers. Read, not set — and
   * not by a page: a number for looking at while tuning the map, which the
   * playground shows, and nothing a page acts on (rule 8; nothing says when
   * it changes, and it changes with every zoom).
   *
   * World units and not metres, which is the same thing only at the equator:
   * this is Mercator, so a unit is `metersPerUnit(lat)` metres — 0.81 of one
   * at 東京's latitude. Named for what it is after the other way round was
   * read off a panel and written into `CLAUDE.md` as metres, where it
   * overstated every texel by 23%.
   */
  get worldPerTexel(): number {
    return this.texel.value
  }

  /**
   * @internal The viewer's, every frame.
   *
   * Points the light at what is to be in the map and opens it just wide enough.
   *
   * Tighter is sharper: the map has a fixed count of texels and they are spread
   * over whatever is asked for. A circle round the view is used rather than the
   * view itself, so turning the camera does not change how much is asked for
   * and set the edges crawling.
   *
   * `reach` is how far that circle goes and `height` is how far back the light
   * has to stand to hold whatever could cast into it.
   */
  aim(centre: Vector3, reach: number, toSun: Vector3, height: number): void {
    const camera = this.camera
    camera.left = -reach
    camera.right = reach
    camera.top = reach
    camera.bottom = -reach
    const back = reach + height
    camera.near = 0
    camera.far = back * 2
    camera.position.copy(centre).addScaledVector(toSun, back)
    camera.up.set(0, 1, 0)
    camera.lookAt(centre)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    // The box is half the map's texels either way, so its own edges sit on the
    // grid and holding the light to the grid holds every texel to it
    const texel = (reach * 2) / SIZE
    this.anchor(centre, toSun, back, texel)
    this.toMap.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.toSun.value.copy(toSun)
    this.texel.value = texel
  }

  /**
   * Moves the light onto a grid that stands still in the world.
   *
   * The map's texels are laid out from wherever the light stands, so a light
   * that has moved half a texel lays them half a texel on. The edge of a roof
   * then falls in a different texel than it did, that texel's answer turns
   * over, and a texel's width of shadow edge turns with it — every frame, since
   * where the light stands is worked out afresh from the camera every frame.
   * Turning the view alone is enough. That is the crawl along every shadow edge
   * as the view swings, and it is not an artefact anyone would call a setting:
   * so the light is only let stand at whole texels.
   *
   * All three axes are rounded, not the two sideways ones. Three's own CSM
   * leaves the one along the light's sight free, and it could be — moving that
   * way puts the same amount on every depth the map holds and on every depth
   * read against it — but a depth is written rounded, and the same numbers
   * rounded afresh each frame are not quite the same numbers.
   *
   * What is left free is the grid's spacing, which is the width the light is
   * given over its fixed count of texels. That follows the view, so a tilt or a
   * zoom respaces the grid and the map is only still once the view is.
   */
  private anchor(at: Vector3, toSun: Vector3, back: number, texel: number): void {
    const camera = this.camera
    if (!(texel > 0)) return
    this.centre.copy(at)
    // Read the axes off the matrix three has just built rather than working
    // them out again: a grid a hair off the one the map is drawn on is no grid
    for (let column = 0; column < 3; column++) {
      this.axis.setFromMatrixColumn(camera.matrixWorld, column)
      const along = this.centre.dot(this.axis)
      this.centre.addScaledVector(this.axis, Math.round(along / texel) * texel - along)
    }
    // The light and what it looks at move together, so it goes on looking the
    // way it was pointed and only its place changes
    camera.position.copy(this.centre).addScaledVector(toSun, back)
    camera.updateMatrixWorld()
  }

  /**
   * @internal The viewer's: it draws the map, not three; see `Viewer.castShadows`.
   *
   * Draws whatever casts, as the light sees it. Depth only.
   *
   * What casts is `object.castShadow`, asked of every object the way three's
   * own shadow pass asks it. Three's default is off, so every mesh this library
   * stands up says so at the one place it is made, and a page's own mesh says
   * it for itself — in the line it would write in any other three scene.
   *
   * It is not three's shadow pass, and the difference is the stand-in
   * materials: three carries a material's `positionNode` and `maskNode` into
   * its own override material but not its `vertexNode`, and it flips the faces
   * it draws (`_shadowSide`). `offscreen.ts` carries all three and keeps the
   * faces as they are.
   */
  render(renderer: WebGPURenderer, scene: Scene): void {
    drawCasters(renderer, scene, this.camera, this.target)
  }

  /**
   * @internal Has the map's own texture made before anything reads it.
   *
   * three makes a depth texture the first time anything touches it, and the
   * first `updateRenderTarget` on a target always finds its sample count new
   * (`renderTargetData.sampleCount` starts undefined) — so it says the depth
   * wants making again. Where a material has already sampled the texture, that
   * is a destroy and a remake, and every shader woven before it goes on
   * holding the one that is gone: the card then refuses the whole submit and
   * the frame is lost, which reads as noise over the picture.
   *
   * Drawing nothing into it is the cheapest way to have the render target be
   * what makes it. Once, before the first picture.
   */
  prime(renderer: WebGPURenderer): void {
    drawCasters(renderer, NOTHING, this.camera, this.target)
  }

  /**
   * How much of the sun reaches this place: one in the open, nought where the
   * map says something stands in the way.
   *
   * This is the light's own, not a factor over the colour. Three multiplies it
   * into the sun's colour itself (`AnalyticLightNode.setupShadow`), so the sun
   * is simply dark where something blocks it and everything three does
   * downstream — the Lambert term, a page's own glTF, a specular lobe — reads a
   * sun that has been cut. Nobody downstream has to know there is a map.
   */
  override setup(builder: NodeBuilder): Node {
    // `If` reads the stack a `Fn` body opens, so the branch lives in one — and
    // so does the one line three asks of a shadow node, which assigns into a
    // property rather than returning a value.
    return Fn(() => {
      // Where three says to look this place up from: `positionWorld`, unless a
      // material or a context has said otherwise
      // (`ShadowBaseNode.setupShadowPosition`). Honoured rather than reading
      // `positionWorld` outright, so that a page's own material which moves its
      // corners and tells three where its shadow belongs is believed here too.
      this.setupShadowPosition(builder)
      const here = shadowPositionWorld as unknown as Node<'vec3'>
      const reached = float(1).toVar()
      // Nothing is read while the map holds nothing: over bare ground that is a
      // reading a pixel for a "lit" known in advance
      If(this.casting.greaterThan(0.5), () => {
        /*
         * Lifted off its own face before it is looked up; see
         * {@link NORMAL_OFFSET}. The sine of the angle between the face and the
         * sun is `sqrt(1 - (N·L)²)`, nought square-on and one at a graze. N·L is
         * held at nought below so that a face turned away is lifted the full
         * amount rather than having the sine fall back towards nought on it —
         * the lift is along the normal either way, so nothing is pushed
         * backwards. Such a face takes no sun, so the picture is the same and
         * this is simply the safe side for a two-sided material or for normals
         * that face the wrong way. Read off the code, not measured.
         */
        const facing = dot(normalWorld, this.toSun).clamp(0, 1).toVar()
        const leaning = float(1).sub(facing.mul(facing)).sqrt().toVar()
        const lifted = here.add(normalWorld.mul(this.texel.mul(this.lifting).mul(leaning))) as Node<'vec3'>
        const place = this.toMap.mul(vec4(lifted, 1)) as Node<'vec4'>
        const flat = place.xyz.div(place.w).toVar()
        // Three's own convention, written out rather than borrowed: the map's
        // own matrix would carry the half-and-a-half, and this one is plain
        // projection × view so it is done here. The second coordinate counts
        // down the texture where the projection counts up — that is WebGPU's,
        // and three does the same `oneMinus` in `ShadowNode.setupShadowCoord`.
        const at = vec2(flat.x.mul(0.5).add(0.5), flat.y.mul(0.5).add(0.5).oneMinus()).toVar()
        /*
         * How deep it is the way the map holds depth, which is nought to one
         * on either card. WebGPU's projection already ends there; WebGL's ends
         * at minus one to one and the card squeezes that into the map as it
         * draws, so on WebGL2 the reading is squeezed the same way before it is
         * compared. Three does the same the other way round
         * (`ShadowNode.setupShadowCoord`), its matrix carrying the squeeze that
         * this plain one does not.
         *
         * Left as it was, every place on WebGL2 was compared at a depth under
         * what the map held for it and came out lit: no sun shadow anywhere,
         * where WebGPU on the same view drew every one (seen side by side,
         * 2026-11-04). Fixed by the card the shader is woven for, so it costs
         * nothing at run time.
         */
        const z = (
          builder.renderer.coordinateSystem === WebGPUCoordinateSystem ? flat.z : flat.z.mul(0.5).add(0.5)
        ).toVar()
        /*
         * The face's own plane, as how much deeper it gets per step across the
         * map; see {@link plane}.
         *
         * **Taken here, outside the branch, because it cannot be taken inside
         * one.** A derivative is the difference between neighbouring pixels, so
         * every pixel of the quad has to reach it — WGSL will not even compile
         * one under control flow it cannot prove uniform, and the branch below
         * is per-pixel. Out here the only branch above is on a uniform.
         *
         * Two screen steps give two equations in the two unknowns, and the 2×2
         * they make is solved outright. Its determinant goes to nought where
         * the map coordinate stops moving across the screen — a face seen
         * edge-on — and there the answer is dropped rather than scaled by
         * infinity.
         */
        const perX = dFdx(at).toVar()
        const perY = dFdy(at).toVar()
        const deepX = dFdx(z).toVar()
        const deepY = dFdy(z).toVar()
        const turning = perX.x.mul(perY.y).sub(perX.y.mul(perY.x)).toVar()
        const plain = turning.abs().greaterThan(1e-12).toVar()
        const perU = plain
          .select(deepX.mul(perY.y).sub(perX.y.mul(deepY)).div(turning), float(0))
          .clamp(-STEEPEST, STEEPEST)
          .toVar()
        const perV = plain
          .select(perX.x.mul(deepY).sub(deepX.mul(perY.x)).div(turning), float(0))
          .clamp(-STEEPEST, STEEPEST)
          .toVar()
        /*
         * Outside the map nothing is read and the place comes out lit, which is
         * the answer that changes nothing: reading the edge anyway answers with
         * whatever happens to stand there, and a whole roof goes dark or not as
         * the view moves.
         *
         * **Outside is all three, and depth is the one that was missing**
         * (2026-10-13). A place past the far plane is as much outside the map
         * as one past its edge — the map never saw it — but the map holds the
         * one it was cleared to, and a depth over one fails against that, so
         * the place came out in full shade instead. What found it was a sheet
         * standing at `at: 'view'`: that grows with the screen while the map,
         * once the mask has stood it on the cut (`Viewer.castShadows`), does
         * not. Measured on the workspace example: the floor at -30 m reached
         * 43,558 world units across where the map held 15,503 of depth, and
         * what stood on screen was a quad of shade 13,777 by 7,018 — the map's
         * own width by however much of the sheet had run past the far plane.
         * Three asks the same three (`ShadowNode.setupShadowFilter`,
         * `shadowCoord.z.lessThanEqual(1)`).
         *
         * The near end is not asked, and would answer the same if it were: a
         * depth under nought is under everything the map can hold, and a
         * reference a driver clamps up into nought is still under it, since
         * what the map holds is nought or more.
         *
         * **Widening the far plane instead was the other way, and it was not
         * taken.** A horizontal face crossing the box changes depth by
         * `reach × cot(altitude)` — 13,961 world units against the 15,503 held,
         * at the 26° sun this was measured under — so `far` would have to
         * follow the sun down, and {@link LOWEST_SUN} puts that at better than
         * three times the box. Every shadow in the picture would spend its
         * depth on a stretch where nothing of this scene stands: out there the
         * tallest thing that could cast onto the sheet is a block 30 m high,
         * whose shadow is 60 m long and lands nowhere near it.
         *
         * Taken on the depth the lookup uses rather than on `z`, so that the
         * test and the value it guards are the one number.
         */
        const depth = z.add(BIAS).toVar()
        const inside = flat.x
          .abs()
          .lessThanEqual(1)
          .and(flat.y.abs().lessThanEqual(1))
          .and(depth.lessThanEqual(1))
        If(inside, () => {
          /*
           * Five places on a disk round it, each asked the same question; see
           * {@link SPREAD}. The disk is turned by its own angle at every screen
           * pixel, because five readings in a fixed pattern draw the pattern
           * itself along a shadow's edge; turning them trades that for a grain
           * the eye reads as softness. Both the disk and the angle are three's,
           * taken from `three/tsl` rather than written again here.
           */
          const turn = interleavedGradientNoise(screenCoordinate.xy)
            .mul(2 * Math.PI)
            .toVar()
          const taps = this.tapping
          let lit: Node<'float'> | null = null
          for (let tap = 0; tap < taps; tap++) {
            const off = vogelDiskSample(int(tap), int(taps), turn).mul(this.spreading).toVar() as Node<'vec2'>
            /*
             * A tap steps off this place, and off the map as well where this
             * place sits within a disc of its edge. The texture clamps there
             * and answers with the border texel, which is whatever stands at
             * the edge rather than anything over this tap — the reading the
             * paragraph above refuses, arrived at by the back door.
             *
             * Asked of each tap rather than by pulling the test above a disc's
             * width inward, which would give up the shade along every edge of
             * the map to save four comparisons. Read off the code; what was
             * measured on screen was the far end, not these.
             */
            const spot = at.add(off).toVar()
            const held = spot.x
              .greaterThanEqual(0)
              .and(spot.x.lessThanEqual(1))
              .and(spot.y.greaterThanEqual(0))
              .and(spot.y.lessThanEqual(1))
            /*
             * This face's own depth where the tap lands, not here's — and no
             * deeper than the map can hold.
             *
             * **The ceiling is what keeps the far edge from drawing itself.**
             * This place passing the test above says nothing about a tap beside
             * it: the tap carries the face's own slope, and near that edge the
             * slope puts the comparison past one, where empty map holds exactly
             * one and the tap comes back shut out. One or two of five failing
             * is the line that was left along the far edge once the depth test
             * went in — 1 to 2 px at 202 against the 225 around it, gone with
             * either `plane` or `spread` at nought and back with them restored.
             * What it costs is that `spread` is no longer free of that edge: a
             * wider disc reaches further past one and gives up more of the
             * shade there.
             */
            const there = depth
              .add(off.x.mul(perU).add(off.y.mul(perV)).mul(this.planing))
              .min(1) as Node<'float'>
            const asked = texture(this.depthTexture, spot).compare(there) as unknown as Node<'float'>
            const answer = held.select(asked, float(1)) as unknown as Node<'float'>
            lit = lit === null ? answer : (lit.add(answer) as Node<'float'>)
          }
          reached.assign(lit!.div(taps) as unknown as Node<'float'>)
        })
      })
      return reached
    })() as unknown as Node
  }

  override dispose(): void {
    this.target.dispose()
    super.dispose()
  }
}
