import {
  diffuseColor,
  float,
  mix,
  specularColor,
  specularColorBlended,
  specularF90,
  transformNormalToView,
  vec3,
} from 'three/tsl'
import {
  MeshStandardNodeMaterial,
  type MeshStandardNodeMaterialParameters,
  type Node,
  type NodeBuilder,
  type NodeMaterial,
} from 'three/webgpu'
import { asReflectance, beforeTheCurve } from './tone.js'

/**
 * The material everything solid in this library is drawn with.
 *
 * **Why one door.** Which material a thing wears decides what light reaches it,
 * and a map where the roads read one lighting model and the walls another is a
 * map with two suns in it. So the choice is made once, here, and the land, the
 * city, the trees, the models, the solids and a page's painted shapes all
 * come through it.
 *
 * **Why Standard and not Lambert.** Lambert is the cheaper answer and the
 * obvious one for a matte map: `MeshLambertNodeMaterial` is three's Phong with
 * the specular turned off, so it costs a dot product and nothing else.
 *
 * The point that used to decide it is gone, and this says so rather than
 * leaving the old reason standing. Until 2026-10-08 the fill was
 * `scene.environment`, which `NodeMaterial.setupEnvironment` hands to physical
 * materials alone — Lambert and Phong read only an `envMap` written on the
 * material itself, and then as a *reflection* through
 * `BasicLightingModel.finish` rather than as light. The sky being the whole of
 * what a face turned from the sun has on it, a Lambert map drew the far side of
 * every building black. Measured then, at the default view of 中野駅 at z18.3 in
 * a 1440×900 window, with Lambert in this line and nothing else changed: a
 * wall turned from the sun came out `#000000` and a tree's far side `#000000`
 * where Standard drew `#b6b6b7` and `#647c54`, and the lit faces lost the sky's
 * share with them, the ground falling from `#e8ebef` to `#aaacaf`. Those
 * readings are of that fill and not of this one.
 *
 * The fill is a `HemisphereLight` now (`lights.ts`), which is a light like any
 * other: three adds it into `builder.context.irradiance`, and
 * `PhongLightingModel.indirect` — the model `MeshLambertNodeMaterial` sets up,
 * with the specular forced off — reads that term the way the physical model
 * does. So a Lambert city would take the same sky on the same faces. Read off
 * three's source, not drawn.
 *
 * What keeps Standard is that there is nothing to win by moving. Measured at
 * the same view: Standard 99 fps against Lambert's 110, a longest frame of 16ms
 * against 13, both against a display that will not go past about 120 anyway.
 * The frame is bound by how many times the scene is drawn, not by the lighting
 * model inside one of those draws, and the city's own colour is a picture
 * thrown down on it, the window paint, the styles, the decals and a sight
 * before any light reaches it. And `scene.environment` reaches a Standard map alone, so
 * moving would close the one door a page has for putting a sky of its own on
 * the library's own surfaces.
 *
 * **Rough, matte, and not metal.** A map is paper and concrete. At metalness
 * nought the albedo is the albedo and nothing is tinted by a reflection, and
 * at roughness one there is no highlight to speak of. What is left is three's
 * dielectric floor — every standard material reflects four parts in a hundred
 * of whatever is around it, whatever colour it is — and that is turned off
 * here; see {@link SolidMaterial.setupSpecular}.
 */
/**
 * Named apart from the `Solid` a page stands on the map (`SolidLayer.ts`),
 * which is a thing and not what a thing is drawn in. Both were `Solid` in the
 * public declarations, and a page importing the two had a thing and a
 * material under one name.
 */
export class SolidMaterial extends MeshStandardNodeMaterial {
  /**
   * Whether the colour written on it is the colour it is to *show* rather than
   * the light it gives back. Set by {@link keepsItsColor}, never by hand.
   *
   * Read when the shader is woven, which is why it is a field and not a node:
   * the answer cannot change for the life of the material, and a material that
   * changed its mind would want weaving again at about a second.
   */
  ownColour = false

  /**
   * The picture thrown over the map, as rgb and how much of it falls here, or
   * null where none is thrown on this surface; see `projection.ts`.
   *
   * Given by {@link Projection.cast} before the first drawing, for the reason
   * {@link ownColour} is a field: a material that took one later would want
   * weaving again at about a second. Whether a projector is on at all, and
   * what it throws, are uniforms inside this node and cost nothing to change.
   */
  cast: Node<'vec4'> | null = null

  /**
   * What one place can see, as rgb and how much of it lands here, or null
   * where no sight is painted on this surface; see `sight.ts`.
   *
   * Given by {@link Sight.paint} before the first drawing, for the reason
   * {@link cast} is. Laid over the thrown picture, since the sight is an answer
   * a page asked for and the picture is the map it asked it on.
   */
  sight: Node<'vec4'> | null = null

  /**
   * No sheen at all.
   *
   * Three gives every standard material a dielectric reflection of four parts
   * in a hundred (`MeshStandardNodeMaterial.setupSpecular` writes a flat 0.04
   * and a grazing response of one). It is right for a thing in a room and
   * wrong for a map, and the dark palette is where it shows. Measured: with
   * it on, a surface takes 0.020 to 0.024 of linear light that has nothing to
   * do with its own colour — the sky reflected off it — and the dark set's
   * ground is 0.010 of linear light all told. So the whole dark map came out
   * at twice its own brightness and most of the way to grey: `#1b1f26` drew
   * `#2e3035`, `#2c323c` drew `#3c4048`, and no albedo could have been chosen
   * to put them back, since the floor alone was over the number wanted.
   *
   * Turned off, the indirect term goes with it — three's `computeMultiscattering`
   * folds both of these into one `FssEss`, and with them at nought the diffuse
   * gets back the share that was being held for the specular as well. What is
   * left of the direct sun's lobe is a grazing fresnel with no colour behind
   * it, which is the one place a dielectric really is a mirror.
   *
   * Three has no flag for this. `metalness` and `roughness` do not reach it,
   * and `ior`, which would, belongs to `MeshPhysicalNodeMaterial` and brings
   * a much wider shader with it. The method is the hook three leaves, and the
   * properties are its own.
   */
  override setupSpecular(): void {
    specularColor.assign(vec3(0))
    specularColorBlended.assign(vec3(0))
    specularF90.assign(float(0))
  }

  /**
   * The colour, taken back through the frame's tone curve where it is a colour
   * to show rather than a reflectance.
   *
   * Here and not on `colorNode`, because `colorNode` is not the whole colour:
   * three multiplies the vertex colours and the map onto it afterwards
   * (`NodeMaterial.setupDiffuseColor`), and a solid carries its colour
   * entirely on its corners. What has to come out as asked is what all of them
   * come to, which is this.
   *
   * **And held to reflectance one where the light is going to multiply it.**
   * The inverse of a compressive curve has no ceiling: `#f6f9fd`, which is the
   * colour a solid falls back to, comes back as (3.48, 3.62, 3.81), and
   * `#ffffff` as 58.16 a channel. A surface giving back fifty-eight times what
   * it is given is past the curve's knee on every face it has, so the shading
   * flattens to nothing — worked through three's `neutralToneMapping` with the
   * two ends of the light as `lights.ts` pins them, a ball-shaped `Solid` at
   * that colour ran `#f6f9fd` lying flat in full light and `#f1f5fa` in
   * full cast shadow, five steps of red and three of blue over the whole of
   * it, and a white one came to 255 everywhere, inside a shadow included.
   * Brought down by its own peak it runs `#e6eaf0` to `#aeb1b5` instead, which
   * is 56 steps of red and within two of what the land beside it draws from
   * the same number. Arithmetic, not a screen reading.
   *
   * Scaled by the peak rather than clamped per channel, so a colour that is
   * brought down keeps its hue — the same gamut map `reachAt` makes for a
   * colour too saturated for the curve to reach, and the honest answer where
   * there is no exact one. What it costs is the top of the range: a page asking
   * for `#ffffff` is drawn `#f0f0f0`, which is what reflectance one draws and
   * what the city's own white wall has always drawn (`theme.ts`, `wall`).
   *
   * Nothing is held back where the material is unlit, which is {@link glows}:
   * there the value goes straight out and the curve over the frame puts the
   * asked colour on the screen exactly. `this.lights` is read as the shader is
   * woven, which is where that question is settled for good.
   */
  override setupDiffuseColor(builder: NodeBuilder): void {
    super.setupDiffuseColor(builder)
    // Held to one where it is blended too, lit or not: three blends before the
    // curve, so the bare inverse of a light colour takes the whole sum and a
    // see-through solid that carries its own light would draw as opaque as a
    // full one — the ceiling `asReflectance` gives every blended colour (see
    // `tone.ts`). A material is see-through or not for good: `transparent` is
    // read here, as the shader is woven, and a solid that turns see-through
    // wears another material (`SolidLayer.materialFor`).
    const written = this.lights || this.transparent ? asReflectance : beforeTheCurve
    if (this.ownColour) {
      diffuseColor.rgb.assign(
        written(diffuseColor.rgb as unknown as Node<'vec3'>) as unknown as Parameters<
          typeof diffuseColor.rgb.assign
        >[0],
      )
    }
    // The thrown picture goes on over the surface's own colour rather than
    // multiplying it: a published legend is the colour it is, and a wall that
    // tinted it would read as a band the legend does not have.
    //
    // **Used as it is, where a page's own colour is taken back through the
    // curve first.** A texel is taken as a reflectance, the way the palette's
    // numbers are (what is made 6): a face lying flat in full daylight takes
    // in exactly the texel, and a wall takes its share of it like any other
    // wall. Taken back through the curve instead, every pale band came out
    // saturated — that inverse has no ceiling, so holding it to reflectance
    // one divides by the brightest channel and a pastel loses the two
    // channels that made it pale. Measured over 由比ヶ浜: the map's pale pink
    // drew the town pillar-box red while the ground beside it stayed pink.
    //
    // **What reaches the screen is that texel through the frame's curve**, as
    // for every lit face, and so not the published colour itself. The
    // palette's numbers were walked back in `theme.ts` to land on the colours
    // they name; a texel has nobody to do that for it, and the inverse above
    // is why it is not done here. By arithmetic off three's
    // `neutralToneMapping`, the legend's 255,216,192 on that flat face, with
    // the sun at `DEFAULT_ANGLE` so that the light on it is exactly one, comes
    // out 240,202,178, where the land's own sheet — unlit and walked back
    // (`pictureSheet.ts`) — draws it as published, or as near as the curve
    // reaches (`reachAt` in `tone.ts`). Not measured. This said, until
    // 2026-10-29, that the face gives back exactly the published colour.
    if (this.cast) {
      diffuseColor.rgb.assign(
        mix(diffuseColor.rgb, this.cast.xyz, this.cast.w) as unknown as Parameters<
          typeof diffuseColor.rgb.assign
        >[0],
      )
    }
    // And a sight over that, the same way: over the colour rather than
    // multiplying it, as a reflectance held to one, so a wall in sight takes
    // its shading with the paint on it as the land beside it does
    if (this.sight) {
      diffuseColor.rgb.assign(
        mix(diffuseColor.rgb, this.sight.xyz, this.sight.w) as unknown as Parameters<
          typeof diffuseColor.rgb.assign
        >[0],
      )
    }
  }
}

export function solid(parameters?: MeshStandardNodeMaterialParameters): SolidMaterial {
  const material = new SolidMaterial(parameters)
  material.roughness = 1
  material.metalness = 0
  return material
}

/**
 * Tells a material that everything it draws faces straight up.
 *
 * For what is laid on the land: the roads, the water, the footprints, the
 * ribbons, the sheets a page lays down. None of them carries a `normal` of its
 * own — they are drapes cut to the ground, two coordinates and a height, and a
 * normal a corner would be three floats a corner saying the same thing every
 * time.
 *
 * Three would answer this with a warning and a guess (`normalLocal` falls back
 * to straight up and says so on the console, once a geometry). Said outright
 * it is the same picture without the console, and it is the truth about these
 * meshes rather than a default that happens to suit them.
 *
 * `normalNode` is read in view space — three assigns what it returns straight
 * to `normalView` — so the up vector is carried through the model and the
 * camera the way a real normal would be. A ground tile is only ever shifted
 * and scaled, so this comes to the camera's own up; written this way it stays
 * right for a tile that is ever turned.
 */
export function facesUp(material: NodeMaterial): void {
  ;(material as { normalNode: Node<'vec3'> | null }).normalNode = transformNormalToView(
    vec3(0, 1, 0),
  ).normalize() as unknown as Node<'vec3'>
}

/**
 * Tells a material that the colour written on it is the colour it is to show
 * in full daylight, rather than the light it gives back.
 *
 * The same bargain the palette makes (CLAUDE.md, 계약 11) and made for the
 * same reason: a page that said `#d94f2a` meant that orange, and the two ends
 * of the light are pinned so that a flat lit surface lands on exactly what it
 * was given. The palette pays for this in its own file, where the numbers are
 * already written past the curve; a page's colour cannot be, so it is taken
 * back through here instead.
 *
 * It is the same bargain to the same ceiling, which is where it was not: the
 * palette's numbers are reflectances and so cannot be asked for above one
 * (`theme.ts`, `wall`), and what goes in here is held to one as well. So a
 * colour up to the `#f0f0f0` a white surface draws comes out as asked, and
 * anything brighter is brought down to it keeping its hue; see
 * {@link SolidMaterial.setupDiffuseColor}.
 *
 * Which colours are a page's and which are a reflectance is not a thing a
 * material can tell, so it is said at each door. A glTF's `baseColorFactor` is
 * a reflectance and does not come this way, nor does anything off the palette
 * ({@link inFullDaylight} is the unlit door for those); a solid a page
 * stood on the map and a shape a page painted on the land do.
 */
export function keepsItsColor(material: SolidMaterial): void {
  material.ownColour = true
}

/**
 * Tells a material it carries its own light: what a page means by `glows`.
 *
 * Two things together, and they are two because they answer two questions.
 * `lights = false` is three's own switch — `NodeMaterial.setupLighting` then
 * never opens a lighting context at all and the colour goes straight out, so
 * there is no branch in any shader and nothing to read at a pixel. And the
 * colour it goes out as is the one it was given, which is the line above: a
 * thing that carries its own light is a thing whose colour a page chose and
 * means to see at every hour.
 *
 * For a page's own colour, and only for that. A thing whose colour came off
 * the palette takes {@link inFullDaylight} instead; the two part on exactly the
 * question `keepsItsColor` is about.
 *
 * The one glowing thing that cannot come this way is the city: a city is one
 * material and which of its buildings glow is said a face at a time, so
 * `Buildings` says it with an emissive instead. See there.
 */
export function glows(material: SolidMaterial): void {
  material.lights = false
  keepsItsColor(material)
}

/**
 * Tells a material to draw as though it lay flat in full daylight: the other
 * half of `glows`, for a thing whose colour is a reflectance.
 *
 * The land is the one that asks. `GroundOptions.glows` says no shadow falls on
 * the land and no hillside turns from the sun, and the palette's numbers are
 * already reflectances — the number `theme.ts` writes beside each of them as
 * "draws" is what that reflectance comes to once the light and the curve have
 * had it. So the only thing to turn off is the light: the colour goes straight
 * out as the reflectance it is, the frame's curve puts it where a flat lit one
 * would have landed, and turning the switch repaints nothing.
 *
 * Taken through the curve backwards instead — which is what `glows` does, and
 * what this was for a day — the land drew the palette's *input* numbers: LIGHT
 * `#f6f9fd` where a lit land draws `#e8ebef`, fourteen steps up and brighter
 * than a white roof square to the sun, and DARK `#3a3c3f` where a lit one
 * draws `#1b1f26`, which is near-black becoming mid-grey. Arithmetic off
 * three's `neutralToneMapping` and this file's own lighting; the switch is off
 * by default and no page in this repository turns it on, so nothing was
 * measured on a screen.
 *
 * A picture thrown down over the map goes out the same way where the land
 * takes one — on the trees — and that is right rather than a concession: the
 * lit land treats a texel as a reflectance too, so the two paths agree and the
 * switch changes only the shading.
 */
export function inFullDaylight(material: SolidMaterial): void {
  material.lights = false
}
