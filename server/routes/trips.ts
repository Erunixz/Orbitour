import type { FailEvent, StageEvent, TripEvent } from '../../src/lib/planEvents.js'
import { tripIdSchema, tripRequestSchema, type TripList } from '../../src/lib/schemas.js'
import { ApiError, parseBody, readJson, sendJson, type Req, type Res } from '../http.js'
import { PlanError, type PipelineDeps } from '../pipeline/context.js'
import { planTrip } from '../pipeline/pipeline.js'
import { openSse } from '../sse.js'
import { StoreUnavailableError, type TripStore } from '../store/tripStore.js'

export type TripRouteDeps = PipelineDeps & { store: TripStore }

/** POST /api/trips: plans a trip and streams the crew's progress as Server-Sent Events. */
export async function handlePlanTrip(req: Req, res: Res, deps: TripRouteDeps): Promise<void> {
  const request = parseBody(tripRequestSchema, await readJson(req))
  if (request.startDate && Number.isNaN(Date.parse(`${request.startDate}T00:00:00Z`))) {
    throw new ApiError(400, 'invalid_request', 'startDate is not a real date.')
  }
  if (request.startTime >= request.endTime) {
    throw new ApiError(400, 'invalid_request', 'The day must end after it starts.')
  }

  const stream = openSse(res)
  const controller = new AbortController()
  // The client closed the page or pressed cancel: stop spending on it.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  const started = Date.now()
  try {
    const { trip, usage } = await planTrip(request, deps, (event: StageEvent) => stream.send('stage', event), controller.signal)
    // A plan costs money to make, so a database problem must not lose it: send it anyway.
    let saved = true
    try {
      await deps.store.save(trip)
    } catch {
      saved = false
    }
    deps.log(
      `[plan] ${trip.days.length} days, ${trip.days.reduce((n, d) => n + d.stops.length, 0)} stops in ${Date.now() - started}ms, llm calls=${usage.calls} in=${usage.inputTokens} out=${usage.outputTokens}`,
    )
    const done: TripEvent = { type: 'trip', trip, usage, saved }
    stream.send('trip', done)
  } catch (error) {
    const fail: FailEvent =
      error instanceof PlanError
        ? { type: 'fail', code: error.code, message: error.message }
        : { type: 'fail', code: 'internal', message: 'Planning failed unexpectedly. Try again.' }
    if (!(error instanceof PlanError)) console.error('[plan] unexpected error', error)
    if (fail.code !== 'aborted') stream.send('fail', fail)
  } finally {
    stream.close()
  }
}

const RECENT_LIMIT = 20

/** Runs a store call, turning an unreachable database into a clear 503. */
async function withStore<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof StoreUnavailableError) throw new ApiError(503, 'store_unavailable', error.message)
    throw error
  }
}

function checkId(id: string): string {
  if (!tripIdSchema.safeParse(id).success) throw new ApiError(400, 'invalid_id', 'That is not a valid trip id.')
  return id
}

/** GET /api/trips: recent saved trips. */
export async function handleListTrips(res: Res, deps: { store: TripStore }): Promise<void> {
  const trips = await withStore(() => deps.store.list(RECENT_LIMIT))
  const body: TripList = { trips, store: deps.store.kind }
  sendJson(res, 200, body)
}

/** GET /api/trips/:id */
export async function handleGetTrip(res: Res, id: string, deps: { store: TripStore }): Promise<void> {
  const trip = await withStore(() => deps.store.get(checkId(id)))
  if (!trip) {
    const hint = deps.store.kind === 'memory' ? ' Without a database, trips are kept in memory, so a server restart clears them.' : ''
    throw new ApiError(404, 'trip_not_found', `No trip with that id.${hint}`)
  }
  sendJson(res, 200, trip)
}

/** DELETE /api/trips/:id */
export async function handleDeleteTrip(res: Res, id: string, deps: { store: TripStore }): Promise<void> {
  const deleted = await withStore(() => deps.store.delete(checkId(id)))
  if (!deleted) throw new ApiError(404, 'trip_not_found', 'No trip with that id.')
  res.statusCode = 204
  res.end()
}
