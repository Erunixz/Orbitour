import { distanceM } from '../../src/lib/geo.js'
import type { LatLon, Leg, TravelMode, TripRequest } from '../../src/lib/types.js'
import { cached, cacheKey, DAY } from '../cache.js'
import { stage, type Emit, type PipelineDeps, type PlannedStop } from './context.js'
import { buildLeg, chooseMode, estimateLeg } from './legs.js'
import { bestOrder } from './order.js'

// Router (code): travel times between a day's stops, the best visiting order,
// then each leg's route. Falls back to honest straight-line estimates.

/** Google allows 100 matrix elements for transit, so 10 points at most. */
const MATRIX_MAX_POINTS = 10

export const legKey = (fromId: string, toId: string) => `${fromId}>${toId}`

/** Mode for ordering: the requested one, or walking (it tracks distance well) when auto. */
const matrixMode = (request: TripRequest): TravelMode => (request.mode === 'auto' ? 'walk' : request.mode)

export function estimatedMatrix(points: LatLon[], request: TripRequest): number[][] {
  return points.map((a, i) =>
    points.map((b, j) => {
      if (i === j) return 0
      const mode = chooseMode(distanceM(a, b), request.mode, request.budget)
      return estimateLeg({ ...a, id: 'a' }, { ...b, id: 'b' }, mode).minutes
    }),
  )
}

/** Minutes between every pair of points. Google when possible, gaps filled with estimates. */
export async function travelMatrix(points: LatLon[], request: TripRequest, deps: PipelineDeps): Promise<number[][]> {
  const estimate = estimatedMatrix(points, request)
  if (!deps.matrix || points.length < 2 || points.length > MATRIX_MAX_POINTS) return estimate
  const matrix = deps.matrix
  const mode = matrixMode(request)
  const key = cacheKey('matrix', mode, points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';'))
  try {
    const grid = await cached(deps.cache, key, DAY, () => matrix.computeMatrix(points, mode))
    return grid.map((row, i) => row.map((v, j) => v ?? estimate[i]![j]!))
  } catch (error) {
    deps.log(`[router] matrix fallback: ${error instanceof Error ? error.message : 'unknown error'}`)
    return estimate
  }
}

/** Stops of one day in the best order, starting near `start` when given. */
export async function orderDay(
  stops: PlannedStop[],
  start: LatLon | null,
  request: TripRequest,
  deps: PipelineDeps,
): Promise<PlannedStop[]> {
  if (stops.length < 2) return stops.slice()
  const points: LatLon[] = start ? [start, ...stops] : stops
  const cost = await travelMatrix(points, request, deps)
  const offset = start ? 1 : 0
  const nodes = stops.map((_, i) => i + offset)
  return bestOrder(nodes, cost, start ? 0 : null).map((n) => stops[n - offset]!)
}

/** Legs between consecutive stops. Legs already in `reuse` are kept as they are. */
export async function legsFor(
  stops: PlannedStop[],
  request: TripRequest,
  deps: PipelineDeps,
  reuse: Map<string, Leg> = new Map(),
): Promise<Leg[]> {
  const legs: Leg[] = []
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!
    const to = stops[i]!
    const known = reuse.get(legKey(from.id, to.id))
    if (known) {
      legs.push(known)
      continue
    }
    const mode = chooseMode(distanceM(from, to), request.mode, request.budget)
    const { leg } = await buildLeg(from, to, mode, { routes: deps.routes, cache: deps.cache, log: deps.log })
    legs.push(leg)
  }
  return legs
}

export type RoutedDay = { stops: PlannedStop[]; legs: Leg[] }

export async function runRouter(
  days: PlannedStop[][],
  request: TripRequest,
  start: LatLon | null,
  deps: PipelineDeps,
  emit: Emit,
): Promise<RoutedDay[]> {
  const s = stage(emit, 'router')
  s.start(deps.routes ? 'Ordering stops and routing on real streets...' : 'Ordering stops. No routes key, so travel times are estimates.')
  const out: RoutedDay[] = []
  for (const [i, stops] of days.entries()) {
    const ordered = await orderDay(stops, start, request, deps)
    const legs = await legsFor(ordered, request, deps)
    out.push({ stops: ordered, legs })
    s.progress(`Day ${i + 1}: ${ordered.length} stops, ${legs.reduce((n, l) => n + l.minutes, 0)} min of travel.`)
  }
  const estimated = out.flatMap((d) => d.legs).filter((l) => l.estimated).length
  s.done(estimated > 0 ? `Routed every day. ${estimated} legs are straight-line estimates.` : 'Routed every day on real streets.', {
    days: out.map((d) => ({ stops: d.stops.map(({ id, name, lat, lon }) => ({ id, name, lat, lon })), legs: d.legs })),
  })
  return out
}
