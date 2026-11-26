import type { Mesh } from 'three/webgpu'
import { maskArea, type MaskArea, standsSomewhere, type StandingShape } from '../mask.js'
import { BUILDING_FACTS, type BuildingFacts } from './tileContent.js'
import { feetOf, feetOn, type FootBox } from './foot.js'
import type { Building } from './Buildings.js'

/**
 * Taking buildings out of the city: one by name, a whole site at once, or
 * whichever ones a rule picks out.
 *
 * The site is what a page cannot say any other way: clearing the plots a
 * proposal stands on. A site is rarely one building — a block goes and one
 * larger thing takes its place — so the site is what is named, and whichever
 * buildings the survey happens to have put there go together.
 *
 * A rule says the other kind of thing, the kind a shape cannot: the sheds, the
 * factories, everything under three storeys. It is asked once per building as
 * a tile lands, and again whenever the tiles are marked afresh.
 *
 * Which is also why this is the buildings' own doing rather than something a
 * model asks for. A page that hides four houses and stands one building over
 * them is not saying anything about any one of the four, and a model that
 * named a building it stood in for could only ever say one-for-one.
 *
 * A corner carries whether its building is out — in the second half of the
 * slot a page's paint already rides in, since a building's corners fill every
 * vertex buffer the card promises and there is no ninth to be had — and the
 * shader throws it away on the mask's own test, so it costs no second branch.
 *
 * Thrown away rather than taken out of the geometry: a tile is shaped once as
 * it lands, hiding is a thing a page changes while looking, and cutting the
 * corners out again would be the whole of that work for every change.
 */

/** A site to clear, kept as the shape a page gave and the area it was read into. */
interface Site {
  readonly given: StandingShape
  readonly area: MaskArea
}

/**
 * A rule that picks buildings out, asked one building at a time.
 *
 * What it is handed is what the tile says about that building; reading
 * {@link Building.position} is what makes the mesh's feet worth finding, and a
 * rule that never asks for one costs nothing but the call.
 */
export type BuildingRule = (building: Building) => boolean

/** What describes one of a mesh's buildings; see {@link HiddenBuildings}. */
type TellsOf = (mesh: Mesh, at: number, feet?: () => Map<number, FootBox>) => Building | null

/**
 * Which buildings a page has taken out, and writing that onto a tile's corners.
 *
 * The sites are held one area apiece rather than as one area of many pieces.
 * A `MaskArea` is read by shaders too and holds only as many pieces as a
 * shader may walk, and nothing here is read by a shader — so a page clearing
 * a dozen plots is a dozen areas and no limit.
 */
export class HiddenBuildings {
  /** Named one by one, by what PLATEAU calls them. */
  private readonly named = new Set<string>()
  private readonly sites: Site[] = []
  /** Rules, in the order they were given. */
  private readonly rules: BuildingRule[] = []

  /**
   * How a building is described to a rule.
   *
   * Handed in rather than imported: what tells of a building lives with the
   * buildings, and reaching for it from here would have the two modules
   * importing one another.
   */
  constructor(private readonly told: TellsOf) {}

  /** Whether anything at all is out; see {@link HiddenBuildings.outOf}. */
  get empty(): boolean {
    return this.named.size === 0 && this.sites.length === 0 && this.rules.length === 0
  }

  /**
   * Takes a building out by name, every building whose foot falls inside a
   * shape, or every one a rule picks.
   */
  hide(what: string | StandingShape | BuildingRule): void {
    // A site stands somewhere; one riding the camera would hide nothing
    if (typeof what === 'object') standsSomewhere(what, 'Buildings.hide')
    if (typeof what === 'string') {
      this.named.add(what)
      return
    }
    if (typeof what === 'function') {
      // Handing the same rule over twice means "look again", not "apply it
      // twice": a page whose rule reads a list it has just added to has no
      // other way to say so, and two copies of one rule answer alike anyway
      if (!this.rules.includes(what)) this.rules.push(what)
      return
    }
    const area = maskArea({ shape: what })
    if (area) this.sites.push({ given: what, area })
  }

  /**
   * Puts one back, or with nothing given, all of them.
   *
   * A shape is matched by being the same shape a page handed over, since that
   * is the only thing a page has to hand back.
   */
  show(what?: string | StandingShape | BuildingRule): void {
    if (what === undefined) {
      this.named.clear()
      for (const site of this.sites) site.area.dispose()
      this.sites.length = 0
      this.rules.length = 0
      return
    }
    if (typeof what === 'string') {
      this.named.delete(what)
      return
    }
    if (typeof what === 'function') {
      const rule = this.rules.indexOf(what)
      if (rule >= 0) this.rules.splice(rule, 1)
      return
    }
    const at = this.sites.findIndex((site) => site.given === what)
    if (at >= 0) {
      // Whoever made it gives it back; see CLAUDE.md's fifth contract
      this.sites[at]?.area.dispose()
      this.sites.splice(at, 1)
    }
  }

  /**
   * Which of a mesh's buildings are out, by the tile's own number for each,
   * or nothing where none of them is.
   *
   * Handed to `BuildingStyles.mark`, which is the one place that writes what a
   * page has decided onto a tile's corners. Judging is here and writing is
   * there, so the attribute the two things share has a single writer.
   *
   * A site is judged by the whole of a building's foot, by {@link feetOn} —
   * the one place that answers whether a building stands on a piece of ground.
   * So a block cleared to the kerb does not take the house across the street
   * whose eaves lean over the line, and the building bent round a yard is not
   * judged by a middle that falls in the yard.
   */
  outOf(mesh: Mesh): Set<number> | null {
    // Before the feet are read, not after. Reading them is a walk over every
    // corner of the mesh, and this is asked again on every mesh whenever a
    // motion or a crowd starts or ends — so a page that has hidden nothing
    // would pay that walk for an answer that is always the same.
    if (this.empty) return null
    const facts = mesh.userData[BUILDING_FACTS] as BuildingFacts | undefined
    if (!facts) return null

    // The one walk, taken when something actually asks where a building is —
    // a site always does, a rule only if it reads `place`
    let walked: Map<number, FootBox> | undefined
    const feet = (): Map<number, FootBox> => (walked ??= feetOf(mesh))

    // One walk a site, taken when the first building is put to it: the answer
    // is about every building the mesh holds; see {@link feetOn}
    let sited: Map<number, boolean>[] | undefined
    const onSite = (building: number): boolean => {
      sited ??= this.sites.map((site) => feetOn(mesh, site.area))
      return sited.some((held) => held.get(building) === true)
    }

    // Over what the tile says it holds rather than over the feet, so that a
    // rule reading nothing but a name never sends anyone walking. A number
    // this mesh has no corner for marks nothing, which is the right answer
    // for a mesh cut down to one building.
    const out = new Set<number>()
    for (let building = 0; building < facts.ids.length; building++) {
      const id = facts.ids[building]
      if (id !== undefined && this.named.has(id)) {
        out.add(building)
        continue
      }
      if (this.sites.length > 0 && onSite(building)) {
        out.add(building)
        continue
      }
      if (this.rules.length === 0) continue
      const told = this.told(mesh, building, feet)
      if (told && this.rules.some((rule) => rule(told))) out.add(building)
    }
    return out.size > 0 ? out : null
  }
}
