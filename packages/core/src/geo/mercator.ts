/**
 * Between longitude and latitude, and the units the world is drawn in.
 *
 * The world is Web Mercator (EPSG:3857) metres, but with **its nought moved
 * to the middle of Japan.** Left where Mercator puts it — off Africa, where
 * the equator meets the prime meridian — Tokyo lands at 15.44 million, and
 * the 32-bit floats a graphics card works in cannot tell metres apart that
 * far out. Every small move of the camera would round each corner differently
 * and the picture would crawl. Moved, nowhere in Japan is past 1.75 million,
 * which is sharp to about 12 centimetres.
 *
 * The axes are the tiles' own, so the arithmetic stays simple. The cost is
 * that the world stretches with latitude — about 1.22 times at Japan's — so
 * anything that arrives in real metres, a building's height among them, is
 * brought back down as it is placed.
 */

/** The Earth's radius in world units, which is what Mercator's stretch is read against. */
export const EARTH_RADIUS = 6378137
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS
/** As far north and south as Mercator can say anything. */
const MAX_LATITUDE = 85.051129

/** Where the world's nought is: the middle of the rectangle Japan fits in. */
const ORIGIN_LON = 138.25
const ORIGIN_LAT = 35.8713

function mercatorX(lon: number): number {
  return ((lon * Math.PI) / 180) * EARTH_RADIUS
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))
  const rad = (clamped * Math.PI) / 180
  return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + rad / 2))
}

/** Where that nought sits in Mercator's own, added back when tiles are counted. */
export const WORLD_ORIGIN_X = mercatorX(ORIGIN_LON)
export const WORLD_ORIGIN_Y = mercatorY(ORIGIN_LAT)

/** A rectangle in world units. y rises north — the opposite of the world's z. */
export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * A rectangle on the map, said by two opposite corners.
 *
 * Each corner is a place the way everything else here says one — `[longitude,
 * latitude]`, which is what `Mask.center`, a polygon's corners and
 * `placeFrom` are all written in. {@link WorldBounds} is the same rectangle
 * after the library has worked it out in world units, and is not what a page
 * writes.
 *
 * `Viewer.fitBounds` took four loose numbers called `minLon`…`maxLat` before
 * 2026-10-13. That was the only place in the library that said "lon" to a
 * page, and the only rectangle not made of the places everything else is made
 * of; `ImageLayer` asking a page for one is what brought it into line.
 */
export interface MapBounds {
  /** The south-west corner: the smaller longitude, the smaller latitude. */
  readonly southWest: readonly [number, number]
  /** The north-east corner: the larger of each. */
  readonly northEast: readonly [number, number]
}

export function lonToX(lon: number): number {
  return mercatorX(lon) - WORLD_ORIGIN_X
}

export function latToY(lat: number): number {
  return mercatorY(lat) - WORLD_ORIGIN_Y
}

export function xToLon(x: number): number {
  return (((x + WORLD_ORIGIN_X) / EARTH_RADIUS) * 180) / Math.PI
}

export function yToLat(y: number): number {
  return ((2 * Math.atan(Math.exp((y + WORLD_ORIGIN_Y) / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI
}

/**
 * How many real metres one world unit is worth at that latitude.
 * What comes in real metres is divided by this as it is placed.
 */
export function metersPerUnit(lat: number): number {
  return Math.cos((lat * Math.PI) / 180)
}
