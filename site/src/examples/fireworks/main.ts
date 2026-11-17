/**
 * 花火 — three.js of your own, over みなとみらい, after dark.
 *
 * Every other example here is made of what the library draws: a mark, a mask,
 * a model, a number painted on a wall. This one is made of what it does not.
 * The shells are a `Layer` written beside this page — an instanced mesh, a few
 * point lights and some arithmetic, none of it the library's — and the page
 * hands it over like any other layer. See `fireworks.ts`; that file is what
 * there is to read here.
 *
 * **What it is for is the light.** A burst is a lamp two hundred metres over
 * the water for a second, and the towers take it on the faces turned toward
 * it. The city is not told about the fireworks and the fireworks are not drawn
 * over the city: they are *in* it, hidden by the tower in front, and what they
 * throw lands on the walls of the ones behind.
 *
 * みなとみらい because what a burst lights here is tall. ランドマークタワー
 * stands 296m and the towers round it are a few hundred of their own, so there
 * is wall above the water from the first floor to the three-hundredth, and a
 * shell goes off halfway up what it is lighting. Over a river the same shell
 * would only reach two banks of blocks.
 *
 * And after dark, because daylight drowns it. The sun is below the horizon at
 * the hour this is set to, so the viewer puts the night's colours on by itself
 * and the only light with a direction in it is the one this page throws.
 */
import { Viewer } from '@plateau-ui/core'
import { Fireworks } from './fireworks.js'

/**
 * The shells, made before the viewer and handed to it in `layers`.
 *
 * Before, because a shader is settled ahead of the first frame and the viewer
 * weaves everything it was given in the constructor. A layer added later is
 * woven later, which is a second of waiting on the first burst.
 *
 * The place is where the barges sit — out on the water off 臨港パーク — and
 * not where the eye is. Hung on the camera instead, a reader who dragged the
 * map would take the whole display with them.
 */
const fireworks = new Fireworks([139.6392, 35.4589])

/**
 * The water the barges sit on and the blocks round it, as a ring standing on
 * them.
 *
 * Eight hundred metres, which holds the shells' water and the whole of the
 * tower cluster on the far side of it. What a burst lights is everything at
 * once, so the ring has to be as wide as the light reaches.
 *
 * Given a `center`, so it stands there rather than riding the camera. A shape
 * that stands can be asked for whole — everything inside it is fetched however
 * the view is turned — and a page that lights the city from the middle wants
 * every wall that would take that light already standing.
 */
const SITE = {
  shape: 'circle',
  center: [139.6361, 35.4588],
  radius: 800,
} as const

/**
 * Low, and looking across the water at the towers.
 *
 * Low because what this page is about is on the *walls*. A view laid back far
 * enough to be a map shows roofs, and a roof three hundred metres up takes
 * nothing from a burst below it. So the pitch is near the ground, which stands
 * みなとみらい up in the picture with the bay between it and the eye.
 *
 * The buildings' `minZoom` off: the default of 18 is set for a district of
 * towers, and
 * here a step back is how a reader takes in a whole burst. Nothing is let
 * loose by turning it off — the ring bounds whatever any zoom may ask for.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  heading: 72,
  buildings: {
    minZoom: false,
  },
  // After dark, which is the whole of what makes a firework a firework: the
  // sun is below the horizon, so the viewer puts the night's colours on and
  // there is no daylight left to drown what this page throws. A Saturday
  // evening in August, half past seven — a little after the sun has gone here
  // at this time of year. Pinned over the ground with `over`, so dragging the
  // map does not move the hour.
  sun: { by: 'time', at: new Date('2026-08-01T19:30+09:00'), over: SITE.center },
  mask: { shapes: [SITE] },
  layers: [fireworks],
})

// Opens on this much ground round the site, however wide the screen. Given as a
// zoom, the same view would show a phone less than half as much across as a
// desk
viewer.camera.fitBounds({ southWest: [139.634057, 35.457136], northEast: [139.638143, 35.460464] })
