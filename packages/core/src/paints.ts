/**
 * Where a colour lands.
 *
 * Anything a page puts a colour on the map with asks this and means the same
 * by it: the land, what was built on it, or both. Asked once and in one word,
 * so that a reader who has met the question in one of them has met it in the
 * others — and so that saying it is the whole of asking for the paint; see
 * {@link ShapeSticks}.
 *
 * **Three asked it once.** A shape, a box of numbers the city took its colour
 * from, and a picture published as tiles and laid over the walls. The last two
 * went on 2026-10-13 with the channel that let one layer read another's data,
 * and in the same change a picture came back to it by another road: both
 * picture layers say with it where their picture lands — on the land's sheet,
 * and through the viewer's projector onto what stands (`projection.ts`),
 * which reads no layer's data. So a shape and a picture ask it today.
 *
 * The rule this repository keeps is that what two layers have to agree on
 * sits where neither of them lives and comes back down to a layer the day it
 * stops being shared (`zooms.ts` went that way) — and this would stay here
 * even if one of the two went, for two reasons. The word is the one the next
 * thing to paint is meant to take, whichever of them comes first; and
 * {@link PaintedKind} below is the viewer's, not any layer's — `Layer.covers`
 * is asked in it.
 *
 * However many ask, they answer by different means — a shape through a bit in
 * the stencil buffer, a picture through being read by whatever it is thrown
 * on — which is why this file holds a word and a question and no machinery at
 * all.
 *
 * _(2026-10-29: this said only the shape asked it, which was never so — the
 * picture layers took the word in the change that wrote that sentence.)_
 */

import type { Stage } from './order.js'

/**
 * The land, what was built on it, or both.
 *
 * `'ground'` is everything the ground draws: the surface, the roads, the
 * water, the green — and the trees standing on it. A tree grows where it is
 * rather than having been put there, so it is read as part of the land, and a
 * wash over a park that stopped at the trunks would say the trees were left
 * out of the district.
 *
 * `'buildings'` is what was built: the city, a page's own models, and the
 * solids a page stands its map on. The word names the common case rather than
 * the whole of it — anything somebody put on the land answers to it.
 */
export type Paints = 'all' | 'ground' | 'buildings'

/** One side of that line. `'all'` is both of them. */
export type PaintedKind = 'ground' | 'buildings'

/**
 * What a thing drawn in a stage counts as for a colour painted over the
 * finished picture, or nothing where no paint lands on it at all.
 *
 * The line the stencil draws as the paint goes on (`classify.ts`): the land
 * marks itself land, whatever stands on it clears that mark, and what is drawn
 * over the picture — a wash of its own, a mark, a label — writes no mark and
 * is not in the reckoning. Asked in stages because a stage is all a viewer
 * knows about a layer.
 *
 * So `overlay` answers nothing, and there is one case where that is a loss
 * rather than a definition: a shape drawn at its own place lies in `overlay`
 * too, and writes no stencil mark either, so a painted wash laid after it
 * covers it on screen while the pointer still gives the drape underneath. A
 * page that wants the wash to answer there keeps its painted shapes in a
 * layer of their own and leaves the drape out of the way
 * ({@link ShapeBase.pickable}).
 */
export function paintedIn(stage: Stage): PaintedKind | null {
  switch (stage) {
    case 'ground':
      return 'ground'
    case 'base':
    case 'structure':
      return 'buildings'
    case 'overlay':
      return null
  }
}

/**
 * Whether a colour painting `paints` lands on `kind`.
 *
 * The one place the question is answered, so that a layer asking it about
 * itself and a shape asking it about a pixel cannot come to differ.
 */
export function paintsOn(paints: Paints, kind: PaintedKind): boolean {
  return paints === 'all' || paints === kind
}
