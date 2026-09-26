import { keyNames, type Health, type KeyName } from '../../src/lib/health.js'
import { hasValue, type Env } from '../env.js'

export function buildHealth(env: Env, now = new Date()): Health {
  const keys = {} as Record<KeyName, boolean>
  for (const name of keyNames) keys[name] = hasValue(env, name)

  return {
    status: 'ok',
    time: now.toISOString(),
    store: keys.MONGODB_URI ? 'mongo' : 'memory',
    keys,
    missing: keyNames.filter((name) => !keys[name]),
  }
}
