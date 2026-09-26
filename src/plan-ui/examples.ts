import { useEffect, useState } from 'react'
import type { LatLon, TripRequest } from '../lib/types'

// Example trips for the home page, and where the suggested cities are so the
// globe can turn to them. Photos come from Wikipedia at view time.

export const CITY_COORDS: Record<string, LatLon> = {
  Amsterdam: { lat: 52.37, lon: 4.9 },
  Athens: { lat: 37.98, lon: 23.73 },
  Bangkok: { lat: 13.75, lon: 100.5 },
  Barcelona: { lat: 41.39, lon: 2.17 },
  Berlin: { lat: 52.52, lon: 13.4 },
  Boston: { lat: 42.36, lon: -71.06 },
  Budapest: { lat: 47.5, lon: 19.04 },
  'Buenos Aires': { lat: -34.6, lon: -58.38 },
  'Cape Town': { lat: -33.92, lon: 18.42 },
  Chicago: { lat: 41.88, lon: -87.63 },
  Copenhagen: { lat: 55.68, lon: 12.57 },
  Dubai: { lat: 25.2, lon: 55.27 },
  Dublin: { lat: 53.35, lon: -6.26 },
  Edinburgh: { lat: 55.95, lon: -3.19 },
  Florence: { lat: 43.77, lon: 11.26 },
  'Hong Kong': { lat: 22.32, lon: 114.17 },
  Istanbul: { lat: 41.01, lon: 28.98 },
  Kyoto: { lat: 35.01, lon: 135.77 },
  Lisbon: { lat: 38.72, lon: -9.14 },
  London: { lat: 51.51, lon: -0.13 },
  'Los Angeles': { lat: 34.05, lon: -118.24 },
  Madrid: { lat: 40.42, lon: -3.7 },
  Melbourne: { lat: -37.81, lon: 144.96 },
  'Mexico City': { lat: 19.43, lon: -99.13 },
  Montreal: { lat: 45.5, lon: -73.57 },
  Munich: { lat: 48.14, lon: 11.58 },
  'New York': { lat: 40.71, lon: -74.01 },
  Paris: { lat: 48.86, lon: 2.35 },
  Prague: { lat: 50.08, lon: 14.44 },
  'Rio de Janeiro': { lat: -22.91, lon: -43.17 },
  Rome: { lat: 41.9, lon: 12.5 },
  'San Francisco': { lat: 37.77, lon: -122.42 },
  Seoul: { lat: 37.57, lon: 126.98 },
  Singapore: { lat: 1.35, lon: 103.82 },
  Stockholm: { lat: 59.33, lon: 18.07 },
  Sydney: { lat: -33.87, lon: 151.21 },
  Tokyo: { lat: 35.68, lon: 139.69 },
  Toronto: { lat: 43.65, lon: -79.38 },
  Venice: { lat: 45.44, lon: 12.32 },
  Vienna: { lat: 48.21, lon: 16.37 },
}

export const POPULAR_CITIES = Object.keys(CITY_COORDS)

/** Coordinates for a typed city name, when it is one we know. */
export function coordsFor(city: string): (LatLon & { label: string }) | null {
  const typed = city.trim().toLowerCase()
  const name = POPULAR_CITIES.find((c) => c.toLowerCase() === typed)
  return name ? { ...CITY_COORDS[name]!, label: name } : null
}

export type Example = {
  id: string
  title: string
  blurb: string
  /** Wikipedia article whose lead image shows the trip. */
  photoArticle: string
  request: Partial<TripRequest> & { city: string }
}

export const EXAMPLES: Example[] = [
  {
    id: 'paris-art',
    title: 'Art and cafés in Paris',
    blurb: '2 days, museums and grand buildings, lunch and dinner.',
    photoArticle: 'Louvre_Pyramid',
    request: { city: 'Paris', days: 2, interests: ['art', 'museums', 'architecture'], pace: 'normal', party: 'couple', budget: 'modest', meals: ['lunch', 'dinner'], mode: 'auto' },
  },
  {
    id: 'lisbon-views',
    title: 'Slow Lisbon viewpoints',
    blurb: '2 relaxed days of views, old churches and trams.',
    photoArticle: 'Belém_Tower',
    request: { city: 'Lisbon', days: 2, interests: ['views', 'history', 'churches'], pace: 'relaxed', party: 'couple', budget: 'modest', meals: ['lunch'], mode: 'auto' },
  },
  {
    id: 'tokyo-markets',
    title: 'Temples and markets in Tokyo',
    blurb: '3 packed days by train, street food at every stop.',
    photoArticle: 'Sensō-ji',
    request: { city: 'Tokyo', days: 3, interests: ['churches', 'markets', 'food'], pace: 'packed', party: 'solo', budget: 'modest', meals: ['lunch', 'dinner'], mode: 'transit' },
  },
  {
    id: 'barcelona-family',
    title: 'Barcelona with the kids',
    blurb: '2 easy days of parks, Gaudí and the beach.',
    photoArticle: 'Park_Güell',
    request: { city: 'Barcelona', days: 2, interests: ['parks', 'architecture'], pace: 'relaxed', party: 'family', budget: 'modest', meals: ['lunch'], mode: 'auto' },
  },
  {
    id: 'rome-free',
    title: 'Rome for free',
    blurb: 'One day on foot, only places that cost nothing to enter.',
    photoArticle: 'Trevi_Fountain',
    request: { city: 'Rome', days: 1, interests: ['history', 'churches', 'architecture'], pace: 'normal', party: 'solo', budget: 'free', meals: ['lunch'], mode: 'walk' },
  },
  {
    id: 'nyc-views',
    title: 'New York skyline and galleries',
    blurb: '2 days of art, parks and the best views.',
    photoArticle: 'Brooklyn_Bridge',
    request: { city: 'New York', days: 2, interests: ['art', 'views', 'parks'], pace: 'normal', party: 'couple', budget: 'any', meals: ['lunch', 'dinner'], mode: 'transit' },
  },
]

export type WikiPhoto = { url: string; fallback: string; pageUrl: string }

const photoCache = new Map<string, Promise<WikiPhoto | null>>()

function loadPhoto(article: string): Promise<WikiPhoto | null> {
  let p = photoCache.get(article)
  if (!p) {
    p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { thumbnail?: { source: string }; content_urls?: { desktop?: { page?: string } } } | null) => {
        const thumb = data?.thumbnail?.source
        if (!thumb) return null
        // Ask for a sharper thumbnail than the default 320px.
        return {
          url: thumb.replace(/\/(\d+)px-/, '/640px-'),
          fallback: thumb,
          pageUrl: data?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${article}`,
        }
      })
      .catch(() => null)
    photoCache.set(article, p)
  }
  return p
}

/** Lead photo of a Wikipedia article, or null while loading or when there is none. */
export function useWikiPhoto(article: string): WikiPhoto | null {
  const [photo, setPhoto] = useState<WikiPhoto | null>(null)
  useEffect(() => {
    let live = true
    loadPhoto(article).then((p) => live && setPhoto(p))
    return () => {
      live = false
    }
  }, [article])
  return photo
}
