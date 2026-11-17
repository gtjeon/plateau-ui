import type { VectorTile } from '../mvt.js'
import { signedArea, type Point } from '../polygons.js'
import { sideAt } from '../polylines.js'
import { clipToSquare } from './lines.js'

/**
 * The shading along a bank.
 *
 * Where water meets land it is a little in shade, the way the corner where a
 * wall meets the floor is. A ribbon is laid just inside the water along the
 * edge of it, darkest at the bank and fading inwards.
 */

/** The layer the shading is taken from: bodies of water. */
const SHADED = new Set(['WA'])
/** How close to the tile's edge an edge counts as running along it, in tile units. */
const BORDER = 0.5
/** How finely an edge's key is counted: the tile's own 4096 steps, divided again by ten. */
const KEY_STEPS = 4096 * 10

/**
 * The ribbon laid along a bank.
 * Each corner carries where it sits on the bank and which way is inland; how
 * far to push it is the shader's to decide. The width is in metres and the
 * world stretches with latitude, so it is set by one number, as a road is.
 */
export interface BankMesh {
  /** Where it sits on the bank (x, y, z). */
  positions: Float32Array
  /** Which way is inland (x, z), scaled by what the corner's bend costs. */
  offsets: Float32Array
  /** How far across the ribbon: 0 at the bank, 1 at its inner edge. */
  across: Float32Array
  indices: Uint32Array
}

/**
 * Builds one tile's bank ribbons.
 *
 * An edge with water on both sides is no bank, so it is left out: the edges
 * the tile cut along its own border, and the ones two bodies of water share
 * where the survey split one river into pieces. An edge meeting another
 * surface painted as water (one of `sources`) goes for the same reason.
 */
export function buildBank(
  tile: VectorTile,
  sources: readonly string[],
  tileSize: number,
): BankMesh | undefined {
  const rings: { pieces: Point[][]; inward: number; scale: number; extent: number }[] = []
  /** How many rings run along each edge. */
  const edges = new Map<string, number>()

  for (const source of sources) {
    const layer = tile.layers[source]
    if (!layer) continue
    const scale = tileSize / layer.extent
    const shaded = SHADED.has(source)

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      // MVT's feature.type: 3 is a polygon
      if (feature.type !== 3) continue
      const geometry = feature.loadGeometry()
      // A hole winds the opposite way to the ring round it, so pushing every
      // ring towards the side the first one's area falls on sends all of them
      // into the water
      const first = geometry.find((ring) => signedArea(ring) !== 0)
      if (!first) continue
      const inward = Math.sign(signedArea(first))

      for (const ring of geometry) {
        const pieces = clipToSquare(ring, layer.extent)
        for (const piece of pieces) {
          for (let k = 1; k < piece.length; k++) {
            const key = edgeKey(piece[k - 1]!, piece[k]!, layer.extent)
            edges.set(key, (edges.get(key) ?? 0) + 1)
          }
        }
        if (shaded) rings.push({ pieces, inward, scale, extent: layer.extent })
      }
    }
  }

  const builder = new BankBuilder()
  for (const { pieces, inward, scale, extent } of rings) {
    for (const run of bankRuns(pieces, extent, edges)) builder.add(run, scale, inward)
  }
  return builder.build()
}

/**
 * Hands back the stretches of a ring that are bank, joined up.
 * A ring closed inside the tile, or one whose end still meets its start after
 * cutting, is joined into a single run: broken there, the ribbon would show a
 * gap at the corner it bends round.
 */
function bankRuns(pieces: readonly Point[][], extent: number, edges: ReadonlyMap<string, number>): Point[][] {
  const runs: Point[][] = []
  for (const piece of pieces) {
    let current: Point[] = []
    for (let k = 1; k < piece.length; k++) {
      const a = piece[k - 1]!
      const b = piece[k]!
      if (onBorder(a, b, extent) || (edges.get(edgeKey(a, b, extent)) ?? 0) > 1) {
        if (current.length > 1) runs.push(current)
        current = []
        continue
      }
      if (current.length === 0) current.push(a)
      current.push(b)
    }
    if (current.length > 1) runs.push(current)
  }

  // The last stretch ending where the first begins means the two are one run
  // with the ring's starting point between them
  const head = runs[0]
  const tail = runs[runs.length - 1]
  if (head && tail && head !== tail) {
    const end = tail[tail.length - 1]!
    const start = head[0]!
    if (end.x === start.x && end.y === start.y) {
      runs[0] = [...tail, ...head.slice(1)]
      runs.pop()
    }
  }
  return runs
}

/** The same key walked either way. Measured as a fraction of the tile, so layers of different extents agree. */
function edgeKey(a: Point, b: Point, extent: number): string {
  const steps = KEY_STEPS / extent
  const p = `${Math.round(a.x * steps)},${Math.round(a.y * steps)}`
  const q = `${Math.round(b.x * steps)},${Math.round(b.y * steps)}`
  return p < q ? `${p} ${q}` : `${q} ${p}`
}

/** Whether a segment runs along one side of the tile's square. */
function onBorder(a: Point, b: Point, size: number): boolean {
  const along = (p: number, q: number, edge: number) =>
    Math.abs(p - edge) <= BORDER && Math.abs(q - edge) <= BORDER
  return along(a.x, b.x, 0) || along(a.x, b.x, size) || along(a.y, b.y, 0) || along(a.y, b.y, size)
}

/** Where the ribbons are gathered: one tile's banks into one mesh. */
class BankBuilder {
  private readonly positions: number[] = []
  private readonly offsets: number[] = []
  private readonly across: number[] = []
  private readonly indices: number[] = []

  /**
   * Adds one run of bank as a ribbon.
   * Two corners a point: one on the bank, one at the inner edge, mitred where
   * it bends as a road is. `inward` is 1 where the water lies to the left of
   * the way it runs, -1 where it lies to the right.
   */
  add(line: readonly Point[], scale: number, inward: number): void {
    const points: { x: number; z: number }[] = []
    for (const point of line) {
      const last = points[points.length - 1]
      const x = point.x * scale
      const z = point.y * scale
      // The same place twice over has no direction between the two, and the corner flies off
      if (last && last.x === x && last.z === z) continue
      points.push({ x, z })
    }
    // A run whose ends meet is a ring: drop the doubled point and join it round
    const start = points[0]
    const end = points[points.length - 1]
    const closed = points.length > 3 && start!.x === end!.x && start!.z === end!.z
    if (closed) points.pop()
    const count = points.length
    if (count < 2) return

    const base = this.across.length
    for (let i = 0; i < count; i++) {
      const here = points[i]!
      const previous = closed ? points[(i + count - 1) % count] : points[i - 1]
      const next = closed ? points[(i + 1) % count] : points[i + 1]
      const side = sideAt(here, previous, next)
      const x = side.x * side.stretch * inward
      const z = side.z * side.stretch * inward
      // One on the bank, one at the inner edge: the same place, and the shader
      // pushes only the inner one
      this.positions.push(here.x, 0, here.z, here.x, 0, here.z)
      this.offsets.push(x, z, x, z)
      this.across.push(0, 1)
    }

    const quads = closed ? count : count - 1
    for (let i = 0; i < quads; i++) {
      const a = base + i * 2
      const b = base + ((i + 1) % count) * 2
      this.indices.push(a, b, b + 1, a, b + 1, a + 1)
    }
  }

  build(): BankMesh | undefined {
    if (this.indices.length === 0) return undefined
    return {
      positions: new Float32Array(this.positions),
      offsets: new Float32Array(this.offsets),
      across: new Float32Array(this.across),
      indices: new Uint32Array(this.indices),
    }
  }
}
