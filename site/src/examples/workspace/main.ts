/**
 * Workspace — a made-up coworking brand, one place of it by each station.
 *
 * Four circles and nothing between them: the twenty kilometres of city the
 * stations are scattered over is neither drawn nor fetched, so the page costs
 * four stations rather than half of Tokyo.
 *
 * Where the four stations are and what stands at each is in `data.ts`; the
 * rows down the side are filled in by `ui.ts`. This file is the map.
 */
import { Solid, Marker, AnnotationLayer, Viewer, type Mask } from '@plateau-ui/core'
import { CylinderGeometry, PlaneGeometry } from 'three'
import { BRAND, BRAND_COLOR, DEPTH, MARK_FONT, PAPER, RADIUS, STATIONS } from './data.js'
import { ui } from './ui.js'

// ── The cut ───────────────────────────────────────────────

/**
 * One circle per station, and the scene is cut to all four together.
 *
 * The mask waits for the screen. A standing circle is normally held whole —
 * its inside comes however the camera is pointed, which is what lets a page
 * ask "every building in here" and be answered — and here that is four
 * districts fetched so that one of them can be looked at, twenty kilometres
 * apart. Nothing on this page counts what is inside a circle, so the answer is
 * worth less than the three districts.
 */
const MASK: Mask = {
  shapes: STATIONS.map(({ at }) => ({ shape: 'circle', center: at, radius: RADIUS })),
  fetch: 'onScreen',
}

/**
 * A block under each station, as wide as the circle the scene is cut to, and
 * the plane the blocks stand on.
 *
 * Where a block stands is written out again rather than read off the mask:
 * the mask says what is drawn, and these say what it was cut out of. The two
 * lining up is this page's doing.
 */
const blocks = STATIONS.map(
  ({ at }) =>
    new Solid({
      at,
      // Cut from its foot up, which is the point a solid is stood at, where
      // three cuts a cylinder about its middle
      geometry: new CylinderGeometry(RADIUS, RADIUS, DEPTH, 64).translate(0, DEPTH / 2, 0),
      height: -DEPTH,
    }),
)
const plane = new Solid({
  at: 'view',
  geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  height: -DEPTH,
  // The sheet the map is stood on, in the page's own white rather than in the
  // colour a solid wears when it is told none — which is the map's ground, and
  // reads as ground under the blocks instead of as the paper they sit on.
  fillColor: PAPER,
  // The one thing here the cut does not reach. A block is as wide as the
  // circle it stands in, so its shadow falls outside that circle — and with
  // the floor cut to the same line there was nothing out there to take it,
  // and four blocks stood in the air throwing nothing. The floor is what the
  // page stands its map on rather than part of what the mask is choosing, so
  // it runs out past the circles and the blocks sit on something.
  masked: false,
})

// ── The spaces ────────────────────────────────────────────

/**
 * A tag on the wall of the floor each space is on, with the brand, the
 * station, the address and the floor.
 *
 * Hung on the face the view is turned toward, so arriving at a station brings
 * its tag round to the front rather than leaving it behind the tower it names
 * (`data.ts` says where on it).
 *
 * Drawn whether or not something stands in front of them: a tag carries
 * letters, and letters seen faint through a building are letters nobody
 * reads. This is what a group is for — one answer for every mark in it, said
 * once.
 */
const markers = new AnnotationLayer({ behind: 'show' })
for (const { name, space } of STATIONS) {
  markers.add(
    new Marker({
      // On the wall, held to the building, so that it comes up out of the
      // ground with it
      at: { building: space.building, offset: space.offset },
      symbol: 'tag',
      color: BRAND_COLOR,
      label: `${BRAND} ${name}\n${space.address} ${space.floor}F`,
      font: MARK_FONT,
    }),
  )
}

// ── The map ───────────────────────────────────────────────

/** The page opens on the first of the four. */
const [START] = STATIONS

/**
 * Far enough out that a whole circle stands on the screen with room round it,
 * so each station reads as a model of itself rather than as a street corner.
 * A step in from here and the cut edge leaves the frame, and with it the one
 * thing that says the rest of the city was never fetched.
 */
const viewer = new Viewer({
  container: 'map',
  // Well back, since what the page is finally about is a floor partway up a
  // tower, and a view from overhead cannot show one.
  pitch: 60,
  heading: START.heading,
  mask: MASK,
  buildings: {
    // The number guards against how many tiles a wide view asks for, and four
    // circles of 400m hold little enough that the mask has already done that.
    // Off rather than lowered, so stepping back to see all four stations at
    // once still shows cities rather than empty ground.
    minZoom: false,
  },
  // The ground's own surface is left out: a block's top is the ground here,
  // and two surfaces at one height is a toss-up over which one a pixel keeps.
  // The rest of what the map draws — the water, the roads, the rails — goes
  // over the blocks as usual.
  ground: { surface: { visible: false } },
  // All of it, in the one statement that makes the map. The viewer seats each
  // by the stage it declares, so the blocks are drawn under the city not
  // because they are written first but because they say they belong under it.
  layers: [...blocks, plane, markers],
})

// Opens on this much ground round the first station, however wide the screen.
// Given as a zoom, the same view would show a phone less than half as much
// across as a desk
viewer.camera.fitBounds({ southWest: [139.695889, 35.686255], northEast: [139.705111, 35.693745] })

/**
 * The floor each space is on, painted right round its building.
 *
 * Which storey a band runs along is the building's own counting, so this
 * names the floor and works out no height; the tag hangs at the spot `data.ts`
 * gives for that floor. The paint waits for that building's tile to come in.
 *
 * Nothing about the city is written here — every building comes from PLATEAU
 * as the tiles land.
 */
for (const { space } of STATIONS) {
  viewer.buildings.setStyle(space.building, { floors: [{ at: space.floor, color: BRAND_COLOR }] })
}

// ── The list ──────────────────────────────────────────────

/**
 * Pressing a row goes to that station. Across, not over: the flight keeps the
 * height it is at and slides level to the next circle, turning to that
 * station's own streets on the way. Rising would only show more of the ground
 * this page left out.
 */
ui(({ at, heading }) => {
  void viewer.camera.flyTo({ center: at, heading }, { arc: false })
})
