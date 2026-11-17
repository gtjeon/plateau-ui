import type { BufferGeometry } from 'three/webgpu'
import { shellOf } from './attributes.js'
import { atOnce, pause, type Steps } from './steps.js'
import { EdgeTable, weld } from './weld.js'

/**
 * Flat roofs, and where a parapet could stand on one.
 *
 * A real roof is not a lid: a low wall runs along its edge and the roof inside
 * it sits lower. PLATEAU gives the lid, so a roof is read here for what a
 * parapet needs — which faces make up one roof, where its rim runs, and which
 * stretches of that rim already have something standing on them.
 *
 * None of it depends on how big the parapet is, so a mesh is read once and can
 * be cut to any size afterwards, over and over.
 *
 * Vertices reaching here have been stood upright and seated, so y is height in
 * metres above the ground the building stands on.
 */

/** Faces within 10° of straight up are flat roof. */
const FLAT = Math.cos((10 * Math.PI) / 180)
/** Neighbouring roof faces this close in height belong to one roof, in metres. */
const LEVEL_STEP = 0.3
/** Roofs whose heights spread wider than this are not flat enough to carve, in metres. */
const MAX_UNEVENNESS = 1
/** Faces rising more than this above a roof edge stand on the roof, so the edge gets no parapet. */
const RISE = 0.3
/** Roofs lower than this above the ground are not carved, in metres. */
const MIN_ROOF_HEIGHT = 3

/** The number at `i`, or nought past the end. */
export function at(values: ArrayLike<number>, i: number): number {
  return values[i] ?? 0
}

/** One closed run of a roof's rim. */
export interface Rim {
  /** Welded points in order, with the roof on the left. */
  readonly points: readonly number[]
  /** Unit normal of each edge (from a point to the next), pointing into the roof. */
  readonly normalX: Float64Array
  readonly normalZ: Float64Array
  /** 1 where the edge gets a parapet, 0 where a face rises from it. */
  readonly parapet: Uint8Array
}

/** One flat roof, rimmed and ready for a parapet of any size. */
export interface FlatRoof {
  /** The building it belongs to, whose number its carved corners take. */
  readonly building: number
  /** The triangles a carving replaces. */
  readonly members: readonly number[]
  readonly rims: readonly Rim[]
  /** Which of the rims runs around the roof; the rest are holes in it. */
  readonly outer: number
  /** Its lowest corner above the ground, in metres. */
  readonly low: number
  /** How much roof it is in plan, in square metres. */
  readonly area: number
}

/**
 * The flat roofs of one mesh, over the welded corners they were found in.
 *
 * Finding them is the long half of carving and none of it depends on the
 * parapet, so a mesh is read once and carved to whatever size is asked for.
 */
export interface RoofPlan {
  /** Plan positions of the welded corners, in metres. */
  readonly px: Float64Array
  readonly py: Float64Array
  readonly pz: Float64Array
  readonly roofs: readonly FlatRoof[]
}

/**
 * Reads the flat roofs of a mesh: which faces make up each one, where its rim
 * runs, and which of its edges a parapet would stand on rather than a wall
 * rising from the roof. Roofs too low or too uneven to carve, and ones pinched
 * where no rim can be followed, are left out — no parapet size would take them.
 */
export function planRoofs(geometry: BufferGeometry): RoofPlan | undefined {
  return atOnce(planningRoofs(geometry))
}

/**
 * {@link planRoofs} a piece at a time, for a tile being shaped between frames;
 * see `steps.ts`. It stops between triangles and between roofs, nowhere else.
 */
export function* planningRoofs(geometry: BufferGeometry): Steps<RoofPlan | undefined> {
  const shell = shellOf(geometry)
  if (!shell) return undefined
  const { position, normal, batch, indexed } = shell

  // Read through the attributes rather than their arrays: Draco hands some of
  // them back interleaved, where the array holds a stride's worth per vertex.
  const triangleCount = Math.floor(indexed.count / 3)

  const { pointOf, px, py, pz } = weld(position, batch)
  const pointCount = px.length
  yield

  // Each face's corners as welded points, the faces along each edge, and
  // which faces are flat roof.
  const corners = new Uint32Array(triangleCount * 3)
  const flat = new Uint8Array(triangleCount)
  /** 1 where the face is a face at all, and so stands along its edges. */
  const real = new Uint8Array(triangleCount)
  const heights = new Float64Array(triangleCount)

  // Edges are numbered in a table of their own, and the faces along them are
  // gathered afterwards into one flat list a run each. An edge holding a list
  // of its own would be three lists made per triangle, and a tile runs to
  // tens of thousands of triangles.
  const edges = new EdgeTable(triangleCount * 3)
  const edgeUses = new Int32Array(triangleCount * 3)
  /** The edge each corner of each face runs along. */
  const edgeOf = new Int32Array(triangleCount * 3).fill(-1)

  /** Counts one face along an edge and gives the edge its number. */
  const runsAlong = (p: number, q: number): number => {
    const edge = edges.between(p, q, true)
    edgeUses[edge] = at(edgeUses, edge) + 1
    return edge
  }
  for (let t = 0; t < triangleCount; t++) {
    if (pause(t)) yield
    const first = indexed.getX(t * 3)
    const a = at(pointOf, first)
    let b = at(pointOf, indexed.getX(t * 3 + 1))
    let c = at(pointOf, indexed.getX(t * 3 + 2))
    if (a === b || b === c || c === a) continue

    const abx = at(px, b) - at(px, a)
    const aby = at(py, b) - at(py, a)
    const abz = at(pz, b) - at(pz, a)
    const acx = at(px, c) - at(px, a)
    const acy = at(py, c) - at(py, a)
    const acz = at(pz, c) - at(pz, a)
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    // Metres, nowhere near what a float cannot hold, so the plain root is
    // right and several times quicker than the careful one.
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (length === 0) continue
    // Tiles do not wind faces reliably; the stored normal tells the outside.
    const outside = nx * normal.getX(first) + ny * normal.getY(first) + nz * normal.getZ(first)
    if ((outside < 0 ? -ny : ny) / length >= FLAT) {
      flat[t] = 1
      // Every roof face winds the same way in plan, so a roof lies to the
      // left of its edges.
      if (abx * acz - abz * acx < 0) [b, c] = [c, b]
    }
    corners[t * 3] = a
    corners[t * 3 + 1] = b
    corners[t * 3 + 2] = c
    heights[t] = (at(py, a) + at(py, b) + at(py, c)) / 3
    real[t] = 1
    edgeOf[t * 3] = runsAlong(a, b)
    edgeOf[t * 3 + 1] = runsAlong(b, c)
    edgeOf[t * 3 + 2] = runsAlong(c, a)
  }

  // Every edge's faces, one run after another.
  const edgeCount = edges.count
  const edgeAt = new Int32Array(edgeCount + 1)
  for (let e = 0; e < edgeCount; e++) edgeAt[e + 1] = at(edgeAt, e) + at(edgeUses, e)
  const edgeFaces = new Int32Array(at(edgeAt, edgeCount))
  const filled = new Int32Array(edgeCount)
  yield
  for (let t = 0; t < triangleCount; t++) {
    if (!real[t]) continue
    for (let k = 0; k < 3; k++) {
      const edge = at(edgeOf, t * 3 + k)
      edgeFaces[at(edgeAt, edge) + at(filled, edge)] = t
      filled[edge] = at(filled, edge) + 1
    }
  }

  const regionOf = new Int32Array(triangleCount).fill(-1)
  const roofs: FlatRoof[] = []

  /** Whether a face other than the roof's own rises from an edge of its rim. */
  const rises = (p: number, q: number, region: number): boolean => {
    const top = Math.max(at(py, p), at(py, q)) + RISE
    const edge = edges.between(p, q, false)
    if (edge < 0) return false
    for (let i = at(edgeAt, edge); i < at(edgeAt, edge + 1); i++) {
      const t = at(edgeFaces, i)
      if (at(regionOf, t) === region) continue
      for (let k = 0; k < 3; k++) {
        const r = at(corners, t * 3 + k)
        if (r !== p && r !== q && at(py, r) > top) return true
      }
    }
    return false
  }

  /**
   * Reads one flat roof made of the given faces. Nothing where no parapet, of
   * any size, could stand on it.
   */
  const read = (members: readonly number[], region: number): FlatRoof | undefined => {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    const edges = new Set<number>()
    for (const t of members) {
      for (let k = 0; k < 3; k++) {
        const p = at(corners, t * 3 + k)
        edges.add(p * pointCount + at(corners, t * 3 + ((k + 1) % 3)))
        low = Math.min(low, at(py, p))
        high = Math.max(high, at(py, p))
      }
    }
    if (low < MIN_ROOF_HEIGHT || high - low > MAX_UNEVENNESS) return undefined

    // Edges without a twin run along the rim. Every rim point needs exactly
    // one rim edge out and one in; otherwise the roof is pinched there.
    const next = new Map<number, number>()
    for (const edge of edges) {
      const p = Math.floor(edge / pointCount)
      const q = edge % pointCount
      if (edges.has(q * pointCount + p)) continue
      if (next.has(p)) return undefined
      next.set(p, q)
    }
    const reached = new Set<number>()
    for (const q of next.values()) {
      if (reached.has(q) || !next.has(q)) return undefined
      reached.add(q)
    }

    const rims: Rim[] = []
    const seen = new Set<number>()
    let outer = -1
    let parapets = 0
    let doubleArea = 0
    for (const start of next.keys()) {
      if (seen.has(start)) continue
      const points: number[] = []
      for (let p = start; !seen.has(p); p = next.get(p) ?? start) {
        seen.add(p)
        points.push(p)
      }
      const count = points.length
      if (count < 3) return undefined

      const normalX = new Float64Array(count)
      const normalZ = new Float64Array(count)
      const parapet = new Uint8Array(count)
      let rimArea = 0
      for (let j = 0; j < count; j++) {
        const p = at(points, j)
        const q = at(points, (j + 1) % count)
        const dx = at(px, q) - at(px, p)
        const dz = at(pz, q) - at(pz, p)
        const length = Math.sqrt(dx * dx + dz * dz)
        if (length < 1e-6) return undefined
        normalX[j] = -dz / length
        normalZ[j] = dx / length
        parapet[j] = rises(p, q, region) ? 0 : 1
        parapets += at(parapet, j)
        rimArea += at(px, p) * at(pz, q) - at(px, q) * at(pz, p)
      }
      if (rimArea > 0) {
        // A connected roof has one outer rim; any other rim is a hole.
        if (outer >= 0) return undefined
        outer = rims.length
      }
      doubleArea += rimArea
      rims.push({ points, normalX, normalZ, parapet })
    }
    if (outer < 0 || parapets === 0) return undefined
    return {
      // Every face of a roof belongs to one building, so any of them says
      // whose corners a carving of it adds.
      building: batch.getX(indexed.getX(at(members, 0) * 3)),
      members,
      rims,
      outer,
      low,
      area: doubleArea / 2,
    }
  }

  yield
  let regions = 0
  for (let t = 0; t < triangleCount; t++) {
    if (pause(t)) yield
    if (!flat[t] || at(regionOf, t) !== -1) continue
    const region = regions++
    const members = [t]
    regionOf[t] = region
    for (let m = 0; m < members.length; m++) {
      const s = at(members, m)
      for (let k = 0; k < 3; k++) {
        const edge = at(edgeOf, s * 3 + k)
        for (let i = at(edgeAt, edge); i < at(edgeAt, edge + 1); i++) {
          const n = at(edgeFaces, i)
          if (!flat[n] || at(regionOf, n) !== -1) continue
          if (Math.abs(at(heights, n) - at(heights, s)) > LEVEL_STEP) continue
          regionOf[n] = region
          members.push(n)
        }
      }
    }
    const roof = read(members, region)
    if (roof) roofs.push(roof)
  }

  return { px, py, pz, roofs }
}
