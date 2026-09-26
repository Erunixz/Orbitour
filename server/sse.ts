import { formatSse } from '../src/lib/sse.js'
import type { Res } from './http.js'

// Server-Sent Events over a plain response. A comment line every few seconds
// keeps proxies from closing a quiet stream.

const HEARTBEAT_MS = 15_000

export type SseStream = {
  send(event: string, data: unknown): void
  close(): void
}

export function openSse(res: Res): SseStream {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, no-transform')
  res.setHeader('Connection', 'keep-alive')
  // Stops nginx-style proxies from holding events back.
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, HEARTBEAT_MS)

  return {
    send(event, data) {
      if (!res.writableEnded) res.write(formatSse(event, JSON.stringify(data)))
    },
    close() {
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    },
  }
}
