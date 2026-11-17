/**
 * Giving a run of points a width, on the plane.
 *
 * Neither the ground's nor the shapes': a road cut out of a vector tile and a
 * line a page paints along the streets both have to come out as a strip of
 * quads, and the corner is the whole of the work. Kept where neither owns it,
 * so that painting a path does not reach into what draws the ground.
 */

/**
 * How far out a mitre may run before it is cut off, as a multiple of the
 * line's own half width.
 *
 * Shared with the paint, which works the same mitre out on the screen for a
 * line in the air; see `shapes/paint.ts`. Two shapes of the same line agreeing
 * on where its corners are is not something to say twice.
 */
export const MITER_LIMIT = 2

/**
 * Which way is sideways at a point, and how far the bend stretches it.
 *
 * The normals of the segment coming in and the one going out, added, which
 * splits the angle between them. That is what makes the shared edge of two
 * neighbouring quads lie along the segment, so the two meet exactly. Taken
 * from the line straight through the points either side, the edge would sit
 * across the segment instead, and the jitter left by rounding alone would
 * twist the corners over each other.
 */
export function sideAt(
  here: { x: number; z: number },
  previous: { x: number; z: number } | undefined,
  next: { x: number; z: number } | undefined,
): { x: number; z: number; stretch: number } {
  if (!previous || !next) {
    const other = next ?? previous!
    const sign = next ? 1 : -1
    return { ...normalLeft((other.x - here.x) * sign, (other.z - here.z) * sign), stretch: 1 }
  }

  const inward = normalLeft(here.x - previous.x, here.z - previous.z)
  const outward = normalLeft(next.x - here.x, next.z - here.z)
  let mx = inward.x + outward.x
  let mz = inward.z + outward.z
  const length = Math.hypot(mx, mz)
  // Doubling straight back on itself: the incoming normal stands
  if (length < 1e-6) return { ...inward, stretch: 1 }

  mx /= length
  mz /= length
  const dot = mx * inward.x + mz * inward.z
  return { x: mx, z: mz, stretch: Math.min(MITER_LIMIT, dot > 1e-3 ? 1 / dot : MITER_LIMIT) }
}

/**
 * Whether a place falls within `within` of a run, in the world's own units.
 *
 * The distance to the nearest piece of it, which is what the band drawn along
 * it covers: the band is a width across, mitred where the run turns, and the
 * two part only where a mitre runs out and the ends of two pieces overlap by
 * about a pixel. Nobody aiming at a line is aiming at that pixel.
 */
export function nearRun(
  run: readonly { x: number; z: number }[],
  x: number,
  z: number,
  within: number,
): boolean {
  const square = within * within
  for (let at = 0; at + 1 < run.length; at++) {
    const from = run[at]!
    const to = run[at + 1]!
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = dx * dx + dz * dz
    // How far along the piece the place falls, held between its two ends, so
    // that a place off the end is measured to the end rather than to the line
    // the piece happens to lie on.
    const along =
      length < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / length))
    const offX = x - (from.x + along * dx)
    const offZ = z - (from.z + along * dz)
    if (offX * offX + offZ * offZ <= square) return true
  }
  return false
}

/** The unit normal pointing left of the way it runs. */
function normalLeft(dx: number, dz: number): { x: number; z: number } {
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return { x: 0, z: 0 }
  return { x: -dz / length, z: dx / length }
}
