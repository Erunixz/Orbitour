import { z } from 'zod'
import { distanceM } from '../../src/lib/geo.js'
import type { LatLon } from '../../src/lib/types.js'
import { cached, cacheKey, DAY, type Cache } from '../cache.js'
import { fetchWithRetry, UpstreamError, type RetryOptions } from './fetchRetry.js'

// OpenStreetMap places through Overpass. Public instances are busy, so each query
// tries a few mirrors before giving up.
// https://wiki.openstreetmap.org/wiki/Overpass_API

export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const TTL = 3 * DAY

/** Every mirror failed. The planner carries on without meals or lodging. */
export class OverpassDownError extends Error {
  constructor() {
    super('OpenStreetMap place search (Overpass) is not responding right now.')
  }
}

export type OsmPlace = LatLon & {
  /** "node/123" style id. */
  osmId: string
  name: string
  tags: Record<string, string>
  url: string
}

export type OverpassClient = {
  /**
   * Named restaurants and cafes near any of the points, in one query. Public
   * servers are slow and rate limited, so a trip asks once for all its meals.
   */
  food(points: LatLon[], radiusM: number): Promise<OsmPlace[]>
  /** Named hotels, guest houses and hostels around a point, nearest first. */
  lodging(center: LatLon, radiusM: number): Promise<OsmPlace[]>
  /**
   * Places OpenStreetMap marks as worth visiting (museums, attractions,
   * viewpoints, castles, monuments, parks, places of worship with a tourism or
   * heritage tag...) that link to Wikidata. Nearest first.
   */
  attractions(center: LatLon, radiusM: number): Promise<OsmPlace[]>
}

const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

const responseSchema = z.object({ elements: z.array(elementSchema) })

export function parseElements(body: unknown, from: LatLon): OsmPlace[] {
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) return []
  const places = parsed.data.elements.flatMap((el): OsmPlace[] => {
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    const name = el.tags?.name
    if (lat === undefined || lon === undefined || !name) return []
    const osmId = `${el.type}/${el.id}`
    return [{ osmId, name, lat, lon, tags: el.tags ?? {}, url: `https://www.openstreetmap.org/${osmId}` }]
  })
  return places.sort((a, b) => distanceM(a, from) - distanceM(b, from))
}

const around = (p: LatLon, r: number) => `(around:${Math.round(r)},${p.lat.toFixed(5)},${p.lon.toFixed(5)})`

export function foodQuery(points: LatLon[], radiusM: number): string {
  const parts = points.map((p) => `nwr["amenity"~"^(restaurant|cafe)$"]["name"]${around(p, radiusM)};`).join('')
  return `[out:json][timeout:15];(${parts});out center 200;`
}

export function lodgingQuery(center: LatLon, radiusM: number): string {
  return `[out:json][timeout:15];nwr["tourism"~"^(hotel|guest_house|hostel)$"]["name"]${around(center, radiusM)};out center 60;`
}

/** OSM tags that mark a place worth visiting. */
const ATTRACTION_TAGS: [string, RegExp][] = [
  ['tourism', /^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park|artwork)$/],
  ['historic', /^(?!(yes|memorial_plaque|boundary_stone|milestone|wayside_cross|district|street|railway_station)$)/],
  ['leisure', /^(park|garden|nature_reserve)$/],
  ['amenity', /^(place_of_worship|theatre|arts_centre|concert_hall|marketplace|fountain|planetarium)$/],
  ['building', /^(cathedral|basilica|palace|castle)$/],
  ['man_made', /^(tower|lighthouse|observatory)$/],
  ['heritage', /./],
]

/**
 * True when OpenStreetMap marks the place as worth visiting. A church or
 * theatre alone is not enough: it must also carry a tourism or heritage tag,
 * or be a cathedral or basilica.
 */
export function isAttraction(tags: Record<string, string>): boolean {
  const hit = ATTRACTION_TAGS.some(([key, re]) => tags[key] !== undefined && re.test(tags[key]!))
  if (!hit) return false
  const everyday = ['place_of_worship', 'theatre', 'arts_centre', 'concert_hall'].includes(tags.amenity ?? '')
  const special = /^(cathedral|basilica)$/.test(tags.building ?? '') || tags.tourism || tags.heritage || tags.historic
  return !everyday || Boolean(special)
}

/** Box around a point, as Overpass wants it: south, west, north, east. */
function bbox(p: LatLon, r: number): string {
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.cos((p.lat * Math.PI) / 180))
  return [p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon].map((n) => n.toFixed(5)).join(',')
}

/**
 * Everything linked to Wikidata inside a box. Filtering the tags in code is much
 * faster than asking Overpass to do it: a few seconds instead of timing out.
 */
export function attractionsQuery(center: LatLon, radiusM: number): string {
  return `[out:json][timeout:40][bbox:${bbox(center, radiusM)}];nwr["wikidata"];out center tags;`
}

type Deps = {
  userAgent: string
  cache: Cache
  mirrors?: string[]
  retry?: Partial<RetryOptions>
}

export function createOverpass({ userAgent, cache, mirrors = OVERPASS_MIRRORS, retry = {} }: Deps): OverpassClient {
  async function run(query: string, from: LatLon, timeoutMs = 20_000): Promise<OsmPlace[]> {
    for (const url of mirrors) {
      try {
        const res = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query }).toString(),
          },
          // One try each: a busy mirror is better skipped than waited on.
          { tries: 1, timeoutMs, ...retry, service: 'overpass' },
        )
        const body = (await res.json()) as { remark?: unknown }
        // A timed-out query still answers 200, with no elements and a remark. Try the next mirror.
        if (typeof body.remark === 'string' && /runtime error/i.test(body.remark)) continue
        return parseElements(body, from)
      } catch (error) {
        // A bad query fails the same way on every mirror, so stop there.
        if (error instanceof UpstreamError && error.status === 400) throw error
      }
    }
    throw new OverpassDownError()
  }

  return {
    food: (points, radiusM) => {
      if (points.length === 0) return Promise.resolve([])
      const key = cacheKey('osm-food', radiusM, points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';'))
      return cached(cache, key, TTL, () => run(foodQuery(points, radiusM), points[0]!))
    },
    attractions: (center, radiusM) =>
      cached(cache, cacheKey('osm-attractions', center.lat, center.lon, radiusM), 7 * DAY, () =>
        run(attractionsQuery(center, radiusM), center, 45_000).then((places) => places.filter((p) => isAttraction(p.tags))),
      ),
    lodging: (center, radiusM) =>
      cached(cache, cacheKey('osm-lodging', center.lat, center.lon, radiusM), TTL, () =>
        run(lodgingQuery(center, radiusM), center),
      ),
  }
}
