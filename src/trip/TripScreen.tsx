import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../lib/types'
import { visitCount } from '../lib/stops'
import { useNarrowScreen } from '../map/hooks'
import { LazyMapView } from '../map/LazyMapView'
import type { Focus } from '../map/MapView'
import { dayColor } from './dayColors'
import { formatMinutes } from './format'
import { useFollowRoute } from './settings'
import { DataCredits, DayPanel, DayTabs, FollowRouteToggle, TripHeading } from './Sidebar'
import { StopCard } from './StopCard'
import { useTripEditor } from './useTripEditor'
import { backView, dayView, hashForView, nextView, sameView, stopView, viewFromHash, type View } from './tripNav'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

type Props = {
  trip: Trip
  /** A warning about the trip itself, such as "not saved". */
  notice?: string
  /** Saved trips can be edited; sample trips cannot. */
  editable?: boolean
}

export function TripScreen({ trip: initialTrip, notice, editable = false }: Props) {
  const editor = useTripEditor(initialTrip, editable)
  const trip = editor.trip
  const counts = useMemo(() => trip.days.map((d) => d.stops.length), [trip])
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash, counts))

  // After a change, stay on the same stop wherever it went, or on the day's overview if it is gone.
  const shownTrip = useRef(trip)
  useEffect(() => {
    const before = shownTrip.current
    shownTrip.current = trip
    if (before === trip) return
    setView((v) => {
      const id = v.stop === null ? null : before.days[v.day]?.stops[v.stop]?.id
      if (id) {
        for (const [d, day] of trip.days.entries()) {
          const i = day.stops.findIndex((s) => s.id === id)
          if (i !== -1) return { day: d, stop: i }
        }
      }
      return dayView(v.day, trip.days.map((d) => d.stops.length))
    })
  }, [trip])
  const [followRoute, setFollowRoute] = useFollowRoute()
  const narrow = useNarrowScreen()
  const [sheetOpen, setSheetOpen] = useState(false)

  const day = trip.days[view.day] ?? trip.days[0]!
  const stop = view.stop === null ? undefined : day.stops[view.stop]
  const focus: Focus = view.stop === null ? { kind: 'overview' } : { kind: 'stop', index: view.stop }

  // Keep the address in step so a reload opens the same place. No history entries.
  useEffect(() => {
    const hash = hashForView(view)
    if (hash === window.location.hash) return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  }, [view])

  const go = useCallback((to: View) => {
    setView((v) => (sameView(v, to) ? v : to))
    setSheetOpen(false)
  }, [])
  const next = useCallback(() => setView((v) => nextView(v, counts)), [counts])
  const back = useCallback(() => setView((v) => backView(v, counts)), [counts])
  const overview = useCallback(() => setView((v) => ({ day: v.day, stop: null })), [])
  const selectDay = useCallback((d: number) => setView((v) => (v.day === d ? v : dayView(d, counts))), [counts])
  const selectStop = useCallback((i: number) => go(stopView(view.day, i, counts)), [go, view.day, counts])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') back()
      else if (event.key === 'Escape') {
        if (sheetOpen) setSheetOpen(false)
        else overview()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, overview, sheetOpen])

  // Keep the camera framing clear of the bottom panel.
  const bottomRef = useRef<HTMLDivElement>(null)
  const [bottomInset, setBottomInset] = useState(0)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const measure = () => {
      const map = el.parentElement?.getBoundingClientRect()
      const bottom = map ? map.bottom : window.innerHeight
      setBottomInset(Math.max(0, Math.round(bottom - el.getBoundingClientRect().top)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const canBack = !sameView(backView(view, counts), view)
  const canNext = !sameView(nextView(view, counts), view)

  const dayPanel = (
    <DayPanel
      day={day}
      dayIndex={view.day}
      view={view}
      onOverview={() => go(dayView(view.day, counts))}
      onSelectStop={selectStop}
      editor={editor}
      dayCount={trip.days.length}
    />
  )
  const dayTabs = <DayTabs days={trip.days} current={view.day} onSelect={selectDay} />

  return (
    <div className="trip-screen">
      {!narrow && (
        <aside className="sidebar" aria-label="Trip plan">
          <TripHeading trip={trip} />
          {notice && (
            <p className="trip-notice" role="alert">
              {notice}
            </p>
          )}
          {dayTabs}
          <div className="sidebar-scroll">{dayPanel}</div>
          <footer className="sidebar-footer">
            <FollowRouteToggle value={followRoute} onChange={setFollowRoute} />
            <DataCredits />
          </footer>
        </aside>
      )}

      <main className="trip-main">
        <LazyMapView
          center={trip.center}
          dayIndex={view.day}
          stops={day.stops}
          legs={day.legs}
          followRoute={followRoute}
          color={dayColor(view.day)}
          focus={focus}
          onSelectStop={selectStop}
          bottomInsetPx={bottomInset}
        />

        {narrow && (
          <header className="trip-header">
            <TripHeading trip={trip} />
            {notice && (
              <p className="trip-notice" role="alert">
                {notice}
              </p>
            )}
          </header>
        )}

        <div className="trip-bottom" ref={bottomRef}>
          {!(narrow && sheetOpen) &&
            (stop && view.stop !== null ? (
              <StopCard
                key={stop.id}
                stop={stop}
                day={view.day}
                index={view.stop}
                stops={day.stops}
                previous={day.stops[view.stop - 1] ?? null}
                next={day.stops[view.stop + 1] ?? null}
                incomingLeg={day.legs[view.stop - 1] ?? null}
                nextLeg={day.legs[view.stop] ?? null}
              />
            ) : (
              <OverviewCard dayIndex={view.day} trip={trip} />
            ))}

          <nav className="trip-controls" aria-label="Stop navigation">
            <button type="button" onClick={back} disabled={!canBack}>
              Back
            </button>
            <button type="button" className="secondary" onClick={overview} disabled={view.stop === null}>
              Overview
            </button>
            <button type="button" onClick={next} disabled={!canNext}>
              Next
            </button>
          </nav>

          {narrow && (
            <section className={`sheet${sheetOpen ? ' is-open' : ''}`} aria-label="Trip plan">
              <div className="sheet-bar">
                {dayTabs}
                <button
                  type="button"
                  className="secondary sheet-toggle"
                  aria-expanded={sheetOpen}
                  aria-controls="sheet-panel"
                  onClick={() => setSheetOpen((o) => !o)}
                >
                  {sheetOpen ? 'Hide stops' : `Stops (${visitCount(day.stops)})`}
                </button>
              </div>
              {sheetOpen && (
                <div className="sheet-panel" id="sheet-panel">
                  {dayPanel}
                  <FollowRouteToggle value={followRoute} onChange={setFollowRoute} />
                  <DataCredits />
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function OverviewCard({ trip, dayIndex }: { trip: Trip; dayIndex: number }) {
  const day = trip.days[dayIndex]
  if (!day) return null
  const travel = day.legs.reduce((n, leg) => n + leg.minutes, 0)
  const first = day.stops[0]
  const last = day.stops[day.stops.length - 1]
  return (
    <article className="stop-card overview-card">
      <div className="stop-body">
        <h2>
          Day {dayIndex + 1} of {trip.days.length}
        </h2>
        {first && last ? (
          <p className="stop-time">
            {first.depart} to {last.depart} · {visitCount(day.stops)} stops · about {formatMinutes(travel)} getting around
          </p>
        ) : (
          <p className="muted">No stops on this day.</p>
        )}
        <p>Press Next or pick a stop to fly there. Use the arrow keys to move and Escape to come back here.</p>
      </div>
    </article>
  )
}
