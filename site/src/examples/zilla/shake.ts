/**
 * What a footfall does to the city, in four versions.
 *
 * Nothing here is the library's idea of a wave. What it is given is what one
 * building does while it moves — keyframes — and how that differs from place
 * to place: a pair of functions of where a building stands, in metres east and
 * north of the foot, read once into a square of ground stamped down there.
 *
 * Which is to say these are not four features. A ring is `Math.hypot`, and a
 * domino going round is `Math.atan2` added to it.
 *
 * The other two differ the other way about. The ring and the coil share a
 * throw — straight up and back down — and part on where it reaches and when;
 * the rocking keeps a field of the same shape as the ring's and parts on the
 * movement itself, which is not up at all but out and back, shrinking. There
 * is one word for that and it is {@link CrowdKeyframe.away}: a field says when
 * a building moves and how much, never which way, so the only direction on
 * offer is the one the library works out for itself — away from the foot.
 * And the quake has no field at all: every building does the one thing at the
 * one moment, a buzz from side to side as a phone shakes on a table, the whole
 * city at once rather than a front running out from the foot.
 *
 * Two of these crossing add up rather than the later one taking the earlier's
 * buildings, so the creature may walk as fast as it likes and nothing is
 * dropped halfway up.
 */
import type { Buildings, CrowdField, CrowdKeyframe } from '@plateau-ui/core'

/** A field's delay is in milliseconds, as every time a motion is given in. */
const SECOND = 1000

/** How far a shake carries, in metres, and how fast its front travels. */
const REACHES = 1300
const SPREADS = 300

/**
 * How fast the rocking's front travels, in metres a second.
 *
 * Four times the throw's. The ring is read as water and wants to be watched
 * going out; this is read as ground, where the far side of a district a
 * kilometre across is shaking about half a second after the near side and the
 * whole of it is going at once by the time the swing has turned.
 */
const SHOCKS = 1200

/**
 * Up and back down. The way up is quick and the way back is not, since what is
 * thrown lands under its own weight rather than being set down.
 */
const THROWN: readonly CrowdKeyframe[] = [
  { translate: [0, 0, 0] },
  { translate: [0, 0, 32], offset: 0.35, easing: 'ease-out' },
  { translate: [0, 0, 0], easing: 'ease-in' },
]

/** How far out the first push of the rocking carries a building, in metres. */
const THROWS = 9

/**
 * Out and back, four times over, each swing smaller than the last.
 *
 * Every number is {@link CrowdKeyframe.away}: how far out from the foot the
 * building is, so a positive one pushes it away and a negative one draws it in
 * past where it stood. Which way that is on the ground is the library's to work
 * out and differs for every building — one north of the foot goes north, one
 * east goes east — so a street of them rocking back and forth is, taken
 * together, a front running out from under the creature.
 *
 * Shrinking is the whole of what makes it a quake rather than a wobble: a
 * ground that has been struck rings down, and swings of one size would be a
 * city on a spring. Four of them, because three ends while it still looks
 * deliberate and five is over before the eye has read the last two.
 *
 * No easing, where the throw has it at both ends. A thing thrown leaves fast
 * and lands slow; a thing shaken is going fastest as it passes the middle,
 * which is what a straight run between the turns gives.
 */
const ROCKED: readonly CrowdKeyframe[] = [
  { away: 0 },
  { away: THROWS, offset: 0.12 },
  { away: -THROWS * 0.7, offset: 0.3 },
  { away: THROWS * 0.4, offset: 0.5 },
  { away: -THROWS * 0.2, offset: 0.7 },
  { away: 0 },
]

/**
 * The quake: how far a building swings to either side, in metres, and how
 * many times it goes there and back.
 *
 * Small and quick, which is what makes it a buzz rather than a sway: a few
 * metres east and west, four times over in under half a second, every swing
 * the same size so it stops rather than rings down. Four, where it was eight
 * at first and read as too many. A motion is read into a table of 32 steps
 * from start to end (`crowd.ts`), and any count that halves into 32 puts each
 * turn on a step of its own; more than eight and the turns fall between steps
 * and the swing comes out short.
 */
const SWAY = 5
const BUZZES = 4

/** East and west and east again, a turn on every other step of the table, from rest and back to it. */
const BUZZED: readonly CrowdKeyframe[] = [
  { translate: [0, 0, 0] },
  ...Array.from({ length: BUZZES * 2 }, (_, turn) => ({
    translate: [turn % 2 === 0 ? SWAY : -SWAY, 0, 0] as const,
    offset: (turn + 0.5) / (BUZZES * 2),
  })),
  { translate: [0, 0, 0] },
]

/**
 * The coil: how far out one turn carries, in metres, how long that turn takes,
 * in seconds, and how far the whole of it reaches.
 *
 * A snail's shell rather than a target's rings: the distance is not rounded to
 * anything, so going round from north to north-east to east the arm is already
 * a little further out at each step, and after a full turn it is exactly
 * `PITCH` out.
 *
 * The turn has to take longer than a building is in the air, or two turns of
 * the arm are up at once, they meet, and what is left is a filled disc going
 * out — a ring. At twice the 1.1 seconds of the throw, half a turn is up at a
 * time and the arm reads as an arm. That is also why the coil is given less
 * ground than the others: two turns of this size are the whole of it, and any
 * more would still be sweeping when the next footfall lands.
 */
const PITCH = 450
const TURN = 2
const COILS = 900

function fading([east, north]: readonly [number, number]): number {
  return Math.max(0, 1 - Math.hypot(east, north) / REACHES) ** 0.6
}

/**
 * One way of shaking the city.
 *
 * The fields are made once, here, and handed over at every footfall: the
 * library reads a field into a table when it first sees it and knows the same
 * one again, so these functions run once for the page's life rather than once
 * a step.
 */
export interface Shake {
  readonly id: string
  /** What it is called, and what its field says, for the panel. */
  readonly name: string
  readonly note: string
  readonly keyframes: readonly CrowdKeyframe[]
  /** How long one building takes to go through them, in milliseconds. */
  readonly duration: number
  /** Left out, every building moves together. */
  readonly field?: CrowdField
}

export const SHAKES: readonly Shake[] = [
  {
    id: 'ring',
    name: 'はもん',
    note: '足元から輪になって広がる',
    keyframes: THROWN,
    duration: 1100,
    field: {
      radius: REACHES,
      delay: ([east, north]) => (Math.hypot(east, north) / SPREADS) * SECOND,
      strength: fading,
    },
  },
  {
    id: 'rock',
    name: 'ゆさぶり',
    note: '足元から押しては引き、だんだん小さくなる',
    keyframes: ROCKED,
    duration: 2400,
    field: {
      radius: REACHES,
      // Faster than the throw's front by a good deal: what is being drawn is
      // ground carrying a shock, not water carrying a ripple, so the far side
      // of the district is already shaking while the near side is still at it.
      delay: ([east, north]) => (Math.hypot(east, north) / SHOCKS) * SECOND,
      strength: fading,
    },
  },
  {
    id: 'coil',
    name: 'うずまき',
    note: '足元から渦を巻いて広がる',
    keyframes: THROWN,
    duration: 1100,
    field: {
      radius: COILS,
      // A turn of the arm is one turn of the bearing and `PITCH` metres of the
      // distance, so the two are added and the sum is read in turns: dominoes
      // stood in a coil and pushed over at the middle.
      delay: ([east, north]) =>
        (Math.hypot(east, north) / PITCH + (Math.atan2(east, north) + Math.PI) / (Math.PI * 2)) *
        TURN *
        SECOND,
      strength: ([east, north]) => Math.max(0, 1 - Math.hypot(east, north) / COILS) ** 0.6,
    },
  },
  {
    id: 'quake',
    name: 'じしん',
    note: '街全体がいっせいに左右に震える',
    keyframes: BUZZED,
    duration: 400,
    // No field: every building moves together, wherever the foot came down
  },
]

/** Shakes the city out from a place on the map, the way that one shakes it. */
export function shake(buildings: Buildings, at: readonly [number, number], how: Shake): void {
  buildings.animateAll(how.keyframes, {
    from: how.field ? at : undefined,
    duration: how.duration,
    field: how.field,
  })
}
