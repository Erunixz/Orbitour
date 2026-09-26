// Core data model shared by the server and the app.

export type LatLon = { lat: number; lon: number }

export type SourceKind = 'wikipedia' | 'osm' | 'routes' | 'nominatim'
export type Source = { kind: SourceKind; label: string; url: string }
export type Photo = { url: string; credit: string; pageUrl: string }

export type TravelMode = 'walk' | 'transit' | 'drive' | 'cycle'
export type Pace = 'relaxed' | 'normal' | 'packed'
export type Party = 'solo' | 'couple' | 'family' | 'easy'
export type Budget = 'free' | 'modest' | 'any'
export type Meal = 'lunch' | 'dinner'

export type TripRequest = {
  city: string
  /** 1 to 7 */
  days: number
  /** "HH:MM" */
  startTime: string
  /** "HH:MM" */
  endTime: string
  /** Hotel or station, free text. */
  startFrom?: string
  /** Free text lines, as typed. */
  mustSee: string[]
  interests: string[]
  pace: Pace
  mode: TravelMode | 'auto'
  party: Party
  budget: Budget
  meals: Meal[]
  diet?: string
  /** "YYYY-MM-DD". Optional; gives each day a date and a weather check. */
  startDate?: string
}

export type StopKind = 'sight' | 'museum' | 'park' | 'viewpoint' | 'market' | 'food' | 'lodging' | 'other'

export type Stop = LatLon & {
  id: string
  name: string
  kind: StopKind
  /** From Wikipedia or OSM. Never written by the LLM. */
  summary: string
  /** Short Scout reason for why it fits the request. */
  reason: string
  photo: Photo | null
  sources: Source[]
  visitMin: number
  /** "HH:MM" */
  arrive: string
  /** "HH:MM" */
  depart: string
  /** The user asked for it by name. */
  mustSee: boolean
  /** Surface height above the WGS84 ellipsoid, found by raycast in the app. */
  groundHeightM?: number
}

export type LegStep = { mode: 'walk' | 'transit'; meters: number; minutes: number; line?: string }

export type Leg = {
  fromId: string
  toId: string
  mode: TravelMode
  minutes: number
  meters: number
  /** Google encoded polyline. */
  polyline: string
  /** True when routing failed and this is a straight-line estimate. */
  estimated: boolean
  steps?: LegStep[]
}

export type Day = {
  index: number
  date?: string
  stops: Stop[]
  legs: Leg[]
  warnings: string[]
}

export type Trip = {
  id: string
  title: string
  request: TripRequest
  center: LatLon
  radiusM: number
  days: Day[]
  lodging?: Stop
  createdAt: string
  updatedAt: string
  /** Schema version for migrations. */
  version: number
}
