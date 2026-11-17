import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js'
import {
  attribute,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  float,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  positionLocal,
  screenDPR,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'
import { uniform } from '../repaint.js'
import {
  InstancedBufferAttribute,
  Vector3,
  type Matrix4,
  type Mesh,
  type Node,
  type ColorRepresentation,
} from 'three/webgpu'
import { MaskShader, type MaskArea } from '../mask.js'
import { ThinLineMaterial } from '../thinLine.js'

import { APPEAR, overGround, stillUnder } from '../appear.js'
import { BATCH_ID } from './attributes.js'
import { PICTURE_ONLY } from '../passes.js'
import { notPicked } from '../pick.js'
import { creasesOf } from './creases.js'
import { hemOf, underfootOf } from './underfoot.js'
import type { Crowds } from './crowd.js'

/**
 * Drawing the lines along the edges where a building folds.
 *
 * WebGPU draws a line one pixel wide and no wider, so each edge is drawn as a
 * strip of its own, a set number of pixels across and turned to face the
 * screen. The strips are drawn with the rest of the picture and smoothed with
 * it, so a fold line holds still while the view moves.
 */

/** How wide an edge line is drawn where a page does not say, in pixels of the page. */
export const DEFAULT_EDGE_WIDTH = 1

/**
 * How far a fold line is drawn nearer than the edge it follows, in pixels of
 * the page.
 *
 * An edge lies on the faces it joins, and a line drawn exactly there is as far
 * off as they are: across its width it goes under a face turning towards the
 * camera, and flickers against one that is not. Brought forward it clears
 * both. The view is flat-on, so a pixel covers the same stretch of the world
 * anywhere on screen and the lift can be counted in pixels.
 */
const LIFT = 2

/** Where a mesh keeps the lines drawn along its edges. */
const TRACED = 'plateauEdges'

/**
 * Where a line says whether a page has taken its building out of the city.
 *
 * Its own attribute rather than the walls' `BUILDING_SLOTS`: a line is an instance
 * of a geometry of its own and shares no corner with the mesh it was cut from,
 * so there is nothing of the building's to read. One float an instance, a few
 * hundred instances a building.
 */
const TAKEN_OUT = 'instanceTakenOut'
/**
 * Where a line says two things about the ground its building rises out of, in
 * the metres the line's ends are given in: how high that ground is, and how far
 * under its own nought the building's walls are carried to meet the slope (the
 * hem).
 *
 * The ends are cut from a building seated on a nought of its own and then
 * raised onto the land, so their nought is the sea's and not the building's.
 * The first of the two is what takes the land back off again.
 *
 * The two are kept apart, in one attribute of two components rather than one of
 * one, because what reads them wants different sums of them: the height the
 * crowd throws a line by is reckoned from the building's own foot and so wants
 * the land alone, and the test that keeps a line above the ground is reckoned
 * from the ground and so wants the hem added back — it is the one part under
 * the building's own nought on purpose, and the very part a test that did not
 * know of it would throw away.
 */
const FLOOR = 'instanceFloor'

/**
 * A mesh's fold lines, and what it takes to move part of them.
 *
 * The lines of a moving building are moved here rather than in the shader.
 * A line is drawn as a ribbon spread from its two ends, and the material
 * spreads it before anything of ours is laid on, so moving the ribbon would
 * take the width with it: a building grown twice as big would have lines twice
 * as thick. Moved at the ends instead, the ribbon is spread afresh from where
 * they now are, which is what the picture wants.
 *
 * A few hundred lines a building, rewritten as the motion runs, is nothing
 * beside the tens of thousands of corners a tile carries.
 */
interface Traced {
  readonly lines: LineSegments2
  /** Which of the lines are not drawn, because their building is out. */
  readonly taken: InstancedBufferAttribute
  /** Both ends of every line as they were cut, which the moved ones come from. */
  readonly rest: Float32Array
  /**
   * When each line's building sets off and how far under the far end of its
   * way lies — the two numbers a corner of that building carries, copied onto
   * the line so that the line comes up with it.
   */
  readonly appear: InstancedBufferAttribute
  /** Which lines each building owns, by the tile's own number for it. */
  readonly of: Map<number, number[]>
  /** The buildings whose lines are away from where they were cut. */
  readonly moved: Set<number>
  /**
   * How high the ground is under each building, in metres, or nothing where
   * the land is drawn flat.
   *
   * The buildings themselves are stood on it in the shader, which these lines
   * cannot be: a line is spread into a ribbon before anything of ours is laid
   * on, so what is moved has to be the ends. They are cut from a shape that
   * stands on its own nought, as everything read off a building is, and
   * lifted onto the land here, after whatever moves them has had its say.
   */
  readonly under: Float32Array | undefined
}

/**
 * The lines along every building's folds, sharing one material.
 *
 * Each mesh carries its own lines as a child, so they stand, move and go with
 * it. The lines are drawn into the picture alone: they cast no shadow and
 * close in no corner.
 *
 * Not the line round a building a page has pointed at — that is found on the
 * screen, over one picture holding every layer, and belongs to the viewer;
 * see {@link Outlines}. These are cut from the shape itself, which is right
 * for a fold and wrong for an outline: a fold *is* an edge inside the shape.
 */
export class Edges {
  // Its edge is its own; see `ThinLineMaterial` for why three's is not used.
  private readonly material = new ThinLineMaterial({ linewidth: DEFAULT_EDGE_WIDTH })
  private readonly lift = uniform(LIFT)
  private readonly cut = new MaskShader()

  /**
   * The waves are handed in rather than made here: the lines have to be
   * thrown by the same waves as the walls they are drawn along, and a wave is
   * the ground's. Asked of the same crowd the walls ask, so a start read by one
   * is read by the other — but of a node of its own, built from what a line
   * carries, since what the two must agree on is the height they are measured
   * by and they hold it in different places.
   */
  constructor(crowds: Crowds) {
    // How much of the world a pixel of the page covers: the projection scales
    // across by two over the width the view takes in.
    const across = cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x
    const perPixel = float(2).div(across.mul(viewport.z.div(screenDPR)))
    // The camera looks down its own -z, so its z points back at it
    const towards = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz
    const lift = modelWorldMatrixInverse.mul(vec4(towards.mul(perPixel.mul(this.lift)), 0)).xyz
    const onWorld = modelWorldMatrix.mul(vec4(positionLocal, 1))
    // How far under where it belongs the line still is, while its building
    // comes up out of the ground or goes back under it. The same reading the
    // walls take, off the same two numbers — written here on the line rather
    // than on a corner, since a line is an instance of a geometry of its own.
    //
    // A line can follow this where it cannot follow a building being grown:
    // coming up is one translation, and both ends moved by the same amount
    // leave the ribbon spread between them exactly as wide as it was. It is
    // scale that a line cannot take.
    const under = stillUnder()
    // Where the line rests before any of this: the two attributes the material
    // spread the ribbon from, read by the same end it picked itself. Both the
    // height the crowd throws it by and the test that keeps it above the ground
    // are measured from here, and neither can be measured from `positionLocal`.
    //
    // The test cannot. `positionLocal` is a varying that
    // `NodeMaterial.setupPosition` rewrites with `positionNode`, and
    // `overGround` wraps what it is handed in a varying of its own, whose
    // vertex code three appends to the *end* of the vertex flow. So a test
    // reading `positionLocal.y` read it after the assignment below had run —
    // the corner already dropped by `under`, carried the two pixels forward
    // and thrown by the crowd — and then took `under` off a second time.
    //
    // The throw cannot either, though for the other reason: inside
    // `positionNode` the expanded quad corner is still what `positionLocal`
    // says, but that corner has already been raised onto the land, and a `rise`
    // is reckoned against a height over the building's own foot.
    //
    // The three other callers of `overGround` (the walls in `Buildings`, the
    // trees and the lines round them in `ground/materials.ts`) hand it
    // `positionGeometry`, which nothing rewrites, which is why none of them
    // ever met the first of those. Only `.y` is wanted of an end, so only `.y`
    // is picked, rather than carrying all three components through the branch
    // to read one of them.
    const end = positionGeometry.y
      .lessThan(0.5)
      .select(attribute('instanceStart', 'vec3').y, attribute('instanceEnd', 'vec3').y)
    // How high the land under the building is, and the hem its walls are
    // carried below their own nought to meet the slope
    const floor = attribute(FLOOR, 'vec2')
    // The end in the building's own measure: the land taken back off, and
    // whatever of the building is still under the ground on its way up taken
    // off with it. That is the very height the walls hand over — there,
    // `positionLocal.y` less the same `under`, on corners seated on the
    // building's own nought — so a `rise` throws a line exactly as far as the
    // wall it is drawn along. Measured off the sea, as it was until the crowd
    // could give each caller a node of its own, it was thrown further by the
    // whole height of the land under it — tens of metres on the coast, some
    // six hundred at 松本.
    const thrown = crowds.movedBy(onWorld.xz as Node<'vec2'>, end.sub(floor.x).sub(under) as Node<'float'>)
    this.material.positionNode = positionLocal
      .sub(vec3(0, under, 0))
      .add(lift)
      .add(thrown)
    // A fat line assigns its expanded quad back into `positionLocal` before
    // the world matrix, so the world place of a fragment is the place on the
    // line and the mask cuts a line exactly where it cuts the wall under it.
    //
    // And with the mask, whatever a page has taken out of the city. The walls
    // read the same thing off their own corners and this reads it off the
    // line, and both ride the mask's test rather than one of their own: a
    // building hidden and still lined is the building's plan left drawn on
    // the ground, which is what a page asking for it gone did not ask for.
    //
    // And with them, whatever of a line has gone under the ground on its way
    // up. The ground does write its own depth and hides most of it, but a
    // viewer cut to a shape has stretches with no ground in them at all, and
    // a line hanging past that rim is the one place it would show.
    //
    // Reckoned from the ground the building rises out of, where the throw above
    // is reckoned from the building's own foot — hence the hem added back here
    // and not there. The two are the same distance apart as the walls' own two
    // readings: the wall is thrown by `positionLocal.y` less `under` and tested
    // on that same height with `hemBelow()` added.
    const drawn = attribute(TAKEN_OUT, 'float')
      .lessThan(0.5)
      .and(overGround(end.sub(floor.x.sub(floor.y)).sub(under) as Node<'float'>))

    this.cut.apply(this.material, drawn)
  }

  /** The shape the lines are cut to, in world units, or null for none. */
  set mask(area: MaskArea | null) {
    this.cut.set(area)
  }

  /** What the mask's hem takes the line over to. */
  set fadeInto(colour: string) {
    this.cut.fadeInto(colour)
  }

  set colour(value: ColorRepresentation) {
    this.material.color.set(value)
  }

  /** How wide the lines are drawn, in pixels of the page. */
  get width(): number {
    return this.material.width
  }

  /**
   * Draws them wider or finer.
   *
   * One width for every line, since they are one shape read by one material —
   * the same reason they are one colour. A page wanting a line round one
   * building alone is after something else than the city's own fold lines.
   */
  set width(value: number) {
    this.material.width = value
  }

  /** Whether the lines are drawn. Lines already traced are kept while hidden. */
  set visible(on: boolean) {
    this.material.visible = on
  }

  /**
   * Traces a mesh's fold lines as they stand now, unless they have been already.
   *
   * A mesh with no edges to draw is marked as traced all the same, so it is
   * not read again every time the view is brought up to date.
   */
  trace(mesh: Mesh, out: ReadonlySet<number> | null = null): void {
    if (mesh.userData[TRACED] !== undefined) return
    const creases = creasesOf(mesh.geometry)
    if (!creases || creases.segments.length === 0) {
      mesh.userData[TRACED] = null
      return
    }
    const { segments, owners } = creases
    const under = underfootOf(mesh)
    // The geometry keeps the very array it is given, so it is given one of its
    // own: what is drawn is moved in place, and what was cut has to stay put
    // for the moved ends to be worked out from.
    const ends = segments.slice()
    if (under) {
      for (let line = 0; line < owners.length; line++) {
        raise(ends, line, under[owners[line] ?? -1] ?? 0)
      }
    }
    const drawn = new LineSegmentsGeometry().setPositions(ends)
    // Nought a line, which is every line drawn. What a page has taken out is
    // written on below, where it is written whenever it changes.
    const taken = new InstancedBufferAttribute(new Float32Array(owners.length), 1)
    drawn.setAttribute(TAKEN_OUT, taken)
    // ...and the same for the coming and going, which `follow` writes from the
    // corners at the foot of this method and again whenever they are stamped
    const appear = new InstancedBufferAttribute(new Float32Array(owners.length * 2), 2)
    drawn.setAttribute(APPEAR, appear)
    // Where the ground is under each line, and how far its building's walls
    // hang below their own nought to meet it. Neither changes while the mesh
    // wears this shape. Kept apart rather than summed, since the throw wants
    // the land alone and the ground test wants the hem added back
    const hem = hemOf(mesh)
    const floor = new Float32Array(owners.length * 2)
    for (let line = 0; line < owners.length; line++) {
      const building = owners[line] ?? -1
      floor[line * 2] = under?.[building] ?? 0
      floor[line * 2 + 1] = hem?.[building] ?? 0
    }
    drawn.setAttribute(FLOOR, new InstancedBufferAttribute(floor, 2))
    const lines = new LineSegments2(drawn, this.material)
    lines.layers.set(PICTURE_ONLY)
    // The building itself answers for a click on it; its own fold lines would be
    // a second answer for the same building, and a worse-placed one
    notPicked(lines)
    mesh.add(lines)

    const of = new Map<number, number[]>()
    for (let line = 0; line < owners.length; line++) {
      const building = owners[line] ?? -1
      const kept = of.get(building)
      if (kept) kept.push(line)
      else of.set(building, [line])
    }
    mesh.userData[TRACED] = {
      lines,
      taken,
      rest: segments,
      appear,
      of,
      moved: new Set<number>(),
      under,
    } satisfies Traced
    this.mark(mesh, out)
    this.follow(mesh)
  }

  /**
   * Says on a mesh's lines which of them a page has taken out of the city.
   *
   * Called wherever that may have changed — a page hiding or showing a
   * building, a tile landing with one already hidden — and alongside the same
   * being said on the walls' corners, so the two cannot come apart. A mesh
   * with no lines yet is left; its lines are told as they are cut.
   */
  mark(mesh: Mesh, out: ReadonlySet<number> | null): void {
    const traced = mesh.userData[TRACED] as Traced | null | undefined
    if (!traced) return
    const taken = traced.taken.array as Float32Array
    let changed = false
    for (const [building, lines] of traced.of) {
      const away = out?.has(building) ? 1 : 0
      for (const line of lines) {
        if (taken[line] !== away) {
          taken[line] = away
          changed = true
        }
      }
    }
    if (changed) traced.taken.needsUpdate = true
  }

  /**
   * Puts the lines of the buildings named where their motions have them, and
   * the lines of any that stopped back where they were cut.
   */
  move(mesh: Mesh, moves: ReadonlyMap<number, Matrix4>): void {
    const traced = mesh.userData[TRACED] as Traced | null | undefined
    if (!traced) return
    const ends = traced.lines.geometry.getAttribute('instanceStart')
    const buffer = (ends as unknown as { data?: { array: Float32Array; needsUpdate: boolean } }).data
    if (!buffer) return

    // Changed only where a line ended up somewhere else: a motion holding at
    // its end is handed over every frame, and a buffer marked changed is a
    // picture drawn again for nothing (`repaint.ts`)
    let changed = false
    for (const [building, matrix] of moves) {
      const lines = traced.of.get(building)
      if (!lines) continue
      const lift = traced.under?.[building] ?? 0
      for (const line of lines) changed = place(buffer.array, traced.rest, line, matrix, lift) || changed
      traced.moved.add(building)
    }
    for (const building of traced.moved) {
      if (moves.has(building)) continue
      const lines = traced.of.get(building)
      const lift = traced.under?.[building] ?? 0
      if (lines)
        for (const line of lines) changed = place(buffer.array, traced.rest, line, null, lift) || changed
      traced.moved.delete(building)
    }
    if (changed) buffer.needsUpdate = true
  }

  /**
   * Copies onto a mesh's lines what its corners now say about coming and
   * going, so the lines rise and sink with the buildings they were cut from.
   *
   * Read back off the corners rather than worked out again. The stamp is not
   * one formula but three — a tile landing, a mesh cut anew, and a building
   * turned round part way — and a second place working out the same answer is
   * a second place to get it wrong. Called wherever the corners are stamped,
   * by whoever stamps them.
   *
   * Every corner of a building carries the same two numbers, so the first of
   * its corners met answers for the building.
   */
  follow(mesh: Mesh): void {
    const traced = mesh.userData[TRACED] as Traced | null | undefined
    if (!traced) return
    const said = mesh.geometry.attributes[APPEAR]
    const batch = mesh.geometry.attributes[BATCH_ID]
    if (!said || !batch) return

    const stamps = new Map<number, [number, number]>()
    for (let v = 0; v < batch.count; v++) {
      const building = batch.getX(v)
      if (stamps.has(building)) continue
      stamps.set(building, [said.getX(v), said.getY(v)])
    }
    const onLines = traced.appear.array as Float32Array
    for (const [building, lines] of traced.of) {
      const stamp = stamps.get(building)
      for (const line of lines) {
        onLines[line * 2] = stamp?.[0] ?? 0
        onLines[line * 2 + 1] = stamp?.[1] ?? 0
      }
    }
    traced.appear.needsUpdate = true
  }

  /** Takes a mesh's lines away, to be traced again from the shape it wears next. */
  clear(mesh: Mesh): void {
    const traced = mesh.userData[TRACED] as Traced | null | undefined
    if (traced) {
      traced.lines.removeFromParent()
      traced.lines.geometry.dispose()
    }
    delete mesh.userData[TRACED]
  }

  dispose(): void {
    this.material.dispose()
  }
}

const corner = new Vector3()

/**
 * Puts one line's ends where a matrix has them, or back where they were cut,
 * and then onto the ground its building stands on.
 *
 * The ground comes after the matrix, as it does for the corners of the
 * building itself: what moves a building moves it about its own foot, and the
 * whole of it is set down on the land afterwards.
 */
function place(
  live: Float32Array,
  rest: Float32Array,
  line: number,
  matrix: Matrix4 | null,
  lift: number,
): boolean {
  const at = line * 6
  let changed = false
  for (let end = 0; end < 2; end++) {
    const i = at + end * 3
    if (matrix) {
      corner.set(rest[i] ?? 0, rest[i + 1] ?? 0, rest[i + 2] ?? 0).applyMatrix4(matrix)
      changed = put(live, i, corner.x) || changed
      changed = put(live, i + 1, corner.y + lift) || changed
      changed = put(live, i + 2, corner.z) || changed
    } else {
      changed = put(live, i, rest[i] ?? 0) || changed
      changed = put(live, i + 1, (rest[i + 1] ?? 0) + lift) || changed
      changed = put(live, i + 2, rest[i + 2] ?? 0) || changed
    }
  }
  return changed
}

/** Writes one number as the 32-bit float the buffer holds it as, and says whether it was not there. */
function put(array: Float32Array, at: number, value: number): boolean {
  const held = Math.fround(value)
  if (array[at] === held) return false
  array[at] = held
  return true
}

/** Lifts one line, as it was cut, onto the ground its building stands on. */
function raise(ends: Float32Array, line: number, lift: number): void {
  if (lift === 0) return
  const at = line * 6
  ends[at + 1] = (ends[at + 1] ?? 0) + lift
  ends[at + 4] = (ends[at + 4] ?? 0) + lift
}
