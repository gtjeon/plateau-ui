/**
 * 駒形 — how long a flood would stay, stood up over the streets it fills.
 *
 * The hazard portal publishes, beside how deep a river's flood would reach,
 * how long the water would stay before it drains away. Here that map is not
 * laid on the ground but stood up off it: each band of the map is a step, and
 * the houses of 駒形, west of 隅田川, stand in them — a few blocks where the
 * water would leave within half a day sit beside blocks where it would stay
 * for weeks.
 *
 * Where the page stands and the legend it reads by are in `data.ts`; the panel
 * is built by `ui.ts`. This file is the map.
 */
import { ImageExtrusionTileLayer, Viewer } from '@plateau-ui/core'
import { HAZARD, HOURS, HOURS_ZOOMS, LEGEND, STREET, WATER } from './data.js'
import { ui } from './ui.js'

/**
 * The portal's map of how long the water stays, stood up as steps: each
 * colour of the picture raises the ground it covers, counted from the land.
 *
 * A little see-through to begin with, so the house standing in a step is
 * still seen to stand in it, and throwing no shadow, which would darken the
 * very streets a reader looks at through it.
 */
const steps = new ImageExtrusionTileLayer({
  url: HOURS,
  credit: HAZARD,
  minZoom: HOURS_ZOOMS.min,
  maxZoom: HOURS_ZOOMS.max,
  legend: LEGEND,
  opacity: 0.9,
  castShadow: false,
})

const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  heading: 37,
  // The land's own heights, so each step is counted from the ground it stands on
  ground: { elevation: true },
  // The city stands further out too, for a reader who steps back to see the
  // whole strip; the default holds it back until 18
  buildings: { minZoom: 16 },
  // A narrow strip round the street and nothing else, and so is what the page fetches
  mask: { shapes: [{ shape: 'rect', center: STREET, width: 800, height: 400 }] },
  layers: [steps],
})

// Opens on this much ground round the street, however wide the screen. Given as
// a zoom, the same view would show a phone less than half as much across as a
// desk
viewer.camera.fitBounds({ southWest: [139.793661, 35.704742], northEast: [139.794739, 35.705618] })

ui(
  (opacity) => {
    steps.opacity = opacity
  },
  (oneColor) => {
    steps.color = oneColor ? WATER : undefined
  },
)
