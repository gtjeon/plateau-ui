import { BufferAttribute, BufferGeometry, type Color } from 'three/webgpu'

/**
 * A circle a page puts at a point, as a fan of triangles round it.
 *
 * Every corner stands at the point itself. What spreads them is a pair of
 * numbers each carries — how far out it is, in pixels of the page — and the
 * paint lays those out on the screen or on the land as it draws; see
 * `shapes/paint.ts`, `circle`. So a circle keeps its size in pixels at every
 * zoom without being cut again, which is the point of saying its radius in
 * pixels at all: a reading drawn twelve pixels across is a reading, and one
 * twelve metres across is a hair at one zoom and a roundabout at another.
 *
 * A fan rather than one square, though the paint works out the round edge
 * for itself and a square would do for the picture. It would not do for the
 * pointer: the look under it draws the shape under a material of its own,
 * which knows where the corners go and nothing of the colour worked out
 * between them, so it finds whatever the triangles cover. A square finds a
 * circle two fifths of its radius out past its edge on the diagonals, which is
 * the tolerance contract 6 says this library does not give. A fan close round
 * the circle finds it no further out than the room its edge fades across —
 * the pixel a line's strip is widened by, for the same reason — and
 * {@link LOOSE} past that.
 *
 * The fill and the ring are one fan. A point is read as one mark, the way
 * Mapbox's circle and deck.gl's scatterplot draw theirs, so two circles that
 * overlap have the second one's fill laid over the first one's ring rather
 * than every ring over every fill as an area's loops are. Drawn apart they
 * would also be twice the meshes for the commonest thing a file holds.
 */

/**
 * How far past the circle its fan may reach on the screen, in pixels of the
 * page, before another side is added.
 *
 * Half a pixel. Only the pointer ever sees the fan's own edge — the picture is
 * worked out to the round one inside it — so this is the slack the look under
 * the pointer gets, and half a pixel is less than the fade it has anyway.
 */
const LOOSE = 0.5

/**
 * How much room past the circle the fan leaves for its edge to fade across,
 * in pixels of the page.
 *
 * One, the same pixel a line's strip is widened by (`ribbon.ts`): the fade is
 * one pixel of the drawing buffer wide and centred on the edge, and a pixel of
 * the page is at least that whatever the screen.
 */
const FEATHER = 1

/** The fewest sides a circle is cut with, however small; and the most, however big. */
const FEWEST = 8
const MOST = 96

/**
 * How many sides a polygon round a circle of `radius` pixels needs to stay
 * within `slack` pixels of it.
 *
 * A side's middle falls short of the circle by `radius * (1 - cos(π / n))`,
 * so the count is read straight off that. Worked out for each circle rather
 * than fixed, because a circle's radius is anything a page says: twelve sides
 * are a circle at six pixels and a polygon at sixty.
 *
 * Shared with the boxes a painted circle is counted through
 * (`shapes/volume.ts`), which stand on these very corners.
 */
export function sidesFor(radius: number, slack: number): number {
  if (radius <= slack) return FEWEST
  const sides = Math.ceil(Math.PI / Math.acos(radius / (radius + slack)))
  return Math.min(Math.max(sides, FEWEST), MOST)
}

/** What one circle is drawn in: its inside and its ring, either of which may be off. */
export interface DiscInk {
  /** How far out its edge is, in pixels of the page. */
  readonly radius: number
  /** The inside's colour and how much of it goes on, or nothing where it is not filled. */
  readonly fill: { readonly colour: Color; readonly shows: number } | null
  /**
   * The ring's colour, how much of it goes on and how wide it is in pixels of
   * the page, or nothing where there is none.
   */
  readonly line: { readonly colour: Color; readonly shows: number; readonly width: number } | null
}

/**
 * One circle as a fan, standing at a place already laid on the land — x, y and
 * z in the world's own units.
 *
 * The ring is centred on the edge, as an area's loop is on its own boundary
 * and as Leaflet and deck.gl draw theirs: half of it inside the radius and half
 * outside. So `radius` is where the edge of the thing is, whatever the ring.
 *
 * Nothing where there is nothing to draw: no fill, and no ring with a width.
 */
export function buildDisc(x: number, y: number, z: number, ink: DiscInk): BufferGeometry | null {
  const radius = Math.max(ink.radius, 0)
  const half = ink.line ? Math.max(ink.line.width, 0) / 2 : 0
  if (!ink.fill && half === 0) return null
  if (radius === 0 && half === 0) return null

  // Out to where the fade ends, and then far enough again that the polygon's
  // sides stand clear of the round edge rather than cutting into it
  const reach = radius + half + FEATHER
  const sides = sidesFor(reach, LOOSE)
  const out = reach / Math.cos(Math.PI / sides)

  const held = sides + 1
  const positions = new Float32Array(held * 3)
  const spots = new Float32Array(held * 4)
  const paint = new Float32Array(held * 4)
  const lines = new Float32Array(held * 4)
  const fill = ink.fill
  const line = ink.line
  for (let at = 0; at < held; at++) {
    positions.set([x, y, z], at * 3)
    // The middle first, at no distance at all, and then the rim. Carried as
    // an offset rather than as the distance itself, because the distance is
    // not straight across a triangle and the offset is — read between the
    // corners it comes out exact wherever the fragment falls, and the
    // distance is taken from it there.
    const angle = ((at - 1) / sides) * Math.PI * 2
    const far = at === 0 ? 0 : out
    // The lengths together — the push, the radius, and the ring's half-width,
    // nought where there is no ring, which the paint reads as a band no pixel
    // can fall into — and the two inks apart, each its colour and how much of
    // it goes on, read the same way
    spots.set([Math.cos(angle) * far, Math.sin(angle) * far, radius, half], at * 4)
    paint.set(fill ? [fill.colour.r, fill.colour.g, fill.colour.b, fill.shows] : [0, 0, 0, 0], at * 4)
    lines.set(line ? [line.colour.r, line.colour.g, line.colour.b, line.shows] : [0, 0, 0, 0], at * 4)
  }

  const indices = new Uint32Array(sides * 3)
  for (let side = 0; side < sides; side++) {
    indices.set([0, 1 + side, 1 + ((side + 1) % sides)], side * 3)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(DISC_SPOT, new BufferAttribute(spots, 4))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setAttribute(DISC_LINE, new BufferAttribute(lines, 4))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/**
 * Where a corner of a circle's fan is pushed to, in pixels of the page, then
 * the circle's own radius and its ring's half-width beside it: the four
 * lengths a circle is drawn by.
 *
 * The radius and the width ride on every corner rather than on the material,
 * which is one for every circle in the layer whatever size each is. The
 * half-width rode with the ring's colour until 2026-11-05, when the ring took
 * an opacity and the colour's fourth was wanted for it, as an inside's is.
 */
export const DISC_SPOT = 'spot'

/** The ring's colour, and how much of it goes on: the same four the inside's `paint` carries. */
export const DISC_LINE = 'ink'
