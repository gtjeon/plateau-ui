/**
 * What is written over the row: the plate over each roof.
 *
 * The page's own markup, standing on the map as `Html` marks. Written here and
 * set in the stylesheet, so what a reader reads over a building and what the
 * page would write anywhere else are one face and one set of colours rather
 * than a list of fonts and inks kept in step with a stylesheet by hand.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Making a few elements out of a building's particulars is the
 * same work here as on any other page, and somebody reading this example came
 * for the other one.
 */
import type { ReplicaBuilding } from '@plateau-ui/core'
import { named } from './data.js'

/**
 * What stands over a building: how high it is, and what it is called.
 *
 * Two lines and no more. The ward each came from and its floor count stood
 * under the name for a while, and were taken off: what the page compares is
 * the heights, and the name is enough to say which is which.
 *
 * The name is the page's own where the survey has none — of these five it has
 * 東京スカイツリー and 横浜ランドマークタワー written down and says nothing of
 * the other three — and a building with no name at all has the height alone.
 */
export function plate(building: ReplicaBuilding): HTMLElement {
  // By what it was taken from, which is what this page's own table is keyed
  // by. Its own name is the library's, minted so that ten of one building can
  // be told apart, and says nothing to a reader.
  const told = named(building.from)
  const card = document.createElement('div')
  card.className = 'plate'

  // The height is what the page is for, so it is set large and at the dark end
  // of the page's one hue; the rest is what a reader goes to once the number
  // has been read, and is written quietly under it.
  const height = document.createElement('b')
  height.textContent = `${building.tall.toFixed(1)}m`
  card.append(height)

  const name = told?.name ?? building.name
  if (name !== '') card.append(line(name))

  return card
}

function line(words: string): HTMLElement {
  const said = document.createElement('span')
  said.textContent = words
  return said
}
