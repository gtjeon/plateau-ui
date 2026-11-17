import { Vector3 } from 'three/webgpu'

/**
 * Where the sun stands at a moment, over a place.
 *
 * Arithmetic and nothing else: no clock of its own, no network, no state. A
 * page hands over an instant and a place and is given back the two numbers
 * {@link SunAngle} is made of — the same pair it would have written by hand —
 * and a third field it would not have written: `down`, which keeps the
 * threshold the palette turns over on in one place rather than in every page
 * that asks the map's own question (see {@link SunAngle.down}). That is the
 * whole of what this file is for — the light is still set in one place, and
 * this only says what to set it to.
 *
 * The same terms SunCalc works in, which are Meeus's: the sun's place among
 * the stars from a handful of periodic terms, then turned into what an
 * observer on the ground sees. Good to a hundredth of a degree over the years
 * a map is looked at, which is far finer than a shadow on a screen can show.
 *
 * What it is **not** is a legal shadow study. 日影規制 is reckoned in 真太陽時
 * — true solar time, where noon is when the sun actually crosses the meridian
 * — and the several minutes between that and the clock matter when the answer
 * is whether a building may be built. This answers the clock.
 */
const RAD = Math.PI / 180
const DAY_MS = 86400000
/** Julian day of the Unix epoch, and of J2000.0, which every term below counts from. */
const J1970 = 2440588
const J2000 = 2451545
/** How far the Earth's axis leans out of its orbit, in radians. */
const OBLIQUITY = 23.4397 * RAD

/**
 * Where the sun is at that moment, seen from that place.
 *
 * `when` is an instant, so the zone is the caller's to say and not this
 * library's: `new Date('2026-12-22T10:00+09:00')` is ten in the morning in
 * Japan wherever the reader's browser happens to be, and `new Date('2026-12-22
 * 10:00')` is ten in the morning wherever *they* are, which for a map of 鎌倉
 * is a different sun. Every mapping library that owns a clock warns about
 * this; this one has no clock to warn about, only the instant handed in.
 *
 * `over` is [longitude, latitude]. It matters: at one instant the sun stands a
 * few degrees apart over 東京 and over 福岡.
 *
 * The elevation comes back negative where the sun is below the horizon, which
 * is most of the day counted over a year. It is not clamped — a page asking
 * for midnight is owed the answer that there is no sun, not a sun lying on the
 * horizon.
 */
export function sunAt(when: Date, over: readonly [number, number]): SunAngle {
  const days = when.valueOf() / DAY_MS - 0.5 + J1970 - J2000

  // Where the sun lies along the ecliptic: how far round its orbit the Earth
  // is, corrected for the orbit being an ellipse rather than a circle, and
  // turned from the Earth's view to the sun's by half a turn
  const anomaly = (357.5291 + 0.98560028 * days) * RAD
  const ellipse =
    (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly)) * RAD
  const longitude = anomaly + ellipse + 102.9372 * RAD + Math.PI

  // That place, said the way the sky is measured: how far north of the equator
  // and how far round it
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(longitude))
  const ascension = Math.atan2(Math.sin(longitude) * Math.cos(OBLIQUITY), Math.cos(longitude))

  // And the same, said from where the reader stands. The hour angle is how far
  // the place has turned past the sun since it last faced it
  const phi = over[1] * RAD
  const hour = (280.16 + 360.9856235 * days) * RAD + over[0] * RAD - ascension
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hour),
  )
  // This comes out counted from due south, which is where the sun is at noon
  // in Japan and so where the arithmetic is simplest. Half a turn puts it on
  // the compass, which is what a page reads and writes
  const fromSouth = Math.atan2(
    Math.sin(hour),
    Math.cos(hour) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
  )

  const up = elevation / RAD
  return {
    azimuth: (((fromSouth / RAD + 180) % 360) + 360) % 360,
    elevation: up,
    down: isDown(up),
  }
}

/**
 * Where a light stands: the two numbers everything downstream works in, and
 * the one question asked of them often enough to be answered here.
 *
 * Whether they were chosen by a page or worked out from a moment, what the
 * lights and the shadows are given is this and only this.
 */
export interface SunAngle {
  /** Which way it comes from, in degrees clockwise from north. */
  readonly azimuth: number
  /** How high above the horizon, in degrees. 90 is straight overhead. */
  readonly elevation: number
  /**
   * Whether it is below the horizon, which is {@link elevation} at or below
   * nought.
   *
   * Said here rather than left to whoever reads the angle, because it is the
   * one place in this library where that threshold means something: the
   * palette turns over on it ({@link Viewer.colors}), and a page whose own
   * markup turns with the map has to ask the same question the map asked. One
   * comparison written twice is two answers the day one of them is written
   * `<` instead of `<=`.
   *
   * `down` and not `isNight`, because "the sun is down" is the English for
   * this and an adjective needs nothing in front of it — three names its own
   * states the same way (`visible`, `transparent`) and keeps `is` for what
   * kind of thing something is (`isMesh`). Not `dark` either: in this library
   * that word means the dark palette.
   *
   * There is no twilight in it. Below the horizon there is no sun to shade
   * with, and that is the whole of what this is for.
   */
  readonly down: boolean
}

/**
 * The light on the scene, said one of two ways.
 *
 * They are not two settings. There is one light and one place to set it
 * ({@link Viewer.sun}); `by` says which of the two things a page is handing
 * over, the way {@link MaskShape}'s `shape` says which shape. Every library that
 * offers a real sun keeps both and names them — Cesium's `SunLight` beside its
 * `DirectionalLight`, ArcGIS's `SunLighting` beside its `VirtualLighting` —
 * because neither stands in for the other: drop the angle and a page cannot
 * pick a light the scene reads well under, drop the moment and it cannot ask
 * what the sun does here at ten in the morning.
 *
 * `shading` belongs to both and is the page's either way. The sun says where
 * it comes from; how hard the picture leans on it is a matter of taste and of
 * the palette under it.
 *
 * What it does not say is the colour of the light a face it has left is lit
 * by. That is `Palette.shadow`, and the theme is the one way in
 * (`ViewerOptions.theme`): the sun and the theme both reach the whole map, so
 * a colour said on both would need an order between them that a page has to
 * be told. It was here as `shadowColor` for part of 2026-10-27, as the hue
 * half of a light whose strength is `shading`, and came off for that reason.
 *
 * Handed over whole and read back as a frozen copy (`viewer.sun`), like a
 * theme. It has two shapes, so there is no part of it to change on its own —
 * three's `scene.fog` is the same, replaced or set to null. Frozen to the
 * bottom: the moment read back throws on `setHours` and the rest, so a later
 * hour is a new `Date` handed over, `viewer.sun = { ...viewer.sun, at: new
 * Date(…) }`.
 */
export type Sun =
  | {
      /** An angle the page picked. */
      readonly by: 'angle'
      /** Which way it comes from, in degrees clockwise from north. */
      readonly azimuth: number
      /** How high above the horizon, in degrees. 90 is straight overhead. */
      readonly elevation: number
      /**
       * How much of the light the sun carries rather than the sky, 0 to 1.
       *
       * One by default. At nought there is no sun at all and the sky lights
       * everything on its own, which is an overcast day: a face keeps very
       * nearly its own colour whichever way it points. See `lights.ts` for
       * what the two ends are and why they are where they are.
       */
      readonly shading?: number
      /**
       * How bright the sun itself is, where one is the light the palette was
       * drawn for. One by default.
       *
       * The sky is not touched, so this moves the faces the sun reaches and
       * leaves the ones it has left where they were — which is the knob for a
       * roof that glares rather than for a map that is too bright. Under one a
       * surface lying flat in full daylight draws darker than the colour the
       * palette gave it, and that is the whole of what it costs: the palette's
       * colours are reflectances, and this is how much light there is to
       * reflect.
       */
      readonly brightness?: number
    }
  | {
      /** The sun as it really stands at a moment. */
      readonly by: 'time'
      /**
       * The moment. An instant, so the zone is written here and not guessed:
       * `new Date('2026-12-22T10:00+09:00')` is ten in the morning in Japan
       * whatever zone the reader's browser is in.
       */
      readonly at: Date
      /**
       * Which place the sun is worked out for, as [longitude, latitude]. The
       * view's own centre by default, and then it follows the view — which is
       * what a map wants and what a site study does not. A page measuring one
       * plot pins it here, so panning the map does not move the sun.
       */
      readonly over?: readonly [number, number]
      /**
       * How much of the light the sun carries rather than the sky, 0 to 1.
       * One by default; see `lights.ts`.
       */
      readonly shading?: number
      /**
       * How bright the sun itself is, where one is the light the palette was
       * drawn for. One by default.
       *
       * The sky is not touched, so this moves the faces the sun reaches and
       * leaves the ones it has left where they were — which is the knob for a
       * roof that glares rather than for a map that is too bright. Under one a
       * surface lying flat in full daylight draws darker than the colour the
       * palette gave it, and that is the whole of what it costs: the palette's
       * colours are reflectances, and this is how much light there is to
       * reflect.
       */
      readonly brightness?: number
    }

/**
 * From the south-east, well up — and an angle rather than a moment.
 *
 * The default is a light picked for how the map reads, not a sun: it stands
 * where the sun would never stand on some of the days a reader might have in
 * mind, and it does not move as the hours do. A page that wants the real one
 * says so with `by: 'time'`.
 *
 * Relief maps have been lit from the upper left for a century, but that holds
 * a picture still: their north never moves. Here the heading swings, so no one
 * azimuth stays at the upper left, and the angle is picked for how the light
 * falls on the city rather than for where it lands on screen. Off the
 * cardinals, so the two walls meeting at a corner catch it differently and the
 * corner reads.
 *
 * The height is not the 45° those maps use, and that half of the reasoning has
 * survived the move onto three's own lighting unchanged: a wall facing the
 * light square on scores cos(elevation) where level ground scores
 * sin(elevation) — Lambert now, a folded Lambert before — so at 45° the two
 * are equal and a roof cannot be told from the wall it meets. Above 45° roofs
 * are the brightest thing on screen, which is what gives a city seen from
 * above its shape.
 *
 * What has gone is the other half. The shading was wound to the top because
 * the shade was a light grey multiplied over everything, and without most of
 * the range a lit wall and one turned away both landed on the same white.
 * There is no such colour any more: what a face turned from the sun is left
 * with is the sky, and how much of it there is is the one thing `shading`
 * now says.
 */
export const DEFAULT_ANGLE: SunAngle = { azimuth: 132, elevation: 52, down: isDown(52) }

/**
 * The light once it has been worked out: what the lights and the shadows read,
 * and all they read.
 *
 * @internal The viewer settles which of {@link Sun}'s two forms it was given
 * and hands this over; nothing downstream knows there were two.
 */
export interface Lit {
  readonly angle: SunAngle
  /**
   * How much of the light the sun carries, already between 0 and 1.
   *
   * Brought inside the range here rather than by each reader, so that a value
   * one of them held to and another did not could not put the two ends of the
   * light in two places.
   */
  readonly shading: number
  /** How bright the sun is, already held to a range; see {@link Sun}. */
  readonly brightness: number
}

/**
 * Where the sun stands, whichever of the two ways it was given.
 *
 * `over` is where the viewer is looking, used only where the sun is dated and
 * has not been pinned to a place of its own — so a page asking of the viewer's
 * own sun passes `viewer.camera.center` and gets the answer the map is drawn by.
 *
 * Out here beside {@link sunAt} because a page holding a {@link Sun} should
 * not have to know which of its two shapes it has to find out whether the sun
 * is up. Without it the one thing a page actually wants — `down` — has to be
 * written again for the `'angle'` case, which is the threshold in a second
 * place, which is the thing {@link SunAngle.down} was opened to prevent.
 */
export function angleOfSun(sun: Sun, over: readonly [number, number]): SunAngle {
  if (sun.by === 'angle') {
    return { azimuth: sun.azimuth, elevation: sun.elevation, down: isDown(sun.elevation) }
  }
  return sunAt(sun.at, sun.over ?? over)
}

/**
 * Whether a height counts as under the horizon.
 *
 * One line, and it is here so that it is one line. What hangs on it is the
 * palette, the fill and whether the sun's map is drawn at all, and those three
 * parting company is a map drawn half in one hour and half in the other — it
 * happened: a guard of `sin(elevation) > 1e-3` in `lights.ts` put the sun's
 * own horizon 0.057° above this one, and in that sliver the page was lit for
 * day by a sun of nought.
 *
 * At nought exactly it is down. A sun on the horizon lights nothing that is
 * not already lit by the sky.
 */
function isDown(elevation: number): boolean {
  return elevation <= 0
}

/**
 * A copy to keep, so that what a page hands over and what it reads back are
 * not the object the viewer is working from.
 *
 * The `Date` and the place are copied too. They are the two fields here that
 * can be changed from underneath without reassigning anything — a moment
 * wound forward, a longitude written into the pair — and a page that kept its
 * own reference and did either would move the sun with nobody told. The place
 * was shared until 2026-10-27, so `viewer.sun.over[0] = …` wrote straight into
 * the sun the viewer was lighting by.
 */
export function heldSun(sun: Sun): Sun {
  if (sun.by !== 'time') return { ...sun }
  const { over } = sun
  return { ...sun, at: new Date(sun.at), ...(over ? { over: [over[0], over[1]] as const } : {}) }
}

/**
 * The copy `viewer.sun` hands out: {@link heldSun}, frozen all the way down.
 *
 * `Object.freeze` is one level deep, and a freeze that leaves what is inside
 * open promises what it does not keep — contract 12's rule 3 is that a write
 * on the copy throws rather than vanishing. The place is an array and freezes.
 * The moment does not: a `Date` keeps its time in an internal slot and not in
 * a property, so `setHours` on a frozen one goes through, on a copy nobody
 * reads, which is the vanishing write itself. So the copy carries setters of
 * its own, and they throw.
 */
export function frozenSun(sun: Sun): Sun {
  const held = heldSun(sun)
  if (held.by !== 'time') return Object.freeze(held)
  const { over } = held
  return Object.freeze({ ...held, at: shut(held.at), ...(over ? { over: Object.freeze(over) } : {}) })
}

/**
 * Every method a `Date` changes itself through. `setYear` is the old one that
 * browsers still carry beside the rest, and is shut for the same reason.
 */
const SETTERS = [
  'setTime',
  'setMilliseconds',
  'setSeconds',
  'setMinutes',
  'setHours',
  'setDate',
  'setMonth',
  'setFullYear',
  'setUTCMilliseconds',
  'setUTCSeconds',
  'setUTCMinutes',
  'setUTCHours',
  'setUTCDate',
  'setUTCMonth',
  'setUTCFullYear',
  'setYear',
] as const

/**
 * Shuts a moment no one else holds against being changed, and freezes it.
 *
 * Its own properties stand in front of `Date.prototype`'s, so a page calling
 * one of them is told rather than ignored. Not enumerable, so nothing walking
 * its keys finds them, and every reading method is left as it was.
 */
function shut(moment: Date): Date {
  const refuse = (): never => {
    throw new TypeError(
      '[plateau-ui] viewer.sun is a frozen copy; hand over another: viewer.sun = { ...viewer.sun, at: new Date(…) }',
    )
  }
  for (const name of SETTERS) Object.defineProperty(moment, name, { value: refuse })
  return Object.freeze(moment)
}

/** The world direction the light comes from. */
export function directionOfSun(sun: SunAngle): Vector3 {
  const azimuth = (sun.azimuth * Math.PI) / 180
  const elevation = (sun.elevation * Math.PI) / 180
  const flat = Math.cos(elevation)
  // World x runs east and z runs south, so north is -z
  return new Vector3(flat * Math.sin(azimuth), Math.sin(elevation), -flat * Math.cos(azimuth))
}

const DEFAULT_SUN_WRITTEN = {
  by: 'time',
  at: new Date('2026-12-22T10:00+09:00'),
  // Both at one, and that is new (2026-10-08). The brightness spent the day at
  // 0.53, then 1.5, then 0.8, because it was the only handle on a complaint it
  // could not answer: at ten on the solstice the sun stands 26° up, and a sun
  // that low meets a wall nearly square while it only grazes the roof and the
  // street, so the facades were the brightest thing on screen — the one
  // arrangement a map seen from above cannot use. Turning it down took the
  // roofs with it, and the roofs are most of what such a map shows.
  //
  // What answered it was the hour, not the light: `lights.ts` no longer drives
  // the sun harder the lower it stands. So one means one again — the light this
  // map was drawn for, at the height `DEFAULT_ANGLE` names — and this hour
  // comes out dimmer than that on its own, which is what a winter morning is.
  //
  // The shading is where the type's own default is, which it was not either (it
  // was 0.7). All of the light to the sun puts the fill at its floor, and that
  // is what parts a face the sun has left from one it reaches.
  shading: 1,
  brightness: 1,
} satisfies Sun

/**
 * Ten in the morning, in Japan, at the solstice — and a moment rather than an
 * angle.
 *
 * {@link DEFAULT_ANGLE} above is still the light this map was drawn for, and
 * still what everything falls back to where there is no sun at all. What it is
 * no longer is the default. Now that the scene is lit by three's own sun there
 * is a real one to be had for nothing, and a city under the sun that was
 * actually there reads as a city rather than as a diagram.
 *
 * The hour is ten because that is where a low sun rakes across a street rather
 * than down it: the shadows are long enough to say which way a building faces
 * and short enough to leave the street readable. The day is the winter
 * solstice because it is the worst case — the sun at its lowest all year, the
 * longest shadows the city ever throws — and a map that reads then reads on
 * every other day. Both are a starting place and neither is a measurement; a
 * page that cares says so.
 *
 * A fixed moment and not `now`. A default worked out from the clock would make
 * a page's first frame depend on when it was opened, which nobody can
 * reproduce and which is the one thing a default must not be.
 *
 * Worked out for the view's own centre, since `over` is left out — so a viewer
 * taken somewhere it is night at ten in the morning in Japan has no light at
 * all and every face keeps its colour. That is the honest answer for a dated
 * sun, and it is why a page showing somewhere else says `over` or goes back to
 * the angle.
 */
export const DEFAULT_SUN = frozenSun(DEFAULT_SUN_WRITTEN) as Readonly<typeof DEFAULT_SUN_WRITTEN>
