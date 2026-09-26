import { distanceM } from '../../src/lib/geo.js'
import { patchDaySchema, replanBodySchema, type PlaceResult } from '../../src/lib/edits.js'
import { tripIdSchema } from '../../src/lib/schemas.js'
import type { Trip } from '../../src/lib/types.js'
import { ApiError, parseBody, readJson, sendJson, type Req, type Res } from '../http.js'
import { MUST_SEE_REACH, PlanError } from '../pipeline/context.js'
import { applyChanges, EditError, type Change } from '../pipeline/edit.js'
import { osmSummary } from '../pipeline/places.js'
import { replan } from '../pipeline/replan.js'
import { stopForPlace } from '../pipeline/verifier.js'
import { StoreUnavailableError } from '../store/tripStore.js'
import type { TripRouteDeps } from './trips.js'
import type { Place } from '../upstream/nominatim.js'

// Editing a saved trip: manual edits, typed changes, undo, and place search.
// Every change keeps the version before it, so one undo is always possible.

async function load(id: string, deps: TripRouteDeps): Promise<Trip> {
  if (!tripIdSchema.safeParse(id).success) throw new ApiError(400, 'invalid_id', 'That is not a valid trip id.')
  const trip = await store(() => deps.store.get(id))
  if (!trip) throw new ApiError(404, 'trip_not_found', 'No trip with that id.')
  return trip
}

async function store<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof StoreUnavailableError) throw new ApiError(503, 'store_unavailable', error.message)
    throw error
  }
}

/** Runs a change and saves it with the previous version kept for undo. */
async function saveChange(res: Res, before: Trip, change: () => Promise<Trip>, deps: TripRouteDeps): Promise<void> {
  let next: Trip
  try {
    next = await change()
  } catch (error) {
    if (error instanceof EditError) throw new ApiError(400, 'invalid_edit', error.message)
    if (error instanceof PlanError) {
      throw new ApiError(error.code === 'llm_not_configured' ? 400 : 502, error.code, error.message)
    }
    throw error
  }
  await store(() => deps.store.saveEdit(next, before))
  sendJson(res, 200, next)
}

const toPlace = (p: PlaceResult): Place => ({
  lat: p.lat,
  lon: p.lon,
  name: p.name,
  displayName: p.label,
  category: p.category,
  type: p.type,
  osmUrl: p.osmUrl,
  bbox: null,
})

/** PATCH /api/trips/:id/days/:dayIndex: manual edits. No LLM call. */
export async function handlePatchDay(req: Req, res: Res, id: string, dayParam: string, deps: TripRouteDeps): Promise<void> {
  const body = parseBody(patchDaySchema, await readJson(req))
  const trip = await load(id, deps)
  const dayIndex = Number(dayParam)
  const day = trip.days[dayIndex]
  if (!Number.isInteger(dayIndex) || !day) throw new ApiError(404, 'day_not_found', 'This trip has no such day.')

  await saveChange(
    res,
    trip,
    async () => {
      const changes: Change[] = []
      for (const edit of body.edits) {
        if (edit.op === 'add') {
          const away = distanceM(edit.place, trip.center)
          if (away > trip.radiusM * MUST_SEE_REACH) {
            throw new EditError(`${edit.place.name} is ${(away / 1000).toFixed(1)} km away, outside this trip's area.`)
          }
          const stop = await stopForPlace(toPlace(edit.place), edit.place.name, 'You added this.', deps)
          changes.push({ kind: 'add', stop, day: dayIndex, index: edit.index ?? null })
          continue
        }
        // Edits name stops of this day only, so a stale page cannot change another day by mistake.
        if (!day.stops.some((s) => s.id === edit.stopId)) throw new EditError('That stop is not on this day any more. Reload the trip.')
        if (edit.op === 'move') changes.push({ kind: 'move', stopId: edit.stopId, toIndex: edit.toIndex })
        else if (edit.op === 'remove') changes.push({ kind: 'remove', stopId: edit.stopId })
        else if (edit.op === 'setVisit') changes.push({ kind: 'setVisit', stopId: edit.stopId, minutes: edit.minutes })
        else changes.push({ kind: 'moveToDay', stopId: edit.stopId, toDay: edit.toDay })
      }
      return applyChanges(trip, changes, deps)
    },
    deps,
  )
}

/** POST /api/trips/:id/replan: a typed change like "drop the museum, slower morning". */
export async function handleReplan(req: Req, res: Res, id: string, deps: TripRouteDeps, countUse: () => void = () => {}): Promise<void> {
  const { text } = parseBody(replanBodySchema, await readJson(req))
  const trip = await load(id, deps)
  countUse()
  await saveChange(res, trip, async () => (await replan(text, trip, deps)).trip, deps)
}

/** POST /api/trips/:id/undo: puts the version before the last change back. */
export async function handleUndo(res: Res, id: string, deps: TripRouteDeps): Promise<void> {
  await load(id, deps)
  const trip = await store(() => deps.store.undo(id))
  if (!trip) throw new ApiError(409, 'nothing_to_undo', 'There is no change to undo.')
  sendJson(res, 200, trip)
}

/**
 * GET /api/places/search?q=&tripId=: places to add, near the trip when given.
 * The app searches when the traveller presses Search, never per keystroke (Nominatim policy).
 */
export async function handlePlaceSearch(req: Req, res: Res, deps: TripRouteDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < 2 || q.length > 120) throw new ApiError(400, 'invalid_request', 'Search for 2 to 120 characters.')
  const tripId = url.searchParams.get('tripId')
  const trip = tripId ? await load(tripId, deps) : null
  const near = trip ? { center: trip.center, radiusM: trip.radiusM * MUST_SEE_REACH } : undefined

  let found: Place[]
  try {
    found = await deps.nominatim.search(q, { limit: 6, ...(near ? { near } : {}) })
  } catch {
    throw new ApiError(502, 'upstream_down', 'The place search is not responding. Try again in a minute.')
  }
  // One square or station often comes back as several map objects. Keep the first of each.
  const unique = found.filter(
    (p, i) => !found.slice(0, i).some((q) => q.name.toLowerCase() === p.name.toLowerCase() && distanceM(p, q) < 150),
  )
  const places: PlaceResult[] = unique.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    label: osmSummary(p.type, p.displayName).replace(/\.$/, ''),
    category: p.category.slice(0, 60),
    type: p.type.slice(0, 60),
    osmUrl: p.osmUrl,
  }))
  sendJson(res, 200, { places })
}
