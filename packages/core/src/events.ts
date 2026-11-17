import type { Object3D, Vector3 } from 'three/webgpu'
import type { Model } from './models/ModelLayer.js'
import type { Solid } from './SolidLayer.js'

/**
 * A place in the world: where on the map, how high it stands, and the building
 * it is held to, where it is held to one.
 *
 * Said the way every map library says a point — Google's `{ lat, lng,
 * altitude }`, Cesium's longitude, latitude and height — and nothing more:
 * no wall, no storey, no offset across a face. A point on a wall is a point.
 * What a click on a building knows besides — which face, which way it looks,
 * which storey — comes with the click as something to read, and is not a way
 * of putting a thing anywhere.
 */
export interface Position {
  /** Latitude, in degrees. */
  readonly lat: number
  /**
   * Longitude, in degrees.
   *
   * `lng` rather than `lon` because that is what a reader coming from a map
   * library has: Google, Mapbox and Leaflet all spell it this way.
   */
  readonly lng: number
  /**
   * How high it stands, in metres over the land under it — the same count a
   * place handed in by `at` makes, so a place the library hands back can be
   * handed straight back in and lands where it was. Google's
   * `RELATIVE_TO_GROUND`.
   *
   * With the land drawn flat that is how far above the ground it is, and the
   * same with the land's heights on: a roof on a hill does not count the
   * hill. Where the height above the sea is wanted, the land's own is
   * `viewer.queryTerrainElevation(at)`, to be added.
   *
   * Always here, since this is what the library hands back and it always
   * knows. A page writing a place of its own leaves it out; see `Where`.
   */
  readonly height: number
  /**
   * The building the place was found on, by the name PLATEAU gives it: a
   * click on a building fills it in.
   *
   * Something to read, and not a way of holding anything to the building. A
   * place handed to a mark, a solid, a model or an eye as a spot on the map
   * stays there, and this is not read; what goes with the building is put at
   * the {@link Anchor} the same click hands back.
   *
   * _(2026-11-03: until today a place with this in it was held to the
   * building, up with it and through a motion but not to wherever it was
   * stood.)_
   */
  readonly building?: string
}

/**
 * A place held to a thing on the map rather than a spot on it: a building, a
 * model or a solid, and how far from its foot.
 *
 * What a mark that goes with something stands at. Nothing in it is a spot on
 * the map, so it goes wherever the thing goes — a building up out of the
 * ground as its tile lands, along with a motion, and to wherever it is stood
 * and round as it is turned; a model or a solid wherever its `at`, `height`
 * and `facing` put it.
 *
 * A mark and an eye take all three. A solid and a model take the two that are
 * not a building: they stand on no building (`OffBuildings`, 2026-11-05).
 *
 * The foot is where the thing stands. For a building, the middle of its foot
 * on the ground it stands on (`Building.position`). For a model or a solid,
 * the place it was stood at and lifted to by its `height` — which is the
 * origin of its file or its geometry, wherever that was drawn: a house built
 * on its origin has its foot under it, a ball cut about its middle has it at
 * its middle. One standing at `'view'` has no foot on the map, and nothing
 * stands at it.
 *
 * `offset` is metres from the foot: east, north and up as the thing faces
 * nought — the building as it was surveyed, a model or a solid at `facing` 0
 * — and turned with it. The place itself moves, so what stands in front of it
 * and where the pointer finds it go with it. A click on a building, a model
 * or a solid hands one back (`anchor`), the offset being the way from the foot
 * to the click, so it leads back to the click.
 *
 * _(2026-11-03, the user's design. The same day this was a roof — the middle
 * of the top — or a wall, the first one met out along a bearing at a height,
 * for buildings alone; taken out for now and left for a later version. Before
 * that a mark was held to a building by a spot on the map with the building
 * beside it (`Position.building`), which followed the building up and through
 * a motion but not to a new place, and to a model by `{ model, height }`.)_
 */
export type Anchor =
  | {
      /** The building, by the name PLATEAU gives it. */
      readonly building: string
      /** Metres from the middle of its foot: east, north and up as it was surveyed. */
      readonly offset?: readonly [number, number, number]
    }
  | {
      readonly model: Model
      /** Metres from its foot: east, north and up as it faces nought. */
      readonly offset?: readonly [number, number, number]
    }
  | {
      readonly solid: Solid
      /** Metres from its foot: east, north and up as it faces nought. */
      readonly offset?: readonly [number, number, number]
    }

/**
 * What lies under the pointer, as the viewer hands it to the layer it belongs to.
 *
 * The layer turns it into what its own listeners are told: a building, a shape
 * someone put on the map, a place on the ground.
 */
export interface Hit {
  /** The mesh the pointer is on. */
  readonly object: Object3D
  /**
   * Which of the things drawn in that mesh, as that mesh numbered them:
   * whatever it wrote under `PICKED_ITEM` for the corner or the instance
   * that was hit — a building's number in its PLATEAU tile, a mark's own number
   * in the group holding it — and 0 where the mesh wrote nothing.
   *
   * Or, where a layer's paint covers what was found, that layer's own number
   * for whatever is painted there. The mesh is then the one the colour landed
   * on — the ground, a wall — and it numbered nothing; the number is the
   * answer to {@link Layer.covers}.
   */
  readonly item: number
  /** Where it was hit, in the world's own units. */
  readonly point: Vector3
  /** The same, on the map. */
  readonly position: Position
  /** Where on the canvas, in pixels of the page from its top left. */
  readonly x: number
  readonly y: number
  /** The pointer event it came from, for the keys held with it. */
  readonly original: PointerEvent
}

/**
 * Something a layer could not fetch.
 *
 * Every layer tells its listeners about failures the same way, so a page can
 * say "the map is having trouble" without knowing which layer was unlucky.
 * What can be asked for again is asked for again on its own — the event says
 * whether it will be, so a page can tell a hiccup from a hole that will stay.
 */
export interface LoadFailure {
  /**
   * Which kind of thing: a tile of the map, one picture laid over it, the
   * catalog that says where things are, a model the page itself asked to be
   * drawn, or a building it named that the survey turns out not to have.
   */
  readonly what: 'tile' | 'picture' | 'catalog' | 'model' | 'building'
  /** Which one, as the layer names it: a tile address, a city code, a URL. */
  readonly key: string
  /** Whether the layer will ask again by itself, after a wait. */
  readonly retrying: boolean
  /** What went wrong, as it was thrown. */
  readonly cause: unknown
}

/**
 * A thing being carried by the pointer, every time it moves.
 *
 * The same four words whatever is being carried, since what a page does with
 * one is the same either way: where it was taken hold of, how far it has come
 * since, and where the pointer is on the canvas.
 *
 * **Metres, counted from where it was taken hold of.** Not the place under the
 * pointer, which is a different question with a different answer: the pointer
 * is on the thing somewhere, not at its middle, and a shape lifted 60m off the
 * ground is drawn well above the ground it stands on — read as a place, it
 * jumps to the pointer the moment it is touched. Carried as a distance it
 * stays where it was taken hold of, which is what a hand does. The two agree
 * where the thing sits on the ground and the pointer is at its middle, and
 * nowhere else.
 *
 * East and north and no up: the view is drawn through an orthographic camera,
 * so a step across the canvas is the same step across the world at any height
 * and the two directions the screen can say are these. Lifting is a page's own
 * to work out from the two, as a page that wants it has a modifier and a rule.
 */
export interface Dragging {
  /** How far it has been carried since it was taken hold of, in metres. */
  readonly east: number
  readonly north: number
  /** Where the pointer is now, in pixels of the page from the canvas's top left. */
  readonly x: number
  readonly y: number
  readonly original: PointerEvent
}

/**
 * Which end of a drag a layer is being told about; see {@link Dragging}.
 *
 * In the signature of `Layer.dragged`, so a page writing a layer of its own
 * needs the name: not internal, whatever the viewer does with it.
 */
export type DragPhase = 'start' | 'move' | 'end'

/**
 * Who listens to a layer for what, and telling them.
 *
 * `on` hands back the way to stop listening, so a listener can be let go of
 * without keeping hold of the function it was given.
 */
export class Events<T extends object> {
  private readonly listeners = new Map<keyof T, Set<(event: never) => void>>()

  on<K extends keyof T>(type: K, listener: (event: T[K]) => void): () => void {
    let listening = this.listeners.get(type)
    if (!listening) this.listeners.set(type, (listening = new Set()))
    listening.add(listener)
    return () => this.off(type, listener)
  }

  off<K extends keyof T>(type: K, listener: (event: T[K]) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** Whether anyone is listening for this. */
  has(type: keyof T): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0
  }

  /**
   * Tells everyone listening for this.
   *
   * A listener that throws is reported the way the platform reports one that
   * throws from `addEventListener` — to the console and `window.onerror` — and
   * the rest are still told. Thrown on through here, it took the caller with
   * it: one page's `on('frame')` that threw every time left the map frozen
   * where it stood, every layer's frame and the drawing after it skipped, and
   * nothing said why.
   */
  emit<K extends keyof T>(type: K, event: T[K]): void {
    const listening = this.listeners.get(type)
    if (!listening) return
    // Copied first: a listener may stop listening as it is told, and the rest are still told
    for (const listener of [...listening]) {
      try {
        ;(listener as (event: T[K]) => void)(event)
      } catch (error) {
        report(error)
      }
    }
  }
}

/** Hands a listener's error to the platform, as a thrown DOM listener's is. */
function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
  else
    setTimeout(() => {
      throw error
    })
}
