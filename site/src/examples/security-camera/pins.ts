/**
 * The pins: two the page opens with and a tag on a wall, and one more mark
 * wherever the map is pressed — a pin on the ground or a roof, a tag on a
 * wall — each saying whether the camera sees it.
 *
 * On its own so that `main.ts` is the map and nothing else. The page keeps the
 * pins and nothing about the city: whether a pin is seen is the camera's to
 * answer (`sees`), and it answers again whenever what it sees has changed.
 */
import {
  Marker,
  type AnnotationLayer,
  type Buildings,
  type Ground,
  type Viewshed,
  type Where,
} from '@plateau-ui/core'
import { FIRST_PINS, FIRST_TAG, HEAD, HIDDEN, HIDDEN_LABEL, SEEN, SEEN_LABEL, WAITING_LABEL } from './data.js'

/** A pin, and the place the camera is asked about. */
interface Pin {
  readonly marker: Marker
  readonly asked: Where
}

/** Puts the first pins in, and one more mark at every press on the ground or on a building. */
export function pins(ground: Ground, buildings: Buildings, sight: Viewshed, markers: AnnotationLayer): void {
  const placed: Pin[] = []

  /** A mark at `at`, asking the camera about `asked`: a pin on the ground or a roof, a tag on a wall. */
  const put = (at: Where, asked: Where, onWall = false): void => {
    const marker = new Marker({
      at,
      symbol: onWall ? 'tag' : 'pin',
      color: HIDDEN,
      label: WAITING_LABEL,
    })
    const pin = { marker, asked }
    markers.add(marker)
    placed.push(pin)
    judge(pin, sight)
  }

  /**
   * On the ground the pin stands on it and the question is about a head over
   * it. Asked of the ground itself, a spot far off along a street the camera
   * barely looks down at reads as hidden by the very street it is on — and a
   * head is what a camera like this one is there to see.
   */
  const onGround = ({ lng, lat }: { readonly lng: number; readonly lat: number }): void =>
    put({ lng, lat, height: 0 }, { lng, lat, height: HEAD })

  for (const at of FIRST_PINS) onGround(at)
  put(FIRST_TAG, FIRST_TAG, true)
  ground.on('click', ({ position }) => onGround(position))
  // On a building the mark goes where it was pressed, and the question is about
  // that very spot: whether the camera sees that much of it. A pin stands up
  // off a roof as it does off the ground. A wall has nothing for one to stand
  // on, so what goes on a wall is a tag with its point on the spot, held to
  // the building by the place the click hands back — which is what lets the
  // tag run off away from the building, whichever side the wall is on. The
  // camera is asked about that same place: it takes one held to a building as
  // well as a spot on the map
  buildings.on('click', ({ face, position, anchor }) =>
    face === 'wall' ? put(anchor, anchor, true) : put(position, position),
  )

  // The city under the camera arrived or moved, and its cube has been read
  // back: every pin is asked again
  sight.on('changed', () => {
    for (const pin of placed) judge(pin, sight)
  })
}

/** Writes the camera's answer on a pin. No answer yet leaves it as it was; the next change asks again. */
function judge({ marker, asked }: Pin, sight: Viewshed): void {
  const seen = sight.sees(asked)
  if (seen === null) return
  marker.color = seen ? SEEN : HIDDEN
  marker.label = seen ? SEEN_LABEL : HIDDEN_LABEL
}
