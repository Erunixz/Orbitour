import type { LatLon, TripRequest } from '../../src/lib/types.js'
import { addDays, FORECAST_DAYS, type DailyForecast } from '../upstream/openMeteo.js'
import { stage, type Emit, type PipelineDeps } from './context.js'

// Forecaster (code): with a start date, each day gets its date and a warning
// when the forecast is notable. Open-Meteo is free and needs no key.

const RAIN_LIKELY = 60
const HOT_C = 32
const COLD_C = 3

/** A short warning for notable weather, or null for an ordinary day. */
export function weatherNote(f: DailyForecast): string | null {
  const range = `${Math.round(f.minC)} to ${Math.round(f.maxC)}°C`
  if (f.code >= 95) return `Forecast: thunderstorms, ${range}. Keep indoor stops in mind.`
  if ((f.code >= 71 && f.code <= 77) || f.code === 85 || f.code === 86) return `Forecast: snow, ${range}.`
  if (f.rainChance !== null && f.rainChance >= RAIN_LIKELY) {
    return `Forecast: rain likely (${f.rainChance}%), ${range}. Museums and covered places suit this day.`
  }
  if (f.maxC >= HOT_C) return `Forecast: hot, up to ${Math.round(f.maxC)}°C. Plan shade and water.`
  if (f.maxC <= COLD_C) return `Forecast: cold, ${range}. Dress warmly.`
  return null
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export type WeatherResult = { dates: (string | undefined)[]; warnings: string[][] }

export async function runWeather(
  request: TripRequest,
  center: LatLon,
  deps: PipelineDeps,
  emit: Emit,
): Promise<WeatherResult> {
  const s = stage(emit, 'weather')
  const empty = { dates: Array.from({ length: request.days }, () => undefined), warnings: Array.from({ length: request.days }, () => []) }
  if (!request.startDate) {
    s.done('No start date given, so no forecast.')
    return empty
  }
  const start = request.startDate
  const dates = Array.from({ length: request.days }, (_, i) => addDays(start, i))
  const warnings: string[][] = dates.map(() => [])
  const today = deps.now().toISOString().slice(0, 10)
  const lastForecast = addDays(today, FORECAST_DAYS - 1)
  const inRange = dates.filter((d) => d >= today && d <= lastForecast)
  if (inRange.length === 0) {
    s.done(start < today ? 'The start date has passed, so no forecast.' : `Forecasts reach ${FORECAST_DAYS} days ahead. Check again closer to the trip.`)
    return { dates, warnings }
  }

  s.start('Checking the forecast...')
  try {
    const forecast = await deps.weather.daily(center, inRange[0]!, inRange.length)
    let notes = 0
    for (const f of forecast) {
      const i = daysBetween(start, f.date)
      const note = weatherNote(f)
      if (note && warnings[i]) {
        warnings[i]!.push(note)
        notes++
      }
    }
    const partly = inRange.length < dates.length ? ` Only ${inRange.length} of ${dates.length} days are in range.` : ''
    s.done(`${notes > 0 ? `${notes} days have weather to plan around.` : 'Nothing unusual in the forecast.'}${partly}`)
  } catch {
    s.done('The forecast service did not answer. The plan works without it.')
  }
  return { dates, warnings }
}
