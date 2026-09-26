import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      name="app"
      fallback={() => (
        <main className="shell">
          <section className="card error" role="alert">
            <h1>Something went wrong</h1>
            <p>The page hit an unexpected problem. Your saved trips are safe.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
