// @vitest-environment node
// Step 13.1: `alertOps` raises a Sentry message tagged `ops:<name>` with a stable fingerprint when
// the DSN is set, and does nothing at all when it is empty (D-098). The second half is the one that
// matters most: Tassl must be fully usable with no observability key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Scope = {
  setTag: (key: string, value: string) => void
  setFingerprint: (parts: string[]) => void
  setLevel: (level: string) => void
}

type Capture = {
  message: string
  level: string
  tags: Record<string, string>
  fingerprint: string[]
}

const captured: Capture[] = []
const opsCaptures: Array<{ event: string; props: Record<string, unknown>; distinctId: string }> = []
const logs: Array<{ level: string; fields: Record<string, unknown> }> = []
let pending: { tags: Record<string, string>; fingerprint: string[]; level: string } | null = null

// The SDK, faked at the boundary `alertOps` actually uses. `enabled: false` is what makes the real
// SDK a no-op, so the fake reads the DSN the same way the real `Sentry.init` does.
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: Scope) => unknown) => {
    const state = {
      tags: {} as Record<string, string>,
      fingerprint: [] as string[],
      level: 'error',
    }
    const scope: Scope = {
      setTag: (key, value) => {
        state.tags[key] = value
      },
      setFingerprint: (parts) => {
        state.fingerprint = parts
      },
      setLevel: (value) => {
        state.level = value
      },
    }
    pending = state
    const result = fn(scope)
    pending = null
    return result
  },
  captureMessage: (message: string, level: string) => {
    if ((process.env.NEXT_PUBLIC_SENTRY_DSN ?? '') === '') return '' // enabled: false
    captured.push({
      message,
      level,
      tags: pending?.tags ?? {},
      fingerprint: pending?.fingerprint ?? [],
    })
    return 'event-id'
  },
}))

vi.mock('@/server/analytics/ops', () => ({
  trackOps: (event: string, props: Record<string, unknown>, distinctId: string) => {
    opsCaptures.push({ event, props, distinctId })
  },
}))

vi.mock('@/server/http/request-context', () => ({
  getLogger: () => ({
    warn: (fields: Record<string, unknown>) => logs.push({ level: 'warn', fields }),
    info: (fields: Record<string, unknown>) => logs.push({ level: 'info', fields }),
  }),
}))

async function loadOps(dsn: string) {
  process.env.NEXT_PUBLIC_SENTRY_DSN = dsn
  vi.resetModules()
  return import('@/server/logging/ops-events')
}

describe('alertOps', () => {
  beforeEach(() => {
    captured.length = 0
    opsCaptures.length = 0
    logs.length = 0
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
  })

  it('captures a Sentry message with the ops tag and fingerprint when the DSN is set', async () => {
    const { alertOps } = await loadOps('https://public@o1.ingest.sentry.io/2')
    alertOps('run_held', { run_id: 'run-1', reason: 'read_failed' })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      message: 'ops.run_held',
      level: 'warning',
      fingerprint: ['ops', 'run_held'],
    })
    expect(captured[0]?.tags).toMatchObject({
      ops: 'run_held',
      run_id: 'run-1',
      reason: 'read_failed',
    })
    expect(logs[0]).toMatchObject({ level: 'warn', fields: { event: 'ops.run_held' } })
  })

  it('sends nothing to Sentry when the DSN is empty, and still writes the log line', async () => {
    const { alertOps } = await loadOps('')
    alertOps('readiness_failed', { db: 'timeout', jobs: 'skipped' })

    expect(captured).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ level: 'warn', fields: { event: 'ops.readiness_failed' } })
  })

  it('never lets an oversized attribute become a Sentry tag verbatim', async () => {
    const { alertOps } = await loadOps('https://public@o1.ingest.sentry.io/2')
    alertOps('llm_error', { note: 'x'.repeat(500) })

    expect(captured[0]?.tags.note).toHaveLength(200)
  })
})

describe('countOps', () => {
  beforeEach(() => {
    captured.length = 0
    opsCaptures.length = 0
    logs.length = 0
  })

  it('never alerts; it logs and hands the counter to the PostHog transport', async () => {
    const { countOps } = await loadOps('https://public@o1.ingest.sentry.io/2')
    countOps('ops_job_completed', { queue: 'send_email', durationMs: 12 }, 'system')

    expect(captured).toHaveLength(0)
    expect(logs[0]).toMatchObject({ level: 'info', fields: { event: 'ops_job_completed' } })
    expect(opsCaptures).toEqual([
      {
        event: 'ops_job_completed',
        props: { queue: 'send_email', durationMs: 12 },
        distinctId: 'system',
      },
    ])
  })
})
