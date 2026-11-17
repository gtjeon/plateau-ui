import { BufferAttribute, BufferGeometry, Color } from 'three/webgpu'
import { sideAt } from '../polylines.js'

/**
 * A painted line as a strip of quads lying on the land.
 *
 * Not a fat line. Three draws one of those by taking two places, pushing the
 * corners of a strip out sideways on the screen and rounding the ends off —
 * which gives a card standing in front of the camera rather than paint lying
 * on the ground. It has ends but no joins, so every turn is one card's round
 * end laid over the next card's body, and the rounding shows there as a
 * bulge. It carries one depth for the whole width, so a wide one cuts into
 * the hillside it crosses. And the world place a fragment of it reads is not
 * a place on the ground, so everything else that is decided by where a thing
 * lies — the shape the scene is cut to, above all — had to be worked out for
 * it on this side instead.
 *
 * A ribbon answers all three at once: the corners are mitred, so two segments
 * meet along a shared edge and nothing is drawn twice; every corner sits on
 * the land it is painted over; and a fragment is at a real place again, so
 * the mask cuts and hems it the way it does the road underneath.
 *
 * It is built wider than the line it draws. What smooths the edge is not the
 * card's own outline — a triangle edge is smoothed by however many places the
 * renderer samples inside a pixel, four of them, which is plenty for a wall
 * and nothing at all for a line a pixel and a half across: the two edges land
 * in the one pixel, some pixels catch two samples and some one, and the line
 * beads along its length. So the strip is given a pixel of room on each side
 * and the paint works out for itself how much of each pixel the line covers,
 * from how far that pixel is off the middle. That reading is continuous where
 * sampling is four steps, and a line thinner than a pixel comes out faint
 * rather than dotted — which is what it should be.
 *
 * A line through the air takes some of the fat line back: its strip is turned
 * to face the eye, since there is no ground under it for the width to lie on.
 * What it does not take is the rest — the corners are still mitred rather than
 * rounded, a fragment is still at a real place, and the turning is one cross
 * product in the paint rather than a card built per segment.
 *
 * What draws it is in `paint.ts`, which every shape shares.
 */

/**
 * How much wider than the line the strip is built, each side, in the pixels
 * the width is given in.
 *
 * One. The fade needs somewhere to happen and a pixel is the whole of what
 * there is to fade across; wider only spreads the same fade over ground the
 * line was never meant to cover.
 */
const FEATHER = 1

/**
 * One painted line as a strip of quads: two corners a point, pushed opposite
 * ways.
 *
 * `walk` is where it runs, already laid on the land — x, y, z and on.
 *
 * Which way a corner is pushed is settled in one of two places, and `facing`
 * is which. A line on the ground is pushed here, flat along the land, and the
 * paint is told nothing about the line at all: the push is worked out once and
 * carried on the corner. A line in the air is pushed towards the eye instead,
 * and the eye moves — so what is carried is the two corners either side of
 * this one, and the paint works the push out afresh every frame. See
 * `shapes/paint.ts`.
 *
 * Flat is what paint does, which is why it is not simply always the other one:
 * a line lying on a road narrows as the road turns away from the eye, and one
 * that kept its width whatever the tilt would be a card standing off the map.
 * A line through the air has no road to lie on.
 */
export function buildRibbon(
  walk: Float32Array,
  halfWidth: number,
  colour: Color,
  shows: number,
  facing: boolean,
): BufferGeometry | null {
  const held = walk.length / 3
  if (held < 2) return null

  const positions = new Float32Array(held * 6)
  const offsets = new Float32Array(held * 4)
  const neighbours = facing ? { back: new Float32Array(held * 6), on: new Float32Array(held * 6) } : null
  const edges = new Float32Array(held * 4)
  // rgb and how much of the line goes on, four a corner — the same four an
  // area's corners carry, and read the same way by the paint
  const paint = new Float32Array(held * 8)
  const indices = new Uint32Array((held - 1) * 6)

  const place = (at: number) => ({
    x: walk[at * 3] ?? 0,
    y: walk[at * 3 + 1] ?? 0,
    z: walk[at * 3 + 2] ?? 0,
  })

  for (let at = 0; at < held; at++) {
    const here = { x: walk[at * 3] ?? 0, z: walk[at * 3 + 2] ?? 0 }
    const previous = at > 0 ? { x: walk[(at - 1) * 3] ?? 0, z: walk[(at - 1) * 3 + 2] ?? 0 } : undefined
    const next = at < held - 1 ? { x: walk[(at + 1) * 3] ?? 0, z: walk[(at + 1) * 3 + 2] ?? 0 } : undefined
    const side = sideAt(here, previous, next)
    // Out to the edge of the room, not to the edge of the line
    const reach = halfWidth + FEATHER
    const push = side.stretch * reach
    const y = walk[at * 3 + 1] ?? 0

    // The same place twice: the left corner and the right
    positions.set([here.x, y, here.z, here.x, y, here.z], at * 6)
    offsets.set([side.x * push, side.z * push, -side.x * push, -side.z * push], at * 4)
    if (neighbours) {
      // The ends have one neighbour, and the paint wants two so that it has a
      // segment either side of every corner. The missing one is the one there
      // reflected through the corner, which gives the end the very segment it
      // has — a straight run rather than a special case in the shader
      const middle = place(at)
      const before = at > 0 ? place(at - 1) : beyond(middle, place(at + 1))
      const behind = at < held - 1 ? place(at + 1) : beyond(middle, place(at - 1))
      neighbours.back.set([before.x, before.y, before.z, before.x, before.y, before.z], at * 6)
      neighbours.on.set([behind.x, behind.y, behind.z, behind.x, behind.y, behind.z], at * 6)
    }
    // How far off the middle this corner is, and how far off it the line ends.
    // The first runs across the strip and the second is the same on both, so
    // a fragment has both numbers without the paint being told about this line
    edges.set([reach, halfWidth, -reach, halfWidth], at * 4)
    paint.set([colour.r, colour.g, colour.b, shows, colour.r, colour.g, colour.b, shows], at * 8)
  }

  for (let at = 0; at < held - 1; at++) {
    const a = at * 2
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], at * 6)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('edge', new BufferAttribute(edges, 2))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  if (neighbours) {
    geometry.setAttribute('prior', new BufferAttribute(neighbours.back, 3))
    geometry.setAttribute('after', new BufferAttribute(neighbours.on, 3))
  } else {
    geometry.setAttribute('offset', new BufferAttribute(offsets, 2))
  }
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/** The place a corner's missing neighbour would be: the one it has, reflected through it. */
function beyond(
  here: { x: number; y: number; z: number },
  other: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return { x: here.x * 2 - other.x, y: here.y * 2 - other.y, z: here.z * 2 - other.z }
}
