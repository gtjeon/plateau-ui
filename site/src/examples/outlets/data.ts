import type { MaskShape } from '@plateau-ui/core'

/**
 * The three zones of the outlets, as the ground each one covers.
 *
 * ウエストゾーン, イーストゾーン and ヒルサイド, as the mall's own map has
 * them. Which shop is in which zone is the mall's to say and is in no survey,
 * so a zone is written here as a shape and the layer paints whatever stands
 * inside it.
 *
 * A shape and not a list of buildings. The list would be this page carrying a
 * copy of the survey: buildings come and go between releases, and one added
 * next year would stand unpainted in the middle of its own zone. The ground
 * does not move.
 *
 * The corners are the buildings' own all the same. Every foot in a zone — 42,
 * 40 and 17 of them — is read off the survey's own shapes and the lot merged,
 * and the outside of what comes back is the ring: 127 corners, then 66 and 69.
 * So the line falls where the walls meet the ground. The ring that stood here
 * before was traced by hand and pushed six metres clear of everything, and a
 * boundary six metres out in the car park is one nobody can check against
 * anything.
 *
 * Closed at six metres, because the blocks do not touch. Merged, a zone comes
 * out in eleven, seventeen and eighteen pieces standing up to 9.5m apart;
 * grown six metres and shrunk back again they join into one. One is what a
 * zone has to be: a zone in eighteen pieces is eighteen zones to answer for,
 * and a shop added in a lane between two of them would belong to neither.
 * What it costs is the passages narrower than twelve metres: they fill, so the
 * ring runs across them rather than round them and takes in 17 to 23% more
 * ground than the buildings themselves cover. The courtyards the closing left
 * open inside are dropped for the same reason — a zone is one ring.
 *
 * None of it is drawn. The ring is what picks the buildings out and nothing
 * else, and the buildings wearing the colour are the only drawing of it there
 * is; see `main.ts`.
 *
 * The colours are this page's own, and are an outlet mall's site map: the
 * saturated orange, pink and purple such a map gives its wings, rather than
 * anything the survey knows. Green is left out — the woods either side are
 * already green — and so are the blues, which the 黄瀬川 has. An example is
 * read by somebody copying it, and the site's tokens do not reach in here.
 */
export interface Zone {
  /**
   * The letter the page files it under, which stands beside its name over the
   * map.
   *
   * The mall's own names are what the zone is called; a letter is what a
   * reader holds while they look from the writing to the map and back. Kept
   * beside the name rather than worked out from the order, since the order is
   * the order these happen to be written in and a letter is a thing said.
   */
  readonly letter: string
  /** What the mall calls it. */
  readonly name: string
  /**
   * What the map says under its name.
   *
   * About the zone as this page has it — the shape it is picked out by, how
   * many buildings wear its colour — and not about the shops, which no survey
   * knows and this page has no business inventing.
   */
  readonly note: string
  /**
   * Where its letter stands, as [longitude, latitude].
   *
   * The middle of {@link Zone.site} by area, worked out once and written down.
   * The ring never moves, so working it out again every time the page loads
   * would be the same answer arrived at the slow way — and a page copying this
   * example would be copying a shoelace centroid it has no use for.
   *
   * By area and not by averaging the corners: the corners are the buildings'
   * own and crowd wherever the shops are close together, which pulls the
   * middle off toward the busiest end of the zone.
   */
  readonly middle: readonly [number, number]
  /** The ground it covers. */
  readonly site: Extract<MaskShape, { shape: 'polygon' }>
  /** The walls and roofs of everything standing on that ground. */
  readonly color: string
  /**
   * The line round each of those buildings: the same colour taken down to a
   * little over half.
   *
   * Its own colour and not one line colour for all three, because what the
   * line is for is telling one shop from the shop it stands wall to wall with
   * — and a line that is the zone's own colour does that without saying
   * anything else. Written out rather than worked out, as the colours are: a
   * page copied from here should be able to change one of these six without
   * finding out what makes the other five.
   */
  readonly edge: string
}

/**
 * The mall's own ground, as one ring.
 *
 * What the view is cut to. Everything outside it is neither drawn nor
 * fetched, so what is left on the page is the mall and nothing of 御殿場
 * around it: no woods beyond the ring, no 東名.
 *
 * Traced the way the zones were — every foot the page dresses, the 105 of
 * them, merged and the outside of what comes back taken — and then set thirty
 * metres out from it, the same thirty the whole way round. That standing off
 * is what the ring is for as much as the shape is: it is the ground the mall
 * is seen on, and a mall cut off at its own walls reads as a model of the
 * buildings rather than as a place. At thirty the car parks keep their
 * aprons, the 黄瀬川 comes through the middle of it, and the woods show along
 * the rim.
 *
 * Not on the walls, whatever the width. The zone rings fall exactly where the
 * walls meet the ground, which is right for picking buildings out and wrong
 * for cutting at: every pixel of a wall standing on the line asks which side
 * of itself it is on, the answer comes out half and half, and the wall is
 * drawn in stripes (measured here).
 *
 * Closed at seventy-five metres where a zone is closed at six, which is what
 * it takes to make one ring of it: the car parks stand off on their own, the
 * two furthest a hundred and fifty metres from the nearest shop, and at
 * seventy-three the ring still comes back in two pieces. What the closing and
 * the standing off cost together is ground — the ring holds 294,000m² where
 * the buildings cover 114,000. One ring is worth that here: the mall is one
 * place, and a page that cut it into four would be drawing the gaps.
 *
 * Simplified to a metre and a half, which is what takes it from 3,486 corners
 * to 97. A ring set on the viewer is drawn out on a grid rather than walked
 * corner by corner, so the length is not what this is for — it is for a file
 * somebody reads.
 */
export const SITE: Extract<MaskShape, { shape: 'polygon' }> = {
  shape: 'polygon',
  // prettier-ignore
  points: [
    [138.9615939, 35.3043731], [138.9617921, 35.304409], [138.9623315, 35.3045797],
    [138.9627938, 35.3048313], [138.9631351, 35.3051367], [138.9632231, 35.3054062],
    [138.9633882, 35.3056128], [138.9635534, 35.3057206], [138.9638506, 35.3058104],
    [138.9640047, 35.3058194], [138.9642359, 35.3057924], [138.964434, 35.3057206],
    [138.9645771, 35.3056308], [138.9646652, 35.3055499], [138.9647642, 35.3054062],
    [138.9648413, 35.3051906], [138.9652266, 35.3048313], [138.9653477, 35.3046426],
    [138.9654467, 35.3045707], [138.965799, 35.304427], [138.9658871, 35.304418],
    [138.9660522, 35.304454], [138.9664705, 35.3048223], [138.9667787, 35.3049391],
    [138.9669769, 35.304957], [138.967208, 35.3049301], [138.9674062, 35.3048582],
    [138.9676153, 35.3047324], [138.9678025, 35.3047055], [138.968518, 35.3047953],
    [138.9689143, 35.304993], [138.9690133, 35.3050738], [138.9690684, 35.3051636],
    [138.9690904, 35.3052984], [138.9689363, 35.3057026], [138.9689253, 35.3058194],
    [138.9689583, 35.306008], [138.9691124, 35.3062506], [138.9695417, 35.3066099],
    [138.9695858, 35.3067447], [138.9695747, 35.3068614], [138.9695197, 35.3069603],
    [138.9692665, 35.3071669], [138.9690904, 35.3072747], [138.9683749, 35.3079933],
    [138.9682538, 35.3080831], [138.9679786, 35.3081909], [138.9677694, 35.3083796],
    [138.9675713, 35.3088198], [138.9675383, 35.3090084], [138.9675823, 35.309242],
    [138.9677584, 35.3095115], [138.9677694, 35.3097091], [138.9677034, 35.3098259],
    [138.9673952, 35.3101313], [138.9672741, 35.3101762], [138.9670209, 35.3101762],
    [138.9665145, 35.3099696], [138.9662613, 35.3097181], [138.9661953, 35.3096013],
    [138.9661953, 35.3094576], [138.9662833, 35.3092959], [138.9663164, 35.3090893],
    [138.9662833, 35.3089006], [138.9661513, 35.308685], [138.9659201, 35.3085143],
    [138.9657219, 35.3084425], [138.9653807, 35.3083976], [138.9652266, 35.3082987],
    [138.9650394, 35.3082269], [138.9647752, 35.3081909], [138.9645221, 35.3082179],
    [138.9643019, 35.3082987], [138.9641478, 35.3083976], [138.9637075, 35.3084694],
    [138.9635424, 35.3085323], [138.9633442, 35.3086581], [138.963124, 35.308712],
    [138.9628819, 35.3088198], [138.9626947, 35.3088557], [138.9625847, 35.3088467],
    [138.9624636, 35.3088018], [138.9623205, 35.308667], [138.9621223, 35.3085413],
    [138.9620563, 35.3084155], [138.9619022, 35.3079574], [138.9618911, 35.3077328],
    [138.9618581, 35.307625], [138.961627, 35.3072836], [138.9614178, 35.307077],
    [138.9611646, 35.3064662], [138.9610435, 35.306044], [138.9610435, 35.3057385],
    [138.9609224, 35.3054331], [138.9609555, 35.3052265], [138.9611646, 35.3046696],
    [138.9613958, 35.304427],
  ],
}

export const ZONES: readonly Zone[] = [
  {
    letter: 'A',
    name: 'ウエストゾーン',
    note: '42棟',
    middle: [138.9626024, 35.3070752],
    color: '#ff7d35',
    edge: '#8c451d',
    site: {
      shape: 'polygon',
      // prettier-ignore
      points: [
        [138.9628119, 35.3085484], [138.9627685, 35.3084474], [138.9628184, 35.3084353],
        [138.9628156, 35.3084274], [138.962979, 35.308388], [138.9630001, 35.3084457],
        [138.9630981, 35.3084214], [138.9631035, 35.3084356], [138.96315, 35.3084239],
        [138.9632053, 35.30841], [138.9631903, 35.3083705], [138.9631546, 35.3083796],
        [138.9631126, 35.3082639], [138.9631488, 35.3082096], [138.9632558, 35.3080484],
        [138.963827, 35.308301], [138.9638973, 35.3082815], [138.9638839, 35.30822],
        [138.9639431, 35.3081309], [138.9639941, 35.3081529], [138.9640008, 35.3081424],
        [138.9640138, 35.308148], [138.964025, 35.3081306], [138.9639154, 35.3080834],
        [138.9639355, 35.3080531], [138.9634011, 35.3078179], [138.9633216, 35.3079382],
        [138.9631789, 35.307875], [138.9631832, 35.3078687], [138.9631468, 35.3078526],
        [138.9631061, 35.3078347], [138.9630634, 35.3078989], [138.9630736, 35.3079034],
        [138.9630038, 35.3080083], [138.9626975, 35.3080823], [138.9626156, 35.3078568],
        [138.9629918, 35.3077562], [138.9630933, 35.3077953], [138.9630977, 35.3077565],
        [138.9631461, 35.3077438], [138.96341, 35.3076744], [138.9633991, 35.307647],
        [138.9632694, 35.3073178], [138.9633264, 35.3073023], [138.9633035, 35.3072464],
        [138.963278, 35.3072533], [138.9631414, 35.3069067], [138.9629975, 35.3065418],
        [138.9629771, 35.30649], [138.9629835, 35.3064179], [138.9631007, 35.3063867],
        [138.9630782, 35.30633], [138.9631369, 35.3063143], [138.9630579, 35.3061108],
        [138.9627474, 35.3060924], [138.9627534, 35.3060227], [138.9627031, 35.3060198],
        [138.9627089, 35.3059539], [138.9622434, 35.3059263], [138.9622445, 35.3059128],
        [138.962119, 35.3059055], [138.9621193, 35.3059018], [138.9619289, 35.3058882],
        [138.9618763, 35.3059186], [138.9618634, 35.3061342], [138.9618882, 35.3061672],
        [138.9621486, 35.3061806], [138.9621459, 35.3062114], [138.9622004, 35.3062146],
        [138.9622012, 35.3062072], [138.9624264, 35.3062206], [138.9624396, 35.3063087],
        [138.9622611, 35.3063561], [138.9622592, 35.3063512], [138.9621671, 35.3063757],
        [138.9621589, 35.3063546], [138.9619508, 35.3063352], [138.9618719, 35.3064175],
        [138.9617938, 35.3064062], [138.9617427, 35.3062785], [138.9617423, 35.3062109],
        [138.9616982, 35.306211], [138.9617248, 35.3059191], [138.9616893, 35.3058804],
        [138.9613915, 35.3058615], [138.9613748, 35.3060283], [138.9614771, 35.3063672],
        [138.9617201, 35.3069628], [138.9618468, 35.3069278], [138.9619772, 35.3072615],
        [138.9620285, 35.3072488], [138.9620661, 35.3072395], [138.9621322, 35.3071323],
        [138.9622207, 35.3071381], [138.9622267, 35.3071535], [138.9623857, 35.3072176],
        [138.962446, 35.3072004], [138.9625026, 35.3073409], [138.9624019, 35.307368],
        [138.9624198, 35.3074115], [138.9625199, 35.307384], [138.9625708, 35.3075108],
        [138.9624691, 35.3075359], [138.9624856, 35.3075801], [138.9625882, 35.3075544],
        [138.9626277, 35.3076528], [138.9626641, 35.3077435], [138.9626564, 35.3077455],
        [138.9626815, 35.3078079], [138.9625366, 35.3078369], [138.9625131, 35.3077871],
        [138.9624192, 35.3078098], [138.9624179, 35.3078062], [138.962345, 35.3078239],
        [138.9623468, 35.307829], [138.9622523, 35.3078518], [138.9622603, 35.3078735],
        [138.9622237, 35.3078823], [138.9623774, 35.3083055], [138.9623669, 35.3083081],
        [138.9623924, 35.3083783], [138.9624725, 35.3083589], [138.9624969, 35.3084244],
        [138.9625821, 35.3084034], [138.9626044, 35.3084655], [138.9626134, 35.3084634],
        [138.9626677, 35.3085896],
      ],
    },
  },
  {
    letter: 'B',
    name: 'イーストゾーン',
    note: '40棟',
    middle: [138.9668324, 35.3073395],
    color: '#fb2b74',
    edge: '#8a1840',
    site: {
      shape: 'polygon',
      // prettier-ignore
      points: [
        [138.966734, 35.3081503], [138.9667375, 35.3081598], [138.9668056, 35.3081434],
        [138.966809, 35.3081527], [138.9679591, 35.3078775], [138.967958, 35.3078743],
        [138.968086, 35.3078449], [138.9686806, 35.3072617], [138.9688587, 35.3070871],
        [138.9684099, 35.3067824], [138.9684164, 35.3067759], [138.9683493, 35.3067304],
        [138.9682624, 35.3066719], [138.9682556, 35.3066785], [138.9678084, 35.3063738],
        [138.9676286, 35.3065497], [138.9676324, 35.3065523], [138.9673601, 35.3068183],
        [138.9665358, 35.3070158], [138.9664505, 35.3070363], [138.9663841, 35.3070518],
        [138.9663819, 35.3070457], [138.9663511, 35.3070529], [138.9662203, 35.306949],
        [138.9662153, 35.3069531], [138.9656196, 35.3065482], [138.9655032, 35.3065271],
        [138.9653009, 35.3065724], [138.9650471, 35.3065504], [138.9649681, 35.3072177],
        [138.9650175, 35.3072218], [138.9650834, 35.3072257], [138.9651628, 35.3072055],
        [138.9652378, 35.3074162], [138.9652179, 35.3074209], [138.9652491, 35.3075087],
        [138.9652702, 35.3075037], [138.965309, 35.3076125], [138.9653264, 35.3076084],
        [138.9653612, 35.3077062], [138.9653389, 35.3077436], [138.9655088, 35.3078212],
        [138.9654155, 35.3079598], [138.9654538, 35.3079771], [138.9654437, 35.3080489],
        [138.9654322, 35.3080516], [138.9654476, 35.3080964], [138.9654976, 35.308085],
        [138.9655234, 35.3081575], [138.9660871, 35.3080241], [138.9663458, 35.30814],
        [138.9663686, 35.3081061], [138.9665026, 35.3081729], [138.9665285, 35.3081383],
        [138.9664935, 35.3081209], [138.9664541, 35.3081013], [138.9664289, 35.3080887],
        [138.9663925, 35.3080705], [138.9664486, 35.3079872], [138.9665361, 35.3079949],
        [138.9665372, 35.307998], [138.9665714, 35.3079909], [138.9666099, 35.3080981],
        [138.9665616, 35.3081283], [138.9666232, 35.308135], [138.966637, 35.3081735],
      ],
    },
  },
  {
    letter: 'C',
    name: 'ヒルサイド',
    note: '17棟',
    middle: [138.9660639, 35.3057939],
    color: '#6c348f',
    edge: '#3b1d4f',
    site: {
      shape: 'polygon',
      // prettier-ignore
      points: [
        [138.9661271, 35.3065747], [138.9661479, 35.3065891], [138.966238, 35.3065027],
        [138.9662327, 35.3064368], [138.9663109, 35.3064046], [138.9664798, 35.3065217],
        [138.9665666, 35.3065238], [138.9667417, 35.3063526], [138.9668425, 35.3064237],
        [138.9668459, 35.3064206], [138.9669677, 35.3065065], [138.9671562, 35.3063286],
        [138.9671269, 35.3063079], [138.967223, 35.3062135], [138.9673083, 35.306001],
        [138.9672484, 35.3059896], [138.9672003, 35.3059539], [138.9671812, 35.3059713],
        [138.967077, 35.3058951], [138.9670644, 35.3059067], [138.9662355, 35.3053313],
        [138.9661164, 35.3051525], [138.9661721, 35.3051254], [138.9658858, 35.3046888],
        [138.9656104, 35.3048093], [138.9657063, 35.3049577], [138.9653494, 35.3051099],
        [138.9654331, 35.305248], [138.9652389, 35.3053336], [138.9652131, 35.3052934],
        [138.9651257, 35.3053307], [138.965152, 35.3053718], [138.9651179, 35.3053869],
        [138.965192, 35.3054979], [138.9651853, 35.3055009], [138.9652433, 35.3055879],
        [138.9650497, 35.3056712], [138.9650353, 35.3057123], [138.965166, 35.3059094],
        [138.9651407, 35.3059599], [138.9652096, 35.3059863], [138.9652191, 35.3059678],
        [138.9653371, 35.30594], [138.965365, 35.3059754], [138.965356, 35.3059355],
        [138.9653882, 35.305928], [138.965448, 35.3057944], [138.9656095, 35.305902],
        [138.9656014, 35.3059096], [138.9656538, 35.3059464], [138.9656266, 35.3060146],
        [138.9653777, 35.3060316], [138.9653755, 35.3060217], [138.9653187, 35.3060757],
        [138.9653225, 35.3060783], [138.9652074, 35.3061886], [138.9651688, 35.3061617],
        [138.9650735, 35.3062529], [138.9651307, 35.3062926], [138.9651866, 35.3062391],
        [138.9652651, 35.3062937], [138.9653267, 35.3062347], [138.9653444, 35.306247],
        [138.9653448, 35.3062467], [138.9654141, 35.3062902], [138.9655047, 35.3061942],
        [138.9660406, 35.3065661], [138.9660324, 35.306574], [138.9660878, 35.3066124],
      ],
    },
  },
]

/**
 * The car parks, by the names PLATEAU gives them.
 *
 * Written out one by one, which nothing else on this page is: the zones are
 * ground and pick up whatever stands on them, and that is what keeps the page
 * from carrying a copy of the survey. These cannot be had that way — a car
 * park stands on the zone's own ground, beside the shops it serves — so
 * telling them apart means naming them.
 *
 * What it costs is what naming buildings always costs: the survey may redraw
 * one under the same name, or give a new one no name this page knows, and
 * either way the page is a release behind. Seven names is a small thing to be
 * behind on; a list of every shop would not be.
 */
export const CAR_PARKS: readonly string[] = [
  'bldg_61e61359-0da6-412a-bd2b-6c2f2cff3302',
  'bldg_d2a4e17c-5276-48df-a4d2-067485d3dd4f',
  'bldg_e60d90e1-89dd-427b-ac47-fa7d3707c79b',
  'bldg_482aff5c-8cb7-4e6c-a1ec-af56f5d94ba9',
  'bldg_b0909bcb-5682-4f32-ac85-749d8e34baf6',
  'bldg_bc3a1a6f-81df-4389-b792-0b5eea7fc3b5',
  'bldg_2f81b0d7-8b45-4407-84bf-c04908b182ae',
]

/**
 * The grey they wear, said once.
 *
 * Beside the zones' own colours and for the same reason: it is worn on the
 * map and shown again in the key, as the swatch beside 駐車場, and a colour
 * written in both places is one that drifts the first time either is changed.
 * The zones never had that problem — the page and the letter both read
 * `zone.color` — and this now does not either.
 */
export const CAR_PARK = {
  /** The walls and roofs, as a zone has `color`. */
  color: '#9aa3ad',
  /** The line round each, as a zone has `edge`. */
  edge: '#555c65',
}
