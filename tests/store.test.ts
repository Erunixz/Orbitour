import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LayeredCache, MemoryCache, MongoCache, type CacheCollection } from '../server/cache'
import { createApp, type AppDeps } from '../server/app'
import { buildHealth } from '../server/routes/health'
import {
  MemoryTripStore,
  MongoTripStore,
  StoreUnavailableError,
  type TripCollection,
  type TripDoc,
  type TripStore,
} from '../server/store/tripStore'
import { tripListSchema, tripSchema } from '../src/lib/schemas'
import type { Trip } from '../src/lib/types'
import { baseRequest, fakeDeps, fakeLlm, scoutPicks } from './fakes'

const sample = tripSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/paris-2day.json', import.meta.url), 'utf8')))
const tripAt = (id: string, updatedAt: string): Trip => ({ ...structuredClone(sample), id, title: `Trip ${id}`, updatedAt })

/** An in-memory stand-in for the MongoDB trips collection. */
function fakeTripCollection(fail = false) {
  const docs = new Map<string, TripDoc>()
  let indexCalls = 0
  const guard = () => {
    if (fail) throw Object.assign(new Error('connection refused to mongodb+srv://user:secret@host'), { name: 'MongoServerSelectionError' })
  }
  const collection: TripCollection = {
    async findOne(id) {
      guard()
      return docs.has(id) ? structuredClone(docs.get(id)!) : null
    },
    async replace(doc) {
      guard()
      docs.set(doc._id, structuredClone(doc))
    },
    async remove(id) {
      guard()
      return docs.delete(id) ? 1 : 0
    },
    async recent(limit) {
      guard()
      return [...docs.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((d) => ({ _id: d._id, title: d.title, updatedAt: d.updatedAt, request: { city: d.request.city, days: d.request.days } }))
    },
    async ensureIndexes() {
      indexCalls++
    },
  }
  return { collection, docs, indexCalls: () => indexCalls }
}

async function commonStoreChecks(store: TripStore) {
  await store.save(tripAt('a', '2026-09-01T10:00:00.000Z'))
  await store.save(tripAt('b', '2026-09-03T10:00:00.000Z'))
  await store.save(tripAt('c', '2026-09-02T10:00:00.000Z'))
  expect((await store.list(2)).map((t) => t.id)).toEqual(['b', 'c'])
  expect((await store.list(10))[0]).toEqual({ id: 'b', title: 'Trip b', city: 'Paris', days: 2, updatedAt: '2026-09-03T10:00:00.000Z' })
  expect(await store.get('a')).toEqual(tripAt('a', '2026-09-01T10:00:00.000Z'))
  expect(await store.get('nope')).toBeNull()
  // Saving again replaces the whole trip.
  await store.save({ ...tripAt('a', '2026-09-05T10:00:00.000Z'), title: 'Renamed' })
  expect((await store.get('a'))?.title).toBe('Renamed')
  expect((await store.list(1))[0]?.id).toBe('a')
  expect(await store.delete('a')).toBe(true)
  expect(await store.delete('a')).toBe(false)
  expect(await store.get('a')).toBeNull()
}

describe('trip stores', () => {
  it('memory store saves, lists newest first, and deletes', async () => {
    await commonStoreChecks(new MemoryTripStore())
  })

  it('memory store hands out copies, so callers cannot change what is stored', async () => {
    const store = new MemoryTripStore()
    await store.save(tripAt('x', '2026-09-01T00:00:00.000Z'))
    const copy = await store.get('x')
    copy!.title = 'Changed'
    expect((await store.get('x'))?.title).toBe('Trip x')
  })

  it('mongo store does the same over the collection, keyed by _id', async () => {
    const fake = fakeTripCollection()
    const store = new MongoTripStore(async () => fake.collection)
    await commonStoreChecks(store)
    const doc = fake.docs.get('b')!
    expect(doc._id).toBe('b')
    expect(doc).not.toHaveProperty('id')
    expect(fake.indexCalls()).toBe(1)
  })

  it('mongo store treats a document that fails the schema as missing', async () => {
    const fake = fakeTripCollection()
    const logs: string[] = []
    const store = new MongoTripStore(async () => fake.collection, (m) => logs.push(m))
    fake.docs.set('broken', { _id: 'broken', title: 'Old' } as unknown as TripDoc)
    expect(await store.get('broken')).toBeNull()
    expect(logs[0]).toMatch(/does not match/)
  })

  it('mongo store turns driver errors into StoreUnavailableError without leaking the URI', async () => {
    const logs: string[] = []
    const store = new MongoTripStore(async () => fakeTripCollection(true).collection, (m) => logs.push(m))
    await expect(store.list(5)).rejects.toBeInstanceOf(StoreUnavailableError)
    await expect(store.save(sample)).rejects.toBeInstanceOf(StoreUnavailableError)
    expect(logs.join(' ')).not.toContain('secret')
    expect(logs[0]).toMatch(/MongoServerSelectionError/)

    const noConnect = new MongoTripStore(async () => {
      throw new Error('bad uri')
    })
    await expect(noConnect.get('x')).rejects.toBeInstanceOf(StoreUnavailableError)
  })
})

describe('caches', () => {
  function fakeCacheCollection(fail = false) {
    const docs = new Map<string, { value: unknown; expires: Date }>()
    const collection: CacheCollection = {
      async read(key) {
        if (fail) throw new Error('down')
        return docs.get(key) ?? null
      },
      async write(key, value, expires) {
        if (fail) throw new Error('down')
        docs.set(key, { value, expires })
      },
      async ensureIndexes() {},
    }
    return { collection, docs }
  }

  it('mongo cache stores values with an expiry and ignores expired ones', async () => {
    let now = 1_000_000
    const fake = fakeCacheCollection()
    const cache = new MongoCache(async () => fake.collection, () => {}, () => now)
    await cache.set('k', { a: 1 }, 5000)
    expect(await cache.get('k')).toEqual({ a: 1 })
    expect(fake.docs.get('k')?.expires.getTime()).toBe(1_005_000)
    await cache.set('none', null, 5000)
    expect(await cache.get('none')).toBeNull()
    now += 6000
    expect(await cache.get('k')).toBeUndefined()
  })

  it('mongo cache misses quietly when the database is down, says so once, and backs off', async () => {
    const logs: string[] = []
    let now = 0
    let attempts = 0
    const cache = new MongoCache(
      async () => {
        attempts++
        return fakeCacheCollection(true).collection
      },
      (m) => logs.push(m),
      () => now,
    )
    await cache.set('k', 1, 1000)
    expect(await cache.get('k')).toBeUndefined()
    expect(await cache.get('k')).toBeUndefined()
    expect(attempts).toBe(1)
    expect(logs).toHaveLength(1)
    now += MongoCache.RETRY_AFTER_MS + 1
    await cache.get('k')
    expect(attempts).toBe(2)
  })

  it('layered cache reads memory first and fills it from the far cache', async () => {
    const near = new MemoryCache()
    const far = new MemoryCache()
    const cache = new LayeredCache(near, far)
    await far.set('only-far', 'x', 60_000)
    expect(await cache.get('only-far')).toBe('x')
    expect(await near.get('only-far')).toBe('x')
    await cache.set('both', 'y', 60_000)
    expect(await far.get('both')).toBe('y')
  })
})

describe('saved trips API', () => {
  let server: Server | null = null
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  })

  async function start(deps: Partial<AppDeps> = {}, env: Record<string, string> = {}): Promise<string> {
    server = createServer(createApp(env, { ...fakeDeps(), store: new MemoryTripStore(), ...deps }))
    await new Promise<void>((resolve) => server!.listen(0, resolve))
    return `http://localhost:${(server.address() as AddressInfo).port}`
  }

  it('lists, opens and deletes trips', async () => {
    const store = new MemoryTripStore()
    await store.save(tripAt('one', '2026-09-01T00:00:00.000Z'))
    const base = await start({ store })

    const list = tripListSchema.parse(await (await fetch(`${base}/api/trips`)).json())
    expect(list.store).toBe('memory')
    expect(list.trips.map((t) => t.id)).toEqual(['one'])

    expect((await fetch(`${base}/api/trips/one`)).status).toBe(200)
    expect((await fetch(`${base}/api/trips/one`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/api/trips/one`, { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(`${base}/api/trips/one`)).status).toBe(404)
  })

  it('refuses ids that are not ids', async () => {
    const base = await start()
    const res = await fetch(`${base}/api/trips/${encodeURIComponent('a b$c')}`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_id')
  })

  it('answers 503 when the database is unreachable', async () => {
    const store = new MongoTripStore(async () => fakeTripCollection(true).collection)
    const base = await start({ store })
    const res = await fetch(`${base}/api/trips`)
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('store_unavailable')
  })

  it('still sends a finished plan when saving it fails', async () => {
    const store = new MongoTripStore(async () => fakeTripCollection(true).collection)
    const titles = ['Old Cathedral', 'Castle Hill', 'Art Museum', 'River Garden', 'Clock Tower']
    const llm = fakeLlm({ scout: [scoutPicks(titles)], critic: [{ ok: true, issues: [] }] })
    const base = await start({ store, llm })
    const res = await fetch(`${base}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseRequest, days: 1 }),
    })
    const text = await res.text()
    const last = JSON.parse(/event: trip\ndata: (.*)/.exec(text)![1]!) as { saved: boolean; trip: Trip }
    expect(last.saved).toBe(false)
    expect(last.trip.days).toHaveLength(1)
  })

  it('reports whether the database answers', async () => {
    const down = new MongoTripStore(async () => fakeTripCollection(true).collection, () => {}, async () => false)
    const base = await start({ store: down }, { MONGODB_URI: 'mongodb://example' })
    const health = (await (await fetch(`${base}/api/health`)).json()) as { database: string; store: string }
    expect(health).toMatchObject({ store: 'mongo', database: 'unreachable' })
    expect(buildHealth({}).database).toBe('memory')
    expect(buildHealth({ MONGODB_URI: 'x' }, new Date(), true).database).toBe('ok')
  })
})
