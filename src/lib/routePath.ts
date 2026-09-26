import { distanceM } from './geo.js'
import type { LatLon } from './types.js'

// Helpers for turning a route polyline into points we can drape on the ground.

/** Total length of a path in metres. */
export function pathLengthM(points: LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!)
  return total
}

/** Point `t` of the way (0..1) from a to b. Fine for the short segments of a route. */
function lerpLatLon(a: LatLon, b: LatLon, t: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
}

/**
 * Points spaced about `spacingM` apart along the path, always keeping the first and
 * last point. Spacing grows if needed so the result has at most `maxPoints` points.
 */
export function resamplePath(points: LatLon[], spacingM: number, maxPoints = 400): LatLon[] {
  if (points.length < 2) return points.slice()
  const total = pathLengthM(points)
  if (total === 0) return [points[0]!, points[points.length - 1]!]
  const spacing = Math.max(spacingM, total / Math.max(1, maxPoints - 1))
  const count = Math.max(1, Math.round(total / spacing))
  const step = total / count

  const out: LatLon[] = [points[0]!]
  let segment = 1
  let segStart = 0
  let segLength = distanceM(points[0]!, points[1]!)
  for (let i = 1; i < count; i++) {
    const at = i * step
    while (segStart + segLength < at && segment < points.length - 1) {
      segStart += segLength
      segment++
      segLength = distanceM(points[segment - 1]!, points[segment]!)
    }
    const t = segLength > 0 ? (at - segStart) / segLength : 0
    out.push(lerpLatLon(points[segment - 1]!, points[segment]!, Math.min(1, Math.max(0, t))))
  }
  out.push(points[points.length - 1]!)
  return out
}

/** Point about `backM` before the end of the path, for "direction of arrival". */
export function pointBeforeEnd(points: LatLon[], backM: number): LatLon | null {
  if (points.length < 2) return null
  let remaining = backM
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1]!
    const b = points[i]!
    const d = distanceM(a, b)
    if (d >= remaining) return lerpLatLon(b, a, d > 0 ? remaining / d : 0)
    remaining -= d
  }
  return points[0]!
}

/**
 * Median filter. Removes single spikes from raycast heights, such as a ray that
 * hit a tree or a bus instead of the street.
 */
export function medianSmooth(values: number[], radius = 2): number[] {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b)
    return window[Math.floor(window.length / 2)]!
  })
}
