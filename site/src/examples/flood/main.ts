/**
 * 由比ヶ浜 — the published tsunami map, laid on the town and carried up it.
 *
 * A viewer standing at the west end of the beach looking back up the strip of
 * town, with the hazard portal's own map of how far a tsunami could reach
 * drawn on the ground — and thrown down over the houses, so each one wears
 * the colour of the ground it stands on all the way up its walls. The band on
 * the ground says how far the water comes; the houses in it say which houses
 * those are.
 *
 * And the picture is read back. Every house in the circle asks it, at its own
 * foot, which band it stands in — `colorAt`, which answers with the texel as
 * the portal published it and not as the screen shows it — and the panel
 * counts the houses in each band; pointing at a band draws a line round its
 * houses. What the page does not do is say how deep a band is. The colours
 * and the legend they are read against are the portal's, and the legend gives
 * two sets of figures for the last two bands (see `BANDS`). Nor does it stand
 * water up at any depth: what used to be here did, and it leaned on three
 * pieces of the library that have since been taken out.
 *
 * Where the site is, what it is cut to, and whose picture this is is in
 * `data.ts`; the counting is in `count.ts`, and the panel in `ui.ts`. This
 * file is the map.
 */
import { ImageTileLayer, Viewer } from '@plateau-ui/core'
import { countBands } from './count.js'
import { HAZARD, SITE, STAND, TSUNAMI, TSUNAMI_ZOOMS } from './data.js'
import { ui } from './ui.js'

/**
 * The picture, named for what it holds rather than for how it arrives.
 *
 * The zooms are the set's own and have to be said: asked at the zoom this
 * page stands at there is no tile, and a layer that does not know where a set
 * stops asks past the end of it and draws nothing. Told, it reads the finest
 * the set does have and lays that under the view instead.
 */
const tsunami = new ImageTileLayer({
  url: TSUNAMI,
  credit: HAZARD,
  minZoom: TSUNAMI_ZOOMS.min,
  maxZoom: TSUNAMI_ZOOMS.max,
  // On the houses as well as on the ground, which is where the page opens;
  // the switch in `index.html` is the reader's to move. The picture is thrown
  // straight down, so a wall takes the colour of the ground it stands on and
  // carries it up — which is what this picture means: the water reaches this
  // depth here, and this is the house standing in it. A photograph would
  // smear instead, which is why the page says and the library does not guess.
  paints: 'all',
})

const viewer = new Viewer({
  container: 'map',
  // Standing west along the beach and looking back up it; see STAND. Square
  // on from the south the town is a band across the screen and every house in
  // it is the same distance away, which says nothing about how far the sea
  // has to come. From the end of the beach the strip runs away from the
  // reader instead, and the sea is beside it the whole way.
  pitch: 70,
  // Up the coast to the north-east, which is the line the town is strung
  // along and the line the water would come in across.
  heading: 53,
  // The land carries its own heights, and here it has them: the beach is at
  // nought and the hills behind the town are at fifty within half a kilometre.
  // The shape of this place is the whole of what the page shows, so it is not
  // something to leave for later.
  ground: { elevation: true },
  buildings: {
    // The houses are the point — how low the town sits against the sea — and
    // the default holds the city back until 18, which is set for a district of
    // towers. Here 18 is one street. Turned off rather than lowered: the page
    // is cut to a circle 600 metres in radius, so however far back a reader
    // steps the city is that one town and never the country's worth of it the
    // limit is there to hold off.
    minZoom: false,
    // Glass on a two-storey house at this distance reads as grain on the wall.
    windows: { visible: false },
  },
  mask: SITE,
  // On the ground the viewer draws, over its roads and its water. One list,
  // and the viewer seats it — the sheet says it lies on the land and that is
  // the whole of what decides where in the picture it goes.
  layers: [tsunami],
})

// Opens on this much ground round where the reader stands (`STAND`), however
// wide the screen. Given as a zoom, the same view would show a phone less than
// half as much across as a desk
viewer.camera.fitBounds({ southWest: [139.533467, 35.309448], northEast: [139.534073, 35.309943] })

const write = ui(
  // Where the picture lands.
  (paints) => {
    tsunami.paints = paints
  },
  // And which band's houses to draw a line round.
  (band) => {
    point(band)
  },
)

// The houses in each band, counted as the city and the picture land
const point = countBands(viewer, tsunami, write)

viewer.on('error', ({ what, cause }) => {
  if (what !== 'start') return
  const map = document.getElementById('map')
  if (map) map.textContent = `地図を開けませんでした: ${String(cause)}`
})
