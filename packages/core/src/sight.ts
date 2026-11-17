import {
  Fn,
  If,
  cross,
  dFdx,
  dFdy,
  float,
  int,
  positionWorld,
  renderGroup,
  sign,
  smoothstep,
  vec4,
} from 'three/tsl'
import { uniform } from './repaint.js'
import { Color, Vector3, type Node, type Object3D, type Scene, type WebGPURenderer } from 'three/webgpu'
import { DistanceRead, Distances, FACE_SIZE, type DistancesInHand } from './distances.js'
import type { SolidMaterial } from './lit.js'
import type { PaintedKind } from './paints.js'
import { asReflectance } from './tone.js'

/**
 * How soft an edge of the sight is, in the cosine and the sine the edges are
 * kept as rather than in degrees — which is about three quarters of a degree
 * where the edges usually fall, and less where they are nearer the middle of
 * the turn. Enough that an edge reads as an edge rather than as a staircase.
 */
const EDGE_SOFT = 0.012
/**
 * What a length is held above before it is divided by, in world units — which
 * are about a metre, so this is a fraction of a millimetre. It stands for a
 * point sitting on the eye, which has no direction to be judged by.
 */
const TINY = 1e-4
/**
 * How far past the range the distances are drawn, as a share of it, so a place
 * at the very end of the range is not cut off by the far plane.
 */
const FAR_ROOM = 1.02
/**
 * How long, in seconds, the cube is left between two drawings while the scene
 * keeps changing under it.
 *
 * A drawing is the city six times over. Asked for on every frame a city is
 * arriving it starved the very tiles it was waiting for, and the buildings did
 * not come up at all (measured 2026-09-28, with the first version of this).
 * Four a second keeps the paint following a city that is still rising, and
 * the last change is always drawn: nothing is marked drawn until it has been.
 */
const SETTLE = 0.25
/**
 * How far off its own face a place is lifted before the cube is read, in
 * texels of the cube there, where the line to the eye grazes the face.
 *
 * The sun's map's answer to the same stripes, for the same reason (see
 * NORMAL_OFFSET in `shadows.ts`): a texel holds one distance for a stretch of
 * every face it covers, and where the line to the eye grazes the face that
 * stretch is long, so a place in the far half of it is further off than the
 * texel says and reads as hidden by the very ground it lies on. Lifted along the
 * face's own facing, by how far that leans from the eye, it is clear of its
 * texel. Counted in texels because a texel is wider the further off it is: a
 * face takes in 90° over {@link FACE_SIZE}, so one is about a 256th of the
 * distance, 0.6 m at 150 m.
 *
 * {@link SightLook.slack} was all there was at first, and it is a length: two
 * metres was enough for an eye 38 m up a wall and not for one 12 m over a
 * square, where the land past 90 m came out in stripes along the cube's texels
 * (measured 2026-10-29: a 150 m sight over the flat at 中野, with nothing built
 * on it, left half the outer band of the circle part-painted).
 *
 * What it costs is what the sun's costs: a place is read as though it stood that
 * much nearer the eye, so something under about that height right in front of
 * it does not hide it. Three, which is under two metres at 150 m.
 */
const NORMAL_OFFSET = 3

/**
 * Where one eye stands and what it takes in, in the world's own units: what a
 * {@link Viewshed} works out from what a page said, handed to the viewer's
 * {@link Sight}.
 */
export interface SightLook {
  /** Where the eye stands. */
  readonly eye: Vector3
  /** Which way it looks, flat and of unit length. */
  readonly facing: Vector3
  /**
   * How far round from that bearing it still takes a place in, as the cosine
   * of half the angle, or under -1 to look all the way round.
   */
  readonly cone: number
  /**
   * And how far up and down, as the sine of half that angle, or over 1 to look
   * from straight up to straight down.
   *
   * Two numbers and not one, so that the shape is a camera's rather than a
   * torch's: a lens is wider than it is tall, and one angle governing both
   * rounds off the corners a page asked for.
   */
  readonly steep: number
  /** How far it reaches. */
  readonly range: number
  /** Over how much of the end of the reach the colour thins out. */
  readonly fade: number
  /** How much further than what was drawn a place may be and still be in sight; see {@link Sight.draw}. */
  readonly slack: number
  /** The colour a place in sight is painted, as the page wants to see it. */
  readonly color: Color
  /** How much of it goes on, 0 to 1. */
  readonly opacity: number
  /** Whether it lands on the land, and on what was built. */
  readonly ground: boolean
  readonly buildings: boolean
}

/** One eye on the sight, and what it is drawn with. */
interface Claim {
  readonly by: object
  look: SightLook
  /** What the claimant draws of its own, kept out of the cube it is measured by. */
  readonly own: Object3D
  /** Whether anyone has asked this eye about a place, and so whether its cube is read back. */
  readonly asks: () => boolean
  /** Told when a cube drawn for it has been read back, and {@link Sight.sees} answers afresh. */
  readonly told: () => void
}

/**
 * How the claimant hears of its answers; see {@link Sight.claim}. Both may be
 * left out by a claimant nobody asks anything of.
 */
export interface SightAsker {
  readonly asks: () => boolean
  readonly told: () => void
}

const NOBODY_ASKS: SightAsker = { asks: () => false, told: () => {} }

/**
 * What one place can see, as one fact about the scene that every surface reads
 * for itself.
 *
 * The viewer's, for the reason the sun and the projector are the viewer's:
 * a wall that wears the answer belongs to the city, the city holds one
 * material for every tile of it, and that material is woven before there is
 * any eye at all. So nothing hands the city an answer. The city, the solids
 * and the trees take the way in as they are attached ({@link paint}), and the
 * eye a {@link Viewshed} puts here is what all of them read.
 *
 * And because what is read is a cube of distances drawn from the eye, which
 * is the scene drawn six times over, the viewer is what draws it — with its
 * own renderer, at a moment of its choosing, as it draws the sun's map. A
 * layer hands over where the eye is and nothing else.
 *
 * **One eye is painted at a time**: the last put on. A cube is some 12 MB on
 * the card and six drawings of the city, and every surface reads one cube.
 * The others keep their place and come back in turn as the one over them is
 * taken off, as pictures on the projector once did. Painting several at once
 * is a later question, and a question of how the colours of several are told
 * apart before it is one of cubes.
 */
export class Sight {
  /** The cube the answer is read off, made when there is first an eye to draw it from. */
  private distances: Distances | null = null
  private readonly read = new DistanceRead()
  private readonly claims: Claim[] = []
  /** That the cube no longer holds what the eye on top would see. */
  private stale = true
  /** When it was last drawn, in seconds off the viewer's clock. */
  private drawnAt = -Infinity
  /** The eye and the reach the cube was last drawn for. */
  private drawnFor: SightLook | null = null
  /**
   * The last cube read back, and the look it was drawn for: what {@link sees}
   * answers from. Null until one has been asked for and has landed.
   */
  private reading: { readonly look: SightLook; readonly cube: DistancesInHand } | null = null
  /** Counts the readings asked for, so one that lands after a newer has been asked for is dropped. */
  private askedFor = 0
  /** Whether a reading is on its way off the card. */
  private onItsWay = false

  private readonly eye = uniform(new Vector3()).setGroup(renderGroup)
  private readonly facing = uniform(new Vector3(0, 0, -1)).setGroup(renderGroup)
  private readonly cone = uniform(-2).setGroup(renderGroup)
  private readonly steep = uniform(2).setGroup(renderGroup)
  private readonly range = uniform(1).setGroup(renderGroup)
  private readonly fade = uniform(0).setGroup(renderGroup)
  private readonly tint = uniform(new Color('#ffffff')).setGroup(renderGroup)
  private readonly opacity = uniform(0).setGroup(renderGroup)
  private readonly onGround = uniform(0).setGroup(renderGroup)
  private readonly onBuilt = uniform(0).setGroup(renderGroup)
  /** Whether there is an answer to read at all. An int, so the branch is not taken. */
  private readonly on = uniform(0, 'int').setGroup(renderGroup)
  /** What each side of the scene is handed; see {@link paint}. */
  private readonly readings = new Map<PaintedKind, Node<'vec4'>>()

  /**
   * The colour a place in sight is painted, for a surface that draws it
   * rather than mixing it in: a reflectance, held to one.
   *
   * Held to one rather than written bare, because what draws it blends, and
   * three blends before the curve. The bare inverse of white is 58.16 a
   * channel, which takes the sum at any alpha a page would use; see
   * `asReflectance` in `tone.ts`. Lit, it is what a page's colour on a lit
   * surface always is (`keepsItsColor`).
   */
  readonly colorNode = asReflectance(this.tint as unknown as Node<'vec3'>)

  /**
   * Hands a material the sight to wear on `on`'s side of the scene, as rgb and
   * how much of it lands.
   *
   * Read when the shader is woven, so it is given before the first frame — a
   * layer does it as it is attached, as it takes the projector (`projection.ts`).
   * After that, whether there is an eye, where it is and what it paints are a
   * texture swapped and uniforms, and no shader is woven again.
   */
  paint(material: SolidMaterial, on: PaintedKind): void {
    let reading = this.readings.get(on)
    if (!reading) {
      const side = on === 'ground' ? this.onGround : this.onBuilt
      // Not in a branch of its own: the reading works out which way the
      // surface faces from the screen's derivatives, which a card takes only
      // where every pixel of a quad takes the same path. Whether there is an
      // eye at all is asked inside it, before the cube is read
      const strength = this.strengthAt(positionWorld as Node<'vec3'>).mul(side)
      reading = vec4(this.colorNode, strength) as unknown as Node<'vec4'>
      this.readings.set(on, reading)
    }
    material.sight = reading
  }

  /**
   * How much of the colour lands at a point: nought where it is not in sight,
   * and the eye's own opacity where it is.
   *
   * The range and the two angles are weighed before the cube is read, which is
   * the dear part: a point behind the eye or beyond the range costs a few
   * multiplies and no sample. In a branch rather than thrown away, since a wall
   * that is not in sight is still a wall and has to be drawn.
   */
  strengthAt(at: Node<'vec3'>): Node<'float'> {
    return Fn(() => {
      const paint = float(0).toVar()
      // Which way the surface here faces, from how the place moves across the
      // pixel: every surface has that, whether it carries normals or not —
      // the land's sheet does not. Asked out here, before anything branches,
      // since a card works derivatives out only where all four pixels of a
      // quad take the same path; see {@link NORMAL_OFFSET}
      const across = cross(dFdx(at), dFdy(at)).toVar()
      const toward = at.sub(this.eye).toVar()
      const away = toward.length().toVar()
      // Round from the bearing, which is a flat question and so asked of the
      // flat part of the way there. Straight up and straight down have no
      // bearing to be outside of, so they are let through here and left to the
      // other half to answer.
      const flat = toward.xz.length().toVar()
      const round = flat.greaterThan(TINY).select(toward.xz.div(flat).dot(this.facing.xz), float(1))
      const side = smoothstep(this.cone.sub(EDGE_SOFT), this.cone.add(EDGE_SOFT), round)
      // And up or down from flat, which is the other half of the same shape.
      // Taken against the whole way there rather than the flat part, so it is
      // the sine of the rise and not its tangent — bounded, where a tangent
      // runs away at the two poles.
      const steepness = toward.y.abs().div(away.max(TINY))
      const over = float(1).sub(smoothstep(this.steep.sub(EDGE_SOFT), this.steep.add(EDGE_SOFT), steepness))
      // Both at once, which is what squares the corners off: a place up and to
      // the side is in, where a single angle would have rounded it away.
      const within = side.mul(over).toVar()
      If(this.on.greaterThan(int(0)).and(away.lessThan(this.range)).and(within.greaterThan(0)), () => {
        // Lifted off its own face toward the eye's side of it, by texels of
        // the cube here and by how far the face leans from the eye
        const facing = across.div(across.length().max(TINY * TINY))
        const square = facing.dot(toward.negate().div(away.max(TINY)))
        const leaning = float(1).sub(square.mul(square)).max(0).sqrt()
        const texel = away.mul(2 / FACE_SIZE)
        const lifted = at.add(facing.mul(sign(square)).mul(texel.mul(NORMAL_OFFSET).mul(leaning)))
        const clear = this.read.clearTo(lifted as Node<'vec3'>)
        // Thinned over the last of the reach, as the mask's hem thins over the
        // last of the shape; a hard edge where the page asked for none
        const thinning = float(1).sub(smoothstep(this.range.sub(this.fade.max(TINY)), this.range, away))
        paint.assign(this.opacity.mul(within).mul(clear).mul(thinning))
      })
      return paint
    })() as unknown as Node<'float'>
  }

  /**
   * Puts an eye on, over every eye put on before it; asked again by one already
   * on, it stays where it is and looks as it now looks.
   *
   * `own` is what the claimant draws of its own — the land it paints — which
   * is kept out of the cube it is measured by. It lies on the land, so it hides
   * nothing the land does not, but it is no part of what can be seen.
   */
  claim(by: object, look: SightLook, own: Object3D, asker: SightAsker = NOBODY_ASKS): void {
    const at = this.claims.findIndex((claim) => claim.by === by)
    if (at >= 0) {
      this.update(by, look)
      return
    }
    this.claims.push({ by, look, own, asks: asker.asks, told: asker.told })
    this.turnedOver()
  }

  /**
   * Whether `world` is in sight of `by`'s eye: inside its reach and what it
   * takes in, and nothing drawn in the way. Null where there is no answer yet —
   * `by` is not the eye painted, or its cube has not been drawn and read back
   * for where it now looks.
   *
   * The paint's own answer, off the same cube with the same reach, angles and
   * slack, so a place in sight is a place painted. Two things the paint does
   * are not asked: the edge of the angles and of the reach is a line here
   * rather than a softening, and the fade, which says how the colour thins and
   * not whether the place is seen, does not come into it.
   */
  sees(by: object, world: Vector3): boolean | null {
    const top = this.top
    if (top?.by !== by) return null
    const reading = this.reading
    if (!reading || !sameAim(reading.look, top.look)) {
      // Asked, so the next drawing is read back: one that went by while nobody
      // asked is drawn again rather than waited on
      if (!this.onItsWay) this.stale = true
      return null
    }
    const look = reading.look
    const toward = SEES.toward.subVectors(world, look.eye)
    const away = toward.length()
    if (away >= look.range) return false
    if (look.cone > -1) {
      const flat = Math.hypot(toward.x, toward.z)
      const round = flat > TINY ? (toward.x * look.facing.x + toward.z * look.facing.z) / flat : 1
      if (round < look.cone) return false
    }
    if (look.steep <= 1 && Math.abs(toward.y) / Math.max(away, TINY) > look.steep) return false
    return reading.cube.clearTo(world, look.slack)
  }

  /** Says how `by` now looks, where it stands. Nothing where `by` is not on. */
  update(by: object, look: SightLook): void {
    const claim = this.claims.find((one) => one.by === by)
    if (!claim) return
    claim.look = look
    if (this.top !== claim) return
    // Where the eye is, how far it reaches, what it takes in (the facing and
    // the field of view, written with the cube in `draw`) and the slack are
    // what the cube was drawn for, so a change to them waits for a drawing;
    // the colour, the opacity, the fade and which sides are painted go
    // straight to uniforms (`dress`)
    const was = this.drawnFor
    if (!was || !sameAim(was, look)) this.stale = true
    this.dress(look)
  }

  /** Takes `by`'s eye off; the one under it, if any, is painted next. */
  release(by: object): void {
    const at = this.claims.findIndex((claim) => claim.by === by)
    if (at < 0) return
    const wasTop = at === this.claims.length - 1
    this.claims.splice(at, 1)
    if (wasTop) this.turnedOver()
  }

  /** Whether `by`'s eye is the one painted. */
  shows(by: object): boolean {
    return this.top?.by === by
  }

  /** Whether any eye is on, and so whether {@link draw} has anything to do. */
  get wanted(): boolean {
    return this.claims.length > 0
  }

  /**
   * Something in the scene moved that the cube may hold: a building rising, a
   * motion, the mask. Said wherever the sun's map is told the same; see
   * `Viewer.stirShadows`.
   */
  stir(): void {
    this.stale = true
  }

  /**
   * @internal Draws the cube again where it no longer holds what the eye on
   * top would see, and points every reader at it.
   *
   * `busy` is whether any layer is still waiting on something: a city still
   * arriving is a city the cube does not yet hold. `now` is the viewer's clock,
   * in seconds; drawings are kept {@link SETTLE} apart while things keep
   * changing.
   *
   * `slack` in the look is how much further than what was drawn a place may be
   * and still count as clear. It is not a fudge for the card: the ground a
   * place lies on is drawn into this too, the line to that place runs along the
   * ground to reach it, and in the coarse texels far off it would find the
   * ground a texel nearer and call the place hidden by the very ground it
   * stands on. A couple of metres of it costs nothing a reader can see — a wall
   * hides what is behind it to within that — and without it the far half of
   * every hillside comes out unseen.
   *
   * Says whether it drew: what the cube holds is in the picture, so the viewer
   * draws the picture again with it.
   */
  draw(renderer: WebGPURenderer, scene: Scene, busy: boolean, now: number): boolean {
    const top = this.top
    if (!top) return false
    if (busy) this.stale = true
    if (!this.stale || now - this.drawnAt < SETTLE) return false
    this.stale = false
    this.drawnAt = now
    const look = top.look
    this.distances ??= new Distances()
    const far = look.range * FAR_ROOM
    // What each eye paints of its own is left out of what any of them can see
    const shown = this.claims.map((claim) => claim.own.visible)
    for (const claim of this.claims) claim.own.visible = false
    try {
      this.distances.draw(renderer, scene, look.eye, far)
    } finally {
      this.claims.forEach((claim, i) => (claim.own.visible = shown[i]!))
    }
    // Pointed at the cube only now that it has been drawn into; see
    // `Distances.draw`
    this.read.at(this.distances.depths, look.eye, far, look.slack)
    this.drawnFor = look
    if (top.asks()) this.readBack(renderer, top, look)
    this.eye.value.copy(look.eye)
    this.facing.value.copy(look.facing)
    this.cone.value = look.cone
    this.steep.value = look.steep
    this.range.value = look.range
    this.on.value = 1
    return true
  }

  dispose(): void {
    this.claims.length = 0
    this.off()
    this.read.dispose()
  }

  /**
   * Reads the cube just drawn back off the card for {@link sees}, and tells the
   * claimant once it has landed — if by then it is still the eye painted and
   * nothing newer has been asked for.
   */
  private readBack(renderer: WebGPURenderer, claim: Claim, look: SightLook): void {
    const distances = this.distances
    if (!distances) return
    const ours = ++this.askedFor
    this.onItsWay = true
    distances.read(renderer).then(
      (cube) => {
        if (ours !== this.askedFor) return
        this.onItsWay = false
        if (this.top !== claim) return
        this.reading = { look, cube }
        claim.told()
      },
      () => {
        // Nothing to answer from; the next question asks for the cube again
        if (ours === this.askedFor) this.onItsWay = false
      },
    )
  }

  /** The eye painted now: the last put on. */
  private get top(): Claim | undefined {
    return this.claims[this.claims.length - 1]
  }

  /**
   * The eye on top has changed. Nothing is painted until the cube is drawn
   * from it — a cube drawn from the eye before would put that eye's answer
   * round this one — and with none left the cube is let go of.
   */
  private turnedOver(): void {
    const top = this.top
    this.drawnFor = null
    // What was read back was another eye's
    this.forget()
    this.stale = true
    this.drawnAt = -Infinity
    this.on.value = 0
    if (top) this.dress(top.look)
    else this.off()
  }

  /** Drops what was read back, and any reading still on its way. */
  private forget(): void {
    this.reading = null
    this.askedFor++
    this.onItsWay = false
  }

  /** Writes what the eye paints and where; none of it asks for a drawing. */
  private dress(look: SightLook): void {
    this.tint.value.copy(look.color)
    this.opacity.value = look.opacity
    this.fade.value = look.fade
    this.onGround.value = look.ground ? 1 : 0
    this.onBuilt.value = look.buildings ? 1 : 0
  }

  /** Nothing to read: the stand-in back under every reader, and the cube let go of. */
  private off(): void {
    this.on.value = 0
    this.forget()
    this.read.clear()
    this.distances?.dispose()
    this.distances = null
    this.drawnFor = null
  }
}

/** Held for {@link Sight.sees}, which is asked per question rather than per frame. */
const SEES = { toward: new Vector3() }

/** Whether two looks would draw the same cube and judge it the same way. */
function sameAim(a: SightLook, b: SightLook): boolean {
  return (
    a.eye.equals(b.eye) &&
    a.range === b.range &&
    a.slack === b.slack &&
    a.facing.equals(b.facing) &&
    a.cone === b.cone &&
    a.steep === b.steep
  )
}
