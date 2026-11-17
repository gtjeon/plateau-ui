/**
 * What a building tile carries, whichever form it arrived in.
 *
 * PLATEAU sends the same survey two ways. Most of it is 3D Tiles 1.0: a b3dm
 * wrapper holding a glTF, with what the survey says about each building in a
 * batch table beside it. 台東区's 2025 tiles are 3D Tiles 1.1, where the tile
 * is the glTF itself and the same facts live inside it, under
 * `EXT_structural_metadata`. Nothing in the catalog says which a city sends —
 * the dataset pages are worded identically — so the file's first four bytes
 * are what tells them apart.
 *
 * Both readers answer with the shape below, so everything downstream reads one
 * thing: the windows, the parapets, the styles and a building picked by name
 * never learn which form their tile came in.
 */

/** Where a mesh keeps what PLATEAU says about each of its buildings, by `_batchid`. */
export const BUILDING_FACTS = 'plateauBuildings'

/**
 * What a tile says about its buildings, one entry per `_batchid`.
 *
 * Every list is as long as the tile has buildings, so a `_batchid` reads all
 * four. What a building did not say for itself reads as empty: no name, no
 * storeys, no usage.
 */
export interface BuildingFacts {
  /** What PLATEAU calls each building, which travels between tiles. */
  readonly ids: readonly string[]
  /** How many storeys each stands above ground, or 0 where it does not say. */
  readonly storeys: Uint8Array
  /** What each is for, in PLATEAU's own words, or '' where it does not say. */
  readonly usages: readonly string[]
  /**
   * What each is called, or '' where the survey does not say.
   *
   * Written for landmarks and left empty for almost everything else: the
   * tower, the ward office and the station carry a name, and the block of
   * flats beside them does not — 43 of 6,871 buildings over 上野. So it is
   * something a page may show where it is there, and never something a page
   * may count on.
   */
  readonly names: readonly string[]
  /**
   * Everything else the survey wrote about one of them, read on asking.
   *
   * The four above are the facts every building has and every page wants, so
   * they are pulled out and typed. This is the rest, and the rest is a
   * different kind of thing: what is in it depends on the city and the year
   * the model was made, the keys are the publisher's own Japanese, and a
   * seaside town carries columns an inland one has never heard of. Measured
   * on 鎌倉 2024: 68 columns, of which 34 are about water or landslides —
   * `津波浸水想定_…_浸水深`, `…_浸水ランク`, `…_浸水継続時間`, one set per
   * river system and per kind of flooding. So it is handed over as the tile
   * wrote it rather than curated into names of ours.
   *
   * A function rather than a list because almost no page asks: the tile holds
   * one JSON document per building and this parses the one that is wanted.
   * Null where the tile says nothing.
   */
  readonly attributesAt: (at: number) => BuildingAttributes | null
}

/**
 * What the survey wrote about one building, as the tile publishes it.
 *
 * Not a shape this library defines — see {@link BuildingFacts.attributesAt}
 * for why it cannot be. A page reads the keys it knows its own data has.
 */
export type BuildingAttributes = Readonly<Record<string, unknown>>

/** A tile read: the shapes, where they are measured from, and what it says of them. */
export interface TileContent extends BuildingFacts {
  /** The glTF binary, which is the whole file where the tile is one. */
  glb: ArrayBuffer
  /** Earth-centred metres the vertices are measured from, when the file says so. */
  center: readonly [number, number, number] | undefined
}

/**
 * The most storeys a building may be said to have.
 *
 * Read as a byte, both to keep the list small and because the number decides
 * how many rows of windows a wall is cut into: a building that claims a
 * thousand would be a wall of glass dust. Japan's tallest is 60-odd.
 */
const MOST_STOREYS = 255

/** Whether a tile is the glTF itself, as 3D Tiles 1.1 sends it. */
export function isGltf(data: ArrayBuffer): boolean {
  return data.byteLength >= 4 && text(data, 0, 4) === 'glTF'
}

/** How many storeys, held to what a byte can say and to what a building can be. */
export function storeyOf(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MOST_STOREYS, Math.round(value))
}

export function text(data: ArrayBuffer, at: number, length: number): string {
  return new TextDecoder().decode(new Uint8Array(data, at, length))
}

export function json(data: ArrayBuffer, at: number, length: number): unknown {
  if (length === 0) return {}
  return JSON.parse(text(data, at, length)) as unknown
}
