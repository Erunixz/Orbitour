import { z } from 'zod'
import type { LatLon, Photo } from '../../src/lib/types.js'
import { cached, cacheKey, DAY, type Cache } from '../cache.js'
import { fetchWithRetry, type RetryOptions } from './fetchRetry.js'
import { RateGate } from './politeness.js'

// Wikipedia and Wikimedia Commons through the MediaWiki action API.
// https://www.mediawiki.org/wiki/API:Geosearch
// https://www.mediawiki.org/wiki/API:Etiquette

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const TTL = 7 * DAY
/** GeoSearch refuses a larger radius. */
export const MAX_GEOSEARCH_RADIUS_M = 10_000
const LOOKUP_BATCH = 20

export type WikiPage = LatLon & {
  pageId: number
  title: string
  description: string
  /** Article length in bytes, a rough sign of how notable a place is. */
  length: number
  /** Views over the last month, when Wikipedia reports them. */
  views: number | null
}

export type WikiArticle = LatLon & {
  pageId: number
  title: string
  description: string
  /** First sentences of the article, plain text. */
  extract: string
  url: string
  /** Commons file name of the lead image, without "File:". */
  image: string | null
}

export type WikipediaClient = {
  nearby(center: LatLon, radiusM: number, limit: number): Promise<WikiPage[]>
  /** Resolves titles (following redirects). Missing, placeless or disambiguation pages map to null. */
  lookup(titles: string[]): Promise<Map<string, WikiArticle | null>>
  /** Titles matching free text, best first. */
  searchTitles(query: string, limit?: number): Promise<string[]>
  /** Photo URL and credit for Commons files. Files without usable data are left out. */
  photos(files: string[]): Promise<Map<string, Photo>>
}

const coordSchema = z.array(z.object({ lat: z.number(), lon: z.number() })).optional()

const nearbySchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          pageid: z.number(),
          title: z.string(),
          coordinates: coordSchema,
          description: z.string().optional(),
          length: z.number().optional(),
          pageprops: z.record(z.string(), z.unknown()).optional(),
          pageviews: z.record(z.string(), z.number().nullable()).optional(),
        }),
      ),
    })
    .optional(),
})

const lookupSchema = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z.array(
        z.object({
          pageid: z.number().optional(),
          title: z.string(),
          missing: z.boolean().optional(),
          coordinates: coordSchema,
          description: z.string().optional(),
          extract: z.string().optional(),
          pageimage: z.string().optional(),
          pageprops: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    })
    .optional(),
})

const searchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }).optional(),
})

const commonsSchema = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z.array(
        z.object({
          title: z.string(),
          imageinfo: z
            .array(
              z.object({
                thumburl: z.string().optional(),
                url: z.string().optional(),
                descriptionurl: z.string(),
                extmetadata: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
})

export const articleUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

/** Removes HTML tags and squeezes spaces. Commons metadata is HTML. */
export function stripHtml(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : ''
}

/** Short, plain summary: whole sentences up to about 280 characters, without asides in brackets. */
export function trimSummary(text: string, maxChars = 280): string {
  let clean = text.replace(/\s+/g, ' ')
  // Lead sentences carry long asides like "(Portuguese: ...; pronounced ...)". Inner ones go first.
  for (let i = 0; i < 3; i++) clean = clean.replace(/\s*\([^()]*\)/g, '')
  clean = clean.trim()
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [clean]
  let out = ''
  for (const s of sentences) {
    if (out && (out + s).length > maxChars) break
    out += s
  }
  out = out.trim() || clean
  return out.length > maxChars + 80 ? `${out.slice(0, maxChars).replace(/\s+\S*$/, '')}...` : out
}

type Deps = {
  userAgent: string
  cache: Cache
  gate?: RateGate
  retry?: Partial<RetryOptions>
}

export function createWikipedia({ userAgent, cache, gate = new RateGate(250), retry = {} }: Deps): WikipediaClient {
  const headers = { 'User-Agent': userAgent, 'Api-User-Agent': userAgent, Accept: 'application/json' }

  const get = (base: string, params: Record<string, string>): Promise<unknown> =>
    gate.run(async () => {
      const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })
      const res = await fetchWithRetry(`${base}?${query.toString()}`, { headers }, { ...retry, service: 'wikipedia' })
      return res.json()
    })

  return {
    async nearby(center, radiusM, limit) {
      const radius = Math.round(Math.min(MAX_GEOSEARCH_RADIUS_M, Math.max(10, radiusM)))
      const key = cacheKey('wiki-nearby', center.lat, center.lon, radius, limit)
      return cached(cache, key, TTL, async () => {
        const body = await get(WIKI_API, {
          generator: 'geosearch',
          ggscoord: `${center.lat}|${center.lon}`,
          ggsradius: String(radius),
          ggslimit: String(Math.min(500, limit)),
          ggsnamespace: '0',
          prop: 'coordinates|description|info|pageprops|pageviews',
          // Without this, coordinates come back for only 10 pages.
          colimit: 'max',
          ppprop: 'disambiguation',
          pvipdays: '30',
        })
        const parsed = nearbySchema.safeParse(body)
        if (!parsed.success) return []
        return (parsed.data.query?.pages ?? []).flatMap((p): WikiPage[] => {
          const c = p.coordinates?.[0]
          if (!c || p.pageprops?.disambiguation !== undefined) return []
          const counts = Object.values(p.pageviews ?? {}).filter((n): n is number => typeof n === 'number')
          return [
            {
              pageId: p.pageid,
              title: p.title,
              lat: c.lat,
              lon: c.lon,
              description: p.description ?? '',
              length: p.length ?? 0,
              views: counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null,
            },
          ]
        })
      })
    },

    async lookup(titles) {
      const out = new Map<string, WikiArticle | null>()
      const missing: string[] = []
      for (const title of new Set(titles.map((t) => t.trim()).filter(Boolean))) {
        const hit = await cache.get<WikiArticle | null>(cacheKey('wiki-article', title))
        if (hit !== undefined) out.set(title, hit)
        else missing.push(title)
      }

      for (let i = 0; i < missing.length; i += LOOKUP_BATCH) {
        const batch = missing.slice(i, i + LOOKUP_BATCH)
        const body = await get(WIKI_API, {
          titles: batch.join('|'),
          redirects: '1',
          prop: 'coordinates|description|extracts|pageimages|pageprops',
          exintro: '1',
          explaintext: '1',
          exsentences: '3',
          exlimit: String(LOOKUP_BATCH),
          piprop: 'name',
          ppprop: 'disambiguation',
        })
        const parsed = lookupSchema.safeParse(body)
        const query = parsed.success ? parsed.data.query : undefined
        const rename = new Map<string, string>()
        for (const n of [...(query?.normalized ?? []), ...(query?.redirects ?? [])]) rename.set(n.from, n.to)
        const pages = new Map((query?.pages ?? []).map((p) => [p.title, p]))

        for (const asked of batch) {
          let title = asked
          for (let hops = 0; hops < 3 && rename.has(title); hops++) title = rename.get(title)!
          const page = pages.get(title)
          const c = page?.coordinates?.[0]
          const article: WikiArticle | null =
            page && !page.missing && page.pageid !== undefined && c && page.pageprops?.disambiguation === undefined
              ? {
                  pageId: page.pageid,
                  title: page.title,
                  lat: c.lat,
                  lon: c.lon,
                  description: page.description ?? '',
                  extract: trimSummary(page.extract ?? ''),
                  url: articleUrl(page.title),
                  image: page.pageimage ?? null,
                }
              : null
          out.set(asked, article)
          await cache.set(cacheKey('wiki-article', asked), article, TTL)
        }
      }
      return out
    },

    async searchTitles(query, limit = 5) {
      const q = query.trim()
      if (!q) return []
      return cached(cache, cacheKey('wiki-search', q, limit), TTL, async () => {
        const body = await get(WIKI_API, { list: 'search', srsearch: q, srlimit: String(limit), srnamespace: '0' })
        const parsed = searchSchema.safeParse(body)
        return parsed.success ? (parsed.data.query?.search ?? []).map((s) => s.title) : []
      })
    },

    async photos(files) {
      const out = new Map<string, Photo>()
      const unique = [...new Set(files.filter(Boolean))]
      const missing: string[] = []
      for (const file of unique) {
        const hit = await cache.get<Photo | null>(cacheKey('commons', file))
        if (hit) out.set(file, hit)
        else if (hit === undefined) missing.push(file)
      }

      for (let i = 0; i < missing.length; i += 50) {
        const batch = missing.slice(i, i + 50)
        const body = await get(COMMONS_API, {
          titles: batch.map((f) => `File:${f}`).join('|'),
          prop: 'imageinfo',
          iiprop: 'url|extmetadata',
          iiurlwidth: '640',
          iiextmetadatafilter: 'Artist|LicenseShortName|Credit',
        })
        const parsed = commonsSchema.safeParse(body)
        const query = parsed.success ? parsed.data.query : undefined
        const rename = new Map((query?.normalized ?? []).map((n) => [n.from, n.to]))
        const pages = new Map((query?.pages ?? []).map((p) => [p.title, p]))

        for (const file of batch) {
          const asked = `File:${file}`
          const info = pages.get(rename.get(asked) ?? asked)?.imageinfo?.[0]
          const meta = info?.extmetadata ?? {}
          const artist = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value)
          const license = stripHtml(meta.LicenseShortName?.value)
          const url = info?.thumburl ?? info?.url
          // No clear author or license means we cannot credit it properly, so skip it.
          const photo: Photo | null =
            info && url && artist && license
              ? { url, credit: `Photo: ${artist}, ${license}, via Wikimedia Commons`, pageUrl: info.descriptionurl }
              : null
          if (photo) out.set(file, photo)
          await cache.set(cacheKey('commons', file), photo, TTL)
        }
      }
      return out
    },
  }
}
