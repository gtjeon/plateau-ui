import { Matrix4, Vector3 } from 'three/webgpu'
import {
  framesOf,
  mixPairs,
  mixTriples,
  offsetsOf,
  valueAt,
  type Frame,
  type Keyframe,
} from '../motion/keyframes.js'
import type { Foot } from './foot.js'

/**
 * How a building stands at one moment of a motion, and the matrix that puts
 * it there.
 *
 * A building is grown first, about the middle of its foot; then leaned, over
 * the edge of its foot on the side it leans to; then moved. In that order a
 * building keeps its feet on the ground however it is handled.
 */

/** How a building stands at one moment of a motion. */
export interface BuildingKeyframe extends Keyframe {
  /**
   * How far it is moved, in metres: east, north and up. Unmoved, [0, 0, 0].
   */
  readonly translate?: readonly [east: number, north: number, up: number]
  /**
   * How big it is drawn against its own size: one number for every way, or
   * three for east, north and up. It grows about the middle of its foot, so it
   * stays on the ground. Unmoved, 1.
   */
  readonly scale?: number | readonly [east: number, north: number, up: number]
  /**
   * Which way it leans and how far: a bearing in degrees clockwise from north,
   * and an angle in degrees from upright. It tips over the edge of its foot on
   * that side, as a thing pushed tips, rather than sinking into the ground.
   * Unmoved, [0, 0].
   */
  readonly tilt?: readonly [bearing: number, degrees: number]
}

/** Where the keyframes put a building, taken apart one property to a list. */
export interface PoseFrames {
  readonly translate: Frame<readonly [number, number, number]>[]
  readonly scale: Frame<readonly [number, number, number]>[]
  /**
   * The lean, kept as how far it tips toward the east and toward the north
   * rather than as a bearing and an angle. A lean turning from one keyframe to
   * the next then passes through upright rather than the long way round the
   * compass.
   */
  readonly lean: Frame<readonly [number, number]>[]
}

/** How a building stands now. */
export interface Pose {
  readonly translate: readonly [number, number, number]
  readonly scale: readonly [number, number, number]
  readonly lean: readonly [number, number]
}

const STILL: Pose = { translate: [0, 0, 0], scale: [1, 1, 1], lean: [0, 0] }

/** Reads keyframes, or throws naming `owner`. */
export function poseFramesOf(keyframes: readonly BuildingKeyframe[], owner: string): PoseFrames {
  const offsets = offsetsOf(keyframes, owner)
  return {
    translate: framesOf(
      keyframes,
      offsets,
      (frame, at) => {
        const move = frame.translate
        if (move === undefined) return undefined
        if (!triple(move)) {
          throw new Error(`${owner}: keyframe ${at} translates by something other than [east, north, up]`)
        }
        return move
      },
      owner,
    ),
    scale: framesOf(
      keyframes,
      offsets,
      (frame, at) => {
        const grown = frame.scale
        if (grown === undefined) return undefined
        if (typeof grown === 'number') return [grown, grown, grown] as const
        if (!triple(grown)) {
          throw new Error(
            `${owner}: keyframe ${at} scales by something other than a number or [east, north, up]`,
          )
        }
        return grown
      },
      owner,
    ),
    lean: framesOf(
      keyframes,
      offsets,
      (frame, at) => {
        const tilt = frame.tilt
        if (tilt === undefined) return undefined
        if (!Array.isArray(tilt) || tilt.length !== 2 || !tilt.every(Number.isFinite)) {
          throw new Error(`${owner}: keyframe ${at} tilts by something other than [bearing, degrees]`)
        }
        const [bearing, degrees] = tilt as [number, number]
        const radians = (bearing * Math.PI) / 180
        return [degrees * Math.sin(radians), degrees * Math.cos(radians)] as const
      },
      owner,
    ),
  }
}

function triple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((part) => Number.isFinite(part))
}

/** How a building stands `progress` of the way through a run. */
export function poseAt(frames: PoseFrames, progress: number): Pose {
  return {
    translate: valueAt(frames.translate, progress, STILL.translate, mixTriples),
    scale: valueAt(frames.scale, progress, STILL.scale, mixTriples),
    lean: valueAt(frames.lean, progress, STILL.lean, mixPairs),
  }
}

/** A building grown to nothing would leave its faces pointing nowhere. */
const THINNEST = 1e-4

const grown = new Matrix4()
const leaned = new Matrix4()
const step = new Matrix4()
const axis = new Vector3()

/**
 * The matrix that puts a building standing on `foot` where `pose` says, in the
 * metres its mesh is drawn in.
 *
 * North runs toward -z, since z runs south.
 */
export function composePose(pose: Pose, foot: Foot, out: Matrix4): Matrix4 {
  const east = thick(pose.scale[0])
  const north = thick(pose.scale[1])
  const up = thick(pose.scale[2])
  const { x, z } = foot

  // Grown about the middle of the foot, which keeps it on the ground
  grown
    .makeTranslation(x, 0, z)
    .multiply(step.makeScale(east, up, north))
    .multiply(step.makeTranslation(-x, 0, -z))

  const [leanEast, leanNorth] = pose.lean
  const degrees = Math.hypot(leanEast, leanNorth)
  if (degrees > 1e-6) {
    const dirX = leanEast / degrees
    const dirZ = -leanNorth / degrees
    const reach = foot.reach(dirX, dirZ, east, north)
    const edgeX = x + dirX * reach
    const edgeZ = z + dirZ * reach
    // Turning about up × direction tips the top toward the direction
    axis.set(dirZ, 0, -dirX)
    leaned
      .makeTranslation(edgeX, 0, edgeZ)
      .multiply(step.makeRotationAxis(axis, (degrees * Math.PI) / 180))
      .multiply(step.makeTranslation(-edgeX, 0, -edgeZ))
  } else {
    leaned.identity()
  }

  const [moveEast, moveNorth, moveUp] = pose.translate
  return out.makeTranslation(moveEast, moveUp, -moveNorth).multiply(leaned).multiply(grown)
}

function thick(scale: number): number {
  if (Math.abs(scale) >= THINNEST) return scale
  return scale < 0 ? -THINNEST : THINNEST
}
