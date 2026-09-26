import { z } from 'zod'
import { cacheKey, DAY, type Cache } from '../cache.js'
import { fetchWithRetry, type RetryOptions } from './fetchRetry.js'
import { RateGate } from './politeness.js'

// Wikidata, for two facts about a place: its English Wikipedia article, and how
// many language editions of Wikipedia cover it (a good sign of how famous it is).
// https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities

const API = 'https://www.wikidata.org/w/api.php'
const TTL = 14 * DAY
const BATCH = 50

export type WikidataFacts = {
  /** English Wikipedia title, or null when there is no English article. */
  enTitle: string | null
  /** Number of language Wikipedias with an article on it. */
  sitelinks: number
}

export type WikidataClient = {
  /** Facts for each id found. May be partial when Wikidata asks us to slow down part way. */
  facts(ids: string[]): Promise<Map<string, WikidataFacts>>
}

const replySchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      missing: z.string().optional(),
      sitelinks: z.record(z.string(), z.object({ title: z.string() })).optional(),
    }),
  ),
})

/** Sister projects are not language Wikipedias. */
const NOT_A_WIKIPEDIA = new Set(['commonswiki', 'specieswiki', 'metawiki', 'mediawikiwiki', 'wikidatawiki', 'sourceswiki', 'outreachwiki', 'wikimaniawiki'])

export const isQid = (id: string) => /^Q\d+$/.test(id)

type Deps = { userAgent: string; cache: Cache; gate?: RateGate; retry?: Partial<RetryOptions> }

export function createWikidata({ userAgent, cache, gate = new RateGate(1000), retry = {} }: Deps): WikidataClient {
  const headers = { 'User-Agent': userAgent, 'Api-User-Agent': userAgent, Accept: 'application/json' }

  return {
    async facts(ids) {
      const out = new Map<string, WikidataFacts>()
      const missing: string[] = []
      for (const id of new Set(ids.filter(isQid))) {
        const hit = await cache.get<WikidataFacts>(cacheKey('wikidata', id))
        if (hit) out.set(id, hit)
        else missing.push(id)
      }
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH)
        let body: unknown
        try {
          body = await gate.run(async () => {
            const query = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: batch.join('|'), props: 'sitelinks' })
            const res = await fetchWithRetry(`${API}?${query.toString()}`, { headers }, { ...retry, service: 'wikidata' })
            return (await res.json()) as unknown
          })
        } catch (error) {
          // Keep what earlier batches found. Stop asking once Wikidata says to slow down.
          if (out.size === 0 && i === 0) throw error
          break
        }
        const parsed = replySchema.safeParse(body)
        if (!parsed.success) continue
        for (const id of batch) {
          const entity = parsed.data.entities[id]
          if (!entity || entity.missing !== undefined) continue
          const links = entity.sitelinks ?? {}
          const facts: WikidataFacts = {
            enTitle: links.enwiki?.title ?? null,
            sitelinks: Object.keys(links).filter((k) => k.endsWith('wiki') && !NOT_A_WIKIPEDIA.has(k)).length,
          }
          out.set(id, facts)
          await cache.set(cacheKey('wikidata', id), facts, TTL)
        }
      }
      return out
    },
  }
}
