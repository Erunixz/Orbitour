import type { Leg, StopKind, TravelMode } from '../lib/types'

export const kindLabels: Record<StopKind, string> = {
  sight: 'Sight',
  museum: 'Museum',
  park: 'Park',
  viewpoint: 'Viewpoint',
  market: 'Market',
  food: 'Food',
  lodging: 'Lodging',
  other: 'Place',
}

export const modeLabels: Record<TravelMode, string> = {
  walk: 'Walk',
  transit: 'Transit',
  drive: 'Drive',
  cycle: 'Cycle',
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Transit line names used by a leg, in order. */
export function transitLines(leg: Leg): string[] {
  return leg.steps?.flatMap((s) => (s.mode === 'transit' && s.line ? [s.line] : [])) ?? []
}

/** "Sat 3 Oct" for an ISO date, or null when there is none. */
export function formatDate(date: string | undefined): string | null {
  if (!date) return null
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
