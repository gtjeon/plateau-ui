import {
  BufferAttribute,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Object3D,
  MeshStandardNodeMaterial,
  SRGBColorSpace,
  Texture,
  type Material,
} from 'three/webgpu'
import {
  cameraProjectionMatrix,
  cameraWorldMatrix,
  float,
  modelWorldMatrixInverse,
  positionLocal,
  screenDPR,
  texture as textureNode,
  vec4,
  viewport,
} from 'three/tsl'
import { marksSolid } from './classify.js'
import { heightsInHand, heightsVersion, type Heights } from './elevation.js'
import { MaskShader, maskHolds } from './mask.js'
import { notPicked, picked } from './pick.js'
import { PICTURE_ONLY, setOccludes } from './passes.js'
import {
  isAnchor,
  offsetOnThing,
  sayIfOnABuilding,
  seatAt,
  worldOf,
  type OffBuildings,
  type Where,
} from './screen.js'
import { metersPerUnit, type WorldBounds } from './geo/mercator.js'
import {
  glows as carriesItsOwnLight,
  keepsItsColor,
  solid as litMaterial,
  type SolidMaterial,
} from './lit.js'
import { beforeTheCurveOf, colourAfterTheCurve, colourAsReflectance } from './tone.js'
import { colorFor, type Palette, type ThemeColor } from './theme.js'
import { DEFAULT_SHAPE_COLOR } from './inks.js'
import { Events, type Anchor, type DragPhase, type Dragging, type Hit, type Position } from './events.js'
import { placeFrom } from './geo/metres.js'
import type { Change, PutsItselfOn, Layer, Stage, Viewer } from './Viewer.js'
import { inStage, outOfStage } from './order.js'

/**
 * What a solid tells the page about.
 *
 * On the solid rather than on the group holding it, the way a model's are: a
 * page that put a block under the map already holds the block, and asking it
 * about its own clicks saves a second table from whatever came back to what
 * it means.
 */
export interface SolidEvents {
  /** This solid was clicked, and where on it. */
  click: {
    readonly solid: Solid
    readonly position: Position
    /**
     * The place clicked, held to the solid: the way from its foot to the
     * click, east, north and up as it faces nought. What a mark that goes with
     * the solid is put at (see {@link Anchor}), and it leads back to the click;
     * `position` is the same place as a spot on the map, which stays there.
     */
    readonly anchor: Extract<Anchor, { readonly solid: Solid }>
    /** Where on the canvas, in pixels of the page from its top left. */
    readonly x: number
    readonly y: number
    readonly original: PointerEvent
  }
  /**
   * The pointer came onto this solid, or left it.
   *
   * Told on the change and not while the pointer travels over one solid.
   * Nothing is drawn or fetched again for it — the viewer is already looking,
   * for the cursor and for the click.
   */
  hover: {
    readonly solid: Solid
    readonly position: Position
  } | null
  /**
   * Taken hold of, carried, let go — the three a map library spells
   * `dragstart`, `drag` and `dragend`, and spelled the same here.
   *
   * Only a solid told {@link SolidOptions.draggable} answers them. **One
   * standing at a place of its own follows the pointer by itself**, as a
   * marker does in Leaflet and in Mapbox and as a mesh does under three's own
   * `DragControls`: by the time `drag` is told, its `at` is already where the
   * hand has carried it. One placed by something else — a model, another
   * solid, the view — answers all three and stays where it is; see
   * {@link SolidOptions.draggable}. A page that wants the carry to mean
   * something else either way — a sun dragged along its own track rather than
   * set down where the pointer is — reads the distance and writes its own
   * answer, which lands on the next frame.
   *
   * What is carried is a distance and not a place; see {@link Dragging}.
   */
  dragstart: { readonly solid: Solid } & Dragging
  drag: { readonly solid: Solid } & Dragging
  dragend: { readonly solid: Solid } & Dragging
}

/** Held for the stretch from metres into the world's units, and thrown away. */
const STRETCH = new Matrix4()

/**
 * How far a solid's fold lines are drawn nearer than the folds they follow, in
 * pixels of the page.
 *
 * A fold lies on the two faces it joins, so a line drawn exactly there is as
 * far off as they are and flickers against them pixel by pixel — which never
 * showed while the lines were only ever drawn with the faces left out, and is
 * the whole picture once a solid is filled and lined at once. Brought forward
 * it clears both. The view is flat-on, so a pixel covers the same stretch of
 * the world anywhere on screen and the lift can be counted in pixels.
 *
 * The same answer and the same two pixels as the city's own fold lines
 * (`buildings/edges.ts`), written again here rather than taken from there,
 * since a layer does not reach into another's constants. Not three's
 * `polygonOffset`, which is the usual word for this: WebGPU takes no depth bias
 * on a line at all.
 */
const LIFT = 2

/**
 * A shape of the page's own standing on the map, or under it; see {@link Solid}.
 *
 * One interface and not two. It stood as a pair while there were four kinds of
 * solid — what they all took, and then the shape itself — and the pair outlived
 * the kinds by a few days: with one kind left, the half that said "whatever its
 * shape" was a shape nobody else had.
 */
export interface SolidOptions {
  /**
   * Whether it carries its own light. `false` by default, so the sun shades
   * it as it shades everything else standing in the city.
   *
   * Said `true`, the colour given is the colour drawn — the same on every
   * face, at every hour, and inside a shadow. What it costs is a second
   * material for the group, woven the first time one of its solids asks.
   *
   * Three has two words that come near this and neither will do here.
   * `material.lights = false` is exactly what this turns (`lit.ts`), but it is
   * read as the shader is woven and the material belongs to the *group* —
   * every solid of one mind shares one, since three weaves a shader per
   * material at about a second each — so a page writing it would turn the
   * light off for its neighbours, and writing it on a material already drawn
   * would turn nothing. `material.emissive` belongs to the material for the
   * same reason, and it *adds* to the lit colour rather than standing in for
   * it: a solid asked to glow would come out brighter than the colour it was
   * given. The city is the one thing in this library that does say it with an
   * emissive, and it can only because it is one material with a table of its
   * buildings behind it (`buildings/styles.ts`); a solid's colour is on its
   * own corners and there is no such table to read.
   */
  readonly glows?: boolean
  /**
   * Whether the shape is filled in. `true` by default.
   *
   * Said `false` with {@link SolidOptions.line}, it is drawn as its fold lines
   * alone: a thing being placed rather than one that is there — showing where
   * something would go as it follows the pointer along a wall, say. Unfilled
   * it takes no light and throws no shadow, since what is not there has
   * neither; three walks past a mesh it does not draw before it asks anything
   * else of it.
   *
   * The same two switches a shape has — `fill` and `line` on a polygon — and
   * deck.gl's `filled` and `wireframe` for the same pair on a solid: one word
   * for each part, so that both can be on. It was one word until 2026-10-27,
   * `outline`, which drew the folds *instead of* the faces and could not say
   * both. And `outline` is kept in this library for one thing only, the line
   * round a building a page has pointed at — CSS's `:focus` ring rather than a
   * drawing of the shape.
   */
  readonly fill?: boolean
  /**
   * What it is painted, where it is {@link SolidOptions.fill}ed: one colour,
   * or a {@link ThemeColor} pair for each of the palette's two sets.
   *
   * Left out, it is the colour the palette gives the ground. One answer and
   * not one per kind: `at` says where a thing goes, and a place is not a
   * colour. A sheet laid over the view took whatever the scene was backed
   * with until 2026-10-09, so that a floor read as the page rather than as a
   * thing laid on it — which is a fair thing for a page to want and not a
   * thing for a word about placing to decide behind its back. The pages that
   * wanted it say it.
   *
   * Not `material.color`, which three does answer. The material is the
   * group's and is shared, so this rides on the corners instead and a page
   * writing the material would paint every solid in the group. And the number
   * does not mean the same thing: what is written here is the colour the solid
   * is to *show* in full daylight, taken back through the frame's tone curve
   * to come out as asked, where `material.color` is a reflectance the light is
   * multiplied over. See `keepsItsColor` in `lit.ts`.
   *
   * A pair is written onto the corners again when the sun crosses the horizon
   * and the palette turns over, once and not every frame.
   */
  readonly fillColor?: ThemeColor
  /**
   * How much of the faces goes on, 0 to 1. One by default — the solid stands
   * as it always has. Held between the two.
   *
   * The name the shapes give the same thing (`PolygonOptions.fillOpacity`),
   * and Leaflet's and Mapbox's before them: the part's name and `Opacity`
   * after it. Not three's `material.opacity`, for the reason `fillColor` is
   * not `material.color`: the material is the group's, so this rides on the
   * corners beside the colour.
   *
   * **Below one it is see-through in three's own way**: the solid wears a
   * material three draws in its transparent half, after everything opaque,
   * blended over what is behind it. What three does there it does here, and
   * nothing more. It still writes depth, as three's transparent materials do
   * by default, so a see-through solid hides what is drawn after it behind
   * it — the transparent things, the building's fold lines among them — and
   * its own far faces are not drawn (it is one-sided). It still throws the
   * sun's whole shadow and is still found by the pointer: those are
   * {@link SolidOptions.castShadow} and {@link SolidOptions.pickable}, and a
   * sheet of water over a flooded street says `false` to both.
   *
   * Changed at any time. Crossing one puts it on the other material, which is
   * woven the first time any solid of its mind asks; a value either side of
   * it is written on the corners and weaves nothing.
   *
   * Its colour goes in held to reflectance one where it is blended, lit or
   * not: three blends before the frame's tone curve, and the bare inverse of a
   * light colour would take the sum at any opacity (`tone.ts`,
   * `asReflectance`). So a see-through solid that glows is drawn no brighter
   * than `#f0f0f0`, as a lit one already is.
   */
  readonly fillOpacity?: number
  /**
   * Drawn at all. `true` by default.
   *
   * What is put away this way is kept as it was cut, so it comes back the
   * moment it is asked for — there is nothing to build again and nothing to
   * fetch. It is out of the shadows and out of the shading's reading while it
   * is away, as anything not drawn is — three walks past what is invisible
   * before it reads anything else off it.
   *
   * Which is three's own `Object3D.visible`, and this is kept because it is
   * not that: the mask writes the same flag, so one of these dropped whole is
   * taken out of the picture without the page having asked for it. What is
   * drawn is the two answers together, and this is the page's half; see
   * {@link Solid.visible}.
   */
  readonly visible?: boolean
  /**
   * Whether the viewer's mask reaches it. `true` by default, as it is for
   * everything else a page puts in the city — a mark, a label, a shape, a
   * model. What the mask leaves out is left out.
   *
   * Said `false` by a page standing its map on something: a plinth is the
   * piece the city was cut *from*, and one cut to the same circle as the mask
   * would have its own wall fall exactly on the edge that cuts it.
   *
   * What happens when the mask does reach it is the kind's to say, not the
   * page's: a sheet is cut where the edge runs through it, since it ends where
   * it ends, and anything standing is kept or dropped whole, since a post
   * sliced down its middle reads as damage rather than as an edge.
   *
   * Nothing in three says this. The nearest is `clippingPlanes`, which cuts
   * against a flat plane and however many of them a page cares to list; a mask
   * here is a shape the page drew — a ring, a circle, a polygon with a hole in
   * it — baked to a grid and read a pixel at a time (`mask.ts`). It is a fact
   * about the map rather than about the mesh, which is why the library keeps
   * the word.
   */
  readonly masked?: boolean
  /**
   * Whether its fold lines are drawn. `false` by default.
   *
   * Over the faces where it is {@link SolidOptions.fill}ed too, drawn a hair
   * nearer the eye than the folds they follow so that the faces meeting there
   * do not flicker through them; alone, with `fill: false`, it is the drawing
   * of a thing being placed.
   *
   * Cut from the same numbers as the faces, so the lines are exactly the thing
   * that would stand there. Ink rather than a surface: they keep the colour
   * they are given at every hour, in shadow and out of it, and are drawn over
   * the shading of corners rather than under it, as every other line in this
   * library is. They throw nothing, whatever {@link SolidOptions.castShadow}
   * says — a line has no surface for the sun to stop on.
   *
   * One device pixel wide, which is what WebGPU draws a line as, so there is
   * no width to give.
   *
   * Not `material.wireframe`, which three does answer and which draws a
   * different picture: wireframe draws the edges of every triangle, so the
   * diagonal across each quad of a block's side comes with them. These are the
   * folds alone, taken with `EdgesGeometry` off the shape that was just cut.
   */
  readonly line?: boolean
  /**
   * What its fold lines are drawn in: one colour, or a {@link ThemeColor} pair.
   *
   * Left out, the shapes' own ink (`DEFAULT_SHAPE_COLOR`), which is what a
   * line a page puts on the map is drawn in where it says nothing. It was the
   * solid's own colour until 2026-10-27, which was right while the lines were
   * drawn instead of the faces and is no use once they are drawn over them: a
   * line the colour of the face it lies on is not there.
   */
  readonly lineColor?: ThemeColor
  /**
   * How much of its fold lines goes on, 0 to 1. One by default, held between
   * the two.
   *
   * The shapes' name for their lines (`PolylineOptions.lineOpacity`), and
   * Mapbox's `line-opacity` and Leaflet's stroke `opacity` before them. Below
   * one the lines are drawn in three's transparent half of the pass they are
   * drawn in, and their ink is held to reflectance one there, since a blender
   * mixes it before the tone curve and the bare inverse would take the sum (a
   * white line would draw as white at any opacity). So a see-through line
   * drawn white is drawn no brighter than `#f0f0f0`.
   */
  readonly lineOpacity?: number
  /**
   * Whether it throws the sun's shadow. `true` by default, as everything
   * standing in the city does.
   *
   * Three's own word, meaning what it means in three, and read the way three
   * reads it — the sun's map asks every mesh it draws for this flag
   * (`offscreen.ts`'s `drawCasters`). It is written here rather than on the
   * mesh because the mesh is the library's, and is not handed to the page.
   *
   * Taking is left on, whatever this says. A solid that throws nothing is
   * still lit, and the city's shadow still falls across it.
   *
   * What says `false` is anything a page stands *for* something rather than
   * puts somewhere — a place, a reading, the sun itself. A thing standing for
   * the sun must not throw a shadow: it is on the line between the sun and
   * whatever the sun is lighting, so its shadow lands on exactly what the page
   * is asking about. Such a thing wants {@link SolidOptions.occludes} off too,
   * for the same reason.
   */
  readonly castShadow?: boolean
  /**
   * Whether it takes part in the shading of corners. `true` by default.
   *
   * Said `false`, it neither darkens the corners it stands in nor is darkened
   * by the corners round it. The city still hides it — it is drawn into the
   * same depth, so a building in front of it is in front of it — and the sun
   * still lights it and still throws its shadow, which is
   * {@link SolidOptions.castShadow}'s to say and not this.
   *
   * A verb, as `glows` is: three has no word for this effect, since the
   * shading is the viewer's (`viewer.occlusion`) and not three's.
   *
   * Until 2026-10-27 the two were one word, `shadow`, which put the solid on
   * the layer the lines and the marks are drawn on and so took it out of both
   * at once. A page could not keep the sun's shadow and drop the shade.
   */
  readonly occludes?: boolean
  /**
   * Whether the pointer finds it. `true` by default, as for a shape, a model
   * and a mark.
   *
   * What is found is what is drawn: the faces where it is filled, the fold
   * lines where it is lined, both where it is both. A solid drawn as its lines
   * alone is found on its lines and nowhere between them, as an unfilled
   * polygon is in every map library.
   *
   * Three's own `Raycaster` asks three's questions and no others: it tests
   * layer 0 and not whether a thing is drawn, so it finds the faces even
   * unfilled, as it would any hidden mesh, and never the lines, which are on
   * the layer the marks are drawn on.
   *
   * Said `false`, the pointer goes through to whatever is behind, and so does
   * that `Raycaster` (`notPicked`). What asks is a preview: a solid
   * following the pointer along the very wall it is previewing would
   * otherwise be what the pointer kept finding. Until 2026-10-27 that was
   * decided for the page by drawing the lines alone; it is the page's switch
   * now, because a preview is not the only thing drawn that way.
   */
  readonly pickable?: boolean
  /**
   * Whether {@link SolidOptions.height} is counted from the land under it
   * or from the map's own nought. On the land by default, as everything else
   * a page puts in the city is — a mark, a label, a model, a building.
   *
   * Only ever a question where the viewer is reading the land at all; see the
   * `elevation` of a viewer's ground. Where it is not, every height is counted
   * from nought and this changes nothing.
   *
   * Said `false` by a page that means a height above the sea rather than above
   * the pavement — a flood line, a flight path, a plane for a map to stand on
   * — since a thing meant to lie level would otherwise ride up over the hills.
   *
   * Nothing in three says this either, and nothing could: it is about the land
   * this library fetches, and a height counted from the land is a number that
   * is not known until the tile under the thing has landed. `position.y` is
   * where the solid ends up; this is which nought that y was measured from.
   */
  readonly grounded?: boolean
  /**
   * Whether the pointer may take hold of it and carry it. `false` by default.
   *
   * The word every other map library uses for this, and used here for the same
   * reason {@link pickable} is not worked out from whether anyone is
   * listening: what is being asked is whether this thing takes the press, not
   * whether somebody wanted to hear about it. A solid that is carried takes
   * the press away from the map, so a page that left it to a listener would
   * find the map stop moving under a solid it only meant to watch.
   *
   * Carried, it follows the pointer by itself and its {@link Solid.at} is
   * written as it goes — so long as its place is its own. One standing on a
   * model or on another solid, or laid to the view, is placed by what it is on;
   * those tell the page and stay where they are. A page that wants one
   * of them to move reads the distance and writes whatever that means for it.
   */
  readonly draggable?: boolean

  /**
   * The shape, in metres, cut about the point it is stood at.
   *
   * A page's own, and kept as handed over — not copied, not cut again. What
   * three draws is what was built, so the corner count, the facings and the
   * folds are the page's to decide; `three` has a shape for most things a map
   * wants and a page that wants another has a modeller.
   *
   * Metres, because that is what every length in here is: the stretch that
   * turns them into the world's units is carried on the mesh where it is put
   * down, so a shape is its own size wherever on the map it ends up.
   *
   * Its colours are this library's. A `color` attribute is laid on it and
   * written from {@link SolidOptions.fillColor} or the palette, since every
   * solid of one mind shares one material and a colour on the material would
   * be a colour for all of them. One already there is written over.
   *
   * And it stays the page's to dispose, as a `Texture` handed to
   * {@link SolidOptions.image} does: the same shape may stand in two solids,
   * or be kept to stand again, so nothing here frees it.
   */
  readonly geometry: BufferGeometry
  /**
   * Where it stands: a spot on the map, or a place on a model or another solid
   * that goes wherever that goes; see {@link Where}. Or `'view'`.
   *
   * Never on a building ({@link OffBuildings}). What is to go with a building
   * is a mark; a solid stood where a building is stands on the map beside it.
   * _(2026-11-05, the user's call. It could be held to one, and rode it.)_
   *
   * `'view'` lays it over whatever the view covers, afresh every frame, which
   * is what a page standing its map on something wants: a floor under the
   * city reaches the edge of the screen wherever the screen has gone. The
   * shape is stretched by its own extent in x and z, so a square of any size
   * does for one — and a shape with height in it is stretched flat, which is
   * why the thing that wants this is a sheet.
   *
   * The word is the mask's (`ViewerOptions.mask`), and means there what it
   * means here: as far as the screen reaches.
   */
  readonly at: OffBuildings | 'view'
  /** How far its foot is lifted off whatever it stands on, in metres. */
  readonly height?: number
  /**
   * Which way its front looks: degrees, 0 north, as {@link Camera.heading} is.
   *
   * The front is the way the shape was cut facing, which for everything three
   * cuts standing up is its own +Z — so a shape left at nought looks north.
   * Its own wherever it stands, on a model as well: a place says where and
   * nothing about which way, so a board stood at a click on a wall is turned
   * to face out of it by the `facing` the click told.
   */
  readonly facing?: number
  /**
   * A picture to draw it in, in place of a colour.
   *
   * Laid on by the shape's own texture coordinates, so what it lands on is
   * the page's to decide: `three`'s plane carries nought to one across its
   * face and shows the whole picture, and its box carries the same on all six
   * and shows it six times. A sign is a plane.
   *
   * **A solid given one wears a material of its own**, where the rest share
   * the group's: no two pictures are one picture, and there is nothing for a
   * shared material to do. Three weaves a shader per material at about a
   * second apiece, so this is a handful of signs and not a city of them.
   *
   * Whether it is lit is {@link SolidOptions.glows}, as for a colour: one
   * that carries its own light keeps its picture at every hour, and one that
   * does not takes the light the wall it hangs on takes — its picture being
   * the picture in full daylight. It stands in for
   * {@link SolidOptions.fillColor}, and is drawn only where the solid is
   * filled.
   *
   * A canvas or an image is made into a texture here and let go of with the
   * solid, or when another picture takes its place; a `Texture` handed in
   * whole is the page's to dispose.
   *
   * Written again at any time, and left out to go back to the colour. The
   * same canvas written again says it has been drawn on, and is sent to the
   * card afresh — three's `texture.needsUpdate`, said for a texture the page
   * never held.
   */
  readonly image?: HTMLCanvasElement | HTMLImageElement | Texture
}

/**
 * A shape a page cut itself, standing in the map's own light.
 *
 * What this is for is not the shape — `three` cuts a sphere and a cylinder
 * better than this file does — but everything a shape in here has to obey and a
 * bare mesh does not: the one light every solid reads (`lit.ts`, where the
 * dielectric floor `three` lays under every standard material is taken back
 * off), the mask that cuts the viewer to a shape, the palette that moves when
 * the sun goes down, and the tone curve a page's own colour has to be walked
 * backwards through to come out as the colour it asked for. A page that built
 * its own mesh would have to find all four.
 *
 * So this is the door: hand over a shape and it stands like everything else.
 *
 * **One class and not two.** There were five kinds of solid once, then one, and
 * the abstract parent they shared outlived them — a family of one, with the
 * family's own name on it and `override` on a third of what is below. An
 * ancestor nobody else inherits is not a design, and a page reading
 * `new Solid(...)` was handed events and options spelled for a word that no
 * longer named anything. Grown back apart, the parent comes back with it.
 */
export class Solid implements PutsItselfOn {
  private readonly events = new Events<SolidEvents>()

  /** Listens for this solid being clicked or pointed at. Hands back the way to stop. */
  on<K extends keyof SolidEvents>(type: K, listener: (event: SolidEvents[K]) => void): () => void {
    return this.events.on(type, listener)
  }

  off<K extends keyof SolidEvents>(type: K, listener: (event: SolidEvents[K]) => void): void {
    this.events.off(type, listener)
  }

  /** @internal Whether anyone is listening, so the group can tell the viewer whether to look. */
  listens(type: keyof SolidEvents): boolean {
    return this.events.has(type)
  }

  /** @internal Told by the group that holds it, which is the one the viewer speaks to. */
  clicked(hit: Hit, viewer: Viewer | null): void {
    const { position, x, y, original } = hit
    const offset = offsetOnThing(this, hit.point, viewer)
    const anchor = offset ? { solid: this, offset } : { solid: this }
    this.events.emit('click', { solid: this, position, anchor, x, y, original })
  }

  /** @internal Told by the group, the same way as {@link clicked}. */
  hovered(hit: Hit | null): void {
    this.events.emit('hover', hit ? { solid: this, position: hit.position } : null)
  }

  /**
   * @internal Told by the group at each end of a carry and at every move
   * between.
   *
   * The place it was taken hold of is kept here rather than counted up as it
   * goes, since {@link Dragging} counts from there too: adding frame to frame
   * would drift, and a solid whose `at` a page wrote in the middle of a carry
   * would fight the hand instead of being moved by it.
   *
   * It moves itself, which is what every other map library does with a
   * draggable marker — so long as the place is its own to move. Two of the
   * ways its place can be written are not: a solid on a model or on another
   * solid is placed by what it is on. One laid to the view is not
   * either — it has no place at all, {@link lay} putting it over the screen
   * every frame, and the pair its `_at` holds is the initialiser nobody reads.
   * All of those answer the events and stay where they are.
   *
   * The two that do move are the two spellings of a place on the map, and the
   * one it was written in is the one it is written back in: `[lng, lat]` stays
   * a pair, and `{ lng, lat, height }` keeps the height it was given.
   */
  carried(drag: Dragging, phase: DragPhase): void {
    if (phase === 'start') this.tookFrom = this.placeItHolds()
    const from = this.tookFrom
    if (from) {
      const [lng, lat] = placeFrom(from, drag.east, drag.north)
      const now = this.placeItHolds()
      // Only where the place actually changes. A press that never wandered
      // asks for the place it already has — `placeFrom` hands back its own
      // two numbers for a distance of nought — and writing it all the same
      // would restand the solid and have the sun's map drawn again, twice,
      // for every click on a thing a page merely said may be carried. A carry
      // that comes back to exactly where it began still writes, since by then
      // the place it holds is the one the last move left.
      if (!now || now[0] !== lng || now[1] !== lat) {
        // Through the setter, which is the one hand that writes a place, and
        // in the spelling the page used — so a height written beside the
        // place survives being carried
        this.at = Array.isArray(this._at) ? [lng, lat] : { ...(this._at as object), lng, lat }
      }
    }
    if (phase === 'end') this.tookFrom = null
    this.events.emit(phase === 'start' ? 'dragstart' : phase === 'end' ? 'dragend' : 'drag', {
      solid: this,
      ...drag,
    })
  }

  /**
   * The place it stands at where that place is its own, and nothing where
   * something else puts it; see {@link carried}.
   *
   * The same two words the rest of the class tells those apart by —
   * {@link riding} asks `isAnchor` and {@link sheet} asks `toView` — so
   * that one answer cannot drift from the other. Asking `Array.isArray` alone,
   * which is what this was, said yes to a sheet laid to the view (its `_at` is
   * the pair it was initialised with and never reads) and no to
   * `{ lng, lat, height }`, which is the very case the carry was written for.
   */
  private placeItHolds(): readonly [number, number] | null {
    if (this.toView || isAnchor(this._at)) return null
    if (Array.isArray(this._at)) return [this._at[0], this._at[1]]
    const place = this._at as { readonly lng: number; readonly lat: number }
    return [place.lng, place.lat]
  }

  /**
   * @internal What goes into the scene.
   *
   * A group and not the shape itself, because what is drawn is not always the
   * shape: a solid lined as well as filled draws its folds beside its faces,
   * and one lined alone draws the folds instead. The group is what the layer
   * holds on to, and it stays the same whatever is inside it.
   */
  readonly root = new Group()

  /**
   * The shape, as three draws it. The group gives it its material.
   *
   * The same mesh for as long as the solid lives, whatever the page turns: the
   * viewer keeps the hit a carry began on and hands it back at every step, and
   * a mesh made again under it would leave the carry holding one nothing draws
   * — which is how {@link pickable} once ended a carry it was turned during.
   */
  private readonly body = new Mesh(new BufferGeometry())

  /** @internal The shape, as three draws it; see {@link body}. */
  get mesh(): Mesh {
    return this.body
  }

  /** Its fold lines, cut from the shape where the page asked for them. */
  private edges: LineSegments<BufferGeometry, LineBasicNodeMaterial> | null = null
  /**
   * The shape those edges were taken off, and the colour they were made in.
   *
   * What says they are still good. The shape is kept by identity rather than
   * by a flag because a shape cut again is a new one, which is exactly the
   * moment the edges stop being the edges of anything.
   */
  private tracedFrom: BufferGeometry | null = null
  private tracedInk = -1
  /** How much of the line went on as they were last coloured; see {@link tracedInk}. */
  private tracedShows = -1

  /**
   * @internal Cuts the shape, and then its fold lines where the page asked for
   * them.
   *
   * The lines come off the shape that was just cut, so they are exactly the
   * thing that stands there — not a second set of numbers that could drift
   * from the first.
   *
   * `night` is which of a {@link ThemeColor} pair's two stands, which the
   * palette handed in has already been settled by; the page's own colours are
   * settled here, by the same answer.
   *
   * `folds` hands over the group's material for lines — the opaque one, or
   * the see-through one where it is asked for that — made the first time each
   * is asked for; see `SolidLayer`'s `folds`.
   */
  shape(palette: Palette, night: boolean, folds: (seeThrough: boolean) => LineBasicNodeMaterial): void {
    this.build(palette, night)
    this.trace(night, folds)
  }

  /**
   * The fold lines, made, recoloured or taken away.
   *
   * Drawn in the group's one material for lines and coloured on their own
   * corners, as the faces are: three weaves a shader per material, and a
   * solid lined as well as filled is not a thing a page places one at a time
   * the way a preview was. {@link EdgesGeometry} keeps only the corners'
   * places — the colours on the shape do not come across, and would be the
   * faces' colours if they did — so the lines are given a colour attribute of
   * their own as they are cut, before anything draws them; a material told to
   * read one is woven to read it only where it is already there.
   */
  private trace(night: boolean, folds: (seeThrough: boolean) => LineBasicNodeMaterial): void {
    if (!this._line) {
      this.untrace()
      return
    }
    const seeThrough = this._lineOpacity < 1
    if (!this.edges || this.tracedFrom !== this.body.geometry) {
      this.untrace()
      const geometry = new EdgesGeometry(this.body.geometry)
      const corners = geometry.attributes['position']?.count ?? 0
      // Four a corner, the fourth how much of the line goes on: three reads a
      // colour attribute of four as colour and alpha (`vertexColor`), and an
      // opaque material leaves the alpha at one whatever it says
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(corners * 4), 4))
      const line = new LineSegments(geometry, folds(seeThrough))
      // With the other lines and the marks: ink is drawn over the shading of
      // corners rather than under it, so a line keeps the colour it is given,
      // and a line has no surface for the sun or the shading to read
      line.layers.set(PICTURE_ONLY)
      if (!this._pickable) notPicked(line)
      // A sheet is laid to the view by moving its mesh and not the group; see
      // `lay`, which keeps the two together from then on
      if (this.toView) {
        line.frustumCulled = false
        line.position.copy(this.body.position)
        line.scale.copy(this.body.scale)
      }
      this.edges = line
      this.tracedFrom = this.body.geometry
      this.tracedInk = -1
      this.tracedShows = -1
      this.root.add(line)
    }
    // The opaque material or the see-through one, which is a choice of mesh
    // material and weaves nothing once both are made: the lines are a mesh of
    // their own, so they move between the two as the page turns the opacity
    const wears = folds(seeThrough)
    if (this.edges.material !== wears) this.edges.material = wears
    const asked = new Color(colorFor(this._lineColor, night))
    // Nothing to do where nothing it reads has changed. It is asked whenever
    // anything in the group wants cutting — another solid's colour, another
    // solid's lines, the palette turning over — and without this every solid
    // would send the corners of its lines to the card again for a change that
    // was somebody else's.
    const hex = asked.getHex()
    if (hex === this.tracedInk && this._lineOpacity === this.tracedShows) return
    this.tracedInk = hex
    this.tracedShows = this._lineOpacity
    // Ink, not a surface: it keeps the colour it is given, so it reads no light
    // and is written past the frame's tone curve (`tone.ts`). Held to one where
    // it is blended, since a blender mixes before that curve and the bare
    // inverse of a light colour takes the sum at any opacity
    const ink = seeThrough ? colourAsReflectance(asked) : beforeTheCurveOf(asked)
    const colors = this.edges.geometry.attributes['color'] as BufferAttribute
    const array = colors.array as Float32Array
    for (let v = 0; v < colors.count; v++) {
      array[v * 4] = ink.r
      array[v * 4 + 1] = ink.g
      array[v * 4 + 2] = ink.b
      array[v * 4 + 3] = this._lineOpacity
    }
    colors.needsUpdate = true
  }

  /**
   * Takes the fold lines away, and their corners with them.
   *
   * Not the material, which is the group's and outlives every line drawn in it.
   */
  private untrace(): void {
    if (!this.edges) return
    this.root.remove(this.edges)
    this.edges.geometry.dispose()
    this.edges = null
    this.tracedFrom = null
    this.tracedInk = -1
    this.tracedShows = -1
  }

  /**
   * The colour the page gave, or the ground's, which is what a solid standing
   * on the map reads as — settled for whichever of the two sets stands.
   *
   * The ground's is a reflectance and the page's is the colour full daylight
   * shows, and the corners carry one door for both (`keepsItsColor`, which
   * walks the curve back). So the ground's goes in already walked forward, and
   * comes out of that door as the reflectance the ground has. Put in as it
   * was, it was walked back a second time: a solid of the ground's colour
   * stood at night as `#393c3e` on a ground of `#1b1f25`, and lit itself, by
   * day, brighter than the ground in full sun.
   */
  private ink(palette: Palette, night: boolean): Color {
    if (this._fillColor !== undefined) return new Color(colorFor(this._fillColor, night))
    return colourAfterTheCurve(new Color(palette.surface))
  }

  private _glows: boolean
  private _visible: boolean
  /** @internal Held out of the picture until its group has woven it; see `SolidLayer.weaveIn`. */
  unwoven = false
  /** @internal Which weaving of it is the latest, so that an older one ending late shows nothing. */
  weavings = 0
  private _masked: boolean
  private _fill: boolean
  private _fillColor: ThemeColor | undefined
  private _fillOpacity: number
  private _line: boolean
  private _lineColor: ThemeColor
  private _lineOpacity: number
  private _castShadow: boolean
  private _occludes: boolean
  private _pickable: boolean
  private owner: SolidLayer | null = null
  private _grounded: boolean
  private _draggable: boolean
  /** Where it stood when the hand took hold of it; see {@link carried}. */
  private tookFrom: readonly [number, number] | null = null
  /**
   * Where it stands.
   *
   * The pair is an initialiser and not a place: one laid to the view stands
   * nowhere of its own and never reads this, so nothing may take the pair for
   * a page having said [0, 0] — see {@link placeItHolds}, which is where that
   * once went wrong.
   */
  private _at: OffBuildings = [0, 0]
  /** Where it ended up, in world units, for the mask to judge it by. */
  private seated: readonly [number, number] | null = null

  /** Whether the pointer may carry it; see {@link SolidOptions.draggable}. */
  get draggable(): boolean {
    return this._draggable
  }

  set draggable(value: boolean) {
    this._draggable = value
  }

  /** Whether the shape is filled in; see {@link SolidOptions.fill}. */
  get fill(): boolean {
    return this._fill
  }

  set fill(value: boolean) {
    if (this._fill === value) return
    this._fill = value
    // Nothing to cut: the corners are the same whether or not they are drawn.
    // Only whether three draws them, and so whether the sun's map, which
    // walks past what is not drawn, has a shape here to keep.
    this.body.visible = value
    this.owner?.stir()
  }

  /**
   * What the shape is painted, where the page gave a colour, and nothing where
   * it did not — the ground's colour is not a value of the solid's to read
   * back, since it moves with the palette; see {@link SolidOptions.fillColor}.
   */
  get fillColor(): ThemeColor | undefined {
    return this._fillColor
  }

  set fillColor(value: ThemeColor | undefined) {
    // Guarded like the other words, so that a page writing the colour it
    // already has does not cut every shape in the group again. What a page
    // hands in is what it handed in — two `new Color()` of the same colour, or
    // two pairs written out twice, are two objects and are taken as a change,
    // which is the page's own doing.
    if (this._fillColor === value) return
    this._fillColor = value
    this.owner?.recut()
  }

  /** How much of the faces goes on, held between 0 and 1; see {@link SolidOptions.fillOpacity}. */
  get fillOpacity(): number {
    return this._fillOpacity
  }

  set fillOpacity(value: number) {
    const held = unit(value)
    if (this._fillOpacity === held) return
    const was = this.seeThrough
    this._fillOpacity = held
    if (this.picture) {
      // A picture's material is its own, so the opacity is its own too and is
      // three's: written there, it weaves nothing. Crossing one is another
      // material, as `glows` is
      if (this.seeThrough !== was) this.rewoven()
      else (this.body.material as Material).opacity = held
      return
    }
    // The group's: crossing one is the other of its materials, and either way
    // the corners carry how much goes on
    if (this.seeThrough !== was) this.owner?.redress(this)
    this.owner?.recut()
  }

  /**
   * @internal Whether its faces are drawn see-through, which is which of the
   * group's materials it wears; see {@link SolidOptions.fillOpacity}.
   */
  get seeThrough(): boolean {
    return this._fillOpacity < 1
  }

  /** Whether its fold lines are drawn; see {@link SolidOptions.line}. */
  get line(): boolean {
    return this._line
  }

  set line(value: boolean) {
    if (this._line === value) return
    this._line = value
    this.owner?.recut()
  }

  /**
   * What its fold lines are drawn in — the shapes' own ink where the page
   * said nothing, which is a value and so is what reads back; see
   * {@link SolidOptions.lineColor}.
   *
   * Written `undefined`, it goes back to that ink.
   */
  get lineColor(): ThemeColor {
    return this._lineColor
  }

  set lineColor(value: ThemeColor | undefined) {
    const next = value ?? DEFAULT_SHAPE_COLOR
    if (this._lineColor === next) return
    this._lineColor = next
    this.owner?.recut()
  }

  /** How much of its fold lines goes on, held between 0 and 1; see {@link SolidOptions.lineOpacity}. */
  get lineOpacity(): number {
    return this._lineOpacity
  }

  set lineOpacity(value: number) {
    const held = unit(value)
    if (this._lineOpacity === held) return
    this._lineOpacity = held
    this.owner?.recut()
  }

  /**
   * Whether it throws the sun's shadow; see {@link SolidOptions.castShadow}.
   *
   * Three's own flag on the mesh is where it is read, and this is where it is
   * kept: the mesh is the library's, and is not handed to the page.
   */
  get castShadow(): boolean {
    return this._castShadow
  }

  set castShadow(value: boolean) {
    if (this._castShadow === value) return
    this._castShadow = value
    this.body.castShadow = value
    // The sun's map is kept from frame to frame, and it holds this solid's
    // shadow or its absence as it was last drawn; see `Viewer.stirShadows`
    this.owner?.stir()
  }

  /** Whether it takes part in the shading of corners; see {@link SolidOptions.occludes}. */
  get occludes(): boolean {
    return this._occludes
  }

  set occludes(value: boolean) {
    if (this._occludes === value) return
    this._occludes = value
    // On the mesh and not on the lines, which never took part: they are on the
    // lines' own layer and are drawn over the shading whatever this says.
    // Nothing to tell anyone either. The shading is measured afresh every
    // frame, and the sun's map, which is kept, does not read this word — it
    // reads `castShadow` (`passes.ts`)
    setOccludes(this.body, value)
  }

  /** Whether the pointer finds it; see {@link SolidOptions.pickable}. */
  get pickable(): boolean {
    return this._pickable
  }

  set pickable(value: boolean) {
    if (this._pickable === value) return
    this._pickable = value
    // Said on the mesh and the lines there are, and not by making them again:
    // a carry holds the hit it began on, and a page turning this off in its
    // `dragstart` — so the hover can find the wall under the solid it carries
    // — would otherwise have handed the carry a mesh nothing draws, and the
    // solid would stop following with no `drag` or `dragend` to say so. Lines
    // cut later are told as they are cut (`trace`)
    const say = value ? picked : notPicked
    say(this.body)
    if (this.edges) say(this.edges)
  }

  /** Whether its height is counted from the land; see {@link SolidOptions.grounded}. */
  get grounded(): boolean {
    return this._grounded
  }

  set grounded(value: boolean) {
    if (this._grounded === value) return
    this._grounded = value
    this.owner?.restand()
  }

  /**
   * @internal Whether the mask cuts it where its edge runs through, or keeps
   * it or drops it whole.
   *
   * A sheet is cut: it ends where it ends, and a page laying one over a site
   * wants it to stop at the site's edge. Anything standing is not — a post
   * sliced down its middle reads as damage — so the whole of it is kept or
   * dropped by where it stands. Said by the kind rather than by the page: the
   * city answers the same question the same way, and a building the line runs
   * through is left out rather than cut down the face of a wall.
   *
   * Cutting a sheet wants the mask woven into the material it is drawn with,
   * which is why a cut sheet wears a material of its own: what the mask keeps
   * or drops whole must not be drawn through that cut.
   *
   * Which it is here is where it was stood: one following the view is a sheet,
   * and one standing at a place of its own is not — the mask takes a thing by
   * where it stands, and half a cylinder is damage rather than an edge.
   */
  get sheet(): boolean {
    return this.toView
  }

  /** Whether it carries its own light; see {@link SolidOptions.glows}. */
  get glows(): boolean {
    return this._glows
  }

  set glows(value: boolean) {
    if (this._glows === value) return
    this._glows = value
    this.rewoven()
    this.owner?.redress(this)
  }

  /**
   * The light a material is woven for has been written, so a picture, which
   * wove its own, has to weave it again.
   *
   * Glow is read as a material is made, and three settles a shader before the
   * material carrying it is first drawn — so changing it is not a value to
   * write but a material to make afresh. For every solid without a picture
   * that is the group's to do, which keeps one material for each mind and
   * hands over the other (`redress`); a picture weaves its own and reads
   * `glows` as it does, so writing that word afterwards left the getter saying
   * one thing and the picture taking the sun as before.
   *
   * The colours and the lines are not among what a material is woven by: the
   * colours ride on the corners and the lines are a mesh of their own, so
   * writing either is cut rather than woven.
   *
   * Whether it is see-through is, the same way: three settles a material's
   * half of the pass and its blending as the shader is woven (and this
   * library's `SolidMaterial` holds a blended colour to one there).
   */
  private rewoven(): void {
    if (!this.picture || (this.litBy === this.glows && this.seenThroughBy === this.seeThrough)) return
    ;(this.body.material as Material).dispose()
    this.dressPicture()
  }

  /**
   * Drawn at all; see {@link SolidOptions.visible}.
   *
   * What the page said, not what the mesh is doing. Where the mask drops one
   * of these whole it takes the mesh out of the picture without the page
   * having asked, and a reading that came off the mesh would answer the
   * mask's question instead of the page's.
   */
  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    if (this._visible === value) return
    this._visible = value
    // Nothing about the shape or its colours has changed, so there is nothing
    // to cut and nothing to lay — only whether the mask still gets a say
    this.showing(this.owner?.maskKeeps(this) ?? true)
    // But what the sun sees has: hidden on a still view, its shadow stayed
    // printed on the ground until something else had the map drawn again
    this.owner?.stir()
  }

  /** Whether the viewer's mask reaches it; see {@link SolidOptions.masked}. */
  get masked(): boolean {
    return this._masked
  }

  set masked(value: boolean) {
    if (this._masked === value) return
    this._masked = value
    this.owner?.redress(this)
    this.showing(this.owner?.maskKeeps(this) ?? true)
    // Kept or dropped by the mask now, so cast or not; see `visible`
    this.owner?.stir()
  }

  /** @internal The mask's answer, put together with the page's own. */
  showing(kept: boolean): void {
    this.root.visible = this._visible && kept && !this.unwoven
  }

  /**
   * Where it stands; see {@link SolidOptions.at}.
   */
  get at(): OffBuildings | 'view' {
    return this.toView ? 'view' : this._at
  }

  /**
   * A place, or `'view'` to lay it over what is in view, as the option takes
   * (rule 2). A sheet read back `[0, 0]`, a place it never stood at, and a
   * place written on one was kept and went nowhere.
   */
  set at(value: OffBuildings | 'view') {
    sayIfOnABuilding(value, 'Solid')
    const toView = value === 'view'
    if (toView !== this.toView) this.becomeSheet(toView)
    if (!toView) this._at = value
    this.owner?.restand()
  }

  /**
   * Turns it from a thing standing at a place into a sheet laid over the
   * view, or back. What the two differ in is undone and done again here: where
   * the group stands (a sheet is laid by its mesh, a place by its group), the
   * box three culls it by, the lines that follow the mesh, and whether the
   * mask's cut is woven into what draws it.
   */
  private becomeSheet(toView: boolean): void {
    this.toView = toView
    this.body.frustumCulled = !toView
    if (toView) {
      this.seated = null
      this.root.matrixAutoUpdate = true
      this.root.position.set(0, 0, 0)
      this.root.quaternion.identity()
      this.root.scale.set(1, 1, 1)
    } else {
      this.body.position.set(0, 0, 0)
      this.body.scale.set(1, 1, 1)
    }
    this.untrace()
    this.owner?.recut()
    this.owner?.redress(this)
    this.owner?.relay()
    this.showing(this.owner?.maskKeeps(this) ?? true)
  }

  /** @internal Where it ended up in the world, for a mask that keeps or drops it whole. */
  get stands(): readonly [number, number] | null {
    return this.seated
  }

  /** @internal Whether its place has to be worked out again every frame. */
  get riding(): boolean {
    return isAnchor(this._at)
  }

  /**
   * @internal Works out where it sits and puts it there.
   *
   * The same ways a mark is placed, through the same {@link seatAt}: a place
   * held to a model or a solid, or a spot on the land. One held to a thing
   * that is nowhere yet waits rather than falling to the ground.
   *
   * Asked with no city: a solid stands on no building ({@link OffBuildings}),
   * and one a page put on a building anyway is nowhere and is not drawn,
   * rather than dropped somewhere it was not put.
   *
   * Nothing where it follows the view: it is laid in the world's own units and
   * a seat would move it off the map and scale it twice; see {@link lay}, which
   * is the question it does answer.
   */
  stand(land: Heights | null): void {
    if (this.toView) return
    // Its own lift and not the page's height: how far a thing carries itself
    // over whatever it is put on -- a ball set on a model is up by its own
    // radius wherever the model is
    const seat = seatAt(null, this._grounded ? land : null, this._at, undefined, this._height)
    if (!seat) {
      this.seated = null
      this.root.visible = false
      return
    }
    // Nothing under it moves it but where it was put, so where it belongs and
    // where this frame draws it are one place
    const { x, y, z } = worldOf(seat)
    this.seated = [x, z]
    this.showing(this.owner?.maskKeeps(this) ?? true)
    this.seatedAt(x, y, z, seat.stretch)
  }

  /**
   * @internal Puts itself where the seat worked out, turned the way it faces,
   * and stretched from metres into the world's units.
   *
   * The group and not the shape, because the edges taken off that shape are its
   * sibling and both have to travel together.
   */
  private seatedAt(x: number, y: number, z: number, stretch: number): void {
    // A shape standing up looks along +Z and the world's north is -z, so nought
    // is half a turn; a heading runs clockwise, which a turn about the world's
    // y does not
    this.root.matrixAutoUpdate = false
    this.root.matrix.makeRotationY(Math.PI - ((this._facing ?? 0) * Math.PI) / 180)
    this.root.matrix.premultiply(STRETCH.makeScale(stretch, stretch, stretch))
    this.root.matrix.setPosition(x, y, z)
    this.root.matrixWorldNeedsUpdate = true
  }

  /**
   * @internal Wears the group's own material — its own where it wears a
   * picture, since no two pictures are one picture and a shared material has
   * nothing to do for them; see {@link SolidOptions.image}.
   */
  dress(material: MeshStandardNodeMaterial): void {
    if (this.picture) {
      this.refinish()
      return
    }
    this.body.material = material
  }

  /**
   * Weaves the picture's material again where what the group finishes it
   * with has changed since: the picture thrown over the map, and the mask's
   * cut. The group is asked as often as it dresses, and a picture is a second
   * of the page's time to weave, so it is woven only on a change.
   */
  private refinish(): void {
    const group = this.owner
    const cast = !this.glows && (group?.casts() ?? false)
    const cut = group?.cuts(this) ?? false
    const was = this.finishedBy
    if (was && was.group === group && was.cast === cast && was.cut === cut) return
    ;(this.body.material as Material).dispose()
    this.dressPicture()
  }

  /** @internal Which group holds it, or nothing. */
  get heldBy(): SolidLayer | null {
    return this.owner
  }

  /**
   * @internal Told which group holds it now.
   *
   * The fold lines go with the group they were drawn for: they wear that
   * group's one material for lines, which the group frees with itself, so a
   * solid moved to another would be holding lines in a material that may
   * already be gone. They are cut again for the next group the first time it
   * cuts, as the faces are dressed again for it.
   */
  held(by: SolidLayer | null): void {
    if (by !== this.owner) this.untrace()
    this.owner = by
  }

  /**
   * @internal Handed to a viewer bare, it goes into that viewer's own group of
   * solids, made if it is the first to ask.
   */
  putOn(viewer: Viewer): void {
    viewer.ownGroup('solids', () => new SolidLayer()).add(this)
  }

  /** @internal */
  takeOff(): void {
    this.owner?.remove(this)
  }

  /**
   * @internal Only what this cut for itself, and the material and texture where
   * it made them.
   *
   * The shape is not in it. A page hands its own `BufferGeometry` over and
   * keeps it — it may stand the same one in two solids, or keep it to stand
   * again later — so freeing it here would take something the library never
   * owned. The fold lines' corners are the library's: `trace()` cut them off
   * the shape. Their material is not — it is the group's, and outlives every
   * line drawn in it. The faces' material only where it wears a picture: every
   * other solid is drawn with one of the group's own, which outlive it
   * (`dress`).
   */
  dispose(): void {
    this.dropPicture()
    this._image = undefined
    this.untrace()
  }

  private toView: boolean
  private _height: number
  private _facing: number | undefined
  /** What the page handed in to be worn, as it handed it in; see {@link image}. */
  private _image: SolidOptions['image']
  /** The picture it wears, and whether it was made here. */
  private picture: Texture | null = null
  /** The `glows` the picture's material was woven for; see {@link rewoven}. */
  private litBy: boolean | null = null
  /** Whether the picture's material was woven see-through; see {@link rewoven}. */
  private seenThroughBy: boolean | null = null
  /** What the group finished the picture's material with; see {@link refinish}. */
  private finishedBy: {
    readonly group: SolidLayer | null
    readonly cast: boolean
    readonly cut: boolean
  } | null = null
  private ours = false

  constructor(options: SolidOptions) {
    this._glows = options.glows ?? false
    this._visible = options.visible ?? true
    this._masked = options.masked ?? true
    this._fill = options.fill ?? true
    this._fillColor = options.fillColor
    this._fillOpacity = unit(options.fillOpacity ?? 1)
    this._line = options.line ?? false
    this._lineColor = options.lineColor ?? DEFAULT_SHAPE_COLOR
    this._lineOpacity = unit(options.lineOpacity ?? 1)
    this._castShadow = options.castShadow ?? true
    this._occludes = options.occludes ?? true
    this._pickable = options.pickable ?? true
    this._grounded = options.grounded ?? true
    this._draggable = options.draggable ?? false
    this.toView = options.at === 'view'
    // Three's own two words, both off by default: a solid a page stood in the
    // city takes the shadows the city takes, and throws one where the page
    // has not said otherwise
    this.body.castShadow = this._castShadow
    this.body.receiveShadow = true
    setOccludes(this.body, this._occludes)
    if (!this._pickable) notPicked(this.body)
    this.body.visible = this._fill
    // Laid over whatever is in view, so there is no box to ask whether the
    // view has left behind
    if (this.toView) this.body.frustumCulled = false
    this.root.add(this.body)
    this.root.visible = this._visible
    this._height = options.height ?? 0
    this._facing = options.facing
    // A place it never uses where it follows the view; see `stand`
    if (!this.toView) this.at = options.at
    this.body.geometry = options.geometry
    // Before anything is drawn, and before the colour itself is known: three
    // weaves the whole scene in the viewer's constructor, and a material told
    // `vertexColors` is woven to read the attribute only where the geometry
    // already has one (`NodeMaterial.setupDiffuseColor` asks `hasAttribute`).
    // Added later it is never read, and the solid draws its material's own
    // white for ever; see CLAUDE.md's trap about that "first".
    this.paint()
    if (options.image) {
      this._image = options.image
      this.wearPicture(options.image)
    }
  }

  /**
   * The shape it is, as the page handed it over and still the page's to free
   * (see {@link dispose}). Changeable, as everything a page gave it is (rule
   * 2): a block that grew taller had to be taken off and made again, and with
   * it every listener the page had hung on it.
   */
  get geometry(): BufferGeometry {
    return this.body.geometry
  }

  set geometry(value: BufferGeometry) {
    if (value === this.body.geometry) return
    this.body.geometry = value
    // Its corners carry the colour, which the new shape has none of yet; see
    // the constructor for why they go on before anything is drawn
    this.paint()
    this.untrace()
    this.owner?.recut()
    this.owner?.relay()
    this.owner?.restand()
    this.owner?.stir()
  }

  /**
   * The picture it is drawn in, as the page handed it over, or nothing where it
   * is drawn in its colour; see {@link SolidOptions.image}.
   */
  get image(): HTMLCanvasElement | HTMLImageElement | Texture | undefined {
    return this._image
  }

  set image(value: HTMLCanvasElement | HTMLImageElement | Texture | undefined) {
    if (value === this._image) {
      // The same canvas or image again is the page saying it has drawn on it.
      // A texture made here is not one the page can tell three about, so it is
      // told for it; a `Texture` the page handed in whole is the page's to tell.
      if (value && this.picture && this.ours) this.picture.needsUpdate = true
      return
    }
    this.dropPicture()
    this._image = value
    if (value) {
      // Its own material, woven the first time it is drawn — a picture is not
      // a value a shared material can carry; see {@link SolidOptions.image}
      this.wearPicture(value)
      return
    }
    // Back to the group's material, and to a colour on the corners: a solid
    // that wore its picture from the start never had one written there
    this.owner?.redress(this)
    this.owner?.recut()
  }

  /**
   * Lets go of the picture: its material, which was this solid's own, and its
   * texture where it was made here.
   *
   * Not the group's material, which a solid without a picture wears and which
   * outlives it.
   */
  private dropPicture(): void {
    if (!this.picture) return
    ;(this.body.material as Material).dispose()
    if (this.ours) this.picture.dispose()
    this.picture = null
    this.litBy = null
    this.seenThroughBy = null
    this.ours = false
  }

  /** Which way its front looks; see {@link SolidOptions.facing}. */
  get facing(): number | undefined {
    return this._facing
  }

  set facing(value: number | undefined) {
    this._facing = value
    this.owner?.restand()
  }

  /**
   * Makes the material the picture is worn with, out of {@link picture}.
   *
   * Apart from {@link wearPicture} because the light it is woven for can
   * change after the picture is on: `glows` is read as the material is made
   * and a shader is settled before it is first drawn, so the answer to writing
   * it is a new material rather than a new value. That is what {@link rewoven}
   * is for, and this is the one kind that has something to do in it.
   */
  private dressPicture(): void {
    if (!this.picture) return
    const material = litMaterial()
    material.colorNode = textureNode(this.picture) as unknown as MeshStandardNodeMaterial['colorNode']
    // Its own material, so how much of it goes on is three's own opacity on
    // it, and see-through is three's own `transparent` — set before the shader
    // is woven, which is where both are read (`SolidMaterial` holds a blended
    // colour to one as it is)
    material.transparent = this.seeThrough
    material.opacity = this._fillOpacity
    // A sign that carries its own light keeps its picture at every hour; one
    // that does not takes the light the wall it hangs on takes, and its
    // picture is still the picture in full daylight.
    if (this.glows) carriesItsOwnLight(material)
    else keepsItsColor(material)
    marksSolid(material)
    // And what the group's own materials take: the picture thrown over the
    // map, and the cut where it is a sheet the mask reaches. Its own material
    // is not the group's, and went without both — a sign stayed bare under a
    // hazard map thrown on every wall, and a sheet with a picture on it ran on
    // past the edge of the mask
    const group = this.owner
    const cast = !this.glows && (group?.casts() ?? false)
    const cut = group?.cuts(this) ?? false
    group?.finish(material, cast, cut)
    this.finishedBy = { group, cast, cut }
    this.body.material = material
    this.litBy = this.glows
    this.seenThroughBy = this.seeThrough
  }

  /**
   * Makes the material this one wears, and the texture where a page handed in
   * something that is not one yet.
   *
   * Through `lit.ts` like every other solid, so a sign takes the same sun as
   * the wall it hangs on. What the picture replaces is the colour and nothing
   * else.
   */
  private wearPicture(image: NonNullable<SolidOptions['image']>): void {
    if (image instanceof Texture) {
      this.picture = image
      this.ours = false
    } else {
      this.picture = image instanceof HTMLCanvasElement ? new CanvasTexture(image) : new Texture(image)
      // What a page draws on a canvas or hands in as a picture is sRGB, as
      // three takes a picture it loads itself to be. Left linear — three's
      // default for a texture made by hand — every colour in it was read as
      // brighter and greyer than drawn
      this.picture.colorSpace = SRGBColorSpace
      this.picture.needsUpdate = true
      this.ours = true
    }
    this.dressPicture()
  }

  /** How far its foot is lifted off whatever it stands on, in metres. */
  get height(): number {
    return this._height
  }

  set height(value: number) {
    this._height = value
    // Stood again as well as laid: the lift is how high a solid on the map
    // stands, and only a sheet was laid afresh for it — one stood on a place
    // of the map kept the height it was stood at until something else moved
    this.owner?.relay()
    this.owner?.restand()
  }

  /**
   * How far its top stands over whatever it is stood on, in metres: what the
   * sun's view must take in.
   *
   * Read off the shape rather than asked for, since the shape is in hand and
   * knows. Nought where it follows the view: what lies flat throws nothing
   * over itself.
   */
  get rise(): number {
    if (this.toView) return 0
    const box = this.body.geometry.boundingBox ?? this.boxed()
    return Math.max(0, box.max.y) + Math.max(0, this._height)
  }

  private boxed(): Box3 {
    this.body.geometry.computeBoundingBox()
    return this.body.geometry.boundingBox ?? new Box3()
  }

  /**
   * @internal Lays it over what is in view, at the height it was given.
   *
   * The height is read at the middle of the view, since a thing laid flat is
   * one height all over and Mercator's stretch is not.
   *
   * What is in view is the ground's own rectangle, and a plane below the
   * ground has to reach past it: a line of sight that meets the ground at the
   * far edge of that rectangle goes on falling, and arrives here further out.
   *
   * The shape is brought to that rectangle by its own extent, so a square cut
   * at any size does — and one with height in it is flattened, which is why
   * what wants this is a sheet.
   */
  lay(bounds: WorldBounds, lat: number, lean: number): void {
    if (!this.toView) return
    const box = this.body.geometry.boundingBox ?? this.boxed()
    const ownWide = Math.max(1e-6, box.max.x - box.min.x)
    const ownDeep = Math.max(1e-6, box.max.z - box.min.z)
    const drop = Math.abs(this._height / metersPerUnit(lat))
    const spread = drop * lean
    const wide = bounds.maxX - bounds.minX + spread * 2
    const deep = bounds.maxY - bounds.minY + spread * 2
    this.body.scale.set(wide / ownWide, 1, deep / ownDeep)
    this.body.position.set(
      bounds.minX - spread - box.min.x * (wide / ownWide),
      this._height / metersPerUnit(lat),
      -(bounds.maxY + spread) - box.min.z * (deep / ownDeep),
    )
    // The lines are the mesh's sibling and not its child — a child would go
    // when the faces are left unfilled, which is when the lines are all there
    // is — so they are laid where the mesh was laid. Left behind, a lined
    // sheet drew its folds at the shape's own size about the world's nought.
    this.edges?.position.copy(this.body.position)
    this.edges?.scale.copy(this.body.scale)
  }

  /**
   * @internal Writes the solid's colour onto the shape it was handed — the
   * page's, or the palette's ground — as it stands in the set now showing.
   */
  build(palette: Palette, night: boolean): void {
    // A picture is not a colour, and nothing in the palette says what it is
    if (this.picture) return
    this.paint(this.ink(palette, night))
  }

  /**
   * Says a colour on every corner, and how much of it goes on, in the one
   * place that does it.
   *
   * Four a corner, the fourth the {@link fillOpacity}: three reads a colour
   * attribute of four as colour and alpha (`vertexColor`), and an opaque
   * material leaves the alpha at one whatever it says — so every solid
   * carries four, and the group's opaque materials are woven once for that
   * one layout rather than once for each. One already there of three is put
   * aside for one of four, as one of the wrong length always was.
   *
   * Called with no colour from the constructor, where there is no palette to
   * ask yet and the point is only that the attribute be there. What the
   * corners say then is white and does not matter; that they say anything
   * does.
   */
  private paint(paint?: Color): void {
    const geometry = this.body.geometry
    const corners = geometry.attributes['position']?.count ?? 0
    if (corners === 0) return
    let colors = geometry.attributes['color'] as BufferAttribute | undefined
    if (!colors || colors.count !== corners || colors.itemSize !== 4) {
      colors = new BufferAttribute(new Float32Array(corners * 4).fill(1), 4)
      geometry.setAttribute('color', colors)
    }
    if (!paint) return
    const array = colors.array as Float32Array
    for (let v = 0; v < corners; v++) {
      array[v * 4] = paint.r
      array[v * 4 + 1] = paint.g
      array[v * 4 + 2] = paint.b
      array[v * 4 + 3] = this._fillOpacity
    }
    colors.needsUpdate = true
  }
}

/**
 * The solids a page stands its map on, drawn as one.
 *
 * A page need not make one: handed a bare {@link Solid}, the viewer keeps a
 * group of its own and puts it in there. This is for a page that wants a group it
 * can name, to take them all away at once.
 *
 * They are drawn before anything else and they both read depth and write it,
 * which nothing laid on the ground does — what lies flat reads without
 * writing. That is the whole reason for a stage of their own: nothing on the
 * ground leaves a mark for another flat thing to be measured against, so
 * between two of them the one drawn later wins, and a block that arrived
 * after the roads would bury them — while a block drawn first is simply what
 * the roads are drawn on.
 *
 * The mask reaches these as it reaches everything else in the city, and a page
 * standing its map on one says `masked: false` on that one: what the mask
 * leaves out is the city, and a plinth is the thing the remaining piece of city
 * was cut out of — cut to the same circle, its own wall would fall exactly on
 * the edge that cuts it.
 */
/** What a group of solids is made with. */
export interface SolidLayerOptions {
  /**
   * Drawn at all. On by default. A property of the layer afterwards, by the
   * same name: the one way to take everything in it off the map at once and
   * put it back, as every other layer has it. Writing `root.visible` instead
   * hid what three draws and left the rest — a page's own markup standing,
   * a shadow printed where solids had been.
   */
  readonly visible?: boolean
}

export class SolidLayer implements Layer {
  readonly root = new Group()
  readonly stage: Stage = 'base'

  constructor(options: SolidLayerOptions = {}) {
    this.root.visible = options.visible ?? true
  }

  /** Drawn at all, its shadows with it; see {@link SolidLayerOptions.visible}. */
  get visible(): boolean {
    return this.root.visible
  }

  set visible(value: boolean) {
    if (value === this.root.visible) return
    this.root.visible = value
    this.viewer?.stirShadows()
  }

  private readonly solids: Solid[] = []
  /** @internal The viewer it is on; read by a solid that weaves its own materials. */
  viewer: Viewer | null = null
  /**
   * The materials the solids wear, by the three things one is woven by:
   * whether it takes the light, whether the mask's cut is woven into it, and
   * whether it is drawn see-through. Each made as the first solid wanting it
   * is dressed — three weaves a shader per material and about a second with
   * it, and a group where nothing glows, nothing is a cut sheet and nothing is
   * see-through should not pay for a material nothing wears.
   *
   * The cut is one of the three because it is woven into a material: a sheet
   * drawn through it ends at the mask's line, and anything sharing that
   * material would end there too — which is exactly what a block standing
   * under the map must not do. See-through is one because three settles a
   * material's half of the pass and its blending as it weaves it.
   *
   * Up to eight, keyed by {@link wornKey}. Every solid of one mind shares one,
   * carrying its own colour and opacity on its corners.
   */
  private readonly worn = new Map<string, MeshStandardNodeMaterial>()
  /** The cut the cut ones are drawn through, made with the first of them. */
  private mask: MaskShader | undefined
  /**
   * The material the solids' fold lines are drawn in, and the one they are
   * drawn in see-through; each made as the first solid asking for it is cut.
   *
   * One of each and not one a solid: three weaves a shader per material, and
   * lines drawn over a filled solid are not the single preview a page moves
   * about the way the lines alone were. Each line carries its colour and how
   * much of it goes on on its own corners, as the faces do; see `Solid`'s
   * `trace`.
   */
  private folds: LineBasicNodeMaterial | undefined
  private foldsSeeThrough: LineBasicNodeMaterial | undefined
  /** Whether a solid wants cutting again: its shape or its colour has changed. */
  private cutting = true
  /** Whether a plane wants laying again: the view has moved, or its own height has. */
  private laying = true
  /**
   * Whether whatever stands on the land wants putting there again.
   *
   * Apart from {@link cutting} because the land arrives tile by tile as the
   * view travels, and cutting every solid's corners afresh each time one
   * landed would pay over and over for shapes nothing had changed about.
   */
  private standing = true
  /** Which heights the solids were last stood on; see {@link frame}. */
  private stoodOn: number | null = null

  /** The solid the pointer is on, so the one it leaves can be told. */
  private hovering: Solid | null = null

  listens(type: 'click' | 'hover' | 'pointing' | 'drag'): boolean {
    if (type === 'pointing') return false
    // Not whether anyone is listening: a solid told it may be carried is
    // carried whether or not the page watches, the way `pickable` says a thing
    // is found whether or not anyone wanted the finding (contract 6).
    if (type === 'drag') return this.solids.some((solid) => solid.draggable)
    return this.solids.some((solid) => solid.listens(type))
  }

  clicked(hit: Hit): void {
    this.solidAt(hit.object)?.clicked(hit, this.viewer)
  }

  /**
   * Hands the carry to the solid it began on — the same one at every step,
   * since the hit is the one it began on and the viewer hands it back
   * unchanged.
   */
  dragged(hit: Hit, drag: Dragging, phase: DragPhase): boolean {
    const solid = this.solidAt(hit.object)
    if (!solid?.draggable) return false
    solid.carried(drag, phase)
    return true
  }

  /**
   * Hands the hover to the solid under the pointer, and tells the one it just
   * left; see {@link ModelLayer.hovered} for why the one before is kept.
   */
  hovered(hit: Hit | null): void {
    const onto = hit ? (this.solidAt(hit.object) ?? null) : null
    if (onto === this.hovering) return
    this.hovering?.hovered(null)
    this.hovering = onto
    if (onto && hit) onto.hovered(hit)
  }

  /**
   * Which solid a thing under the pointer belongs to, or nothing.
   *
   * The same walk the viewer makes to find the layer that drew something, one
   * step further in: a solid's own group is a child of this group's, and what
   * was hit is its mesh below that.
   */
  private solidAt(object: Object3D): Solid | undefined {
    let top: Object3D | null = object
    while (top && top.parent !== this.root) top = top.parent
    return top ? this.solids.find((solid) => solid.root === top) : undefined
  }

  /** The solids, in the order they were put under the map. */
  get items(): readonly Solid[] {
    return this.solids
  }

  /** Puts a solid under the map. */
  add(solid: Solid): this {
    if (solid.heldBy === this) return this
    if (solid.heldBy) {
      throw new Error(
        'SolidLayer.add: this solid is already in another SolidLayer. Take it out of that one first.',
      )
    }
    this.solids.push(solid)
    solid.held(this)
    if (this.viewer) {
      solid.dress(this.materialOf(solid))
      this.weaveIn(solid)
    }
    // A solid's root is a group, and a group is where three takes the stage
    // from — so it says this layer's again. Left at nought it would be read as
    // `structure` and the thing the map is stood on would be sorted among the
    // buildings standing on it. See `order.ts`.
    inStage(solid.root, this.stage)
    this.root.add(solid.root)
    solid.showing(this.maskKeeps(solid))
    this.cutting = true
    this.laying = true
    // And stood, which nothing else would ask for it: the place was written
    // before there was a group to tell (the constructor writes `at` with no
    // owner), and the group stands only on a change of the land or a page
    // writing a place. A group that had stood its first solids then left every
    // later one at the world's nought, off the map — seen 2026-11-05, a solid
    // added to the viewer's own group after another was taken out of it held
    // a matrix of nought for 180 frames
    this.standing = true
    // The sun's map is kept from one frame to the next and only drawn again
    // where something it holds has moved — so a solid that arrives without a
    // word stands in the light with no shadow, and one that leaves leaves its
    // shadow printed on the land; see `Viewer.stirShadows`.
    this.viewer?.stirShadows()
    return this
  }

  /** Takes one off, leaving it as it was made. */
  remove(solid: Solid): this {
    const at = this.solids.indexOf(solid)
    if (at < 0) return this
    this.solids.splice(at, 1)
    solid.held(null)
    this.root.remove(solid.root)
    // Both of what `inStage` wrote, and through the one function that knows
    // there are two: the number, and the mask it was opened on
    outOfStage(solid.root)
    this.viewer?.stirShadows()
    return this
  }

  /** Takes every one off. */
  clear(): void {
    for (const solid of this.solids) {
      solid.held(null)
      this.root.remove(solid.root)
      // As `remove` does: a solid handed back is handed back as it was made,
      // and the stage `add` wrote on its group is not something it was made with
      outOfStage(solid.root)
    }
    this.solids.length = 0
    this.viewer?.stirShadows()
  }

  /**
   * @internal A solid was changed in a way that is written on its corners:
   * the colour of its faces or of its lines, its lines drawn or taken away, a
   * picture taken off.
   *
   * Kept apart from {@link relay} because the view moves every frame of a
   * drag and a solid does not: cutting one is a fresh set of corners and a
   * trip to the card, and doing that to four blocks sixty times a second
   * would pay for a thing nobody asked to change.
   */
  recut(): void {
    this.cutting = true
    // A fresh set of corners is a fresh shape for the sun to see; see `relay`
    this.viewer?.stirShadows()
  }

  /**
   * @internal A solid changed what the sun's map makes of it and nothing
   * else: whether it throws, or whether it is drawn filled at all.
   *
   * Nothing to cut and nothing to lay — three reads those words off the mesh
   * as it draws — but the map is kept from frame to frame and holds the solid
   * as it was; see `Viewer.stirShadows`.
   */
  stir(): void {
    this.viewer?.stirShadows()
  }

  /**
   * The material for the fold lines, opaque or see-through; see {@link folds}.
   *
   * Ink, as the lines round the city's folds are: no light, coloured on its
   * corners and written past the frame's tone curve there (`tone.ts`), so a
   * line keeps the colour it is given at every hour. The see-through one is
   * the same with three's `transparent` on, so it is drawn in the transparent
   * half of its pass and blended by the alpha its corners carry.
   *
   * Drawn {@link LIFT} pixels nearer the eye than where its corners are. The
   * camera is orthographic, so moving a corner towards it leaves it on the
   * same pixel and moves only how far off it reads — which is the whole of
   * what a line drawn over the faces it lies on needs. Worked out in the
   * world, from the size of a pixel of the page there, the same way the
   * city's folds work out theirs: the projection scales across by two over the
   * width the view takes in. Taken back through the mesh's own matrix, since
   * that is what three moves a corner by next — a solid is stretched from
   * metres into the world's units, and a sheet stretched unevenly to the view.
   */
  private foldMaterial(seeThrough: boolean): LineBasicNodeMaterial {
    const had = seeThrough ? this.foldsSeeThrough : this.folds
    if (had) return had
    const material = new LineBasicNodeMaterial({ vertexColors: true, transparent: seeThrough })
    const across = cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x
    const perPixel = float(2).div(across.mul(viewport.z.div(screenDPR)))
    // The camera looks down its own -z, so its z points back at it
    const towards = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz
    const lift = modelWorldMatrixInverse.mul(vec4(towards.mul(perPixel.mul(LIFT)), 0)).xyz
    material.positionNode = positionLocal.add(lift)
    if (seeThrough) this.foldsSeeThrough = material
    else this.folds = material
    return material
  }

  /** @internal A plane was changed and wants laying again. */
  relay(): void {
    this.laying = true
    // Something standing here was moved, resized or recoloured, and the sun
    // drew its map from where it was; see `Viewer.stirShadows`
    this.viewer?.stirShadows()
  }

  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.changed('mask')
    // Nothing to throw away for having changed viewers. The light is three's
    // and reaches a material through the scene it is drawn in, so these
    // are the same wherever the group is put. The mask is not, which is
    // what the line above is for.
    for (const solid of this.solids) {
      solid.dress(this.materialOf(solid))
      this.weaveIn(solid)
    }
    this.cutting = true
    this.laying = true
  }

  /**
   * Weaves a solid's shaders off the frame and holds it out of the picture
   * until they are made, as a tile is held; see `Viewer.weave`.
   *
   * Hung at once and left to the viewer's weaving of the whole scene, a solid
   * was drawn unwoven whenever that weaving did not take it in: one the page
   * made `visible: false` (three's walk passes over what is hidden), one not
   * stood yet (it sits at the world's nought, out of the frustum), and every
   * one put on after the viewer started. Its shader and its stand-in were
   * then built inside the frame that first drew it — on security-camera, as
   * the camera was shown on the city's first `idle` (measured 2026-11-17).
   * Woven here whether shown or not, a hidden one costs nothing when shown.
   */
  private weaveIn(solid: Solid): void {
    const viewer = this.viewer
    if (!viewer) return
    const ours = ++solid.weavings
    // Held out only once frames are being drawn: before, the first frame waits
    // for the scene to be woven, a solid shown in it with the rest
    // (`Viewer.framing`)
    solid.unwoven = viewer.framing
    solid.showing(this.maskKeeps(solid))
    // A weaving that fails is not the solid's failure: it is shown all the
    // same and woven in the frame, as it always was
    void viewer
      .weave(solid.root)
      .catch(() => undefined)
      .then(() => {
        if (solid.weavings !== ours) return
        solid.unwoven = false
        if (solid.heldBy !== this) return
        solid.showing(this.maskKeeps(solid))
        // In the picture now, and not yet in the sun's map
        viewer.stirShadows()
      })
  }

  /**
   * @internal A solid changed which of the group's materials it wears —
   * whether it takes the light, whether the mask's cut is woven into what
   * draws it, or whether it is drawn see-through.
   *
   * Nothing to cut again for the first two: the corners are the same
   * whichever it wears, and all that has changed is whether the light is
   * multiplied over the colour on them and whether a fragment outside the
   * mask is thrown away. The third is said beside a cut, since the opacity is
   * on the corners too.
   */
  redress(solid: Solid): void {
    if (this.viewer) solid.dress(this.materialOf(solid))
  }

  /** The group's material for one solid, as it stands now. */
  private materialOf(solid: Solid): MeshStandardNodeMaterial {
    return this.materialFor(solid.glows, this.throughMask(solid), solid.seeThrough)
  }

  /**
   * The material for a solid that takes the light or does not, cut by the
   * mask or not, drawn see-through or not.
   *
   * Made as the first solid of its kind asks rather than in the constructor,
   * since three weaves a shader per material and about a second with it.
   * Kept from then on, and every solid of the same mind shares it, carrying
   * its own colour and opacity on its corners.
   *
   * Taking the light or not differs in one line, which is `lit.ts`'s own
   * switch: a material told to read no light is what glowing is — no branch in
   * any shader, and nothing to read at a pixel. See-through differs in three's
   * own `transparent` and nothing else of three's: depth is written as three
   * writes it for a transparent material, and the side drawn is the front.
   */
  private materialFor(glows: boolean, cut: boolean, seeThrough: boolean): MeshStandardNodeMaterial {
    const key = wornKey(glows, cut, seeThrough)
    const had = this.worn.get(key)
    if (had) return had
    const material = litMaterial({ vertexColors: true, transparent: seeThrough })
    // It stands rather than lying, and writes depth like any other solid
    marksSolid(material)
    // Whatever colour the page gave is on the corners, and it means the colour
    // the solid shows in full daylight — the same bargain the palette makes;
    // see `lit.ts`. Held there to what a surface can give back, so the default
    // `palette.surface` draws `#e6eaf0` flat and `#aeb1b5` in cast shadow
    // rather than four shades of one, and a page asking for white is drawn the
    // `#f0f0f0` the city's own white wall draws. A glowing one keeps the colour
    // it was given at every hour, exactly, there being no light to multiply it.
    if (glows) carriesItsOwnLight(material)
    else keepsItsColor(material)
    // The picture a page may be throwing down over the map, where this one
    // takes light at all; see `projection.ts`. A solid that carries its own
    // light is a lamp and wears nothing thrown on it.
    if (!glows && this.viewer) this.viewer.projection.cast(material, 'buildings')
    // And a sight, for the same reason and with the same exception: a lamp is
    // not painted by what can see it
    if (!glows && this.viewer) this.viewer.sight.paint(material, 'buildings')
    if (cut) this.maskShader().apply(material)
    this.worn.set(key, material)
    return material
  }

  /**
   * Whether a solid is drawn through the mask's cut: a sheet the page has
   * asked the mask to reach.
   *
   * Anything standing answers no however it was asked, and is kept or dropped
   * whole instead; see {@link maskKeeps}.
   */
  private throughMask(solid: Solid): boolean {
    return solid.sheet && solid.masked
  }

  /** @internal Whether the picture over the map can be thrown on what this group holds: once it is on a viewer. */
  casts(): boolean {
    return this.viewer !== null
  }

  /** @internal Whether a solid is drawn through the mask's cut; see {@link throughMask}. */
  cuts(solid: Solid): boolean {
    return this.viewer !== null && this.throughMask(solid)
  }

  /**
   * @internal Finishes a solid's own material — one wearing a picture — the
   * way {@link materialFor} finishes the group's.
   */
  finish(material: SolidMaterial, cast: boolean, cut: boolean): void {
    if (cast) this.viewer?.projection.cast(material, 'buildings')
    if (cast) this.viewer?.sight.paint(material, 'buildings')
    if (cut) this.maskShader().apply(material)
  }

  /**
   * The cut, made as the first sheet wanting it is dressed and told at once
   * where the mask stands — the shader is built before a frame goes by, and
   * nothing would tell it again until the mask changed.
   */
  private maskShader(): MaskShader {
    if (!this.mask) {
      this.mask = new MaskShader()
      this.mask.set(this.viewer?.maskArea ?? null)
      if (this.viewer) this.mask.fadeInto(this.viewer.colors.backdrop)
    }
    return this.mask
  }

  /**
   * @internal Whether the mask lets one of these through whole.
   *
   * Only ever asked of what is not a sheet: a sheet is cut in its own material
   * and the question does not come up a solid at a time. Where the page did
   * not ask for the mask at all, the answer is yes.
   */
  maskKeeps(solid: Solid): boolean {
    if (!solid.masked || solid.sheet) return true
    const at = solid.stands
    // Nothing until it has been put down — where what it stands on is nowhere
    // yet, and on the frame before the first one
    if (!at) return true
    // In the world's own units, which is what the seat worked out: a solid on
    // a model is wherever the model is, which no longitude it was given says
    return maskHolds(this.viewer?.maskArea ?? null, at[0], at[1])
  }

  /** Solids answer four of the seven words; see {@link Change}. */
  changed(what: Change): void {
    switch (what) {
      case 'mask':
        // The sheets read it, the rest are asked again.
        this.mask?.set(this.viewer?.maskArea ?? null)
        for (const solid of this.solids) solid.showing(this.maskKeeps(solid))
        return
      case 'colors':
        // The colours are read as a solid is cut, so cutting them again is the
        // answer — the palette's ground, and the page's own colours where one
        // was said as a pair, which is what the viewer is saying when it tells
        // this at dusk. A colour said once is the same colour at every hour
        // and is written again unchanged, which costs a solid's corners once.
        if (this.viewer) this.mask?.fadeInto(this.viewer.colors.backdrop)
        this.cutting = true
        this.laying = true
        return
      case 'view':
        // A plane is only ever as wide as the view, so it follows it. A block
        // stands where it stands.
        this.laying = true
        return
      case 'elevation':
        // The land has arrived or changed under whatever is standing on it.
        this.standing = true
        return
    }
  }

  detach(): void {
    this.viewer = null
  }

  /** @internal A solid changed what its height is counted from, so it wants putting down again. */
  restand(): void {
    this.standing = true
    // Put down somewhere else is somewhere the sun's last map does not have it;
    // see `relay`. Said here and not in `changed('elevation')`, which sets the
    // same flag for a reason of its own: this is a page moving one solid, which
    // happens when a page says so, where the land arrives while tiles are still
    // landing and the map is being drawn every frame anyway.
    this.viewer?.stirShadows()
  }

  /**
   * How far the tallest of them stands over what it is stood on, in metres.
   *
   * A block reaching down from the ground is a block standing up from the
   * plane under it, and the sun has to see the whole of it or the shadow it
   * throws over that plane is cut off partway.
   */
  tallest(): number {
    // Nothing of it is drawn, so nothing of it stands for the sun to look at
    if (!this.root.visible) return 0
    let most = 0
    // The plane answers nought, which is why it needs no saying apart: a
    // shadow a plane throws over that plane is cut off partway
    for (const solid of this.solids) most = Math.max(most, solid.rise)
    return most
  }

  frame(): void {
    const viewer = this.viewer
    if (!viewer) return
    // The land under them changes as its tiles land, and what stands on the
    // land stands where the land is when it is stood. Watched as the models
    // and the shapes watch it, or a solid stood before the hill under it had
    // arrived stood at nought inside the hill for good
    const land = viewer.elevation ? heightsVersion() : null
    if (land !== this.stoodOn) {
      this.stoodOn = land
      this.standing = true
    }
    if (!(this.cutting || this.laying || this.standing)) return
    const palette = viewer.colors
    const heights = viewer.elevation ? heightsInHand() : null
    // How far a line of sight travels over the map for every unit it falls.
    // The camera is orthographic, so every line falls at the same angle and
    // there is no horizon for this to run away at; the view lies back no
    // further than 70°, which puts a ceiling of under three on it
    const lean = Math.tan((viewer.camera.pitch * Math.PI) / 180)
    // Three questions, asked of every one of them. What a kind has no answer
    // to it does not answer — a block is not laid to the view, a sheet does not
    // stand on the land — so nothing here has to know which is which.
    // Which of a pair stands: the very answer the palette above was made by,
    // asked of the viewer rather than worked out again from the sun, so a
    // page's pair and the map's own colours turn over on the same frame
    const night = viewer.night
    const folds = (seeThrough: boolean): LineBasicNodeMaterial => this.foldMaterial(seeThrough)
    for (const solid of this.solids) {
      if (this.cutting) solid.shape(palette, night, folds)
      if (this.laying) solid.lay(viewer.visibleBounds, viewer.camera.center[1], lean)
      if (this.standing) solid.stand(heights)
    }
    this.cutting = false
    this.laying = false
    // What stands on a model or a solid is asked again every frame: a page may
    // move what it stands on at any time, and is not asked to say so here.
    this.standing = this.solids.some((solid) => solid.riding)
  }

  /**
   * Lets go of the materials, and of whatever every solid it still holds cut
   * for itself. `clear` hands a solid back as it was made; this is the end of
   * them — though not of the shapes they were handed, which stay the page's
   * (see {@link Solid.dispose}).
   */
  dispose(): void {
    for (const solid of this.solids) {
      solid.held(null)
      this.root.remove(solid.root)
      outOfStage(solid.root)
      solid.dispose()
    }
    this.solids.length = 0
    for (const material of this.worn.values()) material.dispose()
    this.worn.clear()
    // After the solids, which let go of their lines' corners as they were
    // handed back (`held`), so nothing is still drawn in them
    this.folds?.dispose()
    this.foldsSeeThrough?.dispose()
    this.folds = undefined
    this.foldsSeeThrough = undefined
  }
}

/** Which of a group's materials a solid wears; see `SolidLayer`'s `worn`. */
function wornKey(glows: boolean, cut: boolean, seeThrough: boolean): string {
  return `${glows ? 'glows' : 'lit'}|${cut ? 'cut' : 'whole'}|${seeThrough ? 'see-through' : 'opaque'}`
}

/** A share, held between nought and one — as the shapes hold theirs. */
function unit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
