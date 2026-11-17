import type { Mesh } from 'three/webgpu'
import { APPEAR, CLEAR_OF_THE_GROUND, whenOf, type Way } from '../appear.js'
import { BATCH_ID } from './attributes.js'

/**
 * Where a tile's buildings are told to rise, and how far each has to come.
 *
 * The coming and going is written once for everything that does it, and that
 * is not here: the clock, the way and the shader are the viewer's, and the
 * green a park lies on reads the same ones. What is here is the one thing only
 * a building tile can say — which corner belongs to which building. The trees
 * keep their own for the same reason, so that neither has to be known where
 * both are read.
 */

/**
 * Says on a mesh's corners when each of its buildings sets off and how far
 * under the ground the far end of its way lies.
 *
 * Called as a tile lands, as the view leaves the zooms buildings stand at, and
 * again whenever a mesh is cut anew: carving parapets leaves the corners it
 * adds saying nothing, and a building whose walls rose while its parapet stood
 * would come up wearing a hat in the air.
 *
 * `only` names a few of the mesh's buildings where the rest are to be left
 * alone — which is what a page taking one out of a standing city wants, and
 * what nothing wanted while whole tiles were the only things coming and going.
 */
export function stampAppear(
  mesh: Mesh,
  at: number,
  stagger: number,
  way: Way,
  only?: ReadonlySet<number>,
): void {
  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  const said = mesh.geometry.attributes[APPEAR]
  if (!positions || !batch || !said) return

  // How high each building reaches from the nought it is seated on
  const tops = new Map<number, number>()
  for (let v = 0; v < positions.count; v++) {
    const building = batch.getX(v)
    const y = positions.getY(v)
    const top = tops.get(building)
    if (top === undefined || y > top) tops.set(building, y)
  }

  const sign = way === 'up' ? 1 : -1
  const array = said.array as Float32Array
  for (let v = 0; v < batch.count && v * 2 + 1 < array.length; v++) {
    const building = batch.getX(v)
    // Some of them, where a page took a few buildings out of a tile the rest
    // of which is standing still: the corners of the others are left saying
    // what they said, which is that their way is behind them
    if (only && !only.has(building)) continue
    array[v * 2] = whenOf(building, at, stagger)
    array[v * 2 + 1] = sign * ((tops.get(building) ?? 0) + CLEAR_OF_THE_GROUND)
  }
  said.needsUpdate = true
}
