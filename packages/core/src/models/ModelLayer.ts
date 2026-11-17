import {
  AnimationMixer,
  Group,
  Matrix4,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
} from 'three/webgpu'
import { creditsOf, type Credit, type Credits } from '../credits.js'
import { heightsInHand, heightsVersion, type Heights } from '../elevation.js'
import { Events, type Anchor, type Hit, type LoadFailure, type Position } from '../events.js'
import {
  isAnchor,
  offsetOnThing,
  sayIfOnABuilding,
  seatAt,
  worldOf,
  type OffBuildings,
  type Where,
} from '../screen.js'
import { maskHolds } from '../mask.js'
import type { Change, PutsItselfOn, Layer, Stage, Viewer } from '../Viewer.js'
import { inStage, outOfStage } from '../order.js'
import { setOccludes } from '../passes.js'
import { notPicked, picked } from '../pick.js'
import { DRACO_PATH } from '../draco.js'
import { KTX2_PATH } from '../ktx2.js'
import { cloneModel, dress, readModel } from './load.js'
import { worthAsking } from '../transient.js'
import { addressThrough } from '../requests.js'

/** Held between readings: a seat becomes a matrix and the working is thrown away. */
const SIZE = new Matrix4()
/** Three's own `scale` as a matrix, where three puts it: inside the turn. */
const OWN = new Matrix4()
/** Where a model stood before {@link Model.seat} wrote it again; see that method's answer. */
const STOOD = new Matrix4()

/**
 * Visits whatever of a file is drawn: three's three kinds of thing with a
 * material of their own.
 *
 * Wider than the meshes `dress` walks, for {@link ModelOptions.occludes} and
 * {@link ModelOptions.pickable}. A glTF may carry lines and points, and both
 * are drawn into the corner shading's reading and into the look under the
 * pointer as a mesh is — so a model said to stay out of either and keeping a
 * line in it would be half of what the page said.
 */
function eachDrawn(root: Object3D, visit: (thing: Object3D) => void): void {
  root.traverse((thing) => {
    const kind = thing as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean }
    if (kind.isMesh || kind.isLine || kind.isPoints) visit(thing)
  })
}

/** One model of a page's own, standing on the land or on another model or a solid. */
export interface ModelOptions {
  /**
   * The glTF file to draw, `.glb` or `.gltf`: its address, which the browser
   * may fetch from another site if that site allows it. Geometry compressed
   * with Draco or meshopt is read, and so are pictures compressed as KTX2.
   *
   * Models of one url are fetched once and share the corners they were read
   * into, so a street of a hundred lamps costs one file and one shape.
   */
  readonly url: string | URL
  /**
   * Where its origin stands; see {@link Where}.
   *
   * Said the way a solid says it: a spot on the map, which stays there, or a
   * place on a solid or another model ({@link Anchor}), which goes wherever
   * that goes.
   *
   * Never on a building ({@link OffBuildings}). What is to go with a building
   * is a mark; a model stood where a building is stands on the map beside it.
   * _(2026-11-05, the user's call. It could be held to one, and rode it up out
   * of the ground, through a motion and to wherever the building was stood.)_
   */
  readonly at: OffBuildings
  /**
   * How far its origin is lifted off whatever it stands on, in metres. On it
   * by default, and it stays on the land as the heights arrive rather than
   * waiting for them. Below nought sinks it, for a model built on a slab of
   * its own that should not show.
   */
  readonly height?: number
  /**
   * Whether {@link height} is counted from the land under it or from the
   * map's own nought — the word a solid has (`SolidOptions.grounded`). On the
   * land by default. Said `false` for a height above the sea: an aircraft at
   * 300m stood 300m over whatever hill it was over, and the page had to take
   * the hill off itself. Only a question where the viewer reads the land's
   * heights at all. A property afterwards.
   */
  readonly grounded?: boolean
  /**
   * Which way its front looks: degrees, 0 north, as {@link Camera.heading} is.
   * The front is the side glTF has a model face, its own +Z, so a model left
   * at nought looks north.
   */
  readonly facing?: number
  /**
   * How many metres one of the file's units is. glTF counts in metres, so a
   * model built to size wants none of this; one built to another scale, or
   * standing in for something bigger than itself, is brought to size here.
   *
   * One number, because one is what a page putting a model up means. Past that
   * it is three's: a model is an `Object3D`, so `model.scale` is the `Vector3`
   * three gives everything, and a page pressing one axis on its own writes it
   * there. The two are one place — this is written into that vector as the
   * model is made, and nothing reads it again.
   *
   * A `tall` stood beside this once and asked for a height in metres, working
   * the factor out from the file once it had landed. It went because the
   * division is the page's: whoever puts a model up has the file. What the
   * library knew and the page did not — how high the file reaches in its own
   * units — is measured once in a modeller and written down, and it was not
   * worth a public word, a field filled in late, and a size that changed under
   * the page a moment after it asked.
   */
  readonly scale?: number
  /**
   * Which of the file's own animations it stands in, by the name the file
   * gives it. Left out, the model stands as it was built.
   *
   * What moves is whatever the clip moves — a skeleton's bones among the rest,
   * so a walk is a walk rather than a model sliding along.
   */
  readonly clip?: string
  /**
   * Where in that clip it stands, in seconds. Nought by default, and it stays
   * where it is put: the clip does not run on its own.
   *
   * A page winds it, which is what lets the moving and the being moved keep
   * step. A creature walking the city is the case: how far it has gone decides
   * where in its stride it is, so the feet land on the ground rather than
   * sliding over it, and a page that ran the clip on a clock of its own would
   * have to match two clocks instead of writing one number.
   *
   * Past the clip's end it wraps, so a page may hand it a time that only grows.
   */
  readonly clipTime?: number
  /**
   * Whether it carries its own light. `false` by default, so the sun shades it
   * as it shades everything else standing in the city.
   *
   * Said `true`, the file's own colours are the colours drawn — the same on
   * every face, at every hour, and inside a shadow. What a model of a lit sign
   * or a lamp's glass wants, and what a model meant to be read rather than
   * looked at wants.
   *
   * It costs a second set of materials for that file, since the two are told
   * apart by nothing but whether they read the light. Models of one url that
   * agree still share theirs.
   *
   * The three property it comes down to is `material.lights`, and a page
   * cannot write it: the materials belong to the file and not to the model, so
   * every model of one url wears them, and they are read as the shader is
   * woven rather than at a pixel. Which is why a model that changes its mind
   * is a second set of them and not a flag; see `models/load.ts`. An
   * `emissive` would be per-file for the same reason, and it adds to the lit
   * colour rather than standing in for it.
   */
  readonly glows?: boolean
  /**
   * Whether it throws the sun's shadow. On by default, as for everything else
   * standing in the city.
   *
   * Three's own `Object3D.castShadow`, meaning what it means there, and
   * written where a page would write it: on the model, which is a group. Three
   * never reads it off a group — it asks each mesh — so the library carries it
   * down onto every mesh of the file: as the file lands, whenever the clone is
   * made again (a change of {@link glows}, or one made while no viewer could
   * dress it and put right once one can), and on the frame after a page writes
   * it. So it may be written before the file has arrived, and it holds through
   * the file being read again.
   *
   * What does not hold is a page writing it straight onto a mesh inside. Those
   * meshes are the clone's, made again whenever the model is dressed again,
   * and the model's word is what each new one is given; see `Model.wear`.
   */
  readonly castShadow?: boolean
  /**
   * Whether it takes part in the shading of corners: darkening the corners it
   * closes in with whatever stands beside it, and being darkened by theirs. On
   * by default.
   *
   * Off for a thing standing *for* something rather than standing somewhere —
   * a ball marking where the sun is, say — whose shade would fall on just what
   * the page means to show. A verb, as {@link glows} is, because three has no
   * word for taking part in this; and not `occlusion`, which is the effect's
   * own settings on the viewer (`viewer.occlusion`).
   */
  readonly occludes?: boolean
  /**
   * Whether the pointer finds it. On by default, as for everything a page puts
   * on the map (contract 6).
   *
   * Off, a click on it is a click on whatever stands behind it, and three's own
   * `Raycaster` goes through it as well; see `notPicked`. Which is what a model
   * used as a preview wants — one following the pointer about would otherwise
   * be the thing every click lands on.
   */
  readonly pickable?: boolean
  /**
   * Drawn at all. A model hidden this way stays loaded, so it shows again at
   * once.
   *
   * This is three's own `Object3D.visible` and nothing else writes it, so a
   * page may set it whenever it likes and read back what it set. The two
   * answers that are not the page's — whether the file has landed, and whether
   * the mask holds where it stands — are carried by the group inside; see
   * {@link Model}. Which is why a model told to show itself before its file
   * arrives shows itself when the file does.
   */
  readonly visible?: boolean
  /**
   * Who made it, for the viewer to credit while it is on screen — as a
   * licence such as CC BY asks. The viewer draws the line; see `credits.ts`.
   * One or several, as every layer takes it.
   */
  readonly credit?: Credits
}

/** What one model tells of. */
export interface ModelEvents {
  /**
   * This model was clicked, and where on it.
   *
   * On the model rather than on the group holding it: a page that put a house
   * on the map already holds the house, and asking it about its own clicks
   * saves keeping a second table from whatever came back to what it means.
   * Only the model in front is told — a click on one standing before another
   * does not reach the one behind, as it does not reach the building under it.
   */
  click: {
    readonly model: Model
    readonly position: Position
    /**
     * The place clicked, held to the model: the way from its foot to the
     * click, east, north and up as it faces nought. What a mark that goes with
     * the model is put at (see {@link Anchor}), and it leads back to the click;
     * `position` is the same place as a spot on the map, which stays there.
     */
    readonly anchor: Extract<Anchor, { readonly model: Model }>
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto this model, or left it: the hit where it is, null
   * where it has gone.
   *
   * Told on the change and not while the pointer travels over one model, so a
   * page lighting a house up does it once. Nothing is drawn or fetched again
   * for it — the viewer is already looking, for the cursor and for the click —
   * so what it costs is what the page does with the answer.
   */
  hover: {
    readonly model: Model
    readonly position: Position
  } | null
}

/**
 * A model of a page's own, standing in the city — and a `Group`, so three's own
 * way with an object works on it.
 *
 * Not a {@link Layer}, for the reason a `Polyline` is not one: a page that stands
 * fifty of these is not handing the viewer fifty things to seat. It is handed
 * to the viewer all the same and finds its group itself; see {@link Held}.
 *
 * What it holds is the placing — where it stands, which way, how big. The
 * shape inside it belongs to the file and is shared with every other model of
 * the same url, so nothing here may be written into the corners.
 *
 * **Being three's own is the point of the shape.** A glTF a page cannot walk
 * is a glTF with no bone, no named node and no material in reach, and contract
 * 1 says what three can do this library can do. So `traverse`, `add`,
 * `renderOrder`, `userData` and a ray cast at it are all three's, said in
 * three's words, and this class adds none of its own for them.
 *
 * Three things to know, and all three are places where the map has already
 * answered.
 *
 * **`position` and `rotation` say nothing.** The matrix is written whole by
 * {@link seat}, from `at` and `facing` and the land and what it stands on,
 * and `matrixAutoUpdate` is off. They are a second spelling of what `at` and
 * `facing` say, and the map's spelling wins. `scale` is the one of the three
 * that is read, because `at` and `facing` have no counterpart for it.
 *
 * **Putting it in a scene yourself does nothing.** Reading the file, placing
 * it, dressing it and crediting it are {@link ModelLayer}'s, done over the
 * models it holds — so one in `viewer.scene` and in no layer is an empty
 * group. Contract 1: what goes into the scene is the viewer's to put there.
 *
 * **`visible` is the page's alone.** The other two answers ride on
 * {@link inside}.
 *
 * And one place where three's word is kept and its reach widened:
 * **`castShadow` is read off the model.** Three asks each mesh and never a
 * group, and the meshes here are the clone's, made again whenever the model is
 * dressed again — so the page writes it on the group, and the library carries
 * it down. Three reads nothing it would not read anyway; see
 * {@link ModelOptions.castShadow}.
 */
export class Model extends Group implements PutsItselfOn {
  /**
   * What the file came to, under the placing this model is.
   *
   * A group of its own rather than this one, for three reasons that are the
   * same reason said three ways — what is in here is the file's, and what a
   * page adds to a model is the page's. {@link wear} empties it as a file
   * lands and {@link unwear} as one is let go, so a page's own mesh put in
   * the way of that would be thrown out with the clone. {@link worn} is
   * answered by whether anything is in here, so a page's mesh would say a
   * file had landed. And the two answers that are not the page's — the file,
   * the mask — are carried on this one's `visible`, which leaves three's own
   * on the model for the page to write and read as it would anywhere else.
   */
  private readonly inside = new Group()

  private _at: OffBuildings
  private _height: number
  private _facing: number
  private _glows: boolean
  private _occludes: boolean
  private _pickable: boolean
  /**
   * What the clone it wears was given, against which the page's words are
   * read; see {@link recast} and {@link fits}.
   *
   * `castShadow` because it is three's plain field and says nothing when it is
   * written, so it is compared once a frame. `glows` because a clone is
   * dressed once and may outlive the word it was dressed for: one changed while
   * no viewer was there to dress it again stays as it was until a viewer is.
   */
  private casting: boolean
  private wornGlowing = false
  private _url: string
  /** The file what it wears was read from; see {@link fits}. */
  private wornUrl = ''
  private _credit: Credits | undefined
  private readonly events = new Events<ModelEvents>()
  private owner: ModelLayer | null = null
  /** How high the file reaches over its own origin, in its own units. Nought until it lands. */
  private read = 0
  /** What {@link seat} last found three's own two words at; see {@link restless}. */
  private wasShown = true
  private readonly wasScaled = new Vector3(1, 1, 1)
  private _clip: string | undefined
  private _clipTime: number
  /**
   * What plays this model's clip, and the clip it is playing.
   *
   * One apiece rather than one for the file: a mixer holds where its model has
   * got to, and two creatures of one file are two strides. Nothing until the
   * file lands, and nothing at all for a model that never asked for a clip.
   */
  private mixer: AnimationMixer | undefined
  private action: AnimationAction | undefined
  /** The file's clips, once it has landed. */
  private clips: readonly AnimationClip[] = []

  /**
   * @internal Made by {@link ModelLayer.bring} and not by a page.
   *
   * A model standing in a viewer has a file behind it, and the file cannot be
   * read until there is a device to say what it takes a compressed picture in
   * — so one built here and handed over would be an empty shell for as long as
   * the fetch took, with nothing to say when it stopped being one. The viewer
   * hands back the model the file came to instead. Cesium went the other way
   * first and came back from it, and `three` has never offered anything else:
   * `await loader.loadAsync(url)`, then put what came into the scene.
   */
  constructor(options: ModelOptions) {
    super()
    this._url = String(options.url)
    sayIfOnABuilding(options.at, 'Model')
    this._at = options.at
    this._height = options.height ?? 0
    this._grounded = options.grounded ?? true
    this._facing = options.facing ?? 0
    this._glows = options.glows ?? false
    this._occludes = options.occludes ?? true
    this._pickable = options.pickable ?? true
    // Three's own field, on by default here where three's is off: a model is
    // something standing in the city, and everything else standing there
    // throws a shadow. Carried onto the meshes as the file lands; see `wear`
    this.castShadow = options.castShadow ?? true
    this.casting = this.castShadow
    this._credit = options.credit
    this._clip = options.clip
    this._clipTime = options.clipTime ?? 0
    // Into three's own vector, and read from there afterwards. One number in
    // and three out is the whole of the difference; see {@link ModelOptions.scale}
    this.scale.setScalar(Math.max(0, options.scale ?? 1))
    this.visible = options.visible ?? true
    // Said once rather than every seat: the matrix is this model's place and
    // is written whole, so three is told not to build one out of `position`
    // and `rotation`
    this.matrixAutoUpdate = false
    this.add(this.inside)
    // Nothing of the file yet, and the matrix is still three's identity — so
    // without this there is a frame where a model would stand at the origin
    this.inside.visible = false
  }

  /**
   * The file it is read from. Changeable, as a picture layer's `url` is: the
   * file is read again and the model put back into it, with every listener,
   * child and setting the page gave it kept — where a plan's version A was
   * swapped for version B by taking the model away and bringing another, and
   * hanging all of that on again.
   */
  get url(): string {
    return this._url
  }

  set url(value: string | URL) {
    const url = String(value)
    if (url === this._url) return
    this._url = url
    this.owner?.redress(this)
  }

  /** Where it stands; see {@link ModelOptions.at}. */
  get at(): OffBuildings {
    return this._at
  }

  set at(value: OffBuildings) {
    sayIfOnABuilding(value, 'Model')
    this._at = value
    this.moved()
  }

  /** @internal Whether its place has to be worked out again every frame. */
  get riding(): boolean {
    return isAnchor(this._at)
  }

  /** Whether its height is counted from the land; see {@link ModelOptions.grounded}. */
  get grounded(): boolean {
    return this._grounded
  }

  set grounded(value: boolean) {
    if (value === this._grounded) return
    this._grounded = value
    this.moved()
  }

  private _grounded: boolean

  get height(): number {
    return this._height
  }

  set height(value: number) {
    this._height = value
    this.moved()
  }

  get facing(): number {
    return this._facing
  }

  set facing(value: number) {
    this._facing = value
    this.moved()
  }

  /** Whether it carries its own light; see {@link ModelOptions.glows}. */
  get glows(): boolean {
    return this._glows
  }

  /**
   * Changes its mind about the light.
   *
   * A model already standing is dressed again, which means clothing the clone
   * afresh: the materials it is wearing are the made ones, and a second walk
   * over them would make materials out of materials. So it is undressed and
   * read again — and the file is held, so what that costs is a clone and a
   * walk rather than a fetch.
   */
  set glows(value: boolean) {
    if (this._glows === value) return
    this._glows = value
    this.owner?.redress(this)
  }

  /** Whether it takes part in the shading of corners; see {@link ModelOptions.occludes}. */
  get occludes(): boolean {
    return this._occludes
  }

  /**
   * Takes it into the shading of corners, or out of it.
   *
   * Written onto what is drawn now, and onto every clone dressed after this;
   * see {@link wear}. Nothing to tell anyone, as for a solid. The shading is
   * measured afresh every frame, and the sun's map, which is kept, does not
   * read this word: `setOccludes` leaves layer 0 on, which is all the sun's
   * eye sees, and adds a layer beside it (`passes.ts`). What puts a model in
   * that map is `castShadow`, and that one does stir it; see {@link recast}.
   */
  set occludes(value: boolean) {
    if (this._occludes === value) return
    this._occludes = value
    eachDrawn(this.inside, (thing) => setOccludes(thing, value))
  }

  /** Whether the pointer finds it; see {@link ModelOptions.pickable}. */
  get pickable(): boolean {
    return this._pickable
  }

  /**
   * Lets the pointer find it, or not.
   *
   * Written onto the clone it wears either way, and onto every clone dressed
   * after it (see `carry`). Not by making the clone again, as {@link glows}
   * is: that would throw away whatever the page has done inside the model
   * since it landed — a node moved, a thing hung on a bone — for a word that
   * changes nothing it draws.
   */
  set pickable(value: boolean) {
    if (this._pickable === value) return
    this._pickable = value
    eachDrawn(this.inside, value ? picked : notPicked)
  }

  /** Which of the file's animations it stands in, or nothing. */
  get clip(): string | undefined {
    return this._clip
  }

  /**
   * Stands it in another of the file's clips, or in none.
   *
   * The time it stands at is kept: a creature going from a walk to a run is
   * the same stride carried over, and a page that means to start afresh writes
   * the time as well.
   */
  set clip(name: string | undefined) {
    if (name === this._clip) return
    this._clip = name
    this.takeClip()
  }

  /** Where in that clip it stands, in seconds. */
  get clipTime(): number {
    return this._clipTime
  }

  /**
   * Winds it to that moment of the clip, wrapping past the end.
   *
   * The bones move here and now rather than on the next frame: the page that
   * writes this is the one moving the model along, and the two have to be one
   * step. Where the model stands is another matter — that waits for the frame,
   * as everything the land might change does.
   */
  set clipTime(seconds: number) {
    this._clipTime = seconds
    this.pose()
  }

  /** How long the clip it stands in runs, in seconds. Nought where it stands in none. */
  get clipDuration(): number {
    return this.action?.getClip().duration ?? 0
  }

  /**
   * What the file's clips are called. Empty until the file has landed. The
   * clips themselves are where three keeps them, `model.animations`, for a
   * page that runs its own `AnimationMixer` or measures one.
   */
  get clipNames(): readonly string[] {
    return this.clips.map((clip) => clip.name)
  }

  /**
   * Listens for this model being clicked. Hands back the way to stop.
   *
   * Nothing on screen changes for it: what a click shows is the listener's to
   * decide, as it is for a building.
   */
  on<K extends keyof ModelEvents>(type: K, listener: (event: ModelEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ModelEvents>(type: K, listener: (event: ModelEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /** @internal Whether anyone is listening, so the group can tell the viewer whether to look. */
  listens(type: keyof ModelEvents): boolean {
    return this.events.has(type)
  }

  /** @internal Told by the group that holds it, which is the one the viewer speaks to. */
  clicked(hit: Hit, viewer: Viewer | null): void {
    const { position, x, y, original } = hit
    const offset = offsetOnThing(this, hit.point, viewer)
    const anchor = offset ? { model: this, offset } : { model: this }
    this.events.emit('click', { model: this, position, anchor, x, y, original })
  }

  /** @internal Told by the group, the same way as {@link clicked}. */
  hovered(hit: Hit | null): void {
    this.events.emit('hover', hit ? { model: this, position: hit.position } : null)
  }

  /** Who made it, as {@link ModelOptions.credit} says; changeable, as a file that changes hands is. */
  get credit(): Credits | undefined {
    return this._credit
  }

  set credit(value: Credits | undefined) {
    this._credit = value
  }

  /**
   * @internal How far up the sun's view must take in, in metres.
   *
   * Not how high the thing reaches. It is the **height of the box** the file
   * fills (`load.ts` takes `getSize().y`), laid over the model's own origin —
   * which is the top of the model only where the file was built standing on
   * its origin, as a house is. A ball cut about its middle reaches half this.
   *
   * Which is why it is not a page's to read, and why there is no word here for
   * a page hanging something over a model. A number that is the top of one
   * file and twice the top of another is a number nobody can put a label on,
   * and a model has no roof to name — a house has one because a modeller drew
   * it that way, not because anything here knows. The box is what a glTF
   * really offers, and a page wanting it has three's own way now that a model
   * is an `Object3D`: `new Box3().setFromObject(model)`, which answers in
   * world units rather than metres.
   *
   * Overstating is safe for the one reader there is: a sun whose view takes in
   * more than it had to still draws every roof in it. See
   * {@link ModelLayer.tallest}.
   */
  get rise(): number {
    return this._height + this.read * this.scale.y
  }

  /**
   * @internal The file has landed: the clone goes in and how tall it is is
   * known.
   *
   * The clone has to be dressed in the model's own words here, since it is new
   * each time — for the first landing, and for every dressing again after it.
   * It was dressed with `glows` as it reads now: the layer reads it and calls
   * this in one step, with nothing between.
   */
  wear(scene: Object3D, rise: number, clips: readonly AnimationClip[]): void {
    this.inside.clear()
    this.inside.add(scene)
    // Kept for the sun: {@link rise} is what widens its view so that a roof at
    // that height is in the map it draws; see {@link ModelLayer.tallest}
    this.read = rise
    this.clips = clips
    // Where three keeps an object's clips, and where a page that knows three
    // looks for them: a mixer of its own, a crossfade, a clip measured. Read
    // only by the viewer it was not, and zilla read the whole file a second
    // time with a loader of its own to find them
    this.animations = [...clips]
    this.wornGlowing = this._glows
    this.wornUrl = this._url
    this.carry()
    this.takeClip()
    this.owner?.reseat()
  }

  /**
   * Writes the page's three words onto everything the clone draws.
   *
   * `castShadow` onto the meshes alone, as it was written before it was the
   * page's: a line or a point in a file has no surface to throw a shadow
   * from (`passes.ts`), and a file's lines never cast one here. The other two
   * onto every drawn thing; see {@link eachDrawn}.
   *
   * `occludes` is written whichever way it reads, since a clone copies its
   * layers from the file's own reading and that reading is never written.
   */
  private carry(): void {
    this.casting = this.castShadow
    eachDrawn(this.inside, (thing) => {
      if ((thing as Mesh).isMesh) thing.castShadow = this.casting
      setOccludes(thing, this._occludes)
      if (!this._pickable) notPicked(thing)
    })
  }

  /**
   * @internal Carries `castShadow` down again where the page has written it
   * since the clone was dressed, and answers whether the sun's map has to be
   * drawn again for it.
   *
   * Asked by the layer once a frame, which is all a plain field allows — the
   * same as {@link restless} for `visible` and `scale`, and one comparison
   * against a frame that would otherwise keep a shadow the page turned off.
   * Only a model that is drawn can have put anything in the map.
   */
  recast(): boolean {
    if (this.castShadow === this.casting) return false
    const casting = (this.casting = this.castShadow)
    eachDrawn(this.inside, (thing) => {
      if ((thing as Mesh).isMesh) thing.castShadow = casting
    })
    return this.drawn
  }

  /**
   * @internal Whether the clone it wears was dressed for what it asks now.
   *
   * False where `glows` changed since. That is put right by dressing the
   * clone again, and where that could not happen at once — the model out of
   * any layer, or in one with no viewer — it happens when the layer next reads
   * the file for it; see {@link ModelLayer.fetch}.
   */
  get fits(): boolean {
    return this._glows === this.wornGlowing && this._url === this.wornUrl
  }

  /**
   * Takes up the clip it was asked for over whatever it was playing, and
   * stands it at the time it holds.
   *
   * Called when the file lands and when the clip is changed, which are the two
   * moments either of them can be new. A name the file does not have leaves
   * the model standing as it was built rather than throwing: a page naming a
   * clip has read the file, and a file swapped under it is a picture gone
   * still, not a page that should stop.
   */
  private takeClip(): void {
    this.dropClip()
    const [clone] = this.inside.children
    if (!clone || !this._clip) return
    const clip = this.clips.find((one) => one.name === this._clip)
    if (!clip) return
    this.mixer = new AnimationMixer(clone)
    this.action = this.mixer.clipAction(clip)
    this.action.play()
    this.pose()
  }

  /**
   * Lets the mixer go, which puts the bones back where the file built them.
   *
   * Not where the last pose left them, which is what this said for a while:
   * three's `stop()` deactivates the action, the last reference to each
   * binding goes, and `PropertyMixer.restoreOriginalState` writes the saved
   * value straight back into the bone (`AnimationMixer._deactivateAction`).
   * So the model changes shape here and now, exactly as {@link pose} does —
   * and the two paths that take a clip away, a name of none and a name the
   * file has not got, never reach `pose`. Hence the word at the end.
   */
  private dropClip(): void {
    const moving = this.action !== undefined
    this.action?.stop()
    this.mixer?.uncacheRoot(this.mixer.getRoot())
    this.mixer = undefined
    this.action = undefined
    if (moving) this.owner?.reposed()
  }

  /**
   * Puts the bones where the clip has them at {@link Model.clipTime}.
   *
   * The mixer is asked for no time of its own — the action is set to the
   * moment wanted and the mixer told that nothing has passed, so what it does
   * is read the clip at that moment and nothing else. That is what makes this
   * a page's number rather than a clock: written twice with the same value it
   * draws the same pose, and written backwards it walks backwards.
   */
  private pose(): void {
    const action = this.action
    const mixer = this.mixer
    if (!action || !mixer) return
    const runs = action.getClip().duration
    action.time = runs > 0 ? ((this._clipTime % runs) + runs) % runs : 0
    mixer.update(0)
    // The bones moved here and now, and nothing walking the scene would see
    // it: the matrix is the one it had, so the frame's own `seat` answers
    // false and `reseat` alone would wake a frame with nothing to say
    this.owner?.reposed()
  }

  /**
   * @internal Takes the clone off again, leaving the model as it was made.
   *
   * The inverse of {@link Model.wear}. What it is for is a group letting go of
   * the materials it dressed the clone in on being disposed. A model left
   * wearing a material that has been disposed is a model
   * that draws as nothing and never says why; stripped, the next `fetch` finds
   * the file already read and dresses it again for nothing but a clone.
   */
  unwear(): void {
    this.dropClip()
    this.clips = []
    this.animations = []
    this.inside.clear()
    this.read = 0
    this.inside.visible = false
    this.owner?.reseat()
  }

  /** @internal Whether the file has landed. */
  get worn(): boolean {
    return this.inside.children.length > 0
  }

  /**
   * @internal Puts it where it stands.
   *
   * Written out rather than compared first. Everything it reads either says so
   * when it changes — the fields below, the file landing, the shape the viewer
   * is cut to — or is the land, which the group asks `elevation.ts` about; so
   * by the time this is called something has moved, and three works the matrix
   * out from these three afresh every frame whether or not they were written.
   *
   * The file counts in metres and the world is Mercator, so the stretch rides
   * on the matrix and everything inside the model is stretched with it. Three's
   * own `scale` goes inside the turn, where three puts it, so that a page
   * pressing one axis presses the model's own and not the world's.
   *
   * Answers whether it actually moved — whether the matrix or the showing came
   * out other than it went in. Written out and then compared, rather than
   * compared first, because what it costs is four multiplies against a frame
   * that would otherwise redraw the sun's map; see {@link ModelLayer.frame}.
   */
  seat(viewer: Viewer, land: Heights | null): boolean {
    const shown = this.drawn
    STOOD.copy(this.matrix)
    // Read now and not at the end, so that a model waiting on a thing it is
    // put on is not taken for restless on every frame until that thing stands
    this.wasShown = this.visible
    this.wasScaled.copy(this.scale)
    // The height is a lift, as a solid's is (rule 5): how far the model
    // carries itself over wherever it is put, which goes on over the place's
    // own height rather than standing in for it. Asked with no city: a model
    // stands on no building (`OffBuildings`), and one a page put on a building
    // anyway is nowhere and is not drawn
    const seat = seatAt(null, this._grounded ? land : null, this._at, undefined, this._height)
    // On a thing that is nowhere yet, it waits rather than falling to the
    // ground
    if (!seat) {
      this.inside.visible = false
      return shown
    }

    // A model is one place, not a patch, so the mask keeps it or drops it
    // whole. Cutting it down its middle would want the mask woven into
    // materials that belong to the file rather than to this library.
    const { x, y, z } = worldOf(seat)
    this.inside.visible = this.worn && maskHolds(viewer.maskArea, x, z)

    // glTF has a model face its own +Z and the world's north is -z, so nought
    // is half a turn; the heading runs clockwise, which is the way a turn
    // about the world's y does not.
    const stretch = seat.stretch
    this.matrix
      .makeRotationY(Math.PI - (this._facing * Math.PI) / 180)
      .multiply(OWN.makeScale(this.scale.x, this.scale.y, this.scale.z))
    this.matrix.premultiply(SIZE.makeScale(stretch, stretch, stretch))
    this.matrix.setPosition(x, y, z)
    this.matrixWorldNeedsUpdate = true
    return this.drawn !== shown || !this.matrix.equals(STOOD)
  }

  /** @internal Whether anything of it is drawn: the page's word, the file, and the mask. */
  get drawn(): boolean {
    return this.visible && this.inside.visible
  }

  /**
   * @internal Whether a page has written one of three's own words since this
   * was last put in place.
   *
   * `visible` and `scale` are three's fields now that a model is an
   * `Object3D`, and a plain field says nothing when it is written — where
   * `at` and the rest go through a setter that does. So they are read once a
   * frame instead: four comparisons apiece, against a frame that would
   * otherwise leave a model at the size it used to be, or its shadow lying on
   * ground it has been taken off.
   */
  get restless(): boolean {
    return this.visible !== this.wasShown || !this.scale.equals(this.wasScaled)
  }

  /**
   * @internal Says the stage on both groups, since three takes it from the
   * nearest one above whatever it is drawing.
   *
   * Two, because {@link inside} is a group under this one and a group with
   * nothing written on it is read as `structure` — which is where a model
   * usually stands anyway, but the stage is the layer's to set and a page
   * that moved it would have the files stay behind. See `order.ts`.
   */
  staged(stage: Stage): void {
    inStage(this, stage)
    inStage(this.inside, stage)
  }

  /** @internal Gives back both of what {@link staged} wrote: the number, and the mask. */
  unstaged(): void {
    outOfStage(this)
    outOfStage(this.inside)
  }

  /** @internal Which group holds it, or nothing. */
  get heldBy(): ModelLayer | null {
    return this.owner
  }

  /** @internal */
  held(by: ModelLayer | null): void {
    this.owner = by
  }

  /**
   * @internal Handed to a viewer bare, it goes into that viewer's own layer of
   * models — the one that is always there, rather than a group made for the
   * first model to ask.
   *
   * No question to ask before doing it: `viewer.models` is a layer the viewer
   * holds for as long as it lives, since {@link Viewer.remove} turns it away.
   * A page may still have turned it off, and then the model waits there
   * unseen until it is turned back on — which is a page's own doing and
   * reversible, where a model put into a layer the scene had let go of was
   * neither. It was asked and answered wrongly for a day in between — the
   * getter went on handing back a layer `viewer.remove` had taken off, and a
   * model put there drew nothing and said nothing.
   */
  putOn(viewer: Viewer): void {
    viewer.models.add(this)
  }

  /** @internal */
  takeOff(): void {
    this.owner?.remove(this)
  }

  /** Whatever a page changed about it wants it put where it stands again. */
  private moved(): void {
    this.owner?.reseat()
  }
}

export interface ModelLayerOptions {
  /**
   * Where the Draco decoder is fetched from, for a page that would rather
   * serve its own copy than reach Google's. Only read by a file that needs it.
   */
  readonly dracoPath?: string
  /**
   * Where the KTX2 transcoder is fetched from, for the same reason — the pair
   * of files three publishes under `examples/jsm/libs/basis/`. Only fetched by
   * a file whose pictures came compressed that way.
   */
  readonly ktx2Path?: string
  /**
   * Whether it draws at all. On, unless a page says otherwise.
   *
   * Here for the same reason the land and the city have one: these three are
   * the viewer's own and cannot be taken off ({@link Viewer.remove}), so this
   * is the way out. An empty layer costs nothing either way — it fetches only
   * what a page has named — and a page saying it here is saying it before
   * anything is brought.
   */
  readonly visible?: boolean
}

export interface ModelLayerEvents {
  /** A model's file could not be read. Nobody listening, and it goes to the console. */
  error: LoadFailure
  /**
   * Every file it was reading has landed, or has failed for good — told on
   * the turn from busy to idle, as every fetching layer tells it. `models` is
   * how many stand with their files in.
   */
  loaded: { readonly models: number }
  /**
   * What it has standing changed: a file landed, or a model was taken out.
   * Once a frame however many turned over. `models` is how many stand with
   * their files in.
   */
  changed: { readonly models: number }
}

/**
 * The models a page has put in the city.
 *
 * It draws into `structure`, the stage the buildings draw into, because that
 * is what a model is here — a thing standing on the land with the city around
 * it, reading depth and writing it so a building in front hides it and it
 * hides what is behind.
 *
 * The materials belong to this group rather than to the file. glTF hands over
 * three's standard material, which has only the scene's lights to go on; those
 * stand there for it (`lights.ts`), so it is kept as it was written and
 * metalness, roughness, the normal map and emissive all survive. A material
 * with no light to read comes down to its colours instead, and whether the
 * scene's own shading then goes on top is what `glows` decides: an unlit glTF
 * takes it, so it is lit like the city beside it; a model a page said glows
 * takes nothing and draws the file's colours flat. See `load.ts`. Either way it
 * is a copy and this group's, since the file's is shared by every viewer on the
 * page. One material per material per file, so a hundred lamps of one file cost
 * one shader and not a hundred.
 */
export class ModelLayer implements Layer {
  readonly root = new Group()
  readonly stage: Stage = 'structure'
  private readonly events = new Events<ModelLayerEvents>()

  private readonly models: Model[] = []
  /**
   * The materials made or copied for each file, by the file's own material.
   *
   * One map a key, and the key is the url and whether the model glows: the two
   * sets are the same materials told to read the light and told not to, and a
   * material's nodes are settled before it is first drawn. So a file worn both
   * ways has two.
   */
  private readonly worn = new Map<string, Map<Material, Material>>()
  /**
   * What each {@link bring} is waiting on, by the model it is waiting for.
   *
   * A model is in here from the moment it is brought until it has stood, been
   * given up on, or been taken out — see {@link settled}. One a page made and
   * handed over itself is never in here, because nobody is waiting on it.
   */
  private readonly bringing = new Map<Model, (stood: boolean) => void>()
  /**
   * Where the Draco decoder is fetched from; see {@link ModelLayerOptions.dracoPath}.
   *
   * Read-only, as the city's is: the decoder is the same program wherever it
   * is fetched from, and a file already read is held whichever path read it
   * (`load.ts`), so another path would change nothing on the map.
   */
  readonly dracoPath: string
  /**
   * Where the KTX2 transcoder is fetched from; see {@link ModelLayerOptions.ktx2Path}.
   *
   * Read-only for the same reasons as {@link dracoPath}.
   */
  readonly ktx2Path: string
  private viewer: Viewer | null = null
  /** That something wants putting where it stands again. The work happens on the next frame. */
  private dirty = true
  /** Which land the models were last seated on; nothing where they stand on flat ground. */
  private seatedOn: number | null = null

  constructor(options: ModelLayerOptions = {}) {
    this.dracoPath = options.dracoPath ?? DRACO_PATH
    this.ktx2Path = options.ktx2Path ?? KTX2_PATH
    this.root.visible = options.visible ?? true
  }

  get items(): readonly Model[] {
    return this.models
  }

  /**
   * Whether anything here is drawn, as the land and the city each answer.
   *
   * The whole layer at once, and three's own `visible` under it, so a model
   * keeps whatever it said about itself and gets it back when this comes on.
   * Nothing is let go of and nothing is fetched again: a file already read is
   * still read, and one still coming lands into a layer nobody can see.
   *
   * The sun's map is held from one frame to the next and redrawn only where
   * something in it moved, so a layer taken off screen without a word leaves
   * its models' shadows printed on the land.
   */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (this.root.visible === value) return
    this.root.visible = value
    this.viewer?.stirShadows()
    // Nothing was put back in its place while it was off, and a model standing
    // on another rides one that may have moved the whole time
    if (value) this.dirty = true
  }

  /**
   * Hears what this layer has to say; see {@link ModelLayerEvents}. Hand back
   * the function it returns to stop listening.
   *
   * The pair the other layers answer. It was the bag itself for a while, which
   * made this the one layer a page talked to differently — and once the viewer
   * began making one of these for itself, beside the land and the city, that
   * was the odd word out among three things a page reads alike.
   */
  on<K extends keyof ModelLayerEvents>(type: K, listener: (event: ModelLayerEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  /** Stops listening. The same as calling what {@link on} handed back. */
  off<K extends keyof ModelLayerEvents>(type: K, listener: (event: ModelLayerEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /**
   * Reads a glTF file and stands what it came to, once it is standing.
   *
   * ```js
   * const house = await viewer.models.bring({ url, at: [139.75, 35.68] })
   * house.on('click', () => show(house))
   * ```
   *
   * The one way in. What comes back is a model with its file behind it — its
   * clips named, its nodes and materials there to be walked, since it is
   * three's own `Group` — or nothing where the file could not be read, which
   * `error` says more about. See {@link Model}'s constructor for why it is not
   * a page's to call. A page that brings none never waits for anything.
   *
   * Awaited and not handed over at once because the file cannot be read until
   * there is a device to say what it takes a compressed picture in, and that
   * is the viewer's to answer. Handing back an empty shell to be filled in
   * later is the other way, and it leaves a page holding something whose
   * height it cannot read and whose failure it cannot hear. `three` has never
   * offered anything but `await loader.loadAsync(url)`, and Cesium went the
   * shell way and came back from it.
   *
   * Models of one url are read once and share the corners they were read
   * into, so a street of a hundred lamps is a hundred of these and one file.
   *
   * It may be called on a layer that is not on a viewer yet. The fetch waits
   * for the viewer and this waits for the fetch.
   */
  async bring(options: ModelOptions): Promise<Model | null> {
    const model = new Model(options)
    // Before `add`, which starts the fetch where there is a viewer — the fetch
    // is asynchronous and could not land first, but there is nothing to gain
    // by writing it the other way round.
    const stood = new Promise<boolean>((settle) => this.bringing.set(model, settle))
    this.add(model)
    return (await stood) ? model : null
  }

  /**
   * Tells whoever brought a model how it ended, once, and forgets it.
   *
   * Three ways in, and the layer is at all three: the file landed, the file
   * could not be read, or the model was taken out before either. The last is
   * what keeps the promise from outliving the thing — a model pulled mid-flight
   * would otherwise leave a page awaiting it for the life of the tab.
   *
   * Kept here and not on the model because `bring` is the only thing that ever
   * waits. A model a page handed over itself (`viewer.add`) is in no one's
   * list, and this walks away.
   */
  /** How long each model that failed for a moment waits before it is read again; see {@link fetch}. */
  private readonly waits = new WeakMap<Model, number>()

  private settled(model: Model, stood: boolean): void {
    const settle = this.bringing.get(model)
    if (!settle) return
    this.bringing.delete(model)
    settle(stood)
  }

  /** @internal Taken out of a page's hands with {@link bring}; see {@link Model}. */
  add(model: Model): this {
    if (model.heldBy === this) return this
    if (model.heldBy) {
      throw new Error(
        'ModelLayer.add: this model is already in another ModelLayer. Take it out of that one first.',
      )
    }
    this.models.push(model)
    model.held(this)
    // A model is a group, and a group is where three takes the stage from, so
    // it says this layer's; see {@link Model.staged}, which says it on the
    // group inside as well
    model.staged(this.stage)
    this.root.add(model)
    this.dirty = true
    if (this.viewer) void this.fetch(model)
    return this
  }

  remove(model: Model): this {
    const at = this.models.indexOf(model)
    if (at < 0) return this
    this.models.splice(at, 1)
    this.turned += 1
    // Whoever is waiting on it is waiting on a file that will not be put in
    // anything now. Said here and not only where a fetch fails, so a model
    // taken away mid-flight does not leave a page waiting for the life of the
    // tab
    this.settled(model, model.worn)
    model.held(null)
    this.root.remove(model)
    // Gone from the scene, and gone from nothing else: the frame below only
    // hears from models it still holds, so this is the one place that knows
    // the sun's map has something in it that is no longer there
    this.viewer?.stirShadows()
    // Both of what `inStage` wrote, on both groups it was written on: the
    // number, and the mask it was opened on
    model.unstaged()
    return this
  }

  clear(): void {
    for (const model of [...this.models]) this.remove(model)
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.dirty = true
    // Whatever was added before there was a viewer: a file cannot be read
    // without one, because the transcoder has to ask it what the device takes
    // a compressed picture in, so `fetch` turns back where there is none.
    //
    // Nothing else here is the viewer's any more. The light is three's and
    // reaches a material through the scene it is drawn in, so a group carried
    // to another viewer keeps the materials it has and is simply lit by the
    // sun standing there.
    for (const model of this.models) void this.fetch(model)
  }

  /**
   * Nothing here every frame but the asking.
   *
   * Everything a model is put in place by says so when it changes — a page
   * moving one, the file landing, the shape the viewer is cut to — save the
   * land, which arrives from whoever draws the ground and tells nobody. That
   * is what `elevation.ts`'s count answers: one integer however many models a
   * page has stood, and it notices a tile let go of as well as one arriving.
   */
  frame(): void {
    this.sayWhatChanged()
    const viewer = this.viewer
    // Turned off it seats nothing and stirs nothing: what it holds it keeps,
    // hidden, and the setter marks it to be put in place again when it comes
    // back on. The land does the same at the head of its own frame.
    if (!viewer || !this.root.visible) return
    // Three's `castShadow` is a plain field as well, and read apart from the
    // two below because it moves nothing: a model that changed its mind about
    // its shadow stands where it stood, so it is the sun alone that is told.
    // Before the turning back below, which a still layer takes on most frames.
    // Asked only while the layer is on, since nothing of it is in the sun's map
    // while it is off — and turning it on stirs the sun, and the first frame
    // after carries the word down before the map is drawn
    let recast = false
    for (const model of this.models) if (model.recast()) recast = true
    if (recast) viewer.stirShadows()
    const land = viewer.elevation ? heightsVersion() : null
    if (land !== this.seatedOn) this.dirty = true
    // Three's own `visible` and `scale` are plain fields, so a page writing one
    // says nothing by writing it; see {@link Model.restless}
    if (!this.dirty && this.models.some((model) => model.restless)) this.dirty = true
    if (!this.dirty) return
    this.dirty = false
    this.seatedOn = land
    // Made for this pass and thrown away, as it is meant to be: it remembers
    // the tile it last read, and a page's models sit near one another
    const heights = viewer.elevation ? heightsInHand() : null
    // Only where one of them actually went somewhere. The map the sun holds is
    // redrawn for a word from here, and the last line of this method keeps a
    // layer with anything standing on another thing asking every frame — so
    // saying it unasked would hand that page a city drawn twice a frame for
    // ever, which is what `Viewer.stirShadows` exists to avoid. A model on a
    // still model resolves to the place it already had.
    let moved = false
    for (const model of this.models) if (model.seat(viewer, heights)) moved = true
    if (moved) viewer.stirShadows()
    // A model on a model or a solid is asked again every frame: a page may move
    // what it stands on at any time, and is not asked to say so here.
    this.dirty = this.models.some((model) => model.riding)
  }

  /** @internal A model it holds was changed, or has just been dressed or stripped. */
  reseat(): void {
    this.dirty = true
  }

  /**
   * @internal A model it holds moved its bones where it stands; see
   * {@link Model.clipTime}.
   *
   * Apart from {@link reseat}, which asks for the next frame. A pose is
   * written the moment a page writes the word (`mixer.update(0)`), and the
   * frame it would wake finds nothing: `seat` answers whether the place or the
   * shape moved, and a pose moves neither. So the one thing a pose needs said
   * is said straight — the map the sun holds has the pose it was drawn with.
   */
  reposed(): void {
    this.viewer?.stirShadows()
  }

  /**
   * Models answer two of the seven words; see {@link Change}. Both leave the
   * same mark, because both are read as a model is put down: the land it
   * stands on, and whether the shape still holds the place it stands in.
   * Nothing is rebuilt either way — where a model stands is worked out afresh,
   * and the next frame is all that takes.
   */
  changed(what: Change): void {
    if (what === 'elevation' || what === 'mask') this.dirty = true
  }

  tallest(): number {
    // Off is off, the same as the land and the city: three leaves the whole
    // subtree out at a `visible` of false, and a viewer told something still
    // stands here aims the sun's box at it and keeps the map and the shading
    // alive over a scene with nothing drawn in it. `Model.drawn` cannot answer
    // this — it reads the model's own word and the mask, and neither of those
    // hears the layer.
    if (!this.root.visible) return 0
    let top = 0
    for (const model of this.models) {
      if (model.drawn) top = Math.max(top, model.rise)
    }
    return top
  }

  /**
   * The viewer speaks to layers, and a model is not one — so the group stands
   * between them: it answers for every model it holds, and hands the click on
   * to the one that was hit.
   */
  listens(type: 'click' | 'hover' | 'pointing'): boolean {
    if (type === 'pointing') return false
    return this.models.some((model) => model.listens(type))
  }

  clicked(hit: Hit): void {
    this.modelAt(hit.object)?.clicked(hit, this.viewer)
  }

  /**
   * Hands the hover to the model under the pointer, and tells the one it just
   * left.
   *
   * The viewer only says "nothing" when the pointer leaves this group
   * altogether; moving from one model to the next it says the new one. So the
   * one before is remembered here, and told it has been left — otherwise a
   * house lit up on hover stays lit after the pointer has gone to its
   * neighbour.
   */
  hovered(hit: Hit | null): void {
    const onto = hit ? (this.modelAt(hit.object) ?? null) : null
    if (onto === this.hovering) return
    this.hovering?.hovered(null)
    this.hovering = onto
    if (onto && hit) onto.hovered(hit)
  }

  /**
   * Which model a thing under the pointer belongs to, or nothing.
   *
   * The same walk the viewer makes to find the layer that drew something, one
   * step further in: a model's own root is a child of this group's, and what
   * was hit is a mesh of the file somewhere below it.
   */
  /** The model the pointer is on, so the one it leaves can be told. */
  private hovering: Model | null = null

  private modelAt(object: Object3D): Model | undefined {
    let top: Object3D | null = object
    while (top && top.parent !== this.root) top = top.parent
    return top ? this.models.find((model) => model === top) : undefined
  }

  credits(): readonly Credit[] {
    // The same word again. The land and the city get this for nothing — their
    // counts of what is on screen stand still while they are off — and this
    // one holds models rather than tiles, so it has to say it.
    if (!this.root.visible) return []
    const shown: Credit[] = []
    for (const model of this.models) {
      if (model.drawn) shown.push(...creditsOf(model.credit))
    }
    return shown
  }

  detach(): void {
    this.viewer = null
  }

  /**
   * Lets go of the materials made for the files. The geometry is not ours to
   * free — it belongs to the reading of the file, which other viewers on the
   * page may still be drawing from.
   */
  dispose(): void {
    this.undress()
    this.clear()
  }

  /**
   * Lets go of every material made here, and takes the clones wearing them off
   * the models.
   *
   * Both halves together, always: a model left holding a clone dressed in a
   * disposed material is one that draws as nothing wherever it is put next,
   * and `clear` promises a model handed back as it was made.
   */
  private undress(): void {
    for (const made of this.worn.values()) {
      for (const material of made.values()) material.dispose()
    }
    this.worn.clear()
    for (const model of this.models) model.unwear()
  }

  /**
   * @internal A model changed its mind about something its clone was dressed
   * in — the light ({@link Model.glows}) — so it is read again.
   *
   * Nothing is fetched: the file is held, and what this costs is the clone and
   * the walk that dresses it. Taking the old clone off is {@link fetch}'s,
   * which finds it no longer {@link Model.fits}.
   *
   * Nothing here where the model wears nothing yet: a reading is in flight and
   * dresses it in what it asks as it lands, or there is no viewer and `attach`
   * reads it. And nothing where there is no viewer, for the same `attach`.
   */
  redress(model: Model): void {
    if (!model.worn || !this.viewer) return
    void this.fetch(model)
  }

  /**
   * Whether a file is on its way; see {@link Layer.busy}. The viewer's
   * `loaded` waits on it, as it waits on the city's tiles.
   */
  busy(): boolean {
    return this.reading > 0
  }

  /** How many files are being read now; see {@link busy}. */
  private reading = 0
  /** How many times what stands has changed, and how many of those were told; see {@link sayWhatChanged}. */
  private turned = 0
  private told = 0
  private wasBusy = false

  /** Tells `changed` once a frame where anything turned over, and `loaded` on the turn to idle. */
  private sayWhatChanged(): void {
    const standing = (): number => this.models.filter((model) => model.worn).length
    if (this.turned !== this.told) {
      this.told = this.turned
      if (this.events.has('changed')) this.events.emit('changed', { models: standing() })
    }
    const busy = this.busy()
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (!busy && this.events.has('loaded')) this.events.emit('loaded', { models: standing() })
  }

  /** Reads the file a model wants, and dresses the clone it puts in the scene. */
  private async fetch(model: Model): Promise<void> {
    const url = model.url
    // Taken in hand before the wait rather than after, because the transcoder
    // asks the viewer what the device takes a compressed picture in — a
    // question only a viewer can answer, and one asked while the file is still
    // being read. The viewer is read again below for what may have happened
    // meanwhile
    const reading = this.viewer
    if (!reading) return
    if (model.worn) {
      if (model.fits) return
      // Dressed for something it has stopped asking: a word changed with this
      // model out of any layer, or in one with no viewer, so nobody could dress
      // it again then (see `redress`). Taken off here, past the turning back
      // above, so that a model with no viewer to dress it keeps what it wears
      model.unwear()
    }
    this.reading += 1
    try {
      const read = await readModel(url, {
        dracoPath: this.dracoPath,
        ktx2Path: this.ktx2Path,
        detect: (loader) => reading.detectTextureSupport(loader),
        ask: reading.request,
        address: (asked) => addressThrough(reading.transformRequest, asked, 'model'),
      })
      const viewer = this.viewer
      // Taken out, or the layer taken off, while the file was in flight.
      //
      // Taken out, the waiting is settled by whoever did that — `remove`, and
      // `clear` and `dispose` through it. Taken off, it is left open on
      // purpose: a detached layer is one that may be added again, and `attach`
      // asks for every unworn file afresh, so the promise a page is holding is
      // answered by that reading rather than refused by this one.
      if (!viewer || viewer.disposed || model.heldBy !== this) return
      // Its file changed while this one was on its way: the one read is not
      // the one asked for any more, so it is read again rather than worn
      if (model.url !== url) {
        void this.fetch(model)
        return
      }

      // Kept apart by whether the light reaches them as well as by the file:
      // the two sets are the same materials told to read the light and told not
      // to, and a material's nodes are settled before it is first drawn
      const key = model.glows ? `glows ${url}` : url
      let made = this.worn.get(key)
      if (!made) this.worn.set(key, (made = new Map()))
      // A clone shares the corners it was read into and takes materials of its
      // own from here. Which of them keep the file's own is `load.ts`'s to
      // decide — a material that reads the light keeps itself and is lit by
      // the scene. Not cut to the mask, only kept or dropped by it; see
      // Model.seat
      const clone = cloneModel(read.scene)
      dress(clone, made, model.glows)
      model.wear(clone, read.rise, read.clips)
      this.turned += 1
      this.waits.delete(model)
      this.settled(model, true)
    } catch (cause) {
      // Told the same three apart as the exit above, and for the same reasons.
      // Taken out, `remove` has already said so. Taken off, the promise is
      // left open: `attach` asks for every unworn file afresh, and a read that
      // threw leaves the model unworn and still in the list, so the next
      // attach reads it again — refusing it here would answer `null` for a
      // file that afterwards stands, with the page holding no handle on it.
      // Only where this layer is still the one carrying it is the read final.
      const viewer = this.viewer
      const carrying = viewer !== null && !viewer.disposed && model.heldBy === this
      // A moment's trouble is asked about again, after a wait that doubles, as
      // the tiles and the one-picture layer ask (contract 7); the page's
      // promise waits on it. Anything else is the file's answer, and the
      // model goes: the page was handed `null` for it and holds no handle, so
      // left in the list it was an empty group nobody could take out
      const again = carrying && worthAsking(cause)
      this.failed({ what: 'model', key: url, retrying: again, cause })
      if (again) {
        const wait = Math.min((this.waits.get(model) ?? FIRST_WAIT / 2) * 2, LONGEST_WAIT)
        this.waits.set(model, wait)
        setTimeout(() => {
          if (model.heldBy === this && !model.worn && this.viewer && !this.viewer.disposed)
            void this.fetch(model)
        }, wait)
        return
      }
      if (carrying) {
        this.settled(model, false)
        this.remove(model)
      }
    } finally {
      this.reading -= 1
    }
  }

  private failed(failure: LoadFailure): void {
    if (this.events.has('error')) {
      this.events.emit('error', failure)
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[plateau-ui] ModelLayer: ${failure.what} ${failure.key} failed`, failure.cause)
  }
}

/** How long a model that failed for a moment first waits to be read again, and the most it waits, in milliseconds. */
const FIRST_WAIT = 1_000
const LONGEST_WAIT = 30_000
