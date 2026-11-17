import { AlwaysStencilFunc, KeepStencilOp, ReplaceStencilOp, type Material } from 'three/webgpu'

/**
 * Painting a shape onto the ground as drawn, rather than onto a copy of it.
 *
 * The other way is to cut the shape until it can follow the land and lay it
 * down — which is what `drape.ts` does, and what every line here still does.
 * It has one cost that cannot be worked around: where a shape lies is baked
 * into its corners, so every tile of heights that lands under it means cutting
 * it again. Over the twenty-three wards of 東京 that was 296ms a time, and a
 * zoom brings tiles in for as long as it lasts.
 *
 * Classification asks the question at the other end. A box is built over the
 * shape once — see `shapes/volume.ts` — and each frame the box is counted into
 * the stencil buffer, front faces down and back faces up. A pixel whose ground
 * lies inside the box comes out marked; one whose ground lies beside it does
 * not. Then the colour is laid over the marked pixels. Nothing is ever cut
 * again, and the fill lands on the ground to the pixel.
 *
 * The bits of the stencil buffer are shared, so they are parcelled out here
 * rather than by whoever writes them.
 */

/**
 * The bit a thing leaves behind it to say the pixel is ground.
 *
 * Every solid that writes depth has to say which it is — not only the ground.
 * The ground draws first and leaves its mark; a building that then replaced
 * the depth and left the mark standing would hand the pixel to whoever asked
 * for ground alone, and the ward's colour would climb the tower.
 */
export const CLASSIFY_LAND = 0x80

/** The rest of the buffer, where a box counts how deep into itself each pixel is. */
export const CLASSIFY_COUNT = 0x7f

/**
 * Leaves the mark that says this pixel is ground.
 *
 * Two things wear it: the ground's `surface`, the one sheet laid under all of
 * it, and the trees standing on that. A tree grows where it is rather than
 * having been put there, so it counts as land and a wash over a park covers
 * its crowns; see `paints.ts`.
 *
 * Both of them write depth, which is what makes this a choice at all —
 * whatever does not write depth leaves standing whatever mark is under it.
 */
export function marksLand(material: Material): void {
  marks(material, CLASSIFY_LAND)
}

/**
 * Takes that mark off the pixels a built solid covers.
 *
 * Everything put on the land that writes depth: the city, a page's own
 * models, the solids a map is stood on. It is easy to see why only after it
 * has been got wrong — the ground draws first and leaves its mark, so a
 * building that replaces the depth and leaves the mark standing hands the
 * pixel over as ground. Measured in the spike, that put the ward's colour up
 * the whole face of the tower standing in it.
 *
 * The trees are the one solid that does not, since they are land; see
 * {@link marksLand}.
 */
export function marksSolid(material: Material): void {
  marks(material, 0)
}

/** Writes one value into the one bit, wherever the thing wins the depth test. */
function marks(material: Material, value: number): void {
  material.stencilWrite = true
  material.stencilFunc = AlwaysStencilFunc
  material.stencilRef = value
  material.stencilFail = KeepStencilOp
  material.stencilZFail = KeepStencilOp
  material.stencilZPass = ReplaceStencilOp
  // The one bit and no other: the rest belongs to whatever box is counting
  // itself into the buffer at the time
  material.stencilWriteMask = CLASSIFY_LAND
  material.stencilFuncMask = CLASSIFY_LAND
}
