import { BufferAttribute, BufferGeometry, Color } from 'three/webgpu'
import { latToY, lonToX, metersPerUnit, yToLat } from '../geo/mercator.js'
import { PolygonBuilder, outsideFirst, worldLoop, type Point } from '../polygons.js'
import { sideAt } from '../polylines.js'
import type { PolylinePoint } from '../ShapeLayer.js'
import { sidesFor } from './disc.js'

/**
 * The closed box over a filled shape, for drawing it by classification.
 *
 * Nothing here is laid on the land, and that is the whole of why it exists.
 * A shape cut to follow the land carries the land in its corners, so it has to
 * be cut afresh every time a tile of heights lands under it — over the
 * twenty-three wards of 東京 that was 296ms a time, many times over a zoom.
 * A box is built once and again only where the page itself changes it — a
 * colour, an opacity and a width are cut into its corners, so changing any of
 * them cuts it afresh, and so does the palette turning over under a colour a
 * page said twice. What it never waits on is the land: where the land is under
 * it is settled as it is drawn, by the depth the land itself wrote.
 *
 * What is drawn is not the box. The box is counted into the stencil buffer —
 * front faces down, back faces up — so that a pixel inside it is left marked
 * and one beside it is not, and then the colour is laid over the marked
 * pixels. So the fill lands exactly on the ground as drawn, down to the pixel,
 * over a ridge or a kerb or the roof of a tower.
 *
 * Closed, which is why there are caps as well as walls. An open box leaves
 * rays that enter it and never leave, and those come out marked wherever the
 * ground happens to be.
 */

/**
 * How high a corner stands, as the two numbers a shader needs.
 *
 * `climb` turns metres into the world's own units at that corner's latitude,
 * and `high` says whether the corner belongs to the ceiling or the floor. The
 * two heights themselves are not here — they are the group's, and they move
 * with the eye — so a corner's y is `mix(floor, ceiling, high) * climb`, and
 * moving the ceiling costs nothing at all.
 */
export const VOLUME_CLIMB = 'climb'

/** Builds the closed box over one filled shape, or nothing where it has no outside. */
export function buildVolume(
  loops: readonly (readonly (readonly [number, number])[])[],
  colour: Color,
  shows: number,
): BufferGeometry | null {
  const wound = loops.map(worldLoop)
  if ((wound[0]?.length ?? 0) < 3) return null
  // One winding, and the box is built from every one of these: the outside
  // loop one way round and every hole the other, walls and caps together,
  // whichever way the page handed them over. Which way a page's loop goes
  // round cannot be leant on — GeoJSON has an outer loop counter-clockwise and
  // a survey often hands over the other way — and built from two windings the
  // caps faced outwards while the walls faced in. The count tells the box's
  // front faces from its back ones, so it came out non-nought on ground the
  // shape does not cover, and the colour landed on the box's own floor: the
  // loop's own shape, that far under the land, sliding as the view turned
  // (measured at 御殿場, whose loops are wound the way the specification says).
  const kept = outsideFirst([wound[0] as Point[], ...wound.slice(1).filter((loop) => loop.length >= 3)])

  const builder = new PolygonBuilder()
  // No extent and scale 1, as `buildFill` does: these are a page's own loops in
  // the world's units, not a vector tile's square.
  builder.add(kept, 1)
  const cap = builder.build()
  if (!cap) return null

  const corners = cap.positions.length / 3
  const walls = kept.reduce((all, loop) => all + loop.length, 0)
  // Floor and ceiling of the cap, then two corners a loop corner for the walls
  const held = corners * 2 + walls * 2
  const positions = new Float32Array(held * 3)
  const climb = new Float32Array(held * 2)
  const paint = new Float32Array(held * 4)

  const place = (at: number, x: number, z: number, high: number): void => {
    positions[at * 3] = x
    positions[at * 3 + 1] = 0
    positions[at * 3 + 2] = z
    climb[at * 2] = 1 / metersPerUnit(yToLat(-z))
    climb[at * 2 + 1] = high
    paint.set([colour.r, colour.g, colour.b, shows], at * 4)
  }

  for (let at = 0; at < corners; at++) {
    const x = cap.positions[at * 3] ?? 0
    const z = cap.positions[at * 3 + 2] ?? 0
    place(at, x, z, 0)
    place(corners + at, x, z, 1)
  }

  const indices: number[] = []
  // The ceiling as the cap was wound and the floor the other way round, so
  // that the box is wound one way throughout and a front face can be told
  // from a back one. Which way round is not the question — the count is read
  // as not-nought (see `paint.ts`), so it is as good wound inwards — but
  // mixing the two is: the walls and the caps would then disagree about which
  // of their faces the camera is looking at, and the count would be taken
  // over some of the box's near faces and some of its far ones.
  for (let at = 0; at + 2 < cap.indices.length; at += 3) {
    const a = cap.indices[at] ?? 0
    const b = cap.indices[at + 1] ?? 0
    const c = cap.indices[at + 2] ?? 0
    indices.push(corners + a, corners + b, corners + c)
    indices.push(a, c, b)
  }

  let next = corners * 2
  for (const loop of kept) {
    const first = next
    for (const corner of loop) {
      place(next, corner.x, corner.y, 0)
      place(next + 1, corner.x, corner.y, 1)
      next += 2
    }
    for (let at = 0; at < loop.length; at++) {
      const low = first + at * 2
      const nextLow = first + ((at + 1) % loop.length) * 2
      indices.push(low, nextLow, low + 1, nextLow, nextLow + 1, low + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(VOLUME_CLIMB, new BufferAttribute(climb, 2))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  return geometry
}

/** Where a corner of a line's curtain is pushed sideways, in pixels of the page. */
export const VOLUME_OFFSET = 'offset'

/**
 * The closed curtain over one painted line.
 *
 * A line is classified the way a filled shape is, and for the same reason: a
 * boundary laid on the land stops dead at the foot of whatever stands on it,
 * where a boundary painted onto the picture runs up the wall and over the roof
 * — which is what a line drawn on a city is for.
 *
 * What is different is the width. A filled shape covers the ground it covers,
 * but a line is so many pixels of the page wide however far off it is looked
 * at, so the curtain's two faces are pushed apart on the screen rather than in
 * the world. The push rides on the corner and is put on in the shader, so the
 * curtain follows the eye without being built again — the same trick the
 * draped ribbon uses, and the reason a width costs no material of its own.
 *
 * Closed, like the box over a shape: two walls, a roof, a floor and a cap at
 * each end. An open curtain leaves rays that go in and never come out, and
 * those come out marked wherever the ground happens to be.
 */
export function buildRunVolume(
  // Heights are not read. A curtain is only ever cut for a line lying on the
  // ground — see `ShapeLayer`'s `classified` — so a corner that carries one
  // never gets this far
  points: readonly PolylinePoint[],
  colour: Color,
  shows: number,
  width: number,
): BufferGeometry | null {
  const run = points.map(([lon, lat]) => ({ x: lonToX(lon), z: -latToY(lat) }))
  if (run.length < 2) return null

  // Four corners a place: left and right, each at the floor and the ceiling
  const held = run.length * 4
  const positions = new Float32Array(held * 3)
  const climb = new Float32Array(held * 2)
  const offset = new Float32Array(held * 2)
  const paint = new Float32Array(held * 4)

  for (let at = 0; at < run.length; at++) {
    const here = run[at]!
    const side = sideAt(here, run[at - 1], run[at + 1])
    const push = side.stretch * (width / 2)
    for (let corner = 0; corner < 4; corner++) {
      const which = at * 4 + corner
      // 0 and 1 are the left wall, floor then ceiling; 2 and 3 the right
      const left = corner < 2
      positions[which * 3] = here.x
      positions[which * 3 + 1] = 0
      positions[which * 3 + 2] = here.z
      climb[which * 2] = 1 / metersPerUnit(yToLat(-here.z))
      climb[which * 2 + 1] = corner % 2
      offset[which * 2] = side.x * push * (left ? 1 : -1)
      offset[which * 2 + 1] = side.z * push * (left ? 1 : -1)
      // How much of the line goes on rides fourth, as an area's does: the
      // painting pass reads the same four for both (`shapes/paint.ts`'s
      // `classify`)
      paint.set([colour.r, colour.g, colour.b, shows], which * 4)
    }
  }

  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, b, d, c)
  }
  for (let at = 0; at + 1 < run.length; at++) {
    const here = at * 4
    const next = here + 4
    // Left wall, right wall the other way round, then the roof and the floor
    quad(here, next, here + 1, next + 1)
    quad(here + 2, here + 3, next + 2, next + 3)
    quad(here + 1, next + 1, here + 3, next + 3)
    quad(here, here + 2, next, next + 2)
  }
  // The two ends, so that nothing can walk in through them
  const last = (run.length - 1) * 4
  quad(0, 1, 2, 3)
  quad(last + 2, last + 3, last, last + 1)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(VOLUME_CLIMB, new BufferAttribute(climb, 2))
  geometry.setAttribute(VOLUME_OFFSET, new BufferAttribute(offset, 2))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  return geometry
}

/**
 * How close a painted circle's sides keep to the round edge, in pixels of the
 * page.
 *
 * Tighter than the fan a drawn circle is cut as (`disc.ts`), because here the
 * sides are the edge: the count is in or out a pixel at a time, so there is no
 * worked-out round edge inside them to hide a flat.
 */
const SNUG = 0.25

/**
 * The closed column over a painted circle, or over the ring round one.
 *
 * Built as a line's curtain is and for the same reason: a circle is so many
 * pixels of the page across however far off it is looked at, so its corners
 * all stand at the point and carry how far out they go, and the shader pushes
 * them there along the ground (see `shapes/paint.ts`, `boxed`). So it is cut
 * once, and a zoom moves nothing but a uniform.
 *
 * Pushed along the ground and not across the screen, which is what paint
 * does: it lies on what it lands on and narrows as that turns away, so on a
 * tilted map a painted circle is an ellipse — the same narrowing a painted
 * line takes. A circle that has to stay round is drawn rather than painted;
 * see `CircleOptions.billboard`.
 *
 * `inner` above nought takes a hole out of the middle, which is the ring:
 * a band `outer - inner` wide standing over the edge. The inside and the ring
 * are two columns rather than one with two colours, because what paints a
 * marked pixel is one face of the column and its colour — two that overlap on
 * the screen in one geometry leave the colour to whichever face rasterises
 * last (`ShapeLayer.run` measured it on the wards).
 *
 * Wound one way throughout, inwards, as the box over an area is: the ceiling
 * and floor the opposite ways round, the outside wall facing the middle and
 * the wall round a hole facing away from it. Which way does not matter, since
 * the count is read as not-nought; that every face agrees does.
 */
export function buildDiscVolume(
  at: readonly [number, number],
  outer: number,
  inner: number,
  colour: Color,
  shows: number,
): BufferGeometry | null {
  if (!(outer > 0)) return null
  const hollow = inner > 0
  const sides = sidesFor(outer, SNUG)
  const x = lonToX(at[0])
  const z = -latToY(at[1])
  const climb = 1 / metersPerUnit(at[1])

  // The middle, or the rim of the hole, and then the outside rim — each at the
  // floor and at the ceiling
  const rims = hollow ? 2 : 1
  const middle = hollow ? 0 : 2
  const held = middle + rims * sides * 2
  const positions = new Float32Array(held * 3)
  const climbs = new Float32Array(held * 2)
  const offsets = new Float32Array(held * 2)
  const paint = new Float32Array(held * 4)
  const place = (which: number, ox: number, oz: number, high: number): void => {
    positions.set([x, 0, z], which * 3)
    climbs.set([climb, high], which * 2)
    offsets.set([ox, oz], which * 2)
    paint.set([colour.r, colour.g, colour.b, shows], which * 4)
  }

  if (!hollow) {
    place(0, 0, 0, 0)
    place(1, 0, 0, 1)
  }
  // `rim(r, side, high)` is the corner of rim `r` (0 the hole, last the outside)
  const rim = (which: number, side: number, high: number): number =>
    middle + (which * sides + (side % sides)) * 2 + high
  const radii = hollow ? [inner, outer] : [outer]
  radii.forEach((radius, which) => {
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2
      const ox = Math.cos(angle) * radius
      const oz = Math.sin(angle) * radius
      place(rim(which, side, 0), ox, oz, 0)
      place(rim(which, side, 1), ox, oz, 1)
    }
  })

  // Going round by angle is clockwise seen from above (x then z is a turn
  // about down), so a triangle taken in that order faces down: the ceiling
  // is taken that way and the floor the other, and both face into the column.
  const indices: number[] = []
  const outside = radii.length - 1
  for (let side = 0; side < sides; side++) {
    if (hollow) {
      const i0 = rim(0, side, 1)
      const i1 = rim(0, side + 1, 1)
      const o0 = rim(outside, side, 1)
      const o1 = rim(outside, side + 1, 1)
      indices.push(i0, o0, o1, i0, o1, i1)
      indices.push(i0 - 1, o1 - 1, o0 - 1, i0 - 1, i1 - 1, o1 - 1)
    } else {
      indices.push(1, rim(0, side, 1), rim(0, side + 1, 1))
      indices.push(0, rim(0, side + 1, 0), rim(0, side, 0))
    }
    // The outside wall, facing the middle
    const low = rim(outside, side, 0)
    const next = rim(outside, side + 1, 0)
    indices.push(low, next, low + 1, next, next + 1, low + 1)
    // The wall round the hole faces the other way, into the band
    if (hollow) {
      const holeLow = rim(0, side, 0)
      const holeNext = rim(0, side + 1, 0)
      indices.push(holeLow, holeLow + 1, holeNext, holeNext, holeLow + 1, holeNext + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(VOLUME_CLIMB, new BufferAttribute(climbs, 2))
  geometry.setAttribute(VOLUME_OFFSET, new BufferAttribute(offsets, 2))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  return geometry
}
