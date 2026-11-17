/**
 * The five cards down the side, and how a rate is written.
 *
 * Built from the stays rather than written out in the markup: the five are
 * data on this page, and a list said twice is a list that falls out of step.
 * The panel round the cards stands in the markup with the rest of the page's
 * words.
 *
 * It knows nothing of the map. Which card was pressed is passed back, and what
 * to do about it is the map's business; all this file is told in return is
 * which of the five is open.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Building a list of cards and giving one of them a class is the
 * same work here as on any other page, and somebody reading this example came
 * for the other runs.
 */
import { STAYS, type Stay } from './data.js'

/** The rate as a price is written here, and the plate over the roof reads it too. */
export function yen(rate: number): string {
  return `¥${rate.toLocaleString('ja-JP')}`
}

/**
 * The plate a stay wears over its roof.
 *
 * The page's own markup, so it is the button it looks like: pressed, tabbed
 * into, read aloud. And set in the same stylesheet as the card down the side,
 * so the price on the map and the price in the list are one thing said in two
 * places rather than a colour and a face kept in step by hand.
 */
export function ratePlate(stay: Stay, open: () => void): HTMLButtonElement {
  const plate = document.createElement('button')
  plate.className = 'rate'
  plate.textContent = yen(stay.rate)
  plate.title = stay.name
  plate.addEventListener('click', open)
  return plate
}

const cards = new Map<Stay, HTMLLIElement>()

/** Fills the list the markup leaves empty, and says which card was pressed. */
export function ui(open: (stay: Stay) => void): void {
  const list = document.querySelector<HTMLUListElement>('#stays')
  if (!list) return

  for (const stay of STAYS) {
    const card = document.createElement('li')
    card.className = 'stay'
    card.tabIndex = 0
    // Built from elements and text rather than a string of markup, so a name
    // that came from a listing is read as a name, never as markup
    const name = document.createElement('h2')
    name.textContent = stay.name
    const rate = document.createElement('p')
    rate.className = 'stay-rate'
    const price = document.createElement('b')
    price.textContent = yen(stay.rate)
    const per = document.createElement('span')
    per.textContent = '/ 泊'
    rate.append(price, ' ', per)
    card.append(name, rate)
    card.addEventListener('click', () => open(stay))
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open(stay)
      }
    })
    cards.set(stay, card)
    list.append(card)
  }
}

/** Marks the open stay's card, or none of them while the five are shown together. */
export function markOpen(marked: Stay | undefined): void {
  for (const [stay, card] of cards) card.classList.toggle('is-open', stay === marked)
}
