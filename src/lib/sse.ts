// Server-Sent Events framing, shared by the server (writes) and the app (reads).
// The app reads with fetch because EventSource cannot send a POST body.

export type SseMessage = { event: string; data: string }

/** One SSE message. Data lines are split so newlines inside the data survive. */
export function formatSse(event: string, data: string): string {
  const lines = data.split(/\r?\n/).map((line) => `data: ${line}`)
  return `event: ${event}\n${lines.join('\n')}\n\n`
}

/** Incremental parser: feed text as it arrives, get complete messages back. */
export class SseParser {
  private buffer = ''

  push(chunk: string): SseMessage[] {
    this.buffer += chunk
    const out: SseMessage[] = []
    let end: number
    while ((end = this.findEnd()) !== -1) {
      const block = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end).replace(/^(\r?\n){2}/, '')
      const message = parseBlock(block)
      if (message) out.push(message)
    }
    return out
  }

  private findEnd(): number {
    const a = this.buffer.indexOf('\n\n')
    const b = this.buffer.indexOf('\r\n\r\n')
    if (a === -1) return b
    if (b === -1) return a
    return Math.min(a, b)
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null
}
