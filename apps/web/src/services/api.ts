import { z } from 'zod'

/**
 * Tiny typed fetch client. Every payload is validated with zod before the UI
 * sees it; failures surface as ApiError with a coarse `kind`, never raw text.
 */

export const HealthSchema = z.looseObject({
  status: z.literal('ok'),
})
export type Health = z.infer<typeof HealthSchema>

export const AiProviderSchema = z.enum(['foundry', 'mock_for_tests', 'off'])
export const AiStateSchema = z.enum(['configured', 'ready', 'degraded', 'disabled', 'recorded'])

export const SystemStatusSchema = z.object({
  ai: z.looseObject({
    provider: AiProviderSchema,
    state: AiStateSchema,
    deployment: z.string().nullable(),
    calls_used: z.number().int().nonnegative(),
    calls_cap: z.number().int().nonnegative(),
    /** Serving recorded real Foundry runs only; never makes model calls. */
    cache_only: z.boolean().optional(),
  }),
  synthetic: z.literal(true),
  version: z.string(),
})
export type SystemStatus = z.infer<typeof SystemStatusSchema>
export type AiStatus = SystemStatus['ai']

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'invalid_payload'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  { signal, timeoutMs = 5000, fetchImpl = fetch }: RequestOptions = {},
): Promise<z.infer<S>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })

  let response: Response
  try {
    response = await fetchImpl(path, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch {
    const timedOut = controller.signal.reason === 'timeout'
    throw new ApiError(timedOut ? 'timeout' : 'network', `Request to ${path} failed`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new ApiError('http', `Request to ${path} returned ${response.status}`, response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('invalid_payload', `Response from ${path} was not JSON`)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('invalid_payload', `Response from ${path} did not match the expected shape`)
  }
  return parsed.data
}

export const api = {
  health: (options?: RequestOptions) => getJson('/healthz', HealthSchema, options),
  systemStatus: (options?: RequestOptions) => getJson('/api/system/status', SystemStatusSchema, options),
}

/** Short human label for the AI provider chip, e.g. "AI: Foundry ready". */
export function describeAi(ai: AiStatus | null): { text: string; tone: 'live' | 'neutral' | 'warn' } {
  if (!ai) return { text: 'AI: checking', tone: 'neutral' }
  if (ai.provider === 'off' || ai.state === 'disabled') return { text: 'AI: off', tone: 'neutral' }
  const provider = ai.provider === 'foundry' ? 'Foundry' : 'test mock'
  switch (ai.state) {
    case 'ready':
      return { text: `AI: ${provider} ready`, tone: 'live' }
    case 'configured':
      return { text: `AI: ${provider} configured`, tone: 'neutral' }
    case 'degraded':
      return { text: `AI: ${provider} degraded`, tone: 'warn' }
    case 'recorded':
      return { text: `AI: ${provider} · recorded runs`, tone: 'neutral' }
  }
}
