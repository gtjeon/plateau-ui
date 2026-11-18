/**
 * The city shaking, for the disaster page of the second part: the zilla
 * example's own push-and-pull shake (`ゆさぶり`), set off from one point again
 * and again, with no monster.
 *
 * It is a picture of shaking and not a model of it — keyframes laid over the
 * buildings, spreading out from a point — and the page it sits in says so.
 */
import { Viewer } from '@plateau-ui/core'
import { SHAKES, shake } from '../../../site/src/examples/zilla/shake.js'

/** 虎ノ門, where the zilla example stands: towers among older blocks. */
const SITE: [number, number] = [139.749, 35.6607]
/** How often the ground goes again, in seconds. */
const AGAIN = 2.8

const viewer = new Viewer({
  container: 'map',
  center: SITE,
  zoom: 17.2,
  pitch: 58,
  heading: 126,
  mask: { shapes: [{ shape: 'view' }] },
  buildings: { minZoom: false },
})
Object.assign(window, { viewer })

const rock = SHAKES.find((s) => s.id === 'rock')!
let next: number | null = null
const loop = (): void => {
  const now = performance.now() / 1000
  if (viewer.buildings.tileCount.held > 0) {
    next ??= now + 0.6
    if (now >= next) {
      shake(viewer.buildings, SITE, rock)
      next = now + AGAIN
    }
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
