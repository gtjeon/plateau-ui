/**
 * 中目黒 — a viewer, and the palettes to colour it in.
 *
 * The shortest page this library has. One `new Viewer`, and what comes up is
 * the land, the water, the roads, the rails, the parks with their trees, and
 * the city standing on all of it. None of that is asked for here: the viewer
 * makes the ground, the city and the model place itself and hands them back,
 * so a page that wants the map as it comes writes no layer at all.
 *
 * And the panel shows how far that same map goes without one either: a
 * pastel, a photograph in greys, a city under neon, a desert, and the
 * buildings' folds inked in or not — the palette and one of the city's
 * settings, written while it runs. And the miniature look, on from the start
 * and off with a tick, which is one of the viewer's own. The palettes are in `data.ts`, the writing
 * of them in `looks.ts`, the panel in `ui.ts`.
 *
 * Flat land, which is the one thing a bare viewer does not give: heights are
 * `ground: { elevation: true }` and off by default, so the valley 目黒川 runs
 * in is not in this picture. Said here rather than turned on, since what the
 * page is for is what comes without asking.
 *
 * So this is the floor the other examples are built on. Every one of them is
 * this plus one thing — a mark, a mask, a model, a colour on a wall — and a
 * reader who wants to know what the one thing costs can read it against this.
 *
 * 中目黒 rather than any of the places a map of 東京 opens on. Nothing here is
 * a landmark: 目黒川 runs through the middle, the 東横線 crosses it on a
 * viaduct, one tower stands over the station and everything else is three and
 * four storeys packed to the kerb. That is what most of the city is, and a
 * survey of it reads as a city rather than as a set of famous roofs.
 */
import { Viewer } from '@plateau-ui/core'
import { SCHEMES } from './data.js'
import { drawEdges, miniature, paint } from './looks.js'
import { ui } from './ui.js'

/**
 * Looking east along the river, laid as far back as the viewer goes.
 *
 * 70° is the clamp (`MAX_PITCH`), and it is where this place is worth seeing
 * from: from overhead the low blocks are their own plans and the river is a
 * line, while from here they stack into one another and the tower over the
 * station has a height rather than a footprint. (The 東横線 is not in that —
 * railways are laid on the ground at their real width, viaduct or no, so what
 * crosses the river here is drawn as a line across it.)
 *
 * The city is let stand further out than it does by default — from 16.5 rather
 * than 18 — so that a reader pulling back to see the whole of 中目黒 is still
 * looking at a city rather than at its plan, and so that a phone, which opens
 * further out than a desk does (below), opens on one: at 16.8 on a phone 390
 * wide. What that costs is tiles, each of which is shaped
 * on the main thread as it lands: `buildings/zooms.ts` has a dozen of them on
 * screen at 18 and some seventy at 16, which is the coarsest the library will
 * take. This one in between was not measured.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  heading: 88,
  buildings: { minZoom: 16.5 },
  // The miniature look, on from the start: sharp where the view is centred and
  // blurred in front and behind, by as much as the view's own tilt calls for
  tiltShift: { enabled: true },
  // As far as the screen reaches, which is a viewer nobody has cut. Most of
  // the examples here name a shape instead and pay for only what is inside it;
  // this one is what the word means when nothing is being left out.
  mask: { shapes: [{ shape: 'view' }] },
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds({ southWest: [139.695829, 35.641973], northEast: [139.700571, 35.645827] })

ui(SCHEMES, {
  scheme: (scheme) => paint(viewer, scheme),
  edges: (on) => drawEdges(viewer, on),
  tiltShift: (on) => miniature(viewer, on),
})
