import { describe, expect, it } from 'vitest'
import { buildHealth } from '../server/routes/health'
import { healthSchema, keyNames } from '../src/lib/health'

describe('buildHealth', () => {
  it('reports every key as missing when nothing is set', () => {
    const health = buildHealth({})
    expect(health.missing).toEqual([...keyNames])
    expect(health.store).toBe('memory')
    expect(healthSchema.safeParse(health).success).toBe(true)
  })

  it('treats blank values as missing', () => {
    const health = buildHealth({ OPENAI_API_KEY: '   ' })
    expect(health.keys.OPENAI_API_KEY).toBe(false)
  })

  it('uses mongo when a URI is set', () => {
    const health = buildHealth({ MONGODB_URI: 'mongodb+srv://example' })
    expect(health.store).toBe('mongo')
    expect(health.missing).not.toContain('MONGODB_URI')
  })

  it('never includes key values', () => {
    const secret = 'sk-test-should-not-leak'
    const health = buildHealth({ OPENAI_API_KEY: secret, GOOGLE_ROUTES_KEY: secret })
    expect(JSON.stringify(health)).not.toContain(secret)
    expect(health.keys.OPENAI_API_KEY).toBe(true)
  })
})
