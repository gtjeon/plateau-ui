import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router'
import { Docs } from './shell/Docs.js'
import { ExampleList } from './shell/ExampleList.js'
import { ExamplePage } from './shell/ExamplePage.js'
import { Footer } from './shell/Footer.js'
import { Header } from './shell/Header.js'
import { Home } from './shell/Home.js'
import { NotFound } from './shell/NotFound.js'

/**
 * The bar stands over every page; the foot under every page that is read
 * rather than looked at. An example's page has no foot: it is a map the size
 * of the window, and a map has no end to scroll to.
 */
export function App() {
  const { pathname, hash } = useLocation()
  const fills = /^\/examples\/[^/]+/.test(pathname)
  const arrived = useNavigationType()

  // A page reached by a link starts at its top, as a page loaded afresh does:
  // the window is the one thing every page shares, and it kept the last
  // page's place. Going back is left to the browser, which puts the reader
  // where they were; a link to a place on the page (`#…`) goes to that place
  useEffect(() => {
    if (arrived !== 'POP' && hash === '') window.scrollTo(0, 0)
  }, [pathname, arrived, hash])

  return (
    <>
      <Header wide={fills} />
      <Routes>
        <Route index element={<Home />} />
        <Route path="examples" element={<ExampleList />} />
        <Route path="examples/:id" element={<ExamplePage />} />
        <Route path="docs" element={<Docs />} />
        <Route path="docs/:slug" element={<Docs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {!fills && <Footer />}
    </>
  )
}
