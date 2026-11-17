/**
 * The brand, and the five houses it built on the slope.
 *
 * Nothing here calls the library. A page like this one is mostly the places it
 * is about — coordinates, building ids, names and rates — and looking for how
 * the map is made means scrolling past all of it first. So it sits on its own,
 * to be opened when a name matters and left shut when it does not.
 */

/** The slope the brand's houses are on: 七里ヶ浜, a little up from the coast road. */
export const MIDDLE = [139.51836, 35.30433] as const
/**
 * How far round it the city is drawn, in metres: the rows of houses either
 * side, the road and the railway at the foot, and the first of the water.
 */
export const RADIUS = 300
/**
 * How far in from that edge what is drawn fades out, in metres.
 *
 * A hard edge is the honest one — it says outright that the rest was never
 * fetched — and the other pages here keep it for exactly that. This page is
 * a brand's, and what it is showing is a place to stay rather than what the
 * library did not fetch, so the picture is let run out instead.
 */
export const FADE = 90
/** How far over a roof its rate stands, in metres. */
export const RATE_OVER_ROOF = 3

/**
 * The five, spread over the slope above the coast road.
 *
 * Which plots they took, how they are turned and how high they are built is
 * the page's doing and not the survey's — a brand chooses where and what it
 * builds. What the survey is asked for is the land they stand on, the city
 * around them, and the houses they replaced.
 *
 * `roof` is how high a stay stands, in metres. Each began at the height of the
 * house whose plot it took, so that a stay sits among its neighbours rather
 * than over them, and moved from there where the brand builds bigger.
 *
 * It is written here and in the model file both, which is the one thing on
 * this page said twice. The file carries it because glTF counts in metres and
 * a house is a thing of a size, so the model is built to its height and the
 * page says nothing about how big to draw it; this copy is here because the
 * rate stands over the roof and the page has to know where the roof is. The
 * library will not say — a model is a box over whatever origin a modeller
 * chose, and a house that stands on its origin is a convention and not a fact.
 * So a file exported at another size wants this number changed with it.
 *
 * All of it written down rather than read off the tiles: a page that waits
 * for a building before it can size its own draws nothing until the city
 * lands, and these five never move.
 */
export const STAYS = [
  {
    name: '海テラスの家',
    rate: 38000,
    file: 'house-deck.glb',
    at: [139.518573, 35.304742],
    // The street it stands on runs past its west side.
    facing: 250,
    roof: 7.65,
    building: 'bldg_a9141745-2c0e-4f81-8d7a-36c14e87bf51',
  },
  {
    name: '屋上ガーデンの家',
    rate: 42000,
    file: 'house-roof-garden.glb',
    at: [139.519116, 35.304554],
    // Turned right round from the way its walls would have it, to look down
    // the slope rather than up it.
    facing: 276,
    // Built half again over the house it replaced: three floors with a garden
    // on the roof do not fit in what stood here.
    roof: 12.4,
    building: 'bldg_0e122f24-7d86-414a-ba7a-10f92a1b02cf',
  },
  {
    name: 'れんが壁の家',
    rate: 29000,
    file: 'house-brick.glb',
    at: [139.51862, 35.303835],
    // The street it stands on runs north to south along its east side.
    facing: 95,
    roof: 8.27,
    building: 'bldg_7cb321ec-3a09-44ac-9f2e-45d32f12397b',
  },
  {
    name: 'ガレージのある家',
    rate: 33000,
    file: 'house-garage.glb',
    at: [139.517883, 35.304163],
    facing: 180,
    roof: 7.57,
    building: 'bldg_df0e49b2-0065-4e1c-a412-bc7065a0a02f',
  },
  {
    name: '三角屋根の小屋',
    rate: 26000,
    file: 'house-gable.glb',
    // Out in front of the row toward the sea, a few metres down the slope.
    at: [139.517637, 35.304329],
    // Turned to the sea, which lies almost due south of it.
    facing: 193,
    roof: 8,
    building: 'bldg_c457245c-ea7f-4c61-8b07-3409f5a1b41a',
  },
] as const

export type Stay = (typeof STAYS)[number]

/**
 * From over the water, looking up the slope — where the page opens, and where
 * a click the five houses and their prices did not answer comes back to.
 *
 * The middle stands a little inland of the houses so they sit across the
 * lower half of the screen with the wooded hill behind them. The heading
 * comes off the coast, which runs south-west to north-east here: looking 327°
 * puts the sea at the reader's back and the hill in front, which is the way a
 * house on this slope is looked at.
 */
export const WHOLE_SLOPE = {
  // The ground it opens on, however wide the screen; `main.ts` fits it
  bounds: { southWest: [139.517553, 35.304048], northEast: [139.518807, 35.305072] } as const,
  pitch: 66,
  heading: 327,
}
/**
 * How much closer than the whole slope one stay is flown to, in zooms. A step
 * rather than a zoom: a phone opens on the slope further out than a desk does,
 * and coming in by the same step it shows a stay as a desk shows it.
 */
export const ONE_STAY = 1.6
