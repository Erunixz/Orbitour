import type { LatLon, TravelMode } from './types.js'

const travelModes: Record<TravelMode, string> = {
  walk: 'walking',
  transit: 'transit',
  drive: 'driving',
  cycle: 'bicycling',
}

/** Google Maps directions link. Origin is optional; without it Maps uses the user's location. */
export function directionsUrl(destination: LatLon, origin?: LatLon, mode?: TravelMode): string {
  const params = new URLSearchParams({ api: '1', destination: `${destination.lat},${destination.lon}` })
  if (origin) params.set('origin', `${origin.lat},${origin.lon}`)
  if (mode) params.set('travelmode', travelModes[mode])
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Google Maps allows this many stops between the start and the end of a link. */
export const MAX_WAYPOINTS = 9

/**
 * One Google Maps link for a whole day: the first stop to the last, through the
 * ones between. Days with more stops keep an even spread of them as waypoints.
 */
export function dayDirectionsUrl(stops: LatLon[], mode?: TravelMode): string | null {
  if (stops.length < 2) return null
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  let middle = stops.slice(1, -1)
  if (middle.length > MAX_WAYPOINTS) {
    const step = middle.length / MAX_WAYPOINTS
    middle = Array.from({ length: MAX_WAYPOINTS }, (_, i) => middle[Math.floor(i * step)]!)
  }
  const at = (p: LatLon) => `${p.lat},${p.lon}`
  const params = new URLSearchParams({ api: '1', origin: at(first), destination: at(last) })
  if (middle.length > 0) params.set('waypoints', middle.map(at).join('|'))
  if (mode) params.set('travelmode', travelModes[mode])
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
