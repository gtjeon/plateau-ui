import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { float, getViewPosition, mix, screenUV, smoothstep, vec3, vec4 } from 'three/tsl'
import { texture, uniform } from './repaint.js'
import {
  Color,
  CustomBlending,
  DepthTexture,
  DstColorFactor,
  MathUtils,
  Matrix4,
  NodeMaterial,
  OrthographicCamera,
  QuadMesh,
  RenderTarget,
  Vector2,
  Vector3,
  ZeroFactor,
  type Node,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { PICTURE_ONLY } from './passes.js'
import { MaskShader, type MaskArea } from './mask.js'
import { drawDepth } from './offscreen.js'
import { LIGHT } from './theme.js'
import { weaveQuad } from './quads.js'

/**
 * How much a corner darkens for being closed in by what is around it, as a
 * viewer is made with it (`ViewerOptions.occlusion`).
 *
 * Where two faces meet, each shuts out part of what the other could see. There
 * is no light here to be shut out, so this is read straight off the depth of
 * the finished picture and multiplied in.
 *
 * The same three names as {@link ViewerOcclusion}, which is where they are
 * changed afterwards. Each left out is {@link DEFAULT_OCCLUSION}'s.
 */
export interface OcclusionOptions {
  /**
   * Whether it is drawn at all. On by default.
   *
   * `enabled` and not `visible`: it is an effect laid over the picture and not
   * a thing in it, and three says the one word for a pass and a shadow map
   * (`pass.enabled`, `shadowMap.enabled`) and the other for an object. Off, it
   * is not made — the pass and its sheets are let go of — and the two numbers
   * below are kept for when it is turned on again, as three keeps
   * `shadowMap.type` while the map is off.
   *
   * It was `occlusion: null` until 2026-10-27, which said "off" by throwing
   * the settings away.
   */
  enabled?: boolean
  /**
   * How far a fully closed corner drops towards the shadow colour.
   *
   * One is the whole of what the measure found. Past one the corner is carried
   * further than measured, up to {@link MOST_SHADING} — for a page tuning its
   * own palette, since what reads as a corner from the street reads as nothing
   * from above.
   */
  strength?: number
  /**
   * How far around a point counts as closing it in, in metres.
   *
   * Held between two ends, and the page's number is what is used between
   * them. From far off, where this comes to only a few pixels across, the
   * shading fades out — there is nothing to show at that size. From close in
   * it stops growing: the readings that measure a corner are a fixed count,
   * and spread over more than about twenty pixels they draw their own pattern
   * instead of a falloff. So past that zoom the shading
   * is a skirt of about twenty pixels whatever is asked for, which is the
   * right way round — a meeting of two faces does not get wider because the
   * reader stepped nearer.
   */
  radius?: number
}

/**
 * The corner shading of a viewer as it now stands, and the handle on it:
 * `viewer.occlusion.strength = 2`.
 *
 * A part of the viewer that is always there, as three's `renderer.shadowMap`
 * is, rather than a value handed over whole — there is nothing to replace it
 * with, and three settings on one fixed part are three properties (CLAUDE.md,
 * 계약 12, 규칙 3). Writing any of them takes effect on the next frame.
 *
 * What is read back is what was written, not what is drawn: a strength past
 * {@link MOST_SHADING} or a radius under nought is held inside its range where
 * it is used, and the number a page wrote is still the one it reads.
 */
export interface ViewerOcclusion {
  /** Whether it is drawn at all; see {@link OcclusionOptions.enabled}. */
  enabled: boolean
  /** How far a fully closed corner drops; see {@link OcclusionOptions.strength}. */
  strength: number
  /** How far round a point closes it in, in metres; see {@link OcclusionOptions.radius}. */
  radius: number
}

/**
 * The viewer's corner shading as a thing a page holds, telling the viewer as
 * it is written.
 *
 * @internal Made by the viewer, handed out as a {@link ViewerOcclusion}. The
 * one place the three numbers live, so that what a page reads and what the
 * pass is set from cannot part company.
 */
export class OcclusionSettings implements ViewerOcclusion {
  private _enabled: boolean
  private _strength: number
  private _radius: number

  /**
   * @param given what the viewer was made with
   * @param moved told after each change, which brings the pass into line
   */
  constructor(
    given: OcclusionOptions | undefined,
    private readonly moved: () => void,
  ) {
    this._enabled = given?.enabled ?? DEFAULT_OCCLUSION.enabled
    this._strength = given?.strength ?? DEFAULT_OCCLUSION.strength
    this._radius = given?.radius ?? DEFAULT_OCCLUSION.radius
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.moved()
  }

  get strength(): number {
    return this._strength
  }

  set strength(value: number) {
    if (value === this._strength) return
    this._strength = value
    this.moved()
  }

  get radius(): number {
    return this._radius
  }

  set radius(value: number) {
    if (value === this._radius) return
    this._radius = value
    this.moved()
  }
}

// One, which is the whole of what the measure found and no more. It was one,
// then two — the shade the corners are drawn in had been lightened once the
// sun's own shadow was settled (`theme.ts`) and a corner at one was barely
// there — and it is one again, because what sat under it moved twice more the
// same day: the fill went down to its floor (`shading` at one), and the sun
// stopped being driven harder for standing low. Both part a face from its
// neighbour on their own, so the corners no longer need carrying past what was
// measured. By eye, as all three were.
//
// Twenty, and the day it was settled it was thirty, then ten (2026-10-08).
//
// The reach is what the shading is cut off by. It is read off the finished
// picture, so wherever something stands in front, the looks that travel that
// far land on it instead of on what they were measuring, and a reading that
// lands on nothing it can use is counted as nothing being there. The band of
// that loss is as wide as the reach, and at thirty it ran right across a far
// wall along the near building's outline — measured on screen: the shading
// stopped dead at the silhouette and came back whole when the view was tilted,
// so the cut followed the viewpoint and not the building.
//
// It costs at the screen's edge too, though much less than it did: the guard
// band is as wide as the reach, so doubling the reach doubles the depth taken
// past the picture, and where {@link MOST_GUARD} caps that the old fade comes
// back. Twenty is still inside the cap at the zooms a map is read at.
//
// On, since a city with no shade where its walls meet reads as a drawing laid
// flat.
export const DEFAULT_OCCLUSION: Readonly<Required<OcclusionOptions>> = {
  enabled: true,
  strength: 1,
  radius: 20,
}

/**
 * The most shading that can be asked for.
 *
 * One is the whole of what the measure found. Past that the corner is carried
 * further than it was measured — which a page tuning a palette wants, since
 * the measure is conservative at a city's distances and a corner that reads at
 * one in a close view reads as nothing from above. Four, because the factor is
 * held at nought and by four every corner the measure found at all is already
 * flat against the tint; more is a slider with nothing on the end of it.
 */
export const MOST_SHADING = 4

/**
 * How many texels of depth the radius has to span before the shading starts
 * to show, and how many before it shows in full.
 *
 * The shading is measured by looking at the depth a little way off in several
 * directions. Three takes each look from the nearest texel but treats it as
 * taken exactly where it aimed. Ground seen at a slant grows much deeper from
 * one texel to the next, so a look that falls short of the next texel comes
 * back standing above the ground, and the ground shades itself. With a radius
 * of a few texels nearly every look falls short: from far off the whole ground
 * greys evenly, and reads as a duller colour rather than as shading. On flat
 * ground at the steepest tilt, nine tenths of it greys at 4 texels and two
 * thirds is clean by 8.
 *
 * Shading that small would be a few pixels at the foot of a wall anyway, so it
 * fades out rather than being put right, the way windows melt into their wall.
 */
const FADE_FROM = 4
const FADE_TO = 8

/**
 * The furthest a reading is let travel, in pixels of the page.
 *
 * **The radius is a world length and the readings are a fixed count**, so what
 * the two together can describe changes with the zoom. The count is three's own
 * and nothing here sets it: `samples` is 16, which `GTAONode` spends as three
 * directions of `ceil(16 / 3)` steps — eighteen readings, and the six is what
 * matters, since it is one direction's six that have to describe a falloff.
 * Over a reach of twenty pixels they land three apart and come back as that
 * falloff. Over sixty they land ten apart and come back as the pattern itself:
 * three directions read as three streaks, and the per-pixel turn that is meant
 * to break them up turns them into a grain instead. Which is why it looked
 * right on a map and wrong in a street — the same number.
 *
 * Measured on screen at pitch 68 (2026-10-08): radius 20 spans about 20 pixels
 * at z17.3 and reads as shading; the same 20 spans about 58 at z18.5 and draws
 * straight streaks across the picture; radius 4 at z18.5 spans about 12 and is
 * clean again; radius 4 at z20 is back to about 33 and streaks. So the break is
 * somewhere above twenty pixels and below thirty, and this sits under it.
 *
 * No district is named with those, which is unlike the rest of this
 * repository's measurements and is meant. What the spans come to is set by the
 * zoom, the radius and the size of the canvas; where the view happens to be
 * does not enter into it. Where it does come in is whether the streaks are
 * easy to see — close blocks show them and open ground hides them — so
 * somewhere built up is where to stand if this is ever checked again.
 *
 * What it costs is that a corner stops growing once the view is close enough:
 * past that zoom the shading is a skirt of about this many pixels whatever the
 * page asked for. That is the right way round for what this draws — it is the
 * meeting of two faces being shown, and a meeting does not get wider because
 * the reader stepped nearer.
 */
const MOST_REACH = 20

/**
 * How far past the picture the depth is taken, at most, as a share of the
 * shorter side.
 *
 * Far enough and a reading from a pixel at the very edge still lands on depth
 * that was drawn, which is the whole of what the band is for. What it costs is
 * the area, and the area goes as the square: a guard of a tenth on both sides
 * is a sheet a fifth wider and a fifth taller, which is 44% more readings and
 * 44% more of the scene walked for the depth.
 *
 * **A backstop, and no longer the thing that decides.** It was put here when
 * the reach was the page's alone and went to two hundred metres, where the
 * guard would have been wider than the picture. The next day gave the reach
 * its own ceiling in page pixels ({@link MOST_REACH}), and that ceiling is
 * what holds the guard now: at most twenty page pixels of reach, plus two for
 * the slopes, rounded up a rung of {@link GUARD_RUNG} — twenty-four texels,
 * whatever the page asked for and however close the view. A quarter of the
 * shorter side is under that only on a picture shorter than 96 texels, which
 * is a map in a thumbnail. So the cap no longer bites at any size a map is
 * read at, and with it the edge fade it hands over to ({@link spans}) no
 * longer opens either.
 *
 * Kept rather than deleted because it is the one thing standing between a
 * raised {@link MOST_REACH} and a sheet wider than the picture, and because a
 * thumbnail is a real size. Its own measurement is from before that ceiling:
 * at the default reach, 中野 at z20.8 and 68° of tilt, the guard took 146
 * texels of a 668-wide picture. Under the ceiling the same view takes 24.
 */
const MOST_GUARD = 0.25

/**
 * The step the guard is rounded up to, in texels.
 *
 * A changed guard is a changed sheet, and three frees a render target's
 * textures and makes them again whenever its size moves (`RenderTarget.setSize`
 * ends in `dispose`) — the depth, its `DepthTexture` and, through the setSize
 * the measure is given below, the GTAO target with them. Left to the texel,
 * the guard follows the reach, which follows the zoom: dragging across the
 * band where the reach grows from {@link FADE_FROM} to {@link MOST_REACH}
 * steps through every integer in it and rebuilds three large textures at each
 * one.
 *
 * So it is rounded up, which is the safe way to round it — what the guard is
 * for is covering the reach, and a rung over is covered. Eight, because the
 * reach is capped at twenty and two or three rungs across that whole band is
 * as still as this needs to be; the sheet pays at most eight texels a side it
 * did not need, against a picture hundreds wide.
 *
 * The same reasoning as the sun's box, which is cut to a ladder for the same
 * kind of re-cutting (`shadows.ts`, `REACH_RUNG` in `Viewer`). The difference
 * is what it buys: there a changed width redraws every shadow edge, here it
 * is a frame that stalls.
 */
const GUARD_RUNG = 8

/** Scratch for holding the sheet to the world's grid; see `OcclusionPass.render`. */
const WHERE = new Vector3()
const AXIS = new Vector3()

/**
 * Shading of corners, of gaps between buildings and of the foot of a wall —
 * wherever less of the open sky reaches.
 *
 * It is read off the screen rather than from the shapes, because whether two
 * faces meet is a question about what lies beside a point, and a material only
 * ever sees its own. Depth is drawn once on its own, the shading is worked out
 * from it, and the result is multiplied onto the finished picture.
 *
 * Nothing here touches how the scene itself is drawn. The picture keeps the
 * smoothing it was drawn with, which it would lose if the whole scene had to
 * pass through here first.
 */
export class OcclusionPass {
  /**
   * The camera the depth is taken with: the viewer's, opened out by the guard.
   *
   * Ours and not the viewer's, which matters twice. The shading is measured
   * from this depth, so what reads it back — three's reckoning inside the
   * measure, and {@link groundAt} here — has to undo *this* projection and not
   * the picture's. And the layer the marks ride on is switched off on this one,
   * so the viewer's camera is never left holding a setting of ours.
   *
   * A solid thing told not to occlude is not left out by this camera — it is
   * on layer 0 like the rest, so that every other eye still finds it — but by
   * the drawing, which asks each object; see `setOccludes`.
   */
  private readonly wider = new OrthographicCamera()

  /**
   * Depth of its own, drawn apart from the picture.
   *
   * The picture is drawn with several samples to a pixel for smooth edges, and
   * a depth buffer made that way cannot be read a texel at a time — the shader
   * that measures the shading will not even compile against it. So depth is
   * taken again here, plainly, into a target of our own.
   *
   * It is taken, and the shading measured, once to a pixel of the page rather
   * than of the screen, wherever the radius spans enough of them to show in
   * full. On a screen with two pixels to the page's one that is a quarter of
   * the readings, and the shading is soft enough that the picture does not
   * change: at the default view of 中野, with the default radius, the mean
   * difference was one step in 255. What it saves grows as the view closes in,
   * since the radius then spans more pixels and each reading lands further
   * from the last: in a window 668 pixels wide at z20, the graphics card's
   * time a frame went from 19ms to 5.5.
   *
   * That pair was measured before the guard went round the sheet (d117078),
   * so it is the saving of the half-resolution alone; the guard then took
   * part of it back — {@link MOST_GUARD} has how much area it adds — and the
   * two have not been measured together.
   */
  private readonly depthTexture = new DepthTexture(1, 1)
  private readonly depth = new RenderTarget(1, 1, { depthTexture: this.depthTexture })
  private readonly size = new Vector2()
  /** How many texels of guard stand on each side, worked out by {@link reckon}. */
  private guard = 0
  /**
   * Where the picture sits inside the padded sheet: its size as a share of the
   * sheet, and the corner it starts at.
   *
   * Everything that reads the depth or the shading goes through these, since a
   * fragment of the square over the canvas knows its place in the picture and
   * not in the sheet the measure was taken into.
   */
  private readonly shown = uniform(new Vector2(1, 1))
  private readonly inset = uniform(new Vector2())

  private readonly strength = uniform(1)
  /** The strength asked for. What is drawn is this, faded by how few texels the radius spans. */
  private wanted = 1
  /**
   * The reach asked for, in world units. What is measured with is this held
   * under {@link MOST_REACH}, worked out afresh every frame by {@link reckon}.
   */
  private asked = DEFAULT_OCCLUSION.radius
  /** How big the picture is drawn this frame, worked out by {@link reckon}. */
  private wide = 1
  private high = 1
  /**
   * And how big the sheet it sits in is: the picture with {@link guard} round
   * all four sides.
   *
   * Held rather than worked out where it is wanted, because it is wanted in
   * two places a frame apart — {@link reckon} needs it for {@link shown} and
   * {@link inset}, and {@link render} needs it for the target's size and the
   * wider frustum. Written out twice it was the same three fields added the
   * same way in both, so the day the guard grows a term is the day the two
   * part. The same reason `guard` and `wide` are fields and not returns.
   */
  private sheetWide = 1
  private sheetHigh = 1
  /**
   * Half the sheet across and down in the camera's own units, and the nudge
   * that holds it to the world's grid — all four written by {@link reckon} and
   * put on the camera by {@link render}; see the block in `reckon`.
   */
  private halfX = 1
  private halfY = 1
  private nudgeX = 0
  private nudgeY = 0
  private readonly measure: ReturnType<typeof ao>
  /**
   * The measure's answer with the grain taken out of it, and the square that
   * draws it.
   *
   * **What the grain is.** The measure walks a few directions out from each
   * pixel and asks how far it gets before something blocks it, and it turns
   * those directions by a different angle at every pixel so that three of them
   * do not read as three streaks. So each pixel asks a different question and
   * gets a different answer, and on open ground with blocks standing round it
   * — where one direction is stopped and the next is not — the answers are far
   * enough apart to read as dirt. Settled on screen (2026-10-09): the guessed
   * normals come out clean and the measure's own answer does not, so this is
   * the sampling and not what it is told about the surface.
   *
   * **Why a filter and not more samples.** More samples is the only thing that
   * takes the spread away rather than spreading it further, and it is paid for
   * at every pixel of the screen: measured by eye, sixty-four of them still
   * carried it. Fewer directions or a shorter reach buy it back by measuring
   * less of what was asked for.
   *
   * **Why this filter.** A plain mean over the neighbours was tried on
   * 2026-10-08 and taken out the same day: it mixed across the edge of every
   * surface, so a grain that read as texture became blotches ten pixels wide
   * that read as something laid over the city. This one weighs each neighbour
   * by how near it is in depth and in facing as well as in place, so it mixes
   * within a surface and stops at the edge of one. What it does not do is make
   * a wide flat surface exact — the spread inside one is still moved rather
   * than removed, and some of it is still there to be seen as unevenness.
   *
   * **Why a pass of its own.** `DenoiseNode` reads its neighbours at `uv()` —
   * the place the thing being drawn sits — and the square below is drawn over
   * the canvas while the measure lives in a sheet with a guard round it. Drawn
   * into a target the size of that sheet, the two agree on where a pixel is.
   */
  private readonly clean = new RenderTarget(1, 1, { depthBuffer: false })
  private readonly filter: ReturnType<typeof denoise>
  private readonly filtering: QuadMesh

  private readonly multiply: QuadMesh
  /**
   * The shape the scene is cut to, read here as well as by the layers.
   *
   * This draws over the finished picture instead of through a material, so
   * it never goes by way of the hem the layers' colours are taken through. Its
   * own is worked out here from the same uniforms.
   */
  private readonly mask = new MaskShader()
  /**
   * Screen back to world, held as the two steps rather than as one matrix:
   * the projection undone, and then the camera's place.
   *
   * Undoing the projection is where the two backends part — which way up the
   * screen is counted, and how far what is written into the depth buffer
   * reaches — so that step is left to three's own reader below rather than
   * folded into a matrix here, where only one of the two could be right.
   */
  private readonly undone = uniform(new Matrix4())
  /** The camera's own matrix, for turning what the depth buffer saw back into the world. */
  private readonly toWorld = uniform(new Matrix4())
  /**
   * How much of the screen the radius spans, across and down.
   *
   * What it is for is the screen's own edge. The shading is measured by
   * looking a little way off in several directions, and near the border some
   * of those looks land outside the picture, where there is no depth to read.
   * A look that reads nothing is not a look that found nothing — the missing
   * ones are simply left out of the reckoning, and what is left reads as a
   * place more closed in than it is. So the ground greys along the border, and
   * worst along the top, where a tilted view is looking most nearly along the
   * ground and the looks travel furthest.
   *
   * Measured on this page: at 70° of tilt the top of an empty white sheet came
   * out 238 against the 255 it is, fading clean over some sixty pixels.
   *
   * **Answered now (2026-10-08) by taking the depth wider than the picture**
   * — see {@link MOST_GUARD}. What is left here is the reach the guard's
   * ceiling did not cover, and since the reach gained a ceiling of its own the
   * next day ({@link MOST_REACH}) the guard always covers it: this is nought
   * at every setting, at every zoom, on any picture bigger than a thumbnail.
   * Kept as the other side of that backstop — raise the reach's ceiling and
   * the fade is what stands between the border and a grey band. Held a hair
   * over nought rather than at it, since a span of exactly nought is a
   * `smoothstep` with its two edges in one place.
   */
  private readonly spans = uniform(new Vector2())

  /**
   * The colour a closed corner is taken towards.
   *
   * Its own and no longer the light's. The light is three's now and has no
   * shade colour in it — what a face turned from the sun is left with is the
   * sky — but this is not a light at all: it is read off the depth of the
   * finished picture and multiplied over it, which is a thing done to a
   * drawing. So it keeps a colour of its own, and the palette's `shadow` is
   * what the viewer hands it.
   *
   * Standing at the light set's own until then rather than at a hex written out
   * again here. It is never drawn: the viewer makes this pass and shades it in
   * the same breath (`syncOcclusion`), so nothing reads the value below.
   */
  private readonly tint = uniform(new Color(LIGHT.shadow))

  // No camera comes in any more: the one the depth is taken with is this
  // pass's own (`wider`), and the viewer's is handed over a frame at a time
  constructor() {
    // Three works out which way each face points from the depth around it, so
    // no second buffer of normals is needed — the ground carries none.
    const noNormals = null as unknown as Parameters<typeof ao>[1]
    this.measure = ao(texture(this.depthTexture), noNormals, this.wider)

    /*
     * The filter and the square that draws it. The normals are left for it to
     * work out of the depth, which is what the measure does beside it and what
     * was looked at on screen and found clean.
     */
    this.filter = denoise(this.measure.getTextureNode(), texture(this.depthTexture), noNormals, this.wider)
    const cleaning = new NodeMaterial()
    cleaning.depthTest = false
    cleaning.depthWrite = false
    cleaning.colorNode = this.filter as unknown as Node<'vec4'>
    this.filtering = new QuadMesh(cleaning)

    /*
     * Three sizes the shading from the canvas each time it measures, scaled by
     * a factor of its own. It is sized from our depth instead, which is already
     * at the size chosen, and the factor left at 1: under 1, three takes the
     * nearest of four depth texels at each point, which suits depth twice the
     * size of the shading but at the same size draws a light seam along two
     * sides of every building.
     */
    const setSize = this.measure.setSize.bind(this.measure)
    this.measure.setSize = () => setSize(this.depth.width, this.depth.height)

    const paint = new NodeMaterial()
    // Multiply: what is already on screen is kept and only made darker.
    paint.blending = CustomBlending
    paint.blendSrc = DstColorFactor
    paint.blendDst = ZeroFactor
    paint.depthTest = false
    paint.depthWrite = false
    /*
     * One texel of the filtered answer, not of the measure's own.
     *
     * The measure is a sample and not a value: three turns the whole set of
     * looks by a per-pixel angle off a 5×5 tile of noise, and jitters where
     * along each look it reads, so neighbouring pixels answer differently on
     * purpose. What that buys is no streaks; what it costs is that two pixels
     * of one surface disagree, which reads as dirt. {@link clean} is where
     * that is settled and why it is settled the way it is.
     *
     * The other two halves of the same answer are not here either. The sheet
     * is held to the world's grid rather than the screen's, so a place keeps
     * its texel and its directions as the view slides past ({@link reckon});
     * without that, a narrow gap blinks between shaded and not from one frame
     * to the next. And a mean over the noise tile — three's own
     * `SSAOBlurShader` is a 5×5 box — was built and taken out again
     * (2026-10-08), because a mean mixes across the edge of every surface and
     * turns a grain into blotches ten pixels wide; the filter in use now weighs
     * its neighbours by depth and facing so that it stops at those edges.
     *
     * (One real bug was found and fixed while that mean was in, and is worth
     * knowing if anything is ever read a texel at a time here again: the
     * square is drawn over the canvas while the measure is taken into a buffer
     * half that across, so a fragment's place falls anywhere inside a texel.
     * Step a whole texel from there and every reading is a blend of two — a
     * six-wide tent, not a five-wide mean — and the tile is no longer covered
     * a whole number of times. The middle has to be pulled to the texel's
     * centre first.)
     */
    const open = texture(this.clean.texture, this.sheetUV()).r
    /*
     * The shading fades out with everything else at the edge. Left at full
     * strength it darkens a hem whose colours have already gone over to the
     * background — shading with nothing standing in it — and then stops dead
     * at the cut, which is the line the hem was there to do away with.
     *
     * Never narrower than the reach it shades over: that is the width a hard
     * edge crawls across pixel by pixel as the view moves.
     */
    const radius = this.measure.radius as unknown as Node<'float'>
    const inside = float(1).sub(this.mask.fadeAt(this.groundAt(), radius))
    // And in from all four sides of the picture by the same reach; see `spans`
    const across = smoothstep(float(0), this.spans.x, screenUV.x).mul(
      smoothstep(float(0), this.spans.x, float(1).sub(screenUV.x)),
    )
    const down = smoothstep(float(0), this.spans.y, screenUV.y).mul(
      smoothstep(float(0), this.spans.y, float(1).sub(screenUV.y)),
    )
    const held = inside.mul(across).mul(down)
    // Multiplied over the picture as it stands, in the linear buffer three
    // draws the frame through — so this is a factor and not a colour, and the
    // tone curve has nothing to undo here.
    // Held at nought below, because the strength is allowed past one: over one
    // this is no longer a mix but a reach past what the measure found, and a
    // corner it found closed would otherwise come out a negative factor and
    // draw the tint brighter than the tint.
    const closed = mix(float(1), open, this.strength.mul(held)).max(0)
    paint.colorNode = vec3(mix(this.tint, vec3(1, 1, 1), closed)) as Node<'vec3'>
    this.multiply = new QuadMesh(paint)
  }

  /**
   * This fragment's place in the padded sheet rather than in the picture.
   *
   * The sheet is the picture with the guard round it, so a fragment of the
   * screen sits that much in from its edge; see {@link shown} and
   * {@link inset}. Everything this pass reads back — the measure's answer and
   * the depth under {@link groundAt} — is in the sheet, so everything reads
   * through here.
   */
  private sheetUV(): Node<'vec2'> {
    return screenUV.mul(this.shown).add(this.inset) as Node<'vec2'>
  }

  /**
   * Where on the ground each pixel of the finished picture looks.
   *
   * There is no place to read here: this draws a square over the screen, and
   * a fragment of that square is a pixel and not a point of the scene. So the
   * point is worked back out of the depth already taken — the one the shading
   * itself is measured from, so the two cannot disagree about what is where.
   */
  private groundAt(): Node<'vec2'> {
    const at = this.sheetUV()
    const depth = texture(this.depthTexture, at).r
    // Read back through three's own, which knows that `screenUV` counts down
    // from the top of the screen where the projection counts up from the
    // bottom, and what a depth of its buffer comes to on the backend in hand.
    const seen = getViewPosition(at, depth, this.undone)
    const world = this.toWorld.mul(vec4(seen, 1)) as Node<'vec4'>
    return world.xz.div(world.w) as Node<'vec2'>
  }

  /** The shape to cut to, told to this the way a layer is told. */
  setMask(area: MaskArea | null): void {
    this.mask.set(area)
  }

  /** The colour a corner darkens towards: the palette's shade. */
  shade(colour: string): void {
    this.tint.value.set(colour)
  }

  /** Follows the settings. Radius is in world units, as the scene measures. */
  set(radius: number, strength: number): void {
    this.asked = Math.max(0, radius)
    // Written now as well as in `reckon`, so that anything reading it before
    // the first frame finds the number the page gave rather than a default
    this.reach(this.asked)
    // Past one is allowed, and is a reach rather than a mix: it carries a
    // corner further than the measure found it closed. Held at a ceiling all
    // the same, since the factor it makes is clamped at nought and anything
    // over this only flattens more of the picture into the tint.
    this.wanted = Math.max(0, Math.min(MOST_SHADING, strength))
  }

  /**
   * Works out how much of this frame's shading would show, and how finely to
   * take the depth for it.
   *
   * Apart from the drawing so that the frame can ask before it splits itself
   * in two. There is a wide band — a view over relief with nothing standing
   * on it, at a zoom where the radius spans under {@link FADE_FROM} texels —
   * where something stands, so the viewer took the two-pass path, and yet
   * this pass would give up at its first line and draw nothing. The frame
   * paid a second whole-scene walk for a multiplication that never happened.
   * Asked first, it pays for one.
   */
  reckon(renderer: WebGPURenderer, camera: OrthographicCamera): void {
    renderer.getDrawingBufferSize(this.size)
    /*
     * The reach, held under {@link MOST_REACH} pixels of the screen.
     *
     * The page says a world length, which is what a corner is: two walls meet
     * over so many metres whatever the view. But the readings that measure it
     * are a fixed count spread over whatever that length comes to on screen,
     * and past a certain spread they stop describing a falloff — see
     * {@link MOST_REACH}. So the length is what the page asked for until the
     * view is close enough that it would outrun its own readings, and the
     * screen's share from there on.
     */
    // A pixel of the page where the radius spans enough of them to show in
    // full, and never finer than the screen's own, as on a page zoomed out on
    // a plain screen. Where it spans fewer, the screen's pixels, so the shading
    // fades at the same zoom it always did.
    const page = Math.min(1, 1 / renderer.getPixelRatio())
    /*
     * The cap, counted in pixels of the page.
     *
     * In the page's and not the drawing buffer's, because the sheet the
     * readings are actually spread over is a page pixel wide wherever the cap
     * can bite (`scale` below). Counted in the buffer's instead, a screen with
     * two pixels to the page's one halves what the cap allows and one with a
     * single pixel doubles it — the same page at the same zoom would read as
     * shading on a laptop and draw streaks on the monitor beside it.
     *
     * Where the sheet is at the screen's own pixels the cap still holds: that
     * branch is only taken when the radius spans fewer than {@link FADE_TO}
     * page pixels, which is fewer than `FADE_TO × ratio` of the screen's, and
     * ratio is held at two.
     */
    const perPixel = (camera.right - camera.left) / camera.zoom / Math.max(1, this.size.x * page)
    this.reach(Math.min(this.asked, MOST_REACH * perPixel))
    // How much of the view's width the radius spans. The view is orthographic,
    // so it spans the same number of texels anywhere on screen.
    const across = (this.measure.radius.value * camera.zoom) / (camera.right - camera.left)
    const scale = across * this.size.x * page >= FADE_TO ? page : 1
    this.wide = Math.max(1, Math.round(this.size.x * scale))
    this.high = Math.max(1, Math.round(this.size.y * scale))

    const texels = across * this.wide
    this.strength.value = this.wanted * MathUtils.smoothstep(texels, FADE_FROM, FADE_TO)

    /*
     * The guard: the reach, and two more for the slopes.
     *
     * The reach is what a reading travels, so that much on each side is what it
     * takes for a pixel at the very edge to find depth under every one of its
     * looks. The two are for the measure working out which way a face points by
     * differencing the depth two texels off — without them the outermost row
     * would be reading the guard's own edge for that.
     */
    const down = (this.measure.radius.value * camera.zoom) / (camera.top - camera.bottom)
    const deep = down * this.high
    const need = Math.ceil(Math.max(texels, deep)) + 2
    this.guard = Math.min(
      Math.ceil(need / GUARD_RUNG) * GUARD_RUNG,
      Math.round(MOST_GUARD * Math.min(this.wide, this.high)),
    )
    this.sheetWide = this.wide + 2 * this.guard
    this.sheetHigh = this.high + 2 * this.guard
    this.shown.value.set(this.wide / this.sheetWide, this.high / this.sheetHigh)

    /*
     * And the sheet held to the world's own grid rather than to the screen's.
     *
     * The measure turns its directions by an angle read off the pixel it is
     * at, so which directions a place is asked about is decided by where that
     * place lands in the sheet. Left to follow the screen, a view that moves —
     * a camera following something, a drag — hands the same wall a different
     * set of directions every frame, and where the answer is finely balanced
     * it comes back differently each time: a narrow gap between two blocks
     * blinks between shaded and not. Wide surfaces hold still through the same
     * movement, since there the answer is nowhere near the balance.
     *
     * So the frustum is nudged by up to half a texel each way ({@link halfX}
     * and {@link nudgeX}, which {@link render} puts on the camera), to put the
     * sheet's grid on the same world lines it was on last frame. A place then
     * keeps its texel while the view slides past, and keeps its directions
     * with it. The nudge comes straight back off in {@link inset} below, so
     * nothing moves on screen.
     *
     * The same answer `shadows.ts` gives to its own grid, and for the same
     * reason: a grid that follows the screen re-cuts everything standing on it
     * every frame. It works here because this camera is orthographic and the
     * map does not roll — the sheet's axes are the same world directions from
     * one frame to the next, so there is a grid to be held to.
     */
    this.halfX = ((camera.right - camera.left) / 2) * (this.sheetWide / this.wide)
    this.halfY = ((camera.top - camera.bottom) / 2) * (this.sheetHigh / this.high)
    const perX = (2 * this.halfX) / camera.zoom / this.sheetWide
    const perY = (2 * this.halfY) / camera.zoom / this.sheetHigh
    WHERE.setFromMatrixPosition(camera.matrixWorld)
    AXIS.setFromMatrixColumn(camera.matrixWorld, 0)
    const alongX = WHERE.dot(AXIS)
    AXIS.setFromMatrixColumn(camera.matrixWorld, 1)
    const alongY = WHERE.dot(AXIS)
    this.nudgeX = perX > 0 ? Math.round(alongX / perX) * perX - alongX : 0
    this.nudgeY = perY > 0 ? Math.round(alongY / perY) * perY - alongY : 0

    // The guard, and the nudge taken back off: the sheet moved by that much in
    // the world, so a screen pixel sits that much the other way inside it
    this.inset.value.set(
      this.guard / this.sheetWide - (perX > 0 ? this.nudgeX / perX / this.sheetWide : 0),
      this.guard / this.sheetHigh + (perY > 0 ? this.nudgeY / perY / this.sheetHigh : 0),
    )

    // And what the guard did not reach, which the fade still has to cover. Down
    // is worked out on its own rather than from the aspect: an orthographic
    // camera's two halves are set apart from the canvas, and one of them is
    // what the other is not
    this.spans.value.set(
      Math.max(1e-6, (texels - this.guard) / this.wide),
      Math.max(1e-6, (deep - this.guard) / this.high),
    )
  }

  /**
   * Writes a reach into the measure, in world units.
   *
   * Two numbers and not one: `thickness` is how far apart two points may sit
   * along the view and still count as one surface, and it is held equal to the
   * reach because a reading that travelled further than the thickness is a
   * reading the measure would throw away. Three's own thickness is 1, which
   * suits a scene a few units across; ours is a city.
   */
  private reach(radius: number): void {
    this.measure.radius.value = radius
    this.measure.thickness.value = radius
  }

  /** Whether anything of it would show, once {@link reckon} has been asked. */
  get shows(): boolean {
    return this.strength.value > 0
  }

  /**
   * Draws the shading over what the renderer has just drawn.
   *
   * Called after the scene, with the canvas still holding it: depth is taken
   * again on its own, and the picture is multiplied by the shading in place.
   * Only where {@link reckon} said it would show.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: OrthographicCamera): void {
    if (!this.shows) return
    // Both written by `reckon`, which the viewer calls first in the same
    // `draw` — and which is also where `shows` above gets its answer
    const { sheetWide: width, sheetHigh: height } = this

    if (this.depth.width !== width || this.depth.height !== height) this.depth.setSize(width, height)

    /*
     * The viewer's camera, opened out by the guard.
     *
     * Stood in the same place and looking the same way — the transform is
     * copied whole — and only the box it sees is grown, by the share of the
     * sheet the guard takes on each side. Three works an orthographic frustum
     * out around the middle of `left`/`right`, so growing the two halves about
     * that middle is the one thing to do and the two sides need not be equal.
     *
     * The marks ride on a layer of their own and are not depth; switched off
     * here rather than on the viewer's camera, which this no longer touches.
     * What a page said does not occlude is still on layer 0 and is left out by
     * `drawDepth` instead, which asks each object (`setOccludes`).
     */
    this.wider.matrixWorld.copy(camera.matrixWorld)
    this.wider.matrixWorldInverse.copy(camera.matrixWorldInverse)
    this.wider.matrixWorldAutoUpdate = false
    const midX = (camera.right + camera.left) / 2
    const midY = (camera.top + camera.bottom) / 2
    // All four worked out by `reckon`, the nudge that holds the sheet to the
    // world's grid included
    this.wider.left = midX - this.halfX + this.nudgeX * camera.zoom
    this.wider.right = midX + this.halfX + this.nudgeX * camera.zoom
    this.wider.top = midY + this.halfY + this.nudgeY * camera.zoom
    this.wider.bottom = midY - this.halfY + this.nudgeY * camera.zoom
    this.wider.zoom = camera.zoom
    this.wider.near = camera.near
    this.wider.far = camera.far
    this.wider.updateProjectionMatrix()
    this.wider.layers.mask = camera.layers.mask
    this.wider.layers.disable(PICTURE_ONLY)

    const { autoClear } = renderer
    drawDepth(renderer, scene, this.wider, this.depth)

    /*
     * Read back out of every pixel's depth above — this camera's projection,
     * since this camera is what drew it.
     *
     * Copied after the draw and not before. A camera three has never drawn
     * with is still on the WebGL convention it was made with, and three moves
     * it to the backend's own the first time it renders with it, rebuilding
     * the projection as it goes (`Renderer._updateCamera`). Taken before
     * that, the first frame of a newly made pass would hold the inverse of a
     * clip space running −1..1 beside a depth drawn 0..1, and `groundAt`
     * would hand the mask's hem a world place that is nowhere.
     */
    this.undone.value.copy(this.wider.projectionMatrixInverse)
    this.toWorld.value.copy(this.wider.matrixWorld)

    // The filter, into a target the size of the sheet so that its neighbours
    // land where the measure's do. The measure runs inside it, as it would
    // inside the multiply below.
    if (this.clean.width !== width || this.clean.height !== height) this.clean.setSize(width, height)
    const to = renderer.getRenderTarget()
    renderer.setRenderTarget(this.clean)
    renderer.autoClear = true
    this.filtering.render(renderer)
    renderer.setRenderTarget(to)

    // The shading measures itself as this draws: the node asks for a pass of
    // its own before the one it takes part in.
    renderer.autoClear = false
    try {
      this.multiply.render(renderer)
    } finally {
      // Put back because the renderer is the viewer's: left not clearing, every
      // later frame would paint over whatever the last one left on the canvas.
      // The camera's layers were put back here too until the pass was given a
      // camera of its own (`wider`), which nothing else reads.
      renderer.autoClear = autoClear
    }
  }

  /**
   * Weaves the pass's own shaders off the frame, before it first draws.
   *
   * The filter and the multiply are quads of their own, and three made their
   * pipelines on the spot the first time they were drawn. On a card that had
   * never made them that was a stop in the very first frame, with the blur's
   * and the canvas's own: 1.35 s on the public simple-map opened with the
   * shader caches emptied (2026-11-17); see `weaveStandIns` in `offscreen.ts`
   * for the rest of that measurement.
   *
   * The depth the shading reads is made by its own target first, as a frame
   * would make it. A depth texture a material takes up before its target has
   * drawn into it is destroyed and made again under that material (CLAUDE.md,
   * 주의할 점, "깊이 텍스처는 처음 접근한 쪽이 생성하고"). Each quad is woven with
   * the target it draws into set, which is also what has that target make its
   * own texture before the next quad reads it.
   */
  async weave(renderer: WebGPURenderer): Promise<void> {
    renderer.initRenderTarget(this.depth)
    await Promise.all([
      weaveQuad(renderer, this.filtering, this.clean),
      // The multiply draws into whatever the frame is drawing into: the canvas
      weaveQuad(renderer, this.multiply, null),
    ])
  }

  dispose(): void {
    this.depth.dispose()
    this.clean.dispose()
    this.filtering.dispose()
    this.measure.dispose()
    this.multiply.dispose()
  }
}
