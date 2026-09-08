// Drain: docs/tech/10-backend-spec.md §7 and 13-observability-ops.md §3 (`job` log line, ops events).
// Walks DRAIN_ORDER, fetching batches of 5 from the highest-priority non-empty queue, until one pass
// finds every queue empty or maxMs elapses. Queues without a registered handler are skipped (warn).
// Each job runs under its own job logger and request context: complete on success, fail on error.
import * as Sentry from '@sentry/nextjs'
import type { JobWithMetadata } from 'pg-boss'
import { db, sql } from '@/server/db/client'
import { runWithContext } from '@/server/http/request-context'
import { getBoss } from '@/server/jobs/boss'
import { enqueue } from '@/server/jobs/enqueue'
import { getHandler } from '@/server/jobs/handlers'
import { DRAIN_ORDER, utcDateKey, type QueueName } from '@/server/jobs/queues'
import { createJobLogger, rootLogger, scrubSecrets } from '@/server/logging/logger'
import { alertOps, countOps } from '@/server/logging/ops-events'

export type DrainResult = {
  processed: number
  failed: number
  skippedQueues: string[]
  durationMs: number
}

/** Who asked for this drain (13 §2.6): the `after()` kick, Vercel Cron, an operator, the worker. */
export type DrainTrigger = 'after' | 'cron' | 'manual' | 'worker'

export type JobOutcome = { ok: true } | { ok: false; message: string }

const BATCH_SIZE = 5

const errorMessage = (error: unknown): string =>
  scrubSecrets(error instanceof Error ? error.message : String(error))

/**
 * Runs one fetched job through its handler inside a job context and writes the `job` log line.
 * Does not settle the job: the drain calls complete/fail, the local worker lets pg-boss settle.
 */
export async function executeJob(queue: QueueName, job: JobWithMetadata): Promise<JobOutcome> {
  const handler = getHandler(queue)
  const logger = createJobLogger({ jobId: job.id, queue })
  const startedAt = Date.now()
  const attempt = job.retryCount + 1
  return runWithContext({ requestId: job.id, actor: null, logger, startedAt }, async () => {
    if (!handler) return { ok: false, message: `no handler registered for ${queue}` }
    try {
      await handler(job.data as never, { jobId: job.id, logger })
      const durationMs = Date.now() - startedAt
      logger.info({ event: 'job', outcome: 'completed', attempt, durationMs }, 'job completed')
      countOps('ops_job_completed', { queue, attempt, durationMs })
      return { ok: true }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = errorMessage(error)
      const deadLettered = job.retryCount >= job.retryLimit
      logger.error(
        {
          event: 'job',
          outcome: deadLettered ? 'dead_lettered' : 'failed',
          attempt,
          durationMs,
          message,
        },
        'job failed',
      )
      countOps('ops_job_failed', { queue, attempt, durationMs })
      if (deadLettered) {
        countOps('ops_job_dead_lettered', { queue })
        alertOps('job_dead_lettered', { queue, jobId: job.id, attempt })
      }
      return { ok: false, message }
    }
  })
}

/**
 * Runs before every drain (13 §5): a run whose defense finished more than eight minutes ago and is
 * still queued or running has missed NFR-001's end-to-end bound, whatever any single attempt did.
 * A read-only probe, so a failure here is logged and never stops the drain.
 */
async function alertOverdueScoring(): Promise<void> {
  try {
    const rows = await db.execute<{ id: string; age_ms: number }>(sql`
      select id, (extract(epoch from (now() - defense_completed_at)) * 1000)::bigint as age_ms
      from runs
      where scoring_status in ('queued', 'running')
        and defense_completed_at < now() - interval '8 minutes'`)
    for (const row of rows)
      alertOps('scoring_overdue', { run_id: row.id, age_ms: Number(row.age_ms) })
  } catch (error) {
    rootLogger.warn(
      { event: 'drain_overdue_check_failed', err: error },
      'overdue scoring check failed',
    )
  }
}

/**
 * Runs after every drain (13 §5, §6.4): one `ops_queue_depth` event per queue that has anything in
 * it. pg-boss 12 keeps every queue in the partitioned table `pgboss.job`; the dead-letter queues are
 * ordinary queues named `<queue>_dead`, so their `created` count is the dead-letter depth.
 */
async function countQueueDepth(): Promise<void> {
  try {
    const rows = await db.execute<{ name: string; state: string; n: number }>(sql`
      select name, state, count(*)::int as n
      from pgboss.job
      where state in ('created', 'retry', 'active', 'failed')
      group by name, state`)
    type Depth = { created: number; retry: number; active: number; failed: number; dead: number }
    const depths = new Map<string, Depth>()
    for (const row of rows) {
      const dead = row.name.endsWith('_dead')
      const queue = dead ? row.name.slice(0, -'_dead'.length) : row.name
      const bucket: Depth = depths.get(queue) ?? {
        created: 0,
        retry: 0,
        active: 0,
        failed: 0,
        dead: 0,
      }
      const n = Number(row.n)
      if (dead) bucket.dead += n
      else if (row.state === 'created') bucket.created = n
      else if (row.state === 'retry') bucket.retry = n
      else if (row.state === 'active') bucket.active = n
      else if (row.state === 'failed') bucket.failed = n
      depths.set(queue, bucket)
    }
    for (const [queue, bucket] of depths) countOps('ops_queue_depth', { queue, ...bucket })
  } catch (error) {
    rootLogger.warn({ event: 'drain_depth_check_failed', err: error }, 'queue depth check failed')
  }
}

export async function drainQueues({
  maxMs,
  trigger = 'manual',
}: {
  maxMs: number
  trigger?: DrainTrigger
}): Promise<DrainResult> {
  const startedAt = Date.now()
  const deadline = startedAt + maxMs
  const boss = await getBoss()
  await alertOverdueScoring()
  const skippedQueues: string[] = []
  const active: QueueName[] = []
  for (const queue of DRAIN_ORDER) {
    if (getHandler(queue)) active.push(queue)
    else {
      skippedQueues.push(queue)
      rootLogger.warn(
        { event: 'drain_queue_skipped', queue },
        'no handler registered; queue skipped',
      )
    }
  }

  let processed = 0
  let failed = 0
  // Each pass restarts from the top so higher-priority queues are always emptied first; the drain
  // ends when a whole pass fetched nothing or the deadline passed (checked before every fetch).
  let exhausted = active.length === 0
  while (!exhausted && Date.now() < deadline) {
    exhausted = true
    for (const queue of active) {
      if (Date.now() >= deadline) break
      let jobs: JobWithMetadata[]
      try {
        jobs = await boss.fetch(queue, { batchSize: BATCH_SIZE, includeMetadata: true })
      } catch (error) {
        rootLogger.error(
          { event: 'drain_fetch_failed', queue, err: error },
          'fetch failed; drain stopped',
        )
        exhausted = true
        break
      }
      if (jobs.length === 0) continue
      exhausted = false
      for (const job of jobs) {
        const outcome = await executeJob(queue, job)
        try {
          if (outcome.ok) {
            await boss.complete(queue, job.id)
            processed += 1
          } else {
            await boss.fail(queue, job.id, { message: outcome.message })
            failed += 1
          }
        } catch (error) {
          failed += 1
          rootLogger.error(
            { event: 'drain_settle_failed', queue, jobId: job.id, err: error },
            'could not settle job; pg-boss expires it',
          )
        }
      }
      break // back to the highest-priority queue
    }
  }

  const durationMs = Date.now() - startedAt
  await countQueueDepth()
  rootLogger.info({ event: 'drain', trigger, processed, durationMs }, 'drain completed')
  countOps('ops_drain_completed', { trigger, processed, failed, durationMs })
  return { processed, failed, skippedQueues, durationMs }
}

/**
 * The daily sweep (13 §7): the same drain, wrapped in the Sentry cron monitor `jobs-drain-daily`,
 * which the check-in creates on first use with the schedule below. A missed or failed check-in is
 * the alert that the queue stopped being swept. `after()` kicks call `drainQueues` directly and
 * never check in. Without a DSN `withMonitor` simply runs the callback (D-098).
 */
export async function drainDaily(maxMs: number): Promise<DrainResult> {
  return Sentry.withMonitor('jobs-drain-daily', () => drainQueues({ maxMs, trigger: 'cron' }), {
    schedule: { type: 'crontab', value: '0 4 * * *' },
    checkinMargin: 30,
    maxRuntime: 10,
    timezone: 'UTC',
  })
}

/** Daily maintenance (10 §7): one purge_deleted_accounts job per UTC day; the drain picks it up. */
export async function scheduleDailyMaintenance(): Promise<void> {
  await enqueue(
    'purge_deleted_accounts',
    {},
    { singletonKey: `purge:${utcDateKey()}`, drain: false },
  )
}
