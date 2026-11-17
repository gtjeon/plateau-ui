import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  Quaternion,
  Sphere,
  Vector3,
  type MeshBasicNodeMaterial,
  type MeshStandardNodeMaterial,
  type Object3D,
} from 'three/webgpu'
import { APPEAR, CLEAR_OF_THE_GROUND, whenOf, type Way } from '../appear.js'
import { PICTURE_ONLY } from '../passes.js'
import { notPicked } from '../pick.js'
import type { PolygonMesh } from '../polygons.js'
import { randomFrom, scatterOver } from './scatter.js'
import type { TreeShape } from './treeShapes.js'

/**
 * Standing trees on the green of one tile.
 *
 * A tree is something laid on the ground rather than something to click. One
 * is carved per kind and the card draws that one again at every place it
 * stands. A tile holds all of its own, so a tile leaving the screen takes its
 * trees with it.
 */

/** The most trees one tile stands. However close the spacing, no more than this. */
const MAX_PER_TILE = 1_200

/**
 * The four attributes that carry where each tree stands: the columns of its
 * matrix.
 *
 * Carried ourselves rather than handed to three as a list of places. Handed
 * over, a list short enough for a uniform buffer has its length woven into
 * the shader, which means **a shader per mesh** — and weaving one holds the
 * frame for about a second (measured at Yoyogi, z18.6), so the page would
 * stall on every tile that landed. Carried on the corners, no length reaches
 * the shader: every tile uses the one set, and the limit that decides it,
 * which differs by machine, never comes into it.
 */
export const STAND = ['standA', 'standB', 'standC', 'standD'] as const

/** Where each tree carries what its leaf colour is multiplied by. */
export const TINT = 'tint'

/** Where a corner says whether it is leaf or trunk. */
export const LEAFNESS = 'leafness'

/** Where a corner carries which way the outline's shell is pushed. */
export const HULL_NORMAL = 'hullNormal'

/**
 * Where a mesh says it is the trees themselves.
 *
 * The outline's shell is a second mesh sharing the same geometry, and saying
 * when a tree comes and goes is written onto the geometry, so it must be
 * written once — through the mesh that carries this mark.
 */
const WOOD = 'plateauWood'

/**
 * The ends of what each tree's leaf colour is multiplied by, spread evenly
 * from the cool side to the warm.
 *
 * Relative, and so nothing to do with the leaf colour the palette holds:
 * going between the light set and the dark one repaints nothing standing. One
 * kind alone still reads as one tree differing from the next.
 */
const COOL = [0.84, 0.93, 0.8] as const
const WARM = [1.12, 1.06, 0.92] as const

/** How much wider or narrower than its height a tree is, so one kind does not read as one shape. */
const WIDTH_LEAST = 0.86
const WIDTH_RANGE = 0.28

const UP = new Vector3(0, 1, 0)
const scratchPosition = new Vector3()
const scratchRotation = new Quaternion()
const scratchScale = new Vector3()
const scratchMatrix = new Matrix4()

/** What standing the trees of a tile takes. */
export interface Planting {
  /** That tile's own seed, so a plot fetched again is the same wood every time. */
  seed: number
  /** How far apart they stand, in metres. */
  spacing: number
  /** How many world units a real metre is: Mercator stretches with latitude. */
  stretch: number
  shapes: readonly TreeShape[]
  /** What paints them; leaves and trunks share the one material. */
  material: MeshStandardNodeMaterial
  /** What draws the line round them. */
  outline: MeshBasicNodeMaterial
  /**
   * How high the ground stands under a place in the tile, in world units.
   * Left out where the land is drawn flat, and then they all stand on nought.
   */
  lift?: (x: number, z: number) => number
  /**
   * Whether a place is clear to stand a tree on. Left out, every place on the
   * plots is. What it keeps them out of is the buildings standing on a plot.
   */
  clear?: (x: number, z: number) => boolean
}

/**
 * Scatters trees over the plots and stands them.
 *
 * What comes back is one mesh a kind, and an outline apiece. The places are
 * world units from the tile's top-left corner, so putting the mesh where the
 * tile goes puts every tree where it belongs.
 */
export function plant(lots: PolygonMesh, of: Planting): Object3D[] {
  const scattered = scatterOver(
    lots.positions,
    lots.indices,
    of.spacing * of.stretch,
    MAX_PER_TILE,
    randomFrom(of.seed),
  )
  const points = of.clear ? keptClear(scattered, of.clear) : scattered
  if (points.length === 0) return []

  // Kept apart from the scattering's own randomness, so a tree grown again at
  // the same place is the same tree
  const random = randomFrom((of.seed ^ 0x9e3779b9) >>> 0)
  const count = points.length / 2
  const chosen = new Uint8Array(count)
  const totals = new Array<number>(of.shapes.length).fill(0)
  for (let i = 0; i < count; i++) {
    const kind = pickKind(of.shapes, random())
    chosen[i] = kind
    totals[kind] = totals[kind]! + 1
  }

  const stands = totals.map((total) => new Float32Array(total * 16))
  const tints = totals.map((total) => new Float32Array(total * 3))
  const filled = new Array<number>(of.shapes.length).fill(0)

  for (let i = 0; i < count; i++) {
    const kind = chosen[i]!
    const shape = of.shapes[kind]!
    const stand = stands[kind]!
    const tint = tints[kind]!

    const [least, most] = shape.height
    const height = (least + random() * (most - least)) * of.stretch
    const wide = height * (WIDTH_LEAST + random() * WIDTH_RANGE)
    // A tree stands on the ground under its own trunk, so the wood follows
    // the slope it grows on rather than standing on one level
    const east = points[i * 2]!
    const south = points[i * 2 + 1]!
    scratchPosition.set(east, of.lift?.(east, south) ?? 0, south)
    scratchRotation.setFromAxisAngle(UP, random() * Math.PI * 2)
    scratchScale.set(wide, height, wide)
    scratchMatrix.compose(scratchPosition, scratchRotation, scratchScale)

    const slot = filled[kind]!
    scratchMatrix.toArray(stand, slot * 16)
    const towards = random()
    for (let c = 0; c < 3; c++) tint[slot * 3 + c] = COOL[c]! + (WARM[c]! - COOL[c]!) * towards
    filled[kind] = slot + 1
  }

  const objects: Object3D[] = []
  for (let kind = 0; kind < of.shapes.length; kind++) {
    const total = totals[kind]!
    if (total === 0) continue
    const geometry = woodOf(of.shapes[kind]!, stands[kind]!, tints[kind]!, total)

    const mesh = new Mesh(geometry, of.material)
    mesh.userData[WOOD] = true
    // A tree stands, so it casts and it takes — three's own two words, both off
    // by default. It is read as land in the stencil (`marksLand`, CLAUDE.md:
    // 나무는 땅이다) but that is a different question: what a wash painted on a
    // park covers, and not what the sun can see past.
    mesh.castShadow = true
    mesh.receiveShadow = true
    // A tree is not a thing to click: a click on one is a click on the ground
    // under it. Which also takes it out of three's own `Raycaster`, and has to:
    // the shape here is one tree at the origin and the hundreds of real ones
    // are the columns the material reads, so a ray left to walk this mesh
    // answers with a tree nobody can see. See `notPicked`.
    notPicked(mesh)
    objects.push(mesh)

    // The same trees in the same places, drawn once more inside out and pushed
    // out past themselves. Neither the shadows nor the corner shading see this
    // shell. It shares the trees' geometry, so it is let go of with them.
    const hull = new Mesh(geometry, of.outline)
    hull.layers.set(PICTURE_ONLY)
    // Nor is the shell round a tree, which stands further out than the tree
    notPicked(hull)
    objects.push(hull)
  }
  return objects
}

/** Of what was stood, the trees alone: the outline's shell shares their geometry and is skipped. */
export function eachWood(objects: readonly Object3D[], visit: (wood: Mesh) => void): void {
  for (const object of objects) {
    const mesh = object as Mesh
    if (mesh.isMesh && mesh.userData[WOOD] === true) visit(mesh)
  }
}

/**
 * Says for each tree when it sets off and how far under the ground the far
 * end of its way lies.
 *
 * How far it travels is its own height, which the middle column of its matrix
 * already carries, so it is read from there rather than kept twice. The
 * clearance is in world units; it is only margin enough to bury it, so there
 * is nothing to bring back to metres.
 */
export function stampTrees(wood: Mesh, at: number, stagger: number, way: Way): void {
  const said = wood.geometry.getAttribute(APPEAR)
  // The second column of the matrix. They are only ever turned about the
  // upright, so its y is the height
  const stand = wood.geometry.getAttribute(STAND[1])
  if (!said || !stand) return

  const sign = way === 'up' ? 1 : -1
  const array = said.array as Float32Array
  for (let i = 0; i < said.count && i * 2 + 1 < array.length; i++) {
    array[i * 2] = whenOf(i, at, stagger)
    array[i * 2 + 1] = sign * (stand.getY(i) + CLEAR_OF_THE_GROUND)
  }
  said.needsUpdate = true
}

/**
 * Weaves one tree and the places it stands into a single geometry.
 *
 * The tree's corners point straight at the one array carved for that kind.
 * Nothing is copied per tile; only what goes up to the card is a tile's own.
 */
function woodOf(
  shape: TreeShape,
  stands: Float32Array,
  tints: Float32Array,
  count: number,
): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(shape.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(shape.normals, 3))
  geometry.setAttribute(HULL_NORMAL, new BufferAttribute(shape.hullNormals, 3))
  geometry.setAttribute(LEAFNESS, new BufferAttribute(shape.leafness, 1))

  const places = new InstancedInterleavedBuffer(stands, 16, 1)
  STAND.forEach((name, column) => {
    geometry.setAttribute(name, new InterleavedBufferAttribute(places, 4, column * 4))
  })
  geometry.setAttribute(TINT, new InstancedBufferAttribute(tints, 3))
  // When each comes up and when it goes back under, written once they stand
  geometry.setAttribute(APPEAR, new InstancedBufferAttribute(new Float32Array(count * 2), 2))
  geometry.instanceCount = count
  // Leaving an off-screen tile's trees undrawn wants a sphere round every
  // place one stands. It has to be measured off the places, not the corners:
  // the corners are one tree standing at the origin.
  geometry.boundingSphere = standsAround(stands, count, shape.reach)
  return geometry
}

/**
 * The sphere round every place one stands, widened by how far a tree reaches
 * and how tall it is.
 *
 * Read from where the trees were actually put, all three ways. A wood stands
 * on the land it grew on — the height goes into each tree's own place, up at
 * the top of this file — and a sphere measured from the width alone sits at
 * sea level whatever the land does. In 東京 that is a few metres out and
 * nothing comes of it; in 御殿場 the wood is 500m above the sphere three is
 * given, which is further than the sphere is wide, so turning the camera
 * culled every tree on the tile while the green patch under them stayed
 * (measured). The patch never had the fault: its own points are draped on the
 * land before its sphere is taken.
 */
function standsAround(stands: Float32Array, count: number, reach: number): Sphere {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let foot = Infinity
  let top = -Infinity
  for (let i = 0; i < count; i++) {
    const at = i * 16
    // Turned or not, the width is the length of the first column and the
    // height the y of the middle one
    const wide = Math.hypot(stands[at]!, stands[at + 2]!) * reach
    const x = stands[at + 12]!
    const y = stands[at + 13]!
    const z = stands[at + 14]!
    minX = Math.min(minX, x - wide)
    maxX = Math.max(maxX, x + wide)
    minZ = Math.min(minZ, z - wide)
    maxZ = Math.max(maxZ, z + wide)
    foot = Math.min(foot, y)
    top = Math.max(top, y + stands[at + 5]!)
  }
  const centre = new Vector3((minX + maxX) / 2, (foot + top) / 2, (minZ + maxZ) / 2)
  return new Sphere(centre, Math.hypot((maxX - minX) / 2, (top - foot) / 2, (maxZ - minZ) / 2))
}

/** Picks a kind from one number between 0 and 1; the larger share comes up more often. */
function pickKind(shapes: readonly TreeShape[], at: number): number {
  let total = 0
  for (const shape of shapes) total += shape.share
  let seen = 0
  for (let i = 0; i < shapes.length; i++) {
    seen += shapes[i]!.share / total
    if (at < seen) return i
  }
  return shapes.length - 1
}

/** The places of `points` that are clear, in the same pairs. */
function keptClear(points: Float32Array, clear: (east: number, south: number) => boolean): Float32Array {
  const kept: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    if (clear(points[i]!, points[i + 1]!)) kept.push(points[i]!, points[i + 1]!)
  }
  return new Float32Array(kept)
}
