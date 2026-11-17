import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { exampleById, exampleUrl, type ExampleCard } from '../examples/registry.js'
import { ExampleSource } from './ExampleSource.js'
import { NotFound } from './NotFound.js'
import { Prose } from './Prose.js'

/**
 * One example, opened: the map as large as the window allows, a bar over it
 * that says where you are and leads back to the list, and a side that says
 * what the example is and shows what it is made of. No way to the example
 * before or after: the list is the way about, and the bar is short for it.
 *
 * The side can be put away for the map alone, and comes back with the same
 * press. What is in the frame is a page of its own, which runs when it loads
 * and is gone when the frame is, so nothing of the site has to reach in and
 * nothing of it leaks out into what is shown as the code — how three.js and
 * MapLibre show theirs.
 */
export function ExamplePage() {
  const { id } = useParams()
  const card = exampleById(id)
  const [side, setSide] = useState(true)

  if (!card) return <NotFound />

  return (
    <div className="example" data-side={side ? 'open' : 'shut'}>
      <div className="example-bar">
        <nav className="crumbs" aria-label="パンくずリスト">
          <Link to="/examples">一覧</Link>
          <span aria-hidden="true">›</span>
          {/* The example's own address, which the title over the side already names in words */}
          <span aria-current="page" className="crumbs-here">
            {card.id}
          </span>
        </nav>
        <div className="example-tools">
          <a className="tool" href={exampleUrl(card.id)} target="_blank" rel="noreferrer">
            <span className="tool-word">新しいタブ</span>
            <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            className="tool tool-strong"
            aria-pressed={side}
            onClick={() => setSide((was) => !was)}
          >
            {side ? 'コードを閉じる' : 'コードを見る'}
          </button>
        </div>
      </div>

      <div className="example-body">
        <ExampleFrame card={card} />
        {side && (
          <aside className="example-side" aria-label="サンプルの説明とソース">
            <header className="example-head">
              <p className="example-meta">{card.place}</p>
              <h1>{card.title}</h1>
              <p className="example-blurb">
                <Prose text={card.blurb} />
              </p>
              <ul className="tags" aria-label="使っている API">
                {card.tags.map((tag) => (
                  <li key={tag}>
                    <code>{tag}</code>
                  </li>
                ))}
              </ul>
            </header>
            <ExampleSource id={card.id} />
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * The example's page, in a frame of its own.
 *
 * Keyed by the example, so walking to another one is a new frame rather than
 * the same one pointed elsewhere: the old document goes, and with it the
 * device it held.
 */
function ExampleFrame({ card }: { card: ExampleCard }) {
  const [standing, setStanding] = useState<string | null>(null)

  return (
    <div className="example-map">
      <iframe
        key={card.id}
        className="example-frame"
        src={exampleUrl(card.id)}
        title={card.title}
        onLoad={() => setStanding(card.id)}
      />
      {standing !== card.id && <p className="example-loading">読み込み中…</p>}
    </div>
  )
}
