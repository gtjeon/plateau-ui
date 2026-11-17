/**
 * The panel: a row for each palette, the outlines' switch, and the miniature
 * look's.
 *
 * Nothing here calls the library: it lays out the rows, the first chosen, and
 * hands what is picked to whoever asked. The swatches are the palette's own
 * numbers over the library's (`LIGHT`), so a palette that leaves a name out
 * shows the colour the map then keeps.
 */
import { LIGHT } from '@plateau-ui/core'
import { SWATCHES, type Scheme } from './data.js'

/** What the panel tells of. */
export interface Picks {
  /** A palette was chosen. */
  readonly scheme: (scheme: Scheme) => void
  /** The outlines were switched on or off. */
  readonly edges: (on: boolean) => void
  /** The miniature look was switched on or off. */
  readonly tiltShift: (on: boolean) => void
}

/** Fills `#schemes` with a row for each palette, and tells `picks` of every change. */
export function ui(schemes: readonly Scheme[], picks: Picks): void {
  const rows = document.getElementById('schemes')
  if (rows) {
    for (const [i, scheme] of schemes.entries()) rows.append(row(scheme, i === 0, () => picks.scheme(scheme)))
  }
  const edges = document.getElementById('edges')
  if (edges instanceof HTMLInputElement) {
    edges.addEventListener('change', () => picks.edges(edges.checked))
  }
  const tiltShift = document.getElementById('tilt-shift')
  if (tiltShift instanceof HTMLInputElement) {
    tiltShift.addEventListener('change', () => picks.tiltShift(tiltShift.checked))
  }
}

/** One palette: its button, its name, and a swatch of each colour in `SWATCHES`. */
function row(scheme: Scheme, chosen: boolean, pick: () => void): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'pick'
  const button = document.createElement('input')
  button.type = 'radio'
  button.name = 'scheme'
  button.checked = chosen
  button.addEventListener('change', () => {
    if (button.checked) pick()
  })
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = scheme.name
  const chips = document.createElement('span')
  chips.className = 'chips'
  for (const swatch of SWATCHES) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.background = scheme.theme[swatch] ?? LIGHT[swatch]
    chips.append(chip)
  }
  label.append(button, name, chips)
  return label
}
