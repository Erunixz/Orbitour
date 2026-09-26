import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { criticReplySchema } from '../server/pipeline/critic'
import { scoutReplySchema } from '../server/pipeline/scout'
import { createLlm, LlmError, strictJsonSchema } from '../server/llm/openai'

const env = { OPENAI_API_KEY: 'sk-test-secret', LLM_MODEL_SCOUT: 'test-model', LLM_MODEL_CRITIC: 'test-model' }
const schema = z.object({ answer: z.string().min(1) })
const noSleep = async () => {}

function reply(content: string, finish = 'stop', usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }], usage }), { status: 200 })
}

function fakeFetch(responses: (() => Response)[]) {
  const bodies: Record<string, unknown>[] = []
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    return next()
  }) as typeof fetch
  return { impl, bodies }
}

const request = { agent: 'scout' as const, name: 'test', system: 'Be brief.', input: { q: 1 }, schema, maxTokens: 500 }

describe('strict JSON schema for the LLM', () => {
  it('turns the agent schemas into strict-mode schemas', () => {
    for (const s of [scoutReplySchema, criticReplySchema]) {
      const json = JSON.stringify(strictJsonSchema(s))
      expect(json).not.toContain('minLength')
      expect(json).not.toContain('maxLength')
      expect(json).not.toContain('$schema')
      expect(json).toContain('"additionalProperties":false')
    }
  })

  it('refuses optional fields, which strict mode does not allow', () => {
    expect(() => strictJsonSchema(z.object({ a: z.string().optional() }))).toThrow(/optional/)
  })
})

describe('LLM wrapper', () => {
  it('says what is missing without calling OpenAI', async () => {
    const llm = createLlm({ LLM_MODEL_SCOUT: 'x' })
    expect(llm.missingConfig('scout')).toBe('Set OPENAI_API_KEY in .env to run this step.')
    expect(createLlm({}).missingConfig('critic')).toBe('Set OPENAI_API_KEY and LLM_MODEL_CRITIC in .env to run this step.')
    await expect(llm.call(request)).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('sends a strict schema, the model and the budget, and counts tokens', async () => {
    const { impl, bodies } = fakeFetch([() => reply('{"answer":"hi"}')])
    const logs: string[] = []
    const llm = createLlm(env, { fetchImpl: impl, log: (m) => logs.push(m) })
    const usage = { calls: 0, inputTokens: 0, outputTokens: 0 }
    expect(await llm.call(request, usage)).toEqual({ answer: 'hi' })
    const body = bodies[0]!
    expect(body.model).toBe('test-model')
    expect(body.max_completion_tokens).toBe(500)
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'test', strict: true } })
    expect(usage).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 })
    expect(logs[0]).toMatch(/scout model=test-model \d+ms in=100 out=20/)
    expect(logs.join(' ')).not.toContain('sk-test-secret')
  })

  it('retries once with twice the budget when the reply is cut off', async () => {
    const { impl, bodies } = fakeFetch([() => reply('{"answ', 'length'), () => reply('{"answer":"ok"}')])
    const llm = createLlm(env, { fetchImpl: impl })
    expect(await llm.call(request)).toEqual({ answer: 'ok' })
    expect(bodies.map((b) => b.max_completion_tokens)).toEqual([500, 1000])
  })

  it('retries once on a reply that fails validation, then gives up clearly', async () => {
    const { impl } = fakeFetch([() => reply('{"answer":""}'), () => reply('not json')])
    const llm = createLlm(env, { fetchImpl: impl })
    await expect(llm.call(request)).rejects.toMatchObject({ code: 'bad_reply', message: 'The model replied with invalid data twice.' })
  })

  it('reports a cut-off reply twice in plain words', async () => {
    const { impl } = fakeFetch([() => reply('{', 'length'), () => reply('{', 'length')])
    await expect(createLlm(env, { fetchImpl: impl }).call(request)).rejects.toThrow(/ran out of room twice/)
  })

  it('retries rate limits, and never repeats OpenAI error text (it can hold part of the key)', async () => {
    const leak = () => new Response('{"error":{"message":"Incorrect API key provided: sk-tes***cret"}}', { status: 401 })
    const { impl } = fakeFetch([leak])
    const error = await createLlm(env, { fetchImpl: impl, retry: { sleep: noSleep } }).call(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).message).toBe('OpenAI rejected the API key (401). Check OPENAI_API_KEY.')

    const limited = () => new Response('slow down', { status: 429 })
    const { impl: impl2, bodies } = fakeFetch([limited, () => reply('{"answer":"after wait"}')])
    expect(await createLlm(env, { fetchImpl: impl2, retry: { sleep: noSleep } }).call(request)).toEqual({ answer: 'after wait' })
    expect(bodies).toHaveLength(2)
  })

  it('says plainly when the account has no credit', async () => {
    const broke = () => new Response('{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}', { status: 429 })
    const { impl } = fakeFetch([broke, broke, broke])
    const error = await createLlm(env, { fetchImpl: impl, retry: { sleep: noSleep } }).call(request).catch((e: unknown) => e)
    expect((error as LlmError).message).toMatch(/no credit left/)
  })

  it('treats a refusal as a clear failure', async () => {
    const refusal = () =>
      new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'No.' } }] }), { status: 200 })
    await expect(createLlm(env, { fetchImpl: fakeFetch([refusal]).impl }).call(request)).rejects.toMatchObject({ code: 'refused' })
  })
})
