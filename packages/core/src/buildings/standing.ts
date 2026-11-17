import { Vector3, type BufferAttribute, type BufferGeometry, type Mesh } from 'three/webgpu'
import { APPEAR } from '../appear.js'
import type { BuildingSeat } from '../onBuildings.js'
import { BUILDING_FACTS, type BuildingFacts } from './tileContent.js'
import { BATCH_ID, BUILDING_SLOTS } from './attributes.js'
import { footOf, fromFoot, offsetFromFoot, type Foot } from './foot.js'
import { atRest, drawnNow, placingOn, type PlacingState } from './placing.js'
import { storeysOf } from './storeys.js'
import { underfootOf } from './underfoot.js'
import { planWalls, type Wall, type WallPlan } from './wallPlan.js'

/** What is read off a mesh once for a building and kept, since none of it moves. */
interface Read {
  /** Any corner of the building, to read what its corners carry. */
  readonly corner: number
  /** How high its highest corner reaches over the ground it stands on, in metres. */
  readonly top: number
}

/** Where a place is taken back into a tile's own metres. Held, since it is asked per click. */
const HERE = new Vector3()

/** A step towards the camera, and the wall's middle and a step out of it as drawn; see {@link facingAt}. */
const AHEAD = new Vector3()
const DRAWN_HERE = new Vector3()
const DRAWN_OUT = new Vector3()

/** Where a mesh keeps what has been read off it for each of its buildings. */
const READ = 'plateauStanding'

/**
 * A corner of the building and how high it reaches, read the once.
 *
 * Kept on the mesh beside its other readings. A parapet carved into a roof
 * adds corners and moves none, so what is kept holds: the highest corner of a
 * building is the highest whether or not a rim was cut into its roof.
 */
function readOf(mesh: Mesh, building: number): Read | null {
  const kept = (mesh.userData[READ] ??= new Map<number, Read | null>()) as Map<number, Read | null>
  const known = kept.get(building)
  if (known !== undefined) return known

  const positions = mesh.geometry.attributes['position']
  const batch = mesh.geometry.attributes[BATCH_ID]
  let found: Read | null = null
  if (positions && batch) {
    let corner = -1
    let top = -Infinity
    for (let v = 0; v < batch.count; v++) {
      if (batch.getX(v) !== building) continue
      if (corner < 0) corner = v
      const y = positions.getY(v)
      if (y > top) top = y
    }
    if (corner >= 0) found = { corner, top }
  }
  kept.set(building, found)
  return found
}

/**
 * How high a building's highest corner reaches over the ground it stands on,
 * in metres, or nothing where the mesh holds no such building.
 */
export function topOf(mesh: Mesh, building: number): number | null {
  return readOf(mesh, building)?.top ?? null
}

/**
 * How high a building reaches over the ground it stands on, and how many
 * storeys it is drawn in, or nothing where the mesh holds no such building.
 *
 * The count the survey gives where the shape can bear it, and the height over a
 * storey where it cannot — {@link storeysOf}, which the windows are cut by the
 * same rule. What is divided is not quite the same, though: the windows are set
 * out under the roof they were given, and this measures to the highest corner
 * there is. Where something small stands on a roof the two part by its height,
 * which is a row of glass near the top.
 *
 * Everything that paints a storey, or reads one back off a place, divides
 * this — a band of colour, a click — so the two agree with one another
 * whether or not they agree with the glass.
 */
export function storeysOn(
  mesh: Mesh,
  building: number,
  storeyHeight: number,
): { top: number; storeys: number } | null {
  const read = readOf(mesh, building)
  if (!read) return null
  const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
  return { top: read.top, storeys: storeysOf(read.top, facts?.storeys[building] ?? 0, storeyHeight) }
}

/**
 * Which storey a place found on one building falls in, counted from 1 as 1階
 * is, or nothing where the mesh holds no such building.
 *
 * `point` is where a look under the pointer found the building, in the
 * world's own units, and everything between that and a storey is here, since
 * this is where the reverse trip already lives.
 *
 * The trip is short because of how a building is built: its corners carry how
 * high they stand over the ground it was seated on, and the ground under it is
 * added last of all. So the point is taken into the mesh's own metres and that
 * ground taken away, which gives a corner's own y back.
 *
 * The point and not the height a click hands back: that height is counted from
 * the land under the place (`Position.height`), which on a hill is most of the
 * ground taken away here, and taken away twice it put every click on a hill
 * on the first storey.
 *
 * Except by what has happened to the building since. Its arrival is put back —
 * a building still coming up is drawn below where it belongs, and left alone
 * that reads as a lower floor for the second or so it takes. A motion the page
 * started is not: that one the page asked for, and a building it has laid on
 * its side has no storey to speak of anyway. What comes back is then the storey
 * of the building as it stands.
 *
 * Everything from just over one ceiling up to the next answers with the storey
 * between them, which is the storey a band told that number runs round
 * (`FloorStyle.at`). Below the ground
 * it stands on — a wall carried down a slope — is the first, and the highest
 * corner the last. What that division is, and where it parts from the rows of
 * glass, is said at {@link storeysOn}.
 */
export function storeyAt(mesh: Mesh, building: number, point: Vector3, storeyHeight: number): number | null {
  const read = readOf(mesh, building)
  if (!read) return null
  const { top } = read
  if (top <= 0) return 1
  const storeys = storeysOn(mesh, building, storeyHeight)?.storeys ?? 1

  // Two of the three the shader does, since a height on its own cannot be
  // un-turned: a building a motion has tipped would want the whole place back
  // before it could be measured up its own wall. See `placing.ts`.
  mesh.updateWorldMatrix(true, false)
  const here = mesh.worldToLocal(BACK_HERE.copy(point))
  const by = placingOn(mesh, building, read.corner, PLACING)
  const over = here.y - by.underfoot + by.under

  const floor = top / storeys
  return Math.min(Math.max(Math.ceil(over / floor), 1), storeys)
}

/**
 * Where a point the card drew on a building stands with the building at rest,
 * in the world: what a click hands back.
 *
 * What comes off the screen is where the building is *this frame* -- sunk by
 * however much of it is still under the ground, moved by whatever row it
 * reads -- and what is worth keeping is where it is on the building, so both
 * are taken off. Keep the answer and the thing goes back to the same brick
 * after the block has finished rising. `into` is written and handed back.
 */
export function pointAtRest(mesh: Mesh, building: number, point: Vector3, into: Vector3): Vector3 | null {
  const read = readOf(mesh, building)
  if (!read) return null
  // Out of the world and into the mesh's own metres, which is where the
  // corners are
  mesh.updateWorldMatrix(true, false)
  const here = mesh.worldToLocal(into.copy(point))
  // Then out of what the shader does per corner, backwards; see `placing.ts`.
  // That takes the ground under the building off too, which the world has, so
  // it goes back on before the point is taken back out
  const by = placingOn(mesh, building, read.corner, PLACING)
  atRest(by, here.x, here.y, here.z, here)
  here.y += by.underfoot
  return mesh.localToWorld(here)
}

/** Held between clicks: a point is read into the building's own metres and let go. */
const BACK_HERE = new Vector3()
/** Held, since what is being done to a building is asked per click and never kept. */
const PLACING: PlacingState = { under: 0, slot: 0, underfoot: 0 }

/**
 * How far out of the middle of a foot its wall stands, along the way that wall
 * looks — the wall's own plane, where one of this building looks that way.
 *
 * The foot's reach was standing in for this and stands too far out. What it
 * gives is the furthest corner along the direction, and the plane through that
 * corner touches the building there and nowhere else: let the wall stand a
 * few degrees off the way asked, or let the foot be an L, and a picture
 * centred there is centred off the wall. Measured on a square twenty metres
 * across asked for at forty-five degrees to it: four metres of air.
 *
 * The walls are read off the corners as the survey drew them, so this is the
 * wall where the building stands still — which it does until a page moves it,
 * and a page that moves one moves what is on it by the same row.
 *
 * Nothing comes back where no wall of this building looks near enough that
 * way, or where its plane lies behind the middle of the foot: the survey draws
 * its normals whichever way round it likes, and a wall pointing inward would
 * otherwise pull a picture centred on it through the building.
 */
function outTo(mesh: Mesh, building: number, foot: Foot, dx: number, dz: number): number | null {
  const plan = wallsOf(mesh)
  if (!plan) return null
  // The furthest of the walls that look that way, which is the one on the
  // outside: a building with a notch in it has an inner wall looking the same
  // way as the outer one, and a picture centred on the inner one is centred
  // inside the building.
  let furthest: number | null = null
  for (const wall of plan.walls) {
    if (wall.building !== building) continue
    const towards = wall.normalX * dx + wall.normalZ * dz
    if (towards < SQUARE_ON) continue
    // How far along the way asked, not along the wall's own normal: the two are
    // near enough to be the same wall and not near enough to be the same
    // number, and going the normal's distance along a bearing a few degrees off
    // it stops short of the plane -- which puts the picture's middle inside the wall
    const out = (wall.plane - (foot.x * wall.normalX + foot.z * wall.normalZ)) / towards
    if (out > 0 && (furthest === null || out > furthest)) furthest = out
  }
  return furthest
}

/**
 * How far out of the middle of a foot the wall a spot is on stands, along the
 * way asked: the outermost wall looking that way that both the spot's height
 * and its place across the face fall on.
 *
 * Two walls look the same way where a storey is set back over the one below,
 * and where a courtyard opens between two wings. The set-back wall is there at
 * heights the lower one is not, and the back of the courtyard across the gap
 * the wings are not, so the outermost one the spot is on is the one seen from
 * in front of it: the one a click lands on, and the one a page means.
 *
 * Measured where the line out through the spot crosses each wall, and not by
 * which way the survey's normal points: it draws them whichever way round it
 * likes, and the crossing furthest out is the outside of the building whatever
 * way they point. Nothing where no wall of the building is on the spot.
 */
function wallAt(
  mesh: Mesh,
  building: number,
  foot: Foot,
  outX: number,
  outZ: number,
  y: number,
): number | null {
  const plan = wallsOf(mesh)
  if (!plan) return null
  const fromX = foot.x
  const fromZ = foot.z
  let furthest: number | null = null
  for (const wall of plan.walls) {
    if (wall.building !== building) continue
    if (y < wall.low - PAST_THE_END || y > wall.high + PAST_THE_END) continue
    const towards = wall.normalX * outX + wall.normalZ * outZ
    if (Math.abs(towards) < SQUARE_ON) continue
    const out = (wall.plane - (fromX * wall.normalX + fromZ * wall.normalZ)) / towards
    if (!(out > 0) || (furthest !== null && out <= furthest)) continue
    const across = (fromX + outX * out) * wall.alongX + (fromZ + outZ * out) * wall.alongZ - wall.start
    if (across < -PAST_THE_END || across > wall.width + PAST_THE_END) continue
    furthest = out
  }
  return furthest
}

/**
 * How squarely a wall must look north to be the north wall a wall picture
 * given no place is centred on (`northWall`): within fifteen degrees.
 *
 * Wider than this and a building whose walls all stand at an angle to north
 * answers with whichever is least wrong, and the picture is centred on a wall
 * nobody would call the north one. Nothing answering is not a failure -- the
 * foot's own reach stands in.
 */
const SQUARE_ON = Math.cos((15 * Math.PI) / 180)

/**
 * Where a wall picture given no place has its middle, in the mesh's own
 * metres, and which way out that wall looks — or nothing where the mesh holds
 * no such building.
 *
 * Across the middle of the wall looking north, halfway up the building: what a
 * rule's picture gets, since a rule paints many buildings and a place on the
 * map is one building's (`SharedStyle`). The outermost wall looking that way
 * the height falls on; failing that, the outermost plane looking that way;
 * failing that, the foot's own reach.
 */
export function northWall(
  mesh: Mesh,
  building: number,
): { x: number; y: number; z: number; outX: number; outZ: number } | null {
  const read = readOf(mesh, building)
  const foot = footOf(mesh, building)
  if (!read || !foot) return null
  // North is where z is least
  const outX = 0
  const outZ = -1
  const y = read.top / 2
  const face =
    wallAt(mesh, building, foot, outX, outZ, y) ??
    outTo(mesh, building, foot, outX, outZ) ??
    foot.reach(outX, outZ, 1, 1)
  return { x: foot.x + outX * face, y, z: foot.z + outZ * face, outX, outZ }
}

/**
 * The wall of one building a place lies on, in the mesh's own metres: the
 * place put on its plane, and which way the wall looks — or nothing where the
 * building has no walls to ask.
 *
 * Found by the place, not by a bearing. A place a click handed back lies on
 * the very wall it hit, to a rounding error, so the nearest wall is that wall
 * — the inside of an L as well as the outside, where a bearing asked for
 * "the wall looking east" answers with whichever of two it meets first. A
 * place a page wrote by hand and a little off its wall goes to the nearest.
 * Measured in three dimensions where the place says a height: a tower set back
 * over a podium has two walls looking one way, and the height says which.
 *
 * Which way the wall looks comes back as the survey stored it, either way
 * round; what reads it (`aroundBox`) asks only which side of the box it is
 * nearer square to, and that is the same answer for both.
 */
export function wallUnder(
  mesh: Mesh,
  building: number,
  x: number,
  y: number | undefined,
  z: number,
): { x: number; z: number; outX: number; outZ: number } | null {
  const plan = wallsOf(mesh)
  if (!plan) return null
  let found: Wall | undefined
  let nearest = Infinity
  for (const wall of plan.walls) {
    if (wall.building !== building) continue
    const off = x * wall.normalX + z * wall.normalZ - wall.plane
    const along = x * wall.alongX + z * wall.alongZ - wall.start
    const pastEnd = along < 0 ? -along : along > wall.width ? along - wall.width : 0
    const pastTop = y === undefined ? 0 : y < wall.low ? wall.low - y : y > wall.high ? y - wall.high : 0
    const away = off * off + pastEnd * pastEnd + pastTop * pastTop
    if (away >= nearest) continue
    nearest = away
    found = wall
  }
  if (!found) return null
  const off = x * found.normalX + z * found.normalZ - found.plane
  return { x: x - found.normalX * off, z: z - found.normalZ * off, outX: found.normalX, outZ: found.normalZ }
}

/**
 * Where a thing held to one building stands, in the terms the shader moves a
 * building by, or nothing where the mesh holds no such building: the middle of
 * the building's foot, on the ground it stands on, moved by `offset` metres
 * east, north and up. See `Anchor`.
 *
 * Worked out in the mesh's own metres — the frame the building was surveyed
 * in, which a page standing it elsewhere moves and turns, so east and north
 * turn with it — and only then taken into the world through the mesh's
 * matrix. So nothing of it is a spot on the map, and a building stood
 * somewhere else takes it along. Everything but the place comes off the
 * building ({@link seatFrame}), so it comes up out of the ground and goes where
 * a motion sends it as the building does.
 */
export function seatOnAnchor(
  mesh: Mesh,
  building: number,
  offset: readonly [number, number, number] | undefined,
): BuildingSeat | null {
  const read = readOf(mesh, building)
  const foot = footOf(mesh, building)
  if (!read || !foot) return null
  const place = fromFoot(foot, offset)
  ANCHORED.set(place.x, place.y, place.z)
  mesh.updateWorldMatrix(true, false)
  const frame = seatFrame(mesh, building, read)
  const world = mesh.localToWorld(ANCHORED)
  // The ground under the building is the shader's to put on, after the row,
  // so it stays out of the place as it stays out of the corners
  return {
    ...frame,
    x: (world.x - frame.originX) / frame.stretch,
    y: (world.y - frame.originY) / frame.stretch,
    z: (world.z - frame.originZ) / frame.stretch,
  }
}

/** Held, since a place on a building is worked out per mark per frame and never kept. */
const ANCHORED = new Vector3()

/**
 * How far a place found on one building is from the middle of its foot:
 * metres east, north and up as the building was surveyed — the `offset` of
 * the `Anchor` a click hands back, which leads back to the click. Nothing where
 * the mesh holds no such building.
 *
 * Taken back out of what the shader does to the building first, as
 * {@link pointAtRest} takes it, so a click on a building still coming up or
 * set moving answers where on the building it landed.
 */
export function offsetOnBuilding(
  mesh: Mesh,
  building: number,
  point: Vector3,
): [number, number, number] | null {
  const read = readOf(mesh, building)
  const foot = footOf(mesh, building)
  if (!read || !foot) return null
  mesh.updateWorldMatrix(true, false)
  const here = mesh.worldToLocal(BACK_HERE.copy(point))
  // Back out of the shader's three steps, the ground under the building with
  // them, which is what a height on the building is counted from
  atRest(placingOn(mesh, building, read.corner, PLACING), here.x, here.y, here.z, here)
  return offsetFromFoot(foot, here.x, here.y, here.z)
}

/**
 * Everything of a seat on one building but the place: where its tile stands
 * and how it is stretched, the ground under the building, and the row and the
 * coming and going its corners carry.
 *
 * Everything but the place comes off the building's own corners: a thing on
 * the building has to carry what they carry or it will not keep step with it.
 * The tile's place and stretch come off the mesh's world matrix, which is the
 * one the buildings themselves are drawn through.
 */
function seatFrame(mesh: Mesh, building: number, read: Read): Omit<BuildingSeat, 'x' | 'y' | 'z'> {
  const slots = mesh.geometry.attributes[BUILDING_SLOTS] as BufferAttribute | undefined
  const appear = mesh.geometry.attributes[APPEAR] as BufferAttribute | undefined
  mesh.updateWorldMatrix(true, false)
  const m = mesh.matrixWorld.elements
  return {
    originX: m[12] ?? 0,
    originY: m[13] ?? 0,
    originZ: m[14] ?? 0,
    stretch: Math.hypot(m[0] ?? 1, m[1] ?? 0, m[2] ?? 0) || 1,
    underfoot: underfootOf(mesh)?.[building] ?? 0,
    // The same row the building's corners read and the same coming and going.
    // A corner is moved by the row and turned by its group afterwards, while
    // a seat is moved by the row in the turned frame (see `annotations/mesh.ts`),
    // so a building that is both turned and moved splits from it by however
    // far the turn and the motion fail to commute. Exact wherever the building
    // stands still — row 0 is no move at all.
    // The motion row is the fourth of the four a corner carries; see {@link BUILDING_SLOTS}
    slot: slots ? ((slots.array as Float32Array)[read.corner * 4 + 3] ?? 0) : 0,
    appearAt: appear ? appear.getX(read.corner) : 0,
    appearBy: appear ? appear.getY(read.corner) : 0,
  }
}

/**
 * How far off a wall's own plane a place may lie and still be taken as being
 * on it, in metres.
 *
 * A click lands on the face itself, so this has nothing to swallow but the
 * arithmetic that took the pixel back into the world and the mesh back into
 * its tile. It is kept under a metre so that a place on a roof, which is a
 * metre or more inside the walls under it everywhere but at its very rim,
 * cannot be taken for one of them.
 */
const ON_THE_WALL = 0.6
/**
 * How far past a wall's ends a place may lie and still be on it, in metres.
 * A wall is cut where its pieces stand apart (see `wallPlan.ts`), so the room
 * here is for the arithmetic and not for a gap.
 */
const PAST_THE_END = 0.5

/** Where a mesh keeps the walls read off it, and which corners they were read from. */
const WALLS = 'plateauWalls'

/** The walls of a mesh, read the once and kept beside its other readings. */
function wallsOf(mesh: Mesh): WallPlan | undefined {
  const kept = mesh.userData[WALLS] as { from: BufferGeometry; plan: WallPlan | undefined } | undefined
  // Kept against the shape rather than the mesh: a tile whose corners are cut
  // again — windows set into the walls, a rim carved round the roof — comes
  // back as another shape on the same mesh, and the walls are read from it
  // afresh. They come out the same, since neither moves a wall; what this
  // guards is the reading being made against corners that are no longer there.
  if (kept && kept.from === mesh.geometry) return kept.plan
  const plan = planWalls(mesh.geometry)
  mesh.userData[WALLS] = { from: mesh.geometry, plan }
  return plan
}

/**
 * Which way the face at a place on a building looks: degrees, 0 north, as
 * {@link Camera.heading} is — or nothing where the place is on no upright
 * face, which is to say on a roof.
 *
 * The bearing in the world, with whatever turned the building — a page
 * standing it somewhere, a motion under way — put on it: what a page aims a
 * thing by.
 *
 * The place is in world coordinates, as a click gives it. It is taken back
 * into the tile's own metres, where the walls were read, and the wall it lies
 * on is the one whose plane it is on and whose ends it is between.
 *
 * `towards` is where the camera stands, as a direction out of the screen. It
 * is what settles which side of the wall is the outside: the survey draws its
 * normals whichever way round it likes — `wallPlan.ts` takes the stored ones
 * as the outside and some tiles have them facing in — and a wall the pointer
 * found is one the camera can see, so the side the camera is on is the face.
 * Measured rather than trusted, which is the same answer a pass that read the
 * normal off the picture would give and costs nothing to ask here.
 *
 * The walls were read off the corners as the survey drew them, and a motion
 * moves them in the shader afterwards, so the place is taken back out of the
 * motion first — as {@link pointAtRest} takes it — and asked of the walls
 * where the survey has them. Asked of the walls where the motion had put
 * them, a building a page had moved or grown answered with no wall at all,
 * and its walls were clicked as its roof.
 */
export function facingAt(
  mesh: Mesh,
  building: number,
  place: Vector3,
  towards: Vector3 | null,
): number | undefined {
  const plan = wallsOf(mesh)
  if (!plan) return undefined
  mesh.updateWorldMatrix(true, false)
  const here = mesh.worldToLocal(HERE.copy(place))
  const read = readOf(mesh, building)
  const placing = read ? placingOn(mesh, building, read.corner, PLACING) : null
  if (placing) atRest(placing, here.x, here.y, here.z, here)

  let found: Wall | undefined
  let nearest = ON_THE_WALL
  for (const wall of plan.walls) {
    if (wall.building !== building) continue
    const off = Math.abs(here.x * wall.normalX + here.z * wall.normalZ - wall.plane)
    if (off >= nearest) continue
    const along = here.x * wall.alongX + here.z * wall.alongZ - wall.start
    if (along < -PAST_THE_END || along > wall.width + PAST_THE_END) continue
    nearest = off
    found = wall
  }
  if (!found) return undefined

  let outX = found.normalX
  let outZ = found.normalZ
  // Turned to the side the camera is on; see `towards` above. The camera's way
  // is the world's and the wall's is the survey's, so the way is taken back
  // into the survey's frame as the place was — a step towards the camera, put
  // through the same two undoings — before the two are compared. Compared as
  // they stood, a building a page had turned a quarter round had its walls
  // read the wrong side out: the wall facing the camera came back as facing
  // away from it (measured: a tower turned 90°, clicked on its south face from
  // the south, answered 357°).
  if (towards) {
    const ahead = mesh.worldToLocal(AHEAD.copy(place).add(towards))
    if (placing) atRest(placing, ahead.x, ahead.y, ahead.z, ahead)
    if (outX * (ahead.x - here.x) + outZ * (ahead.z - here.z) < 0) {
      outX = -outX
      outZ = -outZ
    }
  }
  // And back out into the world the same way round: the step out of the
  // wall put through the motion and the tile, so whatever turned the building
  // — a page standing it somewhere, or a motion under way — is on the answer.
  const at = placing ? drawnNow(placing, here.x, here.y, here.z, DRAWN_HERE) : DRAWN_HERE.copy(here)
  const out = placing
    ? drawnNow(placing, here.x + outX, here.y, here.z + outZ, DRAWN_OUT)
    : DRAWN_OUT.set(here.x + outX, here.y, here.z + outZ)
  mesh.localToWorld(at)
  mesh.localToWorld(out)
  return bearingOf(out.x - at.x, out.z - at.z)
}

/**
 * A level direction as a bearing: degrees, 0 north, clockwise. North is where
 * z is least, so a direction points sin east and minus cos south, and a
 * bearing is read back out of it the same way round.
 */
function bearingOf(x: number, z: number): number {
  const degrees = (Math.atan2(x, -z) * 180) / Math.PI
  return ((degrees % 360) + 360) % 360
}
