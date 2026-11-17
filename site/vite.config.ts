import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { DOC_PAGES } from './src/docs/pages'
import { EXAMPLES } from './src/examples/registry'

const examples = new URL('src/examples/', import.meta.url)

/**
 * A page for the site, and one for each example.
 *
 * An example is a document of its own — the site shows it in a frame — so it
 * is built as one rather than bundled into the site. That is what lets the
 * files in its folder be exactly what someone using the library would write:
 * markup with a `#map` in it, a stylesheet, and the script that runs when it
 * loads.
 *
 * Found by looking rather than listed, so a new example is a new folder.
 */
const pages = Object.fromEntries(
  readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, fileURLToPath(new URL(`${entry.name}/index.html`, examples))]),
)

/**
 * The built page again at every address the router draws, and once more as `404.html`.
 *
 * GitHub Pages serves files and knows nothing of the router: asked for
 * `/docs/getting-started` it looks for a file there, finds none and answers
 * 404. Its `404.html` would still bring the page up and draw the right thing,
 * but under a 404, which a search engine reads as a page that is not there.
 * So each address the site has gets the page standing at it, and only one it
 * does not have falls through to `404.html`, where the router draws its own
 * "not found" under a 404 that is true. The lists are the ones the router
 * reads, so a new page or example is covered without being named here.
 */
function everyAddress(): Plugin {
  let out = ''
  return {
    name: 'every-address',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const page = readFileSync(join(out, 'index.html'), 'utf8')
      const addresses = [
        'docs',
        ...DOC_PAGES.map((doc) => `docs/${doc.slug}`),
        'examples',
        ...EXAMPLES.map((example) => `examples/${example.id}`),
      ]
      for (const address of addresses) {
        mkdirSync(join(out, address), { recursive: true })
        writeFileSync(join(out, address, 'index.html'), page)
      }
      writeFileSync(join(out, '404.html'), page)
    },
  }
}

export default defineConfig({
  // `/` here and for `pnpm share`; the folder a host puts the site under when
  // it is not at the top, as GitHub Pages does (`/plateau-ui/`), set by the
  // workflow that builds it there
  base: process.env['SITE_BASE'] ?? '/',
  plugins: [react(), everyAddress()],
  resolve: {
    alias: {
      '@plateau-ui/core': new URL('../packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  // The port the host asks for where it asks — several sessions may be
  // looking at this repository at once — and 5181 where nothing does.
  server: { port: Number(process.env['PORT']) || 5181 },
  // The built site, served for a temporary address `tools/share.mjs` opens.
  // Vite answers only the hosts it is told of, and the address is a fresh
  // name under this one each time
  preview: { port: 4173, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
  build: {
    rollupOptions: {
      input: { index: fileURLToPath(new URL('index.html', import.meta.url)), ...pages },
    },
  },
})
