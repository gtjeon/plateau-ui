/**
 * Buildings a page names, rather than the city a view happens to cover.
 *
 * The city arrives because it is being looked at: the view says which patches
 * of which cities, and the tiles for those come and go as it moves. A page
 * that wants one building — the tower it is writing about, five of them side
 * by side — wants the opposite: these, wherever the view goes, and nothing
 * else.
 *
 * An id is not enough to find one. PLATEAU's building id carries a city code,
 * but it is the code of the 市 while the dataset is published per 区
 * (27100-bldg-167320 lives in 27119), so nothing in the name says which
 * tileset to open. What does is the place: the boundaries say which city, the
 * catalog gives that city's tileset, and the tree is walked down towards the
 * point. So a page says where its building stands, and that coordinate is
 * spent on finding the tile rather than on drawing anything.
 *
 * Which is also why a building can then be stood somewhere else entirely: what
 * arrives is a tile of a city with one building left in it, and where that
 * tile hangs is the group's business.
 */
import { BufferAttribute, Group, type BufferGeometry, type Mesh } from 'three/webgpu'
import { BATCH_ID, sameWidthAs, type Attribute } from './attributes.js'
import { latToY, lonToX, metersPerUnit, xToLon, yToLat } from '../geo/mercator.js'
import type { BuildingFacts } from './tileContent.js'
import type { BuildingTile } from '../plateau/tileset.js'
import type { BuildingStyle } from './styles.js'

/** Where a building stands and which way it looks. */
export interface BuildingPlace {
  /**
   * Where to stand it, as [longitude, latitude]. Left out, it stands where the
   * survey has it.
   *
   * It stands on the ground under wherever it is put, where the viewer carries
   * the land's heights. The land is read under the place it is moved to and
   * not under the one it was surveyed on: the ground it was measured against
   * is not the ground it has been moved to, and its own height above sea level
   * says nothing about the hill it now stands on.
   *
   * What does not follow it is the hem — the skirt of wall let down below a
   * building's own nought to meet the slope it was surveyed on (see `hem.ts`).
   * That slope belongs to the place, not to the building. A building whose
   * place was known before its tile was shaped was never given one and stands
   * on a level base; one already standing at home when it is moved keeps the
   * skirt cut into its corners, which goes on being drawn below its new ground
   * without measuring anything. See {@link Buildings.place}.
   */
  readonly at?: readonly [number, number]
  /**
   * Which way it looks: degrees, 0 north, as {@link Camera.heading} is.
   *
   * Its front is the way the survey drew it, since nothing in the survey says
   * which side of a building is the front — and the survey draws it on the
   * world's own axes, so a building left at nought both looks north and stands
   * exactly as it was measured. The two are one number here.
   *
   * The same word every other thing with a bearing takes ({@link
   * SolidOptions.facing}, {@link ModelOptions.facing}), and for the same reason: what varies between them is
   * only which way counts as the front, and that is each one's own business to
   * say. Written as `turn` at first, for a building having no front to point —
   * but the number is the same either way, so all that bought was a second
   * spelling of one question.
   */
  readonly facing?: number
}

/** One building a page asks for by name, and where it is to stand. */
export interface BuildingWanted extends BuildingPlace {
  /** What PLATEAU calls it, a gml:id. */
  readonly id: string
  /**
   * Whereabouts in Japan to look for it, as [longitude, latitude].
   *
   * Not where it is drawn — that is {@link BuildingPlace.at}, and a building
   * left where it was surveyed has neither. This is the clue that finds the
   * building's tile: the city is looked up from it, and the tileset is then
   * walked down the one path whose patches cover it.
   *
   * A clue and not an address, so it need only be close enough to fall in the
   * same tile as the building — a hundred metres or so at the foot of the
   * tree. It cannot be left out: a gml:id is a UUID and says nothing about
   * where it is, and PLATEAU publishes no index from one to the other. Every
   * search it does publish runs the other way, from a place to the ids on it.
   */
  readonly findAt: readonly [number, number]
  /**
   * What to paint it, as {@link Buildings.setStyle} takes for one building.
   *
   * Said here rather than called for afterwards because a page holding the
   * building is a page whose file has already landed, and one painted then is
   * one that stood a frame in the city's own colours first. Where it stands
   * and which way it looks are here for the same reason; see
   * {@link BuildingPlace}.
   */
  readonly style?: BuildingStyle
}

/** Whether a tile's patch covers a place. */
export function tileHolds(tile: BuildingTile, [lon, lat]: readonly [number, number]): boolean {
  const radians = Math.PI / 180
  const [west, south, east, north] = tile.region
  return lon * radians >= west && lon * radians <= east && lat * radians >= south && lat * radians <= north
}

/**
 * The child to look in next, going down a tileset towards a place.
 *
 * PLATEAU's tiles refine by replacing: a tile holds the tallest buildings of
 * its patch and its children hold those same ones again with the shorter ones
 * added. So a building is found at whatever depth it first appears — a tower
 * in the root tile, a house several levels down — and looking down one path is
 * enough. Where two children overlap the point, the first will do: both hold
 * everything of the parent that is theirs.
 */
export function deeper(tile: BuildingTile, findAt: readonly [number, number]): BuildingTile | undefined {
  return tile.children.find((child) => tileHolds(child, findAt))
}

/**
 * Which of a tile's meshes holds a building, by the tile's number for it.
 *
 * Not by asking the facts: those are the tile's and name every building of it,
 * while the corners are split between meshes. A mesh that has none of this
 * building's corners would answer the same as the one that has all of them.
 */
function meshHolding(meshes: readonly Mesh[], at: number): Mesh | undefined {
  return meshes.find((mesh) => {
    const batch = mesh.geometry.attributes[BATCH_ID]
    if (!batch) return false
    for (let v = 0; v < batch.count; v++) if (batch.getX(v) === at) return true
    return false
  })
}

/**
 * Leaves one building of a tile standing and throws the rest of the tile away.
 *
 * A tile is fetched for one building and arrives with the district that
 * building stands in — a leaf runs to a couple of megabytes of shapes, of
 * which one thing was asked for. Keeping the rest and not drawing it, the way
 * a page's own hidden buildings are kept, is the cheaper thing to write and
 * the dearer thing to run: every step a tile goes through after this walks
 * whatever corners it is handed, so the windows, the parapets and the lines
 * along the folds would all be worked out for a thousand buildings nobody
 * sees. And the lines do not read what is hidden at all — they are their own
 * material and it carries no such test — so they were drawn, and a page that
 * asked for five towers got the floor plan of four districts with them.
 *
 * So the shapes are cut instead, before anything is laid on the corners. What
 * comes back is what is still worth standing: the mesh that holds the
 * building, cut down to it, or none where the tile names it and draws nothing.
 */
export function leaveOne(meshes: readonly Mesh[], keep: number): Mesh[] {
  const holder = meshHolding(meshes, keep)
  for (const mesh of meshes) {
    if (mesh === holder) continue
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }
  if (holder && cutTo(holder.geometry, keep)) return [holder]
  holder?.removeFromParent()
  holder?.geometry.dispose()
  return []
}

/**
 * A tile's facts with every name but one blanked out.
 *
 * The mesh `leaveOne` leaves behind draws one building and would otherwise go
 * on answering to every building of the district. Which matters because two
 * names can land on one tile — two towers of one complex is a natural thing
 * for a page to ask for — and each is fetched under a key of its own, so the
 * tile is cut twice and both cuts name all of it. Everything that looks a
 * building up by asking the facts rather than by reading the corners would
 * then take whichever cut it met first for either name, and that mesh holds
 * none of the other's corners: no seat, a motion holding a row it never moves,
 * a colour that never shows.
 *
 * Blanked rather than trimmed. A place in these lists is the tile's own number
 * for a building and everything asks a building by that number — which is why
 * `cutTo` leaves the batch ids alone as well — so the lists keep their length
 * and the name that is left keeps its place. An empty id already reads as "not
 * in this mesh" wherever they are asked (see `toldOf`).
 */
export function namingOne(facts: BuildingFacts, keep: number, as?: string): BuildingFacts {
  return { ...facts, ids: facts.ids.map((id, at) => (at === keep ? (as ?? id) : '')) }
}

/**
 * Cuts a geometry down to the faces of one building, packing its corners down
 * to the ones those faces use. False where it turns out to have none.
 *
 * The tile's own numbers for its buildings are left as they are. Everything
 * that asks about a building — where its foot is, how tall it stands, what the
 * survey says of it — asks by that number, and renumbering the one that is
 * left would mean renumbering the facts of the whole tile along with it.
 */
function cutTo(geometry: BufferGeometry, keep: number): boolean {
  const faces = geometry.index
  const batch = geometry.attributes[BATCH_ID]
  if (!faces || !batch) return false

  // The corners that are kept, in the order they are first met, and where each
  // of them lands in the shorter mesh
  const corners: number[] = []
  const moved = new Int32Array(batch.count).fill(-1)
  const rewritten: number[] = []
  for (let face = 0; face < faces.count; face += 3) {
    // A face is one building's. The tile numbers corners rather than faces, and
    // each of its buildings is a closed shape of its own, so no face of one
    // reaches into another and the first corner answers for the face.
    if (batch.getX(faces.getX(face)) !== keep) continue
    for (let c = 0; c < 3; c++) {
      const corner = faces.getX(face + c)
      let at = moved[corner]!
      if (at < 0) {
        at = corners.length
        moved[corner] = at
        corners.push(corner)
      }
      rewritten.push(at)
    }
  }
  if (rewritten.length === 0) return false

  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    geometry.setAttribute(name, packed(attribute, corners))
  }
  geometry.setIndex(rewritten)
  // What it was is gone, and it has not been stood up or seated yet, so what it
  // is now is worked out where those are done
  geometry.boundingBox = null
  geometry.boundingSphere = null
  return true
}

/**
 * One attribute over the corners that are kept, in their new order.
 *
 * Read through the attribute rather than out of its array: Draco hands some of
 * them back interleaved, a vertex's numbers a stride apart, and some as
 * normalized bytes standing for something else. What comes back is plain and
 * packed, which is what cutting a parapet or setting a window makes of them
 * anyway (see `copyAhead`).
 */
function packed(attribute: Attribute, corners: readonly number[]): BufferAttribute {
  const size = attribute.itemSize
  const out = sameWidthAs(attribute, corners.length * size)
  for (let v = 0; v < corners.length; v++) {
    const from = corners[v]!
    out[v * size] = attribute.getX(from)
    if (size > 1) out[v * size + 1] = attribute.getY(from)
    if (size > 2) out[v * size + 2] = attribute.getZ(from)
    if (size > 3) out[v * size + 3] = attribute.getW(from)
  }
  return new BufferAttribute(out, size)
}

/**
 * Whether two places a building could be stood at are the one place.
 *
 * By what they say and not by which array said it: a page moving a building
 * back where it already is writes a fresh pair of numbers, and what hangs off
 * this is whether the land has to be read again — which the same two numbers
 * cannot have changed. Nowhere, on both sides, is the same place as nowhere.
 */
export function samePlace(
  a: readonly [number, number] | undefined,
  b: readonly [number, number] | undefined,
): boolean {
  if (!a || !b) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

/**
 * Where a building the survey drew actually stands, as [longitude, latitude].
 *
 * A page says roughly where to look for its building and the survey says
 * exactly where it is, so this is what a building left at home is hung on: its
 * own place rather than the one it was found by, which may be a street away.
 */
export function standsAt(
  origin: { readonly x: number; readonly z: number },
  foot: { readonly x: number; readonly z: number },
  stretch: number,
): [number, number] {
  return [xToLon(origin.x + foot.x * stretch), yToLat(-(origin.z + foot.z * stretch))]
}

/**
 * Hangs a tile's group so that one of its buildings lands on a place.
 *
 * The group carries where the tile stands and the corners are metres from the
 * tile's middle, so standing a building somewhere is a matter of hanging its
 * tile the building's own offset away from that place. Which is what keeps the
 * corners small: a building moved by writing 400km onto its vertices would be
 * drawn on a grid three centimetres wide, since that is what a float has left
 * at that size.
 *
 * The foot is in the tile's own metres, so it is turned and stretched by what
 * the group will turn and stretch it by before it is taken off.
 */
export function hang(
  group: Group,
  foot: { readonly x: number; readonly z: number },
  place: readonly [number, number],
  facing: number,
): void {
  // Clockwise from north, on a ground measured x east and z south, is a
  // negative turn about the sky
  const angle = (-facing * Math.PI) / 180
  const stretch = 1 / metersPerUnit(place[1])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  group.rotation.y = angle
  group.scale.setScalar(stretch)
  group.position.set(
    lonToX(place[0]) - (foot.x * cos + foot.z * sin) * stretch,
    0,
    -latToY(place[1]) - (-foot.x * sin + foot.z * cos) * stretch,
  )
}
