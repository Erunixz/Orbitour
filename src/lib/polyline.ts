import type { LatLon } from './types.js'

// Google encoded polyline format, precision 1e5.
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm

export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = []
  let index = 0
  let lat = 0
  let lon = 0

  const next = (): number | null => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded.length) return null
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    const dLat = next()
    const dLon = next()
    if (dLat === null || dLon === null) break
    lat += dLat
    lon += dLon
    points.push({ lat: lat / 1e5, lon: lon / 1e5 })
  }
  return points
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

export function encodePolyline(points: LatLon[]): string {
  let out = ''
  let prevLat = 0
  let prevLon = 0
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5)
    const lon = Math.round(p.lon * 1e5)
    out += encodeValue(lat - prevLat) + encodeValue(lon - prevLon)
    prevLat = lat
    prevLon = lon
  }
  return out
}
