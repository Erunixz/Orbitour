import { describe, expect, it } from 'vitest'
import { tripSchema } from '../src/lib/schemas'
import { PlanError } from '../server/pipeline/context'
import { MAX_REVISIONS, planTrip } from '../server/pipeline/pipeline'
import type { ScoutInput } from '../server/pipeline/prompts/scout'
import { buildPool, verifiedPool } from '../server/pipeline/candidates'
import { runVerifier } from '../server/pipeline/verifier'
import type { OsmPlace } from '../server/upstream/overpass'
import type { WikiPage } from '../server/upstream/wikipedia'
import { at, baseRequest, CENTER, fakeDeps, fakeLlm, fakeNominatim, fakeOverpass, fakeWikidata, fakeWikipedia, pages, place, recorder, scoutPicks } from './fakes'

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

const allTitles = ['Old Cathedral', 'Castle Hill', 'Art Museum', 'River Garden', 'Clock Tower', 'Tile Museum', 'Harbour Market', 'Lighthouse Viewpoint']

describe('planning pipeline', () => {
  it('plans a valid 2-day trip with meals, lodging and consistent times', async () => {
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: [{ ok: true, issues: [] }] })
    const { events, emit } = recorder()
    const { trip, usage } = await planTrip(baseRequest, fakeDeps({ llm }), emit)

    expect(() => tripSchema.parse(trip)).not.toThrow()
    expect(trip.days).toHaveLength(2)
    expect(trip.title).toBe('2 days in Testville')
    expect(trip.lodging?.kind).toBe('lodging')
    expect(usage.calls).toBe(2)

    for (const day of trip.days) {
      expect(day.stops.filter((s) => s.kind === 'food')).toHaveLength(1)
      expect(day.legs).toHaveLength(day.stops.length - 1)
      day.legs.forEach((leg, i) => {
        expect(leg.fromId).toBe(day.stops[i]!.id)
        expect(leg.toId).toBe(day.stops[i + 1]!.id)
        expect(leg.estimated).toBe(true)
        expect(toMin(day.stops[i + 1]!.arrive)).toBeGreaterThanOrEqual(toMin(day.stops[i]!.depart) + leg.minutes)
      })
      expect(toMin(day.stops[0]!.arrive)).toBe(toMin('09:30'))
    }
    // The two far stops share a day.
    const farDay = trip.days.find((d) => d.stops.some((s) => s.name === 'Tile Museum'))!
    expect(farDay.stops.map((s) => s.name)).toEqual(expect.arrayContaining(['Harbour Market', 'Lighthouse Viewpoint']))
    // Verified stops carry Wikipedia summaries, sources and credited photos.
    const cathedral = trip.days.flatMap((d) => d.stops).find((s) => s.name === 'Old Cathedral')!
    expect(cathedral.summary).toContain('Testville')
    expect(cathedral.sources[0]?.kind).toBe('wikipedia')
    expect(cathedral.photo?.credit).toMatch(/Wikimedia Commons/)

    // Every crew member reported, in pipeline order.
    const firstSeen = [...new Set(events.map((e) => e.stage))]
    expect(firstSeen).toEqual(['surveyor', 'candidates', 'scout', 'verifier', 'daysplit', 'router', 'food', 'timekeeper', 'weather', 'critic'])
    expect(events.some((e) => e.stage === 'surveyor' && e.data?.area)).toBe(true)
    expect(events.filter((e) => e.stage === 'verifier' && e.data?.stop).length).toBeGreaterThanOrEqual(8)
    expect(events.some((e) => e.stage === 'router' && e.data?.days)).toBe(true)
  })

  it('sends the Scout only real pool titles and drops made-up picks', async () => {
    const llm = fakeLlm({
      scout: [scoutPicks([...allTitles.slice(0, 4), 'Invented Palace', 'Main Street', 'Far Palace'])],
      critic: [{ ok: true, issues: [] }],
    })
    const { events, emit } = recorder()
    await planTrip({ ...baseRequest, days: 1 }, fakeDeps({ llm }), emit)
    const input = llm.inputs.scout![0] as ScoutInput
    expect(input.pool.map((p) => p.title)).not.toContain('Main Street')
    expect(input.wanted).toBe(8)
    const rejected = events.flatMap((e) => (e.data?.rejected ? [e.data.rejected.title] : []))
    expect(rejected).toEqual(expect.arrayContaining(['Invented Palace', 'Far Palace']))
  })

  it('keeps must-see places even when the Scout forgets them', async () => {
    const nominatim = fakeNominatim({ 'Clock Tower': place('Clock Tower', at(300, -700)), 'Nowhere Thing': null })
    const llm = fakeLlm({ scout: [scoutPicks(['Old Cathedral', 'Art Museum'])], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip(
      { ...baseRequest, days: 1, mustSee: ['Clock Tower', 'Nowhere Thing'] },
      fakeDeps({ llm, nominatim }),
      () => {},
    )
    const stops = trip.days[0]!.stops
    const tower = stops.find((s) => s.name === 'Clock Tower')
    expect(tower?.mustSee).toBe(true)
    expect(trip.days[0]!.warnings).toContain('Could not find "Nowhere Thing" in the trip area.')
    const input = llm.inputs.scout![0] as ScoutInput
    expect(input.mustSee).toEqual([
      { typed: 'Clock Tower', foundAs: 'Clock Tower' },
      { typed: 'Nowhere Thing', foundAs: null },
    ])
  })

  it('routes Critic complaints to the Scout and the Timekeeper', async () => {
    const llm = fakeLlm({
      scout: [scoutPicks(allTitles), scoutPicks(allTitles)],
      critic: [
        {
          ok: false,
          issues: [
            { target: 'scout', stopId: 'wiki-103', action: 'replace_stop', complaint: 'Too many gardens for an art lover.' },
            { target: 'timekeeper', stopId: 'wiki-100', action: 'slow_down', complaint: 'Day 1 feels rushed.' },
          ],
        },
        { ok: true, issues: [] },
      ],
    })
    const { trip } = await planTrip(baseRequest, fakeDeps({ llm }), () => {})
    expect(llm.inputs.scout).toHaveLength(2)
    const second = llm.inputs.scout![1] as ScoutInput
    expect(second.feedback[0]).toContain('Too many gardens for an art lover. (about River Garden)')
    expect(second.avoid).toContain('river garden')
    expect(second.pool.map((p) => p.title)).not.toContain('River Garden')
    expect(trip.days.flatMap((d) => d.stops).map((s) => s.name)).not.toContain('River Garden')
    expect(llm.inputs.critic).toHaveLength(2)
  })

  it('stops revising after the limit and keeps the notes as day warnings', async () => {
    const note = { ok: false, issues: [{ target: 'timekeeper', stopId: null, action: 'slow_down', complaint: 'Still a bit rushed.' }] }
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: Array.from({ length: MAX_REVISIONS + 1 }, () => note) })
    const { trip } = await planTrip({ ...baseRequest, days: 1 }, fakeDeps({ llm }), () => {})
    expect(llm.inputs.critic).toHaveLength(MAX_REVISIONS + 1)
    expect(trip.days[0]!.warnings).toContain('Still a bit rushed.')
  })

  it('fixes a day that runs long in code, never dropping must-see stops', async () => {
    const nominatim = fakeNominatim({ 'Art Museum': place('Art Museum', at(-400, -300)) })
    const llm = fakeLlm({ scout: [scoutPicks(allTitles.slice(0, 5))], critic: [{ ok: true, issues: [] }] })
    const { events, emit } = recorder()
    const { trip } = await planTrip(
      { ...baseRequest, days: 1, pace: 'packed', endTime: '13:00', mustSee: ['Art Museum'] },
      fakeDeps({ llm, nominatim }),
      emit,
    )
    const day = trip.days[0]!
    expect(day.stops.some((s) => s.name === 'Art Museum' && s.mustSee)).toBe(true)
    expect(events.some((e) => e.stage === 'timekeeper' && /left out/.test(e.message))).toBe(true)
    const lastVisit = day.stops.filter((s) => s.kind !== 'food').at(-1)!
    // Either it fits, or only must-see stops are left and a warning says so.
    if (toMin(lastVisit.depart) > toMin('13:00')) expect(day.warnings.some((w) => /past 13:00/.test(w))).toBe(true)
  })

  it('starts each day at the starting point, with a leg to the first place', async () => {
    const nominatim = fakeNominatim({ 'Hotel Sol': place('Hotel Sol', at(-100, -100), { category: 'tourism', type: 'hotel' }) })
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip({ ...baseRequest, startFrom: 'Hotel Sol' }, fakeDeps({ llm, nominatim }), () => {})
    expect(() => tripSchema.parse(trip)).not.toThrow()
    trip.days.forEach((day, d) => {
      const [start, first] = day.stops
      expect(start).toMatchObject({ id: `start-${d + 1}`, role: 'start', name: 'Hotel Sol', arrive: '09:30', depart: '09:30', visitMin: 0 })
      expect(first!.role).toBeUndefined()
      expect(day.legs[0]).toMatchObject({ fromId: start!.id, toId: first!.id })
      expect(toMin(first!.arrive)).toBeGreaterThanOrEqual(toMin('09:30') + day.legs[0]!.minutes)
    })
    expect(trip.lodging?.name).toBe('Hotel Sol')
  })

  it('never drops the starting point when a day runs long', async () => {
    const nominatim = fakeNominatim({ 'Hotel Sol': place('Hotel Sol', at(-100, -100)) })
    const llm = fakeLlm({ scout: [scoutPicks(allTitles.slice(0, 5))], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip(
      { ...baseRequest, days: 1, pace: 'packed', endTime: '11:00', startFrom: 'Hotel Sol' },
      fakeDeps({ llm, nominatim }),
      () => {},
    )
    expect(trip.days[0]!.stops[0]?.role).toBe('start')
  })

  it('fails clearly at the Scout when there is no OpenAI key', async () => {
    const { events, emit } = recorder()
    const error = await planTrip(baseRequest, fakeDeps({ llm: fakeLlm({}, false) }), emit).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlanError)
    expect((error as PlanError).code).toBe('llm_not_configured')
    const scout = events.find((e) => e.stage === 'scout')
    expect(scout?.status).toBe('error')
    expect(scout?.message).toMatch(/OPENAI_API_KEY/)
    // The free steps before it still ran.
    expect(events.find((e) => e.stage === 'candidates' && e.status === 'done')).toBeTruthy()
  })

  it('fails clearly for an unknown city', async () => {
    const error = await planTrip({ ...baseRequest, city: 'Atlantis' }, fakeDeps(), () => {}).catch((e: unknown) => e)
    expect((error as PlanError).code).toBe('city_not_found')
  })

  it('finds every meal of the trip with one Overpass query', async () => {
    const overpass = fakeOverpass()
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip({ ...baseRequest, meals: ['lunch', 'dinner'] }, fakeDeps({ llm, overpass }), () => {})
    expect(overpass.foodCalls).toBe(1)
    for (const day of trip.days) {
      const food = day.stops.filter((s) => s.kind === 'food')
      expect(food).toHaveLength(2)
      expect(day.stops.at(-1)!.kind).toBe('food')
      expect(day.stops.at(-1)!.arrive >= '19:00').toBe(true)
    }
  })

  it('carries on without meals when Overpass is down', async () => {
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip(baseRequest, fakeDeps({ llm, overpass: fakeOverpass(true) }), () => {})
    expect(trip.days.flatMap((d) => d.stops).some((s) => s.kind === 'food')).toBe(false)
    expect(trip.days[0]!.warnings.some((w) => /OpenStreetMap/.test(w))).toBe(true)
    expect(trip.lodging).toBeUndefined()
  })

  it('adds dates and weather warnings with a start date in range', async () => {
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)], critic: [{ ok: true, issues: [] }] })
    const { trip } = await planTrip({ ...baseRequest, startDate: '2026-09-27' }, fakeDeps({ llm }), () => {})
    expect(trip.days.map((d) => d.date)).toEqual(['2026-09-27', '2026-09-28'])
    expect(trip.days[0]!.warnings.some((w) => /rain likely/.test(w))).toBe(true)
    expect(trip.days[1]!.warnings.some((w) => /rain likely/.test(w))).toBe(false)
  })

  it('goes on without the Critic when it is not configured', async () => {
    const llm = fakeLlm({ scout: [scoutPicks(allTitles)] })
    llm.missingConfig = (agent) => (agent === 'critic' ? 'Set LLM_MODEL_CRITIC in .env to run this step.' : null)
    const { events, emit } = recorder()
    const { trip } = await planTrip(baseRequest, fakeDeps({ llm }), emit)
    expect(trip.days.length).toBe(2)
    expect(events.find((e) => e.stage === 'critic')?.status).toBe('error')
  })

  it('stops when the client goes away', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await planTrip(baseRequest, fakeDeps(), () => {}, controller.signal).catch((e: unknown) => e)
    expect((error as PlanError).code).toBe('aborted')
  })
})

describe('verifier', () => {
  it('rejects duplicates at the same spot', async () => {
    const wikipedia = fakeWikipedia()
    const { events, emit } = recorder()
    const survey = { label: 'Testville', center: CENTER, radiusM: 5000, startFrom: null, mustSee: [] }
    const picks = scoutPicks(['Old Cathedral', 'Old Cathedral']).picks.map((p) => ({ ...p, kind: 'sight' as const }))
    const { stops, rejected } = await runVerifier(picks, buildPool(pages, CENTER, 5000), survey, fakeDeps({ wikipedia }), emit)
    expect(stops).toHaveLength(1)
    expect(rejected[0]?.reason).toMatch(/same place/)
    expect(events.filter((e) => e.data?.rejected)).toHaveLength(1)
    // One batched lookup for all picks.
    expect(wikipedia.lookups).toHaveLength(1)
  })
})

describe('verified tourist places', () => {
  const tagged = (title: string, tags: Record<string, string>): OsmPlace => {
    const page = pages.find((p) => p.title === title)!
    return { osmId: `node/${page.pageId}`, name: title, lat: page.lat, lon: page.lon, url: '', tags: { ...tags, wikidata: `Q${page.pageId}` } }
  }
  const osm = [
    tagged('Old Cathedral', { amenity: 'place_of_worship', building: 'cathedral', tourism: 'attraction' }),
    tagged('Castle Hill', { historic: 'castle' }),
    tagged('Art Museum', { tourism: 'museum' }),
    tagged('Clock Tower', { man_made: 'tower', tourism: 'attraction' }),
    tagged('River Garden', { leisure: 'garden' }),
    tagged('Tile Museum', { tourism: 'museum' }),
    tagged('Harbour Market', { amenity: 'marketplace', tourism: 'attraction' }),
    tagged('Lighthouse Viewpoint', { tourism: 'viewpoint' }),
  ]

  it('keeps only places tagged on OpenStreetMap, with their OSM kind', () => {
    const byQid = new Map(pages.map((p) => [`Q${p.pageId}`, p]))
    const facts = new Map(pages.map((p) => [`Q${p.pageId}`, { enTitle: p.title, sitelinks: 10 }]))
    const pool = verifiedPool(osm.slice(0, 3), byQid, facts, CENTER, 5000)
    expect(pool.map((c) => c.title).sort()).toEqual(['Art Museum', 'Castle Hill', 'Old Cathedral'])
    expect(pool.find((c) => c.title === 'Castle Hill')).toMatchObject({ kind: 'sight', osmType: 'castle', sitelinks: 10 })
    expect(pool.find((c) => c.title === 'Old Cathedral')?.osmType).toBe('cathedral')
  })

  it('drops little-known places when there are enough famous ones', () => {
    const byQid = new Map<string, WikiPage>(pages.map((p) => [`Q${p.pageId}`, { ...p, views: 10 }]))
    const many = Array.from({ length: 25 }, (_, i) => ({ ...osm[0]!, tags: { ...osm[0]!.tags, wikidata: `Q${1000 + i}` } }))
    for (let i = 0; i < 25; i++) byQid.set(`Q${1000 + i}`, { ...pages[0]!, pageId: 1000 + i, title: `Famous ${i}` })
    const facts = new Map<string, { enTitle: string; sitelinks: number }>([...byQid].map(([q, p]) => [q, { enTitle: p.title, sitelinks: q.startsWith('Q10') && q.length === 5 ? 30 : 1 }]))
    const pool = verifiedPool([...osm, ...many], byQid, facts, CENTER, 5000)
    expect(pool.every((c) => c.title.startsWith('Famous'))).toBe(true)
  })

  it('plans from verified places and tells the Scout how famous each is', async () => {
    const overpass = { ...fakeOverpass(), attractions: async () => osm }
    const llm = fakeLlm({ scout: [scoutPicks(['Old Cathedral', 'Castle Hill', 'Main Street', 'Central Station'])], critic: [{ ok: true, issues: [] }] })
    const { events, emit } = recorder()
    await planTrip({ ...baseRequest, days: 1 }, fakeDeps({ llm, overpass, wikidata: fakeWikidata({ 'Castle Hill': 80 }) }), emit)
    const input = llm.inputs.scout![0] as ScoutInput
    expect(input.pool.map((p) => p.title)).not.toContain('Main Street')
    expect(input.pool.find((p) => p.title === 'Castle Hill')).toMatchObject({ fame: 80 })
    expect(input.pool.find((p) => p.title === 'Castle Hill')?.about).toMatch(/^castle\./)
    const rejected = events.flatMap((e) => (e.data?.rejected ? [e.data.rejected.title] : []))
    expect(rejected).toEqual(expect.arrayContaining(['Main Street', 'Central Station']))
    expect(events.some((e) => e.stage === 'candidates' && /verified tourist places/.test(e.message))).toBe(true)
  })
})
