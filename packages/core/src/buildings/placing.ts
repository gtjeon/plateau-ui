import { Vector3, type BufferAttribute, type Mesh } from 'three/webgpu'
import { APPEAR, stillUnderNow } from '../appear.js'
import { BUILDING_SLOTS } from './attributes.js'
import { movedNow, restingAt } from './slots.js'
import { underfootOf } from './underfoot.js'

/**
 * Where a corner rests, and where the card is drawing it this frame.
 *
 * A building's corners are kept as the survey drew them, with the lowest at a
 * nought of its own: a corner's y is how high it stands over its own ground,
 * and nothing in the geometry says where that ground is or what is being done
 * to the building. Three things are put on top as it is drawn, and all three
 * happen in the vertex stage — see `placeMoved`, which is the shader half of
 * this file.
 *
 * Whoever reads a place off the screen, or puts one back onto it, has to do
 * the same three in the same order. Three readers were each writing them out
 * for themselves — a seat in the world this frame, a click handed back as a
 * place on a wall, a height asked which storey it is on — and the order is not
 * obvious enough to be written three times. A mast and the roof under it part
 * company for exactly as long as a tile takes to come up if one of them has it
 * wrong, which is a second, which is a thing nobody sees reported.
 *
 * What is left out is the wave a page sends across the city, which the shader
 * adds last of all. It is not of this shape: the other three are one number
 * each for a whole building, and the wave is read from where a corner stands
 * on the world, so a building crossed by one is not moved as a piece. The
 * readers above left it out before this file did, and it is nought wherever no
 * page has sent one.
 */
export interface Placing {
  /**
   * How far under its own ground the building still stands, in its own metres.
   *
   * Nought once it has arrived. It is taken off before the move rather than
   * after, because a building being moved, grown or tipped does all of that
   * about its own foot, and what is still coming up is below that foot until
   * it gets there.
   */
  readonly under: number
  /** Which row of the motion table moves it, nought where nothing does. */
  readonly slot: number
  /**
   * How high the land under its foot is, in its own metres.
   *
   * Last, after the move, the way the group a tile hangs from carries where it
   * stands on the map: where a building stands has never been part of its
   * shape here.
   */
  readonly underfoot: number
}

/** @internal The same, writable, which is how a reader fills one in. */
export type PlacingState = { -readonly [K in keyof Placing]: Placing[K] }

/**
 * What is being done to one building of a mesh, read off the mesh itself.
 *
 * All three are one number for a whole building, written onto every corner of
 * it, so any corner of it answers for the rest — which is why the caller hands
 * one in rather than this looking for one. Finding a corner is a walk over
 * every corner of the tile, and the readers that want this have had to make
 * that walk already.
 *
 * Filled into a held object rather than made, since the callers ask per click
 * and per frame and none of them keeps the answer.
 */
export function placingOn(mesh: Mesh, building: number, corner: number, into: PlacingState): Placing {
  const slots = mesh.geometry.attributes[BUILDING_SLOTS] as BufferAttribute | undefined
  const appear = mesh.geometry.attributes[APPEAR] as BufferAttribute | undefined
  into.under = appear ? stillUnderNow(appear.getX(corner), appear.getY(corner)) : 0
  into.slot = slots ? slots.getW(corner) : 0
  into.underfoot = underfootOf(mesh)?.[building] ?? 0
  return into
}

/**
 * Where a corner at rest is being drawn this frame, in the mesh's own metres.
 *
 * The three in the shader's order. Reading it the other way is {@link atRest}.
 */
export function drawnNow(by: Placing, x: number, y: number, z: number, into: Vector3): Vector3 {
  movedNow(by.slot, x, y - by.under, z, into)
  into.y += by.underfoot
  return into
}

/**
 * Where a corner the card drew would be with none of it done: {@link drawnNow}
 * read backwards.
 *
 * For whoever is handed a point off the screen — a click lands where the
 * building is now — and wants the place on the building it belongs to, which is
 * the one worth keeping. A building's own shape is the thing a page measured
 * and the thing it will measure again; where this frame caught it is not.
 */
export function atRest(by: Placing, x: number, y: number, z: number, into: Vector3): Vector3 {
  restingAt(by.slot, x, y - by.underfoot, z, into)
  into.y += by.under
  return into
}
