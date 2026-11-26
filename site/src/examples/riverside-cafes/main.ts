/**
 * 目黒川沿いのカフェ — three buildings by the river, each with its café's
 * photograph on one wall and one colour, the same for the three, on the rest.
 *
 * The page says which building and how wide the photograph is, and where on
 * it the middle goes. Which wall that is and how the light falls on it are not
 * written here: the library finds the wall the place is on, and lights the
 * photograph as it lights the wall.
 *
 * The pointer on a café grows it and pushes the buildings round it back, with
 * its card over the roof and a line round it, and a click keeps it that way;
 * that is in `pointer.ts`. Which buildings and how wide are in `data.ts`, the
 * pictures in `photos.ts`, and the list of cafés in `ui.ts`. This file is the
 * map.
 */
import { AnnotationLayer, Viewer } from '@plateau-ui/core'
import { AREA, CAFES, VIEW, WALL } from './data.js'
import { growOnPointer } from './pointer.js'
import { photo } from './photos.js'
import { ui } from './ui.js'

/** The cafés' cards, shown over the roof of the one that is up. */
const labels = new AnnotationLayer()

const viewer = new Viewer({
  container: 'map',
  pitch: VIEW.pitch,
  heading: VIEW.heading,
  mask: { shape: { type: 'polygon', points: AREA } },
  // The guard is for a wide view asking for half a prefecture of tiles. The
  // rectangle is about 100 m a side, so there is nothing left for it to guard.
  buildings: { minZoom: false },
  layers: [labels],
})

// Opens on this much ground, however wide the screen. Given as a zoom, the
// same view would show a phone less than half as much across as a desk
viewer.camera.fitBounds(VIEW.bounds)

// Each café's photograph on the wall the reader looks at, as wide as that wall,
// and the cafés' colour on the rest, as soon as the file is in. Likely before the
// building has arrived, which the library does not mind: it holds a style by
// the building's name until the building turns up wearing it. What it wears
// already is kept, as the line round it is if it was picked first
for (const cafe of CAFES) {
  void photo(cafe).then((image) => {
    viewer.buildings.setStyle(cafe.building, {
      ...viewer.buildings.getStyle(cafe.building),
      wallColor: WALL,
      wallImage: { image, width: cafe.face[0], offset: cafe.front },
    })
  })
}

growOnPointer(viewer, labels)
ui(CAFES)

addEventListener('beforeunload', () => {
  viewer.dispose()
})
