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

  it('defaults user.platform_role to student and leaves deleted_at null', async () => {
    const id = crypto.randomUUID()
    await testSql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, 'Seat One', ${`${id}@example.test`}, false, now(), now())`
    const [row] = await testSql<{ platform_role: string; deleted_at: Date | null }[]>`
      select platform_role, deleted_at from "user" where id = ${id}`
    expect(row).toMatchObject({ platform_role: 'student', deleted_at: null })
  })

  it('refuses a platform role outside the four, and any member role but the membership (D-748)', async () => {
    const id = crypto.randomUUID()
    await expect(
      testSql`
        insert into "user" (id, name, email, email_verified, platform_role, created_at, updated_at)
        values (${id}, 'Seat Two', ${`${id}@example.test`}, false, 'none', now(), now())`,
    ).rejects.toThrow(/user_platform_role_check/)
    for (const role of ['student', 'tassl_scenario_editor', 'instructor', 'admin']) {
      const seat = crypto.randomUUID()
      await testSql`
        insert into "user" (id, name, email, email_verified, platform_role, created_at, updated_at)
        values (${seat}, 'Seat', ${`${seat}@example.test`}, false, ${role}, now(), now())`
    }

    const orgId = crypto.randomUUID()
    await testSql`
      insert into organization (id, name, slug, created_at)
      values (${orgId}, 'Walkthrough University', ${`org-${orgId}`}, now())`
    await testSql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, 'Seat Two', ${`${id}@example.test`}, false, now(), now())`
    await expect(
      testSql`
        insert into member (id, organization_id, user_id, role, created_at)
        values (${crypto.randomUUID()}, ${orgId}, ${id}, 'instructor', now())`,
    ).rejects.toThrow(/member_role_is_membership/)
    await testSql`
      insert into member (id, organization_id, user_id, role, created_at)
      values (${crypto.randomUUID()}, ${orgId}, ${id}, 'member', now())`
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
