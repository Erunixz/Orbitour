import { z } from 'zod'
import { healthSchema, type Health } from './health.js'
import { legsResponseSchema, type LegsRequest, type LegsResponse } from './schemas.js'

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
