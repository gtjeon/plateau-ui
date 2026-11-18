/**
 * Records one shot of the award video, frame by frame.
 *
 *   video server running (port 5190), then:
 *   node video/tools/record.mjs <url> <out-dir> [--seconds N] [--fps 30] [--inject file.js]
 *
 * A page made for this (under `shots/`) says when it is ready and how long it
 * runs by setting `window.__shot = { ready, seconds, begin }`. Any other page
 * — a site example — is waited on until it stops fetching, then given
 * `--inject` (a caption, say) and `--seconds`.
 *
 * Each frame is one step of the page's clock (`clock.js`) and one screenshot,
 * so how long a frame takes to draw or capture has nothing to do with how it
 * moves in the video. The frames go to `<out-dir>/00000.jpg …`, which
 * `encode.swift` turns into a movie.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


/** A page laid out at 1280 across, drawn at 1.5 times: a 1080p frame of a desk-sized page. */
const WIDTH = 1280
const HEIGHT = 720
const SCALE = 1.5

const [url, out, ...rest] = process.argv.slice(2)
if (!url || !out) throw new Error('usage: record.mjs <url> <out-dir> [--seconds N] [--fps 30] [--inject file.js]')
const option = (name) => {
  const at = rest.indexOf(`--${name}`)
  return at === -1 ? undefined : rest[at + 1]
}
const fps = Number(option('fps') ?? 30)
const askedSeconds = option('seconds') === undefined ? undefined : Number(option('seconds'))
const inject = option('inject')
const from = Number(option('from') ?? 0)
/** Handed to the injected script as `window.__arg`, as JSON. */
const arg = option('arg')
/** A slow turn of the view while it records: `x,y,dx,dy` — where the right button goes down, and how far it moves each frame. */
const orbit = option('orbit')?.split(',').map(Number)
/** A line run on the page before the clock stops: a press of its own button, say. */
const before = option('before')
const DEBUG_PORT = Number(option('port') ?? 9334)

const clock = await readFile(new URL('clock.js', import.meta.url), 'utf8')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const profile = await mkdtemp(join(tmpdir(), 'plateau-video-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

async function attach() {
  for (let tries = 0; tries < 80; tries++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      const page = targets.find((target) => target.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Not up yet
    }
    await sleep(250)
  }
  throw new Error(`Chrome never answered on ${DEBUG_PORT}`)
}

let socket
try {
  socket = new WebSocket(await attach())
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

  let nextId = 1
  const answers = new Map()
  let inflight = 0
  let stirred = Date.now()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const answer = answers.get(message.id)
    if (answer) {
      answers.delete(message.id)
      if (message.error) answer.reject(new Error(`${answer.method}: ${message.error.message}`))
      else answer.resolve(message.result)
      return
    }
    switch (message.method) {
      case 'Network.requestWillBeSent':
        inflight++
        stirred = Date.now()
        break
      case 'Network.loadingFinished':
      case 'Network.loadingFailed':
        inflight--
        stirred = Date.now()
        break
      case 'Runtime.exceptionThrown':
        console.log('page threw:', message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text)
        break
      case 'Runtime.consoleAPICalled':
        if (message.params.type === 'error' || message.params.type === 'warning' || message.params.type === 'log')
          console.log(`page ${message.params.type}:`, message.params.args.map((a) => a.value ?? a.description).join(' '))
        break
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      answers.set(id, { resolve, reject, method })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const run = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  await send('Page.enable')
  await send('Network.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: clock })

  const started = Date.now()
  const arrival = await send('Page.navigate', { url })
  if (arrival.errorText) throw new Error(arrival.errorText)

  // Made for this, or not
  await sleep(500)
  const own = await run(`typeof window.__shot === 'object' && window.__shot !== null`)
  let seconds = askedSeconds
  if (own) {
    await run(`Promise.resolve(window.__shot.ready)`)
    seconds ??= await run(`window.__shot.seconds`)
  } else {
    // Quiet for two seconds, then two and a half more for the last to rise
    while (Date.now() - started < 40_000) {
      await sleep(250)
      if (inflight <= 0 && Date.now() - stirred > 2000) break
    }
    await sleep(2500)
  }
  if (before) {
    await run(before)
    await sleep(Number(option('settle') ?? 3000))
  }
  if (arg) await run(`window.__arg = ${arg}`)
  if (inject) await run(await readFile(inject, 'utf8'))
  if (!seconds) throw new Error('How long? Give --seconds, or set __shot.seconds')
  console.log(`ready after ${((Date.now() - started) / 1000).toFixed(1)}s, recording ${seconds}s at ${fps} fps`)

  await run(`window.__clock.freeze()`)
  if (own) {
    await run(`window.__shot.begin?.(${from})`)
    // One frame not kept, so the first one kept already has the shot's own view
    await run(`window.__clock.step(0)`)
  }

  await mkdir(out, { recursive: true })
  const frames = Math.round(seconds * fps)
  const begun = Date.now()
  const hand = orbit ? { x: orbit[0], y: orbit[1] } : null
  if (hand) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hand.x, y: hand.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hand.x, y: hand.y, button: 'right', buttons: 2, clickCount: 1 })
  }
  for (let frame = 0; frame < frames; frame++) {
    if (hand && frame > 0) {
      hand.x += orbit[2] ?? 0
      hand.y += orbit[3] ?? 0
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hand.x, y: hand.y, button: 'right', buttons: 2 })
    }
    // A frame that never shows is a stuck GPU or a page gone; say so rather than wait forever
    await Promise.race([
      run(`window.__clock.step(${frame === 0 ? 0 : 1000 / fps})`),
      new Promise((_, fail) => {
        // Unref'd, so the run is not held open a minute after its last frame
        setTimeout(() => fail(new Error(`frame ${frame} did not show within a minute`)), 60_000).unref()
      }),
    ])
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    await writeFile(join(out, `${String(frame).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'))
    if (frame % fps === 0) {
      const each = (Date.now() - begun) / (frame + 1)
      process.stdout.write(`\r${frame}/${frames}  ${each.toFixed(0)} ms a frame  `)
    }
  }
  if (hand) await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hand.x, y: hand.y, button: 'right', buttons: 0, clickCount: 1 })
  console.log(`\n${frames} frames in ${((Date.now() - begun) / 1000).toFixed(1)}s → ${out}`)
} finally {
  socket?.close()
  chrome.kill()
  if (chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((resolve) => chrome.once('exit', resolve))
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
