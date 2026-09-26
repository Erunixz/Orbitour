import { keyNames, type Health, type KeyName } from '../../src/lib/health.js'
import { hasValue, type Env } from '../env.js'

/** `databaseOk` is the result of a ping, when a database is configured. */
export function buildHealth(env: Env, now = new Date(), databaseOk = true): Health {
  const keys = {} as Record<KeyName, boolean>
  for (const name of keyNames) keys[name] = hasValue(env, name)

  return {
    status: 'ok',
    time: now.toISOString(),
    store: keys.MONGODB_URI ? 'mongo' : 'memory',
    database: !keys.MONGODB_URI ? 'memory' : databaseOk ? 'ok' : 'unreachable',
    keys,
    missing: keyNames.filter((name) => !keys[name]),
  }
}
