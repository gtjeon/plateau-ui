/**
 * The wards of 東京, from the two files it takes to draw them — three of them,
 * where 文京, 台東 and 千代田 meet at 湯島, since the page is cut to a circle
 * round that corner.
 *
 * PLATEAU publishes one GeoJSON saying which municipalities it has data for,
 * and this library fetches it on every page: it is how the buildings know
 * which city to ask the catalog about. It says which, and not where. The
 * shapes in it are generalised down to about one blob a ward — 千代田区 is
 * fourteen corners — which is enough to test a point against and nowhere near
 * enough to draw a boundary with.
 *
 * So this page asks it which, and asks 国土数値情報 — the survey those
 * boundaries are actually published in — where. 2,088 corners over the three,
 * against 53 in the coverage file.
 *
 * Which is the thing worth copying off this page. A file that answers one
 * question well is not thereby the file to draw from, and the way to find out
 * is to count the corners of the smallest thing in it.
 *
 * The fetching, the URLs and the colours are in `data.ts`; the rule for
 * painting the wards and what the pointer does to it are in `pick.ts`. This
 * file is the map: a `GeoJsonLayer` handed what came back.
 */
import { GeoJsonLayer, Viewer } from '@plateau-ui/core'
import { BOUNDARY_CREDIT, FIRST_VIEW, MASK, boundaries } from './data.js'
import { paint, pick } from './pick.js'

const viewer = new Viewer({
  container: 'map',
  pitch: FIRST_VIEW.pitch,
  heading: FIRST_VIEW.heading,
  // The corner where the three meet, and nothing past it: outside the circle
  // nothing is drawn and nothing is fetched.
  mask: MASK,
  buildings: {
    // Turned off rather than left at the default, since the ring already
    // bounds what any zoom may ask for: nothing outside the circle is
    // fetched however far the view steps back, and the circle is 900m.
    minZoom: false,
  },
  // The land, because what is painted follows it. A ward's wash and its
  // boundary are laid on the picture rather than on a plane, so with the land
  // on they run over the 崖線 and up the walls standing on it. The streets and
  // the water are the GSI's tiles; the green is PLATEAU's land use.
  ground: {
    elevation: true,
    // And the ground's own boundaries off, because this page draws the same
    // three from a finer survey. Left on they are drawn twice, and the GSI's
    // is the one seen: the ground's thin lines go in the transparent pass and
    // a painted shape in the opaque one, so a pale hairline from the tiles
    // lands on top of the ink this page laid down.
    boundary: { visible: false },
  },
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds(FIRST_VIEW.bounds)

/**
 * The three wards, from the finer of the two files, painted with the wash
 * over everything — the thing this page is here to show. What the pointer and
 * the panel do to that is in `pick.ts`.
 *
 * The view is not moved to what arrived. A ward reaches well past the circle,
 * so fitting to it would open on three flat shapes with the circle lost in the
 * middle of them, which is the one picture that does not say what this page is
 * about; `FIRST_VIEW` stands among the buildings instead, where the wash is
 * seen climbing them. `wards.bounds` is there for a page that wants the other
 * thing.
 */
const wards = new GeoJsonLayer({
  data: await boundaries(),
  credit: BOUNDARY_CREDIT,
  style: paint('all', null, null),
})
viewer.add(wards)
pick(viewer, wards)
