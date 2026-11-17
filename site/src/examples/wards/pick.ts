/**
 * What the reader does to the wards — the pointer over one, a ward picked, the
 * menu that says what the colour lands on — and the rule that paints them.
 *
 * On its own so that `main.ts` is the map and nothing else. Every one of those
 * comes down to one thing: a new rule handed to the layer, which makes every
 * shape afresh from it.
 */
import type { FeatureStyle, GeoJsonFeature, GeoJsonLayer, Paints, Viewer } from '@plateau-ui/core'
import {
  code,
  FILL_COLORS,
  FILL_LIT,
  FILL_OPACITY,
  LINE_COLOR,
  LINE_HOVER,
  LINE_WIDTH,
  nameOf,
  shadeOf,
} from './data.js'
import { ui } from './ui.js'

/** Listens to the pointer and the panel, and paints the wards by what they say. */
export function pick(viewer: Viewer, wards: GeoJsonLayer): void {
  /*
   * What the reader is doing to the map.
   *
   * Three words of state and one rule that reads them. The rule is asked once
   * a feature and these change once a crossing, so they are kept out here and
   * handed in: a rule that reached for them would be asked the question again
   * for every feature of every file on every frame, and answer the same.
   *
   * The wards are named by their code, which is what the file carries and
   * what the colours already go by. A ward may arrive as more than one feature
   * — an islet of its own is one — so the code is what makes two of them the
   * same ward.
   */
  let paints: Paints = 'all'
  let under: string | null = null
  let picked: string | null = null
  // What each ward is called, by the code everything else here goes by. Taken
  // once: the features outlive a restyle, since the file is not read again.
  const named = new Map(wards.features.map((feature) => [code(feature), nameOf(feature)]))
  // The page opens with the wash over everything, since that is the thing it
  // is here to show, and the reader's word goes straight through from there:
  // the menu is written in the library's own three, so there is nothing to
  // translate on the way. What it hands back is where the ward's name goes.
  const show = ui((next) => {
    paints = next
    repaint()
  })
  // A new rule handed over, which the layer asks again of every feature and
  // makes every shape afresh from. The shapes are the layer's own and not
  // handed out, so the rule is what a page changes, never a shape. The file
  // that was fetched is kept: `data` is not written.
  const repaint = (): void => {
    wards.style = paint(paints, under, picked)
    // The one under the pointer, and the one that was picked once the pointer
    // has gone — which is what picking means here, so the panel says it the
    // same way the map does.
    const ward = under ?? picked
    show(ward === null ? null : (named.get(ward) ?? null))
  }

  // Told as the pointer crosses a boundary rather than on every frame it
  // spends inside one, and told null where it leaves the wards altogether.
  // Compared all the same: two features of one ward are two crossings and one
  // ward, and nothing has changed about what is drawn.
  wards.on('hover', (at) => {
    const ward = at ? code(at.feature) : null
    if (ward === under) return
    under = ward
    repaint()
  })

  // Clicking the ward that is already picked puts it back, so a reader who
  // picked one by mistake has the same button to undo it with.
  wards.on('click', ({ feature }) => {
    const ward = code(feature)
    picked = picked === ward ? null : ward
    repaint()
  })

  // And clicking anywhere that is not a ward lets the lot go. The viewer tells
  // a page about a click only where no layer answered it, so this is exactly
  // the clicks the wards did not take.
  viewer.on('click', () => {
    if (picked === null) return
    picked = null
    repaint()
  })
}

/**
 * How a ward is painted: what the colour lands on, and what the reader is
 * doing to it.
 *
 * `paints` is the switch. The colour is not laid on a plane over the streets —
 * it is painted onto the picture wherever what it covers was drawn — so what
 * counts as ground is a question somebody has to answer. `'all'` takes both,
 * which is why the wash climbs the towers; `'ground'` holds it to the land and
 * its trees, and what was built keeps its own colour.
 *
 * `under` and `picked` are the pointer, and they do the same thing: the ward
 * wears a heavier wash and a wider edge. The difference is that one of them
 * goes when the pointer does and the other stays, which is what a page means
 * by picking something. The two beside it are left alone — nothing is dimmed
 * and nothing is written on the map, so the ward says which it is by being
 * the one that moved.
 */
export function paint(
  paints: Paints,
  under: string | null,
  picked: string | null,
): (feature: GeoJsonFeature) => FeatureStyle {
  return (feature) => {
    const shade = shadeOf(feature)
    const ward = code(feature)
    // One answer for both, down to the width of the line, so that a click
    // keeps exactly what the pointer was already showing: hovering says what
    // picking would do, and picking is that same ward left that way once the
    // pointer has gone.
    const lit = ward === under || ward === picked
    return {
      fillColor: FILL_COLORS[shade] ?? FILL_COLORS[0]!,
      fillOpacity: lit ? FILL_LIT : FILL_OPACITY,
      // Saying this is what paints it onto the picture rather than drawing it
      // at a place, which is the whole of what this page is about. See
      // `ShapeSticks`.
      paints,
      lineColor: LINE_COLOR,
      lineWidth: lit ? LINE_HOVER : LINE_WIDTH,
    }
  }
}
