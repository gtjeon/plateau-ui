/**
 * The one switch this page has: where the ward's colour lands — on the land,
 * on what was built on it, or on both.
 *
 * It knows nothing of the map. Which way the switch was thrown is passed back,
 * and what to do about it is the map's business.
 *
 * On its own because nothing of the library is called here. The one thing it
 * names is the word for where a colour lands, which is the whole of what the
 * reader is choosing between: a page writing out three words of its own would
 * be keeping a second vocabulary in step with the first by hand. Wiring a menu
 * is the same work on this page as on any other, and somebody reading this
 * example came for the other file.
 */
import type { Paints } from '@plateau-ui/core'

/**
 * Wires the switch the markup leaves empty, says which way it was thrown, and
 * hands back the way to write the ward under the pointer.
 *
 * Handed back rather than reached for, so that the map still knows nothing of
 * the markup: it says which ward, and where that word goes is this file's.
 */
export function ui(paint: (paints: Paints) => void): (ward: string | null) => void {
  const menu = document.querySelector<HTMLSelectElement>('#paints')
  // The three options are this page's own markup, written in those words.
  menu?.addEventListener('change', () => paint(menu.value as Paints))

  const named = document.querySelector<HTMLElement>('#ward')
  return (ward) => {
    if (named) named.textContent = ward ?? ''
  }
}
