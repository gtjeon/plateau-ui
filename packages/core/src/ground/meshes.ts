import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  Mesh,
  type Line2NodeMaterial,
  type MeshStandardNodeMaterial,
} from 'three/webgpu'
import { notPicked } from '../pick.js'
import type { BankMesh, PolygonMesh, RibbonMesh } from './tileGeometry.js'

/** How far the shader pushes a ribbon's corners sideways, allowed for when culling (m). */
const RIBBON_MARGIN = 120
/** The same for the bank shading pushed inland (m): its width times what a sharp corner costs. */
const BANK_MARGIN = 20

/**
 * Which step of tiles a mesh was cut from, written into every corner of it.
 *
 * The ground changes step at whole zooms, and either side of one the two
 * steps are on screen together while the finer gives way to the coarser. The
 * material that draws them is one — a shader is woven once and shared by
 * every tile — so the mesh cannot be told apart by its material, and a
 * uniform says the same thing to both. A corner can carry it, and this is one
 * number repeated the length of the geometry: four bytes a corner, half a
 * megabyte over a screenful.
 *
 * See `materials.ts`, which reads it against the step now being left.
 */
export const LEVEL = 'plateauLevel'

/** The same number in every corner, which is how a mesh says which step it is. */
function marked(level: number, corners: number): BufferAttribute {
  return new BufferAttribute(new Float32Array(corners).fill(level), 1)
}

/**
 * What everything laid on the land says about shadows: it takes one and throws
 * none.
 *
 * Taking one is the point — paint on a road, and a road in the shadow of the
 * block beside it is a road in shadow.
 *
 * Throwing none is a saving and not a loss. These are drapes cut to the ground:
 * `drape.ts` has already sat every corner of them on the land, so in the sun's
 * map they would write the depth the land writes at the same place, over the
 * same pixels, and the map would hold what it already holds. What they would
 * add is the disagreement between two guesses at one slope — the land is read
 * on a grid fitted to the screen and a drape at its own corners, which is the
 * very gap `LAID_ON_THE_LAND` in `materials.ts` is sized for — and a drape that
 * came out a hair above the land would cast a hair of shadow onto it.
 *
 * They were in a shadow map of the sun's until 2026-10-06, when everything on the default
 * layer was. Not measured on screen either way; the reasoning above is the
 * whole of the case.
 */
function laidOnTheLand(mesh: Mesh): Mesh {
  mesh.receiveShadow = true
  return mesh
}

/** A filled polygon: the kinds that have an area, like water or a footprint. */
export function buildFill(mesh: PolygonMesh, material: MeshStandardNodeMaterial, level: number): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  if (mesh.centres) geometry.setAttribute('centre', new BufferAttribute(mesh.centres, 2))
  geometry.setAttribute(LEVEL, marked(level, mesh.positions.length / 3))
  return laidOnTheLand(new Mesh(geometry, material))
}

/** A line whose thickness is in screen pixels: a coastline, a boundary — things with no real width. */
export function buildLines(
  segments: Float32Array,
  material: Line2NodeMaterial,
  level: number,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(segments)
  // A line is drawn as one instance per segment rather than as corners, so
  // the step it was cut from is written once per segment and not per corner
  geometry.setAttribute(
    LEVEL,
    new InstancedBufferAttribute(new Float32Array(segments.length / 6).fill(level), 1),
  )
  const line = new LineSegments2(geometry, material)
  // Thickness in screen pixels, so what the culling works out can be wrong
  line.frustumCulled = false
  // On the default layer with the rest of the land, and so in the viewer's
  // first drawing, at its own number among the land's pieces — under the
  // corner shading and under whatever a page lays on the land after the
  // ground. Until 2026-10-29 it was on `PICTURE_ONLY`, and so drawn after the
  // shading, over all of that.
  //
  // What kept it off this layer was that under a stand-in material the strip
  // is never spread along the line, and stands at the tile's corner as a sheet
  // a few metres high. The passes that see this layer with a stand-in each
  // leave it out: the sun by `castShadow`, which nothing turns on for it; the
  // corner shading's depth by its material (`drawDepth`); the pointer by
  // `notPicked` below; the lines' picture because nothing of it wears a line.
  // And a click on a coastline is a click on the land it is drawn over
  notPicked(line)
  return line
}

/**
 * A ribbon lying on the ground.
 * Its corners sit on the centre line; the shader pushes them out sideways.
 */
export function buildRibbon(ribbon: RibbonMesh, material: MeshStandardNodeMaterial, level: number): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(ribbon.positions, 3))
  geometry.setAttribute(LEVEL, marked(level, ribbon.positions.length / 3))
  geometry.setAttribute('offset', new BufferAttribute(ribbon.offsets, 2))
  geometry.setAttribute('halfWidth', new BufferAttribute(ribbon.widths, 1))
  // Only the material that draws a pattern along a ribbon
  if (ribbon.along) geometry.setAttribute('along', new BufferAttribute(ribbon.along, 2))
  geometry.setIndex(new BufferAttribute(ribbon.indices, 1))
  // The corners move in the shader, so the sphere it is culled by is widened to match
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += RIBBON_MARGIN
  return laidOnTheLand(new Mesh(geometry, material))
}

/**
 * The shading laid just inside the water along its bank.
 * Its corners sit on the bank; the shader pushes them inland.
 */
export function buildBankShade(bank: BankMesh, material: MeshStandardNodeMaterial, level: number): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(bank.positions, 3))
  geometry.setAttribute(LEVEL, marked(level, bank.positions.length / 3))
  geometry.setAttribute('offset', new BufferAttribute(bank.offsets, 2))
  geometry.setAttribute('across', new BufferAttribute(bank.across, 1))
  geometry.setIndex(new BufferAttribute(bank.indices, 1))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += BANK_MARGIN
  return laidOnTheLand(new Mesh(geometry, material))
}
