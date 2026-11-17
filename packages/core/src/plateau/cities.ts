import { latToY, lonToX, type WorldBounds } from '../geo/mercator.js'
import { ASK_PLAINLY, type Ask } from '../requests.js'

/**
 * The boundaries of the municipalities PLATEAU publishes data for.
 *
 * Fetched once, and only the boxes that pick a city out are kept. Neither the
 * buildings nor the green know which city to ask about until this is in, so
 * it is asked for as the viewer is built and arrives while the renderer is
 * still starting. About 1.3MB compressed, 4.9MB opened out, and the server
 * sends no cache headers, so every page load may fetch it afresh.
 */
const GOV_POLYGONS = 'https://api.plateauview.mlit.go.jp/govpolygon/plateaugovs.geojson'

/** One municipality PLATEAU publishes data for. */
export interface PlateauCity {
  /** Its code, which is what the catalog is asked about. */
  code: string
  /** The world rectangle round its boundary. Neighbouring cities' boxes overlap. */
  bounds: WorldBounds
}

interface GovFeature {
  properties?: { code?: unknown }
  geometry?: { coordinates?: unknown }
}

let listing: Promise<readonly PlateauCity[]> | undefined

/**
 * Every municipality PLATEAU publishes for. Fetched on the first ask and
 * held on to after that. A failure is refused rather than kept, so the next
 * ask goes out afresh.
 */
export function plateauCities(ask: Ask = ASK_PLAINLY): Promise<readonly PlateauCity[]> {
  listing ??= fetchCities(ask).catch((error: unknown) => {
    listing = undefined
    throw error
  })
  return listing
}

/** The municipalities a world rectangle touches. Their boxes overlap, so there are several. */
export async function citiesIn(bounds: WorldBounds, ask: Ask = ASK_PLAINLY): Promise<PlateauCity[]> {
  const cities = await plateauCities(ask)
  return cities.filter(
    ({ bounds: box }) =>
      box.maxX > bounds.minX && box.minX < bounds.maxX && box.maxY > bounds.minY && box.minY < bounds.maxY,
  )
}

async function fetchCities(ask: Ask): Promise<PlateauCity[]> {
  const res = await ask(GOV_POLYGONS, 'cities')
  if (!res.ok) throw new Error(`${res.status}`)
  const json = (await res.json()) as { features?: GovFeature[] }

  const cities: PlateauCity[] = []
  for (const feature of json.features ?? []) {
    const code = feature.properties?.code
    if (typeof code !== 'string') continue
    const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
    extend(box, feature.geometry?.coordinates)
    if (box.west > box.east) continue
    cities.push({
      code,
      bounds: {
        minX: lonToX(box.west),
        minY: latToY(box.south),
        maxX: lonToX(box.east),
        maxY: latToY(box.north),
      },
    })
  }
  return cities
}

/** Polygon or multipolygon alike: walks the coordinates down and widens the box round them. */
function extend(
  box: { west: number; south: number; east: number; north: number },
  coordinates: unknown,
): void {
  if (!Array.isArray(coordinates)) return
  const [lon, lat] = coordinates as unknown[]
  if (typeof lon === 'number' && typeof lat === 'number') {
    box.west = Math.min(box.west, lon)
    box.east = Math.max(box.east, lon)
    box.south = Math.min(box.south, lat)
    box.north = Math.max(box.north, lat)
    return
  }
  for (const inner of coordinates) extend(box, inner)
}
