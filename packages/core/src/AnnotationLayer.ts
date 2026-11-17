import { Color, Group, Vector3, type ColorRepresentation } from 'three/webgpu'
import { DRAWN_BY, dimming, type Behind, type Draws } from './behind.js'
import { Events, type Anchor, type Hit, type Position } from './events.js'
import { heightsInHand, type Heights } from './elevation.js'
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_HALO_COLOR, DEFAULT_LABEL_INK } from './inks.js'
import { maskHolds } from './mask.js'
import { isAnchor, seatAt, worldOf, worldOfNow, type ScreenPlace, type Where } from './screen.js'
import type { BuildingSeat, StandsOnBuildings } from './onBuildings.js'
import { colorFor, type ThemeColor } from './theme.js'
import { Atlas, type Patch } from './atlas.js'
import { standsAs, standsDown } from './annotations/pressed.js'
import { AnnotationMesh, type Instance } from './annotations/mesh.js'
import {
  DEFAULT_ANNOTATION_FONT,
  DEFAULT_DROP_SHADOW,
  DEFAULT_HALO_WIDTH,
  drawAnnotation,
  symbolSize,
  type AnnotationDrawing,
  type DrawnLine,
  type Picture,
  type Shape,
} from './annotations/picture.js'

/** Where a piece of markup stands this frame, between working it out and projecting it. */
const STANDING = new Vector3()

// What a mark's letters are set in, how far the band round them stands out,
// and the shadow a page may drop under them, where a page says nothing.
export { DEFAULT_ANNOTATION_FONT, DEFAULT_DROP_SHADOW, DEFAULT_HALO_WIDTH } from './annotations/picture.js'
// And what a mark's symbol and a label's words are drawn in, for a page that
// wants to say it. Kept in `inks.ts` beside the other defaults that stand
// outside the palette — this layer is the only one that reads it, and that
// file says why it is there all the same; said again here, where a page making
// marks looks.
export { DEFAULT_ANNOTATION_COLOR } from './inks.js'
import type { Change, PutsItselfOn, Layer, Viewer } from './Viewer.js'

/**
 * The mark standing at a marker's place: a `'pin'` standing on it, a `'tag'`
 * lying beside it with its point on it, or a `'dot'` over it.
 *
 * Words with nothing under them are not one of these: that is a
 * {@link Label}, which is its own thing rather than a marker told to draw no
 * marker.
 */
export type MarkerSymbol = 'pin' | 'tag' | 'dot'

/**
 * Which way a tag runs off its place: its plate to the right of its point, to
 * the left, or whichever `'auto'` works out; see {@link MarkerOptions.direction}.
 *
 * Leaflet's word and values for the same choice on a tooltip, less the two a
 * tag cannot take: a plate whose point is on its place lies level with it, so
 * it runs one way or the other along the line and never up or down.
 */
export type MarkerDirection = 'left' | 'right' | 'auto'

/**
 * What an annotation says: one string, where a newline breaks it over two
 * lines.
 *
 * One face and one ink for the whole of it. Lines each set in their own were
 * written here once, for a plate that wanted a number large over its
 * particulars small — and that plate is markup now ({@link Html}), where a
 * page sets its lines in a stylesheet and this had nothing left to answer for.
 * A mark on the sheet is a thing said in the map's own voice; a thing said in
 * three is a page's, and a page has somewhere better to write it.
 */
export type AnnotationText = string

/**
 * How a mark on the sheet looks, wherever it is standing.
 *
 * Every value a field of its own and every one of them a property of the mark
 * after it is made, by the same name and of the same type — the way three's
 * `new MeshStandardMaterial({ color })` is `material.color` afterwards. The
 * parts a mark has (the band round its letters, the plate under them, the
 * shadow dropped off either) are a switch named for the part and the part's
 * name with `Color`, `Width` and the rest after it, as CSS writes
 * `background` and `background-color`. Two or three values a part do not
 * want an object round them.
 *
 * Every colour is a {@link ThemeColor}: one value is that colour at every
 * hour, and a `{ light, dark }` pair is one for each of the two palettes,
 * turning over as the sun crosses the horizon. A colour left out is the
 * library's own, never nothing — the switch beside it is what turns a part off.
 */
export interface AnnotationLook {
  /**
   * What the mark is drawn in: a marker's symbol, or a label's letters. Left
   * out, {@link DEFAULT_ANNOTATION_COLOR}.
   *
   * A marker's letters stay ink whatever this is — two coloured things saying
   * one thing read as a mark that has been shouted — except where they lie on
   * a plate, which is then what the colour is set against. A label has no
   * symbol for its colour to go on, so its colour is its words.
   */
  readonly color?: ThemeColor
  /**
   * What the letters are set in, written as CSS — the very string a
   * stylesheet's `font` takes: `'600 13px "Noto Sans JP", sans-serif'`.
   *
   * Style, weight, size and face in one, since that is how the browser itself
   * takes them and the canvas a mark is drawn on asks for nothing else. One
   * way of saying it rather than a knob apiece. Left out:
   * {@link DEFAULT_ANNOTATION_FONT}.
   *
   * A face the page fetches has to be in hand before the mark is drawn, or the
   * mark is drawn in whatever stood in for it. `document.fonts.ready` is what
   * says so, and a mark made after that is set in the face that was asked for.
   */
  readonly font?: string
  /**
   * The band round the letters, which parts them from whatever they fall on —
   * a white wall, a road, the sky. What a map calls a halo, and what Mapbox
   * names `text-halo-color` and `text-halo-width`.
   *
   * Left out, it is drawn where the letters lie on the map and not where they
   * lie on a plate: a plate already parts them from the map, and a band round
   * them there would only fur the edge. Said, it is what was said either way —
   * a band over a plate is drawn over the plate.
   *
   * No CSS property is this. The nearest, `-webkit-text-stroke`, lays its
   * stroke over the letters and thins them, where this stands out behind them.
   */
  readonly halo?: boolean
  /**
   * What colour the band round the letters is. Left out, `DEFAULT_HALO_COLOR`:
   * the paper the page is drawn on, white by day and the dark land's colour by
   * night.
   *
   * What it is for is the letters being read over whatever they fall on, and
   * the colour that does that is the one the map is drawn on. A page that
   * moved its backdrop moves this with it, or the band shows as a glow round
   * every glyph.
   *
   * The white of a marker's symbol is this colour too — the edge round it, a
   * pin's eye, a dot's ring — since it parts the symbol from the map as the
   * band parts the letters.
   */
  readonly haloColor?: ThemeColor
  /**
   * How far the band stands out from the letters, in CSS pixels. Left out,
   * {@link DEFAULT_HALO_WIDTH}. 0 draws none, as `halo: false` does.
   */
  readonly haloWidth?: number
  /**
   * The shadow under the letters, which lifts them off what they are over.
   * Off unless it is asked for. Named for CSS's `filter: drop-shadow()`, which
   * is what it is.
   *
   * The other way of parting words from a map. A halo puts the page's own
   * colour between the two and so has to be told what that colour is; a shadow
   * is told nothing about the map and works over a pale city and a dark one
   * alike — what it costs is that it darkens what it falls on, where a halo
   * covers it.
   *
   * Nothing to do with the sun, which never sees a mark at all: every mark is
   * on `PICTURE_ONLY` and casts nothing. Which is why it is not a solid's
   * `castShadow` nor the palette's `shadow`, and why its name says so.
   *
   * A page that has both gets the shadow cast off the halo's outer edge, so the
   * two read as one raised band rather than as two effects. Where the letters
   * lie on a plate it is the plate that casts it.
   */
  readonly dropShadow?: boolean
  /**
   * What colour the shadow is, alpha and all: written as CSS, the alpha is the
   * shadow's strength. Left out, the colour of {@link DEFAULT_DROP_SHADOW}.
   */
  readonly dropShadowColor?: ThemeColor
  /** How soft the shadow is, in CSS pixels. 0 is a hard copy of the letters. */
  readonly dropShadowBlur?: number
  /** How far the shadow is dropped to the right, in CSS pixels. */
  readonly dropShadowOffsetX?: number
  /** How far the shadow is dropped down, in CSS pixels. */
  readonly dropShadowOffsetY?: number
  /**
   * Lay the letters on a rounded plate rather than on the map itself. Off by
   * default.
   *
   * For a mark whose words are the whole of it — a price over a roof, a name
   * over a door. A plate holds its words together where a halo only keeps
   * them legible, and it can be turned round, dark on light against light on
   * dark, to say which of them is the one being looked at.
   *
   * A switch and not a colour, as every part here is: a colour that turned the
   * plate on could not ask for the plate in its own colour.
   */
  readonly background?: boolean
  /**
   * What colour the plate is. Left out, `DEFAULT_HALO_COLOR`, the paper the
   * page is drawn on — the same colour a halo is, since both are there to part
   * the letters from the map.
   */
  readonly backgroundColor?: ThemeColor
  /**
   * What the mark does where something stands in front of it. Left out, what
   * the group holding it says; see {@link AnnotationLayerOptions.behind}.
   *
   * Not taken by {@link Html}: what hides a mark is read in the shader, a
   * pixel at a time, and an element over the canvas is not in that picture.
   */
  readonly behind?: Behind
  /**
   * Whether the pointer finds it. True unless it is written down, as for
   * every shape a page puts on the map.
   *
   * What it settles is whether the mark is in the way: one that is not lets a
   * click through to whatever is drawn behind it — the land, a building —
   * rather than taking it and having nobody answer. Leaflet's `interactive`
   * and deck.gl's `pickable` are the same word for the same reason; whether
   * anyone listens is not what decides it.
   */
  readonly pickable?: boolean
  /**
   * Whether it is shown at all. `true` by default.
   *
   * The same word as the property, as three's material takes `{ color }` and
   * has `material.color` (contract 12, rule 2), and taken by {@link Html} as
   * well, which has the same property. Until 2026-10-27 it was the property
   * alone, so a mark a page meant to show later — the next stop on a walk, the
   * price of a room not yet chosen — had to be made, written off and then put
   * on.
   *
   * A hidden mark is left out of the sheet, and the page's own markup is kept
   * out of sight, so neither is in the pointer's way until it is shown.
   */
  readonly visible?: boolean
}

/**
 * Where an annotation stands, and how far its picture is moved off it.
 *
 * Where a mark stands and nothing else: how it looks is {@link AnnotationLook},
 * which the page's own markup ({@link Html}) does not take.
 */
export interface AnnotationPlace {
  /**
   * Where it stands. One of two kinds, and the two never mix.
   *
   * **A spot on the map**: [longitude, latitude], or a place with its height
   * as a click hands one back — a {@link Position}, or the `{ lng, lat }` the
   * land's own click gives. It stays there whatever the city does: a building
   * coming up under it, set moving, moved or taken out leaves it where it was.
   * The `building` a click hands back beside a place is not read.
   *
   * **A place on a thing** ({@link Anchor}): a building, a model or a solid,
   * and an offset in metres from its foot. It goes wherever the thing goes —
   * a building up out of the ground as its tile lands, along with a motion,
   * and to wherever it is stood; a model or a solid wherever the page puts
   * it — and waits, unseen, while the thing stands nowhere yet. A click on any
   * of the three hands one back (`anchor`).
   *
   * _(2026-11-03, the user's design. Until today a spot on the map with a
   * `building` beside it was held to the building, and a place on a model,
   * `{ model, height }`, rode the model. A spot held to a building followed it
   * up and through a motion but not to a new place, so the one place meant two
   * things; now each kind means one.)_
   */
  readonly at: Where
  /** How far it is lifted off the land, in metres, where a spot on the map does not say. On it by default. */
  readonly height?: number
  /**
   * How far its picture is moved off the place, in CSS pixels: `[x, y]`,
   * right and down, as Cesium's `Billboard.pixelOffset` is. Mapbox calls the
   * same thing `Marker.offset`; here `offset` is part of a place on a building,
   * a model or a solid (`Anchor.offset`), and moves the place itself, in
   * metres.
   *
   * _(2026-11-03: this was `offset` until today. The user gave that name to
   * fine-tuning the place, and put it in the place, since it is where the
   * mark stands and not how it is drawn.)_
   *
   * The picture alone. The place it marks stays where it was said to be — a
   * building it stands on still carries it, and what stands in front of the
   * place still hides it — so a pin can be nudged off the corner of a roof it
   * would otherwise sit on, or a row of labels at one place fanned apart,
   * without the place being made up. In pixels and not metres because what is
   * being moved is a picture on the screen, which is the same size at every
   * zoom.
   */
  readonly pixelOffset?: readonly [number, number]
}

/** Where a mark on the sheet stands, and how it looks. */
export type AnnotationOptions = AnnotationPlace & AnnotationLook

/** What a marker is made of: a symbol at a place, and what it says beside it. */
export type MarkerOptions = AnnotationOptions & {
  /** Which mark stands at the place. A `'pin'` by default. */
  readonly symbol?: MarkerSymbol
  /**
   * How big that symbol is drawn, in CSS pixels: how tall. Left out, each
   * symbol's own height — 30 for a pin, 16 for a tag, 12 for a dot.
   */
  readonly size?: number
  /**
   * What it says beside its symbol, if anything. The letters are the ink's
   * where the symbol takes the colour; see {@link AnnotationLook.color}.
   */
  readonly label?: AnnotationText
  /**
   * What colour the words beside the symbol are, where they lie on no plate.
   * Left out, `DEFAULT_LABEL_INK`: near black by day and near white by night.
   * Read only where there are words and no `background` (on a plate the
   * words take `color`, as a label's do). A property afterwards.
   */
  readonly labelColor?: ThemeColor
  /**
   * Which way a tag runs off its place. `'auto'` by default. Read only by a
   * tag: every other symbol stands over its place.
   *
   * `'auto'` runs it away from what it is held to: a tag on a building, a
   * model or a solid (`{ building, offset }` and the rest) runs off on the
   * side its place lies from the middle of that thing's foot, as the screen
   * has them now — so a tag on a west wall runs out to the west of the
   * building rather than across it, and turns over as the map is turned. A
   * tag at a spot on the map has nothing to run away from, and runs as
   * Leaflet's `'auto'` does: to the right in the left half of the screen, to
   * the left in the right half. Nothing is asked of the wall: the place and
   * the foot are all there is.
   *
   * Both ways are drawn once and kept, so turning over costs no drawing.
   */
  readonly direction?: MarkerDirection
}

/** What a label is made of: words at a place, with nothing under them. */
export type LabelOptions = AnnotationOptions & {
  /**
   * Lie beside the place, level with it, rather than standing over it.
   *
   * What stands over its place sits as far above it as it is tall, which is
   * right for a name over a roof and wrong for a number against a rule: a
   * tick is read by being level with the line it names. Defaults to `false`.
   */
  readonly beside?: boolean
  /**
   * What it says. Where the words are the whole of a thing — a price over a
   * roof, a height over a tower — they take the colour the annotation is
   * given, since there is no symbol for that colour to go on.
   */
  readonly text: AnnotationText
}

/** What one mark tells of. */
export interface AnnotationEvents {
  /**
   * This mark was clicked.
   *
   * No place, where a building and a model both give one. Those are things in
   * the world and a click lands somewhere on them; a mark is a card held square
   * to the screen, so the only place a click on one could name is its own —
   * which is {@link Annotation.at}, already in the hand of whoever made it.
   * A price over a roof clicked at the end of its last digit would otherwise
   * report a place some metres from the roof.
   */
  click: {
    readonly annotation: Annotation
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto this mark, or left it.
   *
   * No place, for the same reason a click on one carries none: a mark is a
   * card held square to the screen, and the only place it could name is its
   * own. Told on the change and not while the pointer travels over one mark.
   */
  hover: { readonly annotation: Annotation } | null
}

/**
 * The library's own colours, handed out as they are.
 *
 * Nothing to copy: the three from `inks.ts` are frozen there, and the drop
 * shadow's is a string. So a page reading `marker.color` and writing into what
 * came back is stopped there, rather than turning every mark's default over at
 * once — which is what `keep` does for a page's own pairs.
 */
/** What dressing an {@link Html} for the map writes on its element's inline style, and undressing hands back. */
const WORN = ['position', 'left', 'top', 'pointerEvents', 'display', 'transform', 'zIndex', 'touchAction'] as const

const MARK_INK = DEFAULT_ANNOTATION_COLOR
const PAPER = DEFAULT_HALO_COLOR
const LETTERS = DEFAULT_LABEL_INK
const DROPPED = DEFAULT_DROP_SHADOW.color

/**
 * One thing a page has put on the map at a place, held on to.
 *
 * It is not a {@link Layer}: a hundred of them are not a hundred things for
 * the viewer to seat, and what draws them has to be one material — see
 * {@link AnnotationLayer}. It is handed to the viewer all the same, and finds
 * its group itself; see {@link Held}. This is the handle, so that a page can
 * keep what it has made, change it, listen to it and take it away again.
 *
 * Three kinds stand on this. A {@link Marker} is a symbol at a place with what
 * it says beside it; a {@link Label} is the words alone; both are drawn into
 * the one sheet and look as {@link AnnotationLook} says. An {@link Html} is a
 * piece of the page's own markup, which looks however the page made it. What
 * is written here is what all three share: where they stand, whether they are
 * shown, whether the pointer finds them, and being held by a group.
 */
abstract class Annotation implements PutsItselfOn {
  /**
   * Where it stands; see {@link AnnotationPlace.at}.
   *
   * Changeable, with the height and the offset beside it, as a solid's and a model's
   * place is (rule 2). A mark is placed afresh every frame, so a new place
   * shows on the next one and nothing is drawn again for it; a mark that
   * followed a vehicle was taken off and made again at every step, and the
   * sheet with it.
   */
  at: AnnotationPlace['at']
  /** How far it is lifted; see {@link AnnotationPlace.height}. */
  height: number | undefined
  /** How far its picture is moved off the place; see {@link AnnotationPlace.pixelOffset}. */
  pixelOffset: readonly [number, number] | undefined

  /**
   * @internal What the group holding it knows it by, or 0 while none does.
   *
   * It rides on the card, so that a look under the pointer hands back the
   * annotation itself rather than where it happened to be drawn that frame.
   * Given afresh each time one is taken on, so a number never names two.
   */
  item = 0

  /** The group holding it, so that changing it can ask for another drawing. */
  private owner: AnnotationLayer | null = null
  private readonly events = new Events<AnnotationEvents>()
  private _visible: boolean
  private _pickable: boolean

  protected constructor(options: AnnotationPlace & Pick<AnnotationLook, 'pickable' | 'visible'>) {
    this.at = options.at
    this.height = options.height
    this.pixelOffset = options.pixelOffset
    this._visible = options.visible ?? true
    this._pickable = options.pickable ?? true
  }

  /** Whether it is shown; see {@link AnnotationLook.visible}. */
  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    this._visible = value
    this.drawAgain()
  }

  /** Whether the pointer finds it; see {@link AnnotationLook.pickable}. */
  get pickable(): boolean {
    return this._pickable
  }

  set pickable(value: boolean) {
    this._pickable = value
    this.repicked()
  }

  /**
   * Listens for this being clicked. Hands back the way to stop.
   *
   * Nothing on screen changes for it — one that should look different for
   * having been chosen is one the page turns round itself, which is what its
   * colours are for.
   */
  on<K extends keyof AnnotationEvents>(type: K, listener: (event: AnnotationEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof AnnotationEvents>(type: K, listener: (event: AnnotationEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /** @internal Whether anyone is listening, so the group can tell the viewer whether to look. */
  listens(type: keyof AnnotationEvents): boolean {
    return this.events.has(type)
  }

  /** @internal Told by the group that holds it, which is the one the viewer speaks to. */
  clicked(hit: Pick<Hit, 'x' | 'y' | 'original'>): void {
    const { x, y, original } = hit
    this.events.emit('click', { annotation: this, x, y, original })
  }

  /** @internal Told by the group, the same way as {@link clicked}. */
  hovered(on: boolean): void {
    this.events.emit('hover', on ? { annotation: this } : null)
  }

  /** @internal Which group holds it, so that no two hold the same one. */
  get heldBy(): AnnotationLayer | null {
    return this.owner
  }

  /** @internal Told by {@link AnnotationLayer} as it takes one on and lets it go. */
  held(by: AnnotationLayer | null): void {
    this.owner = by
  }

  /** @internal Handed to a viewer bare, it goes into that viewer's own group of them. */
  putOn(viewer: Viewer): void {
    viewer.ownGroup('annotations', () => new AnnotationLayer()).add(this)
  }

  /** @internal Taken off a viewer, it leaves whichever group is holding it. */
  takeOff(): void {
    this.owner?.remove(this)
  }

  /**
   * Asks the group for another drawing of the sheet.
   *
   * Every setter of how a mark looks comes through here, so that one place
   * has to remember to ask — and the drawing is had on the next frame, once,
   * however many of them a page wrote in one breath.
   */
  protected drawAgain(): void {
    this.owner?.redraw()
  }

  /**
   * Told that whether the pointer finds it has changed.
   *
   * Nothing to do for a mark on the sheet, which is put on the card that
   * answers to it as every frame is laid out; the page's own markup takes it
   * on the element, which is not laid out by anything of ours.
   */
  protected repicked(): void {}
}

/**
 * The name of the family, for a page that wants to say it. The class
 * itself stays in: everything on it is this library's own, so there is
 * nothing out here to extend it against.
 */
export type { Annotation }

/**
 * What a marker and a label share: being drawn into the one sheet, and every
 * value of how that drawing looks.
 *
 * Apart from {@link Annotation} because the page's own markup has none of
 * this. Its colours, its type and its edges are the page's stylesheet's, and a
 * `color` on it that nothing read would be a wrong answer rather than no
 * answer. `behind` is here rather than there for the same reason: what hides a
 * mark is the shader's depth test, and an element over the canvas never meets
 * it, so on markup it would be taken and never read.
 *
 * Every value here can be changed after the mark is made. A drawing is a
 * canvas drawn again on the next frame, and the sheet is packed afresh whenever
 * anything on it changes, so there is nothing a later value costs that the
 * first one did not.
 */
abstract class SheetMark extends Annotation {
  /**
   * What it does where something stands in front of it, or `undefined` for
   * what its group says; see {@link AnnotationLook.behind}. Read as every
   * frame is laid out, so a change shows on the next one.
   */
  behind: Behind | undefined
  private _words: AnnotationText
  private _color: ThemeColor | undefined
  private _font: string | undefined
  private _halo: boolean | undefined
  private _haloColor: ThemeColor | undefined
  private _haloWidth: number | undefined
  private _dropShadow: boolean
  private _dropShadowColor: ThemeColor | undefined
  private _dropShadowBlur: number | undefined
  private _dropShadowOffsetX: number | undefined
  private _dropShadowOffsetY: number | undefined
  private _background: boolean
  private _backgroundColor: ThemeColor | undefined

  protected constructor(options: AnnotationOptions, words: AnnotationText) {
    super(options)
    this.behind = options.behind
    this._words = words
    this._color = keep(options.color)
    this._font = options.font
    this._halo = options.halo
    this._haloColor = keep(options.haloColor)
    this._haloWidth = options.haloWidth
    this._dropShadow = options.dropShadow ?? false
    this._dropShadowColor = keep(options.dropShadowColor)
    this._dropShadowBlur = options.dropShadowBlur
    this._dropShadowOffsetX = options.dropShadowOffsetX
    this._dropShadowOffsetY = options.dropShadowOffsetY
    this._background = options.background ?? false
    this._backgroundColor = keep(options.backgroundColor)
  }

  /**
   * @internal What stands at the place: a marker's symbol, or nothing where
   * the words are the whole of it.
   */
  abstract get shape(): Shape
  /** @internal How big that symbol is drawn, where there is one. */
  abstract get drawnSize(): number | undefined
  /** @internal Whether its words lie beside its place rather than over it. */
  abstract get lies(): boolean

  /**
   * @internal Which ways it is drawn: running right, left, or both where the
   * frame chooses between them. Right alone for everything but a tag.
   */
  get ways(): MarkerDirection {
    return 'right'
  }

  /** @internal What it says, whichever of the two named it. */
  get words(): AnnotationText {
    return this._words
  }

  /**
   * @internal Said again.
   *
   * The two name their words differently — a marker's are its `label`, a
   * label's are its `text` — and both come through here.
   */
  protected say(words: AnnotationText): void {
    this._words = words
    this.drawAgain()
  }

  /** What it is drawn in; see {@link AnnotationLook.color}. Reads the default where none was given. */
  get color(): ThemeColor {
    return this._color ?? MARK_INK
  }

  set color(value: ThemeColor | undefined) {
    this._color = keep(value)
    this.drawAgain()
  }

  /** What its letters are set in, as CSS; see {@link AnnotationLook.font}. */
  get font(): string {
    return this._font ?? DEFAULT_ANNOTATION_FONT
  }

  set font(value: string) {
    this._font = value
    this.drawAgain()
  }

  /**
   * Whether the band round its letters is drawn; see {@link AnnotationLook.halo}.
   *
   * Where the page never said, this follows the plate — on without one, off
   * with one — and turning the plate on or off later turns this with it. Once
   * written it is what was written, plate or no plate.
   */
  get halo(): boolean {
    return this._halo ?? !this._background
  }

  set halo(value: boolean) {
    this._halo = value
    this.drawAgain()
  }

  get haloColor(): ThemeColor {
    return this._haloColor ?? PAPER
  }

  set haloColor(value: ThemeColor | undefined) {
    this._haloColor = keep(value)
    this.drawAgain()
  }

  get haloWidth(): number {
    return this._haloWidth ?? DEFAULT_HALO_WIDTH
  }

  set haloWidth(value: number) {
    this._haloWidth = value
    this.drawAgain()
  }

  /** Whether a shadow is dropped under its letters; see {@link AnnotationLook.dropShadow}. */
  get dropShadow(): boolean {
    return this._dropShadow
  }

  set dropShadow(value: boolean) {
    this._dropShadow = value
    this.drawAgain()
  }

  get dropShadowColor(): ThemeColor {
    return this._dropShadowColor ?? DROPPED
  }

  set dropShadowColor(value: ThemeColor | undefined) {
    this._dropShadowColor = keep(value)
    this.drawAgain()
  }

  get dropShadowBlur(): number {
    return this._dropShadowBlur ?? DEFAULT_DROP_SHADOW.blur
  }

  set dropShadowBlur(value: number) {
    this._dropShadowBlur = value
    this.drawAgain()
  }

  get dropShadowOffsetX(): number {
    return this._dropShadowOffsetX ?? DEFAULT_DROP_SHADOW.offsetX
  }

  set dropShadowOffsetX(value: number) {
    this._dropShadowOffsetX = value
    this.drawAgain()
  }

  get dropShadowOffsetY(): number {
    return this._dropShadowOffsetY ?? DEFAULT_DROP_SHADOW.offsetY
  }

  set dropShadowOffsetY(value: number) {
    this._dropShadowOffsetY = value
    this.drawAgain()
  }

  /** Whether its letters lie on a plate; see {@link AnnotationLook.background}. */
  get background(): boolean {
    return this._background
  }

  set background(value: boolean) {
    this._background = value
    this.drawAgain()
  }

  get backgroundColor(): ThemeColor {
    return this._backgroundColor ?? PAPER
  }

  set backgroundColor(value: ThemeColor | undefined) {
    this._backgroundColor = keep(value)
    this.drawAgain()
  }

  /** @internal What colour words lying beside a symbol are: the default ink, where a kind says nothing else. */
  protected get letters(): ThemeColor {
    return LETTERS
  }

  /**
   * @internal Everything this is drawn from, for the half of the day the
   * palette is in, and whether any of it was a pair — which is what decides
   * whether the sheet has to be drawn again when the palette turns over.
   *
   * Only what is drawn is asked: a halo that is off has a colour, and a pair
   * there would otherwise redraw a sheet on which nothing turns over.
   */
  drawingFor(
    night: boolean,
    toLeft = false,
  ): { readonly drawing: AnnotationDrawing; readonly paired: boolean } {
    let paired = false
    const css = (color: ThemeColor): string => {
      if (colorFor(color, true) !== colorFor(color, false)) paired = true
      return cssOf(colorFor(color, night))
    }
    const shape = this.shape
    const lines = linesOf(this)
    const plate = this.background ? css(this.backgroundColor) : null
    const halo = this.halo ? { width: this.haloWidth, color: css(this.haloColor) } : null
    const shadow = this.dropShadow
      ? {
          blur: this.dropShadowBlur,
          offsetX: this.dropShadowOffsetX,
          offsetY: this.dropShadowOffsetY,
          color: css(this.dropShadowColor),
        }
      : null
    // The ink is asked only where the letters wear it: there are letters, and
    // the colour has gone on a symbol rather than on them
    const ink = lines.length > 0 && shape !== 'none' && plate === null ? css(this.letters) : ''
    // And the paper only where there is a symbol to cut it out of: the edge
    // round a symbol, a pin's eye and a dot's ring. They part the symbol from
    // the map as a halo parts the letters, so they are the halo's colour — the
    // page's where it gave one, the paper's otherwise — and turn over with
    // it. Fixed white, they were the one part of a default mark that stayed
    // in the day's colours after dusk; fixed to the paper, a page that moved
    // its halo to a dark backdrop had no way to move them along
    const edge = shape !== 'none' ? css(this.haloColor) : ''
    const drawing: AnnotationDrawing = {
      symbol: shape,
      size: this.drawnSize,
      color: css(this.color),
      edge,
      ink,
      lines,
      plate,
      halo,
      shadow,
      beside: this.lies,
      toLeft,
    }
    return { drawing, paired }
  }
}

/**
 * The name of the half of the family drawn on the sheet, for the types of
 * the two that are. Kept in for the reason {@link Annotation} is.
 */
export type { SheetMark }

/**
 * A mark standing at a place, and what it says beside it.
 *
 * For pointing: a pin on a doorway, a dot on a corner, a tag beside a tower.
 * Where the words are the whole of what is wanted — a price, a height — the
 * thing to reach for is a {@link Label}, which stands on nothing.
 */
export class Marker extends SheetMark {
  private _symbol: MarkerSymbol
  private _size: number | undefined

  constructor(options: MarkerOptions) {
    super(options, options.label ?? '')
    this._labelColor = keep(options.labelColor)
    this._symbol = options.symbol ?? 'pin'
    this._size = options.size
    this._direction = options.direction ?? 'auto'
  }

  private _direction: MarkerDirection

  /** Which way a tag runs off its place; see {@link MarkerOptions.direction}. */
  get direction(): MarkerDirection {
    return this._direction
  }

  set direction(value: MarkerDirection) {
    if (value === this._direction) return
    this._direction = value
    this.drawAgain()
  }

  /** Which mark stands at the place; see {@link MarkerOptions.symbol}. */
  get symbol(): MarkerSymbol {
    return this._symbol
  }

  set symbol(value: MarkerSymbol) {
    this._symbol = value
    this.drawAgain()
  }

  /**
   * How tall its symbol is drawn, in CSS pixels; see {@link MarkerOptions.size}.
   *
   * Where the page never said, this is the symbol's own height, and giving it
   * another symbol gives it that one's.
   */
  get size(): number {
    return this._size ?? symbolSize(this._symbol)
  }

  set size(value: number) {
    this._size = value
    this.drawAgain()
  }

  /** What it says beside its symbol. */
  get label(): AnnotationText {
    return this.words
  }

  set label(value: AnnotationText) {
    this.say(value)
  }

  /** What colour the words beside the symbol are; see {@link MarkerOptions.labelColor}. */
  get labelColor(): ThemeColor {
    return this._labelColor ?? LETTERS
  }

  /** `undefined` hands it back to the default. */
  set labelColor(value: ThemeColor | undefined) {
    this._labelColor = keep(value)
    this.drawAgain()
  }

  private _labelColor: ThemeColor | undefined

  /** @internal */
  protected override get letters(): ThemeColor {
    return this.labelColor
  }

  /** @internal */
  override get shape(): Shape {
    return this._symbol
  }

  /** @internal */
  override get drawnSize(): number {
    return this.size
  }

  /**
   * @internal A tag is a plate with its point on the place, so its words lie
   * beside it; everything else stands over its place. Asked of the symbol
   * rather than written down, so a marker given another symbol lies as that
   * one does.
   */
  override get lies(): boolean {
    return this._symbol === 'tag'
  }

  /** @internal A tag runs the way it was told, or both ways for the frame to choose; see {@link direction}. */
  override get ways(): MarkerDirection {
    return this.lies ? this._direction : 'right'
  }
}

/**
 * Words at a place, with nothing under them.
 *
 * A price over a roof, a height over a tower, a name over a door. The words
 * are the mark, so they take the colour the label is given — where a marker's
 * colour goes on its symbol and leaves the letters in ink.
 */
export class Label extends SheetMark {
  private _beside: boolean

  constructor(options: LabelOptions) {
    super(options, options.text)
    this._beside = options.beside ?? false
  }

  /** What it says. */
  get text(): AnnotationText {
    return this.words
  }

  set text(value: AnnotationText) {
    this.say(value)
  }

  /** Whether it lies beside its place; see {@link LabelOptions.beside}. */
  get beside(): boolean {
    return this._beside
  }

  set beside(value: boolean) {
    this._beside = value
    this.drawAgain()
  }

  /** @internal */
  override get shape(): Shape {
    return 'none'
  }

  /** @internal */
  override get drawnSize(): undefined {
    return undefined
  }

  /** @internal */
  override get lies(): boolean {
    return this._beside
  }
}

/**
 * What a piece of the page's own markup is made of: where it stands, and the
 * markup.
 *
 * None of {@link AnnotationLook}'s colours, type or parts. The page's HTML is
 * what decides those, and they were taken here once and never read — the
 * drawing that would have read them passes this by. No `behind` either, for
 * the same reason: it was kept once for the shape of the family, and what it
 * says is read in the shader, which an element over the canvas never meets.
 * What stays is what is not the markup's to say and is read: whether it is
 * shown, and whether the pointer finds it.
 */
export type HtmlOptions = AnnotationPlace &
  Pick<AnnotationLook, 'pickable' | 'visible'> & {
    /**
     * Lie beside the place, level with it, rather than standing over it.
     *
     * The same choice a {@link Label} makes and for the same reason: what
     * stands over its place is read as belonging to what is at that place, and
     * a tick against a rule is read by being level with the line it names.
     * Defaults to `false`.
     */
    readonly beside?: boolean
    /**
     * The element itself, which the page makes and keeps.
     *
     * Made by the page on purpose. What is wanted here is markup the page owns
     * — its classes, its stylesheet, its listeners — and an element handed
     * over is the only form that can be. The group puts it over the map and
     * holds it there; everything about how it looks and what it does stays the
     * page's.
     */
    readonly element: HTMLElement
  }

/**
 * A piece of the page's own markup, standing at a place.
 *
 * Written and put on like a {@link Label}, and in the same group: `at`,
 * `height`, `pixelOffset`, `visible`, `pickable` and `remove` all mean what
 * they mean there.
 * What changes is what is drawn — an element of the page's rather than letters
 * on the sheet — and what that lets the thing be. Letters on a sheet are a
 * picture: they cannot be clicked, tabbed into, read aloud or selected. An
 * element is a button if the page wrote a button.
 *
 * Held in place by the group, a frame at a time, so a page never writes a loop
 * of its own. What it cannot do for a page is the other half of a line — a
 * leader from a building to a panel down the side has one end that is not on
 * the map — and that is what {@link Viewer.screen} is for.
 *
 * Two things a mark on the sheet has that this does not, and both for the same
 * reason: it is not drawn with the city.
 *
 * No `behind`. What hides a mark is read in the shader, pixel by pixel, and an
 * element over the canvas is not in that picture at all — so it is not taken
 * here, rather than taken and left unread. Whatever stands in front of the
 * place, the element is drawn over it.
 *
 * And there is a number of them past which this is the wrong tool. Each one is
 * an element the browser lays out afresh every frame the view moves; dozens are
 * nothing and hundreds are a page that stutters. A hundred labels belong on the
 * sheet, where they are one drawing however many there are.
 */
export class Html extends Annotation {
  readonly element: HTMLElement
  /**
   * Whether it lies beside its place; see {@link HtmlOptions.beside}. Read as
   * every frame seats it, so a change shows on the next one.
   */
  beside: boolean
  /** Whether it is dressed for the map, so that a change to `pickable` knows to reach the element. */
  private worn = false
  /** What the page had written inline on the element before it was dressed, to be handed back; see {@link undressed}. */
  private kept: Readonly<Record<(typeof WORN)[number], string>> | null = null
  /** Whether the pointer is over it, so that one taken off the map under the pointer is left as well. */
  private over = false

  constructor(options: HtmlOptions) {
    super(options)
    this.beside = options.beside ?? false
    this.element = options.element
  }

  // Heard on the element itself, which is where the pointer is: the element
  // takes its pointers back from the canvas, so the viewer's look under the
  // pointer never comes to it. Enter and leave and not over and out, so a
  // card's own children do not leave it every time the pointer crosses one
  private readonly entered = () => {
    this.over = true
    this.hovered(true)
  }
  private readonly left = () => {
    this.over = false
    this.hovered(false)
  }

  /**
   * @internal Shown where it stands on the map: in whatever `display` the page
   * wrote inline, which is what showing it means. Cleared to nothing, a card
   * the page laid out with `display: flex` lost its layout on the map.
   */
  showOnMap(): void {
    // Not `none`, though, which a page writes to keep an element out of sight
    // until it is on the map — and the map is what shows it
    const wrote = this.kept?.display
    this.element.style.display = wrote && wrote !== 'none' ? wrote : ''
  }

  /** @internal Out of sight: off screen, outside the mask, or not yet seated. */
  hideOnMap(): void {
    this.element.style.display = 'none'
  }

  /** @internal Told by the viewer: a press let go about where it went down on the element. */
  pressed(x: number, y: number, original: PointerEvent): void {
    this.clicked({ x, y, original })
  }

  /**
   * @internal Dresses the page's element for standing on the map: laid out
   * from the container's own corner, and moved by transform rather than by
   * `left`/`top` — a transform is the one way of moving a box that asks
   * nothing of the page's layout, which is what makes it cheap enough to do
   * every frame.
   *
   * No `will-change: transform`. It was here, and it is what made the letters
   * look soft: it hands the element a compositing layer of its own, and a
   * layer standing on a fraction of a pixel is a layer resampled onto the
   * whole ones. The transform is written every frame either way, so the hint
   * was buying nothing for it.
   *
   * Written when the mark goes onto a map and not in the constructor, so that
   * {@link undressed} can be its exact undoing.
   */
  dressed(): void {
    // Once. Dressed twice, the second keeps what the first wrote as the
    // page's own and hands that back on undressing — which is what a mark
    // added to its group before the group went on a map used to get
    if (this.worn) return
    const style = this.element.style
    this.kept = Object.fromEntries(WORN.map((name) => [name, style[name]])) as Record<
      (typeof WORN)[number],
      string
    >
    standsAs(this.element, this)
    this.element.addEventListener('pointerenter', this.entered)
    this.element.addEventListener('pointerleave', this.left)
    this.element.style.position = 'absolute'
    this.element.style.left = '0'
    this.element.style.top = '0'
    // The layer round it lets pointers through so the map can be dragged; what
    // a page put in it takes its own back — unless the page said it is not to
    // be found, which on an element is the very thing `pointer-events` says
    this.worn = true
    this.wearPicking()
    // A finger on it is the map's, as it is on the canvas. Left to the
    // browser, a finger that came down on a card was the page's to scroll and
    // zoom: it moved the map a few pixels and was taken away
    // (`pointercancel`), and two fingers with one on a card zoomed the page
    // rather than the map (measured, CDP touch on the playground).
    //
    // Not where the page has said what a finger does here, and not on a card
    // that scrolls itself: a card with more in it than fits scrolls under the
    // finger as it does under the wheel. A box that scrolls inside the card
    // scrolls either way — the browser looks for what a touch may do no
    // further up than the box that would do it.
    const page = getComputedStyle(this.element)
    const scrolls = /auto|scroll/.test(page.overflowX + page.overflowY)
    if (page.touchAction === 'auto' && !scrolls) style.touchAction = 'none'
    // And out of sight until it has been given a place.
    //
    // Laid out from the container's corner and moved by a transform, a mark
    // that has not been seated yet is a mark in the corner. The frame that
    // seats it is the next one, so between the two the page's own element is
    // drawn at the top left — and a handful put on together are drawn in a
    // heap there and then jump out to where they belong. Seen on the page
    // that stands five towers in a row: its plates go on once the buildings
    // have said how tall they are, so they are all added in the one breath,
    // in the middle of a frame.
    //
    // Hidden the same way {@link AnnotationLayer.placeMarkup} hides what it
    // cannot seat, and turned back on by it in the same breath as the
    // transform — so there is one way a mark is out of sight and one place
    // that decides it.
    this.element.style.display = 'none'
  }

  /**
   * @internal Hands the element back as the page wrote it.
   *
   * Everything this library ever writes on it: the four above, and the three
   * the group writes each frame to seat it. Without this a page got its
   * element back dressed in whatever the last frame happened to leave — and
   * the last frame leaves `display: none` on anything off screen or behind
   * the mask, so a panel moved from the map into a sidebar was invisible
   * there, and whether it was depended on where the map had been standing.
   */
  undressed(): void {
    // Never dressed, the element is still exactly as the page wrote it
    if (!this.worn) return
    this.worn = false
    standsDown(this.element)
    this.element.removeEventListener('pointerenter', this.entered)
    this.element.removeEventListener('pointerleave', this.left)
    // Taken off under the pointer, it is left: the element going out of the
    // markup layer says nothing of the kind on its own
    if (this.over) this.left()
    // Back to what the page wrote, not to nothing. Cleared, a panel the page
    // had placed with an inline `position` of its own came back unplaced
    const style = this.element.style
    const kept = this.kept
    this.kept = null
    for (const name of WORN) style[name] = kept?.[name] ?? ''
  }

  /**
   * Out of the pointer's way on the element itself, and only while it is on
   * the map: off it, the element is the page's as it wrote it, and
   * `pointer-events` is one of the things handed back.
   */
  protected override repicked(): void {
    if (this.worn) this.wearPicking()
  }

  private wearPicking(): void {
    this.element.style.pointerEvents = this.pickable ? 'auto' : 'none'
  }
}

export interface AnnotationLayerOptions {
  /**
   * What a mark does where something hides it, for the marks on the sheet
   * that say nothing of their own. `'dim'` by default. A property of the layer
   * afterwards, by the same name.
   *
   * Not read for an {@link Html}, which is drawn over the canvas and hidden by
   * nothing in it.
   */
  readonly behind?: Behind
  /**
   * How much of a mark left to `'dim'` shows through what hides it, 0 to 1. A
   * property of the layer afterwards, by the same name.
   */
  readonly dimmed?: number
  /**
   * Drawn at all. On by default. A property of the layer afterwards, by the
   * same name: the one way to take everything in it off the map at once and
   * put it back, as every other layer has it. Writing `root.visible` instead
   * hid what three draws and left the rest — a page's own markup standing,
   * a shadow printed where solids had been.
   */
  readonly visible?: boolean
}

/**
 * A group of annotations, drawn as one.
 *
 * three weaves a shader for each material and that is about a second of the
 * page's start, so a mark cannot afford a material of its own; and the material
 * is told every frame what one viewer's screen is doing — what a pixel of it is
 * worth over the ground, how big its buffer is — so it cannot be shared between
 * viewers either. One of these, seated on a viewer, is what both of those want.
 *
 * The mask is not one of the reasons: nothing of it is woven into the material.
 * It is honoured here, on the processor and a whole mark at a time, by the place
 * each mark stands on — see {@link place}. A mark is one place rather than a
 * patch, so the mask keeps it or leaves it out entire.
 *
 * A page need not make one. Handed a bare {@link Marker} or {@link Label}, the viewer keeps a
 * group of its own and puts the mark in there. This is for a page that wants
 * a group it can name: to give every mark in it one answer, or to take them
 * all off the map at once.
 */
export class AnnotationLayer implements Layer {
  /** Everything the marks are drawn in. The viewer seats it; see {@link Layer.root}. */
  readonly root = new Group()
  /** Over the city, since a mark is read against whatever it stands on. */
  readonly stage = 'overlay' as const

  private viewer: Viewer | null = null
  private readonly kept: Annotation[] = []
  private _behind: Behind
  private _dimmed: number
  private readonly atlas = new Atlas()
  /**
   * One material for each way of standing behind something, and the cards it
   * draws on, made when the first mark asks for it.
   *
   * Whether a mark shows through what hides it is depth, not colour, and depth
   * is settled on the material. So the marks are parted by the answer they
   * give rather than each carrying it — and a page that never asks for one of
   * the three never pays for its shader.
   */
  private readonly meshes = new Map<Draws, AnnotationMesh>()
  /** The meshes made but not hung yet, waiting to hold a mark to be woven with; see {@link place}. */
  private readonly unhung = new Set<AnnotationMesh>()
  /** What the last mark taken on was numbered, so that no two ever share one. */
  private named = 0
  /** That the pictures want drawing again. The work happens on the next frame. */
  private dirty = true
  /**
   * Which half of the day the pictures on the sheet were drawn for, and
   * whether any colour they read was a pair — which together say whether the
   * palette turning over leaves them wrong. See {@link changed}.
   */
  private drawnAtNight = false
  private drewAPair = false
  /**
   * Each mark's picture and where it landed on the sheet, kept between frames.
   *
   * Drawing a mark out and packing the sheet is the dear half and changes only
   * when a page changes a mark. Where a mark stands is the cheap half and can
   * change every frame — a building's tile lands, or the building starts
   * moving and reads another row. So the two are kept apart: this is redone
   * when a page says so, and {@link place} is redone always.
   */
  private laid: { mark: SheetMark; faces: readonly Face[] }[] = []

  constructor(options: AnnotationLayerOptions = {}) {
    this._behind = options.behind ?? 'dim'
    this._dimmed = dimming(options.dimmed)
    this.root.visible = options.visible ?? true
  }

  /** Drawn at all, the page's own markup with the rest; see {@link AnnotationLayerOptions.visible}. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    this.root.visible = value
  }

  /**
   * What a mark does where something hides it, for the marks that say nothing
   * of their own; see {@link AnnotationLayerOptions.behind}.
   *
   * Read as every frame is laid out, which parts the marks by this answer
   * afresh each time — so a change shows on the next frame and costs no
   * drawing. A half no mark asks for any more keeps its mesh, emptied; a half
   * asked for the first time has its material made then, and its shader woven
   * in that frame, which is the same second a mark given that answer costs
   * when it is first added.
   */
  get behind(): Behind {
    return this._behind
  }

  set behind(value: Behind) {
    this._behind = value
  }

  /**
   * How much of a mark left to `'dim'` shows through what hides it, 0 to 1;
   * see {@link AnnotationLayerOptions.dimmed}. Held to that range, as it was
   * when given at the start.
   *
   * A uniform of the one half that draws through what hides, so it is written
   * there and nothing is drawn or woven again.
   */
  get dimmed(): number {
    return this._dimmed
  }

  set dimmed(value: number) {
    this._dimmed = dimming(value)
    this.meshes.get('behind')?.fade(this._dimmed)
  }

  /** What it holds, in the order it was put in. */
  get items(): readonly Annotation[] {
    return this.kept
  }

  /** Puts one in. One already in stays where it is rather than doubling. */
  add(annotation: Annotation): this {
    if (this.kept.includes(annotation)) return this
    if (annotation.heldBy && annotation.heldBy !== this) {
      throw new Error(
        'AnnotationLayer.add: this is already in another AnnotationLayer. Take it out of that one first.',
      )
    }
    this.kept.push(annotation)
    annotation.held(this)
    annotation.item = ++this.named
    // Into the layer over the canvas, if there is one yet. A group put on a
    // viewer later brings everything it is already holding with it, and
    // dresses it then: off the map the element is the page's as it wrote it
    if (annotation instanceof Html && this.viewer) {
      this.viewer.markup.append(annotation.element)
      annotation.dressed()
    }
    this.dirty = true
    return this
  }

  /** Takes one out, leaving it as it was made, to be put back later if wanted. */
  remove(annotation: Annotation): this {
    const at = this.kept.indexOf(annotation)
    if (at < 0) return this
    this.kept.splice(at, 1)
    annotation.held(null)
    annotation.item = 0
    // Back to the page that made it, out of the map's layer and otherwise as
    // it was — it may be put back later, here or somewhere else on the page
    if (annotation instanceof Html) {
      annotation.element.remove()
      annotation.undressed()
    }
    this.dirty = true
    return this
  }

  /** Takes everything out. */
  clear(): void {
    for (const mark of this.kept) {
      mark.held(null)
      mark.item = 0
      if (mark instanceof Html) {
        mark.element.remove()
        mark.undressed()
      }
    }
    this.kept.length = 0
    this.dirty = true
  }

  /** @internal Something it holds was changed and wants drawing again. */
  redraw(): void {
    this.dirty = true
  }

  /**
   * The palette has been made again: draw the sheet again if it was drawn
   * for the other half of the day and anything on it was a pair.
   *
   * Nothing a mark is drawn in comes from the palette — the inks of what a
   * page puts on the map are their own; see `inks.ts` — so a theme handed
   * over changes nothing here. What does is the sun crossing the horizon,
   * which is when a pair says its other colour; and the defaults are pairs,
   * so a mark that names no colour turns over with the rest — as does every
   * symbol whatever it was given, since its edge is the paper's. Once as the sun
   * crosses, and not a frame: the pictures are canvases, and drawing them is
   * the dear half of a mark.
   */
  changed(what: Change): void {
    if (what !== 'colors' || !this.viewer) return
    if (this.drewAPair && this.viewer.night !== this.drawnAtNight) this.dirty = true
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    for (const mark of this.kept) {
      if (!(mark instanceof Html)) continue
      viewer.markup.append(mark.element)
      mark.dressed()
    }
    this.dirty = true
  }

  /**
   * Off the viewer, and the page's markup out of its layer.
   *
   * The elements themselves are left whole, as the marks are: a group taken
   * off one viewer and put on another brings everything it holds, and a page
   * that keeps one of these has it back exactly as it handed it over.
   */
  detach(): void {
    for (const mark of this.kept) {
      if (!(mark instanceof Html)) continue
      mark.element.remove()
      mark.undressed()
    }
    this.viewer = null
  }

  frame(): void {
    const viewer = this.viewer
    if (!viewer) return
    if (this.dirty) {
      this.dirty = false
      this.draw(viewer.night)
    }
    this.place(viewer)
    // Every frame, and not only where the marks changed: what a pixel is worth
    // over the ground is what the zoom decides, and the marks are sized in
    // pixels.
    const { width, height } = viewer.canvasSize
    const ratio = viewer.pixelRatio
    const perPixel = viewer.worldPerPixel
    for (const mesh of this.meshes.values()) {
      mesh.onScreen(perPixel, Math.max(1, width * ratio), Math.max(1, height * ratio), ratio)
    }
  }

  /**
   * The viewer speaks to layers, and a mark is not one — so the group stands
   * between them: it answers for every mark it holds, and hands the click on
   * to the one that was hit.
   */
  listens(type: 'click' | 'hover' | 'pointing'): boolean {
    if (type === 'pointing') return false
    // One the pointer passes through is never found, so its listener is
    // nothing for the viewer to look on its behalf for
    return this.kept.some((mark) => mark.pickable && mark.listens(type))
  }

  clicked(hit: Hit): void {
    this.markAt(hit)?.clicked(hit)
  }

  /**
   * Hands the hover to the mark under the pointer, and tells the one it just
   * left; see {@link ModelLayer.hovered} for why the one before is kept.
   */
  hovered(hit: Hit | null): void {
    const onto = hit ? (this.markAt(hit) ?? null) : null
    if (onto === this.hovering) return
    this.hovering?.hovered(false)
    this.hovering = onto
    onto?.hovered(true)
  }

  dispose(): void {
    // The marks themselves are the page's and outlive this: let go of them
    // first, or each is left saying it is held by a group that is gone and can
    // never be put on another one.
    this.clear()
    for (const mesh of this.meshes.values()) mesh.dispose()
    this.meshes.clear()
    this.unhung.clear()
    this.atlas.dispose()
  }

  /**
   * Which mark the pointer fell on, or nothing.
   *
   * By the number the mark carries rather than by where it was drawn: the marks
   * are laid out afresh every frame and a look is a frame or two in coming
   * back, so a place read then could have changed hands — a tile landing under
   * a mark set on a building is enough. A number is the mark's for as long as
   * this holds it, so a mark taken off in between is simply not found.
   *
   * Walked rather than held in a map of its own: a click is a rare thing beside
   * a frame, and a second list of the marks is a second list to keep in step.
   */
  /** The mark the pointer is on, so the one it leaves can be told. */
  private hovering: Annotation | null = null

  private markAt(hit: Hit): Annotation | undefined {
    return hit.item > 0 ? this.kept.find((mark) => mark.item === hit.item) : undefined
  }

  /**
   * Draws every mark out and lays the pictures on one sheet, in the colours of
   * the half of the day the palette is in.
   *
   * All of them together rather than the one that changed: the sheet is packed
   * afresh whenever anything on it moves, so where every other picture sits
   * has to be given again anyway.
   */
  private draw(night: boolean): void {
    // A page's own markup is not drawn into the sheet, so it is not packed
    // into the atlas either. It is placed with the rest; see `place`.
    const asked = this.kept.filter((mark): mark is SheetMark => mark.visible && mark instanceof SheetMark)
    let drawn: Drawn[][]
    let paired = false
    try {
      // A tag told `'auto'` is drawn both ways, and the frame picks; see `place`
      drawn = asked.map((mark) =>
        leftwards(mark.ways).map((toLeft) => {
          const { drawing, paired: pair } = mark.drawingFor(night, toLeft)
          paired ||= pair
          return { picture: drawAnnotation(drawing), toLeft }
        }),
      )
    } catch (cause) {
      // Thrown out of here, this would be thrown out of the frame: the scene
      // would stop being drawn over a mark that could not be drawn. The marks
      // that were standing keep standing, and the trouble is said aloud
      // rather than swallowed.
      // eslint-disable-next-line no-console
      console.warn('[plateau-ui] AnnotationLayer: these could not be drawn', cause)
      return
    }
    // What does not fit on the sheet is left out, and the rest drawn. Kept as
    // it was instead, one mark too wide — a label some 2,000 pixels long is
    // enough — froze the whole group: what was added did not show, what was
    // taken off stayed, and nothing that changed changed. A mark too big for
    // any sheet goes first; then, where they do not fit together, those added
    // last, as many as it takes.
    const fitting = asked
      .map((mark, i) => ({ mark, ways: drawn[i]! }))
      .filter(({ ways }) => ways.every(({ picture }) => this.atlas.holds(picture)))
    const pictures = (upTo: number): Picture[] =>
      fitting.slice(0, upTo).flatMap(({ ways }) => ways.map(({ picture }) => picture))
    let shown = fitting.length
    let patches = this.packed(pictures(shown))
    if (!patches) {
      let fits = 0
      let fails = shown
      while (fails - fits > 1) {
        const mid = (fits + fails) >> 1
        if (this.packed(pictures(mid))) fits = mid
        else fails = mid
      }
      shown = fits
      patches = this.packed(pictures(shown)) ?? []
    }
    if (shown < asked.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[plateau-ui] AnnotationLayer: ${asked.length - shown} of ${asked.length} marks do not fit on the sheet ` +
          'and are not drawn. Split them between groups, or make them smaller.',
      )
    }
    this.drawnAtNight = night
    this.drewAPair = paired
    this.laid = []
    let next = 0
    for (const { mark, ways } of fitting.slice(0, shown)) {
      const faces: Face[] = []
      for (const { picture, toLeft } of ways) {
        const patch = patches[next++]
        if (patch) faces.push({ picture, patch, toLeft })
      }
      if (faces.length > 0) this.laid.push({ mark, faces })
    }
  }

  /** The pictures packed onto the sheet, or nothing where they do not fit together. */
  private packed(pictures: readonly Picture[]): Patch[] | null {
    try {
      return this.atlas.pack(pictures)
    } catch {
      return null
    }
  }

  /**
   * Seats every mark and hands each mesh the marks that answer as it does.
   *
   * Every frame. A mark set on a building cannot be seated until that
   * building's tile has landed, and what it is seated by changes under it
   * afterwards — a tile thrown out and fetched again is a mesh of its own, and
   * a building that starts moving reads another row from that moment. Asking
   * again is a lookup held by name and a little arithmetic; drawing it again
   * is not, which is why that is not done here.
   */
  private place(viewer: Viewer): void {
    // Asked for afresh rather than kept: a page may add its buildings after
    // its marks, and a layer added later is one this would never find if it
    // had looked the once.
    const city = viewer.onBuildings
    // Made for this pass and thrown away, as it is meant to be: it remembers
    // the tile it last read, and the marks of a page sit near one another.
    // Nothing to read where the land is drawn flat, and nothing to ask for
    // either — a mark takes the heights that are already in hand.
    const land = viewer.elevation ? heightsInHand() : null

    this.placeMarkup(viewer, city, land)

    const parted = new Map<Behind, Instance[]>()
    /** How far into the screen each stands, for laying the far ones down first; see below. */
    const far = new Map<Instance, number>()
    for (const { mark, faces } of this.laid) {
      const seat = this.seatOf(mark, city, land)
      if (!seat) continue
      // Judged by the place the mark stands on rather than by the rectangle it
      // draws: sized in pixels, that rectangle reaches metres from its own
      // place at a far zoom, and cutting by its corners would drop a mark
      // whose place is well inside the shape.
      const { x, z } = worldOf(seat)
      if (!maskHolds(viewer.maskArea, x, z)) continue

      const behind = mark.behind ?? this._behind
      let instances = parted.get(behind)
      if (!instances) parted.set(behind, (instances = []))
      const put = worldOfNow(seat, STANDING)
      const here = viewer.screen.atWorld(put.x, put.y, put.z)
      const depth = here.depth
      // The one way it was drawn, or of the two, the way it runs this frame
      const left = faces.length > 1 && this.runsLeft(mark, here.x, viewer, city, land)
      const { picture, patch } = faces.find((face) => face.toLeft === left) ?? faces[0]!
      const instance: Instance = {
        ...seat,
        item: mark.item,
        pickable: mark.pickable,
        patch,
        width: picture.width,
        height: picture.height,
        // Moved off its place by pulling the place the other way inside the
        // picture: the shader lays the picture out from where its place falls
        // in it, so this is the whole of the move and no buffer is added
        gripX: picture.gripX - (mark.pixelOffset?.[0] ?? 0),
        gripY: picture.gripY - (mark.pixelOffset?.[1] ?? 0),
      }
      instances.push(instance)
      far.set(instance, depth)
    }

    // A dimmed mark goes into both halves: the one that draws what nothing
    // hides, and the one that draws the rest of it through whatever does.
    const drawn = new Map<Draws, Instance[]>()
    for (const [behind, instances] of parted) {
      for (const draws of DRAWN_BY[behind]) {
        const already = drawn.get(draws)
        if (already) already.push(...instances)
        else drawn.set(draws, [...instances])
      }
    }
    // The far ones first and the near ones over them, as the page's own
    // markup is stacked (see `placeMarkup`). Nothing here writes depth, so
    // they cover one another in the order they are drawn, and that was the
    // order they were added in: a label put on last, on the building behind,
    // was drawn over the label of the building in front of it
    for (const instances of drawn.values()) instances.sort((a, b) => far.get(b)! - far.get(a)!)

    for (const [draws, instances] of drawn) this.meshFor(draws).set(instances)
    // A half nobody asked for this time still has its mesh; it is emptied
    // rather than thrown away, since the next frame may want it back.
    for (const [draws, mesh] of this.meshes) if (!drawn.has(draws)) mesh.set([])

    // A mesh made this frame is hung once its cards are woven, and only the
    // cards that hold a mark are woven: one with no marks has no instance
    // buffers yet, and a shader woven against it is not the one it draws with.
    // Hung at once, the first frame drew both halves of the page's pins
    // unwoven, four pipelines made on the spot (measured 2026-11-17,
    // security-camera). Its marks show a few frames later instead
    for (const mesh of this.unhung) {
      const holding = mesh.meshes.filter((card) => card.visible)
      if (holding.length === 0) continue
      this.unhung.delete(mesh)
      void viewer
        .weave(...holding)
        .catch(() => undefined)
        .then(() => {
          if (![...this.meshes.values()].includes(mesh)) return
          for (const card of mesh.meshes) this.root.add(card)
        })
    }
  }

  /**
   * Holds every piece of the page's markup over its place, for this frame.
   *
   * Seated the same way the marks on the sheet are — the same `at`, the same
   * heights, the same mask — and then projected, which is the one step that
   * differs. What cannot be seated is hidden rather than left where it was: a
   * building whose tile has gone would otherwise leave its card standing over
   * whatever is there now.
   *
   * Stacked by how far off each is, so two cards over the same city put the
   * nearer one in front. By their order among themselves rather than by the
   * distance itself, since a z-index is a small integer and a distance here is
   * in the tens of thousands.
   */
  private placeMarkup(viewer: Viewer, city: StandsOnBuildings | null, land: Heights | null): void {
    const ratio = viewer.pixelRatio
    const standing: { mark: Html; place: ScreenPlace }[] = []
    for (const mark of this.kept) {
      if (!(mark instanceof Html)) continue
      // The group turned off takes its page markup with it, as it takes the
      // marks on the sheet: those go with the root they hang from, and these
      // hang from nothing three draws, so they were left standing — and
      // clickable — over a map the page had cleared of the rest
      const seat = mark.visible && this.root.visible ? this.seatOf(mark, city, land) : null
      if (!seat) {
        mark.hideOnMap()
        continue
      }
      // Held or not by where it belongs, as the marks on the sheet are judged:
      // a mark does not leave the shape because the building under it is a
      // second from being up.
      const { x, z } = worldOf(seat)
      if (!maskHolds(viewer.maskArea, x, z)) {
        mark.hideOnMap()
        continue
      }
      // And then put where the frame caught it. The marks on the sheet are
      // moved in the shader by the building's own arithmetic; this is the same
      // move, done here because what carries it is a page's own element.
      const put = worldOfNow(seat, STANDING)
      const place = viewer.screen.atWorld(put.x, put.y, put.z)
      if (!place.onScreen) {
        mark.hideOnMap()
        continue
      }
      mark.showOnMap()
      // Standing over its place, or lying beside it — the two a label has, and
      // the same two. Over: the box sits on the place, since what is named is
      // the ground and a box centred on it buries its own bottom half in
      // whatever stands there. Beside: level with the place and running out to
      // the right of it, which is how a tick against a rule is read.
      //
      // Worked out in pixels and snapped to whole ones of the screen rather
      // than written as `translate(-50%, -100%)`: a place lands wherever it
      // lands, and half of a box 66 wide is a third of a pixel — between them
      // the letters stood on fractions and the browser drew them soft. Snapped
      // to the screen's own pixels and not the page's, so a fine screen still
      // moves them by halves rather than in whole steps.
      const wide = mark.element.offsetWidth
      const high = mark.element.offsetHeight
      const left = place.x - (mark.beside ? 0 : wide / 2) + (mark.pixelOffset?.[0] ?? 0)
      const top = place.y - (mark.beside ? high / 2 : high) + (mark.pixelOffset?.[1] ?? 0)
      mark.element.style.transform = `translate(${snap(left, ratio)}px, ${snap(top, ratio)}px)`
      standing.push({ mark, place })
    }
    standing.sort((a, b) => b.place.depth - a.place.depth)
    for (const [i, { mark }] of standing.entries()) mark.element.style.zIndex = String(i + 1)
  }

  /** The mesh for one way of drawing, made the first time one is wanted. */
  private meshFor(draws: Draws): AnnotationMesh {
    let mesh = this.meshes.get(draws)
    if (!mesh) {
      mesh = new AnnotationMesh(this.atlas, draws)
      mesh.fade(draws === 'behind' ? this._dimmed : 1)
      this.meshes.set(draws, mesh)
      // Hung by `place` once woven. Each card says its own place in the
      // stage; see `AnnotationMesh`
      this.unhung.add(mesh)
    }
    return mesh
  }

  /**
   * Where a mark stands, in the terms the shader moves it by, or nothing where
   * that is not known yet.
   *
   * A mark on the land is given the same shape as a mark on a building: its
   * own place standing in for the tile's, a stretch of one, and no row to
   * read. The shader then has one piece of arithmetic rather than a branch,
   * and the two kinds of mark cost one shader between them.
   *
   * The two kinds of place (see {@link AnnotationPlace.at}) part in `seatAt`,
   * as they do for a solid and a model: a place on a building is the city's to
   * answer and waits for it, one on a model or a solid is worked out from the
   * thing's own words, and a spot on the map is seated on the land with nothing
   * named beside it.
   */
  private seatOf(
    mark: Annotation,
    city: StandsOnBuildings | null,
    land: Heights | null,
  ): BuildingSeat | null {
    return seatAt(city, land, mark.at, mark.height)
  }

  /**
   * Whether a tag told `'auto'` runs off to the left of its place this frame;
   * see {@link MarkerOptions.direction}.
   *
   * Held to a thing, away from the middle of its foot: the same place with the
   * offset across taken out and the height left in, so the two are compared at
   * one height and a tall wall's tag is not judged against the ground below it.
   * Where the two fall on one column of the screen, or there is no thing, as
   * Leaflet does it: by the half of the screen the place is in.
   */
  private runsLeft(
    mark: Annotation,
    x: number,
    viewer: Viewer,
    city: StandsOnBuildings | null,
    land: Heights | null,
  ): boolean {
    const at = mark.at
    if (isAnchor(at)) {
      const up = at.offset?.[2] ?? 0
      const middle = seatAt(city, land, { ...at, offset: [0, 0, up] } as Where, mark.height)
      if (middle) {
        const foot = worldOfNow(middle, FOOT)
        const footX = viewer.screen.atWorld(foot.x, foot.y, foot.z).x
        if (x !== footX) return x < footX
      }
    }
    return x > viewer.canvasSize.width / 2
  }
}

/** Held for {@link AnnotationLayer.runsLeft}, which is asked per tag per frame. */
const FOOT = new Vector3()

/** One way a mark was drawn, and where on the sheet that picture went. */
interface Face {
  readonly picture: Picture
  readonly patch: Patch
  readonly toLeft: boolean
}

/** A picture as drawn, before it has a place on the sheet. */
interface Drawn {
  readonly picture: Picture
  readonly toLeft: boolean
}

/** The ways a mark is drawn, as whether each runs left: one, or both for the frame to choose. */
function leftwards(ways: MarkerDirection): readonly boolean[] {
  return ways === 'auto' ? [false, true] : [ways === 'left']
}

/** A page pixel brought to the nearest whole one of the screen. */
function snap(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio
}

/**
 * A colour as the canvas takes it.
 *
 * A string goes as it was written, since the canvas reads CSS and three's
 * `Color` does not keep what it cannot hold — an alpha, most of all, which is
 * what a drop shadow's strength is written in. Anything else is three's to
 * say: a number or a `Color` written out the way three writes it.
 */
function cssOf(color: ColorRepresentation): string {
  return typeof color === 'string' ? color : new Color(color).getStyle()
}

/**
 * A colour as a mark holds it: a pair copied and frozen, anything else as it
 * came.
 *
 * Copied so that what a page hands over is read once, as it was when handed
 * over — writing into it afterwards is not a change this would be told of, and
 * a picture that took it up only on some later redraw would be one nobody
 * asked for. Frozen so that what a getter hands back says so when written to.
 */
function keep(color: ThemeColor): ThemeColor
function keep(color: ThemeColor | undefined): ThemeColor | undefined
function keep(color: ThemeColor | undefined): ThemeColor | undefined {
  if (typeof color === 'object' && color !== null && 'light' in color && 'dark' in color) {
    return Object.freeze({ light: color.light, dark: color.dark })
  }
  return color
}

/**
 * What a mark says, a line at a time.
 *
 * Broken where the page wrote a newline, and every line of it in the mark's
 * own face and ink. Lines that could each be set differently were here once
 * and are gone: a mark on the sheet says one thing in the map's own voice,
 * and a thing said in two voices is a page's to write — see {@link Html},
 * where the voices are a stylesheet's.
 *
 * The face goes on each line all the same, since that is what the sheet
 * takes: it lays them out one at a time and asks each what it is set in.
 * Answered here rather than where it is drawn, so the answer is given once.
 */
function linesOf(mark: SheetMark): DrawnLine[] {
  const label = mark.words
  if (label === '') return []
  return label.split('\n').map((text) => ({ text, font: mark.font }))
}
