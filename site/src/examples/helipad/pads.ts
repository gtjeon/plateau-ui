/**
 * What pressing a roof does: a marking cut into it, or taken off again.
 *
 * On its own so that `main.ts` is the map and nothing else. This is the one
 * thing the page does with the city once it stands, and it is all done through
 * the city's own styles — the page keeps no list of which roofs wear one.
 */
import type { Buildings } from '@plateau-ui/core'
import { PAD, PAD_FACING, TOWER } from './data.js'
import { helipad } from './ui.js'

/** What the line under the title is told: how many roofs wear one, and a press that missed. */
interface Page {
  said: (marked: number) => void
  missed: () => void
}

/** Listens to the city for presses, and puts the first marking on before anybody presses anything. */
export function pads(buildings: Buildings, page: Page): void {
  /**
   * How many roofs wear one, for the line under the title.
   *
   * The page's only state, and not which roofs: the library holds what each
   * building wears by the name PLATEAU gives it, so a second press on the same
   * roof is told from a first by asking it (`getStyle`) rather than by keeping
   * the same names a second time here.
   */
  let count = 0

  /**
   * The picture, drawn once.
   *
   * Every marking is the same one, so there is no reason to draw it a second
   * time — and the library lays every picture a style carries out on one sheet,
   * where handing it the same canvas twice is one picture, not two.
   */
  const marking = helipad()

  buildings.on('click', ({ building, face, anchor }) => {
    // A wall is not a roof. The click says which it was, so the page does not
    // have to guess from where the pointer landed — and can say so rather than
    // leaving a reader to wonder why nothing happened.
    if (face !== 'roof') {
      page.missed()
      return
    }
    if (buildings.getStyle(building.id)?.roofImage) {
      count -= 1
      buildings.setStyle(building.id, null)
    } else {
      count += 1
      // Where the press landed on the building, handed over as the click gave
      // it, and a box a metre deep about it: a pad put on a low roof beside a
      // tower stays on that roof rather than going on up the tower's top
      buildings.setStyle(building.id, {
        roofImage: { image: marking, width: PAD, rotate: PAD_FACING, offset: anchor.offset, depth: 1 },
      })
    }
    page.said(count)
  })

  // One is in before a reader presses anything, so the page opens on what it is
  // about rather than on an empty roof. No place is given for it, so it sits
  // over the middle of the tower's foot — and the tile it stands on has not
  // landed yet, which the library does not mind: a style is held by the name
  // until the building turns up wearing it.
  buildings.setStyle(TOWER, { roofImage: { image: marking, width: PAD, rotate: PAD_FACING } })
  count = 1
  page.said(count)
}
