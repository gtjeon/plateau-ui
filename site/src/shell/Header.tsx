import { Link, NavLink } from 'react-router'
import { REPOSITORY } from './links.js'

/**
 * The bar over every page: the name, where the site goes, and that what it
 * shows is not finished yet. One line at every width; on a phone the two links
 * close up rather than fold into a menu, since two is not enough to hide.
 * `wide` runs it edge to edge, over a page that does too.
 */
export function Header({ wide = false }: { wide?: boolean }) {
  return (
    <header className={wide ? 'header header-wide' : 'header'}>
      <div className="header-in">
        <Link to="/" className="brand" aria-label="plateau-ui ホーム">
          <span className="brand-mark" aria-hidden="true" />
          plateau-ui
          <span className="brand-tag">alpha</span>
        </Link>
        <nav className="header-nav" aria-label="サイト">
          <NavLink to="/docs">Docs</NavLink>
          <NavLink to="/examples">Examples</NavLink>
        </nav>
        <a className="header-out" href={REPOSITORY} target="_blank" rel="noreferrer">
          GitHub
          <span aria-hidden="true">↗</span>
        </a>
        <a className="header-out header-out-next" href="https://www.mlit.go.jp/plateau/" target="_blank" rel="noreferrer">
          PLATEAU
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
  )
}
