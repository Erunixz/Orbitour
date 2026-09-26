import { distanceM } from '../../src/lib/geo.js'
import type { TripRequest } from '../../src/lib/types.js'
import type { Place } from '../upstream/nominatim.js'
import { MUST_SEE_REACH, PlanError, stage, type Emit, type MustSee, type PipelineDeps, type Survey } from './context.js'

// Surveyor (code): finds the city, the trip area, the start point and each
// must-see place. What the user typed is kept next to what it matched.

const MIN_RADIUS_M = 1500
const MAX_RADIUS_M = 8000

/** Trip radius grows with the number of days, up to a cap. */
export function radiusForDays(days: number): number {
  return Math.min(MAX_RADIUS_M, 1800 + 1200 * days)
}

/** Half the diagonal of a bounding box, in metres. */
export function bboxRadiusM(bbox: [number, number, number, number]): number {
  const [south, north, west, east] = bbox
  return distanceM({ lat: south, lon: west }, { lat: north, lon: east }) / 2
}

/** Area radius: by days, but no bigger than a small town itself. */
export function tripRadius(days: number, city: Place): number {
  const byDays = radiusForDays(days)
  if (!city.bbox) return byDays
  return Math.round(Math.max(MIN_RADIUS_M, Math.min(byDays, bboxRadiusM(city.bbox))))
}

export async function runSurveyor(request: TripRequest, deps: PipelineDeps, emit: Emit): Promise<Survey> {
  const s = stage(emit, 'surveyor')
  s.start(`Looking up ${request.city}...`)

  let city: Place | undefined
  try {
    city = (await deps.nominatim.search(request.city, { limit: 1 }))[0]
  } catch {
    s.error('The place search (Nominatim) is not responding. Try again in a minute.')
    throw new PlanError('upstream_down', 'The place search is not responding right now.')
  }
  if (!city) {
    s.error(`Could not find "${request.city}". Try the city name with its country.`)
    throw new PlanError('city_not_found', `Could not find "${request.city}".`)
  }

  const center = { lat: city.lat, lon: city.lon }
  const radiusM = tripRadius(request.days, city)
  const label = city.displayName.split(',').slice(0, 3).join(',').trim()
  s.progress(`Found ${label}. Trip area: ${(radiusM / 1000).toFixed(1)} km around the center.`, {
    area: { center, radiusM, label },
  })

  const near = (factor: number) => ({ center, radiusM: radiusM * factor })
  const lookup = async (typed: string, factor: number): Promise<Place | null> => {
    try {
      return (await deps.nominatim.search(typed, { limit: 1, near: near(factor) }))[0] ?? null
    } catch {
      return null
    }
  }

  let startFrom: Survey['startFrom'] = null
  if (request.startFrom?.trim()) {
    const typed = request.startFrom.trim()
    const place = await lookup(typed, 2)
    startFrom = { typed, place }
    s.progress(place ? `Start point: ${place.name}.` : `Could not place the start point "${typed}". Starting from the center.`)
  }

  const mustSee: MustSee[] = []
  for (const line of request.mustSee.map((l) => l.trim()).filter(Boolean)) {
    // Must-see places may sit outside the usual area.
    const place = await lookup(line, MUST_SEE_REACH)
    mustSee.push({ typed: line, place })
    s.progress(place ? `"${line}" is ${place.name}.` : `Could not find "${line}" in the trip area.`)
  }

  const found = mustSee.filter((m) => m.place).length
  s.done(
    request.mustSee.length > 0
      ? `Mapped ${label}. Found ${found} of ${mustSee.length} must-see places.`
      : `Mapped ${label}.`,
    { area: { center, radiusM, label } },
  )
  return { label, center, radiusM, startFrom, mustSee }
}
