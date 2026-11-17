/**
 * The camera's shape, and its showing once the city is up.
 *
 * On its own so that `main.ts` is the map and nothing else.
 */
import type { Buildings, Solid, Viewshed } from '@plateau-ui/core'
import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CAMERA } from './data.js'

/**
 * The housing with what holds it up: a plate on the wall, an arm out from it,
 * and the box hung under the arm's end.
 *
 * Its foot is the point on the wall, and it is cut looking down its own +Z —
 * out of the wall once `facing` turns it to the way the wall looks.
 *
 * One shape, so one colour; the lens on the front is a solid of its own for
 * the colour it is (see `lensShape`).
 */
export function housingShape(): BufferGeometry {
  const { plate, arm, housing } = CAMERA
  // The housing's middle is the foot, so it hangs at the height the wall was
  // pressed and the lens and the eye beside it are there too. The arm runs
  // level above it, and the plate is centred on the arm
  const armAt = housing.tall / 2 + arm.over / 2
  const pieces = [
    new BoxGeometry(plate.width, plate.tall, plate.thick).translate(0, armAt, plate.thick / 2),
    new BoxGeometry(arm.thick, arm.thick, arm.long).translate(0, armAt, plate.thick + arm.long / 2),
    // The neck from the arm's end down onto the housing's top
    new BoxGeometry(arm.thick, arm.over, arm.thick).translate(
      0,
      housing.tall / 2 + arm.over / 4,
      plate.thick + arm.long - arm.thick / 2,
    ),
    new BoxGeometry(housing.width, housing.tall, housing.long).translate(
      0,
      0,
      housing.from + housing.long / 2,
    ),
  ]
  const shape = mergeGeometries(pieces)
  for (const piece of pieces) piece.dispose()
  return shape
}

/**
 * The lens: a disc with its foot at its own middle, its face looking down +Z.
 *
 * `three` cuts a cylinder standing up its own Y, so it is laid over to look
 * the way the housing does.
 */
export function lensShape(): BufferGeometry {
  const { lens } = CAMERA
  return new CylinderGeometry(lens.radius, lens.radius, lens.thick, 32).rotateX(Math.PI / 2)
}

/** The camera as the page made it: its housing, the lens on it, and what it sees. */
export interface Camera {
  readonly housing: Solid
  readonly lens: Solid
  readonly sight: Viewshed
}

/**
 * Shows the camera once the city it hangs on is standing.
 *
 * The housing stands at a spot on the map and not on the building: a solid
 * does not go on one. Nothing here moves a building, so the spot on the wall is
 * where the wall stays — but the city comes up out of the ground as it
 * arrives, and a camera hung where a wall will be reads as a mistake until it
 * is. So it waits for the first time the city is all up.
 */
export function hang(buildings: Buildings, { housing, lens, sight }: Camera): void {
  const shown = buildings.on('idle', () => {
    shown()
    housing.visible = true
    lens.visible = true
    sight.visible = true
  })
}
