import { z } from 'zod'

// Shape of GET /api/health. Shared by server (builds it) and client (parses it).
// Only reports whether a setting exists, never its value.

export const keyNames = [
  'VITE_GOOGLE_TILES_KEY',
  'GOOGLE_ROUTES_KEY',
  'OPENAI_API_KEY',
  'LLM_MODEL_SCOUT',
  'LLM_MODEL_CRITIC',
  'LLM_MODEL_FAST',
  'MONGODB_URI',
  'CONTACT_EMAIL',
] as const

export type KeyName = (typeof keyNames)[number]

export const healthSchema = z.object({
  status: z.literal('ok'),
  time: z.string(),
  store: z.enum(['memory', 'mongo']),
  /** Whether the trip database answered. "memory" when there is none. */
  database: z.enum(['memory', 'ok', 'unreachable']),
  keys: z.record(z.enum(keyNames), z.boolean()),
  missing: z.array(z.enum(keyNames)),
})

export type Health = z.infer<typeof healthSchema>
