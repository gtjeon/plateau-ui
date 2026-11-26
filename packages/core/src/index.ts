export { Interaction, type InteractionOptions } from './interaction.js'
export {
  Camera,
  STAGES,
  Viewer,
  type Change,
  type FitBoundsOptions,
  type FlyOptions,
  type Held,
  type Layer,
  type Stage,
  type View,
  type ViewerEvents,
  type ViewerOptions,
  type ViewKeyframe,
} from './Viewer.js'
// What a layer of your own needs to behave like the ones here: three's own
// layer that keeps a line out of the shadows and the corner shading, the way
// to take a solid thing out of the corner shading alone — it keeps layer 0, so
// the sun's map, the outlines and a plain `Raycaster` still see it — the way
// to let a click pass through something, the name a mesh drawing many things
// writes to say which of them a corner belongs to, and the zoom the city
// stands up at.
export { LAND, MARKS, PICTURE_ONLY, setOccludes } from './passes.js'
// The other door to the renderer, and the one a page uses: something drawn
// over the finished frame, which is where three's own `PostProcessing` and the
// passes in its addons attach. `viewer.effects` is the handle.
export { type FramePass } from './passes.js'
// Where a layer of your own is drawn, and what to write on a group nested
// inside it so that it is drawn there too — three reads the stage off the
// nearest group above a mesh, so a group that says nothing says `structure`.
export { drawOrder, inStage, outOfStage } from './order.js'
export { PICKED_ITEM, notPicked } from './pick.js'
// What a layer of your own must call where it stands a solid on the land that
// writes depth. The ground leaves "this pixel is land" standing wherever it
// drew, and a solid that wins the depth test over it inherits that mark unless
// it takes it off — which hands the pixel to whatever paints the ground, and
// puts a wash meant for a park up the face of what is standing in it. Its
// opposite is not offered: a thing that means to be read as land simply does
// not call this, which is what the trees do.
// What a layer of a page's own writes on what it draws, so that colour a page
// paints over the map (`paints`) lands on it as on the library's own: a thing
// that stands says `marksSolid`, and a land of the page's own in place of the
// viewer's says `marksLand` — and wears `LAND` beside layer 0, so that what is
// buried in it stays buried where the mask has cut the viewer's land away.
export { marksLand, marksSolid } from './classify.js'
export { CITY_MIN_ZOOM_COARSEST, DEFAULT_CITY_MIN_ZOOM, cityStands } from './buildings/zooms.js'
// Where a place on the map falls on the canvas, for a page drawing its own
// markup over the city — a leader line, a tooltip, a panel on a building. What
// a page hangs on a place and leaves there is an `Html` mark instead.
export { Screen, type OffBuildings, type ScreenPlace, type Where, type WhereOptions } from './screen.js'
// What a layer of your own needs to honour the shape the viewer is cut to:
// the tests that say whether a patch or a place is inside it, the rectangles
// to narrow what it fetches by — one for each piece, and the one box round
// them for a question that can only be asked once — and the shader to weave
// into its materials. A layer that ignores these draws past the cut and
// fetches what is outside it.
export {
  MaskShader,
  boundsRound,
  maskArea,
  maskBounds,
  maskBoxesIn,
  maskCircle,
  maskEdge,
  maskHolds,
  maskIn,
  maskTouches,
  type Mask,
  type MaskShape,
  type StandingShape,
  type MaskArea,
  type MaskView,
  type MaskField,
  type MaskPart,
} from './mask.js'
// What a layer of your own needs for its things to wear a line round them.
// The line is found on the screen, over one picture holding every layer, so
// a layer says what its material draws into that picture and the viewer does
// the rest — `viewer.outlines` is where a slot for a colour is taken.
export { NO_OUTLINE, drawsOutline, outlinedBy, type OutlineNode, type Outlines } from './outlines.js'

export type { Easing } from './motion/easing.js'
export type { Animation, PlayState, Timing } from './motion/motion.js'
export type { Keyframe } from './motion/keyframes.js'
export {
  Events,
  type Anchor,
  type DragPhase,
  type Dragging,
  type Hit,
  type LoadFailure,
  type Position,
} from './events.js'
// Whose data a layer of your own draws. The viewer gathers what its layers
// give and draws the line; both of these sources ask to be named where
// their data is shown.
// Every request the library makes goes through one function a page can hand
// the viewer, as Mapbox's `transformRequest`: for a proxy, a mirror, or a
// dataset held to one year.
export type { RequestKind, RequestParameters, TransformRequest } from './requests.js'
export {
  DEFAULT_CREDITS_CORNER,
  GSI_CREDIT,
  PLATEAU_CREDIT,
  type Credit,
  type Credits,
  type CreditsCorner,
} from './credits.js'
// What a layer of your own needs to stand its things on the land the ground
// draws: the heights under a patch of it, the finest zoom they come at, and
// the count that changes when the tiles in hand do — which is how a layer that
// builds something out of the heights knows to build it again.
// And where the heights changed since a count taken before, so that what was
// built out of them is built again where it has to be and nowhere else.
export {
  FINEST_HEIGHTS,
  FINEST_STEP,
  Heights,
  heightsChangedSince,
  heightsInHand,
  heightsUnder,
  heightsVersion,
  heightZoom,
} from './elevation.js'
// The land, and each piece it is made of as a part of its own — `ground.road`,
// `ground.rail`, `ground.trees` — carrying the settings that piece has and no
// others, under the names the options write them with.
export {
  Ground,
  type GroundEvents,
  type GroundLine,
  type GroundLineOptions,
  type GroundOptions,
  type ViewerGroundOptions,
  type GroundPiece,
  type GroundPieceOptions,
  type GroundRail,
  type GroundRailOptions,
  type GroundRibbon,
  type GroundRibbonOptions,
  type GroundRiver,
  type GroundRiverOptions,
  type GroundTrees,
  type GroundTreesOptions,
} from './Ground.js'
// A picture somebody else publishes as tiles — a hazard map, an aerial
// photograph, an old survey — laid on the land and cut to the same mask as
// everything else. What a colour means is never this library's: the legend
// belongs to whoever published the set.
export { ImageTileLayer, type ImageTileLayerEvents, type ImageTileLayerOptions } from './ImageTileLayer.js'
// A published picture stood up off the map by its legend: each colour a height
export {
  ImageExtrusionTileLayer,
  type ImageExtrusionTileLayerEvents,
  type ImageExtrusionTileLayerOptions,
} from './ImageExtrusionTileLayer.js'
// The same, arriving as one picture over the rectangle the page says it covers
export {
  ImageExtrusionLayer,
  type ImageExtrusionLayerEvents,
  type ImageExtrusionLayerOptions,
} from './ImageExtrusionLayer.js'
export { type LegendEntry } from './imageExtrusion.js'
// The same picture arriving in one piece instead of many, over the rectangle
// the page says it covers. Everything past that is the same — what it is worn
// on, the colour it may be swapped for, how much of it goes on, the mask.
export { ImageLayer, type ImageLayerEvents, type ImageLayerOptions } from './ImageLayer.js'
// One texel of a published picture, as published — what `colorAt` hands back
// on either of the two. Not a colour anybody sees: what is on the screen has
// been through the light, the tone curve and the mask.
export type { Texel } from './pictureSheet.js'
// The same addresses carrying the shapes themselves rather than a picture of
// them — a road as a line, a flood zone as a polygon, with whatever the
// publisher wrote about each. `GeoJsonLayer` fed by tiles: the same `filter`
// and the same `FeatureStyle`, the same shapes drawn, feature by feature as the
// tiles land, and a feature answering a click and a hover as one there does.
export {
  VectorTileLayer,
  type TiledFeature,
  type VectorTileEvents,
  type VectorTileLayerOptions,
} from './VectorTileLayer.js'
// One shape out of a tile, which is what a page's `style` is handed: its kind,
// what the publisher wrote about it, and the corners it is drawn from. What a
// click hands back is that less the corners — `TiledFeature` above, where the
// reason is written down.
export type { VectorTileFeature } from './mvt.js'
// What one place can see, painted on it: the land in range that nothing stands
// in front of, and the walls and the trees in sight. Worked out the way a point
// light's shadow is, from a cube of distances the viewer draws from the eye.
export {
  Viewshed,
  type FieldOfView,
  type ViewshedBase,
  type ViewshedEvents,
  type ViewshedOptions,
  type ViewshedSticks,
} from './Viewshed.js'
// What a mark, or a line painted on the land, does where something stands
// between it and the camera. One answer for both, since a page means the same
// thing telling either.
export { DEFAULT_DIMMED, type Behind, type Draws } from './behind.js'
// A GeoJSON file drawn on the land. Not a renderer of its own: it holds the
// shapes below and fills them from the file. Sealed — it draws what the file
// says and nothing else, so a page wanting shapes of its own paints them into a
// `ShapeLayer`. Leaflet's split: `filter` says which features, `style` says
// how each is drawn, and a style is the same words a shape made by hand is
// given. Its points are circles among its own shapes; a style saying
// `point: false` gets them back as `points` instead, for a page that wants a
// pin or a label there.
export {
  GeoJsonLayer,
  type FeatureStyle,
  type GeoJsonData,
  type GeoJsonEvents,
  type GeoJsonFeature,
  type GeoJsonFeatureCollection,
  type GeoJsonGeometry,
  type GeoJsonLayerOptions,
  type GeoJsonPlace,
  type GeoJsonPoint,
} from './GeoJsonLayer.js'
// What a page paints on the land: a line along it, a piece of it coloured in,
// a dot on one place of it, and the group that draws them as one. All three
// stand on `Shape`, which is what the group holds — and within one group the
// order a page adds them in is the order they are drawn, so a line added after
// an area lies on top of it. The ring an area is given is outside that order:
// every ring is drawn after every fill, so two areas that share an edge each
// keep theirs. A part is switched by its name and coloured by its name and
// `Color` — `fill` and `fillColor`, `line` and `lineColor` — the same words a
// file's `FeatureStyle` uses, so one object goes into either.
export {
  Circle,
  DEFAULT_CIRCLE_RADIUS,
  DEFAULT_FILL_OPACITY,
  DEFAULT_LINE_WIDTH,
  DEFAULT_SHAPE_COLOR,
  Polygon,
  Polyline,
  type Shape,
  ShapeLayer,
  type CircleOptions,
  type PolygonOptions,
  type PolylineOptions,
  type PolylinePoint,
  type ShapeBase,
  type ShapeEvents,
  type ShapeLayerOptions,
  type ShapeOptions,
  type ShapeSticks,
} from './ShapeLayer.js'
// What a page stands its map on: the solids under the ground, in the stage
// drawn before it.
export {
  SolidLayer,
  Solid,
  type SolidEvents,
  type SolidLayerOptions,
  type SolidOptions,
} from './SolidLayer.js'
// What a layer of your own needs to stand its things on the city's buildings:
// where one is in the terms its shader moves it by, and how to find the layer
// that answers. A mark moved any other way is a mark a frame behind it.
export { standsOnBuildings, type BuildingSeat, type StandsOnBuildings } from './onBuildings.js'
export { seatNow } from './screen.js'
// What a page puts on the map to point at a place or to write on it: a marker
// with a symbol, a label with words alone, a page's own markup, and the group
// that draws them as one. All three stand on `Annotation`, which is what the
// group holds; the two drawn on the group's sheet stand on `SheetMark` as well,
// which is where their look is — the page's markup takes none, since its look
// is the page's HTML. The parts of that look are flat, a switch and the part's
// name with `Color` and the rest after it: `halo` and `haloColor`,
// `background` and `backgroundColor`, `dropShadow` and its four.
export {
  type Annotation,
  AnnotationLayer,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_FONT,
  DEFAULT_DROP_SHADOW,
  DEFAULT_HALO_WIDTH,
  Html,
  Label,
  Marker,
  type SheetMark,
  type AnnotationEvents,
  type AnnotationLayerOptions,
  type AnnotationLook,
  type AnnotationOptions,
  type AnnotationPlace,
  type AnnotationText,
  type HtmlOptions,
  type LabelOptions,
  type MarkerOptions,
  type MarkerDirection,
  type MarkerSymbol,
} from './AnnotationLayer.js'
// The rest of what a mark is drawn in where the page says nothing: the letters
// beside a marker's symbol, and the paper a halo and a plate are drawn in.
// Pairs, like every default colour, since a near-black chosen against the
// light set's paper disappears into the dark set's.
export { DEFAULT_HALO_COLOR, DEFAULT_LABEL_INK } from './inks.js'
// What a page puts in the city that is a page's own: a glTF file of its
// making, standing on the land among the buildings.
export {
  Model,
  ModelLayer,
  type ModelEvents,
  type ModelLayerEvents,
  type ModelLayerOptions,
  type ModelOptions,
} from './models/ModelLayer.js'
export { DRACO_PATH } from './draco.js'
export { KTX2_PATH } from './ktx2.js'
// Two effects of the viewer's own, each a part that is always there and is
// changed in place — `viewer.appear.duration`, `viewer.occlusion.enabled` — as
// three's `renderer.shadowMap` is, with the options written in the same names.
export { DEFAULT_APPEAR, type AppearOptions, type ViewerAppear } from './appear.js'
export { DEFAULT_OCCLUSION, MOST_SHADING, type OcclusionOptions, type ViewerOcclusion } from './occlusion.js'
export { MOST_AUTO_BLUR, type TiltShiftOptions, type ViewerTiltShift } from './tiltShift.js'
// DEFAULT_ANGLE beside DEFAULT_SUN because the default is dated now: a page
// offering both ways of saying the light needs the angle to start its own from.
export { DEFAULT_ANGLE, DEFAULT_SUN, angleOfSun, sunAt, type Sun, type SunAngle } from './sun.js'
// The light itself, three's own, for a page that wants to read it: the sun it
// is lit by and the fill its shaded sides are left with. `viewer.lights` is
// the handle, `viewer.sun` is where it is set.
export { Lights } from './lights.js'
// What a layer of your own draws a solid with, so that the one sun and the one
// fill reach it the way they reach the land and the city; see `lit.ts`.
export { facesUp, glows, inFullDaylight, keepsItsColor, solid, type SolidMaterial } from './lit.js'
// And what it writes a colour through where that colour must come out exactly
// as it was asked for — a line, a label, a thing that carries its own light.
// The frame goes through a tone curve, and this is the way out from under it.
export { beforeTheCurve, beforeTheCurveOf } from './tone.js'
export {
  Buildings,
  type Building,
  type BuildingEvents,
  type BuildingFace,
  type PointedAt,
  type BuildingsLoad,
  type BuildingsOptions,
  type Windows,
  type WindowsOptions,
} from './buildings/Buildings.js'
// Everything the survey wrote about one building besides the four `Building`
// names outright. The publisher's own keys, which is why it is not a shape of
// ours: in a PLATEAU tile they carry that building's own assessed flood depth,
// its band, how long the water stays, and the landslide zones it stands in.
export type { BuildingAttributes } from './buildings/tileContent.js'
// A building a page stood rather than one the view brought; see `Buildings.bring`.
export { ReplicaBuilding } from './buildings/replica.js'
export type { BuildingStyle, FloorStyle, RoofImage, SharedStyle, WallImage } from './buildings/styles.js'
// What a page may hand over to be painted on a roof or round the walls, and
// how many different pictures there may be at once (a device's default limit).
export { MOST_PICTURES, type DecalImage } from './buildings/decals.js'
// A rule a page hands `Buildings.hide`, asked of every building as its tile lands.
export type { BuildingRule } from './buildings/hidden.js'
// What a page names when it wants particular buildings rather than the city:
// which ones, where they stand, and where to stand them instead.
export type { BuildingPlace, BuildingWanted } from './buildings/named.js'
export { DEFAULT_EDGE_WIDTH } from './buildings/edges.js'
export { DEFAULT_OUTLINE_GAP, DEFAULT_OUTLINE_WIDTH, WIDEST_OUTLINE } from './outlines.js'
// `buildings.parapet`, like `buildings.windows`, is a part that is always
// there, turned off and on with what was set on it kept, as three keeps
// `shadowMap.type` while the map is off. Both classes go out as types alone:
// the city makes its own.
export {
  DEFAULT_PARAPET,
  type Parapet,
  type ParapetOptions,
  type ParapetSize,
  type RoofTally,
} from './buildings/parapets.js'
export type { BuildingKeyframe } from './buildings/pose.js'
export type { CrowdField, CrowdKeyframe, CrowdOptions } from './buildings/crowd.js'
export {
  BUILDING_USAGES,
  DEFAULT_HIGH_RISE,
  DEFAULT_WINDOW_STYLES,
  type BuildingUsage,
  type HighRise,
  type WindowStyle,
  type WindowStyles,
  type WindowStylesAsked,
} from './buildings/windowStyle.js'
export { DEFAULT_TALL, type WindowTally } from './buildings/windows.js'
export { DEFAULT_CLEARANCE } from './buildings/neighbours.js'
export { DEFAULT_REACH } from './buildings/roads.js'
// Where a colour lands: the land, what was built on it, or both. One word for
// a shape painted on the map and for a picture laid over the ground, since a
// page means the same thing by it whichever of the two it is saying it of.
export { paintedIn, paintsOn, type PaintedKind, type Paints } from './paints.js'
// The pictures a page throws down over the whole map, which `viewer.projection`
// holds and stacks. A page writing its own layer of things that stand on the
// land hands each of their materials to `cast`, the way the city and the solids
// do.
export { Projection, type Cast } from './projection.js'
// The one eye `viewer.sight` paints, which every surface reads for itself. A
// page writing its own layer of things that stand hands each of their materials
// to `paint`, as it hands them to the projector's `cast`.
export { Sight, type SightAsker, type SightLook } from './sight.js'
export type { BuildingLod } from './plateau/tileset.js'
export {
  GROUND_LAYERS,
  GROUND_PIECES,
  type GroundLayerName,
  type GroundPieceName,
} from './ground/tileGeometry.js'
// The two sets the sun chooses between, and the way a page says its own colour
// in both: one value is that colour at any hour, a `{ light, dark }` pair is
// the colour in each — the type of every colour a page gives, anywhere.
// `colorFor` is how a layer of your own reads a pair — `viewer.night` says
// which half is wanted. `viewer.theme` is the one way a page changes the
// palette, and writing it replaces it.
export {
  COLOR_NAMES,
  DARK,
  LIGHT,
  colorFor,
  type ColorName,
  type Palette,
  type Theme,
  type ThemeColor,
} from './theme.js'
export { JAPAN } from './geo/japan.js'
// The heights come in real metres and the world is Mercator, stretched with
// latitude, so anything standing something on the land divides by this.
// `MapBounds` is the rectangle a page says in degrees — what `fitBounds`
// takes, what `GeoJsonLayer` gives back, and what an `ImageLayer` is laid in.
export { metersPerUnit, type MapBounds, type WorldBounds } from './geo/mercator.js'
// The other question about metres, and the one a page asks: where a place so
// many of them away is, and how many of them apart two places are. Measured on
// a sphere, which is not the one the tiles are cut on; see `geo/metres.ts`.
export { metersFrom, placeFrom } from './geo/metres.js'
