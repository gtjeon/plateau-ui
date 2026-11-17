import { float, mix, positionWorld, vec2 } from 'three/tsl'
import { texture, uniform } from './repaint.js'
import {
  Color,
  DoubleSide,
  Group,
  MeshBasicNodeMaterial,
  Vector2,
  type Node,
  type Texture,
} from 'three/webgpu'
import { blendOverOpaque, pressToLand } from './behind.js'
import { latToY, lonToX, type WorldBounds } from './geo/mercator.js'
import { Surface } from './ground/surface.js'
import { OVER_THE_GROUND } from './ground/tileGeometry.js'
import { notPicked } from './pick.js'
import { MaskShader, maskIn } from './mask.js'
import type { Paints } from './paints.js'
import type { Cast } from './projection.js'
import { colorFor, type ThemeColor } from './theme.js'
import { beforeTheCurve } from './tone.js'
import type { Change, Stage, Viewer } from './Viewer.js'

/**
 * One texel of a published picture, as it was published.
 *
 * Nought to 255 a channel, which is what the file holds — not a colour to
 * draw with and not a colour anybody sees. What is on the screen has been
 * through the light, the tone curve, the mask and whatever was painted over
 * it; this has been through none of them, which is the whole point of asking.
 *
 * `a` is nought where the picture leaves that place clear. A published legend
 * uses that for "no band here", and a page reading a depth off the colour has
 * to tell it from a band whose depth is nought.
 */
export interface Texel {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * A picture laid on the land, however it arrived.
 *
 * Everything the two picture layers do with a picture once they have one:
 * the sheet it is worn on, where on it each place of the world falls, the
 * colour a page may put in its place, how much of it goes on, and the
 * viewer's mask. What is **not** here is where the picture comes from —
 * `ImageTileLayer` stitches a window of tiles, `ImageLayer` fetches one
 * image — and that is the whole of what those two differ in.
 *
 * It is not a `Layer`. A layer owns it, hands out its root as its own, and
 * drives it a frame at a time; the same way `VectorTileLayer` holds a
 * `ShapeLayer`.
 *
 * **The sheet is the ground's own kind**: a grid held in front of the camera,
 * cut to what is in view and laid on the heights. Borrowed rather than
 * written again — a picture over the land wants exactly the shape the land
 * has, and there is one piece of code that knows it. The cost is that the
 * grid covers the view and not the picture, so a picture over one block is
 * still a sheet across the screen, transparent everywhere else.
 */
export interface PictureSheetOptions {
  /**
   * The picture it wears.
   *
   * The object, not what is in it: three weaves a shader once and the node
   * made here holds this texture for good, so whoever owns it swaps the
   * image inside it rather than handing over another.
   */
  readonly picture: Texture
  /**
   * How far in the picture is at a place on it, 0 to 1 — read where the
   * picture is read, so that a picture arriving in pieces can bring them in
   * one at a time. Left out, all of it is in at once.
   */
  readonly upAt?: (at: Node<'vec2'>) => Node<'float'>
  /** How much of the picture goes on, 0 to 1. All of it by default. */
  readonly opacity?: number
  /**
   * A colour to draw it in instead of its own, or left out to wear the
   * picture; see {@link PictureSheet.color}.
   */
  readonly color?: ThemeColor
  /** Drawn at all; lands on the root. */
  readonly visible?: boolean
  /** Whether the viewer's mask cuts it. */
  readonly masked?: boolean
  /**
   * What the picture lands on. `'ground'` where it is left out.
   *
   * There is no leaving it out in the sense a shape has, where it means "not
   * painted, drawn at its own place": a picture has no place of its own to be
   * drawn at, so it is always paint and the word only says where it goes.
   * `'ground'` lays it on the land, the trees in it included, and whatever was
   * built there covers it — the plain thing to do with a map of the ground.
   *
   * `'buildings'` and `'all'` throw it down over the map as well, so that a
   * wall takes the colour of the ground it stands on all the way up; see
   * `projection.ts`, which is also where it says when that is the answer and
   * when it is a smear.
   */
  readonly paints?: Paints
}

/**
 * A colour as the page said it, with a pair copied and frozen: read back and
 * written into, a pair the sheet had already read would change nothing, and
 * frozen it says so in a module's own code instead of quietly.
 */
function kept(color: ThemeColor): ThemeColor {
  return typeof color === 'object' && 'light' in color && 'dark' in color
    ? Object.freeze({ light: color.light, dark: color.dark })
    : color
}

export class PictureSheet {
  /** Everything it draws: the one sheet. The viewer seats it. */
  readonly root = new Group()
  /** Laid on the land, under whatever stands on it; see {@link Stage}. */
  readonly stage: Stage = 'ground'
  /**
   * The picture's west-north corner and how far it runs, in world units.
   *
   * Written by whoever owns the sheet, because only they know where their
   * picture lies — a window of tiles moves it as the view moves, one image
   * sets it once from the rectangle a page gave.
   */
  readonly origin = uniform(new Vector2())
  readonly span = uniform(new Vector2(1, 1))

  private readonly surface = new Surface()
  private readonly material: MeshBasicNodeMaterial
  private readonly mask = new MaskShader()
  private _masked: boolean
  /** The picture itself, kept for the projector; see {@link paints}. */
  private readonly wearing: Texture
  /** Whether anything is on the picture yet; see {@link holding}. */
  private _holding = false
  private _paints: Paints
  /** How much of the picture goes on; see {@link opacity}. */
  private readonly shows = uniform(1)
  /** The colour as the page said it, once or twice; see {@link color}. */
  private _color: ThemeColor | undefined
  /**
   * What it is drawn in instead of the picture, and whether it is: the half of
   * {@link _color} the palette now standing asks for; see {@link retint}.
   */
  private readonly tint = uniform(new Color())
  private readonly tinted = uniform(0)
  private viewer: Viewer | null = null

  constructor(options: PictureSheetOptions) {
    this._masked = options.masked ?? true
    this.wearing = options.picture
    this._paints = options.paints ?? 'ground'
    this.shows.value = Math.min(Math.max(options.opacity ?? 1, 0), 1)
    this.material = this.dress(options.picture, options.upAt)
    this.color = options.color
    this.surface.mesh.material = this.material
    this.surface.mesh.visible = false
    // Over everything the ground draws, which is where it was before the
    // drawing was sorted: the viewer's own land goes on first and a page's
    // sheet after it. The stage comes off the root, so this one number is only
    // ever read against the others of its stage; see `order.ts`.
    this.surface.mesh.renderOrder = OVER_THE_GROUND
    // A picture laid on the land is not a thing to point at, and it answers
    // nothing when pointed at. Found by the pointer, it took every click and
    // hover the land under it would have answered — over the whole screen
    // for a picture of one block, since the sheet is the screen's size
    notPicked(this.surface.mesh)
    this.root.add(this.surface.mesh)
    this.root.visible = options.visible ?? true
  }

  /** How much of the picture goes on, 0 to 1. */
  get opacity(): number {
    return this.shows.value
  }

  set opacity(value: number) {
    this.shows.value = Math.min(Math.max(value, 0), 1)
    // Thinned where it stands among the others; see `projection.ts`
    this.refresh()
  }

  /** What the picture lands on; see {@link PictureSheetOptions.paints}. */
  get paints(): Paints {
    return this._paints
  }

  set paints(value: Paints) {
    if (this._paints === value) return
    this._paints = value
    // Where it lands changes, and where it stands among the others does not.
    // Until 2026-10-29 this took the projector from whichever picture had it,
    // there being one picture thrown; every picture is thrown now
    this.refresh()
  }

  /**
   * What the sheet is drawn in, where a page would rather it were not the
   * picture's own colours, or nothing to wear the picture. Handed back as the
   * page said it — a pair stays a pair.
   *
   * Only the colour changes — where the picture lies is still the picture's
   * to say. Not `material.color` and not reachable as one: three multiplies
   * that over the picture rather than standing in for it, so this is a tint
   * and a switch held as uniforms.
   *
   * **Wherever the picture lands, it lands in this.** The sheet wears it, and
   * it is handed to the projector with the picture (`Cast.tint`), so the trees
   * a `'ground'` picture reaches and the walls of `'buildings'` and `'all'`
   * wear it too. A page that drew its hazard map as water would otherwise see
   * the land in blue and the houses standing in it in the legend's pinks — a
   * field read on one path and not the other.
   *
   * A pair is told apart at the moment the sun crosses the horizon, by the
   * viewer's own answer to that ({@link Viewer.night}), and read again each
   * time the palette turns over; see {@link changed}. Before there is a viewer
   * to ask, the light half stands in, and nothing is drawn by then anyway.
   */
  get color(): ThemeColor | undefined {
    return this._color
  }

  set color(value: ThemeColor | undefined) {
    // `null` is no colour a page may say any more, and the types turn it away.
    // A page written in plain script before that change still writes it to
    // mean the picture's own colours, so it is read as that rather than handed
    // to three, where `Color.set(null)` does nothing and the sheet would go on
    // in whatever colour it last had.
    this._color = value === undefined || value === null ? undefined : kept(value)
    this.retint()
  }

  /** Drawn at all, as the page said. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (this.root.visible === value) return
    this.root.visible = value
    // A picture turned off is taken off the walls and the trees as well. three
    // would only stop drawing the sheet, and the city would go on wearing a
    // picture the page has put away. Thrown at nought rather than taken off
    // the projector, so that turned on again it goes back where it was among
    // the others — the order they went on — and not over all of them
    this.refresh()
  }

  /**
   * Whether anything is on the picture yet: the owner's to say, since only it
   * knows — a window of tiles before its first square lands, one image before
   * it arrives.
   *
   * A picture with nothing on it is thrown at nought. Thrown as it is it would
   * put nothing on the walls either, but a stack is laid round every picture
   * in it, and a window that has not been placed yet stands at the world's
   * origin: the box round it and a picture over 由比ヶ浜 is a hundred
   * kilometres of nothing, and the stack's texels would grow to cover it.
   */
  get holding(): boolean {
    return this._holding
  }

  set holding(value: boolean) {
    if (this._holding === value) return
    this._holding = value
    this.refresh()
  }

  /** Whether the viewer's mask cuts it. */
  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (this._masked === value) return
    this._masked = value
    this.changed('mask')
  }

  /**
   * Whether the sheet is drawn this frame.
   *
   * Set by {@link lay} from what the mask leaves, and the owner's to put back
   * to false where there is nothing on the sheet to show — a window wider
   * than its tile set can say anything about, a picture that has not landed.
   */
  get drawn(): boolean {
    return this.surface.mesh.visible
  }

  /**
   * Whether the viewer's projector is throwing this picture onto what was
   * built.
   *
   * What the credit waits on where the sheet is not drawn: with `'buildings'`
   * the picture is on every wall in view and no sheet of it is on screen, and
   * a line that named nobody then would be a page quietly not meeting the
   * terms it is shown under.
   *
   * Answered from this picture alone: on a viewer, turned on and landing on
   * what was built is on the walls, whatever else is on the map. Until
   * 2026-10-29 it was asked of the projector as well, which threw one picture
   * and left the others on no wall.
   *
   * `'ground'` alone does not count: what it throws lands on the trees, and
   * the trees stand on the sheet, which says so by being drawn.
   */
  get casting(): boolean {
    return this.viewer !== null && this.root.visible && this._paints !== 'ground'
  }

  set drawn(value: boolean) {
    this.surface.mesh.visible = value
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.mask.set(this._masked ? viewer.maskArea : null)
    this.mask.fadeInto(viewer.colors.backdrop)
    // A pair said before there was a viewer was read for the light set
    this.retint()
    this.claim()
  }

  detach(): void {
    this.release()
    this.surface.letGo()
    this.viewer = null
    this.drawn = false
  }

  /**
   * Says where the picture falls, in world units: its west-north corner and
   * how far it runs.
   *
   * Written through here rather than onto {@link origin} and {@link span}
   * because the projector has to be told the same thing — a window of tiles
   * moves it as the view moves, and a projector left aiming at the window
   * before last throws the picture onto the wrong town.
   */
  place(originX: number, originY: number, spanX: number, spanY: number): void {
    this.origin.value.set(originX, originY)
    this.span.value.set(spanX, spanY)
    // A window turning over is the picture moving, and the walls are worn
    // from where it now is
    this.refresh()
  }

  /**
   * Puts this picture on the viewer's projector, over every picture put on
   * before it, as it is attached — which is the order the viewer seats its
   * layers in, so the walls wear the pictures in the order the land does.
   * Turned on or not: a picture turned off is thrown at nought and keeps its
   * place; see {@link visible}.
   *
   * Put on for the land alone as well, which is every picture's default: the
   * sheet is the land's own copy and lies on it, but it is a sheet and cannot
   * reach a tree. A tree is land — it grew where it is rather than having
   * been put there — so a picture on the land is on the trees in it, and a
   * wash that stopped at the trunk would read as the one thing in the park
   * left out. Which side takes it is the projector's to sort out.
   *
   * **Every picture on the map is thrown** (2026-10-29), one over another in
   * the order they went on; see `projection.ts`. Until then the projector
   * threw one, the last asked for: a page's aerial photograph put on after its
   * hazard map took the walls from it.
   */
  private claim(): void {
    this.viewer?.projection.claim(this, this.thrown)
  }

  /** Tells the projector what this picture now throws, where it stands among the others. */
  private refresh(): void {
    this.viewer?.projection.update(this, this.thrown)
  }

  /** Takes this picture off the projector; the others stay as they are. */
  private release(): void {
    this.viewer?.projection.release(this)
  }

  /**
   * What this picture throws, as the projector is handed it.
   *
   * The tint is told apart here, for the palette now standing, because this
   * sheet is told when the palette turns over and the projector is not; see
   * {@link changed}. Thrown at nought where the page has turned it off or
   * there is nothing on it yet; see {@link visible} and {@link holding}.
   */
  private get thrown(): Cast {
    const color = this._color
    return {
      picture: this.wearing,
      origin: this.origin.value,
      span: this.span.value,
      opacity: this.root.visible && this._holding ? this.shows.value : 0,
      paints: this._paints,
      tint: color === undefined ? undefined : colorFor(color, this.viewer?.night ?? false),
    }
  }

  /**
   * Writes the colour the page gave into the tint, for the palette now
   * standing, and hands the projector the same; see {@link color}.
   */
  private retint(): void {
    const color = this._color
    this.tinted.value = color === undefined ? 0 : 1
    if (color !== undefined) this.tint.value.set(colorFor(color, this.viewer?.night ?? false))
    this.refresh()
  }

  /**
   * A sheet answers two of the words; see {@link Change}.
   *
   * `'colors'` is the palette turning over, which is the moment a page's pair
   * changes halves: the mask's fade goes to the new backdrop, and the tint is
   * read again.
   */
  changed(what: Change): void {
    if (what === 'mask') this.mask.set(this._masked ? (this.viewer?.maskArea ?? null) : null)
    else if (what === 'colors') {
      if (this.viewer) this.mask.fadeInto(this.viewer.colors.backdrop)
      this.retint()
    }
  }

  /**
   * Lays the sheet on the land under what is in view, and says where that is.
   *
   * Null where the mask leaves nothing to lay it on, and the sheet is not
   * drawn. Called every frame rather than when the view moves, because a
   * height tile landing changes where the land is without the view having
   * moved at all — the same reason the ground lays its own sheet there.
   */
  lay(viewer: Viewer): WorldBounds | null {
    // Laid over all the screen covers where the mask is not to cut it — what
    // `masked: false` says. Cut to the box round the mask either way, it was
    // the box and not the screen, and not laid at all with the view outside it
    const laid = maskIn(this._masked ? viewer.maskArea : null, viewer.visibleBounds)
    // Nothing is laid on the land where the page asked for the walls alone —
    // the picture is on them, thrown, and a sheet under it as well would be
    // the one thing `'buildings'` says not to draw.
    //
    // **What is in view still comes back.** It is not only where the sheet
    // goes: it is also what the window of a tile set is picked from, and the
    // picture that window stitches is the picture the projector throws. Held
    // back here the first time, `'buildings'` fetched no tile at all and threw
    // a blank canvas over a town that then stayed white (measured at 由比ヶ浜).
    this.drawn = laid !== null && this._paints !== 'buildings'
    if (!laid) return null
    if (this.drawn) this.surface.follow(laid, viewer.elevation ? viewer.landHeights : null)
    return laid
  }

  /**
   * Where a place on the map falls on the picture, nought to one each way, or
   * null for a place the picture does not cover.
   *
   * The same arithmetic the shader does, written once so that the two cannot
   * drift: a reading taken a texel away from where the colour was drawn is a
   * reading of the wrong band. The shader reads it from where the pixel is
   * drawn in the world (until 2026-10-29, from a corner attribute) and this
   * reads it from a page's longitude and latitude; what they do with the
   * numbers is the same.
   *
   * The world's z runs south where a picture's rows run south, which is why
   * the second one adds where the first subtracts.
   */
  spotOf(at: readonly [number, number]): readonly [number, number] | null {
    const origin = this.origin.value
    const span = this.span.value
    if (span.x === 0 || span.y === 0) return null
    const u = (lonToX(at[0]) - origin.x) / span.x
    const v = (origin.y - latToY(at[1])) / span.y
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    return [u, v]
  }

  dispose(): void {
    // Let go while still on a map, it comes off the projector, so the walls do
    // not go on reading a texture nobody is keeping
    this.release()
    this.surface.dispose()
    this.material.dispose()
    this.root.clear()
  }

  /**
   * The one material, made once.
   *
   * Where on the picture a place falls is worked out from where the place is
   * in the world rather than from corners written on the sheet: the sheet is
   * cut afresh every time the view moves, and corners written on it would have
   * to be written again with it. The world does not move.
   */
  private dress(picture: Texture, upAt: PictureSheetOptions['upAt']): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({
      // Read, not written; see LAID_ON_THE_LAND in `ground/materials.ts`.
      depthWrite: false,
      depthTest: true,
      // Lying flat, so neither side is its back
      side: DoubleSide,
    })
    // Raised by the card to the land under it, as the land's own sheet is;
    // see `ground/surface.ts`
    this.surface.stand(material)
    // Where each pixel reads the picture, which is its own place in the world.
    // Until 2026-10-29 each corner carried it, written as the sheet was cut;
    // the sheet is laid out by the card now, and the place falls out of
    // where it is drawn. The world's z runs south where a picture's rows run
    // south, so the two agree once the picture's north edge is taken off.
    const place = positionWorld
    const at = vec2(
      place.x.sub(this.origin.x).div(this.span.x),
      place.z.add(this.origin.y).div(this.span.y),
    ).toVar()
    const read = texture(picture, at)
    // The picture's own colours, or a colour the page gave instead. Mixed by
    // a uniform rather than swapped for another node: three weaves a shader
    // once and a node changed after it is drawn changes nothing.
    //
    // And not lit, which it never was. A published picture is a legend: a
    // colour on it means a depth of water or a band of risk, and a reader
    // matching it against the key is owed the colour that was published. Lit,
    // one band would read as two wherever a shadow crossed it. So it is
    // written past the frame's tone curve instead; see `tone.ts`.
    material.colorNode = beforeTheCurve(mix(read.rgb, this.tint, this.tinted) as Node<'vec3'>)
    // Nothing past the edge of the picture. The sheet is cut to the view and
    // the picture is not always under the whole of it — a page's one image
    // covers a block, and a window being replaced may be narrower than the
    // view already is — and sampled past its edge the last row of texels
    // would be dragged out across the rest of the land.
    const inside = at.x
      .greaterThanEqual(0)
      .and(at.x.lessThanEqual(1))
      .and(at.y.greaterThanEqual(0))
      .and(at.y.lessThanEqual(1))
    // What the picture leaves clear stays clear, the page's own opacity thins
    // the rest, and what has not come all the way in yet is thinner still.
    const up = upAt ? upAt(at) : float(1)
    material.opacityNode = inside.select(read.a.mul(this.shows).mul(up), float(0)) as Node<'float'>
    // Laid on the land, and over whatever opaque was already drawn there.
    pressToLand(material)
    blendOverOpaque(material)
    this.mask.apply(material)
    return material
  }
}
