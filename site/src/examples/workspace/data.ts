/**
 * The brand, and the four places it has a space in.
 *
 * Nothing here calls the library. A page like this one is mostly the places it
 * is about — coordinates, building ids, addresses and floors — and looking for
 * how the map is made means scrolling past all of it first. So it sits on its
 * own, to be opened when a name matters and left shut when it does not.
 */

/** The coworking spaces the page is for, made up for it. */
export const BRAND = 'Workspace'
/**
 * The brand's colour, a deep wine red: the floor each space is on, and the
 * tag that names it. An example writes its colours out rather than reaching
 * for the site's.
 */
export const BRAND_COLOR = '#7a1f35'

/**
 * What the mark over the tower is set in, as CSS — style, weight, size and
 * face in the one string, the way a stylesheet takes it.
 *
 * The page's own face rather than the library's, so the words on the map and
 * the words in the panel are set alike. An example is a page someone copies
 * whole, so it says this where it is used.
 */
export const MARK_FONT = '700 13px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif'
/**
 * How far round each station the city is drawn, in metres: its platforms, the
 * square in front of it and the blocks across the road.
 */
export const RADIUS = 400
/** How deep the ground each station stands on is cut, in metres. */
export const DEPTH = 30

/**
 * Four stations of the 山手線, in the order a train on its inner loop reaches
 * them, and the brand's space at each.
 *
 * Each place is taken at the middle of the station's JR platforms. A station
 * is a few hundred metres long, so this is the station rather than a door
 * into it.
 *
 * The headings turn the view across the streets round each station rather
 * than along them — the blocks read as blocks that way, where a view square
 * to them lies flat. All four open toward the south-east, so going from one
 * station to the next turns the view a little rather than right round.
 *
 * Which floor of which building a space is on is made up with the spaces: the
 * survey says what a building is, not what is inside it. Each building is a
 * tall one in its circle whose storeys PLATEAU gives, and the floor is near
 * its top or about half way up, where the view over the station still sees
 * it. The address is the one PLATEAU writes for that building, and the
 * library does hand it over: `Building.attributes` carries everything the
 * survey wrote, `bldg:address` among it where the survey wrote one (at 中野,
 * 4,563 of 5,057 buildings held). It is written out here all the same,
 * because the tag is made once, when the page runs, and the survey's answer
 * only arrives with the building's tile.
 *
 * `offset` is where the tag hangs on its building: metres east, north and up
 * from the middle of its foot, onto the face the station's view is turned to
 * — half a turn from the heading — and level with the middle of the floor.
 * Read off where a click there hands back.
 */
export const STATIONS = [
  {
    name: '新宿駅',
    at: [139.7005, 35.69],
    // The tracks and 明治通り run a few degrees west of north.
    heading: 128,
    // An office tower of 28 storeys some 300m south of the station.
    space: {
      building: 'bldg_5420c7f5-3f1a-4314-9cb6-3e25a2374b59',
      address: '東京都渋谷区代々木二丁目',
      floor: 26,
      offset: [-30.7, 24, 143.5],
    },
  },
  {
    name: '渋谷駅',
    at: [139.7016, 35.658],
    // The streets fan out from the station, most of them some 20° west of north.
    heading: 114,
    // The tallest tower in the circle, 45 storeys, standing over the station.
    space: {
      building: 'bldg_7b006717-e9e6-4a94-8843-1f4ce13b2509',
      address: '東京都渋谷区渋谷二丁目',
      floor: 23,
      offset: [-22, 9.8, 115.5],
    },
  },
  {
    name: '品川駅',
    at: [139.739, 35.6288],
    // The tracks run straight north, and the streets of 港南 square to them.
    heading: 137,
    // An office tower of 32 storeys on the 港南 side, east of the tracks.
    space: {
      building: 'bldg_5c4454fa-715d-4c0a-84a1-7f07b0c60490',
      address: '東京都港区港南二丁目',
      floor: 30,
      offset: [-22.1, 23.8, 139.3],
    },
  },
  {
    name: '東京駅',
    at: [139.7665, 35.681],
    // 丸の内 and 八重洲 are laid out about 15° east of north.
    heading: 150,
    // An office tower of 42 storeys on the 八重洲 side, south of the station.
    space: {
      building: 'bldg_cbea6733-379b-4490-b641-a1e68192107d',
      address: '東京都千代田区丸の内一丁目',
      floor: 21,
      offset: [-12.8, 22.2, 102.3],
    },
  },
] as const

export type Station = (typeof STATIONS)[number]

/**
 * The sheet everything here is stood on.
 *
 * White, which is where this page's picture starts: the one the viewer draws
 * past the map is white as well, so the two meet with no line between them.
 * Written here because a solid told no colour wears the map's own ground
 * instead, and that is a shade of the sky rather than a sheet of paper.
 */
export const PAPER = '#ffffff'
