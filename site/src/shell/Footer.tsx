import { Link } from 'react-router'

/**
 * The foot of the reading pages: where the data comes from, which the maps
 * say themselves under every view, said once more for the site as a whole,
 * where to write to, and the licence the library is under.
 */
export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true" />
          plateau-ui
        </div>
        <nav className="footer-links" aria-label="サイト">
          <Link to="/docs">Docs</Link>
          <Link to="/examples">Examples</Link>
        </nav>
        <p className="footer-note">
          データ:{' '}
          <a href="https://www.mlit.go.jp/plateau/" target="_blank" rel="noreferrer">
            国土交通省 PLATEAU
          </a>
          、
          <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">
            国土地理院
          </a>
          <br />
          お問い合わせ: <a href="mailto:jeon.gwontaek.dev@gmail.com">jeon.gwontaek.dev@gmail.com</a>
          <br />
          MIT License
        </p>
      </div>
    </footer>
  )
}
