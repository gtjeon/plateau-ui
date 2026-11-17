import type { MarkerSymbol } from '../AnnotationLayer.js'
import type { ThemeColor } from '../theme.js'

/**
 * What stands at an annotation's place as it is drawn: a marker's symbol, or
 * nothing where the words are the whole of it.
 *
 * `'none'` is the drawing's word and not the library's. A page asking for
 * words alone makes a `Label`, which has no symbol to name; this is what that
 * comes out as once it reaches the canvas.
 */
export type Shape = MarkerSymbol | 'none'

/**
 * A mark drawn out: the picture, how big it is, and where in it the place it
 * stands on falls.
 *
 * Symbol and label are drawn into the one picture rather than kept apart. A
 * mark is then one rectangle in the scene however it is made up, and the
 * letters keep step with the symbol whatever the view does — which is the
 * whole reason the label is not a thing of its own.
 */
export interface Picture {
  readonly canvas: OffscreenCanvas
  /** How big it is drawn, in pixels of the page. */
  readonly width: number
  readonly height: number
  /** Where the mark's own place falls inside it, in pixels of the page from its top left. */
  readonly gripX: number
  readonly gripY: number
}

/**
 * Drawn at twice the page's pixels and shown at half of them.
 *
 * Letters are the reason. A picture drawn at the size it is shown goes soft on
 * a screen with two pixels to the page's one, and a mark is read as words
 * before it is read as a shape. Twice covers every screen worth covering, and
 * costs a quarter of a page's atlas per mark either way.
 */
const OVER = 2

/** How the symbols stand at a size of 1, so a size given scales all of them alike. */
const SHAPES = {
  // A head 10 across standing 18 over the tip, with the two lines from the tip
  // that just touch it, and an eye of the paper's colour.
  pin: { width: 22, height: 30, gripX: 11, gripY: 29 },
  // Its point on the left, its back corners rounded, lying out to the right.
  tag: { width: 28, height: 16, gripX: 1, gripY: 8 },
  // A dot in a ring of the paper's colour, which parts it from whatever it is over.
  dot: { width: 12, height: 12, gripX: 6, gripY: 6 },
  none: { width: 0, height: 0, gripX: 0, gripY: 0 },
} as const satisfies Record<Shape, { width: number; height: number; gripX: number; gripY: number }>

/**
 * How wide the edge round a symbol is, at a size of 1. Its colour is the
 * paper's and so is not here; see {@link AnnotationDrawing.edge}.
 */
const EDGE = 1.25

/** How far the letters sit from the symbol, in pixels of the page. */
const GAP = 6

/**
 * How far the band round the letters stands out from them, in pixels of the
 * page, where a page says nothing.
 *
 * Three, which is what a mark over a pale city wants: enough to part a stroke
 * from a wall behind it, and not so much that two words a line apart weld into
 * one bar. Its colour is the paper's and so is not here; see
 * `DEFAULT_HALO_COLOR` in `inks.ts`.
 */
export const DEFAULT_HALO_WIDTH = 3

/**
 * The shadow under the letters, for a page that parts them from the map by
 * depth rather than by a band: what each of the four `dropShadow` values is
 * where a page says nothing.
 *
 * Soft, black and barely dropped. A halo says *these letters are not part of
 * what is under them* by putting the page's own colour between the two; a
 * shadow says it by lifting them off it, and what does that is the blur — the
 * offset only says which way the light comes from, and one much past a pixel
 * reads as a second copy of the word rather than as its shadow.
 *
 * Not black at full: what a shadow falls on is a city drawn pale, and an
 * opaque one under letters already dark closes up into a smudge the shape of
 * the word.
 *
 * One colour rather than a pair, where every other colour a mark wears is
 * two. A halo and a plate are the paper's colour and have to turn over with
 * it; a shadow is told nothing about the map and darkens a pale city and a
 * dark one alike, which is the whole of why a page would choose one.
 *
 * Kept whole as one value rather than four constants, since the four are one
 * shadow: a softer blur wants a smaller offset, and a page that reads one of
 * these to start from wants the others with it.
 */
export const DEFAULT_DROP_SHADOW: {
  readonly color: ThemeColor
  readonly blur: number
  readonly offsetX: number
  readonly offsetY: number
} = Object.freeze({ color: 'rgba(0, 0, 0, 0.45)', blur: 5, offsetX: 0, offsetY: 1 })

/** How tall a line of letters stands, over the size they are set at. */
const LINE = 1.25

/**
 * How far a label's plate stands out past its letters, in pixels of the page.
 *
 * Wider than it is tall, as a plate carrying words is: the letters want air at
 * their ends more than over their heads, and a plate padded evenly reads as a
 * box round the words rather than as something they are written on.
 */
const PLATE_ACROSS = 6
const PLATE_DOWN = 3

/**
 * How far a plate's corners are rounded, in pixels of the page.
 *
 * A fixed radius and not half the height, so a plate is a card with its
 * corners taken off rather than a pill. Rounded fully it reads as a button
 * waiting to be pressed; this reads as something written down.
 */
const PLATE_ROUND = 4

/**
 * What the letters are drawn in.
 *
 * The page's own sans stack rather than a font of ours: a mark is read at a
 * glance and the platform's own face is the one the reader's eye is trained
 * on. The Japanese faces are named because a stack that ends at `sans-serif`
 * leaves the choice to whatever the browser has, which varies more in Japanese
 * than the width of a mark can absorb.
 */
const MARKER_FONT_FAMILY = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif'

/**
 * What a mark is set in where a page says nothing, as CSS.
 *
 * Bold rather than semibold. A mark is read at a glance and at a few pixels a
 * stroke, over a city that is mostly pale — the weight is what carries it, and
 * semibold went thin against the white it is written on.
 */
export const DEFAULT_ANNOTATION_FONT = `700 14px ${MARKER_FONT_FAMILY}`

/** Where a font declaration the canvas has normalized keeps its size. */
const PIXELS = /(\d*\.?\d+)px/

/**
 * How big a declaration sets its letters, in pixels of the page.
 *
 * Read back off the canvas rather than off what a page wrote: a declaration
 * may be written in any order and in any unit, and what comes back of it has
 * the size in pixels in one place. It is the line spacing, the halo's room and
 * the plate's that need the number; nothing else here cares what a page said.
 */
function sizeOf(ruler: OffscreenCanvasRenderingContext2D, font: string): number {
  ruler.font = font
  const said = PIXELS.exec(ruler.font)
  return said ? Number(said[1]) : 14
}

/**
 * How big a symbol is drawn where a page names no size, in pixels of the page:
 * its own height at a size of 1, which is how a size given is measured.
 *
 * Asked of the symbol rather than kept on the marker, so a marker that never
 * said its size takes the new symbol's own when it is given another.
 */
export function symbolSize(symbol: MarkerSymbol): number {
  return SHAPES[symbol].height
}

/** What a symbol takes up, in pixels of the page, at the size asked for. */
function spanOf(
  symbol: Shape,
  size: number | undefined,
): { width: number; height: number; gripX: number; gripY: number } {
  const shape = SHAPES[symbol]
  if (symbol === 'none') return shape
  const scale = (size ?? shape.height) / shape.height
  return {
    width: shape.width * scale,
    height: shape.height * scale,
    gripX: shape.gripX * scale,
    gripY: shape.gripY * scale,
  }
}

/** Draws the symbol with its top left at 0, 0, at the size asked for. */
function drawSymbol(
  paper: OffscreenCanvasRenderingContext2D,
  symbol: Shape,
  size: number | undefined,
  color: string,
  edge: string,
): void {
  if (symbol === 'none') return
  const shape = SHAPES[symbol]
  const scale = (size ?? shape.height) / shape.height
  paper.save()
  paper.scale(scale, scale)
  paper.fillStyle = color
  paper.strokeStyle = edge
  paper.lineWidth = EDGE
  paper.lineJoin = 'round'

  if (symbol === 'pin') {
    const head = new Path2D('M11 29 L19.32 16.56 A10 10 0 1 0 2.68 16.56 Z')
    paper.fill(head)
    paper.stroke(head)
    const eye = new Path2D()
    eye.arc(11, 11, 3.6, 0, Math.PI * 2)
    paper.fillStyle = edge
    paper.fill(eye)
  } else if (symbol === 'tag') {
    const body = new Path2D('M1 8 L6.25 1 H24.9 A2.1 2.1 0 0 1 27 3.1 V12.9 A2.1 2.1 0 0 1 24.9 15 H6.25 Z')
    paper.fill(body)
    paper.stroke(body)
  } else {
    const ring = new Path2D()
    ring.arc(6, 6, 5.5, 0, Math.PI * 2)
    paper.fillStyle = edge
    paper.fill(ring)
    const middle = new Path2D()
    middle.arc(6, 6, 3.6, 0, Math.PI * 2)
    paper.fillStyle = color
    paper.fill(middle)
  }
  paper.restore()
}

/** One line of what a mark says, as it is to be set. */
export interface DrawnLine {
  readonly text: string
  /** The whole declaration, as CSS. */
  readonly font: string
}

/** The band round the letters, as it is drawn: how far it stands out, and what colour. */
export interface DrawnHalo {
  readonly width: number
  readonly color: string
}

/**
 * The shadow under the letters, or under their plate, as it is drawn: how
 * soft, how far dropped, and what colour.
 */
export interface DrawnShadow {
  readonly blur: number
  readonly offsetX: number
  readonly offsetY: number
  readonly color: string
}

/**
 * Everything one mark is drawn from, every colour already one CSS string.
 *
 * Settled before it reaches here — which half of a pair, which default — so
 * that what draws knows nothing of the hour; the layer answers that once for
 * every mark, and redraws them when the answer turns over. A part that is off
 * is `null` rather than a switch beside its values, so that nothing here can
 * draw a band a page turned off.
 */
export interface AnnotationDrawing {
  readonly symbol: Shape
  readonly size: number | undefined
  /** The symbol's colour; and the letters', where there is no symbol or they lie on a plate. */
  readonly color: string
  /**
   * What the parts of a symbol that are not its colour are drawn in: the edge
   * round it, a pin's eye, a dot's ring. The paper's, as a halo's is, since
   * they part the symbol from the map the way a halo parts the letters — see
   * `DEFAULT_HALO_COLOR` in `inks.ts`. Nothing where there is no symbol.
   *
   * These were white, fixed here, which is the light set's paper and not the
   * dark one's; settled with the rest so that they turn over with it.
   */
  readonly edge: string
  /** What the letters are written in where the colour has gone on a symbol. */
  readonly ink: string
  /** What it says, a line at a time, each with what it is set in. */
  readonly lines: readonly DrawnLine[]
  /** What the letters are laid on, or nothing. */
  readonly plate: string | null
  /** The band round the letters, or nothing. */
  readonly halo: DrawnHalo | null
  /** The shadow under them, or under their plate where they have one, or nothing. */
  readonly shadow: DrawnShadow | null
  /**
   * Whether the words lie beside the place, level with it, rather than
   * standing over it.
   */
  readonly beside: boolean
  /**
   * Whether words lying beside the place run off to its left rather than its
   * right, the symbol turned round with them so that its point is still on the
   * place. Read only where they lie beside it.
   */
  readonly toLeft?: boolean
}

/**
 * Draws one mark out: its symbol, and its label.
 *
 * Words lie beside the place or stand over it. A tag's lie beside it, because
 * a tag is a plate with its point on the place and its letters are what the
 * plate carries: split them and neither half is a tag any more. Every other
 * mark takes its letters above it, centred over the place it holds, so that
 * the two read as one thing standing on one point.
 *
 * Beside is also what a tick against a rule wants, and that is why it is told
 * rather than read off the symbol: letters standing over their place sit as
 * far above it as they are tall, and a number that is to be level with the
 * line it names cannot be.
 *
 * Above rather than below, because below is where the map is. A mark stands on
 * a city seen at a slant, and what lies below its place on the screen is the
 * ground nearer the eye and whatever is built on it — the letters would be
 * read against the busiest part of the picture, and would sit over the very
 * streets the mark is there to point into. Above them is the sky, or the far
 * ground, which is the quietest place on the screen.
 *
 * Beside was how all of them were drawn at first, and a pin showed why it does
 * not do: a pin holds its place by its tip, so letters level with that tip sat
 * level with the ground while the pin stood over it, and the two read as a
 * mark and a stray word rather than as one mark.
 *
 * A newline breaks the label; the lines stack in the order they are written,
 * each starting where the one above it did. The block of them is still centred
 * over the place — it is the lines inside it that are not centred on one
 * another. Lines of different lengths centred leave both edges ragged, which
 * reads as a verse; a mark saying four things about one building is a list.
 */
export function drawAnnotation(options: AnnotationDrawing): Picture {
  const span = spanOf(options.symbol, options.size)
  const plate = options.plate
  const halo = options.halo && options.halo.width > 0 ? options.halo : null
  const shadow = options.shadow

  // Measured before the picture is sized, since how wide the letters run is
  // what decides how wide it has to be — and each line is measured in its own
  // declaration, since the widest is not always the one set largest
  const ruler = new OffscreenCanvas(1, 1).getContext('2d')
  if (!ruler) throw new Error('AnnotationLayer: this browser draws no 2d canvas')

  const lines = options.lines
  /*
   * How far a shadow reaches past whatever casts it, across and down: its blur
   * on all four sides and its offset one way besides, so the two are not the
   * same number in both directions.
   */
  const castX = shadow ? shadow.blur + Math.abs(shadow.offsetX) : 0
  const castY = shadow ? shadow.blur + Math.abs(shadow.offsetY) : 0
  const haloWidth = halo ? halo.width : 0
  /*
   * What each line takes up above and below its letters, over its own size.
   * Enough to part two lines and no more: a label is a few words rather than
   * a paragraph.
   *
   * A halo stands the same width out from its letters on all four sides, and
   * two lines set closer than the halo is wide weld into one band. Over white
   * that band is invisible; over anything else it is a bar drawn between the
   * lines — and on a plate of another colour it is the same bar. So the
   * letters are given the halo's room as well as their own, which is a thing
   * of the halo's width rather than of the letters' size: a line set large and
   * one set small both need the same clearance.
   *
   * Laid on nothing, each line also drops a shadow, and that wants the same
   * room or it reaches into the line beside it. Whichever of the two reaches
   * further, rather than both: that is the room the lines have always had, so
   * a shadow turned on beside a halo neither sets the lines further apart nor
   * lifts the words further off their place. What the shadow reaches past the
   * outermost lines is held round the outside of the picture instead — see
   * `held` below. On a plate the shadow is the plate's and there is only the
   * halo between the lines.
   */
  const lineRoom = plate ? haloWidth : Math.max(haloWidth, castY)
  const heights = lines.map((each) => sizeOf(ruler, each.font) * LINE + lineRoom * 2)
  const wordsTall = heights.reduce((all, each) => all + each, 0)
  const above = !options.beside
  // Lying beside the place and running off to its left: the same picture
  // turned round about the grip, all but the letters, which still read
  const leftward = !above && options.toLeft === true

  const textWidth =
    lines.length === 0
      ? 0
      : Math.max(
          ...lines.map((each) => {
            ruler.font = each.font
            return ruler.measureText(each.text).width
          }),
        )

  // How far the plate stands out past the letters across. Its room down is
  // already in each line's height, halo and all; across, the halo's room has
  // to be added here or the band would reach past the plate's ends.
  const plateAcross = PLATE_ACROSS + haloWidth
  // What the words hold past themselves, across and down, which is what sets
  // them against their place. Laid on nothing it is how far the letters bleed;
  // on a plate it is the plate. Either way the shadow counts only where it
  // reaches further than the rest, as it always has: added on top, it would
  // lift a plate three pixels further off its symbol, or set one five further
  // out from its tag, for a page that had only asked for a shadow under it
  // (the library's own shadow, worked out rather than seen).
  const across = plate ? Math.max(plateAcross, castX) : Math.max(haloWidth, castX)
  const down = plate ? Math.max(PLATE_DOWN, castY) : lineRoom
  // Rounded up to a pair, so that half of it is a whole number: the letters
  // are centred over the grip, and a picture whose half-width falls between
  // two pixels puts its every texel between two as well
  const words = lines.length === 0 ? 0 : Math.ceil(textWidth / 2) * 2 + across * 2
  const wordsHigh = lines.length === 0 ? 0 : wordsTall + down * 2
  /*
   * The step between the place and the words.
   *
   * Words beside a place are parted from it whether or not anything is drawn
   * there: a tag is parted from its plate, and a number against a rule is
   * parted from the line it names — set touching it, a tick reads as part of
   * the drawing rather than as a reading of it. Words standing over a place
   * with nothing under them have nothing to be parted from.
   */
  const gap = lines.length === 0 ? 0 : !above || span.height > 0 ? GAP : 0

  // What the picture holds each way of the place the mark stands on. The
  // symbol hangs from its grip wherever it is, and the letters are set against
  // that same grip — beside it for a tag, over it for the rest.
  //
  // Each of the four is a whole number of pixels, and that is the whole of why
  // this is written out rather than left to the sum. The mark is laid on the
  // screen by putting its place on a whole pixel and stepping back by the grip
  // (see `mesh.ts`), so a grip of 25.7 puts every texel of the picture seven
  // tenths of a pixel off the pixel it was drawn for. The sheet is read with a
  // linear filter and no mipmaps, so what comes back is two texels mixed —
  // a picture blurred by most of a pixel. On a flat white face nothing shows;
  // on a rounded corner the mix lands across the very pixels the corner was
  // drawn smooth with, and the curve comes back as a stair.
  // What runs off the grip on the far side of the symbol from its point, and
  // then the words: to the right, or to the left where they run that way
  const beyondGrip = span.width - span.gripX + gap + words
  const leftOfGrip = Math.ceil(above ? Math.max(span.gripX, words / 2) : leftward ? beyondGrip : span.gripX)
  const rightOfGrip = Math.ceil(
    above ? Math.max(span.width - span.gripX, words / 2) : leftward ? span.gripX : beyondGrip,
  )
  const overGrip = Math.ceil(above ? span.gripY + gap + wordsHigh : Math.max(span.gripY, wordsHigh / 2))
  const underGrip = Math.ceil(
    above ? span.height - span.gripY : Math.max(span.height - span.gripY, wordsHigh / 2),
  )

  // Where the words fall in that box. Over the place, the block is what is
  // centred: the widest line decides where its left edge falls and every line
  // starts there.
  const at = above
    ? leftOfGrip - textWidth / 2
    : leftward
      ? leftOfGrip - (span.width - span.gripX) - gap - words + across
      : leftOfGrip + (span.width - span.gripX) + gap + across
  // Standing over the place, the block starts at the box's top edge, so the
  // letters start as far in as the plate or halo stands out. Lying beside it,
  // the block is centred on the grip — and since that room stands above the
  // letters and below them alike, centring the letters centres the block.
  const top = above ? down : overGrip - wordsTall / 2
  // The plate, where there is one. The same pair, so the plate's own edges
  // land on pixels too
  const wide = Math.ceil(textWidth / 2) * 2 + plateAcross * 2
  const high = Math.ceil(wordsTall) + PLATE_DOWN * 2
  const plateLeft = Math.round(above ? leftOfGrip - wide / 2 : at - plateAcross)
  const plateTop = Math.round(top - PLATE_DOWN)

  /*
   * And round the outside of that box, what the shadow reaches past it.
   *
   * The box is the one the words have always been set in, and the shadow used
   * to be cut off at its edge: a plate filled it from end to end, so its shadow
   * stopped in a hard line down both sides, and a halo's shadow is cast off the
   * halo's outer edge, so it reaches the two added where the box holds only the
   * greater. Making the box itself big enough would hold it too, and would
   * move the plate and set the lines apart. So the picture grows round the box
   * by what falls outside it, and the grip moves in with it: every part stands
   * against the place where it stood, and the picture is larger by the shadow
   * and nothing else.
   *
   * Worked out from what casts it — the plate, or the letters and their halo —
   * shifted by the offset and spread by the blur, each side on its own, since
   * an offset that throws the shadow down throws nothing up. Whole pixels, so
   * that the grip stays on one.
   */
  const held = { left: 0, right: 0, top: 0, bottom: 0 }
  if (shadow && lines.length > 0) {
    const caster = plate
      ? { left: plateLeft, top: plateTop, right: plateLeft + wide, bottom: plateTop + high }
      : {
          left: at - haloWidth,
          top: top + lineRoom - haloWidth,
          right: at + textWidth + haloWidth,
          bottom: top + wordsTall - lineRoom + haloWidth,
        }
    const boxWidth = leftOfGrip + rightOfGrip
    const boxHeight = overGrip + underGrip
    held.left = Math.max(0, Math.ceil(shadow.blur - shadow.offsetX - caster.left))
    held.top = Math.max(0, Math.ceil(shadow.blur - shadow.offsetY - caster.top))
    held.right = Math.max(0, Math.ceil(caster.right + shadow.offsetX + shadow.blur - boxWidth))
    held.bottom = Math.max(0, Math.ceil(caster.bottom + shadow.offsetY + shadow.blur - boxHeight))
  }

  const width = held.left + leftOfGrip + rightOfGrip + held.right
  const height = held.top + overGrip + underGrip + held.bottom
  const gripX = held.left + leftOfGrip
  const gripY = held.top + overGrip

  const canvas = new OffscreenCanvas(Math.max(1, width * OVER), Math.max(1, height * OVER))
  const paper = canvas.getContext('2d')
  if (!paper) throw new Error('AnnotationLayer: this browser draws no 2d canvas')
  paper.scale(OVER, OVER)
  // Everything from here is set in the box's own frame, a step in from the
  // picture's corner by what was held round it
  paper.translate(held.left, held.top)

  paper.save()
  if (leftward) {
    // Turned round about the grip, so the point that was on the place's left
    // is on its right and still on the place
    paper.translate(leftOfGrip, overGrip)
    paper.scale(-1, 1)
    paper.translate(-span.gripX, -span.gripY)
  } else {
    paper.translate(leftOfGrip - span.gripX, overGrip - span.gripY)
  }
  drawSymbol(paper, options.symbol, options.size, options.color, options.edge)
  paper.restore()

  if (lines.length > 0) {
    paper.textAlign = 'left'
    paper.textBaseline = 'middle'

    if (plate) {
      paper.fillStyle = plate
      // The plate is what lies on the map, so the plate is what casts the
      // shadow; the letters on it are not off it and have nothing to drop.
      cast(paper, shadow)
      paper.beginPath()
      paper.roundRect(plateLeft, plateTop, wide, high, PLATE_ROUND)
      paper.fill()
      cast(paper, null)
    }
    // And the band round the letters, on a plate as much as off one. It was
    // left off wherever there was a plate, whatever the page had said, since a
    // plate already parts the letters from the map; but a page that names a
    // halo over a plate has said it wants one — a band of the plate's own
    // colour cutting the letters out of a symbol drawn under them, or one of
    // another colour as a second edge — and a field that is taken and not read
    // is a wrong answer. Off by default where there is a plate, which is the
    // same picture as before for every page that said nothing.
    if (halo) {
      paper.lineJoin = 'round'
      paper.strokeStyle = halo.color
      paper.lineWidth = halo.width * 2
    }

    // A mark that is nothing but its letters is coloured by them: there is no
    // symbol for its colour to go on, and a page that gives such a mark a
    // colour means the words. Where there is a symbol the colour is the
    // symbol's, and the letters stay ink — two coloured things saying one
    // thing read as a mark that has been shouted rather than marked. On a
    // plate the letters take the colour too: the plate is then the thing the
    // colour is set against, and the two are what turn round together.
    const ink = plate || options.symbol === 'none' ? options.color : options.ink
    let y = top
    for (const [i, each] of lines.entries()) {
      const tall = heights[i] ?? 0
      paper.font = each.font
      paper.fillStyle = ink
      // Cast once, off the outermost thing the line has — the halo where there
      // is one, the letters where there is not. Leaving the shadow on for both
      // passes would lay one shadow over another and darken where they meet,
      // which is the width of the halo in from the edge of every glyph.
      if (!plate && shadow) {
        cast(paper, shadow)
        if (halo) paper.strokeText(each.text, at, y + tall / 2)
        else paper.fillText(each.text, at, y + tall / 2)
        cast(paper, null)
      }
      if (halo) paper.strokeText(each.text, at, y + tall / 2)
      paper.fillText(each.text, at, y + tall / 2)
      y += tall
    }
  }

  return { canvas, width, height, gripX, gripY }
}

/**
 * Turns the shadow on for what is drawn next, or off again with `null`.
 *
 * The blur and the offset are given in pixels of the page and set in pixels of
 * the canvas, which is {@link OVER} times as many: the canvas spec leaves
 * these three out of the transform, so unlike everything else drawn here they
 * do not come along with `scale`. A shadow set without it is half as soft on
 * the picture as the page asked for.
 */
function cast(paper: OffscreenCanvasRenderingContext2D, shadow: DrawnShadow | null): void {
  paper.shadowColor = shadow ? shadow.color : 'transparent'
  paper.shadowBlur = shadow ? shadow.blur * OVER : 0
  paper.shadowOffsetX = shadow ? shadow.offsetX * OVER : 0
  paper.shadowOffsetY = shadow ? shadow.offsetY * OVER : 0
}
