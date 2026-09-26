import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, fetchLegs } from '../lib/api'
import type { Budget, Leg, Stop, TravelMode } from '../lib/types'

export type LegsState =
  | { kind: 'loading' }
  | { kind: 'ready'; legs: Leg[] }
  | { kind: 'error'; message: string }

/** Asks the server for the legs between consecutive stops. */
export function useLegs(stops: Stop[], mode: TravelMode | 'auto', budget: Budget) {
  const [state, setState] = useState<LegsState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (stops.length < 2) {
      setState({ kind: 'ready', legs: [] })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetchLegs({ stops: stops.map(({ id, lat, lon }) => ({ id, lat, lon })), mode, budget }, controller.signal)
      .then(({ legs }) => setState({ kind: 'ready', legs }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof ApiRequestError ? error.message : 'Could not get travel times.'
        setState({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [stops, mode, budget, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
