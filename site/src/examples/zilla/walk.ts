/**
 * The walk itself: the creature stood once its clip has been measured, then
 * every frame walked on, the city shaken under each footfall and the camera
 * drawn on after it.
 *
 * On its own so that `main.ts` is the map and nothing else. How a stride is
 * worked out is in `zilla.ts`, and what a footfall does to a building is in
 * `shake.ts`; this is what joins the two to the viewer.
 */
import type { Model, Viewer } from '@plateau-ui/core'
import { HEIGHT, MODEL_URL, REACH, SITE, START, WALK_CLIP, fromSite, toSite } from './data.js'
import { SHAKES, shake, type Shake } from './shake.js'
import { Zilla, measureWalk } from './zilla.js'

/**
 * How long the camera takes to close most of the gap to the creature, in
 * seconds.
 *
 * It trails rather than holds it still. Pinned to the middle of the frame the
 * creature would be the one thing on screen not moving and the city would
 * slide past underneath it, which reads as a treadmill; a second or so of lag
 * leaves it running a little ahead of the middle, and that reads as walking.
 */
const LAG = 1.1

/**
 * Sets the creature off through the district, and hands back what picks how
 * the city shakes under it.
 *
 * The creature is stood once its walk has been measured off its own clip,
 * since how big it is drawn and how far under its origin its feet go both come
 * out of that. Nothing is drawn until then: a creature standing in its bind
 * pose for the second the measuring takes would be a lizard lying in the road.
 *
 * Then, every frame, it walks on, the city is shaken wherever a foot came
 * down, the model is stood where the walk has got to, and the camera is drawn
 * on after it. The clip is wound by where the stride is rather than run on a
 * clock of its own, which is what keeps the foot carrying the weight still
 * while the body passes over it.
 */
export function walk(viewer: Viewer): (how: Shake) => void {
  let how: Shake = SHAKES[0]!

  void (async () => {
    const measured = await measureWalk(MODEL_URL, WALK_CLIP)
    const model = await viewer.models.bring({
      url: MODEL_URL,
      at: SITE,
      // How tall the page wants it over how tall the file stands, both in the one
      // measurement: `measured.height` is the creature at its tallest through the
      // whole turn of the clip, and the foot below is off that same number. The
      // viewer measured its own once — the bind pose, which for a creature mid
      // stride is a third height — and the two rulers did not agree
      scale: HEIGHT / measured.height,
      // Its feet on the ground at the lowest they come in a stride
      height: (-measured.lowest * HEIGHT) / measured.height,
      clip: WALK_CLIP,
      credit: { text: 'モデル「Trex」Quaternius（CC0）', url: 'https://quaternius.com' },
    })
    if (model && !viewer.disposed) walkOn(new Zilla(measured, REACH, START), model)
  })()

  /** Where it has got to this frame, and the city shaken under each footfall. */
  function walkOn(zilla: Zilla, model: Model): void {
    viewer.on('frame', ({ delta }) => {
      for (const print of zilla.step(delta)) shake(viewer.buildings, fromSite(...print), how)
      model.at = fromSite(...zilla.origin)
      model.facing = zilla.facing
      model.clipTime = zilla.clipTime

      // Where the view is now, which is the viewer's answer and not a number
      // kept here, and then the same share of the gap every second rather than
      // every frame, so the camera trails by as much on a slow machine as on a
      // fast one. Only the middle is written: the tilt, the turn and how close
      // in it is stay whatever the page or a reader set them to.
      const [east, north] = toSite(...viewer.camera.center)
      const closes = 1 - Math.exp(-delta / LAG)
      viewer.camera.center = fromSite(
        east + (zilla.stance.x - east) * closes,
        north + (zilla.stance.y - north) * closes,
      )
    })
  }

  return (chosen) => {
    how = chosen
  }
}
