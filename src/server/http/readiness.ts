// Readiness report: docs/tech/13-observability-ops.md §4 and 10-backend-spec.md §13 (SYS-009).
// A server-lib module: the only layer src/app may reach the database through (04 §2).
// Check values are fixed strings, never driver messages. Both probes share the 2 s budget.
import { db, pingDb, sql } from '@/server/db/client'
import { rootLogger } from '@/server/logging/logger'

export type ReadinessReport = {
  status: 'ready' | 'not_ready'
  checks: { db: string; jobs: string }
}

const TIMEOUT_MS = 2000

const outcome = (e: unknown): string =>
  e instanceof Error && e.message === 'timeout' ? 'timeout' : 'error'

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** 'ok' when the pgboss schema exists (created by scripts/pgboss-migrate.ts), 'missing' otherwise. */
async function checkJobsSchema(): Promise<string> {
  try {
    const rows = await withTimeout(
      db.execute(sql`select 1 from information_schema.schemata where schema_name = 'pgboss'`),
      TIMEOUT_MS,
    )
    return rows.length > 0 ? 'ok' : 'missing'
  } catch (e) {
    return outcome(e)
  }
}

async function checkDb(): Promise<string> {
  try {
    await pingDb(TIMEOUT_MS)
    return 'ok'
  } catch (e) {
    return outcome(e)
  }
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const [dbCheck, jobs] = await Promise.all([checkDb(), checkJobsSchema()])
  const checks = { db: dbCheck, jobs }
  const status = checks.db === 'ok' && checks.jobs === 'ok' ? 'ready' : 'not_ready'
  if (status === 'not_ready') {
    rootLogger.warn({ event: 'readiness', ...checks }, 'readiness check failed')
  }
  return { status, checks }
}
