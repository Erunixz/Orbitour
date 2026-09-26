import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { isStart, stopLabel, visitCount } from '../lib/stops'
import type { Day, Leg, Trip } from '../lib/types'
import { usePrefersReducedMotion } from '../map/hooks'
import { dayColor } from './dayColors'
import { formatDate, formatDistance, formatMinutes, kindLabels, modeLabels, transitLines } from './format'
import { AddPlace, ChangeBanner, EditError, ReplanBox, StopControls } from './EditTools'
import type { View } from './tripNav'
import type { TripEditor } from './useTripEditor'

// The trip's day-by-day plan: day tabs, then the stops of the chosen day with
// the travel between them. The desktop sidebar and the mobile sheet share these parts.

const colorVar = (day: number) => ({ '--day-color': dayColor(day) }) as CSSProperties

export function TripHeading({ trip }: { trip: Trip }) {
  const stopCount = trip.days.reduce((n, d) => n + visitCount(d.stops), 0)
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
  /** Present for saved trips: turns on editing. */
  editor?: TripEditor
  dayCount: number
}

export function DayPanel({ day, dayIndex, view, onOverview, onSelectStop, editor, dayCount }: DayPanelProps) {
  const reducedMotion = usePrefersReducedMotion()
  const currentRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // The ref is read on drop: the state may not have re-rendered yet when events come quickly.
  const dragged = useRef<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const canEdit = Boolean(editor?.editable) && editing
  const firstSlot = day.stops[0] && isStart(day.stops[0]) ? 1 : 0

  // Drag a place onto another row to put it there (desktop). Arrow buttons do the same everywhere.
  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault()
    const id = dragged.current
    dragged.current = null
    setDragging(null)
    setDropAt(null)
    const from = day.stops.findIndex((s) => s.id === id)
    if (!editor || !id || from === -1 || index === from || index < firstSlot) return
    void editor.editDay(dayIndex, [{ op: 'move', stopId: id, toIndex: index }])
  }
  const isHere = view.day === dayIndex
  const current = isHere ? view.stop : null
  const first = day.stops[0]
  const last = day.stops[day.stops.length - 1]

  // Keep the focused row visible as the user moves with Next and Back.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [current, dayIndex, reducedMotion])

  return (
    <div className={`day-panel${editor?.busy ? ' is-busy' : ''}`} style={colorVar(dayIndex)} aria-busy={editor?.busy}>
      {editor && (
        <>
          <ChangeBanner editor={editor} />
          <EditError editor={editor} />
        </>
      )}
      {editor?.editable && day.stops.length > 0 && (
        <div className="day-panel-tools">
          <button type="button" className="secondary edit-toggle" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done editing' : 'Edit stops'}
          </button>
        </div>
      )}
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
                  {first?.arrive} to {last?.depart} · {visitCount(day.stops)} stops
                </span>
              </span>
            </button>
          </li>
          {day.stops.map((stop, i) => {
            const leg = day.legs[i]
            const isCurrent = current === i
            const movable = canEdit && !isStart(stop)
            return (
              <li
                key={stop.id}
                className={`${dragging === stop.id ? 'is-dragging' : ''}${dropAt === i ? ' is-drop-target' : ''}`}
                draggable={movable}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  dragged.current = stop.id
                  setDragging(stop.id)
                }}
                onDragEnd={() => {
                  dragged.current = null
                  setDragging(null)
                  setDropAt(null)
                }}
                onDragOver={(e) => {
                  if (!dragged.current || i < firstSlot) return
                  e.preventDefault()
                  setDropAt(i)
                }}
                onDrop={(e) => onDrop(e, i)}
              >
                <button
                  ref={isCurrent ? currentRef : undefined}
                  type="button"
                  className="stop-row"
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => onSelectStop(i)}
                >
                  <span className={`stop-num${isStart(stop) ? ' is-start' : ''}`} aria-hidden="true">
                    {stopLabel(day.stops, i)}
                  </span>
                  <span className="stop-row-main">
                    <span className="stop-row-name">{stop.name}</span>
                    <span className="stop-row-sub">
                      {isStart(stop) ? 'Start point' : kindLabels[stop.kind]}
                      {stop.mustSee && ' · Must see'}
                    </span>
                  </span>
                  <span className="stop-row-time">
                    {isStart(stop) ? (
                      <span>{stop.depart}</span>
                    ) : (
                      <>
                        <span>{stop.arrive}</span>
                        <span className="muted">{stop.depart}</span>
                      </>
                    )}
                  </span>
                </button>
                {movable && editor && (
                  <StopControls
                    editor={editor}
                    day={dayIndex}
                    stop={stop}
                    index={i}
                    first={firstSlot}
                    last={day.stops.length - 1}
                    days={dayCount}
                  />
                )}
                {leg && i < day.stops.length - 1 && <LegRow leg={leg} />}
              </li>
            )
          })}
        </ol>
      )}

      {editor?.editable && (
        <div className="edit-tools">
          <AddPlace editor={editor} day={dayIndex} />
          <ReplanBox editor={editor} />
        </div>
      )}
      {editor && !editor.editable && <p className="muted edit-note">This is a sample trip, so it cannot be changed.</p>}
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
