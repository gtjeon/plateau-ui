import earcut from 'earcut'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import { BATCH_ID, copyAhead, sameWidthAs, shellOf } from './attributes.js'
import { positiveMetres } from './lengths.js'
import { at, type FlatRoof, type Rim, type RoofPlan } from './roofPlan.js'
import { atOnce, pause, type Steps } from './steps.js'

/**
 * Cutting the parapet in.
 *
 * Each flat roof loses its lid and gains three things in its place: the tops
 * of the walls, a ring between the rim and the rim moved inwards; their inner
 * faces, carried down; and the sunken roof itself. The rim only ever moves
 * inwards, so a carved building keeps the footprint it came with.
 *
 * Roofs smaller than the size asks for, and ones too narrow anywhere to hold
 * it, are left whole and counted.
 */

/** The sunken part of a roof must be at least this wide everywhere, so no sliver is carved, in metres. */
const MIN_OPENING = 0.1
/** A corner may push a parapet's inner edge at most this many thicknesses from the rim. */
const MAX_MITER = 4
/** Edges turning less than this (the sine of the turn) run straight on. */
const STRAIGHT = 0.02
/**
 * A roof whose rims come to more corners than this is left whole.
 *
 * Checking that a rim moved in has not crossed itself compares the edges that
 * could reach each other, which is nearly the number of edges and, on a roof
 * folded back on itself over and over, nearly its square. Real roofs run to
 * tens of corners; nothing near this is a roof anyone drew.
 */
const MAX_RIM_CORNERS = 4096

/** How big a parapet to cut, in metres. */
export interface ParapetSize {
  /** How thick the low wall along the roof's edge is. */
  readonly thickness: number
  /** How far the roof inside it sinks. Low buildings sink less. */
  readonly depth: number
  /** Roofs smaller than this are left as they are, in square metres. */
  readonly minArea: number
}

/** 65 cm thick and a metre deep, on roofs of 46 m² or more. */
export const DEFAULT_PARAPET: ParapetSize = Object.freeze({ thickness: 0.65, depth: 1, minArea: 46 })

/** The parapet a city cuts into its flat roofs, as a page asks for it; see {@link Parapet}. */
export interface ParapetOptions {
  /** Whether it is cut. Defaults to `true`. */
  visible?: boolean
  /** How thick the low wall along the roof's edge is, in metres. Defaults to 0.65. */
  thickness?: number
  /** How far the roof inside it sinks, in metres. Low buildings sink less. Defaults to 1. */
  depth?: number
  /** Roofs smaller than this are left as they are, in square metres. Defaults to 46. */
  minArea?: number
}

/**
 * The parapet cut into every flat roof, the way a real one is built; see
 * {@link Buildings.parapet}.
 *
 * A part of the layer with settings of its own, the way three's `light.shadow`
 * is: the names {@link ParapetOptions} takes, each read and written here.
 * Writing any of them cuts the roofs on screen again, from the shape they came
 * in rather than from the last carving — each mesh keeps the plan of its roofs
 * — so a new size never cuts a parapet into a parapet. Taken off with
 * `visible`, the size is kept for putting it back.
 *
 * A width is trusted once it is in here: it is what a rim is moved in by, and
 * a negative or absent one moves it outwards instead, which shows as a mitre
 * turned inside out over the street rather than as an error. So each is
 * checked as it is written, and refused there with a RangeError.
 */
export class Parapet {
  private _visible: boolean
  private _thickness: number
  private _depth: number
  private _minArea: number

  /**
   * @internal Made by the layer the parapet is part of. `recut` is how that
   * layer is told the roofs want cutting again.
   */
  constructor(
    asked: ParapetOptions,
    private readonly recut: () => void,
  ) {
    // Field by field rather than spread: a field given as undefined asks for
    // the default, and spreading it would put the undefined over the default
    // and then refuse it.
    this._visible = asked.visible ?? true
    this._thickness = positiveMetres(asked.thickness ?? DEFAULT_PARAPET.thickness, 'parapet thickness')
    this._depth = positiveMetres(asked.depth ?? DEFAULT_PARAPET.depth, 'parapet depth')
    this._minArea = squareMetres(asked.minArea ?? DEFAULT_PARAPET.minArea)
  }

  /** Whether it is cut. The size is kept while it is not. */
  get visible(): boolean {
    return this._visible
  }

  set visible(on: boolean) {
    if (on === this._visible) return
    this._visible = on
    this.recut()
  }

  /** How thick the low wall along the roof's edge is, in metres. */
  get thickness(): number {
    return this._thickness
  }

  set thickness(value: number) {
    const next = positiveMetres(value, 'parapet thickness')
    if (next === this._thickness) return
    this._thickness = next
    // Nothing standing is cut to a size while it is off, so nothing is cut again
    if (this._visible) this.recut()
  }

  /** How far the roof inside it sinks, in metres. */
  get depth(): number {
    return this._depth
  }

  set depth(value: number) {
    const next = positiveMetres(value, 'parapet depth')
    if (next === this._depth) return
    this._depth = next
    if (this._visible) this.recut()
  }

  /** Roofs smaller than this are left as they are, in square metres. */
  get minArea(): number {
    return this._minArea
  }

  set minArea(value: number) {
    const next = squareMetres(value)
    if (next === this._minArea) return
    this._minArea = next
    if (this._visible) this.recut()
  }
}

/**
 * The size a parapet is cut to, or null where the roofs are left whole.
 *
 * A function and not a member, so that what the carving reads is not a
 * fifth name on the part a page writes to.
 */
export function parapetSize(parapet: Parapet): ParapetSize | null {
  if (!parapet.visible) return null
  return { thickness: parapet.thickness, depth: parapet.depth, minArea: parapet.minArea }
}

/** An area that may be nothing but not less, or a RangeError saying so. */
function squareMetres(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`parapet minArea must be a number of square metres, not ${value}`)
  }
  return value
}

/** How a mesh's flat roofs took to the parapet asked for. */
export interface RoofTally {
  /** Roofs that took one. */
  readonly cut: number
  /** Roofs left whole for being smaller than the size asks for. */
  readonly tooSmall: number
  /** Roofs left whole for being too narrow anywhere to hold it. */
  readonly tooNarrow: number
}

/** A mesh carved, and what became of its roofs. */
export interface Carved extends RoofTally {
  /** The mesh recut, or nothing where no roof took a parapet. */
  readonly geometry: BufferGeometry | undefined
}

/** No roofs, so nothing to say about them. */
const NO_ROOFS: Carved = { geometry: undefined, cut: 0, tooSmall: 0, tooNarrow: 0 }

/** A rim moved into its roof. */
interface Inset {
  readonly x: readonly number[]
  readonly z: readonly number[]
  /** The rim point (its index in the rim) each inner point comes from. */
  readonly source: readonly number[]
  /**
   * First and last inner point of each rim point. They differ where a parapet
   * ends on a straight run, which leaves the parapet a square end.
   */
  readonly first: Int32Array
  readonly last: Int32Array
}

/**
 * Cuts a parapet into every roof of a mesh that can hold one.
 *
 * Each roof loses its lid and gains three things in its place: the tops of the
 * parapets, a ring between the rim and the rim moved in; the faces below them,
 * carried down to the floor; and the floor itself. Roofs smaller than the size
 * asks for, and ones too narrow anywhere to hold it, are left whole.
 *
 * No geometry comes back where no roof took a parapet, so the mesh can stay
 * as it is; the tally says how many were left and why, which is otherwise
 * invisible — a roof passed over looks like one that was never there.
 */
export function carveRoofs(geometry: BufferGeometry, plan: RoofPlan, size: ParapetSize): Carved {
  return atOnce(carvingRoofs(geometry, plan, size))
}

/**
 * {@link carveRoofs} a piece at a time, for a tile being shaped between frames;
 * see `steps.ts`. It stops between roofs and between triangles, and builds the
 * new shape in one piece at the end.
 */
export function* carvingRoofs(geometry: BufferGeometry, plan: RoofPlan, size: ParapetSize): Steps<Carved> {
  const shell = shellOf(geometry)
  if (!shell) return NO_ROOFS
  const { position, normal, batch, indexed } = shell

  const { px, py, pz, roofs } = plan
  const vertexCount = position.count
  const triangleCount = Math.floor(indexed.count / 3)

  const addedPositions: number[] = []
  const addedNormals: number[] = []
  const addedIndices: number[] = []
  const addedBuildings: number[] = []
  /** The building whose roof is being carved, for the corners it adds. */
  let carving = 0
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    addedPositions.push(x, y, z)
    addedNormals.push(nx, ny, nz)
    addedBuildings.push(carving)
    return vertexCount + addedPositions.length / 3 - 1
  }

  /** Moves a rim in by a width per edge, or null where a corner is too sharp. */
  const inset = (rim: Rim, width: (edge: number) => number): Inset | null => {
    const count = rim.points.length
    const x: number[] = []
    const z: number[] = []
    const source: number[] = []
    const first = new Int32Array(count)
    const last = new Int32Array(count)
    for (let j = 0; j < count; j++) {
      const i = (j + count - 1) % count
      const ax = at(rim.normalX, i)
      const az = at(rim.normalZ, i)
      const bx = at(rim.normalX, j)
      const bz = at(rim.normalZ, j)
      const wa = width(i)
      const wb = width(j)
      const p = at(rim.points, j)
      first[j] = x.length
      const det = ax * bz - az * bx
      if (Math.abs(det) < STRAIGHT) {
        if (ax * bx + az * bz < 0) return null
        // Straight on. Where the width changes, the parapet ends square.
        x.push(at(px, p) + ax * wa)
        z.push(at(pz, p) + az * wa)
        source.push(j)
        if (wa !== wb) {
          x.push(at(px, p) + bx * wb)
          z.push(at(pz, p) + bz * wb)
          source.push(j)
        }
      } else {
        // Where both edges meet once each moved in by its width.
        const ox = (wa * bz - wb * az) / det
        const oz = (ax * wb - bx * wa) / det
        if (Math.sqrt(ox * ox + oz * oz) > MAX_MITER * Math.max(wa, wb)) return null
        x.push(at(px, p) + ox)
        z.push(at(pz, p) + oz)
        source.push(j)
      }
      last[j] = x.length - 1
    }
    return { x, z, source, first, last }
  }

  /**
   * Whether rims moved in still outline a roof: no edge turned around and no
   * two edges cross. Otherwise the roof is too narrow somewhere.
   */
  const keepsShape = (rims: readonly Rim[], insets: readonly Inset[]): boolean => {
    const segments: number[] = []
    for (let r = 0; r < rims.length; r++) {
      const rim = rims[r]
      const moved = insets[r]
      if (!rim || !moved) return false
      const count = rim.points.length
      for (let j = 0; j < count; j++) {
        const k = (j + 1) % count
        const p = at(rim.points, j)
        const q = at(rim.points, k)
        const from = at(moved.last, j)
        const to = at(moved.first, k)
        const along =
          (at(px, q) - at(px, p)) * (at(moved.x, to) - at(moved.x, from)) +
          (at(pz, q) - at(pz, p)) * (at(moved.z, to) - at(moved.z, from))
        if (along <= 0) return false
      }
      const n = moved.x.length
      for (let k = 0; k < n; k++) {
        const l = (k + 1) % n
        segments.push(at(moved.x, k), at(moved.z, k), at(moved.x, l), at(moved.z, l))
      }
    }
    // Edges are compared in order of where they begin, and a pair is left
    // alone as soon as one begins past where the other ends: nothing further
    // along can reach back either. Comparing every pair meant the square of
    // the corner count for roofs that are mostly corners.
    const count = segments.length / 4
    if (count > MAX_RIM_CORNERS) return false
    const from = new Float64Array(count)
    const to = new Float64Array(count)
    const order = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      const ax = at(segments, i * 4)
      const bx = at(segments, i * 4 + 2)
      from[i] = Math.min(ax, bx)
      to[i] = Math.max(ax, bx)
      order[i] = i
    }
    order.sort((a, b) => at(from, a) - at(from, b))
    for (let i = 0; i < count; i++) {
      const a = at(order, i)
      for (let j = i + 1; j < count; j++) {
        const b = at(order, j)
        if (at(from, b) > at(to, a)) break
        if (crosses(segments, a * 4, b * 4)) return false
      }
    }
    return true
  }

  /** Carves one flat roof. False leaves it as it is, too narrow to hold one. */
  const carve = (roof: FlatRoof): boolean => {
    const { rims, outer, low } = roof
    carving = roof.building

    // A roof too narrow somewhere for its parapet stays whole.
    const probes: Inset[] = []
    const insets: Inset[] = []
    for (const rim of rims) {
      const thickness = (edge: number): number => (at(rim.parapet, edge) ? size.thickness : 0)
      const probe = inset(rim, (edge) => thickness(edge) + MIN_OPENING / 2)
      const moved = inset(rim, thickness)
      if (!probe || !moved) return false
      probes.push(probe)
      insets.push(moved)
    }
    if (!keepsShape(rims, probes)) return false

    // The outer rim first, then the holes.
    const order = [outer]
    for (let r = 0; r < rims.length; r++) if (r !== outer) order.push(r)
    const coords: number[] = []
    const holes: number[] = []
    for (const r of order) {
      const moved = insets[r]
      if (!moved) return false
      if (r !== outer) holes.push(coords.length / 2)
      for (let k = 0; k < moved.x.length; k++) coords.push(at(moved.x, k), at(moved.z, k))
    }
    const triangles = earcut(coords, holes, 2)
    if (triangles.length === 0) return false

    // Low buildings sink less, so the pit never swallows them.
    const floor = low - Math.min(size.depth, low / 3)

    // The sunken roof. Facing up winds the other way in plan from the rim.
    const base = vertexCount + addedPositions.length / 3
    for (let i = 0; i < coords.length; i += 2) {
      vertex(at(coords, i), floor, at(coords, i + 1), 0, 1, 0)
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const a = at(triangles, i)
      const b = at(triangles, i + 1)
      const c = at(triangles, i + 2)
      const turn =
        (at(coords, 2 * b) - at(coords, 2 * a)) * (at(coords, 2 * c + 1) - at(coords, 2 * a + 1)) -
        (at(coords, 2 * b + 1) - at(coords, 2 * a + 1)) * (at(coords, 2 * c) - at(coords, 2 * a))
      if (turn > 0) addedIndices.push(base + a, base + c, base + b)
      else addedIndices.push(base + a, base + b, base + c)
    }

    for (let r = 0; r < rims.length; r++) {
      const rim = rims[r]
      const moved = insets[r]
      if (!rim || !moved) continue

      // Tops of the parapets, between the rim and its inner edge.
      const count = rim.points.length
      for (let j = 0; j < count; j++) {
        if (!at(rim.parapet, j)) continue
        const k = (j + 1) % count
        const p = at(rim.points, j)
        const q = at(rim.points, k)
        const from = at(moved.last, j)
        const to = at(moved.first, k)
        const rimA = vertex(at(px, p), at(py, p), at(pz, p), 0, 1, 0)
        const rimB = vertex(at(px, q), at(py, q), at(pz, q), 0, 1, 0)
        const innerB = vertex(at(moved.x, to), at(py, q), at(moved.z, to), 0, 1, 0)
        const innerA = vertex(at(moved.x, from), at(py, p), at(moved.z, from), 0, 1, 0)
        addedIndices.push(rimA, innerB, rimB, rimA, innerA, innerB)
      }

      // The parapets' inner faces, and faces rising from the roof carried
      // down to the sunken roof. All of them face the roof.
      const n = moved.x.length
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % n
        const ax = at(moved.x, a)
        const az = at(moved.z, a)
        const bx = at(moved.x, b)
        const bz = at(moved.z, b)
        const length = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az))
        if (length < 1e-6) continue
        const nx = -(bz - az) / length
        const nz = (bx - ax) / length
        const topA = at(py, at(rim.points, at(moved.source, a)))
        const topB = at(py, at(rim.points, at(moved.source, b)))
        const lowA = vertex(ax, floor, az, nx, 0, nz)
        const lowB = vertex(bx, floor, bz, nx, 0, nz)
        const highB = vertex(bx, topB, bz, nx, 0, nz)
        const highA = vertex(ax, topA, az, nx, 0, nz)
        addedIndices.push(lowA, lowB, highB, lowA, highB, highA)
      }
    }
    return true
  }

  const removed = new Uint8Array(triangleCount)
  let cut = 0
  let tooSmall = 0
  let tooNarrow = 0
  for (const [r, roof] of roofs.entries()) {
    if (r > 0) yield
    if (roof.area < size.minArea) {
      tooSmall++
      continue
    }
    if (!carve(roof)) {
      tooNarrow++
      continue
    }
    cut++
    for (const member of roof.members) removed[member] = 1
  }
  if (addedIndices.length === 0) return { geometry: undefined, cut, tooSmall, tooNarrow }

  yield
  let kept = 0
  for (let t = 0; t < triangleCount; t++) if (!removed[t]) kept++
  const outIndex = new Uint32Array(kept * 3 + addedIndices.length)
  let o = 0
  for (let t = 0; t < triangleCount; t++) {
    if (pause(t)) yield
    if (removed[t]) continue
    outIndex[o++] = indexed.getX(t * 3)
    outIndex[o++] = indexed.getX(t * 3 + 1)
    outIndex[o++] = indexed.getX(t * 3 + 2)
  }
  outIndex.set(addedIndices, o)

  const added = addedPositions.length / 3
  const outPositions = new Float32Array((vertexCount + added) * 3)
  const outNormals = new Float32Array((vertexCount + added) * 3)
  copyAhead(outPositions, position, vertexCount, 3)
  copyAhead(outNormals, normal, vertexCount, 3)
  outPositions.set(addedPositions, vertexCount * 3)
  outNormals.set(addedNormals, vertexCount * 3)

  // A carving adds corners to buildings that are already there, never a new
  // building, so whatever width the numbers came in still holds them. Widening
  // them to the largest there is cost four bytes a vertex for nothing.
  const outBuildings = sameWidthAs(batch, vertexCount + added)
  copyAhead(outBuildings, batch, vertexCount, 1)
  outBuildings.set(addedBuildings, vertexCount)

  const carved = new BufferGeometry()
  carved.setAttribute('position', new BufferAttribute(outPositions, 3))
  carved.setAttribute('normal', new BufferAttribute(outNormals, 3))
  carved.setAttribute(BATCH_ID, new BufferAttribute(outBuildings, 1))
  carved.setIndex(new BufferAttribute(outIndex, 1))

  // Anything else the mesh was carrying — what its walls say about the windows
  // set into them — comes along untouched. A parapet is not a wall and takes
  // no windows, so the corners it adds are left at nought.
  for (const name of Object.keys(geometry.attributes)) {
    if (name === 'position' || name === 'normal' || name === BATCH_ID) continue
    const along = geometry.attributes[name]
    if (!along) continue
    const out = sameWidthAs(along, (vertexCount + added) * along.itemSize)
    copyAhead(out, along, vertexCount, along.itemSize)
    carved.setAttribute(name, new BufferAttribute(out, along.itemSize))
  }
  carved.computeBoundingSphere()
  return { geometry: carved, cut, tooSmall, tooNarrow }
}

/**
 * Whether two segments in a flat list of [x1, z1, x2, z2] cross, not counting
 * a shared end.
 */
function crosses(segments: readonly number[], a: number, b: number): boolean {
  const side = (from: number, x: number, z: number): number => {
    const value =
      (at(segments, from + 2) - at(segments, from)) * (z - at(segments, from + 1)) -
      (at(segments, from + 3) - at(segments, from + 1)) * (x - at(segments, from))
    return Math.abs(value) < 1e-9 ? 0 : Math.sign(value)
  }
  return (
    side(a, at(segments, b), at(segments, b + 1)) * side(a, at(segments, b + 2), at(segments, b + 3)) < 0 &&
    side(b, at(segments, a), at(segments, a + 1)) * side(b, at(segments, a + 2), at(segments, a + 3)) < 0
  )
}
