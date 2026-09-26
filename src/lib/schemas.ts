import { z } from 'zod'

// Zod schemas for data that crosses the network. Shared by server and app.

export const travelModeSchema = z.enum(['walk', 'transit', 'drive', 'cycle'])
export const budgetSchema = z.enum(['free', 'modest', 'any'])

export const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

export const legStepSchema = z.object({
  mode: z.enum(['walk', 'transit']),
  meters: z.number(),
  minutes: z.number(),
  line: z.string().optional(),
})

export const legSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  mode: travelModeSchema,
  minutes: z.number(),
  meters: z.number(),
  polyline: z.string(),
  estimated: z.boolean(),
  steps: z.array(legStepSchema).optional(),
})

export const legsRequestSchema = z.object({
  stops: z
    .array(latLonSchema.extend({ id: z.string().min(1).max(100) }))
    .min(2)
    .max(12),
  mode: z.union([travelModeSchema, z.literal('auto')]).default('auto'),
  budget: budgetSchema.default('modest'),
})

export const legsResponseSchema = z.object({
  legs: z.array(legSchema),
  estimatedCount: z.number(),
})

export type LegsRequest = z.input<typeof legsRequestSchema>
export type LegsResponse = z.infer<typeof legsResponseSchema>
