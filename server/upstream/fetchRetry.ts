// Fetch with a timeout and retries for rate limits (429), server errors (5xx),
// timeouts, and network failures. Other errors fail at once.

export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message)
  }
}

export type RetryOptions = {
  /** Short name for errors and logs, e.g. "routes". Never include keys. */
  service: string
  tries?: number
  timeoutMs?: number
  baseDelayMs?: number
  maxDelayMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const isRetryableStatus = (status: number) => status === 429 || status >= 500

/** Seconds from a Retry-After header, if it holds a number. */
function retryAfterMs(res: Response): number | null {
  const value = Number(res.headers.get('retry-after'))
  return Number.isFinite(value) && value >= 0 ? value * 1000 : null
}

/** Exponential backoff with jitter: base * 2^attempt, plus up to one base of noise. */
export function backoffMs(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt + random() * baseMs)
}

export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const {
    service,
    tries = 3,
    timeoutMs = 15_000,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  let lastError: UpstreamError = new UpstreamError(service, null, `${service} request failed`)

  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch {
      clearTimeout(timer)
      lastError = new UpstreamError(service, null, `${service} did not respond`)
      if (attempt < tries - 1) await sleep(backoffMs(attempt, baseDelayMs, maxDelayMs, random))
      continue
    }
    clearTimeout(timer)

    if (res.ok) return res

    const body = await res.text().catch(() => '')
    lastError = new UpstreamError(service, res.status, `${service} replied ${res.status}: ${body.slice(0, 200)}`)
    if (!isRetryableStatus(res.status) || attempt === tries - 1) throw lastError

    const wait = retryAfterMs(res) ?? backoffMs(attempt, baseDelayMs, maxDelayMs, random)
    await sleep(Math.min(wait, maxDelayMs))
  }

  throw lastError
}
