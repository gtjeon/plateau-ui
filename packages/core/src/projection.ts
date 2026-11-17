import { mix, positionWorld, renderGroup, uv, vec2, vec4 } from 'three/tsl'
import { uniform } from './repaint.js'
import {
  Color,
  DataTexture,
  NearestFilter,
  NodeMaterial,
  NormalBlending,
  QuadMesh,
  RenderTarget,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  type ColorRepresentation,
  type Node,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu'
import type { SolidMaterial } from './lit.js'
import { paintsOn, type PaintedKind, type Paints } from './paints.js'
import { lookup } from './lookup.js'

/**
 * Pictures thrown straight down over the map, onto whatever is standing in it.
 *
 * A projector hung above the city pointing at the ground. Every face drawn
 * below it works out, from where it is on the map, which point of the picture
 * falls on it — so a wall takes the colour of the ground it stands on, carried
 * up its height, and a roof takes the colour of the ground beneath it.
 *
 * **That smear up a wall is the answer for one kind of picture and wrong for
 * another.** A published hazard map says "the water reaches this depth here",
 * and a house standing there wearing that colour up its wall is the fact
 * drawn. An aerial photograph says what the ground *looks like* from above,
 * and a wall is not in it — projected, one point of tarmac is dragged five
 * storeys up. Nothing in a URL tells the two apart, so the page says which it
 * has; see `Paints`.
 *
 * **The viewer holds it, the way it holds the sun and the mask.** It is not a
 * layer handing its data to another layer — the thing taken out of here on
 * 2026-10-13 — but one fact about the scene that every surface reads for
 * itself, which is what a light is. A surface asks no layer anything: it has
 * its own place on the map already (every solid works out `positionWorld`),
 * so there is nothing to look up and nothing to reconstruct.
 *
 * **Every picture on the map is thrown, one over another in the order they
 * went on** (2026-10-29). The later over the earlier, each at its own
 * opacity, in its own colour or the page's, and each only where it lands
 * (`paints`) — which is what the land does with the same pictures, so a wall
 * wears the stack the ground beside it shows. A picture turned off comes off
 * the walls and the rest stay; one taken off the map and put back on goes to
 * the top, which is how a page puts one over another, the same as it does for
 * the sheets on the land (`Viewer.add`).
 *
 * **Stacked into one picture a side, and a surface reads its side's.** What
 * the stack holds is drawn into a picture of its own ({@link compose}), so a
 * fragment still reads one texture however many pictures are on the map: the
 * cost of a second picture is paid once, when something in the stack
 * changes, and not on every lit fragment of every frame. Two sides and not one
 * because `paints` is each picture's own — a hazard map on the walls alone and
 * a photograph on the land alone are two different stacks — and a material is
 * woven against the side it belongs to ({@link cast}). Where both sides hold
 * the same pictures, which is what `'all'` on every one of them comes to, the
 * stack is drawn once and read by both.
 *
 * **Where one picture is on a side it is read as it is**, and where none is the
 * side reads a texel of nothing; the stack is made only where two or more
 * meet. One picture is a hazard map and nothing else, which is most maps, and
 * drawing it into a stack first would be a copy as big as the picture and a
 * draw on every tile that lands, for a result the picture already is.
 *
 * **The stack covers every picture in it**: the box round all of them, at the
 * texel of the finest, laid on that picture's own grid. On its grid so that the
 * finest picture's texels fall whole on the stack's, and a tile set's coarser
 * zooms with them, since a tile grid halves into the next; read nearest at
 * both ends, the colours a wall is given are then the colours published —
 * given as its reflectance, lit and taken through the frame's curve like any
 * other, so not what reaches the screen (see `SolidMaterial.setupDiffuseColor`
 * in `lit.ts`). **Up to {@link MOST_ACROSS} texels each way**, which is two
 * sets one zoom apart — a hazard map published to 17 under a base map to 18 —
 * each at its own texels.
 * Past it the stack's texel is doubled until it fits, and what is lost is the
 * fine end: the finest picture is worn on the walls at a half, a quarter, of
 * its own texels. Two pictures far apart — one block in one town and a tile
 * set in another — reach that soon, the box between them being mostly empty.
 * The ceiling is memory: four bytes a texel, sixty-four megabytes a stack at
 * the most, and two stacks only where the sides hold different pictures.
 *
 * Measured over 由比ヶ浜 (WebGPU), the tsunami map (to z17) thrown on
 * everything and the GSI's photographs (to z18) at half over the land: the
 * land's stack came out 4096 square at the photographs' texel, and 400 of its
 * texels read back off the card were each within one eight-bit step of the
 * two published pictures laid one over the other by hand. The walls read the
 * tsunami map alone, unstacked. Standing still for three seconds, and turning
 * the view, drew no stack. Under WebGL2, 200 texels read the same way match
 * counted from the bottom row, which is how GL holds a target, and the walls
 * come out the right way up all the same. With the photographs thrown on
 * everything over the tsunami map, 97.6% of the wall pixels (97.4% on WebGL2)
 * matched the photographs thrown alone to a step; the rest took the texel
 * beside, where a texel's edge falls between the two readings — a world
 * coordinate in float32 is a sixtieth of that texel off. A one-block
 * `ImageLayer` over the tsunami map wears its own colour inside and leaves
 * the tsunami map outside, its edge moved by up to a texel of the stack. A
 * video over the tsunami map draws the stack at the video's rate (30 a
 * second, 2048 square) and the view held 120 frames a second.
 *
 * Until 2026-10-29 this threw one picture: the newest a page had put on,
 * turned on or told `paints`, the rest kept in order for when it was turned
 * off. Two texture reads on every lit fragment for a second picture were the
 * reason, and it left the walls bare of every picture but the top one,
 * outside the top one's rectangle as well as inside it.
 */

/** A picture with nothing in it, for a side nothing is thrown on. */
const NOTHING = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType)
NOTHING.needsUpdate = true

/**
 * The most texels a stack is across, each way; see {@link Projection}.
 *
 * Four thousand and ninety-six, which is two windows of tiles one zoom apart
 * worn at the finer one's texels: a window is eight tiles of 256, and the
 * coarser one is twice the ground. Four bytes a texel make it sixty-four
 * megabytes, which is the reason it is not 8192. WebGPU promises a texture of
 * 8192; WebGL2 promises only 2048, and a card that stops there would refuse a
 * stack past it — not asked, as `ImageLayer` does not ask before its 8192
 * (`LARGEST_PICTURE`), and not seen on a card here.
 */
const MOST_ACROSS = 4096

/**
 * The step a stack's size is rounded up to, in texels.
 *
 * A stack of a new size is a new texture, and a window of tiles moves as the
 * view does: rounded to the texel, the box round two windows would be a new
 * size at almost every turn of either. Rounded up, since what the stack is for
 * is covering every picture in it and a step over still covers them — the
 * extra texels are past the last picture and hold nothing.
 */
const STEP = 256

/** What a picture layer hands over to be thrown; see {@link Projection}. */
export interface Cast {
  /** The picture itself. */
  readonly picture: Texture
  /** Its west-north corner and how far it runs, in world units. */
  readonly origin: Vector2
  readonly span: Vector2
  /**
   * How much of it goes on, 0 to 1.
   *
   * Nought takes it off the walls and the trees without taking it out of its
   * place among the others, which is what a picture turned off throws, and one
   * with nothing on it yet: turned on again it goes back where it was, under
   * whatever was put on after it, rather than to the top.
   */
  readonly opacity: number
  /**
   * A colour to throw it in instead of its own, or left out to throw its own.
   * Where the picture leaves a place clear it stays clear; the rest goes on in
   * this.
   *
   * The colour a picture layer's `color` draws its sheet in. Carried here so
   * that a page that recolours its picture sees that colour wherever the
   * picture lands — on the land, and on the trees and walls the sheet cannot
   * reach. Thrown in its own colours instead, a picture drawn as water on the
   * land would climb the houses in the legend's pinks.
   *
   * **Taken as the picture's own colours are taken here**: a reflectance, used
   * as it is, which is what it stands in for. Not through the curve backwards
   * the way a page's colour on a solid is: that inverse has no ceiling, and
   * held to reflectance one a pale colour loses the two channels that made it
   * pale — what turned the texels' pale pink pillar-box red over 由比ヶ浜
   * (`Solid.setupDiffuseColor` in `lit.ts`), and a tint stands where those
   * texels stood.
   *
   * **Said for the palette now standing.** A page's `{ light, dark }` pair is
   * told apart by whoever throws — `colorFor(color, viewer.night)` — and
   * handed over again ({@link Projection.update}) when the palette turns over,
   * because a layer is told that (`changed('colors')`) and the projector is
   * not.
   */
  readonly tint?: ColorRepresentation
  /**
   * What it lands on. The line is the stencil's own: a tree is land, because
   * it grew where it is rather than having been put there, and a wash that
   * stopped at the trunk would read as the one thing in the park left out.
   */
  readonly paints: Paints
}

/**
 * One picture on the projector, and what it throws.
 *
 * Kept as a copy rather than as what was handed over. A `Vector2` or a `Color`
 * held by reference is its owner's to write into, and an owner reusing one for
 * something else would move this picture without saying so — and the stack,
 * which is only drawn again when it is told something changed, would not
 * follow it.
 */
interface Claim {
  readonly by: object
  readonly picture: Texture
  readonly origin: Vector2
  readonly span: Vector2
  readonly opacity: number
  readonly tint: Color | null
  readonly paints: Paints
  /**
   * The picture's `version` when the stack last had it, or −1 for one it has
   * not had.
   *
   * What says the picture changed under the same texture — a tile landing in a
   * window, an image arriving — which nobody tells the projector: three counts
   * every write a layer marks (`needsUpdate`), and this is the count read.
   */
  seen: number
}

function claimOf(by: object, cast: Cast): Claim {
  return {
    by,
    picture: cast.picture,
    origin: cast.origin.clone(),
    span: cast.span.clone(),
    opacity: cast.opacity,
    tint: cast.tint === undefined ? null : new Color(cast.tint),
    paints: cast.paints,
    seen: -1,
  }
}

/** Whether two claims throw the same thing, so that a cast handed over again unchanged draws nothing again. */
function sameCast(one: Claim, other: Claim): boolean {
  return (
    one.picture === other.picture &&
    one.origin.equals(other.origin) &&
    one.span.equals(other.span) &&
    one.opacity === other.opacity &&
    one.paints === other.paints &&
    (one.tint === null ? other.tint === null : other.tint !== null && one.tint.equals(other.tint))
  )
}

/**
 * How many texels a picture is across and down, or nought for one with nothing
 * in it to count.
 *
 * Asked of three (`Texture.width`) rather than read off `image.width`, since
 * three knows what each kind of source calls its size and the source does not
 * always call it that. A video's `width` is its markup attribute, nought
 * unless a page wrote one, and a `VideoFrame` has none: read off the image, a
 * `VideoTexture` handed over on its own would be counted as holding nothing
 * and thrown nowhere. Its own size is `videoWidth` (`displayWidth` for a
 * frame), which is what three reads (`TextureSource.getSize`, three 0.186).
 * Read off three's source; no video was thrown on screen here.
 */
function sizeOf(picture: Texture): readonly [number, number] {
  return [picture.width || 0, picture.height || 0]
}

/** Nought to one, as an opacity is held. */
function held(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** Where a stack lies and how fine it is: its west-north corner, its texel and its size in texels. */
interface Laid {
  readonly west: number
  readonly north: number
  readonly texel: number
  readonly across: number
  readonly down: number
}

/**
 * Where the stack of these pictures lies, and how fine; see {@link Projection}.
 *
 * The box round all of them, at the finest one's texel and on its grid: the
 * west and north edges are walked out from that picture's own corner in whole
 * texels, so its texels and the stack's are the same squares. A tile set's
 * coarser zoom shares those edges, a tile being two of the next zoom's. Past
 * {@link MOST_ACROSS} the texel doubles, from the same corner, until it fits.
 */
function lay(pictures: readonly Claim[]): Laid {
  let finest: Claim | null = null
  let texel = Infinity
  let west = Infinity
  let east = -Infinity
  let north = -Infinity
  let south = Infinity
  for (const claim of pictures) {
    const [across, down] = sizeOf(claim.picture)
    const own = Math.min(claim.span.x / across, claim.span.y / down)
    if (own < texel) {
      texel = own
      finest = claim
    }
    west = Math.min(west, claim.origin.x)
    east = Math.max(east, claim.origin.x + claim.span.x)
    north = Math.max(north, claim.origin.y)
    south = Math.min(south, claim.origin.y - claim.span.y)
  }
  // A hair off a whole count is a whole count: the corners are sums of world
  // units, and a ceiling taken of 3.0000000001 would add a column of nothing
  const whole = (value: number): number => Math.ceil(value - 1e-6)
  const anchorX = finest?.origin.x ?? west
  const anchorY = finest?.origin.y ?? north
  for (let step = texel; ; step *= 2) {
    const fromX = anchorX - whole((anchorX - west) / step) * step
    const fromY = anchorY + whole((north - anchorY) / step) * step
    const across = Math.max(STEP, Math.ceil(whole((east - fromX) / step) / STEP) * STEP)
    const down = Math.max(STEP, Math.ceil(whole((fromY - south) / step) / STEP) * STEP)
    if (across <= MOST_ACROSS && down <= MOST_ACROSS)
      return { west: fromX, north: fromY, texel: step, across, down }
  }
}

/**
 * A picture for a stack to be drawn in.
 *
 * In the picture's own colour space, which is what keeps the stack the
 * pictures it holds: a published picture is sRGB, read back as linear, and
 * eight bits of linear light would band the dark end the sRGB curve spends its
 * steps on. Written through the curve and read back through it, a picture
 * comes out of a stack as it went in. No depth: a stack is pictures laid flat,
 * one over another, and depth would be another texture as big as this one.
 * Read nearest, for the reason a tile set's own picture is (`ImageTileLayer`):
 * a legend is bands of flat colour, and blending would invent the colours
 * between them — or, against the clear ground round a band, pull it towards
 * the black the stack holds there.
 */
function stackOf(across: number, down: number): RenderTarget {
  return new RenderTarget(across, down, {
    depthBuffer: false,
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
  })
}

/**
 * What one side of the stencil's line reads: the land's, with the trees on
 * it, or what was built.
 *
 * On the render group and not the default one. These are one fact about the
 * scene, and three gives a uniform a buffer per *object* unless told otherwise
 * — which has gone wrong here once already, when the sun's map described
 * itself to some surfaces with last frame's aim; see the traps in CLAUDE.md.
 */
class Side {
  /** The picture this side reads: one picture, the stack, or nothing. */
  readonly picture = lookup(NOTHING)
  /** Where it falls: its west-north corner and how far it runs, in world units. */
  readonly origin = uniform(new Vector2()).setGroup(renderGroup)
  readonly span = uniform(new Vector2(1, 1)).setGroup(renderGroup)
  /** How much of it goes on, nought with nothing thrown on this side. */
  readonly shows = uniform(0).setGroup(renderGroup)
  /**
   * A page's colour in place of the picture's, and whether there is one; see
   * {@link Cast.tint}. Mixed in by a uniform rather than swapped for another
   * node, because a node changed after the shader is woven changes nothing.
   * Nought for a stack, which wears each picture's colour already.
   */
  readonly tint = uniform(new Color()).setGroup(renderGroup)
  readonly tinted = uniform(0).setGroup(renderGroup)
  /**
   * Whether the picture is a stack, whose colours are held already multiplied
   * by how much of them went on.
   *
   * Which is what laying one picture over another comes to: three's ordinary
   * blending, `colour × alpha + under × (1 − alpha)`, poured over a clear
   * texture, leaves each colour multiplied through by how much of it went on.
   * Read back that has to be divided out, since a surface mixes the colour
   * over its own by the alpha; a single picture is held as it was published,
   * and the division would darken its every thin edge.
   */
  readonly stacked = uniform(0).setGroup(renderGroup)
  /** The stack this side draws, where it draws one of its own. */
  target: RenderTarget | null = null
}

export class Projection {
  private readonly land = new Side()
  private readonly built = new Side()

  /**
   * The reading, made once a side and handed out as it is from then on.
   *
   * Not one per material, for the reason `MaskShader` keeps one: the passes
   * that draw the scene again under stand-ins of their own tell two stand-ins
   * apart by the nodes they carry, so materials sharing this node share a
   * depth shader instead of taking one apiece.
   */
  private readonly reading = new Map<PaintedKind, Node<'vec4'>>()
  /** Every picture on the projector, in the order they went on: the last is on top. */
  private readonly claims: Claim[] = []
  /** Whether something changed since the stacks were last drawn; see {@link compose}. */
  private dirty = false
  /**
   * Stacks let go of, kept one frame longer before their textures are freed.
   *
   * A side moves to its new picture in the same breath as it lets the old one
   * go, but the materials reading it have only been told so by a uniform, and
   * a texture freed while a drawing still holds it is a frame the card refuses
   * outright (`Destroyed texture used in a submit`; see CLAUDE.md). Freed at
   * the next {@link compose}, after a frame has been drawn with the new one.
   */
  private readonly retired: RenderTarget[] = []

  /**
   * The one material every picture is laid into a stack with, and what it is
   * told picture by picture: which picture, where on it the stack's corner and
   * far edge fall, how much of it goes on and in what colour.
   *
   * One material and not one a picture, since three weaves a shader per
   * material; the picture and the numbers are swapped between the draws of one
   * stack. Where on the picture is said as a corner and a scale already worked
   * out between the two rectangles, in nought-to-one of the picture, rather
   * than as two world corners for the shader to subtract: a world coordinate
   * in Japan runs to 1.75 million units, which a float on the card holds to
   * about twelve centimetres (`geo/mercator.ts`), and the difference of two of
   * them is small and wanted exactly — so it is taken here, in double.
   */
  private readonly into = lookup(NOTHING)
  private readonly offset = uniform(new Vector2())
  private readonly scale = uniform(new Vector2(1, 1))
  private readonly opacity = uniform(1)
  private readonly tint = uniform(new Color())
  private readonly tinted = uniform(0)
  private readonly layingWith = new NodeMaterial()
  private readonly laying = new QuadMesh(this.layingWith)
  /** The renderer's own clear colour, kept while a stack is cleared to nothing. */
  private readonly clearWas = new Color()

  constructor() {
    const at = this.offset.add(uv().mul(this.scale)).toVar()
    const read = this.into.sample(at)
    const inside = at.x
      .greaterThanEqual(0)
      .and(at.x.lessThanEqual(1))
      .and(at.y.greaterThanEqual(0))
      .and(at.y.lessThanEqual(1))
    const material = this.layingWith
    // Each picture over what is in the stack already, by three's ordinary
    // blending; see `Side.stacked` for what that leaves in the texels. Nothing
    // past a picture's edge, or its last row of texels would be dragged out
    // over the rest of the stack.
    material.fragmentNode = vec4(
      mix(read.rgb, this.tint, this.tinted),
      inside.select(read.a.mul(this.opacity), 0),
    ) as Node<'vec4'>
    material.transparent = true
    material.blending = NormalBlending
    material.depthTest = false
    material.depthWrite = false
  }

  /**
   * Hands a material the pictures to wear, as rgb and how much of it.
   *
   * Read when the shader is woven, so it is given before the first frame —
   * a layer does it as it is attached, the same moment it takes the viewer's
   * other scene-wide things. After that, what is thrown and how much of it
   * are a texture swapped and uniforms, and no shader is woven again.
   */
  cast(material: SolidMaterial, on: PaintedKind): void {
    let reading = this.reading.get(on)
    if (!reading) {
      reading = this.read(on === 'ground' ? this.land : this.built)
      this.reading.set(on, reading)
    }
    material.cast = reading
  }

  /**
   * Puts `by`'s picture on, over every picture put on before it.
   *
   * `by` is whoever is throwing. Asked again by one already on, it stays where
   * it is and throws what it now throws: where a picture stands among the
   * others is the order they went on, and only taking one off and putting it
   * on again moves it, as for the sheets on the land. Until 2026-10-29 asking
   * again put it on top.
   */
  claim(by: object, cast: Cast): void {
    const at = this.claims.findIndex((claim) => claim.by === by)
    if (at >= 0) this.change(at, cast)
    else {
      this.claims.push(claimOf(by, cast))
      this.dirty = true
    }
  }

  /**
   * Says what `by` now throws, where it stands: nothing where `by` is not on.
   * A picture taken off moves with the view all the same, and is not to be
   * put back on the map by doing so.
   */
  update(by: object, cast: Cast): void {
    const at = this.claims.findIndex((claim) => claim.by === by)
    if (at >= 0) this.change(at, cast)
  }

  /** Takes `by`'s picture off; the rest stay as they were. */
  release(by: object): void {
    const at = this.claims.findIndex((claim) => claim.by === by)
    if (at < 0) return
    this.claims.splice(at, 1)
    this.dirty = true
  }

  /** Writes what one picture now throws, and marks the stacks to be drawn again where that is a change. */
  private change(at: number, cast: Cast): void {
    const was = this.claims[at]
    if (!was) return
    const now = claimOf(was.by, cast)
    if (sameCast(was, now)) return
    this.claims[at] = now
    this.dirty = true
  }

  /**
   * @internal Draws the stacks again where anything in them changed, and
   * hands each side the picture it reads. The viewer's to call, once a frame,
   * between the layers' frames and the first drawing that wears the pictures.
   *
   * The viewer's because the renderer is (contract 1): handed in for this one
   * call, at the moment the viewer chose, and never inside another render —
   * a stack drawn from inside a material's own drawing would be a render in a
   * render. Most frames it is a count of the pictures and nothing more: a
   * stack is drawn when what it holds is changed — a picture put on, taken
   * off, turned on or off, thinned, recoloured, told `paints` or moved, or
   * written into under the same texture (a tile landing).
   *
   * Says whether it drew, for the same reason the sun's map does: what a stack
   * holds is in the picture, and the viewer draws the picture again with it.
   */
  compose(renderer: WebGPURenderer): boolean {
    for (const target of this.retired) target.dispose()
    this.retired.length = 0
    if (
      !this.dirty &&
      !this.claims.some((claim) => claim.opacity > 0 && claim.picture.version !== claim.seen)
    )
      return false
    this.dirty = false
    for (const claim of this.claims) claim.seen = claim.picture.version
    const land = this.thrownOn('ground')
    const built = this.thrownOn('buildings')
    this.throw(this.land, land, renderer)
    // The same pictures on both sides — `'all'` on every one of them — are
    // the same stack, drawn once
    if (built.length > 1 && built.length === land.length && built.every((claim, at) => claim === land[at])) {
      this.retire(this.built)
      this.copy(this.built, this.land)
    } else this.throw(this.built, built, renderer)
    return true
  }

  /** Lets go of the stacks and the material they are laid with. */
  dispose(): void {
    this.retire(this.land)
    this.retire(this.built)
    for (const target of this.retired) target.dispose()
    this.retired.length = 0
    this.layingWith.dispose()
  }

  /**
   * The pictures thrown on one side, bottom first: those that land there,
   * have something on them and are not thinned to nothing.
   */
  private thrownOn(on: PaintedKind): Claim[] {
    return this.claims.filter((claim) => {
      if (claim.opacity <= 0 || !paintsOn(claim.paints, on)) return false
      const [across, down] = sizeOf(claim.picture)
      return across > 0 && down > 0 && claim.span.x > 0 && claim.span.y > 0
    })
  }

  /** Hands one side what it is to read: nothing, the one picture, or a stack of them. */
  private throw(side: Side, pictures: readonly Claim[], renderer: WebGPURenderer): void {
    const only = pictures.length === 1 ? pictures[0] : undefined
    if (pictures.length === 0) {
      this.retire(side)
      side.picture.value = NOTHING
      side.shows.value = 0
      side.tinted.value = 0
      side.stacked.value = 0
    } else if (only) {
      this.retire(side)
      side.picture.value = only.picture
      side.origin.value.copy(only.origin)
      side.span.value.copy(only.span)
      side.shows.value = held(only.opacity)
      side.tinted.value = only.tint ? 1 : 0
      if (only.tint) side.tint.value.copy(only.tint)
      side.stacked.value = 0
    } else this.stack(side, pictures, renderer)
  }

  /** Has `side` read what `from` reads, which is a stack `from` drew. */
  private copy(side: Side, from: Side): void {
    side.picture.value = from.picture.value
    side.origin.value.copy(from.origin.value)
    side.span.value.copy(from.span.value)
    side.shows.value = from.shows.value
    side.tinted.value = 0
    side.stacked.value = from.stacked.value
  }

  /** Puts a side's own stack by, to be freed after the next frame; see {@link retired}. */
  private retire(side: Side): void {
    if (!side.target) return
    this.retired.push(side.target)
    side.target = null
  }

  /**
   * Draws a stack of pictures, bottom first, into the side's own target.
   *
   * Each is a quad over the whole stack, which leaves it clear past the
   * picture's edges, laid by the renderer's ordinary blending over what is
   * there. The first is laid over a stack cleared to nothing: the renderer's
   * own clear colour is the backdrop, and a stack that started from it would
   * throw the backdrop over every wall the pictures do not cover.
   */
  private stack(side: Side, pictures: readonly Claim[], renderer: WebGPURenderer): void {
    const laid = lay(pictures)
    let target = side.target
    if (!target || target.width !== laid.across || target.height !== laid.down) {
      this.retire(side)
      target = stackOf(laid.across, laid.down)
      side.target = target
    }
    const spanX = laid.across * laid.texel
    const spanY = laid.down * laid.texel
    const was = renderer.getRenderTarget()
    const wasFace = renderer.getActiveCubeFace()
    const wasLevel = renderer.getActiveMipmapLevel()
    const { autoClear } = renderer
    renderer.getClearColor(this.clearWas)
    const alphaWas = renderer.getClearAlpha()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    try {
      pictures.forEach((claim, at) => {
        renderer.autoClear = at === 0
        this.into.value = claim.picture
        // The stack's west-north corner on this picture, and how much of the
        // picture the stack spans, each way. The world's y runs north where a
        // picture's rows run south, which is why the second is turned round.
        this.offset.value.set(
          (laid.west - claim.origin.x) / claim.span.x,
          (claim.origin.y - laid.north) / claim.span.y,
        )
        this.scale.value.set(spanX / claim.span.x, spanY / claim.span.y)
        this.opacity.value = held(claim.opacity)
        this.tinted.value = claim.tint ? 1 : 0
        if (claim.tint) this.tint.value.copy(claim.tint)
        this.laying.render(renderer)
      })
    } finally {
      // The renderer is the viewer's, and every one of these is the viewer's
      // for the rest of its life: left as a stack has them, the next frame is
      // drawn into the stack, or cleared to nothing
      renderer.autoClear = autoClear
      renderer.setClearColor(this.clearWas, alphaWas)
      renderer.setRenderTarget(was, wasFace, wasLevel)
      this.into.value = NOTHING
    }
    side.picture.value = target.texture
    side.origin.value.set(laid.west, laid.north)
    side.span.value.set(spanX, spanY)
    side.shows.value = 1
    side.tinted.value = 0
    side.stacked.value = 1
  }

  /**
   * Where a side's picture falls on the place being drawn, and how much of it.
   *
   * The world's z runs south where a picture's rows run south, so the two
   * agree once the picture's north edge is taken off — the same arithmetic
   * the sheet does, from the same world place, which every solid works out
   * anyway.
   */
  private read(side: Side): Node<'vec4'> {
    const at = vec2(
      positionWorld.x.sub(side.origin.x).div(side.span.x),
      positionWorld.z.add(side.origin.y).div(side.span.y),
    ).toVar()
    const read = side.picture.sample(at)
    const inside = at.x
      .greaterThanEqual(0)
      .and(at.x.lessThanEqual(1))
      .and(at.y.greaterThanEqual(0))
      .and(at.y.lessThanEqual(1))
    // A stack's colours come back multiplied through by how much of them went
    // on, and are divided out to be mixed like a picture's; see
    // `Side.stacked`. Where nothing went on the division is by a floor and the
    // colour is mixed in at nought anyway.
    const own = mix(read.rgb, read.rgb.div(read.a.max(1 / 255)), side.stacked)
    // The picture's own colours or the page's, the same way the sheet mixes
    // them, so that what the picture leaves clear stays clear either way.
    // Nothing past the edge of the picture, and nothing at all with nothing
    // thrown: a texture that is not there reads as its last row of texels
    // dragged out over the whole map.
    const colour = mix(own, side.tint, side.tinted)
    return vec4(colour, inside.select(read.a.mul(side.shows), 0)) as Node<'vec4'>
  }
}
