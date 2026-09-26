import { distanceM } from '../../src/lib/geo.js'
import type { Day, Leg, Pace, Stop, Trip } from '../../src/lib/types.js'
import type { PipelineDeps, PlannedStop } from './context.js'
import { legKey, legsFor } from './router.js'
import { STOPS_PER_DAY } from './scout.js'
import { audit, isAuditWarning, schedule } from './timekeeper.js'

// Applies changes to a saved trip. Only the days that changed are re-routed and
// re-timed, legs that still connect the same two stops are reused, and stops the
// change did not touch keep their ids and data. Edits come from the traveller,
// so a day that runs long gets a warning instead of losing stops.

export type Change =
  | { kind: 'move'; stopId: string; toIndex: number }
  | { kind: 'remove'; stopId: string }
  | { kind: 'setVisit'; stopId: string; minutes: number }
  | { kind: 'moveToDay'; stopId: string; toDay: number }
  | { kind: 'add'; stop: PlannedStop; day: number | null; index: number | null }
  | { kind: 'setPace'; pace: Pace }
  | { kind: 'setTimes'; startTime: string; endTime: string }

/** A change that cannot be applied, with a message for the traveller. */
export class EditError extends Error {}

const NOT_ENOUGH = 'Not enough places were found for this day.'
const isStart = (s: { role?: 'start' }) => s.role === 'start'

/** A stored stop back as a planned one. Its visit length is kept as it was. */
export function toPlanned(stop: Stop): PlannedStop {
  const { visitMin, arrive, depart: _depart, ...rest } = stop
  const planned: PlannedStop = { ...rest, importance: stop.mustSee ? 5 : 3, fixedMin: visitMin }
  if (stop.kind === 'food') planned.meal = arrive >= '17:00' ? 'dinner' : 'lunch'
  return planned
}

export function findStop(days: { id: string }[][], stopId: string): { day: number; index: number } | null {
  for (let d = 0; d < days.length; d++) {
    const index = days[d]!.findIndex((s) => s.id === stopId)
    if (index !== -1) return { day: d, index }
  }
  return null
}

/** First position a place may take: after the starting point, if the day has one. */
const firstSlot = (stops: PlannedStop[]) => (stops[0] && isStart(stops[0]) ? 1 : 0)

/** Where a new stop adds the least walking (straight line), keeping the start first. */
export function bestIndex(stops: PlannedStop[], stop: { lat: number; lon: number }): number {
  let best = stops.length
  let bestCost = Infinity
  for (let i = firstSlot(stops); i <= stops.length; i++) {
    const prev = stops[i - 1]
    const next = stops[i]
    const cost =
      (prev ? distanceM(prev, stop) : 0) + (next ? distanceM(stop, next) : 0) - (prev && next ? distanceM(prev, next) : 0)
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}

/** The day whose places are closest to the stop. */
function nearestDay(days: PlannedStop[][], stop: { lat: number; lon: number }): number {
  let best = 0
  let bestDistance = Infinity
  days.forEach((stops, d) => {
    const places = stops.filter((s) => !isStart(s))
    if (places.length === 0) return
    const near = Math.min(...places.map((s) => distanceM(s, stop)))
    if (near < bestDistance) {
      bestDistance = near
      best = d
    }
  })
  return best
}

function locate(days: PlannedStop[][], stopId: string): { day: number; index: number; stop: PlannedStop } {
  const at = findStop(days, stopId)
  if (!at) throw new EditError('That stop is not in this trip any more.')
  return { ...at, stop: days[at.day]![at.index]! }
}

function refuseStart(stop: PlannedStop, what: string) {
  if (isStart(stop)) throw new EditError(`The starting point cannot be ${what}. Change it by planning again.`)
}

export async function applyChanges(trip: Trip, changes: Change[], deps: PipelineDeps): Promise<Trip> {
  const request = { ...trip.request }
  const days = trip.days.map((d) => d.stops.map(toPlanned))
  const touched = new Set<number>()
  let everyDay = false
  const startTemplate = days.flat().find(isStart)

  for (const change of changes) {
    switch (change.kind) {
      case 'move': {
        const { day, index, stop } = locate(days, change.stopId)
        refuseStart(stop, 'moved')
        const stops = days[day]!
        stops.splice(index, 1)
        const to = Math.max(firstSlot(stops), Math.min(stops.length, change.toIndex))
        stops.splice(to, 0, stop)
        touched.add(day)
        break
      }
      case 'remove': {
        const { day, index, stop } = locate(days, change.stopId)
        refuseStart(stop, 'removed')
        days[day]!.splice(index, 1)
        touched.add(day)
        break
      }
      case 'setVisit': {
        const { day, stop } = locate(days, change.stopId)
        refuseStart(stop, 'given a visit length')
        stop.fixedMin = change.minutes
        touched.add(day)
        break
      }
      case 'moveToDay': {
        const { day, index, stop } = locate(days, change.stopId)
        refuseStart(stop, 'moved')
        const target = days[change.toDay]
        if (!target) throw new EditError(`There is no day ${change.toDay + 1} in this trip.`)
        if (change.toDay === day) break
        days[day]!.splice(index, 1)
        target.splice(bestIndex(target, stop), 0, stop)
        touched.add(day).add(change.toDay)
        break
      }
      case 'add': {
        if (findStop(days, change.stop.id)) throw new EditError(`${change.stop.name} is already in this trip.`)
        const day = change.day ?? nearestDay(days, change.stop)
        const stops = days[day]
        if (!stops) throw new EditError(`There is no day ${day + 1} in this trip.`)
        const index =
          change.index === null ? bestIndex(stops, change.stop) : Math.max(firstSlot(stops), Math.min(stops.length, change.index))
        stops.splice(index, 0, change.stop)
        touched.add(day)
        break
      }
      case 'setPace': {
        request.pace = change.pace
        // Visit lengths follow the new pace.
        for (const stop of days.flat()) delete stop.fixedMin
        everyDay = true
        break
      }
      case 'setTimes': {
        if (change.startTime >= change.endTime) throw new EditError('The day must end after it starts.')
        request.startTime = change.startTime
        request.endTime = change.endTime
        everyDay = true
        break
      }
    }
  }

  // A day keeps its starting point only while it has places to visit, and a day
  // that gains its first places gets one.
  days.forEach((stops, d) => {
    const places = stops.filter((s) => !isStart(s)).length
    if (places === 0 && stops.length > 0) {
      days[d] = []
      touched.add(d)
    } else if (places > 0 && startTemplate && !stops.some(isStart)) {
      stops.unshift({ ...startTemplate, id: `start-${d + 1}` })
      touched.add(d)
    }
  })

  // Any leg that still joins the same two stops is kept, whichever day it was on.
  const reuse = new Map<string, Leg>(trip.days.flatMap((d) => d.legs).map((l) => [legKey(l.fromId, l.toId), l]))
  const perDay = STOPS_PER_DAY[request.pace]
  const newDays: Day[] = []
  for (const [d, old] of trip.days.entries()) {
    if (!everyDay && !touched.has(d)) {
      newDays.push(old)
      continue
    }
    const stops = days[d]!
    const legs = await legsFor(stops, request, deps, reuse)
    const timed = schedule(stops, legs, request)
    const notes = audit(timed, legs, stops, request, perDay)
      .filter((a) => a.kind !== 'too_many')
      .map((a) => a.message)
    const kept = old.warnings.filter((w) => !isAuditWarning(w) && !(w === NOT_ENOUGH && stops.length > 0))
    newDays.push({ ...old, stops: timed, legs, warnings: [...kept, ...notes] })
  }

  const now = deps.now().toISOString()
  const next: Trip = { ...trip, request, days: newDays, updatedAt: now }
  next.lastChange = { at: now, summary: describeChanges(trip, next), undoable: true }
  return next
}

const MAX_LINES = 8

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Positions (in `seq`) of a longest increasing run; everything else was moved. */
function longestIncreasing(seq: number[]): Set<number> {
  const len = seq.map(() => 1)
  const prev = seq.map(() => -1)
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j]! < seq[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1
        prev[i] = j
      }
    }
  }
  let end = len.indexOf(Math.max(0, ...len))
  const keep = new Set<number>()
  while (end !== -1) {
    keep.add(end)
    end = prev[end]!
  }
  return keep
}

/** Short lines saying what changed, like "Removed Louvre Museum." */
export function describeChanges(before: Trip, after: Trip): string[] {
  const lines: string[] = []
  const where = (trip: Trip) => {
    const map = new Map<string, { day: number; index: number; stop: Stop }>()
    trip.days.forEach((d, day) => d.stops.forEach((stop, index) => !isStart(stop) && map.set(stop.id, { day, index, stop })))
    return map
  }
  const old = where(before)
  const now = where(after)
  const multiDay = after.days.length > 1

  for (const [id, { stop }] of old) if (!now.has(id)) lines.push(`Removed ${stop.name}.`)
  for (const [id, { day, stop }] of now) {
    const was = old.get(id)
    const dayText = multiDay ? ` to day ${day + 1}` : ''
    if (!was) lines.push(`Added ${stop.name}${dayText} at ${stop.arrive}.`)
    else if (was.day !== day) lines.push(`Moved ${stop.name} to day ${day + 1} at ${stop.arrive}.`)
    else if (was.stop.visitMin !== stop.visitMin && before.request.pace === after.request.pace) {
      lines.push(`${stop.name} now has ${formatMinutes(stop.visitMin)}.`)
    }
  }

  // Order changes within a day: the stops outside the longest unchanged run moved.
  after.days.forEach((day, d) => {
    const common = day.stops.filter((s) => old.get(s.id)?.day === d)
    const seq = common.map((s) => old.get(s.id)!.index)
    const keep = longestIncreasing(seq)
    common.forEach((s, i) => {
      if (!keep.has(i)) lines.push(`Moved ${s.name}, now at ${s.arrive}.`)
    })
  })

  if (before.request.pace !== after.request.pace) lines.push(`Pace is now ${after.request.pace}.`)
  if (before.request.startTime !== after.request.startTime || before.request.endTime !== after.request.endTime) {
    lines.push(`Days now run ${after.request.startTime} to ${after.request.endTime}.`)
  }

  if (lines.length === 0) return ['Nothing changed.']
  if (lines.length > MAX_LINES) return [...lines.slice(0, MAX_LINES - 1), `And ${lines.length - MAX_LINES + 1} more changes.`]
  return lines
}
