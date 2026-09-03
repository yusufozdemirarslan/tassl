// Job retry runbook tool: docs/tech/13-observability-ops.md §8.6.
// pnpm jobs:retry <jobId>                re-enqueue one job by id (any state, any queue, including *_dead)
// pnpm jobs:retry --dead-letter <queue>  re-enqueue every job waiting in <queue>_dead, then delete the dead copy
// pnpm jobs:retry --expire-stuck         fail active jobs older than 10 minutes so pg-boss retries or dead-letters them
// Re-enqueues through the pg-boss API rather than editing pgboss.* rows by hand. Run with production
// values in the shell (the env pull in §8); the next drain or the local worker processes the result.
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { client, db } from '@/server/db/client'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { alertOps } from '@/server/logging/ops-events'

type JobRow = {
  id: string
  name: string
  data: Record<string, unknown>
  state: string
  singleton_key: string | null
  started_on: string | null
}
const STUCK_AFTER_MS = 10 * 60_000
const DEAD_SUFFIX = '_dead'

const selectJobs = (where: ReturnType<typeof sql>) =>
  db.execute<JobRow>(
    sql`select id, name, data, state, singleton_key, started_on from pgboss.job where ${where}`,
  )

async function resend(boss: Awaited<ReturnType<typeof getBoss>>, job: JobRow): Promise<void> {
  const isDead = job.name.endsWith(DEAD_SUFFIX)
  const queue = isDead ? job.name.slice(0, -DEAD_SUFFIX.length) : job.name
  const newId = await boss.send(
    queue,
    job.data,
    job.singleton_key ? { singletonKey: job.singleton_key } : {},
  )
  console.log(
    `${job.name}/${job.id} -> ${queue}/${newId ?? 'deduplicated (an identical job is already queued)'}`,
  )
  if (isDead) await boss.deleteJob(job.name, job.id)
}

async function main(): Promise<void> {
  const [mode, arg] = process.argv.slice(2)
  const boss = await getBoss()
  try {
    if (mode === '--dead-letter' && arg) {
      const rows = await selectJobs(sql`name = ${`${arg}${DEAD_SUFFIX}`} and state = 'created'`)
      for (const job of rows) await resend(boss, job)
      console.log(`${rows.length} job(s) re-enqueued from ${arg}${DEAD_SUFFIX}`)
    } else if (mode === '--expire-stuck') {
      const rows = await selectJobs(
        sql`state = 'active' and started_on < now() - interval '10 minutes'`,
      )
      for (const job of rows) {
        await boss.fail(job.name, job.id, { reason: 'expired_by_runbook' })
        alertOps('job_expired', {
          queue: job.name,
          job_id: job.id,
          age_ms: Date.now() - new Date(job.started_on ?? Date.now()).getTime(),
        })
      }
      console.log(
        `${rows.length} stuck job(s) failed; pg-boss retries or dead-letters them on the next drain (stuck after ${STUCK_AFTER_MS} ms)`,
      )
    } else if (mode && !mode.startsWith('--')) {
      const rows = await selectJobs(sql`id = ${mode}::uuid`)
      const job = rows[0]
      if (!job) throw new Error(`job ${mode} not found`)
      await resend(boss, job)
    } else {
      console.error('usage: pnpm jobs:retry <jobId> | --dead-letter <queue> | --expire-stuck')
      process.exitCode = 2
    }
  } finally {
    await stopBoss()
    await client.end({ timeout: 5 })
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
