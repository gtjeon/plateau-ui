import type { Object3D } from 'three/webgpu'

/**
 * Which stage of the picture a layer draws into.
 *
 * A layer says which stage it belongs to and the viewer seats it there, so
 * which stage a layer is in is the whole of what decides between stages: two
 * layers of different stages may be added in either order and the picture is
 * the same.
 *
 * `base` is under all of it: what the ground itself is put on, for a page that
 * stands its map on something. Then `ground`, the land and everything laid
 * flat on it; then `structure`, what stands up in it; then `overlay`, what is
 * put over the city to point at it or write on it.
 *
 * Inside one stage, depth decides wherever it can. Both of what shares
 * `structure` — the city and a page's models — writes depth, so they are
 * measured against each other and nothing else is needed. Nothing on `overlay`
 * writes it (see `readDepth`), and on `ground` only the land's own sheet does,
 * so there the order is what decides, and the order is `renderOrder`; see
 * {@link drawOrder}.
 */
export type Stage = 'base' | 'ground' | 'structure' | 'overlay'

/** The stages in the order they are drawn, lowest first. */
export const STAGES: readonly Stage[] = ['base', 'ground', 'structure', 'overlay']

/**
 * How many numbers one stage holds to itself. Nothing uses more than a dozen;
 * the room is there so that a stage can be read off a number at a glance.
 */
const BAND = 100

/**
 * The number a layer's root carries so that three draws its stage in its
 * place: three's `groupOrder`.
 *
 * **Why `groupOrder` and not `renderOrder`.** The renderer sorts its two draw
 * lists by `groupOrder` first, then by `renderOrder`, then by distance, then
 * by the object's id (`painterSortStable` in `RenderList.js`). A `Group`'s own
 * `renderOrder` *is* the `groupOrder` of everything under it
 * (`Renderer._projectObject`), and a mesh's `renderOrder` is its own. So the
 * two are a coarse number and a fine one, and they fall out exactly as this
 * map needs them: the stage is coarse and belongs to the viewer, the fine one
 * belongs to whoever drew the things.
 *
 * **The fine number is only defined inside one layer.** Every layer counts
 * from a nought of its own — `ShapeLayer.seat` numbers the shapes in the order
 * they were painted, a mark takes `DRAWN_AT`, `ImageTileLayer` writes the one
 * constant. What parts two layers of one stage is the coarse number: the
 * viewer seats the n-th layer of a stage at `drawOrder(stage) + n *
 * IN_STAGE`, in the order they went on (`Viewer.seat`, 2026-10-28), so a
 * layer added later is drawn after one added before, whatever their fine
 * numbers say.
 *
 * Before that they were not told apart at all: two layers of one stage that
 * both leave depth alone wrote the same numbers, the sort fell through to the
 * distance of a bounding sphere, and which of two overlapping areas showed on
 * top turned with the view. Where a stencil was being counted it was worse
 * than the flicker, because equal numbers interleaved the two layers' passes:
 * a second `ShapeLayer`'s counting boxes were still standing when the first
 * one's painting pass arrived, so a shape of the first painted ground that
 * only the second marked and cleared the count behind it.
 *
 * **A group nested inside a layer says the stage's own number again**
 * ({@link inStage}), not its layer's place in the stage. The layers that nest
 * groups — the city, models, solids — write depth, and the place would decide
 * nothing between them; the ones that do not write it (shapes, marks,
 * pictures, the land) nest none, and the place on their root is what three
 * reads. The land holds its pieces in bare `Object3D`s, which three walks
 * through without reading a number (2026-10-29, see `Ground.groups`); until
 * then they were groups said in the stage, and a ground a page put on after
 * a picture of its own laid its roads under the picture.
 *
 * **Three only takes it off a group the pass's camera can see**, which is why
 * {@link inStage} opens every layer on one; read the whole of it there.
 *
 * That is what leaves a page's own `renderOrder` worth writing. A page that
 * puts two meshes in one layer and numbers them is numbering them against each
 * other, in three's own terms, and nothing here has to be told about it.
 *
 * **It was the order of `scene.children` until 2026-10-06**, with
 * `renderer.sortObjects` off: the viewer spliced each root in among the others
 * by its stage and three drew them in the order it found them. That ignored
 * `renderOrder` altogether — three reads it only when it sorts — so a page
 * knowing three got nothing for knowing it. Sorting is on now and this is what
 * carries what the splice used to.
 *
 * **The cost of turning it on** is that distance is what breaks a tie, and the
 * things laid on the land are all at one distance to within a millimetre. Two
 * drapes of one tile have no tie to break — their bounding spheres are centred
 * in different places, so one of them is nearer by a hair, and which one is
 * nearer changes as the view turns. That is a flicker, and it is why every one
 * of them is numbered rather than left to the sorter; see `GROUND_STACK`.
 *
 * **The other cost is that the sorter measures.** It wants a bounding sphere
 * to take that distance from, so `_projectObject` computes one wherever it
 * finds none — once, at the first drawing, and never again however the corners
 * move afterwards. Culling asked the same question before, so for anything
 * three culls nothing has changed; what is new is that it now asks the meshes
 * that carry `frustumCulled = false`, which carry it precisely because their
 * corners do not say where they are drawn. For most of them the answer is
 * merely meaningless and harmless, since nothing culls them and `renderOrder`
 * decides their place. It is not harmless where the corners are not written
 * yet at that first drawing — which for anything the viewer holds is the weave
 * before the first frame, not the first frame — because a sphere of nought is
 * then kept for the thing's life, and `Mesh.raycast` tries the sphere before
 * the faces, so a page's own `Raycaster` is told there is nothing there.
 * Whoever writes corners after the drawing starts hands three a sphere itself;
 * `ground/surface.ts` is the one that does.
 *
 * **A root that is not a `Group`** — a bare `Object3D`, or a `Mesh` handed over
 * as a layer on its own — carries this as its own `renderOrder` rather than as
 * a stage, since three takes the stage only off a group. It is then sorted
 * among the things of the `structure` stage, at a number that still puts it on
 * the right side of the city. `base` is the one that lands short: it comes
 * after the ground rather than before it, which costs nothing, as everything
 * drawn there writes depth and is under the land anyway. Said rather than
 * guarded: a guard would mean making a group nobody asked for.
 *
 * @param stage the stage whose number to give
 */
export function drawOrder(stage: Stage): number {
  return (STAGES.indexOf(stage) - STAGES.indexOf('structure')) * BAND
}

/**
 * Says a stage again on a group inside a layer.
 *
 * A `Group` is where three takes `groupOrder` from, and it takes it from the
 * nearest one — so a group nested inside a layer's root hands its children its
 * own number and not the root's. A fresh group's is nought, which is
 * `structure`: left alone, a group of things laid on the land would be sorted
 * among the buildings.
 *
 * **What it says is the stage's first place, not the layer's.** The viewer
 * seats the layers of one stage one after another on their roots
 * (`drawOrder(stage) + n * IN_STAGE`), and a group said through here is cut
 * off from that: everything under it is sorted as if its layer had gone on
 * first. Where what is in it writes depth, that decides nothing. Where it does
 * not — things laid flat and stacked by number — a layer that wants its place
 * holds them in a bare `Object3D` rather than a `Group`, as the land does.
 *
 * Every group this library nests inside a seated root goes through here, and
 * so does a layer's own root (`Viewer.seat`). A page nesting one of its own in
 * its own layer has the same thing to say, and nought meaning `structure` is
 * what makes that the right answer for the one case a page is likely to be in
 * — somebody's own three standing in the city.
 *
 * **And the group is opened on every layer**, because three reads the number
 * off it only where the pass's camera can see it: `_projectObject` takes
 * `groupOrder = object.renderOrder` *inside* `if ( visible )`, and walks the
 * children outside it. A fresh group is on layer 0 alone, so in the viewer's
 * last render — `camera.layers.set(PICTURE_ONLY)`, the one that lays the
 * marks and the painted shapes over the shaded picture — and in
 * `Underground`'s `set(LAND)`, not one of these groups passed the test, every
 * band collapsed to the nought the scene walk started with, and the stages
 * decided nothing. Reading the sort keys of the time, when the land's thin
 * lines were drawn there too (until 2026-10-29): a boundary line (`ground`, 8
 * in `GROUND_STACK`) sorted after a label's plate (`overlay`, 0 to 2 in
 * `DRAWN_AT`) and was drawn over it, while the same scene with the corner shading off goes down in one
 * render, where the bands hold, and stacks the other way round — so the
 * picture turned on a setting that is meant to be a shade over it. Read off
 * three's source and these numbers; no pixel was measured. A group draws nothing,
 * so its mask gates this and nothing else — no pass gains a single fragment by
 * it, since the walk into the children never looked at the mask. The sun is
 * opened for the same reason in `lights.ts`, one line and the same branch.
 */
/**
 * How far apart two layers of one stage are seated: the n-th layer on is
 * `drawOrder(stage) + n * IN_STAGE`. Small enough that ten thousand layers
 * stay inside a band, and three compares the numbers as they are.
 */
export const IN_STAGE = 0.01

export function inStage(group: Object3D, stage: Stage): void {
  group.renderOrder = drawOrder(stage)
  if (isGroup(group)) group.layers.enableAll()
}

/**
 * Gives back what {@link inStage} took, for a root handed out again
 * (`Viewer.remove`): the number and the mask that carried it.
 *
 * Both back to what three makes them, since a root carrying `overlay` onto a
 * scene that knows nothing of stages would be sorted over everything there for
 * no reason it could name. Only a group's mask is touched, because only a
 * group's was written: a root that is a mesh keeps whichever layers its owner
 * put it on.
 */
export function outOfStage(group: Object3D): void {
  group.renderOrder = 0
  if (isGroup(group)) group.layers.set(0)
}

/** What three's own sort asks of an object before it reads a stage off it. */
function isGroup(object: Object3D): boolean {
  return (object as { isGroup?: boolean }).isGroup === true
}
