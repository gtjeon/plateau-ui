import { NodeMaterial, Line2NodeMaterial, NormalBlending } from 'three/webgpu'
import type { NodeBuilder } from 'three/webgpu'
import { diffuseColor, float, min, screenDPR, uv, vec2 } from 'three/tsl'
import { uniform } from './repaint.js'
import { beforeTheCurve } from './tone.js'

/**
 * How far a line's edge is faded, in pixels of the drawing buffer.
 *
 * One, which is all there is to say: the only pixels a line's edge half-covers
 * are the ones it crosses. The fade is laid across the edge rather than
 * outside it — half a pixel either side — so a line carries the same ink as
 * the hard-cut one it replaces and reads at the width it was asked for.
 *
 * Pixels of the drawing buffer, not of the page, and the two are not the same:
 * three measures `linewidth` in page pixels (it divides the viewport by the
 * pixel ratio to get there), so a line asked for at 1 is two pixels wide on
 * most laptops. Spent unconverted, the fade ran over both of them and the
 * default width had no solid pixel left in the middle at all. The ratio is
 * read from `screenDPR` in the shader rather than worked in here, since a
 * window dragged between two screens changes it. `buildings/edges.ts`, whose
 * folded lines are drawn with this very material, reads that same uniform for
 * that same reason — but the other way about: it divides by the ratio to come
 * down to pixels of the page, where this multiplies to come up to the
 * buffer's.
 */
const FEATHER = 1

/**
 * How far past the line's own edge the quad is drawn, on each side, in pixels
 * of the page.
 *
 * A name of its own though it holds what {@link FEATHER} holds, because it is
 * spent in the other unit: the quad is three's and `linewidth` is measured in
 * page pixels, and nothing out here can ask the renderer for the ratio. All it
 * has to do is leave the fade its room — half a drawing-buffer pixel on either
 * side — and one page pixel is at least that whatever the ratio, a page pixel
 * never being the smaller of the two.
 */
const MARGIN = 1

/**
 * A line a few pixels wide whose edge is worked out here.
 *
 * **Why not three's own.** `Line2NodeMaterial` draws its edge one of two ways:
 * it fades it over a pixel where the renderer is sampling more than once, and
 * where it is not, it cuts the line off square. Which one it takes is settled
 * when the shader is built, by asking the renderer how many samples it has —
 * and this renderer answers none. Not because the picture is drawn once: three
 * reports no samples whenever it must draw through a buffer of its own first,
 * and it must whenever there is tone mapping or an output colour space to
 * apply, which is always here. The picture is still drawn four times over —
 * that buffer is made with four samples — so it is the answer that is wrong
 * and not the sampling.
 *
 * So every line in this library was cut off square, and the only softness left
 * was what four samples can say about the edge of the quad the line is drawn
 * on: nothing, a quarter, a half, three quarters, all. Five steps, measured on
 * a ward line at #c8ccd4 over #e8ebef, and a line at a shallow angle spends
 * several rows on each of them — which is the staircase a reader sees.
 *
 * **What this does instead** is what every map does: draw the quad a pixel
 * wider on each side than the line, and fade it by how much of the edge pixel
 * the line actually covers. Mapbox and deck.gl both carry the distance across
 * the line into the fragment and ramp the alpha over a pixel there. Nothing
 * about it needs samples, and it is the same at every angle.
 *
 * **And it blends the ordinary way.** three's own line mixes itself against a
 * copy of the screen when it is transparent, which costs that copy every
 * frame. There is nothing to copy for — a line laid over a picture already
 * drawn is what the blender is for — so {@link setupDiffuseColor} leaves out
 * both of three's steps: the alpha it would hand to the samples, and the copy.
 *
 * **Which pass it lands in.** Being transparent puts these lines in three's
 * clear list, drawn after every opaque thing in the scene whatever number they
 * carry. Worth saying because a number is what stacks the rest of this map
 * (see `order.ts`), and a line left here is out of that reckoning — its
 * number is read against the other lines and against nothing opaque.
 *
 * That is where a building's fold lines stay. The ground's are moved to the
 * opaque half by whoever makes them (`GroundMaterials.line`, 2026-10-29), so
 * that their number is read among the land's and a picture or a painted area
 * a page lays on the land goes over them. Nothing here changes for that: the
 * fade is an alpha either way, and blended either way — only sooner.
 */
export class ThinLineMaterial extends Line2NodeMaterial {
  #pixels = 0
  /** The line's own half-width, in pixels of the page; see {@link width}. */
  readonly #halfLine = uniform(0)
  /** Half the quad the line is drawn on, the same way round. */
  readonly #halfQuad = uniform(MARGIN)

  constructor(parameters?: ConstructorParameters<typeof Line2NodeMaterial>[0]) {
    super(parameters)
    // Blended rather than covered: the fade is a fraction of a pixel, and a
    // fraction is what a blend takes and what coverage cannot hold. All three
    // have to be said. Left alone, three turns the alpha into which samples
    // are written — four of them, so a half comes out as two set and two
    // clear, which is a checkerboard along every edge (seen, before this
    // line) — and it leaves the material unblended, since its own transparent
    // line mixes itself by hand against a copy of the screen.
    this.transparent = true
    this.alphaToCoverage = false
    this.blending = NormalBlending

    // How far across the line a fragment is, 0 in the middle and 1 at the
    // quad's edge. The strip runs a unit past each end of a segment, where the
    // round cap is — a line is drawn as separate segments and the caps are what
    // fill the turns between them, so a cap is measured from its own middle
    // rather than written off as being past the end. Left out, every turn in a
    // line opens a notch.
    const at = uv()
    // `x` runs across the strip and `y` along it, which is the way round the
    // round cap is written: its middle is a unit along, and the distance to it
    // is taken from both.
    const beyond = at.y.greaterThan(0).select(at.y.sub(1), at.y.add(1))
    const across = at.y.abs().greaterThan(1).select(vec2(at.x, beyond).length(), at.x.abs()).toVar()

    // The ink a feather-wide pixel standing here would pick up: how much of it
    // the line covers. Both read in pixels of the drawing buffer, which is
    // what a feather is measured in.
    //
    // Built once, from uniforms, because a node graph is settled before the
    // material is first drawn and never looked at again — so a width written
    // after that frame reached the quad, which is a uniform of three's, and
    // not the fade, which left the line neither of the two widths. Rebuilding
    // it with `needsUpdate` would weave a shader per notch of the slider.
    const halfFeather = float(FEATHER / 2)
    // Where the line's own edge is, and where this fragment is, both measured
    // out from the middle of the line in pixels of the drawing buffer.
    const edge = this.#halfLine.mul(screenDPR)
    const from = across.mul(this.#halfQuad).mul(screenDPR).toVar()
    // Clamped against the line's own half-width on each side rather than
    // ramped straight across the edge. The two are the same arithmetic wherever
    // the line is at least a feather wide; where it is thinner they part, and
    // the ramp alone cannot put a line out — at a width of nought its two
    // edges meet in the middle, and a point exactly on an edge is half covered.
    this.opacityNode = min(from.add(halfFeather), edge)
      .add(min(halfFeather.sub(from), edge))
      .div(FEATHER)
      .saturate()

    this.width = parameters?.linewidth ?? 1
  }

  /**
   * How wide the line reads, in pixels of the page.
   *
   * The quad is drawn a pixel wider on each side and the fade is put back in
   * the shader, so what a page asks for is what it sees. Written through
   * rather than kept twice: `linewidth` is the quad's business and this is the
   * line's.
   */
  get width(): number {
    return this.#pixels
  }

  set width(pixels: number) {
    this.#pixels = pixels
    // {@link MARGIN} on each side, which is a page pixel and not a feather of
    // drawing-buffer ones — the two are told apart there.
    const quad = pixels + 2 * MARGIN
    this.linewidth = quad
    this.#halfLine.value = pixels / 2
    this.#halfQuad.value = quad / 2
  }

  /**
   * The colour, without three's two line-specific steps, and written past the
   * frame's tone curve.
   *
   * The two steps left out: the first hands the edge to the samples, and the
   * edge is settled above instead; the second, which runs when the material is
   * transparent, mixes the line against a copy of the screen — a copy an
   * ordinary blend does not need.
   *
   * The curve is undone here rather than at each of the four places a line is
   * made, because this is the one thing all four are. A line is ink: a page
   * that asked for a boundary at `#c8ccd4` is owed that grey and not the grey
   * a tone curve would make of it. See `tone.ts`.
   *
   * It goes here and not on the colour handed in because a line's colour is
   * not always a colour handed in — the ground's lines are read through a
   * field first, and whatever that comes to is what has to land.
   */
  override setupDiffuseColor(builder: NodeBuilder): void {
    NodeMaterial.prototype.setupDiffuseColor.call(this, builder)
    diffuseColor.rgb.assign(
      beforeTheCurve(diffuseColor.rgb as unknown as Parameters<typeof beforeTheCurve>[0]),
    )
  }
}
