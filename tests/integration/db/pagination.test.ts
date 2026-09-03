// D-166: rows inserted in one statement share a created_at down to the microsecond; paging over them
// must not skip any.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

describe('cursor pagination against Postgres', () => {
  let repo: typeof import('@/server/modules/notifications/repository')

  beforeAll(async () => {
    repo = await import('@/server/modules/notifications/repository')
  })

  afterEach(async () => {
    await truncateAll()
  })

  it('pages through rows that share a millisecond without skipping', async () => {
    const userId = crypto.randomUUID()
    await testSql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, 'Reader', ${`${userId}@example.test`}, true, now(), now())`
    // One statement: identical created_at (microsecond precision) for all five rows.
    await repo.insertNotifications(
      Array.from({ length: 5 }, (_, i) => ({
        userId,
        type: 'run_scored' as const,
        title: `n${i}`,
        body: 'body',
      })),
    )
    const first = await repo.listNotifications(userId, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = await repo.listNotifications(userId, { limit: 2, cursor: first.nextCursor })
    expect(second.items).toHaveLength(2)
    const third = await repo.listNotifications(userId, { limit: 2, cursor: second.nextCursor })
    expect(third.items).toHaveLength(1)
    expect(third.nextCursor).toBeNull()
    const seen = new Set([...first.items, ...second.items, ...third.items].map((n) => n.id))
    expect(seen.size).toBe(5)
  })
})
