import { Matrix4, Vector3 } from 'three/webgpu'

/**
 * Earth-centred coordinates, which 3D Tiles content is given in.
 *
 * A tile's vertices sit near a centre point the tile carries (CESIUM_RTC), and
 * both are metres from the centre of the earth. To place them on our Mercator
 * ground we turn that centre into a longitude and latitude, and turn the
 * vertices around it so east, north and up line up with our axes.
 */

/** WGS84 ellipsoid */
const SEMI_MAJOR = 6378137
const FLATTENING = 1 / 298.257223563
const SEMI_MINOR = SEMI_MAJOR * (1 - FLATTENING)
const E_SQUARED = 1 - (SEMI_MINOR * SEMI_MINOR) / (SEMI_MAJOR * SEMI_MAJOR)

export interface Geodetic {
  /** Degrees */
  lon: number
  /** Degrees */
  lat: number
  /** Metres above the ellipsoid */
  height: number
}

/**
 * Earth-centred metres to longitude, latitude and height.
 * Uses Bowring's method, which is exact enough for anything standing on the ground.
 */
export function geodeticOf(x: number, y: number, z: number): Geodetic {
  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  const secondEccentricity = (SEMI_MAJOR * SEMI_MAJOR - SEMI_MINOR * SEMI_MINOR) / (SEMI_MINOR * SEMI_MINOR)
  const theta = Math.atan2(z * SEMI_MAJOR, p * SEMI_MINOR)
  const lat = Math.atan2(
    z + secondEccentricity * SEMI_MINOR * Math.sin(theta) ** 3,
    p - E_SQUARED * SEMI_MAJOR * Math.cos(theta) ** 3,
  )
  const radius = SEMI_MAJOR / Math.sqrt(1 - E_SQUARED * Math.sin(lat) ** 2)
  const height = p / Math.cos(lat) - radius

  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, height }
}

/**
 * Turns earth-centred offsets into our world axes at that place:
 * x to the east, y up, z to the south.
 *
 * The rows are the east, up and south directions in earth-centred coordinates,
 * so multiplying an offset by this leaves it in world axes.
 */
export function orientationAt(lon: number, lat: number, target = new Matrix4()): Matrix4 {
  const lonRad = (lon * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180
  const sinLon = Math.sin(lonRad)
  const cosLon = Math.cos(lonRad)
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)

  const east = new Vector3(-sinLon, cosLon, 0)
  const up = new Vector3(cosLat * cosLon, cosLat * sinLon, sinLat)
  const north = new Vector3(-sinLat * cosLon, -sinLat * sinLon, cosLat)

  // Rows, not columns: this maps earth-centred offsets into our axes
  return target.set(
    east.x,
    east.y,
    east.z,
    0,
    up.x,
    up.y,
    up.z,
    0,
    -north.x,
    -north.y,
    -north.z,
    0,
    0,
    0,
    0,
    1,
  )
}
