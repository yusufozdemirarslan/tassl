// Enqueue: docs/tech/10-backend-spec.md §6–§7 and DECISIONS.md D-012.
// Sends through pg-boss with the queue's singleton key, then kicks a drain when
// JOBS_DRAIN_ON_ENQUEUE is true: `after()` from next/server inside a request (the drain runs in the
// same invocation once the response is sent), inline for scripts and tests.
import { after } from 'next/server'
import type { SendOptions } from 'pg-boss'
import { env } from '@/server/config'
import { getLogger, getRequestContext } from '@/server/http/request-context'
import { onCommit } from '@/server/jobs/after-commit'
import { getBoss } from '@/server/jobs/boss'
import { singletonKeyFor, type Payload, type QueueName } from '@/server/jobs/queues'

export type EnqueueOptions = {
  /** Overrides the queue's default singleton key (10 §7 table). */
  singletonKey?: string
  /** Seconds to hold the job before it becomes fetchable. */
  startAfter?: number
  /** `false` skips the drain kick (tests, and callers that drain themselves). Default `true`. */
  drain?: boolean
}

const REQUEST_DRAIN_MS = 240_000
const INLINE_DRAIN_MS = 30_000

async function drainSafely(maxMs: number): Promise<void> {
  try {
    // Both loaded lazily: drain.ts imports enqueue() for scheduleDailyMaintenance(), so a static
    // import here would make the two modules a cycle. The registry has to come first — a queue with
    // no handler is skipped, and without this the web process would enqueue an email and never send
    // it until the nightly cron hit the drain route (D-181).
    const [{ registerAllHandlers }, { drainQueues }] = await Promise.all([
      import('@/server/jobs/handlers/register'),
      import('@/server/jobs/drain'),
    ])
    registerAllHandlers()
    await drainQueues({ maxMs })
  } catch (error) {
    getLogger().error({ event: 'drain_failed', err: error }, 'drain after enqueue failed')
  }
}

/** Inside a request: after(); when Next's request scope is absent (tests, scripts): inline. */
async function kickDrain(): Promise<void> {
  if (getRequestContext()) {
    try {
      after(() => drainSafely(REQUEST_DRAIN_MS))
      return
    } catch {
      // `after` throws outside a Next.js request scope (routes invoked directly in tests).
    }
  }
  await drainSafely(INLINE_DRAIN_MS)
}

/** Sends one job; resolves with the pg-boss job id, or null when the singleton key deduplicated it. */
export async function enqueue<Q extends QueueName>(
  queue: Q,
  payload: Payload<Q>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const singletonKey = options.singletonKey ?? singletonKeyFor[queue](payload)
  const sendOptions: SendOptions = {
    ...(singletonKey !== undefined ? { singletonKey } : {}),
    ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
  }
  const boss = await getBoss()
  const jobId = await boss.send(queue, payload, sendOptions)
  getLogger().info(
    {
      event: 'job_enqueued',
      queue,
      jobId,
      deduplicated: jobId === null,
      payloadKeys: Object.keys(payload),
      ...(singletonKey !== undefined ? { singletonKey } : {}),
    },
    'job enqueued',
  )
  if (env.JOBS_DRAIN_ON_ENQUEUE && options.drain !== false) await kickDrain()
  return jobId
}

/**
 * Enqueues once `tx` commits (10 §6) when the transaction is tracked by withTransaction; otherwise
 * enqueues immediately. The deferred enqueue's failure is logged by runAfterCommit, never thrown.
 */
export async function enqueueAfterCommit<Q extends QueueName>(
  tx: object,
  queue: Q,
  payload: Payload<Q>,
  options: EnqueueOptions = {},
): Promise<void> {
  const deferred = onCommit(tx, async () => {
    await enqueue(queue, payload, options)
  })
  if (!deferred) await enqueue(queue, payload, options)
}
