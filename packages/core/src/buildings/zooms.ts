/**
 * The zoom the city stands up at.
 *
 * It sat in the root of the library once, as the neutral ground two layers
 * met on: the ground laid footprints and stood trees exactly where the
 * buildings stood, so that outlines were never left with nothing on them and
 * a park never arrived in a city that had not. The ground keeps neither
 * promise now — its plan is part of the map at any zoom, and its parks come
 * with the land use they stand on — so there is nothing left to agree about
 * and the number came down here, beside the city's other thresholds. A
 * threshold one layer reads belongs to that layer.
 */

/**
 * Where the city begins: the zoom buildings stand up at.
 *
 * A building tile is shaped on the main thread as it lands, and the screen
 * holds the most tiles at the coarsest zoom that draws them, so the cheapest
 * way to bound that work is to say where the city begins. Here a window 670
 * pixels wide at the default tilt looks across some 400m and stands a dozen
 * tiles; at 16 it took around 70, a step out five times that, and two steps
 * out over a thousand.
 */
export const DEFAULT_CITY_MIN_ZOOM = 18

/**
 * The coarsest zoom the city may be asked to stand at.
 *
 * A cost limit. It is the last zoom whose tile count is survivable — around
 * 70 against a step out's five times that — and a building tile is shaped on
 * the main thread as it lands.
 *
 * It was a data limit as well while the ground planted its parks where the
 * city stood: PLATEAU's land use is fetched at z16 and at no other zoom, so a
 * city standing below it stood without them. The parks come with their own
 * data now and that reason is gone; the number is the same.
 *
 * `false` is the limit turned off rather than a value on this scale; see
 * {@link cityMinZoomOf}.
 */
export const CITY_MIN_ZOOM_COARSEST = 16

/**
 * What a zoom asked for is held to.
 *
 * Off passes through; a number is held to {@link CITY_MIN_ZOOM_COARSEST}, and
 * so is anything below it. There is one way to ask for every zoom and a
 * number is not it — nought or less would otherwise be a second way in,
 * saying the same thing in a spelling nobody could read.
 *
 * There is no ceiling. A number above the zoom the viewer itself stops at
 * means the city never stands, which is a fair thing to ask for and breaks
 * nothing; held to the ceiling instead it would stand in the last step before
 * it, which is not what was asked.
 */
export function cityMinZoomOf(value: number | false): number | false {
  return value === false ? false : Math.max(CITY_MIN_ZOOM_COARSEST, value)
}

/**
 * Whether the view is close enough for the city to stand.
 *
 * Off it always is, and the zoom decides nothing. That is for a viewer cut to
 * a shape small enough that every building inside it fits at once, where the
 * number was only ever guarding against how many tiles a wide view would ask
 * for.
 */
export function cityStands(zoom: number, cityMinZoom: number | false): boolean {
  return cityMinZoom === false || zoom >= cityMinZoom
}
