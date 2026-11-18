/**
 * A clock the recorder turns by hand.
 *
 * Put into every page before its own scripts run. Until `__clock.freeze()` the
 * page runs on the real clock, so it loads, compiles and lands its tiles as it
 * would for anyone. After it, time stands still between frames and moves on
 * only when the recorder says `__clock.step(ms)`: a frame that took two
 * seconds to capture is still one frame of the video, and a camera move comes
 * out as smooth as the numbers in it.
 *
 * What is turned by hand is everything the library reads time from:
 * `performance.now()`, `Date.now()`, `requestAnimationFrame`, and the browser's
 * `Animation`, which the library uses as a clock for its motions and camera
 * flights (`motion/motion.ts`). The last is replaced by a small one of our own
 * that answers the handful of things the library asks of it, worked out from
 * `performance.now()` — the browser's own runs on the compositor's time,
 * which no page can stop. CSS animations are not turned: a shot does its own
 * moving in script.
 *
 * Timers (`setTimeout`) keep real time. The library uses them only to retry
 * what failed, and a retry that comes early in the video's time is a tile
 * that lands early, which is no harm.
 */
;(() => {
  const realNow = performance.now.bind(performance)
  const realRaf = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  const realDateNow = Date.now

  /** Virtual time, once frozen; `null` while the page runs on the real clock. */
  let frozenAt = null
  /** Real time minus virtual time at the freeze, so Date keeps counting from where it was. */
  let dateBase = 0

  const now = () => (frozenAt === null ? realNow() : frozenAt)
  performance.now = now
  Date.now = () => (frozenAt === null ? realDateNow() : dateBase + frozenAt)

  /** Callbacks asked for while frozen, run on the next step. */
  let queue = new Map()
  let nextId = 1
  /** Ids handed out while live, mapped to the real handle, so a cancel finds it. */
  const live = new Map()

  window.requestAnimationFrame = (callback) => {
    const id = nextId++
    if (frozenAt === null) {
      live.set(
        id,
        realRaf(() => {
          live.delete(id)
          if (frozenAt === null) callback(now())
          // Frozen while it waited: it belongs to the first step now
          else queue.set(id, callback)
        }),
      )
    } else queue.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => {
    queue.delete(id)
    const handle = live.get(id)
    if (handle !== undefined) {
      realCancel(handle)
      live.delete(id)
    }
  }

  // ---- Animation, on this clock ---------------------------------------------

  const animations = new Set()

  /** Web Animations' timing model, cut down to what the library reads. */
  function computed(timing, localTime) {
    if (localTime === null) return { progress: null, currentIteration: null }
    const delay = timing.delay ?? 0
    const duration = typeof timing.duration === 'number' ? timing.duration : 0
    const iterations = timing.iterations ?? 1
    const fill = timing.fill ?? 'none'
    const active = duration * iterations
    let activeTime
    let phase
    if (localTime < delay) {
      phase = 'before'
      activeTime = fill === 'backwards' || fill === 'both' ? 0 : null
    } else if (localTime >= delay + active) {
      phase = 'after'
      activeTime = fill === 'forwards' || fill === 'both' ? active : null
    } else {
      phase = 'active'
      activeTime = localTime - delay
    }
    if (activeTime === null) return { progress: null, currentIteration: null }
    const overall = duration === 0 ? (phase === 'before' ? 0 : iterations) : activeTime / duration
    let simple = Number.isFinite(overall) ? overall % 1 : 0
    if (simple === 0 && phase !== 'before' && overall !== 0 && activeTime === active && iterations !== 0) simple = 1
    let iteration = Math.floor(overall)
    if (simple === 1) iteration = overall - 1
    const direction = timing.direction ?? 'normal'
    const forwards =
      direction === 'normal' ||
      (direction === 'alternate' && iteration % 2 === 0) ||
      (direction === 'alternate-reverse' && iteration % 2 === 1)
    return { progress: forwards ? simple : 1 - simple, currentIteration: iteration }
  }

  class ClockAnimation {
    #timing
    #startTime = null
    #holdTime = null
    #rate = 1
    #idle = true
    #done = null
    #settled = false

    constructor(effect) {
      this.#timing = effect ? effect.getTiming() : { duration: 0 }
      this.#fresh()
      animations.add(this)
    }

    #fresh() {
      let resolve
      let reject
      const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
      this.#done = { promise, resolve, reject }
      this.#settled = false
    }

    #end() {
      const t = this.#timing
      const duration = typeof t.duration === 'number' ? t.duration : 0
      return (t.delay ?? 0) + duration * (t.iterations ?? 1)
    }

    get effect() {
      return { getTiming: () => this.#timing, getComputedTiming: () => computed(this.#timing, this.currentTime) }
    }

    get currentTime() {
      if (this.#idle) return null
      if (this.#holdTime !== null) return this.#holdTime
      return (now() - this.#startTime) * this.#rate
    }

    set currentTime(time) {
      if (time === null) return
      if (this.#idle || this.#holdTime !== null) {
        this.#idle = false
        this.#holdTime = time
      } else this.#startTime = now() - time / this.#rate
      this.#check()
    }

    get playbackRate() {
      return this.#rate
    }

    set playbackRate(rate) {
      const at = this.currentTime
      this.#rate = rate
      if (at !== null && this.#holdTime === null) this.#startTime = now() - at / rate
    }

    #finishedNow(at = this.currentTime) {
      if (at === null) return false
      return this.#rate > 0 ? at >= this.#end() : this.#rate < 0 ? at <= 0 : false
    }

    get playState() {
      if (this.#idle) return 'idle'
      if (this.#finishedNow()) return 'finished'
      if (this.#holdTime !== null && this.#paused) return 'paused'
      return 'running'
    }

    #paused = false

    play() {
      let at = this.#idle ? null : this.currentTime
      if (at === null || this.#finishedNow(at)) at = this.#rate >= 0 ? 0 : this.#end()
      if (this.#settled) this.#fresh()
      this.#idle = false
      this.#paused = false
      this.#holdTime = null
      this.#startTime = now() - at / this.#rate
    }

    pause() {
      const at = this.#idle ? 0 : this.currentTime
      this.#idle = false
      this.#paused = true
      this.#holdTime = at
      this.#startTime = null
    }

    reverse() {
      this.#rate = -this.#rate
      this.play()
    }

    finish() {
      this.#idle = false
      this.#holdTime = this.#rate >= 0 ? this.#end() : 0
      if (!this.#paused) this.#startTime = now() - this.#holdTime / this.#rate
      if (!this.#paused) this.#holdTime = null
      this.#check()
    }

    cancel() {
      this.#idle = true
      this.#holdTime = null
      this.#startTime = null
      if (!this.#settled) {
        this.#settled = true
        this.#done.reject(new DOMException('cancelled', 'AbortError'))
      }
      this.#fresh()
    }

    get finished() {
      return this.#done.promise
    }

    #check() {
      if (!this.#settled && !this.#idle && this.#finishedNow()) {
        this.#settled = true
        this.#done.resolve(this)
      }
    }

    tick() {
      this.#check()
    }
  }

  window.Animation = ClockAnimation

  function tickAnimations() {
    for (const animation of animations) animation.tick()
  }
  ;(function watch() {
    if (frozenAt === null) tickAnimations()
    realRaf(watch)
  })()

  // ---- What the recorder calls ----------------------------------------------

  const twoRealFrames = () => new Promise((done) => realRaf(() => realRaf(done)))

  /** The clocks of frames inside this page that this page can reach (same origin). */
  function children() {
    const found = []
    for (let i = 0; i < window.frames.length; i++) {
      try {
        const clock = window.frames[i].__clock
        if (clock) found.push(clock)
      } catch {
        // Another origin: its clock is not ours to turn
      }
    }
    return found
  }

  window.__clock = {
    freeze() {
      for (const child of children()) child.freeze()
      if (frozenAt !== null) return
      const at = realNow()
      dateBase = realDateNow() - at
      frozenAt = at
    },
    /** Moves time on by `ms`, runs one frame here and in the frames inside, and settles once shown. */
    async step(ms) {
      if (frozenAt === null) this.freeze()
      frozenAt += ms
      tickAnimations()
      const due = queue
      queue = new Map()
      for (const callback of due.values()) {
        try {
          callback(frozenAt)
        } catch (error) {
          console.error(error)
        }
      }
      for (const child of children()) child.turn(ms)
      await twoRealFrames()
    },
    /** A step without the wait, for a frame inside a page that is being stepped. */
    turn(ms) {
      if (frozenAt === null) this.freeze()
      frozenAt += ms
      tickAnimations()
      const due = queue
      queue = new Map()
      for (const callback of due.values()) {
        try {
          callback(frozenAt)
        } catch (error) {
          console.error(error)
        }
      }
      for (const child of children()) child.turn(ms)
    },
    get now() {
      return now()
    },
  }
})()
