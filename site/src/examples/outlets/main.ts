/**
 * アウトレット — 御殿場, and nothing laid over it.
 *
 * Every other example here is about something the library puts on top of a
 * city: a mark, a mask, a model, a number painted on a wall. This one is the
 * city. Two layers and a place to stand is the whole page, and it is here to
 * show what that alone comes to.
 *
 * 御殿場 rather than 東京, because PLATEAU is not only 東京 and because this
 * place is nothing like the districts the other pages open in: the foot of
 * 富士山, an outlet mall of one- and two-storey sheds laid along the slope,
 * 黄瀬川 cutting past it, woods on both sides. Measured on the page, the
 * buildings in view are one storey 215, two 71, three or more 10 — so what
 * reads here is a plan and a roofline, not a skyline. A wall of towers would
 * say the survey is towers.
 */
import { AnnotationLayer, Html, Viewer } from '@plateau-ui/core'
import { CAR_PARK, CAR_PARKS, SITE, ZONES } from './data.js'
import { ui, zoneName } from './ui.js'

/**
 * Each zone's name, standing over the middle of it as a mall's site map
 * prints it: the letter in the zone's colour, the name, and how many buildings
 * wear the colour. `ui.ts` writes them, with the heading in the corner.
 *
 * The page's own markup and not letters drawn on the map, which is what lets
 * it be a button: clicking one flies to its zone, the keyboard reaches it, and
 * a reader who cannot see the map is read the name.
 *
 * Over `zone.middle`, which is written down in `data.ts` beside the ring it is
 * the middle of — the ring never moves, so nor does its middle.
 *
 * Seventy metres up. Nothing here is tall — one storey 215, two 71 — so a
 * name a few metres up sits among the sheds and has to be picked out of them;
 * carried seventy it reads as hanging over its zone, which is what a sign over
 * a wing of a mall does.
 */
const labels = new AnnotationLayer()
for (const zone of ZONES) {
  const name = zoneName(zone, () => viewer.camera.flyTo({ center: zone.middle }))
  labels.add(new Html({ at: zone.middle, height: 70, element: name }))
}

/**
 * Standing north-east of the mall, at the angle a low building is still a
 * building at, and turned so the rows run across the view rather than away
 * from it — end-on they hide one another, and what there is to see here is
 * how many of them there are.
 *
 * Steeper and the sheds flatten into their own plans — a two-storey shop seen
 * from overhead is a roof and a car park, and nothing here is tall enough for
 * the fall of the land to show against it. 70° is as far back as the viewer
 * lies and this takes all of it: the long roofs step down the slope one
 * behind another, which is what says there is a slope.
 *
 * The land carries its own heights, and here that is not decoration: the site
 * falls about 200m across the view, the mall is built along the fall in
 * terraces, and drawn flat the terraces become one floor and the river beside
 * them becomes a blue line on a table.
 *
 * The view is cut to `SITE`, which is the one ring round everything the page
 * dresses. Nothing outside it is drawn or fetched, so 御殿場 falls away and
 * what is left standing on its own ground is the mall: the three zones, the
 * car parks that serve them, and the ground they stand on. The woods, the
 * river and the 東名 are not hidden — they were never asked for.
 *
 * The buildings' `minZoom` is the guard against how many tiles a wide view
 * asks for, and
 * the default of 18 is set for a city of towers, where z18 is already a
 * district. Here it is a hundred metres of car park: the mall does not fit on
 * screen until 17, and at 17 the default has taken the buildings away. Turned
 * off rather than lowered: `SITE` already bounds what any zoom may ask for,
 * since nothing outside the ring is fetched however far the view steps back.
 */
const viewer = new Viewer({
  container: 'map',
  pitch: 70,
  heading: -142,
  // No trees. They are scattered over the plots land use calls 公共空地 and
  // 山林, and land use says what a plot is for rather than what is on it: round
  // here the mall's own grounds are one such plot, so the woods would come up
  // through the buildings standing on them.
  ground: { elevation: true, trees: { visible: false } },
  // No windows. The glass comes through the zone colours as grey streaks along
  // the walls, which reads as dirt on the colour rather than as windows — and a
  // shed of one storey has nothing to say through them anyway.
  buildings: {
    minZoom: false,
    windows: { visible: false },
  },
  mask: { shape: SITE },
  layers: [labels],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds({ southWest: [138.96176, 35.304019], northEast: [138.96828, 35.309341] })

/**
 * Each zone painted in the colour a mall's site map would give it.
 *
 * The shape is handed over and the layer does the rest: every building whose
 * foot falls on that ground wears the colour, as its tile lands and for as
 * long as it stands there. Nothing about which buildings there are is written
 * on this page — the same three shapes would paint the mall as it was built
 * and as it will be added to.
 *
 * And nothing is drawn of the shapes themselves. They are the buildings' own
 * outline — see `data.ts` — so the city wearing the colour is the shape, said
 * in the only way that cannot drift from it: a line laid over the top would
 * be a second drawing of what is already on screen.
 *
 * A building takes the zone's colour whole — walls and roof alike, since the
 * colour a page paints is the building's and not one face of it — and a line
 * round each in the same colour taken down. That line is the whole reason a
 * block of twenty shops does not read as one shed: the shops stand wall to
 * wall, and in one colour their own corners are all that tell them apart.
 *
 * Three pixels of it, standing one off the wall. The line is found on the
 * screen, round the shape as it stands there — not along the folds of the
 * shape itself — so the standing off is clear ground between the shed and its
 * own edge rather than a gap opening in every crease of the roof.
 *
 * Asked for by `outline` and not by giving it a colour: the switch is what
 * draws it, and a colour left out would draw it in the library's own. Here the
 * colour is the point, so both are said.
 *
 * Nothing else is asked for. The shapes and the shadows are left as the survey
 * and the palette have them.
 */
for (const zone of ZONES) {
  viewer.buildings.setStyle(zone.site, {
    wallColor: zone.color,
    outline: true,
    outlineColor: zone.edge,
    outlineWidth: 3,
    outlineGap: 1,
  })
}

/**
 * The car parks, dressed as the shops are and in a grey.
 *
 * Named one by one rather than picked off a shape, because they stand inside
 * the zones the shops do — a car park at the end of a row is on the same
 * ground as the row — so no ring drawn round the mall tells them apart.
 *
 * Named, and not `site`: `site` is a shape on this page — a zone's ground —
 * and it is what the library calls the same method's other door. A reader
 * copying the two loops one under the other should be able to see at a glance
 * which takes a shape and which takes a name.
 *
 * Grey because they are not a wing of the mall and should not read as one. A
 * fourth colour beside the orange, the pink and the purple would say there is
 * a fourth zone to walk to; a grey says the same building is there and is not
 * somewhere to go. Same line, same width, same standing off, so what changes
 * is the colour and nothing else.
 */
for (const carPark of CAR_PARKS) {
  viewer.buildings.setStyle(carPark, {
    wallColor: CAR_PARK.color,
    outline: true,
    outlineColor: CAR_PARK.edge,
    outlineWidth: 3,
    outlineGap: 1,
  })
}

ui()
