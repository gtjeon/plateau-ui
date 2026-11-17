/**
 * How many houses stand in each band of the published picture, and the line
 * drawn round the houses of the band the reader points at.
 *
 * On its own so that `main.ts` is the map and nothing else. Every house in the
 * circle asks the picture, at its own foot, which band it stands in —
 * `colorAt`, which answers with the texel as the portal published it and not as
 * the screen shows it.
 */
import { metersFrom, type Building, type ImageTileLayer, type Viewer } from '@plateau-ui/core'
import { AROUND, BANDS, CLEAR, STAND, UNKNOWN } from './data.js'
import type { Tally } from './ui.js'

/**
 * Counts the houses as the city and the picture land, writes each count to
 * `write`, and hands back what draws a line round one band's houses.
 */
export function countBands(
  viewer: Viewer,
  tsunami: ImageTileLayer,
  write: (tally: Tally) => void,
): (band: string | null) => void {
  /**
   * Which band each house stands in, by its id.
   *
   * Written as the count is taken and read by the rule that lines a band's
   * houses, so the number in the panel and the houses that light up are the
   * same houses.
   *
   * **Asking the picture is what must not be in that rule.** A rule is put to
   * every building afresh every time the page says the answer may have moved,
   * and asking there meant a read back off a canvas a house — some nineteen
   * hundred of them — between the pointer arriving and the line appearing.
   */
  const bands = new Map<string, string>()

  /**
   * Which band the reader is pointing at, and the line drawn round its houses.
   *
   * One rule for all of them rather than a style apiece: a rule is asked of
   * every building and takes one slot of the lines the viewer draws, where a
   * thousand buildings named one by one would take a thousand. What the rule
   * reads is this page's own, so the city cannot know it changed and `restyle`
   * is how it is told.
   *
   * `outline` is the switch and the colour only what it is drawn in, so both
   * are said. The ink is the one the panel's words are set in (`style.css`),
   * which reads over every band's colour without being one of them.
   */
  let pointed: string | null = null
  viewer.buildings.setStyle((building) => pointed !== null && bands.get(building.id) === pointed, {
    outline: true,
    outlineColor: '#2b3038',
  })

  /**
   * How many houses stand in each band of the published picture.
   *
   * The map is cut to a circle standing still, so the inside of it comes whole
   * and "every house in the circle" is a question with an answer — over a view
   * that follows the camera it would not be, since the ground the view is about
   * to reach has not been asked for yet.
   *
   * The colours are matched exactly. The tiles are drawn into the picture one
   * for one, so a texel that came from a band is one of the legend's six on the
   * nose — and anything else is counted as unknown and shown as such rather
   * than rounded into the nearest band, which is how a reading that stopped
   * matching would make itself seen.
   */
  function count(): Map<string, number> {
    const tally = new Map<string, number>()
    for (const band of [...BANDS, CLEAR, UNKNOWN]) tally.set(band, 0)
    bands.clear()
    viewer.buildings.each((building) => {
      const band = bandOf(building)
      if (band === null) return
      bands.set(building.id, band)
      tally.set(band, (tally.get(band) ?? 0) + 1)
    })
    return tally
  }

  /**
   * Which band a house stands in, or null for one outside the circle.
   *
   * **One point a house, its own foot.** A house wide enough to straddle a band
   * edge falls on whichever side its foot does; `Building.corners` is what a
   * page wanting the deepest band under any part of it would walk instead.
   *
   * **And the circle is drawn here, because the city does not draw it.** A tile
   * of city is wider than this site, so every house in every tile it holds is
   * handed over — the ones the mask is not drawing among them. Counted before
   * this line was put in, they came to 1,120 of 3,736, and every one of them
   * landed under "cannot answer": the picture's window is hung about the view
   * and does not reach that far.
   */
  function bandOf(building: Building): string | null {
    const at: [number, number] = [building.position.lng, building.position.lat]
    const [east, north] = metersFrom(STAND, at)
    if (Math.hypot(east, north) > AROUND) return null
    const texel = tsunami.colorAt(at)
    if (texel === null) return UNKNOWN
    return texel.a === 0 ? CLEAR : `${texel.r},${texel.g},${texel.b}`
  }

  /**
   * Counted again whenever the answer could have changed, and not oftener.
   *
   * Walking the city is one pass a tile and a read back off a canvas a house,
   * which is cheap once and ruinous sixty times a second. The answer moves on
   * two occasions only and both of them say so: a tile of city stands, or a
   * piece of the picture lands.
   *
   * **Not `on('frame')`.** Hung there the count ran every frame — and worse, a
   * page holding that event is a page the viewer takes as one that may move its
   * own things, so the sun's shadow map is drawn afresh every frame as well. It
   * was the whole of why this page went heavy.
   */
  function recount(): void {
    if (viewer.buildings.busy()) return
    write(count())
  }

  // Everything the city was waiting for is standing. Behind a mask that stands
  // on the map that is "every house in the circle is here".
  viewer.buildings.on('loaded', recount)
  // And the picture it is being read against, which lands on its own schedule.
  tsunami.on('changed', recount)

  return (band) => {
    if (pointed === band) return
    pointed = band
    viewer.buildings.restyle()
  }
}
