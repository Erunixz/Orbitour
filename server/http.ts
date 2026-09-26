import type { IncomingMessage, ServerResponse } from 'node:http'
import type { z } from 'zod'

export type Req = IncomingMessage
export type Res = ServerResponse

/** An error with an HTTP status and a stable code, safe to show to the client. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function sendJson(res: Res, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

const MAX_BODY_BYTES = 256 * 1024

/** Reads a JSON request body. Vercel may have parsed it already into `req.body`. */
export async function readJson(req: Req): Promise<unknown> {
  const preParsed = (req as Req & { body?: unknown }).body
  if (preParsed !== undefined && typeof preParsed !== 'string') return preParsed

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', 'Request body is too large.')
    chunks.push(buf)
  }
  const text = typeof preParsed === 'string' ? preParsed : Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(400, 'bad_json', 'Request body is not valid JSON.')
  }
}

/** Parses with a zod schema, turning problems into a 400 with a short message. */
export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : ''
  throw new ApiError(400, 'invalid_request', `${where}${issue?.message ?? 'Invalid request.'}`)
}

export function sendError(res: Res, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  console.error('[server] unexpected error', error)
  sendJson(res, 500, { error: { code: 'internal', message: 'Something went wrong on the server.' } })
}
