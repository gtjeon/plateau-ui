/**
 * The card the video ends on: the name, how to get it, where it lives, and
 * the sources every map in the video drew from.
 */
import { inOut, shot, span } from '../../shared/shot.js'
import { note } from '../../shared/overlay.js'

const SECONDS = 6

note()
const end = document.getElementById('end')!
const sources = document.getElementById('sources')!

// The code has to be drawn before the first frame is taken
const qr = document.querySelector<HTMLImageElement>('#end .qr')!
const ready = qr.complete ? Promise.resolve() : new Promise<void>((done) => qr.addEventListener('load', () => done()))

shot(SECONDS, ready, (t) => {
  const k = span(t, 0.3, 1.3, inOut)
  end.style.opacity = String(k)
  end.style.transform = `translateY(${(14 * (1 - k)).toFixed(2)}px)`
  sources.style.opacity = String(span(t, 0.8, 1.6, inOut))
})
