import { BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, Matrix4 } from 'three/webgpu'

/**
 * Carving the shapes trees are made from.
 *
 * Three kinds, carved once apiece, and the card stands them again and again
 * over every plot. Few faces, each one flat-shaded, so a tree reads as folded
 * paper the way the buildings beside it do.
 *
 * No colour is baked in. A corner only says whether it is leaf or trunk, and
 * the material holds what those are, so going between the light set and the
 * dark one does not carve anything again.
 */

/** The kinds of tree. */
export type TreeKind = 'conifer' | 'broadleaf' | 'shrub'

/**
 * One carved tree.
 *
 * Kept as arrays rather than as a geometry: every tile weaves a geometry of
 * its own pointing straight at these, so the carving happens once and the
 * freeing happens tile by tile.
 */
export interface TreeShape {
  readonly kind: TreeKind
  /** The tree at a height of one, standing on y=0 about the origin. */
  readonly positions: Float32Array
  /** A normal per face, so every fold shows. */
  readonly normals: Float32Array
  /**
   * The normals of the faces meeting at a point, averaged: which way the
   * outline's shell is pushed. Pushed by the folded normals instead, the
   * shell would come apart face from face and gape at every edge.
   */
  readonly hullNormals: Float32Array
  /** 1 for leaf, 0 for trunk, on every corner. */
  readonly leafness: Float32Array
  /** How far it reaches sideways from the middle, at a height of one. */
  readonly reach: number
  /** How tall this kind really grows, in metres. */
  readonly height: readonly [least: number, most: number]
  /** How often this kind comes up. The three add to one. */
  readonly share: number
}

/** The tallest a tree grows, in metres: what the sun's view is widened by. */
export const TALLEST_TREE = 13

/** Corners closer than this count as the same place, at a height of one. */
const WELD = 1e-4

const MOVE = new Matrix4()

/**
 * Carves one set of the three.
 *
 * A conifer is skirts stacked up, a broadleaf two masses set on a trunk, a
 * shrub one low mass. Broadleaves have the largest share, which is what a
 * city's parks and street trees are.
 */
export function cutTrees(): TreeShape[] {
  return [conifer(), broadleaf(), shrub()]
}

/** Four skirts, each narrower than the last, on a bare trunk. */
function conifer(): TreeShape {
  const pieces = [piece(new CylinderGeometry(0.022, 0.032, 0.34, 5), 0, 0, 0.17, 0)]
  for (let tier = 0; tier < 4; tier++) {
    pieces.push(piece(new ConeGeometry(0.21 - tier * 0.043, 0.3, 7), 1, 0, 0.24 + tier * 0.185, 0))
  }
  return stand('conifer', pieces, [7, 13], 0.22)
}

/** Two masses on a trunk, set off to one side of each other. */
function broadleaf(): TreeShape {
  const crown = new IcosahedronGeometry(0.33, 0)
  crown.scale(1, 0.88, 1)
  const side = new IcosahedronGeometry(0.21, 0)
  side.scale(1, 0.9, 1)
  const pieces = [
    piece(new CylinderGeometry(0.026, 0.038, 0.62, 5), 0, 0, 0.31, 0),
    piece(crown, 1, 0, 0.68, 0),
    piece(side, 1, 0.16, 0.53, -0.1),
  ]
  return stand('broadleaf', pieces, [6, 11], 0.48)
}

/** One low mass: hedges and bushes. */
function shrub(): TreeShape {
  const body = new IcosahedronGeometry(0.5, 0)
  body.scale(1, 0.72, 1)
  const bud = new IcosahedronGeometry(0.3, 0)
  bud.scale(1, 0.8, 1)
  const pieces = [piece(body, 1, 0, 0.36, 0), piece(bud, 1, 0.24, 0.26, 0.16)]
  return stand('shrub', pieces, [1.6, 2.8], 0.3)
}

/** The corners of one carved piece, and whether it is leaf or trunk. */
interface Piece {
  positions: Float32Array
  leafness: number
}

/**
 * Moves one piece where it belongs and takes its corners off it.
 *
 * Cones and cylinders arrive sharing corners and the masses do not. Faces
 * each want a normal of their own, which sharing cannot give, so everything
 * is pulled apart here.
 */
function piece(source: BufferGeometry, leafness: number, x: number, y: number, z: number): Piece {
  const flat = source.index ? source.toNonIndexed() : source
  if (flat !== source) source.dispose()
  flat.applyMatrix4(MOVE.makeTranslation(x, y, z))
  const positions = Float32Array.from(flat.getAttribute('position').array)
  flat.dispose()
  return { positions, leafness }
}

/** Joins the pieces and stands the result at a height of one about the origin. */
function stand(
  kind: TreeKind,
  pieces: readonly Piece[],
  height: readonly [number, number],
  share: number,
): TreeShape {
  let length = 0
  for (const part of pieces) length += part.positions.length

  const positions = new Float32Array(length)
  const leafness = new Float32Array(length / 3)
  let at = 0
  let vertex = 0
  for (const part of pieces) {
    positions.set(part.positions, at)
    at += part.positions.length
    for (let i = 0; i < part.positions.length / 3; i++) leafness[vertex++] = part.leafness
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxY = Math.max(maxY, positions[i + 1]!)
    minZ = Math.min(minZ, positions[i + 2]!)
    maxZ = Math.max(maxZ, positions[i + 2]!)
  }
  const scale = 1 / Math.max(maxY - minY, 1e-3)
  const midX = (minX + maxX) / 2
  const midZ = (minZ + maxZ) / 2
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i]! - midX) * scale
    positions[i + 1] = (positions[i + 1]! - minY) * scale
    positions[i + 2] = (positions[i + 2]! - midZ) * scale
  }

  let reach = 0
  for (let i = 0; i < positions.length; i += 3) {
    reach = Math.max(reach, Math.abs(positions[i]!), Math.abs(positions[i + 2]!))
  }

  const normals = facetNormals(positions)
  const hullNormals = weldedNormals(positions, normals)
  return { kind, positions, normals, hullNormals, leafness, reach, height, share }
}

/** A normal per face, so every fold shows. */
function facetNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!
    const ay = positions[i + 1]!
    const az = positions[i + 2]!
    const ux = positions[i + 3]! - ax
    const uy = positions[i + 4]! - ay
    const uz = positions[i + 5]! - az
    const vx = positions[i + 6]! - ax
    const vy = positions[i + 7]! - ay
    const vz = positions[i + 8]! - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    for (let v = 0; v < 3; v++) {
      normals[i + v * 3] = nx
      normals[i + v * 3 + 1] = ny
      normals[i + v * 3 + 2] = nz
    }
  }
  return normals
}

/** The normals meeting at a point, averaged: which way the shell is pushed. */
function weldedNormals(positions: Float32Array, facets: Float32Array): Float32Array {
  const sums = new Map<string, [number, number, number]>()
  const keyOf = (v: number): string =>
    `${Math.round(positions[v]! / WELD)},${Math.round(positions[v + 1]! / WELD)},${Math.round(
      positions[v + 2]! / WELD,
    )}`

  for (let v = 0; v < positions.length; v += 3) {
    const key = keyOf(v)
    const sum = sums.get(key) ?? [0, 0, 0]
    sum[0] += facets[v]!
    sum[1] += facets[v + 1]!
    sum[2] += facets[v + 2]!
    sums.set(key, sum)
  }

  const normals = new Float32Array(positions.length)
  for (let v = 0; v < positions.length; v += 3) {
    const [x, y, z] = sums.get(keyOf(v)) ?? [0, 1, 0]
    const length = Math.hypot(x, y, z) || 1
    normals[v] = x / length
    normals[v + 1] = y / length
    normals[v + 2] = z / length
  }
  return normals
}
