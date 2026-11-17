/**
 * One way the reader moves the map, which a page may turn off and on again.
 *
 * Mapbox's handlers, by their names — `dragPan`, `dragRotate`, `scrollZoom`,
 * `touchZoomRotate`, `touchPitch` — each held by the viewer and each said with
 * the one switch an effect has here (`enabled`, contract 12). A page that
 * takes a gesture for itself while it lasts — a rectangle drawn with ⌘ held,
 * a stroke of a pen — turns the one it shares off for that long, rather than
 * catching the events before the map does and inventing a cancel to send it.
 *
 * Turned off, the gesture does nothing to the view; a press let go where it
 * went down is still a click, and a thing a page made draggable is still
 * carried. What the wheel does when the map does not take it is the page's:
 * it scrolls whatever it would scroll without a map there.
 */
export class Interaction {
  /** Whether the gesture moves the map. On by default. */
  enabled: boolean

  /** @internal Made by the viewer, one for each gesture. */
  constructor(enabled = true) {
    this.enabled = enabled
  }
}

/** One gesture as a viewer is made with it: the same one word it has afterwards. */
export interface InteractionOptions {
  /** Whether the gesture moves the map. On by default. */
  readonly enabled?: boolean
}
