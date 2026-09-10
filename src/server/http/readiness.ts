// Readiness report: docs/tech/13-observability-ops.md §4 and 10-backend-spec.md §13 (SYS-009).
// A server-lib module: the only layer src/app may reach the database through (04 §2).
// Check values are fixed strings, never driver messages. Both probes share the 2 s budget.
//
// `assistantMode` (D-691) is on the report because it is the one runtime fact an operator checks
// before a demo and after throwing the kill switch, and `/api/ready` is the address every warm-up
// and smoke script already reads. It never decides readiness: a deployment on the scripted
// assistant is whole (D-029). It is read through the admin module's public index, which is the door
// the `boundaries` policy gives a server-lib module into `src/server/llm`.
import { db, pingDb, sql } from '@/server/db/client'
import { rootLogger } from '@/server/logging/logger'
import { effectiveAssistantMode, type AssistantMode } from '@/server/modules/admin'

export type ReadinessReport = {
  status: 'ready' | 'not_ready'
  checks: { db: string; jobs: string }
  assistantMode: AssistantMode
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
  const [dbCheck, jobs, assistantMode] = await Promise.all([
    checkDb(),
    checkJobsSchema(),
    // Never throws: a failed read answers `live` inside `readAiMode`, and with `FEATURE_AI=false`
    // the answer is `scripted` without touching the database at all.
    effectiveAssistantMode(),
  ])
  const checks = { db: dbCheck, jobs }
  const status = checks.db === 'ok' && checks.jobs === 'ok' ? 'ready' : 'not_ready'
  if (status === 'not_ready') {
    rootLogger.warn({ event: 'readiness', ...checks }, 'readiness check failed')
  }
  return { status, checks, assistantMode }
}
