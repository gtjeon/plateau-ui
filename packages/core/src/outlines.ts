import {
  Break,
  Fn,
  If,
  Loop,
  cos,
  float,
  int,
  ivec2,
  screenUV,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { uniform } from './repaint.js'
import {
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  NodeMaterial,
  QuadMesh,
  RGBAFormat,
  RenderTarget,
  Vector2,
  type ColorRepresentation,
  type Node,
  type OrthographicCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { drawShapes } from './offscreen.js'
import { PICTURE_ONLY } from './passes.js'
import { colourBeforeTheCurve } from './tone.js'
import { lookup } from './lookup.js'

/** How many things may wear a line at once. */
const SLOTS = 256

/** How many rows the slot table has: colour with standing off, then width. */
const TABLE_ROWS = 2

/**
 * How many ways round itself each pixel looks.
 *
 * Sixteen: at five pixels they are two pixels apart out at the rim, which
 * rounds a corner near enough at a line this wide.
 */
const DIRECTIONS = 16

/**
 * How many steps out along each way, and the fewest there may be.
 *
 * The nearest step that meets another thing wearing a line is how far off it
 * is, so the steps are the grain the distance is known to, and the line's two
 * edges — where it begins and where it ends — both land on that grain. The
 * count is taken from how far the looking has to go, about a step to the
 * screen's own pixel, so the grain stays the same whatever a page asks for
 * rather than coarsening as the line is set further off — up to {@link
 * WIDEST_OUTLINE} steps, past which it does coarsen rather than cost more.
 *
 * The outermost step is the whole reach however many there are, so where one
 * line is asked for it ends exactly where it was asked to. Where it begins is
 * the one that falls on the grain, to half a pixel.
 *
 * Four at the fewest: a short line still wants its corners round. Sixteen at
 * the most, which is {@link WIDEST_OUTLINE} and the point past which a page is
 * paying for a picture nobody is reading that closely.
 */
const LEAST_STEPS = 4

/**
 * How many pixels of the lines' own picture go to one of the screen, each way.
 *
 * Two, so the picture is drawn at four times the screen's pixels.
 *
 * Everything here reads that picture and nothing else, so its grid is the grid
 * every line lands on. A wall running at any angle but flat or upright steps
 * down it a pixel at a time — the scene on screen is drawn with four samples
 * to a pixel and so has no such steps, but this picture holds a number and a
 * slot, and numbers cannot be averaged between neighbours: the mean of the
 * third building and the seventh is the fifth, which is a different building.
 * So it cannot be sampled more than once a pixel, and the line, found by
 * measuring to it, inherits its staircase.
 *
 * Two halves that step, and half a pixel is under what {@link SOFT_EDGE}
 * spreads the edge over, so the steps go into the shading rather than showing
 * as steps. Four times the fragments in the pass that draws this picture and
 * four times its memory — measured at about five in the hundred of a frame,
 * and thirteen megabytes becoming fifty on a laptop's screen.
 *
 * The other way round was tried: the picture left at one and the softening
 * spread to a pixel and a half instead, which costs nothing. It swallows the
 * step and the line with it — what is left reads as a shadow of a boundary
 * rather than a boundary. A line is wanted, so the step is paid for.
 */
const SHARPNESS = 2

/**
 * How far the line's edge is spread, in pixels of the screen.
 *
 * Half of one, which is what an edge wants: enough to shade the pixel the edge
 * falls in and no more. It is not here to hide the steps under it — see
 * {@link SHARPNESS} for what is — and spread wide enough to do that it stops
 * being an edge.
 */
const SOFT_EDGE = 0.5

/**
 * How far into a shape its own line reaches, in pixels of that picture.
 *
 * Drawn strictly outside, a line leaves a pale seam between itself and what it
 * is drawn round. The picture's own edge is not a hard one — a pixel half
 * covered by a wall is half the wall's colour and half the sky's — while this
 * picture's is: that pixel belongs to the building whole, so the line skips it
 * and what shows there is the half-and-half. Reaching a pixel in covers it.
 */
const INSET = SHARPNESS

/** How many ways round itself a pixel looks for the seam; see {@link INSET}. */
const SEAMS = 8

/**
 * The thinnest a thing may be and still wear its line whole, in pixels of the
 * page: one.
 *
 * This picture knows nothing of how much of a pixel a thing covers. A texel
 * belongs to one thing whole or to none, because a number cannot be averaged —
 * that is what {@link SHARPNESS} is there to make bearable, not to undo. The
 * canvas does know: it is drawn with four samples to a pixel, so a roof lying
 * over a quarter of one is a quarter of the wall's colour there and no more.
 *
 * Where a thing is thinner than a pixel the two part company, and the line is
 * drawn whole round something the screen has all but rubbed out. What shows it
 * is the edge of the screen. A building on its way off the top is cut thinner
 * and thinner, and the last of it is a sliver no eye can find — while its
 * line, three pixels of it, goes on standing against the edge with nothing
 * inside. Measured in the playground at a 16-pixel line: the picture held one
 * texel of the building, the canvas held about a quarter of the wall's colour
 * in that row, and the line came out at full strength. Turning or zooming
 * sweeps a whole stretch of roof through that state at once — a roof edge
 * lying along the edge of the screen is in it for its whole length — so a bar
 * of the line's colour appears and goes along the top of the map.
 *
 * So the line is cut to how much of a pixel the thing fills, which is as near
 * as this picture can come to the reckoning the canvas already made. A thing a
 * pixel thick or more is left exactly as it was, and that is everything
 * anybody can see.
 *
 * A pixel of the page and not of the picture, which is where a width and a
 * standing off are already given and so is the unit a reader has: a thing a
 * page pixel thick is a hairline they can point at, and it keeps its line
 * whole. Measured against a pixel of the picture instead — the finest this
 * can tell apart at all — the fading came far too late, because the picture
 * over-reports: a texel is the thing's whole or not at all, so a roof lying
 * over a fifth of one still fills it. Taken against a pixel of the page, the
 * over-reporting is a fifth of the reckoning rather than the whole of it.
 *
 * The other way round was considered: draw the picture over a margin beyond
 * the screen, so that a building on its way off is whole in it and its line
 * falls outside. That answers the sliver and then draws the line for buildings
 * that have left altogether — the line reaches in from the margin — which is
 * the same complaint over a wider band.
 */
const THINNEST = 1

/** How wide a line is where a page does not say, in pixels of the page. */
export const DEFAULT_OUTLINE_WIDTH = 3

/**
 * How far off the thing a line stands where a page does not say: against it.
 *
 * Against it is where a line round something belongs — set off, it reads as a
 * halo rather than as that thing's own edge. The standing off is there for the
 * pages that want the halo.
 */
export const DEFAULT_OUTLINE_GAP = 0

/**
 * The widest a line may be asked to be, in pixels of the page, counting how
 * far off the thing it stands as well: what every pixel then looks over.
 *
 * Sixteen. Past it the sweep coarsens — the steps are counted against the
 * screen's own pixels and held to this many — rather than costing more, so a
 * page asking for forty would be paying for a picture nobody is reading that
 * closely. Anything wider or further off is brought back to this, and it is
 * exported so that a page can see the ceiling rather than discover it: a
 * width of 24 and one of 40 come out the same line, and nothing else would
 * say why.
 */
export const WIDEST_OUTLINE = 16

/**
 * What a material says about the thing it draws, where that thing wears a
 * line — exactly what goes into the picture the lines are found in.
 *
 * Read by {@link Outlines} alone, the way `maskNode` is read by whatever draws
 * the scene again. A material without one draws a thing that wears no line,
 * which is still drawn into the picture: it hides what is behind it, and a
 * line is cut where it does.
 *
 * Four bytes, each said as nought to one: the slot its colour is in, then the
 * thing's own number over three bytes, low first. Nought in the slot is no
 * line at all, and the number is then still written — a thing wearing no line
 * hides what is behind it and cuts a line where it does, so it has to be told
 * from its neighbours all the same.
 *
 * The number must be one **no other thing on screen shares**, and that is the
 * layer's to keep. Sixteen million of them, because a number that runs out is
 * a number that repeats: numbered within a tile, two buildings standing wall
 * to wall across a tile's edge came out the twelfth of each, read as one
 * thing, and no line was drawn between them. There is room here to number
 * every thing a layer has ever held rather than every thing in one tile.
 */
export type OutlineNode = Node<'vec4'>

/**
 * The line round the things a page has pointed at, drawn on the screen rather
 * than along their edges.
 *
 * What it is for is **finding** them. A page that marks a building has marked
 * it so a reader can see where it is — from any angle, and with whatever
 * happens to be standing in the way. So the line is drawn whether or not the
 * thing itself can be seen: only what wears one goes into the picture, the
 * depth is left out of it, and nothing in front rubs anything out.
 *
 * That is a change from how this began. The picture used to hold everything,
 * in nought, so that whatever stood in front of a thing cut its line — the
 * outline of what was on screen. It is a fair thing to draw and it is not
 * what the line is for: a house behind another had no line at all, which is
 * the house a reader is most likely to be looking for, and a sheet of water
 * standing in front of a town cut every line in it at the waterline.
 *
 * Found on the screen all the same, and not along a shape's own edges.
 * Picking the edges out of the shape itself — the two faces along an edge,
 * one turned to the eye and one away — draws the folds inside a shape as
 * well: the inner rim of a roof parapet is such an edge, and it is not where
 * the building ends.
 *
 * Every thing that wears a line is drawn once more into a picture of its own,
 * where a pixel says which line it belongs to and how wide that line is. Then
 * one square over the screen looks round each pixel for a pixel of *another*
 * such thing, and paints the line there. So the line lands on the pixels just
 * outside each shape — and between two that touch or overlap, since the
 * picture tells them apart by number. Between those two there is no outside,
 * so they share the line half each rather than drawing it whole apiece; see
 * `width` below.
 *
 * It belongs to the viewer and not to a layer because one picture holds every
 * layer: a page may mark a building and a model together, the two share one
 * run of slots, and a line is wanted between them where they meet — none of
 * which a layer drawing only its own could do. A layer says which of its
 * things wear a line and in what colour, through {@link drawsOutline}; the
 * viewer draws it. Nothing of this shows in what a page writes.
 */
export class Outlines {
  /**
   * Which line each pixel belongs to: the slot in the first byte, and which
   * thing it is in the other three.
   *
   * Three bytes for the thing and not two, which is what makes a line appear
   * between two buildings standing wall to wall. The number a layer hands over
   * has to be one no other thing on screen shares — see {@link OutlineNode} —
   * and sixteen million of them is room for a layer to number every thing it
   * has ever held rather than every thing in one tile.
   */
  private readonly shape = new RenderTarget(1, 1, {
    // A pixel's slot and number are read whole, never mixed with a neighbour's
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  })
  private readonly size = new Vector2()
  /**
   * What each slot was asked for: its colour and standing off on the first
   * row, how wide it is drawn on the second.
   *
   * The width lives here rather than in the picture because it is one number a
   * slot and not one a pixel — and because the picture has no byte to spare
   * for it once a thing's own number takes three.
   */
  private readonly colours = new Float32Array(SLOTS * 4 * TABLE_ROWS)
  private readonly table = new DataTexture(this.colours, SLOTS, TABLE_ROWS, RGBAFormat, FloatType)
  /** How many pixels across the lines' own picture is, for reading it by texel. */
  private readonly across = uniform(new Vector2(1, 1))
  /** How far every pixel looks, in pixels of the screen: the furthest a line reaches. */
  private readonly furthest = uniform(DEFAULT_OUTLINE_WIDTH)
  /** How many steps out that reach is cut into; see {@link LEAST_STEPS}. */
  private readonly steps = uniform(LEAST_STEPS, 'int')
  /**
   * How many pixels of the lines' own picture go to one of the page: the
   * screen's ratio and {@link SHARPNESS} together.
   *
   * Everything a page writes — a width, a standing off — is in pixels of the
   * page, and the picture the lines are found in is the canvas's own, which on
   * most laptops is two screen pixels to one of the page. Spent unconverted,
   * every line came out at half the width it was asked for on those screens
   * and at the full width on a plain monitor. Read off the renderer each
   * frame, since a window dragged between two screens changes it.
   */
  private readonly ratio = uniform(1)
  /** The furthest a line reaches, in pixels of the page; see {@link reach}. */
  private furthestPage = DEFAULT_OUTLINE_WIDTH
  private readonly line: QuadMesh
  /** What each slot was taken for, so the same colour and width are one slot. */
  private readonly slots = new Map<string, { at: number; held: number }>()
  private readonly asked = new Map<number, { key: string; width: number; gap: number }>()
  private readonly freed: number[] = []
  private next = 1

  constructor() {
    this.table.minFilter = NearestFilter
    this.table.magFilter = NearestFilter
    this.table.generateMipmaps = false
    this.table.needsUpdate = true

    const paint = new NodeMaterial()
    paint.transparent = true
    paint.depthTest = false
    paint.depthWrite = false
    const read = lookup(this.shape.texture)
    const table = lookup(this.table)
    const found = Fn(() => {
      // Read by texel rather than sampled. A sample takes the level of detail
      // from how the coordinate changes across neighbouring fragments, which a
      // card will not work out inside a loop; a texel is read outright, and
      // this picture has no levels under it anyway. One texel to a pixel of
      // the screen, so every distance below is in those — which is what
      // {@link ratio} is here to bring the page's own numbers over to.
      const at = screenUV.mul(this.across).toVar()
      const here = read.load(ivec2(at)).toVar()
      /**
       * Whether a place is in the picture at all.
       *
       * Asked outright rather than left to what a read from outside comes
       * back with, because that is the backend's to say and they do not agree
       * — one hands back nought, another the texel at the edge. Both answers
       * are wrong here in their own way: nought makes the edge of the screen
       * look like the end of a thing, and the edge texel makes it look like
       * the thing goes on for ever. Outside the picture there is nothing
       * known, and that is what the two readings below are told.
       */
      const inPicture = (p: Node<'vec2'>): Node<'bool'> =>
        p.x
          .greaterThanEqual(float(0))
          .and(p.y.greaterThanEqual(float(0)))
          .and(p.x.lessThan(this.across.x))
          .and(p.y.lessThan(this.across.y)) as Node<'bool'>
      /** Of the things wearing a line, the nearest that is not this pixel's own. */
      const other = float(1e4).toVar()
      const slot = float(0).toVar()
      /** Which number that one carried, kept so its thickness can be measured below. */
      const whose = vec3(0, 0, 0).toVar()
      /** Which way that one lay, kept so the distance can be sharpened along it below. */
      const toward = vec2(0, 0).toVar()
      // One loop and not a written-out look apiece: a card holds a shader to
      // 127 statements deep, and the looks written out ran past that at three
      // dozen of them (measured; the card says so in as many words).
      Loop({ start: int(0), end: int(DIRECTIONS).mul(this.steps), type: 'int', condition: '<' }, ({ i }) => {
        const way = i
          .mod(int(DIRECTIONS))
          .toFloat()
          .mul(float((Math.PI * 2) / DIRECTIONS))
        const step = i.div(int(DIRECTIONS)).toFloat().add(float(1)).div(this.steps.toFloat())
        const off = this.furthest.mul(step).toVar()
        const along = vec2(cos(way), sin(way))
        const there = read.load(ivec2(at.add(along.mul(off)))).toVar()
        // Another thing wearing a line — not the very thing this pixel shows,
        // which its own number tells it apart from even where the two wear one
        // colour. Which slot it is comes back with it, and the width is read
        // off that slot at the end: a narrow line and a wide one are looked
        // for in the one sweep, which reaches as far as the widest anything
        // wears, and each is then cut to its own.
        //
        // The first one met is the answer, so the sweep stops there. The ways
        // are walked a whole ring at a time and the rings outward, so nothing
        // left to look at is nearer: the rest of this ring is the same step
        // out, and every later ring is further. It used to walk all of them
        // and keep whichever was nearest, which came to the same answer — a
        // later look could never beat the first — at the price of a hundred
        // and more readings for a pixel that had its answer at the twelfth.
        If(
          there.yzw
            .sub(here.yzw)
            .abs()
            .length()
            .greaterThan(float(0.001))
            .and(there.x.greaterThan(float(0))),
          () => {
            other.assign(off)
            slot.assign(there.x.mul(float(255)))
            whose.assign(there.yzw)
            toward.assign(along)
            Break()
          },
        )
      })
      /** Whether anything was met at all, which is what the rest of this is about. */
      const found = other.lessThan(float(1e4)).toVar()

      /*
       * The distance again, to a fraction of a step.
       *
       * The sweep above walks outward a step at a time, so what it knows is
       * which step the other thing first showed up in — the distance rounded
       * up to the grain, about a pixel of it. Round numbers make round edges:
       * every pixel along a stretch of line gets the same reading, the reading
       * jumps by a whole pixel, and the line's edge jumps with it. That is the
       * staircase, and no amount of softening helps while the number being
       * softened has only whole values to take.
       *
       * So the winning way is walked once more, halving between the last step
       * that was clear and the one that was not. Four halvings put the edge
       * within a sixteenth of a step, which is finer than the softening below
       * needs, and it costs four more readings against the hundred and more
       * the sweep already made — the sweep is over every way at every step,
       * this is one way.
       *
       * Only where the sweep met something. With nothing met there is no way
       * to walk and no distance to sharpen, and `other` stands at the nothing
       * it was set to.
       */
      If(found, () => {
        const grain = this.furthest.div(this.steps.toFloat()).toVar()
        const clear = other.sub(grain).max(float(0)).toVar()
        const met = other.toVar()
        Loop({ start: int(0), end: int(4), type: 'int', condition: '<' }, () => {
          const half = clear.add(met).mul(float(0.5)).toVar()
          const there = read.load(ivec2(at.add(toward.mul(half)))).toVar()
          const foreign = there.yzw
            .sub(here.yzw)
            .abs()
            .length()
            .greaterThan(float(0.001))
            .and(there.x.greaterThan(float(0)))
          met.assign(foreign.select(half, met))
          clear.assign(foreign.select(clear, half))
          // And which thing was met there, and in which slot. The sweep's
          // answer was the thing at the end of a whole step, and a nearer one
          // may lie inside it — rare, but everything downstream is about
          // whatever is actually at `other`: the colour and the width are read
          // off the slot and the thickness is measured of the number, so all
          // three have to name the one thing.
          slot.assign(foreign.select(there.x.mul(float(255)), slot))
          whose.assign(foreign.select(there.yzw, whose))
        })
        other.assign(met)
      })

      /*
       * And how much of a pixel of the page that thing fills, where it fills
       * less than one; see {@link THINNEST}.
       *
       * Walked on from where it was met, the way it was met on — so what is
       * measured is the thing's thickness across the line, which is the
       * direction the line is drawn in and the one the screen cuts it in.
       *
       * One look a pixel further on settles it for everything anybody can see:
       * a wall, a roof, a shed is still itself there, and the line is drawn as
       * it always was. Where it is not, three halvings find the far side — the
       * same way the near side was sharpened above, and for the same reason: a
       * thickness with only whole values to take would make the fading step.
       * Walked only there: where the one look says the thing is still itself,
       * it fills the pixel whole and the halvings have nothing to find.
       *
       * And none of it at all where the sweep met nothing: there is no thing
       * to be thick, and a line of nought strength is not cut any thinner.
       *
       * A place outside the picture is not the thing. That is the whole of
       * what this does at the edge of the screen — the screen holds a sliver,
       * so the screen gets a sliver of the line.
       */
      const stillIt = (far: Node<'float'>): Node<'bool'> => {
        const p = at.add(toward.mul(far)).toVar()
        const there = read.load(ivec2(p))
        return inPicture(p)
          .and(there.x.greaterThan(float(0)))
          .and(there.yzw.sub(whose).abs().length().lessThan(float(0.001))) as Node<'bool'>
      }
      /** How much of a pixel of the page the thing fills, nought to one. */
      const fills = float(1).toVar()
      If(found, () => {
        const thinnest = this.ratio.mul(float(THINNEST)).toVar()
        const across = other.add(thinnest).toVar()
        If(stillIt(across).not(), () => {
          const within = other.toVar()
          const past = across.toVar()
          Loop({ start: int(0), end: int(3), type: 'int', condition: '<' }, () => {
            const half = within.add(past).mul(float(0.5)).toVar()
            const on = stillIt(half).toVar()
            within.assign(on.select(half, within))
            past.assign(on.select(past, half))
          })
          fills.assign(within.sub(other).div(thinnest))
        })
      })

      // And whether this pixel's own edge is near, where it is of a thing that
      // wears a line: the seam its own line has to cover; see {@link INSET}.
      // Asked only of a pixel that is of such a thing, since that is the only
      // pixel whose own line could reach in.
      const mine = here.x.greaterThan(float(0))
      const rim = float(1e4).toVar()
      If(mine, () => {
        Loop({ start: int(0), end: int(SEAMS), type: 'int', condition: '<' }, ({ i }) => {
          const way = i.toFloat().mul(float((Math.PI * 2) / SEAMS))
          const p = at.add(vec2(cos(way), sin(way)).mul(float(INSET))).toVar()
          const there = read.load(ivec2(p))
          // Outside the picture is not another thing. The edge of the screen
          // is not where a building ends, so a pixel against it has no seam
          // there to cover and its own line has no business reaching in; see
          // {@link inPicture}.
          If(inPicture(p).and(there.yzw.sub(here.yzw).abs().length().greaterThan(float(0.001))), () => {
            rim.assign(float(0))
            Break()
          })
        })
      })

      // What the page asked for, slot by slot: the colour it wants and how far
      // off the thing the line is to stand on the first row, how wide it is
      // drawn on the second. Kept here rather than in the picture because they
      // are numbers a slot and not numbers a pixel, and the picture's four
      // bytes are spoken for by the slot and by which thing this is.
      const mineRow = vec4(0, 0, 0, 0).toVar()
      If(mine, () => {
        mineRow.assign(table.load(ivec2(here.x.mul(float(255)).toInt(), int(0))))
      })
      const nearRow = vec4(0, 0, 0, 0).toVar()
      const asked = float(0).toVar()
      If(found, () => {
        nearRow.assign(table.load(ivec2(slot.toInt(), int(0))))
        asked.assign(table.load(ivec2(slot.toInt(), int(1))).x.mul(this.ratio))
      })
      /*
       * And whose side of the boundary carries it.
       *
       * Where the other side wears no line — the land, the sky, a building
       * the page did not mark — there is an outside to draw on, and the whole
       * of the line goes out there. The thing itself gives up only {@link
       * INSET}, to cover the seam.
       *
       * Where both wear one there is no outside: each is the other's. Drawn
       * whole on both sides the line came out twice as thick in just those
       * places, which is where two marked buildings overlap on screen and
       * exactly where a reader is trying to tell them apart. Measured at a
       * line asked for at two pixels of the page, on the edges running up and
       * down the screen: 3.5 pixels where another marked building stood
       * behind, against 2.5 where the land did.
       *
       * So the two share it, half each, and what lies across the boundary is
       * the same thickness either way — the line and the inset together. A
       * standing off is halved with it, for the same reason and to the same
       * end.
       */
      const width = mine.select(asked.add(float(INSET)).mul(float(0.5)), asked).toVar()
      // Its own line reaching in comes first: where a pixel is of a thing that
      // wears a line and its edge is near, the line is that thing's own, not
      // whatever else lies about. Only where the line is drawn against the
      // thing, though — one asked to stand off has no business inside the very
      // shape it is standing off from, and the seam it was reaching in to
      // cover is not its to cover once there is clear ground between them.
      const own = mine.and(rim.lessThan(float(1))).and(mineRow.w.lessThanEqual(float(0)))
      // The standing off is the page's number too, so it is brought over to
      // the screen's pixels here, where it is measured against `other`, and
      // shared the same way the width is
      const gap = nearRow.w
        .mul(this.ratio)
        .mul(mine.select(float(0.5), float(1)))
        .toVar()
      /*
       * How much of this pixel the line covers, rather than whether it is on.
       *
       * The line runs from `gap` out to `gap + width`, and a pixel whose
       * reading lands within half a pixel of either of those is partly over
       * and partly not. Said as a yes or a no — which is what this was — the
       * edge lands on the pixel grid and every step of the shape underneath
       * becomes a step of the line. Said as how much, the same step is a pixel
       * of shading and the eye reads a line.
       *
       * Half a pixel of the screen either side, not of the page: what is being
       * softened is the grid the picture was drawn on.
       *
       * The outer edge always wants it: out there the line simply stops, in
       * the open, and nothing else draws that edge. The inner one only wants
       * it where the line stands off. Drawn against the thing there is no
       * inner edge to soften — that side of the line *is* the thing's own
       * edge, which the canvas has already drawn soft — and softening it
       * anyway shaded the one pixel whose reading lands on the boundary,
       * leaving a pale gap running down the middle of the line. Measured on a
       * wall edge: `other` of 0.13 and a cover of 0.59 with a pixel at 1 on
       * either side, which reads as the line being hollow.
       */
      const soft = float(SOFT_EDGE * SHARPNESS)
      const begins = gap
        .greaterThan(float(0))
        .select(smoothstep(gap.sub(soft), gap.add(soft), other), float(1))
      const cover = begins
        .mul(smoothstep(gap.add(width).sub(soft), gap.add(width).add(soft), other).oneMinus())
        .toVar()
      // Its own line reaching in is not softened: that edge is under the very
      // shape it belongs to, where there is nothing to soften against
      // Cut to how much of the thing the screen actually holds; see {@link
      // THINNEST}. Its own line reaching in is not cut: that is this pixel's
      // own thing, which is here whatever the screen has done to the rest of it.
      const alpha = own.select(float(1), slot.greaterThan(float(0.5)).select(cover.mul(fills), float(0)))
      const colour = own.select(mineRow.xyz, nearRow.xyz)
      return vec4(colour, alpha)
    })() as Node<'vec4'>
    paint.fragmentNode = found
    this.line = new QuadMesh(paint)
  }

  /** Whether anything wears a line, which is whether any of this is drawn at all. */
  get drawn(): boolean {
    return this.slots.size > 0
  }

  /**
   * A slot for one colour, width and standing off, taken again by whoever asks
   * for the same three: a rule that paints a thousand buildings is one slot.
   */
  take(colour: ColorRepresentation, width: number, gap = DEFAULT_OUTLINE_GAP): number {
    const wide = Math.min(WIDEST_OUTLINE, Math.max(1, width))
    const off = Math.min(WIDEST_OUTLINE, Math.max(0, gap))
    const shade = new Color(colour)
    const key = `${shade.getHexString()}|${wide}|${off}`
    const had = this.slots.get(key)
    if (had) {
      had.held++
      return had.at
    }
    const at = this.freed.pop() ?? (this.next < SLOTS ? this.next++ : 0)
    if (at === 0) return 0
    this.slots.set(key, { at, held: 1 })
    this.asked.set(at, { key, width: wide, gap: off })
    // Written past the frame's tone curve. A line round a building is the one
    // thing on screen a page points at by colour, so the colour it asked for
    // has to be the colour drawn — and the curve over the finished frame makes
    // no exception for anyone. Done here, once, rather than at a pixel: the
    // table holds floats, which is room enough for what the inverse comes to
    // (a white line is written well over one). See `tone.ts`.
    const ink = colourBeforeTheCurve(shade)
    this.colours.set([ink.r, ink.g, ink.b, off], at * 4)
    this.colours.set([wide, 0, 0, 0], (SLOTS + at) * 4)
    this.table.needsUpdate = true
    this.reach()
    return at
  }

  /** Hands one back. The slot is kept while anything still wears it. */
  give(at: number): void {
    const held = this.asked.get(at)
    if (!held) return
    const kept = this.slots.get(held.key)
    if (!kept || --kept.held > 0) return
    this.slots.delete(held.key)
    this.asked.delete(at)
    this.freed.push(at)
    this.reach()
  }

  /**
   * @internal The viewer's, every frame.
   *
   * Draws the picture of what wears a line, and then the lines over the
   * canvas. Called with the picture already on it.
   */
  draw(renderer: WebGPURenderer, scene: Scene, camera: OrthographicCamera): void {
    if (!this.drawn) return
    renderer.getDrawingBufferSize(this.size)
    const width = Math.max(1, Math.round(this.size.x))
    const height = Math.max(1, Math.round(this.size.y))
    // The picture is drawn finer than the screen; see SHARPNESS. Every
    // distance below is in its pixels, so the reach is brought over too
    const across = width * SHARPNESS
    const down = height * SHARPNESS
    if (this.shape.width !== across || this.shape.height !== down) this.shape.setSize(across, down)
    this.across.value.set(across, down)
    this.ratio.value = renderer.getPixelRatio() * SHARPNESS
    this.furthest.value = this.furthestPage * this.ratio.value
    // Counted on the screen's own pixels rather than the picture's: the steps
    // are only there to find which one the other thing is in, and the halving
    // below settles where inside it. Counted on the picture's, the sweep would
    // cost twice as much for a grain the halving makes no use of.
    this.steps.value = Math.min(
      WIDEST_OUTLINE,
      Math.max(LEAST_STEPS, Math.round(this.furthest.value / SHARPNESS)),
    )

    const { autoClear } = renderer
    const layers = camera.layers.mask
    // What is drawn over the picture is no part of this: a mark standing in
    // front of a building does not cut the building's line, and carries none.
    // Put back even where the drawing throws, since the camera is the
    // viewer's and would otherwise go on drawing the scene without its marks.
    camera.layers.disable(PICTURE_ONLY)
    try {
      drawShapes(renderer, scene, camera, this.shape)
    } finally {
      camera.layers.mask = layers
    }

    renderer.autoClear = false
    try {
      this.line.render(renderer)
    } finally {
      // Put back for the same reason the camera's layers are: the renderer is
      // the viewer's, and left not clearing it every later frame would paint
      // over whatever the last one left on the canvas.
      renderer.autoClear = autoClear
    }
  }

  /** @internal The viewer's, as it goes. */
  dispose(): void {
    this.shape.dispose()
    this.table.dispose()
    this.line.dispose()
  }

  /**
   * How far every pixel has to look: out to the end of the furthest-reaching
   * line anything wears, in pixels of the page.
   *
   * Only the page's number is settled here. What the card is told — that
   * reach in pixels of the screen, and the steps it is cut into — is written
   * in {@link draw}, since the one depends on the other and the pixel ratio
   * is the renderer's to say.
   */
  private reach(): void {
    let furthest = 0
    for (const held of this.asked.values()) furthest = Math.max(furthest, held.width + held.gap)
    this.furthestPage = furthest || DEFAULT_OUTLINE_WIDTH
  }
}

/**
 * Says what a material draws, where that thing wears a line.
 *
 * Put on the material and read nowhere but by the pass that draws the lines'
 * own picture, the way three's own `maskNode` is put on and read only where
 * fragments are thrown away. A property of our own, so it goes on through a
 * name three does not know.
 */
export function drawsOutline(material: object, line: OutlineNode): void {
  ;(material as { outlineNode?: OutlineNode | null }).outlineNode = line
}

/** Whatever a material says about the line round what it draws, or nothing. */
export function outlinedBy(material: { outlineNode?: OutlineNode | null }): OutlineNode | null {
  return material.outlineNode ?? null
}

/** Nothing wears a line here, and yet something stands here; see {@link Outlines}. */
export const NO_OUTLINE = vec4(0, 0, 0, 0)
