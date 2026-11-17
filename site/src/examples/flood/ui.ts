/**
 * What this page lets the reader do, and what it tells them back.
 *
 * Two things: the switch that says where the published picture lands, and the
 * tally of how many houses stand in each of its bands — which is also how the
 * reader points at a band, since touching a row lights those houses up.
 *
 * It knows nothing of the map. Which way the switch was thrown and which band
 * is being pointed at are passed back, and what to do about them is
 * `main.ts`'s business; the tally arrives counted.
 */
import type { Paints } from '@plateau-ui/core'
import { BANDS, CLEAR, UNKNOWN } from './data.js'

/** How many houses stand in each band, by the band's own colour. */
export type Tally = ReadonlyMap<string, number>

/** Wires the panel, and hands back the way to write a tally into it. */
export function ui(
  paint: (paints: Paints) => void,
  point: (band: string | null) => void,
): (tally: Tally) => void {
  const menu = document.querySelector<HTMLSelectElement>('#paints')
  // The three options are this page's own markup, written in those words.
  menu?.addEventListener('change', () => paint(menu.value as Paints))

  const list = document.querySelector<HTMLElement>('#tally')
  // One row a band, in the legend's own order, and two more for the ground the
  // picture leaves clear and the ground it cannot answer for. Built once and
  // written again as the count changes, so the panel does not jump about while
  // the city is still landing.
  const counts = new Map<string, HTMLElement>()
  for (const band of [...BANDS, CLEAR, UNKNOWN]) {
    const row = document.createElement('li')
    // A button, because it is one: the reader points at it and the map
    // answers. A row that lights the city on being touched and is not
    // reachable from a keyboard would be a row half the readers cannot use.
    const press = document.createElement('button')
    press.type = 'button'
    press.className = 'band'
    const chip = document.createElement('span')
    chip.className = `chip ${band === CLEAR || band === UNKNOWN ? band : ''}`
    if (band !== CLEAR && band !== UNKNOWN) chip.style.background = `rgb(${band})`
    const count = document.createElement('b')
    count.textContent = '0'
    press.append(chip, count)
    // Pointer and keyboard say the same thing, and leaving says it is over.
    press.addEventListener('pointerenter', () => point(band))
    press.addEventListener('focus', () => point(band))
    press.addEventListener('pointerleave', () => point(null))
    press.addEventListener('blur', () => point(null))
    row.append(press)
    list?.append(row)
    counts.set(band, count)
  }

  return (tally) => {
    for (const [band, count] of counts) count.textContent = String(tally.get(band) ?? 0)
  }
}
