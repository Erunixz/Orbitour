import { distanceM } from '../../src/lib/geo.js'
import type { LatLon } from '../../src/lib/types.js'
import { stage, type Emit, type PlannedStop } from './context.js'

// Day split (code): keeps the best stops (must-see always) and groups them by
// distance so each day stays compact.

/** Keeps every must-see stop, then the most important others, up to `max`. */
export function chooseStops(stops: PlannedStop[], max: number): { kept: PlannedStop[]; dropped: PlannedStop[] } {
  const ranked = stops
    .map((stop, i) => ({ stop, i }))
    .sort((a, b) => Number(b.stop.mustSee) - Number(a.stop.mustSee) || b.stop.importance - a.stop.importance || a.i - b.i)
  const keep = new Set(ranked.slice(0, Math.max(max, stops.filter((s) => s.mustSee).length)).map((r) => r.stop))
  return { kept: stops.filter((s) => keep.has(s)), dropped: stops.filter((s) => !keep.has(s)) }
}

/**
 * Splits stops into `days` groups with k-means on distance, then evens out group
 * sizes so no day holds more than its share plus one.
 */
export function splitIntoDays(stops: PlannedStop[], days: number, start: LatLon): PlannedStop[][] {
  if (days <= 1 || stops.length === 0) return [stops.slice(), ...Array.from({ length: Math.max(0, days - 1) }, () => [])]
  const k = Math.min(days, stops.length)

  // Farthest-point start: first the most important stop, then the stop farthest from all chosen.
  const centers: LatLon[] = [stops.reduce((a, b) => (b.importance > a.importance ? b : a))]
  while (centers.length < k) {
    const next = stops.reduce((best, s) =>
      Math.min(...centers.map((c) => distanceM(c, s))) > Math.min(...centers.map((c) => distanceM(c, best))) ? s : best,
    )
    centers.push({ lat: next.lat, lon: next.lon })
  }

  let assign: number[] = stops.map(() => 0)
  for (let round = 0; round < 20; round++) {
    const next = stops.map((s) => nearestIndex(s, centers))
    const same = next.every((c, i) => c === assign[i])
    assign = next
    for (let c = 0; c < k; c++) {
      const members = stops.filter((_, i) => assign[i] === c)
      if (members.length > 0) centers[c] = mean(members)
    }
    if (same && round > 0) break
  }

  // Even out: move the stops that fit elsewhere best out of overfull days.
  const cap = Math.ceil(stops.length / k) + 1
  for (let guard = 0; guard < stops.length * k; guard++) {
    const counts = centers.map((_, c) => assign.filter((a) => a === c).length)
    const over = counts.findIndex((n) => n > cap)
    if (over === -1) break
    let move = -1
    let to = -1
    let penalty = Infinity
    stops.forEach((s, i) => {
      if (assign[i] !== over) return
      centers.forEach((c, j) => {
        if (j === over || counts[j]! >= cap) return
        const extra = distanceM(s, c) - distanceM(s, centers[over]!)
        if (extra < penalty) {
          penalty = extra
          move = i
          to = j
        }
      })
    })
    if (move === -1) break
    assign[move] = to
  }

  const groups = centers.map((_, c) => stops.filter((_, i) => assign[i] === c))
  // Day 1 is the group nearest the start; each next day is the nearest remaining.
  const ordered: PlannedStop[][] = []
  let from = start
  const left = groups.filter((g) => g.length > 0)
  while (left.length > 0) {
    const i = left.reduce((best, g, j) => (distanceM(from, mean(g)) < distanceM(from, mean(left[best]!)) ? j : best), 0)
    const group = left.splice(i, 1)[0]!
    ordered.push(group)
    from = mean(group)
  }
  while (ordered.length < days) ordered.push([])
  return ordered
}

function nearestIndex(p: LatLon, centers: LatLon[]): number {
  let best = 0
  for (let i = 1; i < centers.length; i++) if (distanceM(p, centers[i]!) < distanceM(p, centers[best]!)) best = i
  return best
}

function mean(points: LatLon[]): LatLon {
  const n = points.length
  return { lat: points.reduce((a, p) => a + p.lat, 0) / n, lon: points.reduce((a, p) => a + p.lon, 0) / n }
}

export function runDaySplit(
  stops: PlannedStop[],
  days: number,
  perDay: number,
  start: LatLon,
  emit: Emit,
): PlannedStop[][] {
  const s = stage(emit, 'daysplit')
  s.start(`Splitting ${stops.length} places into ${days === 1 ? 'one day' : `${days} days`}...`)
  const { kept, dropped } = chooseStops(stops, days * perDay)
  const split = splitIntoDays(kept, days, start)
  const sizes = split.map((d) => d.length).join(', ')
  s.done(
    dropped.length > 0
      ? `Kept the best ${kept.length} places (${sizes} per day). ${dropped.length} extra picks left out.`
      : `Stops per day: ${sizes}.`,
  )
  return split
}
