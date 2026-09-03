// pg-boss instance: docs/tech/10-backend-spec.md §7 and DECISIONS.md D-012.
// Serverless mode: no supervision, no scheduler, no migration at start (pnpm db:migrate runs
// scripts/pgboss-migrate.ts), two connections per instance. One instance per process.
import { PgBoss } from 'pg-boss'
import { env } from '@/server/config'
import { rootLogger } from '@/server/logging/logger'

let boss: PgBoss | null = null
let starting: Promise<PgBoss> | null = null

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss
  starting ??= (async () => {
    const instance = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      supervise: false,
      schedule: false,
      migrate: false,
      max: 2,
    })
    // An unhandled 'error' event would crash the process; pg-boss emits one for pool failures.
    instance.on('error', (err) => rootLogger.error({ event: 'pgboss_error', err }, 'pg-boss error'))
    await instance.start()
    boss = instance
    return instance
  })()
  try {
    return await starting
  } catch (error) {
    starting = null
    throw error
  }
}

/** Stops the instance (scripts and tests); the next getBoss() starts a fresh one. */
export async function stopBoss(): Promise<void> {
  const instance = boss ?? (starting ? await starting.catch(() => null) : null)
  boss = null
  starting = null
  if (instance) await instance.stop({ graceful: true, timeout: 5000 })
}
