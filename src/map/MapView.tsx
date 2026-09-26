import { useCallback, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { PerspectiveCamera, Vector3 } from 'three'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three'
import { toDeg, toRad } from '../lib/geo'
import { decodePolyline } from '../lib/polyline'
import { pointBeforeEnd } from '../lib/routePath'
import type { LatLon, Leg, Stop } from '../lib/types'
import { CameraRig } from './CameraRig'
import { headingBetween, makeFlightPath, overviewPose, stopPose, type FlightPath } from './cameraMath'
import { GoogleTiles } from './GoogleTiles'
import { usePageVisible, usePrefersReducedMotion } from './hooks'
import { PinLayer, PinProjector, type PinRefs } from './Pins'
import { pickQuality } from './quality'
import { routeLinePoints, routePaths, type RoutePath } from './routeGeometry'
import { RouteLines, type RouteLineData } from './RouteLines'
import { SceneFrame } from './sceneFrame'
import { claimTileSessionOnce } from './tileBudget'
import { describe, diagnoseTilesKey, type TilesDiagnosis } from './tilesKey'
import { heightFor, medianOf, useGroundHeights, useSurfaceHeights, type Heights } from './useGroundHeights'
import { ViewInset } from './ViewInset'

export type Focus = { kind: 'overview' } | { kind: 'stop'; index: number }

type Props = {
  center: LatLon
  stops: Stop[]
  /** legs[i] goes from stops[i] to stops[i + 1]. May be empty while routing. */
  legs: Leg[]
  color: string
  focus: Focus
  onSelectStop: (index: number) => void
  /** Height of UI covering the bottom of the map, in CSS pixels. */
  bottomInsetPx: number
  /** Fly along the route between neighbouring stops instead of a direct arc. */
  followRoute: boolean
}

type TilesState =
  | { kind: 'loading' }
  | { kind: 'diagnosing' }
  | { kind: 'failed'; diagnosis: TilesDiagnosis }
  | { kind: 'over_budget'; limit: number }

const apiKey = (import.meta.env.VITE_GOOGLE_TILES_KEY ?? '').trim()

/** Distance back along the incoming route used to decide which way the camera faces. */
const ARRIVAL_LOOKBACK_M = 150

export function MapView(props: Props) {
  const { center, stops, legs, color, focus, onSelectStop, bottomInsetPx, followRoute } = props
  const quality = useMemo(pickQuality, [])
  const frame = useMemo(() => new SceneFrame(center), [center])
  const visible = usePageVisible()
  const reducedMotion = usePrefersReducedMotion()

  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [tilesState, setTilesState] = useState<TilesState>(() => {
    if (!apiKey) return { kind: 'failed', diagnosis: describe('missing_key') }
    const budget = claimTileSessionOnce()
    return budget.allowed ? { kind: 'loading' } : { kind: 'over_budget', limit: budget.limit }
  })

  const stopHeights = useGroundHeights(tiles, stops, frame)
  const paths = useMemo(() => routePaths(legs), [legs])
  const routeSamples = useMemo(() => paths.flatMap((p) => p.samples), [paths])
  const routeHeights = useSurfaceHeights(tiles, frame, routeSamples)

  const pinRefs: PinRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = focus.kind === 'stop' ? focus.index : null

  const handleRootError = useCallback(() => {
    setTilesState({ kind: 'diagnosing' })
    void diagnoseTilesKey(apiKey).then((diagnosis) => {
      setTilesState({ kind: 'failed', diagnosis: diagnosis ?? describe('unknown') })
    })
  }, [])

  const retry = useCallback(() => {
    setTilesState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  const showTiles = tilesState.kind === 'loading'

  return (
    <div className="map">
      <Canvas
        frameloop={visible ? 'demand' : 'never'}
        dpr={quality.dpr}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
        camera={{ fov: 50, near: 1, far: 1_000_000, position: [0, 3000, -3000] }}
      >
        <color attach="background" args={['#c9d6e3']} />
        <ViewInset bottomPx={bottomInsetPx} />
        {showTiles ? (
          <GoogleTiles
            key={attempt}
            apiKey={apiKey}
            center={center}
            quality={quality}
            enabled={visible}
            onTiles={setTiles}
            onRootError={handleRootError}
          />
        ) : (
          <gridHelper args={[20_000, 80, '#8aa0b6', '#aebfd0']} />
        )}
        <Scene
          frame={frame}
          stops={stops}
          stopHeights={stopHeights}
          paths={paths}
          routeHeights={routeHeights}
          color={color}
          focus={focus}
          reducedMotion={reducedMotion}
          followRoute={followRoute}
          pinRefs={pinRefs}
          bottomInsetPx={bottomInsetPx}
        />
      </Canvas>
      <PinLayer stops={stops} color={color} current={current} onSelect={onSelectStop} pinRefs={pinRefs} />
      <TilesNotice state={tilesState} onRetry={retry} />
    </div>
  )
}

type SceneProps = {
  frame: SceneFrame
  stops: Stop[]
  stopHeights: Heights
  paths: RoutePath[]
  routeHeights: Heights
  color: string
  focus: Focus
  reducedMotion: boolean
  followRoute: boolean
  pinRefs: PinRefs
  bottomInsetPx: number
}

function Scene(props: SceneProps) {
  const { frame, stops, stopHeights, paths, routeHeights, color, focus, reducedMotion, followRoute, pinRefs } = props
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)

  // Field of view of the free area above the bottom panel (see ViewInset).
  const h = Math.max(1, size.height)
  const inset = Math.max(0, Math.min(props.bottomInsetPx, h * 0.6))
  const tanHalf = Math.tan(toRad(camera.fov) / 2)
  const freeFovDeg = toDeg(2 * Math.atan((tanHalf * (h - inset)) / (h + inset)))
  const aspect = size.width / Math.max(1, h - inset)

  const positions = useMemo(
    () => stops.map((stop) => frame.toScene(stop, heightFor(stop, stopHeights))),
    [frame, stops, stopHeights],
  )

  // Street level for routes before they are measured: the routes' own median,
  // else the lowest stop (stops are rooftops, so the lowest is closest to the street).
  const routeBase = useMemo(() => {
    const fromRoutes = medianOf(Object.values(routeHeights))
    if (fromRoutes !== null) return fromRoutes
    const stopValues = Object.values(stopHeights)
    return stopValues.length > 0 ? Math.min(...stopValues) : 0
  }, [routeHeights, stopHeights])

  const routePoints = useMemo(
    () => paths.map((path) => routeLinePoints(path, routeHeights, routeBase, frame)),
    [paths, routeHeights, routeBase, frame],
  )

  const lines: RouteLineData[] = useMemo(
    () =>
      paths.map((path, i) => ({
        key: path.key,
        points: routePoints[i] ?? [],
        estimated: path.leg.estimated,
        // Leg i arrives at stop i + 1. Highlight the one arriving at the current stop.
        state: focus.kind === 'overview' ? 'normal' : i === focus.index - 1 ? 'active' : 'dim',
      })),
    [paths, routePoints, focus],
  )

  const overview = useMemo(() => overviewPose(positions, freeFovDeg, aspect), [positions, freeFovDeg, aspect])

  const pose = useMemo(() => {
    if (focus.kind === 'overview') return overview
    const i = focus.index
    const here = positions[i]
    if (!here) return overview
    return stopPose(here, arrivalHeading(i, positions, paths, frame))
  }, [focus, positions, paths, frame, overview])

  // Neighbouring stops fly along their leg (reversed when going back).
  const pathBetween = useCallback(
    (fromKey: string, toKey: string): FlightPath | null => {
      if (!followRoute) return null
      const a = stopIndex(fromKey)
      const b = stopIndex(toKey)
      if (a === null || b === null || Math.abs(a - b) !== 1) return null
      const points = routePoints[Math.min(a, b)]
      if (!points) return null
      return makeFlightPath(a < b ? points : points.slice().reverse())
    },
    [followRoute, routePoints],
  )

  // Zoom-out limit must allow the overview, or the controls would clamp it.
  const maxDistance = Math.max(3000, overview.position.distanceTo(overview.target) * 1.3)
  const focusKey = focus.kind === 'overview' ? 'overview' : `stop:${focus.index}`

  return (
    <>
      <RouteLines lines={lines} color={color} />
      <PinProjector positions={positions} pinRefs={pinRefs} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={60}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI * 0.43}
      />
      <CameraRig focusKey={focusKey} pose={pose} reducedMotion={reducedMotion} pathBetween={pathBetween} />
    </>
  )
}

function stopIndex(key: string): number | null {
  const match = /^stop:(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}

/**
 * Which way the camera faces at stop i: along the last stretch of the incoming
 * route when there is one, else straight from the previous stop, and for the
 * first stop toward the second.
 */
function arrivalHeading(i: number, positions: Vector3[], paths: RoutePath[], frame: SceneFrame): Vector3 | null {
  const here = positions[i]!
  const incoming = paths[i - 1]
  if (incoming) {
    const before = pointBeforeEnd(decodePolyline(incoming.leg.polyline), ARRIVAL_LOOKBACK_M)
    const heading = before ? headingBetween(frame.toScene(before, here.y), here) : null
    if (heading) return heading
  }
  const prev = positions[i - 1]
  const next = positions[i + 1]
  return prev ? headingBetween(prev, here) : next ? headingBetween(here, next) : null
}

function TilesNotice({ state, onRetry }: { state: TilesState; onRetry: () => void }) {
  if (state.kind === 'loading') return null
  if (state.kind === 'diagnosing') {
    return <div className="map-notice">The 3D city did not load. Checking why...</div>
  }
  if (state.kind === 'over_budget') {
    return (
      <div className="map-notice">
        This device has used its {state.limit} 3D views for today, so the 3D city is off to save cost. The stops
        still work. It resets tomorrow.
      </div>
    )
  }
  const canRetry = state.diagnosis.problem !== 'missing_key'
  return (
    <div className="map-notice" role="alert">
      <p>{state.diagnosis.message}</p>
      {canRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
