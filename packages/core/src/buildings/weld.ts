import type { Attribute } from './attributes.js'

/**
 * Which faces of a mesh meet along an edge.
 *
 * Faces keep their own copies of shared corners, so two faces meeting along an
 * edge share a place there rather than a vertex. Welding the copies by
 * position, within one building, tells which faces meet along an edge — what
 * a roof is read for to find its rim, and what the outline is read for to find
 * where a building folds.
 */

/** Points closer than this are one point when faces are matched up, in metres. */
const WELD = 0.01

/** A mesh's corners, with the copies its faces keep of each made one again. */
export interface Welded {
  /** The welded point each vertex is a copy of. */
  readonly pointOf: Uint32Array
  /** Where each welded point lies, in metres. */
  readonly px: Float64Array
  readonly py: Float64Array
  readonly pz: Float64Array
  /** Whose each welded point is, by the tile's own number for the building. */
  readonly buildingOf: Int32Array
}

/**
 * Welds the vertices of a mesh by where they lie and whose they are.
 *
 * The table that does the welding is open: a slot per point, reached by
 * hashing the rounded position with the building, and stepped along while
 * another point holds it. Naming a corner instead — the four numbers run
 * together into a string — is what made reading a mesh cost most of what it
 * costs, and a tile carries tens of thousands of corners.
 *
 * Read through the attributes rather than their arrays: Draco hands some of
 * them back interleaved, where the array holds a stride's worth per vertex.
 */
export function weld(position: Attribute, batch: Attribute): Welded {
  const vertexCount = position.count
  const pointOf = new Uint32Array(vertexCount)
  const roundedX = new Int32Array(vertexCount)
  const roundedY = new Int32Array(vertexCount)
  const roundedZ = new Int32Array(vertexCount)
  const building = new Int32Array(vertexCount)
  const xs = new Float64Array(vertexCount)
  const ys = new Float64Array(vertexCount)
  const zs = new Float64Array(vertexCount)
  // Half full at its fullest, so a run of taken slots stays short.
  const slotCount = 2 ** Math.ceil(Math.log2(Math.max(4, vertexCount * 2)))
  const slots = new Int32Array(slotCount).fill(-1)
  const mask = slotCount - 1
  let pointCount = 0
  for (let v = 0; v < vertexCount; v++) {
    const x = position.getX(v)
    const y = position.getY(v)
    const z = position.getZ(v)
    const rx = Math.round(x / WELD)
    const ry = Math.round(y / WELD)
    const rz = Math.round(z / WELD)
    const rb = batch.getX(v)
    let slot =
      (Math.imul(rx, 73856093) ^
        Math.imul(ry, 19349663) ^
        Math.imul(rz, 83492791) ^
        Math.imul(rb, 2654435761)) &
      mask
    for (;;) {
      const held = slots[slot] ?? -1
      if (held === -1) {
        slots[slot] = pointCount
        roundedX[pointCount] = rx
        roundedY[pointCount] = ry
        roundedZ[pointCount] = rz
        building[pointCount] = rb
        xs[pointCount] = x
        ys[pointCount] = y
        zs[pointCount] = z
        pointOf[v] = pointCount
        pointCount++
        break
      }
      if (roundedX[held] === rx && roundedY[held] === ry && roundedZ[held] === rz && building[held] === rb) {
        pointOf[v] = held
        break
      }
      slot = (slot + 1) & mask
    }
  }
  // Cut to the corners that were actually found: a plan is kept for as long
  // as its mesh is, and the room for the copies is not.
  return {
    pointOf,
    px: xs.slice(0, pointCount),
    py: ys.slice(0, pointCount),
    pz: zs.slice(0, pointCount),
    buildingOf: building.slice(0, pointCount),
  }
}

/**
 * Numbers the edges between welded points, the same number whichever way
 * round the two are given.
 *
 * Open like the table that welds the points, for the same reason: a tile runs
 * to tens of thousands of triangles, three edges each.
 */
export class EdgeTable {
  /** Each edge's lower point, and its higher one. */
  readonly low: Int32Array
  readonly high: Int32Array
  /** How many edges have been numbered. */
  count = 0
  private readonly slots: Int32Array
  private readonly mask: number

  /** Room for this many edges. */
  constructor(capacity: number) {
    // Half full at its fullest, like the points
    const slotCount = 2 ** Math.ceil(Math.log2(Math.max(4, capacity * 2)))
    this.slots = new Int32Array(slotCount).fill(-1)
    this.mask = slotCount - 1
    this.low = new Int32Array(capacity)
    this.high = new Int32Array(capacity)
  }

  /** The number of the edge between two points, or -1 where it is not one and none is to be made. */
  between(p: number, q: number, make: boolean): number {
    const low = p < q ? p : q
    const high = p < q ? q : p
    let slot = (Math.imul(low, 2246822519) ^ Math.imul(high, 3266489917)) & this.mask
    for (;;) {
      const held = this.slots[slot] ?? -1
      if (held === -1) {
        if (!make) return -1
        this.slots[slot] = this.count
        this.low[this.count] = low
        this.high[this.count] = high
        return this.count++
      }
      if (this.low[held] === low && this.high[held] === high) return held
      slot = (slot + 1) & this.mask
    }
  }
}
