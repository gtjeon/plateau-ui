/**
 * Mapbox Vector Tiles, read from the bytes.
 *
 * A vector tile is not a picture. It carries the shapes themselves — roads as
 * lines, parks as polygons — clipped to the tile and written as Protocol
 * Buffers, with the coordinates as integers on the tile's own grid rather
 * than as degrees. Three parts of this library read them: the ground draws
 * the map's roads and water, the land use says where the green is, and the
 * buildings ask which of their walls has a road in front of it.
 *
 * Read here rather than taken from a library because of what it actually is.
 * Everything else this library reads is unwrapped by hand — a b3dm is a
 * header and a blob, a glTF tile is a length and some JSON — and this is the
 * one format with a wire protocol under it. That protocol is six field types
 * and a varint, and the tile schema on top of it is four messages. The whole
 * of what the rest of this library asks of a tile is on {@link VectorTile}
 * below: three nouns and one verb.
 *
 * What is deliberately not here: turning a tile into GeoJSON, a feature's
 * bounding box, a feature's id, and sorting rings into outers and holes. The
 * last is the interesting omission — `PolygonBuilder` already does it with
 * its own `signedArea`, so a reader that did it too would be a second opinion
 * nobody asked for.
 */
import type { Point } from './polygons.js'
import { Unreadable } from './transient.js'

/** What a layer's grid is cut into each way where it does not say. */
const DEFAULT_EXTENT = 4096

/** Seven bits to a byte, so sixty-four bits take ten of them and never more. */
const LONGEST_VARINT = 10

/** Stands in for a byte past the end, and ends any number it is read into. */
const END = 0

/*
 * Protobuf writes a field as one varint key — the field number shifted up
 * three, with the wire type in the low three bits — so the numbers below are
 * keys and not field numbers. Spelt out rather than worked out, because the
 * key is what the reader actually compares against and a number it has to
 * take apart first is a number read twice.
 */
const TILE_LAYER = 26 // 3, length-delimited

const LAYER_NAME = 10 // 1, length-delimited
const LAYER_FEATURE = 18 // 2, length-delimited
const LAYER_KEY = 26 // 3, length-delimited
const LAYER_VALUE = 34 // 4, length-delimited
const LAYER_EXTENT = 40 // 5, varint

const FEATURE_TAGS = 18 // 2, length-delimited (packed varints)
const FEATURE_TYPE = 24 // 3, varint
const FEATURE_GEOMETRY = 34 // 4, length-delimited (packed varints)

const VALUE_STRING = 10 // 1, length-delimited
const VALUE_FLOAT = 21 // 2, 32-bit
const VALUE_DOUBLE = 25 // 3, 64-bit
const VALUE_INT = 32 // 4, varint
const VALUE_UINT = 40 // 5, varint
const VALUE_SINT = 48 // 6, varint, zigzag
const VALUE_BOOL = 56 // 7, varint

/** The three the geometry is drawn with; see {@link Feature.loadGeometry}. */
const MOVE_TO = 1
const LINE_TO = 2
const CLOSE_PATH = 7

/** One tile's layers, by the name the tile gives each. */
export interface VectorTile {
  /**
   * A layer with no features is left out, so a name that is in here has
   * something behind it. Null-prototype, so a layer called `constructor`
   * is a layer and not a surprise.
   */
  readonly layers: Readonly<Record<string, VectorTileLayer>>
}

/** One named layer of a tile: a grid size, and the shapes drawn on that grid. */
export interface VectorTileLayer {
  /** How many steps across the tile is, on this layer's own grid. */
  readonly extent: number
  /** How many features it holds. */
  readonly length: number
  /**
   * One of them. Read when asked for rather than up front, since most of a
   * map tile is features the reader goes on to skip on their properties
   * alone.
   */
  feature(at: number): VectorTileFeature
}

/** One shape, and whatever the publisher wrote about it. */
export interface VectorTileFeature {
  /** 1 point, 2 line, 3 polygon; 0 where the tile does not say. */
  readonly type: number
  /** The publisher's own keys and values. Null-prototype, as above. */
  readonly properties: Readonly<Record<string, unknown>>
  /**
   * The shape, as rings of points on the layer's grid.
   *
   * A point feature is one ring of one point, a line is a ring per stroke, a
   * polygon is a ring per loop — the loops in the order the tile wrote them,
   * which is not an order that says which is a hole. Closed, so a polygon's
   * last point is its first again.
   *
   * Read on asking and not held: a caller that wants it twice is a caller
   * that should keep it.
   */
  loadGeometry(): Point[][]
}

/**
 * Reads one tile.
 *
 * The bytes are kept and read from where they lie — a feature remembers where
 * its geometry starts and comes back to it — so whoever holds a tile must hold
 * the bytes still. Nothing here writes to them.
 */
export function readVectorTile(bytes: Uint8Array): VectorTile {
  const reader = new Reader(bytes)
  const layers: Record<string, VectorTileLayer> = Object.create(null) as Record<string, VectorTileLayer>
  while (reader.at < reader.end) {
    const key = reader.varint()
    if (key !== TILE_LAYER) {
      reader.step(key)
      continue
    }
    const layer = new Layer(reader, reader.until())
    // A layer that drew nothing is a layer that is not there, which saves
    // every reader a test it would otherwise write for every name it asks for
    if (layer.length > 0 && layer.name) layers[layer.name] = layer
  }
  return { layers }
}

/**
 * A tile that stops in the middle of itself.
 *
 * A plain error, deliberately: `TileSet` reads {@link Unreadable} as "this
 * will read the same next time" and stops asking, which is the right answer
 * for a form it cannot read and the wrong one for half a download. Half a
 * download is worth asking for again.
 */
function cutShort(what: string): Error {
  return new Error(`vector tile: ${what} runs past the end of the tile`)
}

/** Bytes that are all there and are still not this format. Asking again gets the same. */
function wrongBytes(what: string): Error {
  return new Unreadable(`vector tile: ${what} is not written in a way this can read`)
}

/**
 * A cursor over the bytes, reading protobuf's wire types.
 *
 * Six of them exist; three are used by this format and one more is needed to
 * step over what a newer writer may have added. Groups — protobuf's wire
 * types 3 and 4 — were deprecated before this format was written and are
 * refused rather than guessed at.
 */
class Reader {
  at = 0
  readonly end: number
  private readonly view: DataView
  private readonly text = new TextDecoder()

  constructor(private readonly bytes: Uint8Array) {
    this.end = bytes.length
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  /**
   * A varint, seven bits of it to a byte, least significant first.
   *
   * Built by multiplying rather than by shifting, since shifts in JavaScript
   * are 32-bit and the format's integers are not. Exact to 2^53, past which a
   * number here loses its last digits — the same place any reader that hands
   * back a JavaScript number gives up, and well past anything a tile holds.
   * The one-byte case is almost all of them, so it returns before the loop.
   */
  varint(): number {
    let byte = this.bytes[this.at++] ?? END
    if (byte < 0x80) return byte
    let value = byte & 0x7f
    let scale = 128
    for (let more = 1; more < LONGEST_VARINT; more++) {
      byte = this.bytes[this.at++] ?? END
      value += (byte & 0x7f) * scale
      if (byte < 0x80) return value
      scale *= 128
    }
    // Ten bytes without an end: either the tile stops mid-number or these
    // bytes were never one. Said out loud rather than returned as whatever
    // had been gathered — `END` keeps the loop from running away, and a quiet
    // wrong number is the failure this format is worst at showing.
    throw this.at > this.end ? cutShort('a number') : wrongBytes('a number')
  }

  /**
   * A varint written as an `int64`: two's complement, so a negative number is
   * all ten bytes and reads, unsigned, as some 1.8e19. Read again exactly
   * where it is that large — a float sum of ten bytes cannot tell −1 from 0
   * once 2^64 is taken off — and brought back to a number, which holds it as
   * exactly as {@link varint} holds a positive one. `uint64` is a varint as it
   * stands.
   */
  int64(): number {
    const begun = this.at
    const value = this.varint()
    if (value < 2 ** 63) return value
    this.at = begun
    let exact = 0n
    for (let shift = 0n; ; shift += 7n) {
      const byte = this.bytes[this.at++] ?? END
      exact |= BigInt(byte & 0x7f) << shift
      if (byte < 0x80) break
    }
    return Number(BigInt.asIntN(64, exact))
  }

  /**
   * A varint written zigzag, which is how a signed number is kept small: the
   * sign goes in the low bit so that −1 is 1 rather than sixty-four ones.
   */
  signed(): number {
    const written = this.varint()
    return written % 2 === 0 ? written / 2 : -(written + 1) / 2
  }

  float(): number {
    if (this.at + 4 > this.end) throw cutShort('a number')
    const value = this.view.getFloat32(this.at, true)
    this.at += 4
    return value
  }

  double(): number {
    if (this.at + 8 > this.end) throw cutShort('a number')
    const value = this.view.getFloat64(this.at, true)
    this.at += 8
    return value
  }

  /**
   * Where the field that starts here ends: a length, counted from after it.
   *
   * The one place this arithmetic lives. Written at each call site as
   * `this.at += this.varint()` it is wrong — JavaScript reads the left of
   * `+=` first, so the length lands on the position from *before* the length
   * itself was read and the cursor stops one byte short. That was a real bug
   * here, and six places wanted the same sum, so the sum is written once.
   */
  until(): number {
    const length = this.varint()
    const end = this.at + length
    if (end > this.end) throw cutShort('a field')
    return end
  }

  /**
   * A length and then that many bytes of UTF-8.
   *
   * Through {@link until} rather than counting again, so a name whose length
   * reaches past the tile is caught here too. Left to `subarray` it would be
   * clipped without a word and come back as a shorter name.
   */
  string(): string {
    const end = this.until()
    const from = this.at
    this.at = end
    return this.text.decode(this.bytes.subarray(from, end))
  }

  /** Past a field this reader does not read, whatever it holds. */
  step(key: number): void {
    switch (key & 0x7) {
      case 0:
        this.varint()
        return
      case 1:
        this.at += 8
        return
      case 2:
        this.at = this.until()
        return
      case 5:
        this.at += 4
        return
      default:
        throw wrongBytes(`field ${key >> 3}`)
    }
  }
}

class Layer implements VectorTileLayer {
  readonly name: string = ''
  readonly extent: number = DEFAULT_EXTENT
  readonly length: number
  /** Where each feature's own bytes begin, so one can be read without the rest. */
  private readonly starts: number[] = []
  private readonly keys: string[] = []
  private readonly values: unknown[] = []

  constructor(
    private readonly reader: Reader,
    end: number,
  ) {
    while (reader.at < end) {
      const key = reader.varint()
      switch (key) {
        case LAYER_NAME:
          this.name = reader.string()
          break
        case LAYER_FEATURE:
          // Noted and stepped over. Reading them all here would mean holding
          // every feature of a map tile to answer about the handful a caller
          // goes on to want.
          this.starts.push(reader.at)
          reader.step(key)
          break
        case LAYER_KEY:
          this.keys.push(reader.string())
          break
        case LAYER_VALUE:
          this.values.push(readValue(reader))
          break
        case LAYER_EXTENT:
          this.extent = reader.varint()
          break
        default:
          reader.step(key)
      }
    }
    this.length = this.starts.length
  }

  feature(at: number): VectorTileFeature {
    const start = this.starts[at]
    if (start === undefined) throw new Error(`vector tile: no feature ${at} in layer "${this.name}"`)
    this.reader.at = start
    return new Feature(this.reader, this.reader.until(), this.keys, this.values)
  }
}

class Feature implements VectorTileFeature {
  readonly type: number = 0
  readonly properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  /** Where its geometry lies, or −1 for a feature that drew nothing. */
  private geometry = -1

  constructor(
    private readonly reader: Reader,
    end: number,
    keys: readonly string[],
    values: readonly unknown[],
  ) {
    while (reader.at < end) {
      const key = reader.varint()
      switch (key) {
        case FEATURE_TAGS: {
          // Pairs: which key, then which value. Both are numbers into the
          // layer's own lists, which is how a tile says `種別: 国道` ten
          // thousand times and spells each word once.
          const until = reader.until()
          while (reader.at < until) {
            const name = keys[reader.varint()]
            const value = values[reader.varint()]
            if (name !== undefined) this.properties[name] = value
          }
          break
        }
        case FEATURE_TYPE:
          this.type = reader.varint()
          break
        case FEATURE_GEOMETRY:
          this.geometry = reader.at
          reader.step(key)
          break
        default:
          reader.step(key)
      }
    }
  }

  loadGeometry(): Point[][] {
    if (this.geometry < 0) return []
    const reader = this.reader
    reader.at = this.geometry
    const end = reader.until()

    const rings: Point[][] = []
    let ring: Point[] | undefined
    let command = MOVE_TO
    let left = 0
    let x = 0
    let y = 0

    while (reader.at < end) {
      if (left <= 0) {
        // One number carries both: the command in the low three bits, and how
        // many times to do it in the rest. A count of none is a writer saying
        // nothing, not an end.
        const written = reader.varint()
        command = written & 0x7
        left = written >> 3
        if (left === 0) continue
      }
      left--

      if (command === MOVE_TO) {
        x += reader.signed()
        y += reader.signed()
        if (ring) rings.push(ring)
        ring = [{ x, y }]
      } else if (command === LINE_TO) {
        x += reader.signed()
        y += reader.signed()
        if (ring) ring.push({ x, y })
      } else if (command === CLOSE_PATH) {
        // Closed by repeating the corner it started at, rather than by a flag
        // on the ring: what reads these walks pairs of points, and a loop that
        // says it is closed without saying where is a loop with a gap in it.
        const first = ring?.[0]
        if (first) ring?.push({ x: first.x, y: first.y })
        // Once, whatever count it was written with. The format has it as one
        // and nothing else; the count is the only thing that keeps this loop
        // going, since closing reads no bytes, so a count of 2^28 written in
        // five bytes was 2^28 corners pushed — a tile of twenty bytes that
        // took the page down (found in review; reproduced, 10^7 repeats
        // filled 486 MB)
        left = 0
      } else {
        // Bytes that are all there and are not a geometry: asked for again,
        // the same bytes come back
        throw wrongBytes(`geometry command ${command}`)
      }
    }

    if (ring) rings.push(ring)
    return rings
  }
}

/**
 * One value from the layer's list.
 *
 * The message has a field per kind and holds exactly one of them. A later
 * field wins where a writer sent two, which is what a reader walking the
 * message to its end comes to, and nothing in this format sends two.
 */
function readValue(reader: Reader): unknown {
  const end = reader.until()
  let value: unknown = null
  while (reader.at < end) {
    const key = reader.varint()
    switch (key) {
      case VALUE_STRING:
        value = reader.string()
        break
      case VALUE_FLOAT:
        value = reader.float()
        break
      case VALUE_DOUBLE:
        value = reader.double()
        break
      case VALUE_INT:
        value = reader.int64()
        break
      case VALUE_UINT:
        value = reader.varint()
        break
      case VALUE_SINT:
        value = reader.signed()
        break
      case VALUE_BOOL:
        value = reader.varint() !== 0
        break
      default:
        reader.step(key)
    }
  }
  return value
}
