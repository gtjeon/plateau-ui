import type { Palette } from './theme.js'

/**
 * Who the data on the screen comes from.
 *
 * Both of the sources this library fetches from ask to be named where their
 * data is shown, and the GSI asks for its list of tiles to be linked as well.
 * That is a condition of use, not a courtesy, and it falls on whoever puts
 * the map on a page — which is why the viewer draws the line itself rather
 * than leaving every page to remember it.
 */
export interface Credit {
  /** The words, as the terms ask for them. */
  readonly text: string
  /** Where they lead, where the terms ask for a link. */
  readonly url?: string
}

/**
 * Which corner of the map the line stands in, named the way the map
 * libraries name their corners.
 */
/**
 * Who to name, said as one or as several — the one way every layer takes it
 * (rule 5). They were `Credit` on the picture layers and the vector tiles,
 * either on a file of features, and `credits` in a list on a model.
 */
export type Credits = Credit | readonly Credit[]

/** The names to put on the line, from whatever was said; none for nothing. */
export function creditsOf(credit: Credits | undefined): readonly Credit[] {
  if (credit === undefined) return []
  return Array.isArray(credit) ? (credit as readonly Credit[]) : [credit as Credit]
}

export type CreditsCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const DEFAULT_CREDITS_CORNER: CreditsCorner = 'bottom-right'

/**
 * The two the library fetches from.
 *
 * Here rather than in the layer that fetches, because the ground and the
 * buildings both draw data from both and neither owns what they agree on.
 */
export const PLATEAU_CREDIT: Credit = {
  text: '国土交通省 PLATEAU',
  url: 'https://www.mlit.go.jp/plateau/',
}

export const GSI_CREDIT: Credit = {
  text: '国土地理院 最適化ベクトルタイル・標高タイル',
  url: 'https://maps.gsi.go.jp/development/ichiran.html',
}

/** What the line says now, as one string, for telling one frame from the next. */
export function creditKey(credits: readonly Credit[]): string {
  // The address too: a page that keeps a name and moves where it links to
  // has changed the line, and keyed by the name alone the old link stayed and
  // \`credits\` was never told (found in review)
  return credits.map((credit) => `${credit.text}\u0001${credit.url ?? ''}`).join('\u0000')
}

/**
 * Every name the layers gave, each one once and in the order they were given.
 *
 * Two layers drawing the same source is the usual case — the ground and the
 * buildings both stand on the GSI's tiles — and the line names it once.
 */
export function gatherCredits(given: readonly (readonly Credit[])[]): Credit[] {
  const seen = new Set<string>()
  const all: Credit[] = []
  for (const credits of given) {
    for (const credit of credits) {
      if (seen.has(credit.text)) continue
      seen.add(credit.text)
      all.push(credit)
    }
  }
  return all
}

/**
 * The line itself, in the corner of the container the canvas is in.
 *
 * Drawn by the viewer rather than reported and left to the page: a page that
 * forgets it is a page in breach, and the one that most needs telling is the
 * one that did not know to ask. A page that wants it elsewhere can move it —
 * it carries a class of its own — and `on('credits')` says what it says, for
 * a page that would rather draw its own.
 */
export class CreditsLine {
  readonly element: HTMLElement = document.createElement('p')
  #key = '\u0001'

  constructor() {
    this.element.className = 'plateau-credits'
    this.element.style.cssText = [
      'position:absolute',
      'z-index:1',
      'margin:0',
      'padding:2px 7px',
      'max-width:calc(100% - 16px)',
      'border-radius:4px',
      'font:11px/1.5 system-ui,sans-serif',
    ].join(';')
    this.at(DEFAULT_CREDITS_CORNER)
    // Nothing until a layer says something, so an empty scene has no empty box
    this.element.hidden = true
  }

  /** Says the names, or hides the line where there are none. */
  set(credits: readonly Credit[]): void {
    const key = creditKey(credits)
    if (key === this.#key) return
    this.#key = key

    this.element.replaceChildren()
    this.element.hidden = credits.length === 0
    if (credits.length === 0) return

    credits.forEach((credit, at) => {
      if (at > 0) this.element.append(' · ')
      const href = linkable(credit.url)
      if (!href) {
        this.element.append(credit.text)
        return
      }
      const link = document.createElement('a')
      link.href = href
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = credit.text
      link.style.color = 'inherit'
      this.element.append(link)
    })
  }

  /** Stands it in one of the four corners. */
  at(corner: CreditsCorner): void {
    const style = this.element.style
    const edge = '8px'
    style.top = corner.startsWith('top') ? edge : 'auto'
    style.bottom = corner.startsWith('bottom') ? edge : 'auto'
    style.left = corner.endsWith('left') ? edge : 'auto'
    style.right = corner.endsWith('right') ? edge : 'auto'
  }

  /**
   * Takes its colours from the scene's own, so the line belongs to the map
   * rather than sitting on it. The palette is for a map and names no ink, so
   * the words are the line round a building taken most of the way to black.
   */
  colour(palette: Palette): void {
    this.element.style.background = `color-mix(in srgb, ${palette.backdrop} 86%, transparent)`
    this.element.style.color = `color-mix(in srgb, ${palette.edge}, black 45%)`
  }

  dispose(): void {
    this.element.remove()
  }
}

/**
 * The address a name links to, where it is a page on the web: `http:` or
 * `https:`, read against the page it is on. Anything else is said as plain
 * text. A credit is the page's own words, so this is no wall against a
 * stranger; it keeps a `javascript:` a page passed on from its own users from
 * becoming a link under every map, rather than leaving that to how a browser
 * treats such a link opened in a tab of its own (found in review).
 */
function linkable(url: string | undefined): string | null {
  if (!url) return null
  try {
    const read = new URL(url, location.href)
    return read.protocol === 'https:' || read.protocol === 'http:' ? read.href : null
  } catch {
    return null
  }
}
