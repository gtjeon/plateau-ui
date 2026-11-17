import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import { copyAhead, sameWidthAs } from './attributes.js'
import type { BuildingFacts } from './tileContent.js'
import type { RoofPlan } from './roofPlan.js'
import { ceilingsOf, countStoreys } from './storeys.js'
import { atOnce, pause, type Steps } from './steps.js'
import { holdsWindows, readingFields, type Field } from './wallFields.js'
import type { Wall, WallPlan } from './wallPlan.js'
import { usageNumber } from './windowStyle.js'

/**
 * Marking up the walls so the shader can set windows into them.
 *
 * Nothing is added to the shape of a building. A window is a rectangle of
 * another colour on a wall that was already there, and what it takes to draw
 * one is knowing, at any point of that wall, how far across its field it is,
 * how wide the field is, where its top and its foot are and how steeply that
 * top runs; and of its building, what it is used for, where it stops and how
 * many storeys it stands. Those ride on the vertex; the size of a window and
 * the wall left around it are the shader's, so they can be changed without
 * touching the mesh again.
 *
 * The field is not the wall's own outline but the largest part of it that
 * windows fit in whole, which is where they are set out: see
 * {@link fieldsOf}. A window is only ever drawn all of it or none of it.
 *
 * A vertex can only carry one wall's answer, and a building's corner belongs
 * to two walls at once. So the corners are split — but only the ones that have
 * to be. A vertex used by one wall and nothing else keeps its place and is
 * written where it lies; one shared with another wall, or with a roof, is
 * copied. That leaves the vertex count up by a tenth or so, rather than by
 * half if every wall were given corners of its own.
 */

/**
 * Where a vertex carries the field of its wall: how far across it, how wide it
 * is, where its top is — at its high end, where it slopes — and how many
 * storeys the building stands.
 */
export const WINDOW_FRAME = 'windowFrame'
/**
 * Where a vertex carries which settings to draw its windows with, where the
 * building it belongs to stops, where the field of its wall starts from the
 * ground, and how steeply the top of the field runs. A usage of 0 draws none.
 *
 * The building's ceiling rides along because the storeys are its, not the
 * wall's: a wing standing one floor high off a block of five is not a building
 * of one floor, and its windows line up with the floors of the block. It rides
 * as a negative number where the building's walls stop it rather than a flat
 * roof, which is to say where no parapet can stand over its top row.
 */
export const WINDOW_USAGE = 'windowUsage'

/**
 * Buildings at least this tall take windows on every wall, in metres.
 *
 * What a window looks out on is what decides whether it is there, and above
 * the roofs of everything around it a wall looks out on the city whichever way
 * it turns. A tower with its back to a lane keeps no blank face for it: the
 * eighth floor is over the lane's neighbours and sees straight past them.
 */
export const DEFAULT_TALL = 36

/** A vertex or a triangle no wall being dressed has claimed. */
const NOBODY = -1
/** A vertex two walls share, or a wall shares with a roof. */
const SHARED = -2

/** How a mesh's walls took to the windows. */
export interface WindowTally {
  /** Walls that took them. */
  readonly dressed: number
  /** Walls passed over for looking at nothing. */
  readonly blind: number
  /** Walls passed over for holding no field a window fits in whole: too small, or too broken up. */
  readonly small: number
  /** Walls passed over for having a building right in front of them. */
  readonly crowded: number
}

/** A mesh marked up, and what became of its walls. */
export interface Fitted extends WindowTally {
  /** The mesh marked up, or nothing where no wall took any. */
  readonly geometry: BufferGeometry | undefined
}

const NO_WALLS: Fitted = { geometry: undefined, dressed: 0, blind: 0, small: 0, crowded: 0 }

export interface WindowFit {
  /**
   * How tall a storey is taken to be where the building does not say how many
   * it has, in metres.
   *
   * PLATEAU leaves the storey count out for one building in ten in the newer
   * surveys and four in ten in the older ones, and a wall with no rows on it
   * reads as a building that is not there. So the count is worked out from how
   * high the building stands instead: its ceiling, over this.
   */
  readonly storeyHeight: number
  /**
   * How tall a building has to stand to take windows on every wall, in metres.
   *
   * Above this neither of the two tests below is asked. 0 dresses every wall
   * of every building.
   */
  readonly tall: number
  /** Whether a wall looks at a road, which is the first thing it needs. */
  readonly faces: (wall: Wall) => boolean
  /**
   * Whether a building stands right in front of it, which is the other.
   *
   * A wall can look down a street and still be shut in by the neighbour it was
   * built against, and a window there would look out on that neighbour's wall.
   */
  readonly crowded: (wall: Wall) => boolean
}

/** A wall taking windows, and the field of it they are set out in. */
interface Dressing {
  readonly index: number
  readonly wall: Wall
  readonly field: Field
}

/**
 * Marks up every wall of a mesh that takes windows.
 *
 * Nothing comes back where none of them does, so the mesh can stay as it is;
 * the tally says how many were left and why, which is otherwise invisible — a
 * wall passed over looks like one that was never found.
 */
export function fitWindows(
  geometry: BufferGeometry,
  plan: WallPlan,
  roofs: RoofPlan | null,
  facts: BuildingFacts,
  fit: WindowFit,
): Fitted {
  return atOnce(fittingWindows(geometry, plan, roofs, facts, fit))
}

/**
 * {@link fitWindows} a piece at a time, for a tile being shaped between frames;
 * see `steps.ts`. It stops between walls and between triangles, and builds the
 * new shape in one piece at the end.
 */
export function* fittingWindows(
  geometry: BufferGeometry,
  plan: WallPlan,
  roofs: RoofPlan | null,
  facts: BuildingFacts,
  fit: WindowFit,
): Steps<Fitted> {
  const position = geometry.attributes['position']
  const indexed = geometry.index
  if (!position || !indexed) return NO_WALLS

  const vertexCount = position.count
  const triangleCount = Math.floor(indexed.count / 3)
  const fields = yield* readingFields(plan, position, indexed)
  const ceilings = ceilingsOf(plan, fields, roofs, facts)
  const storeysOf = countStoreys(ceilings.heights, facts, fit.storeyHeight)

  // Which walls take windows, and which triangles are theirs.
  const dressing: Dressing[] = []
  const wallOf = new Int32Array(triangleCount).fill(NOBODY)
  let blind = 0
  let small = 0
  let crowded = 0
  for (let index = 0; index < plan.walls.length; index++) {
    // Each wall asks the roads in front of it and the buildings around it,
    // which is the longest of the work here, so it may stop at every one
    if (index > 0) yield
    const wall = plan.walls[index]
    if (!wall) continue
    const field = fields[index]
    if (!holdsWindows(field)) {
      small++
      continue
    }
    // A building tall enough looks over what stands around it, and is asked
    // neither what it faces nor what is in front of it.
    if ((ceilings.heights.get(wall.building) ?? 0) < fit.tall) {
      if (!fit.faces(wall)) {
        blind++
        continue
      }
      if (fit.crowded(wall)) {
        crowded++
        continue
      }
    }
    dressing.push({ index, wall, field })
    for (const t of wall.members) wallOf[t] = index
  }
  if (dressing.length === 0) return { geometry: undefined, dressed: 0, blind, small, crowded }

  // Which wall each vertex belongs to, where it belongs to only one.
  yield
  const owner = new Int32Array(vertexCount).fill(NOBODY)
  for (let t = 0; t < triangleCount; t++) {
    if (pause(t)) yield
    const wall = wallOf[t] ?? NOBODY
    for (let k = 0; k < 3; k++) {
      const v = indexed.getX(t * 3 + k)
      if (wall === NOBODY) owner[v] = SHARED
      else if (owner[v] === NOBODY) owner[v] = wall
      else if (owner[v] !== wall) owner[v] = SHARED
    }
  }

  const frames = new Float32Array(vertexCount * 4)
  const usages = new Float32Array(vertexCount * 4)
  const outIndex = new Uint32Array(indexed.count)
  for (let i = 0; i < indexed.count; i++) outIndex[i] = indexed.getX(i)

  /** Where each copied vertex came from, so the rest of it can be copied too. */
  const copiedFrom: number[] = []
  const addedFrames: number[] = []
  const addedUsages: number[] = []

  yield
  for (const { index, wall, field } of dressing) {
    const storeys = storeysOf.get(wall.building) ?? 1
    const usage = usageNumber(facts.usages[wall.building] ?? '')
    const height = ceilings.heights.get(wall.building) ?? wall.high
    const ceiling = ceilings.roofed.has(wall.building) ? height : -height
    const width = field.right - field.left
    /** Vertices of this wall that had to be copied, so each is copied once. */
    const copies = new Map<number, number>()

    for (const t of wall.members) {
      for (let k = 0; k < 3; k++) {
        const v = indexed.getX(t * 3 + k)
        // Measured from the field's own start: a vertex outside it comes out
        // below nothing or past its width, and takes no window there.
        const across =
          position.getX(v) * wall.alongX + position.getZ(v) * wall.alongZ - wall.start - field.left
        if (owner[v] === index) {
          frames[v * 4] = across
          frames[v * 4 + 1] = width
          frames[v * 4 + 2] = field.top
          frames[v * 4 + 3] = storeys
          usages[v * 4] = usage
          usages[v * 4 + 1] = ceiling
          usages[v * 4 + 2] = field.foot
          usages[v * 4 + 3] = field.slope
          continue
        }
        let copy = copies.get(v)
        if (copy === undefined) {
          copy = vertexCount + copiedFrom.length
          copies.set(v, copy)
          copiedFrom.push(v)
          addedFrames.push(across, width, field.top, storeys)
          addedUsages.push(usage, ceiling, field.foot, field.slope)
        }
        outIndex[t * 3 + k] = copy
      }
    }
  }

  yield
  const added = copiedFrom.length
  const total = vertexCount + added
  const fitted = new BufferGeometry()

  // Everything the mesh came with, kept where it lies, with the copies after
  // it. A copy stands where the vertex it came from stands, and differs only
  // in what it says about the wall it belongs to.
  for (const name of Object.keys(geometry.attributes)) {
    const source = geometry.attributes[name]
    if (!source) continue
    const size = source.itemSize
    const out = sameWidthAs(source, total * size)
    copyAhead(out, source, vertexCount, size)
    for (let i = 0; i < added; i++) {
      const from = copiedFrom[i] ?? 0
      const to = (vertexCount + i) * size
      out[to] = source.getX(from)
      if (size > 1) out[to + 1] = source.getY(from)
      if (size > 2) out[to + 2] = source.getZ(from)
      if (size > 3) out[to + 3] = source.getW(from)
    }
    fitted.setAttribute(name, new BufferAttribute(out, size))
  }

  const outFrames = new Float32Array(total * 4)
  outFrames.set(frames)
  outFrames.set(addedFrames, vertexCount * 4)
  const outUsages = new Float32Array(total * 4)
  outUsages.set(usages)
  outUsages.set(addedUsages, vertexCount * 4)

  fitted.setAttribute(WINDOW_FRAME, new BufferAttribute(outFrames, 4))
  fitted.setAttribute(WINDOW_USAGE, new BufferAttribute(outUsages, 4))
  fitted.setIndex(new BufferAttribute(outIndex, 1))
  fitted.computeBoundingSphere()
  return { geometry: fitted, dressed: dressing.length, blind, small, crowded }
}
