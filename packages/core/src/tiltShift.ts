import { abs, float, max, min, screenUV, smoothstep, texture as unwatched, vec2, vec4 } from 'three/tsl'
import {
  DepthTexture,
  HalfFloatType,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  Vector2,
  Vector4,
  type FramebufferTexture,
  type Node,
  type OrthographicCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { PICTURE_ONLY } from './passes.js'
import { drawDepth } from './offscreen.js'
import { uniform } from './repaint.js'
import { weaveQuad } from './quads.js'

/**
 * The miniature look: the picture kept sharp at one depth and blurred the
 * further a thing stands in front of it or behind it, as a lens tilted off the
 * film does to a street seen from a roof (`ViewerOptions.tiltShift`).
 *
 * By depth and not by a band across the screen (the user chose, 2026-11-06).
 * A building standing at the focus is sharp to its top, and looking straight
 * down blurs little, since everything is then about as far off.
 *
 * The same names as {@link ViewerTiltShift}, which is where they are changed
 * afterwards. Each left out is worked out from the view as it moves.
 */
export interface TiltShiftOptions {
  /**
   * Whether it is drawn at all. Off by default.
   *
   * `enabled` and not `visible`, for the reason the corner shading gives: it
   * is an effect laid over the picture and not a thing in it.
   */
  enabled?: boolean
  /**
   * Where the picture is sharp, as `[longitude, latitude]` on the ground.
   *
   * Left out, whatever stands at the middle of the screen, as a camera's
   * autofocus takes the middle of the frame: the tower the view is aimed at,
   * or the ground where there is nothing standing. It follows the view, and
   * jumps where the middle of the screen moves off one thing onto another.
   */
  focus?: readonly [number, number]
  /**
   * How far in front of the focus or behind it, in metres of depth, a thing is
   * as blurred as it gets. Three's depth of field names it the same
   * (`DepthOfFieldNode.focalLength`). Smaller is a thinner slice in focus and
   * a smaller-looking town.
   *
   * Left out, it is worked out from the view: the depth the ground spans from
   * the middle of the screen to its top edge, which is nought looking straight
   * down and grows as the view is laid back and drawn out.
   */
  focalLength?: number
  /**
   * The most a point is blurred, in CSS pixels: how far its colour is spread.
   *
   * Left out, {@link MOST_AUTO_BLUR} times how far the view is laid back (the
   * sine of the pitch), so straight down is sharp throughout.
   */
  blur?: number
}

/**
 * The miniature look of a viewer as it now stands, and the handle on it:
 * `viewer.tiltShift.enabled = true`.
 *
 * A part of the viewer that is always there, as `viewer.occlusion` is.
 * Writing any of it takes effect on the next frame. What is read back is what
 * was written: `undefined` where the view decides.
 */
export interface ViewerTiltShift {
  /** Whether it is drawn at all; see {@link TiltShiftOptions.enabled}. */
  enabled: boolean
  /** Where it is sharp, or `undefined` for the middle of the view; see {@link TiltShiftOptions.focus}. */
  focus: readonly [number, number] | undefined
  /** In metres, or `undefined` for the view's own; see {@link TiltShiftOptions.focalLength}. */
  focalLength: number | undefined
  /** In CSS pixels, or `undefined` for the view's own; see {@link TiltShiftOptions.blur}. */
  blur: number | undefined
}

/**
 * The most the view blurs on its own, in CSS pixels, with the view laid all
 * the way back. A number for how it looks, as the corner shading's own are:
 * past about this the low blocks of a ward run together into a wash.
 */
export const MOST_AUTO_BLUR = 8

/**
 * The viewer's miniature look as a thing a page holds, telling the viewer as
 * it is written.
 *
 * @internal Made by the viewer, handed out as a {@link ViewerTiltShift}.
 */
export class TiltShiftSettings implements ViewerTiltShift {
  private _enabled: boolean
  private _focus: readonly [number, number] | undefined
  private _focalLength: number | undefined
  private _blur: number | undefined

  constructor(
    given: TiltShiftOptions | undefined,
    private readonly moved: () => void,
  ) {
    this._enabled = given?.enabled ?? false
    this._focus = given?.focus ? Object.freeze([given.focus[0], given.focus[1]] as const) : undefined
    this._focalLength = given?.focalLength
    this._blur = given?.blur
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.moved()
  }

  get focus(): readonly [number, number] | undefined {
    return this._focus
  }

  set focus(value: readonly [number, number] | undefined) {
    const next = value ? Object.freeze([value[0], value[1]] as const) : undefined
    if (next?.[0] === this._focus?.[0] && next?.[1] === this._focus?.[1]) return
    this._focus = next
    this.moved()
  }

  get focalLength(): number | undefined {
    return this._focalLength
  }

  set focalLength(value: number | undefined) {
    if (value === this._focalLength) return
    this._focalLength = value
    this.moved()
  }

  get blur(): number | undefined {
    return this._blur
  }

  set blur(value: number | undefined) {
    if (value === this._blur) return
    this._blur = value
    this.moved()
  }
}

/**
 * How many readings each side of a point, along each of the two ways the blur
 * is laid, at half the canvas's resolution: spread evenly out to the most a
 * point is blurred, so a blur of 16 device pixels reads every 2 (one texel of
 * the half sheet).
 */
const TAPS = 8

/** The first of the blur's two copies of the canvas; see {@link TiltShiftPass.render}. */
const ONE_PIXEL = new Vector4(0, 0, 1, 1)

/**
 * The blur itself: depth taken again on its own, the finished picture copied
 * off the canvas, a half-size sheet of it blurred across and then down, and
 * the canvas drawn over with the sharp picture and the blurred one mixed by
 * how far each point stands from the focus.
 *
 * **At half the resolution.** First written at the canvas's own, it cost 3.5
 * ms a drawn frame at a pixel ratio of 1 and 11 at 2 (measured, playground
 * 中野, 1280×800), most of it the readings: 25 a pass, each of the picture and
 * the depth both, for every device pixel. A blur has nothing finer than half a
 * pixel in it to keep, so it is made on a quarter of the pixels, and each
 * reading of the half sheet carries the colour and how far from the focus the
 * point stands in one. The sharp picture is kept whole and mixed in at the end.
 *
 * Gathered rather than scattered — each point reads its neighbours — and
 * each neighbour counted only where its own blur reaches this far. A
 * neighbour standing behind this point reaches no further than this point's
 * own blur, so a blurred background does not spill over what stands sharp in
 * front of it, which is how a lens has it. A blurred thing in front of the
 * focus does not spill over what is sharp behind it either, at the last step:
 * a point in focus takes the sharp picture. Lenses do let that spill; a
 * miniature on a map reads the same without it.
 */
export class TiltShiftPass {
  private readonly depthTexture = new DepthTexture(1, 1)
  private readonly depth = new RenderTarget(1, 1, { depthTexture: this.depthTexture })
  /**
   * The finished picture, copied off the canvas before it is drawn over.
   * Read smoothly, as a target's texture is: the half sheet reads it between
   * four pixels and takes the four of them.
   *
   * A target's texture and not three's `FramebufferTexture`. Three makes that
   * one again as 8-bit wherever it is made with no target set
   * (`Textures.updateTexture`), whatever type it was given: WebGPU takes its
   * format from the canvas's frame buffer all the same, WebGL takes it from the
   * type, and a resolve of the frame's half floats into 8 bits is one WebGL
   * refuses (measured 2026-11-17). And the type written back each frame had
   * three make the texture again in every frame it drew, on both. A target's
   * texture is made to the type it is given, once.
   */
  private readonly picture = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  /**
   * Half-size sheets in half floats, as the frame is: the picture with how far
   * from the focus each point stands in its alpha (−1 far behind to 1 far in
   * front), then that spread across, then down.
   */
  private readonly small = new RenderTarget(1, 1, { type: HalfFloatType })
  private readonly across = new RenderTarget(1, 1, { type: HalfFloatType })
  private readonly down = new RenderTarget(1, 1, { type: HalfFloatType })

  /** One texel of the half sheets, in the 0..1 of the screen, each way. */
  private readonly texel = uniform(new Vector2(1, 1))
  private readonly near = uniform(0)
  private readonly far = uniform(1)
  /** The view-space z of the focus, as a place on the ground. */
  private readonly focusZ = uniform(0)
  /**
   * 1 where the focus is whatever stands at the middle of the screen, read off
   * the depth there, as a camera's autofocus takes the middle of the frame; 0
   * where it is {@link focusZ}, a place the page named.
   */
  private readonly centred = uniform(0)
  /** How far from the focus, in world units of depth, a point is fully blurred. */
  private readonly length = uniform(1)
  /** The most a point is blurred, in device pixels of the canvas. */
  private readonly most = uniform(0)

  private readonly shrinking: QuadMesh
  private readonly spreadingAcross: QuadMesh
  private readonly spreadingDown: QuadMesh
  private readonly mixing: QuadMesh

  constructor() {
    // Read through three's own `texture` and not the watched one (`repaint.ts`):
    // these are what this pass writes as it draws, every frame it draws, and
    // watched they would have the frame drawn again for having been drawn
    this.shrinking = new QuadMesh(this.shrink())
    this.spreadingAcross = new QuadMesh(this.spreading(unwatched(this.small.texture), vec2(1, 0)))
    this.spreadingDown = new QuadMesh(this.spreading(unwatched(this.across.texture), vec2(0, 1)))
    this.mixing = new QuadMesh(this.mix())
  }

  /** Whether anything would be blurred, once {@link set} has been told. */
  get shows(): boolean {
    return this.most.value > 0.5 && this.length.value > 0
  }

  /**
   * What to blur by this frame: where the focus stands in the camera's depth
   * (or that the middle of the screen is), how far from it a point is fully
   * blurred, and the most it is blurred.
   */
  set(focusZ: number, centred: boolean, length: number, mostDevicePixels: number): void {
    this.focusZ.value = focusZ
    this.centred.value = centred ? 1 : 0
    this.length.value = Math.max(0, length)
    this.most.value = Math.max(0, mostDevicePixels)
  }

  /**
   * Blurs what the renderer has just drawn on the canvas, in place.
   *
   * The renderer's clearing is set here and put back: the depth and the
   * sheets are cleared as they are drawn, and the canvas is drawn over whole,
   * so it is neither.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: OrthographicCamera): void {
    if (!this.shows) return
    const size = renderer.getDrawingBufferSize(new Vector2())
    const width = Math.max(1, size.x)
    const height = Math.max(1, size.y)
    const halfWide = Math.max(1, Math.ceil(width / 2))
    const halfHigh = Math.max(1, Math.ceil(height / 2))
    if (this.depth.width !== width || this.depth.height !== height) this.depth.setSize(width, height)
    for (const sheet of [this.small, this.across, this.down]) {
      if (sheet.width !== halfWide || sheet.height !== halfHigh) sheet.setSize(halfWide, halfHigh)
    }
    // The copy is made to the shape of what it copies: the canvas is drawn
    // through a frame buffer of the renderer's own type (half floats, under a
    // tone curve), and three refuses a copy between two formats. Made again by
    // three's own path for a target, which is what makes it anew at its size:
    // never drawn into, nothing else does, and the copy went into the 1×1 it
    // was first made at (seen: the whole map one grey)
    const type = renderer.getOutputBufferType()
    if (this.picture.width !== width || this.picture.height !== height || this.picture.texture.type !== type) {
      this.picture.texture.type = type
      this.picture.dispose()
      this.picture.setSize(width, height)
      renderer.initRenderTarget(this.picture)
    }
    this.texel.value.set(1 / halfWide, 1 / halfHigh)
    this.near.value = camera.near
    this.far.value = camera.far

    // Depth of everything solid, through the viewer's own camera: what is
    // laid over the picture alone (the marks, a painted shape, the lines) is
    // no depth of its own
    const layers = camera.layers.mask
    camera.layers.disable(PICTURE_ONLY)
    try {
      drawDepth(renderer, scene, camera, this.depth)
    } finally {
      camera.layers.mask = layers
    }

    // Twice, the first time one pixel. Three's WebGL copy reads whichever frame
    // buffer is bound when it is called, and binds the canvas's own only after
    // it has copied (`WebGLTextureUtils.copyFramebufferToTexture`): inside a
    // draw that is the same thing, out of one, as here, it is whatever was drawn
    // into last — the depth just above, whose colour is the distance its
    // stand-ins write — and the blur was of that, magenta and green bands over
    // the map on WebGL2 (measured 2026-11-17). The pixel is for what it leaves
    // bound. WebGPU names its source, and copies the same picture both times.
    // Three types what it copies into as its own frame buffer texture; it
    // copies into any
    const picture = this.picture.texture as FramebufferTexture
    renderer.copyFramebufferToTexture(picture, ONE_PIXEL)
    renderer.copyFramebufferToTexture(picture)

    const { autoClear } = renderer
    const to = renderer.getRenderTarget()
    try {
      renderer.autoClear = true
      renderer.setRenderTarget(this.small)
      this.shrinking.render(renderer)
      renderer.setRenderTarget(this.across)
      this.spreadingAcross.render(renderer)
      renderer.setRenderTarget(this.down)
      this.spreadingDown.render(renderer)
      renderer.setRenderTarget(to)
      renderer.autoClear = false
      this.mixing.render(renderer)
    } finally {
      renderer.setRenderTarget(to)
      renderer.autoClear = autoClear
    }
  }

  /**
   * Weaves the blur's four quads off the frame, before it first draws.
   *
   * The same stop as the corner shading's (`OcclusionPass.weave`): made on the
   * spot, its four pipelines were part of a first frame of 1.35 s on a card
   * that had never made them. Each quad is woven with the sheet it draws into
   * set, in the order the frame draws them, so each sheet makes its own
   * texture before the quad after it reads it; and the depth and the copied
   * picture are made by their own targets first, for the reason given there.
   */
  async weave(renderer: WebGPURenderer): Promise<void> {
    renderer.initRenderTarget(this.depth)
    renderer.initRenderTarget(this.picture)
    // In the order the frame draws them, each sheet set while its quad is
    // walked, so each makes its own texture before the next quad reads it
    await Promise.all([
      weaveQuad(renderer, this.shrinking, this.small),
      weaveQuad(renderer, this.spreadingAcross, this.across),
      weaveQuad(renderer, this.spreadingDown, this.down),
      // The mix draws into whatever the frame is drawing into: the canvas
      weaveQuad(renderer, this.mixing, null),
    ])
  }

  dispose(): void {
    this.depth.dispose()
    this.small.dispose()
    this.across.dispose()
    this.down.dispose()
    this.picture.dispose()
    for (const quad of [this.shrinking, this.spreadingAcross, this.spreadingDown, this.mixing]) {
      ;(quad.material as NodeMaterial).dispose()
    }
  }

  /** The view-space z of a point: an orthographic camera's depth is straight in its z. */
  private zAt(at: Node<'vec2'>): Node<'float'> {
    const depth = unwatched(this.depthTexture, at).r
    return this.near.add(depth.mul(this.far.sub(this.near))).negate()
  }

  /**
   * How far from the focus a point stands, over how far a point is when it is
   * fully blurred: −1 far behind it, 1 far in front, nought at it.
   *
   * The focus, left to the view, is whatever stands at the middle of the
   * screen: a tower the view is aimed at is sharp to its top, where the ground
   * at its foot would have left it blurred for standing in front of it (seen:
   * the tower over 中目黒 station lost every window). Where nothing is drawn
   * there — past the edge of a mask, say — the ground at the middle of the view.
   */
  private standsAt(at: Node<'vec2'>): Node<'float'> {
    const middle = vec2(0.5, 0.5)
    const drawn = unwatched(this.depthTexture, middle).r.lessThan(1)
    const focus = this.centred.greaterThan(0.5).and(drawn).select(this.zAt(middle), this.focusZ)
    return this.zAt(at)
      .sub(focus)
      .div(max(this.length, float(1e-6)))
      .clamp(-1, 1)
  }

  /** How far a point that stands so far from the focus is blurred, in device pixels of the canvas. */
  private blurOf(stands: Node<'float'>): Node<'float'> {
    return smoothstep(float(0), float(1), abs(stands)).mul(this.most)
  }

  /** The half sheet: the picture, and where each point stands in the alpha. */
  private shrink(): NodeMaterial {
    const material = quadMaterial()
    const colour = unwatched(this.picture.texture, screenUV)
    material.colorNode = vec4(colour.rgb, this.standsAt(screenUV))
    return material
  }

  /** One of the two spreads: the half sheet read along `way`, `TAPS` each side. */
  private spreading(source: ReturnType<typeof unwatched>, way: Node<'vec2'>): NodeMaterial {
    const material = quadMaterial()
    const here = screenUV
    const centre = source.sample(here) as unknown as Node<'vec4'>
    const ownStands = centre.a
    const own = this.blurOf(ownStands)
    // In device pixels of the canvas, two to a texel of the half sheet
    const step = this.most.div(TAPS)
    let sum: Node<'vec3'> = centre.rgb
    let weights: Node<'float'> = float(1)
    for (let i = 1; i <= TAPS; i++) {
      for (const sign of [-1, 1]) {
        const off = step.mul(i)
        const at = here.add(way.mul(this.texel).mul(off.mul(sign / 2))) as Node<'vec2'>
        const there = source.sample(at) as unknown as Node<'vec4'>
        const theirs = this.blurOf(there.a)
        // Counted where its own blur reaches this far, and — if it stands
        // behind this point — no further than this point's own blur reaches
        const reaches = theirs.sub(off).add(1).clamp(0, 1)
        const mine = own.sub(off).add(1).clamp(0, 1)
        const counted = there.a.greaterThanEqual(ownStands).select(reaches, min(reaches, mine))
        // A gentle fall towards the far end, so the spread has no hard rim
        const fall = Math.exp(-2 * (i / TAPS) ** 2)
        const weight = counted.mul(fall)
        sum = sum.add(there.rgb.mul(weight)) as Node<'vec3'>
        weights = weights.add(weight)
      }
    }
    material.colorNode = vec4(sum.div(weights), ownStands)
    return material
  }

  /**
   * The canvas drawn over: the sharp picture where a point is in focus, the
   * blurred sheet where it is not, and between them by how far it is blurred
   * — wholly blurred from two device pixels, where the half sheet's own
   * softness is what is left to see.
   */
  private mix(): NodeMaterial {
    const material = quadMaterial()
    const sharp = unwatched(this.picture.texture, screenUV)
    const blurred = unwatched(this.down.texture, screenUV)
    const blur = this.blurOf(this.standsAt(screenUV))
    const t = blur.div(2).clamp(0, 1)
    material.colorNode = vec4(sharp.rgb.mul(t.oneMinus()).add(blurred.rgb.mul(t)), float(1))
    return material
  }
}

/** A quad's material: drawn over whatever is there, reading no depth and writing none. */
function quadMaterial(): NodeMaterial {
  const material = new NodeMaterial()
  material.depthTest = false
  material.depthWrite = false
  return material
}
