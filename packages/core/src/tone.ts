import { Fn, float, max, min, select, vec3 } from 'three/tsl'
import { Color, LinearSRGBColorSpace, NeutralToneMapping, type Node } from 'three/webgpu'

/**
 * The curve the finished frame is taken through, and how to get out from
 * under it.
 *
 * **Why there is a curve at all.** The scene is lit now, and a lit scene has
 * no ceiling: a white roof square to the sun takes the sun and the sky both,
 * and a page's own metal takes a highlight worth several times either. Written
 * straight to the screen all of that lands on 255 — flat, and the three
 * channels clip one at a time, so a warm white goes magenta on its way out. A
 * curve is what a renderer has instead of a ceiling.
 *
 * **Why this one.** Three offers four. Reinhard halves everything — a surface
 * at one comes out at a half — so the paper of the map would go grey and want
 * the exposure wound up until nothing had any room left. ACES and AgX are film
 * stocks: both crush the dark end, both pull the colour out of the bright end,
 * and both move hues on the way. That last is the one thing this palette
 * cannot pay, since every colour in it is a near-grey told apart from its
 * neighbours by a few parts of blue; either would be a recolouring of the
 * whole map for the sake of a highlight the map does not have.
 *
 * Neutral — Khronos's PBR Neutral — was drawn for exactly that complaint. It is
 * the identity below 0.76 but for a flat 0.04 taken off the bottom, so a colour
 * that already fits on the screen comes out as itself; past that it rolls off
 * towards one and desaturates only as far as it must. The hues stay put.
 *
 * The price is the asymptote. The curve reaches one only in the limit, so the
 * brightest a lit surface can be drawn is short of white, and white is reached
 * only by something several times over it. That is what a tone curve is: the
 * top of the range is spent on what is brighter than paper. It also means the
 * screen's own corner — a colour both as bright as it can be and fully
 * saturated — is off the curve's reach altogether; see {@link reachAt}.
 *
 * Measured, that price: a surface giving back everything it is given, lying in
 * full daylight, draws #f0f0f0 rather than white. A shoulder of our own that
 * begins at 0.98 draws the same surface at 253 and leaves everything under 0.9
 * exactly where this leaves it. It was set aside while the hour the sun is set
 * to was seen to move the same surface further than the curve does, and it was
 * never taken up again: nothing of it is in the repository, here or anywhere
 * beside it. How bright the light is at an hour is `lights.ts`'s to say. The
 * #f0f0f0 stands as the top of what a lit surface draws, and it is what every
 * white wall in the city draws (`wall` in `theme.ts`).
 *
 * **Exposure stays at one.** Three multiplies by `toneMappingExposure` before
 * the curve. How bright the scene is, is set in `lights.ts`, and two knobs for
 * one quantity are two things to tune against each other.
 */
export const TONE_CURVE = NeutralToneMapping

/** The curve's own constants, as three writes them in `neutralToneMapping`. */
const START = 0.8 - 0.04
const DESATURATION = 0.15
const D = 1 - START
/** What the curve leaves at the bottom where it took its quadratic branch; see {@link undo}. */
const KNEE = 0.04
/**
 * The most a colour asked for may be, so the inverse below stays a number.
 *
 * The curve reaches one only in the limit, so a colour asked for at one has no
 * answer. Held just under: 0.999 is what an eight-bit screen rounds to 255
 * anyway, and it leaves the un-mixing a tenth of its range to divide by rather
 * than nothing.
 */
const MOST = 0.999

/**
 * How bright a colour this saturated can be got on screen.
 *
 * The curve pulls colour out of what it compresses, and the harder it
 * compresses the more it pulls. So there is no input at all that comes out
 * both bright and saturated: a full red asked for at one would want a negative
 * green going in. The two ends of that are the whole of the shape — a grey
 * reaches one, a pure hue reaches only the point compression starts — and in
 * between it is the one root of a quadratic, got by setting the curve's own
 * desaturation equal to how little colour the asked-for shade has left:
 *
 *   peak − newPeak = (r/(1−r))/0.15,   peak = 0.52 + 0.0576/(1 − newPeak)
 *
 * with `r` the least part of the colour over its greatest. Solved for
 * `newPeak`, which is what comes out. A colour past it is brought down to it,
 * keeping its hue and what saturation it asked for — which is a gamut map, and
 * the honest answer where there is no exact one.
 */
function reachAt(ratio: number): number {
  const r = Math.min(Math.max(ratio, 0), MOST)
  const K = r / ((1 - r) * DESATURATION)
  const a = K - (START - D)
  const b = 1 - a
  const n = (b + Math.sqrt(Math.max(b * b + 4 * a - 4 * D * D, 0))) / 2
  return Math.min(Math.max(n, START), MOST)
}

/**
 * Walks the curve backwards. Both the shader and the plain one below are this
 * same arithmetic; it is written twice because a colour in a uniform should
 * not cost a shader's worth of it per pixel.
 *
 * Reading three's `neutralToneMapping`: a flat offset comes off the bottom,
 * then the peak is compressed, then the colour is mixed towards its own peak.
 * Each step undoes. The peak of what comes out *is* the compressed peak — the
 * mix is towards it and nothing passes it — so the whole chain can be walked
 * back from `max`, and the branch each step took is told by what is left.
 */
function undo(out: readonly [number, number, number]): [number, number, number] {
  const high = Math.max(out[0], out[1], out[2])
  let y: [number, number, number] = [out[0], out[1], out[2]]
  if (high > 0) {
    const cap = reachAt(Math.min(y[0], y[1], y[2]) / high)
    if (high > cap) y = y.map((v) => (v * cap) / high) as [number, number, number]
  }

  const newPeak = Math.max(y[0], y[1], y[2])
  let loose = y
  if (newPeak >= START) {
    // newPeak = 1 − d²/(peak + d − start), turned round
    const peak = START - D + (D * D) / (1 - newPeak)
    const mixed = 1 - 1 / (DESATURATION * (peak - newPeak) + 1)
    const scale = peak / newPeak
    // Held at nought: the cap above leaves at most a rounding's worth below it
    loose = loose.map((v) => Math.max((v - newPeak * mixed) / (1 - mixed), 0) * scale) as [
      number,
      number,
      number,
    ]
  }
  // The quadratic branch runs while the colour's own least part is under 0.08,
  // and leaves 6.25x² — at most 0.04 — behind it. So what is left says which
  // branch it was, and in that branch the part is the root of it.
  const low = Math.min(loose[0], loose[1], loose[2])
  const offset = low < KNEE ? Math.sqrt(Math.max(low, 0)) / 2.5 - low : 0.04
  return [loose[0] + offset, loose[1] + offset, loose[2] + offset]
}

const curveBack = /*@__PURE__*/ Fn(([colour]: [Node<'vec3'>]) => {
  const asked = vec3(colour).max(0).toVar()
  const high = max(asked.r, max(asked.g, asked.b)).max(1e-5).toVar()

  // As bright as this hue can be got; see `reachAt`
  const ratio = min(asked.r, min(asked.g, asked.b)).div(high).clamp(0, MOST).toVar()
  const k = ratio.div(float(1).sub(ratio).mul(DESATURATION)).toVar()
  const a = k.sub(START - D).toVar()
  const b = float(1).sub(a).toVar()
  const cap = b
    .add(
      b
        .mul(b)
        .add(a.mul(4))
        .sub(4 * D * D)
        .max(0)
        .sqrt(),
    )
    .mul(0.5)
    .clamp(START, MOST)
    .toVar()
  const out = asked.mul(cap.div(high).min(1)).toVar()

  const newPeak = max(out.r, max(out.g, out.b)).toVar()
  const peak = float(START - D)
    .add(float(D * D).div(float(1).sub(newPeak)))
    .toVar()
  const mixed = float(1).sub(float(1).div(float(DESATURATION).mul(peak.sub(newPeak)).add(1)))
  const unmixed = out.sub(vec3(newPeak).mul(mixed)).div(float(1).sub(mixed)).max(0)
  const loose = vec3(select(newPeak.lessThan(START), out, unmixed.mul(peak.div(newPeak)))).toVar()

  const low = min(loose.r, min(loose.g, loose.b)).toVar()
  const offset = select(low.lessThan(KNEE), low.max(0).sqrt().div(2.5).sub(low), float(0.04))
  return loose.add(offset)
})

const heldToOne = /*@__PURE__*/ Fn(([colour]: [Node<'vec3'>]) => {
  const asked = vec3(curveBack(colour)).toVar()
  return asked.div(max(asked.r, max(asked.g, asked.b)).max(1))
})

/**
 * What to write so that the curve puts *this* colour on the screen.
 *
 * For everything that is not lit and must come out as it was asked for: the
 * line round a building a page pointed at, the four thin lines, the marks and
 * their labels, the grid, the air behind the map. A page that said `#ff0000`
 * means that red and not the red a film stock would make of it.
 *
 * Three has a flag for this and it does not reach here. `material.toneMapped`
 * is read by the old WebGL renderer alone; the node renderer applies the curve
 * once over the finished frame (`Renderer._renderOutput`), where no material
 * has a say. The frame already goes through a buffer of its own — the output
 * colour space alone is enough to want one, measured: `needsFrameBufferTarget`
 * was already true before any of this landed — so the curve costs no extra
 * pass and admits no exception. Going backwards through it is the exception.
 */
export function beforeTheCurve(colour: Node<'vec3'>): Node<'vec3'> {
  return curveBack(colour) as unknown as Node<'vec3'>
}

/**
 * The same again, held to reflectance one: what to write as the colour a light
 * is going to multiply, so that a surface lying flat in full daylight draws
 * *this* colour.
 *
 * The inverse above has no ceiling, and it must not: a line or a letter is
 * written straight to the frame and white has to reach white, which takes
 * 58.16 a channel. Multiplied by a light it is another thing entirely. A
 * surface giving back three and a half times what falls on it sits past the
 * curve's knee however it is turned, so every face of it comes out within a
 * few parts of 255 of every other and the shading is gone. See
 * `Solid.setupDiffuseColor` for the two solids that were worked through.
 *
 * **And anything a blender is going to mix wants the same ceiling, lit or
 * not.** Three mixes before the curve, so a source of 58.16 takes the sum
 * whatever its alpha: a patch at 0.55 over the light set's ground comes to
 * 32.3, which the curve draws 255 — the half-seen patch is drawn opaque. Held
 * to one it comes to 0.90 and draws 237, which is the mix a reader is
 * expecting. The callers that mix rather than multiply are the stencil route
 * in `shapes/paint.ts`, the colour a viewshed's land sheet blends (`sight.ts`'s
 * `colorNode`, drawn by `Viewshed`), and the faint half of a mark drawn
 * through what hides it (`annotations/mesh.ts`), where a white plate drew 255
 * at every strength down to 0.35 until it was held here too.
 *
 * One is the ceiling because nothing reflects more than it is given — the line
 * `theme.ts` already holds its `wall` to. Held by the peak rather than a
 * channel at a time, so what is brought down keeps its hue, which is the gamut
 * map {@link reachAt} already makes for a colour too saturated to reach.
 */
export function asReflectance(colour: Node<'vec3'>): Node<'vec3'> {
  return heldToOne(colour) as unknown as Node<'vec3'>
}

/**
 * The same, worked out here rather than in a shader.
 *
 * For the colours written into a uniform, a table or the clear value rather
 * than read out of a picture, which is most of them. A `Color` holds its parts
 * in the working space, which is the space the curve is applied in, so there
 * is no conversion on either side of this.
 *
 * A new colour comes back: the one passed in is usually a page's own, and a
 * page that read back what it set would find it moved.
 */
export function colourBeforeTheCurve(colour: Color): Color {
  const [r, g, b] = undo([
    Math.min(Math.max(colour.r, 0), MOST),
    Math.min(Math.max(colour.g, 0), MOST),
    Math.min(Math.max(colour.b, 0), MOST),
  ])
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace)
}

/**
 * The curve itself, forwards: what the screen shows for a colour written to
 * the frame. Three's `neutralToneMapping`, step for step.
 *
 * For the one place a colour that is already a reflectance has to go in by
 * the door a page's colour goes in by, which walks the curve backwards: put
 * through this first, it comes out of that door as the reflectance it was.
 */
export function colourAfterTheCurve(colour: Color): Color {
  let [r, g, b] = [colour.r, colour.g, colour.b]
  const low = Math.min(r, g, b)
  const offset = low < 0.08 ? low - 6.25 * low * low : KNEE
  r -= offset
  g -= offset
  b -= offset
  const peak = Math.max(r, g, b)
  if (peak >= START) {
    const newPeak = 1 - (D * D) / (peak + D - START)
    r *= newPeak / peak
    g *= newPeak / peak
    b *= newPeak / peak
    const mixed = 1 - 1 / (DESATURATION * (peak - newPeak) + 1)
    r += (newPeak - r) * mixed
    g += (newPeak - g) * mixed
    b += (newPeak - b) * mixed
  }
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace)
}

/** The same again, for a colour said the way a page says one. */
export function beforeTheCurveOf(colour: Parameters<Color['set']>[0]): Color {
  return colourBeforeTheCurve(new Color(colour))
}

/**
 * {@link asReflectance}, worked out here rather than in a shader: the colour
 * taken back through the curve and held to reflectance one by its peak.
 *
 * For a colour written onto corners that a blender is going to mix, which is
 * where the ceiling is wanted lit or not — a solid's fold lines drawn
 * see-through, whose ink is otherwise the bare inverse and takes the sum at
 * any alpha (white at 58.16 a channel). A new colour comes back, as from
 * {@link colourBeforeTheCurve}.
 */
export function colourAsReflectance(colour: Color): Color {
  const back = colourBeforeTheCurve(colour)
  const peak = Math.max(back.r, back.g, back.b)
  return peak > 1 ? back.multiplyScalar(1 / peak) : back
}
