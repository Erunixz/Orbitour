import type { LlmUsage, StageData, StageEvent } from '../../src/lib/planEvents.js'
import type { StageId } from '../../src/lib/crew.js'
import type { LatLon, Source, Stop, StopKind, TripRequest } from '../../src/lib/types.js'
import type { Cache } from '../cache.js'
import type { Llm } from '../llm/openai.js'
import type { RouteMatrixClient, RoutesClient } from '../upstream/googleRoutes.js'
import type { NominatimClient, Place } from '../upstream/nominatim.js'
import type { WeatherClient } from '../upstream/openMeteo.js'
import type { OverpassClient } from '../upstream/overpass.js'
import type { WikipediaClient } from '../upstream/wikipedia.js'

// Shared shapes for the planning pipeline.

export type PipelineDeps = {
  nominatim: NominatimClient
  wikipedia: WikipediaClient
  overpass: OverpassClient
  weather: WeatherClient
  routes: RoutesClient | null
  matrix: RouteMatrixClient | null
  llm: Llm
  cache: Cache
  log: (message: string) => void
  now: () => Date
  newId: () => string
}

export type Emit = (event: StageEvent) => void

/** Sends stage events for one crew member. */
export function stage(emit: Emit, id: StageId) {
  const send = (status: StageEvent['status'], message: string, data?: StageData) =>
    emit({ type: 'stage', stage: id, status, message, ...(data ? { data } : {}) })
  return {
    start: (message: string) => send('start', message),
    progress: (message: string, data?: StageData) => send('progress', message, data),
    done: (message: string, data?: StageData) => send('done', message, data),
    error: (message: string) => send('error', message),
  }
}

/** Stops the pipeline cleanly: the client went away or a stage cannot go on. */
export class PlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Must-see places may sit this many trip radii from the center (a landmark at the edge of town). */
export const MUST_SEE_REACH = 2

export type MustSee = {
  typed: string
  /** Where we found it, or null when nothing matched inside the trip area. */
  place: Place | null
}

export type Survey = {
  label: string
  center: LatLon
  radiusM: number
  startFrom: { typed: string; place: Place | null } | null
  mustSee: MustSee[]
}

export type Candidate = LatLon & {
  pageId: number
  title: string
  description: string
  kind: StopKind
  score: number
}

/** A stop before the Timekeeper has given it times. */
export type PlannedStop = Omit<Stop, 'visitMin' | 'arrive' | 'depart'> & {
  /** 1 (nice to have) to 5 (a highlight). Must-see stops are 5. */
  importance: number
  meal?: 'lunch' | 'dinner'
}

export type PlanState = {
  request: TripRequest
  survey: Survey
  usage: LlmUsage
  /** Notes for the Scout's next run, from the Critic. */
  scoutFeedback: string[]
  /** Titles the Scout must not pick again. */
  banned: Set<string>
}

export const wikiSource = (url: string): Source => ({ kind: 'wikipedia', label: 'Wikipedia', url })
export const osmSource = (url: string): Source => ({ kind: 'osm', label: 'OpenStreetMap', url })
export const nominatimSource = (url: string): Source => ({ kind: 'nominatim', label: 'OpenStreetMap', url })
