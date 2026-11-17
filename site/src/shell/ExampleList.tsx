import { useSearchParams } from 'react-router'
import { CATEGORIES, EXAMPLES, type Category } from '../examples/registry.js'
import { ExampleCards } from './ExampleCards.js'

/**
 * Every example, with a row of chips to narrow them to one shelf.
 *
 * The shelf picked is in the address (`?category=…`), so a link to one shelf
 * is a link, and the back button undoes a pick.
 */
export function ExampleList() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('category')
  const shelf = CATEGORIES.find((one) => one === asked)
  const shown = shelf ? EXAMPLES.filter((example) => example.category === shelf) : EXAMPLES

  function pick(category: Category | undefined): void {
    setParams(category ? { category } : {}, { replace: false })
  }

  return (
    <main className="page">
      <header className="page-head">
        <h1>Examples</h1>
        <p>機能ごとの使い方を、動くサンプルで紹介します。</p>
      </header>
      <div className="chips" role="group" aria-label="分類">
        <button type="button" aria-pressed={shelf === undefined} onClick={() => pick(undefined)}>
          All
          <span className="chip-count">{EXAMPLES.length}</span>
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={shelf === category}
            onClick={() => pick(category)}
          >
            {category}
            <span className="chip-count">
              {EXAMPLES.filter((example) => example.category === category).length}
            </span>
          </button>
        ))}
      </div>
      <ExampleCards examples={shown} />
    </main>
  )
}
