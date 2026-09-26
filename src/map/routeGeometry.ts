import type { Vector3 } from 'three'
import { decodePolyline } from '../lib/polyline'
import { medianSmooth, resamplePath } from '../lib/routePath'
import type { Leg } from '../lib/types'
import type { SceneFrame } from './sceneFrame'
import type { Heights, SamplePoint } from './useGroundHeights'

/** Sample spacing along routes. Also sets how many rays we cast per leg. */
const SPACING_M = 25
const MAX_SAMPLES_PER_LEG = 150
/** Lift above the surface so the line does not flicker into the street. */
const LIFT_M = 2.5

export type RoutePath = { key: string; leg: Leg; samples: SamplePoint[] }

export const legKey = (leg: Leg) => `${leg.fromId}>${leg.toId}`

export function routePaths(legs: Leg[]): RoutePath[] {
  return legs.map((leg) => {
    const key = legKey(leg)
    const points = resamplePath(decodePolyline(leg.polyline), SPACING_M, MAX_SAMPLES_PER_LEG)
    return { key, leg, samples: points.map((p, i) => ({ ...p, key: `${key}:${i}` })) }
  })
}

/**
 * Heights for every sample. Gaps (not measured yet) are filled by straight
 * interpolation between measured neighbours, or `base` when nothing is known.
 */
export function fillHeights(samples: SamplePoint[], heights: Heights, base: number): number[] {
  const raw = samples.map((s) => heights[s.key])
  const known = raw.flatMap((h, i) => (h === undefined ? [] : [i]))
  if (known.length === 0) return raw.map(() => base)

  return raw.map((h, i) => {
    if (h !== undefined) return h
    let before = -1
    let after = -1
    for (const k of known) {
      if (k < i) before = k
      else if (after === -1) after = k
    }
    if (before === -1) return raw[after]!
    if (after === -1) return raw[before]!
    const t = (i - before) / (after - before)
    return raw[before]! + (raw[after]! - raw[before]!) * t
  })
}

/** Scene points for a route, draped on the measured surface. */
export function routeLinePoints(path: RoutePath, heights: Heights, base: number, frame: SceneFrame): Vector3[] {
  const filled = medianSmooth(fillHeights(path.samples, heights, base), 2)
  return path.samples.map((s, i) => frame.toScene(s, (filled[i] ?? base) + LIFT_M))
}
