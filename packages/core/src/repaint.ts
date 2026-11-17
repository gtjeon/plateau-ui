import {
  cubeTexture as threeCubeTexture,
  texture as threeTexture,
  uniform as threeUniform,
  uniformArray as threeUniformArray,
} from 'three/tsl'
import type { Camera, Object3D, Scene } from 'three/webgpu'

/*
 * Whether this frame would draw the picture already on the canvas.
 *
 * The map is drawn only when something in it changed (Mapbox draws the same
 * way). Standing still, a map drawn again every frame is the same picture for
 * the price of a whole frame — most of it the corner shading, about 12 ms on
 * the examples — for as long as the tab is open, on a laptop's battery.
 *
 * What changes a picture here comes from a great many places: well over a
 * hundred lines write a value a shader reads, a colour or a width or an
 * opacity, and as many again rebuild a shape. Having each of them say so would
 * be right until the first one that forgot, and that one would leave the map
 * showing what was there before — a wrong answer, which is worse than a slow
 * one. So nothing has to say so. What is read is compared instead: every value
 * the library hands a shader, and everything the scene holds as three draws
 * it. A frame is drawn when either differs from the frame before.
 *
 * What cannot be compared is said: things that move in the shader on a clock
 * of their own say so through `Viewer.stirShadows` (the line the sun's map
 * already needed), and a page that changes something of the library's through
 * three itself calls `Viewer.triggerRepaint`.
 */

/**
 * The library's uniforms and textures, made through here so that they can be
 * compared frame to frame — the same functions as three's, under the same
 * names, which is all a file has to change to be watched: where they come from.
 *
 * Module-wide, as `appear.ts`'s clock is, because a uniform is made long before
 * it knows its viewer — in a material's constructor, in a shader's weaving —
 * and some (the appear clock) are no one viewer's at all. Held weakly, so a
 * material let go of takes its values with it. A value changed under one viewer
 * redraws the others too, which costs a frame and is never wrong.
 */
const watched: Watched[] = []

interface Watched {
  readonly node: WeakRef<object>
  readonly read: (node: object) => unknown
  numbers: number[]
  things: unknown[]
}

/** Counted up on every frame some watched value was found changed. */
let changes = 0

/** Made in any frame: the numbers and things of one value, written into and then compared. */
const numbersNow: number[] = []
const thingsNow: unknown[] = []

function watch<T extends object>(node: T, read: (node: T) => unknown): T {
  const entry: Watched = {
    node: new WeakRef(node),
    read: read as (node: object) => unknown,
    numbers: [],
    things: [],
  }
  watched.push(entry)
  return node
}

/** Three's `uniform`, watched. */
export const uniform: typeof threeUniform = ((...args: unknown[]) =>
  watch(
    (threeUniform as (...given: unknown[]) => { value: unknown })(...args),
    (node) => node.value,
  )) as typeof threeUniform

/** Three's `uniformArray`, watched: its values are changed in place, so each is read. */
export const uniformArray: typeof threeUniformArray = ((...args: unknown[]) =>
  watch(
    (threeUniformArray as (...given: unknown[]) => { array: unknown })(...args),
    (node) => node.array,
  )) as typeof threeUniformArray

/** Three's `texture`, watched: which texture it reads, and what is in it. */
export const texture: typeof threeTexture = ((...args: unknown[]) =>
  watch(
    (threeTexture as (...given: unknown[]) => { value: unknown })(...args),
    (node) => node.value,
  )) as typeof threeTexture

/** Three's `cubeTexture`, watched as `texture` is. */
export const cubeTexture: typeof threeCubeTexture = ((...args: unknown[]) =>
  watch(
    (threeCubeTexture as (...given: unknown[]) => { value: unknown })(...args),
    (node) => node.value,
  )) as typeof threeCubeTexture

/**
 * How many frames have found a watched value changed. A viewer keeps the count
 * it last saw; a different count is a change since — so two viewers on one
 * page each see what the other's look took in.
 */
export function uniformChanges(): number {
  let changed = false
  for (let i = 0; i < watched.length;) {
    const entry = watched[i]!
    const node = entry.node.deref()
    if (!node) {
      // Swapped out rather than spliced: the order of the list means nothing
      watched[i] = watched[watched.length - 1]!
      watched.pop()
      continue
    }
    numbersNow.length = 0
    thingsNow.length = 0
    note(entry.read(node), numbersNow, thingsNow)
    if (!same(entry.numbers, numbersNow) || !same(entry.things, thingsNow)) {
      entry.numbers = numbersNow.slice()
      entry.things = thingsNow.slice()
      changed = true
    }
    i++
  }
  if (changed) changes++
  return changes
}

/** A scratch array for `toArray`, long enough for a four-by-four matrix. */
const spread: number[] = new Array<number>(16).fill(0)

/**
 * Writes a value down as numbers, and as the things it holds by reference.
 *
 * A texture is written as itself and its version: the version is what three
 * counts up when what is in it is to go to the card again, which is when the
 * picture changes. A vector, a colour or a matrix is written as its numbers,
 * since those are changed in place.
 */
function note(value: unknown, numbers: number[], things: unknown[]): void {
  if (typeof value === 'number') numbers.push(value)
  else if (typeof value === 'boolean') numbers.push(value ? 1 : 0)
  else if (value === null || value === undefined) numbers.push(Number.NEGATIVE_INFINITY)
  else if (Array.isArray(value)) for (const one of value) note(one, numbers, things)
  else if (typeof value === 'object') {
    const object = value as { isTexture?: boolean; version?: number; toArray?: (out: number[]) => number[] }
    if (object.isTexture) {
      things.push(value)
      numbers.push(object.version ?? 0)
    } else if (typeof object.toArray === 'function') {
      const all = object.toArray(spread)
      const count =
        'elements' in object ? (object as { elements: ArrayLike<number> }).elements.length : sizeOf(object)
      for (let i = 0; i < count; i++) numbers.push(all[i] ?? 0)
    } else things.push(value)
  } else things.push(value)
}

/** How many numbers a vector or a colour writes. */
function sizeOf(object: object): number {
  if ('w' in object) return 4
  if ('z' in object || 'r' in object) return 3
  return 2
}

function same(before: readonly unknown[], now: readonly unknown[]): boolean {
  if (before.length !== now.length) return false
  for (let i = 0; i < now.length; i++) if (!Object.is(before[i], now[i])) return false
  return true
}

/**
 * The scene as three would draw it, written down once a frame and compared
 * with the frame before.
 *
 * What is written is what three reads to draw: which objects are shown, in what
 * order and where, the shape each draws and the version of every attribute of
 * it, the material and the values three reads off it on its own (colour,
 * opacity), the lights, the fog, and the camera and the size of the canvas.
 * A page's own three objects are in it like the library's, so a mesh moved, a
 * colour set or an instance matrix written is a frame drawn without anyone
 * saying so.
 *
 * What is not in it is what three cannot see either: a value a material's
 * shader worked out of something else when it was woven. That is what the
 * watched uniforms above are for.
 */
export class SceneState {
  private before: number[] = []
  private now: number[] = []
  private thingsBefore: unknown[] = []
  private thingsNow: unknown[] = []

  /** Whether the scene differs from the last time it was asked. */
  changed(scene: Scene, camera: Camera, width: number, height: number): boolean {
    const numbers = this.now
    const things = this.thingsNow
    numbers.length = 0
    things.length = 0
    // Three brings these up as it draws; they are brought up here first so that
    // what is compared is where things are this frame, not where they were
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    numbers.push(width, height)
    pushMatrix(numbers, camera.matrixWorld.elements)
    pushMatrix(numbers, camera.projectionMatrix.elements)
    numbers.push(camera.layers.mask)
    things.push(scene.background, scene.environment)
    const fog = scene.fog as {
      color?: { r: number; g: number; b: number }
      near?: number
      far?: number
      density?: number
    } | null
    if (fog) {
      things.push(fog)
      if (fog.color) numbers.push(fog.color.r, fog.color.g, fog.color.b)
      numbers.push(fog.near ?? 0, fog.far ?? 0, fog.density ?? 0)
    }
    scene.traverseVisible((object) => writeDown(object, numbers, things))
    const changed = !same(this.before, numbers) || !same(this.thingsBefore, things)
    // The two halves trade places, so that neither is made anew each frame
    this.now = this.before
    this.before = numbers
    this.thingsNow = this.thingsBefore
    this.thingsBefore = things
    return changed
  }
}

function pushMatrix(numbers: number[], elements: ArrayLike<number>): void {
  for (let i = 0; i < 16; i++) numbers.push(elements[i] ?? 0)
}

type Drawn = Object3D & {
  isMesh?: boolean
  isLine?: boolean
  isPoints?: boolean
  isSprite?: boolean
  isLight?: boolean
  isInstancedMesh?: boolean
  geometry?: Shape
  material?: Material | Material[]
  count?: number
  instanceMatrix?: { version: number }
  instanceColor?: { version: number } | null
  morphTargetInfluences?: number[]
  color?: { r: number; g: number; b: number }
  intensity?: number
}

interface Shape {
  readonly id: number
  readonly index: { version: number } | null
  readonly attributes: Record<string, { version?: number; data?: { version: number } }>
  readonly drawRange: { start: number; count: number }
  readonly instanceCount?: number
}

interface Material {
  readonly id: number
  readonly version: number
  readonly opacity: number
  readonly visible: boolean
  readonly color?: { r: number; g: number; b: number }
  readonly emissive?: { r: number; g: number; b: number }
  readonly map?: { version: number } | null
}

function writeDown(object: Object3D, numbers: number[], things: unknown[]): void {
  const drawn = object as Drawn
  numbers.push(object.id, object.renderOrder, object.layers.mask)
  pushMatrix(numbers, object.matrixWorld.elements)
  if (drawn.isMesh || drawn.isLine || drawn.isPoints || drawn.isSprite) {
    const geometry = drawn.geometry
    if (geometry) {
      numbers.push(
        geometry.id,
        geometry.index?.version ?? -1,
        geometry.drawRange.start,
        geometry.drawRange.count,
      )
      numbers.push(geometry.instanceCount ?? -1)
      for (const name in geometry.attributes) {
        const attribute = geometry.attributes[name]!
        numbers.push(attribute.version ?? attribute.data?.version ?? -1)
      }
    }
    const material = drawn.material
    if (Array.isArray(material)) for (const one of material) writeMaterial(one, numbers, things)
    else if (material) writeMaterial(material, numbers, things)
    if (drawn.isInstancedMesh) {
      numbers.push(drawn.count ?? 0, drawn.instanceMatrix?.version ?? -1, drawn.instanceColor?.version ?? -1)
    }
    const influences = drawn.morphTargetInfluences
    if (influences) for (const one of influences) numbers.push(one)
  } else if (drawn.isLight) {
    if (drawn.color) numbers.push(drawn.color.r, drawn.color.g, drawn.color.b)
    numbers.push(drawn.intensity ?? 0)
  }
}

function writeMaterial(material: Material, numbers: number[], things: unknown[]): void {
  things.push(material)
  numbers.push(material.version, material.opacity, material.visible ? 1 : 0)
  if (material.color) numbers.push(material.color.r, material.color.g, material.color.b)
  if (material.emissive) numbers.push(material.emissive.r, material.emissive.g, material.emissive.b)
  if (material.map) {
    things.push(material.map)
    numbers.push(material.map.version)
  }
}
