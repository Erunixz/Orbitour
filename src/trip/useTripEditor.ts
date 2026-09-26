import { useCallback, useRef, useState } from 'react'
import { ApiRequestError, patchDay, replanTrip, searchPlaces, undoTrip } from '../lib/api'
import type { DayEdit, PlaceResult } from '../lib/edits'
import type { Trip } from '../lib/types'

// Holds the trip being viewed and sends changes to the server one at a time.
// The server answers with the whole updated trip, which replaces ours.

export type TripEditor = {
  trip: Trip
  /** False for sample trips, which are read-only files. */
  editable: boolean
  busy: boolean
  error: string | null
  clearError: () => void
  editDay: (day: number, edits: DayEdit[]) => Promise<boolean>
  replan: (text: string) => Promise<boolean>
  undo: () => Promise<boolean>
  search: (q: string) => Promise<PlaceResult[] | null>
}

const message = (error: unknown) => (error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.')

export function useTripEditor(initial: Trip, editable: boolean): TripEditor {
  const [trip, setTrip] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against a second change starting before the first one returns.
  const running = useRef(false)

  const run = useCallback(
    async (change: () => Promise<Trip>): Promise<boolean> => {
      if (!editable || running.current) return false
      running.current = true
      setBusy(true)
      setError(null)
      try {
        setTrip(await change())
        return true
      } catch (e) {
        setError(message(e))
        return false
      } finally {
        running.current = false
        setBusy(false)
      }
    },
    [editable],
  )

  const editDay = useCallback((day: number, edits: DayEdit[]) => run(() => patchDay(trip.id, day, edits)), [run, trip.id])
  const replan = useCallback((text: string) => run(() => replanTrip(trip.id, text)), [run, trip.id])
  const undo = useCallback(() => run(() => undoTrip(trip.id)), [run, trip.id])
  const search = useCallback(
    async (q: string) => {
      setError(null)
      try {
        return await searchPlaces(q, trip.id)
      } catch (e) {
        setError(message(e))
        return null
      }
    },
    [trip.id],
  )
  const clearError = useCallback(() => setError(null), [])

  return { trip, editable, busy, error, clearError, editDay, replan, undo, search }
}
