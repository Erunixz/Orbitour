import { randomUUID } from 'node:crypto'
import { MemoryCache } from './cache.js'
import { hasValue, type Env } from './env.js'
import { ApiError, sendError, sendJson, type Req, type Res } from './http.js'
import { createLlm } from './llm/openai.js'
import { buildHealth } from './routes/health.js'
import { handleLegs } from './routes/legs.js'
import { handleGetTrip, handlePlanTrip, type TripRouteDeps } from './routes/trips.js'
import { MemoryTripStore } from './store/tripStore.js'
import { createRoutesClient } from './upstream/googleRoutes.js'
import { createNominatim } from './upstream/nominatim.js'
import { createWeather } from './upstream/openMeteo.js'
import { createOverpass } from './upstream/overpass.js'
import { userAgent } from './upstream/politeness.js'
import { createWikipedia } from './upstream/wikipedia.js'

type Handler = (req: Req, res: Res, params: Record<string, string>) => Promise<void> | void

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler }

/** Turns "/api/trips/:id" into a regex plus the names of its params. */
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = []
  const source = path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key)
    return '([^/]+)'
  })
  return { pattern: new RegExp(`^${source}/?$`), keys }
}

export type AppDeps = TripRouteDeps

export function defaultDeps(env: Env): AppDeps {
  const cache = new MemoryCache()
  const log = (message: string) => console.log(message)
  const agent = userAgent(env)
  const google = hasValue(env, 'GOOGLE_ROUTES_KEY') ? createRoutesClient(env.GOOGLE_ROUTES_KEY!.trim()) : null
  return {
    cache,
    log,
    routes: google,
    matrix: google,
    nominatim: createNominatim({ userAgent: agent, cache }),
    wikipedia: createWikipedia({ userAgent: agent, cache }),
    overpass: createOverpass({ userAgent: agent, cache }),
    weather: createWeather({ cache }),
    llm: createLlm(env, { log }),
    store: new MemoryTripStore(),
    now: () => new Date(),
    newId: () => randomUUID(),
  }
}

/** Builds the request handler used by both the local server and the Vercel function. */
export function createApp(env: Env = process.env, deps: AppDeps = defaultDeps(env)) {
  const routes: Route[] = []
  const add = (method: string, path: string, handler: Handler) => {
    routes.push({ method, ...compile(path), handler })
  }

  add('GET', '/api/health', (_req, res) => sendJson(res, 200, buildHealth(env)))
  add('POST', '/api/routes/legs', (req, res) => handleLegs(req, res, deps))
  add('POST', '/api/trips', (req, res) => handlePlanTrip(req, res, deps))
  add('GET', '/api/trips/:id', (_req, res, params) => handleGetTrip(res, params.id ?? '', deps))

  return async function handle(req: Req, res: Res): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = req.method ?? 'GET'
      let pathMatched = false

      for (const route of routes) {
        const match = route.pattern.exec(url.pathname)
        if (!match) continue
        pathMatched = true
        if (route.method !== method) continue

        const params: Record<string, string> = {}
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match[i + 1] ?? '')
        })
        await route.handler(req, res, params)
        return
      }

      if (pathMatched) throw new ApiError(405, 'method_not_allowed', `${method} is not allowed here.`)
      throw new ApiError(404, 'not_found', `No route for ${url.pathname}.`)
    } catch (error) {
      if (res.headersSent) {
        console.error('[server] error after response started', error)
        res.end()
        return
      }
      sendError(res, error)
    }
  }
}
