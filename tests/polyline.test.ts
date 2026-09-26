import { describe, expect, it } from 'vitest'
import { distanceM } from '../src/lib/geo'
import { decodePolyline, encodePolyline } from '../src/lib/polyline'
import { medianSmooth, pathLengthM, pointBeforeEnd, resamplePath } from '../src/lib/routePath'
import { fillHeights } from '../src/map/routeGeometry'

describe('polyline', () => {
  it('decodes the example from Google docs', () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ lat: 38.5, lon: -120.2 })
    expect(points[1]!.lat).toBeCloseTo(40.7, 5)
    expect(points[1]!.lon).toBeCloseTo(-120.95, 5)
    expect(points[2]!.lat).toBeCloseTo(43.252, 5)
    expect(points[2]!.lon).toBeCloseTo(-126.453, 5)
  })

  it('encodes the same example', () => {
    const encoded = encodePolyline([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ])
    expect(encoded).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  it('round-trips points at 1e-5 precision', () => {
    const points = [
      { lat: 48.85296, lon: 2.3499 },
      { lat: 48.86106, lon: 2.33583 },
      { lat: -33.8568, lon: 151.2153 },
    ]
    expect(decodePolyline(encodePolyline(points))).toEqual(points)
  })

  it('handles empty and truncated input', () => {
    expect(decodePolyline('')).toEqual([])
    expect(decodePolyline('_p~iF')).toEqual([])
  })
})

describe('route path helpers', () => {
  const line = [
    { lat: 48.85, lon: 2.3 },
    { lat: 48.86, lon: 2.3 },
  ]

  it('resamples at roughly even spacing and keeps the ends', () => {
    const total = pathLengthM(line)
    const out = resamplePath(line, 100)
    expect(out[0]).toEqual(line[0])
    expect(out[out.length - 1]).toEqual(line[1])
    expect(out.length).toBe(Math.round(total / 100) + 1)
    for (let i = 1; i < out.length; i++) expect(distanceM(out[i - 1]!, out[i]!)).toBeCloseTo(total / (out.length - 1), 0)
  })

  it('caps the number of points', () => {
    expect(resamplePath(line, 1, 50).length).toBeLessThanOrEqual(51)
  })

  it('finds a point a set distance before the end', () => {
    const p = pointBeforeEnd(line, 150)!
    expect(distanceM(p, line[1]!)).toBeCloseTo(150, 0)
    expect(pointBeforeEnd(line, 1e6)).toEqual(line[0])
    expect(pointBeforeEnd([line[0]!], 10)).toBeNull()
  })

  it('removes single spikes with a median filter', () => {
    expect(medianSmooth([10, 10, 60, 10, 10], 1)).toEqual([10, 10, 10, 10, 10])
  })

  it('fills unmeasured heights by interpolation, or the base', () => {
    const samples = ['a', 'b', 'c', 'd'].map((key) => ({ key, lat: 0, lon: 0 }))
    expect(fillHeights(samples, { a: 10, d: 40 }, 0)).toEqual([10, 20, 30, 40])
    expect(fillHeights(samples, { b: 5 }, 0)).toEqual([5, 5, 5, 5])
    expect(fillHeights(samples, {}, 7)).toEqual([7, 7, 7, 7])
  })
})
