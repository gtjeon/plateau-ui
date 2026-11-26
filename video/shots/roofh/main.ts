/**
 * For choosing a roof: one building's roof with the helipad on it, in the
 * middle of the screen. `?id=&e=&n=&up=&w=&rot=&z=&p=&h=` — the picture's
 * middle in metres east and north of the building's foot and its height.
 */
import { Viewer } from '@plateau-ui/core'
import { helipad } from '../film/helipad.js'

const q = new URLSearchParams(location.search)
const id = q.get('id')!
const e = Number(q.get('e') ?? 0)
const n = Number(q.get('n') ?? 0)
const up = Number(q.get('up') ?? 0)
const width = Number(q.get('w') ?? 12)
const rotate = Number(q.get('rot') ?? 0)
const [lng, lat] = (q.get('c') ?? '139.6995,35.6440').split(',').map(Number) as [number, number]

const viewer = new Viewer({
  container: 'map',
  center: [lng, lat],
  zoom: Number(q.get('z') ?? 18.6),
  pitch: Number(q.get('p') ?? 40),
  heading: Number(q.get('h') ?? 112),
  buildings: { minZoom: false },
})
Object.assign(window, { viewer })

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const where = { building: id, offset: [e, n, up] as [number, number, number] }

/** Moves the view until the picture's middle is the screen's middle. */
async function centre(): Promise<void> {
  const camera = viewer.camera
  for (let i = 0; i < 3; i++) {
    const at = viewer.screen.at(where)
    if (!at) return
    const [c0, c1] = camera.view.center
    const d = 0.0001
    camera.center = [c0 + d, c1]
    await pause(50)
    const ax = viewer.screen.at(where)!
    camera.center = [c0, c1 + d]
    await pause(50)
    const ay = viewer.screen.at(where)!
    camera.center = [c0, c1]
    await pause(50)
    // How the point moves on screen per step of each, then the steps that bring it to the middle
    const j = [(ax.x - at.x) / d, (ay.x - at.x) / d, (ax.y - at.y) / d, (ay.y - at.y) / d]
    const det = j[0]! * j[3]! - j[1]! * j[2]!
    const dx = 640 - at.x
    const dy = 360 - at.y
    camera.center = [c0 + (j[3]! * dx - j[1]! * dy) / det, c1 + (-j[2]! * dx + j[0]! * dy) / det]
    await pause(300)
  }
}

;(async () => {
  for (let i = 0; i < 300 && !viewer.buildings.said(id); i++) await pause(100)
  viewer.buildings.setStyle(id, {
    // As the film has it by then: the building in its grey, which the white picture reads against
    outline: true,
    outlineWidth: 3,
    wallColor: '#7d8792',
    roofImage: { image: helipad(), width, rotate, offset: [e, n, up], depth: Number(q.get('depth') ?? 1) },
  })
  await centre()
})()
