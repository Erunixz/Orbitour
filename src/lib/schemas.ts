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

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time like "09:30"')

export const tripRequestSchema = z.object({
  city: z.string().min(1).max(120),
  days: z.number().int().min(1).max(7),
  startTime: hhmm,
  endTime: hhmm,
  startFrom: z.string().max(200).optional(),
  mustSee: z.array(z.string().max(200)).max(20),
  interests: z.array(z.string().max(60)).max(20),
  pace: z.enum(['relaxed', 'normal', 'packed']),
  mode: z.union([travelModeSchema, z.literal('auto')]),
  party: z.enum(['solo', 'couple', 'family', 'easy']),
  budget: budgetSchema,
  meals: z.array(z.enum(['lunch', 'dinner'])),
  diet: z.string().max(120).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like "2026-10-03"')
    .optional(),
})

export const sourceSchema = z.object({
  kind: z.enum(['wikipedia', 'osm', 'routes', 'nominatim']),
  label: z.string(),
  url: z.url(),
})

export const photoSchema = z.object({
  url: z.url(),
  credit: z.string(),
  pageUrl: z.url(),
})

export const stopSchema = latLonSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['sight', 'museum', 'park', 'viewpoint', 'market', 'food', 'lodging', 'other']),
  summary: z.string(),
  reason: z.string(),
  photo: photoSchema.nullable(),
  sources: z.array(sourceSchema),
  visitMin: z.number().min(0),
  arrive: hhmm,
  depart: hhmm,
  mustSee: z.boolean(),
  groundHeightM: z.number().optional(),
  role: z.literal('start').optional(),
})

export const daySchema = z.object({
  index: z.number().int().min(0),
  date: z.string().optional(),
  stops: z.array(stopSchema),
  legs: z.array(legSchema),
  warnings: z.array(z.string()),
})

export const tripSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  request: tripRequestSchema,
  center: latLonSchema,
  radiusM: z.number().positive(),
  days: z.array(daySchema).min(1),
  lodging: stopSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(1),
})

/** One row of the saved trips list. */
export const tripSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  city: z.string(),
  days: z.number(),
  updatedAt: z.string(),
})

export const tripListSchema = z.object({
  trips: z.array(tripSummarySchema),
  /** "memory" means trips are lost when the server restarts. */
  store: z.enum(['memory', 'mongo']),
})

export type TripSummary = z.infer<typeof tripSummarySchema>
export type TripList = z.infer<typeof tripListSchema>

/** Trip ids are UUIDs or short slugs. Anything else is refused before it reaches the store. */
export const tripIdSchema = z.string().regex(/^[\w-]{1,64}$/)

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
