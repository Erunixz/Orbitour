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
