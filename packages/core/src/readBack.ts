import type { Texel } from './pictureSheet.js'

/**
 * The pixels of a canvas, read back a block at a time and kept until the
 * canvas is drawn on again.
 *
 * A canvas the browser keeps on the card answers a read with a trip there and
 * back, and a page asking `colorAt` of every house it holds asks one pixel a
 * house: nineteen hundred trips for the flood example's circle, every time a
 * tile of the picture landed. The page froze for seconds at a time while the
 * view was zoomed (measured: a frame of 2.7 s). Read here, the first pixel
 * asked of a block brings the whole block over once and every other pixel of
 * it is a look into what came; a canvas only ever shown is never read, so it
 * stays on the card where it draws fastest.
 *
 * Blocks rather than the whole canvas, because a picture may be 8192 pixels
 * a side, and a quarter of a gigabyte held to answer one place is not what
 * reading a place should cost.
 */
export class ReadBack {
  private readonly paper: OffscreenCanvasRenderingContext2D
  private readonly blocks = new Map<number, ImageData>()

  constructor(paper: OffscreenCanvasRenderingContext2D) {
    this.paper = paper
  }

  /** The canvas was drawn on: everything read before is stale. */
  forget(): void {
    this.blocks.clear()
  }

  /** The texel at a pixel of the canvas, which the caller has kept inside it. */
  texel(x: number, y: number): Texel {
    const across = Math.floor(x / BLOCK)
    const down = Math.floor(y / BLOCK)
    const key = down * KEY + across
    let block = this.blocks.get(key)
    if (!block) {
      const canvas = this.paper.canvas
      const width = Math.min(BLOCK, canvas.width - across * BLOCK)
      const height = Math.min(BLOCK, canvas.height - down * BLOCK)
      block = this.paper.getImageData(across * BLOCK, down * BLOCK, width, height)
      this.blocks.set(key, block)
    }
    const at = ((y - down * BLOCK) * block.width + (x - across * BLOCK)) * 4
    const data = block.data
    return { r: data[at] ?? 0, g: data[at + 1] ?? 0, b: data[at + 2] ?? 0, a: data[at + 3] ?? 0 }
  }
}

/** How many pixels a block is each way. */
const BLOCK = 256

/** Room for a row of blocks in a key: more than any canvas a card holds has. */
const KEY = 1 << 16
