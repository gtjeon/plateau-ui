import { useEffect, useId, useMemo, useState } from 'react'
import { KIND_NAMES, exampleKinds, readExample, type Kind, type Source } from '../examples/sources.js'
import { colour } from './highlight.js'

/**
 * What the example is made of, read from the files themselves.
 *
 * Open from the start and under the sentence that says what the example is,
 * because the code is what anyone came here for: a page that hides it behind
 * a button is a page where most people never see it. A tab a kind, because an
 * example is markup, styles and a script — what it stands in, how it looks and
 * what it does — and a reader shown only the last is left wondering where the
 * rest went.
 *
 * The script is three files, and each of them stands in a fold of its own with
 * its name and its length on the front. The first is open and the rest are
 * shut. Folding was avoided here for a long time, on the grounds that a reader
 * who cannot see a run of code cannot tell whether it was worth reading — but
 * the fold says which file it is and how many lines are in it, which is enough
 * to decide by, and what it buys is the whole of `main.ts` on the screen at
 * once. Unfolded, the fifty lines of coordinates and building ids that a page
 * of this kind is mostly made of stand between a reader and the calls they
 * opened the page for.
 */
export function ExampleSource({ id }: { id: string }) {
  const kinds = useMemo(() => exampleKinds(id), [id])
  const [kind, setKind] = useState<Kind | undefined>(() => kinds[0])
  /** The files of the kind that is open, or null while they are being read. */
  const [sources, setSources] = useState<Source[] | null>(null)
  /** Which of them are unfolded, by name. */
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())

  // Another example is another set of files, and the one that was open was
  // the other example's.
  useEffect(() => setKind(kinds[0]), [kinds])

  useEffect(() => {
    if (!kind) return
    let wanted = true
    setSources(null)

    void readExample(id, kind)
      .then((read) => {
        if (!wanted) return
        setSources(read)
        // The first of the kind, which is the one the order puts first for
        // being the one worth reading. A reader who folds it and walks to
        // another example gets the same offer again rather than a shut tab.
        setShown(new Set(read.slice(0, 1).map((one) => one.name)))
      })
      .catch(() => undefined)

    return () => {
      wanted = false
    }
  }, [id, kind])

  function fold(name: string): void {
    setShown((was) => {
      const now = new Set(was)
      if (!now.delete(name)) now.add(name)
      return now
    })
  }

  return (
    <section className="example-source" aria-label="サンプルのソース">
      <header className="code-head">
        <div className="code-files" role="tablist" aria-label="ファイル">
          {kinds.map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={one === kind}
              onClick={() => setKind(one)}
            >
              {KIND_NAMES[one]}
            </button>
          ))}
        </div>
      </header>
      {sources === null || kind === undefined ? (
        <p className="code-note">読み込み中…</p>
      ) : (
        <div className="code-sheets">
          {sources.map((source) => (
            <SourceFile
              key={source.name}
              source={source}
              kind={kind}
              shown={shown.has(source.name)}
              onFold={() => fold(source.name)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * One file, with its name on the front and a copy of its own.
 *
 * Coloured whether or not it is unfolded, so that opening a fold shows the
 * code coloured rather than plain for a moment: the highlighter is fetched
 * once for the visit and a file of this length costs it nothing.
 */
function SourceFile({
  source,
  kind,
  shown,
  onFold,
}: {
  source: Source
  kind: Kind
  shown: boolean
  onFold: () => void
}) {
  /** The file, coloured. Null until the highlighter has been fetched and run. */
  const [painted, setPainted] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const body = useId()

  useEffect(() => {
    let wanted = true
    setPainted(null)

    // Shown as it was read and coloured a moment later, rather than held back
    // until the highlighter arrives: the text is what was asked for and the
    // colour is only how it looks.
    void colour(source.text, kind)
      .then((html) => {
        if (wanted) setPainted(html)
      })
      .catch(() => undefined)

    return () => {
      wanted = false
    }
  }, [source.text, kind])

  const lines = useMemo(() => source.text.split('\n'), [source.text])

  /**
   * The coloured file by the line, or null.
   *
   * Asked for the tokens alone, Shiki ends a line with a `<br>` rather than a
   * newline, so that is what the coloured copy is cut on. If the two ever
   * disagree on how many lines the file has, the colour is dropped rather
   * than the text mis-cut — the code is what was asked for.
   */
  const tinted = useMemo(() => {
    if (painted === null) return null
    const rows = painted.split(/<br\s*\/?>/)
    return rows.length === lines.length ? rows : null
  }, [painted, lines])

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(source.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="code-file">
      {/*
       * The name and the copy stand side by side rather than one inside the
       * other, so that reaching for the copy cannot fold the file under it.
       */}
      <div className="code-file-head">
        <button
          type="button"
          className="code-file-name"
          aria-expanded={shown}
          aria-controls={body}
          onClick={onFold}
        >
          <span className="code-file-fold" aria-hidden="true" />
          {source.name}
          {/* How much is behind the fold, so that shutting one is not hiding an unknown. */}
          <span className="code-file-size">{lines.length}行</span>
        </button>
        {/*
         * The word stays put and a tick comes over it, so the row does not
         * shift under the pointer at the moment of pressing — and so a reader
         * who copies twice sees the second one answer at all.
         */}
        <button
          type="button"
          className="code-copy"
          aria-label="コピー"
          data-copied={copied || undefined}
          onClick={() => void copy()}
        >
          <span aria-hidden="true">{copied ? '✓' : 'コピー'}</span>
        </button>
      </div>
      {/*
       * A line to an element rather than one block of text with newlines in
       * it, so that a line too long for the column can be turned with an
       * indent under its own start. Told as one block, a turned line begins
       * hard against the left and reads as the next line rather than as
       * more of this one.
       *
       * The HTML is the site's own files, read off disk when the site was
       * built and coloured in the page. Nothing here came from anywhere a
       * stranger could have written it.
       */}
      {shown && (
        <pre id={body}>
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
      )}
    </div>
  )
}
