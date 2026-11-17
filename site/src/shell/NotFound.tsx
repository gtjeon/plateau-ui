import { Link } from 'react-router'

export function NotFound() {
  return (
    <main className="page">
      <h1>ページが見つかりません</h1>
      <p className="section-lead">アドレスが違うか、まだ作っていない場所です。</p>
      <p>
        <Link to="/" className="button">
          ホームへ
        </Link>
      </p>
    </main>
  )
}
