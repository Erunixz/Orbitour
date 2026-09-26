import { z } from 'zod'
import { latLonSchema } from './schemas.js'

// Manual edits to one day of a trip, plus place search results. Shared by the
// server (applies them) and the app (sends them).

/** A place found by search, to add as a stop. The server rebuilds the stop itself. */
export const placeResultSchema = latLonSchema.extend({
  name: z.string().min(1).max(200),
  /** "Hotel in Rua X, Lisbon" style description. */
  label: z.string().max(300),
  category: z.string().max(60),
  type: z.string().max(60),
  osmUrl: z.url().nullable(),
})

export const editSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), stopId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal('remove'), stopId: z.string() }),
  z.object({ op: z.literal('setVisit'), stopId: z.string(), minutes: z.number().int().min(10).max(600) }),
  z.object({ op: z.literal('moveToDay'), stopId: z.string(), toDay: z.number().int().min(0) }),
  z.object({ op: z.literal('add'), place: placeResultSchema, index: z.number().int().min(0).optional() }),
])

export const patchDaySchema = z.object({ edits: z.array(editSchema).min(1).max(20) })

export const replanBodySchema = z.object({ text: z.string().trim().min(3).max(500) })

export const placeSearchSchema = z.object({ places: z.array(placeResultSchema) })

export type PlaceResult = z.infer<typeof placeResultSchema>
export type DayEdit = z.infer<typeof editSchema>
export type PatchDay = z.infer<typeof patchDaySchema>
