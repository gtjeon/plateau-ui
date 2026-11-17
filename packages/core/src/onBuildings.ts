import type { Anchor } from './events.js'
import type { Layer } from './Viewer.js'

/**
 * What a layer standing its things on the city's buildings has to know, and
 * the question it asks to learn it.
 *
 * Here rather than in either of the two layers that meet over it. What the
 * marks need is about buildings, so the buildings are what can answer — but a
 * layer that draws marks is not the buildings' business, and the marks are not
 * to reach into how a building is built. So the question stands between them,
 * the way a zoom two layers have to agree on does.
 */

/**
 * Where a thing stands on a building, in the terms the shader moves it by.
 *
 * Not a place in the world. A building is moved by its own row of the motion
 * table, in the metres of the tile it belongs to and about its own foot, and
 * only then is the tile's own place and stretch put on. Anything meaning to
 * stay on a building through that has to be moved the same way, so what comes
 * back here is every part of it rather than the one place they add up to —
 * which would be a place the building has already left by the next frame.
 */
export interface BuildingSeat {
  /**
   * Where it stands in the tile's own metres, before the building is moved by
   * its row — with the turn a page stood the building by already on x and z.
   * Nothing downstream turns them, and the tile's place has that same turn
   * taken off it already, so it has to be on these.
   */
  readonly x: number
  readonly y: number
  readonly z: number
  /** Where that tile stands on the map, in world units. */
  readonly originX: number
  readonly originY: number
  readonly originZ: number
  /** What the tile's metres are multiplied by to become world units. */
  readonly stretch: number
  /** How high the ground under the building is, in metres. */
  readonly underfoot: number
  /** Which row of the motion table the building's corners read; 0 stands still. */
  readonly slot: number
  /**
   * What the building's corners carry about its coming and going, so that a
   * thing standing on it rises out of the ground with it rather than hanging
   * in the air until it arrives.
   */
  readonly appearAt: number
  readonly appearBy: number
}

/** What a layer asks the buildings for, when it stands something on one. */
export interface StandsOnBuildings {
  /**
   * Where a thing held to one building stands, or nothing where that building
   * is not in hand — its tile never fetched, thrown out for memory, or outside
   * the shape the viewer is cut to; see {@link Anchor}. What comes back is in
   * the building's own terms, so that it rises with the building and goes
   * wherever a motion sends it.
   *
   * Asked again every frame rather than answered once and kept. A tile lands,
   * is thrown out for memory and comes back as a mesh of its own, and a
   * building that starts moving reads another row from that moment; asking is
   * a lookup held by name, and the answer is only ever as old as this frame.
   *
   * _(2026-11-03: `seatOn(building, x, z, height, lift)` stood beside this,
   * for a spot on the map held to a building. Nothing is held that way any
   * more, and it went.)_
   */
  seatOnAnchor(anchor: Extract<Anchor, { readonly building: string }>): BuildingSeat | null
}

/** Whether a layer answers for the buildings it draws. */
export function standsOnBuildings(layer: Layer): layer is Layer & StandsOnBuildings {
  const asks = layer as Partial<StandsOnBuildings>
  return typeof asks.seatOnAnchor === 'function'
}
