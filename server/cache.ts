import type { Collection } from 'mongodb'

// Response cache for upstream services: memory, plus a MongoDB collection when
// MONGODB_URI is set.

export interface Cache {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
}

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>()

  constructor(
    private readonly maxEntries = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh recency so the oldest unused entries are dropped first.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: this.now() + ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

/** Stable key from parts: strings are trimmed and lowercased, numbers rounded. */
export function cacheKey(namespace: string, ...parts: (string | number | boolean | null | undefined)[]): string {
  const norm = parts.map((p) => {
    if (typeof p === 'string') return p.trim().toLowerCase().replace(/\s+/g, ' ')
    if (typeof p === 'number') return Number.isInteger(p) ? String(p) : p.toFixed(5)
    return String(p)
  })
  return `${namespace}:${norm.join('|')}`
}

/** Returns the cached value, or runs `load` and caches what it returns (unless undefined). */
export async function cached<T>(cache: Cache, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key)
  if (hit !== undefined) return hit
  const value = await load()
  if (value !== undefined) await cache.set(key, value, ttlMs)
  return value
}

/** The few calls the Mongo cache uses, so tests can pass a fake. */
export type CacheCollection = {
  read(key: string): Promise<{ value: unknown; expires: Date } | null>
  write(key: string, value: unknown, expires: Date): Promise<void>
  ensureIndexes(): Promise<void>
}

export type CacheDoc = { _id: string; value: unknown; expires: Date }

export function cacheCollection(collection: Collection<CacheDoc>): CacheCollection {
  return {
    read: (key) => collection.findOne({ _id: key }),
    async write(key, value, expires) {
      await collection.updateOne({ _id: key }, { $set: { value, expires } }, { upsert: true })
    },
    async ensureIndexes() {
      // MongoDB removes documents once `expires` has passed.
      await collection.createIndex({ expires: 1 }, { expireAfterSeconds: 0 })
    },
  }
}

/**
 * Cache in a MongoDB collection, so answers survive restarts and are shared by
 * every server instance. Database trouble never breaks a request: it just misses.
 */
export class MongoCache implements Cache {
  private indexed: Promise<void> | null = null
  private warned = false
  /** After a failure, skip the database for a while instead of waiting on every lookup. */
  private downUntil = 0
  static readonly RETRY_AFTER_MS = 60_000

  constructor(
    private readonly collection: () => Promise<CacheCollection>,
    private readonly log: (message: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  private async use<T>(run: (c: CacheCollection) => Promise<T>): Promise<T | undefined> {
    if (this.now() < this.downUntil) return undefined
    try {
      const c = await this.collection()
      this.indexed ??= c.ensureIndexes().catch(() => {
        this.indexed = null
      })
      await this.indexed
      return await run(c)
    } catch (error) {
      this.downUntil = this.now() + MongoCache.RETRY_AFTER_MS
      if (!this.warned) {
        this.warned = true
        this.log(`[cache] MongoDB cache unavailable, using memory only: ${error instanceof Error ? error.name : 'unknown error'}`)
      }
      return undefined
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const doc = await this.use((c) => c.read(key))
    // The TTL index sweeps about once a minute, so check the time too.
    if (!doc || doc.expires.getTime() <= this.now()) return undefined
    return doc.value as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.use((c) => c.write(key, value, new Date(this.now() + ttlMs)))
  }
}

/** Memory in front of a slower shared cache. */
export class LayeredCache implements Cache {
  constructor(
    private readonly near: Cache,
    private readonly far: Cache,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const hit = await this.near.get<T>(key)
    if (hit !== undefined) return hit
    const far = await this.far.get<T>(key)
    // Keep a short local copy; the far cache still owns the real expiry.
    if (far !== undefined) await this.near.set(key, far, 10 * 60 * 1000)
    return far
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await Promise.all([this.near.set(key, value, ttlMs), this.far.set(key, value, ttlMs)])
  }
}
