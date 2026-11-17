import type { ColorRepresentation } from 'three/webgpu'

/**
 * The one set of colours the whole scene shares.
 *
 * The viewer holds it and the layers read from it, so changing a colour in one
 * place changes it everywhere it is drawn.
 *
 * **What a colour in here means now.** Most of them name a *surface*, and a
 * surface in a lit scene has a reflectance rather than a colour on screen: what
 * is drawn is what the sun and the fill leave on it, taken through the frame's
 * tone curve. The two ends of the light are pinned so that one case comes out
 * exactly — *a surface lying flat, face up, in full daylight, under a sun at
 * `DEFAULT_ANGLE`'s height* — so these are still the colours of the paper of
 * the map, of a road, of a roof. Every other face is some fraction of them,
 * which is what makes a city read as standing up rather than as being printed.
 *
 * **Two things narrowed that case on 2026-10-08.** The sun is divided by that
 * reference height alone now and not by its own, so the hour moves the picture:
 * the default sun is a dated one standing some 26° up at its hour, where
 * `surface` draws #d8dbdf and not the #e8ebef below. And the fill answers by
 * direction (`lights.ts`), so a face standing up is taken half the way to the
 * ground's own bounce — which is very little in the light set, where pale paper
 * gives nearly all of the fill back, and half of the light in the dark set,
 * where there is no sun at all and the ground is near-black: the dark `wall`
 * draws #27303c standing up against the #4b5360 in its column. Measured in
 * arithmetic rather than on screen. The column is the pinned case and nothing
 * else.
 *
 * So the numbers below are not the numbers a colour picker would read off the
 * screen. They are what has to go in for the old numbers to come out, which is
 * a brighter and slightly less saturated version of each: the curve takes a
 * flat 0.04 off the bottom of everything (see `tone.ts`), and the dark set
 * feels that most, since 0.04 is most of what a dark colour is. The comment
 * beside each says what it was and what it draws.
 *
 * **Five of them are not surfaces** and are the colours they say, written past
 * the tone curve so that they come out exactly: `backdrop`, which is a clear
 * value, and `coastline`, `boundary`, `edge` and `treeLine`, which are ink
 * drawn unlit.
 *
 * **And `shadow` is neither.** It does two jobs — the factor the corner shading
 * multiplies over the picture (`occlusion.ts`) and the hue the fill is made in
 * (`lights.ts`) — and in neither of them is it the colour it says. Its own
 * entry sets the two out, which is the thing to read before a theme moves it.
 *
 * **One colour is both** — `river` is a wide area where the water is wide and a
 * hairline where it is a canal, and the hairline is ink. It is tuned for the
 * area, which is what a reader sees; the hairline then draws some seven steps
 * of 255 lighter than it used to. Measured, not guessed.
 */
export interface Palette {
  /**
   * What the scene is backed with: the air round the shape the viewer is cut
   * to, and the colour whatever the mask cuts goes over to before it ends.
   *
   * A clear value and not a surface, so it is the colour it says. Nothing else
   * reads it — it was the air overhead while the fill was a sky, and that sky
   * is gone precisely because this is a colour about the interface and not
   * about the light; see `lights.ts`.
   *
   * It used to be the walls' own colour in both sets, and not by accident: how
   * far a thing stands from the backdrop is what its hem leaves behind, and
   * the buildings backed with their own colour leave nothing. That now holds
   * only nearly. A wall cannot be drawn whiter than a surface of reflectance
   * one, which the curve puts at `#f0f0f0` (measured), where the air behind it
   * is written past the curve and reaches `#ffffff`. Fifteen steps of 255
   * apart, and only ever seen along a mask's hem. A page that minds says so by
   * setting this to what its walls draw.
   */
  readonly backdrop: string
  /** The ground. */
  readonly surface: string
  /** Green space. */
  readonly green: string
  /** The leaves of a tree standing on it. */
  readonly leaf: string
  /** Its trunk. */
  readonly trunk: string
  /**
   * The line drawn round a tree. Ink: drawn unlit and the colour it says.
   *
   * `treeLine` and not `treeOutline` (2026-10-27): a part's name with `Line`
   * after it is that part's line everywhere a page writes a colour —
   * `lineColor` on a shape, `ground.trees.lineColor` on the wood — and an
   * outline in this library is the line a page points one thing out with.
   */
  readonly treeLine: string
  /**
   * The footprint of a building, laid flat on the ground.
   *
   * `footprint` and not `building` (2026-10-27), since a building is two
   * colours here and this is the one lying on the land; the walls standing
   * on it are `wall`. The same word the ground's own piece goes by, so one
   * thing has one name wherever a page meets it.
   */
  readonly footprint: string
  /** Roads. */
  readonly road: string
  /** Water and rivers. */
  readonly river: string
  /** Railways. */
  readonly rail: string
  /** The ballast a railway is laid on. */
  readonly ballast: string
  /** The coastline. Ink: a thin line, drawn unlit and the colour it says. */
  readonly coastline: string
  /** Administrative boundaries. Ink, as the coastline is. */
  readonly boundary: string
  /** The walls of a building standing up. */
  readonly wall: string
  /** The windows set into them, where a usage's own window style names no colour. */
  readonly window: string
  /** The mullions dividing them, where a usage's own style names no colour. */
  readonly mullion: string
  /**
   * The line drawn along a building's edges, where its faces fold. Ink.
   *
   * `edge` and not `outline`: an outline in this library is the line a page
   * draws round one building to point at it, which is the page's own colour
   * and never the palette's.
   */
  readonly edge: string
  /**
   * Shade: the colour a corner closed in by what surrounds it darkens towards.
   *
   * Two things, and they are one thing said twice. It is the colour of the fill
   * — what a face the sun has left, or one in cast shadow, is lit by
   * (`lights.ts`) — and it is the colour a corner closed in by what surrounds
   * it darkens towards (`occlusion.ts`). Both are *where the sun does not
   * reach*, so one word covers them and a page tinting this tints every such
   * place at once.
   *
   * The two are not the same machine, and they do not read the value the same
   * way. The fill takes the hue and not the level: `lights.ts` divides it by its
   * own luminance, so how much light there is stays the sun's business and a
   * dark shade tints the light rather than dimming it. The corner shading takes
   * it as it stands — read off the depth of the finished picture and multiplied
   * over it, in the linear buffer the curve comes after — so there a near-black
   * shade is a corner drawn nearly black. {@link DARK}'s own has the arithmetic
   * for both.
   *
   * The theme is the only way in. The sun says how hard the fill leans
   * (`Sun.shading`) and not what colour it is, although the hue would read
   * well beside its strength: the sun and the theme both reach the whole map,
   * and two ways in at one reach is an order between them a page has to be
   * told about. It was offered on the sun as `shadowColor` for part of
   * 2026-10-27 and taken off again for that reason. A value read by both of
   * the two above belongs where both can reach it, and that is here.
   */
  readonly shadow: string
}

export type ColorName = keyof Palette

export const LIGHT: Palette = Object.freeze({
  // A clear value, drawn as it says
  backdrop: '#ffffff',
  surface: '#f6f9fd', // draws #e8ebef
  green: '#c9dcc1', // draws #c3d6ba
  // A step deeper and yellower than the green, so it reads as standing on the grass
  leaf: '#a2bc95', // draws #9ab58c
  // A grey on the warm side of the leaves. A few pixels wide, so what matters is
  // that it parts from them in lightness rather than in hue
  trunk: '#888178', // draws #7d766b
  // A green gone most of the way to grey: the wood keeps its shape against the
  // grass without a black ring round every crown. The building's line, a blue
  // grey, would ring each tree in something cold that lifts off the leaves.
  // Ink, so it is the colour it says
  treeLine: '#66795f',
  footprint: '#e3e7ed', // draws #dde1e7
  road: '#b5beca', // draws #aeb7c4
  river: '#98b7e5', // draws #8fb0e0 where it is an area; see the note above
  rail: '#958c7c', // draws #8c8270
  ballast: '#cfc7b4', // draws #c9c1ad
  // The list came with no coastline or boundary, so both were parted off the
  // road. Both are ink and are the colours they say
  coastline: '#aeb7c4',
  boundary: '#c8ccd4',
  // Reflectance one: nothing reflects more than it is given, so this is as
  // white as a surface goes. The curve then draws it #f0f0f0 (measured), which
  // is the brightest thing in the city and fifteen steps under the air behind
  // it; see `backdrop`
  wall: '#ffffff',
  // A step bluer and darker than the white wall, and no darker: a window that
  // dark reads as a hole in the wall rather than as glass
  window: '#bfc9d6', // draws #b8c3d0
  // A little lighter and less blue than the glass, so it reads as what holds it
  mullion: '#c9ced6', // draws #c3c8d0
  // Darker than the shade, so an edge still reads on a wall turned from the
  // light. Ink, and the colour it says
  edge: '#8f98a6',
  // Not in the list either, and it has moved three times. It began a grey with
  // blue in it, because a neutral shade turns the white walls muddy; it lost
  // most of that blue when it stopped tinting corners and became the fill on
  // every face the sun has left (at #bfc3cc the shaded side of the city read
  // cold against the warm sun opposite it); and it was lightened twice over
  // once the sun's own shadow was settled (2026-10-08), since a shadow now
  // falls at every wall foot and every roof lip and a darker shade made the
  // city a drawing in two tones. The blue is gone altogether now — a flat grey,
  // and light enough that the shade reads as shade rather than as ink
  shadow: '#e1e1e1',
})

/**
 * Night.
 *
 * _(2026-10-08. It was "for a dark page, and not night" — a set a page picked
 * with `dark: true`, which is gone. Nothing else was ever wanted from it: the
 * one hour that needs a dark map is the one with no sun in it, since below the
 * horizon there is nothing to shade with and a white house on a white sheet
 * with no shadow under it is a white rectangle. So the page stopped choosing
 * and the sun decides. A page asking the same question of its own hour asks
 * `sunAt(...).down`, and what the viewer settled on comes back from
 * `viewer.night`, `viewer.colors` and `on('colors')` — `night` was opened and
 * closed again that same day, and opened for good on 2026-10-27, when a layer
 * handed a {@link ThemeColor} pair needed the viewer's own answer rather than
 * one worked out a second time. Read, never set. The numbers are the ones the
 * dark page had, bar `shadow`, which moved for the fill's sake; see it below.)_
 *
 * The lift from what each one draws is much the larger here, and that is the
 * tone curve's doing rather than a choice: it takes a flat 0.04 of linear light
 * off the bottom of the frame, and a dark colour is barely more than that to
 * begin with. So the numbers read as greys and draw as the blue-blacks they
 * always were. The saturation comes back on the way out for the same reason —
 * taking a constant off every channel widens the gaps between them, so putting
 * it back has to narrow them.
 */
export const DARK: Palette = Object.freeze({
  // The dark set's air, drawn as it says
  backdrop: '#4b5360',
  surface: '#3a3c3f', // draws #1b1f26
  green: '#404844', // draws #23302a
  // Against a dark ground the leaves have to be lighter than the green they stand on
  leaf: '#49534c', // draws #2e3d33
  trunk: '#52514e', // draws #3b3a35
  // As far below the dark leaves as the light set's line sits below its light
  // ones. A white ring round every crown catches the eye and holds it. Ink
  treeLine: '#18201c',
  footprint: '#404349', // draws #232831
  road: '#474b52', // draws #2c323c
  river: '#404c67', // draws #22375a
  rail: '#5b5852', // draws #48443b
  ballast: '#474744', // draws #2d2c28
  // Ink, both of them
  coastline: '#2c323c',
  boundary: '#2a3038',
  wall: '#5d646e', // draws #4b5360
  // Glass sitting deeper than the wall round it, and still that now the set is
  // the night's: nothing in the data says which windows are lit — a building's
  // usage is the whole of what it says about them (`windowStyle.ts`) — so the
  // choice is every one or none, and a page wanting them lit says so itself
  // with `buildings.windows.color`
  window: '#51565e', // draws #3a414c
  // A step below the glass, so it divides without drawing the eye
  mullion: '#4a4e54', // draws #30363f
  edge: '#2a3039',
  // Far lighter than the set it sits in, and that is because of what it is for
  // rather than what it looks like next to the others. It does the two jobs
  // `Palette.shadow` names, and the near-black `#0e1116` this was until
  // 2026-10-08 was wrong for both. As the fill — the whole of the light once the
  // sun is down — only its hue is read, since `lights.ts` divides it by its own
  // luminance: a dark shade does not leave the city short of light, it tints the
  // light, and the darker it is the wider the ratio between its channels comes
  // back. That one comes back as a fill of (0.80, 1.02, 1.45), a strongly blue
  // light that draws this set's `surface` #14263c where the column says
  // #1b1f26. And as the corner shading's factor it is read as it stands, so the
  // same colour took a fully closed corner to 0.005 of the picture — black —
  // where this takes it to 0.33. Measured in arithmetic, not on screen.
  //
  // A grey with no cast to it, then, which leaves the dark set's own colours as
  // the only colours at night
  shadow: '#9c9c9c',
})

export const COLOR_NAMES: readonly ColorName[] = Object.freeze(Object.keys(LIGHT) as ColorName[])

/**
 * A colour a page gives, said once or said twice.
 *
 * **Said once it means the hour does not matter.** A page that asked for a
 * sand coloured land meant sand, not sand until the sun goes down. That is
 * what a single value has always meant here and it is unchanged.
 *
 * **Said twice it is the colour in each of the two sets above.** `light`
 * while the sun is up, `dark` once it is down — the same two the viewer swaps
 * between and the same moment it swaps on (`sunAt(...).down`). It is for the
 * colour that was chosen against the paper under it: navy reads on the light
 * set's near-white and disappears into the dark set's near-black, so a page
 * that said navy once gets a navy nobody can see at night.
 *
 * It does not say **which** set stands. The sun says that and a page cannot —
 * see the document's "다크 모드", where the knob for it was taken off. This
 * only says what a page's own colour is in each.
 */
export type ThemeColor =
  | ColorRepresentation
  | { readonly light: ColorRepresentation; readonly dark: ColorRepresentation }

/**
 * What a page hands over to colour the map with: any of the palette's names,
 * each one a colour or a {@link ThemeColor} pair.
 *
 * Names left out keep the library's own value, which already differs between
 * the two sets — so `{ wall: '#fff' }` is a white wall at every hour while
 * everything else still turns over at dusk.
 *
 * It is the whole palette in one object, which is the point: a page keeps its
 * colours in one place and hands them over together, the way a theme is
 * handed to a component library. A layer's own colours are still there for
 * the finer grain — `ground.road.color`, `buildings.wallColor` — and they come
 * over this, as a component's own style comes over its theme. A building
 * painted on its own (`buildings.setStyle(id, …)`) comes over both, and is
 * never said here: one building is not a colour of the map.
 *
 * `shadow` is among them, although it is neither a reflectance nor an ink —
 * its own entry sets out the two jobs it does — and this is the only place it
 * is said.
 */
export type Theme = { readonly [K in ColorName]?: ThemeColor }

/**
 * Which of a {@link ThemeColor}'s two the set now standing asks for.
 *
 * Asked wherever a page's colour meets the palette — the theme, the ground's
 * pieces, the city's, a shape's, a mark's — and asked again every time the
 * palette moves (`changed('colors')`), which is what keeps a pair honest as
 * the sun goes down.
 */
export function colorFor(color: ThemeColor, night: boolean): ColorRepresentation {
  // `Color` is an object too, so the test is for the two names rather than for
  // the kind — nothing three hands back has either of them
  return typeof color === 'object' && color !== null && 'light' in color && 'dark' in color
    ? night
      ? color.dark
      : color.light
    : (color as ColorRepresentation)
}
