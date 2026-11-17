/**
 * Paints the page in the colours the library's maps come out in.
 *
 * The site and the cities it shows are the same set of greys, so the page
 * reads as the ground the buildings stand on and anything raised off it — a
 * card, a panel, a bar — reads as a wall.
 *
 * **Why these are written here and not read from the library.** They used to
 * be `LIGHT` itself, imported, so that a colour changed in one place moved the
 * site with it. `LIGHT` is no longer a set of colours on a screen: the scene is
 * lit now, and what the palette holds is reflectance — what a surface gives
 * back — which is a brighter number than what is drawn, and brighter again for
 * the dark set. Importing it would paint this page in the numbers that go *in*
 * rather than the ones that come out, and the page would read a few steps
 * paler than every map on it.
 *
 * So these are what the library draws, measured off the canvas at the default
 * view and written down. They are the old `LIGHT` to the byte, since the
 * palette was re-tuned to land back on exactly these. What is lost is that a
 * colour changed in the library no longer moves the site; there is no reading
 * of it that would, short of standing a viewer up and sampling it.
 *
 * The palette is for a map and names no ink, so the text colours are mixed
 * down from `edge`, the line the library draws along a building's folds.
 * That keeps the writing in the same blue grey as everything else.
 */
const LIGHT = {
  backdrop: '#ffffff',
  surface: '#e8ebef',
  green: '#c3d6ba',
  leaf: '#9ab58c',
  trunk: '#7d766b',
  // Named as the library's theme names them, since each goes out as
  // `--p-<name>` for a page that wants the map's colour by the map's word
  treeLine: '#66795f',
  footprint: '#dde1e7',
  road: '#aeb7c4',
  river: '#8fb0e0',
  rail: '#8c8270',
  ballast: '#c9c1ad',
  coastline: '#aeb7c4',
  boundary: '#c8ccd4',
  // What a wall of the city draws, which the tone curve holds a little under
  // white: a surface cannot give back more light than it is given, and the
  // curve puts reflectance one here. Measured.
  wall: '#eff0f0',
  window: '#b8c3d0',
  mullion: '#c3c8d0',
  edge: '#8f98a6',
  shadow: '#bfc3cc',
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** Mixes a colour towards black, as a bare `r g b`. 0 leaves it alone, 1 makes it black. */
function darkened(hex: string, by: number): string {
  const keep = 1 - by
  const [r, g, b] = channels(hex)
  return `${Math.round(r * keep)} ${Math.round(g * keep)} ${Math.round(b * keep)}`
}

/** Mixes a colour towards black. */
function darken(hex: string, by: number): string {
  return `rgb(${darkened(hex, by)})`
}

/**
 * The river, taken down to where it carries small text with its blue kept.
 *
 * Darkening it evenly, as everything else here is darkened, takes the colour
 * out with the light: beside grey writing the result reads as more grey. So
 * the blue is held back from the darkening and the other two are not, which
 * is what makes a link look like one.
 */
function linkFrom(hex: string): string {
  const [r, g, b] = channels(hex)
  return `rgb(${Math.round(r * 0.52)} ${Math.round(g * 0.6)} ${Math.round(b * 0.78)})`
}

/** Mixes one colour towards another. */
function towards(hex: string, other: string, by: number): string {
  const [r, g, b] = channels(hex)
  const [r2, g2, b2] = channels(other)
  const mix = (from: number, to: number) => Math.round(from + (to - from) * by)
  return `rgb(${mix(r, r2)} ${mix(g, g2)} ${mix(b, b2)})`
}

/** The same colour, let through. For what floats over the city and has to be read against it. */
function through(hex: string, opacity: number): string {
  const [r, g, b] = channels(hex)
  return `rgb(${r} ${g} ${b} / ${opacity})`
}

export function paintFromLibrary(): void {
  const root = document.documentElement.style

  // Every colour of the palette, under its own name, for anything that wants
  // to draw a map without a map: the hero, a card's picture.
  for (const [name, value] of Object.entries(LIGHT)) {
    root.setProperty(`--p-${name}`, value)
  }

  root.setProperty('--bg', LIGHT.surface)
  // What a building's footprint is painted in: a shade of the ground, for a
  // block of the page that sits back rather than standing up.
  root.setProperty('--bg-sunk', LIGHT.footprint)
  // Walls are all but white, so whatever stands off the page is a wall.
  root.setProperty('--raised', LIGHT.wall)
  root.setProperty('--line', LIGHT.boundary)
  root.setProperty('--line-strong', LIGHT.edge)
  const ink = darkened(LIGHT.edge, 0.72)
  root.setProperty('--ink', `rgb(${ink})`)
  // The same ink as a bare triple, for the faint lines and shadows that want
  // it let through: `rgb(var(--ink-rgb) / 0.12)`.
  root.setProperty('--ink-rgb', ink)
  root.setProperty('--ink-quiet', `rgb(${darkened(LIGHT.edge, 0.35)})`)
  // The one colour in the palette with any saturation left, taken down far
  // enough to carry white writing.
  root.setProperty('--accent', darken(LIGHT.river, 0.38))
  root.setProperty('--accent-ink', LIGHT.wall)
  // Writing that can be pressed, where it stands among writing that cannot.
  root.setProperty('--link', linkFrom(LIGHT.river))
  root.setProperty('--shade', LIGHT.shadow)
  // The ground taken most of the way to the wall: a panel set into a white
  // side, light enough that the colours of the code are the only colour in it.
  root.setProperty('--code-bg', towards(LIGHT.surface, LIGHT.wall, 0.7))
  // A wall with the city showing faintly through it.
  root.setProperty('--panel', through(LIGHT.wall, 0.92))
}
