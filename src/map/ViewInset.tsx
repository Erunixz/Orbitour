import { useCallback, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'

/**
 * Moves the view center up so the focused point lands in the middle of the part of
 * the map that is not covered by the bottom panel. Pins, picking, and controls all
 * use the camera's projection, so they stay aligned. When the panel height changes
 * the offset eases over a few frames instead of jumping.
 */
export function ViewInset({ bottomPx }: { bottomPx: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const current = useRef<number | null>(null)

  const target = Math.max(0, Math.min(bottomPx, size.height * 0.6))

  const apply = useCallback(
    (inset: number) => {
      current.current = inset
      // The projection is built for a taller virtual screen, so its aspect must match
      // that screen or the picture gets squashed.
      camera.aspect = size.width / (size.height + inset)
      if (inset < 1) camera.clearViewOffset()
      else camera.setViewOffset(size.width, size.height + inset, 0, inset, size.width, size.height)
      camera.updateProjectionMatrix()
      invalidate()
    },
    [camera, size.width, size.height, invalidate],
  )

  // First value and any resize apply at once.
  useLayoutEffect(() => {
    apply(current.current ?? target)
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const now = current.current
    if (now === null) return
    // Something else (a canvas resize) reset the aspect. Put ours back.
    if (Math.abs(camera.aspect - size.width / (size.height + now)) > 1e-6) apply(now)
    if (Math.abs(now - target) < 0.5) return
    const step = 1 - Math.exp(-delta * 10)
    apply(Math.abs(now - target) < 1 ? target : now + (target - now) * step)
  })

  // Wake the demand frame loop when the target changes.
  useLayoutEffect(() => {
    invalidate()
  }, [target, invalidate])

  return null
}
