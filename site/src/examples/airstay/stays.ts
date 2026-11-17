/**
 * The five stays on the map: a price over each roof, each house brought in,
 * and what opening one and letting it go do to the view.
 *
 * On its own so that `main.ts` is the map and nothing else. One page, three
 * ways in — the card, the price, the house — and the same `show` behind all
 * three; this is where it is.
 */
import { Html, type AnnotationLayer, type View, type Viewer } from '@plateau-ui/core'
import { ONE_STAY, RATE_OVER_ROOF, STAYS, WHOLE_SLOPE, type Stay } from './data.js'
import { markOpen, ratePlate } from './ui.js'

/**
 * Puts the five on the map — their prices in `labels`, their houses in the
 * city — and hands back what opens one, for the cards down the side.
 */
export function stays(viewer: Viewer, labels: AnnotationLayer): (stay: Stay) => void {
  /** Each stay's own plate, so that opening one can pick it out from the rest. */
  const rates = new Map<Stay, HTMLElement>()

  /**
   * The whole slope as this screen shows it, which is where the page opened.
   *
   * Heard rather than worked out: the viewer fits `WHOLE_SLOPE.bounds` once it
   * knows how wide the screen is, and the first view it then reports is what
   * it chose. A flight back has to name a zoom, and this is the one that fits.
   */
  let whole: View | undefined
  const heard = viewer.on('move', ({ view }) => {
    // A canvas with no size yet has fitted nothing, and is still owed the fit
    if (viewer.canvas.clientWidth === 0) return
    whole = view
    heard()
  })
  const slope = (): View => whole ?? viewer.camera.view

  /**
   * A price on a white plate over each roof, as a map of places to stay writes
   * one.
   *
   * No symbol: the price is the mark, and a pin over it would only say the same
   * thing twice. Over the model rather than on the survey's roof, so a stay
   * built taller than the house it replaced keeps its price over its own.
   *
   * Drawn whole wherever they fall. A price left to fade behind the block in
   * front reads as one not quite offered, and on a slope seen at a slant half of
   * them are behind something at any moment. Nothing has to be said for that:
   * each plate is the page's own markup laid over the canvas, which no house in
   * the picture stands in front of. So there is no `behind` here — what it
   * chooses is read in the shader, for marks drawn with the city, and an `Html`
   * is never one of them.
   */
  for (const stay of STAYS) {
    const plate = ratePlate(stay, () => show(stay))
    labels.add(new Html({ at: stay.at, height: stay.roof + RATE_OVER_ROOF, element: plate }))
    rates.set(stay, plate)
  }

  /**
   * The five brought in, each at the height its stay is built to, and each given
   * the click that opens it.
   *
   * Nothing is said about how big they are. glTF counts in metres and these five
   * are built to the heights they stand at, so the file is the size — which is
   * what `scale` is for and why none is written. One that will not come back
   * comes back as nothing and is said about through `error`; the rest of the
   * page carries on without it, which is what a missing house should cost.
   *
   * Not waited for. The plates, the cards and the way out below are the page
   * whether or not a file has landed, and a page held here would show nothing at
   * all until the last of five models was in.
   */
  for (const stay of STAYS) {
    void viewer.models
      .bring({
        url: new URL(`./models/${stay.file}`, import.meta.url).href,
        at: stay.at,
        facing: stay.facing,
      })
      .then((house) => {
        if (viewer.disposed || !house) return
        // The map is the other list. A reader looking at the slope is already
        // pointing at the thing they mean, and asking them to find its name in
        // the panel to open it is asking them to look away from it. So the house
        // opens the stay as the card does — one page, three ways in, and the
        // same `show` behind all three. The price is the third and listens for
        // itself: it is a button of the page's, so what a press does is written
        // where it is made; see `ratePlate`.
        //
        // Given here because here is where there is something to give it to.
        house.on('click', () => show(stay))
      })
  }

  /** Which stay is open, or nothing while the five are shown together. */
  let open: Stay | undefined

  /**
   * The open stay's card and price are marked; the rest are quiet.
   *
   * The price turns round rather than changing colour — ink on white becomes
   * white on ink. Five plates of one shape with one of them inverted is read at
   * a glance, where one of six colours is read by comparing them.
   *
   * The cards it marks are built by `ui`, once this has handed `show` back.
   * Nothing calls it until something has been pressed, and by then they are
   * there.
   */
  function paint(): void {
    markOpen(open)
    // Turned round for the one being looked at, the way its card is: the same
    // class name, in the same stylesheet, doing the same thing to both
    for (const [stay, plate] of rates) plate.classList.toggle('is-open', stay === open)
  }

  /**
   * Opens one stay: the view goes to it and its price stands out from the rest.
   *
   * It flies level rather than rising. The page is about a slope, and coming
   * down on a house from overhead is the one view that does not show one.
   */
  function show(stay: Stay): void {
    open = stay
    paint()
    void viewer.camera.flyTo({
      center: stay.at,
      zoom: slope().zoom + ONE_STAY,
      pitch: WHOLE_SLOPE.pitch,
      heading: WHOLE_SLOPE.heading,
    })
  }

  /** Back to the five, from wherever one of them was opened. */
  function showAll(): void {
    open = undefined
    paint()
    void viewer.camera.flyTo(slope())
  }

  /**
   * And the map is a way out as well as a way in. The only one: there is no
   * button for it.
   *
   * A reader who has opened one stay and wants the slope back is already looking
   * at the slope, and pressing the hillside beside the house says it plainly
   * enough — plainly enough that a button under the list would only be a second
   * way of saying it, worn by the panel whether or not a stay is open. The
   * viewer tells of a click nothing answered — the land, a house of the survey,
   * the water past the shore — so the five houses and their five prices keep
   * their own clicks and everything else lets go.
   */
  viewer.on('click', showAll)

  return show
}
