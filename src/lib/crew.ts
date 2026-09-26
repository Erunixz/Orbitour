import { z } from 'zod'

// The planning crew: a fixed order of code steps and two AI agents. Shared by the
// server (which runs them) and the app (which shows them as cards).

export const stageIds = [
  'surveyor',
  'candidates',
  'scout',
  'verifier',
  'daysplit',
  'router',
  'food',
  'timekeeper',
  'weather',
  'critic',
] as const

export type StageId = (typeof stageIds)[number]

export type CrewMember = { id: StageId; name: string; ai: boolean; job: string }

export const crew: CrewMember[] = [
  { id: 'surveyor', name: 'Surveyor', ai: false, job: 'Finds the city, your start point and your must-see places on the map.' },
  { id: 'candidates', name: 'Librarian', ai: false, job: 'Collects notable places nearby from Wikipedia.' },
  { id: 'scout', name: 'Scout', ai: true, job: 'Picks the places that fit your interests.' },
  { id: 'verifier', name: 'Verifier', ai: false, job: 'Checks every pick against a real source inside the trip area.' },
  { id: 'daysplit', name: 'Planner', ai: false, job: 'Splits the stops into compact days.' },
  { id: 'router', name: 'Router', ai: false, job: 'Finds the best order and the real travel between stops.' },
  { id: 'food', name: 'Food finder', ai: false, job: 'Finds meals and a place to stay from OpenStreetMap.' },
  { id: 'timekeeper', name: 'Timekeeper', ai: false, job: 'Sets visit lengths and times, and fixes days that run long.' },
  { id: 'weather', name: 'Forecaster', ai: false, job: 'Checks the forecast when you gave a start date.' },
  { id: 'critic', name: 'Critic', ai: true, job: 'Reviews the plan against what you asked for.' },
]

export const stageIdSchema = z.enum(stageIds)
