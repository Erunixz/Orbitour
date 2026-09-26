import { z } from 'zod'
import { healthSchema, type Health } from './health.js'
import { planEventSchema, type PlanEvent } from './planEvents.js'
import { legsResponseSchema, tripListSchema, tripSchema, type LegsRequest, type LegsResponse, type TripList } from './schemas.js'
import { SseParser } from './sse.js'
import type { Trip, TripRequest } from './types.js'

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })

/** Error thrown by API helpers. `code` comes from the server when it sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function requestJson<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const signal = init.signal ?? undefined
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiRequestError(0, 'network', 'Could not reach the server.')
  }

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const parsed = errorSchema.safeParse(body)
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
    throw new ApiRequestError(res.status, 'http', `Server replied with ${res.status}.`)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ApiRequestError(res.status, 'bad_response', 'Server reply was not in the expected shape.')
  return parsed.data
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return requestJson('/api/health', healthSchema, { signal })
}

export function fetchLegs(body: LegsRequest, signal?: AbortSignal): Promise<LegsResponse> {
  return requestJson('/api/routes/legs', legsResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export function fetchTrips(signal?: AbortSignal): Promise<TripList> {
  return requestJson('/api/trips', tripListSchema, { signal })
}

export async function deleteTrip(id: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/trips/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    throw new ApiRequestError(0, 'network', 'Could not reach the server.')
  }
  // Already gone counts as done.
  if (res.ok || res.status === 404) return
  const parsed = errorSchema.safeParse(await res.json().catch(() => null))
  if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
  throw new ApiRequestError(res.status, 'http', `Server replied with ${res.status}.`)
}

export function fetchTrip(id: string, signal?: AbortSignal): Promise<Trip> {
  return requestJson(`/api/trips/${encodeURIComponent(id)}`, tripSchema, { signal })
}

/**
 * Plans a trip. Calls `onEvent` for each crew update as it streams in, and
 * resolves once the final trip or failure event has arrived.
 */
export async function streamPlan(
  request: TripRequest,
  onEvent: (event: PlanEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiRequestError(0, 'network', 'Could not reach the server.')
  }
  if (!res.ok || !res.body) {
    const body: unknown = await res.json().catch(() => null)
    const parsed = errorSchema.safeParse(body)
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
    throw new ApiRequestError(res.status, 'http', `Server replied with ${res.status}.`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  let finished = false
  for (;;) {
    const { done, value } = await reader.read()
    const messages = parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }))
    for (const message of messages) {
      let data: unknown
      try {
        data = JSON.parse(message.data)
      } catch {
        continue
      }
      const event = planEventSchema.safeParse(data)
      if (!event.success) continue
      if (event.data.type !== 'stage') finished = true
      onEvent(event.data)
    }
    if (done) break
  }
  if (!finished) throw new ApiRequestError(0, 'stream_ended', 'The connection closed before the plan was ready.')
}
