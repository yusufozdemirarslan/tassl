// Step 10.4 — the `notifications` service against Postgres (docs/tech/10-backend-spec-modules.md
// §15; SYS-010, D-015, D-020).
//
// The module has exactly one rule — owner only — and it is enforced by the query key rather than by
// a permission helper: the actor's own id *is* the scope, so a row that is not theirs simply is not
// found. That is worth a database to prove, because "not found" and "found and refused" are the same
// sentence in a unit test and two different leaks in production.
//
// Four claims:
//
//   * **The list is the actor's own, newest first, cursor-paginated** (D-020), and `unread` filters.
//   * **Marking read is idempotent and owner-scoped**: the first `read_at` stays, and somebody
//     else's notification is NOT_FOUND rather than FORBIDDEN.
//   * **`notify` writes one row per recipient inside the caller's transaction**, and a rolled-back
//     transaction leaves none — a notification exists exactly when the thing it announces happened.
//   * **An e-mail copy is enqueued for the five types 10 §15 names and for nothing else**, after the
//     commit, carrying the title and body and an absolute link on this deployment's own origin.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import type { SessionUser } from '@/server/auth/types'

type Factories = typeof import('@tests/factories')
type Notifications = typeof import('@/server/modules/notifications')
type Tx = typeof import('@/server/db/tx')

let f: Factories
let notifications: Notifications
let tx: Tx
let orgId: string
let student: SessionUser
let instructor: SessionUser

const actorFor = (row: { id: string; email: string }, organizationId: string): SessionUser => ({
  id: row.id,
  email: row.email,
  name: row.email,
  emailVerified: true,
  platformRole: 'none',
  activeOrganizationId: organizationId,
})

const emailJobs = async () =>
  testSql<{ data: { to: string; template: string; props: Record<string, unknown> } }[]>`
    select data from pgboss.job where name = 'send_email' order by created_on`

beforeEach(async () => {
  await truncateAll()
  await testSql`delete from pgboss.job where name = 'send_email'`
  f = (await import('@tests/factories')) as Factories
  notifications = await import('@/server/modules/notifications')
  tx = await import('@/server/db/tx')

  const { organization } = await f.createInstitution('notifications')
  orgId = organization.id
  const studentUser = await f.createUser('notifications-student')
  const instructorUser = await f.createUser('notifications-instructor')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, instructorUser.id, 'instructor')
  student = actorFor(studentUser, orgId)
  instructor = actorFor(instructorUser, orgId)
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

/** One notification per recipient, written the way `scoreRun` writes them. */
async function write(
  type: 'run_scored' | 'invitation',
  userIds: string[],
  overrides: { title?: string; body?: string; link?: string | null } = {},
): Promise<void> {
  await tx.withTransaction(async (handle) => {
    await notifications.notify(handle, {
      userIds,
      type,
      title: overrides.title ?? 'Your run has been scored',
      body: overrides.body ?? 'The draft bands are with your instructor.',
      link: overrides.link === undefined ? '/runs/abc' : overrides.link,
      payload: { runId: 'abc' },
      orgId,
    })
  })
}

describe('notify', () => {
  it('writes one row per recipient, inside the caller’s transaction', async () => {
    await write('run_scored', [student.id, instructor.id, student.id])

    const rows = await testSql<{ user_id: string; type: string; organization_id: string }[]>`
      select user_id, type, organization_id from notifications order by user_id`
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.user_id).sort()).toEqual([student.id, instructor.id].sort())
    expect(rows.every((row) => row.organization_id === orgId)).toBe(true)
  })

  it('writes nothing when the transaction that announced it rolls back', async () => {
    await expect(
      tx.withTransaction(async (handle) => {
        await notifications.notify(handle, {
          userIds: [student.id],
          type: 'run_scored',
          title: 'Your run has been scored',
          body: 'The draft bands are with your instructor.',
          link: '/runs/abc',
          orgId,
        })
        throw new Error('the mutation failed after the notification')
      }),
    ).rejects.toThrow('the mutation failed after the notification')

    const rows = await testSql`select 1 from notifications`
    expect(rows).toHaveLength(0)
    expect(await emailJobs()).toHaveLength(0)
  })
})

describe('listNotifications', () => {
  it('answers the actor’s own, newest first, and pages on the cursor (D-020)', async () => {
    for (let index = 0; index < 3; index += 1) {
      await write('run_scored', [student.id], { title: `Run ${String(index)} scored` })
    }
    await write('run_scored', [instructor.id], { title: 'Somebody else’s run' })

    const first = await notifications.listNotifications(student, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    expect(first.items.every((item) => item.title.startsWith('Run'))).toBe(true)

    const second = await notifications.listNotifications(student, {
      limit: 2,
      cursor: first.nextCursor ?? '',
    })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()

    const ids = new Set([...first.items, ...second.items].map((item) => item.id))
    expect(ids.size).toBe(3)
  })

  it('filters to the unread ones and counts them for the bell', async () => {
    await write('run_scored', [student.id])
    await write('run_scored', [student.id])
    expect(await notifications.countUnread(student)).toBe(2)

    const page = await notifications.listNotifications(student, { unread: true })
    expect(page.items).toHaveLength(2)

    const [first] = page.items
    await notifications.markRead(student, first?.id ?? '')
    expect(await notifications.countUnread(student)).toBe(1)
    expect((await notifications.listNotifications(student, { unread: true })).items).toHaveLength(1)
  })
})

describe('markRead and markAllRead', () => {
  it('keeps the first read_at and refuses somebody else’s row with NOT_FOUND', async () => {
    await write('run_scored', [student.id])
    const [row] = (await notifications.listNotifications(student)).items
    const id = row?.id ?? ''

    const marked = await notifications.markRead(student, id)
    expect(marked.readAt).not.toBeNull()
    const again = await notifications.markRead(student, id)
    expect(again.readAt).toBe(marked.readAt)

    await expect(notifications.markRead(instructor, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('marks every unread row of the actor and reports how many changed', async () => {
    await write('run_scored', [student.id, instructor.id])
    await write('run_scored', [student.id])

    expect(await notifications.markAllRead(student)).toEqual({ marked: 2 })
    expect(await notifications.countUnread(student)).toBe(0)
    // The instructor's copy is untouched: the actor is the scope.
    expect(await notifications.countUnread(instructor)).toBe(1)
    expect(await notifications.markAllRead(student)).toEqual({ marked: 0 })
  })
})

describe('email copies (10 §15, D-015)', () => {
  it('enqueues one per recipient for a type the spec names, with the title, body and link', async () => {
    await write('run_scored', [student.id, instructor.id])

    const jobs = await emailJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs.map((job) => job.data.to).sort()).toEqual([student.email, instructor.email].sort())
    for (const job of jobs) {
      expect(job.data.template).toBe('notification')
      expect(job.data.props).toEqual({
        title: 'Your run has been scored',
        body: 'The draft bands are with your instructor.',
        url: 'http://localhost:3000/runs/abc',
      })
    }
  })

  it('sends none for a type the spec does not name', async () => {
    await write('invitation', [student.id])
    expect(await emailJobs()).toHaveLength(0)
    expect((await notifications.listNotifications(student)).items).toHaveLength(1)
  })

  it('carries no link when the notification has none', async () => {
    await write('run_scored', [student.id], { link: null })
    const [job] = await emailJobs()
    expect(job?.data.props).toEqual({
      title: 'Your run has been scored',
      body: 'The draft bands are with your instructor.',
    })
  })
})
