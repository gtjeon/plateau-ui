import { Link } from 'react-router'
import { exampleThumb, type ExampleCard } from '../examples/registry.js'
import { Prose } from './Prose.js'

/** The examples given, as cards: the picture, the name, the place and the sentence. */
export function ExampleCards({ examples }: { examples: readonly ExampleCard[] }) {
  return (
    <ul className="cards">
      {examples.map((example) => (
        <li key={example.id}>
          <Link to={`/examples/${example.id}`} className="card" aria-label={example.title}>
            {/*
              The example's own page, as it draws itself. Nothing is said in
              the picture that the title and the sentence under it do not say,
              so it carries no text of its own to read out.
            */}
            <span className="card-picture">
              <img src={exampleThumb(example.id)} alt="" loading="lazy" />
            </span>
            <span className="card-words">
              <span className="card-meta">{example.place}</span>
              <strong>{example.title}</strong>
              <span className="card-blurb">
                <Prose text={example.blurb} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
