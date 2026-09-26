import { z } from 'zod'
import type { Pace } from '../../src/lib/types.js'
import { LlmError } from '../llm/openai.js'
import { PlanError, stage, type Candidate, type Emit, type PipelineDeps, type PlanState } from './context.js'
import { SCOUT_SYSTEM, type ScoutInput } from './prompts/scout.js'
import { displayName } from './verifier.js'

// Scout (LLM): picks the places that fit the request from the candidate pool.

/** Sights per day, not counting meals. */
export const STOPS_PER_DAY: Record<Pace, number> = { relaxed: 4, normal: 5, packed: 7 }

export const pickSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(['sight', 'museum', 'park', 'viewpoint', 'market', 'other']),
  reason: z.string().min(1).max(300),
  importance: z.number().int().min(1).max(5),
  mustSee: z.boolean(),
})

export const scoutReplySchema = z.object({ picks: z.array(pickSchema).max(60) })

export type ScoutPick = z.infer<typeof pickSchema>

const SCOUT_TOKENS = 6000

/** True when the Critic asked for this place to go. Matches the title with or without "(Paris)". */
const isBanned = (state: PlanState, title: string) =>
  state.banned.has(title.toLowerCase()) || state.banned.has(displayName(title).toLowerCase())

export function scoutInput(state: PlanState, pool: Candidate[]): ScoutInput {
  const { request, survey } = state
  const wanted = Math.ceil(request.days * STOPS_PER_DAY[request.pace] * 1.5)
  return {
    city: survey.label,
    days: request.days,
    pace: request.pace,
    party: request.party,
    budget: request.budget,
    interests: request.interests,
    wanted,
    mustSee: survey.mustSee.map((m) => ({ typed: m.typed, foundAs: m.place?.name ?? null })),
    pool: pool
      .filter((c) => !isBanned(state, c.title))
      .map((c) => ({ title: c.title, about: c.description, kind: c.kind })),
    avoid: [...state.banned],
    feedback: state.scoutFeedback,
  }
}

export async function runScout(state: PlanState, pool: Candidate[], deps: PipelineDeps, emit: Emit): Promise<ScoutPick[]> {
  const s = stage(emit, 'scout')
  const missing = deps.llm.missingConfig('scout')
  if (missing) {
    s.error(`The Scout is an AI agent and needs an OpenAI key. ${missing}`)
    throw new PlanError('llm_not_configured', `The Scout could not run. ${missing}`)
  }

  s.start(state.scoutFeedback.length > 0 ? 'Choosing places again with the Critic\'s notes...' : 'Choosing places that fit your trip...')
  try {
    const reply = await deps.llm.call(
      { agent: 'scout', name: 'scout_picks', system: SCOUT_SYSTEM, input: scoutInput(state, pool), schema: scoutReplySchema, maxTokens: SCOUT_TOKENS },
      state.usage,
    )
    const picks = reply.picks.filter((p) => !isBanned(state, p.title))
    s.done(`Picked ${picks.length} places.`)
    return picks
  } catch (error) {
    const message = error instanceof LlmError ? error.message : 'The Scout failed unexpectedly.'
    s.error(message)
    throw new PlanError('scout_failed', message)
  }
}
