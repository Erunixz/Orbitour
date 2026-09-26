import { describe, expect, it, vi } from 'vitest'
import { claimTileSession, parseLimit, type StorageLike } from '../src/map/tileBudget'
import { classify, diagnoseTilesKey } from '../src/map/tilesKey'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('tile session budget', () => {
  const day1 = new Date('2026-09-25T10:00:00Z')
  const day2 = new Date('2026-09-26T10:00:00Z')

  it('allows up to the limit, then blocks', () => {
    const storage = memoryStorage()
    expect(claimTileSession(2, storage, day1)).toEqual({ allowed: true, used: 1, limit: 2 })
    expect(claimTileSession(2, storage, day1)).toEqual({ allowed: true, used: 2, limit: 2 })
    expect(claimTileSession(2, storage, day1).allowed).toBe(false)
  })

  it('resets on a new day', () => {
    const storage = memoryStorage()
    claimTileSession(1, storage, day1)
    expect(claimTileSession(1, storage, day1).allowed).toBe(false)
    expect(claimTileSession(1, storage, day2).allowed).toBe(true)
  })

  it('treats corrupt storage as zero and never blocks without storage', () => {
    const storage = memoryStorage()
    storage.data.set('tiles.sessions.v1', 'not json')
    expect(claimTileSession(1, storage, day1).allowed).toBe(true)
    expect(claimTileSession(1, null, day1).allowed).toBe(true)
  })

  it('parses the limit with a fallback', () => {
    expect(parseLimit('20')).toBe(20)
    expect(parseLimit('')).toBe(50)
    expect(parseLimit('-3')).toBe(50)
    expect(parseLimit(undefined, 7)).toBe(7)
  })
})

describe('tiles key diagnosis', () => {
  it('classifies common Google errors', () => {
    expect(classify(403, 'Requests from referer http://x/ are blocked.')).toBe('referrer_blocked')
    expect(classify(403, '{"reason":"API_KEY_HTTP_REFERRER_BLOCKED"}')).toBe('referrer_blocked')
    expect(classify(403, 'Map Tiles API has not been used in project 123 before or it is disabled.')).toBe(
      'api_not_enabled',
    )
    expect(classify(400, 'API key not valid. Please pass a valid API key.')).toBe('invalid_key')
    expect(classify(429, '')).toBe('quota')
    expect(classify(403, 'This API project requires billing to be enabled.')).toBe('billing')
    expect(classify(500, 'oops')).toBe('unknown')
  })

  it('reports a missing key without calling Google', async () => {
    const fetchImpl = vi.fn()
    const result = await diagnoseTilesKey('  ', fetchImpl as unknown as typeof fetch)
    expect(result?.problem).toBe('missing_key')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses one request and maps its error', async () => {
    const fetchImpl = vi.fn(async () => new Response('API key not valid.', { status: 400 }))
    const result = await diagnoseTilesKey('abc', fetchImpl as unknown as typeof fetch)
    expect(result?.problem).toBe('invalid_key')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('failed')
    })
    const result = await diagnoseTilesKey('abc', fetchImpl as unknown as typeof fetch)
    expect(result?.problem).toBe('network')
  })
})
