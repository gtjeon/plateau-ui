import { useState } from 'react'
import { Link } from 'react-router'
import { exampleById, exampleThumb, type ExampleCard } from '../examples/registry.js'
import { FILM, REPOSITORY } from './links.js'

/**
 * The first screen: pictures, and as few words as will say what they are.
 *
 * The picture across the top is the first example as it opens, taken on a wide
 * screen by `tools/thumbs.mjs --hero`, and upright for a phone by
 * `--hero-portrait`. Under it, a wall of the examples' own
 * cards, one large and the rest around it, each a way in. Between the two, the
 * introduction film, as a still until it is played. No viewer runs here:
 * a map on the home page buys a device and fetches tiles before anybody has
 * asked for one, and every picture on it is a click from the page that draws it.
 */
export function Home() {
  return (
    <main className="home">
      <section className="hero">
        {/* Upright on a phone, framed for that shape: see `--hero-portrait` in `tools/thumbs.mjs` */}
        <picture>
          <source media="(max-width: 640px)" srcSet={`${import.meta.env.BASE_URL}hero-portrait.webp`} />
          <img
            className="hero-picture"
            src={`${import.meta.env.BASE_URL}hero.webp`}
            alt="中目黒の街をミニチュアのように写した3D地図"
          />
        </picture>
        <div className="hero-words">
          <h1>plateau-ui</h1>
          {/* A span to each half, so a narrow card breaks between the two and never inside one */}
          <p className="hero-catch">
            <span>PLATEAU を、あなたのページに。</span>
            <span>アイデアの土台に。</span>
          </p>
          <p className="hero-lead">
            日本の 3D 建物マップを、手軽に描けるライブラリ。three.js
            でできることは、この上でもそのままできます。国のオープンデータだけで動きます。
          </p>
          <div className="hero-actions">
            <Link to="/docs" className="button button-strong">
              はじめる
            </Link>
            <Link to="/examples" className="button">
              サンプルを見る
            </Link>
            <a href={REPOSITORY} className="button" target="_blank" rel="noreferrer">
              GitHub を見る
            </a>
          </div>
        </div>
      </section>

      <section className="film-section">
        <div className="wall-head">
          <h2>Video</h2>
        </div>
        <Film />
      </section>

      <section className="wall-section">
        <div className="wall-head">
          <h2>Examples</h2>
          <Link to="/examples" className="more">
            すべて見る <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className="wall">
          {WALL.map((id, at) => {
            const card = exampleById(id)
            return card ? <WallTile key={id} card={card} big={at === 0} /> : null
          })}
        </ul>
      </section>
    </main>
  )
}

/**
 * Which examples stand on the wall, the large one first. Chosen to show the
 * two things the line above them promises: a city that drops into a page of
 * your own as it comes (an office's access map, a place to stay, a café
 * street, a ward's guide, a mall), and a ground to build an idea on (a giant,
 * a camera's view, flood hours stood up, three.js fireworks). The grid is four
 * across with the large one taking two by two, so the eight fill around it in
 * a checker of the two, and none of them is the picture already across the top.
 */
const WALL = [
  'workspace',
  'airstay',
  'zilla',
  'security-camera',
  'riverside-cafes',
  'guide-map',
  'flood-hours',
  'outlets',
  'fireworks',
]

/**
 * The introduction film: a still of its first title until it is asked for,
 * and only then YouTube's player, already playing. The still is the film's own
 * frame, kept with the site, so the home page fetches nothing from YouTube for
 * a visitor who does not press play; the player comes from youtube-nocookie.
 */
function Film() {
  const [playing, setPlaying] = useState(false)
  return (
    <div className="film">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${FILM}?autoplay=1&rel=0`}
          title="plateau-ui 紹介映像"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button type="button" className="film-poster" onClick={() => setPlaying(true)} aria-label="紹介映像を再生">
          <img src={`${import.meta.env.BASE_URL}video-poster.webp`} alt="" />
          <span className="film-play" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function WallTile({ card, big }: { card: ExampleCard; big: boolean }) {
  return (
    <li className={big ? 'tile tile-big' : 'tile'}>
      <Link to={`/examples/${card.id}`} aria-label={card.title}>
        <img src={exampleThumb(card.id)} alt="" loading="lazy" />
        <span className="tile-caption">
          <strong>{card.title}</strong>
          <small>{card.place}</small>
        </span>
      </Link>
    </li>
  )
}
