import type { Building, Buildings } from './Buildings.js'
import type { BuildingPlace, BuildingWanted } from './named.js'
import type { BuildingAttributes } from './tileContent.js'
import type { Position } from '../events.js'

/**
 * How a replica's name begins, so that it can never be read for a surveyed
 * one.
 *
 * Everything about a building — its paint, whether it is taken out, where it
 * has been moved, what a click answers — is keyed by one name, and a page's
 * replica has to have a place in that list beside the city's own buildings.
 * PLATEAU names a building with a gml:id, which is `bldg_` and a UUID, so a
 * name beginning with a colon is one the survey cannot produce. There is one
 * list of names and no question about which kind a name is.
 */
const MINTED = ':'
let minted = 0

/**
 * A building a page stood, rather than one the city brought.
 *
 * It is the same shape the survey drew — a page names a building and this is
 * made from it — and from there it is the page's own. It stays until the page
 * takes it away, wherever the view goes; there can be ten of them from the one
 * surveyed building; and each is told apart from the others and from the
 * original by a name of its own.
 *
 * It is a {@link Building} as well, so everything a page reads of a building
 * it can read here — what the survey calls it, what it is for, how tall it
 * stands. Those are the survey's words about the building it was taken from,
 * and they are empty until it has arrived, which is what the promise
 * {@link Buildings.bring} hands back waits for.
 *
 * Made by {@link Buildings.bring} and not by a page: the city holds the one
 * material, the one table of motions and the one way to the tiles, and a
 * building that stood outside all three would be a second city.
 *
 * What it does is split by who it can be done to. What can be done to any
 * building — painting it, hiding it, moving it, pointing a line round it — is
 * the layer's, under this one's {@link id}: `buildings.setStyle(tower.id, …)`,
 * `buildings.hide(tower.id)`, `buildings.place(tower.id, …)`. It has no mesh of
 * its own and is drawn in the city's material and table exactly as the city's
 * own are, so the door is the city's door. What can only be done to a building
 * a page stood — taking it away — is here.
 */
export class ReplicaBuilding implements Building {
  /**
   * What this one is called here. Minted, and never a gml:id — see
   * {@link MINTED} — so `setStyle`, `hide`, `place` and a click all speak of
   * one list of names.
   */
  readonly id: string
  /** What PLATEAU calls the building it was taken from. */
  readonly from: string
  /** Whereabouts to look for that building; see {@link BuildingWanted.findAt}. */
  readonly findAt: readonly [number, number]

  private readonly owner: Buildings
  private gone = false
  private _at: readonly [number, number] | undefined
  private _facing: number | undefined

  /**
   * @internal Whether this stands in for one of the city's own buildings a
   * page moved, under that building's own name, rather than one a page
   * brought; see {@link Buildings.place}.
   *
   * The same machinery stands both — a tile fetched for the one building, cut
   * down to it and hung on its own — and they part on what the city does to
   * them: this one goes under with the city when the view steps out of the
   * zooms buildings stand at, and is never handed to a page.
   */
  readonly ofCity: boolean

  /**
   * @internal Made by {@link Buildings.bring} alone, and by
   * {@link Buildings.place} for a city building it moves, which keeps that
   * building's own name (`ofCity`); see above.
   */
  constructor(owner: Buildings, wanted: BuildingWanted, ofCity = false) {
    this.owner = owner
    this.ofCity = ofCity
    this.id = ofCity ? wanted.id : `${MINTED}${(minted += 1).toString(36)}`
    this.from = wanted.id
    this.findAt = wanted.findAt
    this._at = wanted.at
    this._facing = wanted.facing
  }

  /**
   * Where it stands, as [longitude, latitude], or nothing for where it was
   * surveyed. Moved with `buildings.place(id, …)`.
   *
   * Read-only, since writing it did nothing: it was a field a page could set,
   * and the building stayed where it was. Moving one is a thing that happens —
   * the land under the new place is read, the mask judges it again — so it is
   * a call.
   */
  get at(): readonly [number, number] | undefined {
    return this._at
  }

  /** Which way it looks, or nothing for the way it was surveyed. Turned with `buildings.place(id, …)`. */
  get facing(): number | undefined {
    return this._facing
  }

  /** What the survey had to say about it, once it is up. */
  private get surveyed(): Building | undefined {
    return this.owner.said(this.id)
  }

  get name(): string {
    return this.surveyed?.name ?? ''
  }

  get usage(): string {
    return this.surveyed?.usage ?? ''
  }

  get storeys(): number {
    return this.surveyed?.storeys ?? 0
  }

  get tall(): number {
    return this.surveyed?.tall ?? 0
  }

  /** What the survey wrote about the building this one was taken from. */
  get attributes(): BuildingAttributes | null {
    return this.surveyed?.attributes ?? null
  }

  get position(): Position {
    // Before it is up, where it is to stand: where it is to be found is only
    // where the survey had it, and a page that stood it elsewhere was told
    // the survey's place until the tile landed
    const at = this._at ?? this.findAt
    return this.surveyed?.position ?? { lng: at[0], lat: at[1], height: 0 }
  }

  get corners(): readonly Position[] {
    return this.surveyed?.corners ?? []
  }

  /** Whether it has been taken away. A replica taken away does nothing more. */
  get removed(): boolean {
    return this.gone
  }

  /**
   * @internal Where the layer writes what `buildings.place` asked for, once it
   * has read where the building was; `null` puts it back where it was
   * surveyed, looking the way it was surveyed.
   *
   * _(2026-11-03: `tower.place(…)` was here as well, the one way to move a
   * building a page stood. Moving is now the layer's for every building
   * (`buildings.place`), and one door is kept rather than two.)_
   */
  moved(where: BuildingPlace | null): void {
    if (where === null) {
      this._at = undefined
      this._facing = undefined
      return
    }
    if (where.at !== undefined) this._at = where.at
    if (where.facing !== undefined) this._facing = where.facing
  }

  /** Takes it away. Its tile goes with it unless another replica wants it. */
  remove(): void {
    if (this.gone) return
    this.gone = true
    this.owner.drop(this.id)
  }

  /** @internal What the tile fetch is asked for, which is the survey's name. */
  wanted(): BuildingWanted {
    return { id: this.from, findAt: this.findAt, at: this._at, facing: this._facing }
  }
}
