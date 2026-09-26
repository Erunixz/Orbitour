// Response cache for upstream services. In memory for now; a Mongo-backed cache
// with the same interface arrives with storage.

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
