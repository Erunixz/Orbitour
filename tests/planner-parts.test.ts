import { describe, expect, it } from 'vitest'
import { distanceM } from '../src/lib/geo'
import type { Leg } from '../src/lib/types'
import { buildPool, notability, searchPoints } from '../server/pipeline/candidates'
import type { PlannedStop } from '../server/pipeline/context'
import { chooseStops, splitIntoDays } from '../server/pipeline/daySplit'
import { dietTags, foodSummary, lunchSlot, pickFood, pickLodging } from '../server/pipeline/food'
import { bestOrder, pathCost } from '../server/pipeline/order'
import { guessKind, isDestination, kindFromOsm, osmSummary } from '../server/pipeline/places'
import { bboxRadiusM, radiusForDays, tripRadius } from '../server/pipeline/surveyor'
import { audit, dropCandidate, schedule, toMinutes, toTime, visitMinutes } from '../server/pipeline/timekeeper'
import { displayName } from '../server/pipeline/verifier'
import { weatherNote } from '../server/pipeline/weather'
import { at, baseRequest, CENTER, osm, pages, place } from './fakes'

const stop = (id: string, p: { lat: number; lon: number }, extra: Partial<PlannedStop> = {}): PlannedStop => ({
  id,
  name: id,
  kind: 'sight',
  ...p,
  summary: '',
  reason: '',
  photo: null,
  sources: [],
  mustSee: false,
  importance: 3,
  ...extra,
})

const leg = (fromId: string, toId: string, minutes: number): Leg => ({
  fromId,
  toId,
  mode: 'walk',
  minutes,
  meters: minutes * 75,
  polyline: '',
  estimated: true,
})

describe('place rules', () => {
  it('keeps sights and drops streets, districts, stations, people and events', () => {
    expect(isDestination('Old Cathedral', 'Cathedral in Testville')).toBe(true)
    expect(isDestination('Sainte-Chapelle', 'Chapel in the 1st arrondissement of Paris')).toBe(true)
    expect(isDestination('Montmartre', 'Hill in the 18th arrondissement of Paris')).toBe(true)
    expect(isDestination('Main Street', 'Street in Testville')).toBe(false)
    expect(isDestination('Le Marais', 'Historic district of Paris')).toBe(false)
    expect(isDestination('Gare du Nord', 'Railway station in Paris')).toBe(false)
    expect(isDestination('Some Person', 'French painter (1840–1926)')).toBe(false)
    expect(isDestination('Some Company', 'French luxury goods company')).toBe(false)
    expect(isDestination('Battle of Somewhere', 'Battle in 1815')).toBe(false)
    expect(isDestination('List of museums in Paris', '')).toBe(false)
    // Seen in real Lisbon results.
    expect(isDestination('PIDE', '1933–1969 Portuguese secret police force')).toBe(false)
    expect(isDestination('National Republican Guard', 'National gendarmerie force of Portugal')).toBe(false)
    expect(isDestination('São Nicolau, Lisbon', 'Civil parish in Lisbon, Portugal')).toBe(false)
    expect(isDestination('Supreme Court of Justice', 'Highest court in Portugal')).toBe(false)
    expect(isDestination('São Jorge Castle', 'Historic castle in Lisbon, Portugal')).toBe(true)
    expect(isDestination('Teatro Nacional de São Carlos', 'Building in Lisbon, Portugal')).toBe(true)
    expect(isDestination('Lisbon', 'Capital and largest city of Portugal')).toBe(false)
    expect(isDestination('Portuguese Football Federation', 'Governing body of football in Portugal')).toBe(false)
    expect(isDestination('Lisbon City Hall', 'City hall in Lisbon')).toBe(true)
    expect(isDestination('2025 Ascensor da Glória derailment', 'Funicular accident in Lisbon')).toBe(false)
    expect(isDestination('Some Bridge', 'Site of a 1966 collapse')).toBe(false)
  })

  it('guesses the kind of stop', () => {
    expect(guessKind('Louvre', 'Art museum in Paris')).toBe('museum')
    expect(guessKind('Luxembourg Garden', 'Public garden in Paris')).toBe('park')
    expect(guessKind('Eiffel Tower', 'Tower in Paris')).toBe('viewpoint')
    expect(guessKind('Notre-Dame', 'Cathedral in Paris')).toBe('sight')
    expect(guessKind('Marché', 'Covered market')).toBe('market')
    expect(guessKind('Thing', 'Something odd')).toBe('other')
    expect(guessKind('Café A Brasileira', 'Coffeehouse in Lisbon')).toBe('food')
    expect(guessKind('Musée Rodin', '')).toBe('museum')
    expect(guessKind('Santa Justa Lift', 'Municipal elevator in Lisbon, Portugal')).toBe('viewpoint')
    expect(kindFromOsm('tourism', 'museum')).toBe('museum')
    expect(osmSummary('place_of_worship', 'Saint X, Rue Y, Paris, France')).toBe('Place of worship in Rue Y, Paris.')
    expect(osmSummary('hotel', 'Hotel Z, 123, Rua 1º de Dezembro, Lisbon, Portugal')).toBe('Hotel in Rua 1º de Dezembro, Lisbon.')
  })

  it('removes a disambiguation suffix from names', () => {
    expect(displayName('Panthéon (Paris)')).toBe('Panthéon')
    expect(displayName('Louvre')).toBe('Louvre')
  })
})

describe('candidate pool', () => {
  it('searches a ring of points for big areas', () => {
    expect(searchPoints(CENTER, 2000)).toHaveLength(1)
    const points = searchPoints(CENTER, 6000)
    expect(points).toHaveLength(7)
    for (const p of points.slice(1)) expect(distanceM(p.point, CENTER)).toBeCloseTo(3300, -2)
  })

  it('ranks by notability and filters non-destinations and far pages', () => {
    const pool = buildPool([...pages, pages[0]!], CENTER, 5000)
    const titles = pool.map((c) => c.title)
    expect(titles).not.toContain('Main Street')
    expect(titles).not.toContain('Central Station')
    expect(titles).not.toContain('Far Palace')
    expect(titles.filter((t) => t === 'Old Cathedral')).toHaveLength(1)
    expect(titles[0]).toBe('Castle Hill')
    expect(notability({ views: 100_000, length: 1000 })).toBeGreaterThan(notability({ views: 100, length: 1000 }))
  })
})

describe('surveyor radius', () => {
  it('grows with days up to a cap and shrinks for small towns', () => {
    expect(radiusForDays(1)).toBe(3000)
    expect(radiusForDays(2)).toBe(4200)
    expect(radiusForDays(7)).toBe(8000)
    const town = place('Tiny', CENTER, { bbox: [38.71, 38.72, -9.145, -9.135] })
    expect(tripRadius(3, town)).toBe(1500)
    expect(bboxRadiusM([0, 0.01, 0, 0.01])).toBeCloseTo(786, -1)
  })
})

describe('visiting order', () => {
  // Points on a line at 0, 1, 2, 3, 4 km; travel time is the distance.
  const line = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Math.abs(i - j)))

  it('finds the straight path by brute force', () => {
    const cost = line(6)
    const order = bestOrder([3, 0, 5, 1, 4, 2], cost)
    expect(pathCost(order, cost, null)).toBe(5)
  })

  it('uses nearest neighbour plus 2-opt for bigger days', () => {
    const cost = line(11)
    const order = bestOrder([5, 9, 0, 3, 10, 1, 7, 2, 8, 4, 6], cost)
    expect(pathCost(order, cost, null)).toBe(10)
  })

  it('starts next to a fixed start point', () => {
    const cost = line(5)
    // Node 4 is the hotel at the east end.
    expect(bestOrder([0, 1, 2, 3], cost, 4)).toEqual([3, 2, 1, 0])
  })
})

describe('day split', () => {
  it('keeps must-see stops and the most important others', () => {
    const stops = [
      stop('a', at(0, 0), { importance: 1, mustSee: true }),
      stop('b', at(0, 100), { importance: 5 }),
      stop('c', at(0, 200), { importance: 2 }),
      stop('d', at(0, 300), { importance: 4 }),
    ]
    const { kept, dropped } = chooseStops(stops, 3)
    expect(kept.map((s) => s.id)).toEqual(['a', 'b', 'd'])
    expect(dropped.map((s) => s.id)).toEqual(['c'])
  })

  it('groups nearby stops on the same day, nearest group first', () => {
    const west = [0, 1, 2].map((i) => stop(`w${i}`, at(i * 100, -5000)))
    const east = [0, 1, 2].map((i) => stop(`e${i}`, at(i * 100, 5000)))
    const days = splitIntoDays([...east, ...west], 2, at(0, -6000))
    expect(days[0]!.map((s) => s.id).sort()).toEqual(['w0', 'w1', 'w2'])
    expect(days[1]!.map((s) => s.id).sort()).toEqual(['e0', 'e1', 'e2'])
  })

  it('evens out lopsided days and pads empty ones', () => {
    const cluster = Array.from({ length: 8 }, (_, i) => stop(`s${i}`, at(i * 50, 0)))
    const days = splitIntoDays([...cluster, stop('far', at(0, 9000))], 2, CENTER)
    expect(Math.max(...days.map((d) => d.length))).toBeLessThanOrEqual(Math.ceil(9 / 2) + 1)
    expect(splitIntoDays([stop('only', CENTER)], 3, CENTER).map((d) => d.length)).toEqual([1, 0, 0])
  })
})

describe('timekeeper', () => {
  it('sets visit minutes by kind, pace and party', () => {
    expect(visitMinutes({ kind: 'museum' }, baseRequest)).toBe(120)
    expect(visitMinutes({ kind: 'museum' }, { ...baseRequest, pace: 'relaxed' })).toBe(150)
    expect(visitMinutes({ kind: 'sight' }, { ...baseRequest, pace: 'packed', party: 'easy' })).toBe(55)
    expect(visitMinutes({ kind: 'food', meal: 'dinner' }, baseRequest)).toBe(90)
    expect(visitMinutes({ kind: 'lodging' }, baseRequest)).toBe(0)
  })

  it('schedules with travel time, rounding arrivals up to 5 minutes', () => {
    const stops = [stop('a', CENTER), stop('b', CENTER, { kind: 'museum' })]
    const timed = schedule(stops, [leg('a', 'b', 12)], baseRequest)
    expect(timed.map((s) => [s.arrive, s.depart])).toEqual([
      ['09:30', '10:30'],
      ['10:45', '12:45'],
    ])
    expect(timed[0]).not.toHaveProperty('importance')
    expect(toTime(toMinutes('23:50') + 30)).toBe('23:55')
  })

  it('never starts meals too early', () => {
    const stops = [stop('a', CENTER), stop('lunch', CENTER, { kind: 'food', meal: 'lunch' }), stop('dinner', CENTER, { kind: 'food', meal: 'dinner' })]
    const timed = schedule(stops, [leg('a', 'lunch', 5), leg('lunch', 'dinner', 5)], baseRequest)
    expect(timed.map((s) => s.arrive)).toEqual(['09:30', '11:45', '19:00'])
    const notes = audit(timed, [leg('a', 'lunch', 5), leg('lunch', 'dinner', 5)], stops, baseRequest, 5)
    expect(notes.find((n) => n.kind === 'free_time')?.message).toBe('Free time from 12:45 until dinner at 19:00.')
  })

  it('audits overruns, long legs and late lunch; dinner may run late', () => {
    const planned = [stop('a', CENTER, { kind: 'museum' }), stop('b', CENTER, { kind: 'museum' }), stop('c', CENTER, { kind: 'museum' })]
    const legs = [leg('a', 'b', 60), leg('b', 'c', 20)]
    const req = { ...baseRequest, endTime: '15:00' }
    const kinds = audit(schedule(planned, legs, req), legs, planned, req, 5).map((i) => i.kind)
    expect(kinds).toContain('overrun')
    expect(kinds).toContain('long_leg')

    const withDinner = [stop('a', CENTER), stop('d', CENTER, { kind: 'food', meal: 'dinner' })]
    const dl = [leg('a', 'd', 10)]
    const short = { ...baseRequest, endTime: '11:00' }
    expect(audit(schedule(withDinner, dl, short), dl, withDinner, short, 5).map((i) => i.kind)).not.toContain('overrun')
  })

  it('drops the least important stop that is not a must-see or a meal', () => {
    const planned = [
      stop('must', CENTER, { importance: 1, mustSee: true }),
      stop('lunch', CENTER, { importance: 1, meal: 'lunch' }),
      stop('low', CENTER, { importance: 2 }),
      stop('high', CENTER, { importance: 5 }),
    ]
    expect(dropCandidate(planned)).toBe(2)
    expect(dropCandidate([planned[0]!, planned[1]!])).toBe(-1)
  })
})

describe('food finder', () => {
  it('puts lunch after the stop that ends closest to 12:30', () => {
    const stops = [stop('a', CENTER, { kind: 'museum' }), stop('b', CENTER), stop('c', CENTER)]
    // a: 09:30-11:30, b: 11:40-12:40, c: 12:50-13:50
    expect(lunchSlot(stops, [leg('a', 'b', 10), leg('b', 'c', 10)], baseRequest)).toBe(2)
    expect(lunchSlot([], [], baseRequest)).toBe(0)
  })

  it('prefers places that fit the diet, then the preferred kind, then the nearest', () => {
    const places = [
      osm(1, 'Near Cafe', CENTER, { amenity: 'cafe' }),
      osm(2, 'Near Grill', CENTER),
      osm(3, 'Veggie Place', CENTER, { 'diet:vegetarian': 'yes' }),
    ]
    expect(pickFood(places, undefined, 'restaurant', new Set())?.name).toBe('Near Grill')
    expect(pickFood(places, 'Vegetarian please', 'restaurant', new Set())?.name).toBe('Veggie Place')
    expect(pickFood(places, undefined, 'restaurant', new Set(['node/2']))?.name).toBe('Veggie Place')
    expect(dietTags('vegan and gluten free')).toEqual(['diet:vegan', 'diet:gluten_free'])
    expect(dietTags('no fish')).toEqual([])
  })

  it('picks lodging by budget and writes summaries from tags', () => {
    const lodging = [osm(1, 'Hotel', CENTER, { tourism: 'hotel' }), osm(2, 'Hostel', CENTER, { tourism: 'hostel' })]
    expect(pickLodging(lodging, 'free')?.name).toBe('Hostel')
    expect(pickLodging(lodging, 'any')?.name).toBe('Hotel')
    expect(foodSummary(osm(1, 'X', CENTER, { cuisine: 'french;italian' }))).toBe('Restaurant, french and italian food.')
    expect(foodSummary(osm(1, 'X', CENTER, { amenity: 'cafe' }))).toBe('Café.')
  })
})

describe('weather notes', () => {
  const day = { date: '2026-10-01', code: 1, maxC: 20, minC: 12, rainChance: 10 }
  it('warns only about notable weather', () => {
    expect(weatherNote(day)).toBeNull()
    expect(weatherNote({ ...day, rainChance: 70 })).toMatch(/rain likely \(70%\)/)
    expect(weatherNote({ ...day, maxC: 35 })).toMatch(/hot/)
    expect(weatherNote({ ...day, code: 96 })).toMatch(/thunderstorms/)
    expect(weatherNote({ ...day, code: 73 })).toMatch(/snow/)
    expect(weatherNote({ ...day, maxC: 1, minC: -4 })).toMatch(/cold/)
  })
})
