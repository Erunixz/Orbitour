import { z } from 'zod'
import { stageIdSchema } from './crew.js'
import { latLonSchema, legSchema, tripSchema } from './schemas.js'

// Events streamed by POST /api/trips while a trip is planned. Each is one
// Server-Sent Event: the SSE event name is the `type`, the data is this JSON.

export const stopPreviewSchema = latLonSchema.extend({ id: z.string(), name: z.string() })

export const stageDataSchema = z
  .object({
    /** Surveyor: the trip area, so the map can start loading. */
    area: z.object({ center: latLonSchema, radiusM: z.number(), label: z.string() }),
    /** Verifier: a stop that passed. */
    stop: stopPreviewSchema,
    /** Verifier: a pick that was dropped and why. */
    rejected: z.object({ title: z.string(), reason: z.string() }),
    /** Router: ordered stops and legs per day. */
    days: z.array(z.object({ stops: z.array(stopPreviewSchema), legs: z.array(legSchema) })),
    /** Critic: complaints and who must fix them. */
    issues: z.array(z.object({ target: z.enum(['scout', 'timekeeper']), complaint: z.string() })),
  })
  .partial()

export const stageEventSchema = z.object({
  type: z.literal('stage'),
  stage: stageIdSchema,
  status: z.enum(['start', 'progress', 'done', 'error']),
  message: z.string(),
  data: stageDataSchema.optional(),
})

export const usageSchema = z.object({ calls: z.number(), inputTokens: z.number(), outputTokens: z.number() })

export const tripEventSchema = z.object({
  type: z.literal('trip'),
  trip: tripSchema,
  usage: usageSchema,
  /** False when the plan is fine but the database could not store it. */
  saved: z.boolean(),
})

export const failEventSchema = z.object({ type: z.literal('fail'), code: z.string(), message: z.string() })

export const planEventSchema = z.discriminatedUnion('type', [stageEventSchema, tripEventSchema, failEventSchema])

export type StageData = z.infer<typeof stageDataSchema>
export type StageEvent = z.infer<typeof stageEventSchema>
export type TripEvent = z.infer<typeof tripEventSchema>
export type FailEvent = z.infer<typeof failEventSchema>
export type PlanEvent = z.infer<typeof planEventSchema>
export type LlmUsage = z.infer<typeof usageSchema>
