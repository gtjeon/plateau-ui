/**
 * The four rows down the side, one a station.
 *
 * Built from the stations rather than written out in the markup. Each row says
 * a station's name and the floor its space is on, and both are already written
 * once with the stations, so a list said twice is a list that falls out of
 * step — a floor moved in one place and not the other. The panel round the
 * rows stands in the markup with the rest of the page's words.
 *
 * It knows nothing of the map. Which station was pressed is passed back, and
 * what to do about it is the map's business.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Filling a list from an array is the same work here as on any
 * other page, and somebody reading this example came for the other runs.
 */
import { STATIONS, type Station } from './data.js'

/** Fills the list the markup leaves empty, and says which row was pressed. */
export function ui(go: (station: Station) => void): void {
  const list = document.querySelector<HTMLUListElement>('#stations')
  if (!list) return

  for (const station of STATIONS) {
    const row = document.createElement('li')
    // A row is the whole of what is pressed, so the name and the floor beside
    // it are one target rather than the letters alone.
    const button = document.createElement('button')
    button.type = 'button'
    const floor = document.createElement('span')
    floor.className = 'floor'
    floor.textContent = `${station.space.floor}F`
    button.append(station.name, floor)
    button.addEventListener('click', () => go(station))
    row.append(button)
    list.append(row)
  }
}
