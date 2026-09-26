import { describe, expect, it, vi } from 'vitest'
import { distanceM } from '../src/lib/geo'
import { decodePolyline } from '../src/lib/polyline'
import { cacheKey, MemoryCache } from '../server/cache'
import { buildLeg, buildLegs, chooseMode, estimateLeg } from '../server/pipeline/legs'
import { backoffMs, fetchWithRetry, UpstreamError } from '../server/upstream/fetchRetry'
import { createRoutesClient, parseDuration, ROUTE_FIELD_MASK, summarizeSteps, type RoutesClient } from '../server/upstream/googleRoutes'

const a = { id: 'a', lat: 48.8529, lon: 2.3499 }
const b = { id: 'b', lat: 48.8611, lon: 2.3358 }

const noSleep = async () => {}

describe('chooseMode', () => {
  it('walks short hops whatever the budget', () => {
    expect(chooseMode(900, 'auto', 'any')).toBe('walk')
    expect(chooseMode(1400, 'auto', 'free')).toBe('walk')
  })

  it('walks further on a free budget, then takes transit', () => {
    expect(chooseMode(2800, 'auto', 'free')).toBe('walk')
    expect(chooseMode(3500, 'auto', 'free')).toBe('transit')
  })

  it('uses transit for medium hops and drives only long ones with any budget', () => {
    expect(chooseMode(4000, 'auto', 'modest')).toBe('transit')
    expect(chooseMode(12000, 'auto', 'modest')).toBe('transit')
    expect(chooseMode(12000, 'auto', 'any')).toBe('drive')
  })

  it('keeps an explicit mode, except transit or driving for a few hundred metres', () => {
    expect(chooseMode(5000, 'cycle', 'free')).toBe('cycle')
    expect(chooseMode(500, 'transit', 'any')).toBe('walk')
    expect(chooseMode(500, 'drive', 'any')).toBe('walk')
    expect(chooseMode(500, 'cycle', 'any')).toBe('cycle')
  })
})

describe('estimateLeg', () => {
  it('is marked estimated, longer than the straight line, with a two-point polyline', () => {
    const leg = estimateLeg(a, b, 'walk')
    const straight = distanceM(a, b)
    expect(leg.estimated).toBe(true)
    expect(leg.meters).toBeGreaterThan(straight)
    expect(leg.minutes).toBeGreaterThan(10)
    const pts = decodePolyline(leg.polyline)
    expect(pts).toHaveLength(2)
    expect(pts[0]!.lat).toBeCloseTo(a.lat, 5)
  })

  it('adds waiting time for transit', () => {
    const walk = estimateLeg(a, b, 'walk')
    const transit = estimateLeg(a, b, 'transit')
    expect(transit.minutes).toBeGreaterThanOrEqual(8)
    expect(transit.minutes).toBeLessThan(walk.minutes)
  })
})

describe('buildLeg and buildLegs', () => {
  const route = { meters: 1600, seconds: 1260, polyline: 'abc' }

  it('estimates without calling anything when there is no key', async () => {
    const result = await buildLeg(a, b, 'walk', { routes: null, cache: new MemoryCache() })
    expect(result.leg.estimated).toBe(true)
    expect(result.fallbackReason).toBe('no_key')
  })

  it('uses the route and caches it', async () => {
    const computeRoute = vi.fn(async () => route)
    const deps = { routes: { computeRoute } as RoutesClient, cache: new MemoryCache() }
    const first = await buildLeg(a, b, 'walk', deps)
    const second = await buildLeg(a, b, 'walk', deps)
    expect(first.leg).toMatchObject({ estimated: false, minutes: 21, meters: 1600, polyline: 'abc', mode: 'walk' })
    expect(second.leg).toEqual(first.leg)
    expect(computeRoute).toHaveBeenCalledTimes(1)
  })

  it('falls back to an estimate on errors and on no route', async () => {
    const failing = { computeRoute: vi.fn(async () => Promise.reject(new UpstreamError('routes', 500, 'boom'))) }
    const errored = await buildLeg(a, b, 'walk', { routes: failing, cache: new MemoryCache() })
    expect(errored.leg.estimated).toBe(true)
    expect(errored.fallbackReason).toBe('error')

    const none = { computeRoute: vi.fn(async () => null) }
    const noRoute = await buildLeg(a, b, 'transit', { routes: none, cache: new MemoryCache() })
    expect(noRoute.fallbackReason).toBe('no_route')
  })

  it('labels a transit request that came back as walking only as a walk', async () => {
    const client = { computeRoute: vi.fn(async () => ({ ...route, walkOnly: true, steps: [] })) }
    const { leg } = await buildLeg(a, b, 'transit', { routes: client, cache: new MemoryCache() })
    expect(leg.mode).toBe('walk')
    expect(leg.steps).toBeUndefined()
  })

  it('returns one leg per consecutive pair, in order', async () => {
    const stops = [a, b, { id: 'c', lat: 48.8584, lon: 2.2945 }, { id: 'd', lat: 48.8738, lon: 2.295 }]
    const { legs, estimatedCount } = await buildLegs(stops, 'auto', 'modest', { routes: null, cache: new MemoryCache() })
    expect(legs.map((l) => `${l.fromId}>${l.toId}`)).toEqual(['a>b', 'b>c', 'c>d'])
    expect(estimatedCount).toBe(3)
  })
})

describe('Google Routes client', () => {
  const okBody = {
    routes: [
      {
        duration: '1260s',
        distanceMeters: 1600,
        polyline: { encodedPolyline: 'xyz' },
        legs: [
          {
            steps: [
              { travelMode: 'WALK', distanceMeters: 200, staticDuration: '180s' },
              { travelMode: 'WALK', distanceMeters: 100, staticDuration: '60s' },
              {
                travelMode: 'TRANSIT',
                distanceMeters: 2500,
                staticDuration: '420s',
                transitDetails: { transitLine: { nameShort: '1' } },
              },
            ],
          },
        ],
      },
    ],
  }

  it('sends the key, the field mask, and lat/lng waypoints', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(okBody))
    const client = createRoutesClient('test-key', { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep })
    await client.computeRoute(a, b, 'transit')

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    const headers = init!.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('test-key')
    expect(headers['X-Goog-FieldMask']).toBe(ROUTE_FIELD_MASK)
    expect(ROUTE_FIELD_MASK).toContain('routes.polyline.encodedPolyline')
    const body = JSON.parse(String(init!.body))
    expect(body.travelMode).toBe('TRANSIT')
    expect(body.origin.location.latLng).toEqual({ latitude: a.lat, longitude: a.lon })
    expect(body.routingPreference).toBeUndefined()
  })

  it('parses duration, distance, polyline and transit steps', async () => {
    const fetchImpl = vi.fn(async () => Response.json(okBody))
    const client = createRoutesClient('k', { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep })
    const result = await client.computeRoute(a, b, 'transit')
    expect(result).toMatchObject({ meters: 1600, seconds: 1260, polyline: 'xyz', walkOnly: false })
    expect(result!.steps).toEqual([
      { mode: 'walk', meters: 300, minutes: 4 },
      { mode: 'transit', meters: 2500, minutes: 7, line: '1' },
    ])
  })

  it('returns null when Google finds no route', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}))
    const client = createRoutesClient('k', { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep })
    expect(await client.computeRoute(a, b, 'walk')).toBeNull()
  })

  it('parses durations', () => {
    expect(parseDuration('165s')).toBe(165)
    expect(parseDuration('12.5s')).toBe(12.5)
    expect(parseDuration('bad')).toBeNull()
    expect(parseDuration(undefined)).toBeNull()
    expect(summarizeSteps([])).toEqual([])
  })
})

describe('fetchWithRetry', () => {
  it('retries 429 and 5xx, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'))
    const sleep = vi.fn(noSleep)
    const res = await fetchWithRetry('https://x', {}, { service: 't', fetchImpl, sleep })
    expect(await res.text()).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does not retry other client errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad key', { status: 403 }))
    await expect(fetchWithRetry('https://x', {}, { service: 't', fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      status: 403,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after 3 tries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('busy', { status: 429 }))
    await expect(fetchWithRetry('https://x', {}, { service: 't', fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(
      UpstreamError,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('ok'))
    const res = await fetchWithRetry('https://x', {}, { service: 't', fetchImpl, sleep: noSleep })
    expect(res.ok).toBe(true)
  })

  it('backs off exponentially with jitter and a cap', () => {
    expect(backoffMs(0, 500, 8000, () => 0)).toBe(500)
    expect(backoffMs(2, 500, 8000, () => 0)).toBe(2000)
    expect(backoffMs(2, 500, 8000, () => 1)).toBe(2500)
    expect(backoffMs(10, 500, 8000, () => 0)).toBe(8000)
  })
})

describe('MemoryCache', () => {
  it('expires entries and evicts the oldest', async () => {
    let now = 0
    const cache = new MemoryCache(2, () => now)
    await cache.set('a', 1, 100)
    await cache.set('b', 2, 100)
    await cache.set('c', 3, 100)
    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBe(2)
    now = 200
    expect(await cache.get('b')).toBeUndefined()
  })

  it('builds normalized keys', () => {
    expect(cacheKey('geo', '  Paris  ', 48.123456789)).toBe(cacheKey('geo', 'paris', 48.12346))
  })
})
