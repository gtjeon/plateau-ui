import { easingOf, linear, type Easing } from './easing.js'

/**
 * Reading keyframes the way the Web Animations API reads them.
 *
 * A keyframe says where something stands at one moment of a run, and what it
 * leaves out it does not move. So the keyframes are taken apart, one list a
 * property, and each list is read on its own: a motion that names `zoom` in
 * its middle keyframe alone still passes smoothly through it, and whatever it
 * never names is left where it was.
 */

/** What every keyframe may say, whatever else it says. */
export interface Keyframe {
  /**
   * Where in the run this keyframe stands, from 0 at its start to 1 at its
   * end. Left out, keyframes are spread evenly between those that say.
   */
  readonly offset?: number
  /**
   * How time bends from this keyframe to the next, on top of the motion's own.
   * Defaults to running straight through.
   */
  readonly easing?: Easing
}

/** One keyframe's worth of one property. */
export interface Frame<T> {
  readonly offset: number
  readonly easing: (t: number) => number
  readonly value: T
}

/**
 * Where each keyframe stands in a run, as the Web Animations API works it out:
 * the offsets given, and the ones left out spread evenly between them, the
 * first at 0 and the last at 1. Throws, naming `owner`, where an offset is
 * outside 0 to 1 or goes back on the one before.
 */
export function offsetsOf(keyframes: readonly Keyframe[], owner: string): number[] {
  if (!Array.isArray(keyframes)) throw new Error(`${owner}: keyframes are a list`)

  const given = keyframes.map((keyframe, i) => {
    if (!keyframe || typeof keyframe !== 'object') {
      throw new Error(`${owner}: keyframe ${i} is not an object`)
    }
    const { offset } = keyframe
    if (offset === undefined) return undefined
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
      throw new Error(`${owner}: keyframe ${i} has an offset outside 0 to 1`)
    }
    return offset
  })

  let last = -Infinity
  for (const offset of given) {
    if (offset === undefined) continue
    if (offset < last) throw new Error(`${owner}: keyframe offsets go back`)
    last = offset
  }

  const spread = given.slice()
  if (spread.length > 1 && spread[0] === undefined) spread[0] = 0
  if (spread.length > 0 && spread[spread.length - 1] === undefined) spread[spread.length - 1] = 1
  for (let i = 0; i < spread.length; i++) {
    if (spread[i] !== undefined) continue
    let next = i
    while (spread[next] === undefined) next++
    const from = spread[i - 1] ?? 0
    const to = spread[next] ?? 1
    for (let k = i; k < next; k++) {
      spread[k] = from + ((to - from) * (k - i + 1)) / (next - i + 1)
    }
  }
  return spread.map((offset) => offset ?? 0)
}

/**
 * The frames of one property: those keyframes that give it, each with where it
 * stands and how time bends from it.
 */
export function framesOf<K extends Keyframe, T>(
  keyframes: readonly K[],
  offsets: readonly number[],
  read: (keyframe: K, at: number) => T | undefined,
  owner: string,
): Frame<T>[] {
  const frames: Frame<T>[] = []
  keyframes.forEach((keyframe, i) => {
    const value = read(keyframe, i)
    if (value === undefined) return
    frames.push({ offset: offsets[i] ?? 0, easing: easingOf(keyframe.easing, owner), value })
  })
  return frames
}

/**
 * Where a property stands `progress` of the way through a run.
 *
 * Where the frames do not reach the start or the end of the run, `unset` —
 * where the thing stands untouched — stands in there, so a property named in
 * the middle alone comes from where it was and goes back to it.
 */
export function valueAt<T>(
  frames: readonly Frame<T>[],
  progress: number,
  unset: T,
  mix: (from: T, to: T, t: number) => T,
): T {
  if (frames.length === 0) return unset

  const full: Frame<T>[] = []
  if ((frames[0]?.offset ?? 0) !== 0) full.push({ offset: 0, easing: linear, value: unset })
  full.push(...frames)
  const last = frames[frames.length - 1]
  if ((last?.offset ?? 1) !== 1) full.push({ offset: 1, easing: linear, value: unset })
  if (full.length === 1) return full[0]!.value

  if (progress <= 0) return full[0]!.value
  if (progress >= 1) return full[full.length - 1]!.value

  let start = 0
  for (let i = 0; i < full.length - 1; i++) {
    const frame = full[i]!
    if (frame.offset <= progress && frame.offset < 1) start = i
  }
  const from = full[start]!
  const to = full[start + 1]!
  const span = to.offset - from.offset
  const local = span === 0 ? 0 : (progress - from.offset) / span
  return mix(from.value, to.value, from.easing(local))
}

/** Straight between two numbers. */
export function mixNumbers(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Straight between two pairs of numbers. */
export function mixPairs(
  from: readonly [number, number],
  to: readonly [number, number],
  t: number,
): readonly [number, number] {
  return [mixNumbers(from[0], to[0], t), mixNumbers(from[1], to[1], t)]
}

/** Straight between two triples of numbers. */
export function mixTriples(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): readonly [number, number, number] {
  return [mixNumbers(from[0], to[0], t), mixNumbers(from[1], to[1], t), mixNumbers(from[2], to[2], t)]
}
