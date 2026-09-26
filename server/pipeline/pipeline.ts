import type { LlmUsage } from '../../src/lib/planEvents.js'
import type { Day, Trip, TripRequest } from '../../src/lib/types.js'
import { runCandidates } from './candidates.js'
import { nominatimSource, PlanError, stage, type Emit, type PipelineDeps, type PlannedStop, type PlanState } from './context.js'
import { runCritic, type CriticIssue } from './critic.js'
import { runDaySplit } from './daySplit.js'
import { runFood, type FoodResult } from './food.js'
import { osmSummary } from './places.js'
import { legKey, legsFor, runRouter } from './router.js'
import { runScout, STOPS_PER_DAY } from './scout.js'
import { runSurveyor } from './surveyor.js'
import { runTimekeeper, type TimedDay } from './timekeeper.js'
import { runVerifier } from './verifier.js'
import { runWeather } from './weather.js'

// The planning crew in a fixed order. Agents never choose tools. The Critic's
// complaints go to the member it names, at most MAX_REVISIONS times.

export const MAX_REVISIONS = 2
const SLOW_DOWN = 1.15
export const TRIP_VERSION = 1

export type PlanResult = { trip: Trip; usage: LlmUsage }

function checkAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new PlanError('aborted', 'Planning was cancelled.')
}

export async function planTrip(
  request: TripRequest,
  deps: PipelineDeps,
  emit: Emit,
  signal?: AbortSignal,
): Promise<PlanResult> {
  const usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0 }
  const survey = await runSurveyor(request, deps, emit)
  checkAborted(signal)

  const pool = await runCandidates(survey, deps, emit)
  if (pool.length === 0 && !survey.mustSee.some((m) => m.place)) {
    throw new PlanError('no_candidates', 'Found no places to visit in this area. Try a bigger city or check the spelling.')
  }
  checkAborted(signal)

  const state: PlanState = { request, survey, usage, scoutFeedback: [], banned: new Set() }
  const perDay = STOPS_PER_DAY[request.pace]
  const start = survey.startFrom?.place ?? null
  const slack = new Map<number, number>()
  const leftover: { day: number; text: string }[] = []

  let food: FoodResult | null = null
  let timed: TimedDay[] = []
  let weather: Awaited<ReturnType<typeof runWeather>> | null = null

  for (let round = 0; ; round++) {
    if (!food) {
      const picks = await runScout(state, pool, deps, emit)
      checkAborted(signal)
      const { stops } = await runVerifier(picks, pool, survey, deps, emit)
      if (stops.length === 0) throw new PlanError('no_stops', 'None of the picks could be verified, so there is nothing to plan.')
      checkAborted(signal)
      const split = runDaySplit(stops, request.days, perDay, start ?? survey.center, emit)
      const routed = await runRouter(split, request, start, deps, emit, survey.startFrom?.place ? startStopFor(survey.startFrom) : null)
      checkAborted(signal)
      food = await runFood(routed, request, survey, deps, emit)
      checkAborted(signal)
    }

    timed = await runTimekeeper(food.days, request, perDay, slack, deps, emit)
    // Keep the Timekeeper's drops for the next round.
    food = { ...food, days: timed.map(({ stops, legs }) => ({ stops, legs })) }
    weather ??= await runWeather(request, survey.center, deps, emit)
    checkAborted(signal)

    const issues = await runCritic(
      state,
      timed.map((d) => ({ stops: d.timed, legs: d.legs, audit: d.audit.map((a) => a.message) })),
      round,
      deps,
      emit,
    )
    checkAborted(signal)
    if (!issues || issues.length === 0) break

    if (round >= MAX_REVISIONS) {
      for (const issue of issues) leftover.push({ day: dayOf(issue, timed), text: issue.complaint })
      stage(emit, 'critic').done(`Kept the plan after ${MAX_REVISIONS} revisions. Remaining notes are shown on each day.`)
      break
    }

    const needScout = await applyIssues(issues, state, timed, slack, food, request, deps)
    if (needScout) food = null
  }

  const days: Day[] = timed.map((day, d) => ({
    index: d,
    ...(weather?.dates[d] ? { date: weather.dates[d] } : {}),
    stops: day.timed,
    legs: day.legs,
    warnings: [
      ...(d === 0 ? survey.mustSee.filter((m) => !m.place).map((m) => `Could not find "${m.typed}" in the trip area.`) : []),
      ...(day.stops.length === 0 ? ['Not enough places were found for this day.'] : []),
      ...(food?.warnings[d] ?? []),
      ...day.audit.filter((a) => a.kind !== 'too_many').map((a) => a.message),
      ...(weather?.warnings[d] ?? []),
      ...leftover.filter((l) => l.day === d).map((l) => l.text),
    ],
  }))

  const now = deps.now().toISOString()
  const city = survey.label.split(',')[0]!.trim()
  const trip: Trip = {
    id: deps.newId(),
    title: request.days === 1 ? `A day in ${city}` : `${request.days} days in ${city}`,
    request,
    center: survey.center,
    radiusM: survey.radiusM,
    days,
    ...(food?.lodging ? { lodging: food.lodging } : {}),
    createdAt: now,
    updatedAt: now,
    version: TRIP_VERSION,
  }
  return { trip, usage }
}

/** The user's starting point as the first stop of a day. Ids differ per day so every stop id is unique. */
function startStopFor(startFrom: NonNullable<PlanState['survey']['startFrom']>) {
  const place = startFrom.place!
  return (day: number): PlannedStop => ({
    id: `start-${day + 1}`,
    name: place.name,
    kind: 'lodging',
    lat: place.lat,
    lon: place.lon,
    summary: osmSummary(place.type, place.displayName),
    reason: `Your starting point ("${startFrom.typed}").`,
    photo: null,
    sources: place.osmUrl ? [nominatimSource(place.osmUrl)] : [],
    mustSee: false,
    importance: 5,
    role: 'start',
  })
}

function dayOf(issue: CriticIssue, days: TimedDay[]): number {
  if (!issue.stopId) return 0
  const d = days.findIndex((day) => day.stops.some((s) => s.id === issue.stopId))
  return d === -1 ? 0 : d
}

/**
 * Routes each complaint to its crew member. Scout notes go into the Scout's next
 * prompt (and the stop is avoided). Timekeeper notes slow a day down or drop a
 * stop in code. Returns true when the Scout must run again.
 */
async function applyIssues(
  issues: CriticIssue[],
  state: PlanState,
  days: TimedDay[],
  slack: Map<number, number>,
  food: FoodResult,
  request: TripRequest,
  deps: PipelineDeps,
): Promise<boolean> {
  let needScout = false
  for (const issue of issues) {
    const d = dayOf(issue, days)
    const stop = issue.stopId ? days[d]?.stops.find((s) => s.id === issue.stopId) : undefined
    if (issue.target === 'scout') {
      needScout = true
      state.scoutFeedback.push(stop ? `${issue.complaint} (about ${stop.name})` : issue.complaint)
      // Never swap out a must-see stop or the starting point, whatever the Critic says.
      if (stop && !stop.mustSee && stop.role !== 'start' && issue.action === 'replace_stop') {
        state.banned.add(stop.name.toLowerCase())
      }
      continue
    }
    if (issue.action === 'slow_down') {
      slack.set(d, (slack.get(d) ?? 1) * SLOW_DOWN)
    } else if (issue.action === 'drop_stop' && stop && !stop.mustSee && !stop.meal && stop.role !== 'start') {
      const day = food.days[d]
      if (!day) continue
      const stops = day.stops.filter((s) => s.id !== stop.id)
      const reuse = new Map(day.legs.map((l) => [legKey(l.fromId, l.toId), l]))
      food.days[d] = { stops, legs: await legsFor(stops, request, deps, reuse) }
    }
  }
  return needScout
}
