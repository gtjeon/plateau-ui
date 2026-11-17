/**
 * The panel: the legend the steps are read against, how much of them goes on,
 * and them in one colour or the legend's.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Building a list and listening to a slider are the same work
 * here as on any other page; what each one does to the map is handed in from
 * `main.ts`, where the map is.
 */
import { BANDS } from './data.js'

/**
 * Fills the legend the markup leaves empty and listens to the two controls
 * under it. Called once, when the page runs.
 */
export function ui(thin: (opacity: number) => void, paint: (oneColor: boolean) => void): void {
  // One row a band, built from the colours the layer matches rather than
  // written out again in the markup, so the two cannot fall out of step
  const legend = document.querySelector<HTMLElement>('#legend')
  for (const { color, label } of BANDS) {
    const row = document.createElement('li')
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.background = color
    row.append(chip, label)
    legend?.append(row)
  }

  const opacity = document.querySelector<HTMLInputElement>('#opacity')
  const readout = document.querySelector<HTMLElement>('#opacity-value')
  opacity?.addEventListener('input', () => {
    const value = Number(opacity.value)
    thin(value)
    if (readout) readout.textContent = value.toFixed(2)
  })

  const oneColor = document.querySelector<HTMLInputElement>('#one-color')
  oneColor?.addEventListener('change', () => {
    paint(oneColor.checked)
  })
}
