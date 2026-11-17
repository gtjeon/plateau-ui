import { cameraWorldMatrix, getViewPosition, int, positionView, screenUV, vec4 } from 'three/tsl'
import { texture, uniform } from './repaint.js'
import {
  DepthTexture,
  Matrix4,
  RenderTarget,
  Vector2,
  type Camera,
  type Node,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { drawLand } from './offscreen.js'
import { LAND } from './passes.js'

/**
 * How far behind the land a thing may still be and count as standing on it, in
 * world units.
 *
 * A building's foot is the land, to the metre the survey drew it at and the
 * metre the height tile answers with. Read without any give, half the pixels
 * along the foot of every wall fall on the far side of their own ground and go
 * out, which reads as a speckled line where the wall meets the earth. One unit
 * is about a metre at these latitudes, which is under a pixel of the page at
 * any zoom the city stands at, and is far less than the depth a buried wall is
 * at: what this exists to throw away is metres under, not centimetres.
 */
const A_FOOTHOLD = 1

/**
 * The land as it would be with no mask, kept so that what stands in it can hide
 * its own buried half.
 *
 * The land writes depth, and until there was a mask that depth did all of this
 * by itself: whatever of a building lay under the ground failed the depth test
 * and was never drawn. A mask ends the land at the shape a page drew, and past
 * that line there is nothing in the depth buffer at all — so from the far side
 * of a slope, the wall a building carries down into the hillside to meet it
 * (see `hem.ts`) hangs in the open, and the building reads as starting below
 * the ground.
 *
 * Cesium answers the same question the same way round: the globe writes depth
 * and that is what hides what is under the terrain, and it keeps a copy of
 * that depth for the passes that come after. This is that copy, taken before
 * the picture and with the cut left off.
 *
 * A grid of heights baked on the processor would answer too, and was the other
 * way considered. It was not taken because heights arrive tile by tile as the
 * view moves, so the grid would be rebuilt over and over where the mask's own
 * picture is drawn once when the page sets it; and because a grid answers to
 * the nearest texel where this answers to the pixel being drawn.
 *
 * It costs one drawing of the land a frame, depth only — one sheet and its
 * patches, which is not the scene — and only while there is a mask. With none,
 * the land in the picture is already doing the hiding and this stands down.
 */
export class Underground {
  private readonly depthTexture = new DepthTexture(1, 1)
  private readonly depth = new RenderTarget(1, 1, { depthTexture: this.depthTexture })
  private readonly size = new Vector2()
  /**
   * Screen back to view, for turning a depth texel into the place it was taken
   * at. The camera's own place is not wanted: both sides of the reading are in
   * view space, so the world is never gone back to.
   */
  private readonly undone = uniform(new Matrix4())
  /** Whether the land was drawn this frame. Nought lets everything through. */
  private readonly lit = uniform(0, 'int')
  /** Made once and handed out: every material that asks reads the same node. */
  private test: Node<'bool'> | undefined
  /** The same again for {@link landHere}. */
  private place: Node<'vec3'> | undefined

  /**
   * Whether the fragment being drawn stands at or above the land under it.
   *
   * Handed to `MaskShader.apply` beside the other things a material throws
   * away, so it rides the one test the mask already makes rather than adding a
   * branch of its own.
   *
   * View space, not world: what the depth texel gives back is a place along the
   * eye's own axis, and the fragment has one of those already. Going out to the
   * world and back would be two matrices for a comparison that neither of them
   * changes.
   */
  overLand(): Node<'bool'> {
    return (this.test ??= (() => {
      const seen = getViewPosition(screenUV, texture(this.depthTexture, screenUV).r, this.undone)
      // The eye looks down its own negative z, so nearer is greater
      const over = positionView.z.greaterThanEqual(seen.z.sub(A_FOOTHOLD))
      return this.lit.equal(int(0)).or(over) as Node<'bool'>
    })())
  }

  /**
   * Where the land is in the world at the pixel being drawn, as it would be
   * with the mask's cut left off.
   *
   * For a pass that paints over what was already drawn and has to know where
   * its paint lands: the stencil route in `shapes/paint.ts`, whose fragments are
   * on the back of a box standing from under the ground to just below the eye,
   * nowhere near the ground they colour. That route wants the mask's hem read
   * at the ground, and the ground's own place is the one thing a fragment of
   * the box cannot work out. This is it, from the depth taken before the
   * picture.
   *
   * The land and nothing standing on it, as everything here: over a wall it is
   * the land seen behind that wall. And only true while {@link landDrawn}
   * says so: with no mask the land is not drawn here — which is also when
   * there is no hem to read it for — and with the land put out there is none
   * to draw, so the texel holds the far plane and the place this gives is
   * wherever the eye's ray meets it.
   *
   * World rather than view space, unlike {@link overLand}: the mask is a
   * picture laid on the map, and the map is the world's.
   */
  landHere(): Node<'vec3'> {
    return (this.place ??= (() => {
      const seen = getViewPosition(screenUV, texture(this.depthTexture, screenUV).r, this.undone)
      return cameraWorldMatrix.mul(vec4(seen, 1)).xyz as Node<'vec3'>
    })())
  }

  /**
   * Whether {@link landHere} has any land to answer with this frame: there is
   * a mask, and something of the land was drawn under it.
   *
   * The second half is not the first. A page that puts the viewer's ground out
   * (`ground: { visible: false }`) still cuts its buildings to a mask, and with
   * nothing drawn every texel is the far plane. Read as land, that is a place
   * along the eye's ray past everything, off the mask's picture at any tilt —
   * and the paint laid over a hemmed mask's buildings took it for land past the
   * cut and went over to the backdrop entirely (measured, 中野 at a tilt of
   * 55°: a tower painted `'buildings'` drew 243,243,243, bare, against
   * 183,195,238 before the hem was read).
   */
  landDrawn(): Node<'bool'> {
    return this.lit.equal(int(1)) as Node<'bool'>
  }

  /**
   * Draws something that looks with an eye of its own, with the reading above
   * standing down for the while.
   *
   * What {@link overLand} reads is one picture — this frame's canvas, at the
   * pixel being drawn. That makes it true in the pass that draws that picture
   * and in the passes that draw over it with the same camera, and meaningless
   * anywhere else: the sun's map, the cube a sight is drawn into from its
   * eye, the shading's depth drawn into a sheet wider than the canvas, the
   * one pixel the pointer is looked for in. None
   * of those is drawing the canvas's pixel at the place it reads, so what it
   * reads is the land somewhere else. For the pointer that was the middle of
   * the canvas, and the eye being orthographic, the answer was a line across
   * the screen: the pointer found the near half of the city and nothing beyond
   * the middle of it, and a wall was picked or not by how far up the screen it
   * was drawn rather than by what it was.
   *
   * So it is said outright that they see the city whole. What they give up is
   * the buried hem where the mask has taken the land away: a shadow cast by a
   * wall that should be under a hill, a sight line stopped by one, the shading
   * closed in round one, a pointer that finds one. All four are in the hole
   * the mask leaves, and the shadow and the sight line have no ground there to
   * fall on.
   *
   * Bracketed rather than left to each pass to set and unset, so that a pass
   * that throws still gives it back. The value is put back rather than set to
   * one: whether the land was drawn at all is {@link render}'s to say.
   */
  standDown<T>(draw: () => T): T {
    const was = this.lit.value
    this.lit.value = 0
    try {
      return draw()
    } finally {
      this.lit.value = was
    }
  }

  /**
   * @internal The viewer's, every frame.
   *
   * Takes the land's depth for this frame, or stands down where there is no
   * mask to leave a hole in it.
   *
   * Drawn before the picture, since the picture reads it. Only what wears
   * {@link LAND} is drawn, which is the land's own sheet and nothing standing
   * on it — a tree marked there would hide the building behind it.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: Camera, masked: boolean): void {
    this.lit.value = masked ? 1 : 0
    if (!masked) return
    renderer.getDrawingBufferSize(this.size)
    const width = Math.max(1, Math.round(this.size.x))
    const height = Math.max(1, Math.round(this.size.y))
    if (this.depth.width !== width || this.depth.height !== height) this.depth.setSize(width, height)
    this.undone.value.copy(camera.projectionMatrixInverse)

    // Put back even where the drawing throws: the camera is the viewer's, and
    // left on the land alone it would go on drawing the land alone — no city,
    // no models, no marks — for the life of the viewer, with nothing to put it
    // right. The same care `Outlines.draw` takes over the same camera.
    const layers = camera.layers.mask
    camera.layers.set(LAND)
    try {
      // And said to be drawn only where something was: with the land put out
      // there is a mask and no land, which {@link landDrawn} has to tell from
      // land there. {@link overLand} is not moved by it — against a texture
      // holding the far plane everything already stood over the land.
      if (!drawLand(renderer, scene, camera, this.depth)) this.lit.value = 0
    } finally {
      camera.layers.mask = layers
    }
  }

  /** @internal The viewer's, as it goes. */
  dispose(): void {
    this.depth.dispose()
    this.depthTexture.dispose()
  }
}
