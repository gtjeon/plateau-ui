/**
 * The writing printed on the map: each zone's name over its own roofs, and the
 * car parks in the key under the heading.
 *
 * Built from the zones rather than written out in the markup: a zone added to
 * `data.ts` is a zone missing here otherwise, and the letter's colour is
 * `zone.color` — the very value the buildings wear — so it cannot drift from
 * them either.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Where a name flies to is handed in; what to do about it is the
 * map's business.
 */
import { CAR_PARK, CAR_PARKS, type Zone } from './data.js'

/**
 * A zone's name as it stands over the zone: its letter, what the mall calls
 * it, and how many buildings wear its colour.
 *
 * A button. It is the one thing on the page that says "this is somewhere you
 * can go", so pressing it goes there, the keyboard reaches it, and a reader
 * who cannot see the map is read the name.
 */
export function zoneName(zone: Zone, go: () => void): HTMLButtonElement {
  const label = document.createElement('button')
  label.type = 'button'
  label.className = 'zone'
  label.style.setProperty('--zone', zone.color)
  label.style.setProperty('--zone-edge', zone.edge)

  const letter = document.createElement('span')
  letter.className = 'letter'
  letter.textContent = zone.letter

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = zone.name
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = zone.note
  const words = document.createElement('span')
  words.className = 'words'
  words.append(name, count)

  label.append(letter, words)
  label.addEventListener('click', go)
  return label
}

/** Fills the key the markup leaves empty. Called once, when the page runs. */
export function ui(): void {
  const key = document.querySelector<HTMLElement>('#key')
  if (!key) return
  const chip = document.createElement('span')
  chip.className = 'chip'
  // Off the same value the map paints them with, the way a zone's letter takes
  // `zone.color`: a swatch in a key has to be the colour it names
  chip.style.background = CAR_PARK.color
  chip.style.borderColor = CAR_PARK.edge
  // Counted rather than written, so the day a car park is added to `data.ts`
  // the key is already right
  key.append(chip, document.createTextNode(`駐車場 ${CAR_PARKS.length}棟`))
}
