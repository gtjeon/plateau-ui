import type { ThemeColor } from '../theme.js'
import { metres } from './lengths.js'
import { DEFAULT_CLEARANCE } from './neighbours.js'
import { DEFAULT_REACH } from './roads.js'
import {
  DEFAULT_HIGH_RISE,
  highRiseStoreys,
  windowStyles,
  type BuildingUsage,
  type WindowStyles,
  type WindowStylesAsked,
} from './windowStyle.js'
import { DEFAULT_TALL } from './windows.js'

/**
 * The windows a city sets into its walls, as a page asks for them; see
 * {@link Windows}, which is the same names on the running layer.
 */
export interface WindowsOptions {
  /** Whether they are drawn. Defaults to `true`. */
  visible?: boolean
  /**
   * The glass. Left out, the viewer's window colour.
   *
   * Under a colour a usage gives its own glass in {@link styles}, which says
   * more than this does.
   */
  color?: ThemeColor
  /** The bars between the panes, as {@link color} is the glass. */
  mullionColor?: ThemeColor
  /**
   * Melt the windows into the wall as they shrink on screen. Defaults to `true`.
   *
   * A window a few pixels across lands on glass or on wall by chance from one
   * pixel to the next, and a district of them crawls as the view moves. Melted,
   * the near buildings carry the windows and the far ones read as tone.
   */
  melt?: boolean
  /**
   * What one window looks like, how much wall is left around the lot and
   * between two of them, how the glass is divided and what colour it and its
   * mullions are, for each of PLATEAU's usages. What is left out follows the
   * default for that usage; a colour left out follows {@link color}.
   */
  styles?: WindowStylesAsked
  /**
   * How many storeys make a building a high-rise: that many or more. Defaults
   * to 11.
   *
   * A tower is finished off with a band of plant and screens, whatever it is
   * used for, so from here up the top of its walls is {@link highRisePadTop}
   * rather than its usage's.
   */
  highRiseStoreys?: number
  /**
   * The wall a high-rise leaves over its topmost row, below the parapet, in
   * place of its usage's, in metres. Defaults to 5.
   */
  highRisePadTop?: number
  /**
   * How far a wall may stand back from a road and still be given windows, in
   * metres. Defaults to 20.
   *
   * A building shows its face to the street and its back to its neighbour, and
   * this is what tells the two apart.
   */
  reach?: number
  /**
   * How close a building may stand in front of a wall before it takes no
   * windows, in metres. Defaults to 3, and 0 lets a wall be built in.
   *
   * A wall can look down a street and still be shut in by the neighbour it was
   * built against. Only the buildings of the wall's own tile are looked at, so
   * a wall shut in from across a tile's edge is not told of it.
   */
  clearance?: number
  /**
   * How tall a building has to stand to take windows on every wall, whatever
   * lies around it, in metres. Defaults to 36, and 0 dresses every wall.
   *
   * Over the roofs of its neighbours a wall looks out on the city whichever
   * way it turns, so neither the road nor the neighbour is asked about.
   */
  tall?: number
}

/**
 * @internal What a change to the windows sets going in the layer they belong
 * to. Two doors because the two kinds of change cost two different things.
 */
export interface WindowsHost {
  /**
   * Something the paint reads changed: whether they are drawn, how they melt,
   * their sizes, their colours. Written as numbers before the next frame.
   */
  repaint(): void
  /**
   * Something the walls are read with changed, or the windows were turned on
   * over walls that may never have been read for them. `changed` says which:
   * a setting that moved, or only the turning on.
   */
  reread(changed: boolean): void
  /** The colour one usage's glass or bars is drawn in now, as `#rrggbb`. */
  colorOf(usage: BuildingUsage, part: 'glass' | 'mullion'): string
}

/**
 * The windows set into the walls, and every setting they are drawn by; see
 * {@link Buildings.windows}.
 *
 * A part of the layer with settings of its own, the way three's `light.shadow`
 * is a part of the light: the names are the ones {@link WindowsOptions} takes,
 * each of them read and written here. Turning them off with `visible` keeps
 * every other setting, as turning off three's `shadowMap.enabled` keeps its
 * `type`.
 *
 * Writing costs one of two things. Most of it reaches the screen as numbers
 * written before the next frame — the sizes and the colours were never worked
 * into the corners, only where on its wall's field each window lies, what its
 * building is used for, where it stops and how many storeys it stands. `reach`,
 * `clearance` and `tall` decide where a window may be cut at all, which is done
 * as a tile lands; changing one while the windows are drawn lets the tiles go
 * to be stood again, the same trip the land's heights ask for and the same
 * picture — the city standing up where it already was.
 *
 * Changed while the windows are off, it waits for them to be turned on: the
 * walls would be read for nobody to see, and the city would rise out of the
 * ground again for a setting that shows nothing. Turning them on stands the
 * tiles again then, and over a city that was stood without them as well, since
 * a tile landing with the windows off is not read for them and does not fetch
 * the roads that decide where they go.
 */
export class Windows {
  private _visible: boolean
  private _color: ThemeColor | undefined
  private _mullionColor: ThemeColor | undefined
  private _melt: boolean
  private _styles: Readonly<WindowStyles>
  private _highRiseStoreys: number
  private _highRisePadTop: number
  private _reach: number
  private _clearance: number
  private _tall: number

  /** @internal Made by the layer the windows are part of, and by nothing else. */
  constructor(
    asked: WindowsOptions,
    private readonly host: WindowsHost,
  ) {
    this._visible = asked.visible ?? true
    this._color = asked.color
    this._mullionColor = asked.mullionColor
    this._melt = asked.melt ?? true
    this._styles = windowStyles(asked.styles ?? {})
    this._highRiseStoreys = highRiseStoreys(asked.highRiseStoreys ?? DEFAULT_HIGH_RISE.storeys)
    this._highRisePadTop = metres(asked.highRisePadTop ?? DEFAULT_HIGH_RISE.padTop, 'high-rise padTop')
    this._reach = metres(asked.reach ?? DEFAULT_REACH, 'window reach')
    this._clearance = metres(asked.clearance ?? DEFAULT_CLEARANCE, 'window clearance')
    this._tall = metres(asked.tall ?? DEFAULT_TALL, 'window tall')
  }

  /**
   * The colour one usage's glass is drawn in now, as `#rrggbb`: whichever of
   * the usage's own colour, {@link color}, the theme and the library's own
   * holds — the order contract 12's rule 4 sets — for the half of the day
   * the palette is in.
   *
   * What the city draws, asked of the city. A page showing a swatch per
   * usage had to copy the library's table of colours and its order of who
   * wins to say it, and showed the old colour the day the table changed.
   */
  colorOf(usage: BuildingUsage): string {
    return this.host.colorOf(usage, 'glass')
  }

  /** The same for the bars between the panes; see {@link colorOf}. */
  mullionColorOf(usage: BuildingUsage): string {
    return this.host.colorOf(usage, 'mullion')
  }

  /** Whether they are drawn. Every other setting is kept while they are not. */
  get visible(): boolean {
    return this._visible
  }

  set visible(on: boolean) {
    if (on === this._visible) return
    this._visible = on
    this.host.repaint()
    if (on) this.host.reread(false)
  }

  /** The glass, or nothing for the viewer's; see {@link WindowsOptions.color}. */
  get color(): ThemeColor | undefined {
    return this._color
  }

  set color(value: ThemeColor | undefined) {
    this._color = value
    this.host.repaint()
  }

  /** The bars between the panes, or nothing for the viewer's. */
  get mullionColor(): ThemeColor | undefined {
    return this._mullionColor
  }

  set mullionColor(value: ThemeColor | undefined) {
    this._mullionColor = value
    this.host.repaint()
  }

  /** Whether they melt into the wall as they shrink; see {@link WindowsOptions.melt}. */
  get melt(): boolean {
    return this._melt
  }

  set melt(on: boolean) {
    if (on === this._melt) return
    this._melt = on
    this.host.repaint()
  }

  /**
   * Each usage's window, filled out with the library's sizes.
   *
   * Read, it is the whole table, frozen: written into, it would be a copy
   * nobody reads. Written, it is replaced — what the new one leaves out goes
   * back to the default for that usage, not to what was there before — and
   * what it is handed is the same shape {@link WindowsOptions.styles} takes.
   * To change one usage, spread what is there:
   * `buildings.windows.styles = { ...buildings.windows.styles, 住宅: { ... } }`.
   *
   * Handed over whole because it is a table of twenty usages; a method a usage
   * would be twenty calls to say what one object says. A colour is in it only
   * where the page gave one, since one left out is not the usage's default but
   * {@link color}'s; see `windowColour`.
   */
  get styles(): Readonly<WindowStyles> {
    return this._styles
  }

  set styles(value: WindowStylesAsked) {
    this._styles = windowStyles(value)
    this.host.repaint()
  }

  /**
   * How many storeys make a building a high-rise; see
   * {@link WindowsOptions.highRiseStoreys}.
   *
   * Two numbers of their own rather than one object of two, as the parapet's
   * size is three: as an object, changing one would mean handing both back,
   * and what a page read would be a frozen copy rather than the setting.
   */
  get highRiseStoreys(): number {
    return this._highRiseStoreys
  }

  set highRiseStoreys(value: number) {
    const next = highRiseStoreys(value)
    if (next === this._highRiseStoreys) return
    this._highRiseStoreys = next
    this.host.repaint()
  }

  /** The wall a high-rise leaves on top; see {@link WindowsOptions.highRisePadTop}. */
  get highRisePadTop(): number {
    return this._highRisePadTop
  }

  set highRisePadTop(value: number) {
    const next = metres(value, 'high-rise padTop')
    if (next === this._highRisePadTop) return
    this._highRisePadTop = next
    this.host.repaint()
  }

  /**
   * How far a wall looks for a road; see {@link WindowsOptions.reach}. Stands
   * the tiles again while the windows are drawn, and while they are not, waits
   * for them to be turned on.
   */
  get reach(): number {
    return this._reach
  }

  set reach(value: number) {
    const next = metres(value, 'window reach')
    if (next === this._reach) return
    this._reach = next
    this.host.reread(true)
  }

  /**
   * How close a neighbour shuts a wall in; see {@link WindowsOptions.clearance}.
   * Stands the tiles again while the windows are drawn, and while they are not,
   * waits for them to be turned on.
   */
  get clearance(): number {
    return this._clearance
  }

  set clearance(value: number) {
    const next = metres(value, 'window clearance')
    if (next === this._clearance) return
    this._clearance = next
    this.host.reread(true)
  }

  /**
   * How tall a building dresses every wall; see {@link WindowsOptions.tall}.
   * Stands the tiles again while the windows are drawn, and while they are not,
   * waits for them to be turned on.
   */
  get tall(): number {
    return this._tall
  }

  set tall(value: number) {
    const next = metres(value, 'window tall')
    if (next === this._tall) return
    this._tall = next
    this.host.reread(true)
  }
}
