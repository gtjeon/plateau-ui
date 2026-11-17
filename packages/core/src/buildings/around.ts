import type { Mesh } from 'three/webgpu'
import { BATCH_ID } from './attributes.js'

/**
 * The box a picture painted round a building's walls is unrolled on.
 *
 * The walls are taken as one strip running round the building, and a picture
 * is laid on the strip: a small one stays on the wall it was put on, a wide
 * one goes round the corner onto the next, and one longer than the way round
 * covers every wall there is. What the strip runs round is a box — the
 * smallest rectangle the building's foot fits in, turned to the building —
 * rather than the building's own outline.
 *
 * Most buildings in the survey are boxes, and on a box the strip is the
 * walls themselves, metre for metre. The rest are not, and their outline is
 * not one thing to run round: a tower standing back on its podium has two,
 * a notch has two walls looking the same way one behind the other, a
 * courtyard has walls looking in. Every wall of any of them still finds a
 * place on the box's strip, so the picture runs on without a break; what it
 * pays is that a wall standing back from the box is measured as though it
 * stood on it, so the picture runs a little long or short across it.
 * Chosen over a cylinder, which has no corners to be metres on: a building
 * twice as long as it is wide would wear its picture squeezed down its long
 * sides.
 *
 * In the mesh's own metres, as the corners are cut, so a picture written
 * here goes wherever a motion sends the building.
 */
export interface BoxAround {
  /** The middle of the box. */
  readonly x: number
  readonly z: number
  /**
   * Which way the first side looks out, as a level unit vector. The strip
   * starts at that side's left end as it is looked at from outside and runs
   * rightward round the building from there.
   */
  readonly outX: number
  readonly outZ: number
  /** Half how far the box reaches along {@link outX}, and across it. */
  readonly halfOut: number
  readonly halfAcross: number
}

/** Where a mesh keeps the boxes it has been asked for. */
const BOXES = 'plateauBoxesAround'

/**
 * The box round one building of a mesh, read once and kept on it — or nothing
 * where the mesh holds no such building.
 *
 * Kept because the corners do not move under it: a parapet carved into a roof
 * and windows cut into a wall add corners on the faces that were there and
 * move none of the outline.
 */
export function boxAround(mesh: Mesh, building: number): BoxAround | undefined {
  const kept = (mesh.userData[BOXES] ??= new Map<number, BoxAround | null>()) as Map<number, BoxAround | null>
  const known = kept.get(building)
  if (known !== undefined) return known ?? undefined

  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  let found: BoxAround | null = null
  if (positions && batch) {
    const points: number[] = []
    for (let v = 0; v < positions.count; v++) {
      if (batch.getX(v) !== building) continue
      points.push(positions.getX(v), positions.getZ(v))
    }
    found = smallestBox(points)
  }
  kept.set(building, found)
  return found ?? undefined
}

/**
 * The smallest rectangle round some level points: one side lies along an edge
 * of their hull, and of those the least in area is the one.
 *
 * Every corner of the building rather than its foot alone, so a storey that
 * overhangs the one under it is inside the box too.
 */
function smallestBox(flat: readonly number[]): BoxAround | null {
  const hull = hullOf(flat)
  if (hull.length === 0) return null
  if (hull.length < 3) {
    // A line or a point: no area to turn the box by, so it looks north
    return boxAlong(hull, 0, -1)
  }
  let best: BoxAround | null = null
  let least = Infinity
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i]!
    const [bx, bz] = hull[(i + 1) % hull.length]!
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-6) continue
    // The edge runs across the side; the side looks out square to it
    const box = boxAlong(hull, -(bz - az) / length, (bx - ax) / length)
    const area = box.halfOut * box.halfAcross
    if (area < least) {
      least = area
      best = box
    }
  }
  return best
}

/** The box round some points whose first side looks out along (outX, outZ). */
function boxAlong(points: readonly (readonly [number, number])[], outX: number, outZ: number): BoxAround {
  const [acrossX, acrossZ] = rightOf(outX, outZ)
  let outLeast = Infinity
  let outMost = -Infinity
  let acrossLeast = Infinity
  let acrossMost = -Infinity
  for (const [x, z] of points) {
    const out = x * outX + z * outZ
    const across = x * acrossX + z * acrossZ
    outLeast = Math.min(outLeast, out)
    outMost = Math.max(outMost, out)
    acrossLeast = Math.min(acrossLeast, across)
    acrossMost = Math.max(acrossMost, across)
  }
  const outMiddle = (outLeast + outMost) / 2
  const acrossMiddle = (acrossLeast + acrossMost) / 2
  return {
    x: outX * outMiddle + acrossX * acrossMiddle,
    z: outZ * outMiddle + acrossZ * acrossMiddle,
    outX,
    outZ,
    halfOut: (outMost - outLeast) / 2,
    halfAcross: (acrossMost - acrossLeast) / 2,
  }
}

/**
 * Which way is right along a wall that looks out along (outX, outZ), as the
 * wall is looked at from outside.
 *
 * The same turn the shader takes a pixel by (`BuildingStyles.decals`, the
 * `across` line), so that walking right along a wall here is walking right
 * along it there.
 */
function rightOf(outX: number, outZ: number): readonly [number, number] {
  return [outZ, -outX]
}

/** The convex hull of level points, as (x, z) pairs round it. */
function hullOf(flat: readonly number[]): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i]!, flat[i + 1]!])
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (points.length < 3) return points
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Where on the strip round a box a place on a wall falls, in metres from the
 * strip's start.
 *
 * Which side of the box the place is on is read two ways at once. Which pair
 * of sides — those looking along the box's first side or those across it — is
 * the wall's own way out, since a wall standing back from the box still looks
 * the way the side it belongs to looks. Which of the pair is where the place
 * is, since the survey draws its normals whichever way round it likes (see
 * `facingAt` in `standing.ts`) and a wall's normal can point into the building.
 *
 * The four sides in the order walking right takes them: the first side, then
 * the side across, then the far side, then the near one. The shader works the
 * same answer out per pixel (`BuildingStyles.decals`); the two are written to
 * match, and a picture's middle is put on the strip by this one.
 */
export function aroundBox(box: BoxAround, x: number, z: number, wayX: number, wayZ: number): number {
  const [acrossX, acrossZ] = rightOf(box.outX, box.outZ)
  const out = (x - box.x) * box.outX + (z - box.z) * box.outZ
  const across = (x - box.x) * acrossX + (z - box.z) * acrossZ
  const alongOut = Math.abs(wayX * box.outX + wayZ * box.outZ)
  const alongAcross = Math.abs(wayX * acrossX + wayZ * acrossZ)
  const a = box.halfOut
  const b = box.halfAcross
  if (alongOut >= alongAcross) {
    // The first side, walked across; or the far one, walked back
    return out >= 0 ? across + b : 2 * b + 2 * a + (b - across)
  }
  // The side across, walked back along the way out; or the near one, walked forward
  return across >= 0 ? 2 * b + (a - out) : 4 * b + 2 * a + (out + a)
}
