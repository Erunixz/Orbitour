// Where the user is in a trip: a day, and either that day's overview or one stop.
// Pure functions so the rules are easy to test.

export type View = { day: number; stop: number | null }

/** Number of stops in each day, in day order. */
export type DayCounts = readonly number[]

const clampDay = (day: number, counts: DayCounts) => Math.max(0, Math.min(counts.length - 1, day))

/** Next stop. After the last stop of a day comes the first stop of the next day. */
export function nextView(view: View, counts: DayCounts): View {
  const count = counts[view.day] ?? 0
  const i = view.stop ?? -1
  if (i + 1 < count) return { day: view.day, stop: i + 1 }
  for (let day = view.day + 1; day < counts.length; day++) {
    if ((counts[day] ?? 0) > 0) return { day, stop: 0 }
  }
  return view
}

/** Previous stop. The first stop goes back to its day overview, and a day overview to the last stop of the day before. */
export function backView(view: View, counts: DayCounts): View {
  if (view.stop !== null) return view.stop > 0 ? { day: view.day, stop: view.stop - 1 } : { day: view.day, stop: null }
  for (let day = view.day - 1; day >= 0; day--) {
    const count = counts[day] ?? 0
    if (count > 0) return { day, stop: count - 1 }
  }
  return view
}

export const sameView = (a: View, b: View) => a.day === b.day && a.stop === b.stop

export function dayView(day: number, counts: DayCounts): View {
  return { day: clampDay(day, counts), stop: null }
}

export function stopView(day: number, stop: number, counts: DayCounts): View {
  const d = clampDay(day, counts)
  const count = counts[d] ?? 0
  return stop >= 0 && stop < count ? { day: d, stop } : { day: d, stop: null }
}

/**
 * Reads "#day=2&stop=3" (both 1-based). "#stop=3" alone means day 1.
 * Anything missing or out of range falls back to the first day's overview.
 */
export function viewFromHash(hash: string, counts: DayCounts): View {
  const read = (name: string) => {
    const match = new RegExp(`(?:^|[#&])${name}=(\\d+)`).exec(hash)
    return match ? Number(match[1]) : null
  }
  const day = read('day') ?? 1
  if (day < 1 || day > counts.length) return { day: 0, stop: null }
  const stop = read('stop')
  return stop === null ? { day: day - 1, stop: null } : stopView(day - 1, stop - 1, counts)
}

export function hashForView(view: View): string {
  if (view.stop === null) return view.day === 0 ? '' : `#day=${view.day + 1}`
  return `#day=${view.day + 1}&stop=${view.stop + 1}`
}
