import { CanvasTexture, SRGBColorSpace } from 'three/webgpu'
import type { LoadFailure } from './events.js'
import type { Texel } from './pictureSheet.js'
import { ReadBack } from './readBack.js'
import { transient } from './transient.js'
import type { Ask } from './requests.js'

/**
 * One picture fetched whole, held on a canvas for the card to read and for
 * the processor to read back: what every layer that takes a picture in one
 * piece fetches it with.
 *
 * The other half of `tileWindow.ts`, which fetches a picture in tiles. Taken
 * out of `ImageLayer` once a second layer wanted the same picture the same
 * way (`ImageExtrusionLayer`), so that asking again, drawing a picture too
 * large for a card down to fit, and reading a texel back are written once —
 * the reason `TileWindow` was taken out of `ImageTileLayer`.
 *
 * What an owner does once the picture is in, or gone, is the owner's: it is
 * told ({@link OnePictureOptions.landed}, {@link OnePictureOptions.gone}).
 */
export interface OnePictureOptions {
  /** Where the picture is. */
  readonly url: string
  /** How to fetch: the viewer's `transformRequest` once there is one. */
  readonly ask: () => Ask
  /** A failure, told as every fetching layer tells one; see contract 7. */
  readonly told: (failure: LoadFailure) => void
  /** The picture is on the canvas. */
  readonly landed: () => void
  /** The picture that was on the canvas has been let go of. */
  readonly gone: () => void
}

export class OnePicture {
  /**
   * The picture, held on a canvas.
   *
   * A canvas rather than the image itself because a node woven into a shader
   * holds one texture for good — a picture arriving later has to be drawn into
   * what is already there rather than handed over in its place. It starts one
   * pixel square and clear, so that there is a picture to weave before there
   * is a picture.
   */
  private readonly canvas = new OffscreenCanvas(1, 1)
  private readonly paper: OffscreenCanvasRenderingContext2D
  /** The picture's pixels as read back for {@link colorAt}, kept until it is drawn on again. */
  private readonly read: ReadBack
  /** The picture as the card reads it. The object, for good: what is in it is swapped. */
  readonly texture = new CanvasTexture(this.canvas as unknown as HTMLCanvasElement)

  private readonly options: OnePictureOptions
  private _url: string
  /** Whether the owner is on a map, which is when the picture is wanted. */
  private wanted = false
  /** Whether the picture has landed. */
  private _showing = false
  private lives = new AbortController()
  /** Whether it is on its way, so that it is not asked for twice. */
  private asking = false
  /** When a picture that failed is worth asking for again; see contract 4. */
  private askAgainAt = Infinity
  private wait = 0

  constructor(options: OnePictureOptions) {
    this.options = options
    this._url = options.url
    // Kept where reading it back is cheap. A picture comes once and is read
    // back whole by a layer that stands it up, and a pixel at a time by a page
    // asking `colorAt` of every house it holds; on the card, the first read
    // stops the page while the card catches up (`readBack.ts`)
    const paper = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!paper) throw new Error('OnePicture: no 2d context')
    this.paper = paper
    this.read = new ReadBack(paper)
    // Row nought is the top row, which is the north edge; left to itself
    // three would turn the picture over to suit a model's own uv
    this.texture.flipY = false
    this.texture.colorSpace = SRGBColorSpace
  }

  /** Where the picture is. Another address lets the one in hand go and fetches the new one. */
  get url(): string {
    return this._url
  }

  set url(value: string) {
    if (this._url === value) return
    this._url = value
    this.forget()
    if (this.wanted) this.ask()
  }

  /** Whether the picture has landed. */
  get showing(): boolean {
    return this._showing
  }

  /** Whether it is on its way; see `Layer.busy`. */
  get busy(): boolean {
    return this.asking
  }

  /** How many pixels the picture is, across and down, as it is held. */
  get width(): number {
    return this.canvas.width
  }

  get height(): number {
    return this.canvas.height
  }

  /** The owner went on a map: the picture is fetched. */
  attach(): void {
    this.wanted = true
    this.ask()
  }

  /** The owner came off it: the picture is let go of. */
  detach(): void {
    this.wanted = false
    this.forget()
  }

  /**
   * Once a frame: a picture that failed is asked for again when its wait is
   * up, which is the waking path contract 4 asks for.
   */
  frame(): void {
    if (!this.wanted || performance.now() < this.askAgainAt) return
    this.askAgainAt = Infinity
    this.ask()
  }

  /**
   * The texel at a spot of the picture, nought to one each way, as published
   * — or null until the picture has landed. See `ImageLayer.colorAt`.
   */
  colorAt(spot: readonly [number, number]): Texel | null {
    if (!this._showing) return null
    const x = Math.min(this.canvas.width - 1, Math.floor(spot[0] * this.canvas.width))
    const y = Math.min(this.canvas.height - 1, Math.floor(spot[1] * this.canvas.height))
    return this.read.texel(x, y)
  }

  /** Every texel of the picture as it is held, or null until it has landed. */
  texels(): ImageData | null {
    if (!this._showing) return null
    return this.paper.getImageData(0, 0, this.canvas.width, this.canvas.height)
  }

  dispose(): void {
    this.wanted = false
    this.lives.abort()
    this.texture.dispose()
  }

  /**
   * Fetches the picture.
   *
   * Asked once. A host that is busy or broken — what {@link transient} calls
   * temporary — is asked again after a wait that doubles, and {@link frame}
   * is what comes back to ask. Anything else is an answer: there is no such
   * picture, and a page is told so once.
   */
  private ask(): void {
    if (this.asking || this._showing) return
    this.asking = true
    void this.load()
  }

  /**
   * Named as the tile window names its own, and not `fetch`: a method called
   * that beside a bare `fetch(...)` reads as a loop and is not one.
   */
  private async load(): Promise<void> {
    const signal = this.lives.signal
    const url = this._url
    try {
      const answer = await this.options.ask()(url, 'image', { signal })
      if (!answer.ok) {
        if (transient(answer.status)) throw new Error(`HTTP ${answer.status}`)
        this.options.told({ what: 'picture', key: url, retrying: false, cause: new Error(`HTTP ${answer.status}`) })
        return
      }
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(await answer.blob())
      } catch (cause) {
        // It came and is not a picture — a page of HTML handed back as 200 by
        // a host at the wrong address, say. The same bytes come back every
        // time, so it is said once and not asked for again (see `Unreadable`)
        if (signal.aborted) return
        this.options.told({ what: 'picture', key: url, retrying: false, cause })
        return
      }
      if (signal.aborted) {
        bitmap.close()
        return
      }
      this.paint(bitmap)
      this.wait = 0
    } catch (cause) {
      if (signal.aborted) return
      this.wait = Math.min(this.wait ? this.wait * 2 : FIRST_WAIT, LONGEST_WAIT)
      this.askAgainAt = performance.now() + this.wait
      this.options.told({ what: 'picture', key: url, retrying: true, cause })
    } finally {
      this.asking = false
    }
  }

  /** Puts a picture that has landed on the canvas the card reads. */
  private paint(bitmap: ImageBitmap): void {
    // No side over what a card is sure to hold. Larger is drawn down to it,
    // keeping its shape, rather than handed to a card that may refuse it
    const shrink = Math.min(1, LARGEST_PICTURE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * shrink))
    const height = Math.max(1, Math.round(bitmap.height * shrink))
    this.resize(width, height)
    this.paper.drawImage(bitmap, 0, 0, width, height)
    this.read.forget()
    bitmap.close()
    this.texture.needsUpdate = true
    this._showing = true
    this.options.landed()
  }

  /**
   * Gives the canvas a new size, and the card a new texture for it.
   *
   * Three makes what it puts on the card once, at the size the canvas was the
   * first time a material read it, and marking the texture changed after that
   * only writes into what it made. Letting go of what is on the card is what
   * has it made afresh; the texture object stays, which is what the materials
   * hold. A new `url` arriving over the old one is a picture of another size.
   */
  private resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return
    this.canvas.width = width
    this.canvas.height = height
    this.texture.dispose()
    this.read.forget()
  }

  /** Lets the picture go, and starts again. */
  private forget(): void {
    const had = this._showing
    this.lives.abort()
    this.lives = new AbortController()
    this.asking = false
    this.askAgainAt = Infinity
    this.wait = 0
    this._showing = false
    this.resize(1, 1)
    this.texture.needsUpdate = true
    if (had) this.options.gone()
  }
}

/** How long to wait before asking again for a picture that failed, and the most. */
const FIRST_WAIT = 2_000
const LONGEST_WAIT = 60_000

/**
 * The longest side a picture is drawn at, in pixels: the most a WebGPU device
 * holds in one texture unless it is asked for more, which three does not ask.
 */
const LARGEST_PICTURE = 8192
