import { BufferAttribute, Matrix4, type Mesh } from 'three/webgpu'
import { play, type Animation, type Playing, type Timing } from '../motion/motion.js'
import { BATCH_ID, BUILDING_SLOTS } from './attributes.js'
import { BUILDING_FACTS, type BuildingFacts } from './tileContent.js'
import { footOf } from './foot.js'
import { composePose, poseAt, poseFramesOf, type BuildingKeyframe, type PoseFrames } from './pose.js'
import { MOTION_SLOTS, releaseSlot, takeSlot, writeSlot } from './slots.js'

/**
 * The motions playing on single buildings.
 *
 * A motion is held by the name PLATEAU gives its building, which is the only
 * name that travels between tiles. So a motion outlives the tile it started
 * on: the tile may be thrown out for memory and fetched again, and its
 * building stands where the motion has got to by then, without the page
 * knowing any of it happened.
 *
 * What the shaders read is a row of the table (see slots.ts), and what says
 * which row a corner belongs to is a number on the corner. That number is
 * written afresh whenever a mesh is built or cut again, from the one thing
 * that is true of a building whatever its corners do: the tile's own number
 * for it.
 */

/** No building of a mesh is moving. */
const NONE: ReadonlyMap<number, Matrix4> = new Map()

/** What the motions ask of the buildings they move. */
export interface MotionHost {
  /**
   * The mesh a building is drawn in, by its name, and where in it — or nothing
   * where none holds it.
   *
   * Asked of the buildings rather than found by walking their meshes: a city
   * building a page moved is in two of them, the tile it came in and the one
   * it stands in on its own, and only the buildings know which is drawn.
   */
  standing(id: string): { mesh: Mesh; at: number } | null
  /**
   * Puts the lines along a mesh's folds where its moving buildings now are.
   * The lines of a building left out of the list go back where they were cut.
   */
  lineUp(mesh: Mesh, moves: ReadonlyMap<number, Matrix4>): void
  /**
   * Writes afresh which row of the table each of a mesh's buildings reads.
   *
   * Single motions and crowds both write there, so neither may clear it: one
   * would rub out the other's. Whoever holds them both clears it once and
   * lets each lay its own on top.
   */
  remark(mesh: Mesh): void
}

/** One motion playing on one building. */
interface Running {
  readonly motion: Playing
  readonly frames: PoseFrames
  /** The row of the table it writes to. */
  readonly slot: number
  readonly matrix: Matrix4
}

export class BuildingMotions {
  readonly #host: MotionHost
  /** By the name PLATEAU gives the building. One motion to a building. */
  readonly #running = new Map<string, Running>()
  /** The meshes told of a move last frame, so the ones that stopped are told too. */
  #lined = new Set<Mesh>()

  constructor(host: MotionHost) {
    this.#host = host
  }

  /** Whether anything is moving, so a mesh coming in knows to ask. */
  get any(): boolean {
    return this.#running.size > 0
  }

  /**
   * Moves one building as the keyframes say, timed as the timing says.
   *
   * A building takes one motion at a time: starting another takes it from the
   * one before, whose `finished` settles false. A motion that comes to its end
   * without filling lets its building stand as it stood.
   */
  animate(id: string, keyframes: readonly BuildingKeyframe[], timing: Timing): Animation {
    const owner = 'Buildings.animate'
    if (typeof id !== 'string' || id === '') throw new Error(`${owner}: id is a building's name`)
    const frames = poseFramesOf(keyframes, owner)

    // Taken from the motion it replaces, and its row given back with it.
    // Cancelling alone would leave the row held: the frame that hands rows
    // back walks the motions still running, and this one is about to be
    // replaced in that very map
    const had = this.#running.get(id)
    if (had) {
      had.motion.cancel()
      this.#drop(id, had)
    }
    const slot = takeSlot()
    if (slot === undefined) {
      throw new Error(`${owner}: no more than ${MOTION_SLOTS - 1} buildings move at once`)
    }

    const motion = play(timing, owner)
    this.#running.set(id, { motion, frames, slot, matrix: new Matrix4() })
    // Its corners have to learn their row before the next frame draws them
    const found = this.#host.standing(id)
    if (found) this.mark(found.mesh)
    return motion
  }

  /**
   * Brings every motion up to this frame, and says whether any building was
   * put anywhere it was not last frame — which a motion holding at its end
   * (`fill`) is not, though it is still running here.
   */
  frame(): boolean {
    let moved = false
    const moving = new Map<Mesh, Map<number, Matrix4>>()
    for (const [id, run] of this.#running) {
      const state = run.motion.playState
      if (state === 'idle') {
        this.#drop(id, run)
        continue
      }
      const k = run.motion.progress()
      if (k === null) {
        // Over, and filling nothing: the building stands as it stood
        if (state === 'finished') this.#drop(id, run)
        continue
      }
      const found = this.#place(run, id, k)
      if (!found) continue
      if (found.moved) moved = true
      const mesh = moving.get(found.mesh) ?? new Map<number, Matrix4>()
      mesh.set(found.at, run.matrix)
      moving.set(found.mesh, mesh)
    }

    // The lines are moved here rather than in the shader, so a mesh whose
    // buildings all stopped is told once more to put them back
    for (const mesh of this.#lined) {
      if (moving.has(mesh)) continue
      this.#host.lineUp(mesh, NONE)
      moved = true
    }
    for (const [mesh, moves] of moving) this.#host.lineUp(mesh, moves)
    this.#lined = new Set(moving.keys())
    return moved
  }

  /**
   * Writes onto a mesh which of its corners belong to a moving building.
   *
   * Called for a mesh as its tile lands and whenever it is cut again: cutting
   * parapets builds the geometry anew and leaves the corners it adds saying
   * nothing, so a building cut and moved would send its walls away and leave
   * its parapet behind.
   */
  mark(mesh: Mesh): void {
    if (this.#running.size === 0) return
    const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
    if (!facts) return

    const slots = new Map<number, number>()
    for (const [id, run] of this.#running) {
      const building = facts.ids.indexOf(id)
      if (building >= 0) slots.set(building, run.slot)
    }
    this.#write(mesh, slots)
  }

  /** Stops every motion and lets their rows go. */
  clear(): void {
    for (const [id, run] of this.#running) this.#drop(id, run)
    this.#running.clear()
  }

  /**
   * Where a motion's building stands now, on the mesh drawing it.
   *
   * That mesh is asked of the buildings every frame rather than kept. Which
   * mesh draws a name changes under a running motion: a tile thrown out and
   * fetched again is a mesh of its own, and a city building a page moved is
   * drawn in a tile of its own from the moment that one stands and in the tile
   * it came in again once it is put back. What was kept before was asked only
   * whether it still had a parent, and a mesh whose tile has gone keeps one —
   * the tile's group is what comes off the root, with the mesh still under it.
   * So the motion went on moving a mesh nobody draws: put back in mid-pose, a
   * building stood on the ground with its motion still holding 40m up (seen,
   * 2026-11-04). The buildings keep their answer by name and check it is still
   * on the root, so asking is a lookup.
   */
  #place(run: Running, id: string, progress: number): { mesh: Mesh; at: number; moved: boolean } | null {
    const found = this.#host.standing(id)
    if (!found) return null
    const foot = footOf(found.mesh, found.at)
    if (!foot) return null
    const moved = writeSlot(run.slot, composePose(poseAt(run.frames, progress), foot, run.matrix))
    return { mesh: found.mesh, at: found.at, moved }
  }

  /**
   * Lays this lot's rows onto a mesh's corners, leaving every other corner as
   * it found it — a crowd may have written there, and a building this lot
   * does not move is not this lot's to silence.
   */
  #write(mesh: Mesh, slots: Map<number, number>): void {
    const batch = mesh.geometry.attributes[BATCH_ID]
    const marks = mesh.geometry.attributes[BUILDING_SLOTS] as BufferAttribute | undefined
    if (!batch || !marks) return

    // The fourth of the four a corner carries; the first three are the paint's
    // and are not this hand's to write. See {@link BUILDING_SLOTS}.
    const array = marks.array as Float32Array
    for (let v = 0; v < batch.count && v * 4 + 3 < array.length; v++) {
      const slot = slots.get(batch.getX(v))
      if (slot !== undefined) array[v * 4 + 3] = slot
    }
    marks.needsUpdate = true
  }

  /** Lets a motion go: its row back, and its building standing still again. */
  #drop(id: string, run: Running): void {
    this.#running.delete(id)
    releaseSlot(run.slot)
    // Its corners have to stop reading a row that is no longer its own, and
    // only the whole mesh written afresh can do that without rubbing out what
    // a crowd put there. The mesh drawn for it now, asked rather than kept,
    // for the reason in {@link #place}
    const found = this.#host.standing(id)
    if (found) this.#host.remark(found.mesh)
  }
}
