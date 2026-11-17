/**
 * What the guide is a guide to: the walk, and the four places along it.
 *
 * Nothing here calls the library. A page like this one is mostly the place it
 * is about — coordinates, building ids and the words a reader reads — and
 * looking for how the map is made means scrolling past all of it first. So it
 * sits on its own, to be opened when a name matters and left shut when it
 * does not.
 */
import type { MarkerOptions } from '@plateau-ui/core'

/** The guide's own colour. An example writes its colours out rather than reaching for the site's. */
export const MARK_COLOR = '#e5484d'
/** 中野区役所: where the walk ends, marked on its fourth floor and banded there. */
export const WARD_OFFICE = 'bldg_e6536b45-c699-401e-97ad-e4471847bdb5'
/** Which floor the desk is on: the band runs round it. */
export const DESK_FLOOR = 4

/**
 * Out of the north side of the station, up 中野通り, then west along the wide
 * street to the road in front of the ward office. It stops there — the way in
 * is a lane too narrow to draw, and the tag on the wall carries the rest.
 *
 * Four corners, and every one of them a vertex of a 国土地理院 road centre
 * line, so the walk lies along the streets rather than cutting across the
 * blocks between them. The survey gives sixteen along this run; the other
 * twelve say nothing, since the streets here are straight. Measured against
 * the line these four draw, the furthest of them lies 2 m off it, and the walk
 * is painted ten pixels wide — about five metres over the ground at this zoom.
 * They were inside the line.
 */
export const WALK: readonly (readonly [number, number])[] = [
  [139.665898, 35.706406],
  [139.665318, 35.706387],
  [139.665098, 35.708388],
  [139.662879, 35.708313],
]

/**
 * A place the walk reaches: a mark on the map, and the line the list gives it.
 *
 * The two are one thing said twice over — the map says where, the list says
 * what to do there — so they are written together. Kept apart, the list in the
 * markup and the marks here, the order and the names have to be held level by
 * hand, and a stop added to one is a stop missing from the other.
 */
interface Stop {
  /** What the walk does here, in the words the list uses. */
  readonly step: string
  /** Where it is marked on the map, and how. */
  readonly mark: MarkerOptions
}

/**
 * The four, in the order the walk reaches them.
 *
 * The one on the land is a spot on the map: where 国土地理院 puts the way out.
 * The three on buildings are held to them: metres east, north and up from the
 * middle of each building's foot, read off where a click there hands back. So
 * each comes up out of the ground with its building as the tiles land, rather
 * than standing in the air until the building arrives under it.
 */
export const STOPS: readonly Stop[] = [
  // JR names its ways out 北口 and 南口 rather than numbering them, so the
  // mark says which side rather than a number nobody would find on the signs.
  {
    step: '中野駅 北口を出る',
    mark: {
      at: [139.665898, 35.706406],
      symbol: 'pin',
      color: MARK_COLOR,
      label: '中野駅 北口',
    },
  },
  // Two towers the walk passes, marked on their roofs — a landmark reads as a
  // place on the map that way, rather than as text floating over the city.
  // Each is straight over the middle of its foot, at the top of the building.
  //
  // The names are the ones 国土地理院 writes on the map there, and the
  // buildings are the ones standing under those notes: the hotel of twenty
  // storeys and the flats of twenty-six, which is what PLATEAU says each of
  // these two is. A building with no note near it is left unmarked rather than
  // called something made up.
  {
    step: '中野サンプラザの角を右へ',
    mark: {
      at: { building: 'bldg_4be39579-61d4-4aac-9c3d-a63da0712aab', offset: [0, 0, 93.7] },
      symbol: 'dot',
      label: '中野サンプラザ',
    },
  },
  {
    step: '中野サンクォーレの先を左へ',
    mark: {
      at: { building: 'bldg_cabd6dc6-ae34-475e-8ae3-76dcce2c4055', offset: [0, -0.1, 99.2] },
      symbol: 'dot',
      label: '中野サンクォーレ',
    },
  },
  // Where the guide sends someone: a floor of 中野区役所, not the building.
  //
  // Which storey the desk is on is this page's own — the survey does not say
  // what is on which floor, and for this building it does not even say how
  // many there are. The tag is on the west face, the broadest of the faces this
  // view is turned toward: 22.7m west of the middle of the building's foot, at
  // the height of the fourth floor.
  // The band round that floor is the building's own counting (`main.ts`).
  {
    step: '中野区役所 4階へ',
    mark: {
      at: { building: WARD_OFFICE, offset: [-22.7, 0, 12.6] },
      symbol: 'tag',
      color: MARK_COLOR,
      label: '中野区役所\n4F 福祉課',
    },
  },
]
