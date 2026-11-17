/**
 * The list of cafés in the panel, and the card that comes up over a café.
 *
 * Nothing here touches the map. Each café gets a line in the list, which is
 * its name.
 */
import type { Cafe } from './data.js'

/**
 * The card over a café's roof: its name, and nothing else.
 *
 * Two boxes, one inside the other. The library stands the outer one over the
 * roof and moves it every frame; the inner one is the card, and is what comes
 * up and goes away, so the page's own movement never fights the library's.
 * Shown by `shown` on the outer one.
 */
export function cardFor(cafe: Cafe): HTMLElement {
  const tag = document.createElement('div')
  tag.className = 'tag'
  const card = document.createElement('div')
  card.className = 'card'
  card.textContent = cafe.name
  tag.append(card)
  return tag
}

export function ui(cafes: readonly Cafe[]): void {
  const list = document.getElementById('cafes')
  if (!list) return
  for (const cafe of cafes) {
    const line = document.createElement('li')
    line.textContent = cafe.name
    list.append(line)
  }
}
