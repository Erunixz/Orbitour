import { z } from 'zod'
import type { LatLon, LegStep, TravelMode } from '../../src/lib/types.js'
import { fetchWithRetry, type RetryOptions } from './fetchRetry.js'

// Google Routes API, computeRoutes. Every request sends a field mask so we only
// pay for and receive the fields we use.
// https://developers.google.com/maps/documentation/routes/compute_route_directions

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export const ROUTE_FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.name',
].join(',')

const googleModes: Record<TravelMode, string> = {
  walk: 'WALK',
  cycle: 'BICYCLE',
  drive: 'DRIVE',
  transit: 'TRANSIT',
}

const stepSchema = z.object({
  travelMode: z.string().optional(),
  distanceMeters: z.number().optional(),
  staticDuration: z.string().optional(),
  transitDetails: z
    .object({
      transitLine: z.object({ nameShort: z.string().optional(), name: z.string().optional() }).optional(),
    })
    .optional(),
})

const responseSchema = z.object({
  routes: z
    .array(
      z.object({
        duration: z.string().optional(),
        distanceMeters: z.number().optional(),
        polyline: z.object({ encodedPolyline: z.string() }).optional(),
        legs: z.array(z.object({ steps: z.array(stepSchema).optional() })).optional(),
      }),
    )
    .optional(),
})

export type RouteResult = {
  meters: number
  seconds: number
  polyline: string
  /** Walk and transit parts, for transit routes only. */
  steps?: LegStep[]
  /** True when a transit request came back as walking only. */
  walkOnly?: boolean
}

/** "165s" or "12.5s" to seconds. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value)
  return match ? Number(match[1]) : null
}

type Step = z.infer<typeof stepSchema>

/** Collapses Google's many small steps into runs of walking and riding one line. */
export function summarizeSteps(steps: Step[]): LegStep[] {
  const out: LegStep[] = []
  for (const step of steps) {
    const mode: LegStep['mode'] = step.travelMode === 'TRANSIT' ? 'transit' : 'walk'
    const line = step.transitDetails?.transitLine?.nameShort ?? step.transitDetails?.transitLine?.name
    const meters = step.distanceMeters ?? 0
    const minutes = (parseDuration(step.staticDuration) ?? 0) / 60
    const last = out[out.length - 1]
    if (last && last.mode === mode && last.line === line) {
      last.meters += meters
      last.minutes += minutes
    } else {
      out.push({ mode, meters, minutes, ...(line ? { line } : {}) })
    }
  }
  return out.map((s) => ({ ...s, minutes: Math.max(1, Math.round(s.minutes)), meters: Math.round(s.meters) }))
}

export type RoutesClient = {
  /** A route between two points, or null when Google finds none. Throws UpstreamError on failure. */
  computeRoute(from: LatLon, to: LatLon, mode: TravelMode): Promise<RouteResult | null>
}

const waypoint = (p: LatLon) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } })

export function createRoutesClient(apiKey: string, retry: Partial<RetryOptions> = {}): RoutesClient {
  return {
    async computeRoute(from, to, mode) {
      const body: Record<string, unknown> = {
        origin: waypoint(from),
        destination: waypoint(to),
        travelMode: googleModes[mode],
        polylineEncoding: 'ENCODED_POLYLINE',
        languageCode: 'en',
        units: 'METRIC',
      }
      // No routingPreference: it only applies to driving, and leaving it out gives
      // the cheaper traffic-unaware route.

      const res = await fetchWithRetry(
        COMPUTE_ROUTES_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': ROUTE_FIELD_MASK,
          },
          body: JSON.stringify(body),
        },
        { ...retry, service: 'routes' },
      )

      const parsed = responseSchema.safeParse(await res.json())
      if (!parsed.success) return null
      const route = parsed.data.routes?.[0]
      const seconds = parseDuration(route?.duration)
      if (!route || !route.polyline || route.distanceMeters === undefined || seconds === null) return null

      const result: RouteResult = { meters: route.distanceMeters, seconds, polyline: route.polyline.encodedPolyline }
      if (mode === 'transit') {
        const steps = summarizeSteps(route.legs?.flatMap((leg) => leg.steps ?? []) ?? [])
        result.steps = steps
        result.walkOnly = !steps.some((s) => s.mode === 'transit')
      }
      return result
    },
  }
}
