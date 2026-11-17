/**
 * What a page of the documentation is made of, as data.
 *
 * Written as data rather than as a component apiece, so that every page is
 * set the same way by one component (`shell/Docs.tsx`) and a page is its text
 * and nothing else. A name of the library's in a sentence is written in
 * backticks and set as code (`shell/Prose.tsx`), as the example list does.
 */

/** One option or property in a page's table. */
export interface DocOption {
  readonly name: string
  /** As the source writes it. */
  readonly type: string
  readonly default?: string
  readonly meaning: string
}

/** A heading and what is under it: sentences, then a table, then a sample. */
export interface DocSection {
  readonly heading: string
  readonly paragraphs: readonly string[]
  readonly options?: readonly DocOption[]
  /** TypeScript, complete enough to run. */
  readonly code?: string
}

export interface DocPage {
  /** The route: `/docs/<slug>`. */
  readonly slug: string
  readonly title: string
  /** What the page is about, in a sentence or two. */
  readonly lead: string
  readonly sections: readonly DocSection[]
}
