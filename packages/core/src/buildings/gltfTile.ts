/**
 * A tile that is the glTF itself, as 3D Tiles 1.1 sends it.
 *
 * There is no wrapper and no batch table. The shapes are the file's, and what
 * the survey says about each building is inside it: a property table under
 * `EXT_structural_metadata`, and a vertex attribute (`EXT_mesh_features`)
 * saying which row of that table a corner belongs to. The centre the vertices
 * are measured from is the one node's own translation rather than a
 * CESIUM_RTC extension.
 *
 * The columns are named as the batch table named them — `gml_id`,
 * `bldg:usage`, `bldg:storeysAboveGround` — with one exception, which is why
 * {@link namesOf} exists.
 */
import { json, storeyOf, text, type BuildingAttributes, type TileContent } from './tileContent.js'
import { Unreadable } from '../transient.js'

/** Where the JSON chunk's length sits, and where the chunk itself begins. */
const JSON_LENGTH_AT = 12
const JSON_AT = 20
/** A chunk is a length and a type before its bytes. */
const CHUNK_HEADER_BYTES = 8

export function readGltfTile(data: ArrayBuffer): TileContent {
  const magic = text(data, 0, 4)
  if (magic !== 'glTF') throw new Unreadable(`not a glTF tile (magic "${magic}")`)

  const jsonBytes = new DataView(data).getUint32(JSON_LENGTH_AT, true)
  const gltf = json(data, JSON_AT, jsonBytes) as Gltf
  // The JSON chunk is padded to four bytes by the format, so the binary that
  // follows begins at its end plus that chunk's own header
  const binaryAt = JSON_AT + jsonBytes + CHUNK_HEADER_BYTES

  const table = gltf.extensions?.EXT_structural_metadata?.propertyTables?.[0]
  const count = table?.count ?? 0
  // How many rows the table has sizes every column read below, so it is held
  // to what the file could hold: a row takes a byte at the least. A count
  // written as 10^8 in a tile of a few hundred bytes was a gigabyte of empty
  // columns before anything was read (found in review)
  if (!Number.isInteger(count) || count < 0 || count > data.byteLength) {
    throw new Unreadable(`a glTF tile says its table has ${count} rows`)
  }
  const read = table ? new Columns(gltf, data, binaryAt, table) : null
  const attributes = read?.strings('attributes') ?? []

  return {
    // The whole file: there is nothing wrapped round the glTF to strip
    glb: data,
    center: centerOf(gltf),
    ids: read?.strings('gml_id') ?? blank(count),
    storeys: storeysOf(read, count),
    usages: read?.strings('bldg:usage') ?? blank(count),
    names: namesOf(attributes, count),
    attributesAt: attributesOf(attributes),
  }
}

/**
 * The survey's own document for one building; see {@link BuildingFacts.attributesAt}.
 *
 * Here the documents are text — one JSON string per building in the
 * `attributes` column — so the one that is asked for is parsed and kept, and
 * the rest are never touched. A tile of 上野 holds 6,871 of them; parsing all
 * of them to answer about one is the cost {@link namesOf} already goes out of
 * its way to avoid.
 */
function attributesOf(written: readonly string[]): (at: number) => BuildingAttributes | null {
  const parsed = new Map<number, BuildingAttributes | null>()
  return (at) => {
    const held = parsed.get(at)
    if (held !== undefined) return held
    let value: BuildingAttributes | null = null
    const one = written[at]
    if (one) {
      try {
        const read: unknown = JSON.parse(one)
        if (typeof read === 'object' && read !== null) value = read as BuildingAttributes
      } catch {
        // A document that will not parse is a building the survey said nothing
        // readable about, which is the same answer as saying nothing
      }
    }
    parsed.set(at, value)
    return value
  }
}

/**
 * What each building is called.
 *
 * The property table has no `gml:name` column. The name is inside `attributes`
 * instead — one JSON document per building, holding everything the table did
 * not give a column of its own, with the name among its keys.
 *
 * Parsing all of them to find the few that carry one costs more than it is
 * worth: 43 buildings in 6,871 over 上野 have a name at all. So the text is
 * searched first and parsed only where the key is actually in it, which leaves
 * the other 99% as one `indexOf` each.
 */
function namesOf(attributes: readonly string[], count: number): readonly string[] {
  const names = blank(count)
  for (let i = 0; i < count; i++) {
    const written = attributes[i]
    if (!written || !written.includes('"gml:name"')) continue
    try {
      const value: unknown = (JSON.parse(written) as Record<string, unknown>)['gml:name']
      if (typeof value === 'string') names[i] = value
    } catch {
      // A building whose attributes will not parse is a building with no name,
      // which is what almost all of them are anyway
    }
  }
  return names
}

function storeysOf(read: Columns | null, count: number): Uint8Array {
  const storeys = new Uint8Array(count)
  const numbers = read?.numbers('bldg:storeysAboveGround')
  if (!numbers) return storeys
  for (let i = 0; i < count; i++) storeys[i] = storeyOf(numbers[i] ?? 0)
  return storeys
}

/**
 * The centre the vertices are measured from.
 *
 * 3D Tiles 1.0 carries it as a CESIUM_RTC extension, which glTF readers do not
 * know and so leave the vertices alone. Here it is an ordinary node
 * translation, which they do know — so whoever loads the file must undo it,
 * or the tile is placed twice. See where the meshes are gathered in
 * `Buildings.standTile`.
 *
 * And it is written on glTF's axes rather than the earth's. CESIUM_RTC sits
 * outside the model and gives earth-centred metres as they are; a node
 * translation is part of the model, so the same point is written y-up. Handed
 * over unturned it reads as a place in the Southern Ocean off South Australia
 * — the tile stood at 136.9°E, 35.5°S instead of 139.8°E, 35.5°N — which is
 * what the buildings of 上野 did before this turned it back.
 */
function centerOf(gltf: Gltf): readonly [number, number, number] | undefined {
  for (const node of gltf.nodes ?? []) {
    const at = node.translation
    if (!Array.isArray(at) || at.length < 3) continue
    const [x, y, z] = at
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') return [x, -z, y]
  }
  return undefined
}

/**
 * One tile's property table, read a column at a time.
 *
 * A column's values lie in a buffer view; text columns have a second one
 * holding where each string ends. Nothing is read until a column is asked
 * for, since the table has 44 of them and four are wanted.
 */
class Columns {
  private readonly views: readonly BufferView[]
  private readonly properties: Record<string, TableProperty>
  private readonly types: Record<string, ClassProperty>

  constructor(
    gltf: Gltf,
    private readonly data: ArrayBuffer,
    private readonly binaryAt: number,
    table: PropertyTable,
  ) {
    this.views = gltf.bufferViews ?? []
    this.properties = table.properties ?? {}
    const classes = gltf.extensions?.EXT_structural_metadata?.schema?.classes ?? {}
    this.types = classes[table.class]?.properties ?? {}
    this.count = table.count
  }

  private readonly count: number

  /** A column of text, as long as the table is. '' where the column is missing. */
  strings(name: string): string[] {
    const out = blank(this.count)
    const column = this.properties[name]
    const values = this.bytes(column?.values)
    const offsets = this.bytes(column?.stringOffsets)
    if (!values || !offsets) return out

    // How wide an offset is, which the table says and the extension lets be
    // any of four widths. Read rather than assumed: the numbers beside this
    // already honour what their schema says they are, and a table written in
    // 16-bit offsets read as 32-bit gives every name the wrong bytes — or,
    // where the view is then too short for the count, throws outright.
    //
    // 64-bit offsets are left alone rather than half-read. They would want
    // BigInt arithmetic for a column that cannot be four gigabytes long in a
    // tile, and a name is something a page may show where it is there and
    // never something it may count on: no name is the answer this survey gives
    // for all but a handful of buildings anyway.
    const wide = OFFSETS[column?.stringOffsetType ?? 'UINT32']
    if (!wide) return out
    // Copied rather than viewed in place: a buffer view begins wherever the
    // file put it, and a typed array over an unaligned offset throws
    const room = Math.floor(offsets.length / wide.BYTES_PER_ELEMENT)
    if (room < this.count + 1) return out
    const ends = new wide(offsets.slice().buffer, 0, this.count + 1)

    const decoder = new TextDecoder()
    for (let i = 0; i < this.count; i++) {
      const from = ends[i] ?? 0
      const to = ends[i + 1] ?? from
      if (to > from && to <= values.length) out[i] = decoder.decode(values.subarray(from, to))
    }
    return out
  }

  /** A column of numbers, however wide the schema says each one is. */
  numbers(name: string): ArrayLike<number> | undefined {
    const values = this.bytes(this.properties[name]?.values)
    if (!values) return undefined
    const kind = KINDS[this.types[name]?.componentType ?? '']
    if (!kind) return undefined
    const room = Math.min(this.count, Math.floor(values.length / kind.BYTES_PER_ELEMENT))
    return new kind(values.slice().buffer, 0, room)
  }

  /** The bytes of one buffer view, or nothing where it is not there. */
  private bytes(at: number | undefined): Uint8Array | undefined {
    if (at === undefined) return undefined
    const view = this.views[at]
    if (!view) return undefined
    const from = this.binaryAt + (view.byteOffset ?? 0)
    if (from + view.byteLength > this.data.byteLength) return undefined
    return new Uint8Array(this.data, from, view.byteLength)
  }
}

/** How wide each kind of number the schema can name is. */
const KINDS: Record<
  string,
  (new (buffer: ArrayBuffer, at: number, length: number) => ArrayLike<number>) & { BYTES_PER_ELEMENT: number }
> = {
  INT8: Int8Array,
  UINT8: Uint8Array,
  INT16: Int16Array,
  UINT16: Uint16Array,
  INT32: Int32Array,
  UINT32: Uint32Array,
  FLOAT32: Float32Array,
  FLOAT64: Float64Array,
}

function blank(count: number): string[] {
  return new Array<string>(count).fill('')
}

interface BufferView {
  byteOffset?: number
  byteLength: number
}

/** How wide the offsets into a column of text are; see {@link Columns.strings}. */
const OFFSETS: Record<
  string,
  (new (buffer: ArrayBuffer, at: number, length: number) => ArrayLike<number>) & { BYTES_PER_ELEMENT: number }
> = {
  UINT8: Uint8Array,
  UINT16: Uint16Array,
  UINT32: Uint32Array,
}

interface TableProperty {
  values?: number
  stringOffsets?: number
  /** `UINT8`, `UINT16`, `UINT32` or `UINT64`. The extension's own default is `UINT32`. */
  stringOffsetType?: string
}

interface ClassProperty {
  type?: string
  componentType?: string
}

interface PropertyTable {
  class: string
  count: number
  properties?: Record<string, TableProperty>
}

interface Gltf {
  nodes?: { translation?: unknown }[]
  bufferViews?: BufferView[]
  extensions?: {
    EXT_structural_metadata?: {
      schema?: { classes?: Record<string, { properties?: Record<string, ClassProperty> }> }
      propertyTables?: PropertyTable[]
    }
  }
}
