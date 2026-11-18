/**
 * Turns an audio file macOS cannot read (Opus in M4A, as Suno hands it out)
 * into a plain 16-bit WAV, by letting Chrome decode it.
 *
 *   node video/tools/decode.mjs <served path> <out.wav>
 *
 * The path is one the video server serves (e.g. /video/music/song.m4a); the
 * server must be running on 5190.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9336
const [served, out] = process.argv.slice(2)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const profile = await mkdtemp(join(tmpdir(), 'plateau-decode-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', '--mute-audio', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
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
  const run = async (text) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: text, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  // Any page of the server, for the file to be fetched from the same origin
  await send('Page.navigate', { url: 'http://localhost:5190/video/shots/outro/qr.png' })
  await sleep(1000)
  const info = await run(`(async () => {
    const bytes = await (await fetch(${JSON.stringify(served)})).arrayBuffer()
    const audio = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes)
    const left = audio.getChannelData(0)
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left
    const pcm = new Int16Array(audio.length * 2)
    for (let i = 0; i < audio.length; i++) {
      pcm[2 * i] = Math.max(-1, Math.min(1, left[i])) * 32767
      pcm[2 * i + 1] = Math.max(-1, Math.min(1, right[i])) * 32767
    }
    window.__pcm = new Uint8Array(pcm.buffer)
    return { frames: audio.length, rate: audio.sampleRate, bytes: window.__pcm.length }
  })()`)
  console.log('decoded', info)

  // Fetched back a piece at a time: one evaluation carries only so much
  const CHUNK = 3 * 1024 * 1024
  const parts = []
  for (let at = 0; at < info.bytes; at += CHUNK) {
    const b64 = await run(`(() => {
      const piece = window.__pcm.subarray(${at}, ${at + CHUNK})
      let s = ''
      for (let i = 0; i < piece.length; i += 0x8000) s += String.fromCharCode.apply(null, piece.subarray(i, i + 0x8000))
      return btoa(s)
    })()`)
    parts.push(Buffer.from(b64, 'base64'))
  }
  const data = Buffer.concat(parts)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(info.rate, 24)
  header.writeUInt32LE(info.rate * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  await writeFile(out, Buffer.concat([header, data]))
  console.log('wrote', out, (info.frames / info.rate).toFixed(2), 's')
  socket.close()
} finally {
  chrome.kill()
}
