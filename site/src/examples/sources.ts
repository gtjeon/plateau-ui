/**
 * The files an example is made of, as text.
 *
 * Gathered from the folder rather than listed, so an example is what is in its
 * folder. Three kinds of file — the markup it stands in, the styles it wears
 * and the TypeScript that runs — and one kind may be several files: what the
 * page does is one file, the places it is about another, and the panel down
 * the side a third.
 *
 * The comments come out on the way to the screen. They are written for
 * whoever maintains this repository and are in English, which is not what the
 * site is read in, and what a reader wants here is the shape of the code
 * rather than an argument about it. They stay in the files.
 */
const files = import.meta.glob('./*/*.{html,css,ts}', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

/**
 * In the order they are read, and the first is the one shown.
 *
 * What it does comes first, because that is what anyone opened the page for:
 * the markup it stands in and the styles it wears are what you look at once
 * you have seen the calls.
 */
export const KINDS = ['ts', 'html', 'css'] as const

export type Kind = (typeof KINDS)[number]

export const KIND_NAMES: Record<Kind, string> = { html: 'HTML', css: 'CSS', ts: 'TS' }

/**
 * The order a kind's files stand in, where it has more than one.
 *
 * The same three names in the same three places on every example, so that a
 * reader who has read one knows where to look in the next. The calls first,
 * because they are what anyone opened the page for; the coordinates and ids
 * after them, since they say where rather than how; the panel last, as the one
 * run where the library is never named.
 *
 * Which files there are is still the folder's to say — this only sorts what
 * was found, and anything it does not name falls in after, by name.
 */
const ORDER = ['main.ts', 'data.ts', 'ui.ts']

/** One file of an example, named as the folder names it. */
export interface Source {
  readonly name: string
  readonly text: string
}

/** Which of the three kinds an example has, in order. */
export function exampleKinds(id: string): Kind[] {
  return KINDS.filter((kind) => sourcesOf(id, kind).length > 0)
}

/** Every file of one kind, in the order they are to be read. */
export async function readExample(id: string, kind: Kind): Promise<Source[]> {
  return Promise.all(
    sourcesOf(id, kind).map(async ([name, read]) => ({
      name,
      text: withoutComments(await read(), kind),
    })),
  )
}

/** The files of one kind, as `[name, read]`, sorted. */
function sourcesOf(id: string, kind: Kind): [string, () => Promise<string>][] {
  const prefix = `./${id}/`
  return Object.entries(files)
    .filter(([path]) => path.startsWith(prefix) && path.endsWith(`.${kind}`))
    .map(([path, read]): [string, () => Promise<string>] => [path.slice(prefix.length), read])
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
}

function rank(name: string): number {
  const at = ORDER.indexOf(name)
  return at === -1 ? ORDER.length : at
}

/**
 * The same file with its comments taken out.
 *
 * Which marks a comment depends on the file: a `//` is one in TypeScript and
 * in nothing else — in markup it is half of every link there is.
 *
 * The script and the stylesheet are read one character at a time rather than
 * by pattern, because a `//` inside a string is not a comment and a pattern
 * cannot tell the difference. Strings and templates are copied through whole,
 * escapes and all.
 *
 * The newlines inside a comment are kept as it is dropped, so the text that
 * comes out has the same lines as the text that went in. That is what lets a
 * line which held nothing but a comment be dropped rather than left behind as
 * a blank one, while a blank line the author put there stays.
 */
function withoutComments(text: string, kind: Kind): string {
  return tidy(text, kind === 'html' ? withoutTags(text) : withoutSlashes(text))
}

function withoutTags(text: string): string {
  let out = ''
  let at = 0

  while (at < text.length) {
    if (text.startsWith('<!--', at)) {
      at += 4
      while (at < text.length && !text.startsWith('-->', at)) {
        if (text[at] === '\n') out += '\n'
        at += 1
      }
      at += 3
      continue
    }
    out += text[at]
    at += 1
  }

  return out
}

function withoutSlashes(text: string): string {
  let out = ''
  let at = 0

  while (at < text.length) {
    const here = text[at]
    const next = text[at + 1]

    if (here === '/' && next === '/') {
      while (at < text.length && text[at] !== '\n') at += 1
      continue
    }

    if (here === '/' && next === '*') {
      at += 2
      while (at < text.length && !(text[at] === '*' && text[at + 1] === '/')) {
        if (text[at] === '\n') out += '\n'
        at += 1
      }
      at += 2
      continue
    }

    if (here === '"' || here === "'" || here === '`') {
      const quote = here
      out += here
      at += 1
      while (at < text.length) {
        const inside = text[at]
        out += inside
        at += 1
        if (inside === '\\') {
          out += text[at] ?? ''
          at += 1
          continue
        }
        if (inside === quote) break
      }
      continue
    }

    out += here
    at += 1
  }

  return out
}

/** Closes the gaps: a line a comment had to itself goes with it. */
function tidy(before: string, after: string): string {
  const had = before.split('\n')
  const left = after
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, at) => line !== '' || (had[at] ?? '').trim() === '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `${left}\n`
}
