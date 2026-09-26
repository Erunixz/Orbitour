import { useId, useState, type FormEvent } from 'react'
import type { PlaceResult } from '../lib/edits'
import type { Stop } from '../lib/types'
import type { TripEditor } from './useTripEditor'

// Controls for changing a saved trip: what changed last (with undo), per-stop
// edits, adding a place from search, and typed changes.

export function ChangeBanner({ editor }: { editor: TripEditor }) {
  const change = editor.trip.lastChange
  const [hidden, setHidden] = useState<string | null>(null)
  if (!change || hidden === change.at) return null
  return (
    <section className="change-banner" aria-live="polite">
      <div className="change-head">
        <strong>Last change</strong>
        <button type="button" className="link-button" onClick={() => setHidden(change.at)} aria-label="Hide the last change">
          Hide
        </button>
      </div>
      <ul>
        {change.summary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {change.undoable && editor.editable && (
        <button type="button" className="secondary" onClick={() => void editor.undo()} disabled={editor.busy}>
          Undo
        </button>
      )}
    </section>
  )
}

export function EditError({ editor }: { editor: TripEditor }) {
  if (!editor.error) return null
  return (
    <p className="edit-error" role="alert">
      {editor.error}{' '}
      <button type="button" className="link-button" onClick={editor.clearError}>
        Dismiss
      </button>
    </p>
  )
}

const VISIT_CHOICES = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240]

type StopControlsProps = {
  editor: TripEditor
  day: number
  stop: Stop
  index: number
  /** Positions a place may take in this day (after the starting point). */
  first: number
  last: number
  days: number
}

/** Up, down, visit length, other day, remove: shown under each place in edit mode. */
export function StopControls({ editor, day, stop, index, first, last, days }: StopControlsProps) {
  const disabled = editor.busy
  const choices = VISIT_CHOICES.includes(stop.visitMin) ? VISIT_CHOICES : [...VISIT_CHOICES, stop.visitMin].sort((a, b) => a - b)
  return (
    <div className="stop-controls">
      <button
        type="button"
        className="icon-button"
        onClick={() => void editor.editDay(day, [{ op: 'move', stopId: stop.id, toIndex: index - 1 }])}
        disabled={disabled || index <= first}
        aria-label={`Move ${stop.name} earlier`}
        title="Earlier"
      >
        ↑
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => void editor.editDay(day, [{ op: 'move', stopId: stop.id, toIndex: index + 1 }])}
        disabled={disabled || index >= last}
        aria-label={`Move ${stop.name} later`}
        title="Later"
      >
        ↓
      </button>
      <select
        aria-label={`Time at ${stop.name}`}
        value={stop.visitMin}
        disabled={disabled}
        onChange={(e) => void editor.editDay(day, [{ op: 'setVisit', stopId: stop.id, minutes: Number(e.target.value) }])}
      >
        {choices.map((m) => (
          <option key={m} value={m}>
            {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`}
          </option>
        ))}
      </select>
      {days > 1 && (
        <select
          aria-label={`Move ${stop.name} to another day`}
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && void editor.editDay(day, [{ op: 'moveToDay', stopId: stop.id, toDay: Number(e.target.value) }])}
        >
          <option value="">Move to...</option>
          {Array.from({ length: days }, (_, d) => d)
            .filter((d) => d !== day)
            .map((d) => (
              <option key={d} value={d}>
                Day {d + 1}
              </option>
            ))}
        </select>
      )}
      <button
        type="button"
        className="icon-button danger-text"
        onClick={() => void editor.editDay(day, [{ op: 'remove', stopId: stop.id }])}
        disabled={disabled}
        aria-label={`Remove ${stop.name}`}
        title="Remove"
      >
        ✕
      </button>
    </div>
  )
}

/** Search for a place and add it to the day. Searches on submit only. */
export function AddPlace({ editor, day }: { editor: TripEditor; day: number }) {
  const id = useId()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (q.trim().length < 2) return
    setSearching(true)
    setResults(await editor.search(q.trim()))
    setSearching(false)
  }

  const add = async (place: PlaceResult) => {
    if (await editor.editDay(day, [{ op: 'add', place }])) {
      setResults(null)
      setQ('')
    }
  }

  return (
    <form className="edit-tool" onSubmit={submit}>
      <label htmlFor={id}>Add a place to day {day + 1}</label>
      <div className="edit-row">
        <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example Botanical Garden" />
        <button type="submit" className="secondary" disabled={searching || q.trim().length < 2}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>
      {results && results.length === 0 && <p className="muted">Nothing found near this trip. Try another name.</p>}
      {results && results.length > 0 && (
        <ul className="place-results">
          {results.map((place) => (
            <li key={`${place.lat},${place.lon},${place.name}`}>
              <span className="place-text">
                <span className="place-name">{place.name}</span>
                <span className="muted">{place.label}</span>
              </span>
              <button type="button" onClick={() => void add(place)} disabled={editor.busy}>
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

/** A typed change for the whole trip, handled by the fast model. */
export function ReplanBox({ editor }: { editor: TripEditor }) {
  const id = useId()
  const [text, setText] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (text.trim().length < 3) return
    if (await editor.replan(text.trim())) setText('')
  }
  return (
    <form className="edit-tool" onSubmit={submit}>
      <label htmlFor={id}>Describe a change</label>
      <textarea
        id={id}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="For example: drop the museum, slower morning"
        maxLength={500}
      />
      <button type="submit" disabled={editor.busy || text.trim().length < 3}>
        {editor.busy ? 'Working...' : 'Change the plan'}
      </button>
    </form>
  )
}
