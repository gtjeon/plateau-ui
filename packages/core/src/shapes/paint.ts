import {
  Fn,
  attribute,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  cross,
  dot,
  float,
  fwidth,
  min,
  mix,
  modelViewMatrix,
  positionLocal,
  screenDPR,
  smoothstep,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'
import { uniform } from '../repaint.js'
import { CLASSIFY_COUNT, CLASSIFY_LAND } from '../classify.js'
import { MITER_LIMIT } from '../polylines.js'
import type { Paints } from '../paints.js'
import { VOLUME_CLIMB, VOLUME_OFFSET } from './volume.js'
import { DISC_LINE, DISC_SPOT } from './disc.js'
import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  DecrementWrapStencilOp,
  DoubleSide,
  EqualStencilFunc,
  FrontSide,
  IncrementWrapStencilOp,
  KeepStencilOp,
  Mesh,
  MeshBasicNodeMaterial,
  type NodeMaterial,
  NotEqualStencilFunc,
  ZeroStencilOp,
  type BufferGeometry,
  type ColorRepresentation,
  type Node,
} from 'three/webgpu'
import { blendOverOpaque, pressToLand, readDepth, type Draws } from '../behind.js'
import { MaskShader, type MaskArea } from '../mask.js'
import { PICTURE_ONLY } from '../passes.js'
import { answersNoRays, notPicked } from '../pick.js'
import { facesUp, glows as carriesItsOwnLight, keepsItsColor, solid, type SolidMaterial } from '../lit.js'
import { asReflectance } from '../tone.js'
import type { Underground } from '../underground.js'

/**
 * How far under the eye the boxes' ceiling is held, in metres.
 *
 * Enough that a wheel turn cannot put the eye through it between one frame
 * and the next, and little enough that the ground right under a reader
 * standing low is still inside the box.
 */
const CLEAR_OF_THE_EYE = 2

/**
 * How far under the land the boxes' floor is held, in metres.
 *
 * Far enough that nothing lying on the ground is under it — a shape draped on
 * a slope, a tile of heights that lands a moment later, a hillside that five
 * readings missed — and no further. The floor follows the land rather than
 * standing at a height of its own: fixed
 * at fifty under the sea it was 550m below the ground in 御殿場, and at a
 * tilt that put the bottom of the box outside what the camera keeps depth
 * for. The box was then cut open down there, and a box cut open counts wrong
 * — the fill vanished, and the count left over ran into the next shape, which
 * read on screen as one zone's colour spilling into another's as the view
 * turned (measured).
 *
 * The other way round is the same trouble: a floor that stood at 500m
 * everywhere would be that far under the sea-level ground of 東京. Which is
 * also why the land it follows is the lowest ground under the shapes
 * themselves and not the reading under the middle of the view — a page may
 * well be looking at a hillside and painting the valley.
 */
const UNDER_THE_LAND = 300

/**
 * The paint every shape a page puts on the land is drawn with: the lines, the
 * areas and the circles alike.
 *
 * One of these to a {@link ShapeLayer} rather than one to each kind. Three
 * weaves a shader for each material at about a second apiece, so a width, a
 * colour, a radius and how much of an area shows must not want one — all of
 * them ride on the corners, and every shape a page paints shares these however
 * many it paints. What a material is kept by is only what cannot be said on a
 * corner: which half of the depth it draws, whether the shade falls on it, and
 * whether it is a line, an area or a circle.
 *
 * So changing any of what rides on the corners — a colour, a width, whether an
 * area is filled — weaves nothing: the shape is cut again with the new numbers
 * on it. Only `glows`, `behind`, `billboard` and `paints` pick another material,
 * and those are made the first time anything asks and kept.
 *
 * Every kind shares one {@link MaskShader}, which is what makes the shape the
 * viewer is cut to one thing written once: `setMask` writes a set of uniforms,
 * and every material here reads those same uniforms as it draws. One apiece
 * would be one set of uniforms apiece, all holding the same numbers, and a
 * mask moved would have to reach each of them.
 *
 * Elsewhere in this library sharing a mask also saves a shader — the passes
 * that draw the scene again under stand-ins tell two stand-ins apart by the
 * nodes they carry — but not here: everything these draw is `PICTURE_ONLY`, so
 * none of it reaches the depth passes at all. The look under the pointer does
 * draw it, and cuts it there by the material's own cut where the material
 * moves its corners and by a mask of its own where it does not (`pick.ts`).
 */
export class ShapeMaterials {
  private readonly kept = new Map<string, NodeMaterial>()
  /** Read by the paint as it draws; written when the viewer's shape or colours change. */
  private readonly mask = new MaskShader()
  /** What a faint shape goes over to: whatever the scene is backed with. */
  private readonly into = uniform(new Color(0xffffff))
  /**
   * How much of a shape drawn through what hides it shows, 0 to 1.
   *
   * A uniform rather than a number woven in, so that a page turning it on a
   * live map moves one value and weaves no shader; see {@link setDimmed}.
   */
  private readonly dimmed = uniform(0)
  /** Where the floor of every box stands, in metres above the sea; see {@link standBetween}. */
  private readonly floor = uniform(-UNDER_THE_LAND)
  /** Where the ceiling stands, which is always under the eye; see {@link standBetween}. */
  private readonly ceiling = uniform(0)
  /**
   * The viewer's uncut land, for the painting pass to find where its paint
   * lands; see {@link classify}. Nought until the group is on a viewer.
   */
  private land: Underground | null = null

  /** @param dimmed How much of a shape drawn through what hides it shows, 0 to 1. */
  constructor(dimmed: number) {
    this.dimmed.value = dimmed
  }

  /** How much of a shape drawn through what hides it shows, 0 to 1, held there already. */
  setDimmed(dimmed: number): void {
    this.dimmed.value = dimmed
  }

  /**
   * The paint for a line: a strip of quads pushed out sideways on the screen.
   *
   * `facing` is a line through the air, whose strip is turned to face the eye;
   * see {@link Painter.sideways}.
   */
  line(draws: Draws, glows: boolean, facing: boolean): SolidMaterial {
    return this.made(facing ? 'facing' : 'line', draws, glows, (material) => {
      // A mitre run out at a sharp corner turns its quad inside out
      material.side = DoubleSide

      const perPixel = perPixelHere()
      material.positionNode = facing ? this.sideways(perPixel) : this.flat(perPixel)

      // Faint by its colour, not by its alpha. Its alpha has another job —
      // see below — and the two would multiply: a dimmed line would lose its
      // edge as well as its colour, and where it ran behind a building the
      // edge would be all that was left of it.
      //
      // rgb and how much of the line goes on, four a corner as an area's are
      // (`ribbon.ts`). The page's share is the fourth, and it does multiply
      // the edge below: a line asked for at half is half as strong across its
      // whole width, edge and all
      const paint = attribute('paint', 'vec4')
      material.colorNode = this.tinted(paint.xyz as Node<'vec3'>, draws)

      // How much of this pixel the line covers, worked out rather than sampled.
      //
      // The strip is built a pixel wider than the line each side (`ribbon.ts`),
      // and the corner carries how far off the middle it is and where the line
      // ends. `fwidth` says how much that first number moves from one pixel to
      // the next, which is a pixel's worth of it in whatever units it happens
      // to be in — so the fade is one pixel wide at every zoom and every tilt
      // without anything being told the zoom or the tilt.
      //
      // Read off the signed distance rather than the folded one: folding puts
      // a crease down the middle of the line, and a derivative taken across a
      // crease is not the width of a pixel.
      const edge = attribute('edge', 'vec2')
      const pace = fwidth(edge.x).max(float(1e-5))
      material.opacityNode = smoothstep(edge.y.sub(pace), edge.y.add(pace), edge.x.abs())
        .oneMinus()
        .mul(paint.w) as Node<'float'>

      // In the opaque half, the way the fill and the water's bank are; see
      // {@link blendOverOpaque}
      blendOverOpaque(material)

      // Pressed toward the camera, as the fill is. A line lying exactly on the
      // land is at the land's own depth and which of the two a pixel keeps is
      // a toss, so it has to win those ties — and this is the way to win them
      // that leaves the line where the page put it. It used to be stood a
      // metre over the land instead, which won the same ties by moving the
      // line, and a line a metre off the ground is a line a metre from where
      // it was said to be.
      //
      // The press was tried once and dropped, because pressed hard enough to
      // beat the land it beat the buildings too and ran across their faces.
      // What it is now is not that press: it is the one the fill uses, a few
      // pixels of depth and a slope term, set to clear no more than two
      // guesses at one hillside can differ by. A wall stands metres in front
      // of the line behind it, which is hundreds of times that.
      pressToLand(material)
    })
  }

  /**
   * The push for a line lying on the land: flat, along the ground.
   *
   * The corner carries which way is sideways and how far, in pixels, worked
   * out where the strip was cut. So a line lying on the land narrows as the
   * land turns away from the eye, which is what paint does.
   */
  private flat(perPixel: Node<'float'>): Node<'vec3'> {
    const offset = attribute('offset', 'vec2')
    return positionLocal.add(vec3(offset.x, 0, offset.y).mul(perPixel)) as Node<'vec3'>
  }

  /**
   * The push for a line through the air: sideways on the screen, whichever way
   * the line runs and however the map is turned.
   *
   * A flat push is a strip lying in the ground plane, and a strip in the ground
   * plane is seen edge-on wherever the line runs across a tilted view. On the
   * land that is right — paint narrows with the road it is painted on. In the
   * air there is no road, and at a steep tilt half of a line would simply fade
   * out: measured on the arc of a sun, the far half went under a pixel wide
   * and the coverage it is drawn with faded it to nothing.
   *
   * The vector wanted is perpendicular to the line and lying in the plane of
   * the screen, and that is the cross product of the segment with the way the
   * eye looks. Read from the camera afresh every frame, since the whole point
   * is that it follows the camera — which is also why the corners carry their
   * neighbours rather than an answer: an answer cut into the strip would be
   * the answer for wherever the map happened to be pointing when it was cut.
   *
   * The mitre is the same one the ground's corners use, halved between the two
   * segments and run out no further than {@link MITER_LIMIT} — worked out here
   * rather than there because it is a mitre on the screen, and the screen
   * turns. Doubling straight back on itself there is no angle to halve, and
   * the incoming side stands.
   *
   * Either cross product can come out at nothing — a corner written twice
   * over, or a segment running exactly the way the eye looks, which a line
   * sweeping round the sky passes through as the map turns. Normalised, that
   * is a corner at no number at all, and the length test below cannot catch
   * it because nothing compares less than anything. So each side falls back
   * to the other, and where both vanish the strip keeps its corner where the
   * line is rather than losing it: the CPU half of this mitre bails the same
   * way at the same smallness.
   */
  private sideways(perPixel: Node<'float'>): Node<'vec3'> {
    // The camera's own +Z in the world, which is the way back towards the eye
    const toEye = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz
    const prior = attribute('prior', 'vec3')
    const after = attribute('after', 'vec3')
    const acrossIn = cross(positionLocal.sub(prior), toEye).toVar()
    const acrossOut = cross(after.sub(positionLocal), toEye).toVar()
    const gone = float(1e-9)
    // Where neither segment says anything, any perpendicular to the eye will
    // do; the eye never looks along this one, since the view never lies flat
    const spare = cross(vec3(0, 0, 1), toEye).toVar()
    // Whichever of the two says anything, which is what the incoming side is
    // either way: where it says something itself, it is the one taken here
    const either = acrossIn.length().greaterThan(gone).select(acrossIn, acrossOut).toVar()
    const sideIn = either.length().greaterThan(gone).select(either, spare).normalize().toVar()
    const sideOut = acrossOut.length().greaterThan(gone).select(acrossOut, sideIn).normalize()
    const halved = sideIn.add(sideOut).toVar()
    const span = halved.length().toVar()
    const miter = span.lessThan(float(1e-6)).select(sideIn, halved.div(span)).toVar()
    const stretch = float(1)
      .div(dot(miter, sideIn).max(float(1 / MITER_LIMIT)))
      .min(float(MITER_LIMIT))
    const edge = attribute('edge', 'vec2')
    return positionLocal.add(miter.mul(edge.x.mul(stretch).mul(perPixel))) as Node<'vec3'>
  }

  /**
   * The paint for a filled area, which is see-through where a line is not.
   *
   * An area covers ground rather than marking a run across it, and ground
   * covered opaquely is ground a reader can no longer use — the streets under a
   * coloured plot are how they know where the plot is. So how much of it shows
   * is a number the page gives, carried on the corner beside the colour.
   *
   * Blended in the opaque pass, the way the water's bank is. Left to the
   * transparent one it would be drawn after everything opaque, and since
   * nothing laid on the land writes depth that means over the lines drawn on
   * top of it — an area would cover its own outline. Blending here keeps the
   * order where the rest of this map keeps it: in the scene.
   *
   * Only the colour is blended; the alpha underneath is left, so an area laid
   * over the city does not eat the hole the backdrop is read through.
   */
  fill(draws: Draws, glows: boolean): SolidMaterial {
    return this.made('fill', draws, glows, (material) => {
      // Which way a triangle faces is not something the page said and not
      // something the survey said: it falls out of how the loop happened to be
      // wound and of which way the land tipped the triangle as it was laid on
      // it. A flat plot has no back to see, so both sides are drawn.
      material.side = DoubleSide
      blendOverOpaque(material)

      // rgb and how much of it goes on, all four on the corner — the same four
      // a line's `paint` carries since lines took an opacity (2026-11-05)
      const paint = attribute('paint', 'vec4')
      material.colorNode = this.tinted(paint.xyz as Node<'vec3'>, draws)
      material.opacityNode = paint.w as Node<'float'>

      // An area is wide, and a wide shape laid on the land parts from the
      // surface by more than a line does: both are guesses at one hillside, and
      // `drape.ts` only promises to keep this one within half a metre. Pressed
      // rather than lifted, so it is drawn exactly where it lies and only wins
      // the ties; see `pressToLand`.
      pressToLand(material)
    })
  }

  /**
   * The paint for a circle: a fan pushed out round its point, filled and ringed
   * in the one pass.
   *
   * The corners are put where they go outright (`vertexNode`) rather than moved
   * about the world (`positionNode`), the way a mark's card is, and for a reason
   * a mark does not have: everything the light and the cut read of a fragment
   * is then read at the point. Three works the place a fragment is lit at, the
   * place the sun's map is asked about and the place the mask is judged at from
   * `positionLocal`, which this leaves standing on the point — so a circle takes
   * the light the land under its point takes, all of it alike, and is cut by
   * the mask whole or not at all. A circle is a mark on one place. Moved about
   * the world, a circle turned to the eye would stand half in the air over its
   * point and half in the ground in front of it, and be lit, shaded and cut as
   * those places are.
   *
   * The passes that draw the scene again under stand-ins carry `vertexNode`
   * across (`offscreen.ts`, `pick.ts`), so the pointer finds the fan where it
   * is drawn.
   *
   * The edge is worked out as a line's is (`thinLine.ts`): how much of a pixel
   * the inside covers and how much the ring does, from how far the pixel is
   * off the point, with the ring laid over the inside. Two of them on one
   * corner rather than two meshes, because the circle is one mark — see
   * `disc.ts`.
   *
   * `facing` turns the fan to the eye; see {@link placeDisc}.
   */
  circle(draws: Draws, glows: boolean, facing: boolean): SolidMaterial {
    return this.made(facing ? 'disc-facing' : 'disc', draws, glows, (material) => {
      // Lying on the land a fan is seen from above, and turned to the eye it is
      // wound towards it — but which way round that comes out is the screen's
      // business, so neither is leant on
      material.side = DoubleSide
      material.vertexNode = this.placeDisc(facing)

      // The push, the radius and the ring's half-width, then the two inks —
      // each its colour and how much of it goes on (`disc.ts`)
      const spot = attribute(DISC_SPOT, 'vec4')
      const fill = attribute('paint', 'vec4')
      const ring = attribute(DISC_LINE, 'vec4')
      // How far off the point, in pixels of the page, and how much of that one
      // pixel of the drawing buffer is — so the fade below is a pixel wide at
      // every zoom and every tilt, and on every screen
      const off = spot.xy.length()
      const pace = fwidth(off).max(float(1e-5))
      const inside = cover(off.div(pace), spot.z.div(pace)).mul(fill.w)
      const round = cover(off.sub(spot.z).abs().div(pace), spot.w.div(pace)).mul(ring.w)
      // The ring over the inside, as one would be laid over the other
      const under = inside.mul(round.oneMinus())
      const shows = round.add(under)
      const colour = ring.xyz
        .mul(round)
        .add(fill.xyz.mul(under))
        .div(shows.max(float(1e-5)))
      material.colorNode = this.tinted(colour as Node<'vec3'>, draws)
      material.opacityNode = shows as Node<'float'>

      // Blended in the opaque half and pressed to win its ties with the land,
      // both for the reasons the fill gives
      blendOverOpaque(material)
      pressToLand(material)
    })
  }

  /**
   * Where a corner of a circle's fan goes: pushed out from its point by the
   * pixels it carries, across the screen or along the land.
   *
   * Laid out in view space, the way a mark's card is and for its reason: the
   * look under the pointer narrows the camera to one pixel, and a fan laid out
   * against the whole canvas inside that view lands nowhere near where it is
   * drawn. View space's x and y are the screen's right and up whatever the
   * projection after it, and a pixel of the page is {@link perPixelHere} of
   * it. That is also why `modelViewMatrix` turns the land's directions here:
   * the shapes' root is never moved, but a world direction is not a view one.
   *
   * **Turned to the eye**, the fan is a card at its point — and a card at a
   * point on the land is half inside the land in front of it, since on a tilted
   * map the ground below a point on the screen is nearer the eye than the
   * point is. Hidden by the very ground it marks, which is not what being
   * behind something means. So each corner below the point is stepped towards
   * the eye as far as the ground there is, and those above are left at the
   * point's own depth: the lower half lies at the land's depth as though laid
   * on it, and the upper half stands at the point's, so a wall a few metres
   * behind does not cut its top off either. A mark steps its whole card
   * forward by its overhang instead, which clears the ground up to a tilt of
   * forty-five degrees; this clears it at every tilt the map allows. What is
   * left to win is the tie at the bottom rim, which `pressToLand` is for.
   *
   * **Lying on the land**, the fan is pushed along the ground at the point's
   * height and so narrows as the land turns away: an ellipse, which is what a
   * painted circle is too.
   */
  private placeDisc(facing: boolean): Node<'vec4'> {
    return Fn(() => {
      const perPixel = perPixelHere()
      const spot = attribute(DISC_SPOT, 'vec4')
      const seen = modelViewMatrix.mul(vec4(positionLocal, 1)).toVar()
      if (!facing) {
        const along = modelViewMatrix.mul(vec4(spot.x.mul(perPixel), 0, spot.y.mul(perPixel), 0))
        return cameraProjectionMatrix.mul(seen.add(along))
      }
      const right = spot.x.mul(perPixel)
      const up = spot.y.mul(perPixel)
      // The land's own up, seen from the eye: how a step across the screen
      // goes into or out of a level plane through the point. The map is never
      // rolled and never laid flat to the eye, so the third of these is the
      // cosine of the tilt and never less than the steepest tilt allows; it is
      // held off nought all the same, since nothing divides well by it.
      const level = modelViewMatrix.mul(vec4(0, 1, 0, 0)).xyz
      const forward = level.x
        .mul(right)
        .add(level.y.mul(up))
        .negate()
        .div(level.z.max(float(0.05)))
        .max(float(0))
      return cameraProjectionMatrix.mul(seen.add(vec4(right, up, forward, 0)))
    })() as Node<'vec4'>
  }

  /**
   * Stands every box between the land and the eye, in metres above the sea.
   *
   * Which is the whole of how the eye is kept out of them. A box the eye
   * stands inside has its entry faces behind the near plane, where they are
   * clipped away rather than counted — measured in the spike, the count then
   * came out as 1 over the whole screen and the fill covered everything,
   * ground and sky alike.
   *
   * Cesium answers the same thing with depth clamping (`czm_depthClamp`),
   * which caps a volume at the frustum's planes instead of letting it be cut
   * there. That is not open to us: three does not ask WebGPU for
   * `depth-clip-control`, and nothing done to a vertex's z saves one that is
   * behind the eye — its w is negative and it is clipped whatever z says.
   * Lowering the ceiling costs a uniform and nothing else.
   *
   * What it gives up is the ground that stands higher than the eye, which is
   * ground being looked up at — and ground being looked up at is mostly
   * behind the brow of the hill it belongs to.
   *
   * The floor goes with it, under the land rather than under the sea; see
   * {@link UNDER_THE_LAND}. Both are uniforms written once a frame, so the
   * boxes themselves are never rebuilt: a corner's y is mixed between the two
   * as it is drawn.
   *
   * @param land the lowest ground any of the boxes has to straddle, in metres
   * @param eye how high the camera stands, in metres
   */
  standBetween(land: number, eye: number): void {
    this.floor.value = land - UNDER_THE_LAND
    this.ceiling.value = eye - CLEAR_OF_THE_EYE
  }

  /**
   * One of the two passes that count how deep into a box each pixel lies.
   *
   * Two rather than one because three's WebGPU backend writes the front
   * face's stencil operations into the back face's as well
   * (`WebGPUPipelineUtils`, "matching gl.stencilOp() which is not
   * face-separated"), so the two halves of the count cannot ride on one
   * material. Cesium, on WebGL, has `stencilOpSeparate` and draws both faces
   * at once with culling off.
   *
   * `pushed` is a box whose corners are pushed out in pixels of the page — a
   * line's curtain or a circle's column — rather than standing where they are.
   *
   * `paints` is settled in this test rather than in the colour pass, because a
   * stencil test can only ask one question: the count itself must not happen
   * over what is being left out, or the pixel comes out marked and the colour
   * follows.
   *
   * The land's mark is one bit, so the three answers are the two ways of
   * reading it and not reading it at all. `'ground'` wants the bit set,
   * `'buildings'` wants it clear — which is everything put on the land, since
   * only the land and the trees ever leave it standing — and `'all'` asks
   * nothing. Sky is safe under `'buildings'` although its bit is clear: no
   * face of the box fails the depth test in front of the far plane, so no
   * count is ever laid there.
   */
  count(side: typeof FrontSide | typeof BackSide, paints: Paints, pushed: boolean): MeshBasicNodeMaterial {
    return this.boxed(`count|${String(side)}|${paints}|${String(pushed)}`, pushed, (material) => {
      material.colorWrite = false
      material.depthWrite = false
      material.depthTest = true
      material.side = side
      material.stencilWrite = true
      material.stencilFunc = paints === 'all' ? AlwaysStencilFunc : EqualStencilFunc
      material.stencilRef = paints === 'ground' ? CLASSIFY_LAND : 0
      material.stencilFuncMask = paints === 'all' ? 0xff : CLASSIFY_LAND
      material.stencilFail = KeepStencilOp
      material.stencilZFail = side === FrontSide ? DecrementWrapStencilOp : IncrementWrapStencilOp
      material.stencilZPass = KeepStencilOp
      material.stencilWriteMask = CLASSIFY_COUNT
    })
  }

  /**
   * The pass that paints the marked pixels, and clears the count behind it.
   *
   * One face of the box rather than both, since the colour is blended and a
   * pixel blended twice is a pixel twice as strong. Clearing as it goes does
   * the same job where a box folds back on itself — a ward is not convex, so
   * a ray can leave and re-enter it — because the pixel reads nought on the
   * second face and the test then fails.
   *
   * No depth test at all: the depth these fragments carry is the box's, not
   * the ground's, and what may be painted has already been settled by the
   * count. No shade either — the ground under it was shaded when it was drawn
   * and this is laid over that, so a second helping would darken it twice.
   */
  classify(pushed: boolean): MeshBasicNodeMaterial {
    const land = this.land
    return this.boxed(`classify|${String(pushed)}|${String(land !== null)}`, pushed, (material) => {
      material.side = BackSide
      material.depthTest = false
      material.depthWrite = false
      blendOverOpaque(material)
      material.stencilWrite = true
      material.stencilFunc = NotEqualStencilFunc
      material.stencilRef = 0
      material.stencilFuncMask = CLASSIFY_COUNT
      material.stencilFail = ZeroStencilOp
      material.stencilZFail = ZeroStencilOp
      material.stencilZPass = ZeroStencilOp
      // The land's own mark is left standing; only the count is cleared
      material.stencilWriteMask = CLASSIFY_COUNT

      const paint = attribute('paint', 'vec4')
      // Laid over ground that is already lit, so it takes no light of its own —
      // a second helping would darken it twice. Being unlit it is also written
      // past the frame's tone curve, so the colour the page asked for is the
      // colour on screen; see `tone.ts`.
      //
      // Held to one on the way, because this one blends: the opacity below is
      // the page's own and its default is a half. Three blends before the
      // curve, so the bare inverse of a light colour — 58.16 a channel for
      // white — takes the whole sum and a half-opaque shape comes out as
      // opaque as a full one. The measurement further down was made at an
      // opacity of one, where this never showed.
      //
      // And taken over to the backdrop as far as the mask's hem has taken the
      // ground it lands on; see below.
      const hemmed = land
        ? mix(
            paint.xyz,
            this.into,
            land.landDrawn().select(this.mask.fadeOnLand(land.landHere().xz), float(0)),
          )
        : paint.xyz
      material.colorNode = asReflectance(hemmed as Node<'vec3'>)
      material.opacityNode = paint.w as Node<'float'>
      /*
       * The mask is not cut here, and this is the one pass that must not cut
       * by it. A fragment thrown away clears nothing, and that clearing is the
       * whole of what keeps a pixel from being painted twice where a box folds
       * back on itself: cut, a ward in a masked viewer came out two and three
       * deep and near black. Nothing is lost by leaving the cut out: what may
       * be painted is settled by the count, which is taken against what was
       * drawn, and outside the mask nothing is drawn.
       *
       * The hem is another matter, and is read — at the ground, not at the
       * fragment. The fragment is on the box, whose walls stand from under the
       * ground to just below the eye, and the ground it paints may be the far
       * side of the view; judged where it stands, it would fade paint that
       * lands well inside by the rim it happens to be drawn at. So the place
       * is the land's own, out of the depth the viewer takes of the uncut land
       * before the picture (`Underground.landHere`), which is drawn whenever
       * there is a mask — whenever there is a hem to read. No drawing is added
       * for it.
       *
       * Unless the land itself is out (`ground: { visible: false }`): then
       * there is a mask and nothing under it, every texel is the far plane,
       * and read as land that is a place off the mask's picture at any tilt.
       * Taken for land past the cut, the paint on a hemmed mask's buildings
       * went over to the backdrop entirely (measured, 中野 at a tilt of 55°, a
       * 110m circle with a 60m hem: a tower painted `'buildings'` drew
       * 243,243,243, bare, where with the land told apart it draws 183,195,238
       * as it did before the hem was read). With no land there is no place to
       * read the hem at, so the paint is left as it was before the hem was
       * read at all (`Underground.landDrawn`).
       *
       * And faded as the land is, by its colour and not by its alpha: the land
       * under it is already on its way to the backdrop, and paint taken the
       * same way at the same rate lays `mix(mix(land, paint, a), backdrop, f)`
       * — the hemmed picture of a painted ground — where a lowered alpha
       * would leave the land's own fade showing through and land short of it.
       * The same reasoning as the faint half's `tinted`. Mixed before the hold
       * to reflectance one, which is where the colour is still the colour a
       * page named and the backdrop the colour it draws.
       *
       * Measured (中野, z18, a 100m circle with a 60m hem, one area over all of
       * it painted `#2a6fdb` at 0.6 on the ground alone, the view straight
       * down, one row of pixels from the middle out, four to the metre).
       * Before: by night the paint held 57,100,182 from 90m out to past where
       * the land had already gone to the backdrop's 75,83,96, and dropped to
       * it in two pixels — a hard blue disc with the land fading out under
       * it — and by day it lagged the land, 224,230,250 at 95m where the land
       * had gone to 252. After: by night it runs 66,85,128 at 80m, 74,83,102 at
       * 95m where the land is at 74,82,95, and meets the backdrop with the
       * land; by day it is at 248,249,250 at 95m. The middle, where the hem has
       * not begun, is 36,89,176 by night and 162,180,230 by day, before and
       * after.
       *
       * Over the land the place read is the land's own. Over what stands on it
       * — a wall, when the page paints `'buildings'` or `'all'`, or a tree's
       * crown — the land read is the land seen behind it, so the paint there
       * fades by a place up to a building's height away from where it lands: by
       * less than the wall on the near side of a circle, by more on the far
       * side, and where that land lies past the cut, by the rim's far end
       * (`fadeOnLand`). Only where the mask wears a hem: a hard cut fades
       * nothing here, so a page that cut its map hard sees its paint as it did
       * (measured, a 110m circle cut hard and painted `'all'` at a tilt of 55°,
       * z18.3, one pixel in sixteen compared: the frame after parts from the
       * frame before in 1.9 in the hundred of them by at most four units, where
       * two loads of the same code part in 1.9 by at most three). Measured at
       * the same tilt with a 50m hem: a tower on the far rim drew 175,189,235
       * under the paint before and 241,241,241 after, another on the far
       * rim to the west 155,172,224 and 200,207,234, and two places well inside the
       * same to the unit. The wall's own place is the canvas's depth, which a
       * pass cannot read while it is drawing into it; a copy of it a frame is
       * what would answer.
       *
       * _(2026-10-29: until today the hem was given up here and a page with a
       * wide hem wore a ring of colour at the rim — a hard-edged disc by
       * night.)_
       */
    })
  }

  /**
   * A material for the boxes: made once, and told how to stand a corner up.
   *
   * The corner carries where it is on the map and which of the two heights it
   * belongs to; the heights themselves are the group's and move with the eye.
   * So the ceiling moving is a uniform written once a frame, and no box is
   * ever built again for it.
   */
  private boxed(
    key: string,
    pushed: boolean,
    settle: (material: MeshBasicNodeMaterial) => void,
  ): MeshBasicNodeMaterial {
    const had = this.kept.get(key)
    if (had) return had as MeshBasicNodeMaterial
    const material = new MeshBasicNodeMaterial()
    const climb = attribute(VOLUME_CLIMB, 'vec2')
    const up = mix(this.floor, this.ceiling, climb.y).mul(climb.x)
    if (pushed) {
      // A line is so many pixels of the page wide however far off it is
      // looked at, and a circle so many across, so the corners of their boxes
      // are pushed apart by the pixel and not in the world — the same push the
      // draped ribbon uses, read the same way, so the two cannot disagree
      // about a width.
      const perPixel = perPixelHere()
      const offset = attribute(VOLUME_OFFSET, 'vec2')
      material.positionNode = vec3(
        positionLocal.x.add(offset.x.mul(perPixel)),
        up,
        positionLocal.z.add(offset.y.mul(perPixel)),
      )
    } else {
      material.positionNode = vec3(positionLocal.x, up, positionLocal.z)
    }
    settle(material)
    this.kept.set(key, material)
    return material
  }

  /**
   * Which viewer's uncut land the painting pass reads, told as the group goes
   * on a viewer.
   *
   * A painting material reads the land of the viewer it was woven on, so one
   * moved to another viewer is let go of and made again the next time a box
   * asks — which is the next laying, since a group taken off a viewer is
   * stripped of what it drew and nothing holds the old one.
   */
  readLandOf(land: Underground): void {
    if (this.land === land) return
    this.land = land
    for (const [key, material] of this.kept) {
      if (!key.startsWith('classify|')) continue
      material.dispose()
      this.kept.delete(key)
    }
  }

  /** The shape the viewer is cut to has moved. */
  setMask(area: MaskArea | null): void {
    this.mask.set(area)
  }

  /** The backdrop: what the hem fades into, and what a faint shape is taken towards. */
  fadeInto(colour: ColorRepresentation): void {
    this.mask.fadeInto(colour)
    this.into.value.set(colour)
  }

  dispose(): void {
    for (const material of this.kept.values()) material.dispose()
    this.kept.clear()
  }

  /**
   * One material a kind, a half of the depth and an answer about the shade,
   * made the first time it is asked for.
   *
   * The shade never falls on the half drawn through what hides it. That half is
   * not paint on a road any more — it is a hint of where the shape lies, drawn
   * through the block standing in front of it, and the shadow lying on that
   * road is no more to be seen through the block than the road itself is.
   * Shaded, it also darkens twice: once towards the backdrop and once towards
   * the shade, which leaves a hint that comes and goes for no reason a reader
   * can see.
   */
  private made(
    kind: 'line' | 'facing' | 'fill' | 'disc' | 'disc-facing',
    draws: Draws,
    glows: boolean,
    settle: (material: SolidMaterial) => void,
  ): SolidMaterial {
    const takes = !glows && draws !== 'behind'
    const key = `${kind}|${draws}|${takes}`
    const had = this.kept.get(key)
    if (had) return had as SolidMaterial

    const material = solid()
    readDepth(material, draws)
    settle(material)
    if (takes) {
      // A shape laid on the land takes the light the land takes: it is paint
      // on a road, and a road in shadow is a road in shadow. It carries no
      // normals of its own, being a drape cut to the ground, so it is told
      // which way it faces.
      facesUp(material)
      /*
       * And the colour the page named is what it draws *in full daylight*,
       * which is the same bargain the palette makes (CLAUDE.md, 무엇을
       * 만드는가 6): the colour goes in through the tone curve backwards, so
       * that a flat lit surface comes out at exactly it and a shadowed one
       * goes down from there.
       *
       * It is worth a line here because without it this one word would change
       * colour. A page may say `behind: 'hide'` and have the shape counted
       * into the stencil instead (`classify` below), which paints over a
       * picture already lit and so is flat; or `'dim'`, or a `height`, and
       * have it draped and lit. Measured on a plot asked for at `#2f8f4a`
       * with the two routes side by side: the stencil one drew `#2f8f4a` and
       * the draped one `#12893d` — the curve's 0.04 is most of what a green's
       * red channel is. The two now agree in full sun, and part only where a
       * building's shadow falls over one of them, which is the whole of what
       * being on the ground is supposed to mean.
       *
       * That measurement was made at an opacity of one. Both routes are held
       * to reflectance one — this one in `lit.ts` and the stencil one in
       * `classify` — so a paint brighter than the `#f0f0f0` a white surface
       * draws is brought down to it either way, and nothing below that is
       * touched: a `#2f8f4a` goes in at 0.31 of reflectance. The stencil route
       * wanted that ceiling for a different reason than this one does — it
       * blends rather than multiplies, and three blends before the curve, so
       * the bare inverse of a light colour took the whole sum and drew a
       * half-opaque shape opaque.
       */
      keepsItsColor(material)
    } else {
      // One that does not take the light — a page that said it glows, or the
      // faint half drawn through what hides it — carries its own and keeps
      // its colour exactly; see `lit.ts`.
      carriesItsOwnLight(material)
    }
    this.mask.apply(material)
    this.kept.set(key, material)
    return material
  }

  /** The colour as drawn: the corner's own, taken towards the backdrop in the faint half. */
  private tinted(paint: Node<'vec3'>, draws: Draws): Node<'vec3'> {
    return (draws === 'behind' ? mix(paint, this.into, this.dimmed.oneMinus()) : paint) as Node<'vec3'>
  }
}

/**
 * What one pixel of the page is worth in world units, where the corner is
 * being drawn.
 *
 * The projection is orthographic, so one pixel is the same length anywhere on
 * screen, and it is read off the projection rather than handed in: nothing has
 * to be kept in step with the zoom, and nothing is built again for it. The
 * look under the pointer frames its one pixel so that this comes out the same
 * there (`pick.ts`, `measure`).
 */
function perPixelHere(): Node<'float'> {
  const across = cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x
  return float(2).div(across.mul(viewport.z.div(screenDPR))) as Node<'float'>
}

/**
 * How much of a pixel a band covers, the band `half` either side of nought and
 * the pixel `at` from it — both in pixels of the drawing buffer.
 *
 * A pixel's width laid across the band and the overlap measured, the same
 * reckoning `thinLine.ts` makes for a line's edge and for the same reason: a
 * band thinner than a pixel comes out faint rather than gone, and one of no
 * width at all covers nothing — where a ramp across the edge would leave a band
 * of nought at half strength, which is a ring a page turned off still drawn.
 * Read once with the edge of a circle's inside as the band's edge, and once
 * across the ring.
 */
function cover(at: Node<'float'>, half: Node<'float'>): Node<'float'> {
  return min(at.add(0.5), half)
    .add(min(float(0.5).sub(at), half))
    .saturate() as Node<'float'>
}

/**
 * One drawing of one shape. A shape drawn in two halves hands the same
 * geometry to both.
 *
 * `culled` is whether three may leave it out when the ball round its corners
 * falls off the screen — which is to say, whether those corners are the whole
 * of where it is drawn. An area's are: it is filled exactly where its corners
 * say. A line's are not, since its width is pushed on in the shader, so the
 * ball says nothing about what it covers and the answer there is no.
 *
 * `found` is whether the pointer may find it, which the page says of the shape
 * ({@link ShapeBase.pickable}). What is counted into the stencil is never found
 * whatever it says: the box over a painted shape stands between the land and
 * the eye, so the pointer would come back with its ceiling, metres above the
 * ground the colour actually landed on. That shape answers from its own
 * corners instead; see {@link ShapeLayer.covers}.
 */
export function painted(
  geometry: BufferGeometry,
  material: NodeMaterial,
  culled: boolean,
  found: boolean,
): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = culled
  // It takes the shadow and throws none, which is what paint on a road does.
  // Taking it is three's `receiveShadow`, off by default, and is the whole of
  // what `made` above means by "a road in shadow is a road in shadow".
  // Throwing it is settled by the layer instead; see the comment after this.
  mesh.receiveShadow = true
  // Drawn into the picture and nowhere else: a shape painted on the land casts
  // no shadow and closes in no corner. An area is the one that would show it —
  // a plot the size of a ward, left in the corner shading, would darken every
  // street it covers.
  mesh.layers.set(PICTURE_ONLY)
  // Said apart from the layer because it is a separate question: the layer
  // decides which pass draws a thing, and a mark is drawn in the same one and
  // is clicked. See `found` above for what says it here.
  if (!found) notPicked(mesh)
  // And out of three's own `Raycaster` whatever `found` says; see
  // `answersNoRays`.
  answersNoRays(mesh)
  return mesh
}
