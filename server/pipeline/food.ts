import { distanceM } from '../../src/lib/geo.js'
import type { Budget, Leg, Stop, TripRequest } from '../../src/lib/types.js'
import { OverpassDownError, type OsmPlace } from '../upstream/overpass.js'
import { nominatimSource, osmSource, stage, type Emit, type PipelineDeps, type PlannedStop, type Survey } from './context.js'
import { osmSummary } from './places.js'
import { legKey, legsFor, type RoutedDay } from './router.js'
import { schedule, toMinutes } from './timekeeper.js'

// Food finder (code): lunch near the stop you are at around midday, dinner after
// the last stop, and one place to stay. All from OpenStreetMap.

const LUNCH_TARGET_MIN = 12 * 60 + 30

/** Where lunch goes: after the stop whose leave time is closest to 12:30. */
export function lunchSlot(stops: PlannedStop[], legs: Leg[], request: TripRequest): number {
  if (stops.length === 0) return 0
  const timed = schedule(stops, legs, request)
  let best = timed.length
  let bestGap = Infinity
  timed.forEach((stop, i) => {
    const gap = Math.abs(toMinutes(stop.depart) - LUNCH_TARGET_MIN)
    if (gap < bestGap) {
      bestGap = gap
      best = i + 1
    }
  })
  return best
}

const DIET_TAGS: [RegExp, string][] = [
  [/vegan/i, 'diet:vegan'],
  [/vegetarian|veggie/i, 'diet:vegetarian'],
  [/halal/i, 'diet:halal'],
  [/kosher/i, 'diet:kosher'],
  [/gluten|coeliac|celiac/i, 'diet:gluten_free'],
]

/** OSM tags that show a place suits the diet, if we understand it. */
export function dietTags(diet: string | undefined): string[] {
  if (!diet) return []
  return DIET_TAGS.filter(([re]) => re.test(diet)).map(([, tag]) => tag)
}

const fitsDiet = (place: OsmPlace, tags: string[]) => tags.some((t) => place.tags[t] === 'yes' || place.tags[t] === 'only')

/** Best food place: diet first, then the preferred kind, then the nearest. Never one already used. */
export function pickFood(places: OsmPlace[], diet: string | undefined, prefer: 'restaurant' | 'cafe', used: Set<string>): OsmPlace | null {
  const tags = dietTags(diet)
  const open = places.filter((p) => !used.has(p.osmId))
  const score = (p: OsmPlace) => (tags.length > 0 && fitsDiet(p, tags) ? 0 : 2) + (p.tags.amenity === prefer ? 0 : 1)
  // `places` is sorted nearest first, and sort is stable, so ties stay nearest first.
  return open.slice().sort((a, b) => score(a) - score(b))[0] ?? null
}

const LODGING_PREFERENCE: Record<Budget, string[]> = {
  free: ['hostel', 'guest_house', 'hotel'],
  modest: ['guest_house', 'hotel', 'hostel'],
  any: ['hotel', 'guest_house', 'hostel'],
}

export function pickLodging(places: OsmPlace[], budget: Budget): OsmPlace | null {
  const order = LODGING_PREFERENCE[budget]
  const rank = (p: OsmPlace) => {
    const i = order.indexOf(p.tags.tourism ?? '')
    return i === -1 ? order.length : i
  }
  return places.slice().sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** "Restaurant, French and Italian food." Written from OSM tags, not by the LLM. */
export function foodSummary(place: OsmPlace): string {
  const label = place.tags.amenity === 'cafe' ? 'Café' : 'Restaurant'
  const cuisine = (place.tags.cuisine ?? '')
    .split(';')
    .map((c) => c.trim().replace(/_/g, ' '))
    .filter(Boolean)
    .slice(0, 3)
  if (cuisine.length === 0) return `${label}.`
  const list = cuisine.length === 1 ? cuisine[0] : `${cuisine.slice(0, -1).join(', ')} and ${cuisine[cuisine.length - 1]}`
  return `${label}, ${list} food.`
}

const osmStopId = (place: OsmPlace) => `osm-${place.osmId.replace('/', '-')}`

function foodStop(place: OsmPlace, meal: 'lunch' | 'dinner', near: string): PlannedStop {
  return {
    id: osmStopId(place),
    name: place.name,
    kind: 'food',
    lat: place.lat,
    lon: place.lon,
    summary: foodSummary(place),
    reason: `${meal === 'lunch' ? 'Lunch' : 'Dinner'} close to ${near}.`,
    photo: null,
    sources: [osmSource(place.url)],
    mustSee: false,
    importance: 3,
    meal,
  }
}

export type FoodResult = { days: RoutedDay[]; lodging: Stop | undefined; warnings: string[][] }

/** Meal places are looked up within this distance of the stop they follow. */
export const MEAL_RADIUS_M = 700

/** Where a meal goes. `near` lists stops to search around, best first: the stop before, then the one after. */
type MealSlot = { day: number; meal: 'lunch' | 'dinner'; at: number; near: PlannedStop[] }

export async function runFood(
  days: RoutedDay[],
  request: TripRequest,
  survey: Survey,
  deps: PipelineDeps,
  emit: Emit,
): Promise<FoodResult> {
  const s = stage(emit, 'food')
  s.start(request.meals.length > 0 ? 'Finding meals and a place to stay...' : 'Finding a place to stay...')
  const warnings: string[][] = days.map(() => [])
  let down = false

  // Where each meal goes, then one search around all of them.
  const slots: MealSlot[] = []
  days.forEach((day, d) => {
    if (day.stops.length === 0) return
    if (request.meals.includes('lunch')) {
      const at = lunchSlot(day.stops, day.legs, request)
      const near = [day.stops[at - 1], day.stops[at]].filter((s): s is PlannedStop => s !== undefined)
      slots.push({ day: d, meal: 'lunch', at, near })
    }
    if (request.meals.includes('dinner')) {
      slots.push({ day: d, meal: 'dinner', at: day.stops.length, near: [day.stops[day.stops.length - 1]!] })
    }
  })

  let places: OsmPlace[] = []
  if (slots.length > 0) {
    try {
      places = await deps.overpass.food(
        slots.flatMap((slot) => slot.near),
        MEAL_RADIUS_M,
      )
    } catch (error) {
      down = true
      if (!(error instanceof OverpassDownError)) deps.log(`[food] search failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  const used = new Set<string>()
  const chosen = new Map<MealSlot, PlannedStop>()
  for (const slot of slots) {
    // A stop can sit where nobody eats (a bridge, a park), so try its neighbour too.
    for (const anchor of slot.near) {
      const near = places
        .filter((p) => distanceM(p, anchor) <= MEAL_RADIUS_M)
        .sort((a, b) => distanceM(a, anchor) - distanceM(b, anchor))
      const place = pickFood(near, request.diet, 'restaurant', used)
      if (!place) continue
      used.add(place.osmId)
      chosen.set(slot, foodStop(place, slot.meal, anchor.name))
      s.progress(`Day ${slot.day + 1} ${slot.meal}: ${place.name}.`)
      break
    }
    if (!chosen.has(slot) && !down) {
      warnings[slot.day]!.push(`No ${slot.meal} spot found near ${slot.near.map((n) => n.name).join(' or ')} on the map.`)
    }
  }

  const out: RoutedDay[] = []
  for (const [d, day] of days.entries()) {
    const stops = day.stops.slice()
    // Insert from the back so earlier positions stay valid.
    const daySlots = slots.filter((slot) => slot.day === d).sort((a, b) => b.at - a.at)
    for (const slot of daySlots) {
      const stop = chosen.get(slot)
      if (stop) stops.splice(slot.at, 0, stop)
    }
    const reuse = new Map(day.legs.map((l) => [legKey(l.fromId, l.toId), l]))
    out.push({ stops, legs: await legsFor(stops, request, deps, reuse) })
  }

  if (down && slots.length > 0) {
    for (const w of warnings) w.push('Meals were not added because the OpenStreetMap place search was not responding.')
  } else if (request.diet?.trim() && dietTags(request.diet).length === 0) {
    warnings[0]?.push(`Meal picks could not check the diet "${request.diet.trim()}". Check the menus before you go.`)
  }

  const lodging = await findLodging(out, request, survey, deps, () => {
    down = true
  })
  s.done(
    [
      down ? 'OpenStreetMap was not responding, so some places are missing.' : null,
      lodging ? `Staying at ${lodging.name}.` : 'No place to stay found nearby.',
    ]
      .filter(Boolean)
      .join(' '),
  )
  return { days: out, lodging, warnings }
}

async function findLodging(
  days: RoutedDay[],
  request: TripRequest,
  survey: Survey,
  deps: PipelineDeps,
  onDown: () => void,
): Promise<Stop | undefined> {
  const base = { visitMin: 0, arrive: request.endTime, depart: request.startTime, mustSee: false, photo: null }
  const start = survey.startFrom?.place
  if (start) {
    return {
      ...base,
      id: 'lodging-start',
      name: start.name,
      kind: 'lodging',
      lat: start.lat,
      lon: start.lon,
      summary: osmSummary(start.type, start.displayName),
      reason: 'Your start point.',
      sources: start.osmUrl ? [nominatimSource(start.osmUrl)] : [],
    }
  }
  const near = days[0]?.stops[0] ?? survey.center
  try {
    let places = await deps.overpass.lodging(near, 800)
    if (places.length === 0) places = await deps.overpass.lodging(near, 1600)
    const place = pickLodging(places, request.budget)
    if (!place) return undefined
    const kind = (place.tags.tourism ?? 'hotel').replace(/_/g, ' ')
    return {
      ...base,
      id: osmStopId(place),
      name: place.name,
      kind: 'lodging',
      lat: place.lat,
      lon: place.lon,
      summary: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${place.tags.stars ? `, ${place.tags.stars} stars` : ''}.`,
      reason: 'Close to where day 1 starts.',
      sources: [osmSource(place.url)],
    }
  } catch (error) {
    if (error instanceof OverpassDownError) onDown()
    return undefined
  }
}
