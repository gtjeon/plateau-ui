import { Viewer } from '@plateau-ui/core'
import { shot, standing, track } from '../../shared/shot.js'

const TOWER = 'bldg_3de83faa-99f4-488f-86e1-3e2d4bcdbc9d'
const viewer = new Viewer({
  container: 'map',
  center: [139.76253, 35.68325],
  zoom: 18.2,
  pitch: 55,
  heading: 40,
  buildings: { minZoom: false },
})
;(window as any).viewer = viewer
const heading = track([[0, 40], [3, 80]])
let grown = false
shot(3, standing(viewer.buildings.on.bind(viewer.buildings)), (t) => {
  viewer.camera.heading = heading(t)
  if (!grown && t > 0.5) {
    grown = true
    viewer.buildings.animate(TOWER, [{ scale: [1, 1, 1] }, { scale: [1, 1, 1.6] }], { duration: 2000, fill: 'forwards' })
  }
})
