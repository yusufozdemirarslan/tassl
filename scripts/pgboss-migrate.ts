// pg-boss schema and queues: docs/tech/10-backend-spec.md §7, DECISIONS.md D-012.
// Runs as the second half of `pnpm db:migrate` (after drizzle-kit) and from tests/setup/integration.ts.
// Starting an instance with migrate enabled creates or upgrades the `pgboss` schema; the queues are
// then created idempotently (dead-letter queues first, since a queue references its dead letter).
//   pnpm exec tsx scripts/pgboss-migrate.ts
import 'dotenv/config'
import { PgBoss } from 'pg-boss'
import { deadLetterQueue, QUEUE_NAMES, QUEUE_OPTIONS } from '@/server/jobs/queues'

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
    max: 2,
  })
  boss.on('error', (error) => console.error('pgboss-migrate:', error.message))
  await boss.start()
  try {
    console.log('pgboss-migrate: schema pgboss is at the current version')
    for (const name of QUEUE_NAMES) {
      const dead = deadLetterQueue(name)
      await boss.createQueue(dead)
      console.log(`pgboss-migrate: queue ${dead}`)
    }
    for (const name of QUEUE_NAMES) {
      const options = QUEUE_OPTIONS[name]
      await boss.createQueue(name, options)
      // createQueue leaves an existing queue untouched; updateQueue converges its options (fix-forward).
      await boss.updateQueue(name, options)
      console.log(
        `pgboss-migrate: queue ${name} (retryLimit ${options.retryLimit}, retryDelay ${options.retryDelay}s, backoff, expire ${options.expireInSeconds}s, dead letter ${options.deadLetter})`,
      )
    }
  } finally {
    await boss.stop({ graceful: true, timeout: 5000 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
