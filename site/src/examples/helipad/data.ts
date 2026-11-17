/**
 * What the page is about, in numbers.
 *
 * Nothing here is data in the sense the library means it — no building, no
 * boundary, no list of places. It is where to open the map and what the
 * markings look like, which is this page's own business.
 */

/**
 * 丸の内, west of 東京駅. It opens on the roof of one block.
 *
 * Close in, and tilted about half way. What this page is about is on a roof,
 * so a standing camera would be all wall with the one face that matters
 * foreshortened to nothing, and a camera straight overhead would flatten the
 * roof until the marking no longer reads as cut *into* it.
 */
export const VIEW = {
  // The ground it opens on, however wide the screen; `main.ts` fits it
  bounds: { southWest: [139.761767, 35.68263], northEast: [139.763293, 35.68387] } as const,
  pitch: 47,
  heading: 40,
}

/** The middle of that ground, which the circle is drawn round. */
export const MIDDLE = [139.76253, 35.68325] as const

/**
 * The roof that wears one from the moment the page opens: 25 storeys and
 * 104 m, in 丸の内.
 *
 * What PLATEAU calls it. This one line is everything the page holds about the
 * building — not where it stands, not what shape its roof is — and the library
 * cuts the marking from the name alone.
 */
export const TOWER = 'bldg_3de83faa-99f4-488f-86e1-3e2d4bcdbc9d'

/** The radius of the circle the map is cut to, and how wide its hem fades into the backdrop. Metres. */
export const AROUND = 540
export const HEM = 90

/**
 * How wide the marking is, in metres.
 *
 * An emergency landing area as the fire code defines one is larger than this,
 * and even a hovering space runs to a dozen metres or more. This is a size
 * chosen to sit on a roof and still be read, not a real one.
 */
export const PAD = 32

/**
 * Which way the marking points: degrees clockwise from north.
 *
 * Squared to true north it would be the one thing on screen lined up with
 * neither the building's own edges nor the streets, and it reads as floating.
 * The blocks of 丸の内 are turned a little off north, so it is turned with
 * them.
 */
export const PAD_FACING = 15

/**
 * The colour of the marking.
 *
 * A real helipad is painted white. This one is dark, because PLATEAU's roofs
 * are a light grey and white sinks into them. There is no way to repaint one
 * roof alone underneath it either: `roofColor` is the whole layer's
 * (`buildings.roofColor`), and a colour given to one building with `setStyle`
 * goes on its walls and its roof alike.
 */
export const PAD_INK = '#c0392b'

/** A side of the canvas the marking is drawn on: enough that 32 m seen close up keeps a clean edge. */
export const PAD_TEXELS = 512
