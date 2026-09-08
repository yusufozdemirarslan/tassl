// @vitest-environment node
// `sanitize_properties` (17 §5.6, §9.4). Two of Tassl's own links carry a credential in the query
// string — `/verify-email?token=…` and `/reset-password?token=…` — and posthog-js attaches the page
// URL to `$pageview`, `$referrer`, and the `$set_once` initial-URL properties without being asked.
// This is the strip that stops the token at the browser.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeProperties, stripQueryAndHash } from '@/lib/analytics/sanitize'
import { toRouteTemplate } from '@/lib/analytics/route-template'

const calls: string[] = []
vi.mock('posthog-js', () => ({
  default: {
    capture: (...args: unknown[]) => calls.push(`capture:${String(args[0])}`),
    identify: () => calls.push('identify'),
    group: () => calls.push('group'),
    register: () => calls.push('register'),
    unregister: () => calls.push('unregister'),
    reset: () => calls.push('reset'),
    get_distinct_id: () => 'anonymous',
  },
}))

async function loadClient(key: string) {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = key
  vi.resetModules()
  return import('@/lib/analytics/client')
}

describe('stripQueryAndHash', () => {
  it('cuts everything from the first ? or #', () => {
    expect(stripQueryAndHash('https://app/verify-email?token=abc#x')).toBe(
      'https://app/verify-email',
    )
    expect(stripQueryAndHash('https://app/runs/1/work')).toBe('https://app/runs/1/work')
  })

  it('leaves anything that is not an http(s) URL alone', () => {
    expect(stripQueryAndHash('run?id')).toBe('run?id')
    expect(stripQueryAndHash(42)).toBe(42)
    expect(stripQueryAndHash(null)).toBe(null)
  })
})

describe('sanitizeProperties', () => {
  it('strips the token from a URL property, including inside a nested $set_once', () => {
    const props = sanitizeProperties({
      $current_url: 'https://app/verify-email?token=abc#x',
      $set_once: { $initial_current_url: 'https://app/reset-password?token=zzz' },
      run_id: '11111111-1111-4111-8111-111111111111',
      count: 3,
    })

    expect(props.$current_url).toBe('https://app/verify-email')
    expect((props.$set_once as Record<string, unknown>).$initial_current_url).toBe(
      'https://app/reset-password',
    )
    expect(props.run_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(props.count).toBe(3)
  })
})

describe('toRouteTemplate', () => {
  it('replaces dynamic segments with their param name', () => {
    expect(toRouteTemplate('/runs/abc-123/work', { runId: 'abc-123' })).toBe('/runs/[runId]/work')
    expect(toRouteTemplate('/home', {})).toBe('/home')
  })

  it('answers / rather than half a concrete path when the result is not a template', () => {
    expect(toRouteTemplate('/packages/new?draft=1', {})).toBe('/')
  })
})

// The browser half of D-098. With no key the SDK is never initialized and nothing in the product
// can make it speak: every helper returns before it touches `posthog`, so the page opens no
// connection to `/ingest/` at all. That is the state CI, every local machine, and every environment
// without a key runs in, and it must be the quiet one.
describe('the client transport without a key', () => {
  afterEach(() => {
    calls.length = 0
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  })

  it('reports itself disabled and never even fetches the SDK', async () => {
    const { analyticsEnabled, trackClient, identifyClient, registerEnvironment, resetClient } =
      await loadClient('')

    expect(analyticsEnabled).toBe(false)
    await trackClient('error_shown', { code: 'INTERNAL_ERROR', status: 500, route: '/home' })
    await identifyClient('0123456789abcdef', 'org_1')
    await registerEnvironment('test')
    await resetClient()

    expect(calls).toEqual([])
  })

  it('captures, identifies, and groups once a key is present', async () => {
    const { analyticsEnabled, trackClient, identifyClient } = await loadClient('phc_test')

    expect(analyticsEnabled).toBe(true)
    await trackClient('error_shown', { code: 'INTERNAL_ERROR', status: 500, route: '/home' })
    await identifyClient('0123456789abcdef', 'org_1')

    expect(calls).toEqual(['capture:error_shown', 'identify', 'group', 'register'])
  })

  it('rejects on an invalid payload in development rather than sending it', async () => {
    const { trackClient } = await loadClient('phc_test')
    await expect(
      trackClient('error_shown', { code: 'lower case', status: null, route: '/home' }),
    ).rejects.toThrow(/ANALYTICS_PROPS_INVALID/)
    expect(calls).toEqual([])
  })
})
