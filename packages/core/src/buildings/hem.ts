import type { Mesh } from 'three/webgpu'
import type { Heights } from '../elevation.js'
import { BATCH_ID } from './attributes.js'
import { ANKLE, feetOf } from './foot.js'

/**
 * What a building stands on, and how far its walls are carried below it.
 *
 * A building's base is flat, because the survey's is: PLATEAU gives a
 * footprint and a height, and the foot of the shape that comes back is one
 * level ring. The land under it is not level. Seated on the ground under the
 * middle of its foot, a house on a slope hangs over the low side by half the
 * fall across it and is buried on the high side by the same — some 30cm on a
 * 5% street, a metre on the 20% ones at 七里ヶ浜, and a house standing on air
 * is the one thing in the picture nobody can read past.
 *
 * So the walls are carried down to the lowest ground the foot covers. What
 * that fills is a gap, and what fills it is wall: no seam is drawn, because
 * the ground sheet is laid before the buildings and writes its depth, so
 * everything below it is thrown away by the card rather than covered up.
 *
 * Which is also why the depth is worth over-guessing and not worth
 * under-guessing. The box round a foot is not the foot — an L-shaped house's
 * box takes in the yard it wraps — so the lowest ground in the box may be
 * lower than any ground the house is really on. That buys a hem too long,
 * which is buried, against a hem too short, which is the gap coming back.
 *
 * The other ways of closing it were not taken. Following the land corner by
 * corner along the base is the one that sounds right and looks wrong: a
 * building's foundations are level and its walls meet the ground in a
 * straight line, and a base bent to every rise reads as a tent. It would also
 * cost the thing the ground under a foot is carried for — one height a
 * building, a corner's y meaning how high it stands above its own ground,
 * which `underfoot.ts` holds to. Seating the whole
 * building on the lowest ground instead of hemming it needs no new corners at
 * all, and sinks the high side of a steep plot by a full storey; the door
 * goes underground to save the wall.
 */

/** How many places across a foot, each way, the ground is asked about. */
const ACROSS = 3

/** What the ground does under a mesh's buildings. */
export interface Footing {
  /** How high it is under the middle of each foot, in metres above sea level. */
  readonly under: Float32Array
  /** How far below that its lowest point under each foot lies, in metres. Never less than nought. */
  readonly hem: Float32Array
}

/**
 * Reads the ground under every building of a mesh, in one walk over its
 * corners and one pass over the readings.
 *
 * Both answers come from here because both are the same question asked of the
 * same tile of heights, and the land is read in one place. `under` is the
 * middle rather than the lowest: a building keeps the height the ground gives
 * where it stands, and the hem is what reaches down from there.
 */
export function groundUnder(
  mesh: Mesh,
  land: Heights,
  origin: { x: number; z: number },
  stretch: number,
): Footing | null {
  const feet = feetOf(mesh)
  // A building's number sizes the two tables below, so it is held to what the
  // mesh can have: every building has corners of its own, so none is numbered
  // past the corners there are. A number written far past that in a tile was
  // tables that size, kept with the mesh (found in review)
  const corners = mesh.geometry.getAttribute('position')?.count ?? 0
  let most = -1
  for (const building of feet.keys()) if (building < corners) most = Math.max(most, building)
  if (most < 0) return null

  const under = new Float32Array(most + 1)
  const hem = new Float32Array(most + 1)

  // A mesh's corners are metres from the tile's middle; the group carries the
  // Mercator stretch, so it is put back on to ask where they fall. The
  // world's z runs south and Mercator's y runs north.
  const at = (x: number, z: number): number => land.at(origin.x + x * stretch, -(origin.z + z * stretch))

  for (const [building, foot] of feet) {
    if (building > most) continue
    const middle = at(foot.x, foot.z)
    let low = middle
    for (let i = 0; i < ACROSS; i++) {
      const x = foot.minX + ((foot.maxX - foot.minX) * i) / (ACROSS - 1)
      for (let j = 0; j < ACROSS; j++) {
        const z = foot.minZ + ((foot.maxZ - foot.minZ) * j) / (ACROSS - 1)
        const here = at(x, z)
        if (here < low) low = here
      }
    }
    under[building] = middle
    hem[building] = middle - low
  }

  return { under, hem }
}

/**
 * Carries the foot of each building down by its hem.
 *
 * Let down after the windows are set out, and not before: a wall is planned
 * from the corners, and the plan takes a wall's lowest corner for its foot.
 * Let down first, every wall would be a storey taller than the building it
 * belongs to and its windows would be set out from the hem.
 *
 * Nothing needs to keep the windows off what it adds. They are placed by the
 * height a corner is drawn at, counted down from the building's ceiling in
 * storeys of its own, so a wall below the floor is below the last row there
 * is and comes out bare.
 *
 * Which corners are the foot is the question `foot.ts` asks, answered the way
 * it answers it — a corner within an {@link ANKLE} of its building's own
 * nought. The base of a seated building is a level ring, so this is the
 * whole of it, cap and all: the shape stays closed and stays a solid.
 */
export function letDown(mesh: Mesh, hem: Float32Array): void {
  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  if (!positions || !batch) return

  let moved = false
  for (let v = 0; v < positions.count; v++) {
    const y = positions.getY(v)
    if (y > ANKLE) continue
    const drop = hem[batch.getX(v)] ?? 0
    if (drop <= 0) continue
    positions.setY(v, y - drop)
    moved = true
  }
  // The ball the mesh is culled by grows with what it holds; the hand that
  // writes the ground back onto the corners works it out afresh right after
  // this, so nothing is recomputed here to be thrown away.
  if (moved) positions.needsUpdate = true
}
