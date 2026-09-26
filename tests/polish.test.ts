import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { dayDirectionsUrl, MAX_WAYPOINTS } from '../src/lib/mapsLink'
import { createApp } from '../server/app'
import { ApiError } from '../server/http'
import { DailyLimit, readTripLimit } from '../server/rateLimit'
import { MemoryTripStore } from '../server/store/tripStore'
import { baseRequest, fakeDeps, fakeLlm } from './fakes'

describe('daily limit', () => {
  it('reads the setting, with 0 meaning off', () => {
    expect(readTripLimit({})).toBe(20)
    expect(readTripLimit({ DAILY_TRIP_LIMIT: '5' })).toBe(5)
    expect(readTripLimit({ DAILY_TRIP_LIMIT: '0' })).toBe(0)
    expect(readTripLimit({ DAILY_TRIP_LIMIT: 'lots' })).toBe(20)
  })

  it('allows the limit per address per day, then resets the next day', () => {
    let now = new Date('2026-09-26T10:00:00Z')
    const limit = new DailyLimit(2, () => now)
    limit.take('a')
    limit.take('a')
    expect(() => limit.take('a')).toThrow(ApiError)
    limit.take('b')
    now = new Date('2026-09-27T00:00:01Z')
    expect(() => limit.take('a')).not.toThrow()
    const off = new DailyLimit(0)
    for (let i = 0; i < 50; i++) off.take('a')
  })

  let server: Server | null = null
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  })

  it('answers 429 once a visitor has used today\'s plans, and ignores invalid requests', async () => {
    server = createServer(createApp({ DAILY_TRIP_LIMIT: '1' }, { ...fakeDeps({ llm: fakeLlm({}, false) }), store: new MemoryTripStore() }))
    await new Promise<void>((resolve) => server!.listen(0, resolve))
    const base = `http://localhost:${(server.address() as AddressInfo).port}`
    const post = (body: unknown) =>
      fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    expect((await post({ ...baseRequest, city: '' })).status).toBe(400)
    const first = await post(baseRequest)
    expect(first.status).toBe(200)
    await first.text()
    const second = await post(baseRequest)
    expect(second.status).toBe(429)
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('daily_limit')
  })
})

describe('whole-day Google Maps link', () => {
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 38 + i / 100, lon: -9 }))

  it('goes from the first stop to the last through the others', () => {
    const url = new URL(dayDirectionsUrl(points(4), 'walk')!)
    expect(url.searchParams.get('origin')).toBe('38,-9')
    expect(url.searchParams.get('destination')).toBe('38.03,-9')
    expect(url.searchParams.get('waypoints')).toBe('38.01,-9|38.02,-9')
    expect(url.searchParams.get('travelmode')).toBe('walking')
  })

  it('keeps within the waypoint limit and needs two stops', () => {
    const url = new URL(dayDirectionsUrl(points(20))!)
    expect(url.searchParams.get('waypoints')!.split('|')).toHaveLength(MAX_WAYPOINTS)
    expect(dayDirectionsUrl(points(1))).toBeNull()
  })
})
