import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { planEventSchema, type PlanEvent } from '../src/lib/planEvents'
import { formatSse, SseParser } from '../src/lib/sse'
import { createApp, type AppDeps } from '../server/app'
import { MemoryTripStore } from '../server/store/tripStore'
import { initialPlanView, reducePlan } from '../src/plan-ui/planState'
import { baseRequest, fakeDeps, fakeLlm, scoutPicks } from './fakes'

let server: Server | null = null

async function start(deps: AppDeps): Promise<string> {
  server = createServer(createApp({}, deps))
  await new Promise<void>((resolve) => server!.listen(0, resolve))
  return `http://localhost:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = null
})

async function readEvents(res: Response): Promise<PlanEvent[]> {
  const parser = new SseParser()
  const text = await res.text()
  return parser.push(text).map((m) => planEventSchema.parse(JSON.parse(m.data)))
}

const titles = ['Old Cathedral', 'Castle Hill', 'Art Museum', 'River Garden', 'Clock Tower', 'Tile Museum', 'Harbour Market', 'Lighthouse Viewpoint']

describe('SSE framing', () => {
  it('round-trips messages split at any point, with CRLF and multi-line data', () => {
    const wire = formatSse('stage', '{"a":1}') + formatSse('trip', 'line one\nline two') + ': ping\r\n\r\n' + 'event: x\r\ndata: y\r\n\r\n'
    for (const size of [1, 3, 7, wire.length]) {
      const parser = new SseParser()
      const out = []
      for (let i = 0; i < wire.length; i += size) out.push(...parser.push(wire.slice(i, i + size)))
      expect(out).toEqual([
        { event: 'stage', data: '{"a":1}' },
        { event: 'trip', data: 'line one\nline two' },
        { event: 'x', data: 'y' },
      ])
    }
  })
})

describe('POST /api/trips', () => {
  it('streams crew events, then the trip, and saves it', async () => {
    const store = new MemoryTripStore()
    const llm = fakeLlm({ scout: [scoutPicks(titles)], critic: [{ ok: true, issues: [] }] })
    const base = await start({ ...fakeDeps({ llm }), store })
    const res = await fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(baseRequest) })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const events = await readEvents(res)
    const last = events.at(-1)!
    expect(last.type).toBe('trip')
    expect(events.filter((e) => e.type === 'stage').length).toBeGreaterThan(10)

    if (last.type !== 'trip') throw new Error('expected a trip')
    const saved = await fetch(`${base}/api/trips/${last.trip.id}`)
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as { id: string }).id).toBe(last.trip.id)
  })

  it('ends with a clear failure event when the Scout has no key', async () => {
    const base = await start({ ...fakeDeps({ llm: fakeLlm({}, false) }), store: new MemoryTripStore() })
    const res = await fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(baseRequest) })
    const events = await readEvents(res)
    expect(events.at(-1)).toMatchObject({ type: 'fail', code: 'llm_not_configured' })
    expect(events.find((e) => e.type === 'stage' && e.stage === 'scout')).toMatchObject({ status: 'error' })
  })

  it('rejects a bad request with a JSON 400 before streaming', async () => {
    const base = await start({ ...fakeDeps(), store: new MemoryTripStore() })
    const post = (body: unknown) => fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const noCity = await post({ ...baseRequest, city: '' })
    expect(noCity.status).toBe(400)
    expect(((await noCity.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
    expect((await post({ ...baseRequest, days: 9 })).status).toBe(400)
    expect((await post({ ...baseRequest, startTime: '18:00', endTime: '09:00' })).status).toBe(400)
    expect((await post({ ...baseRequest, startDate: '2026-02-31x' })).status).toBe(400)
  })

  it('returns 404 with a hint for unknown trips', async () => {
    const base = await start({ ...fakeDeps(), store: new MemoryTripStore() })
    const res = await fetch(`${base}/api/trips/nope`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/server restart/)
  })
})

describe('planning screen state', () => {
  it('builds the crew view from events', () => {
    let view = initialPlanView()
    const events: PlanEvent[] = [
      { type: 'stage', stage: 'surveyor', status: 'start', message: 'Looking up...' },
      { type: 'stage', stage: 'surveyor', status: 'done', message: 'Mapped.', data: { area: { center: { lat: 1, lon: 2 }, radiusM: 3000, label: 'X' } } },
      { type: 'stage', stage: 'verifier', status: 'progress', message: 'Verified A.', data: { stop: { id: 'a', name: 'A', lat: 1, lon: 2 } } },
      { type: 'stage', stage: 'verifier', status: 'progress', message: 'Dropped B.', data: { rejected: { title: 'B', reason: 'far' } } },
      { type: 'stage', stage: 'critic', status: 'done', message: '1 note.', data: { issues: [{ target: 'scout', complaint: 'More art.' }] } },
      { type: 'stage', stage: 'scout', status: 'start', message: 'Again...' },
    ]
    for (const e of events) view = reducePlan(view, e)
    expect(view.stages.surveyor.status).toBe('done')
    expect(view.stages.verifier.status).toBe('working')
    expect(view.stages.verifier.log).toEqual(['Verified A.', 'Dropped B.'])
    expect(view.area?.label).toBe('X')
    expect(view.rejected).toEqual([{ title: 'B', reason: 'far' }])
    expect(view.issues).toHaveLength(1)
    // A new Scout run clears the old stops.
    expect(view.stops).toEqual([])
    view = reducePlan(view, { type: 'fail', code: 'x', message: 'Nope.' })
    expect(view.failure).toEqual({ code: 'x', message: 'Nope.' })
  })
})
