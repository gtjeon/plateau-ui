import { renderGroup, viewZToPerspectiveDepth } from 'three/tsl'
import { cubeTexture, uniform } from './repaint.js'
import {
  Color,
  CubeDepthTexture,
  CubeRenderTarget,
  LessEqualCompare,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Vector3,
  Vector4,
  WebGPUCoordinateSystem,
  type CubeTexture,
  type DepthTexture,
  type Node,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { ALONG_STEPS, drawDistances } from './offscreen.js'

/**
 * How far off the nearest thing is, in every direction from one place.
 *
 * The scene drawn again from a point, keeping depth alone, into the six faces
 * of a cube. Whoever reads it hands in a place and gets back whether the line
 * from the point to there is clear: their own distance against the one drawn
 * their way. It is how a point light's shadow is worked out, and it answers
 * the same question a shadow answers — what can be seen from here — for
 * anything that has to ask it of a place rather than of a pixel.
 *
 * It draws nothing of the picture and is not a layer. The viewer draws it,
 * with its own renderer, when the sight it belongs to asks; see `sight.ts`.
 *
 * What stands in the way is whatever the scene has in it, so a building off
 * the screen that was never fetched hides nothing: the answer is about the
 * city as it is drawn, not as it is.
 */

/**
 * Texels across each face. A face takes in 90°, so a texel is about a sixth of
 * a degree — a metre at 300 m, finer than a street is wide, and the four texels
 * a reading is weighed across soften the step between them.
 *
 * Six faces of it, with a colour attachment three gives them whether or not
 * anything is written there, come to some 12 MB on the card. Twice as many
 * texels across is four times that, which a phone feels, for an edge that at
 * these ranges nobody sees.
 */
export const FACE_SIZE = 512

/**
 * How near the eye something may stand and still be drawn, in world units:
 * under the thickness of anything the eye could be put against.
 */
const NEAR = 0.05

/** Which way each face of the cube looks, and which way is up in it. */
const FACE_LOOKS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
]
const FACE_UPS = [
  new Vector3(0, -1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
  new Vector3(0, -1, 0),
  new Vector3(0, -1, 0),
]
/**
 * The same, for a card drawn through WebGPU, where the two faces looking along
 * y are swapped over: the picture in a face is written the other way up there,
 * and a cube is sampled by direction rather than by face, so the swap is what
 * keeps a direction pointing at the texels it was drawn into. Three's own point
 * lights carry both tables for this reason.
 */
const FACE_LOOKS_WEBGPU = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
]
const FACE_UPS_WEBGPU = [
  new Vector3(0, -1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, -1),
  new Vector3(0, 0, 1),
  new Vector3(0, -1, 0),
  new Vector3(0, -1, 0),
]

/**
 * A cube of distances, read at a point.
 *
 * Apart from {@link Distances} because what reads a cube is not what draws it:
 * every wall and tree in the city weaves the way in before it is first drawn,
 * which is long before there is a cube to read. So one of these starts on a
 * cube of a single texel and is pointed at the real one later — a texture
 * swapped under a shader already woven, which costs nothing.
 *
 * The maths lives here rather than in each reader: how a direction becomes a
 * face and a distance becomes a depth is one answer, and a second copy of it
 * would become a second answer the first time either was touched.
 *
 * Its numbers are one fact for the whole scene and go in the uniform buffer
 * drawn once a render, as the sun's map's do; see CLAUDE.md, "uniform()".
 */
export class DistanceRead {
  /** Stood in for until a cube is handed over, so the binding is never empty. */
  private readonly blank = blankCube()
  /** What a shader is woven on, and what a later cube is swapped into. */
  private readonly cube = cubeTexture(this.blank.depthTexture as unknown as CubeTexture)
  /** Where the eye stands, as whoever reads this measures from it. */
  private readonly eye = uniform(new Vector3()).setGroup(renderGroup)
  private readonly near = uniform(NEAR).setGroup(renderGroup)
  private readonly far = uniform(1).setGroup(renderGroup)
  /** How much of the way is forgiven; see `Sight.draw` in `sight.ts`. */
  private readonly slack = uniform(0).setGroup(renderGroup)

  /**
   * Whether the line from the eye to a point is clear: 1 where nothing stands
   * in the way, 0 where something does, and between the two along an edge.
   *
   * The point is in world coordinates. Which face of the cube is read comes out
   * of the direction itself, so the reader never asks — the card takes the
   * direction and finds it. The depth it is compared at is worked out from the
   * greatest of the three sides, which is what the face it lands in measures
   * along, the same way a point light's shadow is read.
   */
  clearTo(worldPosition: Node<'vec3'>): Node<'float'> {
    const toward = worldPosition.sub(this.eye)
    const sides = toward.abs()
    const away = sides.x.max(sides.y).max(sides.z).sub(this.slack).max(this.near)
    const depth = viewZToPerspectiveDepth(away.negate(), this.near, this.far)
    // Handed the node rather than the texture, which is what keeps the reading
    // live: three clones it and points the clone back at this one, so a cube
    // swapped in later is the cube a shader woven long ago reads. Three's own
    // types have the cube samplers take a colour cube and know nothing of a
    // node here; a depth cube is what they read, as point shadows read one.
    return cubeTexture(this.cube as unknown as CubeTexture, toward).compare(depth) as unknown as Node<'float'>
  }

  /** The cube this now reads, and where it was drawn from. Written only here. */
  at(depths: CubeDepthTexture, eye: Vector3, far: number, slack: number): void {
    this.cube.value = depths as unknown as CubeTexture
    this.eye.value.copy(eye)
    this.far.value = far
    this.slack.value = slack
  }

  /** Goes back to the stand-in, for a cube about to be let go of. */
  clear(): void {
    this.cube.value = this.blank.depthTexture as unknown as CubeTexture
  }

  /**
   * Lets go of the stand-in, its depth as well. The stand-in is never drawn
   * into, so the renderer never hung its own letting-go on the target, and the
   * texture every reading material bound would outlive the viewer otherwise.
   */
  dispose(): void {
    this.blank.depthTexture?.dispose()
    this.blank.dispose()
  }
}

/**
 * A cube of a single texel a side, for a reader with nothing to read yet.
 *
 * Hung on a render target it will never be drawn into, which is not idle. A
 * depth texture with no target behind it is taken for one of the renderer's
 * own, and declared at the sample count the renderer is drawing at — four here
 * — and a binding of more than one sample has to be a flat one. So the cube
 * fails to bind, and the material it was woven into draws nothing whatever.
 * Measured (2026-09-28): every building in the city went, with a validation
 * error naming the cube's view dimension and nothing else to say what had
 * happened. A target of its own makes it a target's depth, which is counted
 * once. See CLAUDE.md, "렌더 타깃 없는 깊이 텍스처".
 */
function blankCube(): CubeRenderTarget {
  const cube = new CubeDepthTexture(1)
  cube.compareFunction = LessEqualCompare
  cube.minFilter = LinearFilter
  cube.magFilter = LinearFilter
  const target = new CubeRenderTarget(1)
  target.depthTexture = cube as unknown as DepthTexture
  return target
}

/**
 * A cube of distances as the card drew it, read back onto this side: what a
 * page's question about one place is answered from.
 *
 * The answer is the paint's own, off the very cube the walls and the land read
 * — so a place that comes out in sight is a place painted, and the two cannot
 * disagree about which side of a wall a corner is on. What it costs is what the
 * paint costs: a texel's worth of grain, about a sixth of a degree.
 *
 * Read the way it was drawn rather than the way a cube is sampled: each face
 * is asked through the camera that drew it, kept from the drawing, so nothing
 * here knows which way up a face is written on either card. Only the order the
 * rows come back in differs, and that is said once, in {@link rowOf}.
 */
export class DistancesInHand {
  constructor(
    /** Each face's texels, four bytes apiece; see `farAlong` in `offscreen.ts`. */
    private readonly faces: readonly Uint8Array[],
    /** Each face's camera, from the world to its clip space, as it drew. */
    private readonly views: readonly Matrix4[],
    /** Which way each face looked. */
    private readonly looks: readonly Vector3[],
    /** Where it was all drawn from, and how far out, in world units. */
    readonly eye: Vector3,
    private readonly far: number,
    private readonly size: number,
    /** Whether a WebGPU card drew it, which hands rows back top first. */
    private readonly topFirst: boolean,
  ) {}

  /**
   * Whether the line from the eye to `world` is clear, forgiving `slack` of the
   * way: the question `DistanceRead.clearTo` asks on the card, asked here of one
   * texel rather than weighed across four.
   *
   * A point that sits on a surface is drawn into the cube itself, and far off
   * along a surface the eye barely sees, one texel holds a long stretch of it —
   * so such a point can read as hidden by the very face it lies on. The paint
   * lifts each point off its own face for that, and a point asked here has no
   * face to be lifted off; a page asking about a surface lifts the point.
   */
  clearTo(world: Vector3, slack: number): boolean {
    const toward = SCRATCH.toward.subVectors(world, this.eye)
    // The face it lands in is the one it is most along, as on the card
    let face = 0
    let along = -Infinity
    for (let i = 0; i < 6; i++) {
      const on = toward.dot(this.looks[i]!)
      if (on > along) {
        along = on
        face = i
      }
    }
    if (along <= NEAR) return true
    const clip = SCRATCH.clip.set(world.x, world.y, world.z, 1).applyMatrix4(this.views[face]!)
    const x = clip.x / clip.w
    const y = clip.y / clip.w
    const size = this.size
    const column = Math.min(size - 1, Math.max(0, Math.floor(((x + 1) / 2) * size)))
    const row = this.rowOf(y)
    const stride = this.topFirst ? Math.ceil((size * 4) / 256) * 256 : size * 4
    const texels = this.faces[face]!
    const at = row * stride + column * 4
    const whole = texels[at]! * 65536 + texels[at + 1]! * 256 + texels[at + 2]!
    const drawn = (whole / ALONG_STEPS) * this.far
    return along - slack <= drawn
  }

  /**
   * Which row of a face a height on its picture falls in. A WebGPU card hands
   * a texture back top row first, as it draws one; a WebGL card bottom row
   * first, as `readPixels` reads one.
   */
  private rowOf(y: number): number {
    const size = this.size
    const fromBottom = ((y + 1) / 2) * size
    const row = this.topFirst ? size - fromBottom : fromBottom
    return Math.min(size - 1, Math.max(0, Math.floor(row)))
  }
}

/** Held for the reading, since one is asked per question rather than per frame. */
const SCRATCH = { toward: new Vector3(), clip: new Vector4() }

/** The cube itself, and the drawing of it. */
export class Distances {
  readonly depths: CubeDepthTexture
  private readonly target: CubeRenderTarget
  /** One face's worth: square, a right angle across, and pointed six ways in turn. */
  private readonly camera = new PerspectiveCamera(90, 1, NEAR, 1)
  private readonly look = new Vector3()
  /** Each face's camera as it last drew, for reading it back; see {@link DistancesInHand}. */
  private readonly views = Array.from({ length: 6 }, () => new Matrix4())
  private readonly looks = Array.from({ length: 6 }, () => new Vector3())
  private readonly drawnFrom = new Vector3()
  private drawnFar = 1
  private topFirst = true
  /** Held while the clear is turned white, and put back. */
  private readonly clearWas = new Color()

  constructor(size = FACE_SIZE) {
    this.depths = new CubeDepthTexture(size)
    // Asked to compare rather than to hand back a number: the card weighs the
    // answer across the four texels a reading falls between, so the edge of
    // what can be seen moves with the reading instead of with the grid. Asked
    // for a number it would answer off one texel, and the edge would come out
    // as a stair. Both need a sampler that filters, hence the two below.
    //
    // Less-or-equal because a place no further off than what was drawn its way
    // has nothing standing in between. The viewer does not ask for a reversed
    // depth buffer, so depths run the ordinary way.
    this.depths.compareFunction = LessEqualCompare
    this.depths.minFilter = LinearFilter
    this.depths.magFilter = LinearFilter
    this.target = new CubeRenderTarget(size)
    // A cube of depths is what three's own point lights hang here; its types
    // have this as one texture rather than six.
    this.target.depthTexture = this.depths as unknown as DepthTexture
  }

  /**
   * Draws the six faces from `eye`, out to `far`, in world units.
   *
   * All six, though a reader with a direction to look and half the sky to cover
   * needs five at most. Leaving one out leaves whatever was in it, and a
   * reading near the edge of a face weighs texels from the face beside it, so
   * skipping would have to know which readings can reach where. It is drawn
   * only when the sight asks for it, which is what makes six affordable.
   *
   * Drawn into before any reader is pointed at it, always: a depth texture a
   * material samples before its target has drawn into it is thrown away and
   * made again by three on the target's first use, under every shader already
   * bound to it. See CLAUDE.md, "깊이 텍스처는 처음 접근한 쪽이 생성하고".
   */
  draw(renderer: WebGPURenderer, scene: Scene, eye: Vector3, far: number): void {
    const camera = this.camera
    if (camera.far !== far) {
      camera.far = far
      camera.updateProjectionMatrix()
    }
    const webgpu = renderer.coordinateSystem === WebGPUCoordinateSystem
    const looks = webgpu ? FACE_LOOKS_WEBGPU : FACE_LOOKS
    const ups = webgpu ? FACE_UPS_WEBGPU : FACE_UPS
    camera.position.copy(eye)
    // Cleared to white, which the colour reads as the far plane: where nothing
    // was drawn, nothing stands in the way. The canvas's own backdrop would read
    // as a wall at whatever distance its colour happened to spell
    renderer.getClearColor(this.clearWas)
    const alphaWas = renderer.getClearAlpha()
    renderer.setClearColor(0xffffff, 1)
    try {
      for (let face = 0; face < 6; face++) {
        this.look.copy(camera.position).add(looks[face]!)
        camera.up.copy(ups[face]!)
        camera.lookAt(this.look)
        camera.updateMatrixWorld()
        drawDistances(renderer, scene, camera, this.target, face)
        this.views[face]!.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        this.looks[face]!.copy(looks[face]!)
      }
    } finally {
      renderer.setClearColor(this.clearWas, alphaWas)
    }
    this.drawnFrom.copy(eye)
    this.drawnFar = far
    this.topFirst = webgpu
  }

  /**
   * Reads the cube last drawn back off the card: six faces of four bytes a
   * texel, some 6 MB at {@link FACE_SIZE}, handed back a frame or two later.
   *
   * What it was drawn from is taken now, with the drawing, so a reading that
   * lands after the next drawing still answers for the cube it was read off.
   */
  async read(renderer: WebGPURenderer): Promise<DistancesInHand> {
    const views = this.views.map((view) => view.clone())
    const looks = this.looks.map((look) => look.clone())
    const eye = this.drawnFrom.clone()
    const far = this.drawnFar
    const topFirst = this.topFirst
    const size = this.target.width
    const faces = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(
        (face) =>
          renderer.readRenderTargetPixelsAsync(this.target, 0, 0, size, size, 0, face) as Promise<Uint8Array>,
      ),
    )
    return new DistancesInHand(faces, views, looks, eye, far, size, topFirst)
  }

  /** Lets the cube go. */
  dispose(): void {
    this.target.dispose()
    this.depths.dispose()
  }
}
