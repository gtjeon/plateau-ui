/**
 * 防犯カメラ — a camera on a wall, and what it sees.
 *
 * The page hangs one camera on one wall over 新宿通り and asks the library a
 * question it cannot answer by looking: what of the street and the walls
 * round it is in sight of that lens. What comes back is paint, worked out from
 * the city as it stands — the block across the road takes a piece of the
 * street out, and nothing in this file knows where that block is.
 *
 * The camera is fixed, as a real one is: which way it looks is its wall's,
 * and how wide and how far are `data.ts`'s. Pressing the map puts a pin there
 * — on the ground, or on a building's wall or roof — and the camera says
 * whether it sees that spot: the paint's own answer, asked of one place.
 *
 * The camera's shape is in `camera.ts`, and the pins in `pins.ts`. This file
 * is the map.
 */
import { AnnotationLayer, Solid, Viewer, Viewshed } from '@plateau-ui/core'
import { hang, housingShape, lensShape } from './camera.js'
import { pins } from './pins.js'
import { BODY, FOV, FRONT, GLASS, MIDDLE, PAST_THE_LENS, RANGE, SQUARE, START, VIEW } from './data.js'

/** The housing, on its arm, at its spot on the wall. Out of the way until the city is up. */
const housing = new Solid({
  geometry: housingShape(),
  at: START.at,
  facing: START.facing,
  fillColor: BODY,
  // Clicks go through it to the wall behind, so a camera never stands in the
  // way of moving itself
  pickable: false,
  visible: false,
})

/** The lens, on the housing's front: held to the housing, so it goes wherever the housing goes. */
const lens = new Solid({
  geometry: lensShape(),
  at: { solid: housing, offset: [0, FRONT, 0] },
  facing: START.facing,
  fillColor: GLASS,
  pickable: false,
  visible: false,
})

/** What the camera sees, from just past the lens. Held to the housing as the lens is. */
const sight = new Viewshed({
  at: { solid: housing, offset: [0, FRONT + PAST_THE_LENS, 0] },
  facing: START.facing,
  fov: FOV,
  range: RANGE,
  visible: false,
})

/** The pins. */
const markers = new AnnotationLayer()

const viewer = new Viewer({
  container: 'map',
  pitch: VIEW.pitch,
  heading: VIEW.heading,
  mask: { shapes: [{ shape: 'rect', center: MIDDLE, width: SQUARE, height: SQUARE }] },
  // The guard is for a wide view asking for half a prefecture of tiles. The
  // square is 260 m across, so there is nothing left for it to guard.
  buildings: { minZoom: false },
  layers: [sight, housing, lens, markers],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds(VIEW.bounds)

hang(viewer.buildings, { housing, lens, sight })
pins(viewer.ground, viewer.buildings, sight, markers)

addEventListener('beforeunload', () => {
  viewer.dispose()
})
