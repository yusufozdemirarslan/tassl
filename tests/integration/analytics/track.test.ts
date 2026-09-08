// The server transport: docs/tech/17-analytics-events.md §9.3.
// Two halves, and the first is the one that matters: **without a key nothing happens at all** — no
// client is constructed, no `after()` callback is registered, no socket is opened (D-098). Tassl
// must be fully usable with no analytics key, and this is where that is proved.
//
// It needs no database: posthog-node, `next/server`, the request context, and the config module are
// all faked at their boundaries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

type Captured = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
  groups?: Record<string, string>
}

const captured: Captured[] = []
const shutdowns: number[] = []
const afterCallbacks: Array<() => unknown> = []
const constructorOptions: Array<Record<string, unknown>> = []

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(
      public key: string,
      public options: Record<string, unknown>,
    ) {
      constructorOptions.push(options)
    }
    capture(payload: Captured) {
      captured.push(payload)
    }
    async shutdown(timeout: number) {
      shutdowns.push(timeout)
    }
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb)
  },
}))

// The real logger reads the whole validated environment at import; the faked config below carries
// only the two analytics keys, which is the point of the fake.
vi.mock('@/server/logging/logger', () => ({
  rootLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const requestStore = {
  requestId: '77777777-7777-4777-8777-777777777777',
  actor: { id: 'user_1', activeOrganizationId: 'org_1' },
  startedAt: 0,
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}
vi.mock('@/server/http/request-context', () => ({
  getRequestContext: () => requestStore,
  getLogger: () => requestStore.logger,
}))

async function load(key: string) {
  vi.resetModules()
  vi.doMock('@/server/config', () => ({
    env: {
      APP_ENV: 'test',
      NEXT_PUBLIC_POSTHOG_KEY: key,
      NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
    },
  }))
  const track = await import('@/server/analytics/track')
  const posthog = await import('@/server/analytics/posthog')
  const ops = await import('@/server/analytics/ops')
  return { track: track.track, shutdownPosthog: posthog.shutdownPosthog, ...ops }
}

const props = { method: 'password' } as const
const expectedDistinctId = createHash('sha256').update('user_1', 'utf8').digest('hex').slice(0, 16)

describe('track (server)', () => {
  beforeEach(() => {
    captured.length = 0
    shutdowns.length = 0
    afterCallbacks.length = 0
    constructorOptions.length = 0
  })
  afterEach(() => vi.doUnmock('@/server/config'))

  it('is a no-op without a key: no client, no after() hook, no event', async () => {
    const { track } = await load('')
    track('sign_up_completed', props, { userId: 'user_1', organizationId: 'org_1' })
    expect(captured).toHaveLength(0)
    expect(afterCallbacks).toHaveLength(0)
    expect(constructorOptions).toHaveLength(0)
  })

  it('enqueues with a key, hashes the user id, sets the group, and schedules shutdown', async () => {
    const { track } = await load('phc_test')
    track('sign_up_completed', props, { userId: 'user_1', organizationId: 'org_1' })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      distinctId: expectedDistinctId,
      event: 'sign_up_completed',
      properties: {
        method: 'password',
        app_env: 'test',
        organization_id: 'org_1',
        request_id: requestStore.requestId,
        source: 'server',
      },
      groups: { organization: 'org_1' },
    })
    expect(expectedDistinctId).toHaveLength(16)
    expect(captured[0]?.distinctId).not.toBe('user_1')
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]!()
    expect(shutdowns).toEqual([2000])
  })

  it('never sends the client IP to be geolocated', async () => {
    const { track } = await load('phc_test')
    track('sign_up_completed', props, { userId: 'user_1' })
    expect(constructorOptions[0]).toMatchObject({ disableGeoip: true })
  })

  it('uses the system distinct id and no person profile for actor-less events', async () => {
    const { track } = await load('phc_test')
    track('rate_limited', { bucket: 'auth', scope: 'ip' }, { userId: null })
    expect(captured[0]).toMatchObject({
      distinctId: 'system',
      properties: { $process_person_profile: false },
    })
    expect(captured[0]).not.toHaveProperty('groups')
  })

  it('throws on an invalid payload in the test environment', async () => {
    const { track } = await load('phc_test')
    expect(() =>
      track('sign_up_completed', { method: 'password', email: 'x@y.z' } as never, {
        userId: 'user_1',
      }),
    ).toThrow(/ANALYTICS_PROPS_INVALID/)
    expect(captured).toHaveLength(0)
  })

  it('reuses one client per request rather than opening one per event', async () => {
    const { track } = await load('phc_test')
    track('sign_up_completed', props, { userId: 'user_1' })
    track('sign_in_succeeded', { method: 'password' }, { userId: 'user_1' })
    expect(captured).toHaveLength(2)
    expect(constructorOptions).toHaveLength(1)
    expect(afterCallbacks).toHaveLength(1)
  })
})

describe('trackOps (the ops_* counters)', () => {
  beforeEach(() => {
    captured.length = 0
    constructorOptions.length = 0
    afterCallbacks.length = 0
  })
  afterEach(() => vi.doUnmock('@/server/config'))

  it('is a no-op without a key', async () => {
    const { trackOps } = await load('')
    trackOps('ops_drain_completed', { processed: 3, durationMs: 12 }, 'system')
    expect(captured).toHaveLength(0)
  })

  it('normalizes keys to snake_case and adds the environment', async () => {
    const { trackOps } = await load('phc_test')
    trackOps('ops_job_completed', { queue: 'send_email', durationMs: 12, attempt: 1 }, 'system')
    expect(captured[0]).toMatchObject({
      distinctId: 'system',
      event: 'ops_job_completed',
      properties: {
        queue: 'send_email',
        duration_ms: 12,
        attempt: 1,
        app_env: 'test',
        source: 'server',
        $process_person_profile: false,
      },
    })
  })

  it('drops a property whose name would carry a person or authored text', async () => {
    const { trackOps } = await load('phc_test')
    trackOps('ops_run_held', { run_id: 'r1', reason: 'read_failed', email: 'a@b.c' }, 'system')
    expect(captured[0]?.properties).not.toHaveProperty('email')
    expect(captured[0]?.properties).toMatchObject({ run_id: 'r1', reason: 'read_failed' })
  })

  it('drops a string too long to be an id or an enum rather than truncating it', async () => {
    const { safeOpsProperties } = await load('phc_test')
    const long = 'x'.repeat(201)
    expect(safeOpsProperties({ reason: long, queue: 'send_email' })).toEqual({
      queue: 'send_email',
    })
    expect(safeOpsProperties({ reason: 'x'.repeat(200) })).toEqual({ reason: 'x'.repeat(200) })
  })

  it('drops null and undefined instead of sending empty properties', async () => {
    const { safeOpsProperties } = await load('phc_test')
    expect(safeOpsProperties({ a: null, b: undefined, c: 0, d: false })).toEqual({ c: 0, d: false })
  })
})
