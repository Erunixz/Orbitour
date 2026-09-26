import type { Env } from './env.js'
import { ApiError, type Req } from './http.js'

// Daily cap on the calls that cost money (planning and typed changes), per
// visitor address. Kept in memory: it resets on restart, which is fine for a
// cost guard. DAILY_TRIP_LIMIT=0 turns it off.

const DEFAULT_LIMIT = 20

export function readTripLimit(env: Env): number {
  const raw = env.DAILY_TRIP_LIMIT?.trim()
  if (!raw) return DEFAULT_LIMIT
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_LIMIT
}

/** The caller's address. Behind a proxy (like Vercel) the first forwarded address is the visitor. */
export function clientAddress(req: Req): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.socket.remoteAddress || 'unknown'
}

export class DailyLimit {
  private readonly counts = new Map<string, { day: string; used: number }>()

  constructor(
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Counts one use, or throws a 429 when today's allowance is used up. */
  take(key: string): void {
    if (this.limit === 0) return
    const day = this.now().toISOString().slice(0, 10)
    const entry = this.counts.get(key)
    const used = entry?.day === day ? entry.used : 0
    if (used >= this.limit) {
      throw new ApiError(
        429,
        'daily_limit',
        `This device has used its ${this.limit} plans and changes for today. It resets tomorrow (UTC). Change DAILY_TRIP_LIMIT to raise it.`,
      )
    }
    this.counts.set(key, { day, used: used + 1 })
    if (this.counts.size > 5000) {
      for (const [k, v] of this.counts) if (v.day !== day) this.counts.delete(k)
    }
  }
}
