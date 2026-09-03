// Readiness report: docs/tech/13-observability-ops.md §4 (SYS-009).
// A server-lib module: the only layer src/app may reach the database through (04 §2).
// Check values are fixed strings, never driver messages.
import { pingDb } from '@/server/db/client'
import { rootLogger } from '@/server/logging/logger'

export type ReadinessReport = {
  status: 'ready' | 'not_ready'
  checks: { db: string; jobs: string }
}

const TIMEOUT_MS = 2000

const outcome = (e: unknown): string =>
  e instanceof Error && e.message === 'timeout' ? 'timeout' : 'error'

export async function checkReadiness(): Promise<ReadinessReport> {
  // jobs: the pgboss schema check arrives in Step 2.7; until then it is reported as skipped.
  const checks = { db: 'ok', jobs: 'skipped' }
  try {
    await pingDb(TIMEOUT_MS)
  } catch (e) {
    checks.db = outcome(e)
  }
  const status = checks.db === 'ok' ? 'ready' : 'not_ready'
  if (status === 'not_ready') {
    rootLogger.warn({ event: 'readiness', ...checks }, 'readiness check failed')
  }
  return { status, checks }
}
