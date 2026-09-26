import type { LatLon } from './types.js'

export const EARTH_RADIUS_M = 6_371_008.8

export const toRad = (deg: number) => (deg * Math.PI) / 180
export const toDeg = (rad: number) => (rad * 180) / Math.PI

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial compass bearing from a to b, degrees clockwise from north, 0 to 360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Average of the points. Fine for city-sized areas away from the antimeridian. */
export function centroid(points: LatLon[]): LatLon {
  if (points.length === 0) throw new Error('centroid needs at least one point')
  let lat = 0
  let lon = 0
  for (const p of points) {
    lat += p.lat
    lon += p.lon
  }
  return { lat: lat / points.length, lon: lon / points.length }
}
