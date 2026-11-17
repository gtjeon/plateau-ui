import type { BufferGeometry } from 'three/webgpu'
import { shellOf } from './attributes.js'

/**
 * Walls: which faces make up each upright face of a building, and where it stands.
 *
 * PLATEAU gives a building as a shell with nothing on it. A window is not part
 * of that shell and never will be, so it is drawn on the wall rather than cut
 * into it — and to draw on a wall you first have to know where the wall begins
 * and ends. That is all this reads: which faces make up one upright face of a
 * building, how wide it is, how far its foot and its top stand above the
 * ground, and which way it looks.
 *
 * Faces are gathered by the plane they lie in rather than by touching, so a
 * wall broken into a dozen triangles by whatever drew it still reads as one.
 * A plane is then cut where its pieces stand apart, so the two wings of a U do
 * not read as one wall with a courtyard for its middle.
 *
 * Vertices reaching here have been stood upright and seated, so y is height in
 * metres above the ground the building stands on.
 */

/** Faces leaning less than this from upright are wall. */
const UPRIGHT = Math.sin((15 * Math.PI) / 180)
/** Two faces are the same wall where their normals turn less than this. */
const SAME_FACING = Math.cos((5 * Math.PI) / 180)
/** ...and where their planes lie this close together, in metres. */
const SAME_PLANE = 0.3
/**
 * Pieces of one plane standing further apart than this along it are different
 * walls, in metres.
 *
 * Whatever parts them — a courtyard, a column, a joint run down the front —
 * there is no wall in the gap, and a window laid out across it would be drawn
 * in two halves with nothing between them. So each piece is a wall of its own
 * and sets out its windows for itself. What is allowed is room for the numbers
 * a plane is drawn with not quite meeting.
 */
const JOIN = 0.1

/** One upright face of a building: faces in one plane, with no gap wider than {@link JOIN} between them. */
export interface Wall {
  /** The building it belongs to, as `_batchid` numbers them in this tile. */
  readonly building: number
  /** The triangles it is made of. */
  readonly members: readonly number[]
  /** Which way it looks, level and pointing out of the building. */
  readonly normalX: number
  readonly normalZ: number
  /** Along the face, level, and a right angle from the normal. */
  readonly alongX: number
  readonly alongZ: number
  /**
   * How far its plane lies from the origin the mesh is measured from — the
   * tile's centre, not the world's — along its own normal, so a point on the
   * wall is `(normalX, normalZ) * plane` plus some way along it.
   */
  readonly plane: number
  /**
   * Where the wall starts along that direction, measured from that same
   * origin, so a vertex sits at `x * alongX + z * alongZ - start` across it.
   */
  readonly start: number
  /** How wide it is, in metres. */
  readonly width: number
  /** Its foot and its top above the ground, in metres. */
  readonly low: number
  readonly high: number
}

export interface WallPlan {
  readonly walls: readonly Wall[]
}

/** One plane of a building, before it is cut into walls. */
interface Gathering {
  building: number
  members: number[]
  normalX: number
  normalZ: number
  alongX: number
  alongZ: number
  /** How far its plane lies from the origin, along its own normal. */
  plane: number
}

/**
 * Reads the upright faces of a mesh, each gathered into one wall.
 *
 * Nothing here depends on how the windows are set out, so a mesh is read once
 * and can be drawn with any settings afterwards, over and over.
 */
export function planWalls(geometry: BufferGeometry): WallPlan | undefined {
  const shell = shellOf(geometry)
  if (!shell) return undefined
  const { position, normal, batch, indexed } = shell

  const triangleCount = Math.floor(indexed.count / 3)
  const gathered: Gathering[] = []
  /**
   * Where each triangle sits on the plane it belongs to: across it, and how
   * high it stands. Kept a triangle at a time because a plane is cut into
   * walls only once all of it is in.
   */
  const spans = new Float32Array(triangleCount * 4)
  /** Which walls belong to which building, to match a face against. */
  const byBuilding = new Map<number, number[]>()

  for (let t = 0; t < triangleCount; t++) {
    const ia = indexed.getX(t * 3)
    const ib = indexed.getX(t * 3 + 1)
    const ic = indexed.getX(t * 3 + 2)

    const ax = position.getX(ia)
    const ay = position.getY(ia)
    const az = position.getZ(ia)
    const bx = position.getX(ib)
    const by = position.getY(ib)
    const bz = position.getZ(ib)
    const cx = position.getX(ic)
    const cy = position.getY(ic)
    const cz = position.getZ(ic)

    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (length === 0) continue
    nx /= length
    ny /= length
    nz /= length
    if (Math.abs(ny) > UPRIGHT) continue

    // Tiles do not wind faces reliably; the stored normal tells the outside.
    if (nx * normal.getX(ia) + ny * normal.getY(ia) + nz * normal.getZ(ia) < 0) {
      nx = -nx
      nz = -nz
    }
    // What is left of the normal once it is laid flat. A wall leaning back by
    // the most we allow still keeps most of it.
    const level = Math.sqrt(nx * nx + nz * nz)
    if (level < 1e-6) continue
    nx /= level
    nz /= level

    const plane = ax * nx + az * nz
    const building = batch.getX(ia)
    const gathering = planeFor(building, nx, nz, plane)

    gathering.members.push(t)
    let least = Number.POSITIVE_INFINITY
    let most = Number.NEGATIVE_INFINITY
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const [x, y, z] of [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ] as const) {
      const s = x * gathering.alongX + z * gathering.alongZ
      if (s < least) least = s
      if (s > most) most = s
      if (y < low) low = y
      if (y > high) high = y
    }
    spans[t * 4] = least
    spans[t * 4 + 1] = most
    spans[t * 4 + 2] = low
    spans[t * 4 + 3] = high
  }

  /**
   * The plane a face belongs to, or a new one.
   *
   * A building has planes enough to count on one hand and rarely more than a
   * few dozen, so its own are simply looked through. Hashing the plane would
   * split a wall in two wherever it fell either side of a bucket's edge.
   */
  function planeFor(building: number, nx: number, nz: number, plane: number): Gathering {
    let mine = byBuilding.get(building)
    if (!mine) {
      mine = []
      byBuilding.set(building, mine)
    }
    for (const g of mine) {
      const gathering = gathered[g]
      if (!gathering) continue
      if (nx * gathering.normalX + nz * gathering.normalZ < SAME_FACING) continue
      if (Math.abs(plane - gathering.plane) > SAME_PLANE) continue
      return gathering
    }
    const gathering: Gathering = {
      building,
      members: [],
      normalX: nx,
      normalZ: nz,
      // Turned a right angle from the normal, so it runs along the face.
      alongX: -nz,
      alongZ: nx,
      plane,
    }
    mine.push(gathered.length)
    gathered.push(gathering)
    return gathering
  }

  // Each plane, cut where its pieces stand apart. Sorted by where a piece
  // begins, so one walk along the plane finds every gap in it.
  const walls: Wall[] = []
  for (const plane of gathered) {
    plane.members.sort((a, b) => (spans[a * 4] ?? 0) - (spans[b * 4] ?? 0))

    let members: number[] = []
    let least = Number.POSITIVE_INFINITY
    let most = Number.NEGATIVE_INFINITY
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY

    const close = (): void => {
      if (members.length === 0) return
      walls.push({
        building: plane.building,
        members,
        normalX: plane.normalX,
        normalZ: plane.normalZ,
        alongX: plane.alongX,
        alongZ: plane.alongZ,
        plane: plane.plane,
        start: least,
        width: most - least,
        low,
        high,
      })
    }

    for (const t of plane.members) {
      if (members.length > 0 && (spans[t * 4] ?? 0) - most > JOIN) {
        close()
        members = []
        least = Number.POSITIVE_INFINITY
        most = Number.NEGATIVE_INFINITY
        low = Number.POSITIVE_INFINITY
        high = Number.NEGATIVE_INFINITY
      }
      members.push(t)
      least = Math.min(least, spans[t * 4] ?? 0)
      most = Math.max(most, spans[t * 4 + 1] ?? 0)
      low = Math.min(low, spans[t * 4 + 2] ?? 0)
      high = Math.max(high, spans[t * 4 + 3] ?? 0)
    }
    close()
  }
  return { walls }
}

/**
 * Where along a wall it is asked what lies in front of it.
 *
 * Three points rather than the middle alone: a long wall down the side of a
 * block can have a street at one end and a neighbour's flank at the other, and
 * answering for its middle would dress all of it or none of it. Both of the
 * things a wall is asked — whether a road is there, whether a neighbour is —
 * are asked at these same points, so the two answers are about the same places.
 */
export const PROBES = [0.15, 0.5, 0.85] as const

/** Where a wall's two ends stand in plan, in the metres the mesh is measured in. */
export function endsOf(wall: Wall): { x0: number; z0: number; x1: number; z1: number } {
  const px = wall.normalX * wall.plane
  const pz = wall.normalZ * wall.plane
  const far = wall.start + wall.width
  return {
    x0: px + wall.alongX * wall.start,
    z0: pz + wall.alongZ * wall.start,
    x1: px + wall.alongX * far,
    z1: pz + wall.alongZ * far,
  }
}

/**
 * How far apart two stretches of line lie in plan, and nothing where they
 * cross.
 *
 * One is a wall's line of sight and the other a neighbour's wall, which is met
 * where nothing is left between them.
 */
export function gapBetween(
  px: number,
  pz: number,
  qx: number,
  qz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  if (crossingAlong(px, pz, qx, qz, ax, az, bx, bz) <= 1) return 0
  // Apart, the nearest pair of points has an end of one of them in it.
  return Math.min(
    pointGap(px, pz, ax, az, bx, bz),
    pointGap(qx, qz, ax, az, bx, bz),
    pointGap(ax, az, px, pz, qx, qz),
    pointGap(bx, bz, px, pz, qx, qz),
  )
}

/**
 * How far along the first stretch of line it crosses the second, as a share of
 * the first from 0 at its start to 1 at its end, or Infinity where the two do
 * not cross.
 *
 * The first is a wall's line of sight and the second a neighbour's wall or a
 * piece of road, so what comes back says how far out along the view it lies.
 */
export function crossingAlong(
  px: number,
  pz: number,
  qx: number,
  qz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const rx = qx - px
  const rz = qz - pz
  const sx = bx - ax
  const sz = bz - az
  // Where neither turns with respect to the other they are parallel, and do
  // not cross however close they lie.
  const turn = rx * sz - rz * sx
  if (turn === 0) return Number.POSITIVE_INFINITY
  const ox = ax - px
  const oz = az - pz
  const t = (ox * sz - oz * sx) / turn
  const u = (ox * rz - oz * rx) / turn
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : Number.POSITIVE_INFINITY
}

/** How far a point lies from a stretch of line, in plan. */
function pointGap(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const ux = bx - ax
  const uz = bz - az
  const length = ux * ux + uz * uz
  const along = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / length)) : 0
  const toX = ax + ux * along - x
  const toZ = az + uz * along - z
  return Math.sqrt(toX * toX + toZ * toZ)
}
