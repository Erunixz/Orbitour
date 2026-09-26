import { hasValue, type Env } from '../env.js'

// Open data services ask callers to identify themselves and to go slowly.

/** User-Agent for Nominatim, Wikimedia and Overpass. Adds CONTACT_EMAIL when set. */
export function userAgent(env: Env): string {
  const contact = hasValue(env, 'CONTACT_EMAIL') ? ` (${env.CONTACT_EMAIL!.trim()})` : ''
  return `Orbitour/0.1 trip planner${contact}`
}

/**
 * Runs tasks one at a time with at least `gapMs` between starts. Nominatim allows
 * one request per second, so every call goes through one shared gate.
 */
export class RateGate {
  private tail: Promise<unknown> = Promise.resolve()
  private lastStart = -Infinity

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.lastStart + this.gapMs - this.now()
      if (wait > 0) await this.sleep(wait)
      this.lastStart = this.now()
      return task()
    })
    // Keep the chain going whether this task worked or not.
    this.tail = result.catch(() => undefined)
    return result
  }
}
