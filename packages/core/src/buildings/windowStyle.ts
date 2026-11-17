import type { ColorRepresentation } from 'three/webgpu'
import { colorFor, type ThemeColor } from '../theme.js'
import { metres, positiveMetres } from './lengths.js'

/**
 * How windows are set out on a wall, by what the building is for.
 *
 * PLATEAU says what every building is used for, in its own words — 住宅,
 * 業務施設, 工場 and a dozen more — and that is the one thing in the data that
 * says anything about what the windows should look like. A house has small
 * windows with wall between them; an office has wide ones in bands; a factory
 * has few and high. So the settings are keyed by exactly those words, and a
 * city drawn with a setting for 共同住宅 is asking for what PLATEAU means by it.
 *
 * Every length is in metres and describes one window and the wall around it,
 * not a pattern; the colours are {@link ThemeColor}s, said once or once for
 * each palette. How many fit is worked out from the wall: the building's
 * storeys make the rows — as PLATEAU gives them, or worked out from its height
 * where it gives none or none that can be true — and the width left between
 * the side margins, with the gap asked for between each two, makes the
 * columns.
 */

/** What one window looks like, and how much wall is left around the lot. */
export interface WindowStyle {
  /** How wide one window is. */
  readonly width: number
  /**
   * How tall one window is. Never more than four fifths of the storey it sits
   * in, however tall it is asked to be, so every floor keeps some wall around
   * its glass.
   */
  readonly height: number
  /**
   * Wall left above the topmost row, below the parapet where a flat roof has
   * one. A high-rise leaves its own instead: see `windows.highRisePadTop`.
   */
  readonly padTop: number
  /** Wall left below the lowest row. */
  readonly padBottom: number
  /** Wall left at each end. */
  readonly padSide: number
  /**
   * Wall left between two windows side by side, at the least. 0 joins the
   * windows of a row into one band of glass.
   *
   * A wall seldom comes out a whole number of windows wide, and what it has
   * over is shared out among the gaps and the ends, so a gap is often wider
   * than this and never narrower. A band takes it into its windows instead,
   * and runs unbroken from one side margin to the other.
   */
  readonly gap: number
  /**
   * How wide the bars dividing the glass are. Left out or 0, it is undivided.
   *
   * Windows standing apart are split down the middle, the way a sliding pair
   * is. A band is split where one window of it would end and the next begin,
   * so it reads as a row of windows close to and as one stripe from further
   * off, where the bars are too thin to see.
   *
   * `mullionWidth` and not `mullion`: a part's own name is the switch that
   * turns it on and off, and the part's name with `Width` is how wide it is —
   * the grammar `lineWidth` and `outlineWidth` already speak. Spelt bare it
   * read as a switch that took a number.
   */
  readonly mullionWidth?: number
  /**
   * The glass of this usage. Left out, it is {@link Windows.color}, and where
   * that is left out too, the viewer's window colour.
   *
   * This one wins over the layer's because it says more: it is about the
   * glass of one kind of building, and that is about all of them. The
   * library's own colour for a usage — the frosted glass of a warehouse — is
   * the other way about, and gives way to anything the page says anywhere;
   * see {@link windowColour}. So it is in no table of these, not even
   * {@link DEFAULT_WINDOW_STYLES}: wherever this field is filled in, the page
   * said it.
   */
  readonly color?: ThemeColor
  /** The bars dividing the glass, as {@link color} is the glass. */
  readonly mullionColor?: ThemeColor
}

/**
 * The usages PLATEAU gives a building, as they come.
 *
 * The order is the code list's (411 住宅 through 492 その他), with the blank
 * that unsurveyed buildings carry at the end. A building whose usage is none
 * of these falls back on 不明.
 */
export const BUILDING_USAGES = [
  '住宅',
  '共同住宅',
  '店舗等併用住宅',
  '店舗等併用共同住宅',
  '作業所併用住宅',
  '業務施設',
  '商業施設',
  '宿泊施設',
  '商業系複合施設',
  '医療施設',
  '文教厚生施設',
  '官公庁施設',
  'その他公共施設',
  '運輸倉庫施設',
  '工場',
  '農林漁業用施設',
  '供給処理施設',
  '防衛施設',
  'その他',
  '不明',
] as const

export type BuildingUsage = (typeof BUILDING_USAGES)[number]

/** Windows set out by what the building is for. */
export type WindowStyles = Record<BuildingUsage, WindowStyle>

/**
 * What a page hands over for the windows of each usage: any of the usages,
 * and any of the settings of each. What it leaves out is the default for that
 * usage; see {@link windowStyles}.
 */
export type WindowStylesAsked = Partial<Record<BuildingUsage, Partial<WindowStyle>>>

/**
 * What each usage gets unless told otherwise.
 *
 * Each is sized after the buildings PLATEAU files under it, as they are built
 * in Japan, and three things set them apart on screen: how much of a storey
 * the glass takes, how finely it is divided, and how much wall is left around
 * it. Offices come out glassy and finely divided, shops wide-paned under a
 * band for their signs, houses mostly wall; the works of a town show a strip
 * high up and little else.
 *
 * The margins are kept small on anything low. They come out of the storeys,
 * and on a building of two storeys they are a good part of its height.
 *
 * Flats, offices, shops, hotels, schools and town halls run their windows
 * together into one band a floor, as the project this one grew out of drew
 * them; all but the flats divide the band with mullions, the flats' being the
 * rail of a walkway or a balcony. Works run theirs into one strip as well, as
 * undivided as the flats'. The glass and the mullions are the viewer's colours,
 * which are that project's too, but for the pale frosted glass of warehouses.
 *
 * That one colour is not in here. It is the library's, and the library's
 * comes under everything a page says (see {@link windowColour}), but a colour
 * in a table handed to `windows.styles` is the page's, and the page's colour
 * for one usage comes over the one it gave every window. Kept in here, a page
 * that built its own from these numbers, or handed them back to put the shapes
 * back, would be saying the warehouses' glass as its own without meaning to,
 * and the colour it gave every window would stop at the warehouses.
 *
 * They are set out one usage at a time, so overriding one is a matter of
 * naming it. Frozen, since a page reading the library's numbers to build its
 * own from has no business changing them for every other layer as well.
 */
export const DEFAULT_WINDOW_STYLES: Readonly<WindowStyles> = frozen({
  // The standard sliding window, 1.69m by 1.17m, one to a room.
  住宅: { width: 1.7, height: 1.1, padTop: 0.2, padBottom: 0.2, padSide: 0.6, gap: 1.8 },
  // The open strip between a walkway's rail and the slab over it, run on from
  // one flat to the next: a thin line under each floor's ceiling, as the
  // project this one grew out of drew it, and mostly wall below.
  共同住宅: { width: 3, height: 0.8, padTop: 0.3, padBottom: 0.3, padSide: 0.5, gap: 0 },
  // The house, over a floor of shutters and signs.
  店舗等併用住宅: { width: 1.7, height: 1.2, padTop: 0.3, padBottom: 1.2, padSide: 0.5, gap: 1.5 },
  // The flats, over a floor of shops.
  店舗等併用共同住宅: { width: 2.8, height: 1.5, padTop: 0.3, padBottom: 1.5, padSide: 0.5, gap: 0.6 },
  // Smaller windows, over a shuttered workshop.
  作業所併用住宅: { width: 1.4, height: 1, padTop: 0.3, padBottom: 1.2, padSide: 0.8, gap: 1.8 },
  // A band of glass on a 1.8m module, taking most of the storey.
  業務施設: { width: 1.8, height: 2, padTop: 0.6, padBottom: 0.4, padSide: 0.6, gap: 0, mullionWidth: 0.6 },
  // Wide panes in a band, under a band of wall for the signs.
  商業施設: { width: 3.6, height: 2, padTop: 1.2, padBottom: 0.6, padSide: 0.8, gap: 0, mullionWidth: 0.6 },
  // One narrow pane to each narrow room, in a band over the lobby.
  宿泊施設: { width: 1.2, height: 1.3, padTop: 0.8, padBottom: 1.2, padSide: 1, gap: 0, mullionWidth: 0.6 },
  // Shops and offices in one: the tallest glass of any, and close to the widest.
  商業系複合施設: { width: 3, height: 2.3, padTop: 1, padBottom: 1, padSide: 0.6, gap: 0.3 },
  // Wards in a steady row, with wall at the ends.
  医療施設: { width: 2.2, height: 1.7, padTop: 0.8, padBottom: 0.6, padSide: 1.2, gap: 1.2 },
  // A classroom glazed most of its height, between blank stair towers.
  文教厚生施設: {
    width: 1.8,
    height: 2.1,
    padTop: 0.6,
    padBottom: 0.5,
    padSide: 2,
    gap: 0,
    mullionWidth: 0.6,
  },
  // Upright panes in a band, a little more sober than an office's.
  官公庁施設: {
    width: 1.5,
    height: 1.8,
    padTop: 0.8,
    padBottom: 0.8,
    padSide: 1.2,
    gap: 0,
    mullionWidth: 0.6,
  },
  // Halls: more wall than glass, and most of it at the edges.
  その他公共施設: { width: 2.6, height: 1.5, padTop: 1.2, padBottom: 1, padSide: 1.6, gap: 1.6 },
  // Long, low windows high up over blank wall, close together. Their pale
  // frosted glass is in LIBRARY_WINDOW_COLOURS; see above.
  運輸倉庫施設: { width: 6, height: 0.8, padTop: 0.5, padBottom: 2, padSide: 2, gap: 1.05 },
  // One long, low strip of glass along the top of a tall floor, end to end,
  // the way a shed is lit.
  工場: { width: 2.4, height: 1, padTop: 0.5, padBottom: 2, padSide: 1.2, gap: 0 },
  // A few small windows in a barn or a shed.
  農林漁業用施設: { width: 1.2, height: 0.9, padTop: 0.4, padBottom: 1.2, padSide: 1.5, gap: 2.5 },
  // Plants and substations: little more than a slot near the top.
  供給処理施設: { width: 1.2, height: 0.6, padTop: 0.6, padBottom: 2.5, padSide: 2.5, gap: 4 },
  // Small windows, well inside the wall.
  防衛施設: { width: 1.4, height: 1.2, padTop: 0.8, padBottom: 1, padSide: 1.5, gap: 2 },
  // Temples, sheds, garages: small windows, and wall at the corners.
  その他: { width: 1.5, height: 1, padTop: 0.5, padBottom: 0.6, padSide: 1, gap: 2 },
  // It could be anything, so something between a house and an office.
  不明: { width: 1.8, height: 1.4, padTop: 0.5, padBottom: 0.5, padSide: 0.8, gap: 1 },
})

/**
 * @internal The library's own colours for the usages that have one: the pale
 * frosted glass of a warehouse, and nothing else.
 *
 * The bottom of the order {@link windowColour} takes colours in, over only the
 * palette. A table of its own rather than a field of
 * {@link DEFAULT_WINDOW_STYLES}, since a colour there would read as the page's
 * the moment a page handed that table back; see there.
 */
export const LIBRARY_WINDOW_COLOURS: Readonly<
  Partial<Record<BuildingUsage, Readonly<Pick<WindowStyle, 'color' | 'mullionColor'>>>>
> = Object.freeze({
  運輸倉庫施設: Object.freeze({ color: '#d6d6d6' }),
})

/** Where a usage sits in the list, counting from 1. 0 is no windows at all. */
export function usageNumber(usage: string): number {
  const found = BUILDING_USAGES.indexOf(usage as BuildingUsage)
  // Anything the survey did not name is drawn as 不明, which is last.
  return (found < 0 ? BUILDING_USAGES.length - 1 : found) + 1
}

/**
 * Fills a style in from the default for that usage.
 *
 * A usage asked for by a name PLATEAU does not use is refused rather than let
 * go: misspelt, it would otherwise be a setting that quietly never shows.
 *
 * Every length is filled in, and no colour is. A colour left out is not the
 * usage's default but the next thing up — the layer's, then the theme's —
 * and only past all of those the library's own colour for the usage; see
 * {@link windowColour}. Filled in here, the warehouses' frosted glass would
 * stand in front of a colour the page had given every window, and the table
 * a page reads back would say a colour the walls are not drawn in.
 *
 * What comes back is frozen, all the way down: it is what
 * {@link Windows.styles} hands back, and a page writing into it would be
 * writing into nothing.
 */
export function windowStyles(asked: WindowStylesAsked): Readonly<WindowStyles> {
  for (const name of Object.keys(asked)) {
    if (!(BUILDING_USAGES as readonly string[]).includes(name)) {
      throw new RangeError(`no building usage is called ${name}: see BUILDING_USAGES`)
    }
  }
  const styles = {} as WindowStyles
  for (const usage of BUILDING_USAGES) {
    const base = DEFAULT_WINDOW_STYLES[usage]
    const over = asked[usage] ?? {}
    const named = (field: string): string => `window ${field} for ${usage}`
    // Field by field: a field given as undefined asks for the default, and
    // spreading it would put the undefined over the default and then take it.
    const width = positiveMetres(over.width ?? base.width, named('width'))
    const mullionWidth = metres(over.mullionWidth ?? base.mullionWidth ?? 0, named('mullionWidth'))
    // A mullion as wide as the window leaves no glass to divide.
    if (mullionWidth >= width) {
      throw new RangeError(
        `${named('mullionWidth')} must be narrower than the window, ${width}m, not ${mullionWidth}`,
      )
    }
    styles[usage] = {
      width,
      height: positiveMetres(over.height ?? base.height, named('height')),
      padTop: metres(over.padTop ?? base.padTop, named('padTop')),
      padBottom: metres(over.padBottom ?? base.padBottom, named('padBottom')),
      padSide: metres(over.padSide ?? base.padSide, named('padSide')),
      gap: metres(over.gap ?? base.gap, named('gap')),
      mullionWidth,
      // Only where the page said one; see above
      ...(over.color !== undefined ? { color: over.color } : {}),
      ...(over.mullionColor !== undefined ? { mullionColor: over.mullionColor } : {}),
    }
  }
  return frozen(styles)
}

/**
 * Which colour one usage's glass, or its bars, is drawn in.
 *
 * Four hands may say it, and they are taken by how much of the city each one
 * is about (CLAUDE.md, contract 12, rule 4): the page's colour for this usage,
 * then the page's colour for every window ({@link Windows.color}), then the
 * page's theme, which is about the whole map. Under all three the library's
 * own colour for the usage — the warehouses' frosted glass, in
 * {@link LIBRARY_WINDOW_COLOURS} — and under that the library's palette.
 *
 * The theme is asked whether it names the slot at all, rather than read off
 * the palette, because the palette has already put the theme over the
 * library's colour by then and cannot say which of the two it is holding. A
 * page that wrote `theme: { window }` meant every window, the warehouses'
 * among them.
 */
export function windowColour(
  usage: ThemeColor | undefined,
  layer: ThemeColor | undefined,
  themed: boolean,
  library: ThemeColor | undefined,
  palette: ColorRepresentation,
  night: boolean,
): ColorRepresentation {
  const said = usage ?? layer ?? (themed ? undefined : library)
  return said === undefined ? palette : colorFor(said, night)
}

/**
 * What makes a building a tower, and what it wears on top.
 *
 * A tower is finished off with a band of plant and screens rather than with
 * its last floor of offices or flats, whatever it is used for. So from some
 * number of storeys up, the top margin stops being the usage's and is this.
 *
 * The shape of the default and of what the paint reads, not of anything a page
 * hands over: two numbers are two settings, `windows.highRiseStoreys` and
 * `windows.highRisePadTop`, the way the parapet's size is its three.
 */
export interface HighRise {
  /** How many storeys a building needs to be one: that many or more. */
  readonly storeys: number
  /** Wall left above the topmost row, below the parapet, in place of the usage's. */
  readonly padTop: number
}

/**
 * Eleven storeys, and five metres on top.
 *
 * Japan draws the line for a high-rise at 31m, which is ten storeys or so, and
 * asks more of a building from its eleventh floor up.
 */
export const DEFAULT_HIGH_RISE: HighRise = Object.freeze({ storeys: 11, padTop: 5 })

/**
 * A count of storeys that can make a high-rise, or a RangeError saying so.
 *
 * Refused where it is written rather than drawn with: the paint compares a
 * building's storeys against it, so a count under one makes every building a
 * tower and one that is not a number makes none of them, without a word.
 */
export function highRiseStoreys(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`high-rise storeys must be a number from 1 up, not ${value}`)
  }
  return value
}

/** A table of styles with each of them frozen, and the table round them. */
function frozen(styles: WindowStyles): Readonly<WindowStyles> {
  for (const usage of BUILDING_USAGES) Object.freeze(styles[usage])
  return Object.freeze(styles)
}
