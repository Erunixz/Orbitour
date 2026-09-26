import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ApiRequestError, fetchTrip } from './lib/api'
import type { Trip, TripRequest } from './lib/types'
import { defaultRequest, Home } from './plan-ui/Home'
import { PlanningScreen } from './plan-ui/PlanningScreen'
import { StatusPage } from './StatusPage'
import { DEFAULT_FIXTURE, useFixture } from './trip/fixtures'
import { TripScreen } from './trip/TripScreen'

// Pages: "/" plans a trip, "/trip/<id>" opens a saved one, "?fixture=<name>"
// opens a sample trip with no planning calls, "/status" shows server health.

const DRAFT_KEY = 'plan.lastRequest.v1'

function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}
const readPath = () => window.location.pathname

export function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function readDraft(): TripRequest {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    return raw ? { ...defaultRequest, ...(JSON.parse(raw) as Partial<TripRequest>) } : defaultRequest
  } catch {
    return defaultRequest
  }
}

function saveDraft(request: TripRequest) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(request))
  } catch {
    // Not saved. The form still works.
  }
}

export function App() {
  const path = useSyncExternalStore(subscribeLocation, readPath, readPath)
  const [planning, setPlanning] = useState<TripRequest | null>(null)
  // The trip just planned, so opening it needs no extra request.
  const [fresh, setFresh] = useState<{ trip: Trip; saved: boolean } | null>(null)

  const plan = useCallback((request: TripRequest) => {
    saveDraft(request)
    setPlanning(request)
  }, [])

  const done = useCallback((trip: Trip, saved: boolean) => {
    setFresh({ trip, saved })
    setPlanning(null)
    navigate(`/trip/${encodeURIComponent(trip.id)}`)
  }, [])

  if (path === '/status') return <StatusPage />

  const fixture = new URLSearchParams(window.location.search).get('fixture')
  if (fixture) return <FixtureTrip name={fixture} />

  const tripMatch = /^\/trip\/([^/]+)\/?$/.exec(path)
  if (tripMatch) {
    const id = decodeURIComponent(tripMatch[1]!)
    if (fresh?.trip.id === id) {
      const notice = fresh.saved ? undefined : 'This plan could not be saved because the database was not reachable. It is gone once you leave this page.'
      return <TripScreen trip={fresh.trip} notice={notice} />
    }
    return <SavedTrip id={id} />
  }

  if (planning) return <PlanningScreen request={planning} onDone={done} onBack={() => setPlanning(null)} />
  return <Home initial={readDraft()} onPlan={plan} sampleHref={`/?fixture=${DEFAULT_FIXTURE}`} />
}

function FixtureTrip({ name }: { name: string }) {
  const state = useFixture(name)
  if (state.kind === 'ready') return <TripScreen trip={state.trip} />
  return <Message title={state.kind === 'loading' ? null : 'Trip not found'} text={state.kind === 'loading' ? 'Loading the trip...' : state.message} />
}

function SavedTrip({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; trip: Trip } | { kind: 'error'; message: string }>({
    kind: 'loading',
  })
  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetchTrip(id, controller.signal)
      .then((trip) => setState({ kind: 'ready', trip }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: error instanceof ApiRequestError ? error.message : 'Could not load this trip.' })
      })
    return () => controller.abort()
  }, [id])
  if (state.kind === 'ready') return <TripScreen trip={state.trip} />
  return <Message title={state.kind === 'loading' ? null : 'Trip not found'} text={state.kind === 'loading' ? 'Loading the trip...' : state.message} />
}

function Message({ title, text }: { title: string | null; text: string }) {
  return (
    <main className="shell">
      <section className="card" aria-live="polite">
        {title ? (
          <div className="error">
            <h1>{title}</h1>
            <p>{text}</p>
            <p>
              <a href="/">Plan a new trip</a>
            </p>
          </div>
        ) : (
          <p className="muted">{text}</p>
        )}
      </section>
    </main>
  )
}
