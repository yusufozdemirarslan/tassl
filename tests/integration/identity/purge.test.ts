// Step 3.3 — `purge_deleted_accounts` (NFR-009, D-093, D-112, D-167). Thirty days after the soft
// delete the person is gone, but the course record is not: the run, its trace, and the audit rows
// move onto the organization's `deleted-user@<slug>.tassl.local` placeholder, and the append-only
// rows that belong to no organization keep their evidence with no actor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

type Identity = typeof import('@/server/modules/identity')
type Factories = typeof import('@tests/factories')
type Walkthrough = Awaited<ReturnType<Factories['buildWalkthroughFixture']>>

const DAY_MS = 24 * 60 * 60 * 1000

let identity: Identity
let fixture: Walkthrough
let purgedId: string
let purgedEmail: string
let keptId: string
let runId: string

const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS)

describe('purgeDeletedAccounts', () => {
  beforeAll(async () => {
    await truncateAll()
    identity = await import('@/server/modules/identity')
    const f: Factories = await import('@tests/factories')
    fixture = await f.buildWalkthroughFixture()
    const orgId = fixture.organization.id

    // The student who asked to be deleted 31 days ago: a run, one trace event, one audit row.
    purgedId = fixture.student1.id
    purgedEmail = fixture.student1.email
    const [run] = await testSql<{ id: string }[]>`
      insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
        working_clock_seconds, turn_delay_seconds)
      values (${orgId}, ${fixture.assignment.id}, ${purgedId}, ${fixture.pkg.version.id},
        ${fixture.pkg.defective.id}, 1500, 90)
      returning id`
    runId = run!.id
    await testSql`
      insert into run_events (run_id, seq, type, occurred_at, actor_id, payload)
      values (${runId}, 1, 'lifecycle', now(), ${purgedId},
        '{"from":"assigned","to":"readiness"}'::jsonb)`
    await testSql`
      insert into audit_logs (organization_id, actor_id, action, target_type, target_id, request_id)
      values (${orgId}, ${purgedId}, 'account.delete', 'user', ${purgedId}, 'req-purge')`
    // An audit row with no institution behind it: nothing to re-point it to (D-112).
    await testSql`
      insert into audit_logs (organization_id, actor_id, action, target_type, target_id, request_id)
      values (null, ${purgedId}, 'account.delete', 'user', ${purgedId}, 'req-purge-platform')`
    await testSql`
      insert into notifications (user_id, organization_id, type, title, body)
      values (${purgedId}, ${orgId}, 'run_scored', 'Scored', 'Your run was scored.')`
    await testSql`update "user" set deleted_at = ${daysAgo(31)} where id = ${purgedId}`

    // The student who asked yesterday: still inside the 30-day window.
    keptId = fixture.student2.id
    await testSql`update "user" set deleted_at = ${daysAgo(1)} where id = ${keptId}`
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('purges the account that passed the window and keeps the one that has not', async () => {
    const result = await identity.purgeDeletedAccounts()
    expect(result.purged).toBe(1)

    const gone = await testSql`select 1 from "user" where id = ${purgedId}`
    expect(gone).toHaveLength(0)

    const [kept] = await testSql<{ deleted_at: Date | null }[]>`
      select deleted_at from "user" where id = ${keptId}`
    expect(kept?.deleted_at).toBeInstanceOf(Date)
  })

  it('re-points the run and its trace to the organization placeholder', async () => {
    const [placeholder] = await testSql<{ id: string; name: string }[]>`
      select id, name from "user"
      where email = ${`deleted-user@${fixture.organization.slug}.tassl.local`}`
    expect(placeholder).toBeDefined()
    expect(placeholder?.name).toBe('Deleted user')

    const [run] = await testSql<{ student_id: string }[]>`
      select student_id from runs where id = ${runId}`
    expect(run?.student_id).toBe(placeholder!.id)

    const [event] = await testSql<{ actor_id: string | null }[]>`
      select actor_id from run_events where run_id = ${runId}`
    expect(event?.actor_id).toBe(placeholder!.id)
  })

  it('keeps the audit rows, with the placeholder as the actor of the institution ones', async () => {
    const [placeholder] = await testSql<{ id: string }[]>`
      select id from "user"
      where email = ${`deleted-user@${fixture.organization.slug}.tassl.local`}`

    const rows = await testSql<{ actor_id: string | null; organization_id: string | null }[]>`
      select actor_id, organization_id from audit_logs
      where target_id = ${purgedId} order by request_id`
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      actor_id: placeholder!.id,
      organization_id: fixture.organization.id,
    })
    // The platform-level row keeps the evidence and loses the actor (D-112).
    expect(rows[1]).toEqual({ actor_id: null, organization_id: null })
  })

  it('leaves nothing personal behind', async () => {
    const notifications = await testSql`select 1 from notifications where user_id = ${purgedId}`
    expect(notifications).toHaveLength(0)

    const memberships = await testSql`select 1 from member where user_id = ${purgedId}`
    expect(memberships).toHaveLength(0)

    const sections = await testSql`select 1 from section_memberships where user_id = ${purgedId}`
    expect(sections).toHaveLength(0)

    const sessions = await testSql`select 1 from session where user_id = ${purgedId}`
    expect(sessions).toHaveLength(0)

    const verifications =
      await testSql`select 1 from verification where identifier = ${purgedEmail}`
    expect(verifications).toHaveLength(0)
  })

  it('is idempotent: a second pass finds nothing to purge', async () => {
    await expect(identity.purgeDeletedAccounts()).resolves.toEqual({ purged: 0 })
  })
})
