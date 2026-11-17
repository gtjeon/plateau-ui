import { Discard, Fn, attribute, float, positionView, vec4 } from 'three/tsl'
import { uniform } from './repaint.js'

import {
  Color,
  DoubleSide,
  FloatType,
  NoBlending,
  NodeMaterial,
  OrthographicCamera,
  RenderTarget,
  Vector3,
  type BufferGeometry,
  type Material,
  type Node,
  type Object3D,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { MaskShader, type MaskArea } from './mask.js'
import { drawOffscreen, masksFragments, movesCorners, movesVertices } from './offscreen.js'
import type { Underground } from './underground.js'

/**
 * Where a mesh that holds many things says which one each of its corners
 * belongs to.
 *
 * PLATEAU's tiles arrive carrying it — it is a building's number in its batch —
 * and anything else here that draws many things in one mesh writes the same
 * name, so the pointer has one question to ask however the things got there.
 * What the number means is the layer's own business; it hands back whatever was
 * written.
 */
export const PICKED_ITEM = '_batchid'

/** Where a thing says the pointer is never to find it. */
const UNSEEN = 'plateauUnseen'

/**
 * Leaves a thing out of what the pointer can find.
 *
 * The pointer finds whatever the picture shows, so this is the one way of
 * saying otherwise — the answer every library keeps under some name of its
 * own, and the only one here. Which drawing pass a thing belongs to is a
 * separate question and is not asked: a mark is drawn over the finished
 * picture and is a thing to click, and so is a line a page painted on the
 * land, which is drawn there too.
 *
 * What a page puts on the map says this for itself ({@link ShapeBase.pickable},
 * true unless it is written down); what the library dresses the map with says
 * it here, once, where the thing is made.
 *
 * Some of what is drawn dresses the ground rather than standing on it — the
 * trees on a park, say. Nobody clicks a tree: a click there is a click on the
 * ground it grows from, and were the tree in the way the answer would be the
 * point on its crown, which at a tilt is some way off the ground under the
 * pointer. Left out, the pointer goes straight through to what is behind.
 *
 * **And three's own `Raycaster` is told the same**, since a page casting one at
 * the things in the world has to get the same answer about them the pointer
 * gets. (Shapes and marks are not such things and answer no ray at all; see
 * {@link answersNoRays}.) Three reads nothing of the flag above — `Mesh.prototype.raycast`
 * knows about geometry and layers and no more — so the method is replaced, the
 * way `casting.ts` replaces it for the city, and for the same reason: left
 * alone it answers, and answers wrongly. The trees are where it showed: a
 * tile's hundreds of them are one unit tree at the mesh's origin plus a column
 * of matrices the material reads (`ground/trees.ts`), on a plain `Mesh` rather
 * than an `InstancedMesh`, with a bounding sphere drawn round all the places —
 * so the sphere let a ray in and the triangles answered with a tree about 0.8m
 * tall standing at the tile's own corner, where the picture shows bare ground.
 * Read off the code and three's; no ray was cast.
 *
 * What is left standing on the land answers for itself: the land's sheet
 * answers through a `raycast` of its own (`ground/surface.ts`'s `cast`), which
 * puts its corners where the card raises them, and a model or a solid is where
 * its own matrix puts it, so a ray finds all three where they are drawn. The one
 * thing not looked at is the roads and the rails, whose half-width is pushed
 * out in the vertex stage — the shape three walks there is a line of no width,
 * which a ray goes past rather than wrongly into, and what it then finds is the
 * land under the road, a few centimetres from the answer.
 */
export function notPicked(object: Object3D): void {
  object.userData[UNSEEN] = true
  object.raycast = answersNothing
}

/**
 * What {@link notPicked} puts in place of three's `raycast`. One function and
 * not a fresh one each time, so that {@link picked} can tell it from a method a
 * thing was given for a reason of its own (`buildings/casting.ts`'s).
 */
const answersNothing: Object3D['raycast'] = () => undefined

/**
 * Takes a thing out of three's own `Raycaster` and leaves it to the pointer:
 * a shape and a mark, picked or not (2026-10-29).
 *
 * A ray asks what a line through the world runs into, from wherever a page
 * casts it — the camera, or a point in the city looking for the sun. What
 * answers is what stands in the world: the city, the land, a model, a solid.
 * A shape's line and circle are as wide as a number of the page's pixels and
 * a mark is a card turned to the eye, so how big they are and which way they
 * face belongs to the viewer's camera and to no other; a ray from anywhere
 * else stopped by a line four pixels wide would be stopped by nothing in the
 * world. A shape's area is laid out in metres, but it is paint on the map and
 * not a thing on it, and goes with the rest. What is under the cursor, shapes
 * and marks among it, is the pointer's question, and the pointer answers it.
 *
 * Three's own `Sprite` and `Line2` do answer a ray, through
 * `raycaster.camera`, so a page knowing three may look for a mark there; this
 * is where it is told no. Before this the two were kept out by their layer
 * alone (`PICTURE_ONLY`), and a `Raycaster` with every layer on found an area
 * — measured at 中野: 31 of 1,681 rays across the screen struck one raised
 * 30m, and none struck the line, the circle or the mark beside it.
 *
 * Not {@link notPicked}, which takes the thing out of the pointer as well.
 */
export function answersNoRays(object: Object3D): void {
  object.raycast = answersNothing
}

/**
 * @internal Takes {@link notPicked} back: the pointer finds the thing again,
 * and three's own `Raycaster` with it.
 *
 * For a thing a page turns either way while it is drawn — a solid's
 * `pickable`, and a model's. Making the thing again instead would leave
 * whatever already holds it holding a mesh nothing draws: the viewer keeps the
 * hit a carry began on and hands it back at every step, and a page that turns
 * `pickable` off in its `dragstart` would find the solid stop following the
 * hand there and then, with no `drag` and no `dragend` ever coming. A model
 * made again would also lose whatever the page did inside it since it landed.
 *
 * Three's method comes back by taking away the one `notPicked` put on the
 * thing itself, so the prototype answers again. A thing whose method was its
 * own before `notPicked` does not get that one back; nothing asks this of one.
 */
export function picked(object: Object3D): void {
  delete object.userData[UNSEEN]
  if (object.raycast === answersNothing) Reflect.deleteProperty(object, 'raycast')
}

/** What a pixel showed: which mesh, which of its things, and where. */
export interface Picked {
  readonly object: Object3D
  /** Which of the mesh's things, by {@link PICKED_ITEM}, or 0 where it is one thing. */
  readonly item: number
  /** Where, in the world's own units. */
  readonly point: Vector3
}

/** Whether a mesh numbers the things it draws, or is one thing. */
type Tells = 'one' | 'batched'

function tellsOf(geometry: BufferGeometry): Tells {
  return geometry.getAttribute(PICKED_ITEM) !== undefined ? 'batched' : 'one'
}

/** What each of them writes in place of a colour's green. */
const ITEM_OF: Record<Tells, () => Node<'float'>> = {
  one: () => float(0),
  batched: () => attribute(PICKED_ITEM, 'float'),
}

/**
 * What a stand-in has to answer to for a material that asks nothing of the
 * shader: which of its things it draws, and what it makes of the depth already
 * there.
 *
 * The depth is in the key rather than written onto a shared stand-in, because
 * it is what settles who wins where two things meet — a mark told to draw over
 * everything reads no depth at all, and a stand-in that read it would lose
 * every mark standing before a building. Keyed, the materials that answer alike
 * share one: everything laid on the land reads depth without writing it, which
 * is one stand-in for the whole ground rather than one a piece.
 */
function sharedKey(tells: Tells, material: Material): string {
  const depth = material.depthTest ? material.depthFunc : 0
  const press = material.polygonOffset
    ? `${material.polygonOffsetFactor}:${material.polygonOffsetUnits}`
    : '0'
  return `${tells}|${depth}|${material.depthWrite ? 1 : 0}|${press}`
}

/**
 * Carries whatever a material does to its own depth onto a stand-in.
 *
 * The press towards the camera is part of it (`behind.ts`'s `pressToLand`):
 * what is laid on the land guesses a slope differently from the land's own
 * sheet, so without it a drape sits a hair below the ground and the look under
 * the pointer comes back with the ground. Measured in `wards`, where a shape
 * drawn last and covering the pixel lost every look.
 */
function presses(twin: Material, source: Material): void {
  twin.depthTest = source.depthTest
  twin.depthWrite = source.depthWrite
  twin.depthFunc = source.depthFunc
  twin.polygonOffset = source.polygonOffset
  twin.polygonOffsetFactor = source.polygonOffsetFactor
  twin.polygonOffsetUnits = source.polygonOffsetUnits
}

/**
 * What lies under one point of the screen.
 *
 * Only the pixel at that point is drawn, every mesh writing which it is, which
 * of its things, and how far off, in place of its colour. The nearest wins as
 * it does in the picture, so what comes back is the ground, the building or
 * the shape there, whichever layer drew it, with nothing for the layer to do.
 *
 * Depth is written as the camera sees it, not as the world has it: those
 * numbers stay small wherever the view is, and the graphics card holds small
 * numbers far more finely. The point across the view is known already, from
 * where on the screen it was asked for.
 *
 * The answer is read back from the graphics card, which takes a frame or two.
 */
export class PickPass {
  /** One pixel. Float, so a number is written as it is. */
  private readonly target = new RenderTarget(1, 1, { type: FloatType })
  /**
   * The picture's camera, narrowed to the one pixel. Sees every layer, since
   * which pass a thing is drawn in says nothing about whether it is a thing to
   * click; what says that is {@link notPicked}.
   */
  private readonly camera = new OrthographicCamera()
  /** Which mesh is being drawn, set afresh for each one. */
  private readonly drawing = uniform(0).onObjectUpdate((frame) => frame.object?.id ?? 0)
  /**
   * The shape the scene is cut to, as the stand-ins below read it.
   *
   * Its own rather than borrowed from a layer: this pass draws whatever is in
   * the scene, whoever put it there, and the cut is the viewer's.
   */
  private readonly mask = new MaskShader()
  /** One shared stand-in for each answer given by {@link sharedKey}. */
  private readonly plain = new Map<string, NodeMaterial>()
  /**
   * For each material that cannot share one, its own: the same as above but
   * putting its corners where that material puts them and reading depth the
   * way it reads it, so the pointer finds a thing where it is drawn rather
   * than where its geometry has it.
   *
   * Kept by the material rather than by the mesh. A material is one for the
   * whole of what it draws, so this is a handful of shaders however many
   * tiles come and go; by the mesh it would be a shader a tile.
   */
  private readonly moved = new Map<Tells, WeakMap<Material, NodeMaterial>>()
  /**
   * Every stand-in made, and how to take back the listener it hung on the
   * material it stands in for, since a WeakMap cannot be walked to let them go.
   *
   * A layer taken off with {@link Viewer.remove} outlives the viewer it was on,
   * and keeps the materials it was made with. A listener left on one of those
   * holds this whole pass — its pixel, its cut, and every stand-in it made —
   * for as long as the page keeps the layer, and a page that builds a viewer
   * for each of several places keeps one apiece.
   */
  private readonly made = new Map<NodeMaterial, () => void>()
  private readonly clearColour = new Color()

  /**
   * The viewer's reading of the land under the canvas, which this pass draws
   * with standing down.
   *
   * It is read at the pixel being drawn, and the pixel being drawn here is the
   * only one there is — so it would answer for the middle of the canvas
   * wherever the pointer actually was. See {@link Underground.standDown}.
   */
  constructor(private readonly land: Underground) {}

  /**
   * Draws the pixel under a point of the canvas and reads back what it showed,
   * or null where nothing was drawn.
   *
   * The point is in pixels of the page from the canvas's top left, and
   * `width` and `height` are the canvas's own, in the same pixels.
   */
  async measure(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<Picked | null> {
    const pick = this.camera
    pick.copy(camera)
    // Said outright rather than left as whatever the picture's camera was
    // carrying: that mask is set and unset while a frame is drawn, and what
    // this pass wants is everything, whatever layers anyone takes up later
    pick.layers.enableAll()
    // Centred on the point, so the one texel is taken where it is — and
    // framed in the screen's own pixels rather than the page's.
    //
    // The frame is what a shader asking "how wide is a page pixel here" gets
    // its answer from. Four materials work that out as
    // `2 / (projection[0] * viewport.z / screenDPR)`, and `viewport` is the
    // bound target's — three copies `renderTarget.viewport` as it is, without
    // the pixel ratio (`ScreenNode`) — while `screenDPR` is always the
    // renderer's. This pass draws into a 1x1 target, so `viewport.z` is 1 and
    // that division says "a third of a page pixel" on a screen drawing three
    // of them to one. Framed in page pixels, as this was, the frustum then
    // covered a whole page pixel and the two disagreed by exactly the ratio:
    // a draped line answered the pointer `dpr` times further out than it is
    // drawn — 6 page pixels for a 4-pixel line on a Retina screen — which is
    // the tolerance contract 6 says this library does not give.
    //
    // Said in device pixels, the two agree. `across` and `up` below are
    // worked out from the untouched camera and from ratios, so they do not
    // care which unit this is in.
    const dpr = renderer.getPixelRatio()
    pick.setViewOffset(width * dpr, height * dpr, x * dpr - 0.5, y * dpr - 0.5, 1, 1)
    pick.updateMatrixWorld()
    // Kept as they are now: the view may move before the answer comes back
    const toWorld = camera.matrixWorld.clone()
    const across = (camera.left + (x / width) * (camera.right - camera.left)) / camera.zoom
    const up = (camera.top - (y / height) * (camera.top - camera.bottom)) / camera.zoom

    const drawn = new Map<number, Object3D>()
    const alpha = renderer.getClearAlpha()
    const drawObject = renderer.getRenderObjectFunction()
    renderer.getClearColor(this.clearColour)

    // Alpha marks that something was there: the pixel is cleared to nothing
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderObjectFunction(
      (object, scene, camera, geometry, source, group, lights, clipping, pass) => {
        if (object.userData[UNSEEN] === true) return
        drawn.set(object.id, object)
        const material = this.standIn(source, tellsOf(geometry))
        renderer.renderObject(object, scene, camera, geometry, material, group, lights, clipping, pass)
      },
    )
    try {
      this.land.standDown(() => drawOffscreen(renderer, scene, pick, this.target))
    } finally {
      renderer.setRenderObjectFunction(drawObject)
      renderer.setClearColor(this.clearColour, alpha)
    }

    const texel = await renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 1, 1)
    if (texel[3] === 0) return null
    const object = drawn.get(Math.round(texel[0]!))
    if (!object) return null
    return {
      object,
      item: Math.round(texel[1]!),
      point: new Vector3(across, up, texel[2]!).applyMatrix4(toWorld),
    }
  }

  dispose(): void {
    this.target.dispose()
    for (const shared of this.plain.values()) shared.dispose()
    this.plain.clear()
    for (const [twin, take] of this.made) {
      take()
      twin.dispose()
    }
    this.made.clear()
    this.moved.clear()
  }

  /**
   * What to draw a thing with: the shared stand-in, or one that stands in for
   * this material in particular.
   *
   * Three things have to come across for the pointer to find what the picture
   * shows: where the material puts its corners, what it throws away, and what
   * it makes of the depth already there. The first two are nodes and are given
   * to the stand-in as it is made and never again — a material already woven
   * into a shader keeps that shader when its nodes are swapped, so one made
   * blank would stay blank. The third is not a node but pipeline state, which
   * three keys its pipelines by, so it is simply kept in step.
   */
  private standIn(source: Material, tells: Tells): NodeMaterial {
    const moves = movesCorners(source)
    const puts = movesVertices(source)
    if (!moves && !puts) return this.shared(tells, source)

    let kept = this.moved.get(tells)
    if (!kept) this.moved.set(tells, (kept = new WeakMap()))
    let twin = kept.get(source)
    if (!twin) {
      twin = this.material(ITEM_OF[tells](), masksFragments(source) as Node<'bool'> | null)
      twin.positionNode = moves
      twin.vertexNode = puts
      kept.set(source, twin)
      const own = twin
      const held = kept
      const gone = (): void => {
        held.delete(source)
        this.made.delete(own)
        own.dispose()
      }
      const take = (): void => source.removeEventListener('dispose', gone)
      source.addEventListener('dispose', gone)
      this.made.set(own, take)
    }
    // Read afresh: these may be turned about after a material is first drawn,
    // and three picks another pipeline for the new values on its own
    presses(twin, source)
    return twin
  }

  /** The stand-in shared by every material that answers alike; see {@link sharedKey}. */
  private shared(tells: Tells, source: Material): NodeMaterial {
    const key = sharedKey(tells, source)
    let material = this.plain.get(key)
    if (!material) {
      material = this.material(ITEM_OF[tells]())
      // Written once, since the key it was found under is these. A material
      // that comes to answer differently finds a different stand-in rather
      // than turning this one about under everything else sharing it
      presses(material, source)
      this.plain.set(key, material)
    }
    return material
  }

  /** The shape the scene is cut to, in world units, or null for none. */
  setMask(area: MaskArea | null): void {
    this.mask.set(area)
  }

  private material(item: Node<'float'>, cut: Node<'bool'> | null = null): NodeMaterial {
    const material = new NodeMaterial()
    // Written as it is, past the lighting a colour goes through, which floors
    // it at nothing and would lose every depth in front of the camera.
    //
    // A whole fragment of its own, which is past where `maskNode` would be
    // read, so the cut is made here by hand. Without it the pointer would
    // find a building the mask threw away — and, worse, find it in front of
    // the ground that is drawn behind it.
    //
    // A thing that brought its own is cut by that and nothing else. Where a
    // layer cuts by the mask that comes to the same thing, together with
    // whatever it hides alongside — the part of a building still under the
    // ground. Where it does not, no mask is applied here at all: a mark cuts by
    // the ink of its card, and honours the shape by being left out of the
    // layout rather than thrown away as it is drawn. Only a material that moves
    // its corners brings its cut this far; the rest share the stand-in above
    // and are cut by the mask. What the picture does not show, the pointer does
    // not find, and it is the layer that keeps that — in its `maskNode`, or
    // before it lays out.
    material.fragmentNode = Fn(() => {
      if (cut) Discard(cut.not() as Node)
      else this.mask.discardOutside()
      return vec4(this.drawing, item, positionView.z, 1)
    })()

    // A float target cannot be blended into, and nothing here needs to be
    material.blending = NoBlending
    // A face turned away still stands where it stands
    material.side = DoubleSide
    return material
  }
}
