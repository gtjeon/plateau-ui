import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The award video's shots, served the way the site serves its examples: the
 * library from its source, and each shot a page of its own under `shots/`.
 *
 * Served from the repository's top, so a shot and the site's own examples
 * (`/site/src/examples/…`) come from one origin: a shot can set an example in
 * a frame and reach into it, and the recorder's clock turns both.
 *
 * Nothing here is built or shipped. The pages exist to be driven frame by
 * frame by `tools/record.mjs`, which is why they read their time from the
 * page's clock and never from CSS.
 */
const shots = new URL('shots/', import.meta.url)

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: {
      '@plateau-ui/core': new URL('../packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  // Clear of the playground (5180) and the site (5181), which may be open in
  // someone's tab while this runs
  server: { port: Number(process.env['PORT']) || 5190, strictPort: true },
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        readdirSync(shots, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => [entry.name, fileURLToPath(new URL(`${entry.name}/index.html`, shots))]),
      ),
    },
  },
})
