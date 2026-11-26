/**
 * 日あたり — one house, and the shadow it throws.
 *
 * Every other page here is about a place: a district, a line of towers, a
 * slope above the sea. This one is about a single building, close enough to
 * see the ridge of its roof, and what the page is for is what the light does
 * to it.
 *
 * So there is no ground, and nothing is cut to a shape. The sheet is white,
 * one building stands on it and no other is drawn at all. A shadow is read
 * against what it falls on, and the surveyed ground here is a road, a kerb and
 * a corner of green, every one of which gives the eye something to follow that
 * is not the shadow. White gives it nothing else.
 *
 * What moves is the hour, and which day's hour. The viewer is given a moment
 * rather than an angle — a date and a place, which it turns into a sun the way
 * the sky does — so the page's controls are a day and a clock, and everything
 * on screen follows from where those two put the light.
 *
 * Two days, which is the one thing a single day cannot show: how far the light
 * itself moves over a year. The shadow at ten in the morning is only a fact
 * about ten in the morning until there is another ten in the morning to read
 * it against. So both days' roads are drawn at once and the chosen one is
 * inked — the day being watched is a choice made on a picture that is already
 * whole, rather than a picture that is redrawn each time the choice changes.
 *
 * Which house, why that one, and which two days, is in `data.ts`; the sun's
 * roads and where it stands are worked out in `sky.ts`, and the controls are
 * in `ui.ts`. This file is the map.
 */
import { DARK, Polyline, Solid, Viewer } from '@plateau-ui/core'
import { PlaneGeometry, SphereGeometry } from 'three'
import { AT, HOUSE, INK, PAPER, SEASONS, START, START_SEASON, SUN_SIZE, momentOf, ring } from './data.js'
import { follow, lit, road } from './sky.js'
import { ui } from './ui.js'

/**
 * The sheet the house stands on and the shadow lands on.
 *
 * White by day, and the page says which white ({@link PAPER}): a solid told no
 * colour wears the one the map's ground wears, which is a shade of the sky and
 * would read as ground rather than as the sheet a model is photographed on.
 *
 * After dark it wears the dark palette's ground number instead —
 * `DARK.surface`, the night half of a pair. A white sheet is the one thing on
 * the page that does not go out at sunset, and left white it is the brightest
 * thing on a dark screen with nothing on it to read: the house goes flat, the
 * lines turn over to their night ink, and the sheet under both stays lit like
 * a lightbox. The reason the day colour is not the ground's does not hold at
 * night — nothing reads as ground when there is no daylight to read it by.
 *
 * A pair, so the page does not decide when night is. The library turns each
 * half over at the moment it turns the map's own palette over, off the one
 * threshold it keeps in `sun.ts`; this page used to ask `sunAt(...).down` on
 * every move and swap the colour in itself, which was the same answer worked
 * out twice.
 *
 * What it is NOT is the colour the map's ground draws. Both numbers are
 * reflectances, but they go in by different doors: the palette's own ground is
 * lit straight off `surface`, while a colour a page sets on a solid goes
 * through `keepsItsColor`, which walks the tone curve backwards first so that
 * the page gets its colour back under full daylight. The palette's number has
 * already been walked back once in `theme.ts`, so the sheet is walked back
 * twice and lands on the palette's input rather than on what the input draws.
 *
 * Measured at 冬至 20:00, reading the canvas and averaging a block of pixels,
 * since the frame dithers each one a step either way: the sheet draws
 * `#393b3e`, which is `surface` itself give or take that step, where the
 * map's own ground under the same palette draws `#1b1f25`. Kept, because what
 * this page needs of the sheet at night is that it stop being a lightbox —
 * `#e1e1e1` by day, measured the same way — and that is well under the walls
 * and well under the house. A solid told no colour at all does wear the map's
 * ground, at either hour; but a pair has no way to leave one half to the
 * palette, and the day half is the shade of the sky this sheet is not.
 *
 * Nothing cuts it: this page has no mask at all, and a plane is reached by one
 * only where the page asks for it (`masked`). Here that is what is wanted —
 * the white runs to the edge of the window and there is no edge in the picture
 * at all.
 *
 * A solid, and it writes depth like any other, which is how the sun sets. The
 * ball goes under nought and the sheet is in front of it; nothing hides it by
 * hand.
 */
const plane = new Solid({
  at: 'view',
  geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  fillColor: { light: PAPER, dark: DARK.surface },
})

/**
 * The sun itself, as a ball standing over the plot.
 *
 * The one thing on this page that is not surveyed and not drawn to scale. What
 * a shadow is, is the light's direction written on the ground, and the light's
 * direction is the only thing about it there is no way to read off the picture
 * — a reader watching the shadow swing has to be told what is swinging it. So
 * the page says it outright: a point, out where the light is coming from, low
 * in the morning, over the roof at noon, low again at four.
 *
 * Small and close, which is a diagram and is meant to look like one. It stands
 * twenty-two metres off, so it is on the plot rather than at the edge of the
 * sky, and nobody will mistake a ball inside the garden fence for the sun
 * being there.
 *
 * `castShadow: false`, which is the whole reason a sphere can be told that. It
 * stands on the line between the sun and what the sun is lighting, so a shadow
 * thrown from here lands on the roof this page is about — a dark blot in the
 * middle of the one thing being looked at, arriving from nowhere a reader
 * could see.
 *
 * `occludes: false` beside it, which says the same of the other shade on this
 * page: the dark the picture closes into its corners. The ball stands for the
 * light and is not in the garden at all, so there is no corner of the garden
 * for it to close in — and a sun darkened round its own edge is the dark side
 * `glows` is there to keep off it.
 *
 * `glows: true`, because it is the light. Shaded like anything else it would
 * have a dark side, and a sun with a dark side is a ball standing where the
 * sun is rather than the sun — worse, the side turned from the light would be
 * the side facing the house, so the one thing in the picture that is lighting
 * everything would be the one thing looking unlit.
 *
 * Amber, where nothing else here has a hue at all. That is what makes it read
 * as the sun rather than as a marker somebody dropped, and it is one point a
 * metre and a half across, so it takes nothing away from the shadow.
 *
 * Where it stands is set by `follow` in `sky.ts`, and again on every move, and
 * after the sun goes down it is under the sheet — which is the sheet being a
 * solid and not the page hiding anything.
 */
const sun = new Solid({
  at: AT,
  // Cut about its own middle, which is where a ball is put
  geometry: new SphereGeometry(SUN_SIZE, 32, 16),
  fillColor: '#e8a33c',
  glows: true,
  castShadow: false,
  occludes: false,
})

/** Both roads, by the day each one belongs to, so that choosing a day can find its line. */
const arcs = new Map(SEASONS.map((season) => [season, road(season)]))

/**
 * The circle the sun rises out of and sets into, drawn on the ground.
 *
 * The arc's own footing: the same radius, laid flat, so the two read as one
 * ring standing at an angle rather than as a curve floating over a sheet. It
 * is what tells a reader how far out the sun is being stood, which the arc
 * alone cannot say — a curve in the air over a plain white page has no size.
 *
 * The same line as the arc in every other way: thin, black, glowing, hidden by
 * whatever gets in front. Two drawings of the same circle should not disagree
 * about what a line looks like.
 *
 * Two numbers a corner, because it is on the ground and that is how a line on
 * the ground is said. It is cut to follow the land like any other.
 *
 * `billboard: true` is the whole of what it asks for beyond that, and it settles
 * two things at once. A flat width is a different weight in every direction at
 * this tilt — measured round this very circle, from full black where it faced
 * the eye to barely there where it ran across. And a line whose width faces
 * the eye cannot be painted through a curtain of stencil, so it is drawn as a
 * strip instead, which works its edge out to a share of a pixel where the
 * stencil is in or out a whole one. The arc beside it is drawn the same way,
 * and between them the two are one ring.
 */
const horizon = new Polyline({
  points: ring(),
  lineColor: INK,
  lineWidth: 1,
  glows: true,
  billboard: true,
  behind: 'hide',
})

/**
 * Close in, and from the side rather than from above.
 *
 * A shadow is read where it lies on the ground, so the eye has to be low
 * enough for the ground to have depth in the picture and high enough to see
 * the whole of what is lying on it. 55° is that, and it is also the angle at
 * which a gable still reads as a gable — flatter and the two slopes are one
 * roof again.
 *
 * Turned so the ridge runs across the view. End-on, a gabled house is a
 * rectangle and the roof is a line; across, both slopes are in the picture
 * and so are both of the shadow's edges.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  heading: 115,
  sun: lit(momentOf(START_SEASON, START)),
  // Nothing here is fetched for being looked at — the house is named — so
  // the guard on how close the view must be has nothing to hold back.
  // No mask, so nothing is cut away: the house is the whole of the page.
  // No map's ground under it: this page stands the house on a plane of its
  // own, so the land is turned off and fetches nothing.
  ground: { visible: false },
  // No city behind it. Nothing arrives for being looked at, so there is none
  // here to hide — which is what the page did for a while, taking the house's
  // tile whole and then putting a rule over it to send the neighbours away.
  //
  // Nor is anything cut. A ring round the plot would have hidden the
  // neighbours too, but only the ones outside it — they stand twelve metres
  // off and share this house's tile — so a mask was never going to be what
  // kept the page to one building. The house itself is stood below.
  buildings: {
    // Nothing is fetched for the view at all, so there is no zoom to hold it
    // back from: the one house on this page is stood by name below.
    load: 'brought',
  },
  layers: [plane, horizon, ...arcs.values(), sun],
})

// Opens on this much ground round the house, however wide the screen. Given as
// a zoom, the same view would show a phone less than half as much across as a
// desk
viewer.camera.fitBounds({ southWest: [139.52201, 35.304581], northEast: [139.522662, 35.305113] })

/**
 * The one house, stood where the survey has it.
 *
 * The coordinate is the clue that finds it, never anything that is drawn: a
 * gml:id carries the 市's code while the data is published per 区, so where to
 * look is the only thing that says which tileset to open. Here it is the place
 * the view is centred on, because the page is centred on the house.
 */
void viewer.buildings.bring({ id: HOUSE, findAt: AT })

// The day and the moment the controls are put to, and the page turned with them
ui(follow(viewer, sun, arcs))
