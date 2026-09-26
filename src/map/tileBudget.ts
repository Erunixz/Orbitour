// Client-side cap on 3D sessions per device per day. Each page load that shows
// the 3D city starts one billable tiles session, so we count page loads.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type BudgetResult = { allowed: boolean; used: number; limit: number }

const STORAGE_KEY = 'tiles.sessions.v1'

function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function readCount(storage: StorageLike, day: string): number {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return 0
    const { day: storedDay, count } = parsed as { day?: unknown; count?: unknown }
    return storedDay === day && typeof count === 'number' && count >= 0 ? count : 0
  } catch {
    return 0
  }
}

/** Counts one session if under the limit. Storage errors never block the map. */
export function claimTileSession(limit: number, storage: StorageLike | null, now = new Date()): BudgetResult {
  if (!storage) return { allowed: true, used: 0, limit }
  const day = today(now)
  const used = readCount(storage, day)
  if (used >= limit) return { allowed: false, used, limit }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ day, count: used + 1 }))
  } catch {
    // Private mode or full storage. Allow the session anyway.
  }
  return { allowed: true, used: used + 1, limit }
}

export function parseLimit(raw: string | undefined, fallback = 50): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

let claimed: BudgetResult | null = null

/** Claims at most once per page load, so remounts and StrictMode do not double count. */
export function claimTileSessionOnce(): BudgetResult {
  if (claimed) return claimed
  let storage: StorageLike | null = null
  try {
    storage = window.localStorage
  } catch {
    storage = null
  }
  claimed = claimTileSession(parseLimit(__DAILY_TILE_SESSIONS__), storage)
  return claimed
}
