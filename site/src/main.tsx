import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App.js'
import { paintFromLibrary } from './shell/palette.js'
import './styles.css'

const root = document.querySelector('#root')
if (!root) throw new Error('#root not found')

// Before anything is drawn, so the page is never seen in another set of colours.
paintFromLibrary()

// StrictMode on purpose: it mounts every effect twice in development, which
// builds a Viewer, throws it away and builds another. That is the cheapest
// standing test of `dispose()` — a device left behind shows up here first.
createRoot(root).render(
  <StrictMode>
    {/* Under the folder the site is built for (`SITE_BASE`), and at the top in development */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/(.)\/$/, '$1')}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
