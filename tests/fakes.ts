import { MemoryCache } from '../server/cache'
import type { Llm, LlmRequest } from '../server/llm/openai'
import { LlmError } from '../server/llm/openai'
import type { PipelineDeps } from '../server/pipeline/context'
import type { NominatimClient, Place } from '../server/upstream/nominatim'
import type { OsmPlace, OverpassClient } from '../server/upstream/overpass'
import type { WeatherClient } from '../server/upstream/openMeteo'
import type { WikiArticle, WikiPage, WikipediaClient } from '../server/upstream/wikipedia'
import type { StageEvent } from '../src/lib/planEvents'
import type { TripRequest } from '../src/lib/types'

// Offline stand-ins for every upstream service, around a made-up small city.

export const CENTER = { lat: 38.7169, lon: -9.1399 }

/** Metres to a point north and east of the center. */
export const at = (northM: number, eastM: number) => ({
  lat: CENTER.lat + northM / 111_320,
  lon: CENTER.lon + eastM / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180)),
})

export const place = (name: string, p: { lat: number; lon: number }, extra: Partial<Place> = {}): Place => ({
  ...p,
  name,
  displayName: `${name}, Testville, Testland`,
  category: 'tourism',
  type: 'attraction',
  osmUrl: `https://www.openstreetmap.org/node/${name.length}`,
  bbox: null,
  ...extra,
})

type PageSpec = [title: string, description: string, northM: number, eastM: number, views: number]

export const PAGES: PageSpec[] = [
  ['Old Cathedral', 'Cathedral in Testville', 200, 300, 90_000],
  ['Castle Hill', 'Medieval castle in Testville', 600, 500, 120_000],
  ['Art Museum', 'Art museum in Testville', -400, -300, 60_000],
  ['River Garden', 'Public garden in Testville', -900, 200, 20_000],
  ['Clock Tower', 'Tower in Testville', 300, -700, 30_000],
  ['Tile Museum', 'Museum of tiles', 2200, 2600, 40_000],
  ['Harbour Market', 'Covered market in Testville', 2400, 2300, 25_000],
  ['Lighthouse Viewpoint', 'Viewpoint over the bay', 2600, 2800, 15_000],
  ['Main Street', 'Street in Testville', 50, 50, 50_000],
  ['Central Station', 'Railway station in Testville', 100, -100, 70_000],
  ['Far Palace', 'Palace far outside town', 30_000, 30_000, 99_000],
]

export const pages: WikiPage[] = PAGES.map(([title, description, n, e, views], i) => ({
  pageId: 100 + i,
  title,
  description,
  ...at(n, e),
  length: 20_000,
  views,
}))

export function fakeWikipedia(): WikipediaClient & { lookups: string[][] } {
  const lookups: string[][] = []
  return {
    lookups,
    async nearby() {
      return pages
    },
    async lookup(titles) {
      lookups.push(titles)
      const out = new Map<string, WikiArticle | null>()
      for (const t of titles) {
        const p = pages.find((pg) => pg.title.toLowerCase() === t.trim().toLowerCase())
        out.set(
          t.trim(),
          p
            ? {
                pageId: p.pageId,
                title: p.title,
                description: p.description,
                lat: p.lat,
                lon: p.lon,
                extract: `${p.title} is a place in Testville.`,
                url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
                image: `${p.title}.jpg`,
              }
            : null,
        )
      }
      return out
    },
    async searchTitles(query) {
      return pages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase())).map((p) => p.title)
    },
    async photos(files) {
      return new Map(files.map((f) => [f, { url: `https://upload.example/${f}`, credit: 'Photo: Someone, CC BY-SA 4.0, via Wikimedia Commons', pageUrl: `https://commons.example/${f}` }]))
    },
  }
}

export function fakeNominatim(extra: Record<string, Place | null> = {}): NominatimClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async search(query) {
      calls.push(query)
      if (query in extra) {
        const hit = extra[query]
        // Real searches often return one place as several nearby map objects.
        return hit ? [hit, { ...hit, lat: hit.lat + 0.0003, osmUrl: `${hit.osmUrl}0` }] : []
      }
      if (query.toLowerCase() === 'testville') {
        return [place('Testville', CENTER, { category: 'boundary', type: 'administrative', bbox: [38.6, 38.8, -9.3, -9.0] })]
      }
      const page = pages.find((p) => p.title.toLowerCase() === query.toLowerCase())
      return page ? [place(page.title, page)] : []
    },
  }
}

export const osm = (id: number, name: string, p: { lat: number; lon: number }, tags: Record<string, string> = {}): OsmPlace => ({
  ...p,
  osmId: `node/${id}`,
  name,
  tags: { amenity: 'restaurant', ...tags },
  url: `https://www.openstreetmap.org/node/${id}`,
})

export function fakeOverpass(down = false): OverpassClient & { foodCalls: number } {
  let n = 0
  return {
    foodCalls: 0,
    async food(points) {
      this.foodCalls++
      if (down) throw new (await import('../server/upstream/overpass')).OverpassDownError()
      return points.flatMap((p) => [osm(++n, `Bistro ${n}`, p, { cuisine: 'portuguese' }), osm(++n, `Cafe ${n}`, p, { amenity: 'cafe' })])
    },
    async lodging(center) {
      if (down) throw new (await import('../server/upstream/overpass')).OverpassDownError()
      return [osm(900, 'Grand Hotel', center, { amenity: '', tourism: 'hotel' }), osm(901, 'Cosy Guest House', center, { amenity: '', tourism: 'guest_house' })]
    },
  }
}

export const fakeWeather = (): WeatherClient => ({
  async daily(_center, startDate, days) {
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.parse(`${startDate}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      code: 61,
      maxC: 18,
      minC: 11,
      rainChance: i === 0 ? 80 : 10,
    }))
  },
})

type Reply = unknown | ((input: unknown) => unknown)

/** An LLM that answers from a script, per agent, in order. */
export function fakeLlm(script: Partial<Record<'scout' | 'critic' | 'fast', Reply[]>>, configured = true): Llm & { inputs: Record<string, unknown[]> } {
  const inputs: Record<string, unknown[]> = { scout: [], critic: [], fast: [] }
  return {
    inputs,
    missingConfig: () => (configured ? null : 'Set OPENAI_API_KEY and LLM_MODEL_SCOUT in .env to run this step.'),
    async call<T>(request: LlmRequest<T>, usage?: { calls: number; inputTokens: number; outputTokens: number }): Promise<T> {
      inputs[request.agent]!.push(request.input)
      const replies = script[request.agent] ?? []
      const next = replies.shift()
      if (next === undefined) throw new LlmError('bad_reply', 'No scripted reply left.')
      const value = typeof next === 'function' ? (next as (input: unknown) => unknown)(request.input) : next
      if (usage) {
        usage.calls++
        usage.inputTokens += JSON.stringify(request.input).length / 4
        usage.outputTokens += JSON.stringify(value).length / 4
      }
      return request.schema.parse(value)
    },
  }
}

export const scoutPicks = (titles: string[], mustSee: string[] = []) => ({
  picks: titles.map((title) => ({ title, kind: 'other', reason: `${title} suits you.`, importance: 3, mustSee: mustSee.includes(title) })),
})

export function fakeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  let id = 0
  return {
    nominatim: fakeNominatim(),
    wikipedia: fakeWikipedia(),
    overpass: fakeOverpass(),
    weather: fakeWeather(),
    routes: null,
    matrix: null,
    llm: fakeLlm({}),
    cache: new MemoryCache(),
    log: () => {},
    now: () => new Date('2026-09-25T08:00:00Z'),
    newId: () => `trip-${++id}`,
    ...overrides,
  }
}

export const baseRequest: TripRequest = {
  city: 'Testville',
  days: 2,
  startTime: '09:30',
  endTime: '18:00',
  mustSee: [],
  interests: ['history', 'art'],
  pace: 'normal',
  mode: 'auto',
  party: 'couple',
  budget: 'modest',
  meals: ['lunch'],
}

export function recorder() {
  const events: StageEvent[] = []
  return { events, emit: (e: StageEvent) => events.push(e) }
}
