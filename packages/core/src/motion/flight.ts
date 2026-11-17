/**
 * The way from one view to another.
 *
 * Moving and zooming at once is not two moves laid over each other: zoom out a
 * little on the way and the ground travels a shorter distance on screen, so a
 * long flight can be followed instead of streaming past. How far to rise, and
 * how fast to cover the ground while up there, is van Wijk and Nuij's "Smooth
 * and efficient zooming and panning".
 */

/** How much a flight rises on its way: ρ in the paper, at the value web maps settled on. */
const CURVE = 1.42

/** The way between two views, as widths and distances along it. */
export interface FlightPath {
  /**
   * How long the way is, in screens: a flight across one screen at one width
   * is about 1. For timing a flight whose duration is left out.
   */
  readonly length: number
  /**
   * How wide the view is `k` of the way along, from 0 to 1, and how much of
   * the distance between the two middles it has covered by then.
   */
  at(k: number): { readonly width: number; readonly along: number }
}

/**
 * Plans the way between two views `distance` apart, one `fromWidth` across and
 * the other `toWidth`, all in world units.
 *
 * With `arc` the view rises to take in more ground the farther it goes, then
 * comes down again — a hop down the street barely rises, a flight across Japan
 * takes in the whole of it. Without it the view glides at a width eased from
 * one end to the other.
 */
export function flightPath(distance: number, fromWidth: number, toWidth: number, arc: boolean): FlightPath {
  // Widths change by ratios, so they are eased in logarithms: every doubling
  // takes as long as the one before.
  const zoom = Math.log(toWidth / fromWidth)

  if (!arc || distance <= 1e-6 * Math.min(fromWidth, toWidth)) {
    return {
      length: Math.hypot(distance / Math.max(fromWidth, toWidth), zoom),
      at: (k) => ({ width: fromWidth * Math.exp(zoom * k), along: k }),
    }
  }

  // The screen's width w and the distance u covered along the ground are
  // traded against each other so the flight looks equally fast all the way.
  // The `asinh` is the paper's log(sqrt(b² + 1) − b), kept exact when b is
  // large, which it is for a long flight seen from close.
  const rho2 = CURVE * CURVE
  const b0 =
    (toWidth * toWidth - fromWidth * fromWidth + rho2 * rho2 * distance * distance) /
    (2 * fromWidth * rho2 * distance)
  const b1 =
    (toWidth * toWidth - fromWidth * fromWidth - rho2 * rho2 * distance * distance) /
    (2 * toWidth * rho2 * distance)
  const r0 = -Math.asinh(b0)
  const r1 = -Math.asinh(b1)
  const span = (r1 - r0) / CURVE
  return {
    length: span,
    at: (k) => {
      const r = r0 + CURVE * span * k
      return {
        width: (fromWidth * Math.cosh(r0)) / Math.cosh(r),
        along: (fromWidth * (Math.cosh(r0) * Math.tanh(r) - Math.sinh(r0))) / rho2 / distance,
      }
    },
  }
}

/** Slow to leave and slow to arrive: what a flight takes where none is given. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}
