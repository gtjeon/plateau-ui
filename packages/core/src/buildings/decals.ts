import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu'

/**
 * How many pixels a picture is held at, along each side.
 *
 * Every layer of an array texture is the same size, so a picture is squeezed
 * into this square whatever shape it came in and stretched back to its own
 * shape where it is drawn. 512 is enough for a marking read from a rooftop at
 * the closest zoom the city stands at, and a layer of it is a megabyte.
 */
const LAYER_SIZE = 512

/**
 * How many pictures one `Buildings` holds at once: as many layers as a device
 * gives an array texture by default.
 *
 * Not a number of the library's own. The device a viewer asks for is given
 * the limits every device has to meet, and an array texture of 256 layers is
 * one of them — WebGPU's `maxTextureArrayLayers` by default, and the least
 * WebGL2 allows for `MAX_ARRAY_TEXTURE_LAYERS`. Past that the card refuses the
 * texture, so a picture past it is not painted and the console says so.
 *
 * _(Until 2026-10-29 it was 16, which was the library's: "a page marking every
 * roof in sight is a page marking a dozen". What a picture costs is memory —
 * a layer is a megabyte, a third more with its shrunken copies, and the
 * same again here on the processor — and that is the page's to spend, as it
 * spends it on every other thing it puts on the map. Nothing is slower for
 * more: every face reads the one texture however many layers it has.)_
 */
export const MOST_PICTURES = 256

/**
 * Layers the texture is made with. It doubles from here as pictures come in,
 * so the room is bought when it is wanted rather than at the start.
 *
 * Which matters because the overwhelming case is a page that paints no
 * picture on anything. Every `Buildings` holds one of these whether or not a
 * picture is ever asked for, and every layer up front would be a quarter of a
 * gigabyte on the card for a map that will never draw one.
 */
const FIRST_LAYERS = 1

/** Whatever a page hands over to be cut into a building. */
export type DecalImage = HTMLCanvasElement | HTMLImageElement | OffscreenCanvas

/** One picture in one layer, and how many buildings are wearing it. */
interface Held {
  readonly image: DecalImage
  readonly layer: number
  worn: number
}

/**
 * The pictures cut into buildings, one layer of one texture apiece.
 *
 * An array texture rather than a sheet with them packed side by side. A sheet
 * has to be laid out afresh every time a picture is added, which moves where
 * the others sit on it and means every building wearing one has to be told
 * again — and a page that marks a second roof would otherwise find the first
 * one reading the wrong corner of the sheet. A layer added here moves nothing,
 * and adding one is the whole of what this feature does: a reader presses one
 * roof, then another.
 *
 * What it costs is that every picture is held at one size: a wide sign and a
 * round marking take the same square, and a picture smaller than the square is
 * stretched up to it. That is the trade the other way round from a sheet, and
 * it is the one worth making here — the pictures are few, and a decal being in
 * the wrong place is worse than a decal being soft.
 */
export class DecalLayers {
  private depth = FIRST_LAYERS
  private pixels = new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * FIRST_LAYERS)
  private readonly sheet = new DataArrayTexture(this.pixels, LAYER_SIZE, LAYER_SIZE, FIRST_LAYERS)
  /** Which layer each picture went into, so the same one twice is one layer. */
  private readonly held = new Map<DecalImage, Held>()
  /**
   * Pictures nobody wears, the longest let go first, still drawn in their
   * layers: a layer is only painted over once another picture wants the room.
   *
   * Because taking a marking off a roof and putting it back is one press and
   * then another press, and the picture is the page's own canvas either way.
   * Clearing the layer on the way out would mean drawing it again on the way
   * in for nothing. A `Set` hands back what went in first, which is the one
   * let go longest ago.
   */
  private readonly loose = new Set<Held>()
  /** The lowest layer never given out. */
  private next = 0
  /** The one canvas every picture is squeezed through. */
  private scratch: OffscreenCanvas | null = null

  constructor() {
    this.sheet.colorSpace = SRGBColorSpace
    this.sheet.type = UnsignedByteType
    this.sheet.magFilter = LinearFilter
    // Shrunken copies, kept because a marking is read from much further off
    // than it is drawn for: pulled back to where a 22m helipad is ten pixels
    // across, a sampler with one size to read picks ten pixels out of 512 and
    // picks different ones as the camera moves, which crawls.
    this.sheet.minFilter = LinearMipmapLinearFilter
    this.sheet.generateMipmaps = true
    this.sheet.needsUpdate = true
  }

  /**
   * The texture as a material reads it. The same one for the life of this.
   *
   * A material reads it once, as it is woven, so what is handed over must not
   * be replaced afterwards — the layers are written into the array behind it,
   * and growing swaps that array rather than this; see {@link grow}.
   */
  get texture(): DataArrayTexture {
    return this.sheet
  }

  /**
   * Takes a layer for a picture, drawing it in, or nothing where there is no
   * room left.
   *
   * The same picture handed over again takes the layer it already has and the
   * wearing is counted, so a page that cuts one marking into twenty roofs
   * spends one layer on it — and one let go a moment ago is still there to be
   * taken back, drawing and all.
   */
  take(image: DecalImage): number | undefined {
    const kept = this.held.get(image)
    if (kept) {
      this.loose.delete(kept)
      kept.worn++
      return kept.layer
    }
    const layer = this.room()
    if (layer === undefined) return undefined
    this.held.set(image, { image, layer, worn: 1 })
    this.draw(image, layer)
    return layer
  }

  /**
   * Which layer a picture is in, or nothing where it was never taken — or was
   * taken where there was no room.
   */
  layerOf(image: DecalImage): number | undefined {
    return this.held.get(image)?.layer
  }

  /** Lets a picture go, leaving it in its layer until the room is wanted. */
  release(image: DecalImage): void {
    const kept = this.held.get(image)
    if (!kept) return
    kept.worn--
    if (kept.worn <= 0) this.loose.add(kept)
  }

  /**
   * Draws a picture the page has changed in place over again.
   *
   * A page with a clock on a wall redraws its canvas and says so; nothing here
   * can see that it changed. Unknown pictures are ignored rather than taking a
   * layer, since a page may hand over one it never cut in.
   */
  refresh(image: DecalImage): void {
    const kept = this.held.get(image)
    if (kept) this.draw(image, kept.layer)
  }

  dispose(): void {
    this.sheet.dispose()
    this.held.clear()
    this.loose.clear()
  }

  /**
   * A layer for a picture nothing here is holding: one never given out
   * where the texture has it already, then the layer of whichever picture was
   * let go longest ago, and only then a new one, growing the texture.
   *
   * In that order so the texture grows to as many pictures as are worn at
   * once and not to as many as were ever handed over. With sixteen the most
   * there could be, growing first and painting over a let-go picture only at
   * the end cost sixteen megabytes at worst; with the card's own limit it
   * would be a quarter of a gigabyte for a page that swaps one picture for a
   * new canvas now and then.
   */
  private room(): number | undefined {
    if (this.next < this.depth) return this.next++
    const first = this.loose.values().next()
    if (!first.done) {
      const given = first.value
      this.loose.delete(given)
      this.held.delete(given.image)
      return given.layer
    }
    if (this.next >= MOST_PICTURES) return undefined
    const layer = this.next++
    this.grow()
    return layer
  }

  /** Doubles the layers, up to {@link MOST_PICTURES}, keeping what is drawn. */
  private grow(): void {
    const depth = Math.min(this.depth * 2, MOST_PICTURES)
    const pixels = new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * depth)
    pixels.set(this.pixels)
    this.pixels = pixels
    this.depth = depth
    this.sheet.image.data = pixels
    this.sheet.image.depth = depth
    // The same texture object, because a material was woven against this one
    // and reads no other afterwards. What is thrown away is what three built
    // on the card for it, which is the one part that cannot be stretched: it
    // is made afresh at the new depth on the next frame, and three drops the
    // bindings pointing at the old one as it goes.
    this.sheet.dispose()
    this.sheet.needsUpdate = true
  }

  /** Squeezes one picture into one layer. */
  private draw(image: DecalImage, layer: number): void {
    this.scratch ??= new OffscreenCanvas(LAYER_SIZE, LAYER_SIZE)
    const ink = this.scratch.getContext('2d', { willReadFrequently: true })
    if (!ink) return
    ink.clearRect(0, 0, LAYER_SIZE, LAYER_SIZE)
    ink.drawImage(image, 0, 0, LAYER_SIZE, LAYER_SIZE)
    const read = ink.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE)
    this.pixels.set(read.data, layer * LAYER_SIZE * LAYER_SIZE * 4)
    this.sheet.needsUpdate = true
  }
}
