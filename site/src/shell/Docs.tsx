import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { DOC_GROUPS } from '../docs/groups.js'
import { DOC_PAGES } from '../docs/pages.js'
import type { DocPage, DocSection } from '../docs/types.js'
import { colour } from './highlight.js'
import { NotFound } from './NotFound.js'
import { Prose } from './Prose.js'

/**
 * The reading side of the site, in three columns: the pages in their groups
 * down the left, the page asked for in the middle, and its own sections down
 * the right with the one being read marked. On a narrow screen the left
 * folds behind a button and the right goes.
 *
 * `/docs` on its own is the first page, which is where a reader starts.
 */
export function Docs() {
  const { slug } = useParams()
  const page = slug === undefined ? DOC_PAGES[0] : DOC_PAGES.find((one) => one.slug === slug)
  const [find, setFind] = useState('')
  const [open, setOpen] = useState(false)
  const reading = useReading(page)

  // A new page is read with the list shut on a narrow screen. Its top is the
  // app's to go to (`App.tsx`), for every page alike
  useEffect(() => {
    setOpen(false)
  }, [page])

  if (!page) return <NotFound />
  const order = DOC_GROUPS.flatMap((group) => group.slugs)
  const at = order.indexOf(page.slug)
  const before = DOC_PAGES.find((one) => one.slug === order[at - 1])
  const after = DOC_PAGES.find((one) => one.slug === order[at + 1])
  const group = DOC_GROUPS.find((one) => one.slugs.includes(page.slug))
  const wanted = find.trim()

  return (
    <div className="docs">
      <button
        type="button"
        className="docs-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        目次
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      <aside className="docs-nav" data-open={open || undefined} aria-label="ドキュメントの目次">
        <input
          className="docs-find"
          type="search"
          placeholder="ページを探す"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          aria-label="ページを探す"
        />
        {DOC_GROUPS.map((one) => {
          const pages = one.slugs
            .map((name) => DOC_PAGES.find((doc) => doc.slug === name))
            .filter(
              (doc): doc is DocPage => doc !== undefined && (wanted === '' || doc.title.includes(wanted)),
            )
          if (pages.length === 0) return null
          return (
            <div key={one.title} className="docs-group">
              <p className="docs-group-title">{one.title}</p>
              <ul>
                {pages.map((doc) => (
                  <li key={doc.slug}>
                    <NavLink
                      to={`/docs/${doc.slug}`}
                      className={() => (doc === page ? 'active' : undefined)}
                      aria-current={doc === page ? 'page' : undefined}
                    >
                      {doc.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </aside>

      <article className="docs-body">
        <p className="docs-crumbs">
          Docs
          {group && (
            <>
              <span aria-hidden="true"> › </span>
              {group.title}
            </>
          )}
        </p>
        <h1>{page.title}</h1>
        <p className="docs-lead">
          <Prose text={page.lead} />
        </p>
        {page.sections.map((section, index) => (
          <Section key={section.heading} section={section} id={`s-${index}`} />
        ))}
        <Turn before={before} after={after} />
      </article>

      <nav className="docs-toc" aria-label="このページの内容">
        <p className="docs-toc-title">On this page</p>
        <ul>
          {page.sections.map((section, index) => (
            <li key={section.heading}>
              <a href={`#s-${index}`} className={reading === index ? 'active' : undefined}>
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/**
 * Which section of the page is being read: the last whose heading has passed
 * under the bar, or the first while none has.
 */
function useReading(page: DocPage | undefined): number {
  const [reading, setReading] = useState(0)
  useEffect(() => {
    if (!page) return
    setReading(0)
    const sections = page.sections.map((_, index) => document.getElementById(`s-${index}`))
    const look = (): void => {
      // The bar is 56 px tall and a heading is read a little below it
      const line = 96
      let last = 0
      sections.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= line) last = index
      })
      // At the foot of the page the last sections cannot reach the line
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)
        last = sections.length - 1
      setReading(last)
    }
    look()
    window.addEventListener('scroll', look, { passive: true })
    window.addEventListener('resize', look)
    return () => {
      window.removeEventListener('scroll', look)
      window.removeEventListener('resize', look)
    }
  }, [page])
  return reading
}

function Section({ section, id }: { section: DocSection; id: string }) {
  return (
    <section className="docs-section" id={id}>
      <h2>{section.heading}</h2>
      {section.paragraphs.map((text, at) => (
        <p key={at}>
          <Prose text={text} />
        </p>
      ))}
      {section.options && section.options.length > 0 && (
        <div className="docs-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {section.options.map((option) => (
                <tr key={option.name}>
                  <td>
                    <code>{option.name}</code>
                  </td>
                  <td>
                    <code>{option.type}</code>
                  </td>
                  <td>
                    {option.default === undefined ? (
                      '—'
                    ) : option.default.includes('`') ? (
                      // Written as a sentence with names in it, as the meaning is
                      <Prose text={option.default} />
                    ) : (
                      <code>{option.default}</code>
                    )}
                  </td>
                  <td>
                    <Prose text={option.meaning} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.code && <Sample code={section.code} />}
    </section>
  )
}

/**
 * A sample, coloured once the highlighter has come and shown plain until it
 * has: the text is what was asked for and the colour is only how it looks.
 * The HTML is the site's own pages, coloured in the page; nothing in it came
 * from anywhere a stranger could have written it.
 */
function Sample({ code }: { code: string }) {
  const [painted, setPainted] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let wanted = true
    void colour(code, 'ts')
      .then((html) => {
        if (wanted) setPainted(html)
      })
      .catch(() => undefined)
    return () => {
      wanted = false
    }
  }, [code])

  const lines = useMemo(() => code.split('\n'), [code])
  // Shiki ends a line with a `<br>`; the colour is dropped rather than the
  // text mis-cut if the two ever disagree on how many lines there are
  const tinted = useMemo(() => {
    if (painted === null) return null
    const rows = painted.split(/<br\s*\/?>/)
    return rows.length === lines.length ? rows : null
  }, [painted, lines])

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="docs-code">
      <button
        type="button"
        className="code-copy"
        aria-label="コピー"
        data-copied={copied || undefined}
        onClick={() => void copy()}
      >
        <span aria-hidden="true">{copied ? '✓' : 'コピー'}</span>
      </button>
      <pre>
        <code>
          {(tinted ?? lines).map((row, at) =>
            tinted ? (
              <span key={at} className="code-line" dangerouslySetInnerHTML={{ __html: row }} />
            ) : (
              <span key={at} className="code-line">
                {row}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  )
}

/** The page before and the page after, at the foot of the page. */
function Turn({ before, after }: { before: DocPage | undefined; after: DocPage | undefined }) {
  if (!before && !after) return null
  return (
    <nav className="docs-turn" aria-label="前後のページ">
      {before ? (
        <Link to={`/docs/${before.slug}`} className="docs-turn-before">
          <small>← 前へ</small>
          {before.title}
        </Link>
      ) : (
        <span />
      )}
      {after && (
        <Link to={`/docs/${after.slug}`} className="docs-turn-after">
          <small>次へ →</small>
          {after.title}
        </Link>
      )}
    </nav>
  )
}
