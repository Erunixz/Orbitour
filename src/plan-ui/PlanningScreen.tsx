import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ApiRequestError, streamPlan } from '../lib/api'
import type { PlanEvent } from '../lib/planEvents'
import type { Leg, Stop, Trip, TripRequest } from '../lib/types'
import { MapView } from '../map/MapView'
import { CrewPanel } from './CrewPanel'
import { initialPlanView, reducePlan, type StopPreview } from './planState'

// Planning: the 3D city loads behind the crew panel. Pins appear as stops are
// verified and routes draw when the Router is done.

type Props = {
  request: TripRequest
  onDone: (trip: Trip) => void
  onBack: () => void
}

type Action = { kind: 'event'; event: PlanEvent } | { kind: 'reset' }

function reducer(state: ReturnType<typeof initialPlanView>, action: Action) {
  return action.kind === 'reset' ? initialPlanView() : reducePlan(state, action.event)
}

/** The map only needs a few fields of a stop while planning. */
const asStop = (p: StopPreview): Stop => ({
  ...p,
  kind: 'other',
  summary: '',
  reason: '',
  photo: null,
  sources: [],
  visitMin: 0,
  arrive: '00:00',
  depart: '00:00',
  mustSee: false,
})

const noop = () => {}

export function PlanningScreen({ request, onDone, onBack }: Props) {
  const [view, dispatch] = useReducer(reducer, undefined, initialPlanView)
  const [attempt, setAttempt] = useState(0)
  const [connection, setConnection] = useState<string | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const controller = new AbortController()
    dispatch({ kind: 'reset' })
    setConnection(null)
    streamPlan(request, (event) => dispatch({ kind: 'event', event }), controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setConnection(error instanceof ApiRequestError ? error.message : 'Planning stopped unexpectedly.')
    })
    return () => controller.abort()
  }, [request, attempt])

  // Give the last card a moment to show "Done" before opening the trip.
  useEffect(() => {
    if (!view.trip) return
    const trip = view.trip
    const timer = setTimeout(() => doneRef.current(trip), 900)
    return () => clearTimeout(timer)
  }, [view.trip])

  const { stops, legs } = useMemo(() => {
    if (view.days) {
      return {
        stops: view.days.flatMap((d) => d.stops.map(asStop)),
        legs: view.days.flatMap((d) => d.legs) as Leg[],
      }
    }
    return { stops: view.stops.map(asStop), legs: [] as Leg[] }
  }, [view.days, view.stops])

  const problem = view.failure?.message ?? connection
  const center = view.area?.center

  return (
    <div className="planning-screen">
      <div className="planning-map">
        {center ? (
          <MapView
            center={center}
            dayIndex={0}
            stops={stops}
            legs={legs}
            color="#2f6fed"
            focus={{ kind: 'overview' }}
            onSelectStop={noop}
            bottomInsetPx={0}
            followRoute={false}
          />
        ) : (
          <div className="planning-placeholder" aria-hidden="true" />
        )}
      </div>

      <aside className="planning-panel" aria-live="polite">
        <header>
          <h1>Planning {request.city}</h1>
          <p className="muted">
            {request.days === 1 ? '1 day' : `${request.days} days`}
            {view.area ? ` · ${view.area.label}` : ''}
          </p>
        </header>

        {problem && (
          <div className="plan-problem" role="alert">
            <p>{problem}</p>
            <div className="plan-problem-actions">
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
              <button type="button" className="secondary" onClick={onBack}>
                Change the request
              </button>
            </div>
          </div>
        )}

        <CrewPanel view={view} />

        {view.trip ? (
          <p className="plan-ready">Your plan is ready. Opening it...</p>
        ) : (
          !problem && (
            <button type="button" className="secondary plan-cancel" onClick={onBack}>
              Cancel
            </button>
          )
        )}
      </aside>
    </div>
  )
}
