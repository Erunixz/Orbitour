import { legsRequestSchema, type LegsResponse } from '../../src/lib/schemas.js'
import { parseBody, readJson, sendJson, type Req, type Res } from '../http.js'
import { buildLegs, type LegDeps } from '../pipeline/legs.js'

/** POST /api/routes/legs: legs between consecutive stops. */
export async function handleLegs(req: Req, res: Res, deps: LegDeps): Promise<void> {
  const body = parseBody(legsRequestSchema, await readJson(req))
  const result: LegsResponse = await buildLegs(body.stops, body.mode, body.budget, deps)
  sendJson(res, 200, result)
}
