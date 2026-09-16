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

/**
 * What a drain has learned about how long a queue's jobs take, within this one drain (D-754).
 *
 * A drain lives inside one invocation and the deadline used to be checked before every *fetch*: a
 * batch fetched with four seconds left still ran every job in it, and a job started near the end of
 * the budget was killed by the platform mid-call. For a generation step that leaves a
 * `generation_runs` row saying `running` with no worker anywhere, which nothing clears for
 * `GENERATION_RUN_STALE_AFTER_MS` — fifteen minutes of a progress screen reporting a step that
 * died. Measured on production: five steps of 46, 76, 27, 96 and 21 seconds fitted inside a 240 s
 * budget with 26 seconds to spare, and the sixth was started in those 26 seconds.
 *
 * So a drain does not start a job it has no room to finish, and what "room" means is measured
 * rather than guessed: the longest job this drain has run on that queue. The first job of a queue
 * always runs — there is nothing to go on, and refusing it would mean a drain that never drains —
 * and every job after it is admitted only while the budget still holds the worst one seen. A queue
 * of instant jobs keeps its whole batch; a queue of model calls stops after the one that does not
 * fit and leaves the rest to the next drain, which arrives in a fresh invocation with a fresh
 * budget (D-683).
 */
class QueueTimings {
  private readonly worst = new Map<QueueName, number>()

  /** The room one job of this queue needs; zero until one has been run and timed. */
  needs(queue: QueueName): number {
    return this.worst.get(queue) ?? 0
  }

  record(queue: QueueName, durationMs: number): void {
    this.worst.set(queue, Math.max(this.needs(queue), durationMs))
  }
}

const BATCH_SIZE = 5

/**
 * The headroom a drain keeps over the longest job it has seen on a queue, before starting another.
 *
 * A job is not the same length twice — a generation step is a model call — so "the worst so far"
 * is a floor rather than a bound. Thirty seconds is the difference between a drain that stops one
 * job early and one that starts a job it cannot finish, and the second costs an author fifteen
 * minutes of a progress screen reporting a step that has died (`GENERATION_RUN_STALE_AFTER_MS`).
 */
const JOB_MARGIN_MS = 30_000

/**
 * How often a drain runs pg-boss's own maintenance, in ms.
 *
 * The queue's `expireInSeconds` is a policy, not a timer: something has to notice that a lease is
 * older than it, and on this platform nothing does. The boss is constructed with `supervise: false`
 * because there is no process to keep a supervisor in, so a job whose worker was killed mid-call
 * stays `active` — no other drain can fetch it — until the nightly sweep. That is how a generation
 * step held its lease for fifteen minutes and then failed outright instead of being retried the way
 * `retryLimit: 3` says it should be (D-684).
 *
 * `supervise()` is pg-boss's documented entry point for exactly this: an instance run with the
 * built-in supervisor disabled. It is throttled because the generation poll drains every few
 * seconds while a pipeline runs (D-683) and maintenance is a heavier query than a fetch; a minute
 * is well inside the 280 s lease, so a killed worker's job is back on the queue long before anything
 * would notice it gone.
 */
const SUPERVISE_EVERY_MS = 60_000
let lastSupervisedAt = 0

/**
 * Releases leases whose worker no longer exists, at most once a minute per process.
 *
 * Never throws: maintenance failing is a reason to log and drain anyway, not a reason to stop
 * processing jobs that are ready right now.
 */
async function superviseIfDue(boss: Awaited<ReturnType<typeof getBoss>>): Promise<void> {
  const now = Date.now()
  if (now - lastSupervisedAt < SUPERVISE_EVERY_MS) return
  lastSupervisedAt = now
  try {
    await boss.supervise()
  } catch (error) {
    rootLogger.warn(
      { event: 'drain_supervise_failed', err: error },
      'pg-boss maintenance failed; draining anyway',
    )
  }
}

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

/**
 * How many drains this process has open (D-754).
 *
 * A job that enqueues the next one kicks a drain of its own, and that drain begins with a whole
 * fresh budget — so a pipeline of seven model calls ran as seven nested drains inside one
 * invocation, each politely leaving itself 240 seconds of room that the platform had already spent.
 * Measured on production: steps of 61, 155 and 25 seconds ran back to back and the fourth was
 * started 244 seconds into a 300-second function and killed mid-call.
 *
 * The budget belongs to the invocation, and the drain that owns it is the outer one — which loops
 * until its queues are empty anyway, so the job it was about to kick a drain for is the very next
 * thing it fetches. `enqueue` reads this and does not kick.
 */
let openDrains = 0

/** True while this process is inside a drain; an enqueue made here does not start another. */
export const isDraining = (): boolean => openDrains > 0

export async function drainQueues({
  maxMs,
  trigger = 'manual',
}: {
  maxMs: number
  trigger?: DrainTrigger
}): Promise<DrainResult> {
  openDrains += 1
  try {
    return await runDrain(maxMs, trigger)
  } finally {
    openDrains -= 1
  }
}

async function runDrain(maxMs: number, trigger: DrainTrigger): Promise<DrainResult> {
  const startedAt = Date.now()
  const deadline = startedAt + maxMs
  const boss = await getBoss()
  // Before anything is fetched: a job still holding an expired lease is invisible to the fetch below.
  await superviseIfDue(boss)
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
  const timings = new QueueTimings()
  const remaining = (): number => deadline - Date.now()
  /**
   * Room for one more job of this queue: always true for the first, measured after that (D-754).
   *
   * The margin is for the job that runs longer than every one before it — on production a
   * sixty-one-second step was followed by a hundred-and-fifty-five-second one — and it is one
   * `GEN_TIMEOUT_MS` worth of nothing-else-to-do rather than a guess at how much longer.
   */
  const roomFor = (queue: QueueName): boolean => {
    const needs = timings.needs(queue)
    // Nothing measured yet: the first job of a queue runs whatever the budget, because a drain that
    // refuses the only job it has is not a drain. Every job after it is held to what that one cost.
    return needs === 0 ? remaining() > 0 : remaining() > needs + JOB_MARGIN_MS
  }
  // Each pass restarts from the top so higher-priority queues are always emptied first; the drain
  // ends when a whole pass fetched nothing or nothing left in the budget can be finished.
  let exhausted = active.length === 0
  while (!exhausted && remaining() > 0) {
    exhausted = true
    for (const queue of active) {
      if (!roomFor(queue)) continue
      let jobs: JobWithMetadata[]
      try {
        // Only as many jobs as the budget can run to the end. Fetching five and running two leaves
        // three holding a lease nobody is working, which is invisible to the next drain until the
        // lease expires and `supervise()` hands it back.
        const measured = timings.needs(queue)
        const each = measured === 0 ? 1 : measured + JOB_MARGIN_MS
        const batchSize = Math.max(1, Math.min(BATCH_SIZE, Math.floor(remaining() / each)))
        jobs = await boss.fetch(queue, { batchSize, includeMetadata: true })
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
        if (!roomFor(queue)) {
          // The batch was sized to fit, so this is the case where a job ran longer than every job
          // before it on this queue. What is left keeps its lease until `expireInSeconds`, and the
          // next `supervise()` returns it to the queue rather than to this invocation.
          rootLogger.warn(
            { event: 'drain_job_deferred', queue, jobId: job.id, remainingMs: remaining() },
            'no budget left for this job; leaving it to the next drain',
          )
          break
        }
        const jobStartedAt = Date.now()
        const outcome = await executeJob(queue, job)
        timings.record(queue, Date.now() - jobStartedAt)
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
