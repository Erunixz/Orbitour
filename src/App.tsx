import { StatusPage } from './StatusPage'
import { DEFAULT_FIXTURE, useFixture } from './trip/fixtures'
import { TripScreen } from './trip/TripScreen'

export function App() {
  if (window.location.pathname === '/status') return <StatusPage />
  // Until planning exists, the app always shows a fixture trip.
  const name = new URLSearchParams(window.location.search).get('fixture') || DEFAULT_FIXTURE
  return <FixtureTrip name={name} />
}

function FixtureTrip({ name }: { name: string }) {
  const state = useFixture(name)
  if (state.kind === 'ready') return <TripScreen trip={state.trip} />
  return (
    <main className="shell">
      <section className="card" aria-live="polite">
        {state.kind === 'loading' ? (
          <p className="muted">Loading the trip...</p>
        ) : (
          <div className="error">
            <h1>Trip not found</h1>
            <p>{state.message}</p>
          </div>
        )}
      </section>
    </main>
  )
}
