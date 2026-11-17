import type { BufferGeometry } from 'three/webgpu'
import { shellOf } from './attributes.js'
import { at } from './roofPlan.js'
import { EdgeTable, weld } from './weld.js'

/**
 * Where a building folds, which is where its outline is drawn.
 *
 * PLATEAU builds a building out of flat faces and nothing else, so its outline
 * is wherever two of them meet at an angle: the rim of a roof, the corner where
 * two walls turn, the foot of a wall on its floor. The edge a building shows
 * against whatever lies behind it is one of these as well, seen from anywhere,
 * so they are found once for a mesh — as its tile lands, or as the outline is
 * turned on — and nothing is worked out again while the view moves.
 *
 * Faces meeting flat are one surface, however it was cut into triangles, and
 * nothing is drawn between them. Corners are welded within one building, so
 * two buildings standing wall to wall each keep their own edges, and the line
 * between them is drawn even where their fronts run on flush.
 *
 * An edge with a face on one side only is where the shell stops, and is drawn
 * as well: a wall standing on no floor, or one face's edge running past two of
 * another's, which meet it at a corner in between rather than at its ends.
 */

/**
 * Faces turning from each other by more than this at an edge fold there.
 *
 * Under it a surface is only bending: a curved front cut into flat strips, or
 * a roof laid out of pieces that do not quite agree.
 */
const FOLD = Math.cos((20 * Math.PI) / 180)

/** The lines along a mesh's folds, and which building each belongs to. */
export interface Creases {
  /** Both ends of each line, six numbers a line. */
  readonly segments: Float32Array
  /** Whose each line is, by the tile's own number for the building. */
  readonly owners: Int32Array
}

export function creasesOf(geometry: BufferGeometry): Creases | undefined {
  const shell = shellOf(geometry)
  if (!shell) return undefined
  const { position, normal, batch, indexed } = shell

  // Read through the attributes rather than their arrays: Draco hands some of
  // them back interleaved, where the array holds a stride's worth per vertex.
  const triangleCount = Math.floor(indexed.count / 3)
  const { pointOf, px, py, pz, buildingOf } = weld(position, batch)

  // Which way each face looks, out of the building
  const facingX = new Float32Array(triangleCount)
  const facingY = new Float32Array(triangleCount)
  const facingZ = new Float32Array(triangleCount)

  const edges = new EdgeTable(triangleCount * 3)
  /** The first face met along each edge, which the rest are held up against. */
  const firstFace = new Int32Array(triangleCount * 3).fill(-1)
  /** How many faces run along each edge. */
  const faces = new Int32Array(triangleCount * 3)
  /** 1 where a face along the edge turns from the first one by more than FOLD. */
  const folds = new Uint8Array(triangleCount * 3)

  /** Counts a face along an edge, and marks the edge where the face turns from the one before. */
  const along = (p: number, q: number, t: number): void => {
    const edge = edges.between(p, q, true)
    faces[edge] = at(faces, edge) + 1
    const first = at(firstFace, edge)
    if (first < 0) {
      firstFace[edge] = t
      return
    }
    const turn =
      at(facingX, first) * at(facingX, t) +
      at(facingY, first) * at(facingY, t) +
      at(facingZ, first) * at(facingZ, t)
    if (turn < FOLD) folds[edge] = 1
  }

  for (let t = 0; t < triangleCount; t++) {
    const first = indexed.getX(t * 3)
    const a = at(pointOf, first)
    const b = at(pointOf, indexed.getX(t * 3 + 1))
    const c = at(pointOf, indexed.getX(t * 3 + 2))
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
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (length === 0) continue
    // Tiles do not wind faces reliably; the stored normal tells the outside.
    const outside = nx * normal.getX(first) + ny * normal.getY(first) + nz * normal.getZ(first)
    const scale = (outside < 0 ? -1 : 1) / length
    facingX[t] = nx * scale
    facingY[t] = ny * scale
    facingZ[t] = nz * scale

    along(a, b, t)
    along(b, c, t)
    along(c, a, t)
  }

  const drawn = (edge: number): boolean => at(folds, edge) === 1 || at(faces, edge) === 1
  let count = 0
  for (let e = 0; e < edges.count; e++) if (drawn(e)) count++

  const segments = new Float32Array(count * 6)
  // A welded point is welded within its building, so both ends of an edge
  // belong to the same one and either end answers for it
  const owners = new Int32Array(count)
  let i = 0
  let line = 0
  for (let e = 0; e < edges.count; e++) {
    if (!drawn(e)) continue
    const p = at(edges.low, e)
    const q = at(edges.high, e)
    segments[i++] = at(px, p)
    segments[i++] = at(py, p)
    segments[i++] = at(pz, p)
    segments[i++] = at(px, q)
    segments[i++] = at(py, q)
    segments[i++] = at(pz, q)
    owners[line++] = at(buildingOf, p)
  }
  return { segments, owners }
}
