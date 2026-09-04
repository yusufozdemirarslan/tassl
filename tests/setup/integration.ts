// Integration project setup (docs/tech/14-testing-strategy.md §2): migrates TEST_DATABASE_URL once
// per worker (fileParallelism: false) and exposes truncateAll(). The transaction-per-test helpers
// (beginTest/rollbackTest) and the tassl_app role arrive with the data layer in Phase 2.
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll } from 'vitest'

process.env.APP_ENV = 'test'
process.env.LOG_LEVEL ??= 'warn'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tassl:tassl@localhost:5432/tassl_test'

// The application client (src/server/db/client.ts) reads DATABASE_URL when src/server/config loads;
// pointing it at the test database here, before any test file imports server code, keeps every
// integration suite (seed, repositories, rate limiter) on the same database as testSql.
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.DATABASE_URL_UNPOOLED = TEST_DATABASE_URL

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

/**
 * A real signed-in session for `userId` (phase-03 step 3.2): inserts a `session` row and returns the
 * request headers carrying the Better Auth session cookie, so `getSession(headers)` — and any route
 * handler or `auth.api.*` call given these headers — sees the user signed in.
 *
 * The cookie is signed the way better-call does it (`value.HMAC-SHA256(value, secret)`,
 * percent-encoded), which is the one piece of Better Auth internals a test has to reproduce: the
 * factories write users straight to the schema (D-040), so there is no password to sign in with.
 *
 * `auth` is imported lazily: a top-level import would be hoisted above the `DATABASE_URL`
 * assignment at the top of this file and open the app client against the development database.
 */
export async function asUser(
  userId: string,
  options: { activeOrganizationId?: string | null } = {},
): Promise<Headers> {
  const { auth } = await import('@/server/auth/auth')
  const ctx = await auth.$context
  const token = crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  await testSql`
    insert into session (id, token, expires_at, created_at, updated_at, user_id, active_organization_id)
    values (${crypto.randomUUID()}, ${token}, ${expiresAt}, ${now}, ${now}, ${userId},
      ${options.activeOrganizationId ?? null})`
  const signature = createHmac('sha256', ctx.secret).update(token).digest('base64')
  const cookie = encodeURIComponent(`${token}.${signature}`)
  return new Headers({ cookie: `${ctx.authCookies.sessionToken.name}=${cookie}` })
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
