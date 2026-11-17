import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { Kind } from '../examples/sources.js'

/**
 * Colours the source the way an editor would.
 *
 * Shiki, which is what the documentation sites of Vite, Astro and the rest
 * are coloured with: it reads the same grammars VS Code does, so TypeScript
 * comes out right rather than nearly right.
 *
 * Built by hand out of the three grammars and the one theme this site shows
 * rather than taken whole, since the whole of it carries every language there
 * is. Fetched when the first source is read, so the city is never waiting on
 * it, and built once for the visit.
 */
const GRAMMAR: Record<Kind, string> = { html: 'html', css: 'css', ts: 'typescript' }

const THEME = 'github-light'

let starting: Promise<HighlighterCore> | undefined

function start(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [
      import('shiki/langs/html.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/typescript.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  })
}

/**
 * The source as coloured HTML, without a `<pre>` of its own: the page decides
 * what the code sits on, so it sits on the same grey everywhere and a theme
 * swapped for another does not take the layout with it.
 */
export async function colour(code: string, kind: Kind): Promise<string> {
  starting ??= start()
  const shiki = await starting
  return shiki.codeToHtml(code, { lang: GRAMMAR[kind], theme: THEME, structure: 'inline' })
}
