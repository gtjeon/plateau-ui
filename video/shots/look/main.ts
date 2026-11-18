/** A plain viewer at whatever view the address gives, for finding shots: `?c=lng,lat&z=&p=&h=` */
import { Viewer } from '@plateau-ui/core'
import { Raycaster, Vector3 } from 'three'

const q = new URLSearchParams(location.search)
const [lng, lat] = (q.get('c') ?? '139.7645,35.6815').split(',').map(Number)
const viewer = new Viewer({
  container: 'map',
  center: [lng!, lat!],
  zoom: Number(q.get('z') ?? 18.3),
  pitch: Number(q.get('p') ?? 55),
  heading: Number(q.get('h') ?? 30),
  mask: { shapes: [{ shape: 'view' }] },
  buildings: { minZoom: false },
})
;Object.assign(window, { viewer, __three: { Raycaster, Vector3 } })
