/**
 * What every shot page shares: telling the recorder when it is ready and how
 * long it runs, and turning the clock's time into the shot's own seconds.
 *
 * A shot is a function of its time and nothing else. Every frame asks
 * `update(t)` for the picture at `t`, so the recorder can step through it at
 * any rate and a preview in a browser (`?play`) shows the same thing live.
 */

declare global {
  interface Window {
    __shot?: { ready: Promise<void>; seconds: number; begin(from?: number): void }
  }
}

export function shot(seconds: number, ready: Promise<unknown>, update: (t: number) => void): void {
  let origin: number | null = null
  const settled = ready.then(() => undefined)
  window.__shot = {
    ready: settled,
    seconds,
    begin(from = 0) {
      origin = performance.now() - from * 1000
      update(from)
    },
  }
  const loop = (): void => {
    if (origin !== null) update(Math.min((performance.now() - origin) / 1000, seconds))
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // Seen in an ordinary browser: play once ready, from `?play=<seconds>`
  const play = new URLSearchParams(location.search).get('play')
  if (play !== null) void settled.then(() => window.__shot?.begin(Number(play) || 0))
}

// ---- Moving between values ---------------------------------------------------

export type Ease = (x: number) => number

export const linear: Ease = (x) => x
export const inOut: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
export const out: Ease = (x) => 1 - (1 - x) ** 3
export const inOutSine: Ease = (x) => -(Math.cos(Math.PI * x) - 1) / 2

/** 0 before `from`, 1 after `to`, eased in between. */
export function span(t: number, from: number, to: number, ease: Ease = inOut): number {
  if (t <= from) return 0
  if (t >= to) return 1
  return ease((t - from) / (to - from))
}

export const mix = (a: number, b: number, k: number): number => a + (b - a) * k

/** Angles the short way round. */
export function mixAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return a + d * k
}

/** A value held at keys `[time, value]` and eased between them. */
export function track(keys: readonly (readonly [number, number])[], ease: Ease = inOut): (t: number) => number {
  return (t) => {
    if (t <= keys[0]![0]) return keys[0]![1]
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i]!
      const [t0, v0] = keys[i - 1]!
      if (t <= t1) return mix(v0, v1, span(t, t0, t1, ease))
    }
    return keys[keys.length - 1]![1]
  }
}

/** Fades in over `fade` seconds from `from`, out over `fade` before `to`. */
export function shown(t: number, from: number, to: number, fade = 0.4): number {
  return Math.min(span(t, from, from + fade, linear), 1 - span(t, to - fade, to, linear))
}

/** Waits for a viewer's buildings to stand, then a moment more. */
export function standing(on: (name: 'idle', listener: () => void) => () => void, more = 1500): Promise<void> {
  return new Promise((done) => {
    const stop = on('idle', () => {
      stop()
      setTimeout(done, more)
    })
  })
}
