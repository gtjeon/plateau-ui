import { readVectorTile } from '../mvt.js'
import { PolygonBuilder, type PolygonMesh } from '../polygons.js'
import { transient } from '../transient.js'
import { ASK_PLAINLY, type Ask } from '../requests.js'

const CATALOG = 'https://api.plateauview.mlit.go.jp/datacatalog'

/**
 * Land use is only ever read at z16.
 *
 * Stepping out, PLATEAU thins nothing: it only widens the ground one tile
 * covers. So z16 is the lightest there is — about 500KB over a city centre —
 * while z14 runs to 8MB and z12 past 100MB.
 */
export const LUSE_ZOOM = 16

/**
 * The land-use classes (土地利用区分) painted as green. A plot is taken when
 * its label begins with one of these.
 *
 * Public open space is parks, greens, squares, sports grounds and
 * cemeteries; the rest are forest, fields and orchards, and golf courses.
 * Natural land (その他自然地) is left out: beaches and riverbeds share a class
 * with waste ground and cannot be told apart, and a green beach reads worse
 * than a beach left the colour of the ground.
 */
const GREEN_LAND_USES = ['公共空地', '山林', '畑', 'その他①']

/**
 * Of those, the ones trees are stood on: the ground that is planted and kept.
 *
 * Fields and orchards (畑) and golf courses (その他①) are painted green and
 * left bare: a wood standing on a field stops it being a field, and a golf
 * course is grass by its nature.
 */
const TREE_LAND_USES = ['公共空地', '山林']

function isIn(names: readonly string[], properties: Record<string, unknown>): boolean {
  const use = properties['luse_class']
  return typeof use === 'string' && names.some((name) => use.startsWith(name))
}

function isGreen(properties: Record<string, unknown>): boolean {
  return isIn(GREEN_LAND_USES, properties)
}

/** Whether trees stand on a plot of this class. */
function isPlanted(properties: Record<string, unknown>): boolean {
  return isIn(TREE_LAND_USES, properties)
}

/** What one land-use tile came to. */
export interface LuseMesh {
  /** Every plot painted green. */
  green?: PolygonMesh
  /** Of those, the ones trees stand on. Absent where trees are off. */
  planted?: PolygonMesh
}

/**
 * Asked once a city and held on to. A city with no data is remembered as
 * null; a city that could not be asked is not remembered at all.
 */
const sources = new Map<string, Promise<string | null>>()

/**
 * The address template for that city's land-use tiles
 * (`.../{z}/{x}/{y}.mvt`), or null where the city has no data.
 *
 * Many tiles wait on the one answer, so one tile giving up does not cut it
 * off: cutting it would end the others' wait in a cancellation too, and each
 * would take that for its own and sit there still arriving. A failure to ask
 * at all — the server in trouble, or out of reach — is refused rather than
 * answered with "nothing here", and not remembered, so the tiles waiting on
 * it ask again later.
 */
export function luseTiles(code: string, ask: Ask = ASK_PLAINLY): Promise<string | null> {
  const hit = sources.get(code)
  if (hit) return hit

  const task: Promise<string | null> = (async (): Promise<string | null> => {
    const res = await ask(`${CATALOG}/mvt/${code}-luse-latest/tilejson.json`, 'catalog')
    if (transient(res.status)) throw new Error(`${res.status}`)
    if (!res.ok) return null
    const json = (await res.json()) as { tiles?: unknown }
    const first = Array.isArray(json.tiles) ? json.tiles[0] : undefined
    return typeof first === 'string' ? first : null
  })().catch((error: unknown) => {
    if (sources.get(code) === task) sources.delete(code)
    throw error
  })

  sources.set(code, task)
  return task
}

/**
 * Reads the green plots of a land-use tile out as surfaces.
 *
 * With trees on, the plots they stand on are gathered in the same pass:
 * cheaper than reading the same tile through twice.
 */
export function parseLuse(data: ArrayBuffer, tileSize: number, planted: boolean): LuseMesh {
  const tile = readVectorTile(new Uint8Array(data))
  const layer = tile.layers['luse']
  if (!layer) return {}

  const green = new PolygonBuilder()
  const trees = planted ? new PolygonBuilder() : undefined
  const scale = tileSize / layer.extent
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    if (feature.type !== 3 || !isGreen(feature.properties)) continue
    const rings = feature.loadGeometry()
    green.add(rings, scale, layer.extent)
    if (trees && isPlanted(feature.properties)) trees.add(rings, scale, layer.extent)
  }

  const filled = green.build()
  const lots = trees?.build()
  return { ...(filled && { green: filled }), ...(lots && { planted: lots }) }
}
