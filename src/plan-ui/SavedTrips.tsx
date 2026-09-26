import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, deleteTrip, fetchTrips } from '../lib/api'
import type { TripList, TripSummary } from '../lib/schemas'

// Recent trips on the home page: open or delete. Delete asks once more first.

type State = { kind: 'loading' } | { kind: 'ready'; list: TripList } | { kind: 'error'; message: string }

function formatUpdated(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SavedTrips() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetchTrips(controller.signal)
      .then((list) => setState({ kind: 'ready', list }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: error instanceof ApiRequestError ? error.message : 'Could not load saved trips.' })
      })
    return () => controller.abort()
  }, [attempt])

  const removed = useCallback((id: string) => {
    setState((s) => (s.kind === 'ready' ? { kind: 'ready', list: { ...s.list, trips: s.list.trips.filter((t) => t.id !== id) } } : s))
  }, [])

  return (
    <section className="card saved-trips" aria-labelledby="saved-trips-title" aria-live="polite">
      <h2 id="saved-trips-title">Saved trips</h2>
      {state.kind === 'loading' && <p className="muted">Loading your trips...</p>}
      {state.kind === 'error' && (
        <div className="error">
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {state.kind === 'ready' && (
        <>
          {state.list.store === 'memory' && (
            <p className="muted saved-note">
              No database is set up, so trips live in server memory and are gone after a restart. Set MONGODB_URI to keep them.
            </p>
          )}
          {state.list.trips.length === 0 ? (
            <p className="muted">No trips yet. Plan one above and it shows up here.</p>
          ) : (
            <ul className="saved-list">
              {state.list.trips.map((trip) => (
                <SavedRow key={trip.id} trip={trip} onDeleted={removed} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function SavedRow({ trip, onDeleted }: { trip: TripSummary; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteTrip(trip.id)
      onDeleted(trip.id)
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not delete this trip.')
      setBusy(false)
      setConfirming(false)
    }
  }

  const updated = formatUpdated(trip.updatedAt)
  return (
    <li className="saved-row">
      <a className="saved-open" href={`/trip/${encodeURIComponent(trip.id)}`}>
        <span className="saved-title">{trip.title}</span>
        <span className="muted saved-meta">
          {trip.city} · {trip.days === 1 ? '1 day' : `${trip.days} days`}
          {updated && ` · ${updated}`}
        </span>
      </a>
      {confirming ? (
        <span className="saved-confirm">
          <button type="button" className="danger" onClick={remove} disabled={busy}>
            {busy ? 'Deleting...' : 'Delete'}
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Keep
          </button>
        </span>
      ) : (
        <button type="button" className="secondary" onClick={() => setConfirming(true)} aria-label={`Delete ${trip.title}`}>
          Delete
        </button>
      )}
      {error && (
        <p className="error-inline saved-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
