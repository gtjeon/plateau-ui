import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrix,
  floor,
  max,
  modelViewMatrix,
  positionGeometry,
  select,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { texture, uniform } from '../repaint.js'
import {
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  Vector2,
  type Node,
} from 'three/webgpu'
import { APPEAR, stillUnder } from '../appear.js'
import { DRAWN_AT, readDepth, type Draws } from '../behind.js'
import { movedBy } from '../buildings/slots.js'
import type { BuildingSeat } from '../onBuildings.js'
import { MARKS, PICTURE_ONLY } from '../passes.js'
import { PICKED_ITEM, answersNoRays, notPicked } from '../pick.js'
import { asReflectance, beforeTheCurve } from '../tone.js'
import type { Atlas } from '../atlas.js'

/**
 * What one mark hands the shader.
 *
 * Every mark carries the whole of it, whether it stands on a building or on
 * the land. A mark on the land is the case where the tile is the mark's own
 * place, the stretch is one and the row is nought — the same arithmetic
 * answers both, so there is one shader rather than two.
 */
export interface Instance extends BuildingSeat {
  /**
   * What its group knows it by, for the pointer to hand back.
   *
   * A number of the mark's own rather than its turn in the draw: the marks are
   * laid out afresh every frame and a look under the pointer is a frame or two
   * in coming back, so a turn read then would belong to whoever has since
   * taken that place.
   */
  readonly item: number
  /**
   * Whether the pointer finds it. One that is not is drawn on a card of its
   * own, which the pointer is told to pass through; see {@link AnnotationMesh}.
   */
  readonly pickable: boolean
  /** Its picture on the sheet, as a rectangle in 0 to 1. */
  readonly patch: { x: number; y: number; width: number; height: number }
  /** How big the picture is drawn, in pixels of the page. */
  readonly width: number
  readonly height: number
  /** Where inside the picture the place it stands on falls, in pixels from its top left. */
  readonly gripX: number
  readonly gripY: number
}

const LOCAL = 'markLocal'
const ORIGIN = 'markOrigin'
/** Stretch, underfoot and row: three numbers that ride together. */
const SEAT = 'markSeat'
const PATCH = 'markPatch'
/**
 * How big the picture is and where inside it the mark's place falls, in one.
 *
 * A card takes eight buffers of corner values and no more, and a mark has
 * plenty to say: where it is, where its tile is, how it is seated, how it
 * comes and goes, where its picture sits on the sheet. So what can ride
 * together does. These two are read one after the other and are two numbers
 * each, which makes them the pair to put in one.
 */
const BOX = 'markBox'

/**
 * How much of a mark's picture a fragment has to carry to be drawn at all: one
 * step of the eight bits the sheet is kept in.
 *
 * So what the drawing left empty goes, and everything it put a mark on stays —
 * a letter's softest edge is a whole step even where it is barely there. What
 * falls between the two is the sheet being read between its texels, which is
 * nothing of the picture at all.
 */
const INK_AT_LEAST = 1 / 255

/**
 * Every instance attribute and how many numbers each mark gives it.
 *
 * Eight buffers with the corners' own, which is every one a card is allowed
 * and leaves nothing for a ninth. Whatever is added next rides in one of
 * these; see {@link BOX} for the two that already do.
 */
const WIDTHS: readonly (readonly [string, number])[] = [
  [LOCAL, 3],
  [ORIGIN, 3],
  [SEAT, 3],
  [APPEAR, 2],
  [PATCH, 4],
  [BOX, 4],
  [PICKED_ITEM, 1],
]

/**
 * The one material every mark standing behind things one way is drawn in, and
 * the cards it is drawn on.
 *
 * A mark is a rectangle standing at a place in the world and sized in pixels
 * of the page: it keeps its size as the view zooms, the way a label on a map
 * does, and it is a thing of the scene all the same — what stands in front of
 * it stands in front. The mask is no part of this material: it is honoured on
 * the processor, a whole mark at a time, by the place the mark stands on; see
 * `AnnotationLayer`.
 *
 * The rectangle is turned to the screen in view space, after the place has
 * been taken there and before the projection is applied. Doing it there is
 * what keeps it square to the screen under any tilt or turn without the mark
 * having to be told which way the camera looks.
 *
 * A mark set on a building goes where that building goes by carrying what the
 * building's own corners carry and being moved by the same arithmetic — not by
 * being told each frame where the building got to. A building is moved in the
 * shader, so a mark moved anywhere else is a mark a frame behind it, and one
 * moved from a layer that happened to be added first is a mark whose place
 * turns on the order a page called `add` in.
 *
 * **Two cards, one material.** The pointer finds whatever a mesh draws unless
 * the mesh says otherwise (`notPicked`), and says it for the whole mesh — the
 * look under the pointer is a drawing of the scene, and a mesh is the least of
 * it that drawing can be told to leave out. So a mark the page made
 * `pickable: false` cannot be one instance among the rest: it would be drawn
 * into the look as well, and hand back a hit nobody answers to, which takes the
 * click from the land behind it rather than letting it through. It goes on a
 * second card instead, which the pointer passes through. The two share this
 * material, so the second costs a buffer on the card and no shader — three
 * weaves a shader for a material and not for a mesh, which is why the city's
 * tiles can be many meshes and one material.
 *
 * What that costs is the order between the two. Marks are drawn over one
 * another in the order they were added, which is the order of the instances on
 * a card; across the two cards it is three's tie between equals, which falls
 * to the card made first. So where a mark the pointer finds and one it does not
 * overlap, the one it does not is drawn on top, whichever came first.
 */
export class AnnotationMesh {
  /** The two cards, for the layer to hang in its root; see {@link Card}. */
  readonly meshes: readonly Mesh[]
  private readonly material = new MeshBasicNodeMaterial()
  /** What the pointer finds, and what it passes through. */
  private readonly found: Card
  private readonly passed: Card
  /** How much of the world one pixel of the page covers. Written every frame. */
  private readonly perPixel = uniform(1)
  /** The drawing buffer in pixels of the screen, and how many of them go to one of the page. */
  private readonly device = uniform(new Vector2(1, 1))
  private readonly ratio = uniform(1)

  /** How much of what is drawn shows: all of it, or what a dimmed mark keeps. */
  private readonly strength = uniform(1)

  constructor(atlas: Atlas, draws: Draws) {
    const patch = attribute(PATCH, 'vec4')

    this.material.vertexNode = Fn(() => {
      const local = attribute(LOCAL, 'vec3')
      const origin = attribute(ORIGIN, 'vec3')
      const seat = attribute(SEAT, 'vec3')
      const box = attribute(BOX, 'vec4')

      // The same three steps a building's own corner is taken through, in the
      // same order: down while it is still coming in, moved by its row, and
      // then stood on the ground it stands on. `stillUnder` reads the mark's
      // own copy of what its building's corners carry, so the two agree.
      const here = vec3(local.x, local.y.sub(stillUnder()), local.z).toVar()
      const slot = seat.z.toInt().toVar()
      If(slot.greaterThan(0), () => {
        here.assign(movedBy(slot, here))
      })
      // And then out of the tile's metres and onto the map, which is what the
      // group a building hangs from does for the building.
      const worldPosition = origin.add(here.add(vec3(0, seat.y, 0)).mul(seat.x))

      /*
       * Everything from here on happens where the camera stands, not where the
       * screen does.
       *
       * The card is laid out in pixels, so the obvious way to lay it out is in
       * the picture's own pixels — take the place to the screen, step off it
       * there, and come back. That reads well and is wrong for any pass drawn
       * through another projection than the picture's: the look under the
       * pointer narrows the camera to the one pixel it asks about, and a card
       * laid out against the whole canvas inside that narrowed view lands
       * nowhere near where it is drawn. A click would find a mark only where
       * the pointer stood on the very place it marks.
       *
       * View space has neither trouble. Its x and y are already the screen's
       * right and up, so a card built there is square to the screen under any
       * tilt or turn; and a pixel is worth {@link perPixel} of it whatever
       * projection follows. Which is how three's own sprites are built.
       */
      const seen = modelViewMatrix.mul(vec4(worldPosition, 1))

      /*
       * The place on a whole pixel of the buffer being drawn into.
       *
       * Left where it falls, the picture lands between two pixels more often
       * than not. The letters are drawn a texel to the pixel, so read from half
       * a pixel over they are mixed from two texels, and the mix changes with
       * every frame the view moves: a word that crawls and glitters rather than
       * a word. Put the place on a pixel first and the texels land on pixels
       * for as long as the size holds, which is every zoom.
       *
       * Counted out from the middle of the view, which is where the camera's
       * own nought is — its frustum is symmetric, and its pixels are square.
       */
      const onBuffer = seen.xy.div(this.perPixel).mul(this.ratio).add(this.device.mul(0.5))
      const snap = floor(onBuffer.add(0.5)).sub(onBuffer)
      // Pixels right and down from there. Down the page is the way the picture
      // is read and up is the way the screen counts, so the one is the other's
      // negative.
      const corner = positionGeometry.xy.mul(box.xy).sub(box.zw)
      const step = snap.add(vec2(corner.x, corner.y.negate()).mul(this.ratio))
      const aside = step.div(this.ratio).mul(this.perPixel)

      /*
       * And a step toward the camera, as far as the picture hangs below the
       * place it stands on.
       *
       * The card is flat and stands at one depth — its own place's — while the
       * ground under it runs away with the tilt, so a card standing on the
       * ground is partly inside it, and a card standing exactly on it is at
       * the same depth as it and loses the toss. Either way the mark reads as
       * hidden by the very ground it stands on, which is not what standing
       * behind something means: the ground is what a mark is on, not what is
       * in front of it. Stepped off it by its own overhang, a mark clears the
       * ground it stands on and still goes behind anything standing up.
       */
      //
      // Never away from it. A picture a page moved up off its place (see
      // `AnnotationPlace.offset`) hangs above it, and stepped back by that it
      // would sink behind the very ground it stands on.
      const hangs = max(box.y.sub(box.w), 0).mul(this.perPixel)
      return cameraProjectionMatrix.mul(seen.add(vec4(aside.x, aside.y, hangs, 0)))
    })() as Node<'vec4'>

    const sheet = texture(atlas.texture, patch.xy.add(positionGeometry.xy.mul(patch.zw)))
    /*
     * The sheet is read as premultiplied and handed on straight.
     *
     * What lies outside a picture's ink is clear *black* — that is what a
     * canvas holds where nothing was drawn — so a sample taken across an ink
     * edge comes back as the colour already multiplied by how much of it there
     * is: half in, and the card reads half the colour at half the alpha.
     * Blended as it stands, `dst·(1−a) + rgb·a` puts that colour in a second
     * time, and every edge lands short of both what is behind it and what is
     * on it. On white it cannot be seen. On anything else it is a dark line
     * along every straight edge a picture has — which is to say one under each
     * line of letters, where the band round them ends.
     *
     * Divided back out, the colour is the colour and the alpha carries the
     * coverage, which is what the blend expects. The floor is the same step of
     * the eight bits the cut below uses, so nothing that survives the cut is
     * divided by less than it was drawn with.
     */
    const coverage = sheet.a.max(INK_AT_LEAST)
    const ink = sheet.rgb.div(coverage).clamp() as unknown as Node<'vec3'>
    // And written past the frame's tone curve, which is the last thing done to
    // it. A mark is a drawing a page made — its letters, its plate, its symbol —
    // and what it drew is what has to be on screen; nothing here is a surface
    // the sun falls on. See `tone.ts`.
    //
    // All but the half drawn faint through what hides it, which is held to
    // reflectance one instead; see below.
    this.material.colorNode =
      draws === 'behind'
        ? (select(this.strength.lessThan(1), asReflectance(ink), beforeTheCurve(ink)) as Node<'vec3'>)
        : beforeTheCurve(ink)
    /*
     * The coverage, and with it how much of a dimmed mark shows.
     *
     * Three blends in the frame's own light, before the curve, so a dimmed
     * mark is `src·a + dst·(1−a)`. Past the curve, the source for white is
     * 58.16 against a ground holding about one, and a few parts of it already
     * run away with the sum. Measured with a label sunk 30 m under the land so
     * that the land hides it, seen straight down (中野, z19.5, the city off),
     * red channel: over the LIGHT ground (232, sun at 52°) a white plate drew
     * 255 at every strength from 1 down to 0.35, 254 at 0.2 and 252 at 0.05,
     * and over the dark palette's ground (27, sun at −10°) the very same — the
     * white of a mark, a label's halo band, a pin's eye, a page's white plate,
     * could not be dimmed at all, while a `#333333` plate went 51 → 201 at the
     * default 0.35.
     *
     * So the faint half is written as a surface would be rather than as ink:
     * the colour taken back through the curve and then held to reflectance one
     * (`asReflectance`), which is the ceiling the stencil route in
     * `shapes/paint.ts` holds its blended paint to for this same reason. White
     * goes in at one rather than 58, and the blend is a blend again.
     * Everything whose inverse is under one — a colour whose brightest
     * channel draws under about 240 — goes in exactly as before, since the hold
     * only brings down what is past it. Measured after, same place: the white
     * plate draws 238 at 0.8, 236 at 0.5, 235 at the default 0.35, 234 at 0.2
     * and 233 at 0.05 over the light ground, and 227, 184, 157, 122, 63 over the
     * dark one — it goes towards the ground as everything else does. A
     * `#333333` plate and a `#d94f2a` one are where they were to the unit at
     * every strength over both grounds.
     *
     * What it costs is the top of the faint half's range. Held to one, white
     * draws `#f0f0f0` rather than 255 — what a white wall draws — so a dimmed
     * mark's white never quite reaches the paper's. That is the price of
     * blending at all: no single source value gives both a dimmed pixel and an
     * opaque one their drawn mix, since the blend works on values the curve has
     * yet to be applied to (about 1.4 would be wanted for the one and 58 for
     * the other). Reading the destination — a copy of the frame, which the thin
     * lines turned down for their own reasons — is the only way round it.
     *
     * Except at a strength of one, where nothing is being dimmed: that is the
     * half drawn through what hides it at full strength, and it draws exactly
     * (measured: 255), so a mark a page told to show through at one does not
     * wear the seam of 240 against 255 the hold alone would give it where it
     * passes behind a wall. A uniform's choice, so the dim moving across one
     * weaves nothing.
     *
     * `shapes/paint.ts` has the same word and a different answer: it mixes the
     * colour towards the backdrop before the curve and leaves the alpha alone
     * (`tinted`), which it can because a painted shape is laid on the land and
     * the land is what is behind it. A mark stands over the city, the land and
     * the air by turns and has no one colour to mix towards.
     *
     * _(2026-10-29: until today this said the white could not be dimmed from
     * here and left it so. The hold was the way the stencil route had already
     * found; the undimmed half is untouched.)_
     */
    this.material.opacityNode = sheet.a.mul(this.strength) as Node<'float'>
    this.material.transparent = true
    /*
     * And nothing at all where the picture has nothing.
     *
     * A card is the rectangle a mark's picture was drawn in, which is wider
     * than the ink whenever the words stand beside the symbol rather than
     * under it. Blended, the clear part costs nothing and shows nothing — but
     * the pointer reads the same shapes, and a card that answered across the
     * whole of its rectangle would take the click meant for the mark behind
     * its corner. Thrown away here, one cut serves the picture and the pointer
     * alike; see `masksFragments`.
     *
     * The floor is a step of the eight bits the sheet is kept in, so nothing
     * that shows is thrown away — not even the softest edge of a letter, which
     * is a whole step where it is barely there at all.
     */
    this.material.maskNode = sheet.a.greaterThanEqual(INK_AT_LEAST) as Node
    // Down the page is up the screen's negative, so the square is mirrored on
    // its way out and its corners come round the other way. Nothing here has a
    // back to tell from a front, so both are drawn rather than the winding
    // being turned about to suit a rule that decides nothing.
    this.material.side = DoubleSide
    // Marks are drawn last and over one another freely; writing depth would have
    // whatever of one rectangle is short of solid cut a hole in the next — a
    // letter's edge, or the whole of a dimmed mark. The clear part could not: it
    // is thrown away above.
    readDepth(this.material, draws)
    this.material.color = new Color('#ffffff')

    this.found = new Card(this.material, draws)
    this.passed = new Card(this.material, draws)
    // Out of the look under the pointer as a whole card; see `notPicked`. Both
    // cards are out of three's own `Raycaster` already (`Card`).
    notPicked(this.passed.mesh)
    this.meshes = [this.found.mesh, this.passed.mesh]
  }

  /** What the screen is doing, told every frame. */
  onScreen(perPixel: number, width: number, height: number, ratio: number): void {
    this.perPixel.value = perPixel
    this.device.value.set(width, height)
    this.ratio.value = ratio
  }

  /** How much of a mark shows here, for the half drawn through what hides it. */
  fade(strength: number): void {
    this.strength.value = strength
  }

  /**
   * Lays the marks out afresh, each on the card that answers to it.
   * Everything, since what moved is rarely one of them.
   */
  set(instances: readonly Instance[]): void {
    this.found.set(instances.filter((mark) => mark.pickable))
    this.passed.set(instances.filter((mark) => !mark.pickable))
  }

  get count(): number {
    return this.found.count + this.passed.count
  }

  dispose(): void {
    this.found.dispose()
    this.passed.dispose()
    this.material.dispose()
  }
}

/**
 * One mesh of marks: a square, drawn once for each of them.
 *
 * Its own geometry, since the instances are what part one card from the
 * other, and the material it is handed, since a material is a shader.
 */
class Card {
  readonly mesh: Mesh
  private readonly geometry = new InstancedBufferGeometry()
  /** The instance buffers, kept and written into rather than made afresh. */
  private readonly buffers = new Map<string, InstancedBufferAttribute>()
  /** How many marks the buffers have room for. */
  private room = 0
  private held = 0

  constructor(material: MeshBasicNodeMaterial, draws: Draws) {
    // A square with its corners at 0,0 and 1,1, read as across and down the
    // page — the same way the picture on it is read, so one pair of numbers
    // serves the corner and the texture alike.
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
    )
    this.geometry.setIndex([0, 1, 2, 2, 1, 3])
    // No `uv` of its own: the square's corners run 0 to 1 across and down,
    // which is what the picture on it wants read, so one attribute answers
    // both. The buffer that saved is where `PICKED_ITEM` rides, which has no
    // stand-in of its own; see the count above `WIDTHS`.

    this.mesh = new Mesh(this.geometry, material)
    // The rectangles are put where they are by the shader, so what three would
    // measure off the geometry says nothing about where they end up.
    this.mesh.frustumCulled = false
    // Nor would a ray, and a mark answers none, picked or not; see
    // `answersNoRays`
    answersNoRays(this.mesh)
    // Out of sight until it holds a mark, so that nothing weaves a shader
    // against a card with no instance buffers on it yet
    this.mesh.visible = false
    // Which of the three halves it draws, inside the layer's stage; the two
    // cards of one material take the same number, see `AnnotationMesh`
    this.mesh.renderOrder = DRAWN_AT[draws]
    /*
     * Drawn over the finished picture, which is what the layer is for: the
     * corner shading is multiplied over what has been drawn, and a white plate
     * laid under it would come out with the shade of whatever stands behind it
     * printed on it. It casts no shadow either, having no surface to cast one.
     *
     * The pointer is another matter and does not go by this: it finds whatever
     * the picture shows unless the thing says otherwise, which a mark says by
     * the card it is put on. See `notPicked`.
     */
    this.mesh.layers.set(PICTURE_ONLY)
    // And drawn apart from the rest of what is laid over the picture where the
    // picture is blurred, so a label stays one that can be read; see `MARKS`
    this.mesh.layers.enable(MARKS)
  }

  /**
   * Lays its marks out afresh.
   *
   * Written into the buffers already there rather than into new ones. This is
   * called every frame, and three keys a card's buffers by the attribute
   * object it was handed: a fresh one a frame is a fresh buffer on the card a
   * frame, and the ones it replaces are not given back.
   *
   * And sent to the card only where a number in them changed. Marks standing
   * still are written the same every frame, and a buffer marked changed is a
   * picture the viewer would draw again for nothing (`repaint.ts`), as well as
   * an upload for nothing.
   */
  set(instances: readonly Instance[]): void {
    const count = instances.length
    const grown = this.reserve(count)
    const local = this.array(LOCAL)
    const origin = this.array(ORIGIN)
    const seat = this.array(SEAT)
    const appear = this.array(APPEAR)
    const patch = this.array(PATCH)
    const box = this.array(BOX)
    const item = this.array(PICKED_ITEM)
    let changed = grown || count !== this.held
    for (const [i, mark] of instances.entries()) {
      changed = put(item, i, mark.item) || changed
      changed = put3(local, i * 3, mark.x, mark.y, mark.z) || changed
      changed = put3(origin, i * 3, mark.originX, mark.originY, mark.originZ) || changed
      changed = put3(seat, i * 3, mark.stretch, mark.underfoot, mark.slot) || changed
      changed = put(appear, i * 2, mark.appearAt) || changed
      changed = put(appear, i * 2 + 1, mark.appearBy) || changed
      changed = put4(patch, i * 4, mark.patch.x, mark.patch.y, mark.patch.width, mark.patch.height) || changed
      changed = put4(box, i * 4, mark.width, mark.height, mark.gripX, mark.gripY) || changed
    }
    if (changed) for (const buffer of this.buffers.values()) buffer.needsUpdate = true
    this.geometry.instanceCount = count
    this.held = count
    this.mesh.visible = count > 0
  }

  get count(): number {
    return this.held
  }

  dispose(): void {
    this.geometry.dispose()
  }

  /** The values behind one attribute, to be written in place. */
  private array(name: string): Float32Array {
    return this.buffers.get(name)?.array as Float32Array
  }

  /**
   * Makes room for that many marks, doubling rather than fitting exactly.
   *
   * Replacing a buffer costs a buffer on the card, so it is done as seldom as
   * a growing list allows rather than every time one mark is added.
   */
  private reserve(count: number): boolean {
    if (count <= this.room) return false
    let room = Math.max(8, this.room)
    while (room < count) room *= 2
    this.room = room
    for (const [name, width] of WIDTHS) {
      const buffer = new InstancedBufferAttribute(new Float32Array(room * width), width)
      buffer.setUsage(DynamicDrawUsage)
      this.buffers.set(name, buffer)
      this.geometry.setAttribute(name, buffer)
    }
    return true
  }
}

/**
 * Writes a number into a buffer, and says whether it was not there already.
 *
 * Compared as the buffer holds it: a float of 32 bits, so a number it cannot
 * hold exactly reads the same frame after frame rather than different every time.
 */
function put(array: Float32Array, at: number, value: number): boolean {
  const held = Math.fround(value)
  if (array[at] === held) return false
  array[at] = held
  return true
}

function put3(array: Float32Array, at: number, a: number, b: number, c: number): boolean {
  const one = put(array, at, a)
  const two = put(array, at + 1, b)
  return put(array, at + 2, c) || one || two
}

function put4(array: Float32Array, at: number, a: number, b: number, c: number, d: number): boolean {
  const one = put(array, at, a)
  const two = put(array, at + 1, b)
  const three = put(array, at + 2, c)
  return put(array, at + 3, d) || one || two || three
}
