import { crossingAlong, endsOf, gapBetween, PROBES, type Wall } from './wallPlan.js'

/**
 * What stands right in front of a wall, of the buildings around it.
 *
 * A wall can look straight down a street and still be no place for a window:
 * the neighbour's flank stands a metre off it, and what a window there would
 * look out on is that flank. PLATEAU says nothing about neighbours — its
 * buildings stand alone — but a tile holds a whole quarter of them, so a wall
 * is asked of every other building in its own tile whether one of them is
 * close enough in front to shut it in.
 *
 * Only the tile's own buildings are known here. A wall shut in by something
 * across a tile's edge is not told of it, which shows as the odd dressed wall
 * along the seams — cheap to answer and wrong in few places, against holding
 * every neighbouring tile in hand to answer it everywhere.
 */

/**
 * How close a building may stand in front of a wall before it takes no
 * windows, in metres.
 *
 * Narrower than the narrowest street, so a house still faces the lane across
 * from its neighbour's front door; wide enough to take in the gap left between
 * two buildings that were put up against each other.
 */
export const DEFAULT_CLEARANCE = 3

/**
 * How tall a building standing between a wall and its road has to be, as a
 * share of the wall's own height, before it hides the road from the wall.
 */
const OVERLOOKS = 0.5

/** How many of a wall's probe points have to be shut in before it is passed over. */
const SHUT_IN = 2

/** How wide a cell of the lookup grid is, in metres. */
const CELL = 16

/** How far either way a cell can lie and still have a key, in cells. */
const CELLS = 4_096

/**
 * The walls of a tile, ready to be asked what stands in front of one of them.
 *
 * Built once per mesh and asked once per wall, so the walls are sorted into a
 * grid first: a tile holds thousands of them, and comparing every wall against
 * every other is millions of pairs for a tile that lands in a moment.
 */
export class WallsNearby {
  private readonly walls: readonly Wall[]
  /** Two ends per wall, in plan: x0, z0, x1, z1. */
  private readonly ends: Float64Array
  /** Which walls reach into a cell of the grid. */
  private readonly cells = new Map<number, number[]>()

  constructor(walls: readonly Wall[]) {
    this.walls = walls
    this.ends = new Float64Array(walls.length * 4)
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w]
      if (!wall) continue
      const { x0, z0, x1, z1 } = endsOf(wall)
      this.ends[w * 4] = x0
      this.ends[w * 4 + 1] = z0
      this.ends[w * 4 + 2] = x1
      this.ends[w * 4 + 3] = z1
      const cx1 = cellOf(Math.max(x0, x1))
      const cz1 = cellOf(Math.max(z0, z1))
      for (let cz = cellOf(Math.min(z0, z1)); cz <= cz1; cz++) {
        for (let cx = cellOf(Math.min(x0, x1)); cx <= cx1; cx++) {
          const key = keyOf(cx, cz)
          const held = this.cells.get(key)
          if (held) held.push(w)
          else this.cells.set(key, [w])
        }
      }
    }
  }

  /**
   * Whether another building stands within `clearance` metres in front of a
   * wall.
   *
   * Asked at the three points along it the roads are asked at, and answered
   * for the wall as a whole once most of them are shut in: a wall with one end
   * against its neighbour and the rest of it open still faces the street, and
   * still takes its windows.
   */
  crowded(wall: Wall, clearance: number): boolean {
    if (!(clearance > 0)) return false
    const { x0, z0, x1, z1 } = endsOf(wall)
    let shut = 0
    for (const share of PROBES) {
      const x = x0 + (x1 - x0) * share
      const z = z0 + (z1 - z0) * share
      if (this.blocked(x, z, wall, clearance) && ++shut >= SHUT_IN) return true
    }
    return false
  }

  /**
   * How far a wall sees straight out from a point along it before another
   * building stands in the way, in metres and never past `reach`. The point is
   * given as a share of the way along the wall, as {@link PROBES} gives them.
   *
   * A road is only in front of a wall as far as this: a street behind the
   * building across the way is that building's street. Two long sheds either
   * side of a railway each see the other's flank, not the road beyond it.
   *
   * A building under {@link OVERLOOKS} of the wall's height is seen over rather
   * than into, the way a block of flats looks over the shop at its foot to the
   * street; shutting its whole face for that would leave half a town centre
   * blank.
   */
  sight(wall: Wall, share: number, reach: number): number {
    const { x0, z0, x1, z1 } = endsOf(wall)
    const x = x0 + (x1 - x0) * share
    const z = z0 + (z1 - z0) * share
    const ex = x + wall.normalX * reach
    const ez = z + wall.normalZ * reach
    const least = wall.high * OVERLOOKS
    let nearest = 1
    for (const held of this.cellsAlong(x, z, ex, ez)) {
      for (const w of held) {
        const other = this.walls[w]
        // Its own building is no neighbour here either, as below.
        if (!other || other.building === wall.building || other.high < least) continue
        const met = crossingAlong(
          x,
          z,
          ex,
          ez,
          this.ends[w * 4] ?? 0,
          this.ends[w * 4 + 1] ?? 0,
          this.ends[w * 4 + 2] ?? 0,
          this.ends[w * 4 + 3] ?? 0,
        )
        if (met < nearest) nearest = met
      }
    }
    return nearest * reach
  }

  /** Whether the short way a point on a wall looks runs into another building. */
  private blocked(x: number, z: number, wall: Wall, clearance: number): boolean {
    const ex = x + wall.normalX * clearance
    const ez = z + wall.normalZ * clearance
    for (const held of this.cellsAlong(x, z, ex, ez)) {
      for (const w of held) {
        const other = this.walls[w]
        // Its own building is no neighbour: the wings of one block do not
        // shut each other in, and the wall itself lies under this very point.
        if (!other || other.building === wall.building) continue
        const met = gapBetween(
          x,
          z,
          ex,
          ez,
          this.ends[w * 4] ?? 0,
          this.ends[w * 4 + 1] ?? 0,
          this.ends[w * 4 + 2] ?? 0,
          this.ends[w * 4 + 3] ?? 0,
        )
        if (met <= 0) return true
      }
    }
    return false
  }

  /**
   * The walls of every cell a line runs through, a cell's worth at a time.
   *
   * Two lines that cross do so inside a cell they are both in, so these hold
   * everything a sight line could meet. A wall reaching into more than one of
   * them comes up once for each.
   */
  private cellsAlong(x: number, z: number, ex: number, ez: number): number[][] {
    const found: number[][] = []
    const cx1 = cellOf(Math.max(x, ex))
    const cz1 = cellOf(Math.max(z, ez))
    for (let cz = cellOf(Math.min(z, ez)); cz <= cz1; cz++) {
      for (let cx = cellOf(Math.min(x, ex)); cx <= cx1; cx++) {
        const held = this.cells.get(keyOf(cx, cz))
        if (held) found.push(held)
      }
    }
    return found
  }
}

function cellOf(metres: number): number {
  return Math.floor(metres / CELL)
}

/** One number for a cell, since a Map keyed by a pair is slower to ask. */
function keyOf(cx: number, cz: number): number {
  return (cx + CELLS) * (CELLS * 2) + (cz + CELLS)
}
