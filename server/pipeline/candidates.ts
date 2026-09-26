import { distanceM } from '../../src/lib/geo.js'
import type { LatLon } from '../../src/lib/types.js'
import type { OsmPlace } from '../upstream/overpass.js'
import { isQid, type WikidataFacts } from '../upstream/wikidata.js'
import type { WikiPage } from '../upstream/wikipedia.js'
import { MAX_GEOSEARCH_RADIUS_M } from '../upstream/wikipedia.js'
import { stage, type Candidate, type Emit, type PipelineDeps, type Survey } from './context.js'
import { guessKind, isDestination, kindFromTags } from './places.js'

// Candidate pool (code): verified tourist places inside the trip area. A place
// must be tagged as worth visiting on OpenStreetMap and have an English
// Wikipedia article. When OpenStreetMap is down, notable Wikipedia articles only.
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

/** Fame floor: a place needs this many language Wikipedias, or this many monthly views. */
export const MIN_SITELINKS = 4
export const MIN_VIEWS = 3000
/** Below this many famous places, the floor is dropped and the best verified ones are used. */
const MIN_POOL = 20
/** Fewer verified places than this and the pool widens to notable Wikipedia places. */
const MIN_VERIFIED = 5
/** Wikidata lookups per plan, to keep the stage quick. */
const MAX_FACTS = 250
/** Extra Wikipedia page lookups for verified places the geosearch missed. */
const MAX_EXTRA_PAGES = 150

/**
 * How well known an OSM place looks before we ask Wikidata: famous places carry
 * their name in many languages ("name:ja", "name:ar"...) and often a visitor count.
 */
export function osmFame(tags: Record<string, string>): number {
  const languages = Object.keys(tags).filter((k) => /^name:[a-z]{2,3}(-[A-Za-z]+)?$/.test(k)).length
  const visitors = Number(tags['tourism:visitors'] ?? 0)
  const touristy = /^(attraction|museum|gallery|viewpoint)$/.test(tags.tourism ?? '') ? 3 : 0
  return languages + touristy + (visitors > 0 ? Math.log10(visitors) : 0)
}

const famous = (c: Scored) => (c.sitelinks ?? 0) >= MIN_SITELINKS || (c.views ?? 0) >= MIN_VIEWS

type Scored = Candidate & { views: number | null }

/**
 * Verified pool: places OpenStreetMap tags as worth visiting AND that have an
 * English Wikipedia article (tied by their Wikidata id). Ranked by fame.
 */
export function verifiedPool(
  osm: OsmPlace[],
  pageByQid: Map<string, WikiPage>,
  facts: Map<string, WikidataFacts>,
  center: LatLon,
  radiusM: number,
  size = POOL_SIZE,
): Candidate[] {
  const seen = new Set<string>()
  const all: Scored[] = []
  for (const place of osm) {
    const qid = place.tags.wikidata ?? ''
    if (seen.has(qid)) continue
    seen.add(qid)
    const page = pageByQid.get(qid)
    if (!page) continue
    if (distanceM(page, center) > radiusM) continue
    if (!isDestination(page.title, page.description)) continue
    const { kind, type } = kindFromTags(place.tags)
    const sitelinks = facts.get(qid)?.sitelinks
    all.push({
      pageId: page.pageId,
      title: page.title,
      description: page.description,
      lat: page.lat,
      lon: page.lon,
      kind,
      osmType: type,
      views: page.views,
      ...(sitelinks !== undefined ? { sitelinks } : {}),
      score: Math.round((notability(page) + Math.log10((sitelinks ?? 0) + 1) * 3) * 100) / 100,
    })
  }
  const fame = all.filter(famous)
  const pool = fame.length >= MIN_POOL ? fame : all
  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map(({ views: _views, ...c }) => c)
}

export async function runCandidates(survey: Survey, deps: PipelineDeps, emit: Emit): Promise<Candidate[]> {
  const s = stage(emit, 'candidates')
  s.start('Collecting verified tourist places from OpenStreetMap and Wikipedia...')
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

  let osm: OsmPlace[] = []
  try {
    osm = (await deps.overpass.attractions(survey.center, survey.radiusM)).filter(
      (p) => p.tags.wikidata && distanceM(p, survey.center) <= survey.radiusM,
    )
  } catch {
    s.progress('OpenStreetMap is not responding, so places are checked against Wikipedia only.')
  }

  if (osm.length > 0) {
    try {
      const pool = await verifiedFromOsm(osm, pages, survey, deps)
      if (pool.length >= MIN_VERIFIED) {
        s.done(`Found ${pool.length} verified tourist places (tagged on OpenStreetMap, with a Wikipedia article).`)
        return pool
      }
      s.progress('Too few verified places here, so the search widens to all notable Wikipedia places.')
    } catch {
      s.progress('Could not check places against Wikidata, so the search uses Wikipedia only.')
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

async function verifiedFromOsm(osm: OsmPlace[], pages: WikiPage[], survey: Survey, deps: PipelineDeps): Promise<Candidate[]> {
  const pageByQid = new Map<string, WikiPage>()
  for (const p of pages) if (p.wikidata && !pageByQid.has(p.wikidata)) pageByQid.set(p.wikidata, p)

  // Best-known first, so the lookup cap never cuts a landmark.
  const ordered = osm.slice().sort((a, b) => osmFame(b.tags) - osmFame(a.tags))
  const qids = [...new Set(ordered.map((p) => p.tags.wikidata!).filter(isQid))].slice(0, MAX_FACTS)
  const facts = await deps.wikidata.facts(qids)

  // English articles the geosearch missed, most famous first.
  const extra = qids
    .filter((q) => !pageByQid.has(q) && facts.get(q)?.enTitle)
    .sort((a, b) => (facts.get(b)?.sitelinks ?? 0) - (facts.get(a)?.sitelinks ?? 0))
    .slice(0, MAX_EXTRA_PAGES)
  if (extra.length > 0) {
    const byTitle = new Map(extra.map((q) => [facts.get(q)!.enTitle!, q]))
    try {
      for (const page of await deps.wikipedia.pages([...byTitle.keys()])) {
        const qid = page.wikidata ?? byTitle.get(page.title)
        if (qid && !pageByQid.has(qid)) pageByQid.set(qid, page)
      }
    } catch {
      // The places the geosearch found are still verified.
    }
  }
  return verifiedPool(osm, pageByQid, facts, survey.center, survey.radiusM)
}
