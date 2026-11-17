import { EARTH_CIRCUMFERENCE, WORLD_ORIGIN_X, WORLD_ORIGIN_Y, type WorldBounds } from './mercator.js'

/** One XYZ tile: z the zoom, x rising east, y rising south. */
export interface TileId {
  z: number
  x: number
  y: number
}

export function tileKey(t: TileId): string {
  return `${t.z}/${t.x}/${t.y}`
}

/** Which tile an unmoved Mercator coordinate falls in, along one axis. */
function axisToTile(mercator: number, z: number): number {
  const n = 1 << z
  return Math.floor(((mercator + EARTH_CIRCUMFERENCE / 2) / EARTH_CIRCUMFERENCE) * n)
}

/** A tile's rectangle in world units; minX and minY are its south-west corner. */
export function tileBounds(t: TileId): WorldBounds & { size: number } {
  const n = 1 << t.z
  const size = EARTH_CIRCUMFERENCE / n
  const minX = -EARTH_CIRCUMFERENCE / 2 + t.x * size - WORLD_ORIGIN_X
  const maxY = EARTH_CIRCUMFERENCE / 2 - t.y * size - WORLD_ORIGIN_Y
  return { minX, minY: maxY - size, maxX: minX + size, maxY, size }
}

/**
 * The tiles covering a rectangle of the world.
 *
 * Sorted from the middle outwards, so that what is fetched first is what is
 * looked at first.
 */
export function tilesCovering(z: number, bounds: WorldBounds, limit = 256): TileId[] {
  const n = 1 << z
  // Tile numbers are counted in unmoved Mercator, so the origin goes back on
  const x0 = Math.max(0, axisToTile(bounds.minX + WORLD_ORIGIN_X, z))
  const x1 = Math.min(n - 1, axisToTile(bounds.maxX + WORLD_ORIGIN_X, z))
  // Mercator y rises north and tile y rises south, so the two run opposite
  const y0 = Math.max(0, axisToTile(-(bounds.maxY + WORLD_ORIGIN_Y), z))
  const y1 = Math.min(n - 1, axisToTile(-(bounds.minY + WORLD_ORIGIN_Y), z))

  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const out: TileId[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ z, x, y })
  }
  out.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2))
  return out.length > limit ? out.slice(0, limit) : out
}
