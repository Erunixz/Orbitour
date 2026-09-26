import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  arcHeightM,
  createFlight,
  easeInOutCubic,
  flightProgress,
  flightSeconds,
  headingBetween,
  makeFlightPath,
  pointAlongPath,
  overviewPose,
  sampleFlight,
  stopPose,
  STOP_VIEW,
} from '../src/map/cameraMath'
import { heightFor } from '../src/map/useGroundHeights'
import type { Stop } from '../src/lib/types'

describe('stopPose', () => {
  it('sits behind the stop along the heading, pitched down', () => {
    const stop = new Vector3(100, 50, 200)
    const heading = new Vector3(0, 0, 1)
    const pose = stopPose(stop, heading)

    expect(pose.target.equals(stop)).toBe(true)
    expect(pose.position.distanceTo(stop)).toBeCloseTo(STOP_VIEW.distanceM, 6)
    // Behind (south of) the stop when heading north, and above it.
    expect(pose.position.z).toBeLessThan(stop.z)
    expect(pose.position.y).toBeGreaterThan(stop.y)

    const dir = pose.target.clone().sub(pose.position)
    const pitch = Math.asin(-dir.y / dir.length()) * (180 / Math.PI)
    expect(pitch).toBeCloseTo(STOP_VIEW.pitchDeg, 6)
  })

  it('has a comfortable distance and pitch', () => {
    expect(STOP_VIEW.distanceM).toBeGreaterThanOrEqual(250)
    expect(STOP_VIEW.distanceM).toBeLessThanOrEqual(450)
    expect(STOP_VIEW.pitchDeg).toBeGreaterThanOrEqual(30)
    expect(STOP_VIEW.pitchDeg).toBeLessThanOrEqual(40)
  })

  it('ignores the vertical part of a heading', () => {
    const h = headingBetween(new Vector3(0, 0, 0), new Vector3(0, 500, 10))
    expect(h?.y).toBe(0)
    expect(headingBetween(new Vector3(), new Vector3(0.1, 40, 0.1))).toBeNull()
  })
})

describe('overviewPose', () => {
  it('fits all points and is further out for spread-out points', () => {
    const near = [new Vector3(0, 0, 0), new Vector3(300, 0, 0)]
    const far = [new Vector3(0, 0, 0), new Vector3(6000, 0, 0)]
    const a = overviewPose(near, 50, 1.5)
    const b = overviewPose(far, 50, 1.5)
    expect(b.position.distanceTo(b.target)).toBeGreaterThan(a.position.distanceTo(a.target))
    expect(b.target.x).toBeCloseTo(3000)
  })

  it('backs off further on a portrait screen', () => {
    const points = [new Vector3(-2000, 0, 0), new Vector3(2000, 0, 0)]
    const wide = overviewPose(points, 50, 1.8)
    const tall = overviewPose(points, 50, 0.5)
    expect(tall.position.distanceTo(tall.target)).toBeGreaterThan(wide.position.distanceTo(wide.target))
  })
})

describe('flights', () => {
  const a = stopPose(new Vector3(0, 0, 0), null)
  const b = stopPose(new Vector3(0, 0, 4000), null)

  it('lasts 2 to 3.5 seconds and scales with distance', () => {
    const short = stopPose(new Vector3(0, 0, 100), null)
    expect(flightSeconds(a, short)).toBeGreaterThanOrEqual(2)
    expect(flightSeconds(a, short)).toBeLessThan(2.2)
    expect(flightSeconds(a, b)).toBeGreaterThan(flightSeconds(a, short))
    const veryFar = stopPose(new Vector3(0, 0, 50_000), null)
    expect(flightSeconds(a, veryFar)).toBe(3.5)
  })

  it('starts and ends exactly on the poses', () => {
    const flight = createFlight(a, b, 10)
    expect(sampleFlight(flight, 0).position.distanceTo(a.position)).toBeLessThan(1e-6)
    expect(sampleFlight(flight, 1).position.distanceTo(b.position)).toBeLessThan(1e-6)
    expect(sampleFlight(flight, 1).target.distanceTo(b.target)).toBeLessThan(1e-6)
  })

  it('rises in the middle of long hops', () => {
    const flight = createFlight(a, b, 0)
    const mid = sampleFlight(flight, 0.5)
    const straightY = (a.position.y + b.position.y) / 2
    expect(mid.position.y).toBeGreaterThan(straightY + 100)
    expect(arcHeightM(a, b)).toBeLessThanOrEqual(800)
  })

  it('tracks progress over time and clamps', () => {
    const flight = createFlight(a, b, 5)
    expect(flightProgress(flight, 4)).toBe(0)
    expect(flightProgress(flight, 5 + flight.seconds / 2)).toBeCloseTo(0.5)
    expect(flightProgress(flight, 100)).toBe(1)
  })

  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1)
  })
})

describe('heightFor', () => {
  const stop = (id: string) => ({ id }) as Stop

  it('uses the measured height, then the median of known heights, then 0', () => {
    expect(heightFor(stop('a'), { a: 42 })).toBe(42)
    expect(heightFor(stop('x'), { a: 10, b: 30, c: 20 })).toBe(20)
    expect(heightFor(stop('x'), {})).toBe(0)
  })
})

describe('route flights', () => {
  const route = [new Vector3(0, 0, 0), new Vector3(0, 0, 1000), new Vector3(1000, 0, 1000)]
  const path = makeFlightPath(route)!

  it('measures the path and walks along it by distance', () => {
    expect(path.length).toBeCloseTo(2000)
    expect(pointAlongPath(path, 0.25).distanceTo(new Vector3(0, 0, 500))).toBeLessThan(1e-6)
    expect(pointAlongPath(path, 0.75).distanceTo(new Vector3(500, 0, 1000))).toBeLessThan(1e-6)
    expect(makeFlightPath([new Vector3()])).toBeNull()
  })

  it('starts and ends on the poses and passes over the route', () => {
    const from = stopPose(new Vector3(0, 30, 0), null)
    const to = stopPose(new Vector3(1000, 30, 1000), null)
    const flight = createFlight(from, to, 0, path)
    expect(sampleFlight(flight, 0).position.distanceTo(from.position)).toBeLessThan(1e-6)
    expect(sampleFlight(flight, 1).target.distanceTo(to.target)).toBeLessThan(1e-6)
    // Halfway along the path is the corner; the target should be near it, not on the straight diagonal.
    const mid = sampleFlight(flight, 0.5).target
    expect(Math.hypot(mid.x - 0, mid.z - 1000)).toBeLessThan(40)
  })
})
