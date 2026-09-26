import { describe, expect, it } from 'vitest'
import { bearingDeg, centroid, distanceM } from '../src/lib/geo'
import { directionsUrl } from '../src/lib/mapsLink'
import { SceneFrame } from '../src/map/sceneFrame'

const paris = { lat: 48.8566, lon: 2.3522 }

describe('geo helpers', () => {
  it('measures a known distance', () => {
    // Eiffel Tower to Louvre pyramid is about 3.1 km.
    const d = distanceM({ lat: 48.85826, lon: 2.2945 }, { lat: 48.86106, lon: 2.33583 })
    expect(d).toBeGreaterThan(3000)
    expect(d).toBeLessThan(3150)
  })

  it('gives compass bearings', () => {
    expect(bearingDeg(paris, { lat: 48.9, lon: 2.3522 })).toBeCloseTo(0, 3)
    expect(bearingDeg(paris, { lat: 48.8566, lon: 2.4 })).toBeCloseTo(90, 0)
    expect(bearingDeg(paris, { lat: 48.8, lon: 2.3522 })).toBeCloseTo(180, 3)
  })

  it('averages points', () => {
    expect(centroid([{ lat: 0, lon: 0 }, { lat: 2, lon: 4 }])).toEqual({ lat: 1, lon: 2 })
    expect(() => centroid([])).toThrow()
  })

  it('builds a Google Maps directions link', () => {
    const url = new URL(directionsUrl({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, 'walk'))
    expect(url.searchParams.get('destination')).toBe('1,2')
    expect(url.searchParams.get('origin')).toBe('3,4')
    expect(url.searchParams.get('travelmode')).toBe('walking')
  })
})

describe('SceneFrame', () => {
  const frame = new SceneFrame(paris)

  it('puts the center at the origin', () => {
    const p = frame.toScene(paris)
    expect(p.length()).toBeLessThan(0.01)
  })

  it('maps height to +Y at the center', () => {
    expect(frame.toScene(paris, 100).y).toBeCloseTo(100, 3)
  })

  it('maps north to +Z and east to -X', () => {
    const north = frame.toScene({ lat: paris.lat + 0.01, lon: paris.lon })
    expect(north.z).toBeGreaterThan(1100)
    expect(Math.abs(north.x)).toBeLessThan(1)

    const east = frame.toScene({ lat: paris.lat, lon: paris.lon + 0.01 })
    expect(east.x).toBeLessThan(-700)
    expect(Math.abs(east.z)).toBeLessThan(5)
  })

  it('agrees with great-circle distance', () => {
    const other = { lat: 48.87, lon: 2.3 }
    const p = frame.toScene(other)
    const flat = Math.hypot(p.x, p.z)
    expect(Math.abs(flat - distanceM(paris, other))).toBeLessThan(15)
  })
})
