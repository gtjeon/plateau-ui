/**
 * Which of the page's own elements stand on a map as marks, so that a press
 * over the markup layer can be told which mark it went down on.
 *
 * Here rather than in the group or the viewer, since both need it and neither
 * imports the other: the group writes it as it dresses an element, the viewer
 * reads it as a press comes in.
 */

/** A mark a press can land on, and be told it was a click. */
export interface PressedMark {
  /** A press let go about where it went down, at that place on the canvas. */
  pressed(x: number, y: number, original: PointerEvent): void
}

const MARKS = new WeakMap<Element, PressedMark>()

/** Notes that the element stands on a map as this mark. */
export function standsAs(element: Element, mark: PressedMark): void {
  MARKS.set(element, mark)
}

/** Notes that the element is the page's again. */
export function standsDown(element: Element): void {
  MARKS.delete(element)
}

/**
 * The mark a pointer event over the markup layer landed in, if it landed in
 * one: the target itself or the nearest of its ancestors that is a mark,
 * looking no further up than the layer.
 */
export function pressedOn(target: EventTarget | null, markup: Element): PressedMark | null {
  let at = target instanceof Element ? target : null
  while (at && at !== markup) {
    const mark = MARKS.get(at)
    if (mark) return mark
    at = at.parentElement
  }
  return null
}

/**
 * Whether the press went down in something the reader types or selects in.
 * A drag there is a selection, and a right click there is the menu that
 * copies and pastes, so neither is the map's.
 */
export function typedInto(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
  )
}
