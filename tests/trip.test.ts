import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { distanceM } from '../src/lib/geo'
import { decodePolyline } from '../src/lib/polyline'
import { tripSchema } from '../src/lib/schemas'
import { fixtureNames, FixtureError, loadFixture } from '../src/trip/fixtures'
import { formatDate } from '../src/trip/format'
import { backView, dayView, hashForView, nextView, stopView, viewFromHash, type View } from '../src/trip/tripNav'

const counts = [3, 2]

describe('trip navigation', () => {
  it('moves through a day and on to the next day', () => {
    let v: View = { day: 0, stop: null }
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      v = nextView(v, counts)
      seen.push(`${v.day}:${v.stop}`)
    }
    expect(seen).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1', '1:1'])
  })

  it('goes back to the day overview, then to the last stop of the day before', () => {
    expect(backView({ day: 1, stop: 1 }, counts)).toEqual({ day: 1, stop: 0 })
    expect(backView({ day: 1, stop: 0 }, counts)).toEqual({ day: 1, stop: null })
    expect(backView({ day: 1, stop: null }, counts)).toEqual({ day: 0, stop: 2 })
    expect(backView({ day: 0, stop: null }, counts)).toEqual({ day: 0, stop: null })
  })

  it('skips days with no stops', () => {
    expect(nextView({ day: 0, stop: 0 }, [1, 0, 2])).toEqual({ day: 2, stop: 0 })
    expect(backView({ day: 2, stop: null }, [1, 0, 2])).toEqual({ day: 0, stop: 0 })
  })

  it('clamps day and stop picks', () => {
    expect(dayView(9, counts)).toEqual({ day: 1, stop: null })
    expect(stopView(0, 7, counts)).toEqual({ day: 0, stop: null })
    expect(stopView(1, 1, counts)).toEqual({ day: 1, stop: 1 })
  })

  it('reads and writes the address hash', () => {
    expect(viewFromHash('#day=2&stop=1', counts)).toEqual({ day: 1, stop: 0 })
    expect(viewFromHash('#day=2', counts)).toEqual({ day: 1, stop: null })
    expect(viewFromHash('#stop=3', counts)).toEqual({ day: 0, stop: 2 })
    expect(viewFromHash('#day=5&stop=1', counts)).toEqual({ day: 0, stop: null })
    expect(viewFromHash('#day=1&stop=9', counts)).toEqual({ day: 0, stop: null })
    expect(viewFromHash('', counts)).toEqual({ day: 0, stop: null })

    for (const v of [{ day: 0, stop: null }, { day: 1, stop: null }, { day: 1, stop: 1 }, { day: 0, stop: 2 }]) {
      expect(viewFromHash(hashForView(v), counts)).toEqual(v)
    }
    expect(hashForView({ day: 0, stop: null })).toBe('')
  })
})

describe('fixtures', () => {
  it('lists the sample trip and loads it', async () => {
    expect(fixtureNames).toContain('paris-2day')
    const trip = await loadFixture('paris-2day')
    expect(trip.days).toHaveLength(2)
  })

  it('explains an unknown fixture name', async () => {
    await expect(loadFixture('nope')).rejects.toThrow(FixtureError)
    await expect(loadFixture('nope')).rejects.toThrow(/paris-2day/)
  })

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

  for (const name of fixtureNames) {
    const raw: unknown = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

    it(`${name} is a valid, consistent trip`, () => {
      const trip = tripSchema.parse(raw)
      const ids = new Set<string>()
      trip.days.forEach((day, d) => {
        expect(day.index).toBe(d)
        expect(day.legs).toHaveLength(Math.max(0, day.stops.length - 1))
        day.stops.forEach((stop, i) => {
          expect(ids.has(stop.id), `duplicate id ${stop.id}`).toBe(false)
          ids.add(stop.id)
          expect(toMin(stop.depart) - toMin(stop.arrive)).toBe(stop.visitMin)
          expect(distanceM(trip.center, stop)).toBeLessThanOrEqual(trip.radiusM)
          expect(toMin(stop.arrive)).toBeGreaterThanOrEqual(toMin(trip.request.startTime))
          expect(toMin(stop.depart)).toBeLessThanOrEqual(toMin(trip.request.endTime))

          const leg = day.legs[i]
          const next = day.stops[i + 1]
          if (!leg || !next) return
          expect(leg.fromId).toBe(stop.id)
          expect(leg.toId).toBe(next.id)
          // Arrival allows for the travel time, rounded up to at most 5 spare minutes.
          const gap = toMin(next.arrive) - toMin(stop.depart)
          expect(gap).toBeGreaterThanOrEqual(leg.minutes)
          expect(gap).toBeLessThan(leg.minutes + 5)
          const path = decodePolyline(leg.polyline)
          expect(distanceM(path[0]!, stop)).toBeLessThan(50)
          expect(distanceM(path[path.length - 1]!, next)).toBeLessThan(50)
        })
      })
    })
  }
})

describe('trip schema', () => {
  it('rejects bad times and missing fields', () => {
    const trip = tripSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/paris-2day.json', import.meta.url), 'utf8')))
    const badTime = structuredClone(trip)
    badTime.days[0]!.stops[0]!.arrive = '9:30'
    expect(tripSchema.safeParse(badTime).success).toBe(false)

    const { title: _title, ...noTitle } = trip
    expect(tripSchema.safeParse(noTitle).success).toBe(false)
  })

  it('formats optional day dates', () => {
    expect(formatDate(undefined)).toBeNull()
    expect(formatDate('not a date')).toBeNull()
    expect(formatDate('2026-10-03')).toMatch(/3/)
  })
})
