// Integration project setup (docs/tech/14-testing-strategy.md §2): migrates TEST_DATABASE_URL once
// per worker (fileParallelism: false) and exposes truncateAll(). The transaction-per-test helpers
// (beginTest/rollbackTest) and the tassl_app role arrive with the data layer in Phase 2.
import 'dotenv/config'
import { execSync } from 'node:child_process'
import postgres from 'postgres'
import { afterAll, beforeAll } from 'vitest'

process.env.APP_ENV = 'test'
process.env.LOG_LEVEL ??= 'warn'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tassl:tassl@localhost:5432/tassl_test'

if (!/test/.test(TEST_DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"')
}

export const testSql = postgres(TEST_DATABASE_URL, { max: 2, prepare: false })

let migrated = false

export function migrateTestDatabase(): void {
  if (migrated) return
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_URL_UNPOOLED: TEST_DATABASE_URL,
  }
  execSync('pnpm exec drizzle-kit migrate', { stdio: 'inherit', env })
  // pg-boss schema and queues (Step 2.7); lives in schema `pgboss`, which truncateAll() leaves alone.
  execSync('pnpm exec tsx scripts/pgboss-migrate.ts', { stdio: 'inherit', env })
  migrated = true
}

/** Empties every application table in `public` (tests tagged // @db:truncate call this in afterEach); the pgboss schema is left alone. */
export async function truncateAll(): Promise<void> {
  const tables = await testSql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`
  if (tables.length === 0) return
  const names = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await testSql.unsafe(`truncate table ${names} restart identity cascade`)
}

beforeAll(async () => {
  migrateTestDatabase()
  // Step 2.6 (D-085): the immutability migration creates tassl_app NOLOGIN; the grants test signs in
  // with this throwaway password. Local and CI databases only.
  await testSql.unsafe(
    "do $$ begin if exists (select 1 from pg_roles where rolname = 'tassl_app') then alter role tassl_app login password 'test'; end if; end $$",
  )
})

afterAll(async () => {
  await testSql.end({ timeout: 5 })
})
