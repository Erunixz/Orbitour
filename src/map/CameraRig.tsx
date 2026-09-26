import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Vector3 } from 'three'
import {
  clonePose,
  createFlight,
  emptyPose,
  flightProgress,
  posesClose,
  sampleFlight,
  type Flight,
  type FlightPath,
  type Pose,
} from './cameraMath'

/** The parts of drei's OrbitControls we touch. */
type Controls = { target: Vector3; enabled: boolean; update: () => void }

type Props = {
  /** Changes when the user moves to a different stop or to the overview. */
  focusKey: string
  pose: Pose
  reducedMotion: boolean
  /** Route for the look-at point to follow between two focus keys, if any. */
  pathBetween?: (fromKey: string, toKey: string) => FlightPath | null
}

const nowSeconds = () => performance.now() / 1000

/**
 * Moves the camera only when the focus changes. A new focus starts a flight from
 * wherever the camera is now. A new focus during a flight first jumps to the end
 * of that flight. The same focus with a refined pose (for example a better ground
 * height) shifts the view without flying.
 */
export function CameraRig({ focusKey, pose, reducedMotion, pathBetween }: Props) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const invalidate = useThree((s) => s.invalidate)

  const flight = useRef<Flight | null>(null)
  const shown = useRef<{ key: string; pose: Pose } | null>(null)
  const scratch = useRef(emptyPose())

  const apply = useCallback(
    (p: Pose) => {
      camera.position.copy(p.position)
      camera.lookAt(p.target)
      if (controls) {
        controls.target.copy(p.target)
        controls.update()
      }
      invalidate()
    },
    [camera, controls, invalidate],
  )

  const finishFlight = useCallback(() => {
    const f = flight.current
    if (!f) return
    flight.current = null
    apply(f.to)
    if (controls) controls.enabled = true
  }, [apply, controls])

  // Orbit controls mount after the first frame. Point them at what we are showing.
  useEffect(() => {
    if (!controls) return
    const target = flight.current?.to.target ?? shown.current?.pose.target
    if (target) {
      controls.target.copy(target)
      controls.update()
    }
  }, [controls])

  useEffect(() => {
    const prev = shown.current
    shown.current = { key: focusKey, pose: clonePose(pose) }

    if (!prev) {
      apply(pose)
      return
    }

    if (prev.key === focusKey) {
      if (posesClose(prev.pose, pose)) return
      if (flight.current) {
        flight.current.to = clonePose(pose)
        return
      }
      const delta = pose.target.clone().sub(prev.pose.target)
      const moved = pose.position.clone().sub(prev.pose.position)
      if (moved.distanceTo(delta) < 0.5) {
        // Whole view moved together (a refined ground height): keep the user's orbit.
        apply({ position: camera.position.clone().add(delta), target: pose.target })
      } else {
        // Framing changed (window or panel resized): take the new view.
        apply(pose)
      }
      return
    }

    finishFlight()
    if (reducedMotion) {
      apply(pose)
      return
    }

    const from: Pose = {
      position: camera.position.clone(),
      target: controls ? controls.target.clone() : prev.pose.target.clone(),
    }
    const path = pathBetween?.(prev.key, focusKey) ?? null
    flight.current = createFlight(from, pose, nowSeconds(), path)
    if (controls) controls.enabled = false
    invalidate()
  }, [focusKey, pose, reducedMotion, pathBetween, apply, finishFlight, camera, controls, invalidate])

  useFrame(() => {
    const f = flight.current
    if (!f) return
    const t = flightProgress(f, nowSeconds())
    if (t >= 1) {
      finishFlight()
      return
    }
    const p = sampleFlight(f, t, scratch.current)
    camera.position.copy(p.position)
    camera.lookAt(p.target)
    if (controls) controls.target.copy(p.target)
    invalidate()
  })

  return null
}
