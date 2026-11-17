/**
 * The sun over the house: the road it takes on each day, where it stands at a
 * moment, and the page turned with it as the controls move.
 *
 * On its own so that `main.ts` is the map and nothing else. What is here is
 * worked out from the library's own sun (`sunAt`) rather than drawn by hand,
 * and that working is what a reader of the map does not need to scroll past.
 */
import {
  Polyline,
  sunAt,
  type PolylinePoint,
  type Solid,
  type Sun,
  type SunAngle,
  type Viewer,
} from '@plateau-ui/core'
import {
  AT,
  FAINT,
  INK,
  LAST,
  START,
  START_SEASON,
  STEP,
  SUN_AWAY,
  from,
  momentOf,
  type Season,
} from './data.js'

/**
 * The road the sun takes on one day, drawn once and left there.
 *
 * A shadow says where the sun is now. The arc says where it has been and where
 * it is going, which is the other half of what a reader dragging the handle is
 * working out — and it is the thing that makes the ball read as a sun rather
 * than as a marker somebody is moving about.
 *
 * Only the lit part of it. Below the horizon the arc would be under the sheet
 * and hidden anyway, and a road that runs out of sight under the ground says
 * something true about the sun that this page is not about.
 *
 * Walked at the same five minutes the handle steps in, so every place the
 * handle can put the ball is a place the line goes through. Coarser and the
 * ball would sit off its own road at the hours in between.
 *
 * Its corners carry heights, which is the whole of what makes it a line
 * through the air: the third number on a corner is metres over the land there,
 * and a line with one of those is not cut to follow the ground between its
 * corners. Glowing, because it is a diagram and not a thing in the garden —
 * shaded, its far half would go grey for no reason a reader could name.
 *
 * Thin, as a line is drawn. It was the sun's own amber for a while, which made
 * the road look like something the sun had left behind it; it has not been
 * anywhere, it is simply where the sun goes. So it is drawn the way a drawing
 * rules a line, and not asking to be looked at.
 *
 * Faint to begin with, both of them, and one is inked below. A colour written
 * here as well as there would be the same choice made in two places, and the
 * first touch of either would show which of the two the page had not meant.
 *
 * `behind: 'hide'` rather than the default. A shape is faint through whatever
 * hides it because a city at a slant hides most of itself and a mark that
 * vanished would be no use; this is a line in the air with one thing in the
 * whole picture that can get in front of it, and a road seen through the roof
 * it passes behind is a road that is not behind it.
 */
export function road(season: Season): Polyline {
  return new Polyline({
    points: track(season),
    lineColor: FAINT,
    lineWidth: 1,
    glows: true,
    behind: 'hide',
  })
}

/**
 * The sun's place every five minutes of that day it is up, from one horizon to
 * the other.
 *
 * The step that crosses the horizon is walked down to the moment it crosses
 * on, because a five-minute step overshoots: the first sample of 冬至 comes
 * out at 06:55 with the sun half a degree up, which stands the end of the arc
 * twenty centimetres over the ring it is supposed to rise out of. Near enough
 * to be an accident and far enough to see.
 */
function track(season: Season): PolylinePoint[] {
  const points: PolylinePoint[] = []
  let before = sunAt(momentOf(season, 0), AT)
  for (let minutes = STEP; minutes <= LAST; minutes += STEP) {
    const now = sunAt(momentOf(season, minutes), AT)
    // Once on the way up and once on the way down, and the order comes out
    // right either way: at sunrise the crossing is pushed before the first lit
    // step, at sunset after the last one, since the step it is found on is
    // dark and adds nothing of its own. `down` rather than a height compared
    // with nought here, so that the road ends where the library says the sun
    // has set and not where this page would have said it
    if (before.down !== now.down) points.push(mark(crossing(season, minutes - STEP, minutes)))
    if (!now.down) points.push(mark(now))
    before = now
  }
  return points
}

/** Where the sun stands at that angle, as a corner of a line through the air. */
function mark(angle: SunAngle): PolylinePoint {
  const { at, up } = placeOf(angle)
  return [at[0], at[1], up]
}

/**
 * The sun as it stands at the horizon, somewhere between these two minutes.
 *
 * Halved twelve times, which brings a five-minute step down to under a second
 * — the sun is then a thousandth of a degree up and the arc meets the ring
 * inside a hundredth of a millimetre. Kept on the lit side of the crossing, so
 * what comes back is a sun that is up rather than one that has just gone.
 */
function crossing(season: Season, a: number, b: number): SunAngle {
  let lit = sunAt(momentOf(season, a), AT).down ? b : a
  let dark = lit === a ? b : a
  for (let halving = 0; halving < 12; halving++) {
    const between = (lit + dark) / 2
    if (sunAt(momentOf(season, between), AT).down) dark = between
    else lit = between
  }
  return sunAt(momentOf(season, lit), AT)
}

/**
 * The light of a moment over this house.
 *
 * A moment and not an angle. An angle is picked for how a map reads and is
 * nobody's afternoon; what this page asks is what actually falls on this plot
 * at ten in the morning, and the answer is the sky's — so the viewer is handed
 * the date and works out the rest. Below the horizon it works out that there
 * is no light, and the house stands flat with nothing behind it, which is what
 * the small hours of the slider look like and what they should look like.
 *
 * Pinned over the house with `over`. Left out, a dated sun is worked out over
 * the middle of the view and moves with it — right for a page that flies from
 * 東京 to 福岡, wrong here, where a reader who drags the map a street over
 * should still be looking at this house's ten o'clock.
 *
 * In one place because it is said twice: once to light the viewer, once every
 * time the handle moves. A light set two ways drifts the first time one of
 * them is touched.
 */
export function lit(at: Date): Sun {
  return { by: 'time', at, over: AT }
}

/**
 * Where the sun stands, for a given angle of it.
 *
 * Azimuth is degrees clockwise from north and elevation is degrees up from the
 * horizon, so the place is those two read as a direction and walked along for
 * `SUN_AWAY` metres: the flat part of that walk lays it out over the plot, and
 * what is left of it is how high it goes.
 *
 * Below the horizon the height comes out negative and the place is under the
 * sheet. Nothing hides what is put there — the sheet is a solid and writes
 * depth like any other, so the sun sets by going behind the ground, which is
 * what setting is.
 */
function placeOf(angle: SunAngle): { at: readonly [number, number]; up: number } {
  const up = (angle.elevation * Math.PI) / 180
  const round = (angle.azimuth * Math.PI) / 180
  const away = SUN_AWAY * Math.cos(up)
  return { at: from(away * Math.sin(round), away * Math.cos(round)), up: SUN_AWAY * Math.sin(up) }
}

/** Stands the ball where the light is coming from. */
function standSun(sun: Solid, angle: SunAngle): void {
  const { at, up } = placeOf(angle)
  sun.at = at
  sun.height = up
}

/**
 * Follows the controls: hands back what puts the day and the moment the
 * controls are set to on the page, and the page turned over with them once the
 * sun is down.
 *
 * One run for both, because the two are one question. A day without an hour
 * has no sun on it and an hour without a day has no sky to put it in, so what
 * comes over is the pair, and everything below is settled from it at once: the
 * light, the ball, the inked road, and whether it is night.
 *
 * Something has to happen at night, because what the light does then is
 * nothing: below the horizon there is no sun to shade with, and a white house
 * on a white sheet with no shadow under it is a white rectangle. **The map
 * turns itself over** — the walls, the shade's own dark — because the hour is
 * the sun's and the colours follow it. Nothing here asks for that; handing the
 * viewer the moment is the whole of it.
 *
 * What the page drew on the map itself — the inks and the sheet — turns over
 * too, and nothing here does it either. Every one of them was handed a pair,
 * and the library draws the night half of a pair on the same word it turns
 * the palette on, so what this page drew and the map itself cannot come apart
 * about whether the sun is up. **The page writes no threshold of its own and
 * asks no question about the hour.** It used to: it asked `sunAt(...).down`
 * on every move and swapped each colour in by hand, which was the library's
 * answer worked out a second time.
 *
 * The card does not turn with them. Night is what the map is showing, not a
 * mode the page is in — the panel is what a reader reads *about* the map, and
 * a panel that dresses up with it is one more thing moving in a picture whose
 * whole subject is one thing moving. It was turned over for a while, and the
 * page read as having two skins rather than as one drawing with a sun over
 * it.
 */
export function follow(
  viewer: Viewer,
  sun: Solid,
  arcs: ReadonlyMap<Season, Polyline>,
): (season: Season, at: Date) => void {
  /** Which day's road is inked now, so that inking it again costs nothing. */
  let watched: Season | null = null

  /**
   * Inks the day being watched and leaves the other faint.
   *
   * Which day and nothing else. Whether it is night is not asked here: each ink
   * is a pair, and the library draws whichever half the sun says, for these two
   * and for the ring and the sheet alike.
   *
   * Guarded, because a colour set on a shape is a shape cut again — a ribbon
   * bakes its colour into its corners — and the handle hands the day over on
   * every step of a drag, which would be three hundred corners re-cut for a
   * choice that did not change. The same guard the viewer puts on a view set to
   * where it already is.
   *
   * The ring is never faint and is not touched here. It is not a day's road —
   * it is the ground both roads stand on — and two drawings of the same circle
   * should not disagree about what a line looks like.
   */
  function watch(season: Season): void {
    if (season === watched) return
    watched = season
    for (const [day, arc] of arcs) arc.lineColor = day === season ? INK : FAINT
  }

  // Inked for the day the viewer has just been given, and the ball stood where
  // that light comes from; which half of each ink stands is the sun's, as it
  // is at every move of the handle
  watch(START_SEASON)
  standSun(sun, sunAt(momentOf(START_SEASON, START), AT))

  return (season, at) => {
    viewer.sun = lit(at)
    watch(season)
    standSun(sun, sunAt(at, AT))
  }
}
