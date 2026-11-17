import type { BufferAttribute } from 'three/webgpu'
import type { Attribute } from './attributes.js'
import { atOnce, type Steps } from './steps.js'
import type { Wall, WallPlan } from './wallPlan.js'

/**
 * Where on a wall its windows may go: the largest field it covers whole.
 *
 * A wall is whatever faces of a building lie in one plane, and its outline is
 * seldom the rectangle its width and height describe: a gable rises to a point
 * over the eaves, an open ground floor leaves it standing on a column or two,
 * a storey set back over the one below starts in mid-air, a lower wing flush
 * with the front makes an L of it, a building that leans back from the street
 * leaves a side wall shaped like a wedge. Windows set out over the whole width
 * and height would be cut by every one of those edges. So the wall is read
 * along upright lines, each saying where on it there is wall, and the largest
 * field with wall under it at every line is kept. What lies outside it is left
 * plain: a window cut in two reads as a mistake, and a stretch of wall with
 * none does not.
 *
 * A field is a rectangle, or one whose top runs at a slope the wall's own top
 * runs at. The rectangle alone leaves most of a wedge bare — the largest one
 * inside a triangle is a quarter of it — and a slope lets the windows step up
 * it row by row instead.
 *
 * Vertices reaching here have been stood upright and seated, so y is height in
 * metres above the ground the building stands on.
 */

/** Walls narrower than this take no windows, in metres. */
const MIN_WIDTH = 1.5
/** Walls shorter than this take none either, in metres. */
const MIN_HEIGHT = 2.5

/**
 * How far apart the upright lines a wall is read along stand, in metres.
 *
 * Close enough that a step in the outline of a wall is found within a quarter
 * of a metre of where it is, and far enough apart that a wall is read a few
 * dozen times rather than thousands.
 */
const READ_EVERY = 0.25
/** The most lines one wall is read along, however wide it is. */
const MOST_READINGS = 240
/**
 * How far in from each end a wall is read at its ends, in metres. Right on an
 * end a line only grazes the wall, and what it finds there is down to how the
 * numbers happen to round.
 */
const INSET = 0.02
/** Stretches of wall one over the other with less than this between them are one, in metres. */
const TOUCHING = 0.05
/** A top rising or falling by less than this for each metre across is taken as level. */
const LEAST_SLOPE = 0.1
/** The most slopes one wall is tried at, besides level. */
const MOST_SLOPES = 4
/** How much more wall a field with a sloping top has to cover than a rectangle to be chosen over it. */
const SLOPE_MARGIN = 1.1
/** Room for rounding when a field that might yet be found is weighed against the best so far. */
const ROUNDING = 1 + 1e-9

/**
 * The part of a wall windows are set out in, across it from its start and up
 * it from the ground: a rectangle, or one whose top slopes.
 */
export interface Field {
  readonly left: number
  readonly right: number
  readonly foot: number
  /** The highest the field reaches: all along it where it is level, at its high end where it slopes. */
  readonly top: number
  /**
   * How steeply its top runs, in metres up for each metre across: rising
   * to the right where it is more than 0, falling where it is less, level at 0.
   */
  readonly slope: number
}

/** Whether a field is wide enough to hold a window at all. */
export function holdsWindows(field: Field | undefined): field is Field {
  return field !== undefined && field.right - field.left >= MIN_WIDTH
}

/** The field of every wall of a plan, in its order, or nothing for a wall too small to be read. */
export function fieldsOf(
  plan: WallPlan,
  position: Attribute,
  indexed: BufferAttribute,
): (Field | undefined)[] {
  return atOnce(readingFields(plan, position, indexed))
}

/**
 * {@link fieldsOf} a wall at a time, for a tile being shaped between frames;
 * see `steps.ts`. It stops between walls only: the room a wall is read in
 * (below) is shared by every call, and a wall is read all the way through
 * before anything else may use it.
 */
export function* readingFields(
  plan: WallPlan,
  position: Attribute,
  indexed: BufferAttribute,
): Steps<(Field | undefined)[]> {
  const fields: (Field | undefined)[] = []
  for (const wall of plan.walls) {
    fields.push(
      wall.width < MIN_WIDTH || wall.high - wall.low < MIN_HEIGHT
        ? undefined
        : largestField(readAcross(wall, position, indexed), wall.width),
    )
    yield
  }
  return fields
}

// What reading a wall works in. Walls are read one after another and all the
// way through before the next, and what comes back of one is numbers only, so
// the room they are read in is kept from wall to wall rather than taken again
// for each: taking it again was a tenth of the time spent reading.
/** Each triangle's corners, across the wall and up it. Grows to the most any wall needs. */
let corners = new Float64Array(96)
/** Where each line finds the foot of the wall, and its top. */
const feet = new Float64Array(MOST_READINGS + 1)
const tops = new Float64Array(MOST_READINGS + 1)
/** The stretches of wall one line crosses, kept in order of where they start. */
let lows = new Float64Array(16)
let highs = new Float64Array(16)

/**
 * Reads a wall along upright lines into {@link feet} and {@link tops}: at each
 * line, where the longest unbroken stretch of wall it crosses starts and stops.
 * A line that finds no wall reads as a foot at infinity and a top below it.
 *
 * @returns how many spaces the lines stand apart by, one fewer than the lines.
 */
function readAcross(wall: Wall, position: Attribute, indexed: BufferAttribute): number {
  const count = wall.members.length
  if (corners.length < count * 6) corners = new Float64Array(count * 12)
  if (lows.length < count) {
    lows = new Float64Array(count * 2)
    highs = new Float64Array(count * 2)
  }
  for (let i = 0; i < count; i++) {
    const t = wall.members[i] ?? 0
    for (let k = 0; k < 3; k++) {
      const v = indexed.getX(t * 3 + k)
      corners[i * 6 + k * 2] = position.getX(v) * wall.alongX + position.getZ(v) * wall.alongZ - wall.start
      corners[i * 6 + k * 2 + 1] = position.getY(v)
    }
  }

  const lines = Math.min(MOST_READINGS, Math.max(1, Math.ceil(wall.width / READ_EVERY)))
  const step = wall.width / lines
  for (let i = 0; i <= lines; i++) {
    const at = Math.min(Math.max(i * step, INSET), wall.width - INSET)
    let crossed = 0
    for (let j = 0; j < count; j++) {
      let low = Number.POSITIVE_INFINITY
      let high = Number.NEGATIVE_INFINITY
      for (let e = 0; e < 3; e++) {
        const n = ((e + 1) % 3) * 2
        const pa = corners[j * 6 + e * 2] ?? 0
        const pb = corners[j * 6 + e * 2 + 1] ?? 0
        const qa = corners[j * 6 + n] ?? 0
        const qb = corners[j * 6 + n + 1] ?? 0
        if ((pa - at) * (qa - at) > 0) continue
        if (pa === qa) {
          // An edge standing on the line gives both its ends.
          low = Math.min(low, pb, qb)
          high = Math.max(high, pb, qb)
          continue
        }
        const y = pb + ((qb - pb) * (at - pa)) / (qa - pa)
        low = Math.min(low, y)
        high = Math.max(high, y)
      }
      if (!(high > low)) continue
      // Slotted in by where it starts. A line crosses a handful of stretches at
      // the most, so this is quicker than sorting them afterwards.
      let k = crossed++
      while (k > 0 && (lows[k - 1] ?? 0) > low) {
        lows[k] = lows[k - 1] ?? 0
        highs[k] = highs[k - 1] ?? 0
        k--
      }
      lows[k] = low
      highs[k] = high
    }

    let foot = Number.POSITIVE_INFINITY
    let top = Number.NEGATIVE_INFINITY
    let from = Number.POSITIVE_INFINITY
    let to = Number.NEGATIVE_INFINITY
    for (let k = 0; k < crossed; k++) {
      const low = lows[k] ?? 0
      const high = highs[k] ?? 0
      if (low > to + TOUCHING) {
        if (to - from > top - foot) {
          foot = from
          top = to
        }
        from = low
        to = high
      } else if (high > to) to = high
    }
    if (to - from > top - foot) {
      foot = from
      top = to
    }
    feet[i] = foot
    tops[i] = top
  }
  return lines
}

/**
 * The largest field under what {@link readAcross} found, over a wall this
 * wide.
 *
 * Every pair of lines, at every slope worth trying: the wall they both stand on
 * between them, under a top as high as the wall allows at that slope. A slope
 * has to win by a margin, a rectangle being the plainer thing to set windows in
 * where the two come out close.
 *
 * A field too short for a storey is not considered, so a long low strip along
 * the foot of a tower does not win over the tower for its width alone.
 *
 * Most pairs are never looked at. Going on from a line, the foot can only rise
 * and the top only come down, and a field covers more the higher its top and
 * the further it runs — so the field this line would make if it ran on to the
 * far end of the wall without either getting any worse is the most it can come
 * to. Where that is not more than the best so far there is nothing to find
 * from this line, or from here on along it.
 */
function largestField(lines: number, width: number): Field | undefined {
  const step = width / lines
  const far = lines * step
  let best = 0
  let field: Field | undefined
  for (const slope of [0, ...slopesUnder(lines, step)]) {
    const worth = slope === 0 ? 1 : 1 / SLOPE_MARGIN
    for (let i = 0; i < lines; i++) {
      const left = i * step
      let foot = feet[i] ?? Number.POSITIVE_INFINITY
      // Where the top would cross the start of the wall, as low as it has to be
      // to stay under every line.
      let reach = (tops[i] ?? Number.NEGATIVE_INFINITY) - slope * left
      if (areaOver(reach - foot, slope, left, far) * worth * ROUNDING <= best) continue
      for (let j = i + 1; j <= lines; j++) {
        foot = Math.max(foot, feet[j] ?? Number.POSITIVE_INFINITY)
        reach = Math.min(reach, (tops[j] ?? Number.NEGATIVE_INFINITY) - slope * j * step)
        if (!Number.isFinite(foot) || !Number.isFinite(reach)) break
        const right = j * step
        const top = reach + slope * (slope > 0 ? right : left)
        if (top - foot < MIN_HEIGHT - TOUCHING) {
          // Level or falling, it only comes out shorter from here on.
          if (slope <= 0) break
          continue
        }
        const area = areaOver(reach - foot, slope, left, right) * worth
        if (area > best) {
          best = area
          field = { left, right, foot, top, slope }
        } else if (areaOver(reach - foot, slope, left, far) * worth * ROUNDING <= best) break
      }
    }
  }
  return field
}

/**
 * The slopes worth trying for the top of a field: those of the lowest line
 * that can be drawn under the top of the wall all along it, its longest
 * stretches first.
 *
 * Only a line under every part of the top keeps a field inside the wall, and
 * the lowest such line touches the top where it runs straight — the slope of a
 * wedge — and bridges the dips between. A level top gives no slope, and so
 * does a gable: highest in the middle, the line under it runs straight across
 * from eave to eave.
 */
function slopesUnder(lines: number, step: number): number[] {
  // The lower hull of the top, walked from the left.
  const hull: number[] = []
  for (let i = 0; i <= lines; i++) {
    const y = tops[i] ?? Number.NEGATIVE_INFINITY
    if (!Number.isFinite(y)) continue
    while (hull.length >= 2) {
      const a = hull[hull.length - 2] ?? 0
      const b = hull[hull.length - 1] ?? 0
      const ya = tops[a] ?? 0
      const yb = tops[b] ?? 0
      // Keep b only where it stands below the line from a to i.
      if ((b - a) * (y - ya) - (i - a) * (yb - ya) > 0) break
      hull.pop()
    }
    hull.push(i)
  }

  const runs: { slope: number; length: number }[] = []
  for (let k = 1; k < hull.length; k++) {
    const a = hull[k - 1] ?? 0
    const b = hull[k] ?? 0
    const slope = ((tops[b] ?? 0) - (tops[a] ?? 0)) / ((b - a) * step)
    if (Math.abs(slope) < LEAST_SLOPE) continue
    runs.push({ slope, length: (b - a) * step })
  }
  runs.sort((p, q) => q.length - p.length)
  const slopes: number[] = []
  for (const { slope } of runs) {
    if (slopes.some((s) => Math.abs(s - slope) < LEAST_SLOPE)) continue
    slopes.push(slope)
    if (slopes.length === MOST_SLOPES) break
  }
  return slopes
}

/**
 * How much wall a field covers: the area between its foot and a top that
 * starts `rise` over the foot at the start of the wall and climbs `slope` for
 * each metre across, from `left` to `right`. Where the top runs under the foot
 * there is nothing.
 */
function areaOver(rise: number, slope: number, left: number, right: number): number {
  const atLeft = rise + slope * left
  const atRight = rise + slope * right
  if (atLeft >= 0 && atRight >= 0) return ((atLeft + atRight) / 2) * (right - left)
  if (atLeft <= 0 && atRight <= 0) return 0
  const up = Math.max(atLeft, atRight)
  return (up * up) / (2 * Math.abs(slope))
}
