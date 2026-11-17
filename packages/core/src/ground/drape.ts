import { FINEST_STEP, type Heights } from '../elevation.js'
import { metersPerUnit, yToLat, type WorldBounds } from '../geo/mercator.js'
import type { PolygonMesh } from '../polygons.js'
import type { ParsedTile } from './tileGeometry.js'

/**
 * Laying a tile's flat corners on the land.
 *
 * Everything a tile draws is cut on the plane — a road's centre line, the
 * ring round a park, the shading along a bank — and every one of those
 * corners is three numbers with nought in the middle. Draping is writing that
 * middle number, once, as the tile is built: what is drawn then lies on the
 * ground instead of under it, and nothing moves again while the view does.
 *
 * It is done to the corners rather than in the shader, which is where the
 * buildings have theirs done, because these corners *are* the ground. A road
 * has no shape apart from the land it runs over; a building has one, and
 * where it stands is not part of it.
 *
 * What a shape cannot do is bend between its corners, so a shape with no
 * corners inside it is laid across the land as a chord under it. The vector
 * tiles carry their points every few metres along a line, so lines and
 * ribbons follow the ground closely and so do the small filled shapes. What
 * does not is a wide area given by its outline alone — green, above all,
 * which arrives as a handful of plots and is cut into triangles whose longest
 * edge, measured at 七里ヶ浜, runs 284 metres with nothing between its ends.
 * Over a wooded hillside that chord was drawn twenty metres under the ground
 * it belongs to: on the screen the green slid down the slope, leaving the
 * bare surface where it should have been and the trees — each of which reads
 * the land at its own foot — standing in the air over it.
 *
 * So a shape is {@link cutToLand} before it is draped, and the cutting is
 * paid for where it shows: an edge is halved only where the land under its
 * middle has left the chord, so flat green keeps the triangles it came with.
 */

/** How high the ground stands under a place inside a tile, in world units. */
export type Lift = (x: number, z: number) => number

/**
 * How high the land is under one tile, ready to be asked corner by corner.
 *
 * The heights arrive in real metres and the world is Mercator, stretched with
 * latitude, so they are brought back down by the latitude the tile stands at
 * — the same hill in Hokkaido as in Kyushu. One latitude for the whole tile,
 * as the trees and the buildings also take one: across a tile at the zooms a
 * city is looked at the stretch moves by a ten-thousandth, and by the zooms
 * where it moves at all a mountain is a few pixels tall.
 */
export function liftOver(bounds: WorldBounds, heights: Heights): Lift {
  const stretch = stretchOver(bounds)
  const { minX, maxY } = bounds
  // Inside a tile x runs east from its west edge and z runs south from its
  // north one, while Mercator's y rises north
  return (x, z) => heights.at(minX + x, maxY - z) * stretch
}

/**
 * Writes the height into every corner of one array of them.
 *
 * The corners come as [x, y, z] over and over — the same shape for a filled
 * shape, a ribbon, a bank and the ends of a line — so one walk serves them
 * all.
 */
export function drape(positions: Float32Array, lift: Lift): void {
  for (let at = 0; at + 2 < positions.length; at += 3) {
    positions[at + 1] = lift(positions[at]!, positions[at + 2]!)
  }
}

/**
 * The whole of one map tile laid on the land: every filled shape, every line,
 * every ribbon and the shading along the banks.
 *
 * Done before any of it is made into a mesh, so that what is worked out from
 * the corners afterwards — the ball a ribbon is culled by, above all — is
 * worked out about where they really lie.
 */
export function drapeTile(parsed: ParsedTile, lift: Lift): void {
  for (const shape of Object.values(parsed.polygons)) drape(shape.positions, lift)
  for (const segments of Object.values(parsed.lines)) drape(segments, lift)
  for (const ribbon of Object.values(parsed.ribbons)) drape(ribbon.positions, lift)
  if (parsed.bank) drape(parsed.bank.positions, lift)
}

/**
 * How far a shape may be drawn from the land under its middle before that
 * part of it is cut finer, in metres.
 *
 * Half a metre is under a pixel at the zooms a hillside is looked at, and
 * lenient enough that a plot on level ground is never touched.
 */
export const SAGS = 0.5

/** The most times an edge may be halved. Eight takes the longest edge seen to under a metre. */
const HALVINGS = 8

/** How many triangles one shape may be cut into, whatever the land does. */
const MOST_TRIANGLES = 40000

/**
 * The Mercator stretch at a tile, which is what turns metres into the world's
 * own units there. Read in one place so that a tile's heights and the
 * tolerance its shapes are cut to are stretched by the same number.
 */
export function stretchOver(bounds: WorldBounds): number {
  return 1 / metersPerUnit(yToLat((bounds.minY + bounds.maxY) / 2))
}

/** One corner of a run, and how high the land stands under it in metres. */
export interface Underfoot {
  readonly x: number
  readonly z: number
  /** The land's height there, in metres — asked for as the run was cut, so nobody asks twice. */
  readonly up: number
}

/**
 * Cuts a run of corners until it can follow the land between them.
 *
 * The same question {@link cutToLand} asks of a triangle's edge, asked of a
 * line's: does the land under the middle stand further from the straight line
 * between the ends than {@link SAGS}? Where it does not, nothing is added —
 * which is the whole point. A boundary across level ground keeps the corners
 * the file gave it, and one over a ridge is cut as finely as the ridge needs.
 *
 * What it replaces was a fixed step: every piece of every line cut at
 * {@link FINEST_STEP} whether or not there was anything between its ends to
 * follow. Over the twenty-three wards of 東京 — flat, and given by 31,207
 * corners — that was several times the corners for a picture nobody could
 * tell apart, and every one of them built again each time an elevation tile
 * landed.
 *
 * The floor is still {@link FINEST_STEP}: between two readings there is
 * nothing to follow but the straight line already being drawn. So this is
 * never cut finer than the fixed step was, and over broken ground it comes
 * out the same.
 *
 * In metres rather than world units, unlike the triangles' cut — a line may
 * run further north and south than a tile does, so there is no one latitude
 * to bring its heights down by, and the comparison is between two heights
 * either way.
 *
 * How far it may sag is the caller's to say, and it is not {@link SAGS}. A
 * triangle that sags loses a sliver of its edge; a line that sags loses the
 * whole of itself, because a line is thin and what it is measured against is
 * the surface it stands over. So the run has to be cut finer than the line
 * stands off the ground — cut to half a metre while standing 0.3m off it, the
 * boundaries of the twenty-three wards came out dashed wherever a stretch ran
 * straight for long enough, and ran solid again as a zoom made the depth
 * buffer finer under them.
 */
export function cutRunToLand(
  corners: readonly { readonly x: number; readonly z: number }[],
  metresAt: (x: number, z: number) => number,
  sags: number,
): Underfoot[] {
  const out: Underfoot[] = []
  const first = corners[0]
  if (!first) return out

  let here: Underfoot = { x: first.x, z: first.z, up: metresAt(first.x, first.z) }
  out.push(here)
  for (let at = 1; at < corners.length; at++) {
    const corner = corners[at]!
    const next: Underfoot = { x: corner.x, z: corner.z, up: metresAt(corner.x, corner.z) }
    halve(here, next, out, metresAt, sags)
    out.push(next)
    here = next
  }
  return out
}

/**
 * Puts in whatever corners the land between two asks for, and not the two
 * themselves — the caller has those already.
 *
 * Halving rather than stepping along, so that the reading taken at a middle
 * serves both sides of it. The recursion ends on its own: every piece is half
 * the last, so a piece reaches {@link FINEST_STEP} in a handful of passes
 * however long the run began.
 */
function halve(
  a: Underfoot,
  b: Underfoot,
  out: Underfoot[],
  metresAt: (x: number, z: number) => number,
  sags: number,
): void {
  if (Math.hypot(b.x - a.x, b.z - a.z) <= FINEST_STEP) return
  const x = (a.x + b.x) / 2
  const z = (a.z + b.z) / 2
  const up = metresAt(x, z)
  if (Math.abs(up - (a.up + b.up) / 2) <= sags) return
  const middle = { x, z, up }
  halve(a, middle, out, metresAt, sags)
  out.push(middle)
  halve(middle, b, out, metresAt, sags)
}

/**
 * Cuts a shape until it can follow the land, in place.
 *
 * An edge is halved when the land under its middle stands further from the
 * straight line between its ends than {@link SAGS}, and the two triangles
 * either side of an edge always agree about that, because the test reads the
 * edge and nothing else. That is what keeps the cut watertight: a corner
 * added to one triangle is added to its neighbour in the same pass, so no
 * edge is ever left with a corner in the middle of it that the triangle
 * across it has not got. A seam of that kind is a hairline of backdrop
 * showing through the ground, which is worse than the sag it came to fix.
 *
 * It stops at {@link FINEST_STEP}, since between two readings there is
 * nothing to follow, and at {@link MOST_TRIANGLES}, since a shape may cover a
 * mountain and a page still has a frame to draw.
 *
 * The corners are still flat when this runs. It has to be that way round:
 * what is being asked is where the land is, and the answer is the same
 * whether or not the shape has been laid on it yet — but once it is laid,
 * a corner's y is an answer and no longer a question.
 */
export function cutToLand(mesh: PolygonMesh, lift: Lift, stretch: number): void {
  const sags = SAGS * stretch
  let xz = Array.from(mesh.positions)
  let tris = Array.from(mesh.indices)
  // One reading a corner, kept across the passes: a corner is shared by every
  // triangle that touches it and by every edge tested against it
  const lifts = new Map<number, number>()
  const liftAt = (v: number): number => {
    const known = lifts.get(v)
    if (known !== undefined) return known
    const here = lift(xz[v * 3] ?? 0, xz[v * 3 + 2] ?? 0)
    lifts.set(v, here)
    return here
  }

  for (let pass = 0; pass < HALVINGS; pass++) {
    const was = xz.length / 3
    const halved = new Map<number, number>()
    // Asked once an edge, by the pair of corners it runs between. Both
    // triangles that hold the edge come here and get the same answer
    const middleOf = (a: number, b: number): number => {
      const key = a < b ? a * was + b : b * was + a
      const known = halved.get(key)
      if (known !== undefined) return known

      const ax = xz[a * 3] ?? 0
      const az = xz[a * 3 + 2] ?? 0
      const bx = xz[b * 3] ?? 0
      const bz = xz[b * 3 + 2] ?? 0
      let made = -1
      if (Math.hypot(ax - bx, az - bz) > FINEST_STEP) {
        const mx = (ax + bx) / 2
        const mz = (az + bz) / 2
        if (Math.abs(lift(mx, mz) - (liftAt(a) + liftAt(b)) / 2) > sags) {
          made = xz.length / 3
          xz.push(mx, 0, mz)
        }
      }
      halved.set(key, made)
      return made
    }

    const next: number[] = []
    let cut = false
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t] ?? 0
      const b = tris[t + 1] ?? 0
      const c = tris[t + 2] ?? 0
      const m = middleOf(a, b)
      const n = middleOf(b, c)
      const p = middleOf(c, a)
      if (m < 0 && n < 0 && p < 0) {
        next.push(a, b, c)
        continue
      }
      cut = true
      if (m >= 0 && n >= 0 && p >= 0) next.push(a, m, p, m, b, n, p, n, c, m, n, p)
      else if (m >= 0 && n >= 0) next.push(a, m, n, a, n, c, m, b, n)
      else if (n >= 0 && p >= 0) next.push(b, n, p, b, p, a, n, c, p)
      else if (p >= 0 && m >= 0) next.push(c, p, m, c, m, b, p, a, m)
      else if (m >= 0) next.push(a, m, c, m, b, c)
      else if (n >= 0) next.push(b, n, a, n, c, a)
      else next.push(c, p, b, p, a, b)
    }
    tris = next
    if (!cut || tris.length / 3 > MOST_TRIANGLES) break
  }

  mesh.positions = new Float32Array(xz)
  mesh.indices = new Uint32Array(tris)
}
