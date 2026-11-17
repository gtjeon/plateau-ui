import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js'
import { marksSolid } from '../classify.js'
import { decoderFrom } from '../draco.js'
import { transcoderFrom, type DetectsSupport } from '../ktx2.js'
import {
  Box3,
  LoaderUtils,
  LoadingManager,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
  type AnimationClip,
  type Material,
  type Object3D,
} from 'three/webgpu'
import { glows as carriesItsOwnLight, solid, type SolidMaterial } from '../lit.js'
import { transient, Unreadable } from '../transient.js'
import type { Ask } from '../requests.js'

/**
 * Fetching a page's own glTF, and reading it into something this scene can draw.
 *
 * What is held here is the file, not a model: several models of one url share
 * one reading of it, and what each of them puts in the scene is a clone whose
 * corners are the same corners. A street of a hundred lamps is one fetch and
 * one set of geometry.
 *
 * The cache is module-wide, as `elevation.ts` and `cities.ts` are, and for the
 * same reason — it is what was fetched, not what is being drawn. Nothing in it
 * belongs to a viewer, so two viewers on a page share the fetch and neither
 * can take the other's out from under it. The materials are not shared that
 * way: each group makes or copies its own, because what is woven into a
 * material belongs to a viewer, and because the one it would otherwise share
 * is the file's own — which every viewer on the page is drawing from, and
 * which nobody here may dispose.
 */

/**
 * The other way a file's corners come compressed, fetched the first time one
 * asks for it and shared from then on.
 *
 * Draco is given a path because its decoder is a WebAssembly file beside the
 * script; meshopt's is the script, so there is nothing for a page to serve and
 * nothing to point at. Brought in only when a model is read, since a page with
 * no models should not carry it, and awaited before the file is parsed — the
 * loader wants its decoder before it opens anything compressed, not after.
 */
let meshopt: Promise<unknown> | undefined

function meshoptDecoder(): Promise<unknown> {
  meshopt ??= import('three/addons/libs/meshopt_decoder.module.js').then((m) => m.MeshoptDecoder)
  return meshopt
}

/** What one file came to: the scene as it was read, kept to be cloned from. */
export interface ReadModel {
  /** The file's own scene. Never put in a viewer's scene — cloned first. */
  readonly scene: Object3D
  /** How high it reaches over its own origin, in the file's units. */
  readonly rise: number
  /**
   * What moves inside it, as the file names them.
   *
   * Shared, as the corners are: a clip is a list of times and values and
   * nothing about who is playing it. What is not shared is the mixer that
   * plays one, since that holds where a model has got to.
   */
  readonly clips: readonly AnimationClip[]
}

/** Files read, or being read, by url. A failed one is dropped so the next ask goes out afresh. */
const files = new Map<string, Promise<ReadModel>>()

/**
 * What a file needs besides its url: where each decoder that has a place of
 * its own comes from, and who can say what the device takes a compressed
 * picture in.
 *
 * Gathered into one so that a fourth of them costs the callers nothing. They
 * belong to the group that asked, and only the first ask of a url is read —
 * the rest wait on that one, whatever they would have passed.
 */
export interface Reading {
  readonly dracoPath: string
  readonly ktx2Path: string
  readonly detect: DetectsSupport
  /** How the file is fetched: through the viewer's `transformRequest`. */
  readonly ask: Ask
  /** Where the transform sends an address, for what the file names beside it, which three fetches itself. */
  readonly address: (url: string) => string
}

/**
 * Reads the file at a url, once however many models ask for it.
 *
 * The promise is what is held rather than the result, so a second model asking
 * while the first is still in flight waits on that flight instead of starting
 * another.
 */
export function readModel(url: string, how: Reading): Promise<ReadModel> {
  const held = files.get(url)
  if (held) return held

  // A manager of its own, so that what the file names beside it — a `.bin`,
  // its pictures — goes where the page's transform sends it, as the file did
  const manager = new LoadingManager()
  manager.setURLModifier(how.address)
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(decoderFrom(how.dracoPath))
  // These two in hand before the file is opened, not after: the loader wants
  // whatever opens a compressed part at the moment it meets one, and meets it
  // while parsing. Draco is the one that needs no waiting — its loader is made
  // here and fetches its own WebAssembly the first time it is asked to decode.
  const reading = Promise.all([meshoptDecoder(), transcoderFrom(how.ktx2Path, how.detect)])
    .then(async ([decoder, transcoder]) => {
      loader.setMeshoptDecoder(decoder as Parameters<GLTFLoader['setMeshoptDecoder']>[0])
      loader.setKTX2Loader(transcoder)
      // Fetched here and read apart from the fetching, rather than handed to
      // the loader whole, so that the two failures are told apart: a server in
      // a moment's trouble is worth asking again, and a file that came and is
      // not a model is not (see `Unreadable`). Thrown from inside the loader,
      // the two looked the same, and neither was asked about again
      const answer = await how.ask(url, 'model')
      if (!answer.ok) {
        if (transient(answer.status)) throw new Error(`HTTP ${answer.status} for ${url}`)
        throw new Unreadable(`HTTP ${answer.status} for ${url}`)
      }
      const data = await answer.arrayBuffer()
      try {
        return await loader.parseAsync(data, LoaderUtils.extractUrlBase(url))
      } catch (error) {
        throw new Unreadable(`${url} could not be read as a model: ${String(error)}`)
      }
    })
    .then((gltf) => {
      const scene = gltf.scene
      const box = new Box3().setFromObject(scene)
      const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3())
      return { scene, rise: size.y, clips: gltf.animations }
    })
    .catch((error: unknown) => {
      // Dropped rather than kept as a failure: a page that adds the model
      // again, or fixes the url, should reach the network rather than this
      files.delete(url)
      throw error
    })
  files.set(url, reading)
  return reading
}

/**
 * A copy of a file's scene for one model to wear.
 *
 * Three's own clone leaves a skinned mesh pointing at the skeleton of the
 * thing it was copied from, so a street of them would all move as the first
 * one does; this copies the bones too and binds each mesh to its own. The
 * geometry is still shared, which is the point of reading a file once.
 *
 * Used for every model, moving or not — what it does to a scene with no
 * skeleton in it is what a plain clone does.
 */
export function cloneModel(scene: Object3D): Object3D {
  return cloneRigged(scene)
}

/**
 * Whether a material has the scene's lights to go on.
 *
 * The one flag glTF's own materials carry: the loader hands over
 * `MeshStandardMaterial`, or `MeshPhysicalMaterial`, which extends it and
 * carries it too. `KHR_materials_unlit` is the other answer — that comes over
 * as a basic material, and a basic material reads no light whatever stands in
 * the scene.
 *
 * Not `material.lights`, which is this library's own switch for a thing that
 * carries its own light (`lit.ts`) and says nothing about what the file asked
 * for.
 */
function readsLight(from: Material): boolean {
  return (from as Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true
}

/**
 * The file's own material, kept.
 *
 * Kept as a copy, never the object the file was read into: a clone of the
 * scene shares its materials with that reading, and the reading is shared by
 * every model of the url and by every viewer on the page. Disposing it on the
 * way out would empty a file another viewer is still drawing from. The copy
 * shares the pictures, which belong to the reading and are not disposed here.
 *
 * Everything a conversion would drop on the floor survives this — metalness,
 * roughness, the normal map, emissive, and whatever a `MeshPhysicalMaterial`
 * carries over those. The lights in the scene (`lights.ts`) are what light it,
 * and nothing is multiplied over the answer.
 *
 * It gets the city's shadows now, and that is new. The sun's map reaches three
 * as `sun.shadow.shadowNode`, which `AnalyticLightNode.setupShadow` multiplies
 * into the light's own colour — so the sun is dark where something stands in
 * its way and the material's Lambert term, its specular lobe and whatever a
 * `MeshPhysicalMaterial` puts over them all read a sun that has been cut,
 * without this file touching any of them.
 *
 * Gated on `receiveShadow`, though: three weaves the node into a material only
 * where the mesh being woven receives (`AnalyticLightNode.setup`), so a mesh
 * that says no is lit by an uncut sun. Which is why `dress` turns that word on
 * for every mesh of the clone — see the comment there. It was the sun's
 * `colorNode` until 2026-10-06, and then neither of three's two words could
 * change anything.
 */
function kept(from: Material): Material {
  const mine = from.clone()
  // A model is a solid standing on the land; see `classify.ts`
  marksSolid(mine)
  return mine
}

/**
 * The file's colours, carried onto one of ours.
 *
 * For the two cases the file's own material will not do: a glTF that says it
 * is unlit (`KHR_materials_unlit`), and a model a page said glows. They part
 * on what happens next — `worn` hands the unlit file one of this library's
 * lit materials, so it comes out lit the way the city beside it is rather than
 * flat, and hands a glowing one the switch that keeps it flat.
 *
 * Carried onto a standard material either way, so the two differ in one line
 * rather than in a class.
 */
function asOurs(from: Material): SolidMaterial {
  const made = solid()
  // A model is a solid standing on the land; see `classify.ts`
  marksSolid(made)
  const gltf = from as Material & {
    color?: { getHex(): number }
    map?: MeshStandardNodeMaterial['map']
    alphaMap?: MeshStandardNodeMaterial['alphaMap']
  }
  if (gltf.color) made.color.setHex(gltf.color.getHex())
  if (gltf.map) made.map = gltf.map
  if (gltf.alphaMap) made.alphaMap = gltf.alphaMap
  made.transparent = from.transparent
  made.opacity = from.opacity
  made.alphaTest = from.alphaTest
  made.side = from.side
  made.depthWrite = from.depthWrite
  made.depthTest = from.depthTest
  // A file that wrote its colours into the corners rather than into the
  // material reads them only where the material says to look. Left out, such a
  // model came through in one flat colour
  made.vertexColors = from.vertexColors
  made.name = from.name
  return made
}

/**
 * What a mesh of the clone wears: the file's own material where the scene's
 * lights can light it, or one of ours where they cannot.
 *
 * `glows` is a page saying the model carries its own light, and the only way
 * to keep that word for a material which reads the lights is not to keep the
 * material — lights reach it whatever we hand it afterwards. So a model that
 * glows comes down to its colours and is told to read none, as it always did.
 *
 * Woven before it is ever drawn, since a material handed a node after its
 * first frame keeps the shader it was drawn with.
 */
function worn(from: Material, glows: boolean): Material {
  if (!glows && readsLight(from)) return kept(from)
  const made = asOurs(from)
  if (glows) carriesItsOwnLight(made)
  return made
}

/**
 * Walks a clone and hands each mesh the material the group keeps for that
 * material of that file.
 *
 * Read by name and position in the walk rather than by the material object
 * itself, because a clone shares its materials with the reading it came from:
 * two models of one url would otherwise be handed the same made material
 * twice, which is what is wanted, and a model of another url whose file
 * happens to name a material the same would be handed it too, which is not.
 * So the key is the url and the material's own identity together, and the
 * group holds one map per url.
 */
export function dress(clone: Object3D, made: Map<Material, Material>, glows: boolean): void {
  clone.traverse((thing) => {
    const mesh = thing as Mesh
    if (!mesh.isMesh) return
    const wearing = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const swapped = wearing.map((one) => {
      let already = made.get(one)
      if (!already) {
        already = worn(one, glows)
        made.set(one, already)
      }
      return already
    })
    mesh.material = swapped.length === 1 ? swapped[0]! : swapped
    /*
     * And three's gate on the sun's map reaching the material.
     *
     * Set here once, removed as pointless, and back because it is no longer
     * pointless: `receiveShadow` is what three asks before weaving the sun's
     * map into a material (`AnalyticLightNode.setup`). Off, a glTF standing in
     * a street would be lit by an uncut sun.
     *
     * Set on every mesh of the clone and not on the group: three asks the
     * object, not its parents.
     *
     * Not a knob, and here rather than on the model, because it is part of the
     * shader: three keys the shader on it (`RenderObject.getCacheKey`), and the
     * materials made here are shared by every model of the url. A page that
     * turned it off for one model would weave a second shader for the file, and
     * nobody has asked for that.
     *
     * Its partner `castShadow` is not written here. That one is the page's —
     * `Model.castShadow`, three's own word on the group — and the model carries
     * it down onto the meshes as it wears the clone (`Model.wear`). Written here
     * as `true`, as it was until 2026-10-27, it overrode whatever the page had
     * said each time the clone was made again.
     */
    mesh.receiveShadow = true
  })
}
