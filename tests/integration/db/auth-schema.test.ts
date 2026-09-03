// Step 2.1 (DATA-001 to DATA-007): the Better Auth tables exist as generated and the additional
// user fields carry their defaults.
import { afterEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

const AUTH_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'rate_limit',
]

describe('better auth schema', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('creates the eight generated tables', async () => {
    const rows = await testSql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`
    const names = new Set(rows.map((r) => r.tablename))
    for (const table of AUTH_TABLES) expect(names.has(table), table).toBe(true)
  })

  it('defaults user.platform_role to none and leaves deleted_at null', async () => {
    const id = crypto.randomUUID()
    await testSql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, 'Seat One', ${`${id}@example.test`}, false, now(), now())`
    const [row] = await testSql<{ platform_role: string; deleted_at: Date | null }[]>`
      select platform_role, deleted_at from "user" where id = ${id}`
    expect(row).toMatchObject({ platform_role: 'none', deleted_at: null })
  })

  it('keeps member unique per organization and user only once the 2.2 index exists', async () => {
    // The generated schema indexes (organization_id) and (user_id) separately; the composite unique
    // index (06 §3.1) is added by the hand-written migration in Step 2.2. This assertion documents
    // the generated state so the later test can flip it.
    const indexes = await testSql<{ indexname: string }[]>`
      select indexname from pg_indexes where tablename = 'member'`
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(['member_organizationId_idx', 'member_userId_idx']),
    )
  })
})
