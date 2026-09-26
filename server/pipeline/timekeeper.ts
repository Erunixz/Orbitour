import type { Leg, Party, Pace, Stop, StopKind, TripRequest } from '../../src/lib/types.js'
import { stage, type Emit, type PipelineDeps, type PlannedStop } from './context.js'
import { legKey, legsFor, type RoutedDay } from './router.js'

// Timekeeper (code): visit lengths, arrive and leave times, and an audit of each
// day. All time math lives here, never in an LLM.

const BASE_VISIT_MIN: Record<StopKind, number> = {
  museum: 120,
  sight: 60,
  park: 60,
  viewpoint: 60,
  market: 60,
  food: 60,
  lodging: 0,
  other: 45,
}

const PACE_FACTOR: Record<Pace, number> = { relaxed: 1.25, normal: 1, packed: 0.8 }
const PARTY_FACTOR: Record<Party, number> = { solo: 1, couple: 1, family: 1.1, easy: 1.15 }

/** Legs longer than this get a warning. */
export const LONG_LEG_MIN = 45
const LAST_MINUTE = 23 * 60 + 55

export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const toTime = (m: number) => {
  const clamped = Math.max(0, Math.min(LAST_MINUTE, Math.round(m)))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}
const roundUp5 = (m: number) => Math.ceil(m / 5) * 5

/** Minutes at a stop, by kind, pace and party. `slack` above 1 slows a day down. */
export function visitMinutes(stop: Pick<PlannedStop, 'kind' | 'meal'>, request: TripRequest, slack = 1): number {
  const base = stop.meal === 'dinner' ? 90 : BASE_VISIT_MIN[stop.kind]
  if (base === 0) return 0
  const m = base * PACE_FACTOR[request.pace] * PARTY_FACTOR[request.party] * slack
  return Math.max(20, Math.round(m / 5) * 5)
}

/** Meals never start before these times; any gap before them is free time. */
export const EARLIEST_MEAL_MIN = { lunch: 11 * 60 + 45, dinner: 19 * 60 }

/** Arrive and leave times for one day. Arrivals round up to the next 5 minutes. */
export function schedule(stops: PlannedStop[], legs: Leg[], request: TripRequest, slack = 1): Stop[] {
  let t = toMinutes(request.startTime)
  return stops.map((planned, i) => {
    if (i > 0) t = roundUp5(t + (legs[i - 1]?.minutes ?? 0))
    if (planned.meal) t = Math.max(t, EARLIEST_MEAL_MIN[planned.meal])
    const visitMin = planned.fixedMin ?? visitMinutes(planned, request, slack)
    const arrive = t
    t += visitMin
    const { importance: _importance, meal: _meal, fixedMin: _fixed, ...stop } = planned
    return { ...stop, visitMin, arrive: toTime(arrive), depart: toTime(t) }
  })
}

/** True for day warnings the audit wrote, so they can be replaced when a day is re-timed. */
export function isAuditWarning(text: string): boolean {
  return /^Runs \d+ min past |^\d+ stops is a lot |^.+ takes about \d+ min\.$|^Lunch lands at |^Free time from /.test(text)
}

export type AuditIssue = { kind: 'overrun' | 'too_many' | 'long_leg' | 'late_lunch' | 'free_time'; message: string }

/** A wait longer than this before a meal is worth pointing out. */
const FREE_TIME_MIN = 90

/** Problems numbers can find. Dinner may run past the end time. */
export function audit(stops: Stop[], legs: Leg[], planned: PlannedStop[], request: TripRequest, perDay: number): AuditIssue[] {
  const issues: AuditIssue[] = []
  const end = toMinutes(request.endTime)
  let lastIndex = -1
  planned.forEach((p, i) => {
    if (p.meal !== 'dinner') lastIndex = i
  })
  const lastVisit = stops[lastIndex]
  if (lastVisit && toMinutes(lastVisit.depart) > end) {
    issues.push({
      kind: 'overrun',
      message: `Runs ${toMinutes(lastVisit.depart) - end} min past ${request.endTime}.`,
    })
  }
  const sights = planned.filter((p) => !p.meal && p.role !== 'start').length
  if (sights > perDay + 2) issues.push({ kind: 'too_many', message: `${sights} stops is a lot for one day.` })
  legs.forEach((leg, i) => {
    if (leg.minutes > LONG_LEG_MIN) {
      issues.push({
        kind: 'long_leg',
        message: `${stops[i]?.name} to ${stops[i + 1]?.name} takes about ${leg.minutes} min.`,
      })
    }
  })
  stops.forEach((stop, i) => {
    const before = stops[i - 1]
    if (!before || !planned[i]?.meal) return
    const gap = toMinutes(stop.arrive) - toMinutes(before.depart) - (legs[i - 1]?.minutes ?? 0)
    if (gap > FREE_TIME_MIN) issues.push({ kind: 'free_time', message: `Free time from ${before.depart} until ${planned[i]!.meal} at ${stop.arrive}.` })
  })
  const lunchIndex = planned.findIndex((p) => p.meal === 'lunch')
  const lunch = stops[lunchIndex]
  if (lunch && (toMinutes(lunch.arrive) > 14 * 60 + 30 || toMinutes(lunch.arrive) < 11 * 60)) {
    issues.push({ kind: 'late_lunch', message: `Lunch lands at ${lunch.arrive}.` })
  }
  return issues
}

/** Which stop to drop to shorten a day: the least important one that is not a must-see or a meal. */
export function dropCandidate(planned: PlannedStop[]): number {
  let best = -1
  planned.forEach((p, i) => {
    if (p.mustSee || p.meal || p.role === 'start') return
    if (best === -1 || p.importance < planned[best]!.importance) best = i
  })
  return best
}

export type TimedDay = RoutedDay & { timed: Stop[]; audit: AuditIssue[] }

/**
 * Schedules each day and fixes overruns in code before anyone else sees the plan:
 * drop the least important stop that is not a must-see or a meal, re-route, repeat.
 * `slack` slows a day down (from the Critic), by day index.
 */
export async function runTimekeeper(
  days: RoutedDay[],
  request: TripRequest,
  perDay: number,
  slack: Map<number, number>,
  deps: PipelineDeps,
  emit: Emit,
): Promise<TimedDay[]> {
  const s = stage(emit, 'timekeeper')
  s.start('Setting times for each stop...')
  const out: TimedDay[] = []
  for (const [d, day] of days.entries()) {
    let stops = day.stops
    let legs = day.legs
    const factor = slack.get(d) ?? 1
    let timed = schedule(stops, legs, request, factor)
    let issues = audit(timed, legs, stops, request, perDay)
    while (issues.some((i) => i.kind === 'overrun')) {
      const drop = dropCandidate(stops)
      if (drop === -1) break
      const gone = stops[drop]!
      stops = stops.filter((_, i) => i !== drop)
      const reuse = new Map(legs.map((l) => [legKey(l.fromId, l.toId), l]))
      legs = await legsFor(stops, request, deps, reuse)
      timed = schedule(stops, legs, request, factor)
      issues = audit(timed, legs, stops, request, perDay)
      s.progress(`Day ${d + 1} ran long, so ${gone.name} was left out.`)
    }
    out.push({ stops, legs, timed, audit: issues })
  }
  const problems = out.reduce((n, day) => n + day.audit.length, 0)
  s.done(problems > 0 ? `Times set. ${problems} things to keep in mind.` : 'Times set. Every day fits.')
  return out
}
