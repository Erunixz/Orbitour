import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { tripSchema } from '../src/lib/schemas'
import type { Trip } from '../src/lib/types'
import { createApp } from '../server/app'
import { applyChanges, describeChanges, EditError } from '../server/pipeline/edit'
import { planTrip } from '../server/pipeline/pipeline'
import { replan } from '../server/pipeline/replan'
import { MemoryTripStore } from '../server/store/tripStore'
import { at, baseRequest, fakeDeps, fakeLlm, fakeNominatim, place, scoutPicks } from './fakes'

const titles = ['Old Cathedral', 'Castle Hill', 'Art Museum', 'River Garden', 'Clock Tower', 'Tile Museum', 'Harbour Market', 'Lighthouse Viewpoint']
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

async function plannedTrip(extra: Partial<typeof baseRequest> = {}, nominatim = fakeNominatim()): Promise<Trip> {
  const llm = fakeLlm({ scout: [scoutPicks(titles)], critic: [{ ok: true, issues: [] }] })
  return (await planTrip({ ...baseRequest, ...extra }, fakeDeps({ llm, nominatim }), () => {})).trip
}

/** Legs join consecutive stops and times add up, on every day. */
function expectConsistent(trip: Trip) {
  expect(() => tripSchema.parse(trip)).not.toThrow()
  for (const day of trip.days) {
    expect(day.legs).toHaveLength(Math.max(0, day.stops.length - 1))
    day.legs.forEach((leg, i) => {
      expect(leg.fromId).toBe(day.stops[i]!.id)
      expect(leg.toId).toBe(day.stops[i + 1]!.id)
      expect(toMin(day.stops[i + 1]!.arrive)).toBeGreaterThanOrEqual(toMin(day.stops[i]!.depart) + leg.minutes)
    })
    day.stops.forEach((s) => expect(toMin(s.depart) - toMin(s.arrive)).toBe(s.visitMin))
  }
}

const places = (trip: Trip, d: number) => trip.days[d]!.stops.filter((s) => s.kind !== 'food')

describe('applying edits', () => {
  it('removes a stop, re-routes only that day, and keeps other stops as they were', async () => {
    const trip = await plannedTrip()
    const gone = places(trip, 0)[1]!
    const next = await applyChanges(trip, [{ kind: 'remove', stopId: gone.id }], fakeDeps())
    expectConsistent(next)
    expect(next.days[0]!.stops.map((s) => s.id)).not.toContain(gone.id)
    expect(next.days[1]).toBe(trip.days[1])
    const kept = next.days[0]!.stops.find((s) => s.id === places(trip, 0)[0]!.id)!
    expect(kept.summary).toBe(places(trip, 0)[0]!.summary)
    expect(next.lastChange).toMatchObject({ undoable: true, summary: [`Removed ${gone.name}.`] })
  })

  it('moves a stop within its day and says where it went', async () => {
    const trip = await plannedTrip({ meals: [] })
    const first = trip.days[0]!.stops[0]!
    const next = await applyChanges(trip, [{ kind: 'move', stopId: first.id, toIndex: 2 }], fakeDeps())
    expectConsistent(next)
    expect(next.days[0]!.stops[2]!.id).toBe(first.id)
    expect(next.lastChange!.summary[0]).toMatch(new RegExp(`^Moved ${first.name}, now at \\d\\d:\\d\\d\\.$`))
  })

  it('keeps a chosen visit length and shifts the times after it', async () => {
    const trip = await plannedTrip({ meals: [] })
    const [a, b] = trip.days[0]!.stops
    const next = await applyChanges(trip, [{ kind: 'setVisit', stopId: a!.id, minutes: a!.visitMin + 60 }], fakeDeps())
    expect(next.days[0]!.stops[0]!.visitMin).toBe(a!.visitMin + 60)
    expect(toMin(next.days[0]!.stops[1]!.arrive)).toBe(toMin(b!.arrive) + 60)
    expect(next.lastChange!.summary[0]).toMatch(/now has/)
  })

  it('moves a stop to another day at the cheapest spot', async () => {
    const trip = await plannedTrip({ meals: [] })
    const stop = trip.days[0]!.stops[0]!
    const next = await applyChanges(trip, [{ kind: 'moveToDay', stopId: stop.id, toDay: 1 }], fakeDeps())
    expectConsistent(next)
    expect(next.days[1]!.stops.map((s) => s.id)).toContain(stop.id)
    expect(next.lastChange!.summary[0]).toMatch(new RegExp(`^Moved ${stop.name} to day 2 at `))
  })

  it('warns instead of dropping stops when an edit makes a day run long', async () => {
    const trip = await plannedTrip({ meals: [] })
    const stop = trip.days[0]!.stops[0]!
    const next = await applyChanges(trip, [{ kind: 'setVisit', stopId: stop.id, minutes: 600 }], fakeDeps())
    expect(next.days[0]!.stops).toHaveLength(trip.days[0]!.stops.length)
    expect(next.days[0]!.warnings.some((w) => /^Runs \d+ min past 18:00/.test(w))).toBe(true)
    // Undoing that long visit clears the warning again.
    const back = await applyChanges(next, [{ kind: 'setVisit', stopId: stop.id, minutes: 60 }], fakeDeps())
    expect(back.days[0]!.warnings.some((w) => /^Runs /.test(w))).toBe(false)
  })

  it('protects the starting point, and drops it from a day with no places left', async () => {
    const nominatim = fakeNominatim({ 'Hotel Sol': place('Hotel Sol', at(-100, -100)) })
    const trip = await plannedTrip({ startFrom: 'Hotel Sol', meals: [] }, nominatim)
    await expect(applyChanges(trip, [{ kind: 'remove', stopId: 'start-1' }], fakeDeps())).rejects.toBeInstanceOf(EditError)
    const all = trip.days[0]!.stops.filter((s) => s.role !== 'start').map((s) => ({ kind: 'remove' as const, stopId: s.id }))
    const empty = await applyChanges(trip, all, fakeDeps())
    expect(empty.days[0]!.stops).toEqual([])
    // Adding a place back brings the start with it.
    const added = await applyChanges(empty, [{ kind: 'moveToDay', stopId: trip.days[1]!.stops[1]!.id, toDay: 0 }], fakeDeps())
    expect(added.days[0]!.stops[0]).toMatchObject({ id: 'start-1', role: 'start' })
    expectConsistent(added)
  })

  it('changes pace and hours for every day', async () => {
    const trip = await plannedTrip({ meals: [] })
    const next = await applyChanges(
      trip,
      [
        { kind: 'setPace', pace: 'relaxed' },
        { kind: 'setTimes', startTime: '10:30', endTime: '18:00' },
      ],
      fakeDeps(),
    )
    expectConsistent(next)
    expect(next.days.every((d) => d.stops[0]!.arrive === '10:30')).toBe(true)
    expect(next.days[0]!.stops[0]!.visitMin).toBeGreaterThan(trip.days[0]!.stops[0]!.visitMin)
    expect(next.lastChange!.summary).toEqual(expect.arrayContaining(['Pace is now relaxed.', 'Days now run 10:30 to 18:00.']))
    await expect(applyChanges(trip, [{ kind: 'setTimes', startTime: '18:00', endTime: '09:00' }], fakeDeps())).rejects.toThrow(/end after/)
  })

  it('summarises long change lists', () => {
    const before = { request: baseRequest, days: [{ stops: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, arrive: '10:00', visitMin: 30 })) }] }
    const after = { request: baseRequest, days: [{ stops: [] }] }
    const lines = describeChanges(before as unknown as Trip, after as unknown as Trip)
    expect(lines).toHaveLength(8)
    expect(lines.at(-1)).toBe('And 5 more changes.')
  })
})

describe('typed replanning', () => {
  it('turns text into checked edits and applies them', async () => {
    const trip = await plannedTrip({ meals: [] })
    const museum = trip.days.flatMap((d) => d.stops).find((s) => s.name === 'Art Museum')!
    const blank = { stopId: null, day: null, position: null, minutes: null, description: null, pace: null, startTime: null, endTime: null }
    const llm = fakeLlm({
      fast: [
        {
          edits: [
            { ...blank, action: 'remove', stopId: museum.id },
            { ...blank, action: 'set_times', startTime: '10:30' },
            { ...blank, action: 'remove', stopId: 'made-up-id' },
          ],
          note: null,
        },
      ],
    })
    const { trip: next, skipped } = await replan('drop the museum, slower morning', trip, fakeDeps({ llm }))
    expectConsistent(next)
    expect(next.days.flatMap((d) => d.stops).map((s) => s.id)).not.toContain(museum.id)
    expect(next.request.startTime).toBe('10:30')
    expect(skipped).toEqual(['One change named a stop that is not in the plan.'])
    expect(next.lastChange!.summary).toEqual(expect.arrayContaining(['Removed Art Museum.', 'Skipped: One change named a stop that is not in the plan.']))
    // The model saw ids and names, and was told the current hours.
    const input = llm.inputs.fast![0] as { plan: { stops: { id: string }[] }[]; trip: { startTime: string } }
    expect(input.plan[0]!.stops[0]!.id).toBe(trip.days[0]!.stops[0]!.id)
    expect(input.trip.startTime).toBe('09:30')
  })

  it('adds a described place through the Scout and the Verifier', async () => {
    // Planned without Clock Tower, which sits inside the 1-day area.
    const first = fakeLlm({ scout: [scoutPicks(titles.slice(0, 4))], critic: [{ ok: true, issues: [] }] })
    const trip = (await planTrip({ ...baseRequest, days: 1, meals: [] }, fakeDeps({ llm: first }), () => {})).trip
    const inTrip = new Set(trip.days[0]!.stops.map((s) => s.name))
    const spare = 'Clock Tower'
    expect(inTrip.has(spare)).toBe(false)
    const blank = { stopId: null, day: null, position: null, minutes: null, pace: null, startTime: null, endTime: null }
    const llm = fakeLlm({
      fast: [{ edits: [{ ...blank, action: 'add', description: 'something like a garden' }], note: null }],
      scout: [scoutPicks([spare])],
    })
    const { trip: next } = await replan('add a garden', trip, fakeDeps({ llm }))
    const added = next.days[0]!.stops.find((s) => s.name === spare)
    expect(added).toBeTruthy()
    expect(added!.sources[0]?.kind).toBe('wikipedia')
    const scoutInput = llm.inputs.scout![0] as { feedback: string[]; avoid: string[] }
    expect(scoutInput.feedback[0]).toContain('something like a garden')
    expect(scoutInput.avoid).toEqual(expect.arrayContaining([...inTrip]))
  })

  it('explains when nothing can be done, and needs the fast model', async () => {
    const trip = await plannedTrip({ days: 1 })
    const llm = fakeLlm({ fast: [{ edits: [], note: 'I cannot book tickets.' }] })
    await expect(replan('book tickets', trip, fakeDeps({ llm }))).rejects.toThrow('I cannot book tickets.')
    const off = fakeLlm({}, false)
    await expect(replan('drop the museum', trip, fakeDeps({ llm: off }))).rejects.toMatchObject({ code: 'llm_not_configured' })
  })
})

describe('editing API', () => {
  let server: Server | null = null
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  })

  async function start(trip: Trip, deps = fakeDeps()) {
    const store = new MemoryTripStore()
    await store.save(trip)
    server = createServer(createApp({}, { ...deps, store }))
    await new Promise<void>((resolve) => server!.listen(0, resolve))
    const base = `http://localhost:${(server.address() as AddressInfo).port}`
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, body: (await res.json().catch(() => null)) as Trip & { error?: { code: string; message: string } } }
    }
    return { call, store }
  }

  it('edits a day, then undoes it once', async () => {
    const trip = await plannedTrip({ meals: [] })
    const { call } = await start(trip)
    const stop = trip.days[0]!.stops[0]!
    const edited = await call('PATCH', `/api/trips/${trip.id}/days/0`, { edits: [{ op: 'remove', stopId: stop.id }] })
    expect(edited.status).toBe(200)
    expect(edited.body.lastChange).toMatchObject({ undoable: true, summary: [`Removed ${stop.name}.`] })

    const undone = await call('POST', `/api/trips/${trip.id}/undo`)
    expect(undone.status).toBe(200)
    expect(undone.body.days[0]!.stops[0]!.id).toBe(stop.id)
    expect((await call('GET', `/api/trips/${trip.id}`)).body.days[0]!.stops[0]!.id).toBe(stop.id)
    const again = await call('POST', `/api/trips/${trip.id}/undo`)
    expect(again.status).toBe(409)
  })

  it('adds a place found by search, and refuses stale or far edits', async () => {
    const nominatim = fakeNominatim({ 'Tiny Chapel': place('Tiny Chapel', at(150, 150), { category: 'amenity', type: 'place_of_worship' }) })
    const trip = await plannedTrip({ meals: [] })
    const { call } = await start(trip, fakeDeps({ nominatim }))

    const search = (await call('GET', `/api/places/search?q=${encodeURIComponent('Tiny Chapel')}&tripId=${trip.id}`)).body as unknown as {
      places: { name: string }[]
    }
    expect(search.places.map((p) => p.name)).toEqual(['Tiny Chapel'])
    const added = await call('PATCH', `/api/trips/${trip.id}/days/1`, { edits: [{ op: 'add', place: search.places[0] }] })
    expect(added.status).toBe(200)
    expect(added.body.days[1]!.stops.find((s) => s.name === 'Tiny Chapel')).toMatchObject({ mustSee: true, reason: 'You added this.' })

    const far = { ...search.places[0], name: 'Far Place', lat: 10, lon: 10 }
    const tooFar = await call('PATCH', `/api/trips/${trip.id}/days/1`, { edits: [{ op: 'add', place: far }] })
    expect(tooFar.status).toBe(400)
    expect(tooFar.body.error!.message).toMatch(/outside this trip's area/)

    const wrongDay = await call('PATCH', `/api/trips/${trip.id}/days/1`, { edits: [{ op: 'remove', stopId: trip.days[0]!.stops[0]!.id }] })
    expect(wrongDay.status).toBe(400)
    expect((await call('PATCH', `/api/trips/${trip.id}/days/7`, { edits: [{ op: 'remove', stopId: 'x' }] })).status).toBe(404)
    expect((await call('GET', '/api/places/search?q=a')).status).toBe(400)
  })

  it('replans from text and reports a missing model clearly', async () => {
    const trip = await plannedTrip({ meals: [] })
    const blank = { stopId: null, day: null, position: null, minutes: null, description: null, pace: null, startTime: null, endTime: null }
    const llm = fakeLlm({ fast: [{ edits: [{ ...blank, action: 'set_pace', pace: 'relaxed' }], note: null }] })
    const { call } = await start(trip, fakeDeps({ llm }))
    const res = await call('POST', `/api/trips/${trip.id}/replan`, { text: 'slower please' })
    expect(res.status).toBe(200)
    expect(res.body.request.pace).toBe('relaxed')

    server?.close()
    const off = await start(trip, fakeDeps({ llm: fakeLlm({}, false) }))
    const refused = await off.call('POST', `/api/trips/${trip.id}/replan`, { text: 'slower please' })
    expect(refused.status).toBe(400)
    expect(refused.body.error!.code).toBe('llm_not_configured')
  })
})
