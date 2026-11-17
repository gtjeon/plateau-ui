/**
 * The five, where each of them stands, and where the row is put up.
 *
 * Nothing here calls the library. A page like this one is mostly the buildings
 * it is about — their names, and the coordinate that finds each — so it sits
 * on its own, to be opened when a number matters and left shut when it does
 * not.
 *
 * What is not here is any of their heights. The order they stand in is the
 * page's, written below; how tall each of them is, is the survey's word, and
 * comes back with it.
 */

import { DEFAULT_ANGLE, DEFAULT_SUN, placeFrom, sunAt, type Sun } from '@plateau-ui/core'

/**
 * The tallest things PLATEAU has, each named by what the survey calls it and
 * the place that finds its tile.
 *
 * Two of the five are towers rather than buildings, and they are here because
 * the survey has them: 建築物 is what it published, and what it published at
 * 押上 and at 芝公園 stands in it beside the offices. Leaving them out would
 * have been the page ranking the data rather than reading it.
 *
 * The id is a gml:id, and it does not say which dataset to open: PLATEAU's
 * other id for a building carries the 市's code while the data is published
 * per 区 (27100-bldg-167320 is in 27119). So the coordinate is what opens the
 * tileset, and it is spent on that alone — where each of them is drawn is
 * decided further down this file.
 *
 * The names are the page's own because the survey mostly does not name
 * buildings: of these five only 東京スカイツリー and 横浜ランドマークタワー
 * carry a gml:name, and the other three carry none.
 *
 * Written in the order the row is read, tallest first: the first takes the
 * left-hand end. The order is the page's, set down from the heights the
 * survey gave (634.9, 332.1, 330.8, 328.4 and 305.0 metres when it was
 * written); the figures over the five are still read off what comes back.
 */
export const TALLEST = [
  {
    id: 'bldg_58ab8c46-8369-49c4-86cf-6912bbc4efe1',
    findAt: [139.81092, 35.71024],
    name: '東京スカイツリー',
  },
  {
    id: 'bldg_7aff4a51-be8b-405b-abe4-ac489697cbc8',
    findAt: [139.74547, 35.65858],
    name: '東京タワー',
  },
  {
    id: 'bldg_433bc5b3-db73-4644-ac24-a28d51b7ecd5',
    findAt: [139.74049, 35.66089],
    name: '麻布台ヒルズ 森JPタワー',
  },
  {
    id: 'bldg_17b833fb-2d29-4be0-89ca-235e3e248482',
    findAt: [135.51353, 34.64602],
    name: 'あべのハルカス',
  },
  {
    id: 'bldg_69a627f6-25ba-4713-9051-02756aad1fcc',
    findAt: [139.63147, 35.45459],
    name: '横浜ランドマークタワー',
  },
] as const

/** What the page calls a building, by the name PLATEAU knows it as. */
export function named(id: string): { name: string } | undefined {
  return TALLEST.find((building) => building.id === id)
}

/**
 * The paper the five are drawn on: the sheet under them, the wall stood at its
 * far edge, and the backdrop behind both, all the one colour, so neither the
 * sheet's edge nor the wall's top shows and what is past them reads as more
 * paper.
 *
 * Near the #eef1f6 this page was drawn on before the map was lit, and a few
 * steps under it, because the sheet takes the light and a lit face goes no
 * brighter than a reflectance of one: written #eef1f6, the sheet drew
 * 231,234,239 against a backdrop of 238,241,246 (measured), a line round the
 * sheet. This is what the sheet draws, so the backdrop and the wall, which
 * draw what they are given, are written in it.
 *
 * Read as a chart rather than as a map, so the colours are a chart's: one
 * paper, one ink, and one hue carried by the things being measured — the
 * towers' blue, below.
 */
export const PAPER = '#e7eaef'

/**
 * The towers themselves: the wall, the glass and the bars between the panes.
 *
 * Kept as three colours rather than as the library's options, since the wall
 * is said to the buildings and the other two to their windows: where each of
 * them goes is written in `main.ts`, with the rest of what the buildings are
 * told.
 */
export const TOWER = {
  wall: '#2c4a78',
  glass: '#1a2e4e',
  mullion: '#233c63',
} as const

// ── The row ───────────────────────────────────────────────

/**
 * Where the row is put up.
 *
 * Any place would do — the ground here is one plane and none of the five is
 * anywhere near where it was surveyed — so what this really fixes is the
 * latitude, which is
 * what a metre is worth on a Mercator map. 35° is the middle of the country
 * these buildings came from.
 */
export const SITE = [139.7529, 35.6852] as const

/**
 * How far apart they stand, in metres.
 *
 * Set by what stands over them rather than by the buildings: what each
 * carries is written at a size on the screen while the gap between two of them
 * is a size on the ground, so the gap has to be worth the longest name at the
 * zoom this page opens at. Three of the five stand within four metres of one
 * another, and their writing sits at the one height — so it is those three
 * that decide this number.
 */
export const APART = 450

/**
 * The sheet the row stands on, and the wall stood up along its far edge, in
 * metres: the wall is the sheet again, turned up on end.
 *
 * Wide enough to hold the row with room at both ends. The wall is as tall as
 * the sheet is deep, which is more than twice the tallest of the five, so
 * every top is read against it rather than against the sky.
 */
export const SHEET = { width: 2600, depth: 1400 } as const

/**
 * The grid ruled over the sheet and the wall: a line every hundred metres and
 * a stronger one every five hundred, a step and two steps off the paper, as
 * this page ruled them before. A finer ruling closes into hatching at this
 * size, and what is read off the wall is a height to the nearest hundred.
 */
export const GRID = { every: 100, section: 500, color: '#dde3ec', strong: '#c3ccd9', width: 1 } as const

/**
 * The sun, at the height this map's colours are written for (`DEFAULT_ANGLE`):
 * there a level face draws the colour it is given, so the sheet comes out as
 * light as a lit face goes. The library's own sun is a winter morning, lower,
 * and drew the sheet darker still. It stands where the library's own does, so
 * the shadows fall the way they always have on this page.
 */
export const SUN: Sun = {
  by: 'angle',
  azimuth: sunAt(DEFAULT_SUN.at, SITE).azimuth,
  elevation: DEFAULT_ANGLE.elevation,
}

/** How far over each roof its plate stands, in metres. */
export const OVER_ROOF = 20

/*
 * The fonts and the inks the writing over a building is set in used to stand
 * here. They are in `style.css` now, with the reasoning, because the plates
 * became the page's own markup: a colour said in two files is
 * one that drifts, and a reader who changed the one here would have watched
 * the page not move.
 */

/**
 * Where a place given in metres from the middle of the row falls, as
 * [longitude, latitude].
 *
 * The row is laid out in metres — the plates so far apart along the line —
 * and the map wants degrees.
 * Which length a degree is asked to be is the library's answer and not one
 * this file picks, so a metre here is the metre the buildings were placed by.
 */
export function fromSite(east: number, north: number): [number, number] {
  return placeFrom(SITE, east, north)
}
