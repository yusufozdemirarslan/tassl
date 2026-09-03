// Drops and recreates the public schema of TEST_DATABASE_URL (or DATABASE_URL with --dev), runs
// the migrations (with the pg-boss schema), and runs the seed (phase-00 step 0.7, phase-02 step 2.9).
//   pnpm db:reset          # test database
//   pnpm db:reset --dev    # local development database
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import postgres from 'postgres'

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
  } finally {
    await sql.end({ timeout: 5 })
  }
  console.log(`db-reset: schema recreated (${dev ? 'dev' : 'test'})`)

  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url }
  // db:migrate = drizzle-kit migrate + scripts/pgboss-migrate.ts (Step 2.7), so a fresh database also
  // gets the pgboss schema and queues.
  execSync('pnpm db:migrate', { stdio: 'inherit', env })

  if (existsSync('src/server/db/seed.ts')) {
    execSync('pnpm exec tsx src/server/db/seed.ts', { stdio: 'inherit', env })
  } else {
    console.log('db-reset: no seed yet (src/server/db/seed.ts arrives in Phase 2)')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
