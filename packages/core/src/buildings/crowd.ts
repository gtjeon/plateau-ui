import { Fn, If, Loop, float, uniform as unwatched, vec2, vec3 } from 'three/tsl'
import { texture, uniform, uniformArray } from '../repaint.js'
import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGFormat,
  Vector4,
  type Node,
} from 'three/webgpu'
import { framesOf, mixNumbers, mixTriples, offsetsOf, valueAt, type Keyframe } from '../motion/keyframes.js'

/**
 * One motion played over every building at once.
 *
 * What a page asks for is a motion and where and when it started; every corner
 * of every building then works out for itself how far it has been moved by
 * whatever is still running. What is kept is that short list of starts, and
 * nothing at all about the buildings.
 *
 * That is what makes two of these add up rather than take each other's place.
 * A single motion moves a building by a row of a table it points at, and a
 * building points at one row, so a second over the same building is the first
 * one ending — halfway up, a building dropped. Here two are two numbers added,
 * which is what waves do.
 *
 * Both of the things that vary are read once, on the CPU, into tables the card
 * walks: what a building does over the time it is moving ({@link STEPS} steps
 * of the keyframes) and how that differs from place to place (a square of
 * {@link FIELD} texels round the start). Easings, offsets and a field written
 * as a pair of functions are all spent there, once, and the card sees numbers.
 */

/** How many steps the keyframes are sampled into. */
const STEPS = 32

/** How many texels across the field is baked into. */
const FIELD = 128

/** One moment of what a building does while it is moving. */
export interface CrowdKeyframe extends Keyframe {
  /** How far it is moved, in metres: east, north and up. Unmoved, [0, 0, 0]. */
  readonly translate?: readonly [east: number, north: number, up: number]
  /**
   * How tall it stands against itself, about its own foot, so it keeps to the
   * ground. Unmoved, 1.
   */
  readonly rise?: number
  /** How far it is moved out from where the motion started, in metres. */
  readonly away?: number
}

/**
 * How a motion differs from place to place: a square of ground stamped down
 * where the motion starts, and read by whatever stands inside it.
 *
 * The two are written as functions of where a building stands, in metres east
 * and north of the start, and read once — at {@link FIELD} by {@link FIELD}
 * places across the square — when the motion is sent. So they may be written
 * as freely as any other function and cost the card nothing: a ring spreading
 * out is `Math.hypot`, a wave rolling across is a dot product, a spiral adds
 * the angle, and a library that knew about rings would have to be taught each
 * of the others.
 *
 * Buildings outside the square stand still.
 *
 * It is read at every corner rather than once for each building, since a
 * corner is what the card has: a field that changes smoothly over more ground
 * than a building covers leans it a little as the front goes through, which is
 * what a wave does to something standing in it, and one that jumps from one
 * place to the next shears the building it jumps across. Write it smooth, or
 * mean the shear.
 */
export interface CrowdField {
  /** How far the square reaches from the start, in metres. */
  readonly radius: number
  /**
   * When a building there starts, in milliseconds after the motion was sent —
   * the unit of {@link CrowdOptions.duration} and of `Timing.delay`. It was
   * seconds until 2026-10-28, and a page writing the 500 it meant as half a
   * second had its buildings wait eight minutes. Nought everywhere by
   * default, which starts them together.
   */
  readonly delay?: (at: readonly [east: number, north: number]) => number
  /** How much of the keyframes it takes, 0 to 1. All of them by default. */
  readonly strength?: (at: readonly [east: number, north: number]) => number
}

/** What a page hands {@link Buildings.animateAll}. */
export interface CrowdOptions {
  /** How long one building takes to go through the keyframes, in milliseconds. */
  readonly duration?: number
  /**
   * Where the motion starts, as [longitude, latitude]. Only a motion with a
   * field needs one — it is where the field is stamped down.
   */
  readonly from?: readonly [number, number]
  /**
   * How it differs from place to place. Left out, every building does the same
   * thing at the same moment, which is the plain case: a city moving as one.
   */
  readonly field?: CrowdField
}

/** How long one building moves for where a page does not say, in seconds. */
const TAKES = 1

/** How many starts are kept at once. The oldest is written over. */
const MOST = 12

/**
 * The starts as a material reads them, and what they come to at a place.
 *
 * One of these belongs to the buildings, which writes it; the materials read
 * it. Not module-wide, unlike the table the single motions use: nothing here
 * has to be shared between layers, and a second city on the page is a second
 * ground to move.
 */
export class Crowds {
  /** Each start: where on the world's x and z, when it went, and how hard. */
  private readonly hits = Array.from({ length: MOST }, () => new Vector4())
  private readonly hitOf = uniformArray<'vec4'>(this.hits, 'vec4')
  /**
   * Whether that start has a place at all, 1 or 0.
   *
   * Its own number rather than a sign or a nought hidden in the four above: a
   * start with no place is not a start at the world's origin, and a dozen
   * floats is nothing against making one of the four mean two things.
   */
  private readonly placed = new Array<number>(MOST).fill(0)
  private readonly placedOf = uniformArray<'float'>(this.placed, 'float')
  /** How many of the slots hold a start; walked as an int, so none means none is read. */
  private readonly count = uniform(0, 'int')
  /**
   * The clock the starts are stamped with, in seconds.
   *
   * Not watched (`repaint.ts`): it moves every frame, and a still map would be
   * drawn every frame for it. What it moves is told instead, by {@link stirring}.
   */
  private readonly clock = unwatched(0)
  /** How many metres one world unit is here, since the world is Mercator. */
  private readonly perUnit = uniform(1)
  private readonly takes = uniform(TAKES)

  /** The keyframes read out: east, north, up and rise at each step. */
  private readonly moved = Array.from({ length: STEPS + 1 }, () => new Vector4(0, 0, 0, 1))
  private readonly movedOf = uniformArray<'vec4'>(this.moved, 'vec4')
  /** ...and how far out from the start, which has no room left in the four. */
  private readonly spread = new Array<number>(STEPS + 1).fill(0)
  private readonly spreadOf = uniformArray<'float'>(this.spread, 'float')

  /**
   * The field read out: when a place starts, and how much of the motion it
   * takes. Half floats, which is what a card will filter between texels.
   */
  private readonly ground = new DataTexture(
    new Uint16Array(FIELD * FIELD * 2),
    FIELD,
    FIELD,
    RGFormat,
    HalfFloatType,
  )
  /** How far the field reaches, in metres, and whether there is one at all. */
  private readonly radius = uniform(1)
  private readonly stamped = uniform(0)
  /** The field last baked, so that sending the same one again bakes nothing. */
  private was: CrowdField | undefined

  /** Which slot the next start goes in, round and round. */
  private next = 0
  /** On the clock, when the last strike went. */
  private lastStrike = Number.NEGATIVE_INFINITY
  /** The longest any place in the square waits, in seconds, as the card reads it. */
  private longestWait = 0

  constructor() {
    this.ground.magFilter = LinearFilter
    this.ground.minFilter = LinearFilter
    this.ground.needsUpdate = true
  }

  /** What a building does while it moves. Read here, once, into the table the card walks. */
  set shape(shape: { keyframes: readonly CrowdKeyframe[]; takes: number }) {
    const owner = 'Buildings.animateAll'
    const offsets = offsetsOf(shape.keyframes, owner)
    const translate = framesOf(
      shape.keyframes,
      offsets,
      (frame, at) => {
        const move = frame.translate
        if (move === undefined) return undefined
        if (!Array.isArray(move) || move.length !== 3 || !move.every(Number.isFinite)) {
          throw new Error(`${owner}: keyframe ${at} translates by something other than [east, north, up]`)
        }
        return move as readonly [number, number, number]
      },
      owner,
    )
    const rise = framesOf(shape.keyframes, offsets, (frame) => frame.rise, owner)
    const away = framesOf(shape.keyframes, offsets, (frame) => frame.away, owner)

    for (let step = 0; step <= STEPS; step++) {
      const k = step / STEPS
      const move = valueAt(translate, k, [0, 0, 0] as const, mixTriples)
      this.moved[step]?.set(move[0], move[1], move[2], valueAt(rise, k, 1, mixNumbers))
      this.spread[step] = valueAt(away, k, 0, mixNumbers)
    }
    this.takes.value = Math.max(0.01, shape.takes)
  }

  /**
   * How it differs from place to place, baked into the square the card reads.
   *
   * The same field given again is not baked again — the one it was last given
   * is kept and compared by identity, since a page that sends a motion every
   * few frames hands over the same object each time and the baking is sixteen
   * thousand calls of somebody else's function.
   */
  set field(field: CrowdField | undefined) {
    if (field === this.was) return
    this.was = field
    this.stamped.value = field ? 1 : 0
    this.longestWait = 0
    if (!field) return

    const radius = Math.max(1, field.radius)
    this.radius.value = radius
    const delay = field.delay
    const strength = field.strength
    const data = this.ground.image.data as Uint16Array
    for (let row = 0; row < FIELD; row++) {
      // The square is read with north up, and a texture's rows run the other
      // way, so the row is turned round rather than the reading being
      const north = (1 - ((row + 0.5) / FIELD) * 2) * radius
      for (let column = 0; column < FIELD; column++) {
        const east = (((column + 0.5) / FIELD) * 2 - 1) * radius
        const at = [east, north] as const
        // Held in seconds on the card, which is what its clock counts in
        const when = delay ? delay(at) / 1000 : 0
        const held = strength ? strength(at) : 1
        const texel = (row * FIELD + column) * 2
        data[texel] = DataUtils.toHalfFloat(Number.isFinite(when) ? Math.max(0, when) : 0)
        // Kept as the card will read it, rounded to half a float, so the wave
        // is not said to be over a moment before the shader has it over
        const waits = DataUtils.fromHalfFloat(data[texel]!)
        if (waits > this.longestWait) this.longestWait = waits
        data[texel + 1] = DataUtils.toHalfFloat(Math.min(Math.max(held, 0), 1))
      }
    }
    this.ground.needsUpdate = true
  }

  /**
   * The clock, and how the world is stretched here. Written every frame.
   *
   * The stretch is the middle of the view's rather than each tile's: a start
   * is a place on the ground and a distance from it, and a district is not
   * wide enough for the stretch to change across it by anything an eye could
   * see.
   */
  tick(seconds: number, metresPerUnit: number): void {
    this.clock.value = seconds
    this.perUnit.value = metresPerUnit
  }

  /**
   * A motion went, at a place on the world or nowhere in particular, at a
   * moment of the clock.
   *
   * The oldest of the dozen is written over rather than the list growing: one
   * whose time has run out is one nothing reads, and which that is, is the one
   * that has been there longest.
   */
  strike(at: { x: number; z: number } | undefined, seconds: number, strength: number): void {
    this.hits[this.next]?.set(at?.x ?? 0, at?.z ?? 0, seconds, strength)
    this.placed[this.next] = at ? 1 : 0
    this.next = (this.next + 1) % MOST
    this.count.value = Math.min(this.count.value + 1, MOST)
    this.lastStrike = Math.max(this.lastStrike, seconds)
  }

  /**
   * Whether a wave may still be crossing the city.
   *
   * Until the last strike, waited out by the longest wait in the square and
   * then taken, is over: past that every corner reads past the end of its
   * keyframes and stands where it stood. The strikes stay on the list after
   * that, and once this said yes for as long as any did — which had the sun's
   * map, and the whole picture, drawn every frame for good after the first
   * wave (`repaint.ts`). Read by the sun's map; see `Viewer.stirShadows`.
   */
  get stirring(): boolean {
    return this.count.value > 0 && this.clock.value <= this.lastStrike + this.longestWait + this.takes.value
  }

  /** Nothing is running any more: a city put back where it was. */
  clear(): void {
    this.count.value = 0
    this.next = 0
    this.lastStrike = Number.NEGATIVE_INFINITY
  }

  /**
   * How far a corner is moved by the motions still running, in metres of the
   * mesh's own frame: x east, y up, z south.
   *
   * Every start still in the list is asked and the answers are added. Where it
   * stands in the field decides when it moves and how much of the keyframes it
   * takes; the keyframes decide the rest.
   *
   * `overFoot` is how high the corner stands over its building's own foot,
   * which is what a `rise` is measured against; `xz` is where it stands on the
   * world, which is what a field is stamped against. Both are given rather
   * than read here, since the walls and the lines drawn along them hold them
   * in different places and must come out with the same answer.
   *
   * A node is built afresh for each caller, out of the nodes that caller hands
   * in, so each is thrown by its own measure and may read whatever its own
   * geometry carries — the walls the corner they are about to place, the lines
   * the end their ribbon was spread from. Nothing is saved by handing one node
   * round instead: a graph is assembled while three weaves a material's
   * shader, which is once a material, and the layer has two callers.
   *
   * What the callers must share is the meaning of the two arguments, not the
   * node. `overFoot` reckoned from the ground under the building in one place
   * and from the building's own foot in another is one `rise` throwing the
   * outline further than the wall it is drawn along.
   */
  movedBy(xz: Node<'vec2'>, overFoot: Node<'float'>): Node<'vec3'> {
    return Fn(() => {
      const move = vec3(0, 0, 0).toVar()
      Loop({ start: 0, end: this.count, type: 'int', condition: '<' }, ({ i }) => {
        const hit = this.hitOf.element(i)
        // A start with no place is felt everywhere at once, which is what a
        // motion with no field comes to
        const here = this.placedOf.element(i).mul(this.stamped).toVar()
        const along = xz.sub(hit.xy).mul(this.perUnit)
        // Where in the square this corner falls, with north up. Outside it,
        // the reading is thrown away below rather than clamped to the edge
        const across = this.radius.mul(2)
        const uv = vec2(along.x.div(across).add(0.5), along.y.negate().div(across).add(0.5))
        const read = texture(this.ground, uv).level(float(0))
        const inside = uv.x.clamp(0, 1).equal(uv.x).and(uv.y.clamp(0, 1).equal(uv.y))
        const when = read.r.mul(here)
        const held = float(1).sub(here).add(read.g.mul(here)).mul(hit.w)
        const k = this.clock.sub(hit.z).sub(when).div(this.takes)
        If(
          k
            .greaterThanEqual(0)
            .and(k.lessThanEqual(1))
            .and(inside.or(here.lessThan(float(0.5)))),
          () => {
            const step = k
              .mul(STEPS)
              .min(STEPS - 1)
              .max(0)
              .toVar()
            const low = step.floor().toInt()
            const from = this.movedOf.element(low)
            const to = this.movedOf.element(low.add(1))
            const now = from.add(to.sub(from).mul(step.fract()))
            const out = this.at(this.spreadOf, k).mul(held)
            // The way out from the start along the ground. The world's z runs
            // south, so what is north of it goes out toward -z
            const way = along.div(along.length().max(1e-6))
            const east = now.x.mul(held).add(way.x.mul(out))
            const south = now.y.mul(held).negate().add(way.y.mul(out))
            const up = now.z.mul(held).add(now.w.sub(1).mul(held).mul(overFoot))
            move.addAssign(vec3(east, up, south))
          },
        )
      })
      return move
    })() as Node<'vec3'>
  }

  /** One of the read-out tables, at a share of the way through it. */
  private at(table: ReturnType<typeof uniformArray<'float'>>, share: Node<'float'>): Node<'float'> {
    const step = share
      .clamp(0, 1)
      .mul(STEPS)
      .min(STEPS - 1)
      .max(0)
    const low = step.floor().toInt()
    const from = table.element(low)
    const to = table.element(low.add(1))
    return from.add(to.sub(from).mul(step.fract())) as Node<'float'>
  }
}

/** What a page asked for, filled in where it left something out. */
export function shapeOf(
  keyframes: readonly CrowdKeyframe[],
  options: CrowdOptions,
): { keyframes: readonly CrowdKeyframe[]; takes: number } {
  return { keyframes, takes: options.duration === undefined ? TAKES : options.duration / 1000 }
}
