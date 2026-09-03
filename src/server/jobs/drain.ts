// Drain: docs/tech/10-backend-spec.md §7 and 13-observability-ops.md §3 (`job` log line, ops events).
// Walks DRAIN_ORDER, fetching batches of 5 from the highest-priority non-empty queue, until one pass
// finds every queue empty or maxMs elapses. Queues without a registered handler are skipped (warn).
// Each job runs under its own job logger and request context: complete on success, fail on error.
import type { JobWithMetadata } from 'pg-boss'
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

export async function drainQueues({ maxMs }: { maxMs: number }): Promise<DrainResult> {
  const startedAt = Date.now()
  const deadline = startedAt + maxMs
  const boss = await getBoss()
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
  countOps('ops_drain_completed', { processed, failed, durationMs })
  return { processed, failed, skippedQueues, durationMs }
}

/** Daily maintenance (10 §7): one purge_deleted_accounts job per UTC day; the drain picks it up. */
export async function scheduleDailyMaintenance(): Promise<void> {
  await enqueue(
    'purge_deleted_accounts',
    {},
    { singletonKey: `purge:${utcDateKey()}`, drain: false },
  )
}
