import { useEffect, useState } from 'react'
import { tripSchema } from '../lib/schemas'
import type { Trip } from '../lib/types'

// Fixture mode: saved trips in /fixtures load with no planning calls. Each file is
// its own chunk, fetched only when asked for.

const files = import.meta.glob<unknown>('../../fixtures/*.json', { import: 'default' })

const byName = new Map(Object.entries(files).map(([path, load]) => [path.replace(/^.*\/|\.json$/g, ''), load]))

export const fixtureNames = [...byName.keys()].sort()

/** Used until planning exists, when the address has no ?fixture. */
export const DEFAULT_FIXTURE = 'paris-2day'

export class FixtureError extends Error {}

export async function loadFixture(name: string): Promise<Trip> {
  const load = byName.get(name)
  if (!load) {
    const known = fixtureNames.length > 0 ? fixtureNames.join(', ') : 'none'
    throw new FixtureError(`There is no fixture called "${name}". Available: ${known}.`)
  }
  const parsed = tripSchema.safeParse(await load())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''
    throw new FixtureError(`The fixture "${name}" is not a valid trip${where}.`)
  }
  return parsed.data
}

export type FixtureState = { kind: 'loading' } | { kind: 'ready'; trip: Trip } | { kind: 'error'; message: string }

export function useFixture(name: string): FixtureState {
  const [state, setState] = useState<FixtureState>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    loadFixture(name)
      .then((trip) => live && setState({ kind: 'ready', trip }))
      .catch((error: unknown) => {
        if (!live) return
        const message = error instanceof FixtureError ? error.message : `Could not load the fixture "${name}".`
        setState({ kind: 'error', message })
      })
    return () => {
      live = false
    }
  }, [name])
  return state
}
