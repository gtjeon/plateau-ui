/**
 * The GSI's optimised vector tiles (optimal_bvmap-v1): where they are fetched
 * from, and what a road is in them.
 *
 * Two layers read these tiles. The ground draws the roads; the buildings ask
 * which of their walls has one in front of it, since that is what decides
 * where the windows go. A wall must face a road that is actually on screen,
 * so both have to mean the same thing by the word — the same layer, the same
 * exclusions, the same widths. What two layers have to agree on belongs to
 * neither of them: read off the ground, where it used to live, the windows a
 * building wears depended on the layer that draws the map.
 */
import type { TileId } from './geo/tiles.js'

const GSI_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1'

/**
 * Where one GSI vector tile is fetched from. The ground and the roads ask by
 * this one address, so the second is served from the browser's cache.
 */
export function vectorTileUrl(tile: TileId): string {
  return `${GSI_TILES}/${tile.z}/${tile.x}/${tile.y}.pbf`
}

/**
 * A road's width in metres, taken from its width class (幅員区分): about the
 * middle of what the class covers.
 *
 * The tile carries a vt_width too, but it is not a measurement. It is one
 * fixed number per class, and that number is larger than the class's own
 * upper bound — a road classed “under 3m” arrives saying 3.9m. Used as given,
 * roads come out 1.2 to 1.6 times too wide, so two running side by side
 * overlap and show a seam between them.
 */
const ROAD_WIDTHS: Record<string, number> = {
  '3m未満': 2.5,
  '3m-5.5m未満': 4.5,
  '5.5m-13m未満': 9,
  '13m-19.5m未満': 16,
  '19.5m以上': 24,
}

/** The coarser zooms carry no width class, so the kind of road stands in for it. */
const ROAD_KIND_WIDTHS: Record<string, number> = {
  高速自動車国道等: 20,
  国道: 14,
  主要道路: 14,
  都道府県道: 10,
  市区町村道等: 5,
}

function roadWidth(properties: Record<string, unknown>): number | undefined {
  const rank = properties['vt_rnkwidth']
  const byRank = typeof rank === 'string' ? ROAD_WIDTHS[rank] : undefined
  if (byRank !== undefined) return byRank
  const kind = properties['vt_rdctg']
  return typeof kind === 'string' ? ROAD_KIND_WIDTHS[kind] : undefined
}

/** Roads the GSI's own map leaves out: tunnels, roads underground, and the lanes numbered 2721 to 2734. */
const ROAD_CODES_HIDDEN = new Set([2704, 2714])

function roadHidden(properties: Record<string, unknown>): boolean {
  const code = Number(properties['vt_code'])
  return ROAD_CODES_HIDDEN.has(code) || (code >= 2721 && code <= 2734)
}

/**
 * What counts as a road: the layer they arrive in, which of them to leave
 * out, and how wide each one is.
 */
export const ROADS = {
  sources: ['RdCL'],
  /** How wide a road with no class to go by is taken to be, in metres. */
  width: 5,
  widthBy: roadWidth,
  skip: roadHidden,
} as const
