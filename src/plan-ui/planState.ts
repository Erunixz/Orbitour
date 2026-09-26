import { stageIds, type StageId } from '../lib/crew'
import type { LlmUsage, PlanEvent } from '../lib/planEvents'
import type { LatLon, Leg, Trip } from '../lib/types'

// What the planning screen shows, built up from the streamed events.

export type StageStatus = 'waiting' | 'working' | 'done' | 'error'

export type StageView = { status: StageStatus; message: string; log: string[] }

export type StopPreview = LatLon & { id: string; name: string }

export type PlanView = {
  stages: Record<StageId, StageView>
  area: { center: LatLon; radiusM: number; label: string } | null
  /** Verified stops, in the order they passed. */
  stops: StopPreview[]
  /** Ordered days from the Router, once it has run. */
  days: { stops: StopPreview[]; legs: Leg[] }[] | null
  rejected: { title: string; reason: string }[]
  issues: { target: 'scout' | 'timekeeper'; complaint: string }[]
  trip: Trip | null
  usage: LlmUsage | null
  failure: { code: string; message: string } | null
}

const LOG_LIMIT = 30

export function initialPlanView(): PlanView {
  const stages = Object.fromEntries(stageIds.map((id) => [id, { status: 'waiting', message: '', log: [] }])) as unknown as Record<
    StageId,
    StageView
  >
  return { stages, area: null, stops: [], days: null, rejected: [], issues: [], trip: null, usage: null, failure: null }
}

export function reducePlan(view: PlanView, event: PlanEvent): PlanView {
  if (event.type === 'trip') return { ...view, trip: event.trip, usage: event.usage }
  if (event.type === 'fail') return { ...view, failure: { code: event.code, message: event.message } }

  const prev = view.stages[event.stage]
  const status: StageStatus =
    event.status === 'start' || event.status === 'progress' ? 'working' : event.status === 'done' ? 'done' : 'error'
  const log = event.status === 'start' ? [event.message] : [...prev.log, event.message].slice(-LOG_LIMIT)
  const next: PlanView = { ...view, stages: { ...view.stages, [event.stage]: { status, message: event.message, log } } }

  // A new Scout run starts a fresh set of stops.
  if (event.stage === 'scout' && event.status === 'start') {
    next.stops = []
    next.days = null
  }
  const data = event.data
  if (!data) return next
  if (data.area) next.area = data.area
  if (data.stop && !next.stops.some((s) => s.id === data.stop!.id)) next.stops = [...next.stops, data.stop]
  if (data.rejected) next.rejected = [...next.rejected, data.rejected]
  if (data.days) next.days = data.days
  if (data.issues) next.issues = [...next.issues, ...data.issues]
  return next
}
