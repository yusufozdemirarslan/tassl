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
  execSync('pnpm exec drizzle-kit migrate', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL_UNPOOLED: TEST_DATABASE_URL,
    },
  })
  migrated = true
}

/** Empties every application table (tests tagged // @db:truncate call this in afterEach). */
export async function truncateAll(): Promise<void> {
  const tables = await testSql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`
  if (tables.length === 0) return
  const names = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await testSql.unsafe(`truncate table ${names} restart identity cascade`)
}

beforeAll(() => {
  migrateTestDatabase()
})

afterAll(async () => {
  await testSql.end({ timeout: 5 })
})
