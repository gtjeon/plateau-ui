/**
 * Shows the built site to a few people for as long as this runs.
 *
 * Builds the site, serves the build on this machine, and opens a temporary
 * address to it through Cloudflare's quick tunnel (`cloudflared`, no account):
 * a fresh `https://….trycloudflare.com` each run, printed below, which stops
 * answering the moment this is stopped. The built site and not the dev
 * server, which would hand out the library's source as it stands.
 *
 * Not a publication: nothing is uploaded and nothing stays. Anyone given the
 * address can open it while it runs, so it goes to the people it is meant
 * for.
 *
 *   pnpm share         (from the repository root, or `pnpm share` in site/)
 *   Ctrl+C             to close it
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('..', import.meta.url))

if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('cloudflared is not installed: brew install cloudflared')
  process.exit(1)
}

console.log('Building the site…')
const built = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: site, stdio: 'inherit' })
if (built.status !== 0) process.exit(built.status ?? 1)

const preview = spawn('pnpm', ['exec', 'vite', 'preview'], {
  cwd: site,
  stdio: ['ignore', 'pipe', 'inherit'],
})
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://localhost:4173'], {
  stdio: ['ignore', 'ignore', 'pipe'],
})

let shown = false
tunnel.stderr.on('data', (chunk) => {
  const found = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (found && !shown) {
    shown = true
    console.log(`\n  Share this address:  ${found[0]}\n  It works until you press Ctrl+C.\n`)
  }
})

function close() {
  tunnel.kill()
  preview.kill()
  process.exit(0)
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
tunnel.on('exit', (code) => {
  if (!shown) console.error(`cloudflared stopped before giving an address (${code})`)
  preview.kill()
  process.exit(code ?? 0)
})
