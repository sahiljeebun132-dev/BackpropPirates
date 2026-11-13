import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support. Registered after load so it never competes with the first
// paint, and failures are swallowed: a browser without service workers, or a
// page served over plain http, must still get the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err: unknown) => {
        // Swallowed from the user's point of view — the app works without
        // it — but not silent, because a registration that fails quietly is
        // a feature that looks fine and is not there.
        console.warn('Zetway: offline support unavailable.', err)
      })
  })
}
