/**
 * Zilla: what its own walk clip says about how it walks, and where it has got
 * to walking it.
 *
 * Three things come out of it: how far one turn of the clip carries the
 * creature, how that ground goes under the planted foot through the turn, and
 * where in the turn the weight changes from one foot to the other. The first
 * two are what keep the feet from sliding; the last is what the city is shaken
 * by.
 *
 * Every length is in the creature's own height, which is 1, so the page sizes
 * it once and nothing here knows how big it is meant to be.
 *
 * The body is measured forward (the way its head is), to its left and up:
 * along the ground from the middle of its vertices in the clip's first pose,
 * and up from the lowest its feet go in the whole turn.
 */
import { AnimationMixer, Vector3, type Object3D, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HEIGHT, PACE } from './data.js'

/** One moment the weight comes down on a foot. */
export interface Footfall {
  /** Where in the turn it happens, from 0 to 1. */
  readonly phase: number
  /** Where that foot is then, in the creature's heights: ahead of its middle, and to its left. */
  readonly forward: number
  readonly left: number
}

export interface Walk {
  /** How long one turn of the clip lasts, in seconds. */
  readonly duration: number
  /** How tall the creature stands over the whole turn, in the model's own units. */
  readonly height: number
  /**
   * Whether the head is at the model's −Z end, so the model is to be turned
   * round to walk head first: a glTF model's front is its +Z side.
   */
  readonly reversed: boolean
  /**
   * Where the middle measured from lies in the model, in its own units: how
   * far ahead of its origin, the way the head is, and how far to its left.
   */
  readonly middle: { readonly forward: number; readonly left: number }
  /** How far under the model's origin its feet go, in its own units: below nought. */
  readonly lowest: number
  /** How far one turn of the clip carries the creature. */
  readonly stride: number
  /**
   * How much ground has gone under the planted foot by each of `FRAMES` steps
   * through a turn, from 0 at its start to `stride` at its end.
   */
  readonly travel: Float64Array
  /** The moments the weight changes foot, in the order they come. */
  readonly falls: readonly Footfall[]
}

/** How many poses of the clip are measured. */
const FRAMES = 32
/** How near the ground, as a share of the height, a vertex has to come to be a foot. */
const FOOT = 0.08

/**
 * Reads a model's file and measures a walk clip of it: every vertex, bent by
 * the skeleton as the clip poses it, at `FRAMES` moments through one turn.
 *
 * The clip walks on the spot, so the foot on the ground slides backwards
 * through it, and that slide is how far the creature goes: at each step the
 * lower of its two feet is taken to be the one on the ground, and how far it
 * went back is added up. A foot put down still moving forward goes back less
 * than nothing, which is held at nothing, or the creature would step back.
 *
 * The file is read here a second time, since the viewer keeps what it reads of
 * a file to itself; the browser has it at hand by then.
 */
export async function measureWalk(url: string, clipName: string): Promise<Walk> {
  const gltf = await new GLTFLoader().loadAsync(url)
  const clip = gltf.animations.find(({ name }) => name === clipName)
  if (!clip) throw new Error(`The model has no clip "${clipName}"`)
  const scene: Object3D = gltf.scene
  const skinned: SkinnedMesh[] = []
  scene.traverse((node) => {
    if ((node as Partial<SkinnedMesh>).isSkinnedMesh) skinned.push(node as SkinnedMesh)
  })
  // The parts of the model share one list of vertices, so one part is all of them
  const body = skinned[0]
  if (!body) throw new Error('The model has no skinned mesh')
  const count = body.geometry.getAttribute('position').count

  // Every pose in the model's own coordinates: x, y up and z forward
  const mixer = new AnimationMixer(scene)
  mixer.clipAction(clip).play()
  const vertex = new Vector3()
  const poses: Float64Array[] = []
  for (let frame = 0; frame < FRAMES; frame++) {
    mixer.setTime((frame / FRAMES) * clip.duration)
    scene.updateMatrixWorld(true)
    body.skeleton.update()
    const pose = new Float64Array(count * 3)
    for (let v = 0; v < count; v++) {
      body.getVertexPosition(v, vertex).applyMatrix4(body.matrixWorld)
      pose.set([vertex.x, vertex.y, vertex.z], v * 3)
    }
    poses.push(pose)
  }

  // Which end is the head: the end that is thicker across. A tail tapers to a
  // point, and a head is a head
  const first = poses[0] ?? new Float64Array(0)
  let back = Infinity
  let front = -Infinity
  for (let v = 0; v < count; v++) {
    back = Math.min(back, first[v * 3 + 2] ?? 0)
    front = Math.max(front, first[v * 3 + 2] ?? 0)
  }
  const slab = (front - back) * 0.08
  const across = (from: number, to: number): number => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let v = 0; v < count; v++) {
      const z = first[v * 3 + 2] ?? 0
      if (z < from || z > to) continue
      x0 = Math.min(x0, first[v * 3] ?? 0)
      x1 = Math.max(x1, first[v * 3] ?? 0)
      y0 = Math.min(y0, first[v * 3 + 1] ?? 0)
      y1 = Math.max(y1, first[v * 3 + 1] ?? 0)
    }
    return (x1 - x0) * (y1 - y0)
  }
  const nose = across(front - slab, front) > across(back, back + slab) ? 1 : -1

  // Forward, left and up, one height tall, from the middle and the feet
  let lowest = Infinity
  let highest = -Infinity
  for (const pose of poses) {
    for (let v = 0; v < count; v++) {
      lowest = Math.min(lowest, pose[v * 3 + 1] ?? 0)
      highest = Math.max(highest, pose[v * 3 + 1] ?? 0)
    }
  }
  let forward = 0
  let left = 0
  for (let v = 0; v < count; v++) {
    forward += nose * (first[v * 3 + 2] ?? 0)
    left += nose * (first[v * 3] ?? 0)
  }
  forward /= count
  left /= count
  const height = highest - lowest
  const measured = poses.map((pose) => {
    const out = new Float64Array(count * 3)
    for (let v = 0; v < count; v++) {
      out[v * 3] = (nose * (pose[v * 3 + 2] ?? 0) - forward) / height
      out[v * 3 + 1] = (nose * (pose[v * 3] ?? 0) - left) / height
      out[v * 3 + 2] = ((pose[v * 3 + 1] ?? 0) - lowest) / height
    }
    return out
  })
  const at = (frame: number, v: number, axis: number): number => measured[frame]?.[v * 3 + axis] ?? 0

  // The feet: whatever comes down near the ground in the turn, split by the
  // side it is on when lowest
  const feet: [number[], number[]] = [[], []]
  for (let v = 0; v < count; v++) {
    let low = Infinity
    let side = 0
    for (let frame = 0; frame < FRAMES; frame++) {
      if (at(frame, v, 2) < low) {
        low = at(frame, v, 2)
        side = at(frame, v, 1)
      }
    }
    if (low < FOOT) feet[side < 0 ? 0 : 1].push(v)
  }
  const footAt = (foot: readonly number[], frame: number, axis: number) =>
    foot.reduce((sum, v) => sum + at(frame, v, axis), 0) / Math.max(foot.length, 1)

  // Which foot carries the weight at each step, and how far it slid back
  const travel = new Float64Array(FRAMES + 1)
  const carrying: number[] = []
  for (let frame = 0; frame < FRAMES; frame++) {
    const next = (frame + 1) % FRAMES
    const which =
      footAt(feet[0], frame, 2) + footAt(feet[0], next, 2) <
      footAt(feet[1], frame, 2) + footAt(feet[1], next, 2)
        ? 0
        : 1
    carrying.push(which)
    const planted = feet[which] ?? []
    const slid = footAt(planted, frame, 0) - footAt(planted, next, 0)
    travel[frame + 1] = (travel[frame] ?? 0) + Math.max(0, slid)
  }

  /**
   * A footfall is where the weight goes over to the other foot.
   *
   * Not where the toe first touches: that moment is the animator's to draw and
   * the clip here does not draw it sharply, while the change of weight is
   * measured from the ground itself — the foot that is lower over the step is
   * the one holding the creature up. It lands within a frame of the touch
   * either way, and at this size a frame of a stride is a fraction of a step.
   */
  const falls: Footfall[] = []
  for (let frame = 0; frame < FRAMES; frame++) {
    const before = carrying[(frame + FRAMES - 1) % FRAMES] ?? 0
    const which = carrying[frame] ?? 0
    if (which === before) continue
    const foot = feet[which] ?? []
    falls.push({
      phase: frame / FRAMES,
      forward: footAt(foot, frame, 0),
      left: footAt(foot, frame, 1),
    })
  }

  return {
    duration: clip.duration,
    height,
    reversed: nose < 0,
    middle: { forward, left },
    lowest,
    stride: travel[FRAMES] ?? 0,
    travel,
    falls,
  }
}

// ── Walking it ────────────────────────────────────────────

/**
 * How much of the planted foot's own uneven slide the body follows, from 0
 * (the body goes at an even pace and the foot creeps) to 1 (the foot stays put
 * and the body surges and stops twice a stride).
 *
 * The pack's animator drew the swing, not the contact: through one turn the
 * planted foot slides eleven times faster in mid-stance than as the weight
 * changes over, so no setting is both even and planted. At a half the foot
 * creeps about its own length either way, which nobody sees from over the
 * city, and the walk slows and gathers rather than stalling at every footfall.
 */
const LOCK = 0.5

/**
 * How tightly it can turn at the most: the curvature of its path, in turns of
 * a radian a metre, so it keeps to the same path however fast it walks. At
 * 1/260 a quarter turn takes 408 m.
 */
const BEND = 1 / 260
/** How much of that it leans by as it wanders, where it is not heading home. */
const SWAY = 0.3
/**
 * Between what shares of the way out to the edge of the district it leans back
 * toward the middle, a little more the further out it is.
 */
const HOME = [0.38, 0.62] as const

/**
 * Where the creature is and which way it is going, in metres from the middle
 * of the district: x east and y north, as the walk is worked out on a map.
 */
export interface Stance {
  /** East of the middle. */
  x: number
  /** North of the middle. */
  y: number
  /** Which way it faces, in radians counterclockwise from east. */
  yaw: number
}

/** Where a foot came down, in metres east and north of the middle of the district. */
export type Footprint = readonly [east: number, north: number]

/**
 * Zilla itself: where it is, which way it is going, and how far through its
 * stride.
 *
 * Nothing sets its heading. It leans a little one way and the other as it
 * goes, by the ground it has covered, and leans back toward the middle once it
 * is out past a share of the district; its heading is what comes of leaning so
 * for a while. So it never pivots on the spot and never walks the same way
 * twice, and a thing two hundred metres long turns as one would.
 */
export class Zilla {
  readonly stance: Stance
  /** How far through a turn of the walk clip it is, from 0 to 1. */
  phase = 0
  /** How far it has walked, in metres. */
  walked = 0

  private readonly walk: Walk
  /** How far out the district reaches from its middle, in metres. */
  private readonly reach: number

  constructor(walk: Walk, reach: number, start: Stance) {
    this.walk = walk
    this.reach = reach
    this.stance = { ...start }
  }

  /** How far one turn of the clip carries it, in metres. */
  get stride(): number {
    return this.walk.stride * HEIGHT
  }

  /** Where its origin stands, in metres east and north of the middle. */
  get origin(): Footprint {
    const { x, y, yaw } = this.stance
    // The model's origin is not its middle: it lies behind and beside it
    const scale = HEIGHT / this.walk.height
    const forward = this.walk.middle.forward * scale
    const left = this.walk.middle.left * scale
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    return [x - (forward * cos - left * sin), y - (forward * sin + left * cos)]
  }

  /** Which way it looks, in degrees clockwise from north, as a model is turned. */
  get facing(): number {
    return 90 - (this.stance.yaw * 180) / Math.PI + (this.walk.reversed ? 180 : 0)
  }

  /** Where in its clip it stands, in seconds. */
  get clipTime(): number {
    return this.phase * this.walk.duration
  }

  /**
   * Walks on by `seconds`, and says where any foot came down while it did.
   *
   * The clip goes on first, and the body is carried only as far as the ground
   * went under the planted foot while it did, so the foot has nowhere to
   * slide. A step long enough to cross a footfall hands it back here rather
   * than leaving the page to work out which moments of the stride went past,
   * which is arithmetic about a walk and no business of a map.
   */
  step(seconds: number): readonly Footprint[] {
    const stride = this.stride
    const turn = (PACE * seconds) / stride
    const gone = this.reached(this.phase + turn) - this.reached(this.phase)
    const was = this.phase
    this.phase = (this.phase + turn) % 1
    this.walked += gone

    const { stance } = this
    // Leaning one way and the other as it goes, by two waves some 3.9 km and
    // 9.4 km long, so a lean takes minutes and the two never fall back into step
    let bend = 0.5 * BEND * SWAY * (Math.sin(this.walked * 0.0016) + Math.sin(this.walked * 0.00067 + 2.0))

    // Out past a share of the district it leans back toward the middle, the
    // more the further out, so it is already turning in before it is out
    const out = Math.min(
      1,
      Math.max(0, (Math.hypot(stance.x, stance.y) / this.reach - HOME[0]) / (HOME[1] - HOME[0])),
    )
    if (out > 0) {
      let toward = Math.atan2(-stance.y, -stance.x) - stance.yaw
      while (toward > Math.PI) toward -= Math.PI * 2
      while (toward < -Math.PI) toward += Math.PI * 2
      const home = Math.sign(toward) * BEND * Math.min(1, Math.abs(toward) / 0.5)
      bend += (home - bend) * out
    }

    stance.yaw += bend * gone
    stance.x += Math.cos(stance.yaw) * gone
    stance.y += Math.sin(stance.yaw) * gone

    // Which of the turn's footfalls were passed on the way, and where that
    // foot was then: ahead of the middle and to one side of it, turned to face
    // the way it is going
    const turned = (this.phase - was + 1) % 1
    const prints: Footprint[] = []
    for (const fall of this.walk.falls) {
      if ((fall.phase - was + 1) % 1 > turned) continue
      const cos = Math.cos(stance.yaw)
      const sin = Math.sin(stance.yaw)
      prints.push([
        stance.x + HEIGHT * (fall.forward * cos - fall.left * sin),
        stance.y + HEIGHT * (fall.forward * sin + fall.left * cos),
      ])
    }
    return prints
  }

  /**
   * How far the creature has walked by a point of its stride, `phase` turns of
   * the clip from its start, in metres: an even pace mixed by `LOCK` with the
   * ground that went under its planted foot.
   */
  private reached(phase: number): number {
    const { travel } = this.walk
    const frames = travel.length - 1
    const stride = this.stride
    const turns = Math.floor(phase)
    const at = (phase - turns) * frames
    const frame = Math.floor(at)
    const from = travel[frame] ?? 0
    const to = travel[frame + 1] ?? from
    const planted = (from + (to - from) * (at - frame)) * HEIGHT + turns * stride
    return phase * stride * (1 - LOCK) + planted * LOCK
  }
}
