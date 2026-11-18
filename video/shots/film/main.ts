/**
 * The opening and the first part of the video in one take: the city rising
 * under the title, then one tower given what the library can give a building,
 * ending on a city cut down to what is needed, the miniature look, and two
 * things three.js brings with it.
 */
import { Marker, Solid, Viewer, Viewshed, type ReplicaBuilding, type Theme } from '@plateau-ui/core'
import { Mesh, MeshStandardMaterial, Raycaster, TorusKnotGeometry, Vector3 } from 'three'
import { inOut, linear, mix, mixAngle, out, shot, shown, span } from '../../shared/shot.js'
import { note, part, PART_IN } from '../../shared/overlay.js'
import { Fireworks } from '../../../site/src/examples/fireworks/fireworks.js'
import { helipad } from './helipad.js'
import { housingShape, lensShape } from '../../../site/src/examples/security-camera/camera.js'
import { BODY, FRONT, GLASS, PAST_THE_LENS } from '../../../site/src/examples/security-camera/data.js'

// ---- The place ---------------------------------------------------------------

/** The tower over 中目黒 station, 163 m among three- and four-storey streets. */
const TOWER = 'bldg_2f515380-465c-4fe9-8827-c06eb9722473'
/** Where it stands, until the survey says exactly (read once it has landed). */
let home: [number, number] = [139.70038, 35.64383]
let tall = 163
let storeys = 45

const M_PER_LAT = 110_950
const mPerLng = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180)
function offset([lng, lat]: readonly [number, number], east: number, north: number): [number, number] {
  return [lng + east / mPerLng(lat), lat + north / M_PER_LAT]
}
function toward(from: readonly [number, number], metres: number, bearing: number): [number, number] {
  const r = (bearing * Math.PI) / 180
  return offset(from, metres * Math.sin(r), metres * Math.cos(r))
}

// ---- Timing ------------------------------------------------------------------

const OPENING = 7
/** When the part's name starts to come in: once the title has gone. */
const PART_FROM = 6.4
const STEP = 3.6
const STEP_COUNT = 20
/** How long step 4, the windows going off and on, takes: less than the beat. */
const WINDOWS_OFF_STEP = 2.8
/** How long step 13 takes: Tokyo Tower coming up, standing a moment, and going. */
const BRING_STEP = 4.6
/**
 * Steps that take other than the beat: the windows going off and on (4),
 * Tokyo Tower brought in and sent back (13), and the camera's sight (14),
 * which goes in close to the camera on the wall before it stands back to
 * show what it sees.
 */
const LONGER: Readonly<Record<number, number>> = { 4: WINDOWS_OFF_STEP, 13: BRING_STEP, 14: 6.2 }
/** The steps begin once the part's name has settled at the top. */
function stepAt(n: number): number {
  let t = PART_FROM + PART_IN
  for (let i = 1; i < n; i++) t += LONGER[i] ?? STEP
  return t
}
/** The last step, the fireworks, runs on a little past the others' length. */
const SECONDS = stepAt(STEP_COUNT) + 5

/** Step 17: how much of the city is kept, round the view's middle, in metres. */
const ISLAND = 170
const ISLAND_FADE = 30
/** Where the cut starts from: wide enough that nothing on screen is cut yet. */
const ISLAND_FROM = 1400

// ---- The viewer --------------------------------------------------------------

const q = new URLSearchParams(location.search)
/** The tower's colour: a quiet grey that reads as finished rather than as a highlight. */
const WALL = q.get('wall') ?? '#7d8792'
/** The one warm colour the first part uses, for what is laid on the tower. */
const ACCENT = '#f08a4b'

/**
 * Which way the camera on the wall looks: south-west, out over the open
 * ground beside the tower, where what it sees lies on the ground as a fan.
 */
const EYE_FACING = Number(q.get('face') ?? 225)
/** How high up the wall it hangs, in metres. */
const EYE_UP = Number(q.get('up') ?? 6)
/**
 * The example's camera at a little over half its size: it is drawn to be read
 * with a whole square on screen, and here the camera is gone in close to.
 */
const CAMERA_SIZE = Number(q.get('size') ?? 0.6)
/**
 * How far up the screen the middle goes for the camera to be in it, against
 * its height times the pitch's tangent (measured, as the roof's nudge was).
 */
const EYE_LIFT = Number(q.get('lift') ?? 1)
/**
 * The way the camera looks from in step 14: from the camera's side and a little
 * in front of it (up the screen is the bearing 100° short of the way it looks),
 * so the tower it hangs on is beside it and not in front of it.
 */
const EYE_HEADING = (360 + Number(q.get('side') ?? 90) - EYE_FACING) % 360
/** The sight step's camera, close and stood back (zoom, pitch, metres on along the way it looks). */
const EYE_SHOT = {
  close: { z: Number(q.get('cz') ?? 20.6), p: Number(q.get('cp') ?? 45), eye: Number(q.get('ce') ?? 8) },
  back: { z: Number(q.get('bz') ?? 19.9), p: Number(q.get('bp') ?? 45), eye: Number(q.get('be') ?? 22) },
}
/** Short of the block across the open ground, so what it sees stays on the ground. */
const EYE_RANGE = Number(q.get('range') ?? 36)
const EYE_FOV = Number(q.get('fov') ?? 70)

const viewer = new Viewer({
  container: 'map',
  center: home,
  zoom: 17.6,
  pitch: 58,
  heading: 70,
  mask: { shapes: [{ shape: 'view' }] },
  // Low enough that the city is there when the camera comes down to it, high
  // enough that it is not while the title is up
  buildings: { minZoom: 16.4 },
})
const buildings = viewer.buildings
// For looking things up from outside while framing shots
Object.assign(window, { viewer, __three: { Raycaster, Vector3 } })

// ---- The camera --------------------------------------------------------------

/**
 * Where the camera is at each moment of the first part: zoom, pitch, heading,
 * and how far the middle of the screen is set ahead of the tower's foot — in
 * halves of the tower as the pitch shows it, so 1 puts the whole tower in the
 * middle and 2 puts its roof there.
 */
interface Key {
  readonly t: number
  readonly z: number
  readonly p: number
  readonly h: number
  readonly k: number
  /** Stands at the view the simple-map example opens on, rather than on the tower. */
  readonly mini?: boolean
  /** Metres east and north the middle is moved on from there. */
  readonly nudge?: readonly [number, number]
  /**
   * Stands on the camera on the wall rather than on the tower: the camera in
   * the middle, and the middle moved on this many metres the way it looks.
   */
  readonly eye?: number
}
const arrive = (n: number, after: number, z: number, p: number, h: number, k: number): Key => ({
  t: stepAt(n) + after,
  z,
  p,
  h,
  k,
})
/**
 * The view the simple-map example opens on: 中目黒 laid back to 70°, looking
 * east along the river, which is the view its miniature look was tuned on.
 * Worked out with `fitBounds` once the screen is known (see prepare).
 */
const MINI_BOUNDS = { southWest: [139.695829, 35.641973], northEast: [139.700571, 35.645827] } as const
let mini = { center: [139.6982, 35.6439] as [number, number], zoom: 17.3 }
/** Metres the miniature view is moved west of where simple-map's fit puts it. */
const MINI_DOWN = Number(q.get('minidown') ?? 30)
/** How close the camera comes for the picture on the roof. */
const ROOF_ZOOM = Number(q.get('roofz') ?? 19.5)
const ROOF_NUDGE = [11.7, 15.8] as const
const atMini = (t: number, h: number, dz = 0): Key => ({ t, z: dz, p: 70, h, k: 0, mini: true })

/** Metres east and north the middle moves toward the clearing (step 12) and to take in Tokyo Tower (13). */
const HIDE_NUDGE = (q.get('hn') ?? '28,28').split(',').map(Number) as unknown as readonly [number, number]
const BRING_NUDGE = (q.get('bn') ?? '25,25').split(',').map(Number) as unknown as readonly [number, number]

const KEYS: readonly Key[] = [
  { t: 0, z: 15.6, p: 40, h: 40, k: 0 },
  { t: 0.5, z: 15.6, p: 40, h: 40, k: 0 },
  { t: stepAt(1) - 0.3, z: 17.5, p: 58, h: 64, k: 0.8 },
  arrive(1, 1.0, 18.0, 58, 72, 1), // outline
  arrive(2, 0, 18.05, 58, 78, 1),
  arrive(2, 1.0, 18.0, 56, 92, 1), // colour
  arrive(3, 0, 18.0, 56, 98, 1),
  arrive(3, 0.8, 17.9, 62, 100, 1), // floors
  arrive(4, 0, 17.9, 62, 104, 1),
  arrive(4, 0.8, 18.8, 60, 108, 1.3), // the windows off and on
  arrive(5, 0, 18.8, 60, 110, 1.3), // their size
  arrive(6, 0, 18.8, 60, 112, 1.3),
  arrive(6, 0.8, 18.5, 58, 118, 1.1), // their colours
  arrive(7, 0, 18.5, 58, 122, 1.1),
  arrive(7, 0.8, 18.1, 56, 128, 1), // the city's fold lines
  arrive(8, 0, 18.1, 56, 132, 1),
  // The roof, with the deck the picture goes on in the middle: the deck is off
  // the foot's middle (which counts the podium), so the middle is moved on to it
  // (measured: without it the deck stood 90 px below and 50 px right of the middle)
  { ...arrive(8, 1.1, ROOF_ZOOM, 26, 112, 2), nudge: ROOF_NUDGE },
  { ...arrive(9, 0, ROOF_ZOOM, 26, 118, 2), nudge: ROOF_NUDGE },
  arrive(9, 1.0, 18.1, 50, 118, 1.4), // marker
  arrive(10, 0, 18.1, 50, 124, 1.4),
  arrive(10, 0.9, 17.6, 55, 110, 1.8), // stretch
  arrive(11, 0, 17.6, 55, 104, 1.8),
  arrive(11, 0.9, 17.4, 55, 84, 0.9), // move
  arrive(12, 0, 17.4, 55, 80, 0.9),
  // In over the clearing as it is made, then back for Tokyo Tower beside the tower
  { ...arrive(12, 0.9, 17.9, 55, 78, 0.9), nudge: HIDE_NUDGE }, // the buildings beside it taken out
  { ...arrive(13, 0, 17.9, 55, 76, 0.9), nudge: HIDE_NUDGE },
  { ...arrive(13, 1.0, 17.3, 52, 74, 1.6), nudge: BRING_NUDGE }, // Tokyo Tower brought in
  { ...arrive(13, BRING_STEP - 0.8, 17.3, 52, 72, 1.6), nudge: BRING_NUDGE },
  arrive(14, 0, 17.4, 55, 80, 0.9),
  // The sight: in close to the camera on the wall, from its side, so the
  // lens points across the screen; then standing back along the way it looks
  // for the ground it sees. (From behind it, the tower stands in front of it.)
  { t: stepAt(14) + 1.3, ...EYE_SHOT.close, h: EYE_HEADING, k: 0 },
  { t: stepAt(14) + 2.4, ...EYE_SHOT.close, eye: EYE_SHOT.close.eye + 2, h: EYE_HEADING, k: 0 },
  { t: stepAt(14) + 4.6, ...EYE_SHOT.back, h: EYE_HEADING, k: 0 },
  { t: stepAt(15), ...EYE_SHOT.back, z: EYE_SHOT.back.z - 0.05, eye: EYE_SHOT.back.eye + 2, h: EYE_HEADING + 3, k: 0 },
  arrive(15, 0.8, 17.3, 56, 120, 0.6), // themes
  arrive(16, 0, 17.3, 56, 124, 0.6),
  arrive(16, 0.9, 17.3, 52, 110, 0.9), // a day
  arrive(17, 0, 17.3, 52, 118, 0.9),
  atMini(stepAt(17) + 1.2, 88), // the mask, at simple-map's own view
  atMini(stepAt(18), 89), // the miniature, the same view
  atMini(stepAt(19), 90), // the knot
  atMini(stepAt(20), 93, 0.03), // drifting a little till the fireworks
  // Back and up a little for the fireworks: laid back to 70° the sky they
  // burst in is above the top of the screen
  arrive(20, 1.2, 17.3, 60, 96, 0),
  { t: SECONDS, z: 17.25, p: 60, h: 100, k: 0 },
]

/** Where the middle of the screen is for a key, at its own pitch and heading. */
function centerOf(key: Key, p = key.p, h = key.h, k = key.k): [number, number] {
  if (key.mini) return mini.center
  if (key.eye !== undefined) {
    // Up the screen from the camera's foot by its height as the pitch lays it
    // down, for the camera itself to stand in the middle (EYE_LIFT is measured)
    const lifted = toward(camera.at, EYE_UP * Math.tan((p * Math.PI) / 180) * EYE_LIFT, -h)
    return toward(lifted, key.eye, EYE_FACING)
  }
  const ahead = (k * tall * Math.tan((p * Math.PI) / 180)) / 2
  // Up the screen is the bearing -heading (measured: at heading 90 a point to
  // the east is drawn below the middle), so the middle goes that way from the
  // tower's foot for the tower to stand up into the middle of the screen
  return toward(home, ahead, -h)
}

function cameraAt(t: number): { center: [number, number]; z: number; p: number; h: number } {
  let a = KEYS[0]!
  let b = KEYS[0]!
  for (let i = 1; i < KEYS.length; i++) {
    b = KEYS[i]!
    if (t < b.t) break
    a = b
  }
  const s = a === b ? 0 : span(t, a.t, b.t, inOut)
  const za = a.mini ? mini.zoom + a.z : a.z
  const zb = b.mini ? mini.zoom + b.z : b.z
  const z = mix(za, zb, s)
  const p = mix(a.p, b.p, s)
  const h = mixAngle(a.h, b.h, s)
  if (a.eye !== undefined || b.eye !== undefined) {
    // To, from or between views of the camera: each key's own middle at this
    // pitch and heading, and the way between them
    const [ca, cb] = [centerOf(a, p, h), centerOf(b, p, h)]
    return { center: [mix(ca[0], cb[0], s), mix(ca[1], cb[1], s)], z, p, h }
  }
  if (!a.mini && !b.mini) {
    const [ae, an] = a.nudge ?? [0, 0]
    const [be, bn] = b.nudge ?? [0, 0]
    const center = offset(centerOf(a, p, h, mix(a.k, b.k, s)), mix(ae, be, s), mix(an, bn, s))
    return { center, z, p, h }
  }
  // Into or at the miniature view: from where the one key stands to where the other does
  const [ca, cb] = [centerOf(a), centerOf(b)]
  return { center: [mix(ca[0], cb[0], s), mix(ca[1], cb[1], s)], z, p, h }
}

function look(view: { center: readonly [number, number]; z: number; p: number; h: number }): void {
  const camera = viewer.camera
  camera.center = view.center
  camera.zoom = view.z
  camera.pitch = view.p
  camera.heading = view.h
}

// ---- The first part: what one building takes --------------------------------

const helipadImage = helipad()
/**
 * The deck the helipad goes on: the tower's round roof (161 m) has a raised
 * oblong in its middle, 1.3 m up, about 19 m by 12 m, its long side running to
 * the north-north-east. A picture wider than the deck runs over its edge and is
 * broken by the step, so it is kept to the deck's width and turned along it.
 * Measured by casting down onto the roof on a half-metre grid (from the foot:
 * metres east, north, up).
 */
const DECK = { east: -4.2, north: 7.3, up: 162.3, along: 24, width: 11 }

const PASTEL: Theme = {
  backdrop: '#fffaf6',
  surface: '#fcf7f1',
  footprint: '#f3ebe2',
  road: '#ecdfd2',
  river: '#b4d8f0',
  green: '#d2eac5',
  leaf: '#b1d79f',
  wall: '#fbeee8',
  window: '#d9e7f5',
  mullion: '#f6e6e0',
  shadow: '#e6e0e6',
}
const MONO: Theme = {
  backdrop: '#e4e4e4',
  surface: '#bdbdbd',
  footprint: '#c9c9c9',
  road: '#8e8e8e',
  river: '#9c9c9c',
  green: '#acacac',
  leaf: '#d2d2d2',
  trunk: '#6e6e6e',
  treeLine: '#3a3a3a',
  rail: '#787878',
  ballast: '#a2a2a2',
  boundary: '#6e6e6e',
  coastline: '#6e6e6e',
  wall: '#ffffff',
  window: '#a0a0a0',
  mullion: '#d8d8d8',
  shadow: '#c4c4c4',
  edge: '#1a1a1a',
}
const NEON: Theme = {
  backdrop: '#0d0b1f',
  surface: '#2f2b45',
  footprint: '#3a3452',
  road: '#4f3470',
  river: '#22c3e0',
  green: '#2f4d4f',
  leaf: '#2f6b66',
  trunk: '#3d3650',
  treeLine: '#00f0ff',
  rail: '#7a3d8f',
  ballast: '#3a3350',
  coastline: '#00e5ff',
  boundary: '#ff3df2',
  wall: '#3e3858',
  window: '#24d6ff',
  mullion: '#2f2a47',
  edge: '#ff2bd6',
  shadow: '#a99bd9',
}
const DESERT: Theme = {
  backdrop: '#e0d7c9',
  surface: '#f4ecdf',
  footprint: '#ebe2d3',
  road: '#e1d7c6',
  river: '#cdc6b9',
  green: '#e5ddcc',
  leaf: '#b3ad9f',
  trunk: '#85817b',
  treeLine: '#6c6b69',
  rail: '#d3c9b8',
  ballast: '#e4dbcb',
  boundary: '#b3aa99',
  coastline: '#b3aa99',
  wall: '#a09d98',
  window: '#a09d98',
  mullion: '#a09d98',
  shadow: '#6c6b69',
  edge: '#4a4741',
}
/** The palettes run through in step 15, a beat each, and back to the map's own. */
const THEMES: readonly { readonly name: string; readonly theme: Theme }[] = [
  { name: 'pastel', theme: PASTEL },
  { name: 'mono', theme: MONO },
  { name: 'neon', theme: NEON },
  { name: 'desert', theme: DESERT },
]

interface Step {
  readonly say: string
  readonly code: string | ((t: number) => string)
}
const STEPS: readonly Step[] = [
  { say: '建物をひとつ選ぶ', code: `buildings.setStyle(id, { outline: true })` },
  { say: '色を塗る', code: `buildings.setStyle(id, { wallColor: '${WALL}' })` },
  { say: '階ごとに塗る', code: (t) => `floors: [{ at: ${floorAt(t)}, color: '${ACCENT}' }]` },
  { say: '窓を消す・付ける', code: (t) => `buildings.windows.visible = ${windowsOnAt(t)}` },
  {
    say: '窓の大きさを変える',
    code: (t) => {
      const s = windowsAt(t)
      return `windows.styles = { 業務施設: { width: ${s.width.toFixed(1)}, height: ${s.height.toFixed(1)} }, … }`
    },
  },
  { say: '窓の色を変える', code: (t) => `buildings.windows.color = '${glassAt(t) ?? '…'}'` },
  { say: '建物の輪郭に線を引く', code: `buildings.edges = true` },
  { say: '屋上に絵を貼る', code: `roofImage: { image: helipad, width: ${DECK.width} }` },
  { say: 'マーカーを付ける', code: `new Marker({ at: { building: id, offset: [0, 0, 163] } })` },
  { say: '動かす。マーカーもついてくる', code: `buildings.animate(id, [{ scale: [1, 1, 1.5] }], timing)` },
  { say: '別の場所へ移す', code: `buildings.place(id, { at, facing: 90 })` },
  { say: 'まわりの建物を隠す', code: () => `buildings.hide({ shape: 'circle', center, radius: ${CLEARING.radius} })` },
  { say: '東京タワーを取り寄せる', code: `buildings.bring({ id: tokyoTower, findAt, at: center })` },
  { say: 'カメラから見える範囲を塗る', code: `new Viewshed({ at: { solid: camera, offset }, facing })` },
  {
    say: '地図の色を変える',
    code: (t) => {
      const i = themeAt(t)
      return i === null ? `viewer.theme = { … }` : `viewer.theme = ${THEMES[i]!.name}`
    },
  },
  { say: '時刻を進めると、影が回り、夜が来る', code: `viewer.sun = { by: 'time', at: new Date(…) }` },
  {
    say: '必要なところだけ',
    code: `viewer.mask = { shapes: [{ shape: 'circle', center, radius: ${ISLAND} }], fade: ${ISLAND_FADE} }`,
  },
  { say: 'ミニチュアのように見る', code: `viewer.tiltShift.enabled = true` },
  { say: 'three.js の物体を、同じ光と影の中に', code: `viewer.scene.add(new Mesh(knot, new MeshStandardMaterial()))` },
  { say: 'three.js で作ったレイヤーも、そのまま', code: `viewer.add(new Fireworks(at))` },
]

/** Step 3: one band, put on the first storey and carried up to the top. */
const FLOORS_FROM = 0.5
const FLOORS_TO = 3.0
function floorAt(t: number): number {
  const k = span(t, stepAt(3) + FLOORS_FROM, stepAt(3) + FLOORS_TO, linear)
  return 1 + Math.min(storeys - 1, Math.floor(k * storeys))
}

/** Step 4: the windows taken off the whole city, and put back. */
function windowsOnAt(t: number): boolean {
  return !(t >= stepAt(4) + 0.6 && t < stepAt(4) + 1.8)
}

/**
 * Step 5: every window in the city made smaller, then larger, then as it was,
 * by the same factor on each usage's own size (the office's shown on screen).
 */
const WINDOWS_FROM = 0.5
const WINDOWS_TO = 3.1
const windowsAsIs = buildings.windows.styles
function windowSize(t: number): { width: number; height: number } {
  const k = span(t, stepAt(5) + WINDOWS_FROM, stepAt(5) + WINDOWS_TO, linear)
  // down to a slit, up past where it began, and home: one smooth swing
  const swing = Math.sin(k * Math.PI * 2) * (k < 0.5 ? 0.55 : 0.45)
  return { width: 1 - swing * 0.9, height: 1 - swing }
}
function windowsAt(t: number): { width: number; height: number } {
  const f = windowSize(t)
  const office = windowsAsIs['業務施設']
  return { width: office.width * f.width, height: office.height * f.height }
}

/** Step 6: the glass colours, a beat each, then the map's own again. */
const GLASS_COLORS = ['#7fb7e6', '#f5c26b', '#79d2c0', '#c9a3e6'] as const
const GLASS_BEAT = 0.7
function glassAt(t: number): string | null {
  const i = Math.floor((t - stepAt(6) - 0.3) / GLASS_BEAT)
  return i >= 0 && i < GLASS_COLORS.length ? GLASS_COLORS[i]! : null
}

/** Step 15: which palette is up, or null before the first and after the last. */
const THEME_BEAT = 0.65
function themeAt(t: number): number | null {
  const i = Math.floor((t - stepAt(15) - 0.3) / THEME_BEAT)
  return i >= 0 && i < THEMES.length ? i : null
}

const done = new Set<string>()
function once(name: string, t: number, at: number, act: () => void): void {
  if (t >= at && !done.has(name)) {
    done.add(name)
    act()
  }
}

let marker: Marker | null = null
/**
 * Steps 12 and 13: the low buildings just beside the tower taken out (in front
 * of it and to its right as the camera sees it), and what
 * is brought into it — Tokyo Tower, from 芝公園 (the id and the place to find
 * it measured for the tallest example).
 */
const CLEARING = {
  distance: Number(q.get('hd') ?? 80),
  bearing: Number(q.get('hb') ?? 45),
  radius: Number(q.get('hr') ?? 45),
}
const TOKYO_TOWER = { id: 'bldg_7aff4a51-be8b-405b-abe4-ac489697cbc8', findAt: [139.74547, 35.65858] as const }
/** Its own colour, near enough: white, it is lost among the white city. */
const TOKYO_RED = '#e2583a'
const clearing = (): { shape: 'circle'; center: [number, number]; radius: number } => ({
  shape: 'circle',
  center: toward(home, CLEARING.distance, CLEARING.bearing),
  radius: CLEARING.radius,
})
let brought: ReplicaBuilding | null = null
let sentBack = false

/** Where the tower goes in step 11, and how far round. */
const AWAY = { east: -110, north: 50, facing: 90 }

/**
 * Step 14's camera: the security-camera example's own housing and lens, hung on
 * the tower's wall, and what it sees from just past the lens. Made before the
 * shot starts (and kept out of sight till then), so nothing is put together
 * in the middle of it. Where on the wall is found once the tower is there.
 */
const camera = {
  at: toward(home, 20, EYE_FACING),
  housing: new Solid({
    geometry: housingShape().scale(CAMERA_SIZE, CAMERA_SIZE, CAMERA_SIZE),
    at: { lng: home[0], lat: home[1], height: EYE_UP },
    facing: EYE_FACING,
    fillColor: BODY,
    pickable: false,
    visible: false,
  }),
  lens: null as Solid | null,
  sight: null as Viewshed | null,
}
camera.lens = new Solid({
  geometry: lensShape().scale(CAMERA_SIZE, CAMERA_SIZE, CAMERA_SIZE),
  at: { solid: camera.housing, offset: [0, FRONT * CAMERA_SIZE, 0] },
  facing: EYE_FACING,
  fillColor: GLASS,
  pickable: false,
  visible: false,
})
camera.sight = new Viewshed({
  at: { solid: camera.housing, offset: [0, FRONT * CAMERA_SIZE + PAST_THE_LENS, 0] },
  facing: EYE_FACING,
  // Tall enough that what it sees starts on the ground just under the lens: a
  // sight looks level, so it is the height of the view that brings it down there
  fov: { horizontal: EYE_FOV, vertical: 150 },
  range: EYE_RANGE,
  color: '#ff7a3d',
  opacity: 0,
  visible: false,
})
viewer.add(camera.sight)
viewer.add(camera.housing)
viewer.add(camera.lens)
Object.assign(window, { camera })

/** Step 19's knot: a three.js object of the page's own, beside the tower. */
const stretch = 1 / Math.cos((home[1] * Math.PI) / 180)
const knot = new Mesh(
  new TorusKnotGeometry(24 * stretch, 7 * stretch, 260, 36),
  new MeshStandardMaterial({ color: ACCENT, roughness: 0.35, metalness: 0.15 }),
)
knot.castShadow = true
knot.receiveShadow = true

/** Step 20: the fireworks example's own layer, set off over the station instead of the harbour. */
let fireworks: Fireworks | null = null

interface Look {
  readonly outline?: boolean
  readonly wall?: boolean
  readonly floor?: number
  readonly roof?: boolean
}
let lookNow = ''
function dress(look: Look): void {
  const key = JSON.stringify(look)
  if (key === lookNow) return
  lookNow = key
  buildings.setStyle(TOWER, {
    ...(look.outline ? { outline: true, outlineWidth: 3 } : {}),
    ...(look.wall ? { wallColor: WALL } : {}),
    ...(look.floor ? { floors: [{ at: look.floor, color: ACCENT }] } : {}),
    ...(look.roof
      ? {
          roofImage: {
            image: helipadImage,
            width: DECK.width,
            rotate: DECK.along,
            offset: [DECK.east, DECK.north, DECK.up] as [number, number, number],
            // The deck's top only: not the roof round it, 1.3 m down, nor its rim
            depth: 0.8,
          },
        }
      : {}),
  })
}

function firstPart(t: number): void {
  if (t > OPENING - 0.5) buildings.minZoom = false

  // What the tower wears, step by step
  if (t >= stepAt(1) + 0.4) {
    const s3 = stepAt(3)
    dress({
      outline: true,
      wall: t >= stepAt(2) + 0.4,
      floor: t >= s3 + FLOORS_FROM && t < s3 + FLOORS_TO + 0.4 ? floorAt(t) : undefined,
      roof: t >= stepAt(8) + 0.6,
    })
  }

  // 4: the windows off, and on again (the walls they were cut in are kept,
  // so on again is only drawing them)
  const on = windowsOnAt(t)
  if (on !== buildings.windows.visible) buildings.windows.visible = on

  // 5: the windows' size
  const s5 = stepAt(5)
  if (t >= s5 + WINDOWS_FROM && t <= s5 + WINDOWS_TO + 0.2) {
    const f = windowSize(t)
    const key = `${f.width.toFixed(3)} ${f.height.toFixed(3)}`
    if (key !== windowsShown) {
      windowsShown = key
      const styles: Record<string, object> = {}
      for (const [usage, style] of Object.entries(windowsAsIs)) {
        styles[usage] = { ...style, width: style.width * f.width, height: style.height * f.height }
      }
      buildings.windows.styles = styles as typeof windowsAsIs
    }
  }
  once('windows as they were', t, s5 + WINDOWS_TO + 0.2, () => {
    buildings.windows.styles = windowsAsIs
  })

  // 6: the glass, a beat each colour, then the map's own
  if (t >= stepAt(6) && t < stepAt(7)) {
    const glass = glassAt(t)
    if (glass !== glassShown) {
      glassShown = glass
      buildings.windows.color = glass ?? undefined
    }
  }

  // 7: the fold lines of the whole city, while the step is up (set only as it
  // changes: turning them on stands them again)
  const edges = t >= stepAt(7) + 0.4 && t < stepAt(8) + 0.3
  if (edges !== buildings.edges) buildings.edges = edges

  once('5', t, stepAt(9) + 0.5, () => {
    marker = new Marker({
      at: { building: TOWER, offset: [0, 0, tall] },
      symbol: 'pin',
      label: '中目黒のタワー',
      color: ACCENT,
    })
    viewer.add(marker)
  })
  once('6', t, stepAt(10) + 0.4, () => {
    buildings.animate(TOWER, [{ scale: [1, 1, 1] }, { scale: [1, 1, 1.5] }], {
      duration: 850,
      direction: 'alternate',
      iterations: 2,
      easing: 'ease-in-out',
    })
  })

  // 11: out and round, a moment there, and home again
  const s7 = stepAt(11)
  if (t >= s7 + 0.3 && t <= s7 + 3.2) {
    const outward = span(t, s7 + 0.3, s7 + 1.4, inOut)
    const back = span(t, s7 + 1.9, s7 + 3.0, inOut)
    const k = outward - back
    buildings.place(TOWER, { at: offset(home, AWAY.east * k, AWAY.north * k), facing: AWAY.facing * k })
  }
  once('home', t, s7 + 3.2, () => buildings.place(TOWER, { at: home, facing: 0 }))

  // 12: the buildings beside the tower go under
  once('hide', t, stepAt(12) + 0.4, () => buildings.hide(clearing()))

  // 13: Tokyo Tower comes up in the clearing, stands a moment, and goes, and
  // the buildings come back
  const s13 = stepAt(13)
  once('bring', t, s13 + 0.3, () => {
    void buildings.bring({ ...TOKYO_TOWER, at: clearing().center, style: { wallColor: TOKYO_RED } }).then((tower) => {
      if (sentBack) tower?.remove()
      else brought = tower
    })
  })
  once('send back', t, s13 + BRING_STEP - 1.3, () => {
    sentBack = true
    brought?.remove()
    brought = null
    buildings.show()
  })

  // 14: the camera on the wall, gone in close to, and then what it sees
  const s8 = stepAt(14)
  const hung = t >= s8 + 0.5 && t < stepAt(15) + 0.6
  camera.housing.visible = hung
  camera.lens!.visible = hung
  camera.sight!.visible = hung
  camera.sight!.opacity = 0.6 * span(t, s8 + 1.6, s8 + 2.3, linear) * (1 - span(t, stepAt(15) + 0.1, stepAt(15) + 0.6, linear))

  // 15: the palettes, a beat each, then the map's own again
  if (t >= stepAt(15) && t < stepAt(16)) {
    const i = themeAt(t)
    const want = i === null ? -1 : i
    if (want !== themeShown) {
      themeShown = want
      viewer.theme = want < 0 ? {} : THEMES[want]!.theme
    }
  }
  once('own palette', t, stepAt(16), () => {
    themeShown = -1
    viewer.theme = {}
  })

  // 16: a day, from seven in the morning round to seven the next
  const s10 = stepAt(16)
  if (t >= s10 + 0.3 && t < stepAt(17)) {
    const day = span(t, s10 + 0.3, s10 + 3.3, linear)
    viewer.sun = { by: 'time', at: new Date(MORNING + day * 24 * 3600_000) }
  }
  once('morning', t, stepAt(17), () => {
    viewer.sun = { by: 'time', at: new Date(MORNING + 26 * 3600_000) }
  })

  // 17: the city cut down to a round of it, closing in from past the screen's
  // edges as the camera comes round to the miniature view; let go again as the
  // knot comes in
  const s11 = stepAt(17)
  if (t >= s11 + 0.4 && t < stepAt(19) + 0.6) {
    const closing = span(t, s11 + 0.4, s11 + 2.0, inOut)
    const opening = span(t, stepAt(19) + 0.1, stepAt(19) + 0.6, inOut)
    const radius = Math.round(mix(ISLAND_FROM, ISLAND, closing - opening))
    if (radius !== islandShown) {
      islandShown = radius
      viewer.mask = {
        shapes: [{ shape: 'circle', center: islandCenter(), radius }],
        fade: ISLAND_FADE,
        fetch: 'onScreen',
      }
    }
  }
  once('whole city', t, stepAt(19) + 0.6, () => {
    islandShown = -1
    viewer.mask = { shapes: [{ shape: 'view' }] }
  })

  // 18: the miniature look, as simple-map has it, on the round of city
  once('12', t, stepAt(18) + 0.2, () => {
    viewer.tiltShift.focus = undefined
    viewer.tiltShift.enabled = true
  })

  // 19: the knot comes in beside the tower and turns, in a clear picture again
  once('13', t, stepAt(19) + 0.1, () => {
    viewer.tiltShift.enabled = false
    // Off to the left of the tower as the miniature view sees it (up the screen is west)
    const where = toward(home, 85, 182)
    const base = viewer.worldFromLngLat(where[0], where[1])
    knot.position.set(base.x, 110 * stretch, base.z)
    viewer.scene.add(knot)
  })
  if (knot.parent) {
    const grow = span(t, stepAt(19) + 0.1, stepAt(19) + 0.7, out)
    const gone = span(t, stepAt(20) + 0.1, stepAt(20) + 0.5, inOut)
    knot.scale.setScalar(Math.max(0.001, grow * (1 - gone)))
    knot.rotation.set(t * 0.5, t * 0.8, 0)
  }

  // 20: the evening falls and the fireworks go up over the station
  const s14 = stepAt(20)
  if (t >= s14 && t <= s14 + 0.9) {
    const dusk = span(t, s14, s14 + 0.9, inOut)
    viewer.sun = { by: 'time', at: new Date(EVENING + dusk * 2.2 * 3600_000) }
  }
  once('night', t, s14 + 0.9, () => {
    viewer.sun = { by: 'time', at: new Date(EVENING + 2.2 * 3600_000) }
  })
  once('14', t, s14 + 0.6, () => {
    viewer.scene.remove(knot)
    // Behind the tower as the camera sees it (up the screen is the bearing -heading)
    fireworks = new Fireworks(toward(home, 150, -96))
    viewer.add(fireworks)
  })
}
let themeShown = -1
let islandShown = -1
let windowsShown = ''
let glassShown: string | null = null

/**
 * The round of city kept in step 17: between the miniature view's middle and
 * the tower, so the tower stands well inside it and the near streets are kept.
 */
function islandCenter(): [number, number] {
  return [mix(mini.center[0], home[0], 0.75), mix(mini.center[1], home[1], 0.75)]
}

const MORNING = Date.parse('2026-05-20T07:00:00+09:00')
/** Where the dusk of step 20 starts from: the afternoon before the fireworks. */
const EVENING = Date.parse('2026-05-21T17:30:00+09:00')

/**
 * The point on the tower's wall the camera hangs on: found by casting in at
 * its height from out the way it looks, towards the tower's foot.
 */
function findWall(): void {
  const from = toward(home, 80, EYE_FACING)
  const start = viewer.worldFromLngLat(from[0], from[1])
  const end = viewer.worldFromLngLat(home[0], home[1])
  start.y = end.y = EYE_UP * stretch
  const ray = new Raycaster(start, end.clone().sub(start).normalize())
  const hit = ray.intersectObject(buildings.root, true)[0]
  if (!hit) return
  camera.at = viewer.lngLatFromWorld(hit.point.x, hit.point.z)
  camera.housing.at = { lng: camera.at[0], lat: camera.at[1], height: EYE_UP }
}

// ---- Words on screen -------------------------------------------------------------

const title = document.getElementById('title')!
const stepCard = document.getElementById('step')!
const stepSay = stepCard.querySelector('.say')!
const stepCode = stepCard.querySelector('code')!
note()
const label = part('01', '建物を、思いのままに。')

function words(t: number): void {
  title.style.opacity = String(shown(t, 0.9, 6.4, 0.6))
  label(t, PART_FROM)
  let card = 0
  let which = -1
  for (let n = 1; n <= STEP_COUNT; n++) {
    const from = stepAt(n) + 0.2
    const to = n === STEP_COUNT ? SECONDS - 0.3 : stepAt(n + 1) - 0.05
    const o = shown(t, from, to, 0.2)
    if (o > 0) {
      card = o
      which = n - 1
    }
  }
  stepCard.style.opacity = String(card)
  if (which >= 0) {
    const step = STEPS[which]!
    const code = typeof step.code === 'string' ? step.code : step.code(t)
    if (stepSay.textContent !== step.say) stepSay.textContent = step.say
    if (stepCode.textContent !== code) stepCode.textContent = code
  }
}

// ---- Getting ready ---------------------------------------------------------------

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Until the city has stopped fetching and rising for a while. */
async function settle(quiet = 1500, most = 30_000): Promise<void> {
  const started = performance.now()
  let still = performance.now()
  while (performance.now() - started < most) {
    await pause(100)
    if (buildings.busy()) still = performance.now()
    else if (performance.now() - still > quiet) return
  }
}

async function prepare(): Promise<void> {
  await settle()
  const tower = buildings.said(TOWER)
  if (tower) {
    home = [tower.position.lng, tower.position.lat]
    tall = tower.tall
    if (tower.storeys > 0) storeys = tower.storeys
  }

  findWall()

  // The miniature view: simple-map's own, fitted to this screen as it fits its own
  viewer.camera.pitch = 70
  viewer.camera.heading = 88
  viewer.camera.fitBounds(MINI_BOUNDS)
  for (let i = 0; i < 3; i++) await frame()
  // Moved a little up the screen (west, at this heading), so the label over the
  // tower's top clears the part's name at the top of the frame
  const fitted = viewer.camera.view.center
  mini = { center: offset([fitted[0], fitted[1]], -MINI_DOWN, 0), zoom: viewer.camera.view.zoom }
  await settle()

  // The views of the first part, and the tower's other place
  for (const at of [stepAt(8) + 2, stepAt(13) + 2, stepAt(11) + 2, stepAt(14) + 2, stepAt(14) + 5, stepAt(15) + 2]) {
    look(cameraAt(at))
    await settle()
  }
  // Tokyo Tower fetched once beforehand, so that bringing it in the shot is
  // only standing it up
  const warm = await buildings.bring({ ...TOKYO_TOWER, at: clearing().center })
  warm?.remove()
  await settle()
  buildings.place(TOWER, { at: home, facing: 0 })
  await settle()

  // And up high, where the city is not yet
  look(cameraAt(0))
  await pause(2500)
  await settle()
}

shot(SECONDS, prepare(), (t) => {
  look(cameraAt(t))
  firstPart(t)
  words(t)
})
