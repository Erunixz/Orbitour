// Turns a failed tiles load into a message the user can act on.
// We only call Google here after the tiles already failed to load, so a working
// key never pays for an extra request.

export const TILES_ROOT_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json'

export type TilesProblem =
  | 'missing_key'
  | 'invalid_key'
  | 'api_not_enabled'
  | 'referrer_blocked'
  | 'billing'
  | 'quota'
  | 'network'
  | 'unknown'

export type TilesDiagnosis = { problem: TilesProblem; message: string }

const messages: Record<TilesProblem, string> = {
  missing_key: 'No Map Tiles key. Set VITE_GOOGLE_TILES_KEY in .env and restart the dev server.',
  invalid_key: 'Google says the Map Tiles key is not valid. Check VITE_GOOGLE_TILES_KEY.',
  api_not_enabled: 'The Map Tiles API is not enabled for this key. Enable it in Google Cloud Console.',
  referrer_blocked: 'This site is not allowed to use the key. Add it to the key\'s HTTP referrer list.',
  billing: 'Billing is not set up for this Google Cloud project, so 3D tiles cannot load.',
  quota: 'The daily Map Tiles quota is used up. Try again later or raise the cap.',
  network: 'Could not reach Google to load the 3D city. Check your connection.',
  unknown: 'The 3D city failed to load.',
}

export function describe(problem: TilesProblem): TilesDiagnosis {
  return { problem, message: messages[problem] }
}

/** Maps a Google error response to a problem. Exported for tests. */
export function classify(status: number, body: string): TilesProblem {
  const text = body.toLowerCase()
  if (status === 429 || text.includes('quota') || text.includes('rate_limit')) return 'quota'
  if (text.includes('referer') || text.includes('referrer')) return 'referrer_blocked'
  if (text.includes('service_disabled') || text.includes('has not been used') || text.includes('is disabled')) {
    return 'api_not_enabled'
  }
  if (text.includes('billing')) return 'billing'
  if (text.includes('api key not valid') || text.includes('api_key_invalid')) return 'invalid_key'
  return 'unknown'
}

/** One request to explain why the tiles failed. Returns null if Google now answers fine. */
export async function diagnoseTilesKey(key: string, fetchImpl: typeof fetch = fetch): Promise<TilesDiagnosis | null> {
  if (!key.trim()) return describe('missing_key')
  let res: Response
  try {
    res = await fetchImpl(`${TILES_ROOT_URL}?key=${encodeURIComponent(key)}`)
  } catch {
    return describe('network')
  }
  if (res.ok) return null
  const body = await res.text().catch(() => '')
  return describe(classify(res.status, body))
}
