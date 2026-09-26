import { useCallback, useEffect, useState } from 'react'
import { fetchHealth, ApiRequestError } from './lib/api'
import type { Health } from './lib/health'

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: Health }
  | { kind: 'error'; message: string }

export function StatusPage() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ready', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof ApiRequestError ? error.message : 'Could not load server status.'
        setState({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return (
    <main className="shell">
      <header>
        <h1>[APP_NAME]</h1>
        <p className="muted">Server status. <a href="/">Back to the map</a></p>
      </header>

      <section className="card" aria-live="polite">
        <h2>Server status</h2>
        {state.kind === 'loading' && <p className="muted">Checking the server...</p>}

        {state.kind === 'error' && (
          <div className="error">
            <p>{state.message}</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {state.kind === 'ready' && <HealthView health={state.health} />}
      </section>
    </main>
  )
}

function HealthView({ health }: { health: Health }) {
  const entries = Object.entries(health.keys)
  return (
    <>
      <p>
        Server is up. Trip store: <strong>{health.store === 'mongo' ? 'MongoDB' : 'in memory'}</strong>.
      </p>
      {health.missing.length === 0 ? (
        <p className="ok">All settings are configured.</p>
      ) : (
        <p className="warn">
          {health.missing.length} setting{health.missing.length === 1 ? '' : 's'} missing. Add them to your .env
          file.
        </p>
      )}
      <ul className="keys">
        {entries.map(([name, present]) => (
          <li key={name}>
            <span className={present ? 'dot on' : 'dot off'} aria-hidden="true" />
            <code>{name}</code>
            <span className="muted">{present ? 'set' : 'missing'}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
