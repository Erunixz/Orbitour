import { distanceM } from '../../src/lib/geo.js'
import type { LatLon } from '../../src/lib/types.js'
import type { WikiPage } from '../upstream/wikipedia.js'
import { MAX_GEOSEARCH_RADIUS_M } from '../upstream/wikipedia.js'
import { stage, type Candidate, type Emit, type PipelineDeps, type Survey } from './context.js'
import { guessKind, isDestination } from './places.js'

// Candidate pool (code): notable Wikipedia articles inside the trip area.
// GeoSearch returns the nearest pages first, so a dense city center would crowd
// out everything else. We search the center and a ring of points around it.

export const POOL_SIZE = 60

/** Where to search and how far from each point. */
export function searchPoints(center: LatLon, radiusM: number): { point: LatLon; radiusM: number }[] {
  if (radiusM <= 2500) return [{ point: center, radiusM }]
  const ring = radiusM * 0.55
  const each = Math.min(MAX_GEOSEARCH_RADIUS_M, radiusM * 0.55)
  const points = [{ point: center, radiusM: each }]
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * 2 * Math.PI
    const dLat = (ring * Math.cos(angle)) / 111_320
    const dLon = (ring * Math.sin(angle)) / (111_320 * Math.cos((center.lat * Math.PI) / 180))
    points.push({ point: { lat: center.lat + dLat, lon: center.lon + dLon }, radiusM: each })
  }
  return points
}

/** Rough notability: monthly views when known, else article length. */
export function notability(page: Pick<WikiPage, 'views' | 'length'>): number {
  const views = page.views ?? page.length / 20
  return Math.round((Math.log10(views + 10) * 2 + Math.log10(page.length + 100)) * 100) / 100
}

/** Filters and ranks raw pages into the pool the Scout chooses from. */
export function buildPool(pages: WikiPage[], center: LatLon, radiusM: number, size = POOL_SIZE): Candidate[] {
  const seen = new Set<number>()
  const pool: Candidate[] = []
  for (const page of pages) {
    if (seen.has(page.pageId)) continue
    seen.add(page.pageId)
    if (distanceM(page, center) > radiusM) continue
    if (!isDestination(page.title, page.description)) continue
    const kind = guessKind(page.title, page.description)
    // Food and lodging come from OpenStreetMap later.
    if (kind === 'food' || kind === 'lodging') continue
    pool.push({
      pageId: page.pageId,
      title: page.title,
      description: page.description,
      lat: page.lat,
      lon: page.lon,
      kind,
      score: notability(page),
    })
  }
  return pool.sort((a, b) => b.score - a.score).slice(0, size)
}

export async function runCandidates(survey: Survey, deps: PipelineDeps, emit: Emit): Promise<Candidate[]> {
  const s = stage(emit, 'candidates')
  s.start('Collecting notable places from Wikipedia...')
  const pages: WikiPage[] = []
  let failures = 0
  const points = searchPoints(survey.center, survey.radiusM)
  for (const { point, radiusM } of points) {
    try {
      pages.push(...(await deps.wikipedia.nearby(point, radiusM, 60)))
    } catch {
      failures++
    }
  }
  if (failures === points.length) {
    s.error('Wikipedia is not responding. Try again in a minute.')
    return []
  }
  const pool = buildPool(pages, survey.center, survey.radiusM)
  s.done(`Found ${pool.length} candidate places (from ${pages.length} nearby articles).`)
  return pool
}
