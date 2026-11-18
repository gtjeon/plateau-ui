/**
 * One page of the second part: a page of a real kind with one of the site's
 * own examples running inside it, unchanged, in a frame.
 *
 * The example is the real page from `site/src/examples`, served from this same
 * origin, so this page can reach into it: put its panel away where the page
 * around it does that job, and move what the example lets a reader move (the
 * time of day, in the listing). The recorder's clock turns the frame's clock
 * with this one's.
 */
import { shot, shown, span, linear } from '../../shared/shot.js'
import { note, part, PART_IN, quiet } from '../../shared/overlay.js'

interface Page {
  /** The example, or a shot of this video's own. */
  readonly src: string
  /** Whether the example's own panel goes: the page around it is the panel now. */
  readonly bare: boolean
  /** What it stands on, said in code under the page. */
  readonly api: string
  /** Moved every frame, with the frame's document and the shot's time. */
  readonly drive?: (doc: Document, t: number) => void
}

/** How long each page is on. */
const SHOWN = 7

const name = new URLSearchParams(location.search).get('page') ?? 'estate'
/**
 * The first page of the part waits for the part's name to come in and settle
 * before it shows; the pages after it find the name already there.
 */
const START = name === 'estate' ? 0.25 + PART_IN : 0
const SECONDS = START + SHOWN

const PAGES: Record<string, Page> = {
  estate: {
    src: '/site/src/examples/daylight/index.html',
    bare: true,
    api: `viewer.sun = { by: 'time', at }`,
    // The day going by, six in the morning to seven in the evening, through
    // the example's own slider as a reader would move it
    drive: (doc, t) => {
      const slider = doc.getElementById('time') as HTMLInputElement | null
      if (!slider) return
      const minutes = Math.round(360 + span(t, START + 0.3, SECONDS - 0.2, linear) * (1140 - 360))
      if (slider.value !== String(minutes)) {
        slider.value = String(minutes)
        slider.dispatchEvent(new Event('input'))
      }
    },
  },
  stay: { src: '/site/src/examples/airstay/index.html', bare: true, api: `viewer.models.bring({ url, at })` },
  outlets: { src: '/site/src/examples/outlets/index.html', bare: true, api: `buildings.setStyle(zone, { wallColor })` },
  office: { src: '/site/src/examples/workspace/index.html', bare: true, api: `mask: { shapes: [circle, circle, …] }` },
  cityhall: { src: '/site/src/examples/guide-map/index.html', bare: true, api: `new Polyline({ points })` },
  hazard: {
    src: '/site/src/examples/flood-hours/index.html',
    bare: false,
    api: `new ImageExtrusionTileLayer({ url, legend })`,
  },
  quake: { src: '/video/shots/quake/index.html', bare: false, api: `buildings.animateAll(keyframes, { from })` },
}

const page = PAGES[name]!
const template = document.getElementById(name) as HTMLTemplateElement
// The page shown as a page, a little smaller than the frame, so the part's name
// above it and the note below it cover none of it
const sheet = document.getElementById('page')!
sheet.append(template.content.cloneNode(true))

note()
const label = part('02', 'あなたのページで')
/** The first page brings the name in; on the pages after it, it came in long before they start. */
const labelFrom = name === 'estate' ? 0.25 : -PART_IN - 1

const frame = document.createElement('iframe')
frame.src = page.src
document.querySelector('.frame')!.append(frame)

const api = document.getElementById('api')!
api.textContent = page.api

/** Everything in the example but its map (and the map's line of sources, which is in it). */
function bare(doc: Document): void {
  for (const node of [...doc.body.children]) {
    if (node.id !== 'map' && node.tagName !== 'SCRIPT') (node as HTMLElement).style.display = 'none'
  }
}

const ready = new Promise<void>((done) => {
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument!
    quiet(doc)
    if (page.bare) bare(doc)
    // The example fetches its city as it goes; give it time to land and rise
    setTimeout(done, 12_000)
  })
})

shot(SECONDS, ready, (t) => {
  const doc = frame.contentDocument
  if (doc && page.drive) page.drive(doc, t)
  api.style.opacity = String(shown(t, START + 0.5, SECONDS - 0.1, 0.3))
  label(t, labelFrom)
  if (START > 0) {
    const k = span(t, START - 0.15, START + 0.35)
    sheet.style.opacity = String(k)
    sheet.style.translate = `0 ${(18 * (1 - k)).toFixed(2)}px`
  }
})
