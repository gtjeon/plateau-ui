import { Fn, If, positionGeometry, renderGroup, transformNormalToView, vec3 } from 'three/tsl'
import { uniform } from '../repaint.js'
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  Ray,
  Sphere,
  Vector2,
  Vector3,
  type Intersection,
  type Node,
  type NodeMaterial,
  type Raycaster,
} from 'three/webgpu'
import { TEXELS } from '../elevation.js'
import { EARTH_RADIUS, WORLD_ORIGIN_Y, type WorldBounds } from '../geo/mercator.js'
import { metresOnCard, NO_CELLS, NO_TILES, slopeOnCard, type LandHeights } from '../landHeights.js'
import { lookup } from '../lookup.js'

/**
 * The ground under everything: what shows wherever nothing else covers it.
 *
 * A vector tile hands over what is there — roads, rivers, green — and leaves
 * the space between them empty. A plane per tile would reach only as far as
 * the tiles fetched, so its edge would show, and land would sit on the sea.
 * Instead one sheet, belonging to no tile, is held in front of the camera and
 * stretched to what is in view.
 *
 * Flat, that is four corners, as it always was. Carrying the land's own
 * heights it is a grid, and the grid is cut afresh each time the view moves
 * rather than being kept per tile: held in front of the camera it is as fine
 * on screen at one zoom as at another, it has no seams to hide, and it is
 * there over ground whose tiles have not arrived — which is most of the sea
 * and all of the first second.
 *
 * Its corners are put down on a lattice that belongs to the world rather than
 * to the view. Cut wherever the view happened to fall, every corner would sit
 * somewhere new each frame and a ridge would crawl as the map was dragged
 * under it. The lattice steps by powers of two, so a zoom moves it by whole
 * cells too.
 *
 * **The card raises it** _(2026-10-29)_. Each corner reads the land's height
 * at its own place in the vertex stage, out of the heights held on the card
 * (`landHeights.ts`), and each pixel works out which way the land faces there
 * from the same readings. What the processor writes is the lattice and nothing
 * else, and it writes it only when the number of cells changes.
 *
 * Until then the processor raised it: every corner read the tiles in hand
 * each frame the view moved, and the way the ground faced was worked out
 * corner by corner. So the land read only as fine as the sheet was cut, and
 * stepping out that was much coarser than the readings themselves. Measured
 * over the whole of Honshu (z7, a 750-pixel canvas): a cell was 8,192 world
 * units, 6.6km at that latitude, where the readings came every 1,223 — a
 * pixel apiece — so five ridges out of six fell between two corners, and the
 * country shaded as though it were smooth. The shading is now as fine as the readings at every
 * zoom. The shape is not: the lattice is cut as it was, so out there a ridge
 * still stands as a chord between two corners, and what it throws on the sun's
 * map is the chord's shadow.
 *
 * Because what is drawn is no longer what the geometry holds, the mesh answers
 * three's `Raycaster` for itself, off the same readings; see {@link cast}.
 * Every pass that draws it under a material of its own — the sun's map, the
 * shading of corners, the land under a mask, the pointer — carries the
 * material's `positionNode`, so they all draw it where it is drawn
 * (`offscreen.ts`).
 */

/**
 * About how many cells the sheet is cut into, each way.
 *
 * The cell is squared off to a power of two around this, so the real count
 * runs from about 110 to 230. At 160 a cell is some six pixels across on a
 * thousand-pixel canvas, which is finer than the readings themselves
 * anywhere a city is looked at: the tiles hold a reading every ten metres,
 * and by z18 one cell is under three metres.
 *
 * What it costs now is the card's: every corner reads five numbers out of a
 * texture in every pass the land is drawn in. It used to be a walk over some
 * 26,000 corners on the processor on every frame the view moved — 1.7ms of
 * the ground's frame, measured at 横浜 z18 — and that walk is gone. Out at a
 * wide view it was most of the frame: sixty frames turning over the whole of
 * Honshu (z7, 750×470), sent at once and timed to the card's last, took
 * 18.1ms a frame with it and 1.4ms without.
 */
const CELLS = 160

/** The most it is ever cut into, so an odd view cannot run the count away. */
const MOST_CELLS = 256

/**
 * The step the count is held to. A handful of cells of waste at the edge,
 * against writing the face list afresh twice a second while the map is dragged.
 */
const CELL_STEP = 32

/**
 * How many corners each way the rise of the land in view is measured over, at
 * most; see {@link Surface.relief}. The lattice's own corners, every so many,
 * and every one of them below this.
 *
 * Every corner of a cut of 128 cells, 16,641 of them, took 0.5ms (median of
 * fifty, 鎌倉 z16.5); the most the lattice is cut into is four times that. It is
 * measured on the frames the view moves, so it is held to this many.
 */
const RELIEF_CORNERS = 80

/** For three's `Raycaster`, made once. */
const inverse = new Matrix4()
const ray = new Ray()
const cornerPoints = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
const struck = new Vector3()
const nearer = new Vector3()
const faceNormal = new Vector3()
const edgeA = new Vector3()
const edgeB = new Vector3()

export class Surface {
  readonly mesh = new Mesh(new BufferGeometry())
  /** How many cells across it is cut now; 1 while it is flat. */
  private cells = 0
  private readonly positions: Float32Array
  private readonly faces: Uint32Array
  private readonly position: BufferAttribute
  private readonly index: BufferAttribute
  private _cell = 0
  /** Where the lattice's first corner stands: world x, and world y (north). */
  private west = 0
  private north = 0
  /** The heights it reads, or null while it is flat. */
  private land: LandHeights | null = null
  /** The {@link LandHeights.placed} it last aimed by. */
  private aimedAt = -1
  /** The rise last measured, and what it was measured over; see {@link relief}. */
  private _relief = 0
  private measuredAt = -1
  private cutCount = 0
  private measuredCut = -1

  /*
   * What the card reads, all of it one fact about this sheet and so shared by
   * every pass that draws it (CLAUDE.md, `uniform()`s are one per object
   * unless said otherwise).
   */
  /** Where the lattice's first corner falls on the land's window, in readings. */
  private readonly offset = uniform(new Vector2()).setGroup(renderGroup)
  /** Readings of the window to a cell. */
  private readonly stride = uniform(0).setGroup(renderGroup)
  /** World units to a cell, east and south; a flat sheet's one cell is the whole of it. */
  private readonly step = uniform(new Vector2(1, 1)).setGroup(renderGroup)
  /** How far the window runs, in readings, east and south. */
  private readonly room = uniform(new Vector2(1, 1)).setGroup(renderGroup)
  /** One with the heights on, nought with them off. */
  private readonly lifted = uniform(0).setGroup(renderGroup)
  /**
   * The Mercator stretch at the first row, as an angle, and how much of it a
   * row takes away; see {@link stretchAt}.
   */
  private readonly latitude = uniform(new Vector2()).setGroup(renderGroup)
  /** World units between two readings of the window. */
  private readonly texel = uniform(1).setGroup(renderGroup)
  /**
   * One where the sheet is cut coarser than the readings and each pixel works
   * out which way it faces, nought where each corner does; see {@link shade}.
   */
  private readonly perPixel = uniform(0).setGroup(renderGroup)
  /**
   * The land's textures, as a material reads them. Its own nodes, so that the
   * sheet can be woven before it is on a viewer and handed the viewer's
   * heights when it gets there: swapping what a node reads weaves nothing
   * again.
   */
  private readonly tilesRead = lookup(NO_TILES)
  private readonly cellsRead = lookup(NO_CELLS)
  /** Where a corner falls on the window, and the stretch where it stands; see {@link raised}. */
  private readonly place: Node<'vec3'>
  /** The corner where it is drawn; see {@link stand}. */
  private readonly raised: Node<'vec3'>
  /** The way the land faces, once a lit material has asked; see {@link shade}. */
  private facing: Node<'vec3'> | null = null

  constructor() {
    // It is held in front of the camera, so whatever is worked out about
    // where it lies is worked out about the view it was cut for
    this.mesh.frustumCulled = false
    /*
     * And none of three's to measure, which is the other half of the same
     * thing and has to be said out loud since 2026-10-06.
     *
     * Three measures a geometry **once**: `_projectObject` computes a bounding
     * sphere wherever it finds none and the answer stands for the geometry's
     * life. The corners it would measure are the lattice, not the land — the
     * card raises them — so the only honest bound is the endless one: nothing
     * can be ruled out by it, which is what `frustumCulled` already says. The
     * raycaster is answered by {@link cast}, which does not ask it.
     */
    this.mesh.geometry.boundingSphere = new Sphere(new Vector3(), Infinity)
    this.mesh.raycast = (raycaster, hits) => this.cast(raycaster, hits)

    // Room for the finest cut there will ever be, taken once and kept. Every
    // coarser cut is this same room with the corners packed closer together,
    // so no cut ever asks for room of its own; see {@link cut}.
    const corners = (MOST_CELLS + 1) ** 2
    this.positions = new Float32Array(corners * 3)
    this.faces = new Uint32Array(MOST_CELLS * MOST_CELLS * 6)
    this.position = new BufferAttribute(this.positions, 3)
    this.index = new BufferAttribute(this.faces, 1)
    const geometry = this.mesh.geometry
    geometry.setAttribute('position', this.position)
    geometry.setIndex(this.index)
    // Nothing of it until the first cut says how much to draw
    geometry.setDrawRange(0, 0)

    // The lattice as written: a corner's place across and down, in cells
    const lattice = positionGeometry
    const u = this.offset.x.add(lattice.x.mul(this.stride))
    const v = this.offset.y.add(lattice.z.mul(this.stride))
    const angle = this.latitude.x.sub(lattice.z.mul(this.latitude.y))
    this.place = vec3(u, v, angle)
    const metres = metresOnCard(this.tilesRead, this.cellsRead, u, v, this.room)
    const up = metres.mul(stretchAt(angle)).mul(this.lifted)
    this.raised = vec3(lattice.x.mul(this.step.x), up, lattice.z.mul(this.step.y))
  }

  /**
   * How far apart the corners stand, in world units. Nought while it is flat.
   *
   * What a step in the sheet is as wide as: a corner and the one beside it
   * are one of these apart, so anything of the sheet that stands up does it
   * over exactly this much ground.
   */
  get cell(): number {
    return this._cell
  }

  /**
   * How far the land in view rises from its lowest point, in metres. Nought
   * while it is flat.
   *
   * It is what the viewer widens the sun's view by, and what says there is
   * anything here worth shading at all: over land drawn flat there is neither
   * a shadow to cast nor a corner to close in.
   *
   * Measured when asked, and again only once the sheet is cut afresh or what
   * the card reads has changed. Over the lattice's own corners, read the way
   * the card reads them — every one of them up to {@link RELIEF_CORNERS} a
   * side, every so many past that. It used to fall out of raising the
   * sheet, which read every corner anyway; now nobody else reads them here,
   * and a sheet nobody asks this of — a picture laid on the land — never
   * measures at all.
   */
  get relief(): number {
    const land = this.land
    if (!land) return 0
    if (this.measuredAt === land.filled && this.measuredCut === this.cutCount) return this._relief
    this.measuredAt = land.filled
    this.measuredCut = this.cutCount
    const every = Math.max(1, Math.ceil(this.cells / RELIEF_CORNERS))
    let lowest = Infinity
    let highest = -Infinity
    for (let down = 0; down <= this.cells; down += every) {
      for (let across = 0; across <= this.cells; across += every) {
        const metres = this.metresAt(across, down)
        if (metres < lowest) lowest = metres
        if (metres > highest) highest = metres
      }
    }
    this._relief = highest > lowest ? highest - lowest : 0
    return this._relief
  }

  /**
   * Has a material draw the sheet where the land is: the card raises every
   * corner to the height at its own place.
   *
   * For whatever material the sheet wears, and the same node every time, so a
   * material handed it twice is woven once.
   */
  stand(material: NodeMaterial): void {
    material.positionNode = this.raised
  }

  /**
   * Has a lit material face the way the land faces, worked out on the card
   * from the readings themselves.
   *
   * Two ways, by how fine the sheet is cut against the readings.
   *
   * **Cut finer — close in, where a city is looked at — at each corner, as the
   * processor did:** the height a cell east and a cell west, a cell north and
   * a cell south, each brought down by its own row's stretch, and the way the
   * corner faces carried across the faces between corners. The same numbers
   * the processor worked out, so close in the land faces exactly as it did.
   *
   * **Cut coarser — everywhere out of a city — at each pixel:** the rise
   * between the readings either side of the pixel's own place
   * ({@link slopeOnCard}). A corner can only say what it sees at its own
   * place, and out at the whole country a cell is six readings across; the
   * five between would never be seen. This is what shows every ridge. It is
   * also the dear half — twelve readings fetched for every pixel of land on
   * the screen. Measured over 北アルプス (z10, laid back 45°, 1500×940 pixels of
   * land on the Mac this was written on), sixty frames sent at once and timed
   * to the card's last: 1.59ms a frame with it, 1.38ms without. So close in,
   * where it would show nothing the corners do not, it is not paid for.
   * Which of the two is a number the card branches on, so the half not taken
   * costs nothing.
   */
  shade(material: NodeMaterial): void {
    this.facing ??= this.facingNode()
    ;(material as { normalNode: Node<'vec3'> | null }).normalNode = this.facing
  }

  /** The way the land faces, made once; see {@link shade}. */
  private facingNode(): Node<'vec3'> {
    const tiles = this.tilesRead
    const cells = this.cellsRead
    const room = this.room
    // At each corner, in the vertex stage
    const place = this.place
    const stride = this.stride
    const angle = place.z
    const rows = this.latitude.y
    const height = (across: number, down: number, stretch: Node<'float'>): Node<'float'> =>
      metresOnCard(tiles, cells, place.x.add(stride.mul(across)), place.y.add(stride.mul(down)), room)
        .mul(stretch)
        .mul(this.lifted) as Node<'float'>
    const here = stretchAt(angle)
    const eastward = height(1, 0, here)
      .sub(height(-1, 0, here))
      .mul(0.5)
    const southward = height(0, 1, stretchAt(angle.sub(rows)))
      .sub(height(0, -1, stretchAt(angle.add(rows))))
      .mul(0.5)
    // Up, leaning away from the way the land climbs; the rise over a cell
    // either side against the cell itself, as the processor put it
    const cornerFacing = vec3(eastward.negate(), this.step.x, southward.negate()).toVarying()

    // At each pixel, in the fragment stage
    const seen = place.toVarying()
    const slope = slopeOnCard(tiles, cells, seen.x, seen.y, room)
    const perMetre = stretchAt(seen.z).mul(this.lifted).div(this.texel)
    const pixelFacing = vec3(slope.x.mul(perMetre).negate(), 1, slope.y.mul(perMetre).negate())

    const perPixel = this.perPixel
    const facing = Fn(() => {
      const normal = vec3(cornerFacing).toVar()
      If(perPixel.greaterThan(0.5), () => {
        normal.assign(pixelFacing)
      })
      // The sheet is only ever moved, never turned, so the world's way up is
      // its own
      return transformNormalToView(normal.normalize()).normalize()
    })()
    return facing as unknown as Node<'vec3'>
  }

  /**
   * Lays the sheet over what is in view: flat where no heights are given,
   * following them where they are.
   */
  follow(bounds: WorldBounds, land: LandHeights | null): void {
    if (!land?.on) {
      this.flatten(bounds)
      return
    }

    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    if (!(span > 0)) {
      this.flatten(bounds)
      return
    }
    // Squared off to a power of two, so that the lattice a zoom lands on is
    // one the last zoom's corners already stood on
    const cell = 2 ** Math.round(Math.log2(span / CELLS))
    const west = Math.floor(bounds.minX / cell) * cell
    const north = Math.ceil(bounds.maxY / cell) * cell
    const needed = Math.max(
      Math.ceil((bounds.maxX - west) / cell),
      Math.ceil((north - bounds.minY) / cell),
      1,
    )
    // Rounded up to a whole handful, because changing the count is the one
    // expensive thing here — it writes the lattice and every face of the
    // sheet afresh and sends the lot over again. The snap the lattice does
    // leaves a remainder that sweeps from nought to a whole cell as the map is
    // dragged, so the bare count flips between n and n+1 about every half
    // cell: a third of the frames of a drag, and nearly every frame of a
    // zoom. Held to a step, it changes about as often as the cell does.
    const cells = Math.min(MOST_CELLS, Math.ceil(needed / CELL_STEP) * CELL_STEP)

    // Laid somewhere new, the rise is measured again; see {@link relief}
    if (west !== this.west || north !== this.north || cell !== this._cell) this.cutCount++
    this._cell = cell
    this.cut(cells)
    this.mesh.position.set(west, 0, -north)
    this.west = west
    this.north = north
    this.step.value.set(cell, cell)
    this.latitude.value.set((north + WORLD_ORIGIN_Y) / EARTH_RADIUS, cell / EARTH_RADIUS)
    this.lifted.value = 1
    this.land = land
    this.aimedAt = -1
    this.keep()
  }

  /**
   * Aims the sheet again where the window of heights has moved since it last
   * did, which may be on a frame the sheet itself was not laid afresh. A
   * comparison of two numbers where it has not.
   */
  keep(): void {
    const land = this.land
    if (!land || this.aimedAt === land.placed) return
    this.aimedAt = land.placed
    if (this.tilesRead.value !== land.tiles) this.tilesRead.value = land.tiles
    if (this.cellsRead.value !== land.cells) this.cellsRead.value = land.cells
    const texel = land.texel
    this.offset.value.set((this.west - land.west) / texel, (land.north - this.north) / texel)
    this.stride.value = this._cell / texel
    this.room.value.set(land.across * TEXELS, land.down * TEXELS)
    this.texel.value = texel
    this.perPixel.value = this._cell > texel ? 1 : 0
  }

  /**
   * Lets go of the viewer's heights, for a layer taken off its viewer: the
   * sheet reads again what it was made reading, so it neither keeps that
   * viewer's window alive nor binds its textures on another viewer that draws
   * the land flat. Swapping what a node reads weaves nothing again.
   */
  letGo(): void {
    this.land = null
    this.aimedAt = -1
    this.measuredAt = -1
    this._relief = 0
    this.lifted.value = 0
    this.tilesRead.value = NO_TILES
    this.cellsRead.value = NO_CELLS
  }

  dispose(): void {
    this.mesh.geometry.dispose()
  }

  /** Four corners on the plane, which is what the ground was before it had heights. */
  private flatten(bounds: WorldBounds): void {
    this.cut(1)
    this.mesh.position.set(bounds.minX, 0, -bounds.maxY)
    this._cell = 0
    this.land = null
    this.lifted.value = 0
    // The one cell is the whole of what is in view, each way
    this.step.value.set(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    this.perPixel.value = 0
    this.texel.value = 1
    this._relief = 0
    this.cutCount++
  }

  /**
   * Writes the lattice and which corners the faces are drawn between, for a
   * sheet cut that many cells each way, where it is not cut that way already.
   *
   * Nothing is made here. The room for the finest cut is taken once, in the
   * constructor, and a coarser cut is that same room with the corners packed
   * closer together — so all a change of count comes to is the lattice and
   * the face list, which name corners by how far apart they are packed and are
   * the two things that cannot stand. Both are left alone while the view
   * moves: where the lattice lies and how high each corner stands are the
   * card's to work out.
   *
   * It used to make the sheet afresh: a change of count threw away the
   * corners, the facings, the readings and the faces, and the geometry holding
   * them, and wrote the lot again. Measured at 御殿場 z17→18, a zoom level
   * takes four such changes — 6.7MB handed to the collector, and with the
   * geometry went its buffers on the card and whatever the renderer had worked
   * out about drawing it.
   */
  private cut(cells: number): void {
    if (this.cells === cells) return
    this.cells = cells
    this.cutCount++
    const side = cells + 1
    let at = 0
    for (let down = 0; down < cells; down++) {
      for (let across = 0; across < cells; across++) {
        const corner = down * side + across
        this.faces[at] = corner
        this.faces[at + 1] = corner + side
        this.faces[at + 2] = corner + 1
        this.faces[at + 3] = corner + 1
        this.faces[at + 4] = corner + side
        this.faces[at + 5] = corner + side + 1
        at += 6
      }
    }
    for (let down = 0; down < side; down++) {
      for (let across = 0; across < side; across++) {
        const corner = (down * side + across) * 3
        this.positions[corner] = across
        this.positions[corner + 1] = 0
        this.positions[corner + 2] = down
      }
    }

    // Only what was just written goes over, and only those faces are drawn.
    // Past them the room still holds whatever a finer cut left there.
    this.index.clearUpdateRanges()
    this.index.addUpdateRange(0, at)
    this.index.needsUpdate = true
    this.position.clearUpdateRanges()
    this.position.addUpdateRange(0, side * side * 3)
    this.position.needsUpdate = true
    this.mesh.geometry.setDrawRange(0, at)
  }

  /** How high the land stands at a corner, in metres, as the card reads it. */
  private metresAt(across: number, down: number): number {
    const land = this.land
    if (!land) return 0
    const offset = this.offset.value
    const stride = this.stride.value
    return land.metresAt(offset.x + across * stride, offset.y + down * stride)
  }

  /** A corner where the card draws it, in the mesh's own units. */
  private cornerAt(across: number, down: number, into: Vector3): Vector3 {
    const step = this.step.value
    const up = this.land
      ? this.metresAt(across, down) *
        Math.cosh(this.latitude.value.x - down * this.latitude.value.y) *
        this.lifted.value
      : 0
    return into.set(across * step.x, up, down * step.y)
  }

  /**
   * Answers three's `Raycaster` with the land as the card draws it.
   *
   * Three's own would walk the lattice as it lies in the geometry, which is
   * flat — the card raises it — and so find the land at sea level under a
   * mountain. This walks the cells the ray passes over, in the order it passes
   * them, and puts it to the two faces of each with their corners where the
   * card puts them; the first face struck is the nearest, since a face of one
   * cell lies within that cell. The faces are split the way {@link cut} splits
   * them, so a ray and the picture agree to the face.
   *
   * What is left as it was is that the mask is not asked: the sheet is cut by
   * the mask in its fragments, and the ray found the land past it before
   * this, too.
   */
  private cast(raycaster: Raycaster, hits: Intersection[]): void {
    const cells = this.cells
    if (cells === 0) return
    this.mesh.updateWorldMatrix(true, false)
    inverse.copy(this.mesh.matrixWorld).invert()
    ray.copy(raycaster.ray).applyMatrix4(inverse)
    const step = this.step.value
    const width = cells * step.x
    const depth = cells * step.y
    if (!(width > 0) || !(depth > 0)) return

    // The stretch of the ray over the lattice, seen from above
    const o = ray.origin
    const d = ray.direction
    let enter = 0
    let leave = Infinity
    for (const [from, toward, far] of [
      [o.x, d.x, width],
      [o.z, d.z, depth],
    ] as const) {
      if (Math.abs(toward) < 1e-12) {
        if (from < 0 || from > far) return
        continue
      }
      const a = (0 - from) / toward
      const b = (far - from) / toward
      enter = Math.max(enter, Math.min(a, b))
      leave = Math.min(leave, Math.max(a, b))
    }
    if (enter > leave) return

    const startX = o.x + d.x * enter
    const startZ = o.z + d.z * enter
    let across = Math.min(cells - 1, Math.max(0, Math.floor(startX / step.x)))
    let down = Math.min(cells - 1, Math.max(0, Math.floor(startZ / step.y)))
    const stepAcross = d.x > 0 ? 1 : -1
    const stepDown = d.z > 0 ? 1 : -1
    const passX = Math.abs(d.x) < 1e-12 ? Infinity : Math.abs(step.x / d.x)
    const passZ = Math.abs(d.z) < 1e-12 ? Infinity : Math.abs(step.y / d.z)
    let nextX = passX === Infinity ? Infinity : ((d.x > 0 ? across + 1 : across) * step.x - o.x) / d.x
    let nextZ = passZ === Infinity ? Infinity : ((d.z > 0 ? down + 1 : down) * step.y - o.z) / d.z

    const side = cells + 1
    for (let walked = 0; walked <= cells * 2 + 1; walked++) {
      const found = this.strike(across, down)
      if (found >= 0) {
        struck.applyMatrix4(this.mesh.matrixWorld)
        const distance = raycaster.ray.origin.distanceTo(struck)
        if (distance < raycaster.near || distance > raycaster.far) return
        const second = found === 1
        const corner = down * side + across
        const [a, b, c] = second
          ? [corner + 1, corner + side, corner + side + 1]
          : [corner, corner + side, corner + 1]
        hits.push({
          distance,
          point: struck.clone(),
          object: this.mesh,
          face: { a, b, c, normal: faceNormal.clone(), materialIndex: 0 },
          faceIndex: (down * cells + across) * 2 + (second ? 1 : 0),
        })
        return
      }
      if (Math.min(nextX, nextZ) > leave) return
      if (nextX < nextZ) {
        across += stepAcross
        nextX += passX
      } else {
        down += stepDown
        nextZ += passZ
      }
      if (across < 0 || across >= cells || down < 0 || down >= cells) return
    }
  }

  /**
   * Puts the ray, in the mesh's own units, to the two faces of one cell:
   * which of them it strikes first (0 or 1), or -1. Where it strikes is left
   * in {@link struck}, and the face's normal in {@link faceNormal}.
   */
  private strike(across: number, down: number): number {
    const [a, b, c, d] = cornerPoints as [Vector3, Vector3, Vector3, Vector3]
    this.cornerAt(across, down, a)
    this.cornerAt(across, down + 1, b)
    this.cornerAt(across + 1, down, c)
    this.cornerAt(across + 1, down + 1, d)
    let found = -1
    let best = Infinity
    const faces: readonly (readonly [Vector3, Vector3, Vector3])[] = [
      [a, b, c],
      [c, b, d],
    ]
    for (let face = 0; face < 2; face++) {
      const [p, q, r] = faces[face]!
      if (!ray.intersectTriangle(p, q, r, false, nearer)) continue
      const along = nearer.distanceToSquared(ray.origin)
      if (along >= best) continue
      best = along
      found = face
      struck.copy(nearer)
      faceNormal.crossVectors(edgeA.subVectors(r, q), edgeB.subVectors(p, q)).normalize()
    }
    return found
  }
}

/**
 * Mercator's stretch at a place, from how far north it is as an angle: what a
 * real metre is worth in the world's own units there.
 *
 * One over the cosine of the latitude, which on Mercator's own northing is the
 * hyperbolic cosine of that northing over the Earth's radius — so neither a
 * latitude nor a trigonometric function is ever worked out on the card. The
 * same number `metersPerUnit` divides by, row by row, as the processor used to.
 */
function stretchAt(angle: Node<'float'>): Node<'float'> {
  return angle.exp().add(angle.negate().exp()).mul(0.5) as Node<'float'>
}
