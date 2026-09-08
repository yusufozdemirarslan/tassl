// Step 13.6 — retention (SYS-027, NFR-009, D-018, D-069, D-112). Two halves of one rule.
//
// The schedule half: the purge is not a cron entry anywhere, it is a job the daily drain enqueues
// under the key `purge:<UTC day>`. The key is a **label**, not a dedupe: every queue here runs
// pg-boss's `standard` policy, under which a second send with the same key makes a second job
// (D-400, D-518, 10 §7 "Idempotency"). So this suite holds `scheduleDailyMaintenance` to the two
// things that are actually true — the key it stamps and the day boundary it rolls on — and leaves
// "one purge per day" to the handler, which is idempotent (`purge.test.ts`, and the last test here).
//
// The behaviour half: 30 days after the soft delete the person is gone, and the append-only tables
// that mentioned them keep their evidence and lose the person — `llm_calls.user_id` and the audit
// rows that belong to no institution are set to null rather than deleted (D-112), while the
// institution's audit rows move to its placeholder seat. `purge.test.ts` covers the run trace and
// the personal rows; this file covers the append-only side and the far edge of the window itself.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { scheduleDailyMaintenance } from '@/server/jobs/drain'
import { enqueue } from '@/server/jobs/enqueue'
import { utcDateKey } from '@/server/jobs/queues'
import { PURGE_AFTER_DAYS } from '@/server/modules/identity/retention'
import { testSql, truncateAll } from '@tests/setup/integration'

type Identity = typeof import('@/server/modules/identity')
type Factories = typeof import('@tests/factories')
type Walkthrough = Awaited<ReturnType<Factories['buildWalkthroughFixture']>>

const DAY_MS = 24 * 60 * 60 * 1000

let identity: Identity

describe('daily maintenance schedule', () => {
  beforeEach(async () => {
    const boss = await getBoss()
    await boss.deleteAllJobs('purge_deleted_accounts')
  })

  afterAll(async () => {
    const boss = await getBoss()
    await boss.deleteAllJobs('purge_deleted_accounts')
  })

  it('stamps the UTC day on every purge job it sends', async () => {
    await scheduleDailyMaintenance()
    await scheduleDailyMaintenance()
    await scheduleDailyMaintenance()

    const rows = await testSql<{ singleton_key: string | null }[]>`
      select singleton_key from pgboss.job where name = 'purge_deleted_accounts'`
    expect(rows.every((row) => row.singleton_key === `purge:${utcDateKey()}`)).toBe(true)
    // Three, not one: the key is a label under the `standard` queue policy (D-400). What keeps a
    // day to one purge is the handler, not the queue — the last test in this file.
    expect(rows).toHaveLength(3)
  })

  it('rolls the key at midnight UTC, so tomorrow is a different job', async () => {
    await scheduleDailyMaintenance()
    const tomorrow = utcDateKey(new Date(Date.now() + DAY_MS))
    expect(tomorrow).not.toBe(utcDateKey())

    await enqueue('purge_deleted_accounts', {}, { singletonKey: `purge:${tomorrow}`, drain: false })

    const boss = await getBoss()
    expect(
      await boss.findJobs('purge_deleted_accounts', { key: `purge:${utcDateKey()}` }),
    ).toHaveLength(1)
    expect(
      await boss.findJobs('purge_deleted_accounts', { key: `purge:${tomorrow}` }),
    ).toHaveLength(1)
  })
})

describe('purge retention window and append-only rows', () => {
  let fixture: Walkthrough
  let purgedId: string
  let keptId: string
  let runId: string

  beforeAll(async () => {
    await truncateAll()
    identity = await import('@/server/modules/identity')
    const f: Factories = await import('@tests/factories')
    fixture = await f.buildWalkthroughFixture()
    const orgId = fixture.organization.id

    purgedId = fixture.student1.id
    const [run] = await testSql<{ id: string }[]>`
      insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
        working_clock_seconds, turn_delay_seconds)
      values (${orgId}, ${fixture.assignment.id}, ${purgedId}, ${fixture.pkg.version.id},
        ${fixture.pkg.defective.id}, 1500, 90)
      returning id`
    runId = run!.id

    // Two LLM calls: one inside the run, one outside it. Both are evidence of spend and behaviour
    // that outlives the person (D-112).
    await testSql`
      insert into llm_calls (feature, prompt_name, prompt_version, provider, model, input_tokens,
        output_tokens, latency_ms, cost_estimate_usd, outcome, user_id, run_id, request_id)
      values ('assistant', 'assistant.reply', 3, 'mock', 'mock-1', 900, 120, 640, 0.004200, 'ok',
        ${purgedId}, ${runId}, 'req-llm-run')`
    await testSql`
      insert into llm_calls (feature, prompt_name, prompt_version, provider, model, input_tokens,
        output_tokens, latency_ms, cost_estimate_usd, outcome, user_id, run_id, request_id)
      values ('band_read', 'scoring.band_read', 1, 'mock', 'mock-1', 400, 80, 310, 0.001100,
        'validation_failed', ${purgedId}, null, 'req-llm-standalone')`

    await testSql`
      insert into audit_logs (organization_id, actor_id, action, target_type, target_id, request_id)
      values (${orgId}, ${purgedId}, 'account.delete', 'user', ${purgedId}, 'req-audit-org')`
    await testSql`
      insert into audit_logs (organization_id, actor_id, action, target_type, target_id, request_id)
      values (null, ${purgedId}, 'account.delete', 'user', ${purgedId}, 'req-audit-platform')`

    // `user.deleted_at` is `timestamp` without a time zone (the Better Auth generated schema,
    // D-099), and the two drivers disagree about what a JS Date means in that column: drizzle writes
    // `toISOString()`, so UTC wall time, while postgres-js writes local wall time. Writing these two
    // rows as a Date through testSql would therefore shift them by the machine's UTC offset — four
    // hours here, zero in CI — which is enough to move a row across a boundary this test sets a
    // minute away from it. Both edges are written in SQL instead, in the same UTC wall time the
    // purge's own comparison uses (D-590).
    await testSql`
      update "user"
         set deleted_at = (now() at time zone 'utc')
           - make_interval(days => ${PURGE_AFTER_DAYS}::int) - interval '1 minute'
       where id = ${purgedId}`

    // An hour inside the window: still here today, gone tomorrow.
    keptId = fixture.student2.id
    await testSql`
      update "user"
         set deleted_at = (now() at time zone 'utc')
           - make_interval(days => ${PURGE_AFTER_DAYS}::int) + interval '1 hour'
       where id = ${keptId}`

    await identity.purgeDeletedAccounts()
  })

  afterAll(async () => {
    await truncateAll()
    await stopBoss()
  })

  it('purges at the far side of the 30-day window and not a minute before it', async () => {
    expect(await testSql`select 1 from "user" where id = ${purgedId}`).toHaveLength(0)
    const [kept] = await testSql<{ deleted_at: Date | null }[]>`
      select deleted_at from "user" where id = ${keptId}`
    expect(kept?.deleted_at).toBeInstanceOf(Date)
  })

  it('keeps every llm_calls row and nulls the person on it', async () => {
    const rows = await testSql<
      {
        user_id: string | null
        run_id: string | null
        feature: string
        outcome: string
        cost_estimate_usd: string
      }[]
    >`select user_id, run_id, feature, outcome, cost_estimate_usd from llm_calls
      order by request_id`

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.user_id)).toEqual([null, null])
    // The evidence itself is untouched: the spend, the outcome, and the run it belongs to.
    expect(rows[0]).toMatchObject({ feature: 'assistant', outcome: 'ok', run_id: runId })
    expect(Number(rows[0]?.cost_estimate_usd)).toBeCloseTo(0.0042, 6)
    expect(rows[1]).toMatchObject({
      feature: 'band_read',
      outcome: 'validation_failed',
      run_id: null,
    })
  })

  it('re-points the institution audit row and nulls the actor on the platform one', async () => {
    const [placeholder] = await testSql<{ id: string }[]>`
      select id from "user" where email = ${`deleted-user@${fixture.organization.slug}.tassl.local`}`
    expect(placeholder).toBeDefined()

    const rows = await testSql<{ actor_id: string | null; organization_id: string | null }[]>`
      select actor_id, organization_id from audit_logs
      where target_id = ${purgedId} order by request_id`

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ actor_id: placeholder!.id, organization_id: fixture.organization.id })
    expect(rows[1]).toEqual({ actor_id: null, organization_id: null })
  })

  it('leaves no row anywhere still naming the purged id', async () => {
    const [llm] = await testSql<{ count: string }[]>`
      select count(*)::text as count from llm_calls where user_id = ${purgedId}`
    const [audit] = await testSql<{ count: string }[]>`
      select count(*)::text as count from audit_logs where actor_id = ${purgedId}`
    const [events] = await testSql<{ count: string }[]>`
      select count(*)::text as count from run_events where actor_id = ${purgedId}`
    expect([llm?.count, audit?.count, events?.count]).toEqual(['0', '0', '0'])
  })

  it('is what keeps a day to one purge: a second pass finds nothing left to do', async () => {
    await expect(identity.purgeDeletedAccounts()).resolves.toEqual({ purged: 0 })
  })
})
