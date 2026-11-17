/**
 * The row: the five asked for at their places, and each one's height written
 * over it once it has landed.
 *
 * On its own so that `main.ts` is the map and nothing else.
 */
import { Html, type AnnotationLayer, type ReplicaBuilding, type Viewer } from '@plateau-ui/core'
import { APART, OVER_ROOF, TALLEST, fromSite } from './data.js'
import { plate } from './ui.js'

/**
 * Where the nth place in the row stands.
 *
 * How many will stand is known from the start, so the places are too — which
 * is what lets each be asked for at one, rather than set down when it lands.
 *
 * The first in {@link TALLEST} takes the left-hand end and the places run east
 * from there, and east is rightward across the screen at this heading, so the
 * row is read in the order the list is written — tallest first, the way a
 * sorted chart is read. That end is the far one from the camera as well, so
 * the tallest is the furthest off and does not stand over the four beside it.
 */
function placeAt(place: number): [number, number] {
  return fromSite((place - (TALLEST.length - 1) / 2) * APART, 0)
}

/**
 * The five, each asked for at its place in the row, and its height written
 * over it in `labels` when it comes.
 *
 * The place is the page's to say, so nothing waits on anything else: each is
 * stood at {@link placeAt} from the asking, rises there when its tile comes,
 * and has its height written over it then. Asked for without a place, it would
 * stand where the survey has it — four cities away and off screen — and rise
 * there with nobody looking.
 *
 * One the survey does not have comes back as nothing, said about through
 * `error`, and its place stays empty.
 */
export function standRow(viewer: Viewer, labels: AnnotationLayer): void {
  TALLEST.forEach((wanted, place) => {
    void viewer.buildings.bring({ ...wanted, at: placeAt(place) }).then((building) => {
      if (building && !viewer.disposed) label(labels, building, place)
    })
  })
}

/**
 * Writes a building's height over its roof, once it has landed and the survey
 * has said how tall it is.
 */
function label(labels: AnnotationLayer, building: ReplicaBuilding, place: number): void {
  // The writing is the mark. A pin over a building already standing in front
  // of the reader would say the same thing twice.
  labels.add(new Html({ at: placeAt(place), height: building.tall + OVER_ROOF, element: plate(building) }))
}
