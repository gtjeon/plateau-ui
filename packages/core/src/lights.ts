import { Color, DirectionalLight, Group, HemisphereLight } from 'three/webgpu'
import { SunShadow } from './shadows.js'
import { DEFAULT_ANGLE, directionOfSun, type Lit } from './sun.js'
import type { Palette } from './theme.js'

/**
 * The light on the scene. Three's, and the only one there is.
 *
 * There are two sources and no more: a sun that comes from one direction and
 * casts, and a fill that comes from every direction and does not. Between them
 * they are the whole of what a face has on it, and every material in this
 * library is a material that reads them. Nothing multiplies a colour by a
 * shade any more.
 *
 * **Where the shadow comes in.** The sun casts, and it does so through one
 * shadow map of this library's own ({@link SunShadow}) rather than three's,
 * because this one is aimed at *what is on screen* and three's is aimed at the
 * light. It reaches three the way three asks for a shadow — as
 * `sun.shadow.shadowNode`, which `AnalyticLightNode.setupShadow` multiplies
 * into the light's colour for every material whose mesh receives. So the sun is
 * simply dark where something blocks it, everything downstream reads a sun that
 * has been cut, and nothing has to know there is a map.
 *
 * It is the smallest map that draws a shadow at all — one map, one aiming, and
 * five readings on a disk round each place. No cascade, and nothing about any of
 * it in `ViewerOptions`: the four numbers the reading is made of sit on the node
 * ({@link SunShadow.lift}, `plane`, `spread`, `taps`), where the playground
 * turns them and a page need never look. Four larger answers were built before
 * this one and taken out again, and one of them came back in a smaller shape;
 * see `CLAUDE.md`, 계약 11, and `shadows.ts` for what this one is known to get
 * wrong.
 *
 * **Why the fill answers by direction.** A face turned from the sun takes nought
 * from it — that is Lambert, and there is no folding it in half any more — so
 * something has to be there or the far side of every building is black. That
 * something is a hemisphere: `palette.shadow` overhead, which is the palette's
 * word for what the sun does not reach, and that same colour bounced off the
 * land underneath. Why it is weighed by where a face looks, and why the ambient
 * it was until 2026-10-08 came apart after sunset, is on {@link Lights.fill}.
 *
 * **It was an environment until 2026-10-07**, which is a different thing again:
 * a gradient built from `backdrop` overhead down to `surface` underfoot, handed
 * to `scene.environment`. That answered by direction too, and it gave a page's
 * own metal something to reflect. What was wrong with it was not the picture.
 * There is no sky here — `backdrop` is the colour of the empty space a page sees
 * where no tile has arrived, which is a thing about the interface and not about
 * the light, and a map that borrowed it to light its walls could not be given a
 * shadow colour of its own without moving it. So the two it borrowed are given
 * back, and a light answers by direction where an environment used to, at none
 * of an environment's cost. What is still paid is the reflecting: a page's metal
 * reads as a matte of its own colour until something is put in
 * `scene.environment` on purpose.
 *
 * **The two ends.** They are pinned by one rule, which is the heir of the old
 * shading's `level`: *a surface lying flat, face up, in full light takes
 * exactly one* — **at {@link DEFAULT_ANGLE}'s height, and there alone**. So
 * what the palette says is what such a surface is under the light this map was
 * drawn for — the paper of the map, a road, a roof — and every other face, and
 * every other hour, is some fraction of it. Which end carries how much is what
 * `shading` says: the fill carries all of it at nought and {@link
 * FILL_AT_NOON} of it at one, and the sun carries the rest. The sun's colour is
 * worked out as *the rest*, per channel, so the two always add to white however
 * the shade is tinted — a blue shade leaves a warm sun, exactly as the old
 * shading did.
 *
 * **Those four words were not there until 2026-10-08.** The rule used to hold
 * at every height, and it was kept there by dividing the sun by the sine of its
 * own elevation — so a sun 26° up was driven 2.26 times as hard to leave a flat
 * roof where the palette wanted it. A wall takes the cosine where a roof takes
 * the sine, so everything that drive added went to the walls: at that height a
 * wall square to the sun took `cot 26°` — twice the roof — and a white one has
 * no headroom, so it sat in the tone curve's shoulder with the roof a few steps
 * under it and the city read as one sheet. Lower the brightness to put that
 * right and the roofs, which are most of what a map from above shows, went
 * dark with it. One number could not answer both, because what parted them was
 * not the light but the hour.
 *
 * So the sun is no longer divided by its own height but by the reference one,
 * and its strength no longer moves with the clock. What moves is what each face
 * catches, which is what moves outdoors: the real sun does not grow stronger as
 * it sinks — the air takes more of it, so this is still the generous reading.
 * A low sun now draws a dimmer city, which is true of a winter morning, and
 * above 45° the roofs come out over the walls on their own, since `cot` passes
 * under one there. Dusk comes off better too: the ground used to hold the
 * palette's colour until the sun crossed the horizon and then drop, and now it
 * fades out with the sine.
 */

/**
 * The height the light is normalised at: how much of the sun a flat face up
 * takes when it stands where {@link DEFAULT_ANGLE} puts it.
 *
 * The one place the palette's colours are exactly what a flat lit surface
 * draws. Every other hour is read against it, and that is the point — see the
 * head of this file.
 */
const REFERENCE = Math.sin((DEFAULT_ANGLE.elevation * Math.PI) / 180)

/**
 * How much of a flat lit surface's light comes from the fill when the sun is at
 * full strength.
 *
 * It is the one number that says how hard the picture reads, and the face it
 * still describes exactly is a flat one: a surface lying face up in cast shadow
 * keeps the fill and nothing else, so it comes out at exactly this.
 *
 * **A wall does not, since 2026-10-08.** The fill answers by direction now
 * ({@link Lights.fill}), so a vertical face takes the midpoint of the sky and
 * the ground's bounce rather than the sky whole: against the sky's own level,
 * 0.97 of it under `LIGHT`, whose ground is near-white paper, and 0.52 under
 * `DARK`, whose ground has almost nothing to give back. Read off three's
 * weighting and the palette's reflectances — arithmetic, not a screen — so
 * anyone carrying this number elsewhere should work the wall out rather than
 * read it off here.
 *
 * Measured against the picture this replaces, where a wall turned fully from
 * the light came out at 0.63 of white and one in cast shadow at 0.52: a wrapped
 * half-Lambert keeps a quarter of its range on a face at a right angle to the
 * light, and a plain one keeps none, so the walls are bound to part further
 * here than they did. Set to leave the cast shadow where it was and let the
 * walls go where Lambert puts them.
 */
const FILL_AT_NOON = 0.52

/** Rec. 709, which is the weighting three's own colour management works in. */
function level(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

export class Lights {
  /** The sun, for the viewer to put in the scene; a layer never does (contract 1). */
  readonly root = new Group()

  /**
   * What a face the sun has left is lit by, casting nothing — and **answering
   * by direction**: the sky above, the ground's own bounce below.
   *
   * Its sky colour is `palette.shadow` and its level is worked out beside the
   * sun's in {@link set}, so the two always come to the same whole. Read it; do
   * not write it, for the reason the sun says.
   *
   * **A hemisphere and not an ambient** (2026-10-08). An ambient answers one
   * number in every direction, so a roof, a wall and the road take exactly the
   * same light from it. That is harmless while the sun is up — the sun is what
   * shapes the picture and the fill only fills — but **after sunset there is no
   * sun**, the fill is the whole of the light, and a city lit by one number is
   * a city with no faces: every surface the same value, and the only thing left
   * making shape is the corner shading, which then has to carry a job it was
   * never meant for and reads as dirt rather than as form.
   *
   * Three weighs this one by where the face looks
   * (`HemisphereLightNode.setup`: `mix(ground, sky, N·up × 0.5 + 0.5)`) — full
   * sky looking up, halfway at a wall, the ground's colour looking down. So
   * roofs part from walls with no light from anywhere in particular, which is
   * what the night needed and what `CLAUDE.md`'s "하늘은 한 가지 색이 아니라
   * 방향으로 답한다" asks for. It is the same idea as the PMREM sky that was built
   * and taken out in 2026-10-07, at none of the cost: a light, not an
   * environment — no texture, no cube, nothing folded into every material's
   * shader.
   *
   * **The pinned end does not move.** Contract 11 fixes "a face lying flat,
   * looking up, taking all of it" at exactly 1, and that face looks straight
   * up — it takes the sky colour whole, which is the number the ambient gave
   * it. What changed is walls, which now take less. Measured in arithmetic
   * rather than on screen: at `N·up = 0`, half of the gap between sky and
   * ground.
   */
  readonly fill = new HemisphereLight(0xffffff, 0x000000, Math.PI)

  /**
   * The sun: three's own `DirectionalLight`, the one that lights the scene.
   *
   * Its colour and its intensity are three's own uniforms — nothing here
   * stands in front of them, so an inspector reads the light the scene is
   * actually drawn with, and so does a page.
   *
   * **Read it; do not write it.** {@link set} writes all three of its colour,
   * its intensity and its position from the sun the page asked for and the
   * palette, every time either changes, and it works them out together: the
   * two ends of the light are pinned so that a flat lit surface comes out at
   * the palette's own colour, and the sun's colour is whatever the fill is
   * short of. A page turning this up moves one end and not the other, and the
   * land stops being the colour it is written as. {@link Viewer.sun} is where
   * a page says what the light is doing.
   */
  readonly sun = new DirectionalLight(0xffffff, Math.PI)

  /**
   * Where the sun's shadow falls, and the owner of the map it is read from.
   *
   * Made here because it hangs itself on the light — `sun.castShadow` and
   * `sun.shadow.shadowNode`, both of which three reads once as it builds the
   * node for the light — so the light and the shadow cannot be assembled apart.
   * The viewer aims it and draws it; see {@link SunShadow}.
   */
  readonly shadows = new SunShadow(this.sun)

  constructor() {
    // On every layer, so that no pass can lose it. Three gathers a scene's
    // lights per pass, through the same `layers.test` as everything else
    // (`Renderer._projectObject` pushes a light only inside the visible
    // branch), and which lights were gathered goes into the shader's cache key
    // — `RenderObject.getDynamicCacheKey` folds in the `LightsNode`'s, which
    // hashes each light's id. So a pass that narrows the camera to one layer
    // and finds none of them asks for a different shader than the pass beside
    // it: the viewer's last render (`camera.layers.set(PICTURE_ONLY)`) and
    // `Underground`'s (`set(LAND)`) both clear layer 0, and every material
    // drawn there would be woven a second time — inside the frame it is first
    // drawn in, which is the second `weave` exists to spend off-frame.
    this.sun.layers.enableAll()
    this.fill.layers.enableAll()
    this.root.add(this.sun, this.fill)
    // A directional light is read as its position less its target's, and the
    // target is left where it was made — the world's nought, never put in the
    // scene, so its matrix stays the identity and the position is the
    // direction. See `set`.
  }

  /**
   * @internal The viewer's; a page reads these lights and sets the sun (contract 11).
   *
   * Follows the light and the palette, which are one thing here: how bright
   * the fill is depends on how much of the light the sun is carrying, and what
   * colour it is depends on the palette.
   *
   * Called wherever the viewer hands either over, so the sun and the fill
   * cannot disagree about how much light there is between them.
   */
  set(lit: Lit | null, palette: Palette): void {
    const angle = lit?.angle ?? DEFAULT_ANGLE
    // Where the sun stands, which is worth writing even where there is no light
    // to give: the colour below is black then and the picture cannot tell, but a
    // light left pointing at last hour's sun is a thing to puzzle over in an
    // inspector, and `viewer.lights.sun` is open for that reading (계약 11).
    //
    // One page reaches the fallback, and it is the one with no sun at all
    // (`sun: null`) — there is no angle to be had and this is as good a place
    // to point as any. Every hour that *has* a sun arrives here carrying its
    // own angle, midnight included: `Viewer.litNow` keeps it and `risen` below
    // is what makes the hour nought, so the direction is always the real one.
    // It did not used to be — a dated midnight arrived as null and pointed
    // 52° into the south-east, where the sun is not.
    const towards = directionOfSun(angle)
    // Which way the light comes from is where it stands, since its target is
    // left at the world's nought and never put in the scene: three reads a
    // directional light as its own place less its target's, so the place is the
    // direction.
    this.sun.position.copy(towards)

    /*
     * Whether there is a sun to divide the light with at all.
     *
     * Asked of `down` rather than of `lit` being there, because the two part
     * for an angle a page wrote itself: a dated sun below the horizon arrives
     * here as no light (`Viewer.litNow`), while `{ by: 'angle', elevation: -10 }`
     * arrives as an angle, and an angle under the horizon is still a sun that
     * has set. Read it the first way and the two midnights are lit differently
     * — the dated one hands the fill all of the light, the written one hands
     * it `FILL_AT_NOON` of it, and the dark palette, which is chosen by `down`
     * either way, is drawn at half the light it was picked for. Measured in
     * arithmetic: DARK `surface` comes out #0a0e14 instead of #1b1f25.
     *
     * One threshold, written in `sun.ts` and read here, is also what lets the
     * sun below be nought without a second guard of its own.
     */
    const risen = lit !== null && !lit.angle.down
    const strength = risen ? lit.shading : 0
    // What a flat face looking straight up is to take from the fill
    const share = 1 - strength * (1 - FILL_AT_NOON)

    /*
     * The fill, in the palette's own shadow colour, held to that share.
     *
     * The hue is the palette's and only the level is ours, so a page that asks
     * for a blue shade gets a blue shade and the map does not get darker for
     * saying so. Scaled by its own luminance for that reason: what `share`
     * counts is how much light there is, not how blue it is.
     */
    const tint = new Color(palette.shadow)
    const lum = level(tint)
    const scale = lum > 0 ? share / lum : 0
    const fill = tint.clone().multiplyScalar(scale)
    this.fill.color.setRGB(fill.r, fill.g, fill.b, 'srgb-linear')
    /*
     * And what comes back up off the ground: the same fill, once reflected.
     *
     * One bounce, and the palette already holds what it bounces off — a
     * surface's colour there *is* its reflectance (see `theme.ts`), so the
     * product is the whole of the arithmetic. It needs no number of its own
     * and it lands where it is wanted by itself: a pale ground gives nearly
     * the fill back, so a wall in daylight hardly moves, and the dark set's
     * near-black ground gives almost nothing back, so at night a wall drops
     * well under a roof. Both are what the eye expects of those two grounds.
     *
     * The palette's ground and not the one actually drawn, which are two
     * things where a page has styled the land: `ground.surface.color`
     * hands its colour to the ground's own materials and leaves
     * `viewer.colors` as the theme set it, so a page that lays earth over a
     * light map still gets the bounce of white paper. Left as it is because
     * the alternative is the light reaching into a layer for a colour — and
     * a page may draw the ground with a layer of its own, which has no such
     * colour to reach for. What a page can do instead is move the whole set
     * (`viewer.theme`), which this does follow.
     *
     * Multiplied channel by channel in the working space, which is where both
     * of these already are — `new Color(hex)` leaves sRGB behind on the way in.
     */
    const bounce = new Color(palette.surface)
    this.fill.groundColor.setRGB(fill.r * bounce.r, fill.g * bounce.g, fill.b * bounce.b, 'srgb-linear')
    this.fill.intensity = Math.PI

    /*
     * And the sun is the rest.
     *
     * A flat face up takes `fill` from the fill and sin(elevation) of the sun's
     * colour from the sun — that second is Lambert over three's own π, which is
     * why the intensity is π and the colour below is the irradiance wanted. The
     * two are made to come to white, so such a face lands at one *when the sun
     * stands at {@link REFERENCE}* and the palette's colour is what it draws.
     *
     * Divided by that height and not by the sun's own, which is the whole of
     * the change made on 2026-10-08 and the reason the head of this file says
     * "and there alone". Dividing by its own held every hour's roof at the
     * palette's colour by driving the sun harder the lower it stood, and the
     * walls — cosine where a roof is sine — collected all of that drive. The
     * long of it is up top.
     *
     * Per channel, so the sun makes up whatever hue the fill is short of. A
     * blue shade leaves a warm sun, which is what the old shading did and what
     * the light outside actually does.
     *
     * Held at nought where the fill is already over the top in some channel,
     * which a very saturated shade can do. A negative light draws nothing a
     * reader could read. Nought below the horizon too, and that is `risen`
     * above rather than a height of its own: the guard that used to stand here
     * was `sin(elevation) > 1e-3`, left over from when this line divided by
     * that sine, and it put the horizon 0.057° up — a sliver in which `down`
     * said day, the palette stayed light and the sun was black.
     */
    // Wound up or down, which is the one place a page's `brightness` is read.
    // On the sun and not on the fill, so that what moves is the faces the sun
    // reaches: a roof that glares is the complaint this answers, and a wall it
    // has left has nothing to do with it. The hue is untouched, since all
    // three channels take the same factor.
    const lamp = risen ? lit.brightness / REFERENCE : 0
    this.sun.color.setRGB(
      Math.max(1 - fill.r, 0) * lamp,
      Math.max(1 - fill.g, 0) * lamp,
      Math.max(1 - fill.b, 0) * lamp,
      'srgb-linear',
    )
    this.sun.intensity = Math.PI
  }

  /** @internal The viewer's, as it goes. */
  dispose(): void {
    // The map goes with the light it was drawn for
    this.shadows.dispose()
    this.sun.dispose()
  }
}
