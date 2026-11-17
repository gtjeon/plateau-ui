import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three/webgpu'

/**
 * Anything that goes on a sheet: a canvas, and nothing else asked of it.
 *
 * Narrow on purpose. A mark's picture carries where the mark's own place falls
 * inside it and a building's decal does not, and neither is the sheet's
 * business — what it packs by is a size, and what it draws is a canvas.
 */
export interface Sheeted {
  readonly canvas: OffscreenCanvas
}

/** Where one picture ended up, as the shader reads it: a rectangle in 0 to 1. */
export interface Patch {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Pixels left between pictures, so a sampler reading near an edge takes none of the next. */
const GAP = 2

/** The smallest sheet, and the widest — every card takes a texture this size. */
const FIRST = 512
const WIDEST = 4096

/**
 * Every mark's picture on one sheet, so the whole of them is one texture and
 * one draw.
 *
 * Packed afresh whenever the marks change rather than patched in place. The
 * marks on a page are few and a change is something a person did, so the cost
 * is a canvas redrawn between two frames — against which holding freed
 * rectangles, and the seams that come of reusing them, would be machinery
 * bought for a saving nobody can see.
 */
export class Atlas {
  private canvas = new OffscreenCanvas(FIRST, FIRST)
  private _texture: CanvasTexture<OffscreenCanvas> = new CanvasTexture(this.canvas)

  constructor() {
    this.dress()
  }

  /**
   * The sheet as a material reads it. The same one for the life of the atlas.
   *
   * A material reads this once, as it is woven, and three weaves a shader per
   * material — so a card drawing marks is bound to whichever texture object
   * stood here when it was built, and swapping in another leaves it reading
   * the one it was given. The sheet grows by the canvas behind this growing,
   * never by this being replaced.
   */
  get texture(): CanvasTexture<OffscreenCanvas> {
    return this._texture
  }

  /**
   * Lays the pictures out and draws them, giving back where each one landed.
   *
   * On shelves: a row as tall as the first picture put in it, filled across
   * before the next row is begun, with the tallest laid first so a row is not
   * left tall for one picture and empty for the rest.
   */
  /** Whether one picture fits on a sheet at all, on its own. */
  holds(picture: Sheeted): boolean {
    return picture.canvas.width <= WIDEST && picture.canvas.height <= WIDEST
  }

  pack(pictures: readonly Sheeted[]): Patch[] {
    const order = pictures
      .map((picture, at) => ({ picture, at }))
      .sort((a, b) => b.picture.canvas.height - a.picture.canvas.height)

    let size = FIRST
    let placed = this.lay(order, size)
    while (!placed && size < WIDEST) {
      size *= 2
      placed = this.lay(order, size)
    }
    if (!placed) throw new Error('Atlas: these pictures do not fit on one sheet')

    // The canvas grows; the texture over it does not change. Resizing clears
    // it, which is what the packing wants anyway.
    if (this.canvas.width !== size) {
      this.canvas.width = size
      this.canvas.height = size
      // What three built on the card, though, is made once, at whatever size
      // the sheet was the first time it was drawn, and marking the texture as
      // changed only writes into that. So a grown sheet is pushed into a
      // texture still the old size, and every rectangle — measured against the
      // new size — reads a corner of it: measured, the marks came out as
      // letters four times too big, with nothing said on the console.
      // Throwing away what is on the card is the one thing that asks for it
      // afresh. The texture object itself stays, which is what the material
      // reads; see `texture`. Three drops the bindings pointing at the old one
      // as it goes.
      this._texture.dispose()
    }

    const paper = this.canvas.getContext('2d')
    if (!paper) throw new Error('Atlas: this browser draws no 2d canvas')
    paper.clearRect(0, 0, size, size)
    const patches: Patch[] = new Array<Patch>(pictures.length)
    for (const [i, { picture, at }] of order.entries()) {
      const spot = placed[i]
      if (!spot) continue
      paper.drawImage(picture.canvas, spot.x, spot.y)
      patches[at] = {
        x: spot.x / size,
        y: spot.y / size,
        width: picture.canvas.width / size,
        height: picture.canvas.height / size,
      }
    }
    this._texture.needsUpdate = true
    return patches
  }

  dispose(): void {
    this._texture.dispose()
  }

  /** Where each picture would go on a sheet this size, or nothing where they do not all fit. */
  private lay(order: readonly { picture: Sheeted }[], size: number): { x: number; y: number }[] | null {
    const spots: { x: number; y: number }[] = []
    let shelfTop = GAP
    let shelfHigh = 0
    let across = GAP
    for (const { picture } of order) {
      const width = picture.canvas.width
      const height = picture.canvas.height
      if (width + GAP * 2 > size) return null
      if (across + width + GAP > size) {
        shelfTop += shelfHigh + GAP
        shelfHigh = 0
        across = GAP
      }
      if (shelfTop + height + GAP > size) return null
      spots.push({ x: across, y: shelfTop })
      across += width + GAP
      shelfHigh = Math.max(shelfHigh, height)
    }
    return spots
  }

  /**
   * The settings a new sheet gets, kept away from the packing.
   *
   * There is one sheet and one texture over it for the life of the atlas, so
   * these are said once, at the start. The packing makes no second one: it
   * grows the canvas and throws away what the card built, which is what keeps
   * a material reading the same texture object it was woven with; see `pack`.
   *
   * The context is asked for here and the answer thrown away. A canvas nobody
   * has drawn on has no bitmap behind it, and a card handed one of those warns
   * that it could not read the image and leaves the texture unset — which a
   * sheet made before anything is on it would do on its very first frame.
   */
  private dress(): void {
    this.canvas.getContext('2d')
    // The rectangles are measured down from the sheet's top, the way the
    // pictures were drawn on it, so the sheet must not be turned over on its
    // way to the card.
    this._texture.flipY = false
    this._texture.colorSpace = SRGBColorSpace
    this._texture.minFilter = LinearFilter
    this._texture.magFilter = LinearFilter
    this._texture.generateMipmaps = false
  }
}
