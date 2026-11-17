/**
 * 屋上のヘリポート — a marking cut into a roof, where a reader presses one.
 *
 * The page says which building and how wide, and nothing else. Where that
 * roof is, how high it stands, which way it is tilted, how the light falls on
 * it — none of it is written here, and none of it could be: the survey knows
 * the shape and this file has not seen it.
 *
 * Which is the point being made. A marking painted on a roof is not a board
 * hung over it — it lies in the surface, takes the shade the surface takes,
 * and goes with the building if the building is ever moved. So it is cut into
 * the city rather than placed in front of it, and the only thing the page
 * carries is a picture it drew a moment ago.
 *
 * Pressing a marked roof takes it off again. The library holds a building's
 * style — its roof picture with it — by the name PLATEAU gives the building,
 * so the page asks it which roofs wear one and keeps nothing but how many —
 * no names, no positions, no heights, no list of what the city contains.
 *
 * Where the tower is and how wide the marking is are in `data.ts`; what a
 * press does is in `pads.ts`, and the picture and the line under the title in
 * `ui.ts`. This file is the map.
 */
import { Viewer } from '@plateau-ui/core'
import { AROUND, HEM, MIDDLE, VIEW } from './data.js'
import { pads } from './pads.js'
import { ui } from './ui.js'

const viewer = new Viewer({
  container: 'map',
  pitch: VIEW.pitch,
  heading: VIEW.heading,
  mask: { shapes: [{ shape: 'circle', center: MIDDLE, radius: AROUND }], fade: HEM },
  // Boxes rather than the surveyed roof shapes. A pad is laid on a roof as one
  // flat marking, and a surveyed top is not one flat thing: plant rooms, lift
  // overruns and stair heads come through as stacked blocks a few metres
  // across, and the marking would land among them rather than on them. A box
  // has one top, which is the roof a reader means when they press it.
  buildings: {
    // The circle is 1.1 km across, so there is nothing left for the guard
    // against a wide view asking for half a prefecture of tiles.
    minZoom: false,
    lod: 1,
  },
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds(VIEW.bounds)

pads(viewer.buildings, ui())

addEventListener('beforeunload', () => {
  viewer.dispose()
})
