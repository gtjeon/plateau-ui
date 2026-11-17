/**
 * Where the camera hangs when the page opens, what it is like, and how much
 * it takes in.
 *
 * Nothing here calls the library. A page like this one is mostly one place and
 * a handful of sizes, and looking for how the map is made means scrolling past
 * all of that first.
 */

/**
 * 新宿三丁目 by the north edge of 新宿御苑, the whole of the square at once:
 * looked at corner on, so it lies as a diamond in the middle of the
 * screen, and tilted as far over as the map goes. The camera is on the wall at
 * the back, and what it sees runs down the street towards the reader.
 */
export const VIEW = {
  // The ground it opens on, however wide the screen; `main.ts` fits it
  bounds: { southWest: [139.704386, 35.687603], northEast: [139.707014, 35.689737] } as const,
  pitch: 70,
  heading: 45,
}

/** The middle of that ground, which the square is drawn round. */
export const MIDDLE = [139.7057, 35.68867] as const

/**
 * How far across the square the city is drawn in, in metres, round the middle
 * of the screen: the camera's reach in front of it and its own block behind,
 * and no more, so that what it sees is a good part of what is drawn. The middle
 * is 40 m out in front of the camera rather than on it, since it sees one way.
 */
export const SQUARE = 260

/**
 * Where the camera is: 15 m up the south wall of a block by 新宿三丁目, looking
 * out over the street in front of it towards 新宿御苑, said the way a click
 * hands it back — which is how it was got, by clicking that wall. It stays
 * there.
 */
export const START = {
  at: { lng: 139.70565, lat: 35.689029, height: 14.9 },
  facing: 173.1,
}

/**
 * How much the camera takes in, in degrees across: the one lens it has, and no
 * way to turn it.
 *
 * Left level, since that is all a sight's height can say — it reaches as far
 * above flat as below. So the housing is drawn level too, rather than tipped
 * down at a street it does not see any more of for being tipped.
 */
export const FOV = { horizontal: 90, vertical: 90 }

/** How far it sees, in metres. */
export const RANGE = 120

/**
 * The camera's sizes, in metres. Out of the wall is its own +Z, which is the
 * way `facing` turns it; up is +Y.
 *
 * Far bigger than a real one. A real housing is a third of a metre long, which
 * with the whole square on the screen is under a pixel — the camera would not
 * be there at all. This is a size chosen to be read, not a real one.
 */
export const CAMERA = {
  /** The plate on the wall, across and up. */
  plate: { width: 2.5, tall: 3.2, thick: 0.3 },
  /** The arm out from the plate, and how far over the housing's top it runs. */
  arm: { thick: 0.6, long: 3.8, over: 1.8 },
  /** The housing itself, hung under the arm's end, and how far out from the wall it starts. */
  housing: { width: 2.2, tall: 2, long: 6, from: 1.8 },
  /** The lens, round, on the housing's front. */
  lens: { radius: 0.75, thick: 0.25 },
}

/** Where the housing ends, out from the wall: the lens sits on it, and the eye just past that. */
export const FRONT = CAMERA.housing.from + CAMERA.housing.long

/**
 * How far past the lens the eye is, in metres.
 *
 * A sight sees out from the very point it is given, and whatever is nearer
 * than anything else hides what is behind it — the camera's own lens among
 * them. Just past the glass, the camera is all behind the eye.
 */
export const PAST_THE_LENS = 0.05

/**
 * How high over the ground a pin on the ground asks about, in metres: about
 * where a standing person's head is, which is what a camera like this is for.
 */
export const HEAD = 1.6

/**
 * The pins the page opens with, on the ground: one the camera sees and one it
 * does not, so the page shows both answers before anything is pressed.
 * Which is which is the camera's to say; these are only where they stand.
 */
export const FIRST_PINS = [
  // On the street in front of the wall, 34 m out
  { lng: 139.70582, lat: 35.68876 },
  // Further along the same street, off to the camera's left and outside what the lens takes in
  { lng: 139.70642, lat: 35.68876 },
] as const

/**
 * The tag the page opens with on a wall: 21 m up the east wall of the block
 * across the street from the camera, which the camera sees. Held to that
 * building as a click on the wall hands it back — its name, and the way from
 * the middle of its foot — which is how it was got.
 */
export const FIRST_TAG = {
  building: 'bldg_4400de84-3a6c-4f42-8f26-f6fcee719e53',
  offset: [11.14, -0.23, 21.39],
} as const

/** A pin's colour and label once the camera has answered, and before it has. */
export const SEEN = '#d9480f'
export const HIDDEN = '#868e96'
export const SEEN_LABEL = '映る'
export const HIDDEN_LABEL = '映らない'
export const WAITING_LABEL = '…'

/**
 * The housing's colour, and the glass's.
 *
 * Dark, where a real one is as often white: the walls of this city are white,
 * and a white camera on one is not there.
 */
export const BODY = '#383d45'
export const GLASS = '#6f9fe0'
