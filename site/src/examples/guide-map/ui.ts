/**
 * The steps, written down the side.
 *
 * Built from the stops rather than written out in the markup. The walk is
 * already said once, as the four places the map marks, and a list said twice
 * is a list that falls out of step: a stop added to one is a stop missing from
 * the other, and the numbers have to be counted by hand. The panel round the
 * rows stands in the markup with the rest of the page's words.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Filling a list from an array is the same work here as on any
 * other page, and somebody reading this example came for the other runs.
 */
import { STOPS } from './data.js'

/** Fills the list the markup leaves empty. Called once, when the page runs. */
export function ui(): void {
  const list = document.querySelector<HTMLOListElement>('#route')
  if (!list) return

  for (const [at, stop] of STOPS.entries()) {
    const row = document.createElement('li')
    // The first and the last are the two ends of the walk — where it starts,
    // and what it is for — and they are coloured as such rather than looking
    // like the turns in between.
    const end = at === 0 || at === STOPS.length - 1
    const mark = document.createElement('span')
    mark.className = end ? 'route-mark route-mark-end' : 'route-mark'
    mark.textContent = String(at + 1)
    row.append(mark, stop.step)
    list.append(row)
  }
}
