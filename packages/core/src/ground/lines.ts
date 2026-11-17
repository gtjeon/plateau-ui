/**
 * Where the ribbons that lie on the ground are made.
 *
 * A line drawn on screen is as thick as the camera says, so turning or
 * tilting the view slides a road about over the ground and bunches its ends
 * up. Roads and railways are made as quads on the Y=0 plane instead.
 */

import type { Point } from '../polygons.js'
import { sideAt } from '../polylines.js'

/**
 * A ribbon lying on the ground.
 * A corner carries where it sits on the centre line and which way is
 * sideways; how far to push it is the shader's to decide. That way a change
 * of zoom swaps one number rather than rebuilding every ribbon.
 */
export interface RibbonMesh {
  /** Where it sits on the centre line (x, y, z). */
  positions: Float32Array
  /** Which way is sideways (x, z), its length carrying what the mitre costs. */
  offsets: Float32Array
  /** Half the width there, in metres. */
  widths: Float32Array
  /**
   * Where along and across the ribbon: metres from its start, and -1 to 1
   * across its width. For the materials that draw a pattern along one; only
   * carried where one will.
   */
  along?: Float32Array
  indices: Uint32Array
}

/** Where the ribbons are gathered: every run of one kind into one mesh. */
export class RibbonBuilder {
  private readonly positions: number[] = []
  private readonly offsets: number[] = []
  private readonly widths: number[] = []
  private readonly indices: number[] = []
  private readonly along: number[] | undefined

  /** Whether to carry what a pattern-drawing material needs. */
  constructor(patterned = false) {
    if (patterned) this.along = []
  }

  /** How many corners it holds so far; see {@link PolygonBuilder.corners}. */
  get corners(): number {
    return this.positions.length / 3
  }

  get empty(): boolean {
    return this.indices.length === 0
  }

  /**
   * Adds one centre line as a ribbon.
   * Two corners a point, left and right, mitred on the outside where it bends.
   */
  add(line: readonly Point[], scale: number, halfWidth: number): void {
    // Points closer together than the width are dropped. Tile coordinates
    // are rounded to whole steps, so even a straight road arrives wobbling by
    // one; built as it comes, that jitter twists the corners over each other.
    const minStep = Math.max(halfWidth * 0.5, 1e-6)
    const points: { x: number; z: number }[] = []
    for (let i = 0; i < line.length; i++) {
      const x = line[i]!.x * scale
      const z = line[i]!.y * scale
      const last = points[points.length - 1]
      // The last point says where the road ends, so it always stays
      if (last && Math.hypot(last.x - x, last.z - z) < minStep && i < line.length - 1) continue
      points.push({ x, z })
    }
    if (points.length < 2) return

    // A piece ends square. Cut at a tile's edge it has to meet the piece in
    // the next tile, and where the road was bending there, what would have
    // joined them is gone and a hairline shows. Both ends run on by half a
    // width so the two overlap; being the same colour, the overlap does not
    // show.
    extend(points[0]!, points[1]!, halfWidth)
    extend(points[points.length - 1]!, points[points.length - 2]!, halfWidth)

    const base = this.widths.length
    let travelled = 0
    for (let i = 0; i < points.length; i++) {
      const here = points[i]!
      const previous = points[i - 1]
      const next = points[i + 1]
      const { x: nx, z: nz, stretch } = sideAt(here, previous, next)
      if (previous) travelled += Math.hypot(here.x - previous.x, here.z - previous.z)

      const y = 0
      // The left corner and the right: the same place, pushed opposite ways
      this.positions.push(here.x, y, here.z, here.x, y, here.z)
      this.offsets.push(nx * stretch, nz * stretch, -nx * stretch, -nz * stretch)
      this.widths.push(halfWidth, halfWidth)
      this.along?.push(travelled, -1, travelled, 1)
    }

    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2
      this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  build(): RibbonMesh | undefined {
    if (this.empty) return undefined
    return {
      positions: new Float32Array(this.positions),
      offsets: new Float32Array(this.offsets),
      widths: new Float32Array(this.widths),
      ...(this.along && { along: new Float32Array(this.along) }),
      indices: new Uint32Array(this.indices),
    }
  }
}

/** Pushes an end point `distance` further out, away from its neighbour. */
function extend(end: { x: number; z: number }, inner: { x: number; z: number }, distance: number): void {
  const dx = end.x - inner.x
  const dz = end.z - inner.z
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return
  end.x += (dx / length) * distance
  end.z += (dz / length) * distance
}

/**
 * Cuts a line down to the tile's own square.
 *
 * A vector tile carries a margin past its edge, and the neighbouring tile
 * carries the same ground again. Uncut, two tiles draw the same road over
 * each other, and since the ground does not write depth there is no mark to
 * decide between them: the overlap flickers every time the camera moves.
 *
 * Liang-Barsky gives the stretch of each segment that falls inside the
 * square, and the stretches that carry on from one another are joined.
 */
export function clipToSquare(line: readonly Point[], size: number): Point[][] {
  const pieces: Point[][] = []
  let current: Point[] | undefined

  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!
    const b = line[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y

    // The part inside the square lies between t0 and t1
    let t0 = 0
    let t1 = 1
    let outside = false
    const edges: readonly (readonly [number, number])[] = [
      [-dx, a.x],
      [dx, size - a.x],
      [-dy, a.y],
      [dy, size - a.y],
    ]
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) outside = true
        continue
      }
      const r = q / p
      if (p < 0) {
        if (r > t1) outside = true
        else if (r > t0) t0 = r
      } else if (r < t0) outside = true
      else if (r < t1) t1 = r
    }

    if (outside || t1 <= t0) {
      current = undefined
      continue
    }

    const end = { x: a.x + dx * t1, y: a.y + dy * t1 }
    if (current && t0 === 0) {
      current.push(end)
    } else {
      current = [{ x: a.x + dx * t0, y: a.y + dy * t0 }, end]
      pieces.push(current)
    }
    // An end that was cut does not carry on into the next segment
    if (t1 < 1) current = undefined
  }

  return pieces
}
