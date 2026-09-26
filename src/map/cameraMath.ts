import { Vector3 } from 'three'
import { clamp, toRad } from '../lib/geo'

// Pure camera math. No React, no tiles, so it is easy to test.

export type Pose = { position: Vector3; target: Vector3 }

const UP = new Vector3(0, 1, 0)
/** Scene +Z is north. Used when there is no travel direction to face. */
const NORTH = new Vector3(0, 0, 1)

export const STOP_VIEW = {
  /** Straight-line distance from camera to stop, metres. */
  distanceM: 350,
  /** Downward pitch, degrees. */
  pitchDeg: 35,
}

/** Horizontal unit direction from a to b, or null when they are (nearly) the same place. */
export function headingBetween(a: Vector3, b: Vector3): Vector3 | null {
  const dir = new Vector3(b.x - a.x, 0, b.z - a.z)
  if (dir.lengthSq() < 1) return null
  return dir.normalize()
}

/**
 * Camera for looking at one stop. The camera sits behind the stop along `heading`
 * (the direction of travel into the stop), so the path you came along is below you
 * and the stop is ahead.
 */
export function stopPose(stop: Vector3, heading: Vector3 | null, view = STOP_VIEW): Pose {
  const dir = heading ?? NORTH
  const pitch = toRad(view.pitchDeg)
  const back = dir.clone().multiplyScalar(-view.distanceM * Math.cos(pitch))
  const up = UP.clone().multiplyScalar(view.distanceM * Math.sin(pitch))
  return { position: stop.clone().add(back).add(up), target: stop.clone() }
}

/** Camera framing all points, seen from the south, pitched down. */
export function overviewPose(points: Vector3[], verticalFovDeg: number, aspect: number): Pose {
  if (points.length === 0) return stopPose(new Vector3(), null)

  const center = new Vector3()
  for (const p of points) center.add(p)
  center.divideScalar(points.length)

  let radius = 0
  for (const p of points) radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z))
  radius = Math.max(radius, 250)

  // Use the narrower of the two fields of view so portrait screens still fit everything.
  const vHalf = toRad(verticalFovDeg) / 2
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const half = Math.min(vHalf, hHalf)
  const distanceM = (radius * 1.25) / Math.sin(half)

  return stopPose(center, NORTH, { distanceM, pitchDeg: 55 })
}

/** Far view over the whole trip area, for the slow circling while a plan is made. */
export function orbitPose(center: Vector3, radiusM: number): Pose {
  const distanceM = clamp(radiusM * 1.3, 3000, 9000)
  return stopPose(center, NORTH, { distanceM, pitchDeg: 48 })
}

/** Turns the camera around the target's vertical axis by `angle` radians. */
export function orbitAround(position: Vector3, target: Vector3, angle: number): void {
  const x = position.x - target.x
  const z = position.z - target.z
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  position.x = target.x + x * c - z * s
  position.z = target.z + x * s + z * c
}

/** Flight length in seconds: about 2 s for short hops, up to 3.5 s for long ones. */
export function flightSeconds(from: Pose, to: Pose): number {
  const hop = Math.hypot(to.target.x - from.target.x, to.target.z - from.target.z)
  return clamp(2 + hop / 1500, 2, 3.5)
}

/** Extra height at the middle of a flight so long hops clear the buildings. */
export function arcHeightM(from: Pose, to: Pose): number {
  const hop = Math.hypot(to.position.x - from.position.x, to.position.z - from.position.z)
  return clamp(hop * 0.2, 0, 800)
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** A path on the ground for the look-at point to follow, with running lengths. */
export type FlightPath = { points: Vector3[]; cumulative: number[]; length: number }

export function makeFlightPath(points: Vector3[]): FlightPath | null {
  if (points.length < 2) return null
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + points[i]!.distanceTo(points[i - 1]!))
  }
  const length = cumulative[cumulative.length - 1]!
  return length > 1 ? { points, cumulative, length } : null
}

/** Point `t` (0..1) of the way along the path, by distance. */
export function pointAlongPath(path: FlightPath, t: number, out = new Vector3()): Vector3 {
  const at = clamp(t, 0, 1) * path.length
  let i = 1
  while (i < path.points.length - 1 && path.cumulative[i]! < at) i++
  const a = path.points[i - 1]!
  const b = path.points[i]!
  const span = path.cumulative[i]! - path.cumulative[i - 1]!
  return out.lerpVectors(a, b, span > 0 ? (at - path.cumulative[i - 1]!) / span : 0)
}

export type Flight = {
  from: Pose
  to: Pose
  seconds: number
  arcM: number
  startedAt: number
  /** When set, the look-at point follows this route instead of a straight line. */
  path: FlightPath | null
}

/** Route flights take a little longer since the path is longer than the hop. */
export function createFlight(from: Pose, to: Pose, now: number, path: FlightPath | null = null): Flight {
  const seconds = path ? clamp(2 + path.length / 1500, 2, 3.5) : flightSeconds(from, to)
  // Following streets needs only a small rise; the direct hop needs to clear buildings.
  const arcM = path ? arcHeightM(from, to) * 0.35 : arcHeightM(from, to)
  return { from: clonePose(from), to: clonePose(to), seconds, arcM, startedAt: now, path }
}

/** Progress 0..1 of a flight at time `now` (seconds). */
export function flightProgress(flight: Flight, now: number): number {
  return clamp((now - flight.startedAt) / flight.seconds, 0, 1)
}

/**
 * How far the camera pulls back at the middle of a flight, as a share of its
 * distance to the target. More when the view turns a lot, so the rotation reads
 * as a wide sweep and not a spin on the spot.
 */
export const PULL_BACK = { base: 0.35, perTurn: 0.45, maxExtraM: 700 }

/** Camera offset from its target as heading angle, horizontal distance and height. */
type Orbit = { angle: number; flat: number; height: number }

function toOrbit(offset: Vector3): Orbit {
  return { angle: Math.atan2(offset.x, offset.z), flat: Math.hypot(offset.x, offset.z), height: offset.y }
}

/** Signed shortest turn from angle a to angle b, in -PI..PI. */
export function turnBetween(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

const offsetA = new Vector3()
const offsetB = new Vector3()

/**
 * Offset from the target at eased progress e. The heading swings along the
 * shorter arc around the target (a straight blend of two opposite offsets would
 * pass right over it, far too close), and the camera backs off mid-flight.
 */
function orbitOffset(from: Pose, to: Pose, e: number, out: Vector3): Vector3 {
  const a = toOrbit(offsetA.subVectors(from.position, from.target))
  const b = toOrbit(offsetB.subVectors(to.position, to.target))
  const turn = turnBetween(a.angle, b.angle)
  const angle = a.angle + turn * e
  const flat = a.flat + (b.flat - a.flat) * e
  const height = a.height + (b.height - a.height) * e
  const dist = Math.hypot(flat, height)
  const share = PULL_BACK.base + PULL_BACK.perTurn * (Math.abs(turn) / Math.PI)
  const extra = Math.min(dist * share, PULL_BACK.maxExtraM) * Math.sin(Math.PI * e)
  const scale = dist > 0 ? (dist + extra) / dist : 1
  return out.set(Math.sin(angle) * flat * scale, height * scale, Math.cos(angle) * flat * scale)
}

const offset = new Vector3()

/** Camera pose at progress t (0..1). Eased along the way, pulled back and raised in the middle. */
export function sampleFlight(flight: Flight, t: number, out: Pose = emptyPose()): Pose {
  const e = easeInOutCubic(clamp(t, 0, 1))
  if (flight.path) {
    // Look-at point rides the route. The route runs between the two targets, so pin its ends to them exactly.
    pointAlongPath(flight.path, e, out.target)
    const first = flight.path.points[0]!
    const last = flight.path.points[flight.path.points.length - 1]!
    out.target.add(offsetA.subVectors(flight.from.target, first).multiplyScalar(1 - e))
    out.target.add(offsetB.subVectors(flight.to.target, last).multiplyScalar(e))
  } else {
    out.target.lerpVectors(flight.from.target, flight.to.target, e)
  }
  out.position.copy(out.target).add(orbitOffset(flight.from, flight.to, e, offset))
  out.position.y += flight.arcM * Math.sin(Math.PI * e)
  return out
}

export function emptyPose(): Pose {
  return { position: new Vector3(), target: new Vector3() }
}

export function clonePose(pose: Pose): Pose {
  return { position: pose.position.clone(), target: pose.target.clone() }
}

export function posesClose(a: Pose, b: Pose, toleranceM = 0.5): boolean {
  return a.position.distanceTo(b.position) <= toleranceM && a.target.distanceTo(b.target) <= toleranceM
}
