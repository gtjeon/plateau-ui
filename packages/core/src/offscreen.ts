import { cameraFar, positionView, vec4 } from 'three/tsl'
import {
  Color,
  DepthTexture,
  MeshBasicNodeMaterial,
  NoBlending,
  RenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type Node,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { outlinedBy, type OutlineNode } from './outlines.js'
import { LAND, occludes, PICTURE_ONLY } from './passes.js'

/**
 * Stands in for a material while depth alone is drawn, and writes into the
 * colour how far along the camera's look each fragment is: {@link farAlong}.
 *
 * The depth is what every pass reads on the card. The colour is for the one
 * reading done off it: a sight's cube read back so that a page can ask whether
 * a place is in sight (`Viewshed.sees`). Three gives every target a colour
 * attachment whether or not anything is written there, and a depth texture is
 * not a thing three reads back, so the number goes where the space already is.
 * The other passes — the sun's map, the corner shading's depth, the land under
 * the mask — never look at their colour, and the stand-ins are one set for
 * all of them; a second set for the sight alone would be a second shader for
 * every kind of thing in the scene.
 */
function depthOnly(): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ colorNode: farAlong() })
}

/**
 * How far along the camera's look a fragment is, as a share of its far plane,
 * in the colour's three bytes: the top eight bits of 24 in red, the next eight
 * in green, the last in blue. A byte apiece because eight-bit colour is the
 * one kind every card both draws into and reads back the same way, and three
 * of them because one is a 256th of the reach — half a metre at 120 m.
 *
 * Alpha is one, and a texel nothing was drawn into is cleared to white, which
 * reads as the far plane: nothing in the way.
 */
function farAlong(): Node<'vec4'> {
  return farAlongAt(positionView.z)
}

/**
 * {@link farAlong} of a place given by its depth along the camera's look
 * (`viewZ`, negative ahead as three's `positionView.z` is), rather than of the
 * fragment being drawn: for a material that works out for itself where on its
 * drawn shape the thing it stands for is, and stands in for itself in these
 * passes ({@link standsInAs}).
 */
export function farAlongAt(viewZ: Node<'float'>): Node<'vec4'> {
  const share = viewZ.negate().div(cameraFar).clamp(0, 1)
  const whole = share.mul(ALONG_STEPS).round()
  const high = whole.div(65536).floor()
  const middle = whole.div(256).floor().mod(256)
  const low = whole.mod(256)
  return vec4(high.div(255), middle.div(255), low.div(255), 1) as unknown as Node<'vec4'>
}

/**
 * How many steps the far plane is cut into in {@link farAlong}: what three
 * bytes hold. Read back the other way by `DistancesInHand` in `distances.ts`.
 */
export const ALONG_STEPS = 16777215

/** The stand-in for everything that leaves its corners where the geometry has them. */
let plain: MeshBasicNodeMaterial | undefined

/**
 * Materials that stand in for themselves in the passes that keep a depth, and
 * the stand-in each brings; see {@link standsInAs}.
 */
const ownStandIns = new WeakMap<Material, MeshBasicNodeMaterial>()

/**
 * Says that a material is to be drawn under `twin` wherever the scene is drawn
 * again for its depth alone — the sun's map, the corner shading's depth, a
 * sight's cube.
 *
 * For a material whose shape is not the one its corners make. One that works
 * out, fragment by fragment, where on a box it is drawn the thing it stands
 * for really is — a picture stood up by its legend (`imageExtrusion.ts`) — is
 * drawn here as the box it is drawn on unless it says what to draw instead:
 * the depth stand-ins carry what moves a corner and what cuts a fragment, and
 * neither says where inside the box the surface is. The twin is the owner's
 * to make and the owner's to let go of.
 */
export function standsInAs(material: Material, twin: MeshBasicNodeMaterial): void {
  ownStandIns.set(material, twin)
}

/** The stand-in for each material that moves its corners, made once and kept. */
const twins = new WeakMap<Material, MeshBasicNodeMaterial>()

/**
 * The stand-ins for materials that only cut fragments away, kept by the cut
 * they make and the faces they draw rather than by the material.
 *
 * A layer gives every one of its materials the same cut, so here that is one
 * shader for the whole of the ground instead of one for each kind of thing
 * on it. Those materials leave their corners alone, so there is nothing else
 * to tell them apart by.
 */
const cuts = new WeakMap<Node, Map<number, MeshBasicNodeMaterial>>()

/**
 * Whatever a material does to its corners before they are drawn, or nothing.
 *
 * Every pass that draws the scene again under materials of its own asks this,
 * so what counts as moving a corner is said in one place.
 */
export function movesCorners(material: Material): Node<'vec3'> | null {
  return (material as { positionNode?: Node<'vec3'> | null }).positionNode ?? null
}

/**
 * Whatever a material puts its corners at outright, or nothing.
 *
 * The other half of the question above. A corner moved by {@link movesCorners}
 * is still taken to the screen the way every corner is; this one is already
 * there — the material worked the projection out for itself, because where the
 * corner lands is a thing of the screen rather than of the world. A card sized
 * in pixels is the case: it keeps its size as the view zooms, which no amount
 * of moving it about the world can do.
 *
 * A stand-in that took only the first of the two would draw such a thing as
 * the bare shape its geometry holds — for a mark, the unit square its corners
 * are written as, piled at the world's nought.
 */
export function movesVertices(material: Material): Node<'vec4'> | null {
  return (material as { vertexNode?: Node<'vec4'> | null }).vertexNode ?? null
}

/**
 * Whatever a material throws fragments away by, or nothing.
 *
 * A mask cuts the picture, and a pass that did not carry it would have the
 * sun cast a shadow from a building that is not drawn and the corner shading
 * close in round one. Said here alongside moving a corner, since both are the
 * same thing: what a stand-in has to do to stand in.
 */
export function masksFragments(material: Material): Node | null {
  return (material as { maskNode?: Node | null }).maskNode ?? null
}

/**
 * Whether a material is one of three's lines: `Line2NodeMaterial`, and the
 * `ThinLineMaterial` built on it.
 *
 * Such a material puts its corners where they go in `setupPosition`, which is
 * neither of the two nodes a stand-in can carry ({@link movesCorners},
 * {@link movesVertices}): the strip is spread out of the segment's two ends
 * there, across the screen, and what the geometry holds is one unit quad per
 * segment. Under a stand-in that quad is all that is drawn — a sheet a few
 * metres high at the corner of whatever the line hangs in.
 */
function drawnAsLine(material: Material): boolean {
  return (material as { isLine2NodeMaterial?: boolean }).isLine2NodeMaterial === true
}

/**
 * Puts on a stand-in whatever its material does to its corners before they
 * are drawn, and — where the pass wants it — whatever the material cuts away.
 *
 * Redone every time rather than once, because a material may be given its own
 * faces to draw, or another way to move its corners, after it has been drawn.
 *
 * The cut is asked for rather than always carried: the one drawing that has
 * to go without it is the land on its own, whose whole purpose is to have the
 * land past where the mask ends it; see {@link uncut}.
 */
function follow(twin: MeshBasicNodeMaterial, material: Material, cut: boolean | Node): void {
  const moves = movesCorners(material)
  const puts = movesVertices(material)
  const mask = cut === false ? null : cut === true ? masksFragments(material) : cut
  twin.side = material.side
  let woven = false
  if (twin.positionNode !== moves) {
    twin.positionNode = moves
    woven = true
  }
  if (twin.vertexNode !== puts) {
    twin.vertexNode = puts
    woven = true
  }
  if (twin.maskNode !== mask) {
    twin.maskNode = mask
    woven = true
  }
  if (woven) twin.needsUpdate = true
}

/**
 * The stand-in a material already has in that set, or a new one kept there
 * and let go of with the material it stands in for.
 *
 * A stand-in outliving its material is a shader nothing will ever draw with
 * and nobody will ever free, so each one listens for the one word its material
 * says on the way out.
 */
function twinFor(
  held: WeakMap<Material, MeshBasicNodeMaterial>,
  material: Material,
  make: () => MeshBasicNodeMaterial,
): MeshBasicNodeMaterial {
  let twin = held.get(material)
  if (twin) return twin
  twin = make()
  held.set(material, twin)
  const own = twin
  material.addEventListener('dispose', () => {
    held.delete(material)
    own.dispose()
  })
  return twin
}

/**
 * Draws the scene again with every thing under a stand-in for its own
 * material, and hands the renderer back what it was doing before — even where
 * the drawing throws.
 */
function underStandIns(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
  standInFor: (material: Material, object: Object3D) => Material | null,
  face = 0,
): void {
  const drawObject = renderer.getRenderObjectFunction()
  renderer.setRenderObjectFunction(
    (object, scene, camera, geometry, material, group, lights, clipping, pass) => {
      // Null is a thing this pass has no use for, and the cheapest way to
      // leave it out is not to draw it: the target is cleared to what it
      // would have written anyway
      const twin = standInFor(material, object)
      if (!twin) return
      renderer.renderObject(object, scene, camera, geometry, twin, group, lights, clipping, pass)
    },
  )
  try {
    drawOffscreen(renderer, scene, camera, target, null, face)
  } finally {
    renderer.setRenderObjectFunction(drawObject)
  }
}

/**
 * A target the shape of the passes' own, to weave their stand-ins against;
 * see {@link weaveStandIns}. One pixel, since a pipeline is woven for the
 * shape of what it draws into and not for its size.
 */
let rehearsal: RenderTarget | undefined

/**
 * Weaves, off the frame, the shaders the passes that draw under stand-ins
 * will want for these things: the sun's map ({@link drawCasters}), the depth
 * the corner shading and the blur measure from ({@link drawDepth}) and, where
 * a mask has ended the land, the land on its own ({@link drawLand}).
 *
 * **Why.** `Viewer.weave` weaves a thing for the canvas, and a stand-in drawn
 * into a target of its own is a pipeline of its own. Three made those on the
 * spot (`createRenderPipeline`) the first time each kind of thing was drawn
 * there, and on a machine that had never built them the card stopped the
 * picture while it did. Measured 2026-11-17 on the public simple-map, opened
 * with the shader caches emptied: 18 of the page's 29 pipelines made inside a
 * frame, one frame of 1.35 s as the first things were drawn and five more of
 * 0.2 to 0.6 s as the land and the city came in — which is what someone opening
 * the page for the first time sees as the buildings stalling and then jumping
 * up. Opened again, the card has them and nothing stops.
 *
 * **How.** Three's own `compileAsync`, with the stand-in put in place of each
 * material as it walks. It walks with `renderObject` itself rather than with
 * the function a pass sets (`setRenderObjectFunction`, which {@link underStandIns}
 * uses), so `renderObject` is swapped for the length of the walk. The walk runs
 * through before the first thing `compileAsync` waits for, so the swap is in
 * place for exactly that and is put back before anything else can draw; what
 * it leaves to be built afterwards already carries the stand-in.
 *
 * The scene is put as {@link drawOffscreen} puts it — no background — and the
 * target is one of the shape every one of those passes draws into: a colour
 * of eight-bit bytes and a depth texture, one sample. Each walk sees what its
 * pass sees and no more: the depths leave out what is only laid over the
 * picture (a mark, a painted shape), and the land on its own is the land
 * alone. Walked with the viewer's own layers, they wove a stand-in for every
 * mark and every painted shape, and an uncut twin of the city and the trees,
 * that no pass ever draws — and the tiles waited on those as well (reviewed
 * 2026-11-17).
 *
 * **Not where the scene has fog.** The passes draw with the fog taken off, and
 * three reads the fog again as it builds, after the walk and after its first
 * wait, when it is back on: what was woven was a fogged stand-in no pass
 * draws, and the passes went on making theirs in the frame (reviewed
 * 2026-11-17). Fog can only be kept off for the walk — kept off any longer,
 * the frames in between draw without it — so with fog on this weaves nothing,
 * and the passes are made in the frame as they were before any of this.
 */
export async function weaveStandIns(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  things: readonly Object3D[],
  land: boolean,
): Promise<void> {
  if (scene.fog) return
  rehearsal ??= new RenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) })
  const ways: { readonly dress: (material: Material) => Material | null; readonly sees: number }[] = [
    {
      // A line is left out of the depth and casts nothing; see `drawDepth`
      dress: (material) => (drawnAsLine(material) ? null : standIn(material)),
      // As the corner shading's depth sees (`OcclusionPass`, the blur's the
      // same): the viewer's own layers bar what is only laid over the picture.
      // The sun's camera sees three's first layer alone, which is among these
      sees: camera.layers.mask & ~(1 << PICTURE_ONLY),
    },
  ]
  // As `Underground` draws it: the land and nothing else
  if (land) ways.push({ dress: uncut, sees: 1 << LAND })

  type Draw = WebGPURenderer['renderObject']
  const swappable = renderer as unknown as { renderObject: Draw }
  const ownProperty = Object.prototype.hasOwnProperty.call(renderer, 'renderObject')
  const own = renderer.renderObject
  const woven: Promise<unknown>[] = []
  for (const way of ways) {
    const was = renderer.getRenderTarget()
    const wasFace = renderer.getActiveCubeFace()
    const wasLevel = renderer.getActiveMipmapLevel()
    const { background } = scene
    const layers = camera.layers.mask
    scene.background = null
    camera.layers.mask = way.sees
    renderer.setRenderTarget(rehearsal)
    swappable.renderObject = function (this: WebGPURenderer, ...args: Parameters<Draw>) {
      // The fifth is the material, as in {@link underStandIns}
      const twin = way.dress(args[4])
      if (!twin) return
      args[4] = twin
      own.apply(this, args)
    }
    try {
      for (const thing of things) woven.push(renderer.compileAsync(thing, camera, scene))
    } finally {
      if (ownProperty) swappable.renderObject = own
      else delete (swappable as { renderObject?: Draw }).renderObject
      renderer.setRenderTarget(was, wasFace, wasLevel)
      camera.layers.mask = layers
      scene.background = background
    }
  }
  await Promise.all(woven)
}

/**
 * The stand-in to draw a thing with while depth alone is wanted.
 *
 * Three would take one material for the whole scene, and that is what the
 * passes did — but a material may put its corners somewhere other than where
 * the geometry has them, and such a material handed to the sun or to the
 * corner shading left that behind. Every tree of a tile stands on the one
 * shape its tile holds, moved into place by the material; drawn under a
 * material of the sun's own they all stood at the tile's corner, and a wood
 * cast no shadow at all.
 *
 * So each material that moves its corners gets a stand-in of its own, made
 * once and kept, that draws nothing but depth and moves them the same way.
 * The rest share one: a stand-in apiece would be a shader apiece, and those
 * are dear to weave.
 */
function standIn(material: Material): MeshBasicNodeMaterial {
  const own = ownStandIns.get(material)
  if (own) return own
  const moves = movesCorners(material)
  const puts = movesVertices(material)
  const mask = masksFragments(material)
  if (!moves && !puts) {
    if (!mask) return (plain ??= depthOnly())
    let bySide = cuts.get(mask)
    if (!bySide) cuts.set(mask, (bySide = new Map()))
    let cut = bySide.get(material.side)
    if (!cut) {
      cut = depthOnly()
      cut.maskNode = mask
      cut.side = material.side
      bySide.set(material.side, cut)
    }
    return cut
  }

  const twin = twinFor(twins, material, depthOnly)
  follow(twin, material, true)
  return twin
}

/**
 * Draws into a pass's own target which line each pixel belongs to; see
 * {@link Outlines}.
 *
 * Only what wears a line, and with the depth left out of it. A line round a
 * building is there to **find** that building — whatever is standing in front
 * of it, and from whatever angle — so what is in front must not rub it out.
 * Drawn with the depth on and everything else drawn too, the line was the
 * silhouette of what happened to be visible: a house behind another had none
 * at all, and the water in the flood page cut every line it stood in front of
 * at the waterline.
 *
 * What wears none is simply not drawn. The target is cleared to nought, which
 * is what such a thing would have written, and it has nothing else to say
 * here now that it no longer hides anybody.
 *
 * Where two that both wear one overlap, the later drawn is the one the pixel
 * says. Both are wearing a line, so what comes out is a line round the pair
 * and a line along the seam between them, which is what a reader looking for
 * either of them wants to see.
 *
 * The clear is black and clear rather than the backdrop the canvas is cleared
 * to. Cleared to the backdrop, every pixel of the sky would read as a line as
 * wide as the backdrop's own blue.
 */
export function drawShapes(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
): void {
  const colour = new Color()
  renderer.getClearColor(colour)
  const alpha = renderer.getClearAlpha()
  renderer.setClearColor(0x000000, 0)
  try {
    underStandIns(renderer, scene, camera, target, shapeIn)
  } finally {
    renderer.setClearColor(colour, alpha)
  }
}

/**
 * The stand-in that draws a thing into the lines' picture: whatever it says
 * about the line round it, or nought where it says nothing.
 *
 * Kept the way the depth stand-ins are, and for the same reason — a material
 * that moves its corners has to move them here too, or a line would be found
 * round a shape that is not where the picture has it.
 */
/**
 * What each material keeps of itself in the lines' picture: whatever it
 * already threw away, and then everything of it that wears no line.
 *
 * Thrown away rather than written as nought. A layer's things share one
 * material — the whole city wears one — so "wears no line" is a thing a
 * fragment says and not a thing a mesh says, and the depth is off here: a
 * fragment of a plain building written as nought over one that wears a line
 * punches a hole in it, and the line is found round the hole. Discarded, what
 * was underneath stands.
 */
const kept = new WeakMap<Material, Node<'bool'>>()

/**
 * The stand-ins the land wears in the lines' picture: its depth, and nought
 * for a colour.
 *
 * Not {@link depthOnly}, which writes white. Every other pass is free to
 * ignore what a depth stand-in writes — they keep the depth and nothing else
 * — and this picture reads it: white is slot 255 and a number of its own, so
 * the land came out as a thing wearing a line in a slot nobody asked for.
 * Measured: over a block of the picture every texel read as something wearing
 * a line, the land included. Nought is what the target is cleared to, which
 * is what "wears no line" is said in.
 */
const lands = new WeakMap<Material, MeshBasicNodeMaterial>()

function landIn(material: Material): MeshBasicNodeMaterial {
  const twin = twinFor(lands, material, () => {
    const made = new MeshBasicNodeMaterial({ colorNode: vec4(0, 0, 0, 0) })
    made.transparent = false
    made.blending = NoBlending
    return made
  })
  follow(twin, material, true)
  return twin
}

function shapeIn(material: Material, object: Object3D): MeshBasicNodeMaterial | null {
  // The land writes its depth and nothing else. What it hides is not another
  // thing standing in front — nothing a page did not mark hides anybody here
  // — but the part of a marked thing that is under it: a building's wall runs
  // down past its own floor to meet a slope, and a building still on its way
  // up is under the land altogether. Neither is on screen, and a line round
  // either is a line round nothing anyone can see. Measured before this: over
  // eighty pixels of a hillside the screen had only land, and the picture had
  // buildings in two bands of it.
  if (object.layers.isEnabled(LAND)) return landIn(material)
  const line = outlinedBy(material as { outlineNode?: OutlineNode | null })
  // Nothing of this material wears a line, and it is no longer here to hide
  // whoever does; see {@link drawShapes}.
  if (!line) return null
  const twin = twinFor(shapes, material, () => {
    const made = new MeshBasicNodeMaterial()
    made.transparent = false
    // The depth is kept, and what it settles is only ever which of two
    // *marked* things owns a pixel they share — nothing else is drawn here
    // any more, so a building, a sheet of water, anything the page did not
    // mark, hides nobody. Without it the owner would be whichever was drawn
    // last, which is an order nobody chose and which can put the far one in
    // front.
    made.depthTest = true
    made.depthWrite = true
    // Not blended, which is what this picture wants anyway — a slot and a
    // number are written, not mixed — and what keeps the fourth byte. Three
    // takes a material that is opaque, normally blended and not covering by
    // alpha to be one whose alpha nobody reads, and writes one over whatever
    // it was asked for (`NodeBuilder.isOpaque`). Here that byte is how wide
    // the line is: written over with one, every line came out 255 wide, the
    // fade never had a pixel to happen in, and the line ended wherever the
    // looking stopped — a hard edge at the search's own reach (measured: 99.8
    // of every 100 pixels of line were at full strength).
    made.blending = NoBlending
    return made
  })
  const colour = line as unknown as Node<'vec4'>
  if (twin.colorNode !== colour) {
    twin.colorNode = colour
    twin.needsUpdate = true
  }
  let keep = kept.get(material)
  if (!keep) {
    // A slot is written as nought to one over a byte, so the smallest a thing
    // wearing a line can say is a 255th
    const wears = colour.x.greaterThan(0.001) as Node<'bool'>
    const already = masksFragments(material) as Node<'bool'> | null
    keep = (already ? already.and(wears) : wears) as Node<'bool'>
    kept.set(material, keep)
  }
  follow(twin, material, keep as Node)
  return twin
}

/** The stand-in for each material while the lines' picture is drawn. */
const shapes = new WeakMap<Material, MeshBasicNodeMaterial>()

/**
 * The stand-ins for drawing the land on its own, which are the plain ones with
 * the mask left off.
 *
 * The whole point of that drawing is to have the land where the mask ends it,
 * so the one thing a stand-in must not carry here is the cut. What moves the
 * corners it does carry: a sheet whose corners are put somewhere by a node is
 * somewhere else without it, and a depth taken of the wrong place hides the
 * wrong thing.
 */
const bared = new WeakMap<Material, MeshBasicNodeMaterial>()
let bare: MeshBasicNodeMaterial | undefined

function uncut(material: Material): MeshBasicNodeMaterial {
  if (!movesCorners(material) && !movesVertices(material)) return (bare ??= depthOnly())
  const twin = twinFor(bared, material, depthOnly)
  // Without the cut, which is the whole point of this drawing
  follow(twin, material, false)
  return twin
}

/**
 * Keeps the depth of whatever the camera's layers let through, with no mask.
 *
 * {@link drawDepth} with the cut left out, for the one reading that is asked
 * for because the cut exists; see `underground.ts` and {@link LAND}.
 *
 * Says whether anything was drawn at all. A viewer whose land a page has put
 * out (`ground: { visible: false }`) still has a mask, and a reader taking the
 * cleared texture for land at the far plane would answer for ground that is
 * not there; see `Underground.landDrawn`.
 */
export function drawLand(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
): boolean {
  let drew = false
  underStandIns(renderer, scene, camera, target, (material) => {
    drew = true
    return uncut(material)
  })
  return drew
}

/**
 * Draws the depth of whatever casts a shadow, for the sun to read.
 *
 * {@link drawDepth} with three's own question asked of each object first:
 * `castShadow`, the same flag `ShadowBaseNode.getShadowRenderObjectFunction`
 * tests in three's own shadow pass, and tested here for the same reason — so
 * that a page which stands a mesh in the city turns its shadow on the way it
 * would anywhere else in three, and so that a mesh which says no has no shadow
 * rather than an unasked-for one.
 *
 * Asked of the object and not of its parents, which is also three: a group is
 * not a caster and setting the flag on one says nothing about what hangs under
 * it.
 *
 * And nothing else is asked. A thing that closes in no corner (`setOccludes`)
 * is drawn here like anything else that casts: the corner shading and the sun
 * are two questions, and a page answering one has not answered the other.
 *
 * Why not three's own shadow pass, which would ask this for us: three draws it
 * under one override material and carries only some of what a material does to
 * its corners onto it — `positionNode` and `maskNode`, through
 * `Renderer._getShadowNodes`, but not `vertexNode` — and it flips the faces it
 * draws, `FrontSide` for `BackSide` (`_shadowSide`), which moves every depth in
 * the map by the thickness of what wrote it. The stand-ins here carry all three
 * and keep the faces.
 *
 * Writing the far faces instead — three's own rule, and second-depth shadow
 * mapping — was tried on 2026-10-07 and taken out again: it left the creases it
 * was for exactly as they were, and a roof lip's cast shadow lost its own
 * thickness and broke into dashes. `CLAUDE.md`, 계약 11 has that and the three
 * other answers measured against the one in `shadows.ts`.
 */
export function drawCasters(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
): void {
  underStandIns(renderer, scene, camera, target, (material, object) =>
    object.castShadow ? standIn(material) : null,
  )
}

/**
 * Draws the scene again into a pass's own target, keeping how far off each
 * thing that closes in a corner is and nothing else — the depth the corner
 * shading is measured from.
 *
 * Every thing is drawn under a stand-in for its own material, so whatever a
 * material does to its corners is done here too and the depth is the depth of
 * what is on screen.
 *
 * Nothing is asked about casting here. The reader is the shading of corners,
 * and that is not a shadow: a mesh told not to cast still closes in the corner
 * it stands in. Only the sun asks that; see {@link drawCasters}. What is asked
 * is the shading's own question, `occludes` — a thing a page said closes in
 * nothing is left out here and only here, so the shading is measured as though
 * it were not standing there; see `setOccludes` for the rest of what that
 * means and why it is asked of the object rather than said with the camera.
 *
 * **A line is left out too, by its material** ({@link drawnAsLine}). It closes
 * in no corner — it is ink on what it is drawn over, which is here already —
 * and drawn here it would be the sheet that function describes, standing at a
 * tile's corner and shading the street round it. The land's own lines are what
 * ask: since 2026-10-29 they are on the default layer with the rest of the
 * land, so that a page's picture can go over them, and this camera sees that
 * layer. Not said with `setOccludes`, which also holds a thing back until the
 * shading has been multiplied — the very drawing the lines left so as to be
 * under the page's things.
 */
export function drawDepth(renderer: WebGPURenderer, scene: Scene, camera: Camera, target: RenderTarget): void {
  underStandIns(renderer, scene, camera, target, (material, object) =>
    occludes(object) && !drawnAsLine(material) ? standIn(material) : null,
  )
}

/**
 * Draws the scene again into one face of a sight's cube, keeping how far off
 * each thing is: {@link drawDepth} without the corner shading's own question.
 *
 * A thing a page took out of the shading (`setOccludes`) still stands in the
 * way of a line of sight — it is out of one effect, and a solid thing in every
 * other way. Drawn through `drawDepth`, a city told `occludes: false` let every
 * viewshed see through every building. A line is still left out, for the
 * reason {@link drawnAsLine} gives.
 */
export function drawDistances(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
  face: number,
): void {
  underStandIns(renderer, scene, camera, target, (material) => (drawnAsLine(material) ? null : standIn(material)), face)
}

/**
 * Draws the scene again into a pass's own target, to be read rather than
 * shown: no background, no fog, and every shape under `material` when one is
 * given.
 *
 * The fog goes for the same reason the background does — what is drawn here is
 * read and not looked at. Three folds a scene's fog into the output of every
 * node material, the stand-ins included (`NodeMaterial.setupFog`), and these
 * targets hold numbers: a slot in the lines' picture, a building's id under the
 * pointer. Mixed towards a colour by distance they would both be wrong, and
 * the further off the wronger. Depth is the one that would not care.
 *
 * It costs no second shader. Three hangs the fog on the shader's cache key
 * (`NodeManager.getCacheKey`), so a material drawn both ways is woven twice —
 * but a stand-in is only ever drawn here, and what the canvas draws is never
 * drawn here, so each is woven the one way it is used.
 *
 * A cube's target takes a `face` as well, since one drawing fills one of its
 * six sides and the six are drawn one after another.
 *
 * Afterwards the scene is as it was and the renderer draws where it was
 * drawing before, even when drawing fails part way. Where it was before and
 * not the canvas: this is the one place the undoing lives, so what it hands
 * back has to be what it found. The case is a caller with a target of its own
 * already bound that calls this inside it: handed the canvas back, the rest of
 * its own drawing would go to the canvas. Nothing nests that way today — every
 * caller is reached from the frame, with the canvas bound — so this changes no
 * picture now and is a promise to the first caller that does.
 */
export function drawOffscreen(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
  material: Material | null = null,
  face = 0,
): void {
  const background = scene.background
  const fog = scene.fog
  const override = scene.overrideMaterial
  const { autoClear } = renderer
  const was = renderer.getRenderTarget()
  const wasFace = renderer.getActiveCubeFace()
  const wasLevel = renderer.getActiveMipmapLevel()
  scene.background = null
  scene.fog = null
  if (material) scene.overrideMaterial = material
  renderer.setRenderTarget(target, face)
  // The drawing clears the target as it begins. A clear of its own before it
  // would be a pass of its own, writing what the drawing then clears again.
  renderer.autoClear = true
  try {
    void renderer.render(scene, camera)
  } finally {
    renderer.autoClear = autoClear
    renderer.setRenderTarget(was, wasFace, wasLevel)
    scene.overrideMaterial = override
    scene.fog = fog
    scene.background = background
  }
}
