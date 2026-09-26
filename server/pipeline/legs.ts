import { distanceM } from '../../src/lib/geo.js'
import { encodePolyline } from '../../src/lib/polyline.js'
import type { Budget, LatLon, Leg, TravelMode } from '../../src/lib/types.js'
import { cached, cacheKey, DAY, type Cache } from '../cache.js'
import type { RouteResult, RoutesClient } from '../upstream/googleRoutes.js'

// Builds the legs between consecutive stops. Real routes come from Google; when
// that is not possible each leg becomes an honest straight-line estimate.

/** Typical door-to-door speeds in km/h. */
const SPEED_KMH: Record<TravelMode, number> = { walk: 4.5, cycle: 14, drive: 22, transit: 18 }
/** Streets are longer than the straight line. */
const DETOUR: Record<TravelMode, number> = { walk: 1.3, cycle: 1.3, drive: 1.4, transit: 1.4 }
/** Waiting and walking to the stop or car park. */
const OVERHEAD_MIN: Record<TravelMode, number> = { walk: 0, cycle: 2, drive: 5, transit: 8 }

const ROUTE_TTL = DAY

/** Picks a mode for one leg. Explicit modes are kept except for very short hops. */
export function chooseMode(straightM: number, requested: TravelMode | 'auto', budget: Budget): TravelMode {
  if (requested !== 'auto') {
    if ((requested === 'transit' || requested === 'drive') && straightM < 800) return 'walk'
    return requested
  }
  if (straightM <= 1500) return 'walk'
  if (budget === 'free') return straightM <= 3000 ? 'walk' : 'transit'
  if (straightM <= 2000) return 'walk'
  if (budget === 'any' && straightM > 8000) return 'drive'
  return 'transit'
}

/** Straight-line leg with a detour factor and typical speed, marked as estimated. */
export function estimateLeg(from: LatLon & { id: string }, to: LatLon & { id: string }, mode: TravelMode): Leg {
  const meters = Math.round(distanceM(from, to) * DETOUR[mode])
  const minutes = Math.max(1, Math.round((meters / 1000 / SPEED_KMH[mode]) * 60 + OVERHEAD_MIN[mode]))
  return {
    fromId: from.id,
    toId: to.id,
    mode,
    minutes,
    meters,
    polyline: encodePolyline([from, to]),
    estimated: true,
  }
}

function legFromRoute(from: { id: string }, to: { id: string }, mode: TravelMode, route: RouteResult): Leg {
  const leg: Leg = {
    fromId: from.id,
    toId: to.id,
    // A transit request can come back as "just walk". Say so.
    mode: mode === 'transit' && route.walkOnly ? 'walk' : mode,
    minutes: Math.max(1, Math.round(route.seconds / 60)),
    meters: Math.round(route.meters),
    polyline: route.polyline,
    estimated: false,
  }
  if (route.steps && !route.walkOnly) leg.steps = route.steps
  return leg
}

export type LegDeps = {
  routes: RoutesClient | null
  cache: Cache
  log?: (message: string) => void
}

type StopPoint = LatLon & { id: string }

/** One leg, from Google when possible. The reason is set when we fell back. */
export async function buildLeg(
  from: StopPoint,
  to: StopPoint,
  mode: TravelMode,
  deps: LegDeps,
): Promise<{ leg: Leg; fallbackReason?: string }> {
  if (!deps.routes) return { leg: estimateLeg(from, to, mode), fallbackReason: 'no_key' }
  const routes = deps.routes
  const key = cacheKey('route', mode, from.lat, from.lon, to.lat, to.lon)
  try {
    // Cache "no route" too (as null), so we do not ask again for a day.
    const route = await cached<RouteResult | null>(deps.cache, key, ROUTE_TTL, () => routes.computeRoute(from, to, mode))
    if (route) return { leg: legFromRoute(from, to, mode, route) }
    return { leg: estimateLeg(from, to, mode), fallbackReason: 'no_route' }
  } catch (error) {
    deps.log?.(`[routes] fallback for ${mode} leg: ${error instanceof Error ? error.message : 'unknown error'}`)
    return { leg: estimateLeg(from, to, mode), fallbackReason: 'error' }
  }
}

/** Legs between consecutive stops, in order. Runs a few requests at a time. */
export async function buildLegs(
  stops: StopPoint[],
  requested: TravelMode | 'auto',
  budget: Budget,
  deps: LegDeps,
): Promise<{ legs: Leg[]; estimatedCount: number }> {
  const pairs = stops.slice(1).map((to, i) => ({ from: stops[i]!, to }))
  const results: Leg[] = new Array(pairs.length)
  let estimatedCount = 0
  const concurrency = 3
  let next = 0

  async function worker() {
    while (next < pairs.length) {
      const index = next++
      const { from, to } = pairs[index]!
      const mode = chooseMode(distanceM(from, to), requested, budget)
      const { leg } = await buildLeg(from, to, mode, deps)
      if (leg.estimated) estimatedCount++
      results[index] = leg
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker))
  return { legs: results, estimatedCount }
}
