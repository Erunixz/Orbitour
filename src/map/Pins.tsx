import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { isStart, stopLabel } from '../lib/stops'
import type { Stop } from '../lib/types'

// Pins are plain DOM buttons in one overlay layer. A small component inside the
// canvas projects each stop to the screen on every rendered frame and writes the
// transform straight to the element, so moving the camera never re-renders React.

export type PinRefs = RefObject<(HTMLButtonElement | null)[]>

type LayerProps = {
  stops: Stop[]
  color: string
  /** Index of the focused stop, or null in overview. */
  current: number | null
  onSelect: (index: number) => void
  pinRefs: PinRefs
}

/** DOM layer of numbered pins. Their tips sit on the projected surface point. */
export function PinLayer({ stops, color, current, onSelect, pinRefs }: LayerProps) {
  return (
    <div className="pin-layer">
      {stops.map((stop, i) => {
        const state = (current === null ? '' : current === i ? ' is-current' : ' is-dim') + (isStart(stop) ? ' is-start' : '')
        const label = stopLabel(stops, i)
        return (
          <button
            key={stop.id}
            ref={(el) => {
              pinRefs.current[i] = el
            }}
            type="button"
            className={`pin${state}`}
            style={{ '--pin-color': color, visibility: 'hidden' } as CSSProperties}
            onClick={() => onSelect(i)}
            aria-label={isStart(stop) ? `Start: ${stop.name}` : `Stop ${label}: ${stop.name}`}
            title={stop.name}
          >
            <span className="pin-body">
              <span className="pin-number">{label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Lives inside the canvas. Places the pin elements to match the camera. */
export function PinProjector({ positions, pinRefs }: { positions: Vector3[]; pinRefs: PinRefs }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const scratch = useRef(new Vector3())

  // New positions (for example a measured rooftop height) need a fresh frame.
  useEffect(() => invalidate(), [positions, invalidate])

  useFrame(() => {
    const v = scratch.current
    positions.forEach((position, i) => {
      const el = pinRefs.current[i]
      if (!el) return
      v.copy(position).project(camera)
      const inView = v.z > -1 && v.z < 1
      if (!inView) {
        el.style.visibility = 'hidden'
        return
      }
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.visibility = 'visible'
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      // Nearer pins draw on top.
      el.style.zIndex = String(1000 - Math.round(v.z * 500))
    })
  })

  return null
}
