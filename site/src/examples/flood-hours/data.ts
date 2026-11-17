/**
 * Where the page stands and what it reads the picture against.
 *
 * Nothing here calls the library. The place, the portal's legend and the
 * colours are what a reader looks up when a number matters, and they sit on
 * their own so that `main.ts` is the map and nothing else.
 */

/**
 * Where the page opens, and the middle of the strip it is cut to: a street of
 * 駒形, among blocks of four bands.
 */
export const STREET = [139.7942, 35.70518] as const

/** The portal's map of how long a flood would stay, and whose it is. */
export const HOURS = 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_keizoku_data/{z}/{x}/{y}.png'
export const HAZARD = { text: 'ハザードマップポータルサイト', url: 'https://disaportal.gsi.go.jp/' }

/** The zooms the portal's set holds: past 17 there is no tile. */
export const HOURS_ZOOMS = { min: 2, max: 17 }

/**
 * The portal's seven bands, shortest first, as its tiles hold them — read off
 * its own legend image (`copyright/img/shinsui_legend_l2_keizoku.png`), the
 * colours and the words alike. A colour is matched exactly, so these are its
 * bytes rather than a colour near them.
 */
export const BANDS = [
  { color: '#a0d2ff', label: '12時間未満' },
  { color: '#0041ff', label: '12時間〜1日未満' },
  { color: '#faf500', label: '1日〜3日未満' },
  { color: '#ff9900', label: '3日〜1週間未満' },
  { color: '#ff2800', label: '1週間〜2週間未満' },
  { color: '#b40068', label: '2週間以上〜' },
  { color: '#600060', label: '4週間以上〜' },
] as const

/**
 * How high each band's step stands over the one before it, in metres.
 *
 * **A step, not a depth and not a time.** The bands are stood up in their
 * order — the shortest a step off the ground, each longer one a step higher —
 * so a reader sees where the water stays longer by the steps rising. What the
 * picture says is hours and days, which no height is; and the legend itself
 * says its sixth colour may also mean the seventh.
 */
const RISE = 2

/** The legend the layer reads the picture against: each band's colour, and its step. */
export const LEGEND = BANDS.map(({ color }, at) => ({ color, height: (at + 1) * RISE }))

/**
 * What the steps are drawn in when the panel asks for one colour: water's,
 * rather than the legend's — the heights still read the bands.
 */
export const WATER = '#4a90d9'
