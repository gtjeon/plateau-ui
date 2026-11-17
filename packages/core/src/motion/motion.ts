import { easingOf, type Easing } from './easing.js'

/**
 * The browser's own `Animation`, under a name of its own.
 *
 * This module exports an {@link Animation} of its own, which shadows the
 * global inside it — the same shadowing a page that uses both takes care of
 * with `import { Animation as … }`. Named here rather than reached for
 * through `globalThis` at every use so that the two read apart at a glance:
 * one is the browser's clock, the other is what a page is handed.
 */
const WebAnimation = globalThis.Animation
type WebAnimation = InstanceType<typeof WebAnimation>

/**
 * Running a motion, and being played with while it runs.
 *
 * The timing is the Web Animations API's, and it is the browser's own that
 * keeps it: a motion holds a browser `Animation` with nothing to animate, asks it
 * every frame how far along it is, and moves whatever it moves by that. So
 * `delay`, `iterations`, `alternate`, `fill` and `playbackRate` behave exactly
 * as they do on an element, because they are the same code — and none of it is
 * written here.
 */

/** How a motion's time runs: the timing of `element.animate`. */
export interface Timing {
  /** How long one run takes, in milliseconds. */
  readonly duration: number
  /** How long before it starts, in milliseconds. Defaults to 0. */
  readonly delay?: number
  /**
   * How time runs through each run, on top of whatever the keyframes say.
   * Defaults to running straight through.
   */
  readonly easing?: Easing
  /** How many runs; `Infinity` for ever. Defaults to 1. */
  readonly iterations?: number
  /** Which way the runs go. Defaults to `'normal'`. */
  readonly direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
  /**
   * What is shown outside the runs: the first moment while it waits
   * (`'backwards'`), the last once it is done (`'forwards'`), both, or neither
   * (`'none'`, the default), where it is as if the motion were not there.
   */
  readonly fill?: 'none' | 'forwards' | 'backwards' | 'both'
}

/** Where a motion is, as the Web Animations API names it. */
export type PlayState = 'idle' | 'running' | 'paused' | 'finished'

/**
 * One motion, played with as the browser's `Animation` is played with.
 *
 * It carries that name because it is that thing: `animate` returns it, the
 * timing is the Web Animations API's, and `play`, `pause`, `finish`,
 * `cancel`, `currentTime` and `playbackRate` all mean what they mean there.
 * {@link finished} is the one that does not — the browser's rejects when a
 * motion is cancelled, and this one settles false; see its own line.
 *
 * A page that uses the browser's `Animation` in the same file takes whichever
 * of the two it wants under another name —
 * `import { Animation as PlateauAnimation } from '@plateau-ui/core'`.
 *
 * It starts on the call, so most pages let it go:
 *
 * @example
 * viewer.camera.animate([{ heading: 0 }, { heading: 360 }], {
 *   duration: 60000,
 *   iterations: Infinity,
 * })
 *
 * Held, where a page plays with it while it runs — stopped, scrubbed, or
 * waited on:
 *
 * @example
 * const stretch = buildings.animate(id, [{ scale: 1 }, { scale: 1.3 }], { duration: 600 })
 * stretch.pause()
 * stretch.currentTime = 300
 * if (await stretch.finished) console.log('grown')
 */
export interface Animation {
  readonly playState: PlayState
  /**
   * Where it has got to, in milliseconds from its start; set it to jump there.
   * Null once cancelled.
   */
  currentTime: number | null
  /** How fast it plays: 2 twice as fast, -1 backwards. */
  playbackRate: number
  /**
   * Settles as the motion stops: true when it comes to its end, false when it
   * is cancelled or taken over. It never rejects, so it can be left alone.
   */
  readonly finished: Promise<boolean>
  /** Plays on from where it is, or from the start once finished or cancelled. */
  play(): void
  /** Holds it where it is. */
  pause(): void
  /** Plays it the other way from where it is. */
  reverse(): void
  /** Jumps to its end — its start, played backwards. */
  finish(): void
  /** Stops it. Whatever it moved stands as if it had never played. */
  cancel(): void
}

/** What runs a motion asks of it every frame. */
export interface Playing extends Animation {
  /**
   * How far through a run it is, 0 to 1, with the timing's own easing already
   * laid over it — or null where the motion has nothing to say: before it
   * starts, or after it ends, unless it fills.
   */
  progress(): number | null
  /** Whether it is still worth asking. */
  readonly alive: boolean
}

/** Reads a timing, or throws naming `owner`. */
function check(timing: Timing, owner: string): void {
  const { duration, delay = 0, iterations = 1 } = timing
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`${owner}: duration is a number of milliseconds, 0 or more`)
  }
  if (!Number.isFinite(delay)) throw new Error(`${owner}: delay is a number of milliseconds`)
  if (Number.isNaN(iterations) || iterations < 0) {
    throw new Error(`${owner}: iterations is 0 or more, or Infinity`)
  }
}

/**
 * Starts a motion running on the browser's own timeline.
 *
 * Nothing is handed to the browser's animation to animate. What it is for is its
 * clock: `getComputedTiming().progress` says how far through a run it is, having
 * already counted the delay, the runs, the direction and the fill.
 */
export function play(timing: Timing, owner: string): Playing {
  check(timing, owner)
  const ease = easingOf(timing.easing, owner)

  const effect = new KeyframeEffect(null, null, {
    duration: timing.duration,
    delay: timing.delay ?? 0,
    iterations: timing.iterations ?? 1,
    direction: timing.direction ?? 'normal',
    fill: timing.fill ?? 'none',
    // Ours is laid over the progress instead, so a function eases as a name does
    easing: 'linear',
  })
  const animation = new WebAnimation(effect, document.timeline)
  animation.play()
  return new Player(animation, ease)
}

class Player implements Playing {
  readonly #animation: WebAnimation
  readonly #ease: (t: number) => number

  constructor(animation: WebAnimation, ease: (t: number) => number) {
    this.#animation = animation
    this.#ease = ease
    this.#hush()
  }

  progress(): number | null {
    const at = this.#animation.effect?.getComputedTiming().progress
    return at === null || at === undefined ? null : this.#ease(at)
  }

  get alive(): boolean {
    return this.#animation.playState !== 'idle' && this.progress() !== null
  }

  get playState(): PlayState {
    return this.#animation.playState
  }

  get currentTime(): number | null {
    const time = this.#animation.currentTime
    return typeof time === 'number' ? time : null
  }

  set currentTime(time: number | null) {
    this.#animation.currentTime = time
  }

  get playbackRate(): number {
    return this.#animation.playbackRate
  }

  set playbackRate(rate: number) {
    this.#animation.playbackRate = rate
  }

  /**
   * True at its end, false where it was stopped.
   *
   * The browser's own turns down when cancelled, which a page that only
   * wanted to know when a motion ended would have to catch; this settles
   * instead. It is read afresh every time, since playing a motion on from its
   * end gives it a new one to settle.
   */
  get finished(): Promise<boolean> {
    return this.#animation.finished.then(
      () => true,
      () => false,
    )
  }

  play(): void {
    this.#animation.play()
    this.#hush()
  }

  pause(): void {
    this.#animation.pause()
  }

  reverse(): void {
    this.#animation.reverse()
    this.#hush()
  }

  finish(): void {
    this.#animation.finish()
  }

  cancel(): void {
    this.#animation.cancel()
  }

  /**
   * Keeps a cancelled motion from being reported as an error nobody caught.
   *
   * The browser's own promise turns down when it is cancelled. A page that
   * never asked whether the motion finished has no handler on it, and the
   * browser calls that an unhandled rejection.
   */
  #hush(): void {
    void this.#animation.finished.catch(() => undefined)
  }
}
