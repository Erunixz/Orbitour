import { z } from 'zod'
import type { LatLon } from '../../src/lib/types.js'
import { cached, cacheKey, HOUR, type Cache } from '../cache.js'
import { fetchWithRetry, type RetryOptions } from './fetchRetry.js'

// Daily forecast from Open-Meteo. Free, no key.
// https://open-meteo.com/en/docs

const BASE = 'https://api.open-meteo.com/v1/forecast'
/** Open-Meteo forecasts this many days ahead, today included. */
export const FORECAST_DAYS = 16

export type DailyForecast = {
  date: string
  code: number
  maxC: number
  minC: number
  /** Highest chance of rain in the day, percent. */
  rainChance: number | null
}

export type WeatherClient = {
  daily(center: LatLon, startDate: string, days: number): Promise<DailyForecast[]>
}

const responseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
})

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function parseDaily(body: unknown): DailyForecast[] {
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) return []
  const d = parsed.data.daily
  return d.time.flatMap((date, i): DailyForecast[] => {
    const maxC = d.temperature_2m_max[i]
    const minC = d.temperature_2m_min[i]
    if (maxC == null || minC == null) return []
    return [{ date, code: d.weather_code[i] ?? 0, maxC, minC, rainChance: d.precipitation_probability_max[i] ?? null }]
  })
}

export function createWeather({ cache, retry = {} }: { cache: Cache; retry?: Partial<RetryOptions> }): WeatherClient {
  return {
    daily(center, startDate, days) {
      const endDate = addDays(startDate, days - 1)
      const key = cacheKey('weather', center.lat, center.lon, startDate, endDate)
      return cached(cache, key, 3 * HOUR, async () => {
        const params = new URLSearchParams({
          latitude: center.lat.toFixed(4),
          longitude: center.lon.toFixed(4),
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
          timezone: 'auto',
          start_date: startDate,
          end_date: endDate,
        })
        const res = await fetchWithRetry(`${BASE}?${params.toString()}`, {}, { ...retry, service: 'weather' })
        return parseDaily(await res.json())
      })
    },
  }
}
