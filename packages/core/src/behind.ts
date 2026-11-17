import {
  CustomBlending,
  GreaterDepth,
  LessEqualDepth,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
  type Material,
} from 'three/webgpu'

/**
 * What a thing a page puts on the map does where something stands between it
 * and the camera, and the halves it is drawn in to do it.
 *
 * Here rather than with either of the layers that ask. A mark and a line
 * painted on the land answer the same question, and a page that told one of
 * them `'dim'` means by it what it means telling the other — so the words, and
 * what they come to in depth, are said once.
 *
 * Which of a frame's two halves a thing is drawn in is the same kind of thing
 * and is said here too; see {@link blendOverOpaque}.
 */

/**
 * Blends a material in the opaque half of the frame rather than the
 * transparent one.
 *
 * Three splits the render list by `transparent` and draws every opaque thing
 * before any see-through one, so a thing left to the transparent half is drawn
 * after everything opaque whatever number it carries — the split comes before
 * the sorting. On a ground where nothing laid on the land writes depth, that
 * means over the roads, the footprints, the marks and the models standing on
 * it — a painted area would cover its own outline, and the water's bank would
 * be laid over the streets. Blended here, the number is what decides, which is
 * where this map keeps the order; see `order.ts`.
 *
 * Only the colour is blended. The alpha underneath is left, so a thing fading
 * out does not eat the hole the backdrop is read through.
 *
 * `transparent` is already false on a fresh material; it is written all the
 * same, because a caller handing one that is not would otherwise get the
 * opposite of what it asked for and nothing would say so.
 */
export function blendOverOpaque(material: Material): void {
  material.transparent = false
  material.blending = CustomBlending
  material.blendSrc = SrcAlphaFactor
  material.blendDst = OneMinusSrcAlphaFactor
  material.blendSrcAlpha = ZeroFactor
  material.blendDstAlpha = OneFactor
}

/**
 * `'dim'` draws it faint through whatever hides it, `'hide'` leaves it hidden,
 * and `'show'` draws it as though nothing stood in front.
 *
 * A city seen at a slant hides a great deal of itself, so `'dim'` is the
 * default: a thing that simply vanished behind the block in front would be no
 * use, and one drawn at full strength through everything reads as floating off
 * the map.
 */
export type Behind = 'dim' | 'hide' | 'show'

/**
 * What one drawing of a thing reads of the depth already there, which is
 * settled on the material rather than in its colour.
 *
 * `'over'` draws all of it, reading no depth at all. The other two are the
 * halves of one thing: `'ahead'` draws it where nothing is in front of it, and
 * `'behind'` draws only the rest — the part something stands in front of —
 * faint. The two tests are each other's opposite, so a thing handed to both is
 * drawn once everywhere and never twice anywhere.
 */
export type Draws = 'over' | 'ahead' | 'behind'

/** Which halves each answer is drawn in. */
export const DRAWN_BY: Record<Behind, readonly Draws[]> = {
  show: ['over'],
  hide: ['ahead'],
  dim: ['ahead', 'behind'],
}

/**
 * The order the three are drawn in, inside the stage the layer was given.
 *
 * `'ahead'` and `'behind'` are each other's opposite and never meet, so the
 * number between those two decides nothing; `'over'` reads no depth at all and
 * can land on either, and it goes last because that is what the word says —
 * drawn as though nothing stood in front.
 *
 * Written on the mesh rather than left to where it sits in the group, because
 * the renderer sorts and none of these writes depth: the sorter would break the
 * tie by the centre of a bounding sphere, which for marks all standing on one
 * card is the same point, and the answer would come out of the order the cards
 * happened to be made in. See `order.ts`.
 */
export const DRAWN_AT: Record<Draws, number> = { ahead: 0, behind: 1, over: 2 }

/**
 * How much of a dimmed thing shows through what hides it.
 *
 * Enough to be followed behind a block, and little enough that an eye reads it
 * as being behind one rather than as another thing in front.
 *
 * What each of the two layers does with it is its own: a shape mixes its
 * colour towards the backdrop before the frame's tone curve (`shapes/paint.ts`,
 * `tinted`), while a mark lowers its alpha and is blended under the curve, its
 * colour held to reflectance one so that its white has somewhere to go — the
 * price being that a dimmed white never quite reaches the paper's. See
 * `annotations/mesh.ts`, which measures both.
 */
export const DEFAULT_DIMMED = 0.35

/**
 * Tells a material what to read of the depth already there, so that two layers
 * answering the same word answer it the same way.
 *
 * None of them writes depth: these are drawn over the city rather than being
 * part of it, and one writing depth would cut a hole in the next where the two
 * cross. `'behind'` turns the test round — it keeps the fragments a depth test
 * would throw away — and that is the only thing parting it from `'ahead'`, so
 * a layer handing its shape to both weaves one shader for the two.
 */
export function readDepth(material: Material, draws: Draws): void {
  material.depthWrite = false
  material.depthTest = draws !== 'over'
  material.depthFunc = draws === 'behind' ? GreaterDepth : LessEqualDepth
}

/** How much of a dimmed thing shows, as a page asked for it and held to what it can be. */
export function dimming(asked: number | undefined): number {
  return Math.min(Math.max(asked ?? DEFAULT_DIMMED, 0), 1)
}

/**
 * How hard a thing lying on the land is pressed toward the camera, as three
 * names it: a flat term and a slope term.
 *
 * Here for the reason the rest of this file is: the ground's own pieces are
 * not the only things laid on the land, and a second layer that lays anything
 * there has to press it by the same amount or the two disagree about which is
 * the land. Read the whole of why at LAID_ON_THE_LAND in `ground/materials.ts`,
 * which is where what the ground draws is settled.
 *
 * Not a lift. Raised by so many metres a road would sit that far off the
 * ground, and it moves on the screen as it rises. This moves nothing — only
 * the depth each fragment is measured at — so a road is drawn exactly along
 * the line it runs and only wins the ties.
 *
 * What has to be cleared is not the last bit of the depth buffer. The two
 * meshes are two guesses at one hillside: the surface reads the land on a
 * lattice cut to the view, a shape reads it at its own corners and is halved
 * until it is within half a metre of it (`drape.ts`), and neither owes the
 * other agreement. Half a metre is some two pixels at the zooms a slope is
 * looked at, and a few pixels is what this is set to clear.
 *
 * A pixel is about 1,500 of these, and it stays about that at every zoom:
 * the unit is the depth buffer's own step, the viewer opens the depth to
 * twelve times the width of the view (see `Viewer`'s reach), and so both grow
 * together as the map is zoomed. It stops holding where the viewer's depth
 * stops shrinking, at a view some 400m across, and from there in the press
 * widens in pixels — at those zooms there is nothing left for it to wrongly
 * uncover.
 *
 * The slope term is over and above it, for where the ground runs away from
 * the camera and a cell of the lattice covers more depth than it does screen:
 * that is where two guesses part furthest, and it is the same steepness the
 * card already has in hand.
 */
const PRESSED_SLOPE = -2
const PRESSED_FLAT = -5000

/**
 * Presses a material toward the camera by what it takes to win a tie with the
 * land, and nothing more. See {@link PRESSED_SLOPE}.
 *
 * Said apart from {@link readDepth} because the two answer different
 * questions — what to read of the depth already there, against how to stand
 * to the land it is lying on — and a thing may want one, the other or both.
 */
export function pressToLand(material: Material): void {
  material.polygonOffset = true
  material.polygonOffsetFactor = PRESSED_SLOPE
  material.polygonOffsetUnits = PRESSED_FLAT
}
