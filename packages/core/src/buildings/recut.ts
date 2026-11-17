import { BufferAttribute, BufferGeometry, type Mesh } from 'three/webgpu'
import { carvingRoofs, type ParapetSize, type RoofTally } from './parapets.js'
import { planningRoofs, type RoofPlan } from './roofPlan.js'
import { atOnce, type Steps } from './steps.js'

/**
 * Keeping a mesh ready to have its parapets cut again at another size, from
 * the shape it came in.
 */

/** Where a mesh keeps what it needs to have its parapets cut again. */
const PARAPET_CARVING = 'plateauParapetCarving'

/** Cut a parapet into each flat roof of a tile, unless none is wanted. */
export function* carve(
  meshes: readonly Mesh[],
  roofs: readonly (RoofPlan | null)[],
  size: ParapetSize | null,
): Steps<void> {
  if (!size) return
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]
    if (mesh) yield* carvingMesh(mesh, size, roofs[i] ?? null)
  }
}

/** What a mesh keeps so its parapets can be cut again at another size. */
interface Carving {
  /** How many corners it came with, which a carving keeps at its head. */
  readonly corners: number
  /** The faces it came with, some of which a carving replaces. */
  readonly faces: BufferAttribute
  /** Where its flat roofs are, or null where it has none worth carving. */
  readonly plan: RoofPlan | null
  /** The size it is cut to now, or null where it shows what it came with. */
  cut: ParapetSize | null
  /** Whether the geometry on the mesh is a carving rather than what came. */
  carved: boolean
  /** What became of its roofs at that size. */
  tally: RoofTally
}

/** No parapet asked for, so no roof was passed over for one. */
const NO_PARAPETS: RoofTally = { cut: 0, tooSmall: 0, tooNarrow: 0 }

/**
 * Cuts one mesh's parapets to a size, or takes them away for null.
 *
 * Reading where the roofs are is the long half of the work and none of it
 * depends on the size, so the plan is read once and kept on the mesh, along
 * with the faces it came with: a second size is cut from the mesh as it came,
 * read back out of the first carving, since the carving itself has no roofs
 * left to cut.
 *
 * @returns whether the mesh now wears other faces than it did.
 */
export function carveMesh(mesh: Mesh, size: ParapetSize | null, roofs?: RoofPlan | null): boolean {
  return atOnce(carvingMesh(mesh, size, roofs))
}

/**
 * {@link carveMesh} a piece at a time, for a tile being shaped between frames;
 * see `steps.ts`. The mesh changes only at the end, in one piece: a frame drawn
 * while it is part way through draws it as it was.
 */
function* carvingMesh(mesh: Mesh, size: ParapetSize | null, roofs?: RoofPlan | null): Steps<boolean> {
  let carving = mesh.userData[PARAPET_CARVING] as Carving | undefined
  if (!carving) {
    // A mesh never asked for a parapet is never read for one.
    if (!size) return false
    const faces = mesh.geometry.index
    const corners = mesh.geometry.attributes['position']
    if (!faces || !corners) return false
    carving = {
      corners: corners.count,
      faces,
      // Read with the tile where the windows needed them too, and read here
      // where a parapet was turned on after the tile had already landed.
      plan: roofs ?? (yield* planningRoofs(mesh.geometry)) ?? null,
      cut: null,
      carved: false,
      tally: NO_PARAPETS,
    }
    mesh.userData[PARAPET_CARVING] = carving
  }
  if (sameSize(carving.cut, size)) return false

  const came = carving.carved ? asItCame(mesh.geometry, carving, false) : mesh.geometry
  // Nothing comes back where no roof took a parapet, and the mesh goes back to
  // the roofs it came with.
  const carved = size && carving.plan ? yield* carvingRoofs(came, carving.plan, size) : undefined
  let changed = false
  if (carved?.geometry) {
    const worn = mesh.geometry
    mesh.geometry = carved.geometry
    carving.carved = true
    worn.dispose()
    changed = true
  } else if (carving.carved) {
    const whole = asItCame(mesh.geometry, carving, true)
    mesh.geometry.dispose()
    mesh.geometry = whole
    carving.carved = false
    changed = true
  }
  carving.cut = size
  carving.tally = carved ?? NO_PARAPETS
  return changed
}

/**
 * A carved mesh as it came, read back out of the carving.
 *
 * A carving keeps the corners it was given, untouched, at the head of its own,
 * and adds the parapets after them. So a mesh is its own spare copy: only the
 * faces it came with have to be held on to, a fifth of what keeping the whole
 * of it would cost, on every tile on screen.
 *
 * The corners are handed over as they lie unless they are to stay, in which
 * case they are copied out — a window onto the carving would hold the whole of
 * it, parapets and all, for as long as the mesh showed the roofs without them.
 */
function asItCame(carved: BufferGeometry, carving: Carving, toStay: boolean): BufferGeometry {
  const came = new BufferGeometry()
  // Whatever the mesh was carrying, the windows among it: a carving keeps the
  // corners it was given at its head, so the head of every attribute is them.
  for (const name of Object.keys(carved.attributes)) {
    const attribute = carved.attributes[name]
    if (!attribute) continue
    const numbers = attribute.array
    const length = carving.corners * attribute.itemSize
    const head = toStay ? numbers.slice(0, length) : numbers.subarray(0, length)
    came.setAttribute(name, new BufferAttribute(head, attribute.itemSize))
  }
  came.setIndex(carving.faces)
  return came
}

/** Whether two sizes would carve the same, counting null as no parapet. */
export function sameSize(a: ParapetSize | null, b: ParapetSize | null): boolean {
  if (!a || !b) return a === b
  return a.thickness === b.thickness && a.depth === b.depth && a.minArea === b.minArea
}

/**
 * What became of a mesh's roofs at the size it is cut to, or nothing where it
 * was never read for a parapet.
 */
export function roofTallyOf(mesh: Mesh): RoofTally | undefined {
  return (mesh.userData[PARAPET_CARVING] as Carving | undefined)?.tally
}
