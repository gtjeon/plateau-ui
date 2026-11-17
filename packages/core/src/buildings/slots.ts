import {
  Fn,
  If,
  attribute,
  int,
  ivec2,
  normalLocal,
  normalView,
  positionLocal,
  transformNormalToView,
  vec3,
  vec4,
} from 'three/tsl'
import { BUILDING_SLOTS } from './attributes.js'
import {
  DataTexture,
  FloatType,
  Matrix3,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Vector3,
  type Node,
} from 'three/webgpu'
import { aboveGround } from './underfoot.js'
import { lookup } from '../lookup.js'

/**
 * Where the shaders read how each moving building is moved.
 *
 * A building is a run of vertices inside a tile's mesh, and every tile shares
 * one material — giving a mesh a material of its own would weave a shader of
 * its own, and those cost about a second each. So the move cannot ride on the
 * material: it rides on a small table every pass reads, and each vertex
 * carries the number of the row that holds its own.
 *
 * Row 0 is kept for everything standing still, and holds the matrix that moves
 * nothing. A vertex that says 0 is left where the geometry has it.
 */

/** How many buildings can be moving at once across the page, row 0 aside. */
export const MOTION_SLOTS = 256

/**
 * Texels down a column: three for the rows of the matrix that moves the
 * building, three more for the matrix that turns its normals.
 *
 * The matrix's fourth row is always 0, 0, 0, 1, so it is not kept. The
 * normals need a matrix of their own because a building grown more one way
 * than another turns its faces by a different rule than it moves its corners.
 */
const ROWS = 6

const values = new Float32Array(MOTION_SLOTS * ROWS * 4)

/**
 * The table itself: a column to a slot, read by the picture, by the sun, by
 * the corner shading and by the pointer alike. One for the whole page, so a
 * building moved in one viewer is moved in every pass of every other.
 */
const motionTable = new DataTexture(values, MOTION_SLOTS, ROWS, RGBAFormat, FloatType)
motionTable.minFilter = NearestFilter
motionTable.magFilter = NearestFilter
motionTable.generateMipmaps = false
motionTable.needsUpdate = true

const STILL = new Matrix4()
const turning = new Matrix3()

/** Rows given back, to be handed out again before any fresh one. */
const freed: number[] = []
/** The lowest row never yet handed out. Row 0 is the one that moves nothing. */
let unused = 1

/** Takes a row for a building about to move, or nothing where every row is taken. */
export function takeSlot(): number | undefined {
  const slot = freed.pop() ?? (unused < MOTION_SLOTS ? unused++ : undefined)
  if (slot !== undefined) writeSlot(slot, STILL)
  return slot
}

/** Gives a row back once its building stands still again. */
export function releaseSlot(slot: number): void {
  if (slot <= 0 || slot >= MOTION_SLOTS || freed.includes(slot)) return
  writeSlot(slot, STILL)
  freed.push(slot)
}

/**
 * Writes the matrix a row's building is moved by, in the coordinates its mesh
 * is drawn in, and the matrix its normals are turned by. Says whether the row
 * held anything else.
 *
 * Sent to the card only then. A motion that has come to its end and holds
 * there is written the same every frame, and a table marked changed is a
 * picture the viewer would draw again for nothing (`repaint.ts`).
 */
export function writeSlot(slot: number, matrix: Matrix4): boolean {
  if (slot < 0 || slot >= MOTION_SLOTS) return false
  const m = matrix.elements
  turning.getNormalMatrix(matrix)
  const n = turning.elements

  let changed = false
  for (let row = 0; row < 3; row++) {
    // Three keeps a matrix column by column, so a row is every fourth number
    const at = (row * MOTION_SLOTS + slot) * 4
    changed = put(at, m[row] ?? 0) || changed
    changed = put(at + 1, m[4 + row] ?? 0) || changed
    changed = put(at + 2, m[8 + row] ?? 0) || changed
    changed = put(at + 3, m[12 + row] ?? 0) || changed

    const turn = ((row + 3) * MOTION_SLOTS + slot) * 4
    changed = put(turn, n[row] ?? 0) || changed
    changed = put(turn + 1, n[3 + row] ?? 0) || changed
    changed = put(turn + 2, n[6 + row] ?? 0) || changed
    changed = put(turn + 3, 0) || changed
  }
  if (changed) motionTable.needsUpdate = true
  return changed
}

/** Writes one number of the table, as the 32-bit float it holds, and says whether it was not there. */
function put(at: number, value: number): boolean {
  const held = Math.fround(value)
  if (values[at] === held) return false
  values[at] = held
  return true
}

/** One read of the table for the whole page, so every read shares its binding. */
const table = lookup(motionTable)

/**
 * The same move, worked out from the table in hand rather than in a shader.
 *
 * For whoever stands one whole thing on a building. A mast on a roof is one
 * mesh at one place, so the move is done once here instead of at every corner
 * on the card — and it reads the very same rows the shader does, so the mast
 * shakes exactly with the building under it rather than a frame behind.
 *
 * Row 0 moves nothing, as it does there.
 */
export function movedNow(slot: number, x: number, y: number, z: number, into: Vector3): Vector3 {
  if (slot <= 0 || slot >= MOTION_SLOTS) return into.set(x, y, z)
  const row = (r: number) => (r * MOTION_SLOTS + slot) * 4
  const a = row(0)
  const b = row(1)
  const c = row(2)
  return into.set(
    (values[a] ?? 0) * x + (values[a + 1] ?? 0) * y + (values[a + 2] ?? 0) * z + (values[a + 3] ?? 0),
    (values[b] ?? 0) * x + (values[b + 1] ?? 0) * y + (values[b + 2] ?? 0) * z + (values[b + 3] ?? 0),
    (values[c] ?? 0) * x + (values[c + 1] ?? 0) * y + (values[c + 2] ?? 0) * z + (values[c + 3] ?? 0),
  )
}

/**
 * Where a place the card drew would be if its building were not being moved:
 * {@link movedNow} read backwards.
 *
 * For whoever is handed a point off the screen -- a click lands where the
 * building is *now* -- and wants the place on the building it belongs to, which
 * is the one worth keeping. A row that cannot be undone (a building squashed
 * flat, which no motion here does) hands the point back as it came.
 */
export function restingAt(slot: number, x: number, y: number, z: number, into: Vector3): Vector3 {
  if (slot <= 0 || slot >= MOTION_SLOTS) return into.set(x, y, z)
  const row = (r: number) => (r * MOTION_SLOTS + slot) * 4
  const a = row(0)
  const b = row(1)
  const c = row(2)
  // Three keeps a matrix column by column; what the table holds is a row at a
  // time, which is how `movedNow` reads it
  MOVE.set(
    values[a] ?? 0,
    values[a + 1] ?? 0,
    values[a + 2] ?? 0,
    values[a + 3] ?? 0,
    values[b] ?? 0,
    values[b + 1] ?? 0,
    values[b + 2] ?? 0,
    values[b + 3] ?? 0,
    values[c] ?? 0,
    values[c + 1] ?? 0,
    values[c + 2] ?? 0,
    values[c + 3] ?? 0,
    0,
    0,
    0,
    1,
  )
  const determinant = MOVE.determinant()
  if (determinant === 0) return into.set(x, y, z)
  return into.set(x, y, z).applyMatrix4(BACK.copy(MOVE).invert())
}

/** Held between reads, since one is wanted per click and not per frame. */
const MOVE = new Matrix4()
const BACK = new Matrix4()

/**
 * The turn and the growth of one row, without the move: the three-by-three
 * corner of the matrix, as a matrix of its own.
 *
 * For whoever stands a whole thing on a building and wants it to lean as the
 * building leans. {@link movedNow} gives the place its foot ends up at, which
 * is the whole answer for a building that is only being shaken; a building
 * tipped or grown turns what stands on it as well, and that turn is this.
 */
export function basisNow(slot: number, into: Matrix4): Matrix4 {
  if (slot <= 0 || slot >= MOTION_SLOTS) return into.identity()
  const row = (r: number) => (r * MOTION_SLOTS + slot) * 4
  const a = row(0)
  const b = row(1)
  const c = row(2)
  // three keeps a matrix column by column and `set` takes it row by row, so
  // the rows of the table go in as rows
  return into.set(
    values[a] ?? 0,
    values[a + 1] ?? 0,
    values[a + 2] ?? 0,
    0,
    values[b] ?? 0,
    values[b + 1] ?? 0,
    values[b + 2] ?? 0,
    0,
    values[c] ?? 0,
    values[c + 1] ?? 0,
    values[c + 2] ?? 0,
    0,
    0,
    0,
    0,
    1,
  )
}

/**
 * Which way one row turns the faces of its building, worked out from the table
 * in hand rather than in a shader: {@link facingMoved} on this side of the
 * card.
 *
 * For whoever is handed a face off the city and has to say which way it looks
 * — a ray cast at a building a page is moving strikes a wall the card has
 * already turned.
 *
 * It is the second of the two triples the row carries, and not the
 * three-by-three corner of the first ({@link basisNow}): a building grown more
 * one way than another moves its corners by the one and turns its faces by the
 * other, which is the whole reason the table holds both. What stands on a
 * building wants the first, since it is carried rather than bent; a face of the
 * building itself wants this.
 *
 * Row 0 turns nothing, as it does there.
 */
export function facingNow(slot: number, into: Matrix3): Matrix3 {
  if (slot <= 0 || slot >= MOTION_SLOTS) return into.identity()
  // The turn lies in the three rows after the move's own; see {@link writeSlot}
  const row = (r: number) => ((r + 3) * MOTION_SLOTS + slot) * 4
  const a = row(0)
  const b = row(1)
  const c = row(2)
  // three keeps a matrix column by column and `set` takes it row by row, so
  // the rows of the table go in as rows
  return into.set(
    values[a] ?? 0,
    values[a + 1] ?? 0,
    values[a + 2] ?? 0,
    values[b] ?? 0,
    values[b + 1] ?? 0,
    values[b + 2] ?? 0,
    values[c] ?? 0,
    values[c + 1] ?? 0,
    values[c + 2] ?? 0,
  )
}

/**
 * A point moved the way one row of the table moves its building.
 *
 * Here rather than inside whoever moves something: a building's corners are
 * not the only things that have to go where a building goes — a mark set on
 * one reads the same row, so that it keeps step with the building through
 * every pass rather than being carried after it.
 *
 * Rows are kept as rows, so three dot products are the whole multiply; a
 * `mat4` built from them would be its transpose, which is right for a growth
 * and wrong for everything else.
 */
export function movedBy(slot: Node<'int'>, point: Node<'vec3'>): Node<'vec3'> {
  const row = (y: number) => table.load(ivec2(slot, int(y)))
  const corner = vec4(point, 1)
  return vec3(row(0).dot(corner), row(1).dot(corner), row(2).dot(corner)) as Node<'vec3'>
}

/**
 * Brings a corner up out of the ground where its building is still coming in,
 * moves it the way its building's row of the table says, and stands it on the
 * ground its building stands on.
 *
 * The ground comes last, after the move: a building being moved, grown or
 * tipped does all of that about its own foot, and then the whole of it is
 * lifted onto the land — which is what the group it hangs from does for where
 * it stands on the map. With the land flat, and wherever the heights are
 * turned off, every corner carries nought here and nothing is lifted.
 *
 * Hand this to the buildings' one material as its `positionNode`.
 *
 * A corner of a building standing still says row 0 and is not read at all.
 *
 * Which way a face points is turned elsewhere, by {@link facingMoved}, and
 * must not be turned here. `normalLocal` is not a varying but a variable three
 * makes once, wherever it is first asked for; writing to it while the corners
 * are being moved leaves the picture reading a variable that never reached it.
 * Every face in the city then scored the same and the sun went out of the
 * scene — a mean of 232 where it should be 208, which is the picture the sun
 * turned off would give.
 */
export function placeMoved(under: Node<'float'>): Node<'vec3'> {
  return Fn(() => {
    // Still on its way up, where its tile has just landed, or back down,
    // where the view has left the zooms it stands at. It travels whole, and
    // what is under the ground is thrown away by the material, which is given
    // this same drop to work out what that is.
    const here = vec3(positionLocal.x, positionLocal.y.sub(under), positionLocal.z).toVar()

    // Then moved, so a motion goes on top of the growing rather than under it
    const slot = attribute(BUILDING_SLOTS, 'vec4').w.toInt().toVar()
    If(slot.greaterThan(0), () => {
      here.assign(movedBy(slot, here))
    })
    return here.add(vec3(0, aboveGround(), 0))
  })()
}

/**
 * Which way a face points once its building has been moved.
 *
 * Hand this to the buildings' one material as its `normalNode`. It is read
 * where normals are meant to be read — while the picture is drawn — so the
 * face's own direction is still made there, and nothing is taken from the rest
 * of the city.
 *
 * The rows the corners are moved by will not do for the faces. A building
 * grown more one way than another moves its corners by one matrix and turns
 * its faces by another, which is why the table carries both.
 *
 * A face of a building standing still says row 0 and keeps the direction the
 * geometry gives it, to the last bit.
 */
export function facingMoved(): Node<'vec3'> {
  const row = (slot: Node<'int'>, y: number) => table.load(ivec2(slot, int(y)))
  return Fn(() => {
    const slot = attribute(BUILDING_SLOTS, 'vec4').w.toInt().toVar()
    const facing = normalView.toVar()
    If(slot.greaterThan(0), () => {
      const own = normalLocal
      const turned = vec3(row(slot, 3).xyz.dot(own), row(slot, 4).xyz.dot(own), row(slot, 5).xyz.dot(own))
      facing.assign(transformNormalToView(turned).normalize())
    })
    return facing
  })()
}
