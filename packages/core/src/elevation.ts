import { overlapsJapan } from './geo/japan.js'
import type { Position } from './events.js'
import {
  EARTH_CIRCUMFERENCE,
  metersPerUnit,
  WORLD_ORIGIN_X,
  WORLD_ORIGIN_Y,
  xToLon,
  yToLat,
  type WorldBounds,
} from './geo/mercator.js'
import { tileBounds, tileKey, tilesCovering, type TileId } from './geo/tiles.js'
import { transient } from './transient.js'
import { ASK_PLAINLY, type Ask } from './requests.js'

/**
 * How high the ground is, where anything wants to know.
 *
 * A threshold two layers have to agree on belongs to neither of them, and so
 * does a number. The ground lays its roads and its parks on the heights read
 * here and the buildings stand on the same readings, so neither has to know
 * of the other and the two cannot drift apart.
 *
 * ## Where it comes from
 *
 * The GSI's elevation tiles: a PNG a tile, 256 by 256 readings, the same
 * addresses as the map tiles the ground already fetches. `dem_png` (DEM10B,
 * about 10m to a reading, z1 to z14) is the one asked for. It is the only
 * one of the six that covers the whole country — of nineteen places sampled
 * across Japan, dem5a (5m, finer) missed three and dem1a missed eight, while
 * this one answered everywhere. A ladder down from the finer products would
 * fetch two tiles to find one and would step at the edge of what they cover,
 * and a step in the ground reads as a fault rather than as a hill.
 *
 * ## Which datum, and why that decides where a building stands
 *
 * These are 標高: metres above sea level, on the geoid. PLATEAU's buildings
 * carry a height too — their vertices are earth-centred, so the height that
 * falls out of them is above the **ellipsoid**, and in Japan the two differ
 * by 31 to 43 metres and that difference is not a constant. Measured: over
 * Chiyoda a leaf's own floor reads 36.77m where the ground reads 0, and the
 * geoid there is 36.76m; over Naha the same measurement gives 32.23m against
 * a geoid of 30.83m; over Matsumoto, 42.40m against 42.32m. The offset is the
 * geoid, everywhere.
 *
 * Nothing on a CDN hands out that geoid — the GSI's own calculator allows no
 * origin but its own — so a building's own height cannot be brought into the
 * same datum as the ground in a browser. It is not needed: a building is
 * stood on the reading under its foot, so it sits on the ground that is
 * actually drawn, and the whole question never arises. That is also why
 * `seat()` in Buildings may go on throwing the b3dm's own altitude away.
 *
 * ## What is not here
 *
 * No fetching of its own beyond the tiles a layer asks for, and no retrying:
 * whoever awaits a reading is loading a tile of their own, and that tile's
 * `TileSet` already knows how to wait and ask again. A tile the server
 * refuses (404, which is what the sea and anything past z14 answer) is
 * remembered as nothing there; one that fails is forgotten, so the next ask
 * goes out afresh.
 */

/** Where one elevation tile is fetched from. */
const GSI_ELEVATION = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png'

/**
 * The finest zoom the elevation tiles go to. Past it the server answers 404.
 *
 * This is what keeps the ground and the buildings on one surface. The ground
 * reads the heights for a floor tile at that tile's own zoom, or here where
 * the tile is finer; the buildings, which only ever stand from z18, read them
 * here always. At the zooms a city is looked at, both are reading this, so a
 * road and the building beside it are lying on the same numbers.
 */
export const FINEST_HEIGHTS = 14

/**
 * The coarsest zoom they go to. Below it, as past {@link FINEST_HEIGHTS}, the
 * server answers 404 — the set runs z1 to z14.
 *
 * Named rather than left at zero because it bounds the walk in {@link coming}
 * as much as it bounds what is asked for. A refusal is remembered by tile and
 * {@link missing} is never emptied, so a coarse tile stands for far too much
 * ground to answer for: there is one tile at zoom 0 and four at zoom 1. A
 * single 404 from `0/0/0` — which {@link heightZoom} used to hand out to any
 * page asking at that zoom, and which {@link overlapsJapan}, a box test,
 * lets through — would then be found under every place on earth for the life
 * of the page: nothing ever coming, every reading sea level, and the camera
 * no longer following the land.
 */
const COARSEST_HEIGHTS = 1

/** Readings across one tile, each way. */
export const TEXELS = 256

/**
 * How far apart the finest readings stand, in world units.
 *
 * One number for the whole country. The readings are laid on the Mercator
 * grid and so is everything drawn, so a texel is the same many world units in
 * Hokkaido as in Kyushu — the metres it covers shrink with the latitude
 * exactly as the metres of anything drawn there do.
 *
 * What wants it is whoever cuts a shape fine enough to follow the land: finer
 * than this buys nothing, since between two readings there is nothing to
 * follow but the straight line already being drawn.
 */
export const FINEST_STEP = EARTH_CIRCUMFERENCE / (1 << FINEST_HEIGHTS) / TEXELS

/** What one step of the packed number is worth, in metres. */
const STEP = 0.01

/**
 * The one packed value the specification keeps for "no reading here", which
 * is RGB (128, 0, 0) — the lowest number a 24-bit two's complement can hold,
 * so no real height is lost to it.
 *
 * Water is where it turns up: a tile over Tokyo bay came back with four
 * fifths of its readings empty. Read as the sea it came from, which is what
 * they are.
 */
const NO_READING = 0x80_00_00

/**
 * How many decoded tiles are held on to.
 *
 * One is 256KB opened out, so this is 32MB. Close in a screenful is a handful
 * of them — a z14 tile covers four of the ground's z16 tiles each way,
 * sixteen in all — but from the zoom the elevation stops at and out, the
 * ground's own tiles are these tiles, and it holds up to 64 on screen. Twice
 * that leaves room for the zoom stepped in from as well, which is what lets a
 * place not yet read finely stand at its coarse height rather than at nothing.
 */
const KEPT = 128

/** A tile's readings and where in the world they are. */
interface Holding {
  readonly readings: Float32Array
  readonly bounds: WorldBounds
}

/** The tiles opened out, longest unused first. */
const kept = new Map<string, Holding>()
/** Tiles being fetched now, so a second ask waits on the first. */
const asking = new Map<string, Promise<Float32Array | null>>()
/** Tiles the server said hold nothing: the sea, and anywhere off the map. */
const missing = new Set<string>()

/**
 * How many times the set of tiles in hand has changed.
 *
 * For whoever builds something out of the heights rather than reading them as
 * it draws — a shape laid on the land carries the land in its corners, so it
 * has to be built again when the land under it becomes known, or is let go of.
 * The heights are fetched by whoever draws the ground, so they land after such
 * a thing is built, and nothing tells it so.
 *
 * A number rather than a message because the asking is the cheap part: one
 * comparison a frame however many corners a page has laid down, and no layer
 * has to be on anybody's list to hear about it. What actually moved is
 * {@link heightsChangedSince}, for whoever would otherwise build everything
 * it holds over a tile that fell under one corner of it.
 */
let held = 0

/**
 * Where each of those changes was, newest last.
 *
 * Kept because a tile is small and what is laid on the land is not: over the
 * twenty-three wards of 東京, one tile landing had 118 filled shapes cut
 * afresh — 296ms — when it fell under two of them. A rectangle apiece is
 * enough for the ones it did not touch to be left alone.
 *
 * Only the last {@link REMEMBERED} of them. Anyone further behind than that
 * is told so rather than told a half-truth, and builds the lot: falling that
 * far behind means a zoom's worth of tiles has turned over, by which point
 * there is little left that has not moved.
 */
const moved: { readonly at: number; readonly bounds: WorldBounds }[] = []

/**
 * How many changes are remembered.
 *
 * A zoom over a city turns over a few dozen, so this is set past that: the
 * point is to still be able to answer after a step in or out, and to stop
 * short of holding a rectangle for every tile that ever landed.
 */
const REMEMBERED = 128

/** Nothing has moved. */
const NOTHING: readonly WorldBounds[] = []

/** @see {@link held} */
export function heightsVersion(): number {
  return held
}

/**
 * The rectangles the tiles in hand have changed over since a given version,
 * or null where that is further back than {@link REMEMBERED} — meaning
 * whoever is asking should build everything it has.
 *
 * Both ways round: a tile arriving raises the land under it, and one let go
 * of drops it. Neither is more urgent than the other, and neither can be told
 * from the other here, so the answer is where, not what.
 */
export function heightsChangedSince(version: number): readonly WorldBounds[] | null {
  if (version >= held) return NOTHING
  const oldest = moved[0]
  if (!oldest || oldest.at > version + 1) return null
  const out: WorldBounds[] = []
  for (const change of moved) if (change.at > version) out.push(change.bounds)
  return out
}

/** Writes down one change to the set of tiles in hand. The only place {@link held} moves. */
function note(bounds: WorldBounds): void {
  held++
  moved.push({ at: held, bounds })
  if (moved.length > REMEMBERED) moved.shift()
}

/** Which elevation zoom serves a tile zoom: its own, or the finest there is. */
export function heightZoom(tileZoom: number): number {
  return Math.min(FINEST_HEIGHTS, Math.max(COARSEST_HEIGHTS, Math.floor(tileZoom)))
}

/**
 * Waits for every elevation tile a patch of the world needs, then hands back
 * a reading over them.
 *
 * For whoever builds something once and keeps it: a tile of road laid on the
 * ground, a batch of buildings stood on it. What is built waits for the
 * heights rather than being built flat and moved later, so nothing is ever
 * drawn in the wrong place.
 *
 * A tile the server refuses is not waited for twice and reads as the sea; a
 * tile that fails throws, which whoever asked is already prepared for — they
 * are loading a tile of their own and it will be asked for again.
 */
export async function heightsUnder(
  bounds: WorldBounds,
  zoom: number,
  signal: AbortSignal,
  ask: Ask = ASK_PLAINLY,
): Promise<Heights> {
  const z = heightZoom(zoom)
  // A reading's worth further out on every side, for two reasons that meet
  // at the same edge. A place between two readings is read from the ones
  // either side of it, and at the edge one of those belongs to the next tile
  // along. And what asks for heights over a patch draws on that patch: a map
  // tile's own shapes are cut off exactly at its edges, and a ribbon runs
  // half its width past them, so a corner sits precisely where one tile of
  // readings ends and the next begins. Without this those corners find no
  // tile at all and are laid at sea level — a boundary line dropping 2,585m
  // between its two ends, which is what it looked like.
  const texel = EARTH_CIRCUMFERENCE / (1 << z) / TEXELS
  const wanted = tilesCovering(z, {
    minX: bounds.minX - texel,
    minY: bounds.minY - texel,
    maxX: bounds.maxX + texel,
    maxY: bounds.maxY + texel,
  }).filter((tile) => overlapsJapan(tileBounds(tile)))
  const readings = await Promise.all(wanted.map((tile) => heightTile(tile, signal, ask)))

  // Held by the reading itself, not just looked up in the cache as it is
  // used. What was waited for has to still be there when it is read, and at
  // the zooms where one of these covers one tile of the map a screenful of
  // them is the whole cache — so the last tile of a screen could otherwise
  // push out the first, and the ground under it would be laid at sea level.
  const held = new Map<number, Float32Array | null>()
  for (let i = 0; i < wanted.length; i++) {
    const tile = wanted[i]
    if (tile) held.set(packed(tile.z, tile.x, tile.y), readings[i] ?? null)
  }
  return new Heights(z, held)
}

/**
 * A reading from whatever tiles are already in hand, at whatever zoom they
 * came at.
 *
 * For whoever lays something on the land and cannot wait — a page's marks,
 * shapes and models, and the camera — and, until 2026-10-29, the ground's own
 * sheet, whose heights are read on the card now (`landHeights.ts`). It takes
 * the finest tile it finds and walks down from there, which is what keeps the
 * land from flattening in the two places it
 * otherwise would: while a view steps out, where the coarse tiles it is
 * asking for have not landed but the fine ones it stepped in on are still
 * held; and after a long visit elsewhere has pushed a held tile's own
 * readings out of the cache, where nothing would ever fetch them again
 * because the tile that wanted them is already built. The readings are of the
 * same land at either end, so what a mismatch costs is a corner of a wide
 * view drawn finer than the rest, well under a pixel of it.
 *
 * **The sheet on the card walks another way to the same end.** Its window
 * reads one tile a cell, at its own zoom, and where that tile is not in hand
 * it pieces one together from the finer tiles that are, up to two zooms finer
 * (`fromFiner` in `landHeights.ts`), before falling back down the coarser ones
 * ({@link finestHeld}). So a view stepping out past a whole zoom reads the
 * tiles it stepped out of until its own land. _(Until that was added, the
 * same day the window came: measured in the playground at 阿蘇, from z14.4 out
 * to z11.6 at four zooms a second, laid back 45°, 750×470, the land under the
 * middle of the view read 0m for five to nine frames at each whole zoom
 * crossed, where this reading had 1,421m all along.)_
 */
export function heightsInHand(): Heights {
  return new Heights(FINEST_HEIGHTS)
}

/**
 * A point of the world as a place on the map, the way every place the viewer
 * hands back is said: `x` east, `y` up and `z` south, in world units.
 *
 * The world stands as stretched upwards as it is across. The height is counted
 * from the land under the place and not from the world's plane, so that a
 * place handed back is a place that can be handed in (`Where` counts its
 * height from the land): with the land's heights on, a place clicked on a
 * model on a hill and put straight back into `at` stood the hill's height
 * again over the hill (2026-10-28). `readsLand` is whether the land is drawn
 * at its heights at all; where it is not, the land is the world's plane.
 *
 * One way of saying it for the click on anything and the click on a building,
 * which wrote it out twice.
 */
export function positionFromWorld(x: number, y: number, z: number, readsLand: boolean): Position {
  const lat = yToLat(-z)
  const land = readsLand ? heightsInHand().at(x, -z) : 0
  return { lng: xToLon(x), lat, height: y * metersPerUnit(lat) - land }
}

/**
 * How high the ground is at a place, as far as the tiles in hand can say.
 *
 * Made for one piece of work and thrown away: it remembers which tile it last
 * read, and the readings of a mesh walk across one tile in long runs, so the
 * tiles are looked up a handful of times rather than once a corner.
 */
export class Heights {
  private lastTile = -1
  private lastReadings: Float32Array | null = null
  /** The last patch a zoom was settled for, and what it settled on. */
  private lastPatch = -1
  private lastZoom = -1

  /**
   * @param z the zoom its readings are taken at
   * @param found the tiles it holds, by {@link packed}, which it is also
   *   where it remembers the ones it looks up as it goes. What was waited for
   *   is put in here, so it cannot be let go of while it is being read.
   */
  constructor(
    private readonly z: number,
    private readonly found = new Map<number, Float32Array | null>(),
  ) {}

  /**
   * Metres above sea level at a place, in world units, x east and y north.
   * Sea level where nothing is known, which is also what the sea reads.
   */
  at(x: number, y: number): number {
    return this.sample(x, y) ?? 0
  }

  /**
   * The same reading, or nothing at all while one may still turn up here.
   *
   * {@link at} answers nought for the sea and nought again for ground whose
   * tile has not arrived, and for a sheet corner or a shape's floor that is
   * the right answer either way: nought is where the sea is, and a corner of
   * ground nobody has heard of yet is better laid flat than left out.
   *
   * It is the wrong answer for the one reading that aims the camera. There,
   * nought is not a height but an admission, and taken as a height it drops
   * the eye from wherever the city stands to sea level between two frames —
   * 御殿場 is 500m up, so the picture leaps most of a screen and comes back
   * when the tile lands. Whoever needs to tell the two apart asks here.
   *
   * Nothing is answered only where a reading is still owed; over the sea and
   * off the map the answer is nought and is meant, so nobody waiting on this
   * waits for ever. See {@link coming}.
   */
  known(x: number, y: number): number | null {
    const metres = this.sample(x, y)
    if (metres !== undefined) return metres
    return this.coming(x, y) ? null : 0
  }

  /**
   * The reading itself, or nothing where no tile in hand covers the place.
   *
   * Split from {@link known} because the dear half of a miss is the half
   * almost nobody wants. Whoever is laying something down takes nought and
   * walks on — `drape.ts` asks a vertex at a time, and the land's own sheet
   * used to ask some 26,000 corners on every frame the view moved — while
   * telling a tile on its way from the open sea walks every zoom a tile could
   * have been asked for at — fourteen of them, a tile object and a key built
   * as a string and a set lookup apiece — and only the camera ever needs the
   * difference.
   *
   * Read between the four readings around the place rather than from the
   * nearest, so that a slope is a slope: a ground built of the nearest
   * reading comes out as a flight of ten-metre steps.
   */
  private sample(x: number, y: number): number | undefined {
    const zoom = this.finestAt(x, y)
    if (zoom < 0) return undefined

    const span = (1 << zoom) * TEXELS
    const scale = span / EARTH_CIRCUMFERENCE
    // A reading stands at the middle of its own texel, so the place is asked
    // for half a texel back and read between the two either side of it
    const across = (x + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2) * scale - 0.5
    const down = (EARTH_CIRCUMFERENCE / 2 - (y + WORLD_ORIGIN_Y)) * scale - 0.5
    const left = Math.floor(across)
    const top = Math.floor(down)
    const alongX = across - left
    const alongY = down - top

    const a = this.reading(left, top, zoom)
    const b = this.reading(left + 1, top, zoom)
    const c = this.reading(left, top + 1, zoom)
    const d = this.reading(left + 1, top + 1, zoom)
    // At the edge of what is in hand one of the four belongs to a tile that
    // is not. Standing in for it with a neighbour holds the ground level
    // there rather than dropping it to the sea
    const known = a ?? b ?? c ?? d
    if (known === undefined) return undefined
    const above = (a ?? known) + ((b ?? known) - (a ?? known)) * alongX
    const below = (c ?? known) + ((d ?? known) - (c ?? known)) * alongX
    return above + (below - above) * alongY
  }

  /**
   * The finest zoom it is allowed with a tile in hand over that place, or -1
   * where nothing covers it at all.
   *
   * Its own zoom is the finest it will take, and it walks down from there to
   * whatever is there. Settled once a tile rather than once a corner: a tile
   * is 256 readings across and a mesh walks it in long runs, and where
   * nothing at all has arrived the walk would otherwise be fifteen lookups
   * apiece.
   */
  private finestAt(x: number, y: number): number {
    const east = x + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2
    const south = EARTH_CIRCUMFERENCE / 2 - (y + WORLD_ORIGIN_Y)
    // Remembered against the finest tile the place falls in rather than
    // against its own, since that is the smallest patch over which the answer
    // is the same for every corner
    const finest = (1 << FINEST_HEIGHTS) / EARTH_CIRCUMFERENCE
    const patch = packed(FINEST_HEIGHTS, Math.floor(east * finest), Math.floor(south * finest))
    if (patch === this.lastPatch) return this.lastZoom

    let found = -1
    // Down to the coarsest the set publishes and no further. Below that there
    // is no tile to have arrived, so a turn of the loop there can only cost a
    // lookup; see {@link COARSEST_HEIGHTS}.
    for (let zoom = this.z; zoom >= COARSEST_HEIGHTS; zoom--) {
      // The place falls in exactly one tile at every zoom, so this is one
      // lookup a step rather than a search
      const step = (1 << zoom) / EARTH_CIRCUMFERENCE
      if (this.tile(Math.floor(east * step), Math.floor(south * step), zoom)) {
        found = zoom
        break
      }
    }
    this.lastPatch = patch
    this.lastZoom = found
    return found
  }

  /**
   * Whether a reading for that place may still turn up.
   *
   * "Nothing is known here" comes in two kinds and they want opposite
   * answers. A tile still on its way is one the camera should wait for,
   * holding where it stands rather than dropping to the sea and climbing back
   * a frame later. A tile the server has refused — the open sea, and anywhere
   * off the map — is one that is never coming, and sea level is not a guess
   * there but the answer.
   *
   * Asked at every zoom a tile could have been asked for at, {@link
   * COARSEST_HEIGHTS} up to this reading's own, rather than at that one
   * alone, because {@link missing} is written down against the zoom that was
   * asked at. The ground asks for its heights at its own tile's zoom, z4 up
   * to z14, while a reading from the tiles in hand always takes z14 — so at a
   * coarse view the refusal that says "open sea" is filed under z10 and a z14
   * question never meets it. Then nothing here is ever not coming, and the
   * camera holds the height of a hill it flew away from out over water.
   *
   * Off the map is a separate question with no refusal to find: those tiles
   * {@link heightsUnder} never asks for at all, so it is the same test it
   * filters by, put to the finest tile because that is the smallest patch and
   * so the sharpest answer — coarser up, every tile covers some of Japan.
   */
  private coming(x: number, y: number): boolean {
    const east = x + WORLD_ORIGIN_X + EARTH_CIRCUMFERENCE / 2
    const south = EARTH_CIRCUMFERENCE / 2 - (y + WORLD_ORIGIN_Y)
    const tileAt = (zoom: number): TileId => {
      const step = (1 << zoom) / EARTH_CIRCUMFERENCE
      return { z: zoom, x: Math.floor(east * step), y: Math.floor(south * step) }
    }
    for (let zoom = this.z; zoom >= COARSEST_HEIGHTS; zoom--) {
      if (missing.has(tileKey(tileAt(zoom)))) return false
    }
    return overlapsJapan(tileBounds(tileAt(this.z)))
  }

  /** One reading, by where it stands in the whole world's grid at that zoom. */
  private reading(across: number, down: number, zoom: number): number | undefined {
    const readings = this.tile(across >> 8, down >> 8, zoom)
    if (!readings) return undefined
    return readings[(down & 255) * TEXELS + (across & 255)]
  }

  /** One tile's readings, looked up once and remembered. */
  private tile(tx: number, ty: number, zoom: number): Float32Array | null {
    const at = packed(zoom, tx, ty)
    if (at === this.lastTile) return this.lastReadings
    let readings = this.found.get(at)
    if (readings === undefined) {
      readings = holdingsOf(zoom, tx, ty)
      this.found.set(at, readings)
    }
    this.lastTile = at
    this.lastReadings = readings
    return readings
  }
}

/** One tile's readings found in hand, and which tile they are. */
export interface HeldTile {
  readonly z: number
  readonly x: number
  readonly y: number
  readonly readings: Float32Array
}

/**
 * The finest tile in hand over a tile at some zoom: that tile itself, or the
 * nearest coarser one that covers it, or nothing at all.
 *
 * The walk {@link Heights} takes for a place, taken once for a whole tile,
 * for whoever hands the readings on rather than reading them — the land's
 * own sheet, whose heights are read on the card (`landHeights.ts`). Down
 * from the zoom asked for, never up: a tile finer than that is not found here
 * even where it is held, which {@link heightsInHand} would have read. Down to
 * {@link COARSEST_HEIGHTS} and no further, for the reason it gives. Finding a
 * tile keeps it from being let go of, as reading it does.
 */
export function finestHeld(z: number, x: number, y: number): HeldTile | null {
  for (let zoom = Math.min(z, FINEST_HEIGHTS); zoom >= COARSEST_HEIGHTS; zoom--) {
    const shift = z - zoom
    const tx = Math.floor(x / 2 ** shift)
    const ty = Math.floor(y / 2 ** shift)
    const readings = holdingsOf(zoom, tx, ty)
    if (readings) return { z: zoom, x: tx, y: ty, readings }
  }
  return null
}

/**
 * One tile's readings, if that very tile is in hand. For the edge a tile
 * shares with its neighbour, which is read from the neighbour at the same
 * zoom or not at all, as {@link Heights} reads it.
 */
export function heldAt(z: number, x: number, y: number): Float32Array | null {
  return holdingsOf(z, x, y)
}

/** One number standing for a tile, to look it up without building a string. */
export function packed(z: number, x: number, y: number): number {
  return z * 2 ** 28 + y * 2 ** 14 + x
}

/** What is held for a tile, if anything. Reading it keeps it from being let go of. */
function holdingsOf(z: number, x: number, y: number): Float32Array | null {
  const key = tileKey({ z, x, y })
  const holding = kept.get(key)
  if (!holding) return null
  // Longest unused goes first, and this one has just been used
  kept.delete(key)
  kept.set(key, holding)
  return holding.readings
}

/**
 * One elevation tile, fetched and opened out, or null where there is none.
 *
 * Many parts of one screen want the same tile — sixteen of the ground's
 * tiles, four each way, share one of these — so a second ask waits on the
 * first rather than fetching it again.
 */
async function heightTile(tile: TileId, signal: AbortSignal, ask: Ask): Promise<Float32Array | null> {
  const key = tileKey(tile)
  if (missing.has(key)) return null
  const held = holdingsOf(tile.z, tile.x, tile.y)
  if (held) return held

  const waiting = asking.get(key)
  if (waiting) return waitWith(waiting, signal)

  // Not hung off the asker's signal: the others waiting on it have signals of
  // their own, and the first of them giving up would cancel it for all.
  const task = fetchHeights(tile, ask)
    .then((readings) => {
      if (readings) hold(tile, key, readings)
      else missing.add(key)
      return readings
    })
    .finally(() => {
      if (asking.get(key) === task) asking.delete(key)
    })
  asking.set(key, task)
  return waitWith(task, signal)
}

/**
 * Waits for a tile, or for the asker to give up, whichever comes first.
 *
 * Giving up is the asker's own business: the fetch carries on for whoever
 * else is waiting on it, and lands in the cache for whoever asks next. But
 * the asker has to come back at once — a building tile may be one of six the
 * line is held open for, and six of them parked on one tile of readings is
 * the whole city standing still until it answers.
 *
 * The asker's signal is let go of again once the tile has answered. A tile's
 * own signal is aborted when the tile is dropped, which used to be what took
 * the listener off; but the viewer's lifetime signal is handed in as well —
 * the window of heights the card reads asks with it every time it moves
 * (`landHeights.ts`) — and that one is aborted once, when the viewer goes.
 * Until 2026-10-29 every wait left a listener on it. Measured in the
 * playground, the heights on, ten jumps of the view at z14.5 to ground not
 * seen before: 140 added and none taken off. Now, over ten other such jumps,
 * 108 added and 108 taken off.
 */
function waitWith(task: Promise<Float32Array | null>, signal: AbortSignal): Promise<Float32Array | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise<Float32Array | null>((resolve, reject) => {
    const stop = (): void => resolve(null)
    signal.addEventListener('abort', stop, { once: true })
    task.then(
      (readings) => {
        signal.removeEventListener('abort', stop)
        resolve(readings)
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', stop)
        reject(cause)
      },
    )
  })
}

/** Holds a tile's readings, letting the longest unused go once there are too many. */
function hold(tile: TileId, key: string, readings: Float32Array): void {
  const bounds = tileBounds(tile)
  kept.set(key, { readings, bounds })
  // Here and nowhere else. This is the one place the tiles in hand become a
  // different set: `holdingsOf` takes a key out and puts it back to move it to
  // the end of the queue, which changes what is read by nothing, and a tile
  // found to be missing changes what is read by nothing either
  note(bounds)
  for (const [oldest, gone] of kept) {
    if (kept.size <= KEPT) break
    kept.delete(oldest)
    // A tile let go of drops the land back to whatever coarser tile is still
    // held under it, which is as much a change to what is drawn as its
    // arrival was
    note(gone.bounds)
  }
}

async function fetchHeights(tile: TileId, ask: Ask): Promise<Float32Array | null> {
  const res = await ask(`${GSI_ELEVATION}/${tile.z}/${tile.x}/${tile.y}.png`, 'elevation')
  // Only a moment's trouble is worth asking about again. A 404 is the answer
  // over the open sea and anywhere past the finest zoom, and asking again
  // would fetch the whole ocean once a minute for ever
  if (transient(res.status)) throw new Error(`${res.status}`)
  if (!res.ok) return null
  return unpack(await res.blob())
}

/**
 * The readings out of one PNG.
 *
 * Drawn onto a canvas and read back, which is the only way a browser hands
 * over the bytes of a PNG. Both the colour management a browser would
 * otherwise apply and the alpha it would otherwise fold in are turned off:
 * these are not colours, they are a 24-bit number in three bytes, and either
 * would quietly shift it.
 */
async function unpack(png: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    const canvas = new OffscreenCanvas(TEXELS, TEXELS)
    const paper = canvas.getContext('2d', { willReadFrequently: true })
    if (!paper) throw new Error('no 2d context')
    paper.drawImage(bitmap, 0, 0)
    return decode(paper.getImageData(0, 0, TEXELS, TEXELS).data)
  } finally {
    bitmap.close()
  }
}

/**
 * The GSI's own reckoning: the three colour bytes are one 24-bit two's
 * complement number of centimetres.
 *
 * Checked against the tile the specification itself works through
 * (dem_png/14/14547/6463): its corners come out at 5.23m, 0.93m and 2.45m,
 * which is what the text edition of the same tile says, and the fourth is
 * empty in both. Fuji's tile tops out at 3774.04m against a summit of
 * 3776.12m — the readings are the average over a 10m square, so a peak is
 * blunted by a metre or two.
 */
function decode(pixels: Uint8ClampedArray): Float32Array {
  const heights = new Float32Array(TEXELS * TEXELS)
  for (let i = 0; i < heights.length; i++) {
    const at = i * 4
    const value = (pixels[at]! << 16) | (pixels[at + 1]! << 8) | pixels[at + 2]!
    if (value === NO_READING) continue
    heights[i] = (value < NO_READING ? value : value - 0x1_00_00_00) * STEP
  }
  return heights
}
