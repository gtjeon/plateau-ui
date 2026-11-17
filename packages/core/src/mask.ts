import {
  Discard,
  Fn,
  If,
  float,
  int,
  mix,
  neutralToneMapping,
  positionWorld,
  smoothstep,
  vec2,
  vec4,
} from 'three/tsl'
import { uniform } from './repaint.js'

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  type ColorRepresentation,
  type Node,
  type NodeMaterial,
  type Texture,
} from 'three/webgpu'
import { latToY, lonToX, metersPerUnit, yToLat, type WorldBounds } from './geo/mercator.js'
import { beforeTheCurve } from './tone.js'
import { lookup } from './lookup.js'

/**
 * The shape a viewer is cut to: the shapes, and how the cut behaves.
 *
 * What falls outside is neither drawn nor fetched: the ground picks no tile
 * that misses it, the buildings ask about no city that misses it, and a
 * fragment that lands outside is thrown away. So a small mask is a small
 * download, and the edge is the shape rather than the tiles the shape fell on.
 *
 * **Where is said shape by shape, how once for the whole.** A shape carries
 * where it is and how big ({@link MaskShape}); the hem, the margin and how
 * much is fetched are the mask's, and every shape in it wears the same. They
 * were said on each piece once, and only the hem ever answered per piece: the
 * fetching was decided for the mask as a whole (one piece left to the screen
 * held every piece to it), and the pieces had to all ride the camera or all
 * stand already. Cesium's `ClippingPolygonCollection` draws the same line —
 * `inverse` and `enabled` on the collection, positions on each polygon.
 *
 * _(2026-10-29: until today a mask was a shape or a list of shapes, each
 * carrying its own `fade`, `margin` and `fetch`.)_
 */
export interface Mask {
  /**
   * The shapes, which the scene is cut to all of together: what falls in any
   * one is kept. That is a page showing four stations rather than the twenty
   * kilometres between them, and it is the only reading a list can have —
   * there is no sense in which a place could be asked to be inside two
   * separate circles.
   *
   * One is a list of one. None at all is a mask that holds nothing, not the
   * absence of one; `{ shape: 'view' }` riding the camera is a viewer nobody
   * has cut.
   *
   * **The list stands or rides as one.** Shapes that ride the camera given
   * beside shapes that stand are all stood, where the view is when the mask is
   * set, and the console says so once. Mixed, the shape would be a different
   * shape at every step of a drag and its picture would be drawn again each
   * time — 15ms a frame for two circles, 55ms for a ring of 240 corners,
   * measured.
   */
  readonly shapes: readonly MaskShape[]
  /**
   * How far in from the edge what is drawn fades out, in metres. 0, a hard
   * edge, by default.
   *
   * Metres at each shape's own latitude, the way a building's height is, so
   * the same number is the same width on the ground over Tokyo and over
   * Okinawa.
   */
  readonly fade?: number
  /**
   * How far past the edge to fetch anyway, in metres. 0 by default.
   *
   * What is drawn does not change — the shape still ends where it ended. This
   * is for a shape that moves: the ground it is about to reach is asked for
   * before it gets there, so the edge does not drag a bare strip behind it.
   * A mask that stands still but waits for the screen ({@link Mask.fetch})
   * counts as one that moves here, each shape's box being widened by the
   * margin before it is cut down to the screen.
   *
   * **On a mask held whole it is not nothing, though it is meant to be.**
   * Everything inside has already come, so there is nothing ahead to ask for;
   * but the city judges a tile by how near it comes to a shape, and that reach
   * has the margin on it however the mask fetches — so the city fetches the
   * margin's width further round a shape held whole as well, and
   * `Buildings.each` hands over the buildings standing in it. The ground
   * chooses from the shape's own box, and the margin only lets in the tiles in
   * that box's corners that a round edge would have left out. Read off the
   * code (`maskTouches`, `maskBoxesIn`), not measured.
   */
  readonly margin?: number
  /**
   * How much of the inside is fetched at once: all of it, or only the part the
   * screen has reached. `'all'` by default.
   *
   * `'all'` is what standing a shape on the map has always meant — the
   * inside comes however the camera is pointed, so a page may ask "every
   * building in this circle" and be answered. `'onScreen'` hands that back:
   * the cut is exactly where it was, and the picture inside it is the same,
   * but the ground is asked for as the view arrives at it rather than up
   * front. Four stations twenty kilometres apart, where the screen holds one
   * of them, are three quarters of a city fetched for nobody.
   *
   * It does nothing on shapes that ride the camera, which have no inside
   * that can be asked for whole in the first place; see
   * {@link Viewer.screenPicks}.
   *
   * **What it costs is the counting.** `Buildings.each` hands over what has
   * arrived rather than what is inside the shape, and `loaded` says the screen
   * has what it asked for rather than that the shape has. A page that counts
   * leaves this alone.
   */
  readonly fetch?: 'all' | 'onScreen'
}

/**
 * One shape a mask is cut to, or a site a page names — a place to clear,
 * hide or paint.
 *
 * A circle and a box are one shape underneath — a rectangle with rounded
 * corners, the circle being the case where the straight part has no length —
 * so one arithmetic answers both and either can be set on a material after it
 * is woven. A ring of corners is the other, for the shapes those two are too
 * blunt for, and it carries the box round itself so that everything narrowing
 * a rectangle reads it without knowing which kind it is.
 *
 * There is one rule and the four shapes share it: **cut to `shape` round
 * `center`**, and only the way the size is written differs between them. So
 * where a shape sits is one field wherever it appears, and every shape can
 * either stand on the map or ride the camera.
 *
 * Which of those it does is what decides whether how much is fetched *can* be
 * the whole of it. A shape standing still has an inside that can be asked for
 * whole; one riding the camera has not, since the ground it is about to cover
 * has not been asked about yet. One thing hands that back where it is on
 * offer, and it is {@link Mask.fetch}; see {@link Viewer.screenPicks}.
 */
interface MaskShapeBase {
  /**
   * Where the shape sits: a place on the map, or `'view'` to ride the camera.
   *
   * Left out it is `'view'` — except for a ring, whose corners already say
   * where it is. A shape that rides the camera has no edge that stands still,
   * so what is inside it changes as the view moves and nothing can be said to
   * have all arrived; see {@link Viewer.screenPicks}.
   *
   * Its metres are turned into the map's own units at the latitude the camera
   * is at when the mask is set, and not again as it rides. Mercator stretches
   * with latitude, so after a long flight north or south the shape reaches
   * more or less far on the ground than it was given — by arithmetic, a
   * circle of 500m set over 東京 reaches about 450m over 札幌. Setting the mask
   * again measures it where the camera is then.
   */
  readonly center?: readonly [number, number] | 'view'
}

export type MaskShape =
  | (MaskShapeBase & {
      /**
       * As far as the screen reaches, which is the shape of a viewer nobody
       * has cut. Riding the camera it cuts nothing anyone can see; given a
       * place it keeps the reach it had at that moment, and becomes a circle
       * standing there.
       */
      readonly shape: 'view'
    })
  | (MaskShapeBase & {
      readonly shape: 'circle'
      /** How far it reaches from the middle, in metres. */
      readonly radius: number
    })
  | (MaskShapeBase & {
      readonly shape: 'rect'
      /** How far across, east to west, in metres. */
      readonly width: number
      /**
       * How far across, north to south, in metres. Left out, as wide as it is.
       *
       * Up nowhere: everywhere else in this library `height` is up, and here
       * it is the second side of a flat rectangle, as three's `PlaneGeometry`
       * names its two (`width`, `height`). A rectangle on the map has no up.
       */
      readonly height?: number
      /** How far the corners are rounded, in metres. Never more than half the shorter side. */
      readonly corner?: number
    })
  | (MaskShapeBase & {
      readonly shape: 'polygon'
      /**
       * The corners, each as [longitude, latitude].
       *
       * The ring closes itself — the last corner joins the first — and which
       * way round they go does not matter. Fewer than three is no shape at
       * all and holds nothing.
       *
       * For a shape a circle and a box are too blunt for: a district, a
       * campus, the quarter of a mall. As many corners as a page has: one
       * drawn by hand round a district is a dozen, one traced off a survey is
       * hundreds, and neither is measured against a budget. A mask set on the
       * viewer is drawn out on a grid once ({@link MaskField}) and read there,
       * so what a fragment costs is one read whatever the ring is; everything
       * else walks the corners on the processor.
       *
       * What the grid does cost is fineness: a neck narrower than a texel of
       * it fills or parts. At a mall that texel is a metre or two, at a
       * prefecture a hundred.
       *
       * A ring traced round the very things it will cut — a mall's own walls,
       * say — wants pushing a metre or two clear of them first. On the line,
       * every pixel of a wall asks which side of itself it is on and the
       * answer comes out half and half, which draws the wall in stripes.
       */
      readonly points: readonly (readonly [number, number])[]
    })

/**
 * One piece of a mask, in the world's own units.
 *
 * Held as a rounded box: the straight part, and how far the corners are
 * rounded. A circle is a straight part of no length rounded by its radius, so
 * the same arithmetic answers both. A ring carries its corners as well, and
 * the box it fills in is the one round those corners; see {@link corners}.
 */
export interface MaskPart {
  /** The middle, in world units. */
  readonly x: number
  /** The middle, on the world's z — which runs south where the tiles' y runs north. */
  readonly z: number
  /** Half the straight part, before the corners are rounded. */
  readonly halfX: number
  readonly halfZ: number
  /** How far the corners are rounded. */
  readonly round: number
  /** Whether only the part of it the screen has reached is fetched; see {@link Mask.fetch}. */
  readonly onScreen: boolean
  /**
   * How far in from the edge what is drawn fades out, in world units.
   *
   * Inward, not outward: the shape still ends where it ended, so what is
   * fetched does not change and only the last stretch before the edge is
   * taken towards the colour behind it.
   */
  readonly fade: number
  /**
   * How far past the edge this piece is fetched anyway, in world units.
   *
   * Outward, where {@link fade} is inward, and read by the two tests that
   * choose tiles rather than by anything that draws: the shape still ends
   * where it ended. See {@link Mask.margin}.
   */
  readonly margin: number
  /**
   * The corners of a ring, x and z in turn, where this piece is a polygon.
   *
   * A polygon still carries the box round itself in `x`, `z`, `halfX` and
   * `halfZ`, so everything that narrows a rectangle — what to fetch, what to
   * lay a sheet over — reads a polygon without knowing it is one. Only the
   * two that measure the shape exactly, {@link maskEdge} and the shader, walk
   * these.
   */
  readonly corners?: Float64Array
}

/**
 * A mask worked out in the world's own units, which is the form everything
 * that has to judge against it uses.
 *
 * A list of pieces rather than one, and everything that judges against it
 * walks the list. Keeping the list inside the area is what lets every test
 * here — and every layer written against them, including layers this library
 * never saw — keep the shape of a question about one thing.
 */
export interface MaskArea {
  /** The pieces, which the shape is the union of. */
  readonly parts: readonly MaskPart[]
  /** The box round all of them, worked out once as the area is made. */
  readonly bounds: WorldBounds
  /**
   * The shape drawn out on a grid, which is what the card reads.
   *
   * A picture rather than the pieces themselves, because a fragment asking
   * "am I inside?" of a ring traced off a survey would walk hundreds of
   * corners for every pixel of every material the mask is woven into. Drawn
   * once when the mask is set, it answers in one read however the shape was
   * written — so a page may hand over as many corners, and as many pieces, as
   * it likes.
   *
   * Drawn on the first reading rather than as the area is made, and null
   * where there is no shape to draw. Most areas are never read this way at
   * all: `Buildings.setStyle(site, …)` and `buildings.hide(ring)` both answer by
   * walking the corners on the processor, and drawing a picture for them
   * would be nine megabytes rasterised, and a megabyte held, for something no
   * shader will sample. A page clearing twenty plots paid that twenty times.
   */
  readonly field: MaskField | null
  /**
   * Whether any piece rides the camera, and so the shape moves with the view.
   *
   * What this decides is not how it is drawn but what is fetched. A shape
   * that stands still has an inside that can be fetched whole; one that moves
   * has not, since the ground it is about to cover has not been asked for
   * yet. See {@link Viewer.screenPicks}.
   */
  readonly follows: boolean
  /**
   * Whether every piece is held whole — the shape's inside is all in hand, and
   * the screen has nothing to add.
   *
   * False where the mask was told {@link Mask.fetch} `'onScreen'`, and false
   * behind a shape that rides the camera, which has no whole to hold. This is
   * what {@link Viewer.screenPicks} is reading.
   */
  readonly fetchesAll: boolean
  /**
   * Puts the shape round a new middle, in world units, where it rides the
   * camera. Every piece moves together or none does, so this is always the
   * same shape read from further over and never a redrawing.
   */
  moveTo(x: number, z: number): void
  /** Gives the picture back. The mask's owner calls it when the mask is replaced or the owner dies. */
  dispose(): void
}

/**
 * Where the view is and how far it reaches, in the world's own units.
 *
 * Handed in rather than read, because the mask is worked out in `mask.ts` and
 * the camera belongs to the viewer. `reach` is what `shape: 'view'` stands
 * for: the circle {@link Viewer.visibleBounds} is the box round.
 */
export interface MaskView {
  readonly x: number
  readonly z: number
  readonly reach: number
}

/**
 * Works a mask out in world units, or nothing where there is no mask.
 *
 * What arrives in real metres is brought down by Mercator's stretch at each
 * piece's own latitude, the same way a building's height is — the hem and the
 * margin with it, which is why each piece still carries its own though the
 * page says them once. The stretch is read once per piece rather than over
 * its shape: a piece is small enough beside the country that reading it at
 * the middle is within a hair of reading it anywhere else, and a shape whose
 * stretch varied along it would no longer be the rounded box the shader
 * draws. Pieces far apart each get their own, so a mask over Tokyo and one
 * over Okinawa are both right.
 *
 * No shapes is a mask that holds nothing, not the absence of one: the union
 * of nothing is nothing. `null` is how a caller says there is no mask.
 */
export function maskArea(mask: Mask | null | undefined, view?: MaskView): MaskArea | null {
  if (!mask) return null
  const given = mask.shapes
  // Every piece a page hands over, however many. What is counted against the
  // card's arrays is counted where the card is fed; see {@link MaskShader.set}
  let pieces = shapely(given.map((one) => partOf(one, mask, view)))
  // Nothing left of a mask that had pieces: all of them were the screen's own
  // reach riding the camera. That is a viewer nobody has cut, which is not
  // the same as one cut to nothing — an empty list is still a shape, and
  // holds nothing.
  if (given.length > 0 && pieces.length === 0) return null

  // All of them ride the camera or none does. Mixed, the shape is a different
  // shape at every step, and the picture the card reads — drawn once over the
  // box round every piece — would have to be drawn again each time: measured
  // at 15ms for two circles and 55ms for a ring of 240 corners, every frame a
  // drag moves the view. The ones that would have ridden are left where the
  // view was when the mask was set, which is a shape a page can see and
  // understand, and it is said once.
  const riding = pieces.filter((piece) => piece.follows).length
  if (riding > 0 && riding < pieces.length) {
    console.warn(
      '[plateau-ui] A mask mixes shapes that ride the camera with shapes that stand on the map. ' +
        'They all stand: give every piece a center, or none of them.',
    )
    // Standing now, so each one holds its inside whole unless the page asked
    // otherwise. Rebuilt rather than reused: the part a riding piece carries
    // says it waits for the screen because it rode, and it no longer does.
    pieces = pieces.map((piece) => ({
      part: { ...piece.part, onScreen: piece.waits },
      follows: false,
      waits: piece.waits,
    }))
  }

  let parts = pieces.map((piece) => piece.part)
  let bounds = boxRound(parts)
  const follows = pieces.some((piece) => piece.follows)
  // Every piece is told alike, and one riding the camera is told the screen
  // whatever the page said; either way what is in hand then turns on where
  // the camera is, and nothing can be said to have all arrived
  const fetchesAll = parts.every((part) => !part.onScreen)
  let at = { x: view?.x ?? 0, z: view?.z ?? 0 }
  let field: MaskField | null = null
  let drawn = false
  return {
    get parts(): readonly MaskPart[] {
      return parts
    },
    get bounds(): WorldBounds {
      return bounds
    },
    follows,
    fetchesAll,
    get field(): MaskField | null {
      if (!drawn) {
        drawn = true
        field = fieldOf(parts, bounds)
      }
      return field
    },
    moveTo: (x: number, z: number) => {
      const dx = x - at.x
      const dz = z - at.z
      if (!follows || (dx === 0 && dz === 0)) return
      at = { x, z }
      parts = parts.map((part, i) => (pieces[i]!.follows ? movedPart(part, part.x + dx, part.z + dz) : part))
      bounds = boxRound(parts)
      // Where every piece moved together the shape is the same shape a little
      // further over, so the corner the picture is read from moves and nothing
      // is drawn again — which is what makes a mask that rides the camera cost
      // two numbers a frame. The card follows without being told: the corner
      // it reads is this very object (see {@link MaskShader.set}).
      if (field) field.origin.set(field.origin.x + dx, field.origin.y + dz)
    },
    dispose: () => {
      field?.texture.dispose()
      field = null
      // Not drawn again after it has been given back: whoever is handed the
      // area now reads a mask that holds nothing, rather than a picture the
      // card has already been told to forget. It is the area and not the
      // picture that {@link MaskShader.set} branches on. Nothing gets there
      // today — an area is given back only once whatever read it has been
      // pointed at the next one.
      drawn = true
    },
  }
}

/** The world rectangle round a mask, pieces and all. */
export function maskBounds(area: MaskArea): WorldBounds {
  return area.bounds
}

/**
 * A circle holding every piece: its middle on the world's x and z, and how far
 * it reaches, in world units.
 *
 * For whatever has to cover the shape with something that does not share the
 * world's axes. The light is the one that asks: it looks along its own
 * direction, so a rectangle in the world is a lozenge to it and the box it
 * opens has to hold that lozenge whichever way the sun stands — which is to
 * say, it has to hold the circle round the shape.
 *
 * One piece gives its own circle exactly, which is the case worth having:
 * a circular mask hands back its own radius rather than the corner of the box
 * round it, a difference of the square root of two on what the light is asked
 * to cover. Several pieces are held in the circle round the box round them
 * all, which is as tight as this gets without solving for the smallest circle
 * over a set — and the pieces of a mask are usually far apart, where that
 * answer is nearly the same one.
 */
export function maskCircle(area: MaskArea): { x: number; z: number; radius: number } | null {
  const [only] = area.parts
  if (!only) return null
  if (area.parts.length === 1) {
    return { x: only.x, z: only.z, radius: Math.hypot(only.halfX, only.halfZ) + only.round }
  }
  const { minX, maxX, minY, maxY } = area.bounds
  return {
    x: (minX + maxX) / 2,
    // The box is kept with y running north, and the world's z runs south
    z: -(minY + maxY) / 2,
    radius: Math.hypot(maxX - minX, maxY - minY) / 2,
  }
}

/**
 * The box round each piece — whole, or cut down to the screen where the mask
 * asked for that — and the empty ones left out. Where there is no mask, the
 * screen itself.
 *
 * This is what to fetch over. Narrowing to the one box round the whole mask
 * instead would hand a caller the ground between the pieces, which is exactly
 * the ground a mask of several pieces was drawn to leave out — and a caller
 * whose work is bounded, as choosing tiles is, would spend that bound on it
 * and come back with nothing.
 *
 * **Which of the two the pieces get is the mask's to say** ({@link
 * Mask.fetch}), which is why the screen is handed in rather than the caller
 * choosing for all of them. Said once for the lot: it was said on each piece
 * for a while, and the rest of the fetching never followed it piece by piece.
 *
 * **`cutAll` takes that back and binds every piece to the screen**, for a
 * caller whose own work is worth no more than the screen whatever the mask
 * asked for. The coarse stand-in the ground lays under a zoom step is the one:
 * it is thrown away as the fine tiles land, so fetching it over a whole shape
 * is a quarter as many tiles again of ground nobody is looking at.
 *
 * The margin goes on the boxes that are cut and not on the ones held whole,
 * which is what {@link Mask.margin} says of itself: what it buys is the ground
 * an edge is about to reach, and an edge that is not moving has already
 * reached everything inside it.
 */
export function maskBoxesIn(
  area: MaskArea | null,
  screen: WorldBounds,
  cutAll = false,
): readonly WorldBounds[] {
  if (!area) return [screen]
  const boxes: WorldBounds[] = []
  for (const part of area.parts) {
    if (part.onScreen || cutAll) {
      const cut = overlap(partBounds(part, part.margin), screen)
      if (cut) boxes.push(cut)
      continue
    }
    boxes.push(partBounds(part))
  }
  return boxes
}

/**
 * Whether any part of a world rectangle falls inside the mask, which is what
 * says whether a tile is worth fetching. True where there is no mask.
 *
 * Exact rather than a box against a box: a tile sitting off a circle's corner
 * is inside the box round it and outside the circle, and fetching it would
 * put the saving back where a round mask needs it most.
 */
export function maskTouches(area: MaskArea | null, bounds: WorldBounds): boolean {
  if (!area) return true
  return area.parts.some((part) => {
    const across = gap(bounds.minX, bounds.maxX, part.x, part.halfX)
    const along = gap(-bounds.maxY, -bounds.minY, part.z, part.halfZ)
    // Past the edge by whatever the piece asked to be fetched ahead
    const reach = part.round + part.margin
    return across * across + along * along <= reach * reach
  })
}

/**
 * How far past the edge a place on the ground lies: negative inside, nought on
 * it, in world units. Nothing is ever outside where there is no mask.
 *
 * The same rounded box the shader measures, worked out here for whoever has to
 * cut something to the shape before it is drawn rather than as it is drawn — a
 * line, whose corners are pushed sideways by the card and whose fragments are
 * therefore nowhere the shape can be judged at.
 *
 * Over several pieces it is the nearest of them, which is the union: a place
 * is inside if it is inside any one. Where two pieces overlap, the reading
 * inside the overlap is nearer the edge than the union truly is — the hem
 * shows faintly along a seam there — which is why pieces are better set apart
 * than piled up.
 */
export function maskEdge(area: MaskArea | null, x: number, z: number): number {
  if (!area) return -Infinity
  let edge = Infinity
  for (const part of area.parts) {
    if (part.corners) {
      edge = Math.min(edge, ringEdge(part.corners, x, z))
      continue
    }
    const qx = Math.abs(x - part.x) - part.halfX
    const qz = Math.abs(z - part.z) - part.halfZ
    const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
    edge = Math.min(edge, out + Math.min(Math.max(qx, qz), 0) - part.round)
  }
  return edge
}

/** Whether one place on the ground is inside the mask. True where there is no mask. */
export function maskHolds(area: MaskArea | null, x: number, z: number): boolean {
  return maskEdge(area, x, z) <= 0
}

/**
 * A world rectangle cut down to the box round the whole mask, or null where
 * none of it is inside.
 *
 * The box, not the shape: what this narrows are rectangles — the patch the
 * ground sheet is laid over, the patch the cities are looked up in — and a
 * rectangle is all they can be. The shape itself is kept by the shader.
 *
 * One box over all the pieces, so what comes back is one rectangle. Whoever
 * is narrowing something that must not take in the ground between the pieces
 * wants {@link maskBoxesIn} instead.
 */
export function maskIn(area: MaskArea | null, bounds: WorldBounds): WorldBounds | null {
  if (!area) return bounds
  return overlap(area.bounds, bounds)
}

/** How a mask behaves, which every one of its shapes wears alike; see {@link Mask}. */
type MaskHow = Pick<Mask, 'fade' | 'margin' | 'fetch'>

/** One mask as a piece in world units: a rounded box, or a ring and the box round it. */
/** A piece worked out, and whether it rides the camera. */
interface MaskPiece {
  readonly part: MaskPart
  readonly follows: boolean
  /**
   * What the page itself asked for, which is not the same as what the part
   * carries: a piece that rides the camera is given `onScreen` whatever the
   * page said, having no inside to hold. Kept apart so that a mixed shape
   * forced to stand can be rebuilt with the page's own wish — otherwise a
   * piece that only ever waited because it rode would go on waiting after it
   * had been made to stand still.
   */
  readonly waits: boolean
}

/**
 * One of a page's shapes worked out where it sits, or nothing where it cuts
 * nothing at all.
 *
 * The only one that cuts nothing is the screen's own reach riding the camera,
 * which is what a viewer nobody has cut looks like. It could be drawn as the
 * circle it is — every pixel of the screen falls inside it — but then its
 * radius would change with every notch of the wheel, and the picture the card
 * reads would be rasterised afresh each time for an edge no one can see.
 */
/**
 * Whether a shape rides the camera rather than standing somewhere on the map:
 * a size with no `center`, or one told to ride it.
 *
 * What a page names as a site — a place to clear, to hide, to paint — has to
 * stand somewhere. A shape that rides the camera has nowhere to be read away
 * from one, so asked of a site it would quietly hold nothing; see {@link partOf}.
 */
export function ridesTheCamera(shape: MaskShape): boolean {
  return shape.center === 'view' || (shape.center === undefined && shape.shape !== 'polygon')
}

/** Throws, naming `owner`, where a shape named as a site rides the camera; see {@link ridesTheCamera}. */
export function standsSomewhere(shapes: MaskShape | readonly MaskShape[], owner: string): void {
  for (const piece of Array.isArray(shapes) ? (shapes as readonly MaskShape[]) : [shapes as MaskShape]) {
    if (ridesTheCamera(piece)) {
      throw new Error(
        `${owner}: a site has to stand somewhere on the map — give the ${piece.shape} a \`center\``,
      )
    }
  }
}

function partOf(shape: MaskShape, how: MaskHow, view: MaskView | undefined): MaskPiece | null {
  const ring = shape.shape === 'polygon'
  // A ring's corners already say where it is, so left out it stays there.
  // Everything else is a size with no place, and rides the camera until it is
  // given one.
  // Written out rather than asked of `ridesTheCamera`, which says the same,
  // so that the type of `center` follows the answer
  const follows = shape.center === 'view' || (shape.center === undefined && !ring)
  // Nothing to hand back where the piece rides the camera: it has no inside
  // that could have been asked for whole in the first place. What the page
  // asked for is kept beside it; see {@link MaskPiece.waits}.
  const waits = how.fetch === 'onScreen'
  const onScreen = follows || waits
  if (shape.shape === 'view' && follows) return null
  // Asked about away from any camera — `buildings.hide(shape)` and the rest
  // read a page's shape where it stands, once — a shape that rides one holds
  // nothing. There is nowhere to put it, and the world's middle is a worse
  // answer than none.
  if (follows && !view) return null

  if (ring) {
    const part = ringPart(shape.points, how.fade ?? 0, how.margin ?? 0, onScreen)
    if (shape.center === undefined) return { part, follows: false, waits }
    const to = follows ? view! : placeOf(shape.center)
    return { part: movedPart(part, to.x, to.z), follows, waits }
  }

  const to = follows ? view! : placeOf(shape.center as readonly [number, number])
  // Mercator's stretch where the shape stands, the same way a building's
  // height is brought down. A shape that rides the camera reads it where the
  // camera is when the mask is set, and only then: riding is `moveTo`, two
  // numbers a frame, and nothing reads the stretch again. So after a flight
  // north or south it covers more or less ground than it was given — a circle
  // of 500m set over 東京 reaches about 450m over 札幌 (arithmetic, from the
  // two latitudes' cosines; not measured) — until the mask is set again. This
  // said, until 2026-10-29, that such a shape stays right after a flight.
  const stretch = 1 / metersPerUnit(yToLat(-to.z))
  const fade = Math.max(0, how.fade ?? 0) * stretch
  const margin = Math.max(0, how.margin ?? 0) * stretch
  const round = (): number =>
    shape.shape === 'view' ? view!.reach : Math.max(0, (shape as { radius: number }).radius) * stretch

  if (shape.shape === 'view' || shape.shape === 'circle') {
    return {
      part: { x: to.x, z: to.z, halfX: 0, halfZ: 0, round: round(), fade, margin, onScreen },
      follows,
      waits,
    }
  }

  const width = Math.max(0, shape.width) * stretch
  const height = Math.max(0, shape.height ?? shape.width) * stretch
  const corner = Math.min(Math.max(0, shape.corner ?? 0) * stretch, width / 2, height / 2)
  return {
    part: {
      x: to.x,
      z: to.z,
      halfX: width / 2 - corner,
      halfZ: height / 2 - corner,
      round: corner,
      fade,
      margin,
      onScreen,
    },
    follows,
    waits,
  }
}

/**
 * How far past the screen a mask asks to be fetched anyway, in metres.
 *
 * `shape: 'view'` riding the camera cuts nothing anyone can see, so it is left
 * out of the pieces altogether and the {@link Mask.margin} it was given with
 * would have nowhere to live. It is the one place that margin is worth most —
 * an uncut viewer fetches exactly what is on screen, and a page that wants
 * the next street ready before it comes into view has no other way to say
 * so — so it is read off here and the viewer widens what it counts as
 * reachable by it.
 *
 * The {@link Mask.fade} of a mask that is nothing but that has nowhere to live
 * either, and unlike margin there is nothing to read it: a hem at the edge of
 * the screen is a picture nobody draws yet. Said once rather than quietly
 * doing nothing. Beside other shapes it is theirs, and nothing is said.
 */
export function viewMargin(mask: Mask): number {
  const screen = (one: MaskShape): boolean =>
    one.shape === 'view' && (one.center === undefined || one.center === 'view')
  if (!mask.shapes.some(screen)) return 0
  if (mask.fade && mask.shapes.every(screen)) {
    console.warn(
      "[plateau-ui] A mask of shape 'view' riding the camera cannot be hemmed: " +
        'there is no edge on screen to fade. The fade is ignored.',
    )
  }
  return mask.margin ?? 0
}

/** A place on the map, in the world's own units. */
function placeOf(center: readonly [number, number]): { x: number; z: number } {
  return { x: lonToX(center[0]), z: -latToY(center[1]) }
}

/**
 * The same piece standing somewhere else.
 *
 * A ring carries its corners, so they move with it — the shape is the same
 * shape, only further over. Nothing else about a piece depends on where it
 * stands.
 *
 * The corners are written where they lie rather than copied. A shape riding
 * the camera is moved every frame the view moves, and a ring traced off a
 * survey is hundreds of corners: copied, a drag leaves hundreds of kilobytes
 * a second behind it for the collector. The array was made here and is held
 * by nothing else, and everything that reads it does so after the move.
 */
function movedPart(part: MaskPart, x: number, z: number): MaskPart {
  const dx = x - part.x
  const dz = z - part.z
  if (dx === 0 && dz === 0) return part
  const corners = part.corners
  if (corners) {
    for (let i = 0; i < corners.length; i += 2) {
      corners[i] = corners[i]! + dx
      corners[i + 1] = corners[i + 1]! + dz
    }
  }
  return { ...part, x, z, corners }
}

/**
 * One ring as a piece: its corners in world units, and the box round them.
 *
 * The hem is brought down by Mercator's stretch at the middle of the ring,
 * the same way a circle's radius is — a shape small enough to be a mask is
 * within a hair of one stretch throughout.
 *
 * Fewer than three corners is not a shape, and {@link fitted} drops it. A mask
 * left with no pieces at all holds nothing rather than being no mask — the
 * difference between "nothing is inside" and "everything is" — so a page
 * handing over a half-drawn ring sees an empty screen and not a whole city.
 */
function ringPart(
  points: readonly (readonly [number, number])[],
  fade: number,
  margin: number,
  onScreen: boolean,
): MaskPart {
  const corners = new Float64Array(points.length * 2)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let lat = 0
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const x = lonToX(point[0])
    const z = -latToY(point[1])
    corners[i * 2] = x
    corners[i * 2 + 1] = z
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
    lat += point[1]
  }
  if (points.length < 3) {
    return {
      x: 0,
      z: 0,
      halfX: 0,
      halfZ: 0,
      round: 0,
      fade: 0,
      margin: 0,
      onScreen,
      corners: new Float64Array(0),
    }
  }
  const stretch = 1 / metersPerUnit(lat / points.length)
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
    round: 0,
    fade: Math.max(0, fade) * stretch,
    margin: Math.max(0, margin) * stretch,
    onScreen,
    corners,
  }
}

/**
 * The pieces that are a shape at all: a ring of fewer than three corners is
 * dropped, the rest are kept whole.
 *
 * Whole, however many corners they have, and nothing here counts them. The
 * card used to hold a ring in an array of its own and cut what did not fit,
 * which is why this once had a budget to keep clear of; it reads a picture of
 * the shape now ({@link MaskField}), and a picture is the same size whatever
 * was drawn on it. Everything else — which buildings a shape paints, which it
 * hides, which tiles are worth fetching — is answered by {@link maskEdge}
 * walking the corners one at a time, as it always was.
 *
 * A ring left with too few corners is dropped rather than kept as the box
 * round itself: the box is the one answer that is wrong in the direction that
 * shows, since the union would then keep everything in a rectangle the page
 * never drew.
 */
function shapely(pieces: readonly (MaskPiece | null)[]): MaskPiece[] {
  return pieces.filter(
    (piece): piece is MaskPiece => piece !== null && (!piece.part.corners || piece.part.corners.length >= 6),
  )
}

/**
 * How far past a ring's edge a place lies: negative inside, nought on it.
 *
 * The distance to the nearest edge, signed by whether the place is inside —
 * counted by crossings, which asks nothing of how the ring was wound and
 * answers for a shape that folds back on itself. The same arithmetic the
 * shader walks, so a thing cut before it is drawn and a fragment cut as it is
 * drawn land on the same edge.
 */
function ringEdge(corners: Float64Array, x: number, z: number): number {
  const count = corners.length / 2
  if (count < 3) return NO_MASK
  let nearest = Infinity
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ix = corners[i * 2]!
    const iz = corners[i * 2 + 1]!
    const jx = corners[j * 2]!
    const jz = corners[j * 2 + 1]!
    const ex = jx - ix
    const ez = jz - iz
    const wx = x - ix
    const wz = z - iz
    const along = Math.min(1, Math.max(0, (wx * ex + wz * ez) / (ex * ex + ez * ez || 1)))
    const bx = wx - ex * along
    const bz = wz - ez * along
    nearest = Math.min(nearest, bx * bx + bz * bz)
    if (iz > z !== jz > z && wx < (ex * wz) / (ez || 1e-12)) inside = !inside
  }
  return (inside ? -1 : 1) * Math.sqrt(nearest)
}

/** The world rectangle round one piece. */
function partBounds(part: MaskPart, grow = 0): WorldBounds {
  const reachX = part.halfX + part.round + grow
  const reachZ = part.halfZ + part.round + grow
  return {
    minX: part.x - reachX,
    maxX: part.x + reachX,
    // North is where z is least, so the two ends swap as they cross over
    minY: -(part.z + reachZ),
    maxY: -(part.z - reachZ),
  }
}

/**
 * The one rectangle round several, or nothing where there are none.
 *
 * What it is for is asking a question over exactly what is being fetched. The
 * box round the whole mask is wider than that twice over — it takes in the
 * ground between the pieces, and behind a shape riding the camera it reaches
 * as far as the shape rather than as far as the screen — and a catalog asked
 * over the difference answers with cities whose tiles are thrown away as they
 * land. So the boxes {@link maskBoxesIn} hands back are what this is given.
 */
export function boundsRound(boxes: readonly WorldBounds[]): WorldBounds | null {
  let box: WorldBounds | null = null
  for (const here of boxes) {
    box = box
      ? {
          minX: Math.min(box.minX, here.minX),
          maxX: Math.max(box.maxX, here.maxX),
          minY: Math.min(box.minY, here.minY),
          maxY: Math.max(box.maxY, here.maxY),
        }
      : here
  }
  return box
}

/**
 * The rectangle round every piece. Empty of pieces it is a rectangle of no
 * width, which every test reads as holding nothing — which is what an empty
 * mask is.
 */
function boxRound(parts: readonly MaskPart[]): WorldBounds {
  if (parts.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  let box: WorldBounds | undefined
  for (const part of parts) {
    const here = partBounds(part)
    box = box
      ? {
          minX: Math.min(box.minX, here.minX),
          maxX: Math.max(box.maxX, here.maxX),
          minY: Math.min(box.minY, here.minY),
          maxY: Math.max(box.maxY, here.maxY),
        }
      : here
  }
  return box as WorldBounds
}

/** Where two world rectangles meet, or null where they do not. */
function overlap(a: WorldBounds, b: WorldBounds): WorldBounds | null {
  const cut = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
  return cut.maxX > cut.minX && cut.maxY > cut.minY ? cut : null
}

/** How far a span lies outside another, which is nought wherever the two meet. */
function gap(min: number, max: number, middle: number, half: number): number {
  return Math.max(0, min - (middle + half), middle - half - max)
}

/**
 * How many texels the picture of a mask is drawn on, along each side.
 *
 * The one number that decides how finely the cut follows the shape, and the
 * only thing the shape's own size is measured against: a mask over a mall is
 * drawn at a metre and a half to the texel, one over a prefecture at a
 * hundred. What is lost is never the edge's place — a distance field
 * interpolates, so the line lands well inside a texel — but anything thinner
 * than a texel, which fills or parts.
 */
const MASK_FIELD_SIZE = 512

/** How far either side of the edge the picture keeps a true distance, in texels. */
const MASK_FIELD_BAND = 6

/**
 * The shape drawn out: how far from the edge each place on a grid lies, and
 * what hem it wears there.
 *
 * The same two numbers the shader used to work out by walking the pieces —
 * see {@link MaskShader}'s reading — so nothing downstream of it changes.
 * Distance is kept only within a band either side of the edge and saturates
 * beyond it: past the hem the exact figure is never read, only its sign.
 */
export interface MaskField {
  /**
   * The grid's near corner, in world units.
   *
   * The very object the card's uniform points at, so a mask that rides the
   * camera moves the picture by writing here; see {@link MaskArea.moveTo}.
   */
  readonly origin: Vector2
  /** How far it reaches from there. */
  readonly spanX: number
  readonly spanZ: number
  /** How far either side of the edge the distance is true, in world units. */
  readonly band: number
  /**
   * The widest hem any piece wears, which the picture's second channel is read
   * against. A page says one hem in metres; in world units it is wider the
   * further north a piece stands, so pieces far apart still differ.
   */
  readonly fadeMost: number
  /** The picture itself: distance in the first channel, hem in the second. */
  readonly texture: Texture
}

/**
 * Draws the pieces out on a grid.
 *
 * Bytes rather than floats, because what the shader needs near the edge is
 * fineness and not range: a byte across a band of six texels is a fortieth of
 * a texel a step, and a byte is filtered everywhere without asking the device
 * for anything. Far from the edge the value saturates, which costs nothing —
 * the reading there is used for its sign alone.
 *
 * A ring is drawn in two passes rather than one. Measuring every texel
 * against every corner is what the shader used to do per fragment, and doing
 * it here for a 512-square grid and a 127-corner ring is sixteen million
 * measurements. Instead the inside is found by crossings, one row at a time,
 * and the true distance is worked out only for the texels a segment passes
 * near — which is the band, and nothing else.
 */
function fieldOf(parts: readonly MaskPart[], bounds: WorldBounds): MaskField | null {
  if (parts.length === 0) return null
  const size = MASK_FIELD_SIZE
  const reachX = bounds.maxX - bounds.minX
  const reachZ = bounds.maxY - bounds.minY
  const fadeMost = Math.max(0, ...parts.map((part) => part.fade))
  // The band has to hold the hem, or the hem would read against a saturated
  // distance and step instead of fading
  const band = Math.max(fadeMost, (Math.max(reachX, reachZ) / size) * MASK_FIELD_BAND)
  const minX = bounds.minX - band
  const minZ = -bounds.maxY - band
  const spanX = reachX + band * 2
  const spanZ = reachZ + band * 2
  const stepX = spanX / size
  const stepZ = spanZ / size

  const count = size * size
  const edge = new Float64Array(count).fill(Infinity)
  const hem = new Float64Array(count)
  const near = new Float64Array(count)
  const inside = new Uint8Array(count)

  for (const part of parts) {
    if (part.corners) ringOnto(edge, hem, near, inside, part, minX, minZ, stepX, stepZ, size, band)
    else boxOnto(edge, hem, part, minX, minZ, stepX, stepZ, size)
  }

  const data = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    const d = Math.max(-band, Math.min(band, edge[i]!))
    data[i * 4] = Math.round(((d / band) * 0.5 + 0.5) * 255)
    data[i * 4 + 1] = fadeMost > 0 ? Math.round((hem[i]! / fadeMost) * 255) : 0
    data[i * 4 + 3] = 255
  }
  const picture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  picture.minFilter = LinearFilter
  picture.magFilter = LinearFilter
  picture.wrapS = ClampToEdgeWrapping
  picture.wrapT = ClampToEdgeWrapping
  picture.generateMipmaps = false
  picture.needsUpdate = true
  return { origin: new Vector2(minX, minZ), spanX, spanZ, band, fadeMost, texture: picture }
}

/** A rounded box onto the grid: the same arithmetic {@link maskEdge} uses, at every texel. */
function boxOnto(
  edge: Float64Array,
  hem: Float64Array,
  part: MaskPart,
  minX: number,
  minZ: number,
  stepX: number,
  stepZ: number,
  size: number,
): void {
  for (let row = 0; row < size; row++) {
    const z = minZ + (row + 0.5) * stepZ
    const qz = Math.abs(z - part.z) - part.halfZ
    for (let col = 0; col < size; col++) {
      const x = minX + (col + 0.5) * stepX
      const qx = Math.abs(x - part.x) - part.halfX
      const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
      const d = out + Math.min(Math.max(qx, qz), 0) - part.round
      const at = row * size + col
      if (d < edge[at]!) {
        edge[at] = d
        hem[at] = part.fade
      }
    }
  }
}

/**
 * A ring onto the grid: which side of it each texel falls, and how far from it
 * the ones near it lie.
 *
 * `near` and `inside` are handed in rather than made here so that several
 * rings in one mask reuse them; both are written before they are read, so
 * there is nothing to clear between rings.
 */
function ringOnto(
  edge: Float64Array,
  hem: Float64Array,
  near: Float64Array,
  inside: Uint8Array,
  part: MaskPart,
  minX: number,
  minZ: number,
  stepX: number,
  stepZ: number,
  size: number,
  band: number,
): void {
  const corners = part.corners!
  const count = corners.length / 2
  near.fill(Infinity)
  inside.fill(0)

  // Which side, by crossings along each row. The same count the shader and
  // `ringEdge` take, done once a row instead of once a texel.
  const crossings: number[] = []
  for (let row = 0; row < size; row++) {
    const z = minZ + (row + 0.5) * stepZ
    crossings.length = 0
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const iz = corners[i * 2 + 1]!
      const jz = corners[j * 2 + 1]!
      if (iz > z === jz > z) continue
      const ix = corners[i * 2]!
      const jx = corners[j * 2]!
      crossings.push(ix + ((z - iz) / (jz - iz)) * (jx - ix))
    }
    if (crossings.length < 2) continue
    crossings.sort((a, b) => a - b)
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = Math.max(0, Math.ceil((crossings[pair]! - minX) / stepX - 0.5))
      const to = Math.min(size - 1, Math.floor((crossings[pair + 1]! - minX) / stepX - 0.5))
      for (let col = from; col <= to; col++) inside[row * size + col] = 1
    }
  }

  // How far, for the texels a segment passes near. Squared until the end, so
  // the walk costs no roots.
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ix = corners[i * 2]!
    const iz = corners[i * 2 + 1]!
    const jx = corners[j * 2]!
    const jz = corners[j * 2 + 1]!
    const ex = jx - ix
    const ez = jz - iz
    const len = ex * ex + ez * ez || 1
    const fromCol = Math.max(0, Math.floor((Math.min(ix, jx) - band - minX) / stepX))
    const toCol = Math.min(size - 1, Math.ceil((Math.max(ix, jx) + band - minX) / stepX))
    const fromRow = Math.max(0, Math.floor((Math.min(iz, jz) - band - minZ) / stepZ))
    const toRow = Math.min(size - 1, Math.ceil((Math.max(iz, jz) + band - minZ) / stepZ))
    for (let row = fromRow; row <= toRow; row++) {
      const z = minZ + (row + 0.5) * stepZ
      for (let col = fromCol; col <= toCol; col++) {
        const x = minX + (col + 0.5) * stepX
        const wx = x - ix
        const wz = z - iz
        const along = Math.min(1, Math.max(0, (wx * ex + wz * ez) / len))
        const bx = wx - ex * along
        const bz = wz - ez * along
        const at = row * size + col
        const held = bx * bx + bz * bz
        if (held < near[at]!) near[at] = held
      }
    }
  }

  for (let at = 0; at < edge.length; at++) {
    const far = near[at]!
    const d = (inside[at] ? -1 : 1) * (far === Infinity ? band : Math.sqrt(far))
    if (d < edge[at]!) {
      edge[at] = d
      hem[at] = part.fade
    }
  }
}

/**
 * How far the reading stands from the shape when no piece is walked.
 *
 * Nothing branches on whether a mask is set. A node is woven into a material
 * the first time it draws and cannot be taken out afterwards, so a viewer
 * that might ever be masked would have to be told at the moment it is built —
 * and a layer added later, or a mask set later, would find the shader already
 * woven without one. The loop is therefore always there and walks however
 * many pieces there are now; with none, the reading is this, signed one way
 * for no mask at all and the other for a mask that holds nothing. Japan is
 * under two million world units across, so this is far enough beyond that no
 * place can fall the wrong side of it while still nowhere near where a 32-bit
 * float runs out.
 */
const NO_MASK = 1e9

/**
 * The one texel a shader samples before it has been given a mask.
 *
 * A node graph is built before there is a mask to build it round, and a
 * sampler has to point at something. Made once and shared, like the stand-in
 * materials in `offscreen.ts`: nothing reads it — the reading falls through to
 * {@link MaskShader}'s `none` while no picture is set — so one texel is
 * enough and there is nothing to give back.
 */
const NO_PICTURE = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType)
NO_PICTURE.needsUpdate = true

/**
 * The mask as a material reads it: uniforms it is written into, and the test
 * that cuts a fragment against them.
 *
 * One of these belongs to whoever owns a set of materials, and is written
 * from the viewer's mask. It is not shared between layers and there is no
 * module-wide one — a layer is not the viewer's to reach into, and the value
 * has one writer either way.
 */
export class MaskShader {
  /**
   * The picture of the shape, which is the whole of what this reads.
   *
   * The mask's own, not this shader's: it is drawn once where the mask is
   * worked out and every layer that cuts to that mask is handed the same one,
   * so a viewer has one picture however many layers read it. Until one is set
   * it points at a texel of nothing, since a node graph is built before there
   * is a mask to build it round and has to have something to sample.
   */
  private readonly picture = lookup(NO_PICTURE)
  /** The grid's near corner and how far it reaches, in world units. */
  private readonly origin = uniform(new Vector2())
  private readonly span = uniform(new Vector2(1, 1))
  /** How far either side of the edge the picture's distance is true. */
  private readonly band = uniform(1)
  /** The widest hem in the mask, which the picture's second channel is read against. */
  private readonly fadeMost = uniform(0)
  /** Whether there is a picture at all. Nought falls straight through to {@link none}. */
  private readonly drawnOut = uniform(0, 'int')
  /** What the reading is off the picture; see {@link NO_MASK}. */
  private readonly none = uniform(-NO_MASK)
  /** What the hem goes over to: whatever the scene is backed with. */
  private readonly into = uniform(new Color(0xffffff))

  /**
   * The reading at the place being drawn, and the test built from it, each
   * made once and handed out as they are from then on.
   *
   * Not one per material: the passes that draw the scene again under stand-ins
   * of their own tell two stand-ins apart by the nodes they carry, so every
   * material of a layer cutting by the same node is the difference between one
   * depth shader for the lot of them and one apiece.
   */
  private drawn: Node<'vec2'> | undefined
  private test: Node<'bool'> | undefined
  /** Materials already told to fade, so applying twice does not fade twice. */
  private readonly hemmed = new WeakSet<NodeMaterial>()

  /**
   * Cuts what a material draws to the mask, and hems what is left.
   *
   * `maskNode` is three's own place for the cut: it throws the fragment away
   * before the colour is worked out, so nothing here has to be threaded
   * through `colorNode` and the order the colour is built in is left alone.
   *
   * Every material reads the same `positionWorld`, fat lines among them:
   * `Line2NodeMaterial` expands its quad and assigns the result back into
   * `positionLocal` before the world matrix is applied, so the world place of
   * a line's fragment is the place on the line.
   *
   * `also` is whatever else the material wants thrown away — what of a thing
   * on its way is still under its own ground is the one that asks. It comes
   * through here rather than setting `maskNode` behind this class's back,
   * since there is only the one place for it. A material given it no longer
   * shares the one test the rest do, and so costs a depth shader of its own in
   * the passes that draw the scene again; only the materials that move their
   * corners ask for it, and those already stand in for themselves apiece.
   *
   * `at` moves the question off the fragment: not "is this pixel inside" but
   * "is the thing this pixel belongs to inside". What asks is anything that
   * **stands** — a tree grows at one spot, and the ground it grows out of ends
   * at the line, so a tree judged pixel by pixel keeps whatever part of its
   * crown leans over the line and that part is left in the air with nothing
   * under it. Measured on a thirty-metre circle: a tree standing 31.6m out
   * spread 3.6m, so 2m of crown came back inside and was drawn eight metres
   * up. The same rule slices the crown of a tree standing just inside.
   *
   * Given a place, the hem moves with it — a whole thing fades as a whole.
   * {@link holdsAt} answers the same question for a material that only wants
   * the reading; this is for one that wants the cut and the hem with it.
   */
  apply(material: NodeMaterial, also?: Node<'bool'>, at?: Node<'vec2'>): void {
    const read = at ? this.nearest(at) : this.here()
    const cut = at ? this.cutAt(read) : this.cut()
    material.maskNode = (also ? cut.and(also) : cut) as Node
    if (this.hemmed.has(material)) return
    this.hemmed.add(material)
    const asDrawn = material.setupOutput.bind(material)
    material.setupOutput = (builder, output) => asDrawn(builder, this.hem(output, read))
  }

  /**
   * Throws a fragment outside the mask away, for a pass whose material writes
   * its own `fragmentNode` and so never reaches `maskNode`. Called from
   * inside the `Fn` that builds such a node.
   */
  discardOutside(): void {
    Discard(this.cut().not() as Node)
  }

  /**
   * How far over to {@link into} a place given lies, for a pass that draws in
   * screen space and so never goes through {@link apply}.
   *
   * The corner shading is one: it reads the finished picture, and left to
   * itself it would darken a hem whose colours have already gone over to the
   * backdrop and then stop dead at the cut.
   */
  fadeAt(xz: Node<'vec2'>, least: Node<'float'>): Node<'float'> {
    const near = this.nearest(xz)
    return this.faded(near.x as Node<'float'>, near.y as Node<'float'>, least)
  }

  /**
   * How far over to {@link into} the hem has taken a place on the land, for a
   * pass that paints over what the land drew and finds the place from the
   * land's own depth rather than from where its fragment stands — the stencil
   * route in `shapes/paint.ts`.
   *
   * Inside the cut this is the hem, read as {@link hem} reads it. Past the cut
   * the land was never drawn, so a place read there is the land seen behind
   * something standing inside it — a wall, a tree's crown spreading over the
   * line — and the answer is the rim's far end: all the way over where the
   * nearest piece fades out, and nought where it is cut hard. A hard cut has
   * no hem to read, and paint on what stands at it is left as it always was;
   * read as all the way over, a wall standing inside a hard circle would lose
   * its paint wherever the land behind it lay outside — on the far side of
   * the view, the top of every wall near the rim (worked out, not measured).
   * Off the picture the nearest piece is not known, and the widest hem in the
   * mask answers for it.
   *
   * Nought on the line itself too, where the cut is hard. {@link faded} is a
   * step there, and a place read as lying exactly on the line, which a picture
   * read between two of its texels hands back now and then, came out all the
   * way over: one pixel of the cut line in a hard circle lost its paint
   * (measured, 中野 at a tilt of 55°: 135,157,217 painted, 229,231,234 after,
   * and no other pixel moved by more than two loads of the same code do).
   */
  fadeOnLand(xz: Node<'vec2'>): Node<'float'> {
    const near = this.nearest(xz)
    const over = this.faded(near.x as Node<'float'>, near.y as Node<'float'>, float(0))
    const hem = near.x.greaterThanEqual(NO_MASK / 2).select(this.fadeMost, near.y)
    const hemmed = near.x.lessThanEqual(0).select(over, float(1))
    return hem.greaterThan(0).select(hemmed, float(0)) as Node<'float'>
  }

  /**
   * Whether a place given lies inside the shape.
   *
   * For a material that has to judge somewhere other than the fragment it is
   * drawing. A building's footprint is the one that asks: it is a flat shape
   * and it goes whole or it stays whole, so what decides is the middle it
   * carries on its corners rather than where each of its pixels happens to
   * fall — judged by the pixel, a site would leave the half of a footprint
   * that its edge crossed.
   *
   * Unlike the fragment's own reading this is not held: the place differs per
   * material, so there is nothing to share between them.
   */
  holdsAt(xz: Node<'vec2'>): Node<'bool'> {
    return this.nearest(xz).x.lessThanEqual(0) as Node<'bool'>
  }

  /** Where the mask now stands. Read every frame by the card; written only here. */
  set(area: MaskArea | null): void {
    const field = area?.field ?? null
    this.picture.value = field?.texture ?? NO_PICTURE
    this.drawnOut.value = field ? 1 : 0
    if (field) {
      // Shared, not copied: a mask that rides the camera writes its corner
      // and every card reading that mask is already pointed at it
      this.origin.value = field.origin
      this.span.value.set(field.spanX, field.spanZ)
      this.band.value = field.band
      this.fadeMost.value = field.fadeMost
    }
    // A mask with no pieces holds nothing; no mask at all holds everything
    this.none.value = area ? NO_MASK : -NO_MASK
  }

  /**
   * The colour the hem goes over to: whatever the scene is backed with, so
   * that what fades reads as the far side of the shape rather than a hole in
   * it. Set where a layer sets its other colours, since that is what this is.
   *
   * Held as the colour the backdrop *draws*, which is the colour as written —
   * that is what `beforeTheCurveOf` in `Viewer` exists to arrange. The mixing
   * is done in that same drawn space; see {@link hem} for why it has to be.
   */
  fadeInto(colour: ColorRepresentation): void {
    this.into.value.set(colour)
  }

  /**
   * The nearest piece to a place on the ground, as how far past its edge the
   * place lies — negative inside, nought on it — and how wide that piece's
   * hem is. The signed distance to a rounded box, less the corner radius, kept
   * against every piece in turn: one shape for both kinds of mask, and no
   * branch in the shader.
   *
   * The hem travels with the distance rather than being a uniform of its own
   * because, though the page gives one width in metres for the whole mask,
   * each piece turns it into world units at its own latitude, so pieces far
   * apart (Tokyo and Okinawa) carry different widths; see {@link Mask.fade}.
   */
  private nearest(xz: Node<'vec2'>): Node<'vec2'> {
    return Fn(() => {
      const best = vec2(this.none, 0).toVar()
      const uv = xz.sub(this.origin).div(this.span).toVar()
      // Off the picture is outside the shape, since the picture is drawn round
      // the whole of it with the band to spare
      const on = this.drawnOut
        .equal(int(1))
        .and(uv.x.greaterThanEqual(float(0)))
        .and(uv.x.lessThanEqual(float(1)))
        .and(uv.y.greaterThanEqual(float(0)))
        .and(uv.y.lessThanEqual(float(1)))
      If(on, () => {
        const held = this.picture.sample(uv)
        best.assign(vec2(held.x.mul(2).sub(1).mul(this.band), held.y.mul(this.fadeMost)))
      })
      return best
    })() as Node<'vec2'>
  }

  /** The reading at the place being drawn, kept so the cut and the hem share it. */
  private here(): Node<'vec2'> {
    return (this.drawn ??= this.nearest(positionWorld.xz as Node<'vec2'>))
  }

  private cut(): Node<'bool'> {
    return (this.test ??= this.cutAt(this.here()))
  }

  /** The same test, off a reading taken somewhere other than the fragment. Not held: the place is the material's. */
  private cutAt(read: Node<'vec2'>): Node<'bool'> {
    return read.x.lessThanEqual(0) as Node<'bool'>
  }

  /**
   * Nought where a thing is still its own colour, one where it has become the
   * backdrop and there is nothing left to draw.
   *
   * Eased rather than run straight across. A straight ramp leaves a kink where
   * the hem begins, and an eye reads a kink in a gradient as a line — which is
   * the edge this was there to do away with.
   *
   * `least` is a width the hem is never narrower than, for a reader of the
   * finished picture: along a clean cut its edge crawls pixel by pixel as the
   * view moves.
   *
   * Cut to the band, because that is as far as the picture can count. The
   * reading saturates at {@link MaskField.band} either side of the edge —
   * six texels of the shape's own size — and deep inside a shape it is `-band`
   * and not the hundreds it really is. Measured against a wider `least`, that
   * saturated value sits partway up the ramp instead of past its foot, so the
   * whole inside of the shape comes back part-faded rather than whole.
   * Measured: the corner shading over `field-map`'s 800m square ran at 23 in
   * the hundred of what the page asked for, everywhere inside it, and over
   * `wards` at 79. What the narrower reading costs is only that the fade
   * happens over the band rather than over the wider ask — a tighter taper at
   * the rim, where before it was a fog over the whole shape.
   *
   * The hem asks for nought and is untouched by this; the band already holds
   * the widest hem any piece wears.
   */
  private faded(edge: Node<'float'>, fade: Node<'float'>, least: Node<'float'>): Node<'float'> {
    const wide = fade.max(least.min(this.band)).max(float(1e-6))
    return smoothstep(wide.negate(), float(0), edge) as Node<'float'>
  }

  /**
   * The colour as it is drawn, taken over to {@link into} through the hem.
   *
   * Laid over the finished colour through `setupOutput`, three's own place for
   * a material to have the last word: fog and premultiplied alpha still come
   * after, and nothing here touches how the colour was arrived at.
   *
   * The depth, the shadows and the look under the pointer never come this
   * way — they draw under stand-ins with no output of their own — so a
   * fragment in the hem still casts, still shades a corner and can still be
   * clicked. It is tinted, not half there.
   *
   * Every material cutting to this mask hems, and the two are the one question
   * asked at two strengths — a cut with no hem is a stair-stepped edge, and a
   * hem with no cut paints a thing over to the backdrop while claiming to have
   * kept it. They were split once, and that second half is what it looked
   * like: walls standing on the line were erased a pixel at a time instead of
   * being left alone.
   */
  private hem(output: Node, near: Node<'vec2'>): Node {
    const over = this.faded(near.x as Node<'float'>, near.y as Node<'float'>, float(0))
    const drawn = output as Node<'vec4'>
    /*
     * Mixed where the eye reads it — through the curve and back again.
     *
     * Everything here is written in the frame's own numbers, which the curve
     * then squeezes into a screen. White is 58.16 of them and the colours under
     * it are around one, so a straight mix between the two is nearly all spent
     * in the part the curve has already flattened: it reaches the backdrop's
     * drawn value in the first few hundredths of the ramp and holds there. The
     * hem then looks a fraction of its width, whatever width it was given.
     *
     * So the two ends are brought to what they *draw*, mixed there, and the
     * answer put back the way it came. A straight line in drawn values is what
     * a fade looks like to a reader, and both ends land where they should: at
     * one the result is the backdrop exactly, at nought it is the colour
     * untouched, and ink that was already written through the curve's inverse
     * goes round the loop and comes out itself.
     *
     * `CLAUDE.md` says of the marks' `dim` that this cannot be done with
     * blending, and that is still true — the blender mixes before the curve and
     * no source value satisfies both ends. Here the output is ours to write, so
     * it can be.
     *
     * Two passes of the curve a fragment, on every material that cuts to a
     * mask. Both are a handful of arithmetic and neither reads anything.
     */
    const asDrawn = neutralToneMapping(drawn.rgb, float(1)) as unknown as Node<'vec3'>
    const wanted = mix(asDrawn, this.into, over) as Node<'vec3'>
    return vec4(beforeTheCurve(wanted), drawn.a) as Node
  }
}
