import {
  Color,
  OrthographicCamera,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Light,
  type Material,
  type Mesh,
  type Object3D,
  type ColorRepresentation,
} from 'three/webgpu'
import { pressedOn, typedInto, type PressedMark } from './annotations/pressed.js'
import { askThrough, type Ask, type RequestKind, type TransformRequest } from './requests.js'
import { Interaction, type InteractionOptions } from './interaction.js'
import { AppearSettings, stillArriving, tickAppear, type AppearOptions, type ViewerAppear } from './appear.js'
import { Buildings, type BuildingsOptions } from './buildings/Buildings.js'
import { heightsInHand, positionFromWorld } from './elevation.js'
import { LandHeights } from './landHeights.js'
import { Ground, type ViewerGroundOptions } from './Ground.js'
import { Events, type DragPhase, type Dragging, type Hit, type Position } from './events.js'
import { paintedIn, type PaintedKind } from './paints.js'
import { JAPAN } from './geo/japan.js'
import { MARKS, PICTURE_ONLY, occludes, type FramePass } from './passes.js'
import { weaveStandIns } from './offscreen.js'
import {
  EARTH_CIRCUMFERENCE,
  latToY,
  lonToX,
  metersPerUnit,
  xToLon,
  yToLat,
  type MapBounds,
  type WorldBounds,
} from './geo/mercator.js'
import { maskArea, maskCircle, viewMargin, type Mask, type MaskArea, type MaskView } from './mask.js'

import type { Easing } from './motion/easing.js'
import { easeInOut, flightPath } from './motion/flight.js'
import {
  framesOf,
  mixNumbers,
  mixPairs,
  offsetsOf,
  valueAt,
  type Frame,
  type Keyframe,
} from './motion/keyframes.js'
import { play, type Animation, type Playing, type Timing } from './motion/motion.js'
import { OcclusionPass, OcclusionSettings, type OcclusionOptions, type ViewerOcclusion } from './occlusion.js'
import { MOST_AUTO_BLUR, TiltShiftPass, TiltShiftSettings, type TiltShiftOptions, type ViewerTiltShift } from './tiltShift.js'
import { Outlines } from './outlines.js'
import { Projection } from './projection.js'
import { SceneState, uniformChanges } from './repaint.js'
import { Sight } from './sight.js'
import { Underground } from './underground.js'
import type { Html, Label, Marker } from './AnnotationLayer.js'
import type { Circle, Polygon, Polyline } from './ShapeLayer.js'
import type { Solid } from './SolidLayer.js'
import type { Model } from './models/ModelLayer.js'
import { Screen } from './screen.js'
import { standsOnBuildings, type StandsOnBuildings } from './onBuildings.js'
import {
  CreditsLine,
  DEFAULT_CREDITS_CORNER,
  creditKey,
  gatherCredits,
  type Credit,
  type CreditsCorner,
} from './credits.js'
import { plateauCities } from './plateau/cities.js'
import { PickPass } from './pick.js'
import { Lights } from './lights.js'
import { LOWEST_SUN, type SunShadow } from './shadows.js'
import { DEFAULT_SUN, angleOfSun, directionOfSun, frozenSun, heldSun, type Lit, type Sun } from './sun.js'
import { TONE_CURVE, beforeTheCurveOf } from './tone.js'
import {
  COLOR_NAMES,
  DARK,
  LIGHT,
  colorFor,
  type ColorName,
  type Palette,
  type Theme,
  type ThemeColor,
} from './theme.js'

// The stages, and the number that puts one of them in its place; see
// `order.ts`. Re-exported here because a layer says its stage beside its root,
// so this is where anyone writing one looks for the word.
export { STAGES, type Stage } from './order.js'
import { IN_STAGE, drawOrder, inStage, outOfStage, type Stage } from './order.js'
// One of the three layers a viewer makes for itself. A value import, and one
// way only: `ModelLayer` takes the viewer as a type alone.
import { ModelLayer, type ModelLayerOptions } from './models/ModelLayer.js'

/**
 * Which of the viewer's things has changed, for {@link Layer.changed}.
 *
 * Every word names something the viewer holds and a layer reads back out of
 * it, so the word is also where to go and read: `viewer.camera.view`,
 * `viewer.colors`, `viewer.elevation`, `viewer.maskArea`, `viewer.appear`.
 */
export type Change =
  /**
   * Where the view is, or how much of the world it takes in: `viewer.camera.view`.
   * Where to choose the tiles again.
   */
  | 'view'
  /** The colours: read `viewer.colors` again. */
  | 'colors'
  /**
   * The land has been given its heights, or had them taken away:
   * `viewer.elevation`. Whatever was laid on the ground has to be laid again.
   *
   * Where a layer stands things is baked into what it built — the corners of a
   * road, the ground each building was stood on — so this means building it
   * again rather than moving it. What was fetched is still in the browser's
   * hands, so it is the shaping that is paid for, not the fetching.
   */
  | 'elevation'
  /**
   * The shape the viewer is cut to has changed, or been taken away. Read it
   * from `viewer.maskArea`, which is the mask in the units everything judges
   * against it in.
   *
   * A layer that fetches chooses again — what lies outside was never asked
   * for, and what lies outside now is worth letting go of — and a layer that
   * draws writes the new shape into whatever its materials read it from.
   */
  | 'mask'
  /**
   * The pace things come up out of the ground and go back under it has been
   * written: `viewer.appear`.
   *
   * A layer holding anything on its way finishes it here — what was coming
   * stands, what was going is gone — and leaves every corner saying its way is
   * long behind it. The shader reads the pace afresh every frame, while what a
   * layer holds about the trip (when to stop drawing the sun's map again for
   * it, when to let a sunk tile go) was worked out from the pace it set off
   * at. Left as they were the two part company: a longer pace raised buildings
   * on after the map had stopped following them and let tiles go half way
   * down, and turning it off stood a sinking city back up until the old
   * deadline came and took it away.
   */
  | 'appear'

/** What a viewer is made of. Buildings and Ground are layers; so is anything else drawn. */
export interface Layer {
  /**
   * Everything this layer draws, as one thing.
   *
   * The viewer puts it in the scene as the layer is added and takes it out
   * again as the layer is removed; a layer never touches `viewer.scene` itself.
   * That is what lets a click be traced back to whoever drew the thing under
   * it, and it is where the viewer writes the stage — `root.renderOrder`,
   * which three reads as the stage of everything under it. A group nested
   * inside here loses it and has to say it again; see `inStage`. What it says
   * then is the stage's first place, not this layer's place among the layers
   * of its stage; things that write no depth and are to keep that place are
   * held in a bare `Object3D`, which passes the root's number on, as the
   * land's pieces are.
   *
   * A mesh in here that writes depth and stands up — a block, a mast, a
   * model of the page's own — says so on its material with `marksSolid`, as
   * the library's own do. Unsaid, the stencil under it still says "land" from
   * the land drawn before it, and a colour a page paints on the land alone
   * (`paints: 'ground'`) climbs it as though it were the street. A land of the
   * page's own says `marksLand` instead.
   */
  readonly root: Object3D
  /**
   * Which stage it draws into: the coarse half of where it is drawn. The fine
   * half is the `renderOrder` on the things themselves, which is this layer's
   * to spend — see `order.ts`.
   */
  readonly stage: Stage
  /**
   * Added to a viewer. The root is already seated in the scene by now; this
   * is for what wants the viewer itself — its palette, its shading, its view.
   */
  attach(viewer: Viewer): void
  /**
   * Something the viewer holds and this layer may read has changed: read it
   * again. The word says which thing; see {@link Change}.
   *
   * One method and a word where there were seven methods — `viewChanged`,
   * `colorsChanged` and five more. All seven said the same sentence: the
   * viewer never asks what a layer did about one and never waits to hear. What
   * the words part is which thing to go and read and what reading it again
   * costs, and that is the layer's own business, which reads better as the
   * arms of one switch than as seven methods scattered down a file.
   * {@link listens} is the same shape for the same reason.
   *
   * Every layer is told every word, so one that answers two answers two and
   * lets the rest fall through. Being told costs a call and a string compared,
   * which is why the viewer does not keep track of who wants what.
   *
   * A layer written against the seven keeps compiling and stops being told,
   * since all seven were optional and a class may carry a method this
   * interface has never heard of. `colorsChanged` and the rest are now words.
   */
  changed?(what: Change): void
  /**
   * Once a frame, just before drawing.
   * Input that arrives many times over — a drag — is not acted on as it comes;
   * it is handled here, once.
   *
   * Handed the two numbers the viewer's own `frame` event carries: how long
   * since the last frame, in seconds and held to a tenth however long the tab
   * was away, and the time now, in seconds. A layer that moves something by
   * the clock moves it by these, so it keeps time with the page's own
   * `on('frame')` rather than with a clock and a ceiling of its own.
   */
  frame?(delta: number, time: number): void
  /**
   * Whether this layer is still waiting on something it asked for.
   *
   * Left out where a layer fetches nothing, which is most of them — one with
   * nothing coming is never what a page is waiting for. What it must not
   * report is "everything I wanted arrived": a tile that failed for good is
   * never coming, and a layer holding out for it would keep the viewer from
   * ever saying it had landed.
   */
  busy?(): boolean
  /**
   * How high the tallest thing this layer has on screen reaches, in metres.
   * Left out, it has nothing that stands off the ground. It is what the sun's
   * view is widened by, so that it takes in a roof at that height. With every
   * layer answering 0 the frame draws neither shadows nor the shading where
   * faces meet, so a layer that stands anything up must answer.
   *
   * A layer that answers this and then **moves** what it stands has one more
   * thing to say: {@link Viewer.stirShadows}, which is how the sun is told its
   * map is a frame behind. Not needed where the moving is done from a page's
   * own `on('frame')` — the viewer takes that as a scene that may move and
   * draws the map every frame regardless.
   */
  tallest?(): number
  /**
   * Whose data this layer is drawing at the moment, named as their terms ask.
   *
   * Read once a frame, after {@link frame}. The viewer gathers what all of
   * its layers give, each name once, and draws the line itself — so a layer
   * names a source only while that source is on the screen, and the line
   * never credits what is not being shown.
   */
  credits?(): readonly Credit[]
  /**
   * Patches of ground where this layer's things are on their way: asked for
   * and not yet standing. A layer that draws the ground shows them coming.
   * Asked every frame, since what arrives does not wait for the view to move.
   */
  arriving?(): readonly WorldBounds[]
  /**
   * Whether anyone is listening to this layer for clicks, or for the pointer
   * coming onto its things. The viewer only looks under the pointer for a
   * layer that is.
   */
  listens?(type: 'click' | 'hover' | 'pointing' | 'drag'): boolean
  /**
   * One of this layer's things was clicked. Only one layer is told: a click on
   * a building does not reach the ground under it — and where something is
   * painted over what was found, the layer that painted it is told instead of
   * the layer that drew the pixel; see {@link covers}.
   */
  clicked?(hit: Hit): void
  /**
   * The pointer came onto one of this layer's things, or off all of them
   * (null). Told only when that changes, and not while the view is dragged.
   */
  hovered?(hit: Hit | null): void
  /**
   * Which of this layer's things is painted over what the pointer found, or
   * null where none is.
   *
   * For the things that are not drawn at a place of their own but painted onto
   * the finished picture: a ward's wash lands on the very pixels the ground and
   * the city were drawn in, so the pointer finds *them*, and the answer belongs
   * to the paint standing in front of them. `on` says which of the two was
   * found, since a wash may be held to the land and leave what was built alone
   * ({@link Paints}).
   *
   * Asked once the pixel has been read, and only where what was found is
   * something paint lands on at all — a mark is drawn after the paint and is
   * never washed by it. Every layer is asked and the last to claim it wins,
   * which is the one **added** last — not necessarily the one drawn last: two
   * layers on one stage that write no depth carry the same number and three
   * breaks the tie by bounding-sphere distance (contract 1). A page that needs
   * an order between two washes puts their shapes in one layer. What comes
   * back is carried on as the hit's {@link Hit.item}, so that a page is told
   * afresh as the pointer crosses from one of them to the next.
   */
  covers?(hit: Hit, on: PaintedKind): number | null
  /**
   * Where the pointer is on this layer's things, every time the viewer looks
   * under it — which is every time it moves — and null once it is on
   * something else.
   *
   * The other half of {@link hovered}, and the half that costs nothing extra:
   * the viewer is already looking, and this is only whether the answer is
   * passed on unchanged or only when it turns over. A layer whose page draws
   * something that follows the pointer wants this one; a layer that only
   * lights up what is under it wants the other, and would be told the same
   * thing sixty times a second by this.
   */
  pointed?(hit: Hit | null): void
  /**
   * One of this layer's things is being carried by the pointer: taken hold of,
   * moved, let go.
   *
   * The hit is the one the drag began on and is handed back unchanged at every
   * step, so a layer knows which of its things it is carrying without keeping
   * the answer itself. What moves is {@link Dragging}, which counts from there.
   *
   * Only the layer under the pointer when the button went down is told, and it
   * goes on being told until the button is let go — the pointer leaving the
   * thing, or the canvas, does not end it. That is what taking hold of
   * something means, and it is why this is not another {@link pointed}.
   *
   * Whether the thing follows the pointer is the layer's own to decide. The
   * ones a page stood on the map do follow, as a marker does in every other
   * map library; the viewer only says how far the hand has gone.
   *
   * **The `start` answers whether it was taken at all.** A layer holds many
   * things and only some of them may be carried, which the viewer cannot see:
   * what it found was a pixel, and the layer is the one that knows whose. So
   * it is asked, and a `false` hands the press back to the map — without that,
   * pressing the sheet a page laid its map on would stop the map moving and do
   * nothing instead.
   */
  dragged?(hit: Hit, drag: Dragging, phase: DragPhase): boolean | void
  /**
   * Taken off a viewer. The root is taken out of the scene by the viewer
   * itself; this is for letting go of what the layer holds for one — tiles on
   * their way, motions running, what it drew.
   *
   * The reverse of {@link attach}, and only that: the layer must come out of
   * this ready to be added again, to this viewer or another. What is made
   * once and kept for good — materials, shaders, shapes carved — belongs in
   * {@link dispose}, which is not called here.
   */
  detach(): void
  /**
   * Lets go of everything this layer holds for good. Optional; a layer with
   * nothing of its own to free need not have one.
   *
   * For a layer that will not be used again. A viewer being disposed calls
   * this on every layer it still has, since the common case by far is a layer
   * that was made for that viewer and dies with it. A layer meant to outlive
   * one is taken off it first: {@link Viewer.remove} hands it back untouched —
   * which the three a viewer makes for itself are not; see that method.
   */
  dispose?(): void
}

/**
 * Something a page puts on the map without making the layer that holds it.
 *
 * A group of lines or of marks is how the drawing is kept to a few materials
 * — a hundred lines are not a hundred layers — but that is the renderer's
 * reason and not the page's. So a page may hand the viewer the thing itself:
 * the viewer keeps one group of each kind for whoever never asked for one,
 * and the thing puts itself in there — except a model, which goes into the
 * layer the viewer makes for itself whether or not anybody asks
 * ({@link Viewer.models}). A page that wants a group of its own —
 * to give a hundred lines one answer, or to take them all off at once — makes
 * one and adds that instead, and nothing about it changes.
 *
 * Named as the things it is. It was an interface whose two members are the
 * viewer's own business, so in the public declarations it was empty, and an
 * empty interface takes anything: `viewer.add(mesh)` compiled and threw.
 */
export type Held = Marker | Label | Html | Polyline | Polygon | Circle | Solid | Model

/**
 * What every {@link Held} does to go on the map and come off it.
 *
 * The viewer never learns what a line or a mark is. It learns only that
 * something can put itself on, which is the bargain {@link Viewer.answering}
 * strikes between two layers that have to meet.
 *
 * The two ways in are the library's own and are left out of the published
 * types; the name stays, since the classes a page holds say they are one of
 * these, and a declaration naming a type that is not there does not compile.
 */
export interface PutsItselfOn {
  /**
   * @internal Puts itself into the viewer's own place for its kind: a group
   * made by the first of that kind to ask, or — for a model — the layer the
   * viewer already holds.
   */
  putOn(viewer: Viewer): void
  /** @internal Takes itself out of whatever group holds it. */
  takeOff(): void
}

/**
 * The kinds of group a viewer keeps for the things handed to it bare.
 *
 * Written here rather than spelled out at each {@link Held.putOn}: the kind is
 * what decides whether two things share a group, and a kind misspelt at one of
 * them would quietly make a second group nobody asked for. A name has one
 * place to be got wrong.
 */
export type OwnGroup = 'annotations' | 'solids' | 'shapes'

/**
 * What a viewer tells whoever is listening.
 *
 * A page that shows where the view is — a readout, a permalink, a React
 * component holding it in state — has somewhere to hear it from rather than
 * reading the viewer on every frame of its own loop.
 */
export interface ViewerEvents {
  /**
   * The view moved: dragged, zoomed, flown, keyframed, or set outright — or
   * the canvas changed size, which moves what is in view though none of the
   * numbers move. Told once a frame at most, with the frame after it
   * happened.
   */
  move: { readonly view: View }
  /**
   * The colours changed: a theme handed over, or the sun crossing the horizon
   * and the palette turning to the night's or back.
   */
  colors: { readonly colors: Palette }
  /**
   * Every layer has what it was waiting for: nothing is on its way.
   *
   * Told on the turn, so a page hears it again each time the view asks for
   * more and gets it. Behind a mask held whole the first of them is "the whole
   * shape is here" — which is what a page measuring what it found has to wait
   * for, since the shape and not the screen is what was asked for; see
   * {@link Viewer.screenPicks}. Behind one that rides the camera, or one told
   * to wait for the screen ({@link Mask.fetch}), it is only
   * "what is on screen is here", which is all anyone could promise.
   *
   * There was a `viewer.loaded` beside this for a while that settled on the
   * first of them. It said the same thing in a second word and nothing in
   * this repository ever read it, so it went; a page wanting the first one
   * and no more takes the stop this hands back and calls it.
   *
   * A layer says whether it is still waiting through {@link Layer.busy}; one
   * that does not say is taken to be done, since a layer with nothing to
   * fetch never holds anybody up.
   */
  loaded: Record<string, never>
  /**
   * A frame is about to be drawn, and how long it has been since the last one,
   * in seconds.
   *
   * For a page with something of its own to move: a model walking the city, a
   * value that changes with time, anything that wants a clock. Told before the
   * layers choose their tiles and before the camera and the sun are aimed, so
   * what a page moves here is what this frame draws rather than what the last
   * one did.
   *
   * The gap is held to a tenth of a second. A page that was in the background
   * would otherwise be handed however long it was away, and whatever it moves
   * by that would leap across the city in one frame.
   *
   * Without this a page has to hand the viewer a layer that draws nothing, or
   * run a loop of its own beside the viewer's and be a frame behind it.
   */
  frame: { readonly delta: number; readonly time: number }
  /**
   * Something the viewer itself could not do, and which of the two it was.
   *
   * **`'start'`** — it could not start. Not a browser without WebGPU: there
   * it starts on WebGL 2 instead (see {@link Viewer.backend}). This is a
   * browser with neither, or a device that would not be had — the one a page
   * may want to say something about. Said once and never again: there is no
   * second attempt.
   *
   * **`'effect'`** — one of {@link ViewerOptions.effects} threw as it drew.
   * The picture is already on the canvas and the other passes are drawn, so
   * the frame carries on; this is said for the pass that threw, and as often
   * as it throws — every frame, where whatever it is unhappy about does not
   * pass.
   *
   * A page can hear the first of those by listening on the line after it made
   * the viewer: asking the browser for a device is the first thing the viewer
   * awaits, so nothing can have failed before the constructor returns.
   * `viewer.ready` used to carry that failure as a rejection and was taken
   * off — Cesium had the same `readyPromise` and removed it in 1.107, for the
   * same reason it was awkward here: a promise nobody awaits turns a failure
   * into an unhandled rejection, which is a worse thing than the failure.
   *
   * With nobody listening it goes to the console instead.
   */
  error:
    | {
        /** Which of the two. */
        readonly what: 'start'
        /** What went wrong, as it was thrown. */
        readonly cause: unknown
      }
    | {
        readonly what: 'effect'
        /** The pass that threw, so a page with several knows which to take off. */
        readonly effect: FramePass
        readonly cause: unknown
      }
  /**
   * Whose data is on the screen changed — a source came into view, or the
   * last of it went. The viewer draws its own line; this is for a page that
   * would rather draw one of its own.
   */
  credits: { readonly credits: readonly Credit[] }
  /**
   * A click nothing answered.
   *
   * The layer whose thing is in front is told first, as it always was. This is
   * the rest: a click that found nothing at all, and a click on something whose
   * layer nobody is listening to. So a page that opens a thing when it is
   * clicked has somewhere to close it again, and a click that lands beside the
   * thing is not simply lost.
   *
   * There is no way to be told about a click a layer did take. Whether a thing
   * answers is whether someone is listening to it, which the page itself
   * decided; asking to hear about it twice would be asking to hear its own
   * listener.
   */
  click: {
    /** Where on the map the click landed, or nothing where it landed on nothing. */
    readonly position: Position | null
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
}

/** Where the view is and how it is angled. */
export interface View {
  /** The middle of the view, as [longitude, latitude]. */
  readonly center: readonly [number, number]
  /** The zoom, on the map tiles' own scale. Fractions are welcome. */
  readonly zoom: number
  /** The tilt, in degrees. At 0 it looks straight down. */
  readonly pitch: number
  /** The heading, in degrees. At 0 north is up. */
  readonly heading: number
}

/** How {@link Camera.fitBounds} fits. */
export interface FitBoundsOptions {
  /** A margin kept clear round the rectangle, in CSS pixels. Nought by default. */
  readonly padding?: number
}

/** How a flight from one place to another goes. */
export interface FlyOptions {
  /**
   * How long it takes, in milliseconds. 0 moves at once. Left out, the
   * distance decides, between 0.4 and 5 seconds.
   */
  duration?: number
  /** How time runs through it. Slow to set off and slow to land, by default. */
  easing?: Easing
  /**
   * Whether it pulls back on the way and comes down again. The further it
   * goes the higher it rises, so that the ground never runs past faster than
   * the eye can follow. Turned off, the width changes evenly and it goes
   * straight there. On by default.
   */
  arc?: boolean
}

export interface ViewerOptions {
  /**
   * Where the canvas goes: the element, or its id — the way the map
   * libraries have taken it since before `querySelector` was everywhere.
   *
   * Given an id nothing has, the viewer says so. That is the one check a
   * page would otherwise write, and it is the same check on every page.
   */
  container: HTMLElement | string
  /**
   * Which backend to draw with, where the page means to pin one.
   *
   * Left out — which is what a page wants — the renderer takes WebGPU where
   * the browser has it and WebGL 2 where it does not. `'WebGL2'` pins the
   * fallback, so that the path a browser without WebGPU takes can be looked
   * at on a machine that has it. It is three's own `forceWebGL`, and there is
   * no pinning the other way: WebGPU is taken wherever it is there.
   *
   * {@link Viewer.backend} says which one it ended up on, either way.
   */
  backend?: 'WebGL2'
  /**
   * Which corner the line naming the sources stands in. Bottom right by
   * default. The line is drawn whatever is chosen — both of the sources this
   * library fetches from ask to be named where their data is shown.
   */
  creditsAt?: CreditsCorner
  /**
   * A say over every request the library makes — Mapbox's `transformRequest`,
   * by its name and its shape. Handed the address and what it is for (see
   * {@link RequestKind}), it hands back where to go instead and with what
   * headers, or nothing to go as asked. For a proxy, a mirror, a signed
   * request, or a dataset held to one year where the catalog's address says
   * `-latest`. A property of the viewer afterwards, by the same name.
   *
   * What several viewers share is fetched once, through whichever viewer
   * asked first: the land's heights, PLATEAU's list of cities and its
   * catalog are held for the whole page.
   */
  transformRequest?: TransformRequest
  /**
   * The middle of the view, as [longitude, latitude].
   *
   * Read rather than held: a page that writes its places down as `as const`
   * hands over a readonly pair, and a page that keeps its own array is not
   * handing the viewer a way to move the view behind its back.
   */
  center?: readonly [number, number]
  /** The zoom, on the map tiles' own scale; fractions welcome. Left out, the whole of Japan is fitted. */
  zoom?: number
  /** The tilt, in degrees. At 0 it looks straight down; it lies back as far as 70. */
  pitch?: number
  /** The heading, in degrees. At 0 north is up. */
  heading?: number
  /**
   * The furthest out and the closest in the view may go, on the tiles' own
   * scale — Mapbox's two, by their names. 2 and 22 by default, which is as
   * far as this library goes either way; a page may hold the view tighter
   * than that and no looser. Properties of {@link Viewer.camera} afterwards.
   */
  minZoom?: number
  maxZoom?: number
  /**
   * How far the view may lie back, in degrees: 70 by default, which is as far
   * as this library goes (Mapbox's `maxPitch`). A property of
   * {@link Viewer.camera} afterwards.
   */
  maxPitch?: number
  /**
   * How many pixels of the screen go to one of the page. The device's own by
   * default; a property of the viewer afterwards, by the same name.
   */
  pixelRatio?: number
  /**
   * The ways the reader moves the map, each on by default; see
   * {@link Interaction}. Properties of the viewer afterwards, by the same
   * names.
   */
  dragPan?: InteractionOptions
  dragRotate?: InteractionOptions
  scrollZoom?: InteractionOptions
  touchZoomRotate?: InteractionOptions
  touchPitch?: InteractionOptions
  /**
   * What to draw, put on as the viewer is made.
   *
   * The same things {@link Viewer.add} takes, and the same rules: a layer is
   * seated by the stage it declares, and a mark or a line goes into the
   * viewer's own group of its kind. Written here, a page says what it draws in
   * the one statement that makes the map rather than in a list of calls after
   * it.
   *
   * They go on whole or not at all. Anything already taken refuses to go on
   * twice — a layer on another viewer, a mark in another group — and it is
   * found partway down the list, after its neighbours are seated; a page that
   * wrote the lot in one place has no handle on the half that landed. So the
   * half that landed comes off again and the refusal is what a page hears.
   *
   * `add` is still there, for what a page makes later or swaps out.
   */
  layers?: readonly (Layer | Held)[]
  /**
   * The land. A viewer always has one, and seats it at the head of its stage,
   * so a page draws a map by making a viewer and nothing else.
   *
   * A page that wants none says `visible: false` here: turned off it chooses
   * no tiles and fetches nothing, and {@link Viewer.ground} is still there to
   * turn back on. Made either way rather than left out, so that reading it is
   * never a question — which is how a globe is turned off in Cesium, and why
   * `scene.globe` is still something to talk to afterwards.
   *
   * Only one, and the viewer's: the land is one surface, and a second would
   * fight the first for the same depth and fetch the same tiles twice. A page
   * drawing its own floor turns this off and puts its layer in {@link layers}.
   */
  ground?: ViewerGroundOptions
  /**
   * The city. A viewer always has one, turned off the same way as the land.
   *
   * A second is a fair thing to ask for — a city at another level of detail,
   * which is settled when the layer is made, so the playground turns this one
   * off and swaps a city of its own whole whenever the level changes — and a
   * page makes that one itself and hands it over in {@link layers}.
   */
  buildings?: BuildingsOptions
  /**
   * The page's own models. A viewer always has a layer for them, the way it
   * has the land and the city, so `viewer.models.bring(…)` is the one way a
   * glTF file is read and `viewer.buildings.bring(…)` reads the same beside
   * it.
   *
   * Said here for a page that would rather serve its own Draco or KTX2
   * decoder than reach the ones this library falls back on — Google's build
   * of the first and a CDN copy of the second, both named in `draco.ts` and
   * `ktx2.ts`, neither of them three's own. A page wanting a second layer —
   * its own decoders for some files and not others — makes one and hands it
   * over in {@link layers}.
   */
  models?: ModelLayerOptions
  /**
   * The shape the scene is cut to: a circle, a rectangle or a ring, or a list
   * of them, the scene cut to all of them together, with one hem, margin and
   * way of fetching for the lot. One shape alone may stand on the map or ride
   * the camera; a list stands; see {@link Mask}.
   *
   * Left out, nothing is cut, and the scene reaches as far as the screen does
   * — what Mapbox and Cesium do with no clipping said. A mask with no `shape`,
   * or with the screen's own (`{ type: 'view' }`), is the same, with a say in
   * how far past the screen is fetched.
   *
   * The shape is the whole of what is fetched, not only of what is drawn. A
   * shape standing on the map has an inside that can be asked for whole,
   * however the camera is pointed, so a page may say "every building in this
   * circle" and be answered; one riding the camera has not, and neither has a
   * viewer nobody has cut. Nothing a page has to know about tiles — and one
   * word, {@link Mask.fetch}, where a page would rather have that inside come
   * as the view reaches it; see {@link Viewer.screenPicks}.
   *
   * It may be set, moved or taken away at any time afterwards through
   * {@link Viewer.mask}.
   *
   * _(2026-11-26: it had to be said, and a viewer nobody had cut said so with
   * `{ shapes: [{ shape: 'view' }] }`. That is `{ shape: { type: 'view' } }`
   * now, and what leaving it out means.)_
   */
  mask?: Mask
  /**
   * The palette, as far as a page wants to say it.
   *
   * Any of the palette's names, each one a colour or a {@link ThemeColor}
   * pair; what is left out keeps the library's own, which already turns over
   * at dusk. One object for the whole map, so that a page keeps its colours
   * in one place and hands them over together.
   *
   * A layer's own colours are the finer grain and they come over this —
   * `ground.road.color`, `buildings.wallColor` — and one building painted on
   * its own (`buildings.setStyle(id, …)`) comes over both. A theme is the
   * ground a page builds on, not the last word: the wider a setting reaches,
   * the sooner it gives way, which is the whole of the order between them.
   */
  theme?: Theme
  /**
   * The light: an angle picked for how the map reads, or the sun as it stands
   * at a moment. null leaves every face the same brightness.
   */
  sun?: Sun | null
  /**
   * The shading where faces meet: whether it is drawn, how strong, how far
   * round. On by default; `{ enabled: false }` leaves it out. Changed
   * afterwards through {@link Viewer.occlusion}, by the same names.
   */
  occlusion?: OcclusionOptions
  /**
   * The miniature look: sharp at one depth, blurred in front of it and behind
   * it. Off by default; `{ enabled: true }` turns it on, with the rest worked
   * out from the view. Changed afterwards through {@link Viewer.tiltShift}, by
   * the same names.
   */
  tiltShift?: TiltShiftOptions
  /**
   * What a page draws over the finished frame: its own post-processing, a pass
   * out of three's addons, a quad of its own. Drawn in the order given, last
   * in the frame; see {@link FramePass}.
   */
  effects?: readonly FramePass[]
  /**
   * How things come up out of the ground as they arrive and go back under it
   * as they leave: whether they do, how long one takes, and how far apart the
   * things of one tile set off so that a tile does not move as a slab.
   * `{ enabled: false }` stands them up, and takes them away, at once.
   * Defaults to on. Changed afterwards through {@link Viewer.appear}, by the
   * same names.
   *
   * The page's, not any one layer's and not any one viewer's. Buildings
   * rising and the park they stand in keep the same step because they keep
   * this one, and the clock they keep it by is a shader's — woven into every
   * material that rises, so there is one of it for the whole page; see
   * `appear.ts`. A second viewer given no pace of its own still sets the
   * default, so two viewers on one page cannot each have their own.
   */
  appear?: AppearOptions
}

/**
 * Whatever is moving the view of its own accord. One at a time.
 *
 * A flight and a keyframed motion move the same four numbers, so there is
 * nothing to share between them: whichever starts pushes the other out.
 */
interface ViewMotion {
  readonly motion: Playing
  /** Each frame: given how far along it is, 0 to 1, it puts the view where it belongs. */
  step(k: number): void
  /** Once, on reaching the end. */
  done(): void
  /** Once, on being stopped part way. */
  cut(): void
  /**
   * Once, on the page cancelling it itself: what it moved goes back to where
   * it stood before, as `Animation.cancel` says. Not on being stopped by
   * something else taking the view, which is the other side of {@link cut} —
   * that one has somewhere new to be.
   */
  undo?(): void
  /**
   * Whether the viewer is done with it the moment it ends.
   *
   * A flight is: nothing was handed back that could play it again, only a
   * promise that has settled. A keyframed motion is not — the page holds it,
   * and `play()` on a finished motion means play it again, so the viewer
   * keeps its place and picks it up when it starts moving once more.
   */
  readonly spent: boolean
  /** Whether it has already been told it ended, so that it is told once. */
  settled: boolean
  /** Whether it was cancelled and has been undone, so that it is undone once. */
  idle?: boolean
}

/** One keyframe of a motion that moves the view. */
export interface ViewKeyframe extends Keyframe {
  /** The middle of the view, as [longitude, latitude]. */
  readonly center?: readonly [number, number]
  readonly zoom?: number
  readonly pitch?: number
  /**
   * The heading, in degrees. The values are run through as written, so 0 to
   * 360 turns a full circle. To turn the short way round, write it as 350 to
   * 370.
   */
  readonly heading?: number
}

/** The keyframes taken apart, one list per thing they move. */
interface ViewFrames {
  readonly centre: Frame<readonly [number, number]>[]
  readonly zoom: Frame<number>[]
  readonly pitch: Frame<number>[]
  readonly heading: Frame<number>[]
}

const TILE_PIXELS = 256
/**
 * How far the view may zoom. The floor tiles stop at z16, but they are
 * vectors and hold up past it.
 *
 * The far end sits at 22 because there is nothing more to see there, not
 * because anything breaks. The projection is orthographic, so the camera
 * never walks through a wall; the depth range does not follow the zoom, so no
 * building is ever cut off; and there is no jitter from large coordinates,
 * since the model-view matrix is multiplied out on the CPU and only small
 * numbers reach the card.
 *
 * At 22 the screen is some 20 metres across: one face of a building fills it
 * and a few windows show. Closer than that and all that is left is the colour
 * of one wall.
 */
const MIN_ZOOM = 2
const MAX_ZOOM = 22
/** How far the view may lie back, in degrees. Further, and the horizon runs away without end. */
const MAX_PITCH = 70
/**
 * How far the zoom moves for a pixel of wheel.
 *
 * One notch of a mouse wheel is usually 100 pixels, so a notch is 0.4 of a
 * zoom step, and fifty notches carry it end to end.
 */
const ZOOM_PER_PIXEL = 0.004
/**
 * How near the ground may come to running away from the eye before the wheel
 * stops trying to stand on it; see {@link Viewer.overTheLand}.
 *
 * A quarter. Moving the middle back down a slope to undo a rise lands it on
 * ground of its own, and `1 + slope·tan(pitch)` is how much of the move
 * survives that: on level ground it is 1, on ground rising away from the eye
 * it is more and the move is smaller, and on ground falling away at the very
 * angle the eye looks down it reaches nought — the middle can chase that
 * hillside for ever and never catch it. Under a quarter, the answer is worth
 * four times the first guess or is not a number at all, and nothing is done:
 * a picture that slides is better than one that leaps sideways.
 */
const LEAST_SETTLE = 0.25
/**
 * What a wheel counted in lines or pages is worth in pixels.
 *
 * A browser sends one of the three, and the one that counts lines (Firefox)
 * makes a notch 3. Taken as pixels, the same notch would move the zoom by a
 * thirtieth of what it should and the map would barely stir.
 */
const WHEEL_LINE = 16
const WHEEL_PAGE = 400
/** How many screenfuls a flight given no duration crosses in a second. */
const FLY_SPEED = 1.5
const FLY_MIN_DURATION = 400
const FLY_MAX_DURATION = 5000
/** How many degrees of turning or tilting take as long as crossing one screen. */
const DEGREES_PER_SCREEN = 90
/**
 * The longest a page is told a frame took, in seconds.
 *
 * A page moving something by the gap between frames should not be handed the
 * minute it spent in another tab: whatever it moves would cross the city in
 * one step. A tenth is longer than any frame worth drawing and short enough
 * that nothing leaps.
 */
const LONGEST_FRAME = 0.1

/**
 * How much depth is kept open even at the closest zooms — world units, about
 * 1.6km. The tallest building there is is Skytree at 634m, so a few times
 * that is room enough.
 */
const DEPTH_FLOOR = 2000
/** Skytree, the tallest there is, stands 634m. The sun's view steps back this far to take a shadow in (m). */
const TALLEST = 700

/**
 * The ladder the sun's box is cut to.
 *
 * **Why there is a ladder at all.** The box holds a fixed count of texels, so
 * a box of another width is a map of another texel size — and the grid every
 * shadow's edge is chopped on is laid down afresh. Each tooth along an edge
 * is then cut somewhere else than it was, which the eye reads as a saw running
 * along every shadow in the view. Taken as it comes, the width follows three
 * things at once and two of them move smoothly: how far the view reaches over
 * the ground, how far the view leans, and how tall the tallest thing standing
 * in it is.
 *
 * Measured 2026-10-07 at 中野駅, z20.71. Leaning from 51° to 65° took the
 * texel from 0.322m to 0.414m, smoothly, a step every two degrees. Zooming
 * 20.71 to 20.90 took it from 0.296m to 0.288m, again smoothly. Turning right
 * round, by contrast, stepped it twice — the tallest thing in view is the only
 * one of the three that turning moves, and it moves in jumps. Which is why the
 * ladder is cut here, on the width, where all three arrive, and not on the
 * height: a ladder on the height alone was tried first and bought nothing.
 *
 * **It does not wait on the way in.** It did: the box used to come in only
 * once the smaller rung had been enough for thirty frames together, so that a
 * lean crossing a rung and coming back cost one step rather than two, and the
 * step back landed after the hand was off the view. What that bought in
 * stillness it paid for in surprise — a zoom ended, and a quarter of a second
 * later every shadow edge in the view was cut afresh for no reason the eye
 * could see. Now the rung is simply whatever the width asks for, out and in
 * alike, and what the view does the shadow does with it.
 *
 * A quarter of an octave, so a step coarsens the map by at most 19% and the
 * rungs sit at the same places whatever the zoom.
 */
const REACH_RUNG = 4

/** The rung at or above a width. */
function reachingTo(metres: number): number {
  if (!(metres > 0)) return 0
  return 2 ** (Math.ceil(Math.log2(metres) * REACH_RUNG) / REACH_RUNG)
}
/**
 * How long a frame may take before the page is seen to stutter, in
 * milliseconds.
 *
 * A sixtieth of a second, which is what a display asks for and what a reader
 * dragging the map notices the loss of. A display that refreshes faster wants
 * less, but a layer told so would do a little work at a time forever on a fast
 * screen and hold up what the reader is waiting for; a display that refreshes
 * slower is not made smoother by filling the gap.
 */
const FRAME_RUNS_LONG = 16

/**
 * What a pixel of the canvas is worth over the ground: how far one to the
 * right goes east, how much a tilt stretches one up the screen, and which way
 * the view is turned.
 *
 * Taken as a value rather than read off the viewer where it is used, because
 * one reader wants it as it *was*. A carry counts the whole distance from
 * where the button went down ({@link Viewer.carriedTo}), so a wheel turned or
 * a view swung in the middle of one must not change what the pixels already
 * crossed are worth — and both can happen, the wheel because nothing stops it
 * and the turn because the right button is the view's whatever is held.
 */
interface GroundScale {
  readonly perPixel: number
  readonly lean: number
  readonly heading: number
}

/**
 * Something the pointer has hold of: whose it is, what it took hold of, where
 * the button went down, and what the pixels were worth over the ground at that
 * moment.
 *
 * All four are kept here rather than read again as the hand moves, because all
 * four are about the moment the hold began — see {@link Viewer.carriedTo} for
 * what reading them afresh would do to the distance.
 */
interface Carried {
  readonly layer: Layer
  readonly hit: Hit
  /** Where the button went down, in the page's own pixels. */
  readonly x: number
  readonly y: number
  readonly scale: GroundScale
  /** Metres to a world unit where the thing stands. */
  readonly metres: number
}

/** What so many pixels right and up come to over the ground, in world units. */
function overTheGround(right: number, up: number, scale: GroundScale): { x: number; y: number } {
  const east = right * scale.perPixel
  // Under a tilt one pixel down the screen is a longer way over the ground
  const north = (up * scale.perPixel) / scale.lean
  const heading = (scale.heading * Math.PI) / 180
  return {
    x: east * Math.cos(heading) - north * Math.sin(heading),
    y: east * Math.sin(heading) + north * Math.cos(heading),
  }
}

/**
 * Whether anything between what the wheel was turned over and the markup layer
 * still has room to scroll the way it was turned.
 *
 * Asked of the path the event took rather than of the one element under the
 * cursor, since what scrolls is usually a box some way up from the text the
 * pointer is actually on. The walk stops at the layer itself: above it is the
 * page, and the page scrolling is the very thing being taken away.
 *
 * A pixel of slack is let go. A box scrolled to its end lands on a fractional
 * remainder at some zoom levels and under some device pixel ratios, and a box
 * that is done scrolling should hand the turn over rather than swallow it for
 * the sake of half a pixel.
 *
 * Scrolling and nothing else. A mark that handles the wheel itself says so by
 * calling `preventDefault`, and that is read where this is called rather than
 * here: this function answers one question and the caller asks the other.
 */
function scrollRoomIn(e: WheelEvent, upTo: HTMLElement): boolean {
  const SLACK = 1
  // The axis the turn was mostly on, and only that one. A trackpad's vertical
  // swipe carries a few pixels of the other way, so a box asked about both
  // axes answers "I have room" about the axis the reader was not using — and
  // one horizontally scrollable strip anywhere in the path would then claim
  // every vertical turn on the card it sits in.
  const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY)
  const delta = sideways ? e.deltaX : e.deltaY
  if (delta === 0) return false
  for (const node of e.composedPath()) {
    if (node === upTo) return false
    if (!(node instanceof HTMLElement)) continue
    const style = getComputedStyle(node)
    if (!SCROLLS.test(sideways ? style.overflowX : style.overflowY)) continue
    const span = sideways
      ? node.scrollWidth - node.clientWidth
      : node.scrollHeight - node.clientHeight
    // How far it has come from its own start edge. Right to left that edge is
    // the right-hand one and the number runs negative from it, which is the
    // convention every current browser follows — so the distance is taken
    // without its sign and the two ways round are swapped instead.
    const from = Math.abs(sideways ? node.scrollLeft : node.scrollTop)
    const onwards = sideways && style.direction === 'rtl' ? delta < 0 : delta > 0
    if ((onwards ? span - from : from) > SLACK) return true
  }
  return false
}

/** The computed overflow values that scroll. `clip` and `visible` do not, and `hidden` only by script. */
const SCROLLS = /^(auto|scroll|overlay)$/

/**
 * A mask as a page handed it, copied all the way down and frozen: what
 * {@link Viewer.mask} hands back, so that writing into it throws in a module
 * rather than reading one shape while another is drawn.
 */
function frozenMask(mask: Mask | null): Mask | null {
  return mask ? deepFrozen(structuredClone(mask)) : null
}

function deepFrozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inside of Object.values(value)) deepFrozen(inside)
    Object.freeze(value)
  }
  return value
}

/** A keyframe's number, or throws naming where — as a middle that is not [lon, lat] does. */
function numberIn(value: number | undefined, name: string, at: number, owner: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new Error(`${owner}: keyframe ${at} has a ${name} that is not a number`)
  return value
}

/** Wraps a heading into -180 to 180. */
function wrapHeading(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180
}
/** How far the view turns for each pixel dragged, in degrees */
const LOOK_SPEED = 0.25
/**
 * How far a press may wander, in pixels of the page, and still be a click
 * when it is let go. Further and it was a drag.
 */
const CLICK_SLOP = 4
/**
 * How many frames at most go by between two looks under a pointer that stays
 * still. A tile can land under it without anything moving.
 */
const LOOK_AGAIN_EVERY = 10
/**
 * The cursor over a map that is standing still and answering nothing.
 *
 * The page's own, whatever that is — a canvas with nothing said about it shows
 * what the platform shows anywhere else, and a reader knows that arrow already.
 */
const RESTING_CURSOR = 'default'

/**
 * Where the map is looked at from, and the ways of moving there.
 *
 * Four numbers and nothing else: the middle, how close in, how far the view
 * is tilted and which way is up. Everything a page says about where it is
 * looking goes through here — written one at a time, flown to, or keyframed —
 * and everything it reads back comes from here.
 *
 * **Not three's camera.** That one is {@link Viewer.threeCamera}, and it is
 * what these four come out as once the viewer has worked out where to stand
 * an orthographic eye to make them true. The two share a word and share
 * nothing else: `zoom` here is the map tiles' own scale, where three's is how
 * far a projection is blown up, and writing to three's would be overwritten
 * by the next frame besides.
 *
 * Every write lands in one place, which is what lets a view be clamped,
 * wrapped and told about exactly once however it was asked for (contract 3).
 */
export class Camera {
  /** @internal Made by the viewer, and read as `viewer.camera`. */
  constructor(private readonly viewer: Viewer) {}

  /** Where the view is and how it is angled, all four together. */
  get view(): View {
    return this.viewer.viewNow
  }

  /** The middle of the view, as [longitude, latitude]. Frozen; write a new pair to move it. */
  get center(): readonly [number, number] {
    return this.viewer.viewNow.center
  }

  set center(value: readonly [number, number]) {
    this.viewer.setView({ center: value })
  }

  /** The zoom, on the map tiles' own scale. Fractions are welcome. */
  get zoom(): number {
    return this.viewer.viewNow.zoom
  }

  set zoom(value: number) {
    this.viewer.setView({ zoom: value })
  }

  /** The tilt, in degrees. At 0 it looks straight down. */
  get pitch(): number {
    return this.viewer.viewNow.pitch
  }

  set pitch(value: number) {
    this.viewer.setView({ pitch: value })
  }

  /** The heading, in degrees. At 0 north is up. */
  get heading(): number {
    return this.viewer.viewNow.heading
  }

  set heading(value: number) {
    this.viewer.setView({ heading: value })
  }

  /** The furthest out the view may go; see {@link ViewerOptions.minZoom}. A view further out is brought in. */
  get minZoom(): number {
    return this.viewer.limits.minZoom
  }

  set minZoom(value: number) {
    const { maxZoom, maxPitch } = this.viewer.limits
    this.viewer.limit(value, maxZoom, maxPitch)
  }

  /** The closest in the view may go; see {@link ViewerOptions.maxZoom}. */
  get maxZoom(): number {
    return this.viewer.limits.maxZoom
  }

  set maxZoom(value: number) {
    const { minZoom, maxPitch } = this.viewer.limits
    this.viewer.limit(minZoom, value, maxPitch)
  }

  /** How far back the view may lie, in degrees; see {@link ViewerOptions.maxPitch}. */
  get maxPitch(): number {
    return this.viewer.limits.maxPitch
  }

  set maxPitch(value: number) {
    const { minZoom, maxZoom } = this.viewer.limits
    this.viewer.limit(minZoom, maxZoom, value)
  }

  /**
   * Moves the view somewhere else. What is not named keeps the value it has,
   * and a value that is not a finite number counts as not named.
   *
   * Where the zoom changes on the way, it pulls back once and comes down
   * again: the further it goes the higher it rises, so the ground never runs
   * past faster than the eye can follow.
   *
   * The promise settles true on arrival and false on being stopped part way —
   * someone taking hold of the view, another flight starting, `center` or
   * `zoom` being set outright, {@link stop}, or the viewer being disposed. It
   * never rejects, so it need not be caught.
   *
   * It moves with the frames, so it waits out a hidden tab and lands exactly
   * on the first frame after its time is up.
   *
   * @example
   * await viewer.camera.flyTo({ center: [139.7671, 35.6812], zoom: 18 })
   */
  flyTo(to: Partial<View>, options: FlyOptions = {}): Promise<boolean> {
    return this.viewer.flyTo(to, options)
  }

  /**
   * Moves the view by keyframes. What comes back is a motion handled the way
   * the browser's `Animation` is: paused, reversed, run at another rate,
   * cancelled.
   *
   * Anything the keyframes do not speak of stays where it was when the motion
   * started. `fill` is `'both'` unless the timing says otherwise, where an
   * element's is `'none'`: the view has no value of its own under the motion
   * to go back to, so by default it stands where the motion last put it.
   * Filled `'none'` or `'backwards'`, it goes back to where it was once the
   * motion ends; cancelled, it goes back whatever the fill, as `cancel` says.
   *
   * Played again once it has ended, it moves the view again: the viewer keeps
   * its place until something else takes the view. Someone taking hold of the
   * view, setting `center` or `zoom` outright, or another motion starting,
   * stops it for good — played after that, it runs on its own and moves
   * nothing.
   *
   * @example
   * // A slow turn, as a backdrop
   * viewer.camera.animate([{ heading: 0 }, { heading: 360 }], {
   *   duration: 60000,
   *   iterations: Infinity,
   * })
   */
  animate(keyframes: readonly ViewKeyframe[], timing: Timing): Animation {
    return this.viewer.animate(keyframes, timing)
  }

  /** Stops whatever is moving the view where it stands. A flight's promise settles false. */
  stop(): void {
    this.viewer.stop()
  }

  /**
   * Sets the middle and the zoom so that a rectangle of longitude and latitude
   * fits on screen, as the view is turned and tilted.
   *
   * `padding` is a margin kept clear round it, in CSS pixels, as Mapbox's
   * is. Nought where it is left out. It was a share of the screen until
   * 2026-10-28 (0.9 by default), and a page writing the 40 it meant as
   * pixels had the rectangle thrown five zooms past the edge of the screen.
   *
   * The page asking to look somewhere, so whatever was moving the view gives
   * way. Asked before the canvas has a size — a page fits to what it fetched,
   * which may well arrive before the stylesheet does — it is kept and done
   * once there is one, and the last rectangle asked for is the one done.
   *
   * A rectangle that is not four finite numbers moves nothing. The rectangle
   * round nothing loaded is every corner at infinity, and staying where the
   * view is is the honest answer to being asked to look at nothing.
   */
  fitBounds(bounds: MapBounds, options: FitBoundsOptions = {}): void {
    this.viewer.fitBounds(bounds, options.padding ?? 0)
  }
}

export class Viewer {
  /**
   * The scene. Three's, and three's rules hold in it.
   *
   * **Fog follows, and nothing here had to be written for it to.** Every
   * material this library draws a solid with is a node material, and three
   * folds `scene.fog` into the output of all of them
   * (`NodeMaterial.setupFog`), so `viewer.scene.fog = new Fog(…)` reaches the
   * land, the city, the trees, a page's own models — the lines and the letters
   * too, which three fogs as it fogs everything else. Read in the renderer's
   * own code and not measured on screen; there was no fog in this map before
   * and there is none in it now.
   *
   * Three things to know about writing it.
   *
   * It is a colour in the light and goes through the tone curve like every
   * other, so a page wanting the colour it wrote writes
   * `beforeTheCurveOf(…)`; see `tone.ts`.
   *
   * Turning it on or off re-weaves. Three hangs the fog on the shader's cache
   * key (`NodeManager.getCacheKey`), so the first frame after it changes pays
   * a shader for every material on screen, at about a second each — a page
   * that means to have fog writes it before the first frame, or weaves again
   * ({@link weave}) off the frame — `await viewer.weave()` with nothing
   * named weaves the scene as it stands. Moving its colour, its near or its
   * far costs nothing: three reads those three as uniforms.
   *
   * And it is left out of everything drawn to be read rather than looked at —
   * the lines' picture and the look under the pointer — because those hold
   * numbers and a number mixed towards a colour is a wrong number. One line
   * in `drawOffscreen`.
   *
   * `scene.background` is the viewer's own until a page writes one: the
   * palette's `backdrop`, kept up as the theme changes and the sun crosses
   * the horizon. A background the page puts there itself is left alone.
   */
  readonly scene = new Scene()
  readonly threeCamera = new OrthographicCamera()
  /**
   * Where the map is looked at from: the middle, the zoom, the tilt and the
   * heading, and the ways of moving them. See {@link Camera}, which says why
   * it is not {@link threeCamera}.
   */
  readonly camera: Camera = new Camera(this)
  /**
   * The light: a sun that casts and a sky that fills, both three's own.
   *
   * Public since 2026-10-06, when they stopped being a stand-in. Every
   * material in this library reads them now, so `lights.sun` is the light the
   * city is actually lit by and `lights.fill` is what its shaded sides are left
   * with — a page that knows three can read either, or hang a helper on the sun
   * to see where it points.
   *
   * `scene.environment` is left empty, and that is a decision rather than an
   * oversight: there is no sky here (see `lights.ts`). A page that wants its
   * own metal to reflect something puts a picture there itself, before the
   * first frame — what a scene holds there is part of every material's shader.
   *
   * Reading, not writing. There is still one place to say what the light is
   * doing ({@link sun}), because the two ends of it are pinned so that a flat
   * lit surface comes out at the palette's own colour — a page turning the
   * sun's intensity up moves one end and leaves the other, and the land stops
   * being the colour it is written as. See `lights.ts`.
   */
  readonly lights = new Lights()
  /**
   * What the sun can see, as one map over the view.
   *
   * The light's, not the viewer's — it hangs on `sun.shadow.shadowNode`, which
   * is where three asks for a shadow — and held here only because aiming it is
   * the viewer's work: it is fitted to what is on screen and to the shape the
   * scene is cut to, and nothing else knows either. See {@link castShadows}.
   */
  private readonly shadows: SunShadow = this.lights.shadows
  /**
   * What the sun's map was last drawn for — where it was aimed, as the eight
   * numbers {@link castShadows} works out — or null where it holds nothing
   * worth keeping.
   */
  private shadowDrawnFor: readonly number[] | null = null
  /** The shape of the sun's shader as it was last built; see {@link castShadows}. */
  private shadowShape = 0
  /** Whether the sun's map has had its texture made; see {@link SunShadow.prime}. */
  private shadowPrimed = false
  /**
   * Whether a pass over the picture made from here on weaves as it is made;
   * before, `begin` weaves the ones there are once the scene is woven. See
   * {@link weavePass}.
   */
  private passesWeave = false
  /** Whether the frames have begun; see {@link framing}. */
  private framesBegun = false
  /** The passes over the picture whose shaders are made, which are the only ones drawn; see {@link weavePass}. */
  private readonly passesWoven = new WeakSet<OcclusionPass | TiltShiftPass>()
  /** The weaving under way for each pass over the picture; see {@link weavePass}. */
  private readonly passesWeaving = new Map<OcclusionPass | TiltShiftPass, Promise<void>>()
  /** The scene as last drawn, to tell whether this frame would draw it again; see `repaint.ts`. */
  private readonly sceneState = new SceneState()
  /** The count of changed uniforms this viewer last saw; see `uniformChanges`. */
  private uniformsSeen = -1
  /** Whether something that cannot be compared asked for the next frame to be drawn. */
  private repaintAsked = true
  /** Whether the last frame was drawn for something moving on a clock; see {@link wouldRedraw}. */
  private drewOnClock = false
  /** Scratch for the drawing buffer's size, so a frame allocates nothing for it. */
  private readonly drawingSize = new Vector2()
  /**
   * The lines round whatever a page has pointed at, and where a layer takes a
   * slot for the colour its things wear; see {@link Outlines} for why they are
   * found here rather than in the layer that drew the things.
   */
  readonly outlines = new Outlines()
  /**
   * The land as it would be with no mask, for the things that have to hide
   * their own buried half; see `underground.ts`.
   *
   * The viewer's and not a layer's, because it answers a question about one
   * picture — what is under the ground at this pixel — and because a mask is
   * the viewer's. A layer that stands things in the land reads it as it reads
   * {@link Viewer.outlines}, when it is taken on.
   */
  readonly underground = new Underground()

  /**
   * The pictures thrown down over the map, if a page has any; see
   * `projection.ts`.
   *
   * Here for the reason the sun and the mask are here: it is one fact about
   * the scene that every surface reads for itself, not a thing one layer
   * hands to another. The picture layers put theirs on it, and it stacks them
   * in the order they went on; the city, `SolidLayer` and a page's own layer
   * take it as they are attached.
   */
  readonly projection = new Projection()
  /**
   * What one place can see, where a page has put an eye on the map; see
   * `sight.ts` and {@link Viewshed}.
   *
   * Here for the projector's reason — one fact about the scene that every
   * surface reads for itself — and for one of its own: what is read is the
   * scene drawn again from the eye, and the drawing is the viewer's. The city,
   * `SolidLayer`, the trees and a page's own layer take it as they are
   * attached (`sight.paint`).
   */
  readonly sight = new Sight()
  /**
   * @internal The land's heights where the card reads them, for the sheets
   * laid on the land to be raised by; see `landHeights.ts`.
   *
   * The viewer's, because what it holds is chosen by what is in view and two
   * sheets lie on the one land: the ground's own, and a picture a page lays
   * over it. Held once, both are raised over the same readings, and a picture
   * cannot come to lie a reading off the land it was laid on.
   */
  readonly landHeights = new LandHeights()
  /**
   * @internal The layer a page's own markup stands in, over the canvas.
   *
   * The viewer's and not a page's: it has to be exactly as big as the canvas
   * and go when the canvas goes, and a page asked to keep a div in step with a
   * canvas it does not own is a page doing the library's work. `markup` and
   * not `overlay`, since that word is a {@link Stage} here and means something
   * else.
   */
  readonly markup = document.createElement('div')
  /**
   * Where a place on the map falls on the canvas.
   *
   * For a page drawing its own markup over the city — a leader line, a
   * tooltip, a panel anchored to a building. What a page hangs on a place and
   * leaves there is an {@link Html} mark instead, which is held in step by the
   * group holding it; this is for the cases a mark cannot answer.
   */
  readonly screen: Screen

  /**
   * The canvas the map is drawn on — Mapbox's `getCanvas()`, as a property.
   * For a page measuring against it, or listening on it for a gesture of its
   * own (turning off the one it shares; see {@link dragPan}).
   *
   * The renderer that draws into it stays the viewer's (contract 1).
   */
  readonly canvas: HTMLCanvasElement

  /**
   * The ways the reader moves the map, each with a switch — Mapbox's
   * handlers, by their names: dragging moves it, the right button turns and
   * tips it, the wheel and a trackpad's pinch zoom it, two fingers zoom and
   * turn it, and two fingers moved up or down together tip it. See
   * {@link Interaction}.
   */
  readonly dragPan: Interaction
  readonly dragRotate: Interaction
  readonly scrollZoom: Interaction
  readonly touchZoomRotate: Interaction
  readonly touchPitch: Interaction
  private readonly renderer: WebGPURenderer
  private readonly layers = new Set<Layer>()
  private readonly resizeObserver: ResizeObserver
  /**
   * This viewer's one sign of life, given up when it is disposed.
   *
   * Everything that crosses a wait reads it and nothing else: the listeners
   * outside the canvas are registered with it, the renderer starting reads it
   * before carrying on, a look under the pointer reads it before answering,
   * and a layer is handed it to hang its own loading off. One signal means one
   * answer to "is this still alive", instead of a check invented afresh at
   * every await.
   */
  private readonly lifetime = new AbortController()
  /** Which layer put each of the scene's own things there, to hand back what is found under the pointer. */
  private readonly owners = new Map<Object3D, Layer>()
  /**
   * The groups kept for the things a page hands over bare, one to a kind.
   * Made by the first thing of its kind and seated like any other layer.
   */
  private readonly own = new Map<OwnGroup, Layer>()
  private readonly events = new Events<ViewerEvents>()
  /** Whether any layer was still waiting when last looked, for telling the turn. */
  private wasBusy = false
  /** Reads what lies under the pointer off the picture. */
  private readonly picking = new PickPass(this.underground)
  /** The line naming whose data is drawn, and what it said when last looked at. */
  private readonly creditsLine = new CreditsLine()
  private creditsKey = '\u0001'
  private _creditsAt: CreditsCorner
  /** Where the pointer is over the canvas and the event that said so, or null while it is off it. */
  private pointerAt: { x: number; y: number; event: PointerEvent } | null = null
  /** Whether a button is down, moving or turning the view. */
  private pressing = false
  /**
   * What the button that is down is doing: moving the map, turning the view,
   * carrying a thing, nothing to the view while it may still click
   * (`'still'`, a gesture the page turned off), or waiting on a look under a
   * finger before deciding (`'pending'`). 'none' whenever no button is down,
   * so anyone reading it outside a drag reads 'none'.
   */
  private pressMode: 'none' | 'move' | 'look' | 'carry' | 'still' | 'pending' = 'none'
  /** Whether what lies under the pointer may have changed since it was last looked at. */
  private underStale = true
  private framesSinceLook = 0
  /** Whether a look under the pointer is on its way back. */
  private looking = false
  /** The layer being told where the pointer is, so it can be told when it is not. */
  private pointedOn: Layer | null = null
  /** What the pointer is on, as last found, and whose it is. */
  private hovering: { layer: Layer; object: Object3D; item: number } | null = null
  /**
   * What the last look found, whether or not anything listened for it.
   *
   * A drag has to begin the moment the button goes down, and reading the pixel
   * under the pointer is a round trip to the card — the answer would arrive a
   * frame late, with the map already sliding. So the look the viewer is
   * already taking for the cursor is kept, and taking hold of something is
   * answered out of it. The cost is that a pointer moved and pressed inside
   * one frame takes hold of what was there a frame ago; the gain is that the
   * map never moves under a hand that meant to carry something.
   *
   * **A finger takes no look, so a finger is not answered out of this.**
   * {@link follow} leaves touch alone — there is no cursor to say anything to
   * and a finger is where the press says it is — so on a touch-only device
   * this is always null, and on a screen that has both it is the cursor's, a
   * look at a place the finger never went. A finger is looked under as it
   * presses instead ({@link lookUnderFinger}), and the press holds still
   * until the answer comes back: a frame or two, where something on the map
   * can be carried, and nothing at all where nothing can.
   */
  private under: { layer: Layer; hit: Hit } | null = null
  /** What is being carried now, and where and in what view it was taken hold of. */
  private carrying: Carried | null = null
  /** Whether what the pointer is on would answer a click, which is what the cursor says. */
  private pointing = false

  private _center: [number, number]
  private _zoom: number
  /**
   * A rectangle owed a fit, held until the canvas can say how big it is.
   *
   * The whole of Japan where no zoom was given, and whatever a page asked
   * {@link fitBounds} for before the canvas had been measured. Spent the
   * moment there is a size worth fitting to — or the moment anyone chooses
   * where to look, whichever comes first.
   *
   * Not "has the first resize happened": a viewer built in a hidden tab and
   * pointed somewhere by the page must stay where it was put when that tab is
   * finally shown. And not dropped when a page asks early, which is the
   * ordinary case — a page fits to something it fetched, and a file that
   * arrives before the stylesheet does would otherwise be fitted to a canvas
   * of one pixel, which lands at the furthest zoom out.
   */
  private pendingFit: {
    readonly bounds: MapBounds
    /** The margin kept clear, in CSS pixels; see {@link FitBoundsOptions.padding}. */
    readonly padding: number
    /** How much of what is left the rectangle takes: under one for the viewer's own first fit. */
    readonly share?: number
    /** Whether the middle stays where the page put it, the fit choosing only the zoom. */
    readonly keepCenter?: boolean
  } | null
  /** Whether the canvas has ever read back a size worth fitting to. */
  private measured = false
  /** Whether the view has moved since the page was last told; see {@link sayIfMoved}. */
  private moveOwed = false
  /**
   * The mask as the page handed it, frozen, for {@link mask} to hand back. A
   * copy and not the page's own object: one the page goes on to write into
   * would read one shape and draw another, since the shape was baked when it
   * was handed over.
   */
  private _maskGiven: Mask | null
  /** What this viewer last put behind the map, to tell it from a background the page put there; see {@link paintBackdrop}. */
  private backdrop: Color | null = null
  /** What the container's own `position` was before this set it, to put back; see {@link dispose}. */
  private placedContainer: { readonly element: HTMLElement; readonly position: string } | null = null
  /** The lights the page stood in the scene itself, found each frame; see {@link pageCasts}. */
  private readonly ownLights: Light[] = []
  /** When this frame's work began, for {@link frameLeft}. */
  private frameBegan = 0
  private _pitch: number
  private _heading: number
  private _elevation: boolean
  /** The land this viewer made. */
  private readonly _ground: Ground
  /** The city this viewer made. */
  private readonly _buildings: Buildings
  /** The layer this viewer made for the page's models. */
  private readonly _models: ModelLayer
  private _mask: Mask | null
  /** The mask in world units, worked out once when it is set rather than by everyone who reads it. */
  private _maskArea: MaskArea | null
  /**
   * How far past the screen to fetch anyway, in world units; see
   * {@link viewMargin}. Nought unless a mask asked for it.
   */
  private _fetchMargin = 0

  /**
   * Whether the sun is down, which is the only thing the dark set answers to.
   *
   * Not a mode and not a handle (2026-10-08). It was `dark`, a boolean a page
   * set, and the set it picked said of itself that it was for a dark page and
   * not for night. Now there is a real sun with a real height, and the one
   * thing the dark set is wanted for is the hour that sun makes: below the
   * horizon there is nothing to shade with, and a white house on a white sheet
   * with no shadow under it is a white rectangle. So the page stopped choosing
   * and the sun decides. Worked out beside the light, in {@link benighted}.
   */
  private night_: boolean
  private _sun: Sun | null
  /**
   * That light worked out, held rather than found again every frame.
   *
   * Null for one reason only: a page that asked for no light model at all
   * (`sun: null`). A sun under the horizon is not that — it is a sun, standing
   * where it stands, handing over nought.
   *
   * _(It used to be null for a dated midnight as well, and the reason written
   * here was that taking the angle anyway would light the city from underneath.
   * `Lights.set` closed that on 2026-10-09 by asking `angle.down` before it
   * divides the light, so a sun below the horizon hands over a colour of nought
   * whichever way it was written. What the null was still costing was the
   * direction: with nothing to read an angle off, the light fell back to
   * {@link DEFAULT_ANGLE} and a page that hung a helper on `viewer.lights.sun`
   * — which 계약 11 invites — watched it point 52° into the south-east at
   * midnight. And `benighted` had to work the angle out a second time to find
   * out what this already knew.)_
   */
  private _lit: Lit | null
  /** The corner shading's settings, which a page holds as {@link occlusion}. */
  private readonly _occlusion: OcclusionSettings
  /** The miniature look's settings, which a page holds as {@link tiltShift}. */
  private readonly _tiltShift: TiltShiftSettings
  /** How things come and go, which a page holds as {@link appear}. */
  private readonly _appear: AppearSettings
  /** What a page draws over the finished frame; see {@link FramePass}. */
  private _effects: readonly FramePass[] = []
  /** Whatever is moving the view of its own accord, or null. */
  private moving: ViewMotion | null = null
  /** Darkens where faces meet, over the finished picture. Turned off, it is never made. */
  private occlusionPass: OcclusionPass | null = null
  /** Blurs the finished picture away from its focus. Off by default, and then never made. */
  private tiltShiftPass: TiltShiftPass | null = null
  /**
   * The colours given by name, which come before the theme's.
   *
   * Held as the page said them rather than as the palette now reads them: a
   * {@link ThemeColor} pair is two colours and which of them stands is a
   * question for {@link applyPalette}, asked again every time the sun crosses.
   */
  private overrides: Partial<Record<ColorName, ThemeColor>>
  private palette: Palette

  private readonly scratch = new Vector3()
  /**
   * How high the land is under the middle of the view, in world units, as far
   * as the tiles in hand can say. Nought while the land is drawn flat.
   *
   * The camera looks at this rather than at sea level, and so does the sun;
   * see {@link followLand}.
   */
  private landHere = 0
  private width = 1
  private height = 1
  /** Whether the frames are running: there is a device and the loop is on. */
  private drawing = false
  /** When the last frame went out, on `performance.now()`'s clock in seconds. */
  private drawnAt = 0
  /**
   * Settles once the renderer has its device and the frames are running, and
   * rejects where it never can — on a browser without WebGPU, usually.
   *
   * The viewer's own, and not a page's. Two things here wait on the device
   * before they may touch it ({@link weave}, {@link takes}) and the teardown
   * chains onto it, and that is the whole of what it is for. A page hears the
   * failure as `on('error')` with `what: 'start'`; see {@link
   * ViewerEvents.error} for why it is not handed one of these to await.
   */
  private readonly starting: Promise<void>
  /** Whether the renderer got its device. Only then is there anything to give back. */
  private started = false

  /**
   * Whether this viewer has been disposed. Everything it holds is gone and
   * nothing it is asked for will happen.
   */
  get disposed(): boolean {
    return this.lifetime.signal.aborted
  }

  /**
   * Given up when this viewer is disposed.
   *
   * A layer is welcome to hang its own loading off this — pass it to `fetch`,
   * or make a controller of its own that follows it — so that what is on its
   * way stops when the viewer goes rather than landing on a dead scene.
   */
  get signal(): AbortSignal {
    return this.lifetime.signal
  }

  /** Which backend the renderer actually ended up on. `'unknown'` until it has started. */
  /** A say over every request the library makes; see {@link ViewerOptions.transformRequest}. */
  get transformRequest(): TransformRequest | undefined {
    return this._transformRequest
  }

  set transformRequest(value: TransformRequest | undefined) {
    this._transformRequest = value
  }

  private _transformRequest: TransformRequest | undefined

  /**
   * @internal How every layer of this viewer fetches: through the page's
   * {@link transformRequest}, read at the moment of asking so that one written
   * afterwards holds from the next request on.
   */
  readonly request: Ask = (url, kind, init) => askThrough(this._transformRequest)(url, kind, init)

  get backend(): 'WebGPU' | 'WebGL2' | 'unknown' {
    return this._backend
  }
  private _backend: 'WebGPU' | 'WebGL2' | 'unknown' = 'unknown'

  constructor(options: ViewerOptions) {
    // Neither the buildings nor the green know what to fetch until the city
    // boundaries are in, so they are asked for while the renderer starts. A
    // failure is not reported here: the layers asking later will ask again.
    //
    // Only where something is going to draw from them. A map with the land
    // and the city both off is a page drawing its own, and it was sending a
    // megabyte and more to PLATEAU on its first breath for nothing. A layer
    // turned on later asks for itself, as it would after a failure.
    const ground = options.ground
    const drawsGreen =
      ground?.visible !== false && (ground?.green?.visible !== false || ground?.trees?.visible !== false)
    this._transformRequest = options.transformRequest
    this.dragPan = new Interaction(options.dragPan?.enabled ?? true)
    this.dragRotate = new Interaction(options.dragRotate?.enabled ?? true)
    this.scrollZoom = new Interaction(options.scrollZoom?.enabled ?? true)
    this.touchZoomRotate = new Interaction(options.touchZoomRotate?.enabled ?? true)
    this.touchPitch = new Interaction(options.touchPitch?.enabled ?? true)
    if (options.pixelRatio !== undefined && Number.isFinite(options.pixelRatio) && options.pixelRatio > 0) {
      this._pixelRatio = options.pixelRatio
    }
    if (drawsGreen || options.buildings?.visible !== false) plateauCities(this.request).catch(() => undefined)

    // Held to the same limits as every other write (contract 3), and a value
    // that is not a number is no value: the default stands in for it, as it
    // would for one left out
    const given = (value: number | undefined) =>
      value !== undefined && Number.isFinite(value) ? value : undefined
    const centre = options.center?.every(Number.isFinite) ? options.center : undefined
    const zoom = given(options.zoom)
    this._center = centre
      ? [centre[0], centre[1]]
      : [(JAPAN.southWest[0] + JAPAN.northEast[0]) / 2, (JAPAN.southWest[1] + JAPAN.northEast[1]) / 2]
    this.limit(options.minZoom ?? MIN_ZOOM, options.maxZoom ?? MAX_ZOOM, options.maxPitch ?? MAX_PITCH, false)
    this._zoom = this.clampZoom(zoom ?? 4)
    // No zoom is Japan's, but a middle given is the page's: the fit then only
    // chooses how far out to stand, and stands there
    this.pendingFit =
      zoom === undefined ? { bounds: JAPAN, padding: 0, share: 0.9, keepCenter: centre !== undefined } : null
    this._pitch = this.clampPitch(given(options.pitch) ?? 0)
    this._heading = wrapHeading(given(options.heading) ?? 0)
    this._elevation = options.ground?.elevation ?? false
    this._mask = options.mask ?? null
    this._maskGiven = frozenMask(this._mask)
    this._maskArea = maskArea(this._mask, this.maskView)
    this._fetchMargin = this.marginOf(this._mask)
    this.picking.setMask(this._maskArea)

    this.overrides = paletteOf(options.theme)
    // What the shaders read is set as this is made, from what was given or
    // the default. A pace changed afterwards is told to every layer, since
    // each holds deadlines it took from the old one (see `Change`'s
    // 'appear'), and to the sun's map, since what it sees has just moved
    this._appear = new AppearSettings(options.appear, () => {
      for (const layer of this.layers) layer.changed?.('appear')
      this.stirShadows()
    })
    // The default is copied like a page's own now that it carries a moment: it
    // is one object shared by every viewer that took it, and a page winding its
    // `at` forward would move the sun in all of them
    this._sun = options.sun === undefined ? heldSun(DEFAULT_SUN) : options.sun && heldSun(options.sun)
    this._lit = this.litNow()
    // The sun before the colours, since the colours are now read off it. Not
    // through `applyPalette` either: that hands the set to the layers, the
    // shading and the credits, and none of them is standing yet
    this.night_ = this.benighted
    this.palette = Object.freeze(this.paletteNow())
    // Before any layer goes on, since anything that calls `syncOcclusion` reads it
    this._occlusion = new OcclusionSettings(options.occlusion, () => this.syncOcclusion())
    this._tiltShift = new TiltShiftSettings(options.tiltShift, () => this.syncTiltShift())
    this._effects = options.effects ? [...options.effects] : []
    this.tellTheLight()
    // The light, in before the first weave and before any layer is seated:
    // which lights a scene holds is part of every material's shader, so one
    // arriving later is every material woven again at about a second each.
    // See `lights.ts`.
    this.scene.add(this.lights.root)

    const container = elementOf(options.container)

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
    container.appendChild(this.canvas)

    // Where a page's own markup stands over the map; see `Html`. It lets every
    // pointer through, or the map could not be dragged under it — what a page
    // puts in it takes its own back, which is what makes a button a button.
    //
    // Laid over the canvas exactly, not over the container: a mark is seated
    // in the canvas's pixels, and the container's padding is not the canvas.
    // Laid over the container, every card stood the padding up and to the
    // left of its place. Put right with each size the canvas reads back.
    this.markup.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none'
    container.appendChild(this.markup)

    // The line stands in the corner of the container, which has to be
    // something to stand in the corner of. A container the page has already
    // placed is left as it is.
    if (getComputedStyle(container).position === 'static') {
      this.placedContainer = { element: container, position: container.style.position }
      container.style.position = 'relative'
    }
    this._creditsAt = options.creditsAt ?? DEFAULT_CREDITS_CORNER
    this.creditsLine.at(this._creditsAt)
    this.creditsLine.colour(this.palette)
    container.appendChild(this.creditsLine.element)

    this.paintBackdrop()
    this.screen = new Screen(
      this.threeCamera,
      () => ({ ...this.canvasSize, worldWidth: this.viewWidth, lat: this._center[1]! }),
      () => ({
        // Asked for afresh rather than kept: a page may add its buildings
        // after whatever is asking, and a layer added later is one this would
        // never find if it had looked the once
        city: this.onBuildings,
        land: this._elevation ? heightsInHand() : null,
      }),
    )

    // The picture shows what the shadows and the shading of corners leave out
    this.threeCamera.layers.enable(PICTURE_ONLY)

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      stencil: true,
      // Left out, three takes WebGPU where it is there; see
      // {@link ViewerOptions.backend}
      ...(options.backend === 'WebGL2' && { forceWebGL: true }),
    })
    // The frame is lit, so it has no ceiling, and a curve is what a renderer
    // has instead of one. It costs no extra pass: the frame already goes
    // through a buffer of three's for the output colour space, and the curve
    // rides the same quad. What it costs instead is that nothing drawn is
    // exempt from it — see `tone.ts` and everything that calls
    // `beforeTheCurve`.
    this.renderer.toneMapping = TONE_CURVE
    // Three's gate on shadows as a whole, which makes it the gate on this map
    // too. The sun casts — `SunShadow` turns `light.castShadow` on where it is
    // made (`shadows.ts`) — and with this off `AnalyticLightNode.setupShadow`
    // returns on its first line, so `sun.shadow.shadowNode` is never woven into
    // a material at all. The viewer would go on aiming and drawing the map
    // every frame and nothing would read it: no shadow anywhere, and not a line
    // in the console. A page's own light turning `castShadow` on rides the same
    // gate and gets three's ordinary map, without reaching for a renderer it is
    // not handed (contract 10). Read off three's source, not measured on screen.
    this.renderer.shadowMap.enabled = true
    // A size before the device is asked for, because the canvas has none until
    // its stylesheet lands and three takes the swapchain from whatever is
    // there. Nought is not a size a swapchain can be, and asked for one the
    // backend refuses every texture it is then asked to make — hundreds of
    // them, for as long as the layout takes. One pixel is a size, and the
    // first resize puts it right.
    this.renderer.setSize(1, 1, false)
    this.renderer.setPixelRatio(this.ratioNow())
    // Three's own default, written out because this file said the opposite
    // until 2026-10-06 and anyone reading the ordering has to be able to find
    // where it is settled. Sorting is what reads `renderOrder` at all — three
    // looks at it nowhere else — so leaving it off was what made a page's own
    // number a dead letter. What the sorter does with a tie is distance, and
    // the things laid on the land are at one distance: every one of them
    // carries a number of its own so that no tie is left to break. See
    // `order.ts`.
    this.renderer.sortObjects = true

    // The canvas, not the container it sits in. The canvas fills the
    // container's content box, so a container with padding or a border is
    // larger than what is drawn — and the pointer is read against the canvas.
    // Measured against the container, a padded one would draw at the wrong
    // size and every click would land a little off.
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.canvas)
    this.bindPointer()

    // Last, with everything it draws with in hand. Asking the browser for a
    // device is the one thing a constructor cannot wait for, and it is the
    // only reason a viewer would not start — so it starts here and says how
    // it went, rather than leaving every page to remember a call whose whole
    // purpose was to be somewhere for that to land. A map library starts when
    // it is made; so does this.
    this.starting = this.begin()
    this.starting.catch((cause: unknown) => {
      if (this.events.has('error')) this.events.emit('error', { what: 'start', cause })
      else console.error('Viewer could not start', cause)
    })

    // What a page asked to be drawn, put on last. Everything a layer is handed
    // on the way on is in hand well before here — the palette, where the view
    // is, the shape it is cut to — so this is last only because of what
    // happens when one of them refuses.
    //
    // Anything already taken refuses to go on twice: a layer on another
    // viewer, a mark or a line or a model already in a page's own group. It is
    // found partway down the list, after its neighbours are seated, and a page
    // that wrote the lot in one place gets no viewer back to put that right —
    // a constructor that throws hands back nothing to dispose. So what landed
    // comes off again, the viewer takes itself down, and the refusal is all
    // the page is left with. That is the one thing it can act on.
    //
    // The land and the city go on first. That used to be what left them at the
    // head of their stages, when `seat` spliced them into `scene.children`;
    // now `seat` writes a stage and nothing more, and what shows over what
    // inside one stage is the number each thing carries. What still leans on
    // this order is that number: `OVER_THE_GROUND` is picked as the first past
    // everything the ground draws, so a sheet laid over the land is over the
    // land this viewer made. See `order.ts`. A page that wants its own there
    // instead says `ground: { visible: false }` and hands one over below.
    this._ground = new Ground(options.ground ?? {})
    this._buildings = new Buildings(options.buildings ?? {})
    this._models = new ModelLayer(options.models ?? {})
    // The viewer's own three go on outside the guard below, because they
    // cannot be refused: `add` turns away a layer already seated or already on
    // another viewer, and these were made one line ago. Which leaves `landed`
    // holding only what the page handed over — exactly what the rollback is
    // for, and what it has always said it was for.
    for (const own of [this._ground, this._buildings, this._models]) this.add(own)
    const landed: (Layer | Held)[] = []
    try {
      for (const thing of options.layers ?? []) {
        this.add(thing)
        landed.push(thing)
      }
    } catch (refused) {
      // The page's own things go back as they were made; the canvas, the
      // credits line, the observer and the listeners are the viewer's and go
      // down with it — and so are the three above, which `remove` would turn
      // away and `dispose` takes instead.
      for (const thing of landed.reverse()) this.remove(thing)
      this.dispose()
      throw refused
    }
  }

  private async begin(): Promise<void> {
    await this.renderer.init()
    this.started = true
    // Disposed while the device was being asked for: whoever disposed is
    // waiting on this promise to tear the renderer down, and none of what
    // follows would have anything left to run on
    if (this.disposed) return
    this._backend = 'isWebGPUBackend' in this.renderer.backend ? 'WebGPU' : 'WebGL2'
    this.drawing = true
    this.syncOcclusion()
    // Made here for a viewer made with it on, as the shading is: the settings
    // only tell of a change
    this.syncTiltShift()
    this.resize()
    // Whatever the page handed over on the way in, woven before the first
    // frame rather than inside it. A page that gave the constructor its models
    // has them in the scene already; a layer that fetches has nothing here
    // yet and weaves its own as it lands. See {@link weave}.
    await this.weave(this.scene)
    if (this.disposed) return
    // The passes the viewer runs over the picture, woven as well before the
    // first frame rather than inside it; see `OcclusionPass.weave`. From the
    // same moment one made later weaves itself as it is made, so that none
    // falls between the two: the flag was set once these were done, and a
    // pass made while they wove was never woven (reviewed 2026-11-17)
    this.passesWeave = true
    this.weavePass(this.occlusionPass)
    this.weavePass(this.tiltShiftPass)
    await Promise.all(this.passesWeaving.values())
    if (this.disposed) return
    this.framesBegun = true
    this.renderer.setAnimationLoop(() => {
      this.frameBegan = performance.now()
      // The sun's map has its own texture made here, before any material has
      // sampled it; see {@link SunShadow.prime}. Once, and it draws nothing
      if (!this.shadowPrimed) {
        this.shadowPrimed = true
        this.shadows.prime(this.renderer)
      }
      // The view settles first, so that the layers choose the tiles that suit it
      this.stepView()
      const time = performance.now() / 1000
      // One clock for everything on its way in or out, brought up once here
      // so the buildings of a tile and the park they stand in keep step
      tickAppear(time)
      // Then whatever the page moves itself, before the layers read the scene
      const delta = this.drawnAt === 0 ? 0 : Math.min(time - this.drawnAt, LONGEST_FRAME)
      this.drawnAt = time
      if (this.events.has('frame')) this.events.emit('frame', { delta, time })
      // After the page's own frame, so a view it moved there is told this frame
      this.sayIfMoved()
      // Moving a window to another display changes the pixel ratio without
      // changing the size, so watching the size cannot tell. The event that
      // would say so is missed while the window is hidden, so it is compared
      // every frame
      if (this.ratioNow() !== this.renderer.getPixelRatio()) this.resize()
      // The heights the card raises the land by, chosen for the view as it now
      // stands and before any layer lays a sheet on them
      this.landHeights.update({
        on: this._elevation,
        zoom: this._zoom,
        bounds: this.visibleBounds,
        signal: this.signal,
        ask: this.request,
      })
      for (const layer of this.layers) layer.frame?.(delta, time)
      // After their frame, so a layer that took the last piece this very frame
      // is already done when it is asked
      this.sayIfLanded()
      // Once the layers have had their say about the land, since it is where
      // they have put it that the camera and the sun must be aimed
      this.followLand()
      // The pictures thrown over the map, stacked into one where more than one
      // lands on a side — after the layers' frames, which is where a window of
      // tiles moves, and before anything that wears them is drawn. A render of
      // its own between the others, never inside one, and none at all on a
      // frame where no picture changed; see `projection.ts`
      const composed = this.projection.compose(this.renderer)
      // What an eye on the map can see, drawn again where it no longer holds:
      // after the layers' frames, which is where an eye on a building is seated,
      // and before anything that wears it is drawn. Inside a stand-down for the
      // sun's reason below — six eyes with no canvas under them
      let busy = false
      for (const layer of this.layers) if (layer.busy?.() ?? false) busy = true
      let sighted = false
      if (this.sight.wanted) {
        // A page moving things on its own clock, or holding meshes of its own
        // in the scene, moves them where nothing tells the cube — the sun's map
        // asks the same two questions below. Drawn again for them, kept to
        // `SETTLE` apart by the sight itself
        if (this.events.has('frame') || this.pageStands()) this.sight.stir()
        sighted = this.underground.standDown(() => this.sight.draw(this.renderer, this.scene, busy, time))
      }
      const tallest = this.tallest()
      const ownCast = this.pageCasts()
      // With nothing standing there are no shadows and no corners for shading:
      // flat ground casts nothing on itself, and the corner shading would leave
      // only a faint stain over it
      const standing = tallest > 0 || ownCast
      // What the sun can see, before the picture that reads it. With no sun or
      // nothing standing the map would hold at most the ground, which shadows
      // nothing, so it is neither drawn nor read
      const casting = this._lit !== null && !this._lit.angle.down && standing
      this.shadows.casts = casting
      // Inside a stand-down: the sun's eye has no canvas under it, and the
      // mask the city carries
      // reads the canvas land through `screenUV`. Left standing, the city's
      // own fragments are tested against the land's depth at whatever place
      // of the sun's 2048² map their screen coordinate happens to fall.
      // `Underground.standDown` names this one outright — "a shadow cast by a
      // wall that should be under a hill" is the first of the four it gives up.
      const cast = casting && this.underground.standDown(() => this.castShadows(tallest, ownCast))
      if (this.wouldRedraw(busy || composed || sighted || cast)) {
        // The land on its own, before the picture that reads it. Only where a
        // mask has ended the land: with none, the land in the picture hides
        // what is under it by itself, as it always did
        this.underground.render(this.renderer, this.scene, this.threeCamera, this._maskArea !== null)
        this.draw(standing)
      }
      this.gatherCredits()
      // Off the scene as it now stands; the answer is for a later frame
      this.lookUnderPointer()
    })
  }

  /**
   * Draws the frame: the scene, the corner shading over it, and last what is
   * in the picture but not of the city.
   *
   * The shading is multiplied over the finished picture rather than worked
   * into it, so the antialiasing survives. That multiplication is why the last
   * of the drawings is on its own. Marks, outlines and the lines painted on the
   * land are all on {@link PICTURE_ONLY}, which is already kept out of the
   * depth the shading is measured from — so the shading has no reading of its
   * own where one of them stands, and multiplying over it would darken a white
   * plate by however much the building behind it is in shade. A price over a
   * roof came out with that roof's corners printed on it.
   *
   * So they are drawn after it. What the layer is named for is exactly this:
   * in the picture, and no part of what the picture is shaded by.
   *
   * **A solid thing a page said closes in no corner is held back the same way,
   * for the same reason** (`setOccludes`). The shading is measured without it,
   * so multiplied over it the shading would print on it the corners of
   * whatever stands behind. It is drawn after the shading and before the lines
   * — it is a thing in the city, so the line round it, or round a building
   * behind it, goes over it as a line goes over the city. It is not on a layer
   * of its own the camera could leave out: it keeps layer 0 so that the sun,
   * the lines, the pointer and a page's `Raycaster` all still see it, and so
   * the first drawing asks each object instead ({@link drawWhere}). The
   * drawing between is made only where the first held something back.
   *
   * With nothing standing there is no shading to multiply, and the scene goes
   * down in one pass as it always did — and the same where something stands
   * but the shading would draw nothing anyway. Something standing and the
   * shading showing are two different questions: what stands is judged by
   * how far the land rises on screen, and the shading by how many texels its
   * radius spans, so there is a whole band of zooms over open relief where
   * the first says yes and the second says no. Asked, rather than assumed.
   */
  private draw(standing: boolean): void {
    const occlusion = this.drawable(this.occlusionPass)
    occlusion?.reckon(this.renderer, this.threeCamera)
    const shading = standing && occlusion?.shows ? occlusion : null
    const blurring = this.reckonTiltShift()
    if (!shading && !blurring) {
      void this.renderer.render(this.scene, this.threeCamera)
      this.outlines.draw(this.renderer, this.scene, this.threeCamera)
      this.drawEffects()
      return
    }

    // The camera's layers and the renderer's clearing are both set aside part
    // way through, and both are the viewer's for the rest of its life: a throw
    // between here and the end would leave the camera seeing only
    // PICTURE_ONLY, or everything but it, and every later frame painting over
    // a canvas nothing had cleared. Read before the try so the undoing has
    // them whichever of the passes fails. The function each object is drawn
    // through is the third such thing, and `drawWhere` puts its own back.
    const layers = this.threeCamera.layers.mask
    const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } = this.renderer
    const keep = (): void => {
      this.renderer.autoClear = false
      this.renderer.autoClearColor = false
      this.renderer.autoClearDepth = false
      this.renderer.autoClearStencil = false
    }
    const unkeep = (): void => {
      this.renderer.autoClear = autoClear
      this.renderer.autoClearColor = autoClearColor
      this.renderer.autoClearDepth = autoClearDepth
      this.renderer.autoClearStencil = autoClearStencil
    }
    try {
      this.threeCamera.layers.disable(PICTURE_ONLY)
      if (shading) {
        const heldBack = this.drawWhere(true)
        this.threeCamera.layers.mask = layers

        // Stood down for the pass's own eye, as the sun's map is: the
        // depth it takes is drawn with `wider` into a sheet bigger than the
        // canvas, so the city's mask would read the canvas land at
        // `inset + u * shown` — a band of the picture tested against the ground
        // a sixth of a screen away. The multiply over the picture reads no land.
        this.underground.standDown(() => shading.render(this.renderer, this.scene, this.threeCamera))

        // What the first drawing held back, over the shaded picture: under the
        // same camera as that drawing, so it is the same scene walk with the
        // same lights in it and every material keeps the shader it was woven
        // with. Kept rather than cleared, as the marks' drawing below is, so it
        // hides and is hidden by the depth the city left.
        if (heldBack) {
          keep()
          this.threeCamera.layers.disable(PICTURE_ONLY)
          this.drawWhere(false)
          this.threeCamera.layers.mask = layers
          // The lines take their own picture with the clearing as the viewer
          // keeps it — that target is cleared as it is drawn into
          unkeep()
        }
      } else {
        // Unshaded, and only here because of the blur: everything solid in one
        // drawing, as the plain frame draws it, and what is laid over it after
        void this.renderer.render(this.scene, this.threeCamera)
        this.threeCamera.layers.mask = layers
      }

      if (blurring) {
        // What is laid over the picture and is part of the map — a painted
        // shape, the lines along the folds — goes under the blur with the map.
        // The marks do not, and nor does the line round what a page pointed
        // at: both are there to be read and found, and blurred they are not
        keep()
        this.drawLaidOver(PICTURE_ONLY, false)
        unkeep()
        blurring.render(this.renderer, this.scene, this.threeCamera)
        this.outlines.draw(this.renderer, this.scene, this.threeCamera)
        keep()
        this.drawLaidOver(MARKS, true)
      } else {
        // Over the shaded picture and under what is drawn on top of it: a line
        // round a building is a fact about the city, so it takes the city's shade
        // — and a mark hung over the city stands in front of the line, as it does
        // in front of the building the line is round.
        this.outlines.draw(this.renderer, this.scene, this.threeCamera)

        // Over what is now on the canvas, depth and stencil and all: kept, so a
        // mark told to hide behind the city still does, and so does the mark the
        // land left saying which pixels are ground. Letting the stencil go was
        // what made a shape asked to paint the ground alone paint nothing: it is
        // written in the first drawing and read in this one.
        keep()
        this.drawLaidOver(PICTURE_ONLY, true)
      }
    } finally {
      this.threeCamera.layers.mask = layers
      unkeep()
    }
    // Outside the undoing: a page's pass is handed the renderer as the viewer
    // keeps it, not as the middle of the frame left it — the camera's layers
    // above all, which the last render had narrowed. The clearing is the one
    // thing it is handed otherwise, and `drawEffects` says why.
    this.drawEffects()
  }

  /**
   * Draws what is laid over the finished picture — the camera narrowed to one
   * layer — over what is on the canvas, with the clearing as the caller left
   * it. Given `marks: false`, the marks are passed over (`MARKS`); they are on
   * the layer too.
   *
   * Three gathers only the lights the camera can see, so a light the page
   * stood in the scene its own way — on layer 0, as every light is made — was
   * not gathered here: what is drawn over the shading and is lit (a shape
   * raised off the ground, one left to `'dim'`) took the page's light with the
   * shading off and lost it with the shading on. Opened to this one render and
   * closed again, so the page's light is as the page left it.
   */
  private drawLaidOver(layer: number, marks: boolean): void {
    const layers = this.threeCamera.layers.mask
    this.threeCamera.layers.set(layer)
    const opened = this.ownLights.filter((light) => !light.layers.isEnabled(layer))
    for (const light of opened) light.layers.enable(layer)
    const renderer = this.renderer
    const drawObject = renderer.getRenderObjectFunction()
    if (!marks) {
      renderer.setRenderObjectFunction(
        (object, scene, camera, geometry, material, group, lights, clipping, pass) => {
          if (object.layers.isEnabled(MARKS)) return
          renderer.renderObject(object, scene, camera, geometry, material, group, lights, clipping, pass)
        },
      )
    }
    try {
      void renderer.render(this.scene, this.threeCamera)
    } finally {
      renderer.setRenderObjectFunction(drawObject)
      for (const light of opened) light.layers.disable(layer)
      // Put back here and not left to the frame's end: a pass that draws after
      // this through the same camera (the blur's own depth) would see one layer
      this.threeCamera.layers.mask = layers
    }
  }

  /**
   * Draws the scene through the viewer's camera, but only the things that
   * close in a corner — or, given `false`, only the things that do not — and
   * says whether it passed over any.
   *
   * Asked of each object as it is drawn rather than said with the camera's
   * layers, because a camera lets a thing through for sharing any one layer
   * with it, and the things passed over here are on layer 0 on purpose; see
   * `setOccludes`. What three hands this is what survived its own walk — the
   * camera's layers and its frustum — so "passed over any" is "there is one on
   * screen", and the drawing that would take them up is spared where there is
   * none.
   */
  private drawWhere(occluding: boolean): boolean {
    const renderer = this.renderer
    const drawObject = renderer.getRenderObjectFunction()
    let passed = false
    renderer.setRenderObjectFunction(
      (object, scene, camera, geometry, material, group, lights, clipping, pass) => {
        if (occludes(object) !== occluding) {
          passed = true
          return
        }
        renderer.renderObject(object, scene, camera, geometry, material, group, lights, clipping, pass)
      },
    )
    try {
      void renderer.render(this.scene, this.threeCamera)
    } finally {
      renderer.setRenderObjectFunction(drawObject)
    }
    return passed
  }

  /**
   * Whatever the page draws over the finished frame, in the order it handed
   * them over; see {@link FramePass}.
   *
   * One pass throwing does not take the others with it, and does not take the
   * frame: the picture is already on the canvas, and a page whose effect fails
   * should see the city rather than a loop that stopped. Said once a pass, the
   * way a layer's failure is said, so a page can find which of them it was.
   *
   * **With the clearing off, which is what makes the finished picture be
   * there.** Three's default is to clear, and the curve puts every render
   * aimed at the canvas through one shared frame buffer first
   * (`needsFrameBufferTarget` is true for any tone mapping at all, so
   * `_renderScene` takes `_getFrameBufferTarget()` and `_renderOutput` blits
   * it over the canvas afterwards). So a pass that called `renderer.render` or
   * drew a quad with the clearing left on would have `Background.update` clear
   * that buffer to the clear colour, draw its own content into an empty one,
   * and the blit would replace the canvas with it — the city, the shading, the
   * lines and the marks gone, and the depth and the stencil {@link FramePass}
   * says are there gone with them. Only three's own `RenderPipeline` escapes
   * it, and only by accident: it sets `NoToneMapping` for the length of its
   * call, which turns the shared buffer off, and its quad covers every pixel.
   *
   * Undone after, as `occlusion.ts` and `outlines.ts` each undo it privately:
   * what a page is handed is the renderer as the viewer keeps it.
   */
  private drawEffects(): void {
    if (this._effects.length === 0) return
    const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } = this.renderer
    try {
      this.renderer.autoClear = false
      this.renderer.autoClearColor = false
      this.renderer.autoClearDepth = false
      this.renderer.autoClearStencil = false
      for (const effect of this._effects) {
        try {
          effect.draw(this.renderer, this.scene, this.threeCamera)
        } catch (cause: unknown) {
          if (this.events.has('error')) this.events.emit('error', { what: 'effect', effect, cause })
          else console.error('A frame pass threw', cause)
        }
      }
    } finally {
      this.renderer.autoClear = autoClear
      this.renderer.autoClearColor = autoClearColor
      this.renderer.autoClearDepth = autoClearDepth
      this.renderer.autoClearStencil = autoClearStencil
    }
  }

  /**
   * Says that what the sun would see has changed, so its map is drawn again.
   *
   * **The map is the city drawn once more.** Where the view is still and
   * nothing in it moves, the map the sun holds is the map it would draw, and
   * drawing it again is a whole pass spent on the picture it already has. So
   * {@link castShadows} keeps it, and this is how it is told not to.
   *
   * Said by whatever moved — and by the thing that moved it, not by a watcher.
   * Most of what moves in this scene moves **in the shader**, off a clock the
   * viewer brings up: a building on its way out of the ground, a motion, a
   * crowd's wave, the wood going under a park. None of them touch a matrix, so
   * nothing walking the scene could tell. `Buildings.frame` and `Ground.frame`
   * say it for those; a solid says it when it is moved; a page's own layer
   * says it for whatever it stands.
   *
   * Four things are caught without anyone saying so, and need not: the sun's
   * aim moving (compared, number for number), a layer still waiting on
   * something ({@link Layer.busy}), a page holding `on('frame')` — a page
   * handed every frame may be moving meshes of its own, which nothing here can
   * see, so such a page keeps the map drawn every frame as it always was —
   * and a mesh of the page's own in the scene that casts, for the same
   * reason. A page's layer is not the page: what it stands, it says.
   *
   * Saying it when nothing moved costs one pass. Not saying it when something
   * did leaves a shadow where the thing used to be, so when in doubt, say it.
   */
  stirShadows(): void {
    this.shadowDrawnFor = null
    // What moves where the sun's map cannot see it moves where the comparing
    // cannot either (`repaint.ts`), so the picture is drawn again with it
    this.repaintAsked = true
    // What moves the sun's map moves what an eye on the map can see, the same
    // way and for the same reason: it moves in the shader, out of anyone's sight
    this.sight.stir()
  }

  /**
   * Draws the map on the next frame whatever else is or is not changing.
   *
   * The map is drawn only when something in it changes (Mapbox's
   * `triggerRepaint`, which this is named for, says the same). What the
   * library changes, and what a page changes on the three objects it put in
   * the scene itself, is found by comparing (`repaint.ts`), and a page that has
   * taken `frame` or holds meshes of its own in the scene has the map drawn
   * every frame as it always was. What is left is a page that changes, through
   * three, something of the library's that is not compared: a value of its own
   * in a material it handed over, say. That page calls this once after the
   * change, or once a frame while it is changing.
   */
  triggerRepaint(): void {
    this.repaintAsked = true
  }

  /**
   * Whether this frame is to be drawn: something said so, or something drawn
   * differs from the last frame that was compared.
   *
   * @param drawnBesides what the frame has already found to draw for: tiles on
   *   their way, a picture over the walls stacked again, an eye's or the sun's
   *   view drawn again
   */
  private wouldRedraw(drawnBesides: boolean): boolean {
    const asked = this.repaintAsked
    this.repaintAsked = false
    // Things moving on a clock of their own say so while they move, and the
    // last frame they say it in is short of where they end by up to a frame:
    // a wave that has just crossed reads its last step, then nothing. One
    // frame more after they stop puts the end on the canvas
    const onClock = asked || stillArriving()
    const after = this.drewOnClock && !onClock
    this.drewOnClock = onClock
    if (
      onClock ||
      after ||
      drawnBesides ||
      // A page handed every frame, or holding meshes of its own, may change
      // them on a clock of its own; its passes may too
      this.events.has('frame') ||
      this.pageStands() ||
      this._effects.length > 0
    ) {
      return true
    }
    // Compared only on a frame nothing else has already answered for: the
    // comparing is a walk of the scene and of every watched value (0.4 to
    // 0.9 ms a frame, measured), and while a frame is drawn anyway it buys
    // nothing. What it holds is then some frames old, so the first frame
    // after finds them changed and is drawn once more, which is the frame
    // that would have been drawn anyway
    const size = this.renderer.getDrawingBufferSize(this.drawingSize)
    const sceneChanged = this.sceneState.changed(this.scene, this.threeCamera, size.x, size.y)
    const seen = uniformChanges()
    const uniformsChanged = seen !== this.uniformsSeen
    this.uniformsSeen = seen
    return sceneChanged || uniformsChanged
  }


  /**
   * Takes in no more through the sun's eye than is in view: the tighter it is
   * held, the sharper the shadow.
   *
   * What is in view is not only the ground. Under a tilt a high roof stands
   * further up the screen than its own footprint, so the footprint of a roof on
   * screen lies off screen, towards the camera. And where that roof falls in
   * the sun's view is where its shadow lands, away from the sun. So the circle
   * is stretched both ways by the height of the tallest thing; without that, a
   * roof reads off the edge of the map and goes wholly into shade and out again
   * as the zoom or the view moves.
   */
  private castShadows(tallest: number, ownCast: boolean): boolean {
    const light = this._lit
    if (!light) return false
    /*
     * A knob on the shadow that changed the *shape* of its shader — which is
     * only ever how many readings a spread is made of — is not in the picture
     * until every render object is built again, and what three keys that on is
     * the renderer's own context node: its version goes into every object's
     * cache key (`RenderObject.getDynamicCacheKey`), and an object whose key no
     * longer matches is thrown away and made afresh. Nothing else reaches it —
     * a node's own version does not travel into the lights' key — so the shadow
     * says that its shape moved and this says to whom. The map is drawn again
     * with it, since the new one holds nothing.
     */
    if (this.shadowShape !== this.shadows.shape) {
      this.shadowShape = this.shadows.shape
      this.renderer.contextNode.needsUpdate = true
      this.stirShadows()
    }
    // What the light has to see is what is drawn: the circle the view reaches
    // over, and, where the scene is cut, no more of it than the cut keeps.
    // Nothing outside the mask is drawn or lit, so a map spent there is a map
    // not spent on the city
    const cut = this._maskArea ? maskCircle(this._maskArea) : null
    const view = { x: lonToX(this._center[0]), z: -latToY(this._center[1]), radius: this.viewReach }
    const lit = cut && cut.radius < view.radius ? cut : view
    const perMetre = 1 / metersPerUnit(this._center[1])
    const toSun = directionOfSun(light.angle)
    const centre = new Vector3(lit.x, this.landHere, lit.z)

    let margin = 0
    const rise = Math.max(tallest, 0) * perMetre
    if (rise > 0) {
      // Per unit of height: how far the point seen at the same place on screen
      // moves towards the camera, and how far its shadow runs away from the sun
      const pitch = (this._pitch * Math.PI) / 180
      const heading = (this._heading * Math.PI) / 180
      const lean = Math.tan(pitch)
      const up = Math.max(toSun.y, LOWEST_SUN)
      centre.x += ((lean * Math.sin(heading) - toSun.x / up) * rise) / 2
      centre.z += ((lean * Math.cos(heading) - toSun.z / up) * rise) / 2
      // Widened by the same amount however the two overlap. A width that
      // changed as the view turned would set the shadow edges crawling
      margin = ((lean + Math.hypot(toSun.x, toSun.z) / up) * rise) / 2
    }
    // Far enough back to hold whatever could cast into the view. The tallest
    // building there is settles that where the ground is flat; where the land
    // has its heights, a mountain is several times it
    const reach = reachingTo(lit.radius + margin)
    const height = Math.max(TALLEST, tallest) * perMetre
    // Aimed every frame however the drawing goes: the aiming is a matrix and a
    // few numbers, and what the shader reads has to agree with what the map
    // holds whether or not it was drawn again
    this.shadows.aim(centre, reach, toSun, height)
    if (this.shadowsWouldDiffer(centre, reach, toSun, height) || ownCast) {
      this.shadows.render(this.renderer, this.scene)
      return true
    }
    return false
  }

  /**
   * Whether the map the sun holds is not the map this frame would draw.
   *
   * Yes wherever it is aimed anywhere else, wherever anything said so
   * ({@link stirShadows}), wherever a layer is still waiting on something, and
   * wherever the page has taken `frame`. No only where the viewer can tell that
   * the two would be the same picture.
   */
  private shadowsWouldDiffer(centre: Vector3, reach: number, toSun: Vector3, height: number): boolean {
    const aim = [centre.x, centre.y, centre.z, reach, toSun.x, toSun.y, toSun.z, height]
    const was = this.shadowDrawnFor
    if (was !== null && !this.events.has('frame') && aim.every((n, i) => n === was[i])) {
      for (const layer of this.layers) if (layer.busy?.() ?? false) return true
      return false
    }
    this.shadowDrawnFor = aim
    return true
  }

  /**
   * Keeps the camera, and the sun, looking at the land rather than at the sea.
   *
   * The middle of the view is a place on the map, and with the land carrying
   * its heights that place is not at sea level any more. Left aiming at
   * nought, two things go wrong at once, both by the same amount and both
   * worse the higher the ground: what the view is centred on slides up the
   * screen — 松本 at 590m would leave most of the screen the moment the
   * heights were turned on — and the sun's view, which is only as wide as the
   * ground in sight, slides off what it is meant to cover, so a city a few
   * hundred metres up loses its shadows altogether.
   *
   * Read every frame rather than when the view moves: the answer changes as
   * the tiles land, and the camera has to rise with the ground it is looking
   * at rather than after it.
   */
  private followLand(): void {
    const land = this.landAt(this._center[0], this._center[1])
    if (land === this.landHere) return
    this.landHere = land
    this.updateCamera()
  }

  /**
   * The land under a place, in world units, for the two that aim the camera
   * by it: following it below, and the wheel working out where to land.
   *
   * While a reading is still owed there, the land stays where it is rather
   * than falling to the sea; see {@link Heights.known}. A tile arriving moves
   * the eye once, which is what {@link followLand} is for. A tile that has
   * not arrived must not move it at all — but the sea and anywhere off the
   * map are answered outright, so the eye comes back down over water instead
   * of holding a hillside it has left.
   */
  private landAt(lon: number, lat: number): number {
    if (!this._elevation) return 0
    const metres = heightsInHand().known(lonToX(lon), latToY(lat))
    return metres === null ? this.landHere : metres / metersPerUnit(lat)
  }

  /**
   * Whether the page has stood something of its own in the scene that casts,
   * three's way: `viewer.scene.add(mesh)` and `mesh.castShadow = true`, and
   * nothing more (contract 10).
   *
   * Nothing tells the viewer when such a mesh moves — it is the page's, moved
   * by the page's hand on the page's clock — so where there is one the map is
   * drawn every frame, as it is for a page holding `on('frame')`. And it
   * counts as standing, so that the map is drawn at all on a screen where no
   * layer stands anything. Before, the one line three asks for was not
   * enough: such a mesh cast where it was when the map was last drawn for
   * some other reason, and nothing at all at a zoom with no city.
   */
  private pageCasts(): boolean {
    let casts = false
    this.ownLights.length = 0
    for (const child of this.scene.children) {
      if (this.owners.has(child) || child === this.lights.root) continue
      child.traverseVisible((object) => {
        if ((object as Mesh).isMesh && object.castShadow) casts = true
        if ((object as Light).isLight) this.ownLights.push(object as Light)
      })
    }
    return casts
  }

  /**
   * Whether the page has a mesh of its own shown in the scene — added with
   * `scene.add`, outside every layer — which may have moved since the sight's
   * cube was drawn with nothing to say so. {@link pageCasts} is the sun's same
   * question, asked of the meshes that cast.
   */
  private pageStands(): boolean {
    for (const child of this.scene.children) {
      if (this.owners.has(child) || child === this.lights.root) continue
      let stands = false
      child.traverseVisible((object) => {
        if ((object as Mesh).isMesh) stands = true
      })
      if (stands) return true
    }
    return false
  }

  /** The tallest thing the layers have standing on screen, in metres. 0 where everything lies flat. */
  private tallest(): number {
    let top = 0
    for (const layer of this.layers) top = Math.max(top, layer.tallest?.() ?? 0)
    return top
  }

  /**
   * Weaves a pass the viewer runs over the picture, off the frame; see
   * `OcclusionPass.weave`.
   *
   * The pass is not drawn until this is done ({@link drawable}), and the frame
   * after it is asked for. Drawn while its quads were still being made, three
   * left out each quad whose pipeline was not there yet but still cleared what
   * it draws into, so the frame showed no blur, or the blurred bands black, or
   * the whole map in the shading's tint; and since a still map draws only what
   * changed, that frame stayed. Measured 2026-11-17 with the card made slow
   * the way a cold one is: the blur switched off and on in simple-map was
   * still missing three seconds later.
   *
   * A failure is not the pass's failure: unwoven, it is drawn all the same and
   * woven the old way, inside the frame that first draws it.
   */
  private weavePass(pass: OcclusionPass | TiltShiftPass | null): void {
    if (!pass || !this.started || this.disposed) return
    if (this.passesWoven.has(pass) || this.passesWeaving.has(pass)) return
    // And what the passes before it are still making, as {@link weave} waits
    // on the weavings before it: a blur switched off and on again before its
    // shaders were made is handed the first one's, unmade, and told it is done
    const earlier = [...this.passesWeaving.values()]
    const weaving = (async (): Promise<void> => {
      try {
        await pass.weave(this.renderer)
      } catch {
        // Drawn and woven in the frame instead, as it always was
      }
      await Promise.all(earlier)
      this.passesWeaving.delete(pass)
      this.passesWoven.add(pass)
      if (pass === this.occlusionPass || pass === this.tiltShiftPass) this.repaintAsked = true
    })()
    this.passesWeaving.set(pass, weaving)
  }

  /** `pass` where it may be drawn this frame, which is once it is woven; see {@link weavePass}. */
  private drawable<Pass extends OcclusionPass | TiltShiftPass>(pass: Pass | null): Pass | null {
    return pass && this.passesWoven.has(pass) ? pass : null
  }

  /**
   * Lets a pass over the picture go, as the page turns it off.
   *
   * One still being woven is let go once the weaving is done. Three goes on
   * building what it was handed after each of its waits, on whatever it finds
   * there: let go of under it, the pass's sheets were made again by the
   * building and nothing freed them a second time (reviewed 2026-11-17). Once
   * the viewer is down, the renderer that held them is gone with it.
   */
  private letPassGo(pass: OcclusionPass | TiltShiftPass | null): void {
    if (!pass) return
    const weaving = this.passesWeaving.get(pass)
    if (!weaving) {
      pass.dispose()
      return
    }
    void weaving.then(() => {
      if (!this.disposed) pass.dispose()
    })
  }

  /** Makes the blur or lets it go as the page turns it on and off. */
  private syncTiltShift(): void {
    if (this.disposed) return
    // A pass over the picture, as the corner shading is: nothing compared
    // would see it switched or set (`repaint.ts`)
    this.repaintAsked = true
    if (!this._tiltShift.enabled) {
      this.letPassGo(this.tiltShiftPass)
      this.tiltShiftPass = null
      return
    }
    if (!this.tiltShiftPass) {
      this.tiltShiftPass = new TiltShiftPass()
      if (this.passesWeave) this.weavePass(this.tiltShiftPass)
    }
  }

  /**
   * Tells the blur where it is sharp and how much, this frame, and hands it
   * back where it would blur anything.
   *
   * What the page left out is worked out from the view. The focus is what
   * stands at the middle of the screen, which the pass reads off its own depth
   * (`TiltShiftPass.focus`); the land at the middle of the view is handed over
   * for where nothing is drawn there. How far from it a point is fully blurred
   * is the depth the ground spans from the middle of the screen to its top
   * edge: a slice of the ground on an orthographic camera laid back by the
   * pitch runs that far back for every bit of the screen it rises, by the
   * tangent of the pitch. So the ground at the top edge is fully blurred
   * however near or far the view is, and looking straight down nothing is.
   * The most it blurs grows with the sine of the pitch for the same reason.
   */
  private reckonTiltShift(): TiltShiftPass | null {
    const pass = this.drawable(this.tiltShiftPass)
    if (!pass) return null
    const settings = this._tiltShift
    const camera = this.threeCamera
    const [lng, lat] = settings.focus ?? this._center
    const focus = new Vector3(lonToX(lng), this.landAt(lng, lat), -latToY(lat)).applyMatrix4(camera.matrixWorldInverse)
    const pitch = (this._pitch * Math.PI) / 180
    const high = (camera.top - camera.bottom) / camera.zoom
    const length =
      settings.focalLength !== undefined
        ? settings.focalLength / metersPerUnit(lat)
        : (high / 2) * Math.tan(pitch)
    const blur = settings.blur ?? MOST_AUTO_BLUR * Math.sin(pitch)
    pass.set(focus.z, settings.focus === undefined, length, blur * this.renderer.getPixelRatio())
    return pass.shows ? pass : null
  }

  /**
   * Brings the corner shading into line with the settings as they now stand.
   * Turning it on and off, changing its numbers, changing its colour: all
   * here.
   */
  private syncOcclusion(): void {
    // The settings outlive the viewer, since a page may go on holding them; a
    // write to one after `dispose` would otherwise make a pass nobody frees
    if (this.disposed) return
    // A pass the viewer runs over the picture, not a value in a material, so
    // nothing compared would see it switched or set (`repaint.ts`)
    this.repaintAsked = true
    const settings = this._occlusion
    if (!settings.enabled) {
      this.letPassGo(this.occlusionPass)
      this.occlusionPass = null
      return
    }
    if (!this.occlusionPass) {
      this.occlusionPass = new OcclusionPass()
      if (this.passesWeave) this.weavePass(this.occlusionPass)
    }
    this.occlusionPass.shade(this.palette.shadow)
    // The radius is given in real metres, so the world's stretch with latitude
    // is taken back out of it
    this.occlusionPass.set(settings.radius / metersPerUnit(this._center[1]), settings.strength)
    // It draws over the finished picture rather than through a material, so
    // the shape has to reach it the way it reaches a layer
    this.occlusionPass.setMask(this._maskArea)
  }

  // ── Listening ─────────────────────────────────────────────

  /**
   * Listens for the view moving, or the colours changing. Hands back the way
   * to stop.
   *
   * @example
   * const stop = viewer.on('move', ({ view }) => setUrl(view))
   */
  on<K extends keyof ViewerEvents>(type: K, listener: (event: ViewerEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof ViewerEvents>(type: K, listener: (event: ViewerEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  // ── Where it looks ────────────────────────────────────────

  /** @internal Where the view is and how it is angled; read through {@link camera}. */
  get viewNow(): View {
    // Frozen, as the theme and the sun are handed out (rule 3): a copy a page
    // could write into took `view.zoom = 18` and `center[0] += 0.01` without a
    // word and moved nothing. The view is moved through the camera's setters
    return Object.freeze({
      center: Object.freeze([this._center[0]!, this._center[1]!] as const),
      zoom: this._zoom,
      pitch: this._pitch,
      heading: this._heading,
    })
  }

  // ── The frame ─────────────────────────────────────────────

  /**
   * How many milliseconds of this frame are left before it runs long.
   *
   * For a layer holding more work than one frame can take. Shapes laid on the
   * land are the case it was made for: a tile of heights landing under one
   * corner of a city-sized outline means cutting that outline again, and over
   * the twenty-three wards of 東京 the whole set of them came to 296ms — one
   * stall the reader sees, where eighteen frames of the same work is a zoom
   * that keeps moving.
   *
   * Negative once the frame has run long, so a loop that spends while this is
   * positive stops of its own accord. It cannot promise a frame: what a layer
   * is part way through is its own to finish, and the worst single shape
   * measured took 23.8ms by itself. What it can do is stop the next one from
   * being started.
   */
  get frameLeft(): number {
    return FRAME_RUNS_LONG - (performance.now() - this.frameBegan)
  }

  // ── The land ──────────────────────────────────────────────

  /**
   * The land.
   *
   * Handed back rather than kept by the page, since the viewer is what made
   * it: `viewer.ground.hide(ring)` is how a page clears a site of its
   * footprints. Always there, turned off or not.
   */
  get ground(): Ground {
    return this._ground
  }

  /** The city. Always there, turned off or not. */
  get buildings(): Buildings {
    return this._buildings
  }

  /**
   * Where the page's models stand; `viewer.models.bring(…)` reads a glTF file.
   *
   * Always there, as the land and the city are, and empty until a page brings
   * something — it holds nothing of its own and fetches nothing but what it
   * is asked for by name. A page may stand another layer of its own beside it
   * ({@link ViewerOptions.layers}); both write depth, so the two settle their
   * order by it.
   */
  get models(): ModelLayer {
    return this._models
  }

  /** Whether the land carries its real heights. Off by default. */
  get elevation(): boolean {
    return this._elevation
  }

  /**
   * How high the land is under the middle of the view, in world units, as far
   * as the tiles in hand can say. Nought while the land is drawn flat.
   *
   * What the camera and the sun are aimed at, offered because a layer that
   * stands something about the middle of the view has the same question — the
   * shapes' own boxes are the one that asks, and they are stood between the
   * land and the eye.
   */
  get landHeight(): number {
    return this.landHere
  }

  /**
   * How high the land stands at a place, in metres over the sea — Mapbox's
   * `queryTerrainElevation`, by its name. Nought while the land is drawn flat,
   * and null where its heights are still on their way.
   *
   * What a page adds to a place's own `height` for how high it stands over
   * the sea: a place the library hands back counts its height from the land
   * (see `Position.height`).
   */
  queryTerrainElevation(at: readonly [number, number]): number | null {
    if (!this._elevation) return 0
    return heightsInHand().known(lonToX(at[0]), latToY(at[1]))
  }

  /**
   * Gives the land its heights, or takes them away.
   *
   * Every layer lays what it draws on the ground as it builds it, so this asks
   * them all to build again. Nothing is fetched twice — the tiles are in the
   * browser's hands — but a city is shaped afresh, which takes a moment and
   * shows as the buildings going back under the ground and coming up again on
   * the land they really stand on.
   */
  set elevation(value: boolean) {
    if (this._elevation === value) return
    this._elevation = value
    for (const layer of this.layers) layer.changed?.('elevation')
  }

  // ── The mask ──────────────────────────────────────────────

  /** The shape the scene is cut to, or null where nobody has cut it. */
  get mask(): Mask | null {
    return this._maskGiven
  }

  /**
   * Cuts the scene to a shape, moves the one it is cut to, or takes it away
   * (null).
   *
   * Every layer is asked to choose again, so what falls outside stops being
   * fetched and what has come inside is asked for. Nothing has to be shaped
   * afresh: the shape is a value the materials read, not something built into
   * what they draw, so it may be moved every frame if a page wants that.
   */
  set mask(value: Mask | null) {
    // Gone, there is no scene to cut, and the picture made for it would be a
    // texture nobody lets go of
    if (this.disposed) return
    this._mask = value ?? null
    this._maskGiven = frozenMask(this._mask)
    // The area carries the picture of the shape the card reads, which is a
    // texture; the one that was standing goes back here, since this is where
    // it stops being anyone's
    this._maskArea?.dispose()
    this._maskArea = maskArea(this._mask, this.maskView)
    this._fetchMargin = this.marginOf(this._mask)
    // The pointer finds what is drawn, so the pass that looks for it is cut
    // the same way. It belongs to no layer, so it is told here
    this.picking.setMask(this._maskArea)
    this.syncOcclusion()
    // What the mask cuts is not drawn and so does not cast. The aim follows
    // the mask's circle and would catch most of this by itself, but a shape
    // swapped for another of the same reach is the same aim over a different
    // city
    this.stirShadows()
    for (const layer of this.layers) layer.changed?.('mask')
  }

  /**
   * The mask in the world's own units: what a layer judges a tile against, and
   * what it writes into its materials. Null where there is no mask.
   */
  get maskArea(): MaskArea | null {
    return this._maskArea
  }

  /**
   * Where the view is, in world units — where a shape riding the camera is
   * put. See {@link MaskView}.
   */
  get maskView(): MaskView {
    return { x: lonToX(this._center[0]), z: -latToY(this._center[1]) }
  }

  /**
   * Whether the screen gets a say in what is fetched.
   *
   * With no mask it does, and it is the only thing that could: the world is
   * bigger than anyone means to download, so what is looked at is what comes.
   *
   * A mask says where the scene ends, and then the screen has nothing to add
   * — everything inside the shape is wanted whether the camera happens to be
   * pointed at it or not. That is what lets a page say "every building in
   * this circle" and be answered: judged by the screen as well, the half of
   * the circle behind the camera would simply not be there, and a page
   * counting what it found would count the wrong number.
   *
   * So the mask is the whole of the question, and layers that would otherwise
   * drop what is off screen read this first.
   */
  /**
   * Tells the turn from "something is coming" to "nothing is", once.
   *
   * Only after something was coming. A viewer that has asked for nothing yet
   * is idle in the plainest sense and saying so would mean nothing — worse,
   * a page waiting for the first of these before the first tile was even
   * chosen would be let through to measure an empty scene.
   */
  private sayIfLanded(): void {
    let busy = false
    for (const layer of this.layers) {
      if (layer.busy?.() ?? false) {
        busy = true
        break
      }
    }
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    if (busy) return
    if (this.events.has('loaded')) this.events.emit('loaded', {})
  }

  /**
   * Whether the screen is what chooses: tiles, buildings, the lot.
   *
   * True where nothing was cut and where the shape rides the camera, since
   * either way the screen is the only thing that can say what to ask for. And
   * true where a page standing a shape on the map said it wanted only the part
   * the screen has reached ({@link Mask.fetch}) — the shape still cuts the
   * picture, but it has stopped being the thing that is fetched.
   *
   * Read by everything that drops what is off screen: the city's frustum test,
   * the ground's visible range and its cap of sixty-four tiles.
   */
  get screenPicks(): boolean {
    return this._maskArea === null || !this._maskArea.fetchesAll
  }

  /** Which corner the line naming the sources stands in. */
  get creditsAt(): CreditsCorner {
    return this._creditsAt
  }

  set creditsAt(corner: CreditsCorner) {
    if (corner === this._creditsAt) return
    this._creditsAt = corner
    this.creditsLine.at(corner)
  }

  // ── Colours ───────────────────────────────────────────────

  /**
   * The colours as they now stand. The dark set where the sun is down —
   * `sunAt(...).down` is the same question, asked of a page's own moment.
   */
  get colors(): Readonly<Palette> {
    return this.palette
  }

  /**
   * Whether the sun is down, which is which of the two sets {@link colors} is.
   *
   * **This was opened, closed and opened again.** It went on 2026-10-08 with
   * the `dark` handle it replaced, and came off the same day: it was one
   * property traded for one knob, and a page could already ask
   * `sunAt(...).down` of its own moment.
   *
   * What brought it back is {@link ThemeColor}. A layer handed a pair has to
   * know which half the palette is asking for, and it has to ask the viewer
   * rather than work the hour out again — the viewer's answer is the one the
   * palette was built from, and a layer that re-derived it from `viewer.sun`
   * would be writing the threshold down a second time, which is the mistake
   * the document records against `sun.ts`. The ground and the city ask it, and
   * so does a layer of somebody else's; that is why it is public rather than
   * internal.
   *
   * Still not a handle. Nothing is set here — the sun decides, as above.
   */
  get night(): boolean {
    return this.night_
  }

  /**
   * What the page has said of the palette; see {@link ViewerOptions.theme}.
   *
   * A frozen copy. Written to, it throws in a module rather than taking the
   * value and doing nothing with it — changing the palette is assigning a
   * theme, below, and a copy that quietly kept a page's edit would look like
   * the other way to do it.
   */
  get theme(): Readonly<Theme> {
    return Object.freeze({ ...this.overrides })
  }

  /**
   * The whole of what a page pins over the library's colours, replaced.
   *
   * `=` means what it means everywhere else in JavaScript: what was here
   * before is gone. To change one name, spread what is already there —
   * `viewer.theme = { ...viewer.theme, wall: '#fff' }` — and to hand one back
   * to the library, leave it out. `{}` returns every name to the library.
   *
   * Merging on assignment was the other way, and it cost two rules a page had
   * to be told: that `=` here does not replace, and that `null` is how you
   * undo. Replacing needs neither, and the spread that pays for it is the
   * language's own. MUI does the same with a theme — it is built once from
   * what a page says over the defaults, and changed by handing over another
   * one, never by editing the one in place.
   *
   * It takes what the option takes — a page that wrote
   * `new Viewer({ theme: { backdrop: 0x101418 } })` should not have to spell
   * the same colour differently to change it afterwards. Every one is brought
   * to the one spelling the palette keeps them in, both halves of a pair
   * included, so what {@link Viewer.theme} hands back is what the palette
   * holds rather than what the page happened to type.
   */
  set theme(value: Theme) {
    this.overrides = paletteOf(value)
    this.applyPalette()
  }

  /**
   * The set as it now stands: the theme the sun chose, with whatever the page
   * pinned over it.
   *
   * A page's colour is read for that set rather than kept as it was given — a
   * {@link ThemeColor} pair says a different thing once the sun is down, and
   * this runs again every time it crosses.
   */
  private paletteNow(): Palette {
    const asked: { -readonly [K in keyof Palette]?: Palette[K] } = {}
    for (const name of COLOR_NAMES) {
      const given = this.overrides[name]
      if (given !== undefined) asked[name] = new Color(colorFor(given, this.night_)).getStyle()
    }
    // The theme is the one way in to every name, `shadow` included. The sun
    // said it too for part of 2026-10-27 (`shadowColor`) and came off again:
    // the two reach the same whole map, and a second way in at one reach is an
    // order between them a page has to be told
    return { ...(this.night_ ? DARK : LIGHT), ...asked }
  }

  /**
   * The air behind the map, in the palette's `backdrop` — unless the page has
   * put a background of its own on the scene, three's way, which is the page's
   * to keep (contract 10). Written over, a sky a page hung there went back to
   * the palette's colour the moment the theme was handed over or the sun went
   * down, without a word.
   */
  private paintBackdrop(): void {
    const now = this.scene.background
    if (now !== null && now !== this.backdrop) return
    this.backdrop = beforeTheCurveOf(this.palette.backdrop)
    this.scene.background = this.backdrop
  }

  private applyPalette(): void {
    this.palette = Object.freeze(this.paletteNow())
    this.paintBackdrop()
    this.tellTheLight()
    this.syncOcclusion()
    for (const layer of this.layers) layer.changed?.('colors')
    this.creditsLine.colour(this.palette)
    if (this.events.has('colors')) this.events.emit('colors', { colors: this.colors })
  }

  // ── Light ─────────────────────────────────────────────────

  /**
   * The light, as it was given: an angle, or a moment.
   *
   * What it is not is the answer — a dated sun does not turn into degrees on
   * the way out. A page that wants those asks {@link sunAt}, which is the same
   * arithmetic this one goes through.
   */
  get sun(): Sun | null {
    // Frozen, as a theme is: the light is changed by handing over another,
    // and a copy that took a page's write without a word would read as the
    // other way to change it. All the way down, the moment and the place
    // included: `setHours` on a copy nobody reads is that very write, and a
    // freeze one level deep let it through; see `frozenSun`
    return this._sun ? frozenSun(this._sun) : null
  }

  /**
   * The shading where faces meet, and the handle on it:
   * `viewer.occlusion.enabled = false`, `viewer.occlusion.radius = 10`.
   *
   * Always the same object, and there is no handing over a new one. It is a
   * part of the viewer and not a value, as three's `renderer.shadowMap` is:
   * turned off it is still there to be turned on, with the numbers it had.
   * It was a whole value until 2026-10-27, set to null to turn it off, which
   * threw the numbers away with it.
   */
  get occlusion(): ViewerOcclusion {
    return this._occlusion
  }

  /**
   * The miniature look, and the handle on it: `viewer.tiltShift.enabled = true`,
   * `viewer.tiltShift.blur = 6`.
   *
   * Always the same object, as {@link occlusion} is. What is left `undefined`
   * is worked out from the view on every frame drawn.
   */
  get tiltShift(): ViewerTiltShift {
    return this._tiltShift
  }

  /**
   * How things come up out of the ground and go back under it, and the handle
   * on it: `viewer.appear.enabled = false`, `viewer.appear.duration = 2`.
   *
   * A part of the viewer in the way {@link occlusion} is. It could only be said
   * as the viewer was made until 2026-10-27; what changed is that the pace is
   * now set again whenever a page writes it, rather than once.
   */
  get appear(): ViewerAppear {
    return this._appear
  }

  /**
   * What a page draws over the finished frame, in the order it is drawn; see
   * {@link FramePass}.
   *
   * Copied on the way in and out, so the list cannot be added to behind the
   * viewer's back half way through a frame. Whoever made a pass frees it.
   */
  get effects(): readonly FramePass[] {
    return [...this._effects]
  }

  set effects(value: readonly FramePass[]) {
    this._effects = [...value]
  }

  set sun(value: Sun | null) {
    this._sun = value ? heldSun(value) : null
    this._lit = this.litNow()
    // Nothing to tell the layers about the light itself: it is three's and
    // reaches a material through the scene it is drawn in, so there is nothing
    // copied out of it for a layer to be holding. The colours are another
    // matter, and a sun put down past the horizon changes those
    this.tellTheHour()
  }

  /**
   * The light as {@link Lights} and the shadows want it, worked out from what
   * the page gave.
   *
   * A dated sun is worked out over the middle of the view unless the page
   * pinned it somewhere, which is why {@link placeView} calls this again when
   * the middle moves: the same instant is a different sun over 東京 and over
   * 福岡, and a page that set the hour once should not be left holding the sun
   * of wherever it happened to be looking then.
   */
  private litNow(): Lit | null {
    const sun = this._sun
    if (!sun) return null
    const angle = angleOfSun(sun, this._center)
    // The angle whatever hour it is, including an hour with no sun in it. What
    // a sun under the horizon hands over is nought, and the one place that is
    // decided is `Lights.set`, which asks `angle.down` before it divides the
    // light between the sun and the sky. Said once there rather than twice —
    // once as a null here and once as a threshold there — because the two
    // parted: the null took the direction with it, and the light fell back on
    // `DEFAULT_ANGLE` for an hour that has an angle of its own.
    return {
      angle,
      shading: Math.max(0, Math.min(1, sun.shading ?? 1)),
      // Held under two rather than under one: one is the light the palette was
      // drawn for, and a page lighting a model of its own may want more than
      // the map does. Two is where the curve has nothing left to give it
      brightness: Math.max(0, Math.min(2, sun.brightness ?? 1)),
    }
  }

  /**
   * Whether the sun has gone down over what is being looked at.
   *
   * Read off {@link _lit}, which was worked out a line before every one of the
   * three places this is asked. It used to solve the sun again here, because
   * `litNow` threw the angle away at a dated midnight and there was nothing
   * left to read; now it keeps it, and the two cannot disagree about an hour
   * for the same reason the threshold itself is written once.
   *
   * A viewer with no sun is not at night. It is a page that asked for no light
   * model, and the fill lights everything on its own — a flat picture, and a
   * light one.
   */
  private get benighted(): boolean {
    return this._lit !== null && this._lit.angle.down
  }

  /**
   * Takes the light that has just been worked out, and the hour with it.
   *
   * One call, because the colours now follow the sun: a set that changed
   * without the light, or a light that changed without the set, would be a
   * frame drawn half in one hour and half in the other. {@link applyPalette}
   * hands the light over itself, so it is this or that and never both.
   */
  private tellTheHour(): void {
    const was = this.night_
    this.night_ = this.benighted
    // The palette is rebuilt only where the set turned over. Not on every sun,
    // because rebuilding it hands every layer a change of colours and the city
    // rewrites its paint table for one — and nothing else about a sun reaches
    // the palette
    if (this.night_ !== was) this.applyPalette()
    else this.tellTheLight()
  }

  /**
   * Hands the light, as it has been worked out, to the one thing that holds it.
   *
   * Safe from the constructor, and not because a first frame tidies up after
   * it: `Lights.set` writes colours, strengths and a direction and draws
   * nothing, so there is nothing here that wants a renderer. There is no sky to
   * bake either — the fill is a `HemisphereLight` and `scene.environment` is
   * left empty on purpose; see {@link lights}.
   */
  private tellTheLight(): void {
    this.lights.set(this._lit, this.palette)
  }

  /**
   * Works the light out again where a dated sun would have moved with the view.
   *
   * The hour with it: fly far enough west and the same instant is a sun still
   * up over one city and down over the next.
   */
  private relight(): void {
    if (this._sun?.by !== 'time' || this._sun.over) return
    this._lit = this.litNow()
    this.tellTheHour()
  }

  // ── World coordinates ─────────────────────────────────────

  /**
   * The world is Mercator metres as they come.
   * three.js has Y upwards, so Mercator's y goes in as the world's z with its
   * sign turned round.
   */
  worldFromLngLat(lng: number, lat: number): Vector3 {
    return new Vector3(lonToX(lng), 0, -latToY(lat))
  }

  /** The other way round, for turning a place on the ground back into coordinates. */
  lngLatFromWorld(x: number, z: number): [number, number] {
    return [xToLon(x), yToLat(-z)]
  }

  /**
   * Where a patch of ground falls on screen: whether it shows at all, and how
   * far its middle sits from the middle of the view.
   *
   * Layers use this to pick what to fetch. Judging by a single middle point is
   * not enough — once the view is no wider than one tile, a tile covering the
   * whole screen still has its middle outside it.
   */
  measureOnScreen(bounds: WorldBounds): {
    visible: boolean
    distance: number
  } {
    let left = Infinity
    let right = -Infinity
    let bottom = Infinity
    let top = -Infinity
    // Mercator y grows north, world z grows south
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
    ] as const) {
      this.scratch.set(x, 0, -y).project(this.threeCamera)
      left = Math.min(left, this.scratch.x)
      right = Math.max(right, this.scratch.x)
      bottom = Math.min(bottom, this.scratch.y)
      top = Math.max(top, this.scratch.y)
    }
    return {
      visible: right > -1 && left < 1 && top > -1 && bottom < 1,
      distance: Math.hypot((left + right) / 2, (bottom + top) / 2),
    }
  }

  /**
   * Whether anything standing on a patch of ground, up to a height, shows on
   * screen.
   *
   * Stricter than `measureOnScreen`, which asks only whether the rectangle
   * around the patch's corners on screen meets it. Tilted and turned, a patch
   * lands as a slanting parallelogram and that rectangle reaches well past it:
   * at the default view of 中野 half the building tiles it let through had
   * nothing on screen. The height is for what stands on the patch, which the
   * tilt lifts toward the top of the screen, so a tall building short of the
   * bottom edge still counts.
   *
   * @param height how far above `from` to look, in world units
   * @param from how high the patch itself lies, in world units. Nought where
   *   the land is drawn flat; where it carries its heights, a tile of a town
   *   three hundred metres up is three hundred metres up, and at a tilt that
   *   is most of a screen away from where it would be judged without this.
   */
  reachesScreen(bounds: WorldBounds, height: number, from = 0): boolean {
    // Opened by the margin, so a patch about to come into view is judged to
    // have come already and is fetched before it is wanted
    const grow = this._fetchMargin
    if (grow > 0) {
      bounds = {
        minX: bounds.minX - grow,
        minY: bounds.minY - grow,
        maxX: bounds.maxX + grow,
        maxY: bounds.maxY + grow,
      }
    }
    const at = (x: number, y: number, up: number): [number, number] => {
      this.scratch.set(x, up, -y).project(this.threeCamera)
      return [this.scratch.x, this.scratch.y]
    }
    // The camera is orthographic, so the patch and all above it land as its
    // south-west corner plus any share of three sides: east, north and up.
    const [x0, y0] = at(bounds.minX, bounds.minY, from)
    const [ex, ey] = at(bounds.maxX, bounds.minY, from)
    const [nx, ny] = at(bounds.minX, bounds.maxY, from)
    const [ux, uy] = at(bounds.minX, bounds.minY, from + height)
    const sides: [number, number][] = [
      [ex - x0, ey - y0],
      [nx - x0, ny - y0],
      [ux - x0, uy - y0],
    ]
    // Two such shapes miss each other only where a line square to a side of
    // one leaves them apart: the screen's two, then the three above
    const across: [number, number][] = [[1, 0], [0, 1], ...sides.map(([x, y]): [number, number] => [-y, x])]
    return across.every(([dx, dy]) => {
      let low = x0 * dx + y0 * dy
      let high = low
      for (const [x, y] of sides) {
        const along = x * dx + y * dy
        if (along < 0) low += along
        else high += along
      }
      // The screen runs from -1 to 1 both ways
      const reach = Math.abs(dx) + Math.abs(dy)
      return low <= reach && high >= -reach
    })
  }

  /** Where the layers have things on their way, as {@link Layer.arriving} gives them. */
  get arriving(): WorldBounds[] {
    const all: WorldBounds[] = []
    for (const layer of this.layers) {
      const patches = layer.arriving?.()
      if (patches) all.push(...patches)
    }
    return all
  }

  /** The canvas in pixels, for the layers that measure a line's thickness in them. */
  get canvasSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /**
   * How many pixels of the screen go to one of the page.
   *
   * The device's own by default, as Mapbox's `pixelRatio` is — a screen three
   * to the page is drawn at three. It was held to two until 2026-10-28, a
   * cost settled for every page; a page that wants fewer pixels for a quicker
   * frame says so here, and `undefined` hands it back to the device.
   *
   * Read by a layer with something to land on a whole pixel of the screen.
   * Letters are the case: drawn a texel to the pixel and then put down
   * between two, they are resampled afresh every frame the view moves, and
   * what should be a word crawls.
   */
  get pixelRatio(): number {
    return this.ratioNow()
  }

  set pixelRatio(value: number | undefined) {
    this._pixelRatio = value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
    this.resize()
  }

  private _pixelRatio: number | undefined

  /** The ratio drawn at: the page's, or the device's as it stands now. */
  private ratioNow(): number {
    return this._pixelRatio ?? window.devicePixelRatio
  }

  /** How wide a stretch of Mercator the screen holds, in metres, from the zoom and the canvas. */
  get viewWidth(): number {
    return this.widthAt(this._zoom)
  }

  /**
   * What one pixel of the page is worth in the world's own units.
   *
   * The one answer for everything sized in page pixels — a line's width, a
   * mark's card, the reach of the corner shading. Three layers worked it out
   * from the same two getters, which is three places for it to drift; it is
   * also the number the shaders arrive at from the projection matrix
   * (`shapes/paint.ts`), and they cannot read this, so the two are kept in
   * step by saying the same thing: how wide the view is, over how wide the
   * canvas is.
   *
   * World units, not metres. Mercator stretches with the latitude, so a
   * length wanted in real metres divides by `metersPerUnit` at the place it
   * is wanted.
   */
  get worldPerPixel(): number {
    return this.viewWidth / Math.max(1, this.width)
  }

  /** The same, for a zoom given rather than the one in use. */
  private widthAt(zoom: number): number {
    return (this.width / TILE_PIXELS) * (EARTH_CIRCUMFERENCE / 2 ** zoom)
  }

  /** The zoom that holds that width: {@link widthAt} turned round. */
  private zoomForWidth(width: number): number {
    return Math.log2(((this.width / TILE_PIXELS) * EARTH_CIRCUMFERENCE) / width)
  }

  // ── Limits ────────────────────────────────────────────────

  /** How far out, how far in, and how far back the view may go; see {@link ViewerOptions.minZoom}. */
  private _minZoom = MIN_ZOOM
  private _maxZoom = MAX_ZOOM
  private _maxPitch = MAX_PITCH

  /** @internal The page reads and writes these through {@link Camera.minZoom} and its two. */
  get limits(): { readonly minZoom: number; readonly maxZoom: number; readonly maxPitch: number } {
    return { minZoom: this._minZoom, maxZoom: this._maxZoom, maxPitch: this._maxPitch }
  }

  /**
   * @internal Holds the view to new limits, and the view now standing to them:
   * a view outside the new range is brought in, as Mapbox's setters bring it.
   *
   * Held within the library's own, which a page may narrow and not widen, and
   * the two ends of the zoom the right way round — a range with nothing in it
   * throws rather than leaving every write to land on whichever end won.
   */
  limit(minZoom: number, maxZoom: number, maxPitch: number, holdView = true): void {
    const low = Math.max(MIN_ZOOM, Number.isFinite(minZoom) ? minZoom : MIN_ZOOM)
    const high = Math.min(MAX_ZOOM, Number.isFinite(maxZoom) ? maxZoom : MAX_ZOOM)
    if (low > high) throw new Error(`Viewer: minZoom ${minZoom} is past maxZoom ${maxZoom}`)
    this._minZoom = low
    this._maxZoom = high
    this._maxPitch = Math.max(0, Math.min(MAX_PITCH, Number.isFinite(maxPitch) ? maxPitch : MAX_PITCH))
    // Not from the constructor, which has no view yet to hold
    if (holdView) this.placeView({ zoom: this._zoom, pitch: this._pitch })
  }

  private clampPitch(value: number): number {
    return Math.max(0, Math.min(this._maxPitch, value))
  }

  private clampZoom(value: number): number {
    return Math.max(this._minZoom, Math.min(this._maxZoom, value))
  }

  // ── Flying ────────────────────────────────────────────────

  /** @internal The page flies through {@link Camera.flyTo}, which says what it does. */
  flyTo(to: Partial<View>, options: FlyOptions = {}): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    const { duration, arc = true } = options
    if (duration !== undefined && !(Number.isFinite(duration) && duration >= 0)) {
      throw new Error(`Viewer: a flight takes 0 or more milliseconds, got ${duration}`)
    }

    const fromWidth = this.viewWidth
    const from = {
      x: lonToX(this._center[0]),
      y: latToY(this._center[1]),
      pitch: this._pitch,
      heading: this._heading,
    }
    // What is not a finite number is left out, as {@link placeView} would
    // leave it: a flight towards `NaN` is a flight whose every frame is lost
    const finite = (value: number | undefined) =>
      value !== undefined && Number.isFinite(value) ? value : undefined
    const centre = to.center?.every(Number.isFinite) ? to.center : this._center
    const target = {
      x: lonToX(centre[0]),
      y: latToY(centre[1]),
      zoom: this.clampZoom(finite(to.zoom) ?? this._zoom),
      pitch: this.clampPitch(finite(to.pitch) ?? this._pitch),
      heading: wrapHeading(finite(to.heading) ?? this._heading),
    }
    this.stop()
    // Someone has chosen where to look; nothing is owed a fit any more
    this.pendingFit = null

    const path = flightPath(
      Math.hypot(target.x - from.x, target.y - from.y),
      fromWidth,
      this.widthAt(target.zoom),
      arc,
    )
    // Turned the short way round, rather than the long way past north
    const turn = ((((target.heading - from.heading) % 360) + 540) % 360) - 180
    const length = path.length + (Math.abs(turn) + Math.abs(target.pitch - from.pitch)) / DEGREES_PER_SCREEN
    const time =
      duration ??
      (length > 1e-6
        ? Math.min(FLY_MAX_DURATION, Math.max(FLY_MIN_DURATION, (length / FLY_SPEED) * 1000))
        : 0)

    if (time === 0) {
      this.land(target)
      return Promise.resolve(true)
    }

    const motion = play({ duration: time, easing: options.easing ?? easeInOut }, 'Viewer.flyTo')
    return new Promise((resolve) => {
      this.moving = {
        motion,
        step: (k) => {
          const { width, along } = path.at(k)
          this.placeView({
            center: [
              xToLon(from.x + (target.x - from.x) * along),
              yToLat(from.y + (target.y - from.y) * along),
            ],
            zoom: this.zoomForWidth(width),
            pitch: from.pitch + (target.pitch - from.pitch) * k,
            heading: from.heading + turn * k,
          })
        },
        // A flight fills nothing, so it has nothing to say on the last frame:
        // the view is simply put down where it was going
        done: () => {
          this.land(target)
          resolve(true)
        },
        cut: () => resolve(false),
        spent: true,
        settled: false,
      }
    })
  }

  /** @internal The page keyframes through {@link Camera.animate}, which says what it does. */
  animate(keyframes: readonly ViewKeyframe[], timing: Timing): Animation {
    const owner = 'Viewer.animate'
    const offsets = offsetsOf(keyframes, owner)
    const frames: ViewFrames = {
      centre: framesOf(
        keyframes,
        offsets,
        (frame, at) => {
          const centre = frame.center
          if (centre === undefined) return undefined
          if (!Array.isArray(centre) || centre.length !== 2 || !centre.every(Number.isFinite)) {
            throw new Error(`${owner}: keyframe ${at} has a center that is not [lon, lat]`)
          }
          return [lonToX(centre[0]), latToY(centre[1])] as const
        },
        owner,
      ),
      zoom: framesOf(keyframes, offsets, (frame, at) => numberIn(frame.zoom, 'zoom', at, owner), owner),
      pitch: framesOf(keyframes, offsets, (frame, at) => numberIn(frame.pitch, 'pitch', at, owner), owner),
      heading: framesOf(
        keyframes,
        offsets,
        (frame, at) => numberIn(frame.heading, 'heading', at, owner),
        owner,
      ),
    }

    this.stop()
    this.pendingFit = null
    const start = {
      centre: [lonToX(this._center[0]), latToY(this._center[1])] as const,
      zoom: this._zoom,
      pitch: this._pitch,
      heading: this._heading,
    }
    // Filled both ways unless the page says otherwise, since a view has to
    // stand where the motion left it: there is no value of its own under the
    // motion for it to go back to, the way an element has its stylesheet.
    // Said otherwise, it is the page's — a motion that fills nothing stands
    // the view back where it found it once it ends, which is what `'none'`
    // means on an element too
    const fill = timing.fill ?? 'both'
    const motion = play({ ...timing, fill }, owner)
    const back = () =>
      this.placeView({
        center: [xToLon(start.centre[0]), yToLat(start.centre[1])],
        zoom: start.zoom,
        pitch: start.pitch,
        heading: start.heading,
      })
    this.moving = {
      motion,
      step: (k) => {
        const [x, y] = valueAt(frames.centre, k, start.centre, mixPairs)
        this.placeView({
          center: [xToLon(x), yToLat(y)],
          zoom: valueAt(frames.zoom, k, start.zoom, mixNumbers),
          pitch: valueAt(frames.pitch, k, start.pitch, mixNumbers),
          heading: valueAt(frames.heading, k, start.heading, mixNumbers),
        })
      },
      done: () => {
        if (fill === 'none' || fill === 'backwards') back()
      },
      cut: () => undefined,
      undo: back,
      // The page holds this one, and may play it again once it has ended
      spent: false,
      settled: false,
    }
    return motion
  }

  /**
   * @internal The one gate; see {@link Camera}.
   *
   * The one way the page moves the view: every setter, the wheel, a drag and
   * `fitBounds` come through here.
   *
   * Whoever asks this way is taken to mean it, so a flight or a keyframed
   * motion running gives way rather than fighting for the same four numbers
   * frame by frame, and the first fit to Japan is given up on — someone has
   * chosen where to look.
   *
   * A motion moving the view goes through {@link placeView} instead. Passing
   * this way would have it stop itself on its first frame.
   */
  setView(to: Partial<View>): void {
    this.stop()
    this.pendingFit = null
    this.placeView(to)
  }

  /**
   * Puts the view where it is told without interrupting anything: for the
   * motion that is doing the moving, and for the first fit.
   *
   * What is not named is left where it stands. Every value is held to its
   * limits here, once, so no caller has to remember which of them wrap and
   * which clamp.
   *
   * And a value that is not a finite number is left out as if it had not been
   * named — the same answer `fitBounds` gives a rectangle at infinity. Taken,
   * `NaN` is not a bad view but the end of the view: clamping `NaN` is `NaN`,
   * every drag and wheel turn after it is arithmetic on it, and nothing the
   * reader does brings the map back. A page setting `zoom` from a text box
   * that held a word was enough.
   */
  private placeView(to: Partial<View>): void {
    const wasLon = this._center[0]
    const wasLat = this._center[1]
    const wasZoom = this._zoom
    const wasPitch = this._pitch
    const wasHeading = this._heading

    if (to.center && Number.isFinite(to.center[0]) && Number.isFinite(to.center[1])) {
      this._center = [to.center[0], to.center[1]]
    }
    if (to.zoom !== undefined && Number.isFinite(to.zoom)) this._zoom = this.clampZoom(to.zoom)
    if (to.pitch !== undefined && Number.isFinite(to.pitch)) this._pitch = this.clampPitch(to.pitch)
    if (to.heading !== undefined && Number.isFinite(to.heading)) this._heading = wrapHeading(to.heading)

    // A motion filled forwards says the same thing every frame once it has
    // ended, a paused one for as long as it is held, and a value already at
    // its limit says it however far past the limit it is asked to go. Telling
    // the layers each time would have them choosing tiles afresh for a view
    // that has not moved.
    if (
      this._center[0] === wasLon &&
      this._center[1] === wasLat &&
      this._zoom === wasZoom &&
      this._pitch === wasPitch &&
      this._heading === wasHeading
    ) {
      return
    }
    // The sun stands over a place, so moving the middle moves it
    if (this._center[0] !== wasLon || this._center[1] !== wasLat) this.relight()
    // A shape riding the camera is carried before the layers choose again, so
    // what they judge against is the shape where it is now. Two numbers: the
    // picture the card reads is the same picture, read from further over.
    if (this._maskArea?.follows) {
      const seat = this.maskView
      this._maskArea.moveTo(seat.x, seat.z)
    }
    this.viewChanged()
  }

  /**
   * @internal The page stops through {@link Camera.stop}.
   *
   * Stops whatever is moving the view. A flight's promise settles false.
   */
  stop(): void {
    const moving = this.moving
    if (!moving) return
    this.moving = null
    moving.motion.cancel()
    moving.cut()
  }

  /** Carries whatever is moving the view one frame on. */
  private stepView(): void {
    const moving = this.moving
    if (!moving) return
    const state = moving.motion.playState

    // Cancelled from outside — `motion.cancel()`, not this viewer's doing.
    // Playing it again starts it from the beginning, so a motion the page
    // still holds keeps its place here.
    if (state === 'idle') {
      // Once for each cancel, whether it was cancelled running or after it
      // had ended and stood filled
      if (!moving.idle) {
        moving.idle = true
        moving.undo?.()
      }
      this.settle(moving, false)
      return
    }
    moving.idle = false

    const along = moving.motion.progress()
    // The browser has not given it a start time yet: looked at again next frame
    if (along === null && state !== 'finished') return
    if (along !== null) moving.step(along)

    if (state === 'finished') this.settle(moving, true)
    // Running again after it had ended, or after it was cancelled
    else moving.settled = false
  }

  /**
   * Tells a motion it has ended — once — and lets go of it if nothing could
   * play it again.
   */
  private settle(moving: ViewMotion, reached: boolean): void {
    if (!moving.settled) {
      moving.settled = true
      if (reached) moving.done()
      else moving.cut()
    }
    if (moving.spent) this.moving = null
  }

  /** Puts the view down exactly where it was going. */
  private land(to: { x: number; y: number; zoom: number; pitch: number; heading: number }): void {
    this.placeView({
      center: [xToLon(to.x), yToLat(to.y)],
      zoom: to.zoom,
      pitch: to.pitch,
      heading: to.heading,
    })
  }

  /**
   * The rectangle of Mercator the screen holds now.
   * Under a tilt the screen's height reaches further over the ground.
   *
   * The heading is left out on purpose. Fitted to a turned rectangle, the
   * tiles wanted would change with every small turn and the view would spend
   * a whole rotation fetching and dropping them. Taking the screen's diagonal
   * as the radius gives the same rectangle at any angle, so the tiles stand
   * still while it turns.
   */
  get visibleBounds(): WorldBounds {
    const reach = this.viewReach
    const cx = lonToX(this._center[0])
    const cy = latToY(this._center[1])
    return { minX: cx - reach, minY: cy - reach, maxX: cx + reach, maxY: cy + reach }
  }

  /**
   * The rectangle worth fetching over: {@link visibleBounds} widened by
   * whatever the mask asked to have ready before it comes into view.
   *
   * Two rectangles rather than one because they answer different questions.
   * What is drawn ends where the screen ends, and a sheet laid over more than
   * that is paid for and never seen; what is fetched may reach past it, which
   * is the whole of what a margin is for. Whoever chooses tiles of things —
   * the land, the city, a vector tileset — reads this one.
   *
   * Not the picture layers. A picture is laid into one sheet the size of the
   * screen, so it is fetched for what the screen shows and no further: tiles
   * past the edge would be stitched into a sheet that does not reach them.
   */
  get fetchBounds(): WorldBounds {
    const grown = this.viewReach + this._fetchMargin
    const cx = lonToX(this._center[0])
    const cy = latToY(this._center[1])
    return { minX: cx - grown, minY: cy - grown, maxX: cx + grown, maxY: cy + grown }
  }

  /** What a mask asks to have fetched past the screen, in world units. */
  private marginOf(mask: Mask | null): number {
    const metres = viewMargin(mask)
    return metres > 0 ? metres / metersPerUnit(this._center[1]) : 0
  }

  /**
   * How far the view can reach over the ground from its middle, in world
   * units: the circle {@link visibleBounds} is the box round.
   *
   * The circle is the shape of the answer and the box is a convenience for
   * whoever asks in rows and columns. Anything covering what is in view with
   * something that does not share the world's axes wants the circle instead —
   * the box round it reaches a further square root of two into the corners,
   * and the light would spend its map on them.
   */
  private get viewReach(): number {
    const halfW = this.viewWidth / 2
    const halfH = (halfW * this.height) / this.width / Math.max(0.2, Math.cos((this._pitch * Math.PI) / 180))
    return Math.hypot(halfW, halfH)
  }

  // ── The layers ─────────────────────────────────────────────

  /**
   * Adds a layer. Which stage it declares decides where its things are drawn,
   * so a page may add the ground before the buildings or after and the picture
   * comes out the same.
   *
   * **Within a stage, the order they went on is the order they are drawn**
   * (2026-10-28): a layer added later goes over one added before it, as on
   * Mapbox, deck.gl and Leaflet. Two pictures on the land, two groups of
   * shapes over the city: the later one is on top, and to put one under
   * another a page takes it off and puts it back on. Where layers write depth
   * — the city, models, solids — the nearer thing still hides the farther
   * one, whatever their order. The land is not among them: only its sheet
   * writes depth, so a ground goes at its place among the layers of its stage
   * as a picture does (2026-10-29, see `Ground.groups`). See {@link Stage} and
   * `order.ts`.
   *
   * Until 2026-10-06 that order was a splice into `scene.children` with the
   * renderer told not to sort; from then until this, it decided nothing, and
   * two layers of one stage that wrote no depth were parted by whichever of
   * their centres the eye was nearer, which turned over as the view did.
   *
   * A layer belongs to one viewer at a time. Adding one that is already on
   * another viewer throws rather than quietly emptying that viewer's scene.
   *
   * A line or a mark is handed over the same way, with no group made for it;
   * see {@link Held}.
   */
  add(thing: Layer | Held): this {
    // A viewer that has gone takes nothing on. Taken, a layer handed over
    // after the dispose — by a React page whose data came in after it had
    // unmounted, say — sat attached to a dead scene with nobody left to let
    // it go, since the dispose that would have was already over
    if (this.disposed) return this
    if ('putOn' in thing) {
      thing.putOn(this)
      return this
    }
    const layer = thing
    if (this.layers.has(layer)) return this
    this.refuseTaken(layer)
    this.layers.add(layer)
    // Whatever it has brought is not in the map the sun holds
    this.stirShadows()
    this.seat(layer)
    this.owners.set(layer.root, layer)
    layer.attach(this)
    layer.changed?.('colors')
    // Before the view: a layer chooses its tiles from what it has been told,
    // and a mask told afterwards would have it fetch the world once first
    layer.changed?.('mask')
    layer.changed?.('view')
    return this
  }

  /**
   * Refuses a layer that belongs to another viewer.
   *
   * A layer is on one viewer at a time: its root is one node, and seating it
   * here would take it out of that viewer's scene without that viewer ever
   * being told. So this says no rather than quietly emptying it.
   */
  private refuseTaken(layer: Layer): void {
    if (layer.root.parent) {
      throw new Error('Viewer: this layer is already on a viewer. Take it off that one with remove() first.')
    }
  }

  /**
   * @internal The viewer's own group of a kind, made and seated the first time
   * one is wanted. Called by whatever is putting itself on; see {@link Held}.
   */
  ownGroup<T extends Layer>(kind: OwnGroup, make: () => T): T {
    const had = this.own.get(kind)
    if (had) return had as T
    const made = make()
    this.own.set(kind, made)
    this.add(made)
    return made
  }

  /**
   * Every drawn layer of buildings, asked as one, for what stands
   * on a building: each is asked in the order it was seated, and the first
   * that holds the building answers. Null where none is drawn.
   *
   * The first drawn was the only one asked before, so a building in any other
   * — a second `Buildings` a page put up for towers of its own, as `load` and
   * `animateAll` tell it to — could carry nothing.
   */
  get onBuildings(): StandsOnBuildings | null {
    for (const layer of this.layers) if (layer.root.visible && standsOnBuildings(layer)) return this.everyCity
    return null
  }

  /** Every drawn layer of buildings, asked as one; see {@link onBuildings}. */
  private readonly everyCity: StandsOnBuildings = {
    seatOnAnchor: (anchor) => {
      for (const layer of this.layers) {
        if (!layer.root.visible || !standsOnBuildings(layer)) continue
        const seat = layer.seatOnAnchor(anchor)
        if (seat) return seat
      }
      return null
    },
  }

  /**
   * The first layer on this viewer that answers a given question, or nothing.
   *
   * Two layers sometimes have to meet: a layer standing marks on the city has
   * to ask the city's own layer where a building is. The question they meet
   * over belongs to neither of them — it goes in a place of its own, as a zoom
   * two layers agree on does — and this is how the one finds the other without
   * either naming the other's type.
   *
   * The viewer is the only thing that knows what is on it, and it learns
   * nothing about either of them by answering: the question is the asker's and
   * the answer is the answerer's.
   */
  answering<T extends Layer>(asks: (layer: Layer) => layer is T): T | null {
    // What is not drawn answers nothing. A layer turned off chooses no tiles
    // and holds nothing, so there is no building in it to stand on -- and the
    // page that turned the viewer's own city off did it to put its own there.
    // Taking the first that answers would otherwise always take the viewer's,
    // since the viewer seats its own before anything the page hands over, and
    // everything seated by name would quietly find nothing.
    for (const layer of this.layers) if (layer.root.visible && asks(layer)) return layer
    return null
  }

  /**
   * Takes a layer off, leaving it as it was made: its tiles given back, what
   * it carved kept. It can go on another viewer, or back on this one.
   *
   * This is also how a layer outlives its viewer — one being disposed takes
   * the layers it still holds with it.
   *
   * **The three the viewer made for itself are turned away** — the land, the
   * city and the models layer. They are what {@link ground},
   * {@link buildings} and {@link models} answer for the life of the viewer,
   * so nothing that reads one has to ask whether it is still there, and
   * nothing that routes into one has to ask either: a bare `Model` handed to
   * {@link add} goes into `viewer.models`, and that is always a layer the
   * scene holds. A page with no use for one writes `visible = false`.
   *
   * Half-removing one was the old answer and it was the worst of both — the
   * getter went on handing back a layer the scene no longer held, and a model
   * put there afterwards drew nothing and said nothing.
   *
   * Told apart by **which object it is** and not by what class it is, which
   * is the whole of the rule: a page is free to make a `Ground` or a
   * `Buildings` of its own, add it, and take it off again. The playground
   * does exactly that — it turns the viewer's city off and swaps a city of
   * its own whenever the level of detail changes, since that is baked into
   * the corners. A brand on the class would have refused it, and a brand on
   * these getters would be a word in the types that is not there at runtime;
   * the fact is about the instance, so the guard is too.
   */
  remove(thing: Layer | Held): this {
    if ('putOn' in thing) {
      thing.takeOff()
      return this
    }
    const layer: Layer = thing
    if (layer === this._ground || layer === this._buildings || layer === this._models) {
      throw new Error(
        "Viewer.remove: the land, the city and the models layer are the viewer's own and cannot be taken off. Turn one off with `visible = false`.",
      )
    }
    if (!this.layers.delete(layer)) return this
    // Whatever it was casting is still in the map the sun holds
    this.stirShadows()
    this.owners.delete(layer.root)
    // A group the viewer made for itself is one a page may take off like any
    // other; the next thing of that kind then makes a fresh one
    for (const [kind, kept] of this.own) if (kept === layer) this.own.delete(kind)
    if (this.hovering?.layer === layer) this.hovering = null
    // The look the pointer last took is answered out of for a whole press
    // ({@link under}), and a layer taken off is still in it: a detached layer
    // goes on answering `listens('drag')` and still finds its own things, so a
    // press on that pixel in the ten frames before the next look would hand it
    // a carry, write a place on a thing that is in no scene, and hold the map
    // still for the length of the press.
    if (this.under?.layer === layer) this.under = null
    if (this.carrying?.layer === layer) {
      this.carrying = null
      // And the press ends with it. The map stands just as still either way —
      // 'none' turns back at the top of the move handler and a 'carry' with an
      // empty hand falls out of its own branch — so what this buys is the
      // letting go: left live, a press that never wandered would come back as
      // a click on whatever that pixel holds now.
      this.pressMode = 'none'
    }
    layer.detach()
    this.scene.remove(layer.root)
    // Left as it was made, the mask `seat` opened along with the number; see
    // `outOfStage`.
    outOfStage(layer.root)
    // The ones after it close up behind it
    this.restage(layer.stage)
    return this
  }

  /**
   * Weaves the shaders for something before it is first drawn.
   *
   * Three settles a shader the first time the material carrying it is drawn,
   * and weaving one costs about a second. Drawn without this, that second is
   * paid inside a frame: the loop stops, the tile that landed stands there
   * half a second late, and whatever was moving jumps. Asked for here instead,
   * the backend builds the pipeline off the main thread
   * (`createRenderPipelineAsync`) and the frame that draws it finds it ready.
   *
   * It is the layer that calls this, and not the viewer that asks, because
   * only the layer knows when it is about to put something new in front of the
   * camera. A tile lands between frames, which is exactly where there is time
   * to weave — so a layer waits for this and then hangs the thing under its
   * root. Waiting costs the tile nothing anyone sees: it is already coming up
   * out of the ground over the best part of a second.
   *
   * What it weaves for is the canvas. A pass with an eye of its own draws
   * under a stand-in material into a target of its own, which is a pipeline of
   * its own and not this one; those are few and are woven the old way.
   *
   * Handing back nothing done is not failure. Before the device is in hand
   * there is nothing to weave with, and after the viewer is down there is
   * nothing to draw — in both the thing is simply drawn as it always was.
   *
   * @param things what is about to go into the scene, not yet in it; with
   *   nothing given, everything already in it — for after the fog is turned
   *   on or off, which weaves every material afresh
   */
  async weave(...things: readonly Object3D[]): Promise<void> {
    if (this.disposed) return
    // Nothing named is the whole scene, as it stands: what a page asks for
    // after turning the fog on or off, which every material is woven again
    // for (see CLAUDE.md, "scene.fog"). It returned at once, and the frame
    // after paid for every shader on screen
    const weaving = things.length > 0 ? things : [this.scene]
    // A layer whose first tile beats the device waits on the promise the
    // viewer started with, rather than weaving against a renderer with no
    // device behind it. Its own failure is said elsewhere; here it only means
    // there is nothing to weave with.
    if (!this.started) await this.starting.catch(() => undefined)
    if (!this.started || this.disposed) return
    // For the canvas, and then for the passes that draw the same things under
    // stand-ins into targets of their own — the sun's map, the depth the
    // corner shading and the blur measure from, the land under a mask. Those
    // were left to be made on the spot, and on a card that had never made
    // them the picture stopped while it did; see `weaveStandIns`
    //
    // Each as shown and in view, whatever it says this moment. Three's walk
    // passes over what is told `visible = false` and over what its frustum
    // test leaves out (`_projectObject`), and both are things the frames to
    // come draw: a page's solid or sight hidden until the city stands, a thing
    // a layer holds out of the picture until it is woven, a solid not stood
    // yet and sitting at the world's nought. Left to the walk, those were
    // built in the frame that first drew them (measured 2026-11-17 on
    // security-camera: the camera's housing, its stand-in in the sight's cube
    // and the sight's sheet, made with `createRenderPipeline` as the camera
    // appeared). Only the things handed over are shown, not what is under
    // them, so what a layer hides inside one stays hidden. Put back as soon as
    // the walk is done: three walks before it first waits and reads neither
    // again after
    const shown = weaving.filter((thing) => !thing.visible)
    const culled: Object3D[] = []
    for (const thing of weaving) {
      thing.traverse((object) => {
        if (!object.frustumCulled) return
        object.frustumCulled = false
        culled.push(object)
      })
    }
    for (const thing of shown) thing.visible = true
    let forCanvas: Promise<unknown>[] = []
    let forPasses: Promise<unknown> = Promise.resolve()
    try {
      forCanvas = weaving.map((thing) => this.renderer.compileAsync(thing, this.threeCamera, this.scene))
      forPasses = weaveStandIns(this.renderer, this.scene, this.threeCamera, weaving, this._maskArea !== null)
    } finally {
      for (const thing of shown) thing.visible = false
      for (const object of culled) object.frustumCulled = true
    }
    const mine = Promise.allSettled([...forCanvas, forPasses])

    /*
     * And whatever an earlier weaving of the same materials is still making.
     *
     * Three makes a pipeline once and hands the same one to everything that
     * asks for it after — and a weaving that asks while it is still being made
     * is handed it, unmade, and told it is done. A second tile of the city
     * woven while the first was still making the city's shader was hung at
     * once; the canvas left it out until the shader was there, and the sun's
     * map, whose stand-in was made long before, drew it. Filmed 2026-11-17 in
     * the playground opened cold with the rise slowed: the shadows of a street
     * lay on the ground a quarter of a second before the street. So a weaving
     * waits for the ones before it that share a material — the tiles of one
     * kind share theirs — and only for those, so that the land does not wait
     * on the city.
     */
    const materials = new Set<Material>()
    for (const thing of weaving) {
      thing.traverse((object) => {
        const worn = (object as Mesh).material
        if (!worn) return
        for (const material of Array.isArray(worn) ? worn : [worn]) materials.add(material)
      })
    }
    const earlier = new Set<Promise<unknown>>()
    for (const material of materials) {
      const before = this.weavingFor.get(material)
      if (before) earlier.add(before)
    }
    // What the next weaving of these waits on is this one and all it waits on
    // in turn, and not this one alone. Left as this one alone, a weaving that
    // was handed the city's shader unmade finished at once, and the one after
    // it waited on that and nothing else: the second tile waited, the third
    // was hung in the middle of the first's shader being made (probed
    // 2026-11-17, cold: three tiles drawn into the sun's map 0.4 s before the
    // canvas could draw them). Neither rejects — `mine` is settled whatever
    // happens, and so is every one before it
    const whole = Promise.all([mine, ...earlier])
    for (const material of materials) this.weavingFor.set(material, whole)
    const settled = await mine
    await whole
    for (const material of materials) {
      if (this.weavingFor.get(material) === whole) this.weavingFor.delete(material)
    }
    // Failing as the weaving did before it waited on anything: a shader that
    // would not weave is said by the frame that draws it
    const failed = settled.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
  }

  /** The weaving under way for each material, for the next weaving of it to wait on; see {@link weave}. */
  private readonly weavingFor = new Map<Material, Promise<unknown>>()

  /**
   * @internal Whether frames are being drawn, so that a thing put on now may be
   * drawn before a weaving of it is done.
   *
   * Before, it may not: the first frame waits for the scene as it stands to be
   * woven, and a weaving asked for until then waits for the viewer to start
   * (see {@link weave}), which ends after that first frame. A layer holding a
   * thing out of the picture until it is woven holds it only from here on —
   * held from the start, a thing the page put on the map with the viewer was
   * missing from its first frames.
   */
  get framing(): boolean {
    return this.framesBegun
  }

  /**
   * @internal Tells a loader which compressed forms the device will take a
   * picture in.
   *
   * The one thing a loader of compressed pictures cannot work out for itself:
   * whether to transcode a KTX2 file to ASTC, to BC, or to nothing at all is
   * an answer about the card, not about the file. The renderer does not go out
   * with it — what leaves here is the question answered, the same shape as
   * {@link weave}, so that a layer still has no way to draw with it
   * (contract 1).
   *
   * Awaited on the way in, since three throws from `hasFeature` before the
   * backend is up. Not refused once the viewer is down: the device is there to
   * be asked either way, and a loader left untold throws on its first picture
   * and on every picture after it — including those of another viewer, since
   * the loader is shared by the place it was fetched from. See `ktx2.ts`.
   */
  async detectTextureSupport(loader: { detectSupport(renderer: WebGPURenderer): unknown }): Promise<void> {
    if (!this.started) await this.starting
    // What is handed over answers the two things three's loader asks of a
    // renderer and holds nothing else — `isWebGPURenderer`, and `hasFeature`
    // for each compressed form. Handing the renderer itself would be a door to
    // it (contract 1) through a parameter anyone can shape: a page passing
    // `{ detectSupport: (r) => kept = r }` would walk off with the renderer and
    // could draw to the canvas out of turn. The cast is to three's own
    // parameter type, which is wider than what it reads.
    loader.detectSupport({
      isWebGPURenderer: true,
      hasFeature: (name: string) => this.renderer.hasFeature(name),
    } as unknown as WebGPURenderer)
  }

  /**
   * Puts a layer's root in the scene and writes its stage on it, which is what
   * draws it in its place.
   *
   * The number is three's `groupOrder`, taken from the root's own
   * `renderOrder`; see `drawOrder` in `order.ts` for why that one and not the other.
   * Where the root sits among `scene.children` says nothing now — the renderer
   * sorts — so this is one line where it was a splice.
   *
   * Through `inStage` rather than written here, so that the root is opened on
   * every layer with the groups nested under it: three reads the number off a
   * group only in a pass whose camera can see it, and two of this viewer's
   * renders narrow the camera to one layer. See {@link inStage}.
   *
   * The viewer owns that number and that mask while the layer is on it, and
   * {@link Viewer.remove} gives both back. A layer wanting a place inside its
   * stage says it on what it draws, not here: the root is one number for the
   * lot of them.
   *
   * **And the layers of one stage go in the order they went on** (2026-10-28,
   * as Mapbox, deck.gl and Leaflet put theirs): the n-th of its stage is
   * seated a hair after the one before (`IN_STAGE`). It used to be the stage's
   * number alone for every one of them, and two that write no depth — two
   * pictures on the land, two groups of shapes over the city — were parted by
   * whichever of their centres the eye was nearer, which turns over as the
   * view does. Reordering is taking one off and putting it back on.
   *
   * What a layer nests under its root takes the stage's own number again
   * (`inStage`), and that is the first place of the stage; the layers that
   * nest groups are the city, the models and the solids, which write depth,
   * so it decides nothing between them. The land nests no group: its pieces
   * hang in bare `Object3D`s, which three walks through without reading a
   * number, so the place written here reaches them (2026-10-29, see
   * `Ground.groups`).
   */
  private seat(layer: Layer): void {
    inStage(layer.root, layer.stage)
    this.scene.add(layer.root)
    this.restage(layer.stage)
  }

  /** Puts the layers of one stage in the order they went on; see {@link seat}. */
  private restage(stage: Stage): void {
    let place = 0
    for (const layer of this.layers) {
      if (layer.stage !== stage || layer.root.parent !== this.scene) continue
      layer.root.renderOrder = drawOrder(stage) + place * IN_STAGE
      place += 1
    }
  }

  // ── Under the pointer ─────────────────────────────────────

  /**
   * Looks under the pointer for whoever listens for it coming onto things,
   * once it or the view has moved, or now and then while it stays still.
   * Not while a drag moves the view under it: that settles when it is let go.
   *
   * Looked for a layer that listens for clicks as well as for one that listens
   * for the pointer, because the cursor has to say which things answer one.
   * Nothing else can say it — what is under the pointer is only known by
   * looking — and a page that gives its city something to answer and leaves
   * the reader to guess where has given them nothing.
   */
  private lookUnderPointer(): void {
    this.framesSinceLook++
    const at = this.pointerAt
    if (
      !at ||
      !(
        this.listensFor('hover') ||
        this.listensFor('click') ||
        this.listensFor('pointing') ||
        this.listensFor('drag')
      )
    ) {
      this.under = null
      this.hoverOn(null)
      this.pointOn(null)
      this.showPointing(false)
      return
    }
    if (this.pressing || this.looking) return
    if (!this.underStale && this.framesSinceLook < LOOK_AGAIN_EVERY) return
    this.underStale = false
    this.framesSinceLook = 0
    this.looking = true
    void this.pick(at.x, at.y, at.event)
      .then((found) => {
        // Gone off the canvas meanwhile: the next frame lets go instead
        if (!this.pointerAt) return
        this.under = found
        this.hoverOn(found)
        this.pointOn(found)
        this.showPointing(found?.layer.listens?.('click') === true)
      })
      .finally(() => {
        this.looking = false
      })
  }

  /**
   * Says with the cursor whether what is under the pointer answers a click.
   *
   * Written here rather than left to the page: whether a thing answers is the
   * viewer's to know, and a page would have to ask every frame to find out.
   *
   * Nothing is written while a button is down. No look is taken while a drag
   * has hold of the view, so the only answer that can land during one is the
   * one that was already on its way when it took hold — taken where the pointer
   * then was, for a view that has moved since. {@link bindPointer} writes the
   * cursor again once the drag is let go.
   *
   * A turn being offered needs no guard of its own: {@link showCursor} answers
   * for it whoever asks.
   */
  private showPointing(on: boolean): void {
    if (this.pointing === on) return
    this.pointing = on
    if (this.pressing) return
    this.showCursor()
  }

  /**
   * The browser's own cursors, and only two of them: arrows every way while the
   * view turns or a drag would turn it, and a finger over anything that answers
   * a click. Everything else, the plain arrow.
   *
   * No hand at any point. An open one standing still would say the map is a
   * thing to pick up, which it is — but it says that everywhere, over every
   * reading of it, and a cursor that never changes tells a reader nothing. A
   * closed one while the map is actually being dragged says only what the map
   * moving under the pointer has already said, and says it by changing the one
   * mark on screen that was carrying a meaning. Left plain, the one time it
   * does change means something.
   *
   * The one place the cursor is written, so that no two answers can disagree.
   */
  private showCursor(): void {
    const cursor = this.pressMode === 'look' ? 'move' : this.pointing ? 'pointer' : RESTING_CURSOR
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor
  }

  /**
   * A click let go at `e`: tells the layer whose thing is there, if it listens,
   * and otherwise says that nothing answered.
   *
   * The look is taken for either — a page listening only for what nothing
   * answered still has to know that nothing did.
   */
  private clickAt(e: PointerEvent): void {
    if (!this.listensFor('click') && !this.events.has('click')) return
    const { x, y } = this.canvasPoint(e)
    void this.pick(x, y, e).then((found) => {
      if (this.disposed) return
      if (found?.layer.listens?.('click')) {
        found.layer.clicked?.(found.hit)
        return
      }
      if (!this.events.has('click')) return
      this.events.emit('click', { position: found?.hit.position ?? null, x, y, original: e })
    })
  }

  /**
   * Tells the layer under the pointer where it is, at every look.
   *
   * Nothing is compared, unlike {@link hoverOn}: the place moves although the
   * thing under it does not, and a layer that asked for this asked for the
   * moving. The layer the pointer has left is told once, so whatever it was
   * showing can be taken down.
   */
  private pointOn(found: { layer: Layer; hit: Hit } | null): void {
    const onto = found?.layer.listens?.('pointing') ? found : null
    const was = this.pointedOn
    if (was && was !== onto?.layer) was.pointed?.(null)
    this.pointedOn = onto?.layer ?? null
    onto?.layer.pointed?.(onto.hit)
  }

  /** Tells the layer the pointer came onto, and the one it came off, when that has changed. */
  private hoverOn(found: { layer: Layer; hit: Hit } | null): void {
    const onto = found?.layer.listens?.('hover') ? found : null
    const was = this.hovering
    if (!was && !onto) return
    if (
      was &&
      onto &&
      was.layer === onto.layer &&
      was.object === onto.hit.object &&
      was.item === onto.hit.item
    )
      return
    this.hovering = onto ? { layer: onto.layer, object: onto.hit.object, item: onto.hit.item } : null
    if (was && was.layer !== onto?.layer) was.layer.hovered?.(null)
    if (onto) onto.layer.hovered?.(onto.hit)
  }

  /** What lies under a point of the canvas, and the layer it belongs to. A frame or two in coming. */
  private async pick(
    x: number,
    y: number,
    original: PointerEvent,
  ): Promise<{ layer: Layer; hit: Hit } | null> {
    if (!this.drawing || this.disposed) return null
    // Reading a pixel back off the card takes a frame or two, and the viewer
    // may be disposed inside it: the target is gone, the device with it, and
    // the read gives up. That is this viewer ending, not an error the page
    // has anything to do about
    const picked = await this.picking
      .measure(this.renderer, this.scene, this.threeCamera, x, y, this.width, this.height)
      .catch(() => null)
    if (!picked || this.disposed) return null
    const layer = this.ownerOf(picked.object)
    if (!layer) return null
    const { x: px, y: py, z: pz } = picked.point
    const position = positionFromWorld(px, py, pz, this._elevation)
    const hit = { ...picked, position, x, y, original }
    return this.paintedOver(layer, hit) ?? { layer, hit }
  }

  /**
   * Whoever's paint covers what was found, since a colour painted onto the
   * picture stands in front of whatever it was laid on; see
   * {@link Layer.covers}.
   *
   * Asked of every layer that has an answer, and not only of the ones somebody
   * is listening to: whether a thing is in the way is the thing's own business
   * and not its audience's (see {@link ShapeBase.pickable}), and the two ways a
   * shape is found have to draw that line in one place or a wash and a drape of
   * one layer would answer differently. Nothing is asked when nobody listens to
   * anything, since no look is taken then at all.
   *
   * Every one of them is asked and the last to claim it wins, which is the one
   * added last. Not the one drawn last: two layers on one stage that write no
   * depth carry the same number and the renderer breaks that tie by distance,
   * so between two washes the picture and this can disagree. There is no depth
   * between them to settle it any better, and a page that needs the two
   * ordered puts their shapes in one layer, where the numbers run.
   */
  private paintedOver(drew: Layer, hit: Hit): { layer: Layer; hit: Hit } | null {
    const on = paintedIn(drew.stage)
    if (!on) return null
    let claim: { layer: Layer; item: number } | null = null
    for (const layer of this.layers) {
      if (!layer.covers) continue
      const item = layer.covers(hit, on)
      if (item !== null) claim = { layer, item }
    }
    return claim ? { layer: claim.layer, hit: { ...hit, item: claim.item } } : null
  }

  /** The layer that put a thing in the scene, found through what it hangs from. */
  private ownerOf(object: Object3D): Layer | undefined {
    let top: Object3D | null = object
    while (top && top.parent !== this.scene) top = top.parent
    return top ? this.owners.get(top) : undefined
  }

  /**
   * Asks every layer whose data it is drawing and says so, where that has
   * changed since the last frame.
   *
   * Compared before anything is written, because this runs every frame and
   * what it finds is the same answer nearly every time.
   */
  private gatherCredits(): void {
    const given: (readonly Credit[])[] = []
    for (const layer of this.layers) {
      const credits = layer.credits?.()
      if (credits && credits.length > 0) given.push(credits)
    }
    const all = gatherCredits(given)
    const key = creditKey(all)
    if (key === this.creditsKey) return
    this.creditsKey = key
    this._credits = Object.freeze([...all])
    this.creditsLine.set(all)
    if (this.events.has('credits')) this.events.emit('credits', { credits: this._credits })
  }

  /**
   * Whose data is on the screen now: the names the viewer's own line shows.
   *
   * The value beside the {@link ViewerEvents.credits} event, as `colors` is
   * beside its own. A page drawing a line of its own that listened after the
   * first frame heard nothing until the names next changed, and had nowhere
   * to read the ones already up. Frozen.
   */
  get credits(): readonly Credit[] {
    return this._credits
  }

  private _credits: readonly Credit[] = Object.freeze([])

  private listensFor(type: 'click' | 'hover' | 'pointing' | 'drag'): boolean {
    for (const layer of this.layers) if (layer.listens?.(type)) return true
    return false
  }

  private canvasPoint(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── Inside ────────────────────────────────────────────────

  private viewChanged(): void {
    this.underStale = true
    this.updateCamera()
    // The shading's radius is given in metres, so a change in the latitude being
    // looked at moves it into world units again
    if (this.occlusionPass) this.syncOcclusion()
    for (const layer of this.layers) layer.changed?.('view')
    // The page hears it with the next frame, once, however many writes came
    // in between: a trackpad sends several wheel turns a frame, and a page
    // that puts the view in React state was rendering once for each
    this.moveOwed = true
  }

  /** Tells the page the view moved, if it did since the last frame; see {@link viewChanged}. */
  private sayIfMoved(): void {
    if (!this.moveOwed) return
    this.moveOwed = false
    if (this.events.has('move')) this.events.emit('move', { view: this.camera.view })
  }

  /**
   * What so many pixels right and up on screen come to over the ground, in
   * world units.
   *
   * Dragging the view and zooming towards the cursor work it out the same way.
   * The projection is orthographic, so one screen pixel is the same distance
   * anywhere over the ground, and only the tilt stretches the vertical.
   */
  private acrossGround(
    right: number,
    up: number,
    zoom = this._zoom,
    heading = this._heading,
  ): { x: number; y: number } {
    return overTheGround(right, up, this.groundScale(zoom, heading))
  }

  /**
   * What a pixel is worth over the ground as the view stands, or as it will
   * at another zoom and heading; see {@link GroundScale}.
   */
  private groundScale(zoom = this._zoom, heading = this._heading): GroundScale {
    return {
      perPixel: this.widthAt(zoom) / this.width,
      lean: Math.max(0.2, Math.cos((this._pitch * Math.PI) / 180)),
      heading,
    }
  }

  /**
   * What the pointer could take hold of where it is, or nothing.
   *
   * Read off the last look rather than taken afresh; see {@link under}. A
   * layer that does not answer for drags is not one, and neither is bare
   * ground — the ground under the pointer is what moving the map is, and a
   * page that made the land takeable would have taken the map away with it.
   */
  /** A hold on what a press took, as the view stands at the moment it was taken; see {@link Carried}. */
  private holdOf(grab: { layer: Layer; hit: Hit }, e: PointerEvent): Carried {
    return {
      ...grab,
      x: e.clientX,
      y: e.clientY,
      scale: this.groundScale(),
      metres: metersPerUnit(grab.hit.position.lat),
    }
  }

  /**
   * Looks under a finger as it comes down, and hands on what can be carried
   * there — or nothing — while the press is still waiting on it.
   *
   * A finger has no look taken for it before it presses, as a mouse has for
   * its cursor, so it has to be taken now and waited for: a frame or two. A
   * finger could not take hold of anything at all before; a `draggable`
   * solid pressed on a phone panned the map instead.
   */
  private async lookUnderFinger(
    e: PointerEvent,
    waiting: () => boolean,
    then: (found: { layer: Layer; hit: Hit } | null) => void,
  ): Promise<void> {
    const { x, y } = this.canvasPoint(e)
    const found = await this.pick(x, y, e)
    if (!waiting()) return
    then(found && found.layer.listens?.('drag') ? found : null)
  }

  private takeable(): { layer: Layer; hit: Hit } | null {
    const found = this.under
    if (!found || !found.layer.listens?.('drag')) return null
    return { layer: found.layer, hit: found.hit }
  }

  /**
   * How far the hand has carried something since it went down, in metres east
   * and north.
   *
   * The camera is orthographic, so a step across the canvas is the same step
   * across the world whatever height the thing is at — a shape 60m up travels
   * exactly as far as one on the pavement under the same drag. That is the
   * whole reason this is a distance and not a place: a place has to be read
   * off some surface, and which surface is a question the pointer cannot
   * answer.
   *
   * Counted from where the button went down rather than added up frame by
   * frame, so that a drag ends exactly where the arithmetic says and a browser
   * that drops a move event loses nothing.
   *
   * **And counted in the view the hold began in**, which is the whole of what
   * {@link Carried} keeps. The view can change under a carry — the wheel is
   * nobody's to refuse and the right button turns whatever is held — and with
   * the pixels read against the view as it is now, one notch of the wheel
   * would rewrite a distance the hand had already travelled: 200 pixels that
   * were 48m become 37m and the thing jumps back a quarter of the way,
   * although the hand never moved. Against the view the hold began in, what
   * is answered is what the hand did.
   *
   * The metres are those of the place the thing was taken hold of, not of the
   * middle of the view. A world unit is a cosine of latitude of a metre, and
   * {@link Solid.carried} walks the distance out from the thing's own place —
   * so on a view that spans real latitude the middle's cosine is the wrong
   * one, by 15% between 35° and 45°.
   */
  private carriedTo(e: PointerEvent, taken: Carried): Dragging {
    const over = overTheGround(e.clientX - taken.x, taken.y - e.clientY, taken.scale)
    const { x, y } = this.canvasPoint(e)
    return { east: over.x * taken.metres, north: over.y * taken.metres, x, y, original: e }
  }

  /** The middle moved by that much in world units, given back as longitude and latitude. */
  private centerMovedBy(by: { x: number; y: number }): [number, number] {
    return [xToLon(lonToX(this._center[0]) + by.x), yToLat(latToY(this._center[1]) + by.y)]
  }

  private updateCamera(): void {
    const halfW = this.viewWidth / 2
    const halfH = (halfW * this.height) / this.width
    this.threeCamera.left = -halfW
    this.threeCamera.right = halfW
    this.threeCamera.top = halfH
    this.threeCamera.bottom = -halfH

    /*
     * The projection is orthographic, so distance does nothing to the picture
     * — but it does to the depth.
     *
     * Left generously open it comes to thousands of times the screen's width
     * at the closest zooms, and the numbers written into the depth buffer go
     * coarse enough that the screen-space shading can no longer tell where two
     * faces meet. It needs only to hold the tallest building and the ground
     * running away under a tilt.
     *
     * The land carrying its own heights asks for nothing more. What this
     * opens takes in anything up to about five times it standing above the
     * ground, and the floor alone is 1.6km: a view narrow enough for the
     * floor to be what decides is far too narrow to hold a mountain that
     * tall.
     */
    const reach = Math.max(this.viewWidth * 4, DEPTH_FLOOR)
    this.threeCamera.near = -reach
    this.threeCamera.far = reach * 2

    const target = this.worldFromLngLat(this._center[0], this._center[1])
    // On the land, not on the sea it would be at; see followLand
    target.y = this.landHere
    const pitch = (this._pitch * Math.PI) / 180
    const heading = (this._heading * Math.PI) / 180
    const dir = new Vector3(
      Math.sin(pitch) * Math.sin(heading),
      Math.cos(pitch),
      Math.sin(pitch) * Math.cos(heading),
    )
    this.threeCamera.position.copy(target).addScaledVector(dir, reach)
    // Giving the sky as up leaves nothing to say which way the screen stands
    // when it looks straight down (tilt 0): up and the way it looks are the
    // same line. three falls back to north-up there, so reaching 0 with the
    // heading turned spins the screen round in one frame. The top of the
    // screen is always the way the heading points, so that is given as up.
    this.threeCamera.up.set(-Math.sin(heading), 0, -Math.cos(heading))
    this.threeCamera.lookAt(target)
    this.threeCamera.updateProjectionMatrix()
    // A layer has to be able to ask where a place falls on screen. This matrix
    // is brought up to date as things are drawn, so without doing it here it
    // would answer for the frame before.
    this.threeCamera.updateMatrixWorld()
    this.threeCamera.matrixWorldInverse.copy(this.threeCamera.matrixWorld).invert()
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    // A canvas in a hidden tab, or measured before its stylesheet lands,
    // reads nothing at all. Drawing at one pixel is harmless — the next
    // resize puts it right — but fitting to it is not: it would land at the
    // furthest zoom out and count as the fit having happened
    const measured = rect.width >= 1 && rect.height >= 1
    if (measured) this.measured = true
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    const markup = this.markup.style
    markup.left = `${this.canvas.offsetLeft}px`
    markup.top = `${this.canvas.offsetTop}px`
    markup.width = `${rect.width}px`
    markup.height = `${rect.height}px`
    if (this.drawing) {
      // Zooming the page changes the ratio. Left at what it first was, a Retina
      // display at 50% would draw four times the pixels it shows, and a window
      // carried over from a 1x display would stay blurred
      const ratio = this.ratioNow()
      if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio)
      this.renderer.setSize(this.width, this.height, false)
    }
    const owed = this.pendingFit
    if (owed && measured) {
      this.pendingFit = null
      this.fitTo(owed.bounds, owed.padding, owed.share, owed.keepCenter)
    }
    // Whether the fit moved anything or not: the five numbers may all be the
    // same, but a wider or narrower screen shows another stretch of ground
    this.viewChanged()
  }

  /**
   * @internal The page fits through {@link Camera.fitBounds}.
   *
   * Sets the middle and the zoom so that a rectangle of longitude and latitude
   * fits on screen.
   *
   * The page asking to look somewhere, so whatever was moving the view gives
   * way. The viewer's own first fit — when no zoom was given — takes the
   * quieter way in and never takes the view off anyone.
   *
   * A rectangle that is not four real numbers moves nothing. A page usually
   * hands over a rectangle it worked out from something it loaded, and the
   * answer over nothing loaded is the empty one — every corner at infinity.
   * Fitted, that is a middle at `NaN`, and a `NaN` middle is not a bad view
   * but the end of the view: every drag and every wheel turn is arithmetic on
   * it from then on, so nothing the reader does brings the map back. Better to
   * stay where we are, which is the honest answer to being asked to look at
   * nothing.
   */
  fitBounds(bounds: MapBounds, given = 0): void {
    const corners = [...bounds.southWest, ...bounds.northEast]
    if (!corners.every((corner) => Number.isFinite(corner))) return
    const padding = Number.isFinite(given) ? Math.max(0, given) : 0
    this.stop()
    // Kept rather than worked out, where the canvas has not said how big it is
    // yet. A page fits to what it fetched, and a file that beats the
    // stylesheet in would be fitted to one pixel — which is the furthest zoom
    // out, and looks to the reader like the map never loaded. The rectangle
    // asked for replaces whatever was owed, so the last page to ask wins, as
    // it would have if the canvas had been ready.
    if (!this.measured) {
      this.pendingFit = { bounds, padding }
      return
    }
    this.pendingFit = null
    this.fitTo(bounds, padding)
  }

  private fitTo(bounds: MapBounds, padding: number, share = 1, keepCenter = false): void {
    const minX = lonToX(bounds.southWest[0])
    const maxX = lonToX(bounds.northEast[0])
    const minY = latToY(bounds.southWest[1])
    const maxY = latToY(bounds.northEast[1])

    // The rectangle as it lies on the screen. Turned, each of its sides
    // reaches across both of the screen's axes; tilted, what runs up the
    // screen is shortened by the same lean a drag is (see `groundScale`).
    // Fitted east-west to the width and north-south to the height alone, a
    // view turned a quarter put a long strip's length up the short side.
    const turn = (this._heading * Math.PI) / 180
    const cos = Math.abs(Math.cos(turn))
    const sin = Math.abs(Math.sin(turn))
    const lean = Math.max(0.2, Math.cos((this._pitch * Math.PI) / 180))
    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)
    const across = spanX * cos + spanY * sin
    const upward = (spanX * sin + spanY * cos) * lean
    // The screen less the margin on both sides, and never less than a pixel:
    // a margin wider than the screen is a page asking for nothing, and a zoom
    // worked out from a negative width is not a zoom
    const wide = Math.max(1, this.width - 2 * padding)
    const high = Math.max(1, this.height - 2 * padding)
    const byWidth = (wide / TILE_PIXELS) * (EARTH_CIRCUMFERENCE / across)
    const byHeight = (high / TILE_PIXELS) * (EARTH_CIRCUMFERENCE / upward)

    const zoom = Math.log2(Math.min(byWidth, byHeight) * share)
    this.placeView(
      keepCenter ? { zoom } : { center: [xToLon((minX + maxX) / 2), yToLat((minY + maxY) / 2)], zoom },
    )
  }

  /**
   * What each button does.
   *
   * The left one moves the map and the right one turns the view. A left press
   * let go about where it went down is a click; a right one is a turn that
   * did not happen, and clicks nothing. The wheel zooms.
   *
   * No modifier is watched, which is the point of the right button carrying
   * the turn: ⌘ and Ctrl are the page's to take, and a page that wants one —
   * to pick several buildings out with a rectangle of its own, say — listens
   * on the canvas and is not fought for it.
   *
   * One pointer at a time. A second finger coming down while the first is
   * pressing is not heard: taken as a press of its own it put the drag's last
   * place where it came down, and the map jumped the width of the hand.
   *
   * The same presses over a page's own mark ({@link Html}), which takes its
   * pointers back so that a button in it is a button, and so never passes
   * them to the canvas. The map was dead under every card: a drag that began
   * on one moved nothing, the right button opened the browser's menu, and a
   * click on one was heard by nobody. Taken here, a press on a mark is the
   * mark's until it moves — the map does not take the pointer while it is
   * still a click, or the button under it would never hear one — and the
   * map's from the moment it is a drag. What the page acted on itself is the
   * page's, and so is a field the reader is typing or selecting in.
   */
  private bindPointer(): void {
    let lastX = 0
    let lastY = 0
    /** Where the button went down, and whether the pointer has wandered far enough since to be a drag */
    let downX = 0
    let downY = 0
    let dragged = false
    /** Which pointer is pressing, and with which button */
    let pressId: number | null = null
    let button = 0
    /** The mark the press went down on, where it went down on one */
    let onMark: PressedMark | null = null
    /**
     * Whether a press on a mark is still waiting to be a drag. Until it is,
     * nothing holds the pointer, so it is followed over the whole document:
     * let go off the map, it would otherwise press for ever.
     */
    let loose = false

    // Once here, so the canvas carries an inline cursor before anything is
    // under the pointer to ask about
    this.showCursor()

    // A Mac's ctrl+click is its right click too, and would open the menu as a turn begins
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    const capture = (id: number) => {
      try {
        this.canvas.setPointerCapture(id)
      } catch {
        // The pointer is already gone. The drag carries on without the capture.
      }
    }

    /** What a press with this button does to the view, given the gestures the page left on. */
    const doing = (e: PointerEvent, took: boolean): typeof this.pressMode => {
      if (took) return 'carry'
      if (e.button === 2) return this.dragRotate.enabled ? 'look' : 'none'
      if (e.button !== 0) return 'none'
      // One finger pans as a pointer does, as Mapbox's dragPan takes both. Off,
      // the press still clicks where it is let go
      return this.dragPan.enabled ? 'move' : 'still'
    }

    const press = (e: PointerEvent, mark: PressedMark | null) => {
      if (pressId !== null) return
      // A pen or a tap on a touchpad can come down where no move was heard
      if (!mark) this.follow(e)
      // The right button turns, whatever is held — on a Mac ctrl+click arrives
      // as button 2 and turns, which is what it has always done there.
      // Something takeable under the pointer takes the press before the map
      // does; see {@link under}. The right button is the view's whatever is
      // there — a page carrying a thing still has to be able to turn the city
      // round it.
      // Asked before the map is given the press, and the layer may say no:
      // one of its things is takeable, the one under the pointer need not be.
      //
      // The hold is worked out before it is asked for, since the question
      // itself carries a distance — nought, this being where it began — and
      // the distance is read against the view of this moment; see
      // {@link carriedTo}.
      //
      // A finger is asked afresh, below: the look this is answered out of is
      // the one taken for the cursor, and `follow` leaves touch alone — so it
      // would be handed whatever the cursor was last over. Nor does a press
      // on a mark: what the cursor was last over is the city under the card.
      const finger = e.pointerType === 'touch'
      const grab = !mark && e.button === 0 && !finger ? this.takeable() : null
      const hold = grab ? this.holdOf(grab, e) : null
      const took = hold !== null && hold.layer.dragged?.(hold.hit, this.carriedTo(e, hold), 'start') === true
      // A finger over a map where something may be carried waits for the look
      // under it before it decides, and moves nothing meanwhile: a pan begun
      // under a finger meaning to carry would drag the map out from under it
      const asks = finger && !mark && e.button === 0 && this.listensFor('drag')
      this.pressMode = asks ? 'pending' : doing(e, took)
      this.showCursor()
      if (this.pressMode === 'none') return
      pressId = e.pointerId
      button = e.button
      onMark = mark
      lastX = downX = e.clientX
      lastY = downY = e.clientY
      dragged = false
      if (took) this.carrying = hold
      this.pressing = true
      if (mark) {
        loose = true
        document.addEventListener('pointermove', looseMove, true)
        document.addEventListener('pointerup', looseUp, true)
        document.addEventListener('pointercancel', looseUp, true)
        return
      }
      // Someone taking hold of the view stops whatever was flying it — but not
      // a press that will not move it
      if (this.pressMode !== 'still') this.stop()
      capture(e.pointerId)
      if (asks)
        void this.lookUnderFinger(
          e,
          () => pressId === e.pointerId && this.pressMode === 'pending',
          (found) => {
            const held = found ? this.holdOf(found, e) : null
            const carries =
              held !== null && held.layer.dragged?.(held.hit, this.carriedTo(e, held), 'start') === true
            if (carries) this.carrying = held
            this.pressMode = doing(e, carries)
            if (this.pressMode !== 'still') this.stop()
          },
        )
    }

    const move = (e: PointerEvent) => {
      if (this.pressMode === 'none' || e.pointerId !== pressId) return
      if (!dragged && Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP) {
        dragged = true
        // A press on a mark has turned out to be a drag, and is the map's now
        if (loose) {
          letGo()
          if (this.pressMode !== 'still') this.stop()
          capture(e.pointerId)
        }
      }
      // Still a click on the mark, or a finger still being looked under. The
      // map waits rather than creeping under it, and catches the few pixels up
      // when it does move
      if (loose || this.pressMode === 'pending') return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      if (dx === 0 && dy === 0) return
      if (this.pressMode === 'still') return
      if (this.pressMode === 'carry') {
        const held = this.carrying
        if (held) held.layer.dragged?.(held.hit, this.carriedTo(e, held), 'move')
        return
      }
      if (this.pressMode === 'look') {
        // Dragged right the scene turns right; dragged up it lies further back
        this.setView({
          heading: this._heading - dx * LOOK_SPEED,
          pitch: this._pitch - dy * LOOK_SPEED,
        })
        return
      }

      // For the scene to follow the drag, the middle goes the other way
      this.setView({ center: this.centerMovedBy(this.acrossGround(-dx, dy)) })
    }

    const stop = (e: PointerEvent) => {
      if (e.pointerId !== pressId) return
      const held = this.carrying
      if (held) {
        this.carrying = null
        held.layer.dragged?.(held.hit, this.carriedTo(e, held), 'end')
      }
      letGo()
      pressId = null
      onMark = null
      this.pressMode = 'none'
      this.pressing = false
      // The view may have moved under a pointer that stood still
      this.underStale = true
      this.showCursor()
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
      } catch {
        // Already released
      }
    }

    const release = (e: PointerEvent) => {
      if (e.pointerId !== pressId) return
      // Let go about where it went down: a click, not the end of a drag — and
      // only for the left button, which is the one that clicks
      const clicked = !dragged && button === 0
      const mark = onMark
      stop(e)
      if (!clicked) return
      if (mark) {
        const { x, y } = this.canvasPoint(e)
        mark.pressed(x, y, e)
      } else this.clickAt(e)
    }

    function looseMove(e: PointerEvent): void {
      move(e)
    }
    function looseUp(e: PointerEvent): void {
      // A finger lifted off a card never reaches the canvas, which is where
      // the fingers are otherwise let go of: left counted, the next finger
      // down anywhere would be taken for the second of a pair
      if (e.pointerType === 'touch') fingers.delete(e.pointerId)
      if (e.type === 'pointercancel') stop(e)
      else release(e)
    }
    function letGo(): void {
      if (!loose) return
      loose = false
      document.removeEventListener('pointermove', looseMove, true)
      document.removeEventListener('pointerup', looseUp, true)
      document.removeEventListener('pointercancel', looseUp, true)
    }

    /*
     * Two fingers, as a phone's map takes them: spread or pinched they zoom
     * about the place between them, turned they turn the view, and moved
     * together they carry the map; moved up or down side by side they tip it
     * back or forward (Mapbox's touchZoomRotate and touchPitch).
     *
     * Which of the two a gesture is, is settled by how it starts and kept
     * until a finger lifts: a pinch that wanders a little up the screen does
     * not tip the view half way through.
     *
     * One finger at a time used to be all there was. A second coming down was
     * not heard, and before that it was heard as a press of its own that put
     * the drag's last place where it landed, and the map jumped the width of
     * the hand.
     */
    const fingers = new Map<number, { x: number; y: number }>()
    let pair: {
      readonly a: number
      readonly b: number
      span: number
      angle: number
      mid: { x: number; y: number }
      kind: 'undecided' | 'zoomRotate' | 'pitch'
    } | null = null

    const pairNow = (a: number, b: number) => {
      const one = fingers.get(a)!
      const two = fingers.get(b)!
      return {
        span: Math.max(1, Math.hypot(two.x - one.x, two.y - one.y)),
        angle: Math.atan2(two.y - one.y, two.x - one.x),
        mid: { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 },
        level: Math.abs(two.y - one.y) < Math.abs(two.x - one.x),
      }
    }

    const fingerDown = (e: PointerEvent): boolean => {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (fingers.size !== 2) return fingers.size > 2
      if (!this.touchZoomRotate.enabled && !this.touchPitch.enabled) return false
      // The one finger's press becomes the pair's: whatever it was carrying is
      // put down where it is, and it clicks nothing when it lifts
      const first = pressId
      if (first !== null && first !== e.pointerId) {
        dragged = true
        const held = this.carrying
        if (held) {
          this.carrying = null
          held.layer.dragged?.(held.hit, this.carriedTo(e, held), 'end')
        }
        this.pressMode = 'none'
      }
      const [a, b] = [...fingers.keys()] as [number, number]
      const now = pairNow(a, b)
      pair = { a, b, span: now.span, angle: now.angle, mid: now.mid, kind: 'undecided' }
      this.stop()
      // Both held by the canvas from here. A finger that came down on a card
      // was followed over the document while it might still be a click on
      // it; it is the pair's now, and its moves have to come where the
      // pair's are read
      letGo()
      capture(a)
      capture(b)
      this.pressing = true
      return true
    }

    const fingerMove = (e: PointerEvent): boolean => {
      const finger = fingers.get(e.pointerId)
      if (!finger) return false
      const was = { ...finger }
      finger.x = e.clientX
      finger.y = e.clientY
      if (!pair || (e.pointerId !== pair.a && e.pointerId !== pair.b)) return pair !== null
      const now = pairNow(pair.a, pair.b)
      if (pair.kind === 'undecided') {
        // Both fingers going the same way up or down, side by side, is a tip;
        // anything else is a pinch and a turn. Settled once there is a few
        // pixels' worth to go on
        const dy = e.clientY - was.y
        const travelled =
          Math.hypot(now.mid.x - pair.mid.x, now.mid.y - pair.mid.y) + Math.abs(now.span - pair.span)
        if (travelled < CLICK_SLOP) return true
        const vertical = Math.abs(now.mid.y - pair.mid.y) > Math.abs(now.mid.x - pair.mid.x) * 2
        const steady = Math.abs(now.span - pair.span) < Math.abs(now.mid.y - pair.mid.y)
        pair.kind =
          now.level && vertical && steady && dy !== 0 && this.touchPitch.enabled ? 'pitch' : 'zoomRotate'
        if (pair.kind === 'zoomRotate' && !this.touchZoomRotate.enabled) pair.kind = 'pitch'
      }
      if (pair.kind === 'pitch') {
        if (this.touchPitch.enabled)
          this.setView({ pitch: this._pitch - (now.mid.y - pair.mid.y) * LOOK_SPEED })
      } else if (this.touchZoomRotate.enabled) {
        // About the place between the fingers, as the wheel zooms about the
        // cursor: that place stays under them while they spread and turn, and
        // goes where they go when they move together.
        //
        // The place's ground offset from the middle is read twice, at the view
        // as it stands and at the zoom and heading it is going to, and the
        // middle moved by the difference. Read only at the new zoom, the turn
        // went about the middle of the screen: a place a third of the way down
        // a phone swung 286 pixels off the fingers over a 30° turn (measured,
        // CDP touch on the playground).
        //
        // The spread and the turn are the wheel's kind of move and are kept off
        // the slope as it keeps them ({@link overTheLand}): neither asks the
        // picture to slide. The fingers moving together are a drag, and a drag
        // follows the ground.
        const rect = this.canvas.getBoundingClientRect()
        const right = pair.mid.x - rect.left - this.width / 2
        const up = this.height / 2 - (pair.mid.y - rect.top)
        const zoom = this.clampZoom(this._zoom + Math.log2(now.span / pair.span))
        const turn = ((now.angle - pair.angle) * 180) / Math.PI
        const heading = this._heading - turn
        const before = this.acrossGround(right, up)
        const after = this.acrossGround(right, up, zoom, heading)
        const kept = this.overTheLand({ x: before.x - after.x, y: before.y - after.y })
        const carried = this.acrossGround(-(now.mid.x - pair.mid.x), now.mid.y - pair.mid.y, zoom, heading)
        this.setView({
          zoom,
          heading,
          center: this.centerMovedBy({ x: kept.x + carried.x, y: kept.y + carried.y }),
        })
      }
      pair.span = now.span
      pair.angle = now.angle
      pair.mid = now.mid
      return true
    }

    const fingerUp = (e: PointerEvent): boolean => {
      if (!fingers.delete(e.pointerId)) return false
      if (!pair) return false
      if (e.pointerId !== pair.a && e.pointerId !== pair.b) return true
      pair = null
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
      } catch {
        // Already released
      }
      // The finger left behind carries the map on, from where it is, and
      // clicks nothing when it lifts
      const [left] = [...fingers.entries()]
      if (left && this.dragPan.enabled) {
        const [id, at] = left
        pressId = id
        button = 0
        onMark = null
        lastX = downX = at.x
        lastY = downY = at.y
        dragged = true
        this.pressMode = 'move'
        return true
      }
      pressId = null
      this.pressMode = 'none'
      this.pressing = false
      this.underStale = true
      this.showCursor()
      return true
    }

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && fingerDown(e)) return
      press(e, null)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && fingerMove(e)) return
      this.follow(e)
      move(e)
    })
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && fingerUp(e)) return
      release(e)
    })
    this.canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch' && fingerUp(e)) return
      stop(e)
    })

    // Held while dragging, so this comes only once the pointer is let go off the canvas
    this.canvas.addEventListener('pointerleave', () => {
      this.pointerAt = null
    })

    this.markup.addEventListener('pointerdown', (e) => {
      if (e.defaultPrevented || typedInto(e.target)) return
      const mark = pressedOn(e.target, this.markup)
      if (!mark) return
      // Counted as a finger like one on the canvas, so that a pinch with one
      // finger on a card is a pinch. Not counted, the map heard only the
      // other finger and did nothing at all (measured, CDP touch)
      if (e.pointerType === 'touch' && fingerDown(e)) return
      press(e, mark)
    })
    this.markup.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented || typedInto(e.target) || !pressedOn(e.target, this.markup)) return
      e.preventDefault()
    })

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        // Turned off, the wheel is the page's to scroll with, as if the map
        // were not there
        if (!this.scrollZoom.enabled) return
        e.preventDefault()
        this.zoomAt(e)
      },
      { passive: false },
    )

    /*
     * The same wheel, over what a page has stood on the map.
     *
     * A mark takes its own pointers back (`markup` lets them through and what
     * is in it does not), so a wheel turned over one never reaches the canvas
     * and never reaches the listener above. Nothing then calls
     * `preventDefault`, the browser chains the scroll up out of the map, and
     * what moves is the page the map is on — in the site, the page outside the
     * frame. So the map stood still and the reader's own page jumped.
     *
     * Taken here instead, where the mark's own scrolling comes first: a card
     * with more in it than fits scrolls, as it would anywhere else, and only
     * once it has nothing left to give does the turn go to the map. A label
     * with nothing to scroll hands every turn straight over, so standing a
     * name on the city does not put a hole in the map under it.
     *
     * Three states and this is the only one of them that is all three:
     * `overscroll-behavior` alone would stop the page jumping and leave the
     * map dead under the mark, and taking every turn for the map would stop a
     * card scrolling at all.
     */
    this.markup.addEventListener(
      'wheel',
      (e) => {
        // What the page has already acted on is the page's. A mark that is a
        // stepper or a chart handles the wheel and says so the one way the
        // platform has; this runs after it, in the bubble, and zooming the
        // city on top of it would move the map every time the reader adjusted
        // the control.
        if (e.defaultPrevented || !this.scrollZoom.enabled) return
        // A pinch is a wheel with ctrl held, and it never scrolls anything —
        // so no box has room for it, and asking is asking the wrong question.
        // Left to the browser it zooms the whole document, which is the very
        // thing this listener is here to take away.
        if (!e.ctrlKey && scrollRoomIn(e, this.markup)) return
        e.preventDefault()
        // Nothing had room for a turn that was mostly sideways, and the map
        // has no sideways answer either: it zooms by `deltaY`, which is the
        // axis the reader was not using. Swallowed rather than acted on — the
        // `preventDefault` above is what this listener is for — so that a
        // diagonal swipe over a card does not walk the city half a zoom step
        // on the events where the sideways pixels happen to win. A pinch is
        // exempt: it carries its whole amount on `deltaY`.
        if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
        this.zoomAt(e)
      },
      { passive: false },
    )

    // And over the credits, which stand in the container's corner beside the
    // canvas rather than in it: a wheel turned there scrolled the reader's
    // page, the very jump the listener above is for. Nothing in the line
    // scrolls, so every turn is the map's
    this.creditsLine.element.addEventListener(
      'wheel',
      (e) => {
        if (!this.scrollZoom.enabled) return
        e.preventDefault()
        this.zoomAt(e)
      },
      { passive: false },
    )
  }

  /** Zooms for a turn of the wheel, about the place under the cursor. */
  private zoomAt(e: WheelEvent): void {
    const asPixels = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1
    const next = this.clampZoom(this._zoom - e.deltaY * asPixels * ZOOM_PER_PIXEL)
    if (next === this._zoom) return

    /*
     * Moves the middle so that whatever was under the cursor stays under it.
     *
     * Zooming into the middle alone pushes what you wanted to look at off the
     * screen as you close in, and you end up dragging it back and rolling
     * again, over and over. Instead: where the same screen point fell over the
     * ground before the zoom and after, and the middle pushed back by the
     * difference.
     */
    const { x, y } = this.canvasPoint(e)
    const right = x - this.width / 2
    const up = this.height / 2 - y
    const before = this.acrossGround(right, up)
    const after = this.acrossGround(right, up, next)
    this.setView({
      zoom: next,
      center: this.centerMovedBy(this.overTheLand({ x: before.x - after.x, y: before.y - after.y })),
    })
  }

  /**
   * That move over the ground, nudged for how high the ground it lands on is.
   *
   * The middle of the view stands on the land — {@link followLand} puts it
   * there every frame — and the land's height is the one thing in the whole
   * projection that slides the picture up and down the screen: the camera
   * looks along `(0, sin pitch, -cos pitch)`, so a metre of it is
   * `sin(pitch)` of a metre of screen. Move the middle over a slope and the
   * picture lifts or drops by that much, whether anybody asked it to or not.
   *
   * Dragging asks for exactly that, and it is what the map following the
   * ground means. A zoom does not: what a zoom asks for is that the place
   * under the cursor stay under the cursor, and it contains no sliding at all.
   * So every turn of the wheel with the cursor off the middle threw the
   * picture up or down by however much the ground had risen or fallen in
   * between — and since the wheel goes both ways over the same slope, the
   * picture shook. Measured at 御殿場, a turn of the wheel with the cursor a
   * third of a screen up: the land under the middle went 511m, 496m, 512m,
   * 494m over four turns, which is 23 pixels of shake each way.
   *
   * Undone by moving the middle the other way along the slope: a rise of `r`
   * lifts the picture by `r·sin(pitch)`, and going `r·tan(pitch)` back down
   * the heading drops it by the same.
   *
   * Except that going back down the slope lands the middle on ground of its
   * own height, so the rise to be undone is not the one first read. Asking
   * again and again from the new place settles it on gentle ground and runs
   * away on steep — so instead the ground is read twice, once where the zoom
   * would have put the middle and once where the first guess would, and the
   * slope between those two answers is used to solve the thing outright:
   * `guess / (1 + slope·tan(pitch))`. Two readings of a tile already in hand,
   * once a turn of the wheel rather than once a frame, and no loop to run
   * away. What it cannot answer is said in {@link LEAST_SETTLE}.
   *
   * At no tilt there is nothing to undo — a metre of land is no pixels of
   * screen — and the sum falls out to nothing on its own.
   */
  private overTheLand(by: { x: number; y: number }): { x: number; y: number } {
    if (!this._elevation) return by
    const lean = Math.tan((this._pitch * Math.PI) / 180)
    if (lean <= 0) return by
    const heading = (this._heading * Math.PI) / 180
    const alongHeading = (north: number) => ({
      x: by.x - north * Math.sin(heading),
      y: by.y + north * Math.cos(heading),
    })
    // Against the land under the middle as it stands, not against the height
    // the camera happens to be holding: that one is written once a frame, and
    // a wheel sends more than one turn between two frames whenever the frames
    // are slow or a trackpad is quick. Read here, each turn undoes the rise
    // over its own move and the turns add up to the whole of it; read off the
    // camera, every turn after the first undoes a rise that was already undone.
    const here = this.landAt(this._center[0], this._center[1])
    const riseAt = (north: number) => {
      const [lon, lat] = this.centerMovedBy(alongHeading(north))
      return this.landAt(lon, lat) - here
    }
    const rise = riseAt(0)
    const guess = -rise * lean
    if (guess === 0) return by
    // How much the ground itself rose over that guess, which is the slope the
    // middle would be walking back down
    const slope = (riseAt(guess) - rise) / guess
    const settle = 1 + slope * lean
    if (settle < LEAST_SETTLE) return by
    return alongHeading(guess / settle)
  }

  /** Notes where the pointer is, to look under it. A finger points at nothing between touches. */
  private follow(e: PointerEvent): void {
    if (e.pointerType === 'touch') return
    const { x, y } = this.canvasPoint(e)
    this.pointerAt = { x, y, event: e }
    this.underStale = true
  }

  /**
   * Lets everything this viewer holds go. Safe to call twice, and safe to
   * call while it is still starting.
   *
   * The layers it still holds go with it. Take one off with
   * {@link remove} first to keep it.
   *
   * Stays synchronous, because the places that call it are: a React cleanup,
   * a router leaving, `beforeunload`. The renderer is the one thing that
   * cannot be torn down here and now — three only frees a renderer that has
   * finished starting, and both `setAnimationLoop` and `dispose` bring one
   * that has not up first, which would hand back a device nobody would ever
   * free. So the teardown is hung off the start instead, and runs the moment
   * there is something to tear down.
   */
  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.lifetime.abort()
    this.resizeObserver.disconnect()
    // The layers go with it. One made for this viewer — which is nearly all of
    // them — would otherwise be left holding a material nobody will free, and
    // a page that means to keep one takes it off first.
    for (const layer of this.layers) {
      layer.detach()
      this.scene.remove(layer.root)
      layer.dispose?.()
    }
    this.layers.clear()
    this.owners.clear()
    this._maskArea?.dispose()
    this.own.clear()
    this.hovering = null
    // Both hold a `Hit`, which holds the mesh it was found on, which holds the
    // scene. Nothing is told it was let go of: this function says nothing to
    // the layers it is taking down — the line above says nothing either — and
    // a page's `dragend` reaching it in the middle of a teardown is a promise
    // the viewer has never made.
    this.under = null
    this.carrying = null
    this.picking.dispose()
    this.outlines.dispose()
    this.underground.dispose()
    // The stacks of pictures thrown over the map, after the layers have taken
    // theirs off it above
    this.projection.dispose()
    this.sight.dispose()
    this.landHeights.dispose()
    // The fourth of the viewer's own passes, and the only one that is not
    // always there: it is made where a page asks for shading and unmade where
    // it takes the ask away, which until now was the only place it was freed.
    // A page that mounts and unmounts a map left a depth sheet half again the
    // canvas, its GTAO target and a woven material behind each time round.
    this.occlusionPass?.dispose()
    this.occlusionPass = null
    this.tiltShiftPass?.dispose()
    this.tiltShiftPass = null
    this.creditsLine.dispose()
    this.canvas.remove()
    // All three of the viewer's own go back, not two of them. The sheet the
    // marks stand on is as much the viewer's as the canvas is — a page that
    // mounts and unmounts a map was left one of these in its container every
    // time round, stacked over the live one and catching nothing, since it
    // takes no pointer
    this.markup.remove()
    // And the one line this wrote on the page's own element, back as the page
    // had it: left, a container a React page mounted a map in once was laid
    // out `position: relative` for the rest of the visit
    if (this.placedContainer) {
      this.placedContainer.element.style.position = this.placedContainer.position
      this.placedContainer = null
    }
    // Never started, or started and failed: the renderer holds no device, and
    // asking it to stop would be asking it to start
    const shut = (): void => {
      if (this.started) this.shut()
    }
    void this.starting.then(shut, shut)
  }

  /** Stops the frames and gives the device back. Only ever after the renderer has started. */
  private shut(): void {
    this.renderer.setAnimationLoop(null)
    this.lights.dispose()
    void this.renderer.dispose()
  }
}

/**
 * The element a viewer was asked to go in.
 *
 * An id is looked up here so that it is looked up once and said once: a page
 * that mistypes it gets a sentence naming what it asked for, rather than
 * whatever `null` breaks first. The sentence says what is taken, too, since
 * the other thing a hand reaches for is a selector.
 */
function elementOf(container: HTMLElement | string): HTMLElement {
  if (typeof container !== 'string') return container
  const found = document.getElementById(container)
  if (!found) {
    throw new Error(`Viewer: no element has the id "${container}" — container takes an element or its id`)
  }
  return found
}

/** A page's theme in the palette's own words, which is how it is held. */
function paletteOf(theme: Theme | undefined): Partial<Record<ColorName, ThemeColor>> {
  const held: Partial<Record<ColorName, ThemeColor>> = {}
  if (!theme) return held
  for (const name of COLOR_NAMES) {
    const asked = theme[name]
    if (asked !== undefined) held[name] = spelledOnce(asked)
  }
  return held
}

/**
 * A page's colour in the one spelling the palette keeps them in, a pair's two
 * halves included.
 *
 * The pair is kept a pair — reading it down to a single colour here would
 * throw away the half the sun has not asked for yet. And frozen, since it is
 * the viewer's own and goes out by reference inside the frozen copy
 * {@link Viewer.theme} hands back: a freeze one level deep would leave the
 * pair inside it open to a write that the palette took up the next time it
 * was built, with nobody told.
 */
function spelledOnce(color: ThemeColor): ThemeColor {
  return typeof color === 'object' && color !== null && 'light' in color && 'dark' in color
    ? Object.freeze({ light: new Color(color.light).getStyle(), dark: new Color(color.dark).getStyle() })
    : new Color(color as ColorRepresentation).getStyle()
}
