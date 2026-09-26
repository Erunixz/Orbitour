import { z } from 'zod'
import type { LlmUsage } from '../../src/lib/planEvents.js'
import { hasValue, type Env } from '../env.js'
import { fetchWithRetry, UpstreamError, type RetryOptions } from '../upstream/fetchRetry.js'

// The one wrapper for every LLM call: OpenAI Chat Completions with a strict JSON
// schema, a token budget, a timeout, zod validation, and one retry with a bigger
// budget when the reply is cut off or invalid.
// https://platform.openai.com/docs/guides/structured-outputs

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export type Agent = 'scout' | 'critic' | 'fast'

const modelVar: Record<Agent, string> = {
  scout: 'LLM_MODEL_SCOUT',
  critic: 'LLM_MODEL_CRITIC',
  fast: 'LLM_MODEL_FAST',
}

export class LlmError extends Error {
  constructor(
    readonly code: 'not_configured' | 'upstream' | 'bad_reply' | 'refused',
    message: string,
  ) {
    super(message)
  }
}

export type LlmRequest<T> = {
  agent: Agent
  /** Short name for the schema, letters and underscores. */
  name: string
  system: string
  /** Sent as JSON in the user message. */
  input: unknown
  schema: z.ZodType<T>
  maxTokens: number
}

export type Llm = {
  /** Null when this agent can run, else a message saying what is missing. */
  missingConfig(agent: Agent): string | null
  call<T>(request: LlmRequest<T>, usage?: LlmUsage): Promise<T>
}

/** Keywords OpenAI strict mode does not accept. zod still checks them on the reply. */
const UNSUPPORTED = new Set(['$schema', 'minLength', 'maxLength', 'default'])

/** JSON schema for OpenAI strict mode. Every object must list all its keys as required. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((n, i) => clean(n, `${path}[${i}]`))
    if (typeof node !== 'object' || node === null) return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED.has(key)) continue
      out[key] = key === 'properties' ? cleanProps(value, path) : clean(value, `${path}.${key}`)
    }
    if (out.type === 'object') {
      const keys = Object.keys((out.properties as Record<string, unknown> | undefined) ?? {})
      const required = (out.required as string[] | undefined) ?? []
      if (keys.some((k) => !required.includes(k))) {
        throw new Error(`LLM schema at ${path || 'root'} has optional fields. Use nullable instead.`)
      }
      out.additionalProperties = false
    }
    return out
  }
  const cleanProps = (props: unknown, path: string) =>
    Object.fromEntries(Object.entries(props as Record<string, unknown>).map(([k, v]) => [k, clean(v, `${path}.${k}`)]))
  return clean(z.toJSONSchema(schema), '') as Record<string, unknown>
}

const replySchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
})

/** Plain message for an OpenAI HTTP error. OpenAI's own text can echo part of the key, so it is never shown. */
function describeStatus(status: number | null): string {
  if (status === null) return 'OpenAI did not respond.'
  if (status === 401) return 'OpenAI rejected the API key (401). Check OPENAI_API_KEY.'
  if (status === 403) return 'OpenAI refused access for this key (403).'
  if (status === 404) return 'OpenAI does not know that model (404). Check the LLM_MODEL_* settings.'
  if (status === 429) return 'OpenAI rate limit or quota reached (429). Try again later or check billing.'
  if (status === 400) return 'OpenAI rejected the request (400).'
  return `OpenAI had a server error (${status}).`
}

type Deps = {
  fetchImpl?: typeof fetch
  log?: (message: string) => void
  retry?: Partial<RetryOptions>
  timeoutMs?: number
  now?: () => number
}

export function createLlm(env: Env, deps: Deps = {}): Llm {
  const { fetchImpl = fetch, log = () => {}, retry = {}, timeoutMs = 120_000, now = Date.now } = deps

  const missingConfig = (agent: Agent): string | null => {
    const missing = ['OPENAI_API_KEY', modelVar[agent]].filter((name) => !hasValue(env, name))
    if (missing.length === 0) return null
    return `Set ${missing.join(' and ')} in .env to run this step.`
  }

  async function once<T>(request: LlmRequest<T>, model: string, maxTokens: number, usage?: LlmUsage) {
    const started = now()
    const body = {
      model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: JSON.stringify(request.input) },
      ],
      max_completion_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.name, strict: true, schema: strictJsonSchema(request.schema) },
      },
    }

    let res: Response
    try {
      res = await fetchWithRetry(
        OPENAI_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
          body: JSON.stringify(body),
        },
        { timeoutMs, ...retry, fetchImpl, service: 'openai' },
      )
    } catch (error) {
      const status = error instanceof UpstreamError ? error.status : null
      log(`[llm] ${request.agent} model=${model} failed status=${status ?? 'none'} after ${now() - started}ms`)
      throw new LlmError('upstream', describeStatus(status))
    }

    const parsed = replySchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) throw new LlmError('bad_reply', 'OpenAI sent a reply in an unexpected shape.')
    const { choices, usage: used } = parsed.data
    if (usage && used) {
      usage.calls += 1
      usage.inputTokens += used.prompt_tokens
      usage.outputTokens += used.completion_tokens
    }
    log(
      `[llm] ${request.agent} model=${model} ${now() - started}ms in=${used?.prompt_tokens ?? '?'} out=${used?.completion_tokens ?? '?'} budget=${maxTokens}`,
    )

    const choice = choices[0]!
    if (choice.message.refusal) throw new LlmError('refused', 'The model declined to answer.')
    const truncated = choice.finish_reason === 'length'
    let value: unknown = null
    try {
      value = JSON.parse(choice.message.content ?? '')
    } catch {
      return { ok: false as const, truncated }
    }
    const checked = request.schema.safeParse(value)
    return checked.success ? { ok: true as const, value: checked.data } : { ok: false as const, truncated }
  }

  return {
    missingConfig,
    async call(request, usage) {
      const problem = missingConfig(request.agent)
      if (problem) throw new LlmError('not_configured', problem)
      const model = env[modelVar[request.agent]]!.trim()

      const first = await once(request, model, request.maxTokens, usage)
      if (first.ok) return first.value
      // Cut off or invalid: one more try with twice the room.
      const second = await once(request, model, request.maxTokens * 2, usage)
      if (second.ok) return second.value
      throw new LlmError(
        'bad_reply',
        second.truncated ? 'The model ran out of room twice, so its answer was cut off.' : 'The model replied with invalid data twice.',
      )
    },
  }
}
