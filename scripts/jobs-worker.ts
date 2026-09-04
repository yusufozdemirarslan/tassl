// Local job worker: docs/tech/10-backend-spec.md §7 (trigger 3 of D-012), 04-repo-structure.md §1.
//   pnpm jobs:worker
// Polls every queue that has a registered handler with boss.work(); pg-boss settles each job from
// the handler's outcome (throw → retry or dead letter). Stops on SIGINT/SIGTERM. Handlers come from
// `handlers/register`; a queue without one is logged at warn and not polled.
import type { JobWithMetadata } from 'pg-boss'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { executeJob } from '@/server/jobs/drain'
import { hasHandler } from '@/server/jobs/handlers'
import { registerAllHandlers } from '@/server/jobs/handlers/register'
import { QUEUE_NAMES } from '@/server/jobs/queues'
import { rootLogger } from '@/server/logging/logger'

async function main(): Promise<void> {
  registerAllHandlers()
  const boss = await getBoss()
  let polling = 0
  for (const queue of QUEUE_NAMES) {
    if (!hasHandler(queue)) {
      rootLogger.warn(
        { event: 'worker_queue_skipped', queue },
        'no handler registered; not polling',
      )
      continue
    }
    await boss.work(queue, { includeMetadata: true, batchSize: 1 }, async (jobs) => {
      for (const job of jobs as JobWithMetadata[]) {
        const outcome = await executeJob(queue, job)
        if (!outcome.ok) throw new Error(outcome.message)
      }
    })
    polling += 1
  }
  rootLogger.info({ event: 'worker_started', queues: polling }, 'jobs worker polling')

  const shutdown = async (signal: string): Promise<void> => {
    rootLogger.info({ event: 'worker_stopping', signal }, 'jobs worker stopping')
    await stopBoss()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  rootLogger.error({ event: 'worker_failed', err: error }, 'jobs worker failed to start')
  process.exit(1)
})
