/**
 * Which stretch of the river, which three buildings, and how each wears its
 * picture.
 *
 * Nothing here calls the library. A page like this one is mostly one place and
 * a handful of sizes, and looking for how the map is made means scrolling past
 * all of that first.
 */

/**
 * 目黒川 north-west of 中目黒駅, looked at from the north-east: over the backs
 * of the first row on this bank, across the water, to the row on the far side
 * standing up behind it.
 */
export const VIEW = {
  // The ground it opens on, however wide the screen; `main.ts` fits it. A
  // square 200 m a side, wide enough that the panel over the top left corner
  // covers none of the city in the frame the site gives a 1440 screen (980 by
  // 796); in the 820 a 1280 one gives, it still covers the far left corner.
  // Its middle is 10 m further up the screen than the middle of `AREA`: the
  // buildings stand up the screen from their feet, so with the ground in the
  // middle the city is above it
  bounds: { southWest: [139.697493, 35.644874], northEast: [139.699704, 35.646671] } as const,
  pitch: 60,
  heading: 158,
}

/**
 * The piece of the city the map is cut down to: a rectangle 102 m along the
 * water and 71 m across it, with the three cafés in the middle of it. It takes
 * the first row of buildings on each bank and the river between.
 *
 * It stops behind the first row on this bank because the cafés' photographs
 * are on that side. The row behind stands across a narrow street, close enough
 * to hide them.
 *
 * Its edges stand `PUSH` metres clear of the buildings it takes in. The map is
 * cut at the edges whatever stands there, so a building pushed or grown out
 * over one would lose the part that went over. A building the edge goes
 * through is left off whole, so the margin is street and ground and nothing
 * else.
 *
 * Turned square to the river rather than to north, which only a ring of
 * corners can be.
 */
export const AREA: readonly (readonly [number, number])[] = [
  [139.699325, 35.645818],
  [139.698445, 35.646391],
  [139.697954, 35.645893],
  [139.698834, 35.64532],
]

/**
 * The three cafés: two on this bank with buildings between them, and one
 * across the river in the block opposite. None of them is real.
 *
 * Each wears its photograph on the one wall the reader looks at, and `WALL`
 * on the rest. It is put on
 * a building that is a plain box — four walls, each one flat from the ground
 * to the roof — so that one wall is one face, and a photograph as wide as it
 * stops at its corners.
 *
 * `building` is what PLATEAU calls it. `front` is where the middle of the
 * photograph goes: the middle of the wall the reader looks at, halfway up, in
 * metres east, north and up from the middle of the building's foot. It is the
 * wall looking north-east on either bank: on this one the back, away from the
 * river, and across it the one over the water.
 * `face` is how wide and how tall that wall is, in metres, which the
 * photograph is cut to. `photo` is the JPEG in `photos/` it wears; where each
 * came from is in the README there.
 */
export const CAFES = [
  {
    name: 'かわべり珈琲',
    building: 'bldg_9417ba38-0963-4124-a840-ae9e74f6c31f',
    front: [4.11, 4.18, 5.55],
    face: [9.9, 11.1],
    photo: 'storefront',
  },
  {
    name: 'ともしび',
    building: 'bldg_dcb9e58a-a98a-4d47-8d84-84f0db7e27f5',
    front: [2.92, 3.1, 5.9],
    face: [10.6, 11.8],
    photo: 'night',
  },
  {
    name: 'こかげ',
    building: 'bldg_f3f470a0-f4eb-4f7d-9145-d70f5310ac6b',
    front: [3.11, 3.5, 3.55],
    face: [5.7, 7.1],
    photo: 'terrace',
  },
] as const

export type Cafe = (typeof CAFES)[number]

/**
 * The other walls and the roof of every café: one colour for the three, so
 * that a café reads as a café before its photograph does, picked from the
 * photograph of the first.
 */
export const WALL = '#c9b8a3'

/**
 * What the pointer on a café does to the street round it.
 *
 * The café grows by `GROW` about the middle of its foot. Every building whose
 * foot is within `REACH` metres of the café's is pushed straight away from it,
 * by `PUSH` metres next to it and by less further off, down to nothing at the
 * edge of the reach. All of it takes `EASE` milliseconds there and back.
 */
export const GROW = 1.3
export const PUSH = 6
export const REACH = 40
export const EASE = 450

/** How far over the roof the café's card stands, in metres. */
export const OVER_ROOF = 1

/**
 * The line round the café the pointer is on and the one picked, and its card:
 * the red the other examples mark things in. `style.css` writes it again for
 * the card, which a stylesheet cannot import.
 */
export const OUTLINE = '#e5484d'
