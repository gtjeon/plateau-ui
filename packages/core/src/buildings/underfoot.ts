import { attribute } from 'three/tsl'
import { BufferAttribute, type Mesh, type Node } from 'three/webgpu'
import { BATCH_ID } from './attributes.js'

/**
 * How high the ground is under each building, and how it gets there.
 *
 * Every building in a tile is brought down to stand on a nought of its own as
 * the tile lands (`seat`), and everything afterwards reads a corner's y as
 * its height above the ground that building stands on: which corners are its
 * foot, where its flat roofs are, how many storeys its walls are cut into,
 * how far under it starts as it rises. That reading is worth keeping.
 *
 * So the ground it stands on is not put into the corners. It is carried
 * beside them, one number a corner, and added at the last moment — after the
 * motion that may be moving the building, as the group's own place is. Where
 * a building stands has never been part of its shape here; this is one more
 * thing about where it stands.
 *
 * Every corner of one building carries the same number, which is wasteful and
 * is still the cheapest way there is: a table read by building would want a
 * binding of its own, and three weaves a shader for each material that has
 * one — about a second each — so a tile with a table of its own would stall
 * the frame it landed on. The corners already carry two such numbers apiece
 * for the same reason.
 *
 * It is in metres, like the corners it rides with. The group the tile hangs
 * from carries the Mercator stretch, so nothing has to be brought back here.
 */

/**
 * Where a corner says two things about the ground under its building, in
 * metres: how high it is, and how far under its own nought the building's walls
 * are carried to meet it (see `hem.ts`).
 *
 * The second rides with the first because it answers to the same thing and is
 * the same shape — one number a building, written onto every corner of it — and
 * a component costs a component where an attribute of its own costs an
 * attribute.
 */
const UNDERFOOT = 'underfoot'

/** Where a mesh keeps those two for each of its buildings, by the tile's own number for it. */
const STANDING_ON = 'plateauUnderfoot'
const HEMMED_BY = 'plateauHem'

/**
 * Adds the ground a corner's building stands on. Read where the corners are
 * placed, once the motion that moves them has had its say.
 */
export function aboveGround(): Node<'float'> {
  return attribute(UNDERFOOT, 'vec2').x as Node<'float'>
}

/**
 * How far under its own nought a corner's building reaches.
 *
 * What reads it is the test that throws away whatever of a building is below
 * the ground it stands on. That test took a corner's own y for how far over
 * that ground it rests, which held while every corner was at or above nought;
 * a hemmed building has corners below it on purpose, and they are the very
 * ones that fill the gap on a slope. Read without this they are all thrown
 * away and the hem is a thing that exists and is never drawn.
 */
export function hemBelow(): Node<'float'> {
  return attribute(UNDERFOOT, 'vec2').y as Node<'float'>
}

/**
 * Lays the attribute on a mesh, empty.
 *
 * Laid as the tile lands, where every building mesh passes exactly once, and
 * laid whether or not there are heights to write: every mesh drawn with the
 * buildings' one material has to carry every attribute that material reads,
 * and a mesh given it later would be a shader of its own.
 */
export function layUnderfoot(mesh: Mesh, corners: number): void {
  mesh.geometry.setAttribute(UNDERFOOT, new BufferAttribute(new Float32Array(corners * 2), 2))
}

/**
 * Says how high the ground is under each of a mesh's buildings, and writes it
 * onto their corners.
 *
 * @param under metres above sea level, by the tile's own number for the building
 * @param hem how far under its own nought each one's walls are carried, in metres
 */
export function standOn(mesh: Mesh, under: Float32Array, hem: Float32Array): void {
  mesh.userData[STANDING_ON] = under
  mesh.userData[HEMMED_BY] = hem
  standAgain(mesh)
}

/**
 * Writes it again over the corners as they are now.
 *
 * Cutting a parapet adds corners, and what a carving adds says nothing of its
 * own — so the same hand that tells those corners which motion they follow
 * tells them what they stand on.
 */
export function standAgain(mesh: Mesh): void {
  const under = mesh.userData[STANDING_ON] as Float32Array | undefined
  const hem = mesh.userData[HEMMED_BY] as Float32Array | undefined
  if (!under) return
  const heights = mesh.geometry.attributes[UNDERFOOT] as BufferAttribute | undefined
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!heights || !batch) return

  const values = heights.array as Float32Array
  let low = Infinity
  let high = -Infinity
  for (let v = 0; v < batch.count && v * 2 + 1 < values.length; v++) {
    const building = batch.getX(v)
    const height = under[building] ?? 0
    values[v * 2] = height
    values[v * 2 + 1] = hem?.[building] ?? 0
    if (height < low) low = height
    if (height > high) high = height
  }
  heights.needsUpdate = true
  if (low <= high) raiseBall(mesh, low, high)
}

/**
 * Lifts the ball a mesh is culled by along with the corners inside it.
 *
 * What the card is told to skip drawing is decided by the ball round the
 * corners as the geometry has them, and the corners it really draws are those
 * corners lifted. A tile of a town three hundred metres up would be judged
 * against a ball at sea level — and at a tilt that is most of a screen away,
 * so the tile would blink out while it was plainly in view.
 *
 * Worked out afresh rather than moved: this is said again every time a motion
 * starts or a roof is cut, and a ball nudged each time would walk away.
 *
 * The box round the same corners is left where it lies, and a reader should
 * know what that means. Nothing here reads it — three culls by the ball — so
 * it stays null until somebody asks, and a page that asks
 * `new Box3().setFromObject(viewer.buildings.root)` gets the city as the
 * survey drew it: every tile standing at nought, however high the town it
 * holds. It cannot be put right the way a ray can (see `casting.ts`). A ray is
 * carried into one building's own space and the hit carried back out, one
 * building at a time; a box is one offset for everything inside it, and the
 * offset here is one per building. Lifting it by the lowest and the highest, as
 * the ball above is lifted, would make it a box that holds the city rather
 * than a box that is wrong — but never the city's own box, and it would have
 * to be written again on every frame anything was moving or coming up. So it
 * is left alone rather than half-answered.
 */
function raiseBall(mesh: Mesh, low: number, high: number): void {
  mesh.geometry.computeBoundingSphere()
  const ball = mesh.geometry.boundingSphere
  if (!ball) return
  ball.center.y += (low + high) / 2
  ball.radius += (high - low) / 2
}

/** How high the ground is under each of a mesh's buildings, where it was told. */
export function underfootOf(mesh: Mesh): Float32Array | undefined {
  return mesh.userData[STANDING_ON] as Float32Array | undefined
}

/** How far under its own nought each of a mesh's buildings reaches, where it was told. */
export function hemOf(mesh: Mesh): Float32Array | undefined {
  return mesh.userData[HEMMED_BY] as Float32Array | undefined
}
