/**
 * The four ways of shaking, down the side.
 *
 * Built from the list rather than written out in the markup, so that adding a
 * fifth is one entry in one place. The panel round the rows stands in the
 * markup with the rest of the page's words.
 *
 * On its own, because it is the one run on this page where the library is
 * never named: filling a list from an array and hearing a click is the same
 * work here as on any other page, and somebody reading this example came for
 * the other runs.
 */
import { SHAKES, type Shake } from './shake.js'

/** Fills the list the markup leaves empty. The first is the one chosen. */
export function ui(pick: (how: Shake) => void): void {
  const list = document.querySelector<HTMLUListElement>('#shakes')
  if (!list) return

  for (const [at, how] of SHAKES.entries()) {
    const row = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'shake'
    button.setAttribute('aria-pressed', String(at === 0))
    const name = document.createElement('span')
    name.className = 'shake-name'
    name.textContent = how.name
    const note = document.createElement('span')
    note.className = 'shake-note'
    note.textContent = how.note
    button.append(name, note)
    button.addEventListener('click', () => {
      for (const other of list.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-pressed', 'true')
      pick(how)
    })
    row.append(button)
    list.append(row)
  }
}
