/**
 * Zilla — a creature walking through 虎ノ門, and the city shaking under it.
 *
 * Outside the circle no building is drawn and none is fetched, so the page
 * costs the district rather than the city round it.
 *
 * Where the district is and what walks through it is in `data.ts`; how it walks
 * is in `zilla.ts`, and `walk.ts` sets it walking; what a footfall does to the
 * buildings is in `shake.ts`, and the panel that picks between those in
 * `ui.ts`. This file is the map.
 */
import { Solid, Viewer } from '@plateau-ui/core'
import { PlaneGeometry } from 'three'
import { LAND, MASK } from './data.js'
import { ui } from './ui.js'
import { walk } from './walk.js'

/**
 * The land is one plane rather than the map's own tiles: nothing the ground
 * would draw is wanted here.
 *
 * A grey of its own (`data.ts`), and the city on it in the library's colours.
 * A solid told none wears the colour the map's own ground does, and that is
 * the walls' colour near enough that the blocks melt into the board.
 */
const plane = new Solid({
  at: 'view',
  geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  fillColor: LAND,
  // Not cut, which is what `data.ts` has always said of it: the mask takes the
  // city and the land runs on past it. The plane covers the window, so there
  // is no horizon: no air behind it shows.
  masked: false,
})

/**
 * Turned so that 東京タワー stands at the top of the screen: the district has
 * one thing in it anybody knows by sight, and a picture of a place reads as
 * that place when what says so is in it. The tower is 234° from the middle,
 * and the top of the screen looks along the heading.
 *
 * Close in on the creature rather than back far enough to hold the whole
 * circle: a hundred-metre lizard framed by a nine-hundred-metre district is a
 * speck, and what the page is about is the thing walking. What falls outside
 * the frame is still there — the district is cut by the mask, not by the
 * camera — and the frames below carry the view along after it. It opens where
 * the creature sets out, so there is nothing to find.
 *
 * A little under the isometric angle, which leaves street between the blocks
 * and shows a building from the side rather than from above.
 *
 * The land is left flat. 虎ノ門 climbs west towards 赤坂, but what this page is
 * for is a district standing on a board, and a board is level.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 60,
  heading: 126,
  mask: MASK,
  // Written with the plane after the buildings on purpose: the viewer seats
  // each by the stage it declares, so a plane that says it belongs under the
  // city is under it however it is written here. The creature goes on later,
  // when its walk has been measured.
  // No map's ground: the district stands on a plane of the page's own, so the
  // land is turned off and fetches nothing.
  ground: { visible: false },
  // No glass and no parapets cut into the roofs. What this page is for is a
  // district being shaken, and a wall's own detail is not what reads while it
  // is. Nothing about which buildings stand is written here — every one of
  // them comes from PLATEAU as the tiles land.
  buildings: {
    // The number guards against how many tiles a wide view asks for, and here
    // the circle is 900m in radius, so what comes in is bounded by the mask and
    // there is nothing left to guard.
    minZoom: false,
    windows: { visible: false },
    parapet: { visible: false },
  },
  layers: [plane],
})

// Opens on this much ground round where the creature sets out, however wide the
// screen. Given as a zoom, the same view would show a phone less than half as
// much across as a desk
viewer.camera.fitBounds({ southWest: [139.749768, 35.65305], northEast: [139.758415, 35.660076] })

// The creature, set off once its clip is measured; the panel picks how the
// city shakes under it
ui(walk(viewer))
