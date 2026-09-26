import { Line } from '@react-three/drei'
import type { Vector3 } from 'three'

export type RouteLineState = 'normal' | 'active' | 'dim'

export type RouteLineData = {
  key: string
  points: Vector3[]
  estimated: boolean
  state: RouteLineState
}

const WIDTH: Record<RouteLineState, number> = { normal: 4, active: 6, dim: 3 }
const OPACITY: Record<RouteLineState, number> = { normal: 0.95, active: 1, dim: 0.45 }

/**
 * Route lines on the ground. Each route is drawn twice: a faint copy that shows
 * through buildings so the path never disappears, and the main line that is
 * hidden behind buildings like the real street. Estimated legs are dashed.
 */
export function RouteLines({ lines, color }: { lines: RouteLineData[]; color: string }) {
  return (
    <>
      {lines.map((line) => {
        if (line.points.length < 2) return null
        const dash = line.estimated ? { dashed: true, dashSize: 25, gapSize: 18 } : { dashed: false }
        return (
          <group key={line.key}>
            <Line
              points={line.points}
              color={color}
              lineWidth={WIDTH[line.state]}
              transparent
              opacity={OPACITY[line.state] * 0.3}
              depthTest={false}
              depthWrite={false}
              renderOrder={1}
              {...dash}
            />
            <Line
              points={line.points}
              color="#ffffff"
              lineWidth={WIDTH[line.state] + 3}
              transparent
              opacity={OPACITY[line.state] * 0.8}
              depthWrite={false}
              renderOrder={2}
            />
            <Line
              points={line.points}
              color={color}
              lineWidth={WIDTH[line.state]}
              transparent
              opacity={OPACITY[line.state]}
              depthWrite={false}
              renderOrder={3}
              {...dash}
            />
          </group>
        )
      })}
    </>
  )
}
