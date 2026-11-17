import { BufferAttribute, BufferGeometry, Color } from 'three/webgpu'
import { metersPerUnit, yToLat } from '../geo/mercator.js'
import { cutToLand, drape, type Lift } from '../ground/drape.js'
import { PolygonBuilder, outsideFirst, worldLoop, type Point } from '../polygons.js'
import type { Heights } from '../elevation.js'

/**
 * A filled shape lying on the land: a plot, a site, a ward.
 *
 * The same three steps the ground takes with its own green, in the same order
 * and for the same reasons — cut the loops into triangles, cut those finer
 * until they can follow the land, then write the land's height into every
 * corner. What is here rather than in `ShapeLayer` is only the part that has to
 * know about triangles; the group has no other reason to.
 *
 * The order matters and is not a matter of taste. A wide shape given by its
 * outline alone is laid across the land as a chord under it — measured at
 * 七里ヶ浜, a triangle edge 284 m long drawn twenty metres below the hillside it
 * belongs to. So it is cut first, while the corners are still flat and asking
 * the land is still a question; see `drape.ts`.
 */

/**
 * One filled shape, cut and laid on the land.
 *
 * `loops` is the outside first and its holes after, each as [longitude,
 * latitude] corners — the shape GeoJSON gives a polygon, and the one a page
 * writing a plot by hand would write anyway.
 *
 * `over` is how far off the land the page asked it to stand, in metres.
 * Nothing is added to that here. A shape lying exactly on the land tosses with
 * it for each pixel, and lifted even a little a shape this wide shows daylight
 * under its edge — so it is pressed toward the camera instead, which moves the
 * depth and not the picture; see `pressToLand`.
 *
 * `colour` and `shows` are the inside's colour, as it stands in the set now
 * standing, and how much of it goes on.
 */
export function buildFill(
  loops: readonly (readonly (readonly [number, number])[])[],
  land: Heights | null,
  over: number,
  colour: Color,
  shows: number,
): BufferGeometry | null {
  // The outside is settled before anything is thrown away. Dropping the short
  // loops first and taking whatever is left at the front would let a shape
  // whose outer loop arrived with two corners promote its first hole to the
  // outside — and a hole read as an outside is filled in, which draws the one
  // piece of ground the page asked to be left out.
  const wound = loops.map(worldLoop)
  if ((wound[0]?.length ?? 0) < 3) return null
  const kept = [wound[0] as Point[], ...wound.slice(1).filter((loop) => loop.length >= 3)]

  const builder = new PolygonBuilder()
  // No extent: that argument cuts a loop back to a vector tile's own square,
  // and a loop a page drew has no tile to be cut to. Scale 1: these are in the
  // world's units already.
  builder.add(outsideFirst(kept), 1)
  const mesh = builder.build()
  if (!mesh) return null

  // One stretch for the whole shape, read at the middle of it, the way a tile's
  // is read at the middle of the tile. Mercator stretches with latitude, and
  // over anything a page draws as one plot the stretch moves by a
  // ten-thousandth; a shape drawn from Hokkaido to Kyushu in one loop would
  // want more, and there is nothing else it could sensibly mean either.
  const stretch = 1 / metersPerUnit(middleLatitude(kept))
  const lift: Lift = land ? (x, z) => (land.at(x, -z) + over) * stretch : () => over * stretch
  if (land) cutToLand(mesh, lift, stretch)
  drape(mesh.positions, lift)

  // rgb and how much of it goes on, on every corner: the paint reads all four
  // from here, so a colour and a strength cost no material of their own.
  const held = mesh.positions.length / 3
  const paint = new Float32Array(held * 4)
  for (let at = 0; at < held; at++) paint.set([colour.r, colour.g, colour.b, shows], at * 4)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  return geometry
}

/** The middle of the latitudes a shape covers, which is where its stretch is read. */
function middleLatitude(loops: readonly Point[][]): number {
  let top = Infinity
  let bottom = -Infinity
  for (const loop of loops) {
    for (const corner of loop) {
      if (corner.y < top) top = corner.y
      if (corner.y > bottom) bottom = corner.y
    }
  }
  return yToLat(-(top + bottom) / 2)
}
