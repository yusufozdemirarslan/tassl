// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module parses process.env at import time, so every case re-imports it.
async function load() {
  vi.resetModules()
  return import('@/server/config')
}

const PRODUCTION_VALUES = {
  APP_ENV: 'production',
  BETTER_AUTH_SECRET: 'a-real-secret-of-at-least-thirty-two-characters',
  CRON_SECRET: 'a-real-cron-secret',
  DATABASE_URL: 'postgres://u:p@db.example/tassl',
  DATABASE_URL_UNPOOLED: 'postgres://u:p@db.example/tassl',
  NEXT_PUBLIC_APP_URL: 'https://tassl.example',
}

describe('server config (docs/tech/05-environment-config.md §3)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('loads local defaults and forces the mock provider while FEATURE_AI is false', async () => {
    vi.stubEnv('APP_ENV', 'local')
    vi.stubEnv('FEATURE_AI', 'false')
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    const m = await load()
    expect(m.env.APP_ENV).toBe('local')
    expect(m.env.FEATURE_AI).toBe(false)
    expect(m.effectiveLlmProvider()).toBe('mock')
  })

  it('uses the configured provider when FEATURE_AI is true', async () => {
    vi.stubEnv('FEATURE_AI', 'true')
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    const m = await load()
    expect(m.effectiveLlmProvider()).toBe('anthropic')
  })

  it('refuses production with the local defaults', async () => {
    vi.stubEnv('APP_ENV', 'production')
    await expect(load()).rejects.toThrow('INVALID_SERVER_ENV')
    expect(console.error).toHaveBeenCalledWith(
      'Invalid server environment:',
      expect.stringContaining('BETTER_AUTH_SECRET must be set outside local/test'),
    )
  })

  it('refuses preview without an unpooled database url', async () => {
    for (const [k, v] of Object.entries({ ...PRODUCTION_VALUES, APP_ENV: 'preview' }))
      vi.stubEnv(k, v)
    vi.stubEnv('DATABASE_URL_UNPOOLED', '')
    await expect(load()).rejects.toThrow('INVALID_SERVER_ENV')
  })

  it('refuses production openai-compatible without an API key', async () => {
    for (const [k, v] of Object.entries(PRODUCTION_VALUES)) vi.stubEnv(k, v)
    vi.stubEnv('LLM_PROVIDER', 'openai-compatible')
    vi.stubEnv('LLM_API_KEY', '')
    await expect(load()).rejects.toThrow('INVALID_SERVER_ENV')
  })

  it('accepts production with real values', async () => {
    for (const [k, v] of Object.entries(PRODUCTION_VALUES)) vi.stubEnv(k, v)
    const m = await load()
    expect(m.env.APP_ENV).toBe('production')
    expect(m.env.NEXT_PUBLIC_APP_URL).toBe('https://tassl.example')
  })

  it('coerces numbers and booleans', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '1234')
    vi.stubEnv('NOTIFY_EMAIL_COPIES', 'false')
    const m = await load()
    expect(m.env.LLM_TIMEOUT_MS).toBe(1234)
    expect(m.env.NOTIFY_EMAIL_COPIES).toBe(false)
  })
})
