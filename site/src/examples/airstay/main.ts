/**
 * AirStay — a made-up brand of holiday lets, on a slope above the sea.
 *
 * 七里ヶ浜 in 鎌倉 is a hillside: the houses stand in rows up it, the railway
 * and the coast road run along its foot, and the sea begins where the land
 * stops. Drawn flat none of that is there — the rows read as a grid on a
 * plain and the shore reads as a change of colour. So this is the first page
 * here to carry the land's own heights, and the circle it is cut to is small
 * enough that one slope is what is looked at rather than the map around it.
 *
 * It is also the first to put something of its own in the city: five houses
 * the brand built, each on a plot a house of the survey's has been taken off.
 *
 * What the five are is in `data.ts`; what they do on the map — the prices, the
 * houses, opening one — is in `stays.ts`, and the cards down the side are
 * built by `ui.ts`. This file is the map.
 */
import { AnnotationLayer, Viewer } from '@plateau-ui/core'
import { FADE, MIDDLE, RADIUS, STAYS, WHOLE_SLOPE } from './data.js'
import { stays } from './stays.js'
import { ui } from './ui.js'

/**
 * A price on a white plate over each roof; `stays.ts` writes them. Drawn whole
 * wherever they fall, so there is no `behind` here: each plate is the page's
 * own markup laid over the canvas.
 */
const labels = new AnnotationLayer()

const viewer = new Viewer({
  container: 'map',
  // Low, because a slope seen from overhead is not a slope: what says the
  // land climbs is the roofs stepping up behind one another.
  pitch: WHOLE_SLOPE.pitch,
  heading: WHOLE_SLOPE.heading,
  // One circle, and nothing outside it is drawn or fetched
  mask: { shapes: [{ shape: 'circle', center: MIDDLE, radius: RADIUS }], fade: FADE },
  // What the page is about. The ground is cut to the real shape of the hill
  // and every house stands on the ground under its own foot. The slope and the
  // houses on it come from PLATEAU and the GSI; only the five stays are the
  // page's.
  ground: { elevation: true },
  buildings: {
    // The number guards against how many tiles a wide view asks for, and one
    // circle of 300m is already narrower than the guard. Off rather than
    // lowered, so stepping back to see the whole slope keeps its houses.
    minZoom: false,
    /*
     * The plot each stay stands on, cleared of the house that was there.
     *
     * The house is named rather than the ground it stands on: a plot here is
     * one house, and the name is exact where a circle drawn round it would
     * also take the corner of the plot across the street. Its footprint is
     * left on the ground, since the stay that replaces it stands on the same
     * plot and covers it.
     *
     * Said here and not with `hide()` afterwards, which would have the five
     * sink into the ground as the page opened. They are not being pulled
     * down: this page is about what stands on these plots instead, and what
     * was there is simply not part of it.
     */
    hide: STAYS.map(({ building }) => building),
  },
  // All of it, in the one statement that makes the map. Each is seated by the
  // stage it declares, so this is the order the page reads in rather than an
  // order the picture depends on. The houses are not here: they are files, and
  // a file is read by the viewer that will draw it.
  layers: [labels],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds(WHOLE_SLOPE.bounds)

// The five on the map, and the cards down the side that open them
ui(stays(viewer, labels))
