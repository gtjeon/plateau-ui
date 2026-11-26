/**
 * Where the district is, what it is cut to, and what walks through it.
 *
 * Nothing here calls the library. A page like this one is mostly the place it
 * is about — the coordinates, the reach, the creature — and looking
 * for how the map is made means scrolling past all of it first. So it sits on
 * its own, to be opened when a number matters and left shut when it does not.
 */
import { metersFrom, placeFrom } from '@plateau-ui/core'
import type { Mask } from '@plateau-ui/core'

/** The middle of the district: 虎ノ門, in 港区. */
export const SITE = [139.749, 35.6607] as const

/** How far the district reaches from its middle, in metres. */
export const REACH = 900

/**
 * The district and nothing past it: what falls outside is neither drawn nor
 * fetched, so the page costs one district rather than the city it stands in.
 *
 * It cuts the city and nothing else — the land is a plane, and a plane is not
 * masked — so what ends at the circle is the buildings.
 *
 * No hem. A hem takes what it holds over to the backdrop before the cut ends
 * it, which is worth doing where the edge would otherwise read as a line; here
 * the land runs on past it either way, and a building at the rim is better cut
 * clean than dissolved into the ground it stands on.
 */
export const MASK: Mask = { shape: { type: 'circle', center: SITE, radius: REACH }, fade: 0 }

/**
 * The board the district stands on: a plain grey, no hue in it, a few steps
 * under the library's own ground, which is what the walls are near, so the
 * city stands up off it rather than melting into it. The one colour this page says; the rest is the
 * library's.
 */
export const LAND = '#c8c8c8'

// ── The creature ──────────────────────────────────────────

/**
 * The model: “Trex” of Quaternius's Dinosaur Animated Pack, as glTF. CC0, and
 * credited in the viewer's line anyway while it is on screen; see
 * `models/Trex-LICENSE.txt` for what was changed on the way to glTF.
 */
export const MODEL_URL = new URL('./models/Trex.glb', import.meta.url).href
/** The clip it walks by, as the file names it. */
export const WALK_CLIP = 'Armature|TRex_Walk'

/** How tall it stands, in metres. Twice the blocks it walks between. */
export const HEIGHT = 105

/**
 * How fast it walks, in metres a second, taken over a whole stride.
 *
 * Slow, for a thing this size: a stride of a hundred and ten metres at this
 * pace takes near seven seconds, so a foot comes down about every three and a
 * half. Fast enough that it is going somewhere, slow enough that the wave from
 * one footfall is still crossing the district when the next lands.
 */
export const PACE = 16

/** Where it starts: 460 m east and 460 m south of the middle, facing it. */
export const START = { x: 460, y: -460, yaw: (135 * Math.PI) / 180 }

/**
 * Where a place given in metres from the middle of the district falls, as
 * [longitude, latitude].
 *
 * The creature walks in metres — a pace is sixteen of them — and the map
 * wants degrees, so something has to turn one into the other. That is the
 * library's, not this page's: a page working it out for itself picks a length
 * for a degree, and the one it picks is not the one the map was drawn with.
 */
export function fromSite(east: number, north: number): [number, number] {
  return placeFrom(SITE, east, north)
}

/**
 * The way back: a place on the map, in metres from the middle of the district.
 *
 * Exactly the way back, which is why it is worth having — the view's middle
 * is read here, held to the district and written out again, and a pair that
 * did not undo each other would walk the view a little further out every time.
 */
export function toSite(lon: number, lat: number): [east: number, north: number] {
  return metersFrom(SITE, [lon, lat])
}
