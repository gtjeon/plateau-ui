/**
 * The grid: a line every so many metres across the sheet, and up and along the
 * wall stood at its far edge.
 *
 * On its own so that `main.ts` is the map and nothing else. Each line is a
 * `Polyline` of two corners. The ones on the wall stand off the ground, so
 * they are given a height at each corner, which makes them lines through the
 * air.
 */
import { Polyline, type PolylinePoint } from '@plateau-ui/core'
import { GRID, SHEET, fromSite } from './data.js'

/** Every line of the grid, the sheet's and the wall's. */
export function grid(): Polyline[] {
  const east = SHEET.width / 2
  const north = SHEET.depth / 2
  const lines: Polyline[] = []
  // Every fifth line is the stronger one, counted from where the sheet meets
  // the wall: up the wall from its foot, back across the sheet from the same
  // line, and along both from the middle of the row
  const rule = (at: number, points: PolylinePoint[]): void => {
    lines.push(
      new Polyline({
        points,
        lineColor: at % GRID.section === 0 ? GRID.strong : GRID.color,
        lineWidth: GRID.width,
        // Hidden where a tower stands in front, rather than drawn faint
        // through it: a ruled line across a tower reads as part of the tower
        behind: 'hide',
        // Every line drawn alike, the sheet's as the wall's: facing the screen,
        // so a line lying on the sheet is not thinned by the slant it is seen
        // at, and in its own light, so it is the colour written rather than
        // that colour lit. Left to the defaults the sheet's lines lay down and
        // took the sun, and came out thinner and bluer than the wall's
        // (215,221,230 against 222,226,232, measured)
        billboard: true,
        glows: true,
        pickable: false,
      }),
    )
  }
  // Across the sheet and along it. The far edge is left to the wall's foot
  for (let x = -east; x <= east; x += GRID.every) rule(x, [fromSite(x, -north), fromSite(x, north)])
  for (let back = GRID.every; back <= SHEET.depth; back += GRID.every) {
    rule(back, [fromSite(-east, north - back), fromSite(east, north - back)])
  }
  // Up the wall and along it, on its face
  for (let x = -east; x <= east; x += GRID.every) {
    rule(x, [
      [...fromSite(x, north), 0],
      [...fromSite(x, north), SHEET.depth],
    ])
  }
  for (let up = 0; up <= SHEET.depth; up += GRID.every) {
    rule(up, [
      [...fromSite(-east, north), up],
      [...fromSite(east, north), up],
    ])
  }
  return lines
}
