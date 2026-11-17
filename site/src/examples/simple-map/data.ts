/**
 * The palettes the page offers, in numbers.
 *
 * Nothing here calls the library: each is a theme — the palette's own names,
 * see `Palette` — and the roofs' colour where it is not the walls', which
 * `looks.ts` hands to the viewer as they are. The colours are what the
 * palette's are, the colour of a face lying flat in full daylight; the faces
 * turned from the sun draw darker, as every face here does.
 */
import type { Palette } from '@plateau-ui/core'

/** One palette. */
export interface Scheme {
  /** What the choice says. */
  readonly name: string
  /**
   * The palette, over the library's own: a name left out keeps the library's
   * colour. A `Theme` with one colour a name, day and night alike, which is
   * what lets the panel paint a swatch of each.
   */
  readonly theme: { readonly [K in keyof Palette]?: string }
  /** The roofs' own colour, where it is not the walls'. */
  readonly roofColor?: string
}

/** The palette names the panel shows a swatch of, in the order it shows them. */
export const SWATCHES = ['wall', 'window', 'road', 'river', 'edge'] as const

export const SCHEMES: readonly Scheme[] = [
  // The library's own colours, which is what the page opens on
  { name: '標準', theme: {} },
  // Soft colours: walls of peach, roofs of lilac, the water and the green a
  // step deeper than the library's so they still read against them
  {
    name: 'パステル',
    theme: {
      backdrop: '#fffaf6',
      surface: '#fcf7f1',
      footprint: '#f3ebe2',
      road: '#ecdfd2',
      river: '#b4d8f0',
      green: '#d2eac5',
      leaf: '#b1d79f',
      wall: '#fbeee8',
      window: '#d9e7f5',
      mullion: '#f6e6e0',
      shadow: '#e6e0e6',
    },
    roofColor: '#eae3f7',
  },
  // No hue anywhere, as a photograph in black and white: white walls over a
  // grey ground, the roads and the water darker greys, the glass a grey the
  // walls are told apart by. A darker shade than the library's, so it is the
  // light and the shadow that draw the city. Where the edges are on, the
  // folds are black ink
  {
    name: 'モノクロ',
    theme: {
      backdrop: '#e4e4e4',
      surface: '#bdbdbd',
      footprint: '#c9c9c9',
      road: '#8e8e8e',
      river: '#9c9c9c',
      green: '#acacac',
      leaf: '#d2d2d2',
      trunk: '#6e6e6e',
      treeLine: '#3a3a3a',
      rail: '#787878',
      ballast: '#a2a2a2',
      boundary: '#6e6e6e',
      coastline: '#6e6e6e',
      wall: '#ffffff',
      window: '#a0a0a0',
      mullion: '#d8d8d8',
      shadow: '#c4c4c4',
      edge: '#1a1a1a',
    },
  },
  // A city under neon: dark violet walls and ground, the glass and the river
  // cyan, and magenta for the ink — the folds where the edges are on, the
  // wards' boundary. The shade is a pale violet, so the faces the sun has left
  // go over to violet rather than to grey: the fill takes its hue and not its
  // level (`Palette.shadow`), and a deeper one turned the whole city blue
  {
    name: 'サイバーパンク',
    theme: {
      backdrop: '#0d0b1f',
      surface: '#2f2b45',
      footprint: '#3a3452',
      road: '#4f3470',
      river: '#22c3e0',
      green: '#2f4d4f',
      leaf: '#2f6b66',
      trunk: '#3d3650',
      treeLine: '#00f0ff',
      rail: '#7a3d8f',
      ballast: '#3a3350',
      coastline: '#00e5ff',
      boundary: '#ff3df2',
      wall: '#3e3858',
      window: '#24d6ff',
      mullion: '#2f2a47',
      edge: '#ff2bd6',
      shadow: '#a99bd9',
    },
    roofColor: '#4b4170',
  },
  // 砂漠, desert: the colours the Zilla example wore before it went over to
  // the library's — a warm paper ground, walls of one warm grey with the glass
  // in the same grey so no windows show, and a deep shade, so the city stands
  // as a model on a board. The ground pieces sit a step either side of the paper, so the
  // streets and the water are there without the plan taking over.
  //
  // A step lighter than the numbers it wore there (#dcd3c4, #85817b). That
  // page set its sun 52° up and this one keeps the library's, 26° up at ten on
  // the solstice, which drew the same numbers darker: the walls 77–94 against
  // its 118–125, the ground 205 against its 220. These bring them back to
  // 103–132 and 214 (measured, red channel, the screen and its thumbnail)
  {
    name: '砂漠',
    theme: {
      backdrop: '#e0d7c9',
      surface: '#f4ecdf',
      footprint: '#ebe2d3',
      road: '#e1d7c6',
      river: '#cdc6b9',
      green: '#e5ddcc',
      leaf: '#b3ad9f',
      trunk: '#85817b',
      treeLine: '#6c6b69',
      rail: '#d3c9b8',
      ballast: '#e4dbcb',
      boundary: '#b3aa99',
      coastline: '#b3aa99',
      wall: '#a09d98',
      window: '#a09d98',
      mullion: '#a09d98',
      shadow: '#6c6b69',
      edge: '#4a4741',
    },
  },
]
