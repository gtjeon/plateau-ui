import type { ThemeColor } from './theme.js'

/**
 * What the things a page puts on the map are drawn in where the page says
 * nothing, for each of the two sets.
 *
 * Not the palette. The palette is the map's own colours; these belong to what
 * was put on top of it — a shape, a mark, the line pointed round a building —
 * and a page that says nothing wants one that reads against every colour of the
 * map at once.
 *
 * Only the shapes' ink is read by more than one layer: the city's outline and
 * its storey bands take it as well, and a layer may not reach into another
 * layer's constants, so that one has to be here. The three a mark wears are
 * read by `AnnotationLayer` alone, and by the rule that a value no other layer
 * reads goes down into the one that does, they would be there. They are here
 * because the four are one table — the defaults that stand outside the
 * palette, which contract 12 writes down together — and a table kept in one
 * file is changed in one file, as `theme.ts` keeps the palette's.
 *
 * Every one is a pair, since the reason a page may say its own colour twice
 * holds for these too: a near-black chosen against the light set's paper
 * disappears into the dark set's. The light halves are the values each of
 * these had before there were two. The dark halves turn the lightness over and
 * were chosen in arithmetic, not on screen.
 *
 * Frozen, since a pair is an object and these are handed out as they are: a
 * shape or a solid left to the default keeps this very pair and gives it back
 * from `lineColor` or `fillColor`, and the city's outline and storey bands
 * read it again at every bake. A page writing into what it read back would
 * otherwise turn the default over for all of them at once; frozen, the write
 * throws in a module's own code instead (contract 12, rule 3, and the same
 * reason the marks and the image layers freeze the pairs they hold).
 */

/** A shape, the line round a building pointed at, a band round a storey. */
export const DEFAULT_SHAPE_COLOR: ThemeColor = Object.freeze({ light: '#1f2933', dark: '#e4e9f0' })

/**
 * A mark's symbol, and the letters of a `Label`, which has no symbol for its
 * colour to go on — as a marker's own letters do where they lie on a plate. A
 * grey rather than an ink, so a named mark outweighs it.
 */
export const DEFAULT_ANNOTATION_COLOR: ThemeColor = Object.freeze({ light: '#5a6472', dark: '#aab3bf' })

/**
 * The letters a marker writes beside its symbol (`Marker.label`), where the
 * symbol has taken the colour and nothing lies under them. Not a `Label`'s
 * letters, nor a marker's on a plate: those take the mark's colour, which is
 * {@link DEFAULT_ANNOTATION_COLOR} where the page said none.
 */
export const DEFAULT_LABEL_INK: ThemeColor = Object.freeze({ light: '#1a1a1a', dark: '#f0f2f5' })

/**
 * What the letters are parted from the map by: the band round them, and the
 * plate under them when there is one. The paper the page is drawn on — white in
 * the light set, and in the dark set the colour the dark land is drawn.
 */
export const DEFAULT_HALO_COLOR: ThemeColor = Object.freeze({ light: '#ffffff', dark: '#1b1f26' })
