import { z } from 'zod'
import type { Leg, Stop, TripRequest } from '../../src/lib/types.js'
import { LlmError } from '../llm/openai.js'
import { stage, type Emit, type PipelineDeps, type PlanState } from './context.js'
import { CRITIC_SYSTEM, type CriticInput } from './prompts/critic.js'

// Critic (LLM): reviews the scheduled plan for what numbers cannot judge. Each
// complaint names the crew member that must fix it.

export const issueSchema = z.object({
  target: z.enum(['scout', 'timekeeper']),
  stopId: z.string().nullable(),
  action: z.enum(['replace_stop', 'drop_stop', 'slow_down', 'none']),
  complaint: z.string().min(1).max(300),
})

export const criticReplySchema = z.object({ ok: z.boolean(), issues: z.array(issueSchema).max(6) })

export type CriticIssue = z.infer<typeof issueSchema>

const CRITIC_TOKENS = 3000

export type ReviewDay = { stops: Stop[]; legs: Leg[]; audit: string[] }

export function criticInput(request: TripRequest, label: string, days: ReviewDay[]): CriticInput {
  return {
    request: {
      city: label,
      days: request.days,
      pace: request.pace,
      party: request.party,
      interests: request.interests,
      mustSee: request.mustSee,
    },
    plan: days.map((day, d) => {
      const names = new Map(day.stops.map((s) => [s.id, s.name]))
      return {
        day: d + 1,
        stops: day.stops.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          arrive: s.arrive,
          depart: s.depart,
          mustSee: s.mustSee,
          about: s.summary.slice(0, 160),
        })),
        legs: day.legs.map((l) => ({ from: names.get(l.fromId) ?? l.fromId, to: names.get(l.toId) ?? l.toId, mode: l.mode, minutes: l.minutes })),
      }
    }),
    audit: days.flatMap((day, d) => day.audit.map((a) => `Day ${d + 1}: ${a}`)),
  }
}

/** The review, or null when the Critic could not run. The plan is still usable without it. */
export async function runCritic(
  state: PlanState,
  days: ReviewDay[],
  round: number,
  deps: PipelineDeps,
  emit: Emit,
): Promise<CriticIssue[] | null> {
  const s = stage(emit, 'critic')
  const missing = deps.llm.missingConfig('critic')
  if (missing) {
    s.error(`Skipped the review. ${missing}`)
    return null
  }
  s.start(round === 0 ? 'Reviewing the plan...' : 'Reviewing the revised plan...')
  try {
    const reply = await deps.llm.call(
      {
        agent: 'critic',
        name: 'critic_review',
        system: CRITIC_SYSTEM,
        input: criticInput(state.request, state.survey.label, days),
        schema: criticReplySchema,
        maxTokens: CRITIC_TOKENS,
      },
      state.usage,
    )
    const issues = reply.issues.filter((i) => i.action !== 'none' || i.target === 'scout')
    s.done(issues.length === 0 ? 'Looks good.' : `${issues.length} notes for the crew.`, {
      issues: issues.map(({ target, complaint }) => ({ target, complaint })),
    })
    return issues
  } catch (error) {
    s.error(`Skipped the review. ${error instanceof LlmError ? error.message : 'The Critic failed unexpectedly.'}`)
    return null
  }
}
