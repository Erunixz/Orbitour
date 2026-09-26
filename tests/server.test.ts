import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer(createApp({}))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('server routes', () => {
  it('serves health with missing keys', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; missing: string[] }
    expect(body.status).toBe('ok')
    expect(body.missing).toContain('OPENAI_API_KEY')
  })

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await fetch(`${base}/api/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No route for /api/nope.' } })
  })

  it('returns 405 for the wrong method', async () => {
    const res = await fetch(`${base}/api/health`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('returns estimated legs when there is no routes key', async () => {
    const res = await fetch(`${base}/api/routes/legs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stops: [
          { id: 'a', lat: 48.8529, lon: 2.3499 },
          { id: 'b', lat: 48.8611, lon: 2.3358 },
          { id: 'c', lat: 48.8584, lon: 2.2945 },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { legs: { estimated: boolean; fromId: string }[]; estimatedCount: number }
    expect(body.legs).toHaveLength(2)
    expect(body.legs.every((l) => l.estimated)).toBe(true)
    expect(body.estimatedCount).toBe(2)
  })

  it('rejects bad leg requests with a 400', async () => {
    const one = await fetch(`${base}/api/routes/legs`, {
      method: 'POST',
      body: JSON.stringify({ stops: [{ id: 'a', lat: 1, lon: 2 }] }),
    })
    expect(one.status).toBe(400)
    const body = (await one.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_request')

    const broken = await fetch(`${base}/api/routes/legs`, { method: 'POST', body: '{nope' })
    expect(broken.status).toBe(400)
  })
})
