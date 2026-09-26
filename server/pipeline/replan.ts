import { z } from 'zod'
import type { Trip } from '../../src/lib/types.js'
import { LlmError } from '../llm/openai.js'
import { runCandidates } from './candidates.js'
import { PlanError, type PipelineDeps, type PlannedStop, type PlanState, type Survey } from './context.js'
import { applyChanges, EditError, findStop, type Change } from './edit.js'
import { REPLAN_SYSTEM, type ReplanInput } from './prompts/replan.js'
import { SCOUT_SYSTEM, type ScoutInput } from './prompts/scout.js'
import { scoutReplySchema } from './scout.js'
import { runVerifier, stopForPlace } from './verifier.js'

// Replan: the fast model turns text like "drop the museum, slower morning" into
// edits. Code checks each one against the trip before anything changes. New
// places go through the Scout and the Verifier, like a normal plan.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const replanEditSchema = z.object({
  action: z.enum(['remove', 'move', 'move_to_day', 'set_visit', 'add', 'swap', 'set_pace', 'set_times']),
  stopId: z.string().nullable(),
  day: z.number().int().nullable(),
  position: z.number().int().nullable(),
  minutes: z.number().int().nullable(),
  description: z.string().max(200).nullable(),
  pace: z.enum(['relaxed', 'normal', 'packed']).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
})

export const replanReplySchema = z.object({ edits: z.array(replanEditSchema).max(10), note: z.string().max(300).nullable() })

export type ReplanEdit = z.infer<typeof replanEditSchema>

const REPLAN_TOKENS = 1500
const noEmit = () => {}

export function replanInput(text: string, trip: Trip): ReplanInput {
  return {
    request: text,
    trip: {
      city: trip.request.city,
      pace: trip.request.pace,
      startTime: trip.request.startTime,
      endTime: trip.request.endTime,
      days: trip.days.length,
    },
    plan: trip.days.map((d, i) => ({
      day: i + 1,
      stops: d.stops.map((s) => ({ id: s.id, name: s.name, kind: s.kind, arrive: s.arrive, role: s.role ?? null })),
    })),
  }
}

/** The trip area as a survey, for the Scout and Verifier. */
function surveyOf(trip: Trip): Survey {
  return { label: trip.request.city, center: trip.center, radiusM: trip.radiusM, startFrom: null, mustSee: [] }
}

/**
 * A new place for a description, through the Scout and Verifier. Falls back to
 * a map search when the Scout finds nothing that fits.
 */
async function findPlace(description: string, trip: Trip, deps: PipelineDeps, state: PlanState): Promise<PlannedStop | null> {
  const survey = surveyOf(trip)
  const taken = new Set(trip.days.flatMap((d) => d.stops.map((s) => s.id)))
  const pool = await runCandidates(survey, deps, noEmit)
  if (pool.length > 0 && !deps.llm.missingConfig('scout')) {
    const input: ScoutInput = {
      city: trip.request.city,
      days: 1,
      pace: trip.request.pace,
      party: trip.request.party,
      budget: trip.request.budget,
      interests: trip.request.interests,
      wanted: 3,
      mustSee: [],
      pool: pool.map((c) => ({ title: c.title, about: c.description, kind: c.kind })),
      avoid: trip.days.flatMap((d) => d.stops.map((s) => s.name)),
      feedback: [`The traveller wants to add: "${description}". Pick only places that match it, best match first.`],
    }
    try {
      const reply = await deps.llm.call(
        { agent: 'scout', name: 'scout_add', system: SCOUT_SYSTEM, input, schema: scoutReplySchema, maxTokens: 2000 },
        state.usage,
      )
      const { stops } = await runVerifier(reply.picks, pool, survey, deps, noEmit)
      const fresh = stops.find((s) => !taken.has(s.id))
      if (fresh) return fresh
    } catch (error) {
      if (!(error instanceof LlmError)) throw error
    }
  }
  const found = (await deps.nominatim.search(description, { limit: 1, near: { center: trip.center, radiusM: trip.radiusM * 2 } }))[0]
  if (!found) return null
  const stop = await stopForPlace(found, description, `You asked for ${description}.`, deps)
  return taken.has(stop.id) ? null : stop
}

export type ReplanResult = { trip: Trip; skipped: string[] }

/** Turns the text into checked changes and applies them. */
export async function replan(text: string, trip: Trip, deps: PipelineDeps): Promise<ReplanResult> {
  const missing = deps.llm.missingConfig('fast')
  if (missing) throw new PlanError('llm_not_configured', `Typed changes use an AI model. ${missing}`)

  const state: PlanState = {
    request: trip.request,
    survey: surveyOf(trip),
    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    scoutFeedback: [],
    banned: new Set(),
  }
  let reply: z.infer<typeof replanReplySchema>
  try {
    reply = await deps.llm.call(
      { agent: 'fast', name: 'replan_edits', system: REPLAN_SYSTEM, input: replanInput(text, trip), schema: replanReplySchema, maxTokens: REPLAN_TOKENS },
      state.usage,
    )
  } catch (error) {
    throw new PlanError('replan_failed', error instanceof LlmError ? error.message : 'Could not read that change.')
  }
  if (reply.edits.length === 0) {
    throw new EditError(reply.note ?? 'Could not turn that into changes. Try naming the stop, like "drop the Louvre".')
  }

  const days = trip.days.map((d) => d.stops)
  const skipped: string[] = []
  const changes: Change[] = []
  const nameOf = (id: string | null) => (id ? days.flat().find((s) => s.id === id)?.name : undefined)

  for (const edit of reply.edits) {
    const at = edit.stopId ? findStop(days, edit.stopId) : null
    const needsStop = ['remove', 'move', 'move_to_day', 'set_visit', 'swap'].includes(edit.action)
    if (needsStop && !at) {
      skipped.push('One change named a stop that is not in the plan.')
      continue
    }
    if (at && days[at.day]![at.index]!.role === 'start') {
      skipped.push('The starting point cannot be changed here.')
      continue
    }
    switch (edit.action) {
      case 'remove':
        changes.push({ kind: 'remove', stopId: edit.stopId! })
        break
      case 'move': {
        if (edit.position === null) {
          skipped.push(`Moving ${nameOf(edit.stopId)} needs a position.`)
          break
        }
        const hasStart = days[at!.day]![0]?.role === 'start'
        changes.push({ kind: 'move', stopId: edit.stopId!, toIndex: Math.max(0, edit.position - 1) + (hasStart ? 1 : 0) })
        break
      }
      case 'move_to_day':
        if (edit.day === null || edit.day < 1 || edit.day > days.length) skipped.push(`There is no such day for ${nameOf(edit.stopId)}.`)
        else changes.push({ kind: 'moveToDay', stopId: edit.stopId!, toDay: edit.day - 1 })
        break
      case 'set_visit':
        if (edit.minutes === null || edit.minutes < 10 || edit.minutes > 600) skipped.push(`That visit length for ${nameOf(edit.stopId)} does not work.`)
        else changes.push({ kind: 'setVisit', stopId: edit.stopId!, minutes: edit.minutes })
        break
      case 'add':
      case 'swap': {
        const description = edit.description?.trim()
        if (!description) {
          skipped.push('An added place needs a description.')
          break
        }
        const stop = await findPlace(description, trip, deps, state)
        if (!stop) {
          skipped.push(`Could not find "${description}" in the trip area.`)
          break
        }
        if (edit.action === 'swap') {
          changes.push({ kind: 'add', stop, day: at!.day, index: at!.index }, { kind: 'remove', stopId: edit.stopId! })
        } else {
          const day = edit.day !== null && edit.day >= 1 && edit.day <= days.length ? edit.day - 1 : null
          changes.push({ kind: 'add', stop, day, index: null })
        }
        break
      }
      case 'set_pace':
        if (edit.pace) changes.push({ kind: 'setPace', pace: edit.pace })
        break
      case 'set_times': {
        const start = edit.startTime ?? trip.request.startTime
        const end = edit.endTime ?? trip.request.endTime
        if (!hhmm.safeParse(start).success || !hhmm.safeParse(end).success || start >= end) skipped.push('Those day hours do not work.')
        else changes.push({ kind: 'setTimes', startTime: start, endTime: end })
        break
      }
    }
  }

  if (changes.length === 0) throw new EditError(skipped[0] ?? 'Could not turn that into changes.')
  deps.log(`[replan] ${changes.length} changes, ${skipped.length} skipped, llm calls=${state.usage.calls} in=${state.usage.inputTokens} out=${state.usage.outputTokens}`)
  const next = await applyChanges(trip, changes, deps)
  if (skipped.length > 0 && next.lastChange) next.lastChange.summary.push(...skipped.map((s) => `Skipped: ${s}`))
  return { trip: next, skipped }
}
