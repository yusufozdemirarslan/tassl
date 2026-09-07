// Drops and recreates the public and pgboss schemas of TEST_DATABASE_URL (or DATABASE_URL with
// --dev), runs the migrations (which rebuild the pg-boss schema and its queues), runs the seed
// (phase-00 step 0.7, phase-02 step 2.9), and refuses to report success if the seed left a job it
// could not run (D-432).
//   pnpm db:reset          # test database
//   pnpm db:reset --dev    # local development database
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import postgres from 'postgres'

type JobTally = { name: string; state: string; count: number }

/**
 * A seed that leaves a broken job behind must not look like a clean reset (D-432).
 *
 * `enqueue()` drains inline when there is no Next request scope, so the seed runs every job it
 * sends; `drainQueues` logs a failure and moves on, and the script still exits 0. That is how five
 * `send_email` jobs failed on every `pnpm db:reset` for a whole phase while `lhci` and `e2e` stayed
 * green (D-431). A job in `retry` or `failed`, or any job sitting in a `<queue>_dead` queue, now
 * fails the reset with the tally, so the next such regression is a red job and not a log line.
 */
async function assertNoBrokenJobs(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false })
  let broken: JobTally[]
  try {
    broken = await sql<JobTally[]>`
      select name, state::text as state, count(*)::int as count
      from pgboss.job
      where state in ('retry', 'failed') or right(name, 5) = '_dead'
      group by name, state
      order by name, state
    `
  } finally {
    await sql.end({ timeout: 5 })
  }
  if (broken.length === 0) {
    console.log('db-reset: no failed or dead-lettered jobs after the seed')
    return
  }
  const lines = broken.map((row) => `  ${row.count} x ${row.name} (${row.state})`).join('\n')
  throw new Error(
    `db-reset: the seed left jobs it could not run:\n${lines}\n` +
      'Read the `job failed` lines above for the reason; the queue must be runnable in the seed ' +
      'process or its handler must not be registered there (docs/tech/10-backend-spec.md §7).',
  )
}

async function main(): Promise<void> {
  const dev = process.argv.includes('--dev')
  const url = dev
    ? process.env.DATABASE_URL
    : (process.env.TEST_DATABASE_URL ?? 'postgres://tassl:tassl@localhost:5432/tassl_test')
  if (!url) throw new Error('DATABASE_URL is not set')
  if (!dev && !/test/.test(url)) {
    throw new Error('refusing to reset: TEST_DATABASE_URL does not look like a test database')
  }

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe('drop schema if exists public cascade')
    await sql.unsafe('create schema public')
    await sql.unsafe('drop schema if exists drizzle cascade')
    // The queue goes with the rows it refers to (D-432). It survived the reset before, so a job a
    // previous run left behind outlived every row it named, and the check below would have read a
    // stale failure as this run's. `pnpm db:migrate` recreates the schema and the queues.
    await sql.unsafe('drop schema if exists pgboss cascade')
  } finally {
    await sql.end({ timeout: 5 })
  }
  console.log(`db-reset: schema recreated (${dev ? 'dev' : 'test'})`)

  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url }
  // db:migrate = drizzle-kit migrate + scripts/pgboss-migrate.ts (Step 2.7), so a fresh database also
  // gets the pgboss schema and queues.
  execSync('pnpm db:migrate', { stdio: 'inherit', env })

  if (existsSync('src/server/db/seed.ts')) {
    // --conditions=react-server: since Phase 5 the seed imports the scenarios service to load the
    // fixture package, and that reaches `server-only` through the permission helpers (D-214). The
    // condition is process-wide, so this process has no `react-dom/server` and cannot render an
    // email; it enqueues the seat verification mails and leaves them for a runtime that can (D-431).
    execSync('pnpm exec tsx --conditions=react-server src/server/db/seed.ts', {
      stdio: 'inherit',
      env,
    })
    await assertNoBrokenJobs(url)
  } else {
    console.log('db-reset: no seed yet (src/server/db/seed.ts arrives in Phase 2)')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
