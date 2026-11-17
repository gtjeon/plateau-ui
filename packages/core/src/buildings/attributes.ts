import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three/webgpu'

/**
 * Reading a tile's attributes out into arrays of our own.
 *
 * A tile arrives Draco compressed, and what comes back of it is not laid out
 * the way a fresh geometry would be: some attributes are interleaved, a vertex
 * worth of numbers a stride apart, and some are normalized bytes standing for
 * something else. Both of the things we do to a mesh — cutting parapets into
 * its roofs, setting windows into its walls — keep the vertices it came with
 * and add more after them, so both need the same thing: the old numbers at the
 * head of a longer array.
 */

/** Any of the arrays an attribute's numbers can lie in. */
export type Numbers =
  Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array

/** Either kind of attribute a geometry can hold. */
export type Attribute = BufferAttribute | InterleavedBufferAttribute

/** The attribute that says which building each vertex belongs to, by its place in the tile. */
export const BATCH_ID = '_batchid'

/**
 * Where a mesh keeps how tall each of its buildings stands, in metres, by the
 * tile's own number for it.
 *
 * Read off the shape as it arrives rather than from what the survey says it
 * measures: `bldg:measuredHeight` is the building, and the shape is the
 * building with its mast on top — the tower at 押上 says 355m and stands 635m.
 * Taken where every corner is walked anyway (see `seat`), and before a
 * parapet is cut or a window set, so it is the shape the survey drew.
 */
export const BUILDING_HEIGHTS = 'plateauHeights'

/**
 * The four numbers a corner carries about what has been decided for its
 * building, rather than about the shape the survey drew.
 *
 * `x` is the column of the paint table it reads, `y` whether the page has
 * taken the building out of the city, `z` which building in the scene it
 * belongs to — written so a screen can tell one outline from another — and `w`
 * the row of the motion table it is moved by, nought standing still.
 *
 * One attribute for the four because a card will not take another: a
 * building's corners already fill every vertex buffer WebGPU promises, and a
 * component costs a component where an attribute of its own costs a whole
 * buffer. They belong together besides — not one of them is what the survey
 * says a building is, and all of them are what something has since said of it.
 *
 * The halves are written by different hands and must not rub each other out.
 * `BuildingStyles.mark` writes x, y and z over every corner of a mesh; the
 * motions write w on the corners of whatever they are moving, and a corner
 * nobody is moving keeps whatever was there. Neither reaches past its own.
 */
export const BUILDING_SLOTS = 'plateauSlots'

/**
 * What reading the shape of a building mesh needs: its corners, which way they
 * face, whose they are, and the faces between them.
 */
export interface Shell {
  readonly position: Attribute
  readonly normal: Attribute
  readonly batch: Attribute
  readonly indexed: BufferAttribute
}

/** A building mesh's shell, or nothing where any of it is missing. */
export function shellOf(geometry: BufferGeometry): Shell | undefined {
  const position = geometry.attributes['position']
  const normal = geometry.attributes['normal']
  const batch = geometry.attributes[BATCH_ID]
  const indexed = geometry.index
  if (!position || !normal || !batch || !indexed) return undefined
  return { position, normal, batch, indexed }
}

/**
 * Copies an attribute into the head of a longer array, a run at a time where
 * it lies that way.
 *
 * The vertices that are kept are unchanged, so the copy is the whole point of
 * it; asking for them one number at a time is what it used to cost. Draco
 * hands some attributes back interleaved, where a vertex's numbers sit a
 * stride apart, and those are still read through the attribute.
 */
export function copyAhead(out: Numbers, attribute: Attribute, count: number, itemSize: number): void {
  const array = attribute.array
  const packed =
    !attribute.normalized &&
    attribute.itemSize === itemSize &&
    !(attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    array.length === count * itemSize
  if (packed) {
    out.set(array as unknown as ArrayLike<number>)
    return
  }
  for (let v = 0; v < count; v++) {
    out[v * itemSize] = attribute.getX(v)
    if (itemSize > 1) out[v * itemSize + 1] = attribute.getY(v)
    if (itemSize > 2) out[v * itemSize + 2] = attribute.getZ(v)
    if (itemSize > 3) out[v * itemSize + 3] = attribute.getW(v)
  }
}

/** An array of the same kind as an attribute's, long enough for the new one. */
export function sameWidthAs(attribute: Attribute, length: number): Numbers {
  // A normalized number is not the number it stands for. What it is read out
  // as is the fraction it stands for, so that is what is kept, and the new
  // attribute holds it as a plain float rather than normalized again.
  if (attribute.normalized) return new Float32Array(length)
  const kind = attribute.array.constructor as Uint32ArrayConstructor
  return new kind(length)
}
