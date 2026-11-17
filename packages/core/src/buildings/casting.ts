import {
  BackSide,
  Box3,
  FrontSide,
  Matrix3,
  Matrix4,
  Ray,
  Triangle,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Intersection,
  type Material,
  type Mesh,
  type Raycaster,
} from 'three/webgpu'
import { BATCH_ID, BUILDING_SLOTS } from './attributes.js'
import { atRest, drawnNow, placingOn, type PlacingState } from './placing.js'
import { facingNow } from './slots.js'
import { notHiddenNow } from './styles.js'
import { hemOf } from './underfoot.js'

/**
 * Answering three's own `Raycaster` where the city is drawn.
 *
 * Whoever holds this library holds three, and the first thing they reach for
 * to ask what lies under a point is
 * `new Raycaster().intersectObject(viewer.buildings.root, true)`. Left alone
 * it answers, and answers wrongly. A tile keeps its buildings as the survey
 * drew them, each with its lowest corner at a nought of its own, and every
 * step that puts one where it is drawn is taken in the vertex stage — see
 * `placing.ts`. So the triangles three tests are not the triangles on the
 * screen: the answer is out by the height of the hill the building stands on,
 * by whatever of it is still coming up out of the ground, and by whatever a
 * page has asked of it. Silently out, which is the worst of it: a point comes
 * back and reads like a point, with nothing on it to say that it is some other
 * building a few hundred metres off.
 *
 * So rather than a question of our own, the standard brick is made to fit:
 * each tile mesh is handed a `raycast` of its own. three-mesh-bvh does the
 * same thing one storey up, replacing `Mesh.prototype.raycast` for every mesh
 * in the page; here it is per mesh, since the three in the page is the page's
 * and not ours to reach into (CLAUDE.md's tenth contract).
 *
 * What makes it cheap is that the displacement is one number for a whole
 * building rather than one per corner: every corner of a building carries the
 * same ground under its foot, the same pair saying how it comes and goes, and
 * the same row of the motion table. So the whole of it is affine, and the ray
 * can be carried into the space the survey drew that one building in, put to
 * that one building's faces, and the place it struck carried back out. The
 * other way round — displacing every corner of every tile on screen, once a
 * click — is the work the card does in a frame, done on the main thread.
 *
 * Carrying the ray costs less than letting three walk, not more, because the
 * box it is then put to throws nearly every building away before a single face
 * is tested. Measured over 中野 at z18, 11 tiles, 5,351 buildings and 234,310
 * faces: 0.68ms a cast against three's own 7.8ms, and 27ms once for the
 * reading below.
 *
 * Put beside the layer's own look under the pointer, over 19 pixels of the
 * same view with the land 36 to 40m up, it names the same building every time
 * and lands within a centimetre of it. Left to three, one of the 19 found
 * nothing at all, twelve answered with some other building, and the place came
 * back out by 9 to 291m. Three were right, and were right by accident: a tall
 * tower's wall is an upright plane, so lifting the tower on to its hill leaves
 * that plane where it was and the ray meets it in the same place. Roofs,
 * anything low, and anything a page has moved have no such luck.
 *
 * What is left out is the wave a page sends across the city, for the reason
 * `placing.ts` gives: it is read from where a corner stands on the world, so a
 * building crossed by one is not moved as a piece and there is no one ray to
 * carry in. It is nought wherever no page has sent one, which is every page
 * that has not called `animateAll`.
 *
 * What the walls throw a fragment away by is mirrored here, both halves of it:
 * a building the page has taken out or the mask has cut (`notHiddenNow`), and
 * whatever of one is still below its own ground. The first is one number for
 * the whole building and is asked before the box; the second is not, and is
 * asked of the point that was struck.
 *
 * The third the viewer adds on top — the uncut land, which hides the hem
 * buried in a hillside where the mask has taken the land away — is not
 * mirrored, and is not meant to be. It is read off this frame's canvas and
 * means nothing away from it, so the layer's own look under the pointer stands
 * it down too: `pick.ts` draws through `Underground.standDown`, and what that
 * gives up is written out there — "a pointer that finds one". A ray cast at
 * the city finds the same hem the pointer does.
 *
 * The fold lines round a building are its children and are not answered for.
 * They stand on three's own `PICTURE_ONLY` layer, which a plain `Raycaster`
 * does not test, and the building itself is the better answer for a click on
 * it in any case; see `notPicked`.
 *
 * A box round the city cannot be put right the same way. See `raiseBall` in
 * `underfoot.ts`, where what the geometry's own bounds mean is already set
 * down.
 */

/**
 * Lets a plain `Raycaster` find one building tile where it is drawn.
 *
 * Handed to every building mesh as its tile lands, beside the attributes it is
 * given there. Nothing is read off the mesh here: the reading waits for the
 * first ray, so a page that never casts one pays nothing for this.
 */
export function answersRays(mesh: Mesh): void {
  mesh.raycast = castAtBuildings
}

function castAtBuildings(this: Mesh, raycaster: Raycaster, hits: Intersection[]): void {
  const read = bricksOf(this)
  const index = this.geometry.index
  if (!read || !index) return
  const { faces, bricks } = read
  // Every tile in the city wears the one material, so there is never an array
  // of them here and never a group to choose one by; see CLAUDE.md's first
  // trap for why that material is shared.
  const material = this.material as Material
  const facings = this.geometry.attributes['normal']
  const slots = this.geometry.attributes[BUILDING_SLOTS]
  // How far under its own nought each building's walls are carried, for the
  // test below; the hem is on purpose and is drawn, so it must not be read as
  // being under the ground. See `hemBelow`.
  const hems = hemOf(this)
  const uv = this.geometry.attributes['uv']
  const uv1 = this.geometry.attributes['uv1']

  this.updateWorldMatrix(true, false)
  // The ray in the metres the mesh is drawn in, which is where the card has
  // the buildings and not where the geometry does
  INTO_MESH.copy(this.matrixWorld).invert()
  DRAWN.copy(raycaster.ray).applyMatrix4(INTO_MESH)

  for (const [building, brick] of bricks) {
    // A building the page has taken out, or one the mask's edge runs through:
    // the walls throw away every fragment of it, so there is nothing of it on
    // the screen to be struck. The one bit answers for both reasons; see
    // `Buildings.notDrawn`.
    if (slots && !notHiddenNow(slots.getY(brick.corner))) continue

    const by = placingOn(this, building, brick.corner, PLACING)
    // The ray, back in the space the survey drew this one building in.
    //
    // Where it points is taken as the difference between two places on it
    // rather than by a matrix of its own: what carries a place back is affine,
    // and `placing.ts` is the one place that knows how it is put together. It
    // is not made a unit again on the way in, and must not be — a row that
    // grows a building would scale it, and both `intersectsBox` and
    // `intersectTriangle` answer the same whatever its length. How far off the
    // hit lies is measured out in the world, off the place that was struck.
    atRest(by, DRAWN.origin.x, DRAWN.origin.y, DRAWN.origin.z, REST.origin)
    atRest(
      by,
      DRAWN.origin.x + DRAWN.direction.x,
      DRAWN.origin.y + DRAWN.direction.y,
      DRAWN.origin.z + DRAWN.direction.z,
      AHEAD,
    )
    REST.direction.copy(AHEAD).sub(REST.origin)
    // The box is the building's own and exact, which is why nothing here leans
    // on the ball three would have tested: that one is lifted by the land
    // under the tile and by nothing else, so it says nothing about a building
    // still underground or one a page has thrown into the air.
    if (!REST.intersectsBox(brick.box)) continue
    // Which way the row turns this building's faces. Not the corner of the
    // matrix that moves its corners; see {@link facingNow}.
    facingNow(by.slot, TURN)

    const end = brick.at + brick.count
    for (let f = brick.at; f < end; f++) {
      const triangle = faces[f] ?? 0
      const corner = triangle * 3
      const a = index.getX(corner)
      const b = index.getX(corner + 1)
      const c = index.getX(corner + 2)
      this.getVertexPosition(a, A)
      this.getVertexPosition(b, B)
      this.getVertexPosition(c, C)
      if (!struck(REST, A, B, C, material, POINT)) continue
      // Whatever of the building is still below the ground it stands on is
      // thrown away by the walls, so there is nothing of it on screen to be
      // struck either. Read here rather than per building, because this is the
      // one half of that test which is not one number for the whole of it: a
      // tile on its way is sunk by its own height, so the roof is above its
      // ground while the ground floor is not, and which it is depends on the
      // corner. The same sum the walls read — a corner's own y, plus the hem
      // carried below its nought on purpose, less how far it is still down.
      // Nought once the tile has arrived, which is every tile but the ones
      // coming or going.
      if (POINT.y + (hems?.[building] ?? 0) - by.under < 0) continue

      // And the place it struck forward again through the very three the
      // shader does, so what is handed back is where the pointer is pointing
      drawnNow(by, POINT.x, POINT.y, POINT.z, WORLD).applyMatrix4(this.matrixWorld)
      const distance = raycaster.ray.origin.distanceTo(WORLD)
      if (distance < raycaster.near || distance > raycaster.far) continue

      // Everything from here on is three's own reading of a face it has hit,
      // and is made rather than held: a cast finds a handful of faces where it
      // walks thousands, and what it finds is handed to the page to keep.
      const barycoord = new Vector3()
      Triangle.getBarycoord(POINT, A, B, C, barycoord)
      const normal = new Vector3()
      Triangle.getNormal(A, B, C, normal)
      normal.applyMatrix3(TURN).normalize()
      const hit: Intersection = {
        distance,
        point: WORLD.clone(),
        object: this,
        faceIndex: triangle,
        face: { a, b, c, normal, materialIndex: 0 },
        barycoord,
      }
      if (uv) hit.uv = Triangle.getInterpolatedAttribute(uv, a, b, c, barycoord, new Vector2())
      if (uv1) hit.uv1 = Triangle.getInterpolatedAttribute(uv1, a, b, c, barycoord, new Vector2())
      if (facings) {
        const looks = Triangle.getInterpolatedAttribute(facings, a, b, c, barycoord, new Vector3())
        looks.applyMatrix3(TURN)
        // Turned toward whoever asked, as three turns it: the survey draws its
        // normals whichever way round it likes, and a face the ray reached is
        // a face the ray is looking at
        if (looks.dot(DRAWN.direction) > 0) looks.multiplyScalar(-1)
        hit.normal = looks
      }
      hits.push(hit)
    }
  }
}

/**
 * Where a ray meets one face, judged by the side the material draws.
 *
 * three's own test, in a shape that can be handed a ray of ours. Which side of
 * a face counts is the material's business and is asked rather than assumed,
 * so that the pointer finds what the card draws and goes through what it
 * culls.
 */
function struck(ray: Ray, a: Vector3, b: Vector3, c: Vector3, material: Material, into: Vector3): boolean {
  if (material.side === BackSide) return ray.intersectTriangle(c, b, a, true, into) !== null
  return ray.intersectTriangle(a, b, c, material.side === FrontSide, into) !== null
}

/** Where a mesh keeps its buildings as a ray wants them. */
const BRICKS = 'plateauBricks'

/** One building of a mesh, as a ray wants it. */
interface Brick {
  /**
   * Any corner of it, which is where what is being done to it is read; see
   * {@link placingOn}.
   */
  readonly corner: number
  /**
   * Where its faces lie in {@link Bricks.faces}: the first of them, and how
   * many. Both are settled while the shape is read and left alone after.
   */
  at: number
  count: number
  /** The box round it as the survey drew it, in the mesh's own metres. */
  readonly box: Box3
}

interface Bricks {
  /** The shape they were read from; see {@link bricksOf}. */
  readonly from: BufferGeometry
  readonly bricks: ReadonlyMap<number, Brick>
  /**
   * Every face of the mesh by its triangle number, one building's together, so
   * that a building's own are a run.
   */
  readonly faces: Uint32Array
}

/**
 * A mesh's buildings as a ray wants them, read the once and kept beside its
 * other readings.
 *
 * Kept against the shape rather than against the mesh, as the walls are: a
 * tile whose corners are cut again — windows set into its walls, a rim carved
 * round its roofs — comes back as another shape on the same mesh. Unlike the
 * walls, this is not then the same reading twice over: the faces are the whole
 * of what is kept here, and carving takes some away and puts others on.
 *
 * Read on the first ray and not as the tile lands. It is two walks over a tile
 * that runs to tens of thousands of corners, and a page that never casts one
 * should not pay them.
 */
function bricksOf(mesh: Mesh): Bricks | undefined {
  const kept = mesh.userData[BRICKS] as Bricks | undefined
  if (kept?.from === mesh.geometry) return kept
  const read = readBricks(mesh.geometry)
  if (read) mesh.userData[BRICKS] = read
  return read
}

function readBricks(geometry: BufferGeometry): Bricks | undefined {
  const position = geometry.attributes['position']
  const batch = geometry.attributes[BATCH_ID]
  const index = geometry.index
  if (!position || !batch || !index) return undefined

  // A corner apiece to read what is being done to the building by, and the box
  // the ray is put to before any of its faces are
  const bricks = new Map<number, Brick>()
  for (let v = 0; v < position.count; v++) {
    const building = batch.getX(v)
    let brick = bricks.get(building)
    if (!brick) {
      brick = { corner: v, at: 0, count: 0, box: new Box3() }
      bricks.set(building, brick)
    }
    brick.box.expandByPoint(AT.set(position.getX(v), position.getY(v), position.getZ(v)))
  }

  // Whose each face is, gathered so that a building's are a run. They are not
  // one already as the mesh stands: carving a parapet drops the roof faces out
  // of the middle of the list and puts the rim's on the end, so a tower owns
  // faces at both ends of it (see `carveRoofs`). Measured over 中野 at z18,
  // every tile of the eleven was broken that way — 1,123 buildings lying in
  // 1,822 runs on the largest of them, half again as many runs as buildings
  // throughout. Setting windows leaves the order alone, and either way this is
  // read afresh from the shape that comes out.
  const triangles = Math.floor(index.count / 3)
  for (let t = 0; t < triangles; t++) bump(bricks, batch.getX(index.getX(t * 3)))
  // Each run's end goes in first and the runs are then filled backwards, so
  // what is left in `at` when the walk is done is where the run begins. A
  // cursor of its own would be a second number a building carries for the
  // length of its tile and is read for the length of one walk.
  let end = 0
  for (const brick of bricks.values()) {
    end += brick.count
    brick.at = end
  }
  const faces = new Uint32Array(end)
  for (let t = triangles - 1; t >= 0; t--) {
    const brick = bricks.get(batch.getX(index.getX(t * 3)))
    if (brick) faces[--brick.at] = t
  }
  return { from: geometry, bricks, faces }
}

/**
 * Counts one more face for a building.
 *
 * A face is taken to be whole of one building, by the first of its three
 * corners: a building is a closed solid of its own, and no face of the survey
 * reaches from one to the next. Measured over 中野 at z18, where not one of
 * 234,310 faces had its three corners saying different buildings.
 */
function bump(bricks: ReadonlyMap<number, Brick>, building: number): void {
  const brick = bricks.get(building)
  if (brick) brick.count++
}

/** Held between casts: a ray is carried into a mesh and let go. */
const INTO_MESH = new Matrix4()
const DRAWN = new Ray()
const REST = new Ray()
const AHEAD = new Vector3()
/** Held between faces: the three corners of one, and where the ray met them. */
const A = new Vector3()
const B = new Vector3()
const C = new Vector3()
const POINT = new Vector3()
const WORLD = new Vector3()
/** Held, since one is wanted per building of a cast and none of them is kept. */
const TURN = new Matrix3()
const PLACING: PlacingState = { under: 0, slot: 0, underfoot: 0 }
/** Held while a shape is read: a corner is put to a box and thrown away. */
const AT = new Vector3()
