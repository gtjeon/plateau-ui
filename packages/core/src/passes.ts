import type { Camera, Object3D, Scene, WebGPURenderer } from 'three/webgpu'
import type { Viewer } from './Viewer.js'

/**
 * Three's own layer for what is drawn over the finished picture rather than
 * into the scene the picture is made of.
 *
 * The shadows and the shading of corners each draw the scene again under
 * materials of their own, to learn how far off the nearest thing is. A line has
 * no surface for either: it casts nothing and closes in no corner. Drawn under
 * their materials it would be read as a surface all the same, so whatever is
 * put on this layer is left out of both.
 *
 * And, with the corner shading, out of the other side of it as well: the
 * shading is multiplied over the finished picture, so whatever was left out of
 * its reading is drawn after it has been laid on rather than under it. Left in
 * front of it, a mark would be darkened by the shade of whatever stands behind
 * the mark — the one thing the reading it was kept out of knows nothing about.
 * See `Viewer`'s own drawing of a frame.
 *
 * The land's own thin lines left this layer on 2026-10-29. They are ink on the
 * land like a road, and drawn after the shading they went over whatever a page
 * had laid on the land in the first drawing — a picture, above all. On the
 * default layer they are in that drawing at their place among the land's
 * pieces, and the two readings leave them out otherwise: the sun by
 * `castShadow`, the shading's depth by their material (`drawDepth`).
 *
 * The look under the pointer is not one of these and does not read this layer.
 * Which pass a thing is drawn in says nothing about whether it is a thing to
 * click: a mark is drawn here and is one, a painted line is drawn here and is
 * not. That question has an answer of its own — see `notPicked`.
 *
 * Nor is the line round what a page pointed at: a mark standing in front of a
 * building neither cuts that building's line nor carries one (`outlines.ts`).
 * A solid thing that is to be out of the corner shading and nothing else is
 * not put here; see {@link setOccludes}.
 */
export const PICTURE_ONLY = 1

/**
 * Three's own layer for the land itself: the one sheet everything stands on,
 * so that it can be drawn again on its own.
 *
 * The land writes depth, and that depth is what has always hidden the part of
 * a thing that is under the ground — a wall carried below its own nought to
 * meet a slope, a building still on its way up. A mask ends the land where the
 * page said it ends, and past that line there is no depth to hide anything
 * with: what was buried in the hillside hangs in the air instead, and from the
 * far side of a slope a building is seen to start below the ground.
 *
 * So the land is drawn once more, away from the canvas and without the mask's
 * cut, and whatever stands in it reads that rather than leaning on a depth
 * that stops where the page's shape does; see `underground.ts`.
 *
 * Only the land wears this. Not what lies on it — a road, a green, a footprint
 * — since those share the land's own depth and would add nothing; and above
 * all not what stands on it, since a tree marked here would hide the building
 * behind it.
 */
export const LAND = 2

/**
 * Three's own layer as a mark on a thing that stands in the scene and closes
 * in no corner. Read off the object, never set on a camera; see
 * {@link setOccludes}.
 */
export const NOT_OCCLUDING = 3

/**
 * Three's own layer as a mark on the marks: the pins, tags, dots and labels a
 * page hangs over the map, which are on {@link PICTURE_ONLY} besides.
 *
 * So that they can be drawn after the miniature look's blur (`tiltShift.ts`)
 * while what else is laid over the picture — a painted shape, the lines along
 * the buildings' folds — is drawn before it and blurred with the map it is
 * part of. A label blurred with the street under it is a label that cannot be
 * read. Set on a camera only by the viewer, for that one drawing.
 */
export const MARKS = 4

/**
 * Says whether a thing is part of what the corner shading is measured from —
 * `occludes`, on a solid and on a model.
 *
 * Said `false`, the thing neither darkens the corners round it nor is darkened
 * by them. It stays a solid thing in every other way: the sun's map takes it
 * wherever its own `castShadow` says so, the line round it is drawn when a
 * page points at it, the pointer finds it, a plain `Raycaster` finds it, and
 * the mask and the uncut land hide it as they hide anything else.
 *
 * **Why not {@link PICTURE_ONLY}.** That layer is "out of both": the sun's eye
 * sees layer 0 alone, so nothing on it casts, and the lines' picture leaves it
 * out, so nothing on it is outlined. Both are right for a mark or a hairline and
 * both are wrong here — what this takes away is the corner shading and nothing
 * more. And a thing on that layer alone is on no layer a default `Raycaster`
 * tests, which for a mark or a line is the point (`notPicked`) and for a solid
 * a page can click would be a wrong answer from three's own tool.
 *
 * **So the thing keeps layer 0 and wears {@link NOT_OCCLUDING} beside it.**
 * Every camera that sees layer 0 still sees it — the sun's, the pointer's, the
 * lines', a page's own — and so does a page's `Raycaster`. The one reading it
 * must be kept out of is the depth the shading is measured from, and the one
 * drawing it must not be in is the one the shading is multiplied over. A
 * camera's layers can only ever let a thing through for sharing one of them,
 * so neither of those can be said with the camera: both ask the object, as the
 * picture is drawn.
 *
 * - `offscreen.ts`'s `drawDepth` draws only what occludes, so the shading is
 *   measured as though the thing were not there.
 * - `Viewer`'s drawing of a frame draws the picture without it, multiplies the
 *   shading over that, and then draws what it held back — under the same
 *   camera and the same lights, so its shader is the one it would have had —
 *   before the lines go over and the marks over them. It is darkened by
 *   nothing, it hides what is behind it as anything does, and a line round it
 *   or round something behind it lands over it as it would over the city.
 *
 * What that costs is a drawing of the scene more, and only where such a thing
 * is on screen: the first drawing notes what it held back, and with nothing
 * held back the extra one is not made. With the shading off there is one
 * drawing as there always was, and this changes nothing.
 *
 * And one thing in the picture is not as it would be. Whatever the first
 * drawing laid over the picture without writing depth — water, a building
 * drawn see-through — lies under the thing rather than over it where it is in
 * front, which is what already holds for the marks.
 *
 * Every object under the one given is told, so a model's whole tree is said in
 * one call. A group is passed over: it draws nothing, and its mask is
 * `inStage`'s, which opens it on every layer so that it hands on its stage.
 * What is made afterwards — a model's file arriving, a solid cut again — is
 * told again by whoever made it.
 */
export function setOccludes(object: Object3D, occludes: boolean): void {
  object.traverse((part) => {
    if ((part as { isGroup?: boolean }).isGroup === true) return
    if (occludes) part.layers.disable(NOT_OCCLUDING)
    else part.layers.enable(NOT_OCCLUDING)
  })
}

/**
 * Whether a thing is part of what the corner shading is measured from; see
 * {@link setOccludes}. What the drawings ask of each object as they go.
 */
export function occludes(object: Object3D): boolean {
  return !object.layers.isEnabled(NOT_OCCLUDING)
}

/**
 * Something a page hands the viewer to draw over the finished frame: three's
 * own `PostProcessing`, a pass out of three's addons, a quad of its own.
 *
 * The one door to the renderer, and it opens for the length of one call at a
 * moment the viewer picks, so that when the frame is drawn stays the viewer's
 * (contract 1). A page holding `viewer.renderer` could draw whenever it liked,
 * and then nothing could be said about the order of anything.
 *
 * There was a second beside it until 2026-10-13 — `ScenePass`, which a layer
 * handed over to have the scene drawn from an eye of its own, before the
 * picture. Nothing in core used it once the viewshed went, so it went with it;
 * a layer that has to see something rather than work it out wants it designed
 * again rather than found half-remembered here.
 *
 * **When it is called.** Last in the frame, with the canvas holding the
 * finished picture — the scene, the shading of corners multiplied over it, the
 * lines round what was pointed at, and the marks over those — and with the
 * depth and the stencil of that drawing still on it. The camera's layers are
 * as the viewer keeps them. The renderer's clearing is *off*, which is what
 * makes the sentence above true: left on, three's default, the first render a
 * pass made would clear the picture away before drawing its own. It is put
 * back after the last pass; see `Viewer.drawEffects`. Several are drawn in the
 * order the page handed them over.
 *
 * **Three's `PostProcessing` needs the renderer to be made**, which is why the
 * renderer comes in on every call rather than once: a page builds one the
 * first time it is asked to draw and keeps it. Hung on `pass(viewer.scene,
 * viewer.threeCamera)` it walks the scene a second time, into a target of its own,
 * and composites that over the canvas — so it is a second whole drawing of the
 * city and not a filter over the first. Not measured; said so that nobody is
 * surprised by the frame time.
 *
 * **Why the viewer's own two are not this.** The shading of corners
 * (`occlusion.ts`) has to be drawn in the middle of the frame and not at the
 * end — it is multiplied over the picture, and the marks are drawn after it so
 * that a price over a roof is not darkened by the shade of the building behind
 * it. A door that draws last cannot do that. Its depth is no longer a second
 * reason: since 2026-10-08 the pass takes it with a camera of its own
 * (`OcclusionPass.wider`) and switches `PICTURE_ONLY` off on that, so it leaves
 * no setting of ours on the viewer's. The lines (`outlines.ts`) are the
 * viewer's for the reason in that file: one picture has to hold every layer.
 * Both are also settings rather than passes — they follow the palette and the
 * mask — and a page turns them with {@link Viewer.occlusion} and
 * `viewer.outlines`.
 *
 * **Whoever made it frees it.** The viewer draws it and holds nothing of it;
 * taking it off `viewer.effects` is all that is needed here, and a page's own
 * `dispose` is the page's to call (contract 5).
 */
export interface FramePass {
  /**
   * Draws it. Once a frame, last, onto the canvas.
   *
   * @param renderer the viewer's, for the length of this call
   * @param scene the scene as the frame was drawn from
   * @param camera the camera it was drawn with
   */
  draw(renderer: WebGPURenderer, scene: Scene, camera: Camera): void
}
