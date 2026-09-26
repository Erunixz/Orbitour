import { describe, expect, it } from 'vitest'
import { MemoryCache } from '../server/cache'
import { parseMatrix } from '../server/upstream/googleRoutes'
import { createNominatim, viewbox } from '../server/upstream/nominatim'
import { addDays, parseDaily } from '../server/upstream/openMeteo'
import { createOverpass, foodQuery, OverpassDownError, parseElements } from '../server/upstream/overpass'
import { RateGate, userAgent } from '../server/upstream/politeness'
import { createWikipedia, stripHtml, trimSummary } from '../server/upstream/wikipedia'
import { CENTER } from './fakes'

const noSleep = async () => {}

type Call = { url: string; init?: RequestInit }

function recordingFetch(respond: (call: Call) => Response) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('politeness', () => {
  it('builds a User-Agent with the contact email only when set', () => {
    expect(userAgent({})).toBe('Orbitour/0.1 trip planner')
    expect(userAgent({ CONTACT_EMAIL: ' me@example.com ' })).toBe('Orbitour/0.1 trip planner (me@example.com)')
  })

  it('spaces calls at least the gap apart, even when started together', async () => {
    let clock = 0
    const starts: number[] = []
    const gate = new RateGate(
      1000,
      () => clock,
      async (ms) => {
        clock += ms
      },
    )
    await Promise.all([1, 2, 3].map(() => gate.run(async () => starts.push(clock))))
    expect(starts).toEqual([0, 1000, 2000])
  })

  it('keeps going after a failed call', async () => {
    const gate = new RateGate(0)
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await gate.run(async () => 'next')).toBe('next')
  })
})

describe('Nominatim', () => {
  it('searches inside a bounded box with a User-Agent, and caches', async () => {
    const { impl, calls } = recordingFetch(() =>
      json([
        { osm_type: 'node', osm_id: 5, lat: '38.72', lon: '-9.14', name: 'Clock Tower', display_name: 'Clock Tower, Testville', category: 'tourism', type: 'attraction' },
        { osm_type: 'node', osm_id: 6, lat: '38.80', lon: '-9.14', name: 'Far', display_name: 'Far, Testville', category: 'tourism', type: 'attraction' },
      ]),
    )
    const client = createNominatim({ userAgent: 'Test/1', cache: new MemoryCache(), gate: new RateGate(0), retry: { fetchImpl: impl } })
    const near = { center: CENTER, radiusM: 2000 }
    const places = await client.search('clock tower', { near })
    expect(places.map((p) => p.name)).toEqual(['Clock Tower'])
    expect(places[0]!.osmUrl).toBe('https://www.openstreetmap.org/node/5')
    const url = new URL(calls[0]!.url)
    expect(url.searchParams.get('bounded')).toBe('1')
    expect(url.searchParams.get('viewbox')).toBe(viewbox(CENTER, 2000))
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe('Test/1')
    await client.search('Clock Tower ', { near })
    expect(calls).toHaveLength(1)
  })
})

describe('Wikipedia', () => {
  it('follows redirects in lookups and skips disambiguation pages', async () => {
    const { impl } = recordingFetch(() =>
      json({
        query: {
          normalized: [{ from: 'eiffel tower', to: 'Eiffel tower' }],
          redirects: [{ from: 'Eiffel tower', to: 'Eiffel Tower' }],
          pages: [
            { pageid: 1, title: 'Eiffel Tower', coordinates: [{ lat: 48.858, lon: 2.294 }], description: 'Tower in Paris', extract: 'The Eiffel Tower is a tower. It is tall. It is iron. It is old.', pageimage: 'Tower.jpg' },
            { pageid: 2, title: 'Mercury', coordinates: [{ lat: 1, lon: 1 }], pageprops: { disambiguation: '' } },
            { title: 'Nope', missing: true },
          ],
        },
      }),
    )
    const wiki = createWikipedia({ userAgent: 'Test/1', cache: new MemoryCache(), gate: new RateGate(0), retry: { fetchImpl: impl } })
    const found = await wiki.lookup(['eiffel tower', 'Mercury', 'Nope'])
    expect(found.get('eiffel tower')).toMatchObject({ pageId: 1, title: 'Eiffel Tower', image: 'Tower.jpg', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' })
    expect(found.get('Mercury')).toBeNull()
    expect(found.get('Nope')).toBeNull()
  })

  it('credits Commons photos and skips ones without an author or license', async () => {
    const { impl, calls } = recordingFetch(() =>
      json({
        query: {
          pages: [
            { title: 'File:Good.jpg', imageinfo: [{ thumburl: 'https://upload/good.jpg', descriptionurl: 'https://commons/Good', extmetadata: { Artist: { value: '<a href="x">Ann</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
            { title: 'File:Bad.jpg', imageinfo: [{ thumburl: 'https://upload/bad.jpg', descriptionurl: 'https://commons/Bad', extmetadata: {} }] },
          ],
        },
      }),
    )
    const cache = new MemoryCache()
    const wiki = createWikipedia({ userAgent: 'Test/1', cache, gate: new RateGate(0), retry: { fetchImpl: impl } })
    const photos = await wiki.photos(['Good.jpg', 'Bad.jpg'])
    expect(photos.get('Good.jpg')).toEqual({ url: 'https://upload/good.jpg', credit: 'Photo: Ann, CC BY-SA 4.0, via Wikimedia Commons', pageUrl: 'https://commons/Good' })
    expect(photos.has('Bad.jpg')).toBe(false)
    // Both answers are cached, including "no usable photo".
    await wiki.photos(['Good.jpg', 'Bad.jpg'])
    expect(calls).toHaveLength(1)
  })

  it('cleans HTML and trims summaries to whole sentences', () => {
    expect(stripHtml('<span>Jean &amp; Marie</span>')).toBe('Jean & Marie')
    expect(trimSummary('The Sé (Portuguese: Sé de Lisboa (listen)) is a cathedral. It is old.')).toBe('The Sé is a cathedral. It is old.')
    const long = 'First sentence here. '.repeat(30)
    const trimmed = trimSummary(long)
    expect(trimmed.length).toBeLessThanOrEqual(280)
    expect(trimmed.endsWith('.')).toBe(true)
  })
})

describe('Overpass', () => {
  it('parses nodes and ways, nearest first, skipping unnamed places', () => {
    const places = parseElements(
      {
        elements: [
          { type: 'way', id: 2, center: { lat: CENTER.lat + 0.01, lon: CENTER.lon }, tags: { name: 'Far' } },
          { type: 'node', id: 1, lat: CENTER.lat, lon: CENTER.lon, tags: { name: 'Near' } },
          { type: 'node', id: 3, lat: CENTER.lat, lon: CENTER.lon, tags: {} },
        ],
      },
      CENTER,
    )
    expect(places.map((p) => [p.name, p.osmId])).toEqual([
      ['Near', 'node/1'],
      ['Far', 'way/2'],
    ])
    const query = foodQuery([CENTER, { lat: 1, lon: 2 }], 500)
    expect(query).toContain('(around:500,38.71690,-9.13990)')
    expect(query).toContain('(around:500,1.00000,2.00000)')
  })

  it('fails over to the next mirror, then reports the service as down', async () => {
    const { impl, calls } = recordingFetch((call) =>
      call.url.includes('second') ? json({ elements: [{ type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'Cafe' } }] }) : new Response('busy', { status: 504 }),
    )
    const retry = { fetchImpl: impl, sleep: noSleep }
    const overpass = createOverpass({ userAgent: 'T', cache: new MemoryCache(), mirrors: ['https://first/api', 'https://second/api'], retry })
    expect((await overpass.food([CENTER], 500)).map((p) => p.name)).toEqual(['Cafe'])
    // A busy mirror gets one try, then the next mirror is used.
    expect(calls.filter((c) => c.url.includes('first'))).toHaveLength(1)
    expect(await overpass.food([], 500)).toEqual([])

    const down = createOverpass({ userAgent: 'T', cache: new MemoryCache(), mirrors: ['https://first/api'], retry })
    await expect(down.lodging(CENTER, 500)).rejects.toBeInstanceOf(OverpassDownError)
  })
})

describe('Routes matrix and forecast parsing', () => {
  it('builds a square matrix of minutes, leaving gaps where there is no route', () => {
    const grid = parseMatrix(
      [
        { destinationIndex: 1, duration: '600s', condition: 'ROUTE_EXISTS' },
        { originIndex: 1, duration: '300s', condition: 'ROUTE_EXISTS' },
        { originIndex: 1, destinationIndex: 1, duration: '0s', condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
      ],
      2,
    )
    expect(grid).toEqual([
      [0, 10],
      [5, 0],
    ])
    expect(parseMatrix([{ originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' }], 2)[0]![1]).toBeNull()
  })

  it('reads the daily forecast and counts dates', () => {
    const days = parseDaily({
      daily: {
        time: ['2026-10-01', '2026-10-02'],
        weather_code: [61, null],
        temperature_2m_max: [18, null],
        temperature_2m_min: [11, 9],
        precipitation_probability_max: [80, 5],
      },
    })
    expect(days).toEqual([{ date: '2026-10-01', code: 61, maxC: 18, minC: 11, rainChance: 80 }])
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
