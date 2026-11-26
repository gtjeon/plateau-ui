/**
 * 案内図 — the walk from the north side of 中野駅 to the ward office.
 *
 * The guide covers the station, the walk and the ward office and nothing else:
 * outside the circle nothing is drawn and nothing is fetched, so the page
 * costs what it shows.
 *
 * Where the walk goes and what it passes is in `data.ts`; the steps down the
 * side are filled in by `ui.ts`. This file is the map.
 */
import { AnnotationLayer, Marker, Polyline, Viewer } from '@plateau-ui/core'
import { DESK_FLOOR, MARK_COLOR, STOPS, WALK, WARD_OFFICE } from './data.js'
import { ui } from './ui.js'

// ── The walk ──────────────────────────────────────────────

/**
 * Painted along the streets. Over the roads it runs on and under the blocks it
 * passes: where a building stands between it and the eye it shows faint
 * through it, which tells a reader the way goes behind that building rather
 * than over it, and still leaves the way to be followed.
 */
const path = new Polyline({ points: WALK, lineColor: MARK_COLOR, lineWidth: 10 })

// ── The markers ───────────────────────────────────────────

/**
 * The markers fade where something stands in front of them, as the walk does.
 * A stop behind a block is a stop you cannot see from here, and saying so is
 * worth more than the letters are: the panel on the left carries the same four
 * names in order, so nothing is lost by letting the one on the map go faint.
 *
 * What faint comes to is not the whole mark. A mark's white — the band around
 * its letters, the dot inside its pin — keeps its colour whatever strength is
 * asked for, because the fading happens before the frame's own curve and white
 * has run away from the ground by then; see `annotations/mesh.ts`, where the
 * arithmetic is written out. So a hidden mark reads as a pale pin with a crisp
 * white rim rather than as a ghost. Enough to tell the two apart, which is
 * what a guide needs, and worth knowing before you copy this.
 *
 * This is what a group is for: one answer for every mark in it, said once. The
 * walk needs no such thing and is handed to the viewer bare.
 */
const markers = new AnnotationLayer({ behind: 'dim' })
for (const { mark } of STOPS) markers.add(new Marker(mark))

// ── The map ───────────────────────────────────────────────

/**
 * Looking south-west, across the grid rather than along it — the streets of
 * 中野 run north and east, so a view square to them lies flat and dead.
 *
 * Turned so the walk falls down the frame from the station at the top to the
 * ward office at the bottom, which is the order a reader reads the list in.
 *
 * Close enough that the city fills the frame, since a view wider than the mask
 * shows the empty ground past its edge, which reads as a hole rather than as
 * the end of the guide.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 55,
  heading: 225,
  mask: { shape: { type: 'circle', center: [139.66439, 35.70761], radius: 385 }, fade: 110 },
  buildings: {
    // The number guards against how many tiles a wide view asks for, and here
    // the circle is 385m in radius, so what comes in is bounded by the mask and
    // there is nothing left to guard. Off rather than lowered, so that a reader
    // stepping back out of this view still sees the city they walked through.
    minZoom: false,
  },
  // All of it, in the one statement that makes the map. Each is seated by the
  // stage it declares, so this is the order the page reads in rather than an
  // order the picture depends on — the markers are over the walk because a
  // marker is drawn with transparency and the walk is not, which puts them in
  // different passes whichever way round they are written here.
  layers: [path, markers],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds({ southWest: [139.662171, 35.706441], northEast: [139.665889, 35.709459] })

/**
 * The floor the desk is on, said by the building itself. Which storey a band
 * runs along is the building's own counting, so this names the floor and works
 * out no height.
 *
 * Nothing about the city is written here either — every building comes from
 * PLATEAU as the tiles land, and the streets and the water are the GSI's.
 */
viewer.buildings.setStyle(WARD_OFFICE, { floors: [{ at: DESK_FLOOR, color: MARK_COLOR, strength: 0.8 }] })

// ── The list ──────────────────────────────────────────────

ui()
