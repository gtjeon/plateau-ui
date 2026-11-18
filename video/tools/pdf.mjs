/**
 * Prints the slides to one PDF, a 1280x720 page a slide.
 *
 *   node video/tools/pdf.mjs <url of the slides> <out.pdf>
 *
 * The slides are served by the video server (5190), so their pictures load
 * from the same origin.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9337
const [url, out] = process.argv.slice(2)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const profile = await mkdtemp(join(tmpdir(), 'plateau-pdf-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' },
)
try {
  let target
  for (let tries = 0; tries < 80 && !target; tries++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      target = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {}
    if (!target) await sleep(250)
  }
  const socket = new WebSocket(target)
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
  let nextId = 1
  const answers = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const answer = answers.get(message.id)
    if (!answer) return
    answers.delete(message.id)
    if (message.error) answer.reject(new Error(message.error.message))
    else answer.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      answers.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  await send('Page.navigate', { url })
  // Every picture in, and the fonts settled, before printing
  await sleep(1500)
  await send('Runtime.evaluate', {
    expression: `Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r }))])`,
    awaitPromise: true,
  })
  const { data } = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  await writeFile(out, Buffer.from(data, 'base64'))
  console.log('wrote', out)
  socket.close()
} finally {
  chrome.kill()
}
