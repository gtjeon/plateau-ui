/**
 * Opens a page in headless Chrome, waits, runs a line and prints what it
 * returns — and a screenshot if asked. For framing shots and looking things
 * up (which building, how tall) without a visible browser.
 *
 *   node video/tools/probe.mjs <url> '<expression>' [--wait ms] [--shot out.jpg]
 *
 * The expression may `await`. It runs after `window.__shot.ready` where the
 * page has one, else after `--wait` (default 8000 ms).
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9335
const [url, expression = 'null', ...rest] = process.argv.slice(2)
const option = (name) => {
  const at = rest.indexOf(`--${name}`)
  return at === -1 ? undefined : rest[at + 1]
}
const wait = Number(option('wait') ?? 8000)
const shotTo = option('shot')
/** For a shot page: the moment to look at, in its own seconds. Several, comma-separated; `--shot` then names files with %t for the time. */
const times = option('at')?.split(',').map(Number)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const clock = await readFile(new URL('clock.js', import.meta.url), 'utf8')

const profile = await mkdtemp(join(tmpdir(), 'plateau-probe-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--window-size=1280,720',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)
let socket
try {
  let target
  for (let tries = 0; tries < 80 && !target; tries++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      target = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {}
    if (!target) await sleep(250)
  }
  socket = new WebSocket(target)
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
  let nextId = 1
  const answers = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const answer = answers.get(message.id)
    if (answer) {
      answers.delete(message.id)
      if (message.error) answer.reject(new Error(message.error.message))
      else answer.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      console.error('page threw:', message.params.exceptionDetails?.exception?.description)
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      console.error('page error:', message.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      answers.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const run = async (text) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: text,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: clock })
  await send('Page.navigate', { url })
  await sleep(500)
  if (await run(`typeof window.__shot === 'object' && window.__shot !== null`)) await run(`window.__shot.ready`)
  else await sleep(wait)
  const shoot = async (to) => {
    await sleep(300)
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 })
    await writeFile(to, Buffer.from(data, 'base64'))
  }
  if (times) {
    // Each moment played up to from a second before, in order
    await run(`window.__clock.freeze()`)
    for (const time of times) {
      const from = Math.max(0, time - 1)
      await run(`window.__shot.begin(${from})`)
      for (let i = 0; i < Math.round((time - from) * 30); i++) await run(`window.__clock.step(${1000 / 30})`)
      if (shotTo) await shoot(shotTo.replace('%t', String(time)))
      console.log(`t=${time}`, JSON.stringify(await run(`(async () => { return ${expression} })()`)))
    }
  } else {
    const value = await run(`(async () => { return ${expression} })()`)
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
    if (shotTo) await shoot(shotTo)
  }
} finally {
  socket?.close()
  chrome.kill()
  if (chrome.exitCode === null && chrome.signalCode === null) await new Promise((r) => chrome.once('exit', r))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
