/**
 * The house this page is about, the two days the light is watched on, and the
 * ground it is allowed to stand on.
 *
 * One house, one place, two days and a handful of numbers is the whole of what
 * the page has to say for itself, and it sits apart so that `main.ts` is the
 * map and nothing else. The library is asked one thing here — how far a metre
 * runs in degrees — because that is an answer about the map rather than about
 * the house.
 */

import { placeFrom } from '@plateau-ui/core'

/**
 * One house at 七里ヶ浜 in 鎌倉: two storeys, a gable, seven metres.
 *
 * Named rather than picked off the ground, because what the page wants is
 * this house and not whatever stands on this plot. A circle drawn round it
 * would take the neighbour's corner with it — they stand twelve metres
 * apart — and a rule reading the survey's own words would take every 住宅 in
 * 鎌倉.
 *
 * Why this one of the several hundred thousand PLATEAU holds: it has a roof
 * with two slopes and nothing else on it. Most of what the survey carries is
 * flat on top, and a flat top throws the same rectangle whatever the light
 * does; a ridge throws a shape that bends where the roof bends, which is the
 * only reason to look at a shadow at all. It is also small, square-ish and
 * alone enough on its plot to be looked at whole — 8.8m by 7.3m, two storeys,
 * 6.99m to the ridge, all of it the survey's own.
 */
export const HOUSE = 'bldg_49e8e07b-9968-4ff0-9181-6a80c6cf21da'

/** Where it stands, as [longitude, latitude]. */
export const AT = [139.522336, 35.304847] as const

/**
 * One of the days the light is watched on: the word for it, and the midnight
 * it starts at.
 *
 * The word is written down and the date is not. What day of the calendar a
 * 冬至 falls on is arithmetic and is asked for off the midnight below — see
 * `ui.ts`; that the day is *called* 冬至 is the one thing about it that no
 * date can be asked for, so it is the one thing carried.
 *
 * A day and not an angle, all the way down. What the page draws is where the
 * sun actually goes over this plot on this date, which is the sky's answer and
 * not a number anybody here picked.
 */
export type Season = {
  readonly called: string
  readonly midnight: number
}

/**
 * A day, from its name and its date.
 *
 * Midnight is pinned to +09:00 and not to wherever the reader is: the hour on
 * the slider is the hour at the house.
 */
function season(called: string, when: string): Season {
  return { called, midnight: Date.parse(`${when}T00:00:00+09:00`) }
}

/**
 * 夏至, the longest day — the sun at its highest. It stands 78° up at noon
 * here and the shadow is a collar round the walls.
 */
const SUMMER = season('夏至', '2025-06-21')

/**
 * 冬至, the shortest day — the sun at its lowest, and the one the country
 * watches.
 *
 * Taken from the rule rather than picked. 日影規制 — what a building is
 * allowed to drop on its neighbours — is measured on 冬至日 and on no other,
 * so a page about one house's shadow watches the day the rule watches.
 *
 * It is also the day with the most on it to see. The sun reaches 31° at noon
 * and this roof lays eleven metres across the ground, running out to
 * twenty-seven by three in the afternoon.
 */
const WINTER = season('冬至', '2025-12-22')

/**
 * Both of them, in the order they stand in the picture: the high road first.
 *
 * The two solstices and nothing between them, because they are the two ends of
 * what the light does over a year and everything else is somewhere in the
 * middle of them. 春分 and 秋分 are a third line a diagram like this would
 * usually carry, and they are one line and not two — the sun is on the equator
 * on both, so the two days share a road.
 *
 * The same year for both: two solstices of one year are the two ends of one
 * year, and two of different years are two dates somebody happened to write
 * down.
 */
export const SEASONS: readonly Season[] = [SUMMER, WINTER]

/**
 * The one the page opens on: 冬至, the day the rule is written about and the
 * day the shadow has a shape. Opening on 夏至 would open on a collar of dark
 * round the walls and say nothing until the reader found the other day.
 */
export const START_SEASON = WINTER

/**
 * How far the slider runs, in minutes from midnight — the whole day, and the
 * far end is 24:00 rather than the next day's 00:00. It is the same instant
 * either way; the one a reader dragging to the end of a day expects to read
 * is the one that says the day ended.
 *
 * The whole day on both, and so the same run on both, which is what makes the
 * two comparable: moving between the days leaves the handle where it is, and
 * ten in the morning in June is read against ten in the morning in December.
 * Cut to the hours the sun is up it would be a different length on each day
 * and the same handle would mean a different hour on each.
 */
export const LAST = 24 * 60

/**
 * How fine it is, in minutes. Dragged, anything under about six is already
 * smooth — the whole day is a few hundred pixels — so this is really the size
 * of an arrow-key press, and five minutes of a winter sun is a shadow that
 * visibly moved.
 */
export const STEP = 5

/**
 * Where it starts: ten in the morning.
 *
 * Not noon. At noon the sun is nearly behind the house from where the camera
 * stands and the shadow is at its shortest, which is the one hour of the day
 * that shows least — and it is the hour the two days have least to say against
 * each other, both of them being due south at once.
 *
 * At ten the winter sun is 26.6° up in the south-south-east and lays fourteen
 * metres of roof out to the north-west with both slopes of the gable in it;
 * the summer sun of the same hour is 64.6° up and lays 3.3m. One handle, one
 * hour, and the two days answer it nine-tenths differently.
 */
export const START = 10 * 60

/**
 * The moment the slider is pointing at, on one of the days.
 *
 * Minutes in, a `Date` out, which is the whole of what the library wants —
 * where the sun then stands is its arithmetic and not this page's. The day is
 * handed in rather than read off a constant, because there are two of them now
 * and every question this page asks is asked of one of them.
 */
export function momentOf(season: Season, minutes: number): Date {
  return new Date(season.midnight + minutes * 60000)
}

/**
 * How far from the house the sun is stood, in metres.
 *
 * A diagram and not a distance. The sun is a hundred and fifty million
 * kilometres off and no page draws that; what is drawn is the one thing about
 * it this page is asking — which way it lies and how high it is — put where
 * the eye can hold it and the house in the same look.
 *
 * Twenty-two, which keeps the whole of both days' arcs on the sheet the shadow
 * is falling on: the ball comes up out of the ground at one side, goes over
 * the roof and sets at the other. Further out and it is off the edge of the
 * window at the very hours the sun is lowest — which are the hours the shadow
 * is longest and most worth watching.
 *
 * One distance for both days, which is what makes them one picture rather than
 * two drawings at different scales. The arcs are then the same circle leaning
 * two different ways, and how far apart they lean is the thing being looked
 * at.
 *
 * Close enough that it reads as a diagram and is meant to. Nobody will take a
 * ball hanging twenty metres over a garden for the sun being there; what it is
 * saying is which way, and how high.
 */
export const SUN_AWAY = 22

/**
 * How big it is drawn, as a radius in metres.
 *
 * Three metres across. Smaller and it is a point — right for something that
 * only says which way, and wrong for the one thing on the page that is meant
 * to read as the sun. It is still a fifth of the house it goes over, which is
 * far enough off scale that nobody will look for it on the ground.
 */
export const SUN_SIZE = 1.6

/** How many corners the circle is drawn through. Enough that it reads as a circle at this zoom. */
const CORNERS = 128

/**
 * The circle both arcs stand on, as the corners a line is drawn through.
 *
 * The same radius the ball goes round at, so what is drawn is where that
 * circle meets the ground — the arcs' own footing, and the line the sun comes
 * up out of and goes back down into on whichever day it is on. One ring for
 * both, because there is one ground.
 *
 * Worked out rather than written out. A circle is two numbers and a formula,
 * and a hundred and twenty-eight pairs of coordinates sitting in this file
 * would read as a shape somebody went and surveyed — the one surveyed thing on
 * this page is the house.
 */
export function ring(): readonly (readonly [number, number])[] {
  const corners: (readonly [number, number])[] = []
  for (let corner = 0; corner <= CORNERS; corner++) {
    const round = (corner / CORNERS) * Math.PI * 2
    corners.push(from(SUN_AWAY * Math.sin(round), SUN_AWAY * Math.cos(round)))
  }
  return corners
}

/**
 * A place so many metres east and north of the house, as [longitude, latitude].
 *
 * Here rather than in `main.ts` because where the sun is stood is worked out
 * from an angle and a distance, and this is the last step of that: the ring
 * the sun is carried round on is written in metres, and the map wants degrees.
 *
 * How long a degree is at this latitude is the library's answer and not one
 * this file picks, so the ring stands where the house stands.
 */
export function from(east: number, north: number): readonly [number, number] {
  return placeFrom(AT, east, north)
}

/**
 * The sheet everything here is stood on.
 *
 * White, which is where this page's picture starts: the one the viewer draws
 * past the map is white as well, so the two meet with no line between them.
 * Written here because a solid told no colour wears the map's own ground
 * instead, and that is a shade of the sky rather than a sheet of paper.
 */
export const PAPER = '#ffffff'

/**
 * The two weights a road is drawn in: the day being watched, and the day
 * standing beside it.
 *
 * Ink and not colour. The one coloured thing on this page is the sun, and a
 * page that marked the chosen day in a hue would have two things asking to be
 * looked at and neither of them the shadow. So the choice is said the way a
 * drawing says it — one line ruled and one line faint.
 *
 * The faint one is still drawn, which is the whole point of there being two.
 * Hidden, the switch would be a picture redrawn and a reader would be holding
 * the other day in their head; drawn, the two roads are one picture and how
 * far apart they lean is simply there to be seen.
 *
 * Each in two halves, a day one and a night one, because the sheet they are
 * drawn on turns over at nightfall and black on a dark sheet is not ink. With
 * one colour each it came out backwards: the faint grey was the brightest line
 * on the screen after sunset and the chosen road was the one that had all but
 * gone, which is the opposite of what the page was saying it meant. Measured,
 * by switching days at eight in the evening and watching the bright line
 * follow the day that was *not* chosen.
 *
 * The night halves are the day halves turned over and nothing more: a light
 * that carries on a dark sheet, and a grey far enough below it to read as the
 * road not chosen. Each is a pair the library holds, so which half is drawn is
 * the sun's to say, at the same moment it says it of the sheet and of the map.
 * The card keeps its one set either way — night is the map's, and the page
 * outside it does not play along.
 */
export const INK = { light: '#000000', dark: '#e8eaee' }
export const FAINT = { light: '#b0b0b0', dark: '#767e8b' }
