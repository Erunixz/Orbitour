// Reads settings from process.env. Values stay on the server.

export type Env = Record<string, string | undefined>

/** Load .env into process.env for local runs. Missing file is fine. */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path)
  } catch {
    // No .env file. Keys can still come from the real environment.
  }
}

/** True when a variable is set to something other than blanks. */
export function hasValue(env: Env, name: string): boolean {
  const value = env[name]
  return typeof value === 'string' && value.trim().length > 0
}

export function readPort(env: Env): number {
  const port = Number(env.PORT)
  return Number.isInteger(port) && port > 0 ? port : 8787
}
