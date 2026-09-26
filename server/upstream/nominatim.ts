import { z } from 'zod'
import { distanceM } from '../../src/lib/geo.js'
import type { LatLon } from '../../src/lib/types.js'
import { cached, cacheKey, DAY, type Cache } from '../cache.js'
import { fetchWithRetry, type RetryOptions } from './fetchRetry.js'
import { RateGate } from './politeness.js'

// Nominatim geocoding. At most one request per second, cached, with a real
// User-Agent. No autocomplete: the usage policy does not allow it.
// https://operations.osmfoundation.org/policies/nominatim/

const BASE = 'https://nominatim.openstreetmap.org'
const TTL = 30 * DAY

const resultSchema = z.object({
  osm_type: z.string().optional(),
  osm_id: z.number().optional(),
  lat: z.string(),
  lon: z.string(),
  name: z.string().optional(),
  display_name: z.string(),
  category: z.string().optional(),
  class: z.string().optional(),
  type: z.string().optional(),
  boundingbox: z.array(z.string()).length(4).optional(),
})

export type Place = LatLon & {
  name: string
  displayName: string
  /** OSM category and type, like "tourism" and "museum". */
  category: string
  type: string
  osmUrl: string | null
  /** [south, north, west, east] */
  bbox: [number, number, number, number] | null
}

export type NominatimClient = {
  /** Best matches for free text. Near a point when `near` is given. */
  search(query: string, options?: { limit?: number; near?: { center: LatLon; radiusM: number } }): Promise<Place[]>
}

function toPlace(raw: z.infer<typeof resultSchema>): Place {
  const bbox = raw.boundingbox?.map(Number)
  const osmUrl =
    raw.osm_type && raw.osm_id !== undefined ? `https://www.openstreetmap.org/${raw.osm_type}/${raw.osm_id}` : null
  return {
    lat: Number(raw.lat),
    lon: Number(raw.lon),
    name: raw.name || raw.display_name.split(',')[0]!.trim(),
    displayName: raw.display_name,
    category: raw.category ?? raw.class ?? '',
    type: raw.type ?? '',
    osmUrl,
    bbox: bbox && bbox.every(Number.isFinite) ? (bbox as [number, number, number, number]) : null,
  }
}

/** A box around a point, as Nominatim's viewbox "left,top,right,bottom". */
export function viewbox(center: LatLon, radiusM: number): string {
  const dLat = radiusM / 111_320
  const dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  return [center.lon - dLon, center.lat + dLat, center.lon + dLon, center.lat - dLat].map((n) => n.toFixed(5)).join(',')
}

type Deps = {
  userAgent: string
  cache: Cache
  gate?: RateGate
  retry?: Partial<RetryOptions>
}

export function createNominatim({ userAgent, cache, gate = new RateGate(1100), retry = {} }: Deps): NominatimClient {
  return {
    async search(query, { limit = 5, near } = {}) {
      const q = query.trim()
      if (!q) return []
      const key = cacheKey('nominatim', q, limit, near?.center.lat, near?.center.lon, near?.radiusM)
      return cached(cache, key, TTL, () =>
        gate.run(async () => {
          const params = new URLSearchParams({ q, format: 'jsonv2', limit: String(limit), 'accept-language': 'en' })
          if (near) {
            params.set('viewbox', viewbox(near.center, near.radiusM))
            params.set('bounded', '1')
          }
          const res = await fetchWithRetry(
            `${BASE}/search?${params.toString()}`,
            { headers: { 'User-Agent': userAgent, Accept: 'application/json' } },
            { ...retry, service: 'nominatim' },
          )
          const parsed = z.array(resultSchema).safeParse(await res.json())
          if (!parsed.success) return []
          const places = parsed.data.map(toPlace)
          // A bounded search uses a box; keep only what is inside the circle.
          return near ? places.filter((p) => distanceM(p, near.center) <= near.radiusM) : places
        }),
      )
    },
  }
}
