import { Discard, Fn, positionWorld } from 'three/tsl'
import { uniform } from './repaint.js'
import { Color, DoubleSide, Group, Mesh, MeshBasicNodeMaterial, Vector3, type Node } from 'three/webgpu'
import {
  DEFAULT_DIMMED,
  DRAWN_BY,
  blendOverOpaque,
  pressToLand,
  readDepth,
  type Behind,
  type Draws,
} from './behind.js'
import { heightsInHand } from './elevation.js'
import type { WorldBounds } from './geo/mercator.js'
import { Surface } from './ground/surface.js'
import { OVER_THE_GROUND } from './ground/tileGeometry.js'
import { MaskShader, maskIn } from './mask.js'
import type { BuildingSeat } from './onBuildings.js'
import { paintsOn, type Paints } from './paints.js'
import { Events } from './events.js'
import { notPicked } from './pick.js'
import { seatAt, worldOfNow, type Where } from './screen.js'
import type { SightAsker, SightLook } from './sight.js'
import { colorFor, type ThemeColor } from './theme.js'
import type { Change, Layer, Viewer } from './Viewer.js'

/** How far the eye sees, in metres, where a page does not say. */
const DEFAULT_RANGE = 300
/** How much of the colour goes on where a place is in sight. */
const DEFAULT_OPACITY = 0.55
/**
 * The colour, where a page does not choose one: an amber that nothing on the
 * map is anywhere near, so it reads as a page's working rather than as
 * something in the city. One colour for both palettes: it reads on the light
 * one's ground and the dark one's alike.
 */
const DEFAULT_COLOR = '#f08c00'
/**
 * How much of the way to a place is forgiven, in metres; see {@link
 * SightLook.slack}. What is judged is the surface itself — the very pavement
 * and the very wall drawn into the cube — so without this every face comes out
 * hidden by itself.
 */
const SLACK = 2

/**
 * How wide and how tall an eye takes things in, in degrees across the whole of
 * each.
 *
 * Two and not one because they are two questions. A lens is wider than it is
 * tall, and a sign is read from well round to the side of the street it faces
 * but not from the pavement at the foot of its own wall. One angle for both
 * makes the shape a torch's cone, and narrowing it to keep the far sides out
 * takes the ground under the eye with it.
 */
export interface FieldOfView {
  /** How much it takes in to the left and the right of {@link ViewshedBase.facing}. 360 by default. */
  readonly horizontal?: number
  /** How much it takes in above and below flat; 180 is straight up to straight down, and the default. */
  readonly vertical?: number
}

/** What every viewshed has, whichever way it is drawn. */
export interface ViewshedBase {
  /**
   * Where the eye is, said the way a mark, a solid and a model say it: a spot
   * on the map, or a place on a building, a model or a solid; see
   * {@link Where}. A click hands back both.
   *
   * Held to a building, the eye rides it. It stands where the place says and
   * nowhere else: the `anchor` of a wall clicked puts it on the face itself,
   * at the height clicked.
   *
   * On the face itself it sees through the face. The wall is nought away from
   * an eye standing on it, so the cube holds nothing in front of what is
   * behind the wall, and the inside of the building and the street beyond are
   * painted as seen. A page meaning a window puts the eye a little out from
   * the wall, by however much it means — the library does not move it, since
   * a place moved to look right is a place a page did not give.
   */
  readonly at: Where
  /**
   * Which way it looks: degrees, 0 north, as {@link Camera.heading} is. Left
   * out, it looks all round and {@link fov} is not read.
   */
  readonly facing?: number
  /**
   * How much it takes in about {@link facing}, in degrees across. One number
   * is both ways at once; see {@link FieldOfView}. All round where it is left
   * out.
   *
   * The sides are cut square rather than rounded off, so a place up and to the
   * side is in where a cone would have dropped it: the shape is a camera's.
   */
  readonly fov?: number | FieldOfView
  /** How far it reaches, in metres. 300 by default. */
  readonly range?: number
  /**
   * The colour a place in sight is painted, as it reads in full daylight; the
   * same promise a shape's colour makes. A pair is told apart as the sun
   * crosses the horizon.
   */
  readonly color?: ThemeColor
  /** How much of it goes on, 0 to 1. */
  readonly opacity?: number
  /**
   * Over how many metres at the end of the range the colour thins out to
   * nothing, the way a mask's {@link Mask.fade} thins over the last of its
   * shape. Nought by default, which ends the range on a line.
   */
  readonly fade?: number
  /** Drawn at all. */
  readonly visible?: boolean
}

/**
 * How it is drawn: painted on what is there, or laid on the land as a thing
 * of its own that what stands in front of it hides, dims or does not.
 *
 * The same choice a shape makes and in the same words: the one sets
 * {@link Paints}, the other {@link Behind}, and a page says one or the other.
 */
export type ViewshedSticks =
  | {
      /**
       * What the sight is painted on: the land, what was built on it, or both.
       * `'all'` by default.
       *
       * A sight is about places rather than about the ground, and a wall is a
       * place: which windows a sign can be read from is the same question as
       * which of the street it can be read from. The land is painted by this
       * layer, on a sheet it lays under the eye. What was built is painted by
       * whatever draws it, as it draws — the city, a solid, a page's own layer
       * that asks for it (`viewer.sight.paint`) — and the trees go with the
       * land, as they do wherever the ground is painted.
       */
      readonly paints?: Paints
      readonly behind?: never
      readonly dimmed?: never
    }
  | {
      readonly paints?: never
      /**
       * Laid on the land alone, as a thing of its own, and what it does where
       * something stands in front of it; see {@link Behind}.
       *
       * Nothing that stands is painted then. A wall is painted by the city as
       * it draws itself, so it has nothing to say about what is in front of it
       * — a wall with something in front of it was never drawn.
       */
      readonly behind: Behind
      /** How much of the part something stands in front of shows, 0 to 1. Read only with `'dim'`. */
      readonly dimmed?: number
    }

export type ViewshedOptions = ViewshedBase & ViewshedSticks

/** What a viewshed tells the page about. */
export interface ViewshedEvents {
  /**
   * What {@link Viewshed.sees} answers has changed: the eye's cube was drawn
   * again — for a new place or way of looking, or for a city that moved under
   * it — and read back. Asked again on this, a question that came back null
   * has its answer.
   *
   * Named as every layer names its own; what changed here is the answers.
   * Listening is one of the two ways of asking (the other is {@link Viewshed.sees}
   * itself): the cube is read back off the card only once somebody has.
   */
  changed: { readonly viewshed: Viewshed }
}

/**
 * What one place can see, painted on it.
 *
 * A camera and the ground it covers; a sign on a wall and the street and the
 * windows it can be read from; a tower and the city it looks out over. A place
 * is in sight where nothing stands on the line between it and the eye, inside
 * the range and inside what a `facing` and a `fov` take in.
 *
 * Worked out the way a point light's shadow is: the scene drawn again from the
 * eye into the six faces of a cube, keeping how far off the nearest thing was
 * each way, and every face in range comparing its own distance with the one
 * drawn its way. The viewer does that drawing, with its own renderer, and only
 * when what the cube holds has gone stale; see `sight.ts`.
 *
 * **What hides a place is whatever the scene has in it**: the buildings as the
 * styles leave them, a page's own models and solids, the land itself, and the
 * trees the ground scatters over a park — which are a guess at what grows
 * there rather than a survey of it, and which hide a street all the same, since
 * what is measured is the city as it is drawn. Only what is drawn counts:
 * buildings arrive as the view comes over them, so a building off the screen
 * that was never fetched hides nothing.
 *
 * **One is painted at a time**: the one put on last. The others keep their place
 * and come back as the one over them is taken off or turned off. Every surface
 * in the city reads one cube; painting several at once is a question of how
 * their colours are told apart before it is one of cubes.
 *
 * @example
 * // What a camera on a corner covers, out to 120 m.
 * viewer.add(new Viewshed({
 *   at: { lng: 139.6655, lat: 35.7056, height: 6 },
 *   facing: 200,
 *   fov: { horizontal: 90, vertical: 60 },
 *   range: 120,
 * }))
 */
export class Viewshed implements Layer {
  private readonly events = new Events<ViewshedEvents>()

  /** Listens for the answers changing. Hands back the way to stop. */
  on<K extends keyof ViewshedEvents>(type: K, listener: (event: ViewshedEvents[K]) => void): () => void {
    this.ask()
    return this.events.on(type, listener)
  }

  /** The painted land. The viewer seats it; see {@link Layer.root}. */
  readonly root = new Group()
  /**
   * Laid on the land, with the roads and the water it is painted over; the
   * buildings cover it as they cover a road.
   */
  readonly stage = 'ground' as const

  private viewer: Viewer | null = null
  private _at: Where
  private _facing: number | undefined
  private _fov: number | FieldOfView | undefined
  private _range: number
  private _color: ThemeColor | undefined
  private _opacity: number
  private _fade: number
  private _paints: Paints | undefined
  private _behind: Behind | undefined
  /** How much of the dimmed half shows; a uniform, so changing it weaves nothing. */
  private readonly shown = uniform(DEFAULT_DIMMED)

  /** The sheet the land is painted on, the ground's own kind; see `ground/surface.ts`. */
  private readonly surface = new Surface()
  private readonly mask = new MaskShader()
  /**
   * What the land is drawn in now: one mesh painting it, or the halves of a
   * thing that what stands in front of it hides. All of them on the one sheet.
   */
  private meshes: Mesh[] = []
  /**
   * Every material made on this viewer so far, by what it draws, so that
   * turning back costs nothing. Made on a viewer because what they read is
   * that viewer's sight; see {@link paintFor}.
   */
  private readonly materials = new Map<Draws | 'paint', MeshBasicNodeMaterial>()
  /** What the last weaving was for, so that one overtaken does not hang; see {@link redraw}. */
  private weaving = 0
  /** What this eye last told the viewer, so an unchanged frame tells it nothing. */
  private look: SightLook | null = null
  /** Held for the frame's working, so that a frame that changes nothing makes nothing. */
  private readonly eye = new Vector3()
  private readonly facingOf = new Vector3()
  private readonly colour = new Color()
  /** Held for {@link sees}: the place asked about, in the world's units. */
  private readonly placeAsked = new Vector3()
  /**
   * Whether a page has asked anything of this eye, by {@link sees} or by
   * listening. Until it has, the cube stays on the card: reading it back is
   * six megabytes off the card every time it is drawn.
   */
  private asking = false
  /** What the viewer's sight is told about this eye's askers; see {@link SightAsker}. */
  private readonly asker: SightAsker = {
    asks: () => this.asking,
    told: () => this.events.emit('changed', { viewshed: this }),
  }

  constructor(options: ViewshedOptions) {
    this.root.name = 'Viewshed'
    this._at = options.at
    this._facing = options.facing
    this._fov = options.fov
    this._range = Math.max(options.range ?? DEFAULT_RANGE, 0)
    this._color = options.color
    this._opacity = clamp01(options.opacity ?? DEFAULT_OPACITY)
    this._fade = Math.max(options.fade ?? 0, 0)
    this._paints = options.paints
    this._behind = options.behind
    this.shown.value = clamp01(options.dimmed ?? DEFAULT_DIMMED)
    this.root.visible = options.visible ?? true
  }

  /** Where the eye is; see {@link ViewshedBase.at}. */
  get at(): Where {
    return this._at
  }

  set at(value: Where) {
    this._at = value
  }

  /** Which way it looks, or nothing to look all round; see {@link ViewshedBase.facing}. */
  get facing(): number | undefined {
    return this._facing
  }

  set facing(value: number | undefined) {
    this._facing = value
  }

  /** How much it takes in about its facing; see {@link ViewshedBase.fov}. */
  get fov(): number | FieldOfView | undefined {
    return this._fov
  }

  set fov(value: number | FieldOfView | undefined) {
    this._fov = value
  }

  /** How far it reaches, in metres. */
  get range(): number {
    return this._range
  }

  set range(value: number) {
    this._range = Math.max(value, 0)
  }

  /** The colour a place in sight is painted, or nothing for the default; see {@link ViewshedBase.color}. */
  get color(): ThemeColor | undefined {
    return this._color
  }

  set color(value: ThemeColor | undefined) {
    this._color = value
  }

  /** How much of the colour goes on, 0 to 1. */
  get opacity(): number {
    return this._opacity
  }

  set opacity(value: number) {
    this._opacity = clamp01(value)
  }

  /** Over how many metres at the end of the range the colour thins out; see {@link ViewshedBase.fade}. */
  get fade(): number {
    return this._fade
  }

  set fade(value: number) {
    this._fade = Math.max(value, 0)
  }

  /**
   * What the sight is painted on, or nothing where it is laid on the land as a
   * thing of its own; see {@link ViewshedSticks}. Setting it paints again,
   * whatever {@link behind} said.
   */
  get paints(): Paints | undefined {
    return this._behind === undefined ? (this._paints ?? 'all') : undefined
  }

  set paints(value: Paints | undefined) {
    const was = this.drawnBy
    this._paints = value
    this._behind = undefined
    if (this.drawnBy !== was) this.redraw()
  }

  /**
   * What the land does where something stands in front of it, or nothing
   * where the sight is painted; see {@link ViewshedSticks}. Setting it lays the
   * sight on the land alone, whatever {@link paints} said; nothing paints it
   * again.
   *
   * Changing between the two, or between two of these, weaves the sheet's
   * shaders afresh, which is a second's work off the frame: what reads which
   * depth is settled on a material as it is woven. What has been woven once is
   * kept, so turning back costs nothing.
   */
  get behind(): Behind | undefined {
    return this._behind
  }

  set behind(value: Behind | undefined) {
    const was = this.drawnBy
    this._behind = value
    if (value !== undefined) this._paints = undefined
    if (this.drawnBy !== was) this.redraw()
  }

  /** How much of the part something stands in front of shows, 0 to 1; read only with `behind: 'dim'`. */
  get dimmed(): number {
    return this.shown.value
  }

  set dimmed(value: number) {
    this.shown.value = clamp01(value)
  }

  /**
   * Drawn at all. Turned off it comes off the viewer's sight, so the eye under
   * it is painted; turned on it goes back on over every other, as one put on
   * now would.
   */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (this.root.visible === value) return
    this.root.visible = value
    if (!value) this.release()
  }

  /**
   * Hangs the sheet once woven, as a change of drawing does ({@link redraw}).
   *
   * It was hung at once and left to the viewer's weaving of the whole scene,
   * which walks past a root told `visible = false`: a sight a page shows only
   * once the city stands was drawn unwoven in that frame (measured
   * 2026-11-17, security-camera), and one put on after the viewer started was
   * never woven at all. The meshes are woven themselves, shown, whatever the
   * root says; the geometry carries its corners from the start (CLAUDE.md,
   * "그 처음이 생성자 시점으로").
   */
  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.mask.set(viewer.maskArea)
    this.mask.fadeInto(viewer.colors.backdrop)
    this.look = null
    this.meshes = []
    this.redraw()
  }

  /** Takes the sheet down with the paint that read this viewer's sight. */
  detach(): void {
    this.release()
    this.weaving++
    this.viewer = null
    this.unmake()
  }

  /**
   * A viewshed answers three of the words; see {@link Change}. The view is not
   * one of them: what one place can see does not turn on where it is looked at
   * from.
   */
  changed(what: Change): void {
    const viewer = this.viewer
    if (!viewer) return
    switch (what) {
      case 'colors':
        // The hem the mask leaves goes over to whatever the scene is backed
        // with. A colour given as a pair is read again by the frame
        this.mask.fadeInto(viewer.colors.backdrop)
        return
      case 'mask':
        // What is drawn at all has changed, so what hides what has changed with it
        this.mask.set(viewer.maskArea)
        if (this.showing) viewer.sight.stir()
        return
      case 'elevation':
        // The land has risen or gone flat, and the city standing on it with it
        if (this.showing) viewer.sight.stir()
        return
    }
  }

  /**
   * Seats the eye, tells the viewer how it looks where that has changed, and
   * lays the sheet under it.
   *
   * The eye is seated every frame rather than once: on a building, a tile
   * lands, is thrown out for memory and comes back as a mesh of its own, and a
   * building that starts moving reads another row from that moment. A frame
   * that comes to the same eye tells the viewer nothing, and a cube is drawn
   * only for a change.
   */
  frame(): void {
    const viewer = this.viewer
    if (!viewer) return
    if (!this.root.visible) {
      this.release()
      return
    }
    const seat = this.seat(viewer)
    // A building not in hand answers nothing, and the eye waits where it was
    // rather than dropping to the ground: the look stays as it is
    if (seat) {
      const look = this.lookFrom(seat, viewer)
      if (!this.look) viewer.sight.claim(this, look, this.root, this.asker)
      else if (look !== this.look) viewer.sight.update(this, look)
      this.look = look
    }
    this.lay(viewer)
  }

  /**
   * Whether a place is in sight of this eye: in its reach and what it takes
   * in, with nothing drawn in the way. Null where there is no answer yet — the
   * cube for where it now looks has not been drawn and read back, this eye is
   * under another (one is painted at a time), it is not on a viewer, or the
   * place is held to something not in hand. Asked again on {@link ViewshedEvents.changed}.
   *
   * The paint's own answer: off the very cube the walls and the land read, so
   * a place that comes out in sight is a place painted, to the grain of that
   * cube — about a sixth of a degree.
   *
   * **A place on a surface is not lifted off it.** The paint lifts every point
   * a little off its own face before it asks, since far off along a surface the
   * eye barely sees one texel holds a long stretch of it, and a point lying on
   * that stretch reads as hidden by it. A place asked here has no face, so a
   * page asking about the ground asks about a height over it — where a
   * person's head is, say — and the answer is about that.
   *
   * The first question, or the first listener, is what starts the cube being
   * read back, so the first answer is null.
   */
  sees(at: Where): boolean | null {
    this.ask()
    const viewer = this.viewer
    if (!viewer) return null
    const seat = seatAt(viewer.onBuildings, viewer.elevation ? heightsInHand() : null, at, undefined)
    if (!seat) return null
    return viewer.sight.sees(this, worldOfNow(seat, this.placeAsked))
  }

  /** Lets go of the sheet and the paint, and comes off the viewer's sight. */
  dispose(): void {
    this.weaving++
    this.release()
    this.unmake()
    this.surface.dispose()
  }

  /**
   * Marks this eye as asked about; see {@link asking}. The first time, a cube
   * already drawn is drawn again so that it is read back: one drawn while
   * nobody asked was left on the card.
   */
  private ask(): void {
    if (this.asking) return
    this.asking = true
    if (this.showing) this.viewer?.sight.stir()
  }

  /** Whether this eye is the one the viewer paints. */
  private get showing(): boolean {
    return this.viewer?.sight.shows(this) ?? false
  }

  /** Off the viewer's sight; put on again by the next frame it is drawn. */
  private release(): void {
    this.viewer?.sight.release(this)
    this.look = null
  }

  /** What the land is drawn by now: the paint, or one of the three answers to {@link Behind}. */
  private get drawnBy(): Behind | 'paint' {
    return this._behind ?? 'paint'
  }

  /** Where the eye stands this frame, worked out the one way everything standing on the map is. */
  private seat(viewer: Viewer): BuildingSeat | null {
    return seatAt(viewer.onBuildings, viewer.elevation ? heightsInHand() : null, this._at, undefined)
  }

  /**
   * The look this frame comes to, in the world's own units — the one last told
   * the viewer where nothing in it has changed, so that an unchanged frame
   * tells it nothing and allocates nothing.
   */
  private lookFrom(seat: BuildingSeat, viewer: Viewer): SightLook {
    const eye = worldOfNow(seat, this.eye)
    // Real metres against world units: the world is Mercator, stretched with
    // latitude, and the stretch at the eye does for the whole reach, as one
    // does for a tile of the ground
    const stretch = seat.stretch
    const range = this._range * stretch
    const fade = this._fade * stretch
    const slack = SLACK * stretch
    let cone = -2
    let steep = 2
    const facing = this.facingOf.set(0, 0, -1)
    if (this._facing !== undefined) {
      // North is where z is least, so a bearing points sin east and minus cos south
      const turn = (this._facing * Math.PI) / 180
      facing.set(Math.sin(turn), 0, -Math.cos(turn))
      const fov = this._fov
      const across = (typeof fov === 'number' ? fov : fov?.horizontal) ?? 360
      const over = (typeof fov === 'number' ? fov : fov?.vertical) ?? 180
      // Kept as what the shader wants: a cosine for how far round, a sine for
      // how far up. Past the whole turn and past the half turn there is nothing
      // left to cut, and a number no reading can fail says so
      cone = across >= 360 ? -2 : Math.cos((across * Math.PI) / 360)
      steep = over >= 180 ? 2 : Math.sin((over * Math.PI) / 360)
    }
    const colour = this.colour.set(colorFor(this._color ?? DEFAULT_COLOR, viewer.night))
    const paints = this.paintedOn
    const ground = paints !== null && paintsOn(paints, 'ground')
    const buildings = paints !== null && paintsOn(paints, 'buildings')
    const was = this.look
    if (
      was &&
      was.eye.equals(eye) &&
      was.facing.equals(facing) &&
      was.cone === cone &&
      was.steep === steep &&
      was.range === range &&
      was.fade === fade &&
      was.slack === slack &&
      was.color.equals(colour) &&
      was.opacity === this._opacity &&
      was.ground === ground &&
      was.buildings === buildings
    ) {
      return was
    }
    // Made afresh rather than written over: the viewer keeps the look its cube
    // was drawn for, and tells a move by comparing the two
    return {
      eye: eye.clone(),
      facing: facing.clone(),
      cone,
      steep,
      range,
      fade,
      slack,
      color: colour.clone(),
      opacity: this._opacity,
      ground,
      buildings,
    }
  }

  /** What the sight is painted on, or null where it is laid on the land alone. */
  private get paintedOn(): Paints | null {
    return this.paints ?? null
  }

  /**
   * Lays the sheet over the land in range, where the mask and the view leave
   * any, and draws it only while this eye is the one painted — every sheet
   * reads the one sight, and the one under another would wear that one's
   * answer.
   */
  private lay(viewer: Viewer): void {
    const look = this.look
    const paints = this.paintedOn
    const onLand = paints === null || paintsOn(paints, 'ground')
    const bounds = look && onLand && this.showing ? this.reach(look, viewer) : null
    for (const mesh of this.meshes) mesh.visible = bounds !== null
    if (!bounds) return
    this.surface.follow(bounds, viewer.elevation ? viewer.landHeights : null)
    // The meshes share the sheet's one shape, and the sheet is laid by moving it
    for (const mesh of this.meshes) mesh.position.copy(this.surface.mesh.position)
  }

  /** The square of land in range, cut to what the mask and the view leave of it. */
  private reach(look: SightLook, viewer: Viewer): WorldBounds | null {
    const around: WorldBounds = {
      minX: look.eye.x - look.range,
      maxX: look.eye.x + look.range,
      // The world's y runs north where its z runs south
      minY: -look.eye.z - look.range,
      maxY: -look.eye.z + look.range,
    }
    const view = maskIn(viewer.maskArea, viewer.visibleBounds)
    return view && overlap(around, view)
  }

  /**
   * Draws the land in what {@link drawnBy} now asks for, woven off the frame
   * before it goes in: the halves in place go on drawing until it is ready.
   */
  private redraw(): void {
    const viewer = this.viewer
    // Off a viewer there is nothing hung; the next one is hung as asked
    if (!viewer) return
    const meshes = this.make(viewer)
    const ours = ++this.weaving
    void viewer.weave(...meshes).then(() => {
      if (ours !== this.weaving) return
      this.root.remove(...this.meshes)
      this.meshes = meshes
      this.root.add(...meshes)
    })
  }

  /** The meshes the land is drawn in for {@link drawnBy}, all on the one sheet. */
  private make(viewer: Viewer): Mesh[] {
    const by = this.drawnBy
    const draws: readonly (Draws | 'paint')[] = by === 'paint' ? ['paint'] : DRAWN_BY[by]
    return draws.map((kind) => {
      // On the sheet's shape, and moved with it; not the sheet's own mesh, which
      // a change of drawing would repaint in place under the halves still
      // hanging, a frame before its new paint was woven
      const mesh = new Mesh(this.surface.mesh.geometry, this.paintFor(kind, viewer))
      // Over everything the ground draws, as a picture laid on the land is
      mesh.renderOrder = OVER_THE_GROUND
      mesh.frustumCulled = false
      // A click here belongs to the land under it, as it does on a painted road
      notPicked(mesh)
      // Left shown: three weaves only what is shown (`compileAsync` passes an
      // object told `visible = false` by), and these are woven before they go
      // in. `lay` says every frame whether they are drawn, before the drawing
      return mesh
    })
  }

  /**
   * The material for one way of drawing the land, made once.
   *
   * The paint is a picture's kind: over what opaque was drawn on the land
   * before it, in the land's own place among the layers, and under whatever
   * stands on it. The halves are a shape's kind, transparent, so that they are
   * drawn after everything that stands: what is in front of the land has to be
   * in the depth already for a half to be hidden by it or dimmed through it.
   *
   * Not lit either way. The land underneath has been lit already and shows
   * through what the opacity leaves, so a place in sight still reads as the
   * street it is; a wall wears the same answer as part of its own colour,
   * which is lit with it (`lit.ts`).
   *
   * Woven on the viewer's own sight, which is the eye the walls read: the
   * strength at a place is the one answer, asked of the land here and of a
   * wall there, so the two cannot come to disagree about where it stops.
   */
  private paintFor(kind: Draws | 'paint', viewer: Viewer): MeshBasicNodeMaterial {
    const had = this.materials.get(kind)
    if (had) return had
    const material = new MeshBasicNodeMaterial({
      color: 0xffffff,
      // Lying on the land, so neither side is its back
      side: DoubleSide,
    })
    readDepth(material, kind === 'paint' ? 'ahead' : kind)
    if (kind === 'paint') blendOverOpaque(material)
    else material.transparent = true
    // Raised by the card to the land under it, as the land's own sheet is
    this.surface.stand(material)
    // Laid on the land, so it wins the ties with it rather than being cut into
    pressToLand(material)
    const sight = viewer.sight
    material.colorNode = sight.colorNode
    const shown = kind === 'behind' ? this.shown : null
    material.opacityNode = Fn(() => {
      // The same reading every wall is given, asked of the land this is drawn on
      const paint = sight.strengthAt(positionWorld as Node<'vec3'>).toVar()
      // Thrown away where none lands, which on a square laid round a circle,
      // and on an eye that looks one way, is most of it
      Discard(paint.lessThanEqual(0) as Node)
      return shown ? paint.mul(shown) : paint
    })() as unknown as Node<'float'>
    this.mask.apply(material)
    this.materials.set(kind, material)
    return material
  }

  /** Takes the meshes down and lets the paint go; the sheet's shape is kept. */
  private unmake(): void {
    this.root.remove(...this.meshes)
    this.meshes = []
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}

/** Where two boxes meet, or nothing where they do not. */
function overlap(a: WorldBounds, b: WorldBounds): WorldBounds | null {
  const cut = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
  return cut.maxX > cut.minX && cut.maxY > cut.minY ? cut : null
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
