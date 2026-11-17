/**
 * Real metres on the ground, which are not the metres the world is drawn in.
 *
 * `mercator.ts` answers where a place lands in the units a card draws in, and
 * those stretch with latitude — about 1.22 times at Japan's. This is the other
 * question, and the one a page asks: how far apart two places are, and where a
 * place so many metres from another one is. A page that wants a square 800m
 * across means 800m of ground, not 800 of whatever the projection counts.
 *
 * Both take the Earth for a sphere, which is what every map library on the web
 * does — Turf, Mapbox GL JS, Leaflet and deck.gl each measure on one, and
 * their radii sit within twelve metres of each other. The one here is the mean
 * of the WGS84 ellipsoid's, which is Turf's and Mapbox's.
 *
 * A sphere is not the ground, and this is the price: an ellipsoid answers a
 * degree of latitude differently at every latitude — 110,940m at 東京 against
 * this sphere's 111,195 — so what is asked for in metres comes out about two
 * parts in a thousand short of what a tape would say, nine tenths of a metre
 * in four hundred. Carrying the ellipsoid is what Cesium is for, which draws a
 * globe and is asked where a satellite is.
 *
 * It is not the projection's own radius either, which is the equatorial
 * 6,378,137m the tiles are cut on. Leaflet does the same thing — draws on one
 * sphere and measures on another — and for the same reason: what is drawn has
 * to land on the tiles, and what is measured should be the ground.
 */

/** The Earth as one sphere, for measuring on: the mean of WGS84's three radii. */
const GROUND_RADIUS = 6_371_008.8

const RADIANS = Math.PI / 180

/**
 * The place so many metres east and north of another one.
 *
 * Taken as one move — that far, in that direction — rather than as a step
 * east and then a step north. The two are not the same thing on a sphere and
 * only one of them has an exact way back: {@link metersFrom} undoes this to
 * the last decimal, so a page can hold a place as metres from a middle and
 * read it back as metres from that middle.
 *
 * East and north near the start, then: further out the direction has turned
 * with the meridians, and "north" is where north was when it set off, which is
 * what going north on a sphere means. Against the flat reading — so far east
 * at this latitude, then so far north — it is a millimetre at a hundred
 * metres, two centimetres at four hundred, thirteen at a thousand, and
 * thirteen metres at ten thousand.
 */
export function placeFrom(from: readonly [number, number], east: number, north: number): [number, number] {
  const away = Math.hypot(east, north)
  if (away === 0) return [from[0], from[1]]
  const along = away / GROUND_RADIUS
  const towards = Math.atan2(east, north)
  const wasLon = from[0] * RADIANS
  const wasLat = from[1] * RADIANS
  const lat = Math.asin(
    Math.sin(wasLat) * Math.cos(along) + Math.cos(wasLat) * Math.sin(along) * Math.cos(towards),
  )
  const lon =
    wasLon +
    Math.atan2(
      Math.sin(towards) * Math.sin(along) * Math.cos(wasLat),
      Math.cos(along) - Math.sin(wasLat) * Math.sin(lat),
    )
  return [lon / RADIANS, lat / RADIANS]
}

/**
 * How far one place is east and north of another, in metres.
 *
 * The way back from {@link placeFrom}, and exactly that: how far off it is and
 * which way, put back as the two numbers that were handed over. A page wanting
 * the plain distance takes `Math.hypot` of the pair.
 *
 * How far apart is worked out through the half-angles rather than through the
 * cosine of the whole one. Two places a metre apart move that cosine by a part
 * in a hundred million million, which is about the last bit a double holds, so
 * taking it straight comes back five millimetres long at a metre and a third
 * too long at a tenth of one. Leaflet works it this way; Mapbox takes the
 * cosine, and a page here asks in single metres — a foot on a building, a
 * mark beside a door.
 */
export function metersFrom(
  from: readonly [number, number],
  to: readonly [number, number],
): [east: number, north: number] {
  const wasLat = from[1] * RADIANS
  const nowLat = to[1] * RADIANS
  const halfLat = Math.sin(((to[1] - from[1]) * RADIANS) / 2)
  const halfLon = Math.sin(((to[0] - from[0]) * RADIANS) / 2)
  const half = halfLat * halfLat + Math.cos(wasLat) * Math.cos(nowLat) * halfLon * halfLon
  const away = GROUND_RADIUS * 2 * Math.atan2(Math.sqrt(half), Math.sqrt(1 - half))
  if (away === 0) return [0, 0]
  const turn = (to[0] - from[0]) * RADIANS
  const towards = Math.atan2(
    Math.sin(turn) * Math.cos(nowLat),
    Math.cos(wasLat) * Math.sin(nowLat) - Math.sin(wasLat) * Math.cos(nowLat) * Math.cos(turn),
  )
  return [away * Math.sin(towards), away * Math.cos(towards)]
}
