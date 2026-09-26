import { useEffect, useRef, type CSSProperties } from 'react'
import type { Day, Leg, Trip } from '../lib/types'
import { usePrefersReducedMotion } from '../map/hooks'
import { dayColor } from './dayColors'
import { formatDate, formatDistance, formatMinutes, kindLabels, modeLabels, transitLines } from './format'
import type { View } from './tripNav'

// The trip's day-by-day plan: day tabs, then the stops of the chosen day with
// the travel between them. The desktop sidebar and the mobile sheet share these parts.

const colorVar = (day: number) => ({ '--day-color': dayColor(day) }) as CSSProperties

export function TripHeading({ trip }: { trip: Trip }) {
  const stopCount = trip.days.reduce((n, d) => n + d.stops.length, 0)
  return (
    <div className="trip-heading">
      <h1>{trip.title}</h1>
      <p className="muted">
        {trip.days.length === 1 ? '1 day' : `${trip.days.length} days`} · {stopCount} stops
      </p>
      {trip.lodging && <p className="muted">Staying at {trip.lodging.name}</p>}
      <a className="new-trip" href="/">
        New trip
      </a>
    </div>
  )
}

type DayTabsProps = { days: Day[]; current: number; onSelect: (day: number) => void }

export function DayTabs({ days, current, onSelect }: DayTabsProps) {
  if (days.length < 2) return null
  return (
    <div className="day-tabs" role="group" aria-label="Days">
      {days.map((day, i) => {
        const date = formatDate(day.date)
        return (
          <button
            key={day.index}
            type="button"
            className="day-tab"
            style={colorVar(i)}
            aria-pressed={i === current}
            onClick={() => onSelect(i)}
          >
            <span className="day-dot" aria-hidden="true" />
            Day {i + 1}
            {date && <span className="day-tab-date">{date}</span>}
          </button>
        )
      })}
    </div>
  )
}

type DayPanelProps = {
  day: Day
  dayIndex: number
  view: View
  onOverview: () => void
  onSelectStop: (index: number) => void
}

export function DayPanel({ day, dayIndex, view, onOverview, onSelectStop }: DayPanelProps) {
  const reducedMotion = usePrefersReducedMotion()
  const currentRef = useRef<HTMLButtonElement>(null)
  const isHere = view.day === dayIndex
  const current = isHere ? view.stop : null
  const first = day.stops[0]
  const last = day.stops[day.stops.length - 1]

  // Keep the focused row visible as the user moves with Next and Back.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [current, dayIndex, reducedMotion])

  return (
    <div className="day-panel" style={colorVar(dayIndex)}>
      {day.warnings.length > 0 && (
        <ul className="day-warnings">
          {day.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {day.stops.length === 0 ? (
        <p className="muted">No stops on this day.</p>
      ) : (
        <ol className="stop-list">
          <li>
            <button
              ref={isHere && current === null ? currentRef : undefined}
              type="button"
              className="stop-row overview-row"
              aria-current={isHere && current === null ? 'step' : undefined}
              onClick={onOverview}
            >
              <span className="stop-num overview-num" aria-hidden="true" />
              <span className="stop-row-main">
                <span className="stop-row-name">Day {dayIndex + 1} overview</span>
                <span className="stop-row-sub">
                  {first?.arrive} to {last?.depart} · {day.stops.length} stops
                </span>
              </span>
            </button>
          </li>
          {day.stops.map((stop, i) => {
            const leg = day.legs[i]
            const isCurrent = current === i
            return (
              <li key={stop.id}>
                <button
                  ref={isCurrent ? currentRef : undefined}
                  type="button"
                  className="stop-row"
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => onSelectStop(i)}
                >
                  <span className="stop-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="stop-row-main">
                    <span className="stop-row-name">{stop.name}</span>
                    <span className="stop-row-sub">
                      {kindLabels[stop.kind]}
                      {stop.mustSee && ' · Must see'}
                    </span>
                  </span>
                  <span className="stop-row-time">
                    <span>{stop.arrive}</span>
                    <span className="muted">{stop.depart}</span>
                  </span>
                </button>
                {leg && i < day.stops.length - 1 && <LegRow leg={leg} />}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function LegRow({ leg }: { leg: Leg }) {
  const lines = transitLines(leg)
  return (
    <p className="leg-row">
      {modeLabels[leg.mode]} {formatMinutes(leg.minutes)} · {formatDistance(leg.meters)}
      {lines.length > 0 && <> · {lines.join(', ')}</>}
      {leg.estimated && (
        <span className="leg-estimated" title="Routing was not available, so this is a straight-line estimate.">
          estimated
        </span>
      )}
    </p>
  )
}

export function FollowRouteToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Fly along routes
    </label>
  )
}
