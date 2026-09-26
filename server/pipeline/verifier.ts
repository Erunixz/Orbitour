import { distanceM } from '../../src/lib/geo.js'
import type { StopKind } from '../../src/lib/types.js'
import type { Place } from '../upstream/nominatim.js'
import type { WikiArticle } from '../upstream/wikipedia.js'
import {
  MUST_SEE_REACH,
  nominatimSource,
  stage,
  wikiSource,
  type Candidate,
  type Emit,
  type MustSee,
  type PipelineDeps,
  type PlannedStop,
  type Survey,
} from './context.js'
import { guessKind, isDestination, kindFromOsm, osmSummary } from './places.js'
import type { ScoutPick } from './scout.js'

// Verifier (code): every pick must be a real Wikipedia article with coordinates
// inside the trip area. Everything else is dropped with a reason. Must-see
// places the Scout left out are added back.

/** Two picks closer than this are the same place. Neighbours like a convent next to a lift stay apart. */
const SAME_PLACE_M = 35
/** A stop this close to a must-see place counts as that place. */
const MUST_SEE_MATCH_M = 250

export type Rejection = { title: string; reason: string }

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** "Sacré-Cœur (Paris)" to "Sacré-Cœur". */
export const displayName = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '').trim()

function namesMatch(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  return x.length > 2 && y.length > 2 && (x === y || x.includes(y) || y.includes(x))
}

function mustSeeFor(stop: { name: string; lat: number; lon: number }, mustSee: MustSee[]): MustSee | undefined {
  return mustSee.find(
    (m) =>
      m.place &&
      (distanceM(stop, m.place) <= MUST_SEE_MATCH_M || namesMatch(stop.name, m.place.name) || namesMatch(stop.name, m.typed)),
  )
}

function stopFromArticle(article: WikiArticle, kind: StopKind, reason: string, importance: number): PlannedStop {
  return {
    id: `wiki-${article.pageId}`,
    name: displayName(article.title),
    kind,
    lat: article.lat,
    lon: article.lon,
    summary: article.extract || article.description,
    reason,
    photo: null,
    sources: [wikiSource(article.url)],
    mustSee: false,
    importance,
  }
}

function stopFromPlace(place: Place, typed: string): PlannedStop {
  const kind = kindFromOsm(place.category, place.type)
  return {
    id: `osm-${norm(place.osmUrl ?? `${place.lat},${place.lon}`).replace(/ /g, '-')}`,
    name: place.name,
    kind: kind === 'lodging' || kind === 'food' ? 'sight' : kind,
    lat: place.lat,
    lon: place.lon,
    summary: osmSummary(place.type, place.displayName),
    reason: `You asked for ${typed}.`,
    photo: null,
    sources: place.osmUrl ? [nominatimSource(place.osmUrl)] : [],
    mustSee: true,
    importance: 5,
  }
}

export async function runVerifier(
  picks: ScoutPick[],
  pool: Candidate[],
  survey: Survey,
  deps: PipelineDeps,
  emit: Emit,
): Promise<{ stops: PlannedStop[]; rejected: Rejection[] }> {
  const s = stage(emit, 'verifier')
  s.start(`Checking ${picks.length} picks against Wikipedia...`)

  const poolByTitle = new Map(pool.map((c) => [c.title.toLowerCase(), c]))
  let articles = new Map<string, WikiArticle | null>()
  try {
    articles = await deps.wikipedia.lookup(picks.map((p) => p.title))
  } catch {
    s.progress('Wikipedia did not answer. Using what the candidate pool already knows.')
  }

  const stops: PlannedStop[] = []
  const rejected: Rejection[] = []
  const reject = (title: string, reason: string) => {
    rejected.push({ title, reason })
    s.progress(`Dropped ${title}: ${reason}`, { rejected: { title, reason } })
  }
  const accept = (stop: PlannedStop) => {
    stops.push(stop)
    s.progress(`Verified ${stop.name}.`, { stop: { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon } })
  }

  for (const pick of picks) {
    const fromPool = poolByTitle.get(pick.title.toLowerCase())
    const article = articles.get(pick.title.trim()) ?? null
    if (!article) {
      // The pool knows it but the lookup failed: build from what we have.
      if (!fromPool) {
        reject(pick.title, 'no Wikipedia article with a location')
        continue
      }
    }
    const lat = article?.lat ?? fromPool!.lat
    const lon = article?.lon ?? fromPool!.lon
    const title = article?.title ?? fromPool!.title
    const description = article?.description ?? fromPool!.description
    const matched = mustSeeFor({ name: displayName(title), lat, lon }, survey.mustSee)

    const limit = matched ? survey.radiusM * MUST_SEE_REACH : survey.radiusM
    const away = distanceM({ lat, lon }, survey.center)
    if (away > limit) {
      reject(title, `outside the trip area (${(away / 1000).toFixed(1)} km from the center)`)
      continue
    }
    if (!matched && !isDestination(title, description)) {
      reject(title, 'not a place to visit')
      continue
    }
    const pageId = article?.pageId ?? fromPool!.pageId
    const duplicate = stops.find((st) => st.id === `wiki-${pageId}` || distanceM(st, { lat, lon }) < SAME_PLACE_M)
    if (duplicate) {
      reject(title, `same place as ${duplicate.name}`)
      continue
    }

    const kind = pick.kind === 'other' ? guessKind(title, description) : pick.kind
    const stop = article
      ? stopFromArticle(article, kind, pick.reason, pick.importance)
      : stopFromArticle(
          { pageId, title, description, lat, lon, extract: '', url: `https://en.wikipedia.org/?curid=${pageId}`, image: null },
          kind,
          pick.reason,
          pick.importance,
        )
    if (matched) {
      stop.mustSee = true
      stop.importance = 5
    }
    accept(stop)
  }

  // Must-see places are always kept, even when the Scout skipped them.
  for (const m of survey.mustSee) {
    if (!m.place || stops.some((st) => st.mustSee && mustSeeFor(st, [m]))) continue
    const near = stops.find((st) => mustSeeFor(st, [m]))
    if (near) {
      near.mustSee = true
      near.importance = 5
      continue
    }
    accept(await mustSeeStop(m, m.place, deps))
  }

  // Photos with credits, in one batch.
  const files = new Map<string, string>()
  for (const article of articles.values()) if (article?.image) files.set(`wiki-${article.pageId}`, article.image)
  if (files.size > 0) {
    try {
      const photos = await deps.wikipedia.photos([...files.values()])
      for (const stop of stops) {
        const file = files.get(stop.id)
        const photo = file ? photos.get(file) : undefined
        if (photo) stop.photo = photo
      }
    } catch {
      // Photos are a nice extra. The plan works without them.
    }
  }

  s.done(`${stops.length} places passed, ${rejected.length} dropped.`)
  return { stops, rejected }
}

/** A must-see place: its Wikipedia article when one sits right there, else the map result. */
async function mustSeeStop(m: MustSee, place: Place, deps: PipelineDeps): Promise<PlannedStop> {
  try {
    const titles = await deps.wikipedia.searchTitles(m.typed, 3)
    const found = await deps.wikipedia.lookup(titles)
    for (const title of titles) {
      const article = found.get(title)
      if (article && distanceM(article, place) <= MUST_SEE_MATCH_M) {
        const stop = stopFromArticle(article, guessKind(article.title, article.description), `You asked for ${m.typed}.`, 5)
        stop.mustSee = true
        if (article.image) {
          const photo = (await deps.wikipedia.photos([article.image])).get(article.image)
          if (photo) stop.photo = photo
        }
        return stop
      }
    }
  } catch {
    // Fall back to the map result below.
  }
  return stopFromPlace(place, m.typed)
}
