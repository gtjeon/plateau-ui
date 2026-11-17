import { readVectorTile } from '../mvt.js'
import { ROADS } from '../vectorTiles.js'
import { buildBank, type BankMesh } from './bank.js'
import { clipToSquare, RibbonBuilder, type RibbonMesh } from './lines.js'
import { PolygonBuilder, type PolygonMesh } from '../polygons.js'

export type { BankMesh } from './bank.js'
export type { RibbonMesh } from './lines.js'
export type { PolygonMesh } from '../polygons.js'

/**
 * Stretches of railway that cannot be seen from above.
 * Drawing the underground lines too lays track alongside every road they run under.
 */
const RAIL_STATES_HIDDEN = new Set(['トンネル', '地下', '雪覆い'])

function railHidden(properties: Record<string, unknown>): boolean {
  // The coarser tiles sometimes pad the state with a trailing space
  return RAIL_STATES_HIDDEN.has(String(properties['vt_railstate'] ?? '').trim())
}

/**
 * The kinds the ground draws, and which layer of the GSI's optimised vector
 * tiles (optimal_bvmap-v1) each comes from. A kind is named after the colour
 * the viewer holds for it, so that nothing has to be mapped across.
 *
 * 'ribbon' lays it on the ground at its real width; 'line' draws it at a
 * thickness measured in screen pixels; 'both' is a kind that arrives as a mix
 * of surfaces and lines.
 */
export const GROUND_LAYERS = {
  /**
   * Bodies of water, and the narrow ones that arrive as lines instead.
   *
   * Both, because the survey draws water two ways: a river wide enough to
   * have banks comes as a surface (`WA`), and a canal or a culvert too narrow
   * for one comes as its centre line (`RvrCL`). Neither is the whole of the
   * water, so the kind takes both and the page gets one river.
   *
   * What is left out is `WL`, the 水涯線 — the line where water meets land.
   * It runs along the edge of every surface `WA` already draws, so drawing it
   * put a bright outline round each body of water and said nothing the
   * surface had not: on a map whose water and ground are different colours it
   * reads as a shore, and on one where they are not it reads as an outline of
   * a shape nobody asked about.
   */
  river: { kind: 'both', sources: ['WA', 'WStrA', 'RvrCL', 'WRltLine'] },
  /**
   * Railways, drawn as one ribbon: two rails and their sleepers on ballast.
   * The material draws the pattern, so the ribbon carries where along itself
   * each point lies.
   *
   * The width is fixed at about one double track. Widening it through a
   * station would widen the gauge, the rails and the sleepers' reach with it,
   * since all three are measured across the half-width, while the sleepers
   * stayed three metres apart along it — a yard of oddly broad track rather
   * than more tracks.
   */
  rail: { kind: 'ribbon', sources: ['RailCL'], width: 6, skip: railHidden, patterned: true },
  /** The centre lines of roads. */
  road: { kind: 'ribbon', ...ROADS },
  /**
   * Building footprints. Each records its own middle, so one still waiting for
   * its building to stand can pulse as one thing rather than in pieces.
   */
  footprint: { kind: 'polygon', sources: ['BldA'], centred: true },
  coastline: { kind: 'line', sources: ['Cstline'] },
  boundary: { kind: 'line', sources: ['AdmBdry'] },
} as const

export type GroundLayerName = keyof typeof GROUND_LAYERS

/** How one of {@link GROUND_LAYERS} is drawn. */
type DrawnAs<K extends GroundLayerName> = (typeof GROUND_LAYERS)[K]['kind']

/**
 * The kinds laid as ribbons, whose width a page scales rather than sets: the
 * roads, at the width the survey gives each, and the railways, at the one
 * double-track width they are all laid at.
 *
 * Worked out from {@link GROUND_LAYERS} rather than written out, so that a
 * kind moved from one way of drawing to another moves the one place a page
 * can reach its width from with it.
 */
export type GroundRibbonName = {
  [K in GroundLayerName]: DrawnAs<K> extends 'ribbon' ? K : never
}[GroundLayerName]

/**
 * The kinds drawn, wholly or in part, as lines a number of screen pixels
 * thick: the narrow water, the coastline and the boundaries.
 */
export type GroundLineName = {
  [K in GroundLayerName]: DrawnAs<K> extends 'line' | 'both' ? K : never
}[GroundLayerName]

/** The kinds drawn, wholly or in part, as areas: the wide water and the footprints. */
export type GroundAreaName = {
  [K in GroundLayerName]: DrawnAs<K> extends 'polygon' | 'both' ? K : never
}[GroundLayerName]

/**
 * The pieces the ground is made of, named as the viewer names its colours, so
 * `ground.road` is drawn in the theme's `road`. The surface and the green are
 * written out here too: neither comes from a layer of the vector tiles.
 */
export type GroundPieceName = 'surface' | 'green' | GroundLayerName

/**
 * The kinds, in the order they are drawn; later is on top.
 *
 * The surface writes depth and everything laid on it only reads (see
 * LAID_ON_THE_LAND in `materials.ts`), so none of them is measured against
 * another and this order is the whole of what stacks them.
 *
 * The kinds that arrive as lines are in it too. Their material is blended in
 * the opaque half of the frame, as the bank is, so their place here is where
 * they are drawn — not, as until 2026-10-29, after every opaque kind whatever
 * place they held; see `GroundMaterials.line`.
 *
 * What a page reads this for is its own: it is the list of the pieces a
 * ground has one of — `ground[piece]`, each with a colour and a switch — so
 * `for (const piece of GROUND_PIECES) ground[piece].visible = true` reaches
 * every one. {@link GROUND_STACK} is what the drawing goes by. The trees are
 * not among them: they are no kind of tile but what stands on the green, and
 * `ground.trees` is shaped accordingly.
 */
export const GROUND_PIECES: readonly GroundPieceName[] = [
  'surface',
  'green',
  'river',
  'footprint',
  'rail',
  'road',
  'coastline',
  'boundary',
]

/**
 * Everything the ground draws, in the order it is drawn, as three's
 * `renderOrder` inside the stage the viewer gave the layer.
 *
 * {@link GROUND_PIECES} with the two things that are not kinds put in their
 * places: the shading just inside the water's bank, which goes over the water
 * and under whatever comes after it, and the trees, which go last.
 *
 * **Every one of these needs a number of its own.** They lie on the same land,
 * often to the same millimetre, and none of them writes depth — so the sorter,
 * asked, would break the tie by distance, and distance here is the centre of a
 * bounding sphere rather than the ground under a pixel. Two drapes of one tile
 * have different centres, so one is a hair nearer; which one is nearer changes
 * as the view turns, and the overlaps flicker. Numbered, there is no tie.
 *
 * The trees' number decides nothing and is here for the same reason the rest
 * are: they stand up and write depth, so a road drawn after one is hidden
 * behind it and a road drawn before is covered by it, and either way the tree
 * is in front. Measured, when they were moved to sit right after the green and
 * compared frame for frame. Last because that is where they were.
 */
export const GROUND_STACK: readonly (GroundPieceName | 'bank' | 'tree')[] = [
  'surface',
  'green',
  'river',
  'bank',
  'footprint',
  'rail',
  'road',
  'coastline',
  'boundary',
  'tree',
]

/** Where one of them sits in that order. */
export function stackedAt(what: GroundPieceName | 'bank' | 'tree'): number {
  return GROUND_STACK.indexOf(what)
}

/**
 * How far past its kind's own number a kind's lines are drawn: half a step,
 * so after that kind's surfaces and before the next kind.
 *
 * Only the water has both, and that is the tie this parts. Its surfaces and
 * its lines hang in one group at one number, and once the lines were blended
 * in the opaque half (2026-10-29, see `GroundMaterials.line`) nothing else
 * told them apart: a canal's line running into a river would have been over
 * the river or under it as the sorter's distance said, which turns with the
 * view. Over is where it was before. For the coastline and the boundary the
 * half step says nothing; neither has a surface.
 */
export const LINES_OVER_THEIR_KIND = 0.5

/**
 * The first number past everything the ground draws, for a layer laid on the
 * land that goes over the lot of it — a sheet of somebody's tiles.
 *
 * Those are a page's layers and are seated after the ground, which is the
 * viewer's and goes on first, so over is where they were before the drawing
 * was sorted.
 */
export const OVER_THE_GROUND = GROUND_STACK.length

export interface ParsedTile {
  polygons: Partial<Record<GroundAreaName, PolygonMesh>>
  /** Segments end to end: [x1,y1,z1, x2,y2,z2, ...]. */
  lines: Partial<Record<GroundLineName, Float32Array>>
  ribbons: Partial<Record<GroundRibbonName, RibbonMesh>>
  /** The shading laid just inside the water along its bank. */
  bank?: BankMesh
}

/**
 * Only the building footprints of a map tile, for what has to keep out of
 * them: the trees stood on a plot of open ground or forest, which the land
 * use draws round the buildings standing in it rather than with holes for
 * them.
 */
export function parseFootprints(data: ArrayBuffer, tileSize: number): PolygonMesh | undefined {
  const tile = readVectorTile(new Uint8Array(data))
  const polygon = new PolygonBuilder()
  for (const source of GROUND_LAYERS.footprint.sources) {
    const layer = tile.layers[source]
    if (!layer) continue
    const scale = tileSize / layer.extent
    for (let i = 0; i < layer.length; i++) polygon.add(layer.feature(i).loadGeometry(), scale, layer.extent)
  }
  return polygon.build()
}

export function parseTile(data: ArrayBuffer, tileSize: number): ParsedTile {
  const tile = readVectorTile(new Uint8Array(data))
  const polygons: ParsedTile['polygons'] = {}
  const lines: ParsedTile['lines'] = {}
  const ribbons: ParsedTile['ribbons'] = {}

  for (const [name, spec] of Object.entries(GROUND_LAYERS) as [
    GroundLayerName,
    (typeof GROUND_LAYERS)[GroundLayerName],
  ][]) {
    const polygon = new PolygonBuilder('centred' in spec && spec.centred)
    const segments: number[] = []
    const ribbon = new RibbonBuilder('patterned' in spec && spec.patterned)
    const widthBy = 'widthBy' in spec ? spec.widthBy : undefined
    const fallbackWidth = 'width' in spec ? spec.width : 3
    const skip = 'skip' in spec ? spec.skip : undefined

    for (const source of spec.sources) {
      const layer = tile.layers[source]
      if (!layer) continue
      const scale = tileSize / layer.extent

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i)
        if (skip?.(feature.properties)) continue
        const rings = feature.loadGeometry()

        if (spec.kind === 'ribbon') {
          const half = (widthBy?.(feature.properties) ?? fallbackWidth) / 2
          for (const ring of rings) {
            for (const piece of clipToSquare(ring, layer.extent)) ribbon.add(piece, scale, half)
          }
          continue
        }

        // MVT's feature.type: 1 point, 2 line, 3 polygon
        if (spec.kind === 'line' || (spec.kind === 'both' && feature.type !== 3)) {
          for (const ring of rings) {
            for (const piece of clipToSquare(ring, layer.extent)) {
              for (let k = 1; k < piece.length; k++) {
                const a = piece[k - 1]!
                const b = piece[k]!
                const ax = a.x * scale
                const az = a.y * scale
                const bx = b.x * scale
                const bz = b.y * scale
                segments.push(ax, 0, az, bx, 0, bz)
              }
            }
          }
          continue
        }

        polygon.add(rings, scale, layer.extent)
      }
    }

    // Each comes out of the branch above that only a kind drawn that way
    // reaches, so the narrowing is the kind's own and not a guess: a ribbon
    // kind never fills the polygon, nor a polygon kind the segments
    const filled = polygon.build()
    if (filled) polygons[name as GroundAreaName] = filled
    if (segments.length > 0) lines[name as GroundLineName] = new Float32Array(segments)
    const built = ribbon.build()
    if (built) ribbons[name as GroundRibbonName] = built
  }

  const bank = buildBank(tile, GROUND_LAYERS.river.sources, tileSize)
  return { polygons, lines, ribbons, ...(bank && { bank }) }
}
