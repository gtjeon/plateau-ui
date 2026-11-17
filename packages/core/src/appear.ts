import { Fn, attribute, float, uniform as unwatched, varying } from 'three/tsl'
import { uniform } from './repaint.js'
import { BufferAttribute, type Mesh, type Node } from 'three/webgpu'

/**
 * Things coming up out of the ground as they arrive, and going back under it
 * as they leave.
 *
 * A tile arrives all at once and, without this, a whole block of city springs
 * into being between two frames; a view stepping back out of the zooms the
 * buildings stand at takes the same block away just as suddenly. Each building
 * instead comes up out of the ground, whole, from a little below its own
 * height, and goes back down the way it came. They do not all set off
 * together, or a tile would read as a slab rising rather than as a street
 * filling up. The trees of a park come and go the same way, in the same
 * breath, since they stand on the same ground and leave at the same zoom, and
 * the green they stand on washes in under them — a patch lying flat on the
 * ground cannot rise out of it, but it can arrive.
 *
 * It rises rather than growing. A building grown from nothing is a building
 * squashed flat and pulled upright, which is a thing no building does; one
 * that comes up from below is the shape it will be the whole way. The part
 * still under the ground hides itself, by {@link overGround}: the ground does
 * write its own depth, and did the hiding until there was a mask, but a mask
 * leaves stretches of the picture with no ground in them at all.
 *
 * Two numbers on each corner are all it takes — when the thing it belongs to
 * sets off, and how far under the ground the far end of its way lies — since
 * everything here is seated on a nought of its own and so comes and goes from
 * its own. The sign of the second says which way it is going: under by that
 * much to begin with, or under by that much at the end.
 */

/** Where a corner says when it sets off and how far under the far end of its way lies. */
export const APPEAR = 'appear'

/** Which way a thing is going. */
export type Way = 'up' | 'down'

/** How a tile's buildings come and go, in seconds, where none is given. On. */
export const DEFAULT_APPEAR = { enabled: true, duration: 0.8, stagger: 0.6 } as const

/**
 * How things come up out of the ground and go back under it, as a viewer is
 * made with it (`ViewerOptions.appear`). Each left out is {@link
 * DEFAULT_APPEAR}'s.
 *
 * The same three names as {@link ViewerAppear}, which is where they are changed
 * afterwards. There is no `appear: false` beside it any more (2026-10-27): an
 * option and the property it is read back from have one shape, and `false`
 * there would be a value a property cannot hold.
 */
export interface AppearOptions {
  /**
   * Whether they come and go at all. On by default.
   *
   * Off, everything stands up, and is taken away, at once — and the two
   * numbers below are kept for when it is turned on again. `enabled` and not
   * `visible`, since what it turns is an effect and not a thing drawn.
   */
  enabled?: boolean
  /** How long one building takes to come up or go back under, in seconds. */
  duration?: number
  /** How far apart the buildings of one tile set off, at most, in seconds. */
  stagger?: number
}

/**
 * How things come and go as it now stands, and the handle on it:
 * `viewer.appear.duration = 2`.
 *
 * A part of the viewer that is always there, so three settings are three
 * properties rather than a value handed over whole.
 *
 * Written while something is on its way, that is finished at once: what was
 * coming stands, what was going is gone, and the new pace is for whatever sets
 * off after. The layers are told (`Change`'s 'appear') and do the finishing.
 * It used to be left to the shader, which reads the duration afresh every
 * frame and so put what was on its way where the new pace would have it by
 * then — while each layer kept the deadlines it had taken from the old pace,
 * for letting a sunk tile go and for drawing the sun's map again while things
 * move. The two parted: a longer pace raised buildings on after the map had
 * stopped following them, and let tiles go half way down; turning it off stood
 * a sinking city back up until the old deadline took it away. A jump either
 * way, and this one is worked out from the code, not measured on screen.
 *
 * **One for the page and not for the viewer.** The clock is a shader's and is
 * module-wide (see the note above {@link tickAppear}), so a second viewer on
 * the page that writes its own sets the pace for both, and each reads back what
 * it last wrote rather than what is running. That was true of the option before
 * it was true of this.
 */
export interface ViewerAppear {
  /** Whether they come and go at all; see {@link AppearOptions.enabled}. */
  enabled: boolean
  /** How long one takes, in seconds. */
  duration: number
  /** How far apart a tile's set off, at most, in seconds. */
  stagger: number
}

/** How far below its own top a thing starts, or ends, over its height. */
export const CLEAR_OF_THE_GROUND = 1

/*
 * The clock, and the pace, that everything coming and going keeps.
 *
 * One of each for the whole page, and both read from inside shaders. That is
 * what makes them module-wide rather than a field on something: a uniform is
 * woven into a shader the first time the material carrying it is drawn, and
 * three weaves a shader per material — about a second each — so the buildings
 * of every tile share one material and it cannot be handed a different clock
 * later on.
 *
 * The viewer is the only thing that sets them. Its frame loop brings the
 * clock up, and its `appear` sets the pace, so buildings rising and the park
 * they stand in keep the same step without either layer knowing of the other.
 * The layers only ever read them.
 */

/**
 * Seconds since the page began, as everything on its way is measured against.
 *
 * Not watched (`repaint.ts`): it moves every frame, and a map standing still
 * would be drawn every frame for it. What it moves is told instead — see
 * {@link stillArriving}.
 */
const now = unwatched(0)
/** How long one takes, or 0 where things stand up and vanish where they are. */
const takes = uniform(DEFAULT_APPEAR.duration)
/** How far apart the things of one tile set off, which only the stamping reads. */
let spread: number = DEFAULT_APPEAR.stagger
/** On the clock above, when the last thing stamped on its way gets there. */
let lastArrives = 0

/**
 * Brings the clock every coming and going is measured against up to this
 * frame. The viewer's, once a frame, and nobody else's.
 */
export function tickAppear(seconds: number): void {
  now.value = seconds
}

/**
 * Whether anything is still on its way in or out, which moves in the shader
 * off the clock where nothing that is compared can see it. The viewer draws
 * the map every frame while it is.
 *
 * Kept as the last arrival of everything stamped, rather than asked of every
 * layer: every way of stamping a thing on its way is in this file
 * ({@link stampWhole}, {@link whenOf}, {@link turnBack}), and the markers that
 * ride a building copy the building's.
 */
export function stillArriving(): boolean {
  return now.value < lastArrives
}

/** Notes when something stamped to set off at `at` will have got there. */
function arrivesAt(at: number): void {
  const there = at + takes.value
  if (there > lastArrives) lastArrives = there
}

/**
 * How long a thing takes to come or go, and how far apart a tile's set off.
 * Set from the viewer's `appear`, and from nowhere else.
 */
export function setAppearing(duration: number, stagger: number): void {
  takes.value = Math.max(0, duration)
  spread = Math.max(0, stagger)
}

/**
 * The viewer's coming and going as a thing a page holds, setting the pace as it
 * is written.
 *
 * @internal Made by the viewer, handed out as a {@link ViewerAppear}. The three
 * numbers are kept here as the page wrote them, so that turning it off and on
 * again comes back to the pace it had; what the shaders read is set from them
 * on every change, nought for both while it is off — which is what
 * `appear: false` used to say.
 */
export class AppearSettings implements ViewerAppear {
  private _enabled: boolean
  private _duration: number
  private _stagger: number

  /**
   * @param given what the viewer was made with
   * @param moved told after each change, once the pace is set — which is when
   *   the viewer has its layers finish what is on its way
   */
  constructor(
    given: AppearOptions | undefined,
    private readonly moved: () => void,
  ) {
    this._enabled = given?.enabled ?? DEFAULT_APPEAR.enabled
    this._duration = given?.duration ?? DEFAULT_APPEAR.duration
    this._stagger = given?.stagger ?? DEFAULT_APPEAR.stagger
    // Set as the viewer is made whatever it was given, so a second viewer made
    // with nothing said still puts the default back — as the option always did
    this.pace()
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.changed()
  }

  get duration(): number {
    return this._duration
  }

  set duration(value: number) {
    if (value === this._duration) return
    this._duration = value
    this.changed()
  }

  get stagger(): number {
    return this._stagger
  }

  set stagger(value: number) {
    if (value === this._stagger) return
    this._stagger = value
    this.changed()
  }

  private pace(): void {
    if (this._enabled) setAppearing(this._duration, this._stagger)
    else setAppearing(0, 0)
  }

  private changed(): void {
    this.pace()
    this.moved()
  }
}

/** How long one takes now. Nought stands them up, and takes them away, at once. */
export function appearTakes(): number {
  return takes.value
}

/** How far apart the things of one tile set off now. */
export function appearStagger(): number {
  return spread
}

/**
 * How much of a thing is here: nought where it has not set off, one once it is
 * where it belongs.
 *
 * Slow to arrive and slow to leave, so a thing eases into its place rather
 * than stopping dead, and slips away from it rather than being snatched.
 *
 * Coming, this is how much of the way is behind it; going, how much is left.
 * One curve read from either end, which is what lets a thing turned round part
 * way carry straight on from where it stands (see turnBack). A corner reads
 * one where nothing is coming or going at all.
 */
export function arrived(): Node<'float'> {
  return Fn(() => {
    const said = attribute(APPEAR, 'vec2')
    const share = now.sub(said.x).div(takes.max(1e-6)).clamp(0, 1)
    const along = said.y.greaterThan(0).select(share, share.oneMinus())
    return takes.greaterThan(0).select(along.oneMinus().pow(3).oneMinus(), float(1))
  })()
}

/**
 * How far below where it belongs a corner still is, in the units its mesh is
 * drawn in.
 *
 * What is left of its way, over the whole of it. A corner whose way is behind
 * it reads nought, which is what every corner reads once nothing is coming or
 * going.
 */
export function stillUnder(): Node<'float'> {
  return arrived().oneMinus().mul(attribute(APPEAR, 'vec2').y.abs())
}

/**
 * The same number, worked out from one corner's two in hand rather than in a
 * shader.
 *
 * Whoever reads a place back off the picture reads it where the thing is drawn,
 * which is short of where it belongs by exactly this while it is on its way —
 * so a height taken off a building that is still coming up says a lower storey
 * than the one that was clicked, for the second or so it takes. Adding it back
 * is the whole of the undoing: a thing goes under before it is moved, so this
 * comes off the y first and goes back on last.
 *
 * The one place the curve above is written twice. It cannot be helped — the
 * shader's is the card's and cannot be asked from here — so the two are kept
 * side by side, and neither is to be changed without the other.
 */
export function stillUnderNow(at: number, by: number): number {
  const span = takes.value
  if (span <= 0) return 0
  const share = Math.min(Math.max((now.value - at) / Math.max(span, 1e-6), 0), 1)
  const along = by > 0 ? share : 1 - share
  const done = 1 - (1 - along) ** 3
  return (1 - done) * Math.abs(by)
}

/** Where a corner says how far it is over the ground its thing rises out of. */
const OVER_GROUND = 'plateauOverGround'

/**
 * Whether a corner is at or above the ground its thing rises out of, for the
 * picture to read as it draws.
 *
 * Until there was a mask, nothing had to ask: the ground writes its own depth,
 * so whatever had gone below it was already behind it. That holds only where
 * there is ground to write it. Cut the viewer to a shape and the ground stops
 * at the rim, while a building inside the shape keeps every fragment it has —
 * its own place is inside, however far under it has gone. What is still
 * beneath hangs past the rim with nothing in front of it, which is the city
 * arriving in a hole.
 *
 * So a thing on its way hides its own underside rather than leaning on the
 * ground to do it. What is given is how far over that ground the corner stands
 * now: where it rests less {@link stillUnder}. Where it rests is a building's
 * own y, since each is seated on a nought of its own, and a tree's the same
 * scaled by how tall it stands.
 *
 * Hand it the very {@link stillUnder} the corner was moved by rather than
 * another of the same: both are worked out in the vertex stage, and one node
 * asked for twice is written once.
 *
 * Nothing standing still pays for this. That number is nought the moment the
 * way is behind it, every corner is then at or above its own nought, and the
 * test throws nothing away.
 */
export function overGround(over: Node<'float'>): Node<'bool'> {
  return varying(over, OVER_GROUND).greaterThanEqual(0) as Node<'bool'>
}

/**
 * How far into a turn each of a tile's things waits before it sets off, by the
 * tile's own number for it.
 *
 * Counting them in order would sweep a front across the tile, which reads as
 * the tile it is rather than as a city. Stepping by the golden ratio scatters
 * them while giving each a place of its own, so the same tile always comes,
 * and goes, the same way.
 */
const GOLDEN = 0.618033988749895

export function whenOf(thing: number, at: number, stagger: number): number {
  const sets = at + stagger * ((thing * GOLDEN) % 1)
  arrivesAt(sets)
  return sets
}

/**
 * Turns everything a mesh carries round to go back the way it came, and says
 * when the last of it will have got there.
 *
 * Time is folded about this moment: what a thing has done it now has left to
 * do. Nothing jumps — each is where it stands, going the other way — and the
 * order is kept, so the first up is the last down.
 *
 * Only for things still on their way. One that arrived long ago would fold to
 * setting off just as long from now, which is why a mesh standing still is
 * stamped afresh instead.
 */
export function turnBack(mesh: Mesh, at: number): number {
  const said = mesh.geometry.attributes[APPEAR]
  if (!said) return at
  const array = said.array as Float32Array
  const span = takes.value
  let last = at
  for (let i = 0; i + 1 < array.length; i += 2) {
    const sets = 2 * at - (array[i] ?? 0) - span
    array[i] = sets
    array[i + 1] = -(array[i + 1] ?? 0)
    if (sets + span > last) last = sets + span
  }
  said.needsUpdate = true
  arrivesAt(last - span)
  return last
}

/**
 * Says on a flat thing's corners when the whole of it comes in, and which way.
 *
 * A patch of ground lying at nought has no way to travel, so it says one and
 * only the sign of it is read. It comes as one, too: a stagger wants something
 * to stagger, and a patch is one thing however wide it lies.
 *
 * The corners are given their two numbers here where they have none, which is
 * as the mesh is built and before it is ever drawn. A shape handed another
 * attribute after that is a shape the card must be told of again, and being
 * told costs about a second.
 */
export function stampWhole(mesh: Mesh, at: number, way: Way): void {
  const positions = mesh.geometry.attributes['position']
  if (!positions) return
  let said = mesh.geometry.attributes[APPEAR]
  if (!said || said.count !== positions.count) {
    said = new BufferAttribute(new Float32Array(positions.count * 2), 2)
    mesh.geometry.setAttribute(APPEAR, said)
  }

  arrivesAt(at)
  const array = said.array as Float32Array
  const sign = way === 'up' ? 1 : -1
  for (let v = 0; v + 1 < array.length; v += 2) {
    array[v] = at
    array[v + 1] = sign
  }
  said.needsUpdate = true
}

/** When the last thing of a mesh will have finished coming, or going. */
export function doneBy(at: number, duration: number, stagger: number): number {
  return at + stagger + duration
}
