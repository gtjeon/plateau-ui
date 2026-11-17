import type { BuildingFacts } from './tileContent.js'
import type { FlatRoof, RoofPlan } from './roofPlan.js'
import { holdsWindows, type Field } from './wallFields.js'
import type { WallPlan } from './wallPlan.js'

/**
 * Where each building stops, and how many storeys stand under that.
 *
 * The rows of windows belong to a building, not to a wall: a wing standing one
 * floor high off a block of five is not a building of one floor, and its
 * windows line up with the floors of the block. So the storeys are worked out
 * once for each building, from the top of it down, and every wall of it is
 * set out by them.
 */

/**
 * A roof is the building itself rather than a box left on it once it covers
 * this much of the building's widest roof.
 *
 * What stands on a roof falls in two heaps: a stair enclosure or a plant room,
 * which is a fraction of what it stands on, and a storey of the building that
 * happens to be set back, which is most of it. Half tells them apart with room
 * to spare either way.
 */
const BIG_ENOUGH = 0.5

/**
 * How short a storey has to come out before the ceiling it was worked out from
 * is taken to be wrong, in metres.
 *
 * Which roof of a building is the building cannot be read off the roofs alone:
 * measured over 中野 and 東京, the roofs that are a building's own top and the
 * boxes standing on one overlap on every measure there is — area against the
 * widest, area in square metres, height above what they stand on. There is no
 * line to draw between two heaps because there are not two heaps.
 *
 * So the roofs are not asked. The building's own storeys are, and they answer
 * a different question: not which roof this is, but whether the answer already
 * given can be true. Fourteen storeys under a ceiling of fourteen metres is
 * not a roof that might be the wrong one — it is a metre a floor, which no
 * building is.
 */
const SHORTEST_STOREY = 2

/**
 * ...and how tall a storey a ceiling chosen again has to leave, in metres.
 *
 * The doubt above and the answer here are deliberately not the same number. A
 * ceiling comes out too low for its storeys either because it is the wrong
 * roof or because the storeys were overstated, and in the second case the
 * right roof is below the line by definition — so anything picked instead of
 * it is wrong. Asking more of the replacement than was asked of the doubt
 * leaves the mistaken case with nothing to pick, and it keeps what it had.
 */
const ACCEPTABLE_STOREY = 2.5

/**
 * How far under the building's tallest wall a ceiling has to sit before it is
 * doubted at all, in metres.
 *
 * Nothing is gained by moving a ceiling that has no blank wall above it. Most
 * ceilings that sit below the tallest wall sit two or three metres below it —
 * a parapet rim, a stair enclosure — and those are right.
 */
const BIG_DROP = 5

/**
 * Field tops this close together are one line of eaves, in metres.
 *
 * A gable's field is read a hair in from the ends of the wall, where its top
 * has already begun to rise, so it comes out a few millimetres over the eaves
 * the long walls stop at. Taken for the ceiling as it is, it leaves those walls
 * short of their top row by that much, and the row goes.
 */
const SAME_EAVES = 0.05

/** Where the buildings of a mesh stop, and which of them a flat roof stops. */
export interface Ceilings {
  /** Each building's ceiling, in metres over the ground it is seated on. */
  readonly heights: Map<number, number>
  /**
   * The buildings whose ceiling is a flat roof, which is where a parapet may
   * be cut. The rest stop at their walls — a pitched roof's eaves — where
   * nothing stands above the top row to hide it.
   */
  readonly roofed: ReadonlySet<number>
}

/**
 * Where each building of a mesh stops, in metres over the ground it is seated
 * on. What the storeys divide, and what the windows of every wall of it line
 * up with however high that wall itself reaches.
 *
 * Working out which roof is over each wall is more than it is worth — walls
 * share planes, and a wall that steps has two over it — so one roof is taken
 * for the whole building: the highest of those big enough to be the building
 * rather than a box standing on it. A tower set back on a wide podium keeps
 * its own height that way, while a stair enclosure gives the building none.
 * Windows are not drawn above it, and the rim of wall carrying the parapet is
 * no more a storey than the box is.
 *
 * A building with no flat roof to go on — a pitched one, or one too broken up
 * to read as flat — falls back to the highest top of any field its walls hold
 * a window in, level all along or taken at its high end where it slopes, and
 * only where none of them holds one to the highest top of any of its walls,
 * read at the wall's field where it has one. For a pitched roof that is the
 * eaves: the field under a gable end stops at the eaves, and a dormer or the
 * step between two roofs holds none.
 *
 * That leaves one shape it reads wrongly: a tower on a wide podium, whose own
 * roof is less than half the podium's and is thrown out with the stair boxes.
 * The building's storeys catch it — see {@link SHORTEST_STOREY}.
 */
export function ceilingsOf(
  plan: WallPlan,
  fields: readonly (Field | undefined)[],
  roofs: RoofPlan | null,
  facts: BuildingFacts,
): Ceilings {
  /**
   * The highest top of each building's walls, read at a wall's field where it
   * has one and at the wall itself where it has none, kept for the doubt below
   * before the roofs are allowed to speak.
   */
  const tallest = new Map<number, number>()
  /** The highest top of a field that holds a window, for each building that has one. */
  const highest = new Map<number, number>()
  for (let w = 0; w < plan.walls.length; w++) {
    const wall = plan.walls[w]
    if (!wall) continue
    const field = fields[w]
    const top = field?.top ?? wall.high
    if (top > (tallest.get(wall.building) ?? 0)) tallest.set(wall.building, top)
    if (holdsWindows(field) && field.top > (highest.get(wall.building) ?? 0)) {
      highest.set(wall.building, field.top)
    }
  }
  /** ...and the lowest of the tops that make one line of eaves with it. */
  const eaves = new Map(highest)
  for (let w = 0; w < plan.walls.length; w++) {
    const wall = plan.walls[w]
    const field = fields[w]
    if (!wall || !holdsWindows(field)) continue
    const top = highest.get(wall.building) ?? 0
    if (field.top >= top - SAME_EAVES && field.top < (eaves.get(wall.building) ?? top)) {
      eaves.set(wall.building, field.top)
    }
  }
  const heights = new Map(tallest)
  for (const [building, top] of eaves) heights.set(building, top)
  const roofed = new Set<number>()
  if (!roofs) return { heights, roofed }

  // The widest roof always stands, so a building with any roof at all ends up
  // with one.
  const chosen = highestOfTheWidest(roofs.roofs, () => true)
  for (const [building, low] of chosen) {
    heights.set(building, low)
    roofed.add(building)
  }

  // Buildings whose ceiling the storeys say cannot be right, and which have a
  // blank wall standing over it to show for it.
  const mistaken = new Map<number, number>()
  for (const [building, ceiling] of heights) {
    const storeys = facts.storeys[building] ?? 0
    if (storeys <= 0 || ceiling >= storeys * SHORTEST_STOREY) continue
    if ((tallest.get(building) ?? ceiling) - ceiling <= BIG_DROP) continue
    mistaken.set(building, storeys)
  }
  if (mistaken.size === 0) return { heights, roofed }

  // Chosen again over the roofs high enough to stand the storeys under, which
  // leaves the podium out of the comparison that threw its tower away. Where
  // nothing stands high enough, the building keeps the ceiling it had: the
  // doubt is only worth acting on when there is something to act on.
  const again = highestOfTheWidest(roofs.roofs, (roof) => {
    const storeys = mistaken.get(roof.building)
    return storeys !== undefined && roof.low >= storeys * ACCEPTABLE_STOREY
  })
  for (const [building, low] of again) {
    heights.set(building, low)
    roofed.add(building)
  }
  return { heights, roofed }
}

/**
 * For each building, the highest of its roofs that covers at least half its
 * widest — the widest measured among the roofs admitted, and only those looked
 * at. What is left is the building rather than the boxes standing on it.
 */
function highestOfTheWidest(
  roofs: readonly FlatRoof[],
  admit: (roof: FlatRoof) => boolean,
): Map<number, number> {
  const widest = new Map<number, number>()
  for (const roof of roofs) {
    if (!admit(roof)) continue
    if (roof.area > (widest.get(roof.building) ?? 0)) widest.set(roof.building, roof.area)
  }
  const highest = new Map<number, number>()
  for (const roof of roofs) {
    if (!admit(roof) || roof.area < (widest.get(roof.building) ?? 0) * BIG_ENOUGH) continue
    if (roof.low > (highest.get(roof.building) ?? Number.NEGATIVE_INFINITY)) {
      highest.set(roof.building, roof.low)
    }
  }
  return highest
}

/**
 * How many storeys each building of a mesh stands.
 *
 * What PLATEAU says, where it says anything and what it says can be true.
 * Where it does not, its ceiling over how tall a storey is taken to be — its
 * shape is the only other thing that knows, and a building of no storeys
 * would be a building with no windows.
 *
 * A count is turned down where it would share the building out into storeys
 * under {@link SHORTEST_STOREY}. Over one screen of 中野 that is 112 buildings
 * of the 2,770 that state a count, 48 of them under a metre a storey: a hotel
 * outbuilding 3.5m tall carrying the twenty storeys of the block it belongs
 * to, a shop of 4.3m carrying six. They are not parts of one building wrongly
 * split — every one is its own `bldg:Building` with its own `uro:buildingID` —
 * and the height is not in doubt, since `bldg:measuredHeight` agrees with the
 * mesh. It is the count alone that is wrong, so it is the count that goes.
 */
export function countStoreys(
  ceilings: Map<number, number>,
  facts: BuildingFacts,
  storeyHeight: number,
): Map<number, number> {
  const storeys = new Map<number, number>()
  for (const [building, ceiling] of ceilings) {
    storeys.set(building, storeysOf(ceiling, facts.storeys[building] ?? 0, storeyHeight))
  }
  return storeys
}

/**
 * How many storeys one building is taken to have, which is the rule above for
 * a single building.
 *
 * Out here because the windows are no longer the only thing that asks. A mark
 * set on a storey has to land on the same floor the windows cut, and a second
 * reading of the same rule is a mark that drifts a floor off its own building
 * the day either reading is touched.
 */
export function storeysOf(ceiling: number, said: number, storeyHeight: number): number {
  const believable = said > 0 && ceiling / said >= SHORTEST_STOREY
  return believable ? said : Math.max(1, Math.round(ceiling / storeyHeight))
}
