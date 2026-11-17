import { Fn, If, attribute, float, fwidth, mix, positionGeometry, varying } from 'three/tsl'
import { uniform, uniformArray } from '../repaint.js'
import { Color, Vector4, type Node, type NodeBuilder, type ColorRepresentation } from 'three/webgpu'
import {
  BUILDING_USAGES,
  DEFAULT_HIGH_RISE,
  type BuildingUsage,
  type HighRise,
  type WindowStyles,
} from './windowStyle.js'
import { WINDOW_FRAME, WINDOW_USAGE } from './windows.js'

/**
 * Painting the windows onto the walls.
 *
 * A window is a rectangle of another colour on a wall that is already there,
 * so all of this happens where the wall is drawn, one point at a time. The
 * vertex says where on its wall this is — how far across the field of the wall
 * windows go in, how wide that is, where its top and its foot are and how
 * steeply the top runs — and of its building, what it is used for, where it
 * stops and how many storeys it stands. The settings say how big a window is,
 * how much wall to leave around the lot and between two, and how the glass is
 * divided and coloured. Between them they say whether this point is glass.
 *
 * The settings live in uniforms rather than on the vertices, so changing them
 * is a number written before the next frame rather than every wall in the city
 * read and marked up again.
 *
 * Down the wall: the rows belong to the building, not to the wall. They start
 * at the top of the building, less the parapet standing on it where it has a
 * flat roof to stand on and the margin left under that, and what is left down
 * to the bottom margin is shared out among its storeys. A high-rise leaves a
 * margin of its own on top instead, but only at its top: a podium or a step
 * back keeps the margin any building would. A wall that stops short of the
 * building's top — a wing, a lower half set back from the front — keeps those
 * places and simply leaves off at the last row that fits under its own top, so
 * its windows line up with the ones beside it instead of being squeezed into
 * whatever height it has. One whose foot stands off the ground — over an open
 * ground floor, or set back over the storey below — takes up at the first row
 * that clears its foot by the bottom margin, the same way. A row is there whole
 * or not at all; where the top of the field slopes, each window of it is asked
 * the same on its own.
 *
 * Across it: as many windows as fit inside the side margins with the gap asked
 * for between each two, and whatever the wall has over widens every gap by one
 * share and each end by half of one. With no gap the windows are one band,
 * which takes it into its panes instead. Mullions divide the glass: a bar down
 * the middle of each window, or one where each pane of a band meets the next.
 *
 * An edge is not drawn as a yes or a no but as how much of the pixel it covers,
 * measured against how far the wall moves across one. That softens an edge,
 * but a pixel still sees only the one window it falls in: once a storey or a
 * column is down to a few pixels, the next pixel lands on glass or on wall by
 * chance, and a district of them crawls and flashes as the view turns. So as
 * a pixel comes to cover more of one, the pattern melts into the share of the
 * wall its glass takes, and past that towards the bare wall: the near
 * buildings carry the windows, and the far ones read as tone. Melting can be
 * turned off, to see every window drawn as hard as it can be.
 */

/**
 * How fast the pattern melts as a pixel comes to cover more of a storey or a
 * column. A pixel holding this much of one leaves nothing of it: at 1 a storey
 * has to stand a pixel tall to show at all, and sixteen to show itself nearly
 * whole.
 */
const MELT = 1

/**
 * What is left of the glass once it has melted. Under the share of the wall
 * it takes, so a district seen from far off reads as pale stone with a grain
 * in it rather than as a field of glass.
 */
const MELTED = 0.12

/**
 * The most of its storey's height a window may take.
 *
 * A window taller than the floor it is set into leaves no wall above or below
 * it, and a row of them reads as one sheet of glass rather than as windows.
 * The storeys can come out short for reasons the shader cannot see — a wall
 * that is barely taller than its margins, a count the survey overstated — so
 * the window is held inside its own floor here rather than trusted to fit.
 */
const SASH_SHARE = 0.8

/** A distance to an edge that is not there: far enough that nothing is measured against it. */
const OPEN = 1e4

type Triple = Node<'vec3'>

/**
 * The windows, painted into the wall colour one point at a time.
 *
 * Everything a usage sets — the size of a window, the four margins, the gap,
 * the mullions and the colours of both — sits in uniform arrays read by the
 * usage number the vertex carries, and beside them what holds for every
 * building alike: where a high-rise starts and what it leaves on top, how deep
 * the parapet is cut, whether windows are drawn at all and whether they melt
 * from far off.
 */
export class WindowPaint {
  /** Per usage: how wide a window is, how tall, the side margin, the top one. */
  private readonly shapes = BUILDING_USAGES.map(() => new Vector4())
  /** Per usage: the bottom margin. */
  private readonly padBottoms = BUILDING_USAGES.map(() => 0)
  /** Per usage: the wall between two windows side by side. */
  private readonly gaps = BUILDING_USAGES.map(() => 0)
  /** Per usage: how wide the bars dividing the glass are. */
  private readonly mullionWidths = BUILDING_USAGES.map(() => 0)
  /** Per usage: the glass, and the bars dividing it. */
  private readonly glassColours = BUILDING_USAGES.map(() => new Color())
  private readonly mullionColours = BUILDING_USAGES.map(() => new Color())
  private readonly shapeOf = uniformArray<'vec4'>(this.shapes, 'vec4')
  private readonly padBottomOf = uniformArray<'float'>(this.padBottoms, 'float')
  private readonly gapOf = uniformArray<'float'>(this.gaps, 'float')
  private readonly mullionWidthOf = uniformArray<'float'>(this.mullionWidths, 'float')
  private readonly glassColourOf = uniformArray<'color'>(this.glassColours, 'color')
  private readonly mullionColourOf = uniformArray<'color'>(this.mullionColours, 'color')
  /** How many storeys make a building a high-rise. */
  private readonly highRiseStoreys = uniform(DEFAULT_HIGH_RISE.storeys)
  /** The wall a high-rise leaves over its topmost row, in place of its usage's. */
  private readonly highRisePadTop = uniform(DEFAULT_HIGH_RISE.padTop)
  /**
   * How far down from the top of a building the parapet standing on it reaches.
   *
   * The parapet is cut into the roof rather than raised above the wall, so a
   * wall's own top is the top of the building: without this the top row of
   * windows would sit behind it. Only a building with a flat roof for its
   * ceiling has one to take off; one stopped by its walls has nothing standing
   * over its top row.
   */
  private readonly parapet = uniform(0)
  /**
   * 1 where windows are drawn, 0 where the walls are left plain.
   *
   * The walls are marked up whether or not any are wanted, so turning them off
   * is a number rather than every mesh on screen read and rebuilt. What that
   * costs is 32 bytes a vertex on a scene that never asks for a window.
   */
  private readonly showing = uniform(1)
  /** 1 where the windows melt into the wall as they shrink, 0 where they are drawn hard. */
  private readonly melting = uniform(1)

  /** Whether any windows are drawn at all. */
  set on(yes: boolean) {
    this.showing.value = yes ? 1 : 0
  }

  /** Whether the windows melt into the wall as a pixel comes to cover more of one. */
  set melt(yes: boolean) {
    this.melting.value = yes ? 1 : 0
  }

  /**
   * Follows the settings. The node holds these, not the values.
   *
   * The sizes only. A usage's colours are not its own to settle — the layer,
   * the theme and the palette all have a say — so they come in through
   * {@link paintColours} as answers.
   */
  set styles(styles: Readonly<WindowStyles>) {
    for (let i = 0; i < BUILDING_USAGES.length; i++) {
      const usage = BUILDING_USAGES[i]
      const shape = this.shapes[i]
      if (!usage || !shape) continue
      const style = styles[usage]
      shape.set(style.width, style.height, style.padSide, style.padTop)
      this.padBottoms[i] = style.padBottom
      this.gaps[i] = style.gap
      this.mullionWidths[i] = style.mullionWidth ?? 0
    }
  }

  /** Where a building becomes a high-rise, and what it leaves on top. */
  set highRise(tower: HighRise) {
    this.highRiseStoreys.value = tower.storeys
    this.highRisePadTop.value = tower.padTop
  }

  /** How deep a parapet is being cut, or 0 where the roofs are left whole. */
  set parapetDepth(metres: number) {
    this.parapet.value = metres
  }

  /**
   * What each usage's glass and bars are drawn in, already settled.
   *
   * Handed in as answers rather than worked out here: the answer runs through
   * the usage's own colour, the layer's, the theme's and the palette's, read
   * for whichever palette now stands, and only the layer holds all of those.
   * See `windowColour`.
   */
  paintColours(
    glassOf: (usage: BuildingUsage) => ColorRepresentation,
    mullionOf: (usage: BuildingUsage) => ColorRepresentation,
  ): void {
    for (let i = 0; i < BUILDING_USAGES.length; i++) {
      const usage = BUILDING_USAGES[i]
      if (!usage) continue
      this.glassColours[i]?.set(glassOf(usage))
      this.mullionColours[i]?.set(mullionOf(usage))
    }
  }

  /**
   * The wall colour with the windows set into it.
   *
   * What comes back is a colour, not a light: it goes into the wall's albedo
   * and the scene's own sun and sky are what multiply it, so a window on a
   * wall turned from the sun darkens with the wall it is on.
   */
  over(wall: Triple): Triple {
    const frame = attribute(WINDOW_FRAME, 'vec4')
    const usage = attribute(WINDOW_USAGE, 'vec4')
    // How high up the wall a place is, in the metres the wall was cut with.
    // A motion moving the building writes where its corners are drawn into
    // `positionLocal`, while everything the windows are set out from — the
    // ceiling, the foot, how many storeys — is in the metres it came with.
    // Read the drawn height against those and a lifted building has its
    // windows slide down its wall.
    const cutHeight = varying(positionGeometry.y, 'plateauCutHeight')

    return Fn((builder: NodeBuilder) => {
      // A wall with no windows set into it is wall, and is drawn as one. A tile
      // stood while the windows are off is never fitted for them — the roads
      // that say where they go are not fetched for nobody to see — and neither
      // is a mesh where no wall took one, so neither carries the two
      // attributes. Asked for one a geometry does not have, three reads nought
      // and says so on the console; nought is no usage, so the picture came out
      // right and the warning was all there was. Asked here instead, as the
      // shader is put together for that geometry: three puts one together for
      // each set of attributes a material meets (`getGeometryCacheKey`), so the
      // one for geometry without them simply leaves the windows out. Filling
      // the two with noughts would have said the same thing at 32 bytes a
      // vertex — 64 MB of them for the district `zilla` stands in.
      // What three's own `hasGeometryAttribute` asks, which its types leave
      // out — and as it asks, since a builder may have no geometry at all.
      const carries = (name: string): boolean => Boolean(builder.geometry?.getAttribute(name))
      if (!carries(WINDOW_USAGE) || !carries(WINDOW_FRAME)) return wall
      const colour = wall.toVar()
      // How far the wall moves across one pixel, up it and along it. Measured
      // on the height and the distance along the wall, which run smoothly, and
      // not on the row or the column: those count from a floor, which jumps a
      // whole storey at every edge, and a pixel cannot be measured on something
      // that jumps. And measured here, before anything below branches: a pixel
      // is measured against its neighbours, and a neighbour that took the other
      // branch has nothing to be measured with. Measured inside, every edge
      // where a window may stop — along the tops of the top row, down the side
      // margins — came out as a dotted line across the bare wall.
      // Measured on the corner as it was cut, not as it is drawn. A motion
      // moving the building writes where its corners are drawn into
      // `positionLocal`, while everything the windows are set out from — the
      // ceiling, the foot, how many storeys — is in the metres the wall came
      // with. Read the drawn height against those and a lifted building has
      // its windows slide down its wall.
      const pixelUp = fwidth(cutHeight).toVar()
      const pixelAlong = fwidth(frame.x).toVar()
      // Roofs, and walls that look at nothing, carry no usage and are wall.
      If(usage.x.greaterThan(0.5).and(this.showing.greaterThan(0.5)), () => {
        // The usages are numbered from 1 so that 0 can mean no windows; the
        // half keeps a whole number that arrived a hair under from dropping a
        // place when it is cut to an integer.
        const usageIndex = usage.x.sub(0.5).toInt()
        const shape = this.shapeOf.element(usageIndex)
        const windowWidth = shape.x
        const windowHeight = shape.y
        const padSide = shape.z
        const usagePadTop = shape.w
        const padBottom = this.padBottomOf.element(usageIndex)
        const gap = this.gapOf.element(usageIndex)
        const mullionWidth = this.mullionWidthOf.element(usageIndex)

        const across = frame.x
        const fieldWidth = frame.y
        const fieldTop = frame.z
        const storeys = frame.w
        // The building's ceiling, negative where no flat roof stops it and so
        // no parapet stands over its top row.
        const roofTop = usage.y.abs()
        const parapetHere = usage.y.greaterThan(0).select(this.parapet, float(0))
        const foot = usage.z
        const slope = usage.w
        const height = cutHeight

        // Down the building, from its top: the rows are its storeys. A
        // high-rise leaves a margin of its own on top, whatever it is for.
        const padTop = storeys.greaterThanEqual(this.highRiseStoreys).select(this.highRisePadTop, usagePadTop)
        const rowsTop = roofTop.sub(parapetHere).sub(padTop)
        const room = rowsTop.sub(padBottom)
        const storey = room.div(storeys)
        const under = rowsTop.sub(height)
        const row = under.div(storey).floor()
        const sash = windowHeight.min(storey.mul(SASH_SHARE))
        const head = rowsTop.sub(row.mul(storey))
        const sill = head.sub(sash)

        // How many of those rows stand above this wall altogether. A row the
        // wall holds only half of is one of them: half a row of windows cut
        // off along a roofline reads as a mistake, and a row missing does not.
        // The parapet and the usage's top margin fall out of it, being taken
        // off both. What a high-rise leaves over that belongs to its top alone:
        // a podium or a step back keeps only the margin any building would. A
        // row above the building's top is one of these too, so nothing further
        // needs to keep the rows under it.
        const crown = padTop.sub(usagePadTop).max(0)
        const missing = roofTop.sub(fieldTop).sub(crown).div(storey).sub(0.001).ceil().max(0)

        // Across it: each window is a column with half a gap either side of it.
        // The end windows want no gap past them, the side margin being the wall
        // there, so the two halves they do not use are added to the width
        // inside the margins before it is shared out. What a wall has over then
        // widens every gap and both ends alike.
        const inside = fieldWidth.sub(padSide.mul(2))
        const span = inside.add(gap)
        const columns = span.div(windowWidth.add(gap)).floor()
        const column = span.div(columns.max(1))
        const along = across.sub(padSide)
        const intoSpan = along.add(gap.mul(0.5))
        const pane = intoSpan.div(column).floor()
        const middle = pane.mul(column).add(column.mul(0.5))
        // With no gap the windows are a band, and each takes the whole of its
        // column; otherwise a window stands in the middle of its own.
        const banded = gap.lessThan(0.001)
        const halfGlass = banded.select(column, windowWidth).mul(0.5)

        // Where the top of the field slopes, how far it has fallen from its high
        // end by the time it is over a window. It is asked at the corner nearer
        // the low end, moved out by the side margin, so a window steps clear of
        // the slope the way it stands clear of the wall's ends; over that the
        // window keeps the margin any top would leave — its usage's, or at the
        // building's own top the smaller of that and a high-rise's. A pane of a
        // band is asked the same, and so are its neighbours: where the next one
        // is there too, the two run on into each other with no edge between.
        const atTop = fieldTop.greaterThanEqual(roofTop.sub(0.01))
        const margin = atTop.select(usagePadTop.min(padTop), usagePadTop)
        const limit = fieldTop.sub(parapetHere).sub(margin).add(0.01)
        // The window's two sides moved out by the side margin, measured from
        // the start of the field.
        const outLeft = middle.sub(gap.mul(0.5)).sub(halfGlass)
        const outRight = middle.sub(gap.mul(0.5)).add(halfGlass).add(padSide.mul(2))
        const clearBy = (shift: Node<'float'>) =>
          head
            .add(
              slope
                .mul(fieldWidth.sub(outLeft.add(shift)))
                .max(slope.negate().mul(outRight.add(shift)))
                .max(0),
            )
            .lessThanEqual(limit)
        const clear = clearBy(float(0))
        const leftOpen = banded.and(pane.greaterThanEqual(1)).and(clearBy(column.negate()))
        const rightOpen = banded.and(pane.lessThan(columns.sub(1))).and(clearBy(column))

        // Where a window may be at all: inside the margins, on a storey there is.
        const glazed = room
          .greaterThan(0)
          .and(columns.greaterThanEqual(1))
          .and(row.greaterThanEqual(missing))
          .and(row.lessThan(storeys))
          .and(sill.greaterThanEqual(foot.add(padBottom)))
          .and(clear)
          .and(along.greaterThanEqual(0))
          .and(along.lessThanEqual(inside))

        // How far inside the glass this point is, down the wall and across it.
        // Across a band, a side the next pane carries on from is no edge.
        const intoRow = under.sub(row.mul(storey))
        const down = intoRow.min(sash.sub(intoRow))
        const fromLeft = intoSpan.sub(middle.sub(halfGlass))
        const fromRight = middle.add(halfGlass).sub(intoSpan)
        const sideways = leftOpen.select(float(OPEN), fromLeft).min(rightOpen.select(float(OPEN), fromRight))

        // Melted into the share of its storey and its column the glass takes,
        // as a pixel comes to cover more of either, and past that towards the
        // bare wall: near, the windows come back on their own. Down the wall
        // and across it melt apart, a wall seen at a slant losing its columns
        // well before its rows.
        const sharpUp = this.sharpness(pixelUp, storey)
        const sharpAlong = this.sharpness(pixelAlong, column)
        const tall = mix(sash.div(storey), edge(down, pixelUp), sharpUp)
        const wide = mix(halfGlass.mul(2).div(column).min(1), edge(sideways, pixelAlong), sharpAlong)
        const left = mix(float(MELTED), float(1), sharpUp.min(sharpAlong))
        const glass = glazed.select(tall.mul(wide).mul(left), float(0))
        colour.assign(mix(colour, this.glassColourOf.element(usageIndex), glass))

        // The mullions: down the middle of a window, or where one pane of a
        // band meets the next. They thin out as the pixel grows past them and
        // are gone by the time it is twice their width, a fine grid drawn at
        // that size being a moire and not a grid.
        const toBar = banded.select(
          leftOpen.select(fromLeft, float(OPEN)).min(rightOpen.select(fromRight, float(OPEN))),
          intoSpan.sub(middle).abs(),
        )
        const fading = pixelAlong.div(mullionWidth.mul(2).max(1e-6)).oneMinus().clamp(0, 1)
        const bar = mullionWidth
          .greaterThan(0)
          .select(edge(mullionWidth.mul(0.5).sub(toBar), pixelAlong).mul(fading), float(0))
        colour.assign(mix(colour, this.mullionColourOf.element(usageIndex), glass.mul(bar)))
      })
      return colour
    })() as Triple
  }

  /**
   * How much of the pattern is left standing, from 1 where a period of it is
   * many pixels wide down to 0 where one pixel holds it; always 1 with melting
   * turned off.
   */
  private sharpness(pixel: Node<'float'>, period: Node<'float'>): Node<'float'> {
    return pixel.div(period.max(1e-6)).mul(MELT).mul(this.melting).oneMinus().clamp(0, 1)
  }
}

/**
 * How much of a pixel lies inside an edge, given how far in it is and how far
 * the wall moves across one pixel. The pixel is the caller's to measure, and
 * outside any branch.
 */
function edge(into: Node<'float'>, pixel: Node<'float'>): Node<'float'> {
  return into.div(pixel.max(1e-6)).add(0.5).clamp(0, 1)
}
