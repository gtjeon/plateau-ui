import { Vector3, type Mesh } from 'three/webgpu'
import { maskEdge, type MaskArea } from '../mask.js'
import { BATCH_ID } from './attributes.js'

/**
 * Where a building's foot is and how far it reaches.
 *
 * A building is grown about the middle of its foot so it stays on the ground,
 * and leaned over the edge of its foot on the side it leans to, as a thing
 * pushed tips rather than sinking. Both want the shape of the foot, which
 * nothing here keeps: the walls are planned as a tile lands and let go again.
 * So it is read off the vertices the once, when a building is first moved, and
 * kept on its mesh by the number the tile calls it.
 *
 * A mesh's corners are metres from its tile's middle, x east, y up, z south,
 * and every building has been brought down to stand on y = 0 of its own. That
 * is what lets the foot be picked out by height alone.
 */

/** Where a mesh keeps the feet it has been asked for. */
const FEET = 'plateauFeet'

/** How high above its own nought a corner may be and still count as the foot, in metres. */
export const ANKLE = 0.5

export interface Foot {
  /** The middle of the foot, in the mesh's own metres. */
  readonly x: number
  readonly z: number
  /**
   * How far the foot reaches from its middle toward a level direction, once
   * grown east and north by the numbers given.
   *
   * The direction is a unit vector in x and z. What comes back is the largest
   * any corner of the foot lies along it, so a building that is longer than it
   * is wide tips over its long side further out than over its short one.
   */
  reach(dirX: number, dirZ: number, east: number, north: number): number
}

/** The foot of one building of a mesh, read once and kept on it. */
export function footOf(mesh: Mesh, building: number): Foot | undefined {
  const kept = (mesh.userData[FEET] ??= new Map<number, Foot>()) as Map<number, Foot>
  const known = kept.get(building)
  if (known) return known

  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!positions || !batch) return undefined

  // Corners along the ground, and if a building is seated on a slope and has
  // none there, every corner of it instead
  let ground = cornersOf(positions, batch, building, ANKLE)
  if (ground.length < 6) ground = cornersOf(positions, batch, building, Infinity)
  if (ground.length < 2) return undefined

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < ground.length; i += 2) {
    minX = Math.min(minX, ground[i]!)
    maxX = Math.max(maxX, ground[i]!)
    minZ = Math.min(minZ, ground[i + 1]!)
    maxZ = Math.max(maxZ, ground[i + 1]!)
  }
  const x = (minX + maxX) / 2
  const z = (minZ + maxZ) / 2

  const foot: Foot = {
    x,
    z,
    reach(dirX, dirZ, east, north) {
      let furthest = 0
      for (let i = 0; i < ground.length; i += 2) {
        const along = (ground[i]! - x) * east * dirX + (ground[i + 1]! - z) * north * dirZ
        if (along > furthest) furthest = along
      }
      return furthest
    },
  }
  kept.set(building, foot)
  return foot
}

/**
 * Where metres east, north and up from the middle of a building's foot, on
 * the ground it stands on, land in its mesh's own metres: what an `Anchor` on
 * a building and a picture's `offset` both say.
 *
 * One reading for both, so that a mark and a picture given the same three
 * numbers are at the same place. The mesh's metres are the building's as it
 * was surveyed, so the three turn with it wherever a page stands it.
 */
export function fromFoot(
  foot: Foot,
  offset: readonly [number, number, number] | undefined,
): { x: number; y: number; z: number } {
  const [east = 0, north = 0, up = 0] = offset ?? []
  // North is where z is least, and the ground the building stands on is the
  // nought its corners count their heights from
  return { x: foot.x + east, y: up, z: foot.z - north }
}

/** {@link fromFoot} read backwards: the three a place in the mesh's own metres is from the foot. */
export function offsetFromFoot(foot: Foot, x: number, y: number, z: number): [number, number, number] {
  return [x - foot.x, foot.z - z, y]
}

/** The x and z of the corners of one building lying no higher than `ankle`. */
function cornersOf(
  positions: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number },
  batch: { getX(i: number): number },
  building: number,
  ankle: number,
): Float32Array {
  const found: number[] = []
  for (let v = 0; v < positions.count; v++) {
    if (batch.getX(v) !== building) continue
    if (positions.getY(v) > ankle) continue
    found.push(positions.getX(v), positions.getZ(v))
  }
  return new Float32Array(found)
}

/** Where one building's foot lies: the middle of it, and the box around it. */
export interface FootBox {
  /** The middle of the foot, in the mesh's own metres. */
  readonly x: number
  readonly z: number
  /** The box the foot fits inside, the same metres. */
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/**
 * Every building's foot in a mesh, in one pass over its corners.
 *
 * {@link footOf} walks the whole mesh for one building, which is nothing when
 * a page moves one; a motion over a whole city would walk it once a building.
 * This answers for all of them at the cost of the one walk.
 *
 * The box comes with the middle because the middle is worked out from it:
 * whoever wants to ask about the ground under the whole of a foot rather than
 * under one point of it would otherwise walk the mesh again for a box this
 * pass already had in its hand.
 */
export function feetOf(mesh: Mesh): Map<number, FootBox> {
  const middles = new Map<number, FootBox>()
  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!positions || !batch) return middles

  const boxes = new Map<number, [number, number, number, number]>()
  for (let v = 0; v < positions.count; v++) {
    if (positions.getY(v) > ANKLE) continue
    const building = batch.getX(v)
    const x = positions.getX(v)
    const z = positions.getZ(v)
    const box = boxes.get(building)
    if (!box) boxes.set(building, [x, x, z, z])
    else {
      if (x < box[0]) box[0] = x
      if (x > box[1]) box[1] = x
      if (z < box[2]) box[2] = z
      if (z > box[3]) box[3] = z
    }
  }
  for (const [building, box] of boxes) {
    middles.set(building, {
      x: (box[0] + box[1]) / 2,
      z: (box[2] + box[3]) / 2,
      minX: box[0],
      maxX: box[1],
      minZ: box[2],
      maxZ: box[3],
    })
  }
  return middles
}

/** Where a mesh keeps the corners it has been asked to stand on. */
const STOOD = 'plateauStood'

/**
 * Every building's ground corners in a mesh, in one pass over its corners.
 *
 * The box {@link feetOf} gives is what a foot *fits inside*, which is not what
 * it stands on: a building bent round a yard takes the yard in with it, and
 * the middle of that box is out in the yard — which is why nothing here judges
 * a building by either; see {@link feetOn}. These are the corners themselves,
 * every one of them on the building, for whoever has to ask about the ground a
 * building actually stands on.
 *
 * The same corner comes back once per wall that meets it, so they are thinned
 * on the way: two walls meeting write the same end twice, and a reader asking
 * about the ground would ask about that place twice over. Thinned to the
 * centimetre, which is finer than the survey draws and coarser than the
 * rounding that put two copies a millionth apart.
 *
 * Kept on the mesh, as {@link footOf} keeps its feet, and never thrown away:
 * nothing that changes a mesh after it lands puts a foot corner anywhere new.
 * A parapet is cut into a roof, which is nowhere near the ground. Setting
 * windows into walls splits the corners two walls share, and a split corner is
 * a copy standing in the same place, which the thinning above takes for the
 * one it is. And a wall carried down a slope adds no corner at all — it drops
 * the ones the foot already had, by `letDown`, and what is kept here is their
 * x and z.
 */
export function stoodOf(mesh: Mesh): Map<number, Float32Array> {
  const kept = mesh.userData[STOOD] as Map<number, Float32Array> | undefined
  if (kept) return kept

  const found = new Map<number, number[]>()
  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!positions || !batch) return new Map()

  const seen = new Set<string>()
  for (let v = 0; v < positions.count; v++) {
    if (positions.getY(v) > ANKLE) continue
    const building = batch.getX(v)
    const x = positions.getX(v)
    const z = positions.getZ(v)
    const key = `${building}|${Math.round(x * 100)}|${Math.round(z * 100)}`
    if (seen.has(key)) continue
    seen.add(key)
    const corners = found.get(building)
    if (corners) corners.push(x, z)
    else found.set(building, [x, z])
  }

  const stood = new Map<number, Float32Array>()
  for (const [building, corners] of found) stood.set(building, new Float32Array(corners))
  mesh.userData[STOOD] = stood
  return stood
}

/**
 * Which of a mesh's buildings a shape holds, by every corner of the foot.
 *
 * The one place that answers whether a building stands on a piece of ground:
 * the mask the viewer is cut to, the sites a page clears, the shapes it paints
 * by. They used to answer it two ways, and both were a point taken to stand
 * for the building — the middle of the foot, or the four corners of the box
 * round it. Both are wrong in the way that matters. A building bent round a
 * yard has the middle of its box out in the yard, which is not on the building
 * at all, and the box itself takes in the yard as well: at 御殿場 the middle
 * put two shops outside a ring drawn round their own walls, and the box would
 * have put the same two outside it for the opposite reason (measured). The
 * corners are the building.
 *
 * The whole foot has to be inside, so a city stops a little inside the line
 * rather than being cut down the face of a wall — a room with no far wall
 * reads as damage rather than as an edge.
 *
 * One walk over the mesh's corners for an answer about every building on it.
 * Asked a building at a time it would be that walk apiece, and this is asked
 * again whenever the tiles are marked afresh.
 *
 * A corner a hair outside counts as inside; see {@link A_HAIR}.
 */
export function feetOn(mesh: Mesh, area: MaskArea): Map<number, boolean> {
  const held = new Map<number, boolean>()
  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!positions || !batch) return held

  // The corners are in the tile's own metres and the shape is in the world's,
  // so where the tile hangs is what carries one to the other
  mesh.updateWorldMatrix(true, false)
  for (let v = 0; v < positions.count; v++) {
    if (positions.getY(v) > ANKLE) continue
    const building = batch.getX(v)
    // Settled by one corner: the whole foot is wanted, so one corner outside
    // is the answer and the rest of them are not worth carrying over
    const had = held.get(building)
    if (had === false) continue
    AT.set(positions.getX(v), 0, positions.getZ(v)).applyMatrix4(mesh.matrixWorld)
    held.set(building, maskEdge(area, AT.x, AT.z) <= A_HAIR)
  }
  return held
}

/**
 * How far outside a shape a corner may lie and still count as inside, in world
 * units — about eight centimetres at Japan's latitudes.
 *
 * Because the answer must not turn on the last decimal of either side. A page
 * writes a shape in degrees rounded somewhere, and a ring traced round the
 * very walls it judges leaves half a building's corners lying *on* the line,
 * where millimetres decide each one. Measured at 御殿場, where the zones are
 * the outline of the buildings they paint: 56 of 99 buildings fell outside
 * their own zone, every one of them by 8mm or less. Nothing a page means by a
 * boundary is that small, and nothing it means is as big as a hand.
 */
const A_HAIR = 0.1

/** Held between readings: a corner is turned into a place and the vector thrown away. */
const AT = new Vector3()
