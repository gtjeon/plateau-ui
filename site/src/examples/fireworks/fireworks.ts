/**
 * The fireworks: a layer of this page's own, written beside it.
 *
 * Nothing here is the library's. It is three — an `InstancedMesh` of sparks, a
 * handful of `PointLight`s and some arithmetic — handed over as a `Layer`, the
 * way `ViewerOptions.layers` takes anything with a `root` and a `stage`.
 *
 * **What the page is about is the light, not the sparks.** A shell goes up,
 * bursts, and for a second or so there is a lamp two hundred metres over the
 * water: the towers take it on the faces turned toward it and lose it again as
 * it falls and dims. That is a page's own light reaching the city, which is
 * the one thing a map lit by its own sun could not do before the scene was put
 * on three's lighting.
 *
 * **Two words are deliberately left off.** The sparks neither cast nor receive
 * — three's defaults, untouched — because a spark is a thing that *emits*:
 * lighting it would dim it, and having it throw a shadow would ask the sun's
 * one map to hold something two hundred metres up for a second. And this layer
 * says no `tallest()` for the same reason: the sun's box is sized by what
 * stands on the ground, and a shell is not standing.
 */
import { marksSolid, metersPerUnit, type Change, type Layer, type Viewer } from '@plateau-ui/core'
import {
  Color,
  Group,
  InstancedMesh,
  MeshBasicNodeMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'

/** How many shells may be in the air at once, and how many sparks each throws. */
const SHELLS = 5
const SPARKS = 150

/** How long one goes up for, and how long the burst lasts after it, in seconds. */
const RISE = 1.4
const BURST = 2.6

/** How high it bursts over the water, in metres: the range it is picked from. */
const LOW = 110
const HIGH = 230

/**
 * How fast a spark leaves the burst, in metres a second, and how quickly the
 * air takes that away.
 *
 * Seventy over the 2.6 seconds a burst lasts would carry a spark 182 metres if
 * nothing slowed it. The drag is an exponential — a tenth of its number per
 * step of a hundredth, so what is left of a speed after a whole second is
 * `exp(-1.2)`, or 0.30 — and it pulls those 182 in to about 56, which is the
 * width a shell of this height actually opens to.
 */
const THROWN = 70
const DRAG = 0.12

/** The world's own, in metres a second per second. These are in the air. */
const GRAVITY = -9.8

/** How far from the middle the barges sit, in metres. */
const SPREAD = 220

/** How long between one going up and the next, in seconds. */
const EVERY = 0.6

/**
 * The colours a shell is picked from.
 *
 * Written as they are to be *seen* rather than as reflectances — a spark is a
 * light and so is what it throws, and neither is a surface the sun falls on.
 * Kept bright and few: a burst reads as one colour at this distance, and the
 * point of them being different is that two in the air at once are told apart.
 */
const COLOURS = ['#ffd27f', '#ff7a7a', '#7adcff', '#b8ff9a', '#ffffff', '#ff9ae8'] as const

/**
 * How hard the burst's lamp burns at its brightest.
 *
 * Three reads a point light's intensity as candela and falls off with the
 * square of the distance (`decay` 2, which is the ordinary one and the only
 * honest one here — a lamp two hundred metres up is far enough that the near
 * tower and the far one should not take the same light). The square is what
 * makes the number large: at four hundred metres it is divided by a hundred
 * and sixty thousand.
 *
 * Chosen on screen, against the night's own fill. The first try was 9e6 and
 * washed the whole of みなとみらい one flat pink — at four hundred metres that
 * is still fifty times a full daylight face. This one leaves the near towers
 * clearly lit and the far ones touched.
 */
const LAMP = 1.5e6

/** One shell: where it is, how far along it is, and the lamp it carries. */
type Shell = {
  readonly light: PointLight
  readonly colour: Color
  /** Where it goes up from, in world units, at the water. */
  readonly from: Vector3
  /** Where each of its sparks is and how fast, in metres from {@link from}. */
  readonly at: Vector3[]
  readonly speed: Vector3[]
  /** How high it bursts, in metres. */
  peak: number
  /** Seconds since it went up, or null where it is not in the air. */
  age: number | null
}

export class Fireworks implements Layer {
  readonly root = new Group()
  /**
   * `structure`, where the city stands.
   *
   * A spark writes depth like anything else solid, so a tower in front of the
   * burst hides the sparks behind it — which is what says the burst is *in*
   * the city rather than drawn over a picture of it.
   */
  readonly stage = 'structure' as const

  private viewer: Viewer | null = null
  private readonly shells: Shell[] = []
  private readonly geometry = new SphereGeometry(1, 6, 4)
  /**
   * One material and one mesh for every spark of every shell.
   *
   * Three weaves a shader per material at about a second each, so a material
   * per shell would be five seconds of waiting; and a mesh per spark would be
   * seven hundred and fifty draws. An `InstancedMesh` is one of each, and
   * three multiplies a per-instance colour into whatever the material says
   * (`NodeMaterial`: `colorNode = instanceColor.mul(colorNode)`), which is how
   * two shells in the air at once are different colours.
   *
   * Basic and not standard: a spark is its own light. Lit, it would take the
   * night's fill and come out as dim as the walls it is lighting.
   */
  private readonly material = new MeshBasicNodeMaterial()
  private readonly sparks: InstancedMesh
  private readonly put = new Object3D()
  /** Scratch, so that a frame allocates nothing. */
  private readonly world = new Vector3()
  private readonly tint = new Color()

  private last = performance.now()
  private due = 0
  /** Where the barges sit, as the page named it. */
  private readonly over: readonly [number, number]

  constructor(over: readonly [number, number]) {
    this.over = over
    this.sparks = new InstancedMesh(this.geometry, this.material, SHELLS * SPARKS)
    this.sparks.count = SHELLS * SPARKS
    this.sparks.frustumCulled = false
    this.root.add(this.sparks)

    for (let shell = 0; shell < SHELLS; shell++) {
      const light = new PointLight(0xffffff, 0, 0, 2)
      // On every layer, the same as the library's own two. Three gathers a
      // scene's lights per pass through the same layer test as everything
      // else, and which lights were gathered goes into every material's
      // shader key — so a pass that narrows the camera to one layer and finds
      // none of them asks for a different shader than the pass beside it.
      light.layers.enableAll()
      // And always visible, never switched off. The same key is why: a light
      // that fails `visible` is not gathered at all, so toggling one changes
      // the set and every render object in the scene — the city's one
      // material among them — is thrown away and woven again, at about a
      // second a go. Five standing lights are one set and one key; a shell
      // that is not in the air is one of them at an intensity of nought,
      // which costs a falloff nobody sees.
      this.root.add(light)
      this.shells.push({
        light,
        colour: new Color(),
        from: new Vector3(),
        at: Array.from({ length: SPARKS }, () => new Vector3()),
        speed: Array.from({ length: SPARKS }, () => new Vector3()),
        peak: 0,
        age: null,
      })
    }
    this.hideAll()
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    // A page's own layer takes the ground's mark off what it stands, or a wash
    // meant for the land climbs it; the library's own solids all say this
    marksSolid(this.material)
    this.due = 0
    this.last = performance.now()
  }

  detach(): void {
    for (const shell of this.shells) this.rest(shell)
    this.hideAll()
    this.viewer = null
  }

  /** Nothing here reads the mask or the light, so there is nothing to answer. */
  changed(_what: Change): void {}

  /** Made once and kept; see `Layer.dispose`. */
  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.sparks.dispose()
  }

  /**
   * Once a frame, from the viewer. No loop of its own — a layer running its
   * own `requestAnimationFrame` beside the viewer's would be a frame behind it.
   */
  frame(): void {
    const viewer = this.viewer
    if (!viewer) return

    const now = performance.now()
    // Capped for the reason every step is capped: a tab left in the background
    // comes back with seconds on the clock, and a shell would be over before
    // the first frame drew it
    const step = Math.min((now - this.last) / 1000, 1 / 20)
    this.last = now

    this.due -= step
    if (this.due <= 0) {
      this.due = EVERY
      this.launch(viewer)
    }

    const unit = 1 / metersPerUnit(this.over[1])
    let drawn = 0
    for (const shell of this.shells) drawn = this.step(shell, step, unit, drawn)
    // The rest of the pool is put where nothing is: an instance left where it
    // was would hang in the air as a dot after its shell had gone
    for (let spare = drawn; spare < SHELLS * SPARKS; spare++) this.park(spare)
    this.sparks.instanceMatrix.needsUpdate = true
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true
  }

  /** Sends one up, from a barge somewhere in the middle of the ring. */
  private launch(viewer: Viewer): void {
    const shell = this.shells.find((one) => one.age === null)
    if (!shell) return

    const unit = 1 / metersPerUnit(this.over[1])
    const turn = Math.random() * Math.PI * 2
    const out = Math.sqrt(Math.random()) * SPREAD * unit
    this.world.copy(viewer.worldFromLngLat(this.over[0], this.over[1]))
    shell.from.set(this.world.x + Math.cos(turn) * out, 0, this.world.z + Math.sin(turn) * out)

    shell.colour.set(COLOURS[Math.floor(Math.random() * COLOURS.length)]!)
    shell.peak = LOW + Math.random() * (HIGH - LOW)
    shell.age = 0
    shell.light.color.copy(shell.colour)

    this.throw(shell)
  }

  /**
   * The sparks a shell is loaded with.
   *
   * Thrown on a sphere rather than in a disc, so the burst is a ball from every
   * side. `Math.cbrt` of a random fills it evenly rather than crowding the
   * shell's surface.
   */
  private throw(shell: Shell): void {
    for (let spark = 0; spark < SPARKS; spark++) {
      const up = Math.random() * 2 - 1
      const round = Math.random() * Math.PI * 2
      const flat = Math.sqrt(1 - up * up)
      const fast = THROWN * (0.35 + 0.65 * Math.cbrt(Math.random()))
      shell.at[spark]!.set(0, 0, 0)
      shell.speed[spark]!.set(Math.cos(round) * flat * fast, up * fast, Math.sin(round) * flat * fast)
    }
  }

  /** One shell, one step. Returns how many instances have been written. */
  private step(shell: Shell, step: number, unit: number, drawn: number): number {
    if (shell.age === null) return drawn
    shell.age += step
    if (shell.age > RISE + BURST) {
      this.rest(shell)
      return drawn
    }

    const rising = shell.age < RISE
    // Up the way a shell goes up: fast off the barge and slowing into the top,
    // which is what a mortar's charge does and what the eye reads as a climb
    const part = Math.min(shell.age / RISE, 1)
    const height = shell.peak * (1 - (1 - part) * (1 - part))

    if (rising) {
      // One spark for the shell itself, the rest held off the screen
      this.place(drawn, shell, shell.from.x, shell.from.y + height * unit, shell.from.z, 1.2 * unit)
      // A dim lamp on the way up, so a climbing shell throws a little of its
      // own colour on the water before it opens
      shell.light.position.set(shell.from.x, shell.from.y + height * unit, shell.from.z)
      shell.light.intensity = LAMP * 0.04
      return drawn + 1
    }

    const since = shell.age - RISE
    // The flash is nearly all of it, and then it falls away: a burst is bright
    // for a tenth of a second and is embers for the rest
    const left = 1 - since / BURST
    shell.light.intensity = LAMP * left * left * left
    shell.light.position.set(shell.from.x, shell.from.y + height * unit, shell.from.z)

    const slowed = Math.exp(-DRAG * step * 10)
    for (let spark = 0; spark < SPARKS; spark++) {
      const speed = shell.speed[spark]!
      const at = shell.at[spark]!
      speed.y += GRAVITY * step
      speed.multiplyScalar(slowed)
      at.addScaledVector(speed, step)
      this.place(
        drawn + spark,
        shell,
        shell.from.x + at.x * unit,
        shell.from.y + (height + at.y) * unit,
        shell.from.z + at.z * unit,
        (0.5 + left * 0.8) * unit,
        left,
      )
    }
    return drawn + SPARKS
  }

  /** Writes one instance: where it is, how big, and what colour is left of it. */
  private place(which: number, shell: Shell, x: number, y: number, z: number, size: number, fade = 1): void {
    this.put.position.set(x, y, z)
    this.put.scale.setScalar(Math.max(size, 1e-6))
    this.put.updateMatrix()
    this.sparks.setMatrixAt(which, this.put.matrix)
    this.sparks.setColorAt(which, this.tint.copy(shell.colour).multiplyScalar(fade))
  }

  /** An instance with nothing to show, put where nothing is drawn. */
  private park(which: number): void {
    this.put.position.set(0, -1e6, 0)
    this.put.scale.setScalar(1e-6)
    this.put.updateMatrix()
    this.sparks.setMatrixAt(which, this.put.matrix)
  }

  private rest(shell: Shell): void {
    shell.age = null
    // Dark, not gone: see the constructor for why the set of lights never moves
    shell.light.intensity = 0
  }

  private hideAll(): void {
    for (let spare = 0; spare < SHELLS * SPARKS; spare++) this.park(spare)
    this.sparks.instanceMatrix.needsUpdate = true
  }
}
