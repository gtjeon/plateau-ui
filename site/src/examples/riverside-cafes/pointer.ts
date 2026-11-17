/**
 * What the pointer does to the cafés. The one it is on grows, the buildings
 * round it make room, its card comes up over its roof, and a line goes round
 * it. A click keeps a café that way once the pointer has gone; a click
 * anywhere else lets it go.
 *
 * One café is up at a time: the one the pointer is on, or else the one picked.
 * Two up at once would push the same buildings two ways, and the first two
 * cafés are 37 m apart, inside each other's reach.
 *
 * Every building sets off from where it is drawn at that moment. A building
 * takes one motion at a time, and a new one starts at its first keyframe:
 * started at `{}`, the picked café would be thrown back to its own size the
 * moment the pointer went to its neighbour, which pushes it, and the buildings
 * between them would be thrown back to where they stood.
 *
 * Done with the library's own motions, one building at a time, so the
 * photograph grows with its wall, the shadows move with the buildings, and the
 * name stays on the roof however tall the café has got: it is held to the
 * building, not to a spot on the map.
 */
import { type Animation, type AnnotationLayer, type Building, Html, type Viewer } from '@plateau-ui/core'
import { CAFES, EASE, GROW, OUTLINE, OVER_ROOF, PUSH, REACH } from './data.js'
import { cardFor } from './ui.js'

/** Metres in a degree of latitude, near enough for a few dozen metres of street. */
const METRES_PER_DEGREE = 111_320

/** How a building is moved: grown about the middle of its foot, and pushed east, north and up, in metres. */
interface Pose {
  readonly scale: number
  readonly translate: readonly [number, number, number]
}

const STILL: Pose = { scale: 1, translate: [0, 0, 0] }

/**
 * Quick at first and slow to settle, as `ease-out` is. Written out rather than
 * named so that where a motion has got to can be worked out here as well.
 */
const easeOut = (t: number): number => 1 - (1 - t) ** 2

export function growOnPointer(viewer: Viewer, labels: AnnotationLayer): void {
  const { buildings } = viewer

  /**
   * Each café's card, over the middle of its roof. Always on the map and
   * hidden by the page's own styles, so it can fade in and out rather than
   * blink.
   *
   * A label, which the pointer goes through to whatever is behind it. Seen
   * from here, かわべり珈琲's card stands right in front of ともしび, so a
   * card that took the pointer would leave no way onto ともしび while
   * かわべり珈琲 is up.
   */
  const cards = new Map<string, HTMLElement>(
    CAFES.map((cafe) => {
      const element = cardFor(cafe)
      labels.add(
        new Html({
          at: { building: cafe.building, offset: [0, 0, cafe.face[1] + OVER_ROOF] },
          element,
          pickable: false,
        }),
      )
      return [cafe.building, element] as const
    }),
  )

  /** The café the pointer is on, the one a click picked, and the one up. */
  let pointed: Building | undefined
  let picked: Building | undefined
  let up: Building | undefined

  /** Every building that has been moved: where it set off from, where it is going, and the motion taking it. */
  const moving = new Map<string, { from: Pose; to: Pose; motion: Animation }>()

  const timing = { duration: EASE, easing: easeOut, fill: 'forwards' } as const

  /** Where a building is drawn now, worked out from how far its motion has got. */
  function poseOf(id: string): Pose {
    const run = moving.get(id)
    if (!run) return STILL
    const k = easeOut(Math.min(1, Math.max(0, (run.motion.currentTime ?? EASE) / EASE)))
    const [a, b] = [run.from, run.to]
    return {
      scale: a.scale + (b.scale - a.scale) * k,
      translate: [0, 1, 2].map((i) => a.translate[i]! + (b.translate[i]! - a.translate[i]!) * k) as [
        number,
        number,
        number,
      ],
    }
  }

  function moveTo(id: string, to: Pose): void {
    // Already on its way there
    if (moving.get(id)?.to === to) return
    const from = poseOf(id)
    moving.set(id, { from, to, motion: buildings.animate(id, [from, to], timing) })
  }

  /** Where the café and the buildings round it go while it is up. */
  function roomFor(cafe: Building): Map<string, Pose> {
    const room = new Map<string, Pose>([[cafe.id, { scale: GROW, translate: [0, 0, 0] }]])
    // The buildings round it pushed straight out, the nearest furthest
    const { lng, lat } = cafe.position
    const east = METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180)
    buildings.each((other) => {
      if (other.id === cafe.id) return
      const dx = (other.position.lng - lng) * east
      const dy = (other.position.lat - lat) * METRES_PER_DEGREE
      const away = Math.hypot(dx, dy)
      if (away === 0 || away > REACH) return
      const push = (PUSH * (1 - away / REACH)) / away
      room.set(other.id, { scale: 1, translate: [dx * push, dy * push, 0] })
    })
    return room
  }

  function show(cafe: Building, on: boolean): void {
    cards.get(cafe.id)?.classList.toggle('shown', on)
  }

  function settle(): void {
    outline()
    const next = pointed ?? picked
    if (next?.id === up?.id) return
    if (up) show(up, false)
    up = next
    const room = up ? roomFor(up) : new Map<string, Pose>()
    // Whatever moved for the last one and does not for this one goes back
    for (const id of moving.keys()) if (!room.has(id)) moveTo(id, STILL)
    for (const [id, to] of room) moveTo(id, to)
    if (up) show(up, true)
  }

  /**
   * The cafés with a line round them: the one the pointer is on, and the one
   * picked. Both, where the pointer is on one café and another is picked, so
   * the picked one still says so while it is down.
   */
  let lined = new Set<string>()

  function outline(): void {
    const now = new Set([pointed, picked].flatMap((cafe) => (cafe ? [cafe.id] : [])))
    for (const id of new Set([...lined, ...now])) {
      if (lined.has(id) === now.has(id)) continue
      // What it wears already, with the line put on or taken off
      buildings.setStyle(id, { ...buildings.getStyle(id), outline: now.has(id), outlineColor: OUTLINE })
    }
    lined = now
  }

  /** A café picks it, or lets it go where it was the one picked. Anything else lets the picked one go. */
  function click(cafe: Building | undefined): void {
    picked = cafe && cafe.id !== picked?.id ? cafe : undefined
    settle()
  }

  buildings.on('hover', (hover) => {
    pointed = hover && cards.has(hover.building.id) ? hover.building : undefined
    settle()
  })
  buildings.on('click', ({ building }) => {
    click(cards.has(building.id) ? building : undefined)
  })
  // The ground, and anywhere nothing answered
  viewer.on('click', () => {
    click(undefined)
  })
}
