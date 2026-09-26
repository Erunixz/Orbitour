import type { Stop } from './types.js'

// A day may begin at the traveller's starting point. It shows as "S" and is not
// counted as a place to visit, so the places are numbered 1, 2, 3 after it.

export const isStart = (stop: Pick<Stop, 'role'>) => stop.role === 'start'

/** Places to visit in a list of stops, not counting the starting point. */
export const visitCount = (stops: Pick<Stop, 'role'>[]) => stops.filter((s) => !isStart(s)).length

/** Visit number (1-based) of stop i, or null for the starting point. */
export function visitNumber(stops: Pick<Stop, 'role'>[], i: number): number | null {
  const stop = stops[i]
  if (!stop || isStart(stop)) return null
  return i + 1 - stops.slice(0, i).filter(isStart).length
}

/** Label for a pin or list row: "S" for the start, else the visit number. */
export function stopLabel(stops: Pick<Stop, 'role'>[], i: number): string {
  return String(visitNumber(stops, i) ?? 'S')
}
