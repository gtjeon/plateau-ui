/**
 * Scattering points evenly over a surface.
 *
 * Where they land comes from a seed the tile decides. A tile leaving the
 * screen is dropped and fetched again when it comes back, and if the points
 * moved each time, the same park would be a different wood every visit.
 */

/** Random-looking, and the same numbers every time from the same seed. */
export function randomFrom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Text to one number, so a tile's name can be its seed. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Scatters points about `spacing` apart over a surface cut into triangles.
 *
 * A triangle is picked in proportion to its area and a place found inside it.
 * Handing each triangle a share instead would crowd the long thin slivers and
 * thicken wherever the cutting happened to be fine.
 *
 * Corners come in as [x, y, z] — the surface lies flat, so y is not read —
 * and what comes back are [x, z] pairs.
 */
export function scatterOver(
  positions: Float32Array,
  indices: ArrayLike<number>,
  spacing: number,
  most: number,
  random: () => number,
): Float32Array {
  const triangles = Math.floor(indices.length / 3)
  if (triangles === 0 || spacing <= 0) return new Float32Array(0)

  // Areas added up as we go: a point along that running total picks a triangle
  // in proportion to its area
  const upTo = new Float64Array(triangles)
  let total = 0
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3
    const b = indices[t * 3 + 1]! * 3
    const c = indices[t * 3 + 2]! * 3
    const ax = positions[a]!
    const az = positions[a + 2]!
    total +=
      Math.abs(
        (positions[b]! - ax) * (positions[c + 2]! - az) - (positions[c]! - ax) * (positions[b + 2]! - az),
      ) / 2
    upTo[t] = total
  }
  if (total <= 0) return new Float32Array(0)

  const count = Math.min(most, Math.round(total / (spacing * spacing)))
  if (count <= 0) return new Float32Array(0)

  const points = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const t = pick(upTo, random() * total)
    const a = indices[t * 3]! * 3
    const b = indices[t * 3 + 1]! * 3
    const c = indices[t * 3 + 2]! * 3
    // A place spread evenly inside the triangle, folded back where it runs past half
    let u = random()
    let v = random()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    const ax = positions[a]!
    const az = positions[a + 2]!
    points[i * 2] = ax + u * (positions[b]! - ax) + v * (positions[c]! - ax)
    points[i * 2 + 1] = az + u * (positions[b + 2]! - az) + v * (positions[c + 2]! - az)
  }
  return points
}

/** The first triangle whose running area passes `at`. */
function pick(upTo: Float64Array, at: number): number {
  let low = 0
  let high = upTo.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (upTo[middle]! < at) low = middle + 1
    else high = middle
  }
  return low
}

/** How many cells a side the test below sorts a tile's triangles into. */
const COVER_CELLS = 32

/**
 * A test for whether a place on a tile lies under any of a set of polygons —
 * a tile's building footprints, say, which a tree must not stand in.
 *
 * The triangles are sorted into a grid first, so each place asks the few
 * that could hold it rather than every footprint on the tile: a tile has
 * thousands, and a tile of trees has a thousand places to ask about.
 */
export function coveredBy(
  positions: Float32Array,
  indices: ArrayLike<number>,
  size: number,
): (x: number, z: number) => boolean {
  const cell = size / COVER_CELLS
  const bins: number[][] = Array.from({ length: COVER_CELLS * COVER_CELLS }, () => [])
  const at = (value: number) => Math.min(COVER_CELLS - 1, Math.max(0, Math.floor(value / cell)))
  const triangles = Math.floor(indices.length / 3)
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3
    const b = indices[t * 3 + 1]! * 3
    const c = indices[t * 3 + 2]! * 3
    const xs = [positions[a]!, positions[b]!, positions[c]!]
    const zs = [positions[a + 2]!, positions[b + 2]!, positions[c + 2]!]
    for (let z = at(Math.min(...zs)); z <= at(Math.max(...zs)); z++) {
      for (let x = at(Math.min(...xs)); x <= at(Math.max(...xs)); x++) bins[z * COVER_CELLS + x]!.push(t)
    }
  }
  return (x, z) => {
    if (x < 0 || z < 0 || x >= size || z >= size) return false
    for (const t of bins[at(z) * COVER_CELLS + at(x)]!) {
      const a = indices[t * 3]! * 3
      const b = indices[t * 3 + 1]! * 3
      const c = indices[t * 3 + 2]! * 3
      // Which side of each edge it lies on: inside where it is the same side of all three
      const side = (p: number, q: number) =>
        (positions[q]! - positions[p]!) * (z - positions[p + 2]!) -
        (positions[q + 2]! - positions[p + 2]!) * (x - positions[p]!)
      const ab = side(a, b)
      const bc = side(b, c)
      const ca = side(c, a)
      if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true
    }
    return false
  }
}
