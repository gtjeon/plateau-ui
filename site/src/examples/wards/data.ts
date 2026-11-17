/**
 * Where the boundaries come from, and what they are drawn in.
 *
 * Nothing here draws. It is the fetching, the two URLs it goes to and the
 * colours the wards wear, so that the map beside it is the map: `main.ts`
 * makes a {@link GeoJsonLayer} out of what {@link boundaries} hands back and is
 * done.
 *
 * No boundary is written down here, and no list of wards. Both arrive over the
 * wire: which wards there are from PLATEAU, where their edges run from
 * 国土数値情報. What is written down is only what a page has to choose — where
 * to look first, and what colours to wear.
 */
import { metersFrom } from '@plateau-ui/core'
import type { Credit, GeoJsonFeature, GeoJsonFeatureCollection, Mask } from '@plateau-ui/core'

/**
 * The list of municipalities PLATEAU publishes for, which is what this page
 * takes from it.
 *
 * The library fetches this same file on every page — it is how the buildings
 * know which city to ask the catalog about. It says which, and not where: the
 * shapes in it are generalised down to about one blob a ward (千代田区 is
 * fourteen corners), enough to test a point against and nowhere near enough to
 * draw a boundary with.
 */
export const COVERAGE = 'https://api.plateauview.mlit.go.jp/govpolygon/plateaugovs.geojson'

/**
 * Where one municipality's boundary is, by its code.
 *
 * 国土数値情報 hands its 行政区域 out as one archive for the whole country, which
 * a page cannot fetch; this is the same survey cut up a municipality a file and
 * put on a CDN. The prefecture in the path is the first two digits of the code,
 * so nothing here holds a list of anything.
 */
const boundaryOf = (code: string): string =>
  `https://geolonia.github.io/japanese-admins/${code.slice(0, 2)}/${code}.json`

/**
 * Whose the boundaries are, for the line under the map.
 *
 * Named by the page because the library cannot know: a parsed file says
 * nothing about who made it. 加工して作成 rather than the bare name, since what
 * is drawn is the survey cut up and simplified by somebody else, and the terms
 * it comes under ask for that to be said.
 */
export const BOUNDARY_CREDIT: Credit = {
  text: '「国土数値情報（行政区域データ）」（国土交通省）を加工して作成',
  url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html',
}

/**
 * What the twenty-three share at the front of their code: 千代田区 is 13101 and
 * 江戸川区 is 13123.
 *
 * The coverage file covers the whole country, and this page draws the city it
 * is about.
 */
const WARD_CODE_PREFIX = '131'

/**
 * Where 文京, 台東 and 千代田 meet, at 湯島.
 *
 * The three wards that come together here wear three different colours, which
 * is the one place in the city where what this page does is plain at a glance:
 * the wash is not on a plane over the streets, it is on the streets and up the
 * walls, and the boundary between two wards runs over the roofs rather than
 * stopping at the foot of them.
 *
 * Close in rather than over the whole circle, because the circle is one wheel
 * turn away and this is not. A reader who zooms out gets the three wards
 * whole; a reader who never zooms at all has still seen the thing.
 */
export const FIRST_VIEW = {
  // The ground it opens on, however wide the screen; `main.ts` fits it
  bounds: { southWest: [139.769325, 35.70454], northEast: [139.772675, 35.70726] } as const,
  pitch: 70,
  heading: -30,
}

/**
 * Where 文京, 台東 and 千代田 meet, at 湯島 — the corner the page is cut to.
 *
 * Nothing outside the circle is drawn or fetched, so the page costs a
 * kilometre of city rather than the whole of 東京. It also settles what a
 * reader who zooms out sees: three wards is what this page is about, and cut
 * to the circle that is three wards of the city rather than three of
 * twenty-three with the rest left bare.
 */
export const MEETING = [139.7701, 35.7054] as [number, number]

/** How far the page reaches from that corner, in metres. */
export const REACH = 900

/** The circle itself, which the viewer is cut to and the fetching is judged against. */
export const MASK: Mask = { shapes: [{ shape: 'circle', center: MEETING, radius: REACH }] }

/**
 * Three colours for the inside of a ward, and one ink for every line over them.
 *
 * The colour says nothing but *not the one beside it*, which is all a colour
 * on a map of districts ever says — and the panel names the one under the
 * pointer, so it is not even asked to say which. Three, dealt by code: the
 * codes run round
 * the city in order, so the three the circle takes in land on three different
 * ones — 千代田 cobalt, 文京 pink, 台東 lime.
 *
 * Hue, and at this pitch it is paid for loudly. The wash is not on a plane over
 * the streets — it is on the streets and up the walls — so a hue in it
 * recolours the city under it, and at full chroma the roofs, the walls and the
 * shadows between them do all their talking through it: what is left of the
 * city is its shading and nothing of its own colour. A scale of greys was the
 * other way — it lays the city a step darker rather than repainting it — and
 * what it could not do is say *which* ward without a reader measuring one wash
 * against the one beside it: two greys a step apart over a shaded city came
 * out, when measured, two of the same. These three are not in danger of that.
 *
 * An example writes its colours out rather than reaching for the site's: this
 * is a page of its own, and somebody copying it takes the page and not the site.
 */
export const FILL_COLORS = ['#3155ff', '#ff4fa3', '#c7f000']

/**
 * What every ward's boundary is drawn in. One ink, not one a ward.
 *
 * Two wards share an edge and each draws its own line along it. With an ink a
 * ward those two lie on top of each other in different colours, and the edge
 * comes out as a mix of them when it is looked at closely.
 *
 * Not because the two disagree about where the border runs: they share their
 * corners exactly — of 千代田's 623 segments, 107 are 文京's as well and 93 are
 * 台東's, matching to the seventh decimal. What differs is the corners, where
 * each ring turns the other way because the inside is on the other side, so
 * the two bands splay apart at every bend and each spills past the other.
 * (Counted from the files; the spilling is read off how the band is built and
 * was not measured on screen.)
 *
 * One ink and the question is gone: the two lines land in the same place in
 * the same colour, and the second is the first.
 *
 * What it costs is an edge that said whose edge it was. The wash under it
 * still says, and the panel names the ward under the pointer.
 *
 * Dark and neutral, so that it reads over all three washes without belonging
 * to any of them — the same ink the panel's own words are set in
 * (`style.css`), which is a page of a piece rather than two sets of colours.
 */
export const LINE_COLOR = '#2b3038'

/**
 * How much of the fill goes on, 0 to 1.
 *
 * Under half, which is as thin as it goes and still names a ward. Nothing
 * about telling the three apart rides on this number — hues that far apart
 * tell apart at any of it — so all it is buying is the city underneath, and at
 * full strength there was none left: three neons at 0.7 took the roofs, the
 * roads and the green with them and left only the shading of the walls. Here
 * a block is a block again and the wash is read over it.
 */
export const FILL_OPACITY = 0.45

/** How wide a ward's boundary is drawn, in pixels of the page. */
export const LINE_WIDTH = 2

/**
 * The wash on the ward under the pointer, and on the one that was clicked.
 *
 * Half again as much as {@link FILL_OPACITY}, which is what it takes to read
 * as *that one* across a city of three colours. The warning that number
 * carries — that at full strength there is no city left under the wash —
 * is about all three of them at once and all of the time; this is one ward,
 * and only while a reader is pointing at it or has asked for it.
 *
 * The wards beside it are left exactly as they were. Stepping them back said
 * the same thing twice and took the page somewhere the reader had not asked
 * to go: two wards they were still reading went faint because they pointed at
 * a third.
 */
export const FILL_LIT = 0.68

/**
 * How wide a boundary is drawn under the pointer, and once picked, in pixels.
 *
 * One width for both, as the wash is one strength for both: picking a ward is
 * keeping what the pointer was already showing, so it has nothing more to say.
 * A wider line again for the picked one was tried and came off — it made two
 * states out of what the page means as one.
 *
 * The line cannot carry this on its own, since a boundary may run off the
 * screen and a reader hovering the middle of a ward would see nothing move.
 * Where it is on screen it is the sharpest thing the page has, and widening
 * it costs nothing of the city underneath.
 */
export const LINE_HOVER = 4

/** Which of the three a ward wears, by its code. */
export function shadeOf(feature: GeoJsonFeature): number {
  return Number(code(feature)) % FILL_COLORS.length
}

/**
 * The boundaries of the wards the circle takes in, ready to be drawn.
 *
 * Two rounds of fetching. The first asks PLATEAU which wards there are — only
 * their codes are taken, since the shapes beside them are too coarse to draw,
 * and only the ones the circle reaches are kept. The second asks 国土数値情報
 * for each of those boundaries, all at once: they do not depend on each other,
 * and the map is worth nothing until the last of them is in.
 *
 * Here rather than in the layer because {@link GeoJsonLayer} takes no URL. A layer
 * that fetched would have to be hung on the viewer's own life, would have a
 * failure to tell somebody about, and would need a policy for asking again. A
 * page has `fetch`, an `await` and none of that — and here it has four of
 * them, which a layer taking one URL could not have done at all.
 */
export async function boundaries(): Promise<GeoJsonFeature[]> {
  const listed = await file(COVERAGE)
  const wards = listed.features
    .filter((feature) => code(feature).startsWith(WARD_CODE_PREFIX) && near(feature))
    .map((feature) => ({ code: code(feature), name: cityOf(feature) }))

  const drawn = await Promise.all(
    wards.map(async ({ code: said, name }) => {
      const boundary = await file(boundaryOf(said))
      // Both are written on from the coverage file. The code because these
      // files do not carry one and the colours go by code — the page asked
      // for one code a file, so it writes that back rather than reading the
      // name and turning it into one. And the name because the two files
      // spell it differently: a boundary file says 東京都千代田区 and the
      // coverage file keeps the ward apart from the prefecture, which is what
      // a panel two hundred pixels wide wants.
      return boundary.features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, code: said, name },
      }))
    }),
  )
  return drawn.flat()
}

/**
 * Whether a ward comes near enough the circle to be worth fetching.
 *
 * Nothing outside the circle is drawn, so nothing outside it is asked for: of
 * the twenty-three, three are fetched. Judged by the corners of the blob the
 * coverage file carries, which is coarse and does not have to be better than
 * this — the nearest corner of each of the three is within 350 m of the
 * middle, and the nearest corner of any other ward is 1.5 km out.
 */
function near(feature: GeoJsonFeature): boolean {
  return corners(feature.geometry?.coordinates).some(
    ([x = 0, y = 0]) => Math.hypot(...metersFrom(MEETING, [x, y])) < REACH,
  )
}

/** Every corner a geometry holds, however deep the file nested it. */
function corners(said: unknown): number[][] {
  if (!Array.isArray(said)) return []
  if (typeof said[0] === 'number') return [said as number[]]
  return (said as unknown[]).flatMap(corners)
}

/** What a file calls the municipality a feature is, or '' where it does not say. */
export function code(feature: GeoJsonFeature): string {
  const said = feature.properties?.['code']
  return typeof said === 'string' ? said : ''
}

/** What the coverage file calls a municipality, or '' where it does not say. */
function cityOf(feature: GeoJsonFeature): string {
  const said = feature.properties?.['city']
  return typeof said === 'string' ? said : ''
}

/**
 * What a ward is called, for the page to show.
 *
 * Written on as the boundaries are gathered; see {@link boundaries}. Not the
 * name the boundary file carries, which has the prefecture in front of it.
 */
export function nameOf(feature: GeoJsonFeature): string {
  const said = feature.properties?.['name']
  return typeof said === 'string' ? said : ''
}

/** One GeoJSON file, or the reason it could not be had. */
async function file(url: string): Promise<GeoJsonFeatureCollection> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`)
  return (await response.json()) as GeoJsonFeatureCollection
}
