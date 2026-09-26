import { useEffect, useMemo, useState } from 'react'
import { Raycaster, Vector3 } from 'three'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three'
import type { LatLon, Stop } from '../lib/types'
import type { SceneFrame } from './sceneFrame'

// Finds the surface height (rooftop or street) under points by casting rays down
// onto the loaded tiles. Heights are metres above the WGS84 ellipsoid, so they
// stay valid across sessions. Rays run in small batches between frames so a long
// route never blocks the page, and re-run as finer tiles arrive.

export type Heights = Record<string, number>
export type SamplePoint = LatLon & { key: string }

const CACHE_KEY = 'ground.heights.v1'
const CACHE_LIMIT = 500
const RAY_TOP_M = 2000
const RAY_BOTTOM_M = -200
const DEBOUNCE_MS = 300
const BATCH_SIZE = 25

const coordKey = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`

function readCache(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeCache(entries: Record<string, number>): void {
  try {
    const all = { ...readCache(), ...entries }
    const keys = Object.keys(all)
    for (const key of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete all[key]
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    // Storage full or blocked. Heights still work for this session.
  }
}

/** Height of the first surface under `point`, or null when no loaded tile is there. */
export function raycastSurface(
  tiles: TilesRendererImpl,
  frame: SceneFrame,
  point: LatLon,
  raycaster = new Raycaster(),
): number | null {
  const origin = frame.toScene(point, RAY_TOP_M)
  const below = frame.toScene(point, RAY_BOTTOM_M)
  const direction = new Vector3().subVectors(below, origin).normalize()
  raycaster.set(origin, direction)
  raycaster.far = RAY_TOP_M - RAY_BOTTOM_M
  Object.assign(raycaster, { firstHitOnly: true })
  const hit = raycaster.intersectObject(tiles.group, true)[0]
  return hit ? RAY_TOP_M - hit.distance : null
}

type Options = {
  /** Remember heights in localStorage by coordinate (use for stops, not route samples). */
  persist?: boolean
  /** Known heights to start from, by key. */
  initial?: Heights
}

export function useSurfaceHeights(
  tiles: TilesRendererImpl | null,
  frame: SceneFrame,
  points: SamplePoint[],
  { persist = false, initial }: Options = {},
): Heights {
  const [heights, setHeights] = useState<Heights>({})

  // Seed from known values and the cache whenever the point set changes.
  useEffect(() => {
    const cache = persist ? readCache() : {}
    const seed: Heights = {}
    for (const p of points) {
      const known = initial?.[p.key] ?? cache[coordKey(p)]
      if (typeof known === 'number' && Number.isFinite(known)) seed[p.key] = known
    }
    setHeights((prev) => ({ ...seed, ...prev }))
  }, [points, persist, initial])

  useEffect(() => {
    if (!tiles || points.length === 0) return
    const raycaster = new Raycaster()
    let timer: ReturnType<typeof setTimeout> | undefined
    let run = 0

    const measure = () => {
      const thisRun = ++run
      const found: Heights = {}
      let index = 0

      const batch = () => {
        if (thisRun !== run) return
        const end = Math.min(points.length, index + BATCH_SIZE)
        for (; index < end; index++) {
          const p = points[index]!
          const h = raycastSurface(tiles, frame, p, raycaster)
          if (h !== null) found[p.key] = h
        }
        if (index < points.length) {
          timer = setTimeout(batch, 0)
          return
        }
        if (Object.keys(found).length === 0) return
        setHeights((prev) => {
          const changed = Object.entries(found).some(([key, h]) => Math.abs((prev[key] ?? Infinity) - h) > 0.5)
          return changed ? { ...prev, ...found } : prev
        })
        if (persist) {
          const toCache: Record<string, number> = {}
          for (const p of points) {
            const h = found[p.key]
            if (h !== undefined) toCache[coordKey(p)] = Math.round(h * 10) / 10
          }
          writeCache(toCache)
        }
      }
      batch()
    }

    // Re-measure after each batch of tiles finishes, since finer tiles give truer heights.
    const schedule = () => {
      clearTimeout(timer)
      run++
      timer = setTimeout(measure, DEBOUNCE_MS)
    }

    tiles.addEventListener('tiles-load-end', schedule)
    schedule()
    return () => {
      run++
      clearTimeout(timer)
      tiles.removeEventListener('tiles-load-end', schedule)
    }
  }, [tiles, frame, points, persist])

  return heights
}

/** Rooftop heights under each stop, keyed by stop id. */
export function useGroundHeights(tiles: TilesRendererImpl | null, stops: Stop[], frame: SceneFrame): Heights {
  const points = useMemo(() => stops.map((s) => ({ key: s.id, lat: s.lat, lon: s.lon })), [stops])
  const initial = useMemo(() => {
    const out: Heights = {}
    for (const s of stops) if (s.groundHeightM !== undefined) out[s.id] = s.groundHeightM
    return out
  }, [stops])
  return useSurfaceHeights(tiles, frame, points, { persist: true, initial })
}

/** Height to use for a stop: measured, else the median of known heights, else 0. */
export function heightFor(stop: Stop, heights: Heights): number {
  const own = heights[stop.id]
  if (own !== undefined) return own
  return medianOf(Object.values(heights)) ?? 0
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}
