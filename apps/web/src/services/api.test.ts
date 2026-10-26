import { describe, expect, it, vi } from 'vitest'
import { ApiError, SystemStatusSchema, api, describeAi, getJson } from './api'
import type { AiStatus } from './api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OFF: AiStatus = { provider: 'off', state: 'disabled', deployment: null, calls_used: 0, calls_cap: 200 }
const VALID_STATUS = { ai: OFF, synthetic: true, version: '0.1.0' }

describe('api client', () => {
  it('parses a valid /api/system/status payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_STATUS))
    const status = await api.systemStatus({ fetchImpl })
    expect(status.ai.provider).toBe('off')
    expect(fetchImpl).toHaveBeenCalledWith('/api/system/status', expect.anything())
  })

  it('accepts /healthz with extra fields', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', uptime_s: 3 }))
    await expect(api.health({ fetchImpl })).resolves.toMatchObject({ status: 'ok' })
  })

  it('rejects a malformed system status payload with invalid_payload', async () => {
    const malformed = {
      ai: { provider: 'openai', state: 'ready', deployment: 42, calls_used: -1 },
      synthetic: false,
    }
    const fetchImpl = vi.fn(async () => jsonResponse(malformed))
    const err = await api.systemStatus({ fetchImpl }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('invalid_payload')
    expect(SystemStatusSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects an unhealthy /healthz payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'down' }))
    await expect(api.health({ fetchImpl })).rejects.toMatchObject({ kind: 'invalid_payload' })
  })

  it('rejects non-JSON bodies without leaking raw text', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>proxy error</html>', { status: 200 }))
    const err = await api.health({ fetchImpl }).catch((e: unknown) => e)
    expect((err as ApiError).kind).toBe('invalid_payload')
    expect((err as ApiError).message).not.toContain('<html>')
  })

  it('maps network failure and HTTP errors to coarse kinds', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(getJson('/healthz', SystemStatusSchema, { fetchImpl: offline })).rejects.toMatchObject({
      kind: 'network',
    })
    const http500 = vi.fn(async () => jsonResponse({ detail: 'boom' }, 500))
    await expect(api.health({ fetchImpl: http500 })).rejects.toMatchObject({ kind: 'http', status: 500 })
  })

  it('describes AI state for the header chip', () => {
    expect(describeAi(null).text).toBe('AI: checking')
    expect(describeAi(OFF).text).toBe('AI: off')
    expect(describeAi({ ...OFF, provider: 'foundry', state: 'ready', deployment: 'x' }).text).toBe(
      'AI: Foundry ready',
    )
    expect(describeAi({ ...OFF, provider: 'foundry', state: 'degraded' }).tone).toBe('warn')
  })
})
