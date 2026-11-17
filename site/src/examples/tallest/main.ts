/**
 * 高さくらべ — the tallest things in Japan, stood in a row.
 *
 * The other examples here draw a place: the view says which patch of which
 * city, and the buildings of that patch arrive. This one draws five of them
 * and nothing else. They are named, one by one, and the city each came out of
 * is never fetched — what lands is five tiles with one building left in each.
 *
 * Then they are stood where they have never stood: side by side on a sheet,
 * in the order this page lists them. Nothing about their heights is written
 * here — the figure over each of them reads what came back.
 *
 * Which five and where to look for them is in `data.ts`; how they are stood in
 * a row is in `row.ts`, and the plate over each in `ui.ts`. There is nothing
 * else: the page is the map, and what would have been a panel down the side is
 * a plate over each building, where a reader is already looking.
 */
import { AnnotationLayer, Solid, Viewer } from '@plateau-ui/core'
import { PlaneGeometry } from 'three'
import { PAPER, SHEET, SUN, TOWER, fromSite } from './data.js'
import { grid } from './grid.js'
import { standRow } from './row.js'

// ── The ground ────────────────────────────────────────────

/**
 * The ground the shadows land on: one plane, as wide as the view, in the
 * colour the page is drawn on.
 *
 * What a reader gets from it is how far each of them stands from the next,
 * which a row seen from the corner does not otherwise say. There is nothing
 * else under them — five things taken out of five cities have no ground in
 * common, and a street plan under them would be the plan of a place none of
 * them is in.
 */
const plane = new Solid({
  // A slab the row stands on rather than a sheet to the edge of the window:
  // the five are a chart, and a chart has a sheet with an edge (`data.ts` has
  // how big)
  at: fromSite(0, 0),
  geometry: new PlaneGeometry(SHEET.width, SHEET.depth).rotateX(-Math.PI / 2),
  // The paper this is drawn on, which is the page's and not the map's: a solid
  // told no colour wears the one the map's ground wears, and what the five
  // stand on here is a chart's sheet rather than a piece of ground.
  fillColor: PAPER,
  // Nothing to cut it to, since the sheet is the page's own and not a piece of
  // the city the mask is choosing from.
  masked: false,
})

/**
 * The same sheet stood up on end along its far edge, so the tops of the five
 * are read against a wall ruled in hundreds of metres rather than against the
 * sky. Its foot is on the sheet's edge and it faces the row.
 */
const wall = new Solid({
  at: fromSite(0, SHEET.depth / 2),
  // Turned round. A plane faces along its own +z, and stood here that side
  // looks away from the row: on screen it drew only from behind
  geometry: new PlaneGeometry(SHEET.width, SHEET.depth).rotateY(Math.PI).translate(0, SHEET.depth / 2, 0),
  fillColor: PAPER,
  // Its own light, so it is the paper's colour all over, as the backdrop is:
  // lit, a face standing up takes the sun at another angle than the sheet and
  // comes out a different grey. What it gives up is the towers' shadows
  glows: true,
  masked: false,
})

// ── The five ──────────────────────────────────────────────

/**
 * A plate over each roof, drawn whole wherever it falls. In a row seen from
 * one side the far buildings stand behind the near ones, and nothing more has
 * to be said for the far plates to be read: each is the page's own markup laid
 * over the canvas, which no building in the picture stands in front of. That is
 * why there is no `behind` here — what it chooses is read in the shader, for
 * marks drawn with the city, and an `Html` is never one of them.
 */
const labels = new AnnotationLayer()

// ── The view ──────────────────────────────────────────────

/**
 * Low and square on to the row, which is how heights are compared: from above
 * they are five roofs, and from an angle the near ones cover the far. The
 * projection is orthographic, so a building at the far end is drawn to the
 * same scale as the one at the near end and the comparison is honest.
 *
 * Wide enough to hold the row and the sky over the tallest of them, since what
 * the page is about is the difference between the tops.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  // Turned off the row rather than square to it. Square on, five towers in a
  // line hide one another and the sheet is an edge; from the corner the sheet
  // runs away under them, which says how far apart they are as well as how
  // high.
  heading: 38,
  // Nothing cut away: what stands is the five this page stands itself.
  mask: { shapes: [{ shape: 'view' }] },
  // The air behind the sheet and the wall in the paper's colour, and the sun
  // that draws the sheet in it (`data.ts`)
  theme: { backdrop: PAPER },
  sun: SUN,
  // No map's ground: the row stands on a sheet of the page's own, so the land
  // is turned off and fetches nothing.
  ground: { visible: false },
  buildings: {
    // Only what this page names. What stands is the five it stands itself,
    // below, so the view decides nothing and the guard on how close it must be
    // has nothing to hold back.
    load: 'brought',
    // The parapets are left off. A parapet is cut into a flat roof and sunk,
    // and what this page is about is how high each building's own shape
    // reaches; a roof lowered by three quarters of a metre for looks is three
    // quarters of a metre off the thing being compared.
    parapet: { visible: false },
    // The one hue the five are drawn in, on the walls and in the windows. The
    // glass is said here, for the whole layer, because that outranks the
    // colour the library keeps for a use of its own: all five wear the same
    // blue whatever the survey says they are for.
    wallColor: TOWER.wall,
    windows: { color: TOWER.glass, mullionColor: TOWER.mullion },
  },
  // All of it, in the one statement that makes the map. Each is seated by the
  // stage it declares, so the plane is under the buildings however this is
  // written and the labels are over them.
  layers: [plane, wall, ...grid(), labels],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk. Round
// the middle of the row, and far enough north of it that a row of towers sits
// in the frame rather than climbing out of the top of it — the one at 押上
// stands twice as high as anything beside it, and the frame is cut to hold it.
viewer.camera.fitBounds({ southWest: [139.742635, 35.681629], northEast: [139.759843, 35.695606] })

// ── The row ───────────────────────────────────────────────

standRow(viewer, labels)
