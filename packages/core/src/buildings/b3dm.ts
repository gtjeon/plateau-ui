/**
 * Batched 3D Model (b3dm), the form most of PLATEAU's building tiles come in.
 *
 * A tile is a short header, two tables and a glTF binary. The tables hold how
 * many buildings are batched together and an attribute list for them; the glTF
 * holds the shapes, with its vertices measured from a centre point the file
 * carries (CESIUM_RTC).
 *
 * The other form, where the tile is the glTF itself, is read by `gltfTile.ts`;
 * both answer with the `TileContent` of `tileContent.ts`, which is where what
 * they have in common lives.
 */
import { json, storeyOf, text, type BuildingAttributes, type TileContent } from './tileContent.js'
import { Unreadable } from '../transient.js'

const HEADER_BYTES = 28

export function readB3dm(data: ArrayBuffer): TileContent {
  const view = new DataView(data)
  const magic = text(data, 0, 4)
  if (magic !== 'b3dm') throw new Unreadable(`not a b3dm tile (magic "${magic}")`)

  const featureJsonBytes = view.getUint32(12, true)
  const featureBinaryBytes = view.getUint32(16, true)
  const batchJsonBytes = view.getUint32(20, true)
  const batchBinaryBytes = view.getUint32(24, true)

  const batchTable = HEADER_BYTES + featureJsonBytes + featureBinaryBytes
  const at = batchTable + batchJsonBytes + batchBinaryBytes

  const glb = data.slice(at)
  const table = batchJsonBytes === 0 ? {} : (json(data, batchTable, batchJsonBytes) as Table)
  const packed: Binary = { data, at: batchTable + batchJsonBytes, length: batchBinaryBytes }
  const count = column(table, 'gml_id')?.length ?? 0
  return {
    glb,
    center: readCenter(glb),
    ids: readIds(table, count),
    storeys: readStoreys(table, count, packed),
    usages: readUsages(table, count),
    names: strings(table, 'gml:name', count),
    attributesAt: attributesOf(table),
  }
}

/**
 * The survey's own document for one building; see {@link BuildingFacts.attributesAt}.
 *
 * The batch table carries it twice over — once as an `attributes` column of
 * whole documents, and once flattened into a column per leaf
 * (`津波浸水想定_…_浸水深`). The document is taken, because the flattening is
 * the converter's and loses what it cannot flatten: measured on 鎌倉 2024,
 * `uro:DataQualityAttribute` arrives as four parallel lists inside the
 * document and as three scalar columns outside it.
 *
 * Already parsed here — the batch table is one JSON object — so this only
 * picks the row. The glTF tiles of 3D Tiles 1.1 hold the same documents as
 * text and parse on asking; see `gltfTile.ts`.
 */
function attributesOf(table: Table): (at: number) => BuildingAttributes | null {
  const documents = column(table, 'attributes')
  return (at) => {
    const one = documents?.[at]
    return typeof one === 'object' && one !== null ? (one as BuildingAttributes) : null
  }
}

/**
 * The batch table's JSON, by column name: a list, or for a column kept in the
 * binary after it, a note of where its numbers lie.
 */
type Table = Record<string, unknown>

/**
 * One column of the batch table, where it is a list.
 *
 * A column of numbers may instead lie in the binary that follows the table,
 * with the JSON holding only a note of where; {@link numbersOf} reads those.
 * Text only ever comes as a list.
 */
function column(table: Table, name: string): readonly unknown[] | undefined {
  const values = table[name]
  return Array.isArray(values) ? values : undefined
}

/** Where a tile's batch table binary lies, for the columns kept in it. */
interface Binary {
  readonly data: ArrayBuffer
  readonly at: number
  readonly length: number
}

/** What a note in the JSON says about a column kept in the binary. */
interface Packed {
  readonly byteOffset?: unknown
  readonly componentType?: unknown
  readonly type?: unknown
}

/** How wide each kind of number is, and how to read one. */
const KINDS: Record<string, { width: number; read: (view: DataView, at: number) => number }> = {
  BYTE: { width: 1, read: (view, at) => view.getInt8(at) },
  UNSIGNED_BYTE: { width: 1, read: (view, at) => view.getUint8(at) },
  SHORT: { width: 2, read: (view, at) => view.getInt16(at, true) },
  UNSIGNED_SHORT: { width: 2, read: (view, at) => view.getUint16(at, true) },
  INT: { width: 4, read: (view, at) => view.getInt32(at, true) },
  UNSIGNED_INT: { width: 4, read: (view, at) => view.getUint32(at, true) },
  FLOAT: { width: 4, read: (view, at) => view.getFloat32(at, true) },
  DOUBLE: { width: 8, read: (view, at) => view.getFloat64(at, true) },
}

/**
 * One column of numbers, however the tile chose to send it.
 *
 * A column is either a list in the table's JSON or a note saying where in the
 * binary after it the numbers lie, and PLATEAU sends the same column both ways
 * from one district to the next: the storeys come as a list over 中野 and as
 * bytes over 東京駅. A reader that knows only the list reads a whole city
 * centre as saying nothing about its storeys, which is not a gap it can tell
 * from a building that truly says nothing.
 */
function numbersOf(
  table: Table,
  name: string,
  count: number,
  packed: Binary,
): ((i: number) => number) | undefined {
  const values = table[name]
  if (Array.isArray(values)) {
    return (i) => {
      const value: unknown = values[i]
      return typeof value === 'number' ? value : Number.NaN
    }
  }
  if (typeof values !== 'object' || values === null) return undefined

  const note = values as Packed
  // Only one number a building is ever asked for here, so anything wider is
  // left alone rather than read wrongly.
  if (note.type !== undefined && note.type !== 'SCALAR') return undefined
  const kind = typeof note.componentType === 'string' ? KINDS[note.componentType] : undefined
  if (!kind) return undefined
  const offset = typeof note.byteOffset === 'number' ? note.byteOffset : 0
  const bytes = kind.width * count
  if (offset < 0 || packed.length < offset + bytes) return undefined

  const view = new DataView(packed.data, packed.at + offset, bytes)
  return (i) => kind.read(view, i * kind.width)
}

/**
 * What PLATEAU calls each building, in `_batchid` order.
 *
 * A `_batchid` is only a place in its own tile: number three means one
 * building here and another one street over. Anything that has to know one
 * building from another across tiles — a building picked and kept, the same
 * block reached from two directions — needs a name that travels, and this is
 * it: a CityGML gml:id, `bldg_` and a UUID.
 *
 * The table it comes from carries forty more columns, heights and addresses
 * and flood depths among them, which nothing asks for yet.
 */
function readIds(table: Table, count: number): readonly string[] {
  return strings(table, 'gml_id', count)
}

/**
 * How many storeys each building stands above ground.
 *
 * This is what says how many rows of windows a wall gets, and PLATEAU leaves
 * it out for one building in ten here and four in ten in the older parts of
 * the city. A building that does not say reads as 0, and whoever draws it
 * works the count out from how tall it is instead.
 */
function readStoreys(table: Table, count: number, packed: Binary): Uint8Array {
  const storeys = new Uint8Array(count)
  const read = numbersOf(table, 'bldg:storeysAboveGround', count, packed)
  if (!read) return storeys
  for (let i = 0; i < count; i++) storeys[i] = storeyOf(read(i))
  return storeys
}

/**
 * What each building is for, in PLATEAU's own words: 住宅, 業務施設, 工場 and a
 * dozen more, with 不明 where the survey could not tell.
 *
 * They are kept as they came rather than gathered into kinds of our own. The
 * window settings are keyed by these, so a city drawn with settings for
 * 共同住宅 is asking for what PLATEAU means by it.
 */
function readUsages(table: Table, count: number): readonly string[] {
  return strings(table, 'bldg:usage', count)
}

/** One column as a list of strings, as long as the tile has buildings. */
function strings(table: Table, name: string, count: number): readonly string[] {
  const values = column(table, name)
  const out = new Array<string>(count).fill('')
  if (!values) return out
  for (let i = 0; i < count; i++) {
    const value = values[i]
    if (typeof value === 'string') out[i] = value
  }
  return out
}

/** The centre a glTF's vertices are measured from, if it carries one. */
function readCenter(glb: ArrayBuffer): readonly [number, number, number] | undefined {
  if (glb.byteLength < 20) return undefined
  const jsonBytes = new DataView(glb).getUint32(12, true)
  const gltf = json(glb, 20, jsonBytes) as {
    extensions?: { CESIUM_RTC?: { center?: unknown } }
  }
  const center = gltf.extensions?.CESIUM_RTC?.center
  if (!Array.isArray(center) || center.length < 3) return undefined
  const [x, y, z] = center as number[]
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? [x, y, z] : undefined
}
