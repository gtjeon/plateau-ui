import { Matrix4, Vector3, type Camera } from 'three/webgpu'
import { stillUnderNow } from './appear.js'
import { drawnNow } from './buildings/placing.js'
import { basisNow } from './buildings/slots.js'
import { latToY, lonToX, metersPerUnit } from './geo/mercator.js'
import { heightsInHand, type Heights } from './elevation.js'
import type { Anchor } from './events.js'
import type { BuildingSeat, StandsOnBuildings } from './onBuildings.js'

/**
 * Where something is: a spot on the map, or a place on a thing a page can
 * point at — a building, a model, a solid. The two never mix.
 *
 * One way of saying a place for everything put on the map — a mark, a solid,
 * a model, an eye — and the way a click hands one back, so what comes back
 * goes straight in: `position` for the spot, `anchor` for the place on what
 * was clicked.
 *
 * **A spot on the map** — [longitude, latitude], or `{ lng, lat, height }` —
 * follows nothing. The `building` a click hands back beside it is not read.
 * **A place on a thing** ({@link Anchor}) is its foot and an offset from it,
 * and goes wherever the thing goes.
 *
 * A solid and a model take all of it but a building ({@link OffBuildings}):
 * they stand on the map or on each other, and on no building.
 *
 * _(2026-11-03, the user's design. A spot with a `building` beside it was held
 * to the building — up with it and through a motion, but not to wherever it
 * was stood — and a place on a model was `{ model, height }`. Marks went over
 * first, and the rest followed the same day.)_
 */
export type Where =
  | readonly [number, number]
  | {
      readonly lng: number
      readonly lat: number
      /** How high over the land, in metres; see {@link Position.height}. */
      readonly height?: number
    }
  | Anchor

/**
 * Whether a place is held to a thing rather than a spot on the map: it names
 * no longitude.
 *
 * And so whether it has to be asked for again and again rather than worked
 * out the once. A building comes and goes with its tile and moves with a
 * motion; a model or a solid goes wherever a page puts it.
 *
 * _(2026-11-05: `ridesSomething` asked the second beside this, and had come to
 * be this word for word once a spot on the map stopped riding anything.)_
 */
export function isAnchor(at: Where): at is Anchor {
  return !Array.isArray(at) && !('lng' in at)
}

/**
 * Where a solid or a model stands: a spot on the map, or a place on a model or
 * a solid. Never on a building.
 *
 * _(2026-11-05, the user's call. Both could be held to a building, and rode it
 * up out of the ground and through a motion — a motion's tip and growth with
 * them, where a page standing the building somewhere else (`place`) turned the
 * building and left the thing facing as it was. A mark and an eye still go on
 * a building; what wants to go with one is a mark.)_
 */
export type OffBuildings = Exclude<Where, { readonly building: string }>

/**
 * Says the once, for a page the types do not reach, that a solid or a model
 * was put on a building, which neither stands on; see {@link OffBuildings}.
 * What it was put on is not read, and it is not drawn — as it would not be
 * on a model that is nowhere yet — rather than dropped somewhere it was not
 * put.
 */
export function sayIfOnABuilding(at: Where | 'view', owner: string): void {
  if (at === 'view' || !isAnchor(at) || !('building' in at) || SAID_ON_A_BUILDING.has(owner)) return
  SAID_ON_A_BUILDING.add(owner)
  console.warn(
    `[plateau-ui] ${owner}: \`at\` names a building, and a ${owner.toLowerCase()} does not stand on one, ` +
      'so it is not drawn. Stand it at a spot on the map, or put a mark on the building.',
  )
}

/** The kinds already told; see {@link sayIfOnABuilding}. */
const SAID_ON_A_BUILDING = new Set<string>()

/** How high above its place, where the place does not say. */
export interface WhereOptions {
  /** How far it is lifted off the land, in metres. On it by default. */
  readonly height?: number
}

/** Where a place falls on the canvas. */
export interface ScreenPlace {
  /**
   * Pixels of the page from the canvas's top left — the same corner and the
   * same units the click event reports, so a place and a click can be compared
   * without either being converted first.
   */
  readonly x: number
  readonly y: number
  /**
   * How far in front of the eye it lies, in world units.
   *
   * For stacking things a page draws itself: two cards over the same city want
   * the nearer one in front, and that is what this is for. The projection is
   * orthographic, so this says nothing about how big it should be drawn.
   */
  readonly depth: number
  /**
   * Whether it falls within the canvas.
   *
   * `x` and `y` are given either way. A page that pins a card to the edge of
   * the screen and points an arrow at what is off it needs the place of the
   * thing that is off it, and a reading of nothing would leave it with no
   * direction to point.
   */
  readonly onScreen: boolean
}

/**
 * The canvas as the map falls on it: where a place on the map lands in pixels.
 *
 * What it is for is everything a page draws in its own markup and wants held
 * over a place — a card, a tooltip, a leader line from a building to a panel
 * down the side. Those are the page's, not the library's: they are clicked,
 * tabbed into and read aloud, which is the whole reason for them being markup
 * and not pixels on a sheet.
 *
 * It is not what an {@link Html} mark uses through the page — that one is held
 * in place by the group that holds it, and a page writing one never sees this.
 * This is for the cases a mark cannot answer: a line has two ends and only one
 * of them is on the map.
 *
 * Read afresh whenever it is asked. Nothing is kept from frame to frame, so a
 * page may ask in `on('frame')`, in a pointer handler, or once after a
 * `flyTo`, and the answer is the view as it stands at that moment.
 */
export class Screen {
  private readonly scratch = new Vector3()
  private readonly toEye = new Vector3()
  /** Where the seat stands this frame, worked out just before it is projected. */
  private readonly standing = new Vector3()

  /** @internal Made by the viewer, which is the only thing that knows all of these. */
  constructor(
    private readonly camera: Camera,
    private readonly view: () => { width: number; height: number; worldWidth: number; lat: number },
    private readonly seatBy: () => { city: StandsOnBuildings | null; land: Heights | null },
  ) {}

  /**
   * Where a place falls on the canvas, or nothing where the place is not known
   * yet.
   *
   * Nothing means the building has not landed: a page may name one before its
   * tile is in, and until then there is nowhere to put what it named. Off the
   * screen is not nothing; see {@link ScreenPlace.onScreen}.
   */
  at(where: Where, options: WhereOptions = {}): ScreenPlace | null {
    const { city, land } = this.seatBy()
    const seat = seatAt(city, land, where, options.height)
    if (!seat) return null
    // Where the frame caught it, not where it belongs: a page holding its own
    // writing over a building wants it on the building, and a building coming
    // up out of the ground is metres below its own roof for a second. What is
    // seated on the ground is the same either way — a seat with no building
    // under it reads no clock and no row; see {@link worldOfNow}.
    const { x, y, z } = worldOfNow(seat, this.standing)
    return this.atWorld(x, y, z)
  }

  /**
   * How many metres one pixel of the page covers.
   *
   * One number for the whole canvas, not one per place: the projection is
   * orthographic, so a metre is the same number of pixels wherever it is. What
   * it is for is a page sizing its own markup in the map's units — a ring a
   * hundred metres across, a bar that is as long as the block it names.
   */
  get metersPerPixel(): number {
    const { width, worldWidth, lat } = this.view()
    return (worldWidth / Math.max(1, width)) * metersPerUnit(lat)
  }

  /** @internal The same reading, for something already worked out in world units. */
  atWorld(x: number, y: number, z: number): ScreenPlace {
    const { width, height } = this.view()
    const at = this.scratch.set(x, y, z)
    // Camera space before the projection undoes the sign: the eye looks down
    // its own negative z, so what is in front comes back positive
    const depth = -this.toEye.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse).z
    at.project(this.camera)
    return {
      x: (at.x * 0.5 + 0.5) * width,
      // The projection counts up from the bottom of the screen where a page
      // counts down from the top
      y: (-at.y * 0.5 + 0.5) * height,
      depth,
      onScreen: at.x >= -1 && at.x <= 1 && at.y >= -1 && at.y <= 1 && at.z >= -1 && at.z <= 1,
    }
  }
}

/**
 * Where a thing sits, in the form the drawing wants: a seat of its own on the
 * land for a spot on the map, or a seat on what a place is held to.
 *
 * Shared by the marks, the solids, the models, the eye and {@link Screen}
 * rather than written in each. They ask the same question — where does this
 * `at` put a thing — and the day another way of naming a place is added, it is
 * added here.
 */
export function seatAt(
  city: StandsOnBuildings | null,
  land: Heights | null,
  at: Where,
  height: number | undefined,
  lift?: number,
  hops = 0,
): BuildingSeat | null {
  // A thing may be on a thing — a sign on a float on a lorry — and a page may
  // also put two on each other, which has no answer and would be asked for
  // ever. Nowhere rather than a hang: the thing simply is not placed
  if (hops > RIDDEN_DEEP) return null
  // `lift` is not the page's at all -- it is how far a thing carries itself
  // over wherever it is put, a board cut about its middle asking for half its
  // height -- so it goes on wherever the place came from
  if (isAnchor(at)) {
    // A building not in hand answers nothing, and what is held to it waits
    // for it rather than standing on the map without it. A solid or a model
    // stands on none (`OffBuildings`), so what is held to one is not the
    // city's to answer at all
    const seat =
      'building' in at
        ? (city?.seatOnAnchor(at) ?? null)
        : seatOnThing('model' in at ? at.model : at.solid, at.offset, land, hops + 1)
    return seat && lift ? { ...seat, y: seat.y + lift } : seat
  }
  // A spot on the map, taken apart and put back without whatever else came
  // with it — the building a click names above all. The loose height beside
  // it is the older spelling of the spot's own and is read only where the
  // spot does not say; a spot that says wins, since it is the one the page
  // wrote on purpose
  let lng: number
  let lat: number
  if (Array.isArray(at)) {
    ;[lng, lat] = at as readonly [number, number]
  } else {
    const spot = at as { readonly lng: number; readonly lat: number; readonly height?: number }
    lng = spot.lng
    lat = spot.lat
    height = spot.height ?? height
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const x = lonToX(lng)
  const z = -latToY(lat)
  // North is where the world's z is least, which is where Mercator's y is
  // most, so the one is asked for as the other's negative.
  const ground = land?.at(x, -z) ?? 0
  return {
    // Its own place stands in for the tile's, and the stretch does for it
    // what the group a building hangs from does for the building — so what
    // a seat carries means the same whichever of the two it is: metres over
    // the ground it stands on, and the ground under it beside them.
    x: 0,
    y: (height ?? 0) + (lift ?? 0),
    z: 0,
    originX: x,
    originY: 0,
    originZ: z,
    stretch: 1 / metersPerUnit(lat),
    underfoot: ground,
    slot: 0,
    appearAt: 0,
    appearBy: 0,
  }
}

/**
 * A thing a page stood on the map — a model, a solid — read for where it
 * stands: what an `Anchor` on one asks of it.
 *
 * An interface rather than the two classes, so that reading a place need not
 * know what either is; both answer it by having these, which are the words
 * they are themselves put down by. Read afresh every frame rather than from a
 * copy of where the thing ended up, so that no layer can be a frame ahead of
 * another — the same reason a thing on a building asks the buildings instead
 * of keeping an answer; see `onBuildings.ts`.
 */
export interface StoodThing {
  readonly at: OffBuildings | 'view'
  readonly height: number
  readonly facing: number | undefined
  readonly grounded: boolean
}

/**
 * Where something held to a thing a page stood stands, in the terms the shader
 * moves things by: the thing's foot, moved by `offset` metres east, north and
 * up as it faces nought and turned with its facing. Nothing where the thing
 * stands nowhere yet — at `'view'`, or on a thing that is nowhere.
 *
 * The foot is worked out from the thing's own words exactly as its layer
 * works it out (`seatAt` with its height as the lift), so the two agree in the
 * frame.
 */
export function seatOnThing(
  thing: StoodThing,
  offset: readonly [number, number, number] | undefined,
  land: Heights | null,
  hops = 0,
): BuildingSeat | null {
  const seat = footOfThing(thing, land, hops)
  if (!seat) return null
  const [east = 0, north = 0, up = 0] = offset ?? []
  const { cos, sin } = turnOf(thing.facing)
  // A facing runs clockwise, so a step east turns toward the south and a step
  // north toward the east. North is where z is least
  return {
    ...seat,
    x: seat.x + east * cos + north * sin,
    y: seat.y + up,
    z: seat.z + east * sin - north * cos,
  }
}

/**
 * How far a point on a thing a page stood is from its foot: metres east, north
 * and up as it faces nought — the `offset` a click on it hands back, which
 * leads back to the click. Nothing where the thing stands nowhere yet.
 *
 * The viewer rather than the land, since a click is all that asks and the
 * viewer is what it has; read the way the thing's own layer reads it.
 *
 * The way from the foot to the point is taken back through what
 * {@link seatOnThing} puts it through, last first: the stretch, then the
 * facing. Nothing else moves it — a thing stands on no building
 * ({@link OffBuildings}), so no row or arrival is under it.
 *
 * _(2026-11-05: the same morning a building's row came off here too, before
 * the facing: a click on a solid atop a building a motion had grown by half
 * handed back an offset 12 to 25 pixels off the click. Things left buildings
 * that afternoon, and the row with them.)_
 */
export function offsetOnThing(
  thing: StoodThing,
  point: Vector3,
  viewer: { readonly elevation: boolean } | null,
): [number, number, number] | null {
  const seat = footOfThing(thing, viewer?.elevation ? heightsInHand() : null)
  if (!seat) return null
  const foot = worldOf(seat)
  const east = (point.x - foot.x) / seat.stretch
  // North is where z is least
  const north = (foot.z - point.z) / seat.stretch
  const up = (point.y - foot.y) / seat.stretch
  const { cos, sin } = turnOf(thing.facing)
  // The turn in {@link seatOnThing} taken back off
  return [east * cos - north * sin, east * sin + north * cos, up]
}

/** A facing as the cosine and sine of its turn, clockwise from north. */
function turnOf(facing: number | undefined): { cos: number; sin: number } {
  const turn = ((facing ?? 0) * Math.PI) / 180
  return { cos: Math.cos(turn), sin: Math.sin(turn) }
}

/** Where a thing a page stood has its foot, as its own layer seats it. */
function footOfThing(thing: StoodThing, land: Heights | null, hops = 0): BuildingSeat | null {
  if (thing.at === 'view') return null
  // No city: a thing stands on none, so one a page left on a building anyway
  // is nowhere, as its own layer has it (see `sayIfOnABuilding`)
  return seatAt(null, thing.grounded ? land : null, thing.at, undefined, thing.height, hops)
}

/**
 * A seat in the world's own units as it stands *this frame*: sunk by however
 * much of its building is still under the ground, moved by whatever row that
 * building is reading, and then set on the land.
 *
 * The three steps, and their order, are the shader's own — see `placeMoved`,
 * which does the same to every corner of every building. They have to stay the
 * shader's, or a mast and the roof under it part company for exactly the
 * second a tile takes to come up. What is done there per corner is done here
 * once, because what stands on a building is one mesh at one place.
 *
 * {@link worldOf} is the same seat at rest, which is what a mask wants: where
 * a thing belongs rather than where this frame caught it.
 */
export function worldOfNow(seat: BuildingSeat, into: Vector3): Vector3 {
  // The three, in the shader's order; see `placing.ts`, which is where that
  // order is kept now that three readers want it
  PLACING.under = stillUnderNow(seat.appearAt, seat.appearBy)
  PLACING.slot = seat.slot
  PLACING.underfoot = seat.underfoot
  drawnNow(PLACING, seat.x, seat.y, seat.z, into)
  // The land is already on it, in the mesh's own metres, and is stretched with
  // them rather than after — which is what the mark mesh does
  // (`origin + (local + underfoot) * stretch`), and the two have to agree
  return into.set(
    seat.originX + into.x * seat.stretch,
    seat.originY + into.y * seat.stretch,
    seat.originZ + into.z * seat.stretch,
  )
}

/** Held, since one of these is wanted per seat per frame rather than per click. */
const PLACING = { under: 0, slot: 0, underfoot: 0 }

/**
 * Where a thing stood on a building is this frame, as a matrix to put on it:
 * the place {@link worldOfNow} works out, the turn and the growth its
 * building is moving by (`basisNow`), and the stretch from metres into the
 * world's units.
 *
 * For a layer of a page's own that stands its things on buildings, as the
 * marks stand theirs: a {@link BuildingSeat} asked
 * of the city (`viewer.onBuildings`) carries a slot and an arrival that mean
 * nothing without the arithmetic the shader moves the building by, and that
 * arithmetic is this. Put on afresh every frame — the building may move — with
 * the thing's own turn multiplied on after it.
 *
 * @example
 * mesh.matrixAutoUpdate = false
 * mesh.matrix.copy(seatNow(seat)).multiply(ownTurn)
 */
export function seatNow(seat: BuildingSeat, into = new Matrix4()): Matrix4 {
  const at = worldOfNow(seat, SEAT_AT)
  basisNow(seat.slot, into)
  into.premultiply(SEAT_STRETCH.makeScale(seat.stretch, seat.stretch, seat.stretch))
  return into.setPosition(at)
}

const SEAT_AT = new Vector3()
const SEAT_STRETCH = new Matrix4()

/**
 * How many models one place may be read through.
 *
 * A guard and not a feature: one hop is what a page means, a few are a stack
 * somebody built on purpose, and a ring is a mistake that would otherwise be
 * read for ever.
 */
const RIDDEN_DEEP = 4

/**
 * A seat in the world's own units: its own place, stretched, over its ground.
 *
 * The ground it stands on rides with the metres it is over and is stretched
 * with them, rather than being added after — which is what the mark mesh does
 * (`origin + (local + underfoot) * stretch`), and the two have to agree or a
 * card and the mark beside it stand at different heights. Read the other way
 * round at 御殿場 it came out ninety pixels low: the ground there is four
 * hundred and fifty metres, and Mercator's stretch at that latitude is a
 * fifth again.
 */
export function worldOf(seat: BuildingSeat): { x: number; y: number; z: number } {
  return {
    x: seat.originX + seat.x * seat.stretch,
    y: seat.originY + (seat.y + seat.underfoot) * seat.stretch,
    z: seat.originZ + seat.z * seat.stretch,
  }
}
