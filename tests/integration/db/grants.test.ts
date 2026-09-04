// Step 2.6 (NFR-004, NFR-005, D-085): connected as tassl_app, the append-only tables accept inserts
// and refuse updates and deletes. tests/setup/integration.ts gives the role a local password.
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

const appUrl = (() => {
  const url = new URL(TEST_DATABASE_URL)
  url.username = 'tassl_app'
  url.password = 'test'
  return url.toString()
})()

const appSql = postgres(appUrl, { max: 1, prepare: false })

type Ids = { runId: string; userId: string; orgId: string; placeholderId: string }

// The parent chain is written by the owner role; only the assertions run as tassl_app.
async function seedRun(): Promise<Ids> {
  const userId = crypto.randomUUID()
  const orgId = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Seat', ${`${userId}@example.test`}, true, now(), now())`
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${orgId}, 'Org', ${`org-${orgId.slice(0, 8)}`}, now())`
  const [course] = await testSql<{ id: string }[]>`
    insert into courses (organization_id, name, term, created_by)
    values (${orgId}, 'Course', '2026-fall', ${userId}) returning id`
  const [section] = await testSql<{ id: string }[]>`
    insert into sections (organization_id, course_id, name)
    values (${orgId}, ${course!.id}, 'A') returning id`
  const [pkg] = await testSql<{ id: string }[]>`
    insert into scenario_packages (organization_id, title, family_key, created_by)
    values (${orgId}, 'Pkg', ${`fam-${orgId.slice(0, 8)}`}, ${userId}) returning id`
  const [version] = await testSql<{ id: string }[]>`
    insert into scenario_package_versions (organization_id, package_id, version, concept_set)
    values (${orgId}, ${pkg!.id}, 1, '{a,b,c,d}') returning id`
  const [variant] = await testSql<{ id: string }[]>`
    insert into scenario_variants (package_version_id, key, label)
    values (${version!.id}, 'defective', 'Defective') returning id`
  const [assignment] = await testSql<{ id: string }[]>`
    insert into assignments (organization_id, section_id, label, package_version_id, variant_id)
    values (${orgId}, ${section!.id}, 'Run 1', ${version!.id}, ${variant!.id}) returning id`
  const [run] = await testSql<{ id: string }[]>`
    insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
      working_clock_seconds, turn_delay_seconds)
    values (${orgId}, ${assignment!.id}, ${userId}, ${version!.id}, ${variant!.id}, 1500, 90)
    returning id`
  // The per-organization placeholder a purged account's rows are re-pointed to (D-093).
  const placeholderId = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${placeholderId}, 'Deleted user',
      ${`deleted-user@org-${orgId.slice(0, 8)}.tassl.local`}, true, now(), now())`
  return { runId: run!.id, userId, orgId, placeholderId }
}

describe('tassl_app grants', () => {
  let ids: Ids

  beforeAll(async () => {
    ids = await seedRun()
  })

  afterEach(async () => {
    // Keep the seeded chain for the whole file; truncateAll runs once at the end.
  })

  afterAll(async () => {
    await appSql.end({ timeout: 5 })
    await truncateAll()
  })

  it('can insert a run event but not update it', async () => {
    const [event] = await appSql<{ id: number }[]>`
      insert into run_events (run_id, seq, type, occurred_at, payload)
      values (${ids.runId}, 1, 'lifecycle', now(), '{"from":"assigned","to":"readiness"}')
      returning id`
    // postgres-js returns bigint identities as strings.
    expect(Number(event?.id)).toBeGreaterThan(0)
    await expect(
      appSql`update run_events set payload = '{}' where id = ${event!.id}`,
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot update a frame or delete an audit row', async () => {
    await testSql`
      insert into run_frames (run_id, decision, assumptions, position, confidence, locked_at)
      values (${ids.runId}, 'Hold', '{"a","b","c"}', 'Position', 60, now())`
    await expect(
      appSql`update run_frames set decision = 'Cut' where run_id = ${ids.runId}`,
    ).rejects.toThrow(/permission denied/)

    const [audit] = await appSql<{ id: string }[]>`
      insert into audit_logs (actor_id, action, target_type, target_id, request_id)
      values (${ids.userId}, 'role.set', 'user', ${ids.userId}, 'req-1') returning id`
    await expect(appSql`delete from audit_logs where id = ${audit!.id}`).rejects.toThrow(
      /permission denied/,
    )
  })

  // D-167: the purge has to rewrite the actor columns of two tables the role may only insert into,
  // so it goes through a SECURITY DEFINER function (migration 0010) rather than a widened grant.
  it('re-points a purged user through repoint_user_references, though a direct update is denied', async () => {
    const [event] = await appSql<{ id: number }[]>`
      insert into run_events (run_id, seq, type, occurred_at, actor_id, payload)
      values (${ids.runId}, 10, 'lifecycle', now(), ${ids.userId},
        '{"from":"readiness","to":"framing"}')
      returning id`
    const [audit] = await appSql<{ id: string }[]>`
      insert into audit_logs (organization_id, actor_id, action, target_type, target_id, request_id)
      values (${ids.orgId}, ${ids.userId}, 'account.delete', 'user', ${ids.userId}, 'req-grants')
      returning id`

    await expect(
      appSql`update run_events set actor_id = ${ids.placeholderId} where id = ${event!.id}`,
    ).rejects.toThrow(/permission denied/)
    await expect(
      appSql`update audit_logs set actor_id = null where id = ${audit!.id}`,
    ).rejects.toThrow(/permission denied/)

    const [counts] = await appSql<
      { runs_updated: number; run_events_updated: number; audit_logs_updated: number }[]
    >`select * from repoint_user_references(${ids.userId}, ${ids.placeholderId}, ${ids.orgId})`
    expect(Number(counts?.run_events_updated)).toBe(1)
    expect(Number(counts?.audit_logs_updated)).toBe(1)
    expect(Number(counts?.runs_updated)).toBe(1)

    const [row] = await appSql<{ actor_id: string }[]>`
      select actor_id from run_events where id = ${event!.id}`
    expect(row?.actor_id).toBe(ids.placeholderId)

    // Put the run back for the tests that follow.
    const [restored] = await appSql<
      { runs_updated: number }[]
    >`select * from repoint_user_references(${ids.placeholderId}, ${ids.userId}, ${ids.orgId})`
    expect(Number(restored?.runs_updated)).toBe(1)
  })

  it('may still update a table that is not append-only', async () => {
    await expect(
      appSql`update runs set state = 'readiness' where id = ${ids.runId}`,
    ).resolves.toBeDefined()
  })
})
