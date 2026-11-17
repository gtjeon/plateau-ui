import { latToY, lonToX, type WorldBounds } from '../geo/mercator.js'
import { transient } from '../transient.js'
import { ASK_PLAINLY, type Ask } from '../requests.js'

const CATALOG = 'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles'

/** How much detail the buildings are asked for. */
export type BuildingLod = 1 | 2

/**
 * Datasets to try for each level, best first.
 *
 * The textureless LOD2 has the same shapes as the textured one without an image
 * in every tile, which is what we want: the colours come from the palette. When
 * a city has no LOD2 we fall back to LOD1.
 */
const DATASETS: Record<BuildingLod, readonly (readonly [string, BuildingLod])[]> = {
  2: [
    ['bldg-lod2-notexture', 2],
    ['bldg-lod1', 1],
  ],
  1: [['bldg-lod1', 1]],
}

/**
 * One tile of a building tileset, with the tiles below it.
 *
 * The files refine by replacing and mean it. A tile holds the tallest
 * buildings of its patch; its children hold those same ones again and add the
 * shorter ones, so every building in a parent reappears below it and siblings
 * share none. A tile does stand in for what is under it, and only the deepest
 * ones on screen are drawn.
 */
export interface BuildingTile {
  /** Absolute URL of the tile content. */
  url: string
  /** West, south, east and north in radians, then lowest and highest metres. */
  region: readonly [number, number, number, number, number, number]
  children: BuildingTile[]
}

/** Where a tile's region falls on the Mercator ground. */
export function worldBoundsOf(tile: BuildingTile): WorldBounds {
  const degrees = 180 / Math.PI
  return {
    minX: lonToX(tile.region[0] * degrees),
    minY: latToY(tile.region[1] * degrees),
    maxX: lonToX(tile.region[2] * degrees),
    maxY: latToY(tile.region[3] * degrees),
  }
}

export interface BuildingTileset {
  city: string
  /** The level the data actually is, which may be lower than the one asked for. */
  lod: BuildingLod
  /**
   * Where the walk down begins. Usually one tile, but a tileset whose upper
   * nodes carry nothing to draw begins at however many tiles those nodes
   * branch into; see {@link build}.
   */
  roots: readonly BuildingTile[]
}

/**
 * A city the catalog could not be asked about, as against one it answered with
 * no dataset of its own.
 *
 * Either way the city stands no buildings, and from the outside the two used to
 * look the same — null for both. They mean opposite things: an answer is final,
 * so a place that falls only in cities like that is a place the survey does not
 * cover and a page can be told so once and for all, while a failure says
 * nothing about the survey and is only worth asking again. Told apart here
 * rather than guessed at by whoever reads the answer.
 */
export const ASK_FAILED = Symbol('building tileset could not be asked about')

/** What is known about a city: its tileset, no dataset there, or no answer at all. */
export type TilesetAnswer = BuildingTileset | null | typeof ASK_FAILED

/**
 * Asked once per city and level, then held on to. A city that publishes no
 * dataset is remembered as null and a city that could not be asked about as
 * {@link ASK_FAILED}, and only the second is let go of after a while.
 */
const tilesets = new Map<string, Promise<TilesetAnswer>>()

/**
 * The answers that have come back, for asking without waiting.
 *
 * A promise cannot be read; it can only be waited on. Waiting on every city
 * on screen before drawing any of them puts the whole view behind the slowest
 * answer, and the catalog answers one question at a time — eight cities took
 * eight seconds each. Held here as well, a layer draws the cities it already
 * has and comes back for the rest as they land.
 */
const answered = new Map<string, TilesetAnswer>()

/**
 * What came back about a city if it is in hand, or undefined while it is still
 * on its way. Never asks.
 */
export function tilesetInHand(city: string, lod: BuildingLod): TilesetAnswer | undefined {
  return answered.get(`${city}:${lod}`)
}

/**
 * How long a city that could not be asked about stays without buildings
 * before it is asked again, in milliseconds. Not at once: the view asks on
 * every frame it moves, and a catalog in trouble would be asked sixty times a
 * second for each city on screen.
 */
export const ASK_AGAIN_AFTER = 30_000

/** What went wrong asking about a city, while that failure stands; see {@link tilesetFailure}. */
const failures = new Map<string, unknown>()

/**
 * What was thrown asking the catalog about a city, for as long as the failure
 * is kept — or undefined where the catalog answered or has not yet been
 * asked. One failure is one thing thrown, so a layer that tells of each one
 * once tells of each by this.
 */
export function tilesetFailure(city: string, lod: BuildingLod): unknown {
  return failures.get(`${city}:${lod}`)
}

export function buildingTileset(
  city: string,
  lod: BuildingLod,
  ask: Ask = ASK_PLAINLY,
): Promise<TilesetAnswer> {
  const key = `${city}:${lod}`
  const hit = tilesets.get(key)
  if (hit) return hit

  const task: Promise<TilesetAnswer> = resolve(city, lod, ask).catch((cause: unknown) => {
    // Not an answer, only a failure to get one: remembered as that rather than
    // as the catalog having nothing, then kept a while and let go so the next
    // ask goes out afresh
    failures.set(key, cause)
    setTimeout(() => {
      if (tilesets.get(key) !== task) return
      tilesets.delete(key)
      answered.delete(key)
      failures.delete(key)
    }, ASK_AGAIN_AFTER)
    return ASK_FAILED
  })
  tilesets.set(key, task)
  void task.then((got) => {
    if (tilesets.get(key) === task) answered.set(key, got)
  })
  return task
}

async function resolve(city: string, lod: BuildingLod, ask: Ask): Promise<BuildingTileset | null> {
  for (const [dataset, actualLod] of DATASETS[lod]) {
    const base = `${CATALOG}/${city}-${dataset}-latest`
    const outer = await fetchJson(`${base}/tileset.json`, ask)
    if (!outer) continue

    // The catalog hands back a wrapper whose one child points at the real tileset
    const link = firstContent(outer)
    if (!link) continue
    const innerUrl = new URL(link, `${base}/`).href
    const inner = await fetchJson(innerUrl, ask)
    if (!inner) continue

    const roots = build(inner.root, innerUrl)
    if (roots.length > 0) return { city, lod: actualLod, roots }
  }
  return null
}

interface TileNode {
  content?: { uri?: string; url?: string }
  boundingVolume?: { region?: number[] }
  geometricError?: number
  children?: TileNode[]
}

/**
 * Keeps the tree, skipping past nodes that carry nothing to draw.
 *
 * A node with no content of its own is not a tile; it is a fork in the path.
 * So it stands aside and its children take its place, however many there are
 * — which is why this answers with a list rather than with one tile.
 *
 * Letting only an only child stand in dropped whole cities. 台東区 begins with
 * twelve such nodes in a row and then branches four ways, and at that fork the
 * walk ended: both levels came back empty, the city was remembered as having
 * no dataset at all, and nothing in 上野 ever stood. The catalog had answered
 * with a megabyte of tiles.
 */
function build(node: TileNode | undefined, base: string): BuildingTile[] {
  if (!node) return []
  const children = (node.children ?? []).flatMap((child) => build(child, base))

  const uri = node.content?.uri ?? node.content?.url
  const region = node.boundingVolume?.region
  if (!uri || !region || region.length < 6) return children
  return [
    {
      url: new URL(uri, base).href,
      region: region.slice(0, 6) as unknown as BuildingTile['region'],
      children,
    },
  ]
}

function firstContent(tileset: { root?: TileNode }): string | undefined {
  let node = tileset.root
  while (node) {
    const uri = node.content?.uri ?? node.content?.url
    if (uri) return uri
    node = node.children?.[0]
  }
  return undefined
}

/**
 * The JSON at a URL, or null where there is none. A server in trouble throws
 * instead: taken as none, a city would fall back to plain boxes, or stand no
 * buildings, for the rest of the visit.
 */
async function fetchJson(url: string, ask: Ask): Promise<{ root?: TileNode } | null> {
  const res = await ask(url, 'catalog')
  if (transient(res.status)) throw new Error(`${res.status}`)
  if (!res.ok) return null
  return (await res.json()) as { root?: TileNode }
}
