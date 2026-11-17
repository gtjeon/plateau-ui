import { latToY, lonToX, type MapBounds, type WorldBounds } from './mercator.js'

/**
 * How far this library reaches: as far as the GSI has tiles.
 * South-west of Yonaguni, north-east well past the eastern tip of Hokkaido.
 */
export const JAPAN = {
  southWest: [122.5, 24],
  northEast: [154, 46.2],
} as const satisfies MapBounds

/** The same rectangle, worked out in world units the once. */
const JAPAN_WORLD = {
  minX: lonToX(JAPAN.southWest[0]),
  minY: latToY(JAPAN.southWest[1]),
  maxX: lonToX(JAPAN.northEast[0]),
  maxY: latToY(JAPAN.northEast[1]),
}

/** Nothing outside Japan is worth fetching a tile for. */
export function overlapsJapan(bounds: WorldBounds): boolean {
  return (
    bounds.maxX > JAPAN_WORLD.minX &&
    bounds.minX < JAPAN_WORLD.maxX &&
    bounds.maxY > JAPAN_WORLD.minY &&
    bounds.minY < JAPAN_WORLD.maxY
  )
}
