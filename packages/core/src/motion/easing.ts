/**
 * How time is bent between one moment and the next.
 *
 * Written the way CSS writes it, so a page that already knows `'ease-out'`
 * knows this, or as a plain function for anything CSS cannot say. The names
 * and the curves behind them are the ones CSS gives.
 */
export type Easing = string | ((t: number) => number)

/** Straight through: what is left out. */
export const linear = (t: number): number => t

/** The four numbers CSS gives each of its named curves. */
const NAMED: Record<string, readonly [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

const CUBIC = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/
const STEPS = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/
/** Where CSS lets steps jump. */
const STEP_POSITIONS: readonly string[] = ['start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both']

/**
 * Reads an easing, or throws naming `owner`.
 *
 * A function is taken as it is: it is asked for the share of the way covered
 * at a share of the time, both from 0 to 1, and may leave that range — a
 * curve that overshoots is a curve.
 */
export function easingOf(easing: Easing | undefined, owner: string): (t: number) => number {
  if (easing === undefined) return linear
  if (typeof easing === 'function') return easing
  if (typeof easing !== 'string') throw new Error(`${owner}: easing is a name or a function`)

  const name = easing.trim()
  if (name === 'linear') return linear
  const named = NAMED[name]
  if (named) return bezier(...named)
  if (name === 'step-start') return steps(1, 'start')
  if (name === 'step-end') return steps(1, 'end')

  const cubic = CUBIC.exec(name)
  if (cubic) {
    const numbers = cubic.slice(1, 5).map(Number)
    if (numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(`${owner}: cubic-bezier takes four numbers, got "${name}"`)
    }
    const [x1, y1, x2, y2] = numbers as [number, number, number, number]
    // The curve is a function of time only where time runs forward all the way
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
      throw new Error(`${owner}: the first and third numbers of cubic-bezier are 0 to 1`)
    }
    return bezier(x1, y1, x2, y2)
  }

  const stepped = STEPS.exec(name)
  if (stepped) {
    const count = Number(stepped[1])
    const at = stepped[2] ?? 'end'
    // Named wrong, it is not an easing, as a curve named wrong is not. It was
    // taken as `end` without a word, which ran a `middle` as though it were
    if (!STEP_POSITIONS.includes(at)) throw new Error(`${owner}: "${at}" is not a place for steps to jump`)
    // Two places at least, where the first and the last are both held
    const least = at === 'jump-none' ? 2 : 1
    if (count < least) throw new Error(`${owner}: steps(${at}) takes ${least} or more`)
    return steps(count, at)
  }

  throw new Error(`${owner}: "${name}" is not an easing`)
}

/** How near the wanted time a guess has to land before the curve answers. */
const CLOSE_ENOUGH = 1e-6
/** Tries at Newton's method before falling back on halving the range. */
const NEWTON_TRIES = 8

/**
 * The curve CSS draws through (0,0), (x1,y1), (x2,y2) and (1,1).
 *
 * Time runs along x and the way covered along y, so answering means finding
 * the point whose x is the time asked for. Newton's method walks there in a
 * few steps where the curve is steep enough to say which way to go, and the
 * range is halved instead where it is not.
 */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (x1 === y1 && x2 === y2) return linear

  const alongX = (t: number): number => curve(t, x1, x2)
  const alongY = (t: number): number => curve(t, y1, y2)

  return (time: number): number => {
    if (time <= 0) return 0
    if (time >= 1) return 1

    let at = time
    for (let i = 0; i < NEWTON_TRIES; i++) {
      const off = alongX(at) - time
      if (Math.abs(off) < CLOSE_ENOUGH) return alongY(at)
      const slope = slopeX(at, x1, x2)
      if (Math.abs(slope) < CLOSE_ENOUGH) break
      at -= off / slope
    }

    let low = 0
    let high = 1
    at = time
    while (high - low > CLOSE_ENOUGH) {
      const off = alongX(at) - time
      if (off > 0) high = at
      else low = at
      at = (low + high) / 2
    }
    return alongY(at)
  }
}

/** A cubic Bézier along one axis, its ends fixed at 0 and 1. */
function curve(t: number, a: number, b: number): number {
  const c = 3 * a
  const d = 3 * (b - a) - c
  const e = 1 - c - d
  return ((e * t + d) * t + c) * t
}

/** How fast the curve runs along x, for Newton to follow. */
function slopeX(t: number, x1: number, x2: number): number {
  const c = 3 * x1
  const d = 3 * (x2 - x1) - c
  const e = 1 - c - d
  return (3 * e * t + 2 * d) * t + c
}

/**
 * Jumping from one moment to the next rather than passing between them.
 *
 * As CSS works it out: the step is counted along the time and moved on one
 * where it jumps at the start, and divided by how many jumps there are —
 * one more than the steps where it jumps at both ends, one fewer where it
 * jumps at neither. `jump-both` was divided as `jump-start` was, so its first
 * and last steps were never held.
 */
function steps(count: number, at: string): (t: number) => number {
  const start = at === 'start' || at === 'jump-start' || at === 'jump-both'
  const jumps = at === 'jump-both' ? count + 1 : at === 'jump-none' ? count - 1 : count
  return (t: number): number => {
    const held = Math.min(Math.max(t, 0), 1)
    const step = Math.floor(held * count) + (start ? 1 : 0)
    return Math.min(Math.max(step, 0), jumps) / jumps
  }
}
