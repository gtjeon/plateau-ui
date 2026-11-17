/**
 * Puts what the panel picked on the viewer.
 *
 * On its own so that `main.ts` is the map and nothing else. Both are settings
 * the viewer already has and takes while it runs — the palette and the roofs'
 * colour, and whether the buildings' folds are drawn — so a choice is put on
 * by writing them, and nothing is made again.
 */
import type { Viewer } from '@plateau-ui/core'
import type { Scheme } from './data.js'

/** Colours the map in `scheme`, every colour it names and every one it leaves to the library. */
export function paint(viewer: Viewer, scheme: Scheme): void {
  // Handed over whole, so a colour the last palette set and this one does not
  // is the library's again: a theme is replaced, not merged
  viewer.theme = scheme.theme
  viewer.buildings.roofColor = scheme.roofColor
}

/**
 * Draws the buildings' folds or takes them away. Their colour is the palette's
 * `edge`, so each palette inks them in its own.
 */
export function outline(viewer: Viewer, on: boolean): void {
  viewer.buildings.edges = on
}

/**
 * Turns the miniature look on or off. Where it is sharp and how much the rest
 * blurs are left to the viewer, which works them out from the view.
 */
export function miniature(viewer: Viewer, on: boolean): void {
  viewer.tiltShift.enabled = on
}
