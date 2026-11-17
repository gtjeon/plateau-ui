/**
 * Cutting a vector tile's loops to the tile and filling them in, and turning
 * a page's own loop of longitudes and latitudes into one of the same kind.
 *
 * Neither the ground's nor the land use's, though both read loops out of a
 * vector tile — the GSI's for one, PLATEAU's for the other — and both want
 * them cut and filled the same way. Kept where neither owns it, so that
 * reading PLATEAU's tiles does not reach into what draws the ground.
 */
import earcut from 'earcut'
import { latToY, lonToX } from './geo/mercator.js'

/**
 * A corner of a loop, in the tile's own grid.
 *
 * MVT counts y downwards, which is what decides the sign a loop's area comes
 * out with, and so which way round an outer loop runs. The lines drawn on the
 * ground are made of the same points.
 */
export interface Point {
  x: number
  y: number
}

export interface PolygonMesh {
  positions: Float32Array
  indices: Uint32Array
  /**
   * The middle [x, z] of its own piece, on every corner. Only where the kind
   * was built to record it. Measured off the loop before it was cut, so a
   * footprint split across two tiles mostly points at the same place from both.
   */
  centres?: Float32Array
}

/**
 * A loop's signed area.
 * MVT counts y downwards, so by this reckoning an outer loop comes out
 * positive and a hole negative.
 */
export function signedArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const current = points[i]!
    const previous = points[j]!
    sum += (previous.x - current.x) * (current.y + previous.y)
  }
  return sum
}

/** One loop in the world's own units. The world's z runs south, where latitude runs north. */
export function worldLoop(loop: readonly (readonly [number, number])[]): Point[] {
  return loop.map(([lon, lat]) => ({ x: lonToX(lon), y: -latToY(lat) }))
}

/**
 * Whether a place falls inside a set of loops: the outside one, less its holes.
 *
 * The even-odd crossing count, which is how every library settles this — a ray
 * from the place, counting the loop edges it crosses. Run over every loop at
 * once rather than loop by loop: a hole lies inside the outside, so a place in
 * a hole crosses both and comes out even, which is outside.
 *
 * Asked in the world's own units, where the same question has an answer
 * already. A shape painted onto the picture is counted into the stencil
 * through the walls of a prism cut from these very loops
 * (`shapes/volume.ts`), so a world point tested against them is that test
 * done again rather than a second, looser one in degrees.
 *
 * `z` is the world's own, which is what a {@link Point}'s `y` holds; see
 * {@link worldLoop}.
 */
export function insideLoops(loops: readonly (readonly Point[])[], x: number, z: number): boolean {
  let inside = false
  for (const loop of loops) {
    for (let at = 0, before = loop.length - 1; at < loop.length; before = at++) {
      const here = loop[at]!
      const last = loop[before]!
      // Half-open: an edge counts where it straddles the ray one way and not
      // the other, so a place level with a corner two edges share is counted
      // once rather than twice or not at all.
      if (here.y > z === last.y > z) continue
      const across = ((last.x - here.x) * (z - here.y)) / (last.y - here.y) + here.x
      if (x < across) inside = !inside
    }
  }
  return inside
}

/**
 * The loops wound the way {@link PolygonBuilder} reads them: the outside one
 * way and the holes the other.
 *
 * The builder tells an outside from a hole by which way a loop winds, because
 * that is all a vector tile ever says about it. A page says it in the order
 * instead — the first loop is the outside, and so does GeoJSON — so the
 * winding is set here to match what the builder reads rather than trusted from
 * whoever wrote the file. RFC 7946 does lay the winding down, and files in the
 * wild get it wrong both ways round; the order they do not get wrong, since
 * there is nothing else the first loop could be.
 *
 * Here rather than beside either caller because both ask it of a page's loops
 * — the fill laid on the land and the box drawn over it — and which loop is a
 * hole is one answer, not two that have to be kept saying the same thing.
 */
export function outsideFirst(loops: readonly Point[][]): Point[][] {
  return loops.map((loop, at) => {
    const outside = at === 0
    return signedArea(loop) > 0 === outside ? loop : [...loop].reverse()
  })
}

/**
 * Cuts a loop down to the tile's own rectangle (Sutherland-Hodgman).
 *
 * A vector tile carries a margin past its edge, and the neighbouring tile
 * carries the same ground again. Being the same colour it ought not to show,
 * but the two edges drawn over each other leave a hard line along every tile
 * seam that shifts about as the view turns.
 *
 * Cut against the four sides in turn; a loop keeps the way it winds.
 *
 * Exported for `VectorTileLayer`, whose areas are the same tiles' loops and
 * carry the same margin: one cut for both, so the ground and a page's tileset
 * cannot come to disagree about where a tile ends.
 */
export function clipLoopToSquare(loop: readonly Point[], size: number): Point[] {
  let current: Point[] = [...loop]
  const edges: readonly ((p: Point) => number)[] = [
    (p) => p.x,
    (p) => size - p.x,
    (p) => p.y,
    (p) => size - p.y,
  ]

  for (const inside of edges) {
    if (current.length === 0) return []
    const next: Point[] = []
    for (let i = 0; i < current.length; i++) {
      const a = current[i]!
      const b = current[(i + 1) % current.length]!
      const da = inside(a)
      const db = inside(b)

      if (da >= 0) next.push(a)
      // Crossing the side: put the meeting point in
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db)
        next.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
    }
    current = next
  }
  return current
}

/**
 * How much ground a face has to cover to be worth keeping, in square world
 * units.
 *
 * A survey's loops close on themselves: one runs out along a line and comes
 * back along the same one, enclosing nothing. Earcut fills that with faces
 * that cover no ground at all. Flat they draw nothing — no pixels, and nobody
 * ever saw them. The ground here is not flat: every corner is set down on the
 * land under it (`drape.ts`), so a face with no footprint takes two heights
 * and stands up as a wall. Twenty-eight of them over a screenful at 由比ヶ浜,
 * covering seven square centimetres between them.
 *
 * **The footprint is the question, and not the width.** It was asked as a
 * width first — a quarter of a metre — and that threw away 1,783 faces that
 * did cover ground, 1,883m² of it, the largest 447m long. Every one of those
 * left a slit for the land to show through, which is the thing the test was
 * put in to stop. Dropping a face that covers nothing leaves nothing behind;
 * dropping a thin one leaves its shape.
 *
 * Seven square centimetres is a tenth of the smallest face the survey's own
 * grid can make — twelve centimetres a step at z16, so the least it can draw
 * is seventy — and what goes is only what had already collapsed.
 */
const NO_FOOTPRINT = 0.001

/** Whether a triangle covers no ground at all, and so is a wall once draped. See {@link NO_FOOTPRINT}. */
function coversNothing(flat: readonly number[], a: number, b: number, c: number): boolean {
  const ax = flat[a * 2]!
  const az = flat[a * 2 + 1]!
  const bx = flat[b * 2]!
  const bz = flat[b * 2 + 1]!
  const cx = flat[c * 2]!
  const cz = flat[c * 2 + 1]!
  // Twice the area it covers on the map, with the heights it has not been
  // given yet left out of it
  const twiceArea = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax))
  return twiceArea < NO_FOOTPRINT * 2
}

/**
 * Puts a loop back on the whole steps the survey gave it.
 *
 * A vector tile counts in whole steps — 4096 across the tile, twelve
 * centimetres at z16 — so every corner that came in it is already on one.
 * Cutting the loop to the tile's square is what makes corners that are not: a
 * cut lands wherever the line crossed, between two steps. Those go back on
 * the step they were cut from, and corners that then fall together are one
 * corner.
 *
 * What it is worth is the corners that fall together. Measured over a
 * screenful at 由比ヶ浜, the footprints came to 51,856 corners left between
 * the steps and 44,354 put back on them, and the ground drawn is the same to
 * within a square metre in two million.
 *
 * It used to reach further: a corner within a step of another was welded onto
 * it, to close the slots a loop can be drawn with. Measured, that closed four
 * narrow gaps in the footprints and moved 202 corners to do it, one of them
 * by seventeen centimetres — further than the survey's own step, at any place
 * inside the tile. A gap is something the survey said. A corner moved further
 * than the survey can speak is this library saying something instead, so it
 * reaches no further than the step a corner is already on.
 */
function onTheGrid(loop: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const point of loop) {
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    const last = out[out.length - 1]
    // Corners that fall on one step are one corner
    if (last && last.x === x && last.y === y) continue
    out.push({ x, y })
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && first && last && first.x === last.x && first.y === last.y) out.pop()
  return out
}

/**
 * How far a tile reaches past its own edge, in the tile's own steps: a
 * quarter.
 *
 * Cut to its square, a tile's shapes end exactly on the line the next tile's
 * begin on, and the two ought to meet. They are two meshes, though, and the
 * card works that one line out twice — once through each tile's own matrix,
 * from numbers that are a tile apart. In float that is not the same answer
 * twice, and the hair between the two answers is covered by neither: the
 * samples that land in it keep whatever was under, which is the land.
 *
 * It shows as a line because a seam runs north and south and the map faces
 * north, so the camera only pitches and the seam's world x goes straight to a
 * screen x. Dead upright, every row of pixels meets it at the same place
 * inside the pixel — so if one of the four samples falls in the hair, it
 * falls in it on every row. Measured at 由比ヶ浜: a quarter of each pixel for
 * the whole height of the water, which is the land showing through at 24 per
 * cent, even and unbroken, and gone again at the next size of window.
 *
 * So the two are made to overlap instead of to meet. A quarter of a step at
 * z16 is four centimetres in the world's own units, which is three of ground
 * — the world is stretched 1.22 times at Japan's latitudes, and the twelve
 * centimetres a step above is ground. The pixel and the two millimetres this
 * is weighed against are in world units as well, so both of the ratios are a
 * length over a length in the one unit: put the numerator in the other and
 * they stop being true. A fourteenth of a pixel where this map opens, and the
 * tiles it covers are the same ground in the same colour, so an overlap draws
 * as nothing at all. Measured against it: two millimetres of overlap was
 * already enough to close the line, so this is twenty times what the hair
 * needs.
 */
const PAST_THE_EDGE = 0.25

/**
 * Pushes the corners sitting on the tile's edge a hair over it, so that
 * neighbouring tiles overlap rather than abut. See {@link PAST_THE_EDGE}.
 *
 * After the grid, not before: a corner the cut left just inside the edge is
 * rounded onto it there, and this is what then carries it over.
 */
function pastTheEdge(loop: readonly Point[], size: number): Point[] {
  return loop.map((point) => ({
    x: point.x <= 0 ? -PAST_THE_EDGE : point.x >= size ? size + PAST_THE_EDGE : point.x,
    y: point.y <= 0 ? -PAST_THE_EDGE : point.y >= size ? size + PAST_THE_EDGE : point.y,
  }))
}

/** Where surfaces are gathered: every piece of one kind into one mesh. */
export class PolygonBuilder {
  private readonly positions: number[] = []
  private readonly indices: number[] = []
  private readonly centres: number[] = []

  /**
   * @param centred Whether each corner also records the middle of its own
   *   piece, so that a shader can treat one piece as one thing even though
   *   they are all gathered into a single mesh.
   */
  constructor(private readonly centred = false) {}

  /**
   * Adds the loops of one feature.
   * Every outer loop starts a new piece, and the negative loops that follow
   * are its holes. Given an extent, what lies outside the tile's rectangle is
   * cut away so it does not overlap the neighbouring tile.
   */
  /**
   * How many corners it holds so far.
   *
   * Read either side of an {@link add} by a caller that gathers many things
   * into one mesh and has something to write on each one's corners — a colour
   * off a vector tile, say. What a loop comes to is not known before it is
   * added: cut back to a tile's square it may come to more corners than it
   * went in with, or to none.
   */
  get corners(): number {
    return this.positions.length / 3
  }

  add(loops: readonly (readonly Point[])[], scale: number, extent?: number): void {
    let flat: number[] = []
    let holes: number[] = []
    let centre = { x: 0, z: 0 }

    const flush = () => {
      if (flat.length < 6) return
      const base = this.positions.length / 3
      const cut = earcut(flat, holes, 2)
      for (let t = 0; t + 2 < cut.length; t += 3) {
        const a = cut[t]!
        const b = cut[t + 1]!
        const c = cut[t + 2]!
        // Faces that cover nothing are left out rather than drawn flat: no
        // ground goes with them, and kept they are a wall once the land is
        // under them
        if (coversNothing(flat, a, b, c)) continue
        this.indices.push(base + a, base + b, base + c)
      }
      for (let v = 0; v < flat.length; v += 2) {
        const x = flat[v]!
        const z = flat[v + 1]!
        this.positions.push(x, 0, z)
        if (this.centred) this.centres.push(centre.x, centre.z)
      }
      flat = []
      holes = []
    }

    for (const source of loops) {
      const loop =
        extent === undefined ? source : pastTheEdge(onTheGrid(clipLoopToSquare(source, extent)), extent)
      if (loop.length < 3) continue
      const outer = signedArea(loop) > 0
      if (outer) {
        flush()
        centre = middleOf(source, scale)
      } else if (flat.length === 0) continue
      else holes.push(flat.length / 2)
      for (const point of loop) flat.push(point.x * scale, point.y * scale)
    }
    flush()
  }

  build(): PolygonMesh | undefined {
    if (this.indices.length === 0) return undefined
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      ...(this.centred && { centres: new Float32Array(this.centres) }),
    }
  }
}

/** The middle of the box a loop fits in. */
function middleOf(loop: readonly Point[], scale: number): { x: number; z: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of loop) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: ((minX + maxX) / 2) * scale, z: ((minY + maxY) / 2) * scale }
}
