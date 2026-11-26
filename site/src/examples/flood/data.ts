/**
 * 由比ヶ浜 in 鎌倉: a long thin town caught between the sea and the hills.
 *
 * Where the page stands, and nothing else. What is eventually drawn over this
 * ground arrives from somewhere else and is written where it arrives.
 */
import type { Credit, Mask } from '@plateau-ui/core'
import { placeFrom } from '@plateau-ui/core'

/**
 * The middle of the site: where the beach meets the town.
 *
 * The sea is to the south and the hills close in from three sides, so the
 * town is a strip a few hundred metres wide with nowhere to go.
 */
export const MIDDLE = [139.545, 35.3085] as const

/**
 * Where the page stands to look from: west along the beach, off 稲村ヶ崎,
 * with the whole strip of the town running away to the north-east.
 *
 * Measured off {@link MIDDLE} rather than written as a coordinate of its own,
 * so there is one place this page is about and everything else is said as a
 * distance from it.
 */
export const STAND = placeFrom(MIDDLE, -1019, 133)

/**
 * What the page is cut to. Outside it nothing is drawn and nothing is fetched.
 *
 * Drawn from where the page stands and not from the middle of the site. What
 * the circle is for is the edge of the picture, and a reader reads that
 * against the view rather than against a coordinate — cut from somewhere the
 * camera is not, it falls across the near town on one side and off the screen
 * on the other.
 */
export const AROUND = 600

export const SITE: Mask = { shape: { type: 'circle', center: STAND, radius: AROUND }, fade: 60 }

/**
 * The tsunami inundation the hazard portal publishes, as tiles.
 *
 * `{z}/{x}/{y}` PNG on the same grid as everything else the library fetches,
 * so it is the one kind of thing an image tile layer draws and the URL is the
 * whole of what makes it this map rather than another. The portal publishes a
 * couple of dozen at these addresses — floods, storm surge, landslides — and
 * swapping this line is how a page offers a reader another.
 *
 * What a colour on it means is the portal's legend and not this page's. It is
 * also not one tsunami: the bands are the envelope of several fault models at
 * their largest, so they say how far the water could reach and not how far it
 * will.
 */
export const TSUNAMI = 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png'

/** The zooms the portal publishes that set at. Outside them there is no tile. */
export const TSUNAMI_ZOOMS = { min: 2, max: 17 }

/**
 * Whose picture it is, which the portal's terms ask for in those words.
 *
 * Its own example is 出典：「ハザードマップポータルサイト」, with the page's address
 * after it where there is room. The line under the map is a list of the
 * sources on screen, so the name stands in it as given and the address is the
 * link.
 */
export const HAZARD: Credit = {
  text: 'ハザードマップポータルサイト',
  url: 'https://disaportal.gsi.go.jp/',
}

/**
 * The bands the picture is drawn in, deepest first.
 *
 * Read off the portal's own legend image rather than typed from a table:
 * `copyright/img/shinsui_legend3.png`, six swatches, these exact bytes. The
 * tiles are drawn into the picture one for one, so a texel that came from a
 * band is one of these six exactly — a reading that matches none of them is
 * counted as unknown and shows up as such rather than being rounded into the
 * nearest band.
 *
 * **No depth is written here.** The same six colours carry different
 * breakpoints for different sets of this portal — the legend prints two rows
 * of figures against the last two swatches — and a page that guessed which
 * applied would be putting a number on a flood. The chips are shown as they
 * are, and the reader matches them against the legend the panel names.
 */
export const BANDS = [
  '220,122,220',
  '242,133,201',
  '255,145,145',
  '255,183,183',
  '255,216,192',
  '247,245,169',
] as const

/** What a building is counted under where the picture leaves its ground clear. */
export const CLEAR = 'clear'

/** And where the picture cannot answer for it at all; see `colorAt`. */
export const UNKNOWN = 'unknown'
