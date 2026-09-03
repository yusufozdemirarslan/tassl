// Step 2.4 (DATA-028 to DATA-040, NFR-005): the trace is unique per (run_id, seq), a locked brief
// refuses updates, the frame has no updated_at, and run_claims.relied_on derives from relied_on_via.
// @db:truncate
import { afterEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

type RunChain = {
  organizationId: string
  userId: string
  packageVersionId: string
  variantId: string
  assignmentId: string
  runId: string
}

/** Inserts the minimal parent chain a run needs and returns its ids. */
async function createRunChain(): Promise<RunChain> {
  const organizationId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const courseId = crypto.randomUUID()
  const sectionId = crypto.randomUUID()
  const packageId = crypto.randomUUID()
  const packageVersionId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const assignmentId = crypto.randomUUID()
  const runId = crypto.randomUUID()

  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${organizationId}, 'Walkthrough U', ${`org-${organizationId}`}, now())`
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Seat One', ${`${userId}@example.test`}, true, now(), now())`
  await testSql`
    insert into courses (id, organization_id, name, term, mapping, created_by)
    values (${courseId}, ${organizationId}, 'Marketing Strategy', '2026-fall',
            '{"novice":1,"developing":2,"proficient":3,"professional":4}'::jsonb, ${userId})`
  await testSql`
    insert into sections (id, organization_id, course_id, name)
    values (${sectionId}, ${organizationId}, ${courseId}, 'Section A')`
  await testSql`
    insert into scenario_packages (id, organization_id, title, family_key, created_by)
    values (${packageId}, ${organizationId}, 'Northwind Launch', ${`family-${packageId}`}, ${userId})`
  await testSql`
    insert into scenario_package_versions (id, organization_id, package_id, version, concept_set)
    values (${packageVersionId}, ${organizationId}, ${packageId}, 1,
            '{"segmentation","pricing","channel","positioning"}'::text[])`
  await testSql`
    insert into scenario_variants (id, package_version_id, key, label)
    values (${variantId}, ${packageVersionId}, 'defective', 'Defective')`
  await testSql`
    insert into assignments (id, organization_id, section_id, label, package_version_id, variant_id)
    values (${assignmentId}, ${organizationId}, ${sectionId}, 'Run 1', ${packageVersionId}, ${variantId})`
  await testSql`
    insert into runs (id, organization_id, assignment_id, student_id, package_version_id, variant_id,
                      working_clock_seconds, turn_delay_seconds)
    values (${runId}, ${organizationId}, ${assignmentId}, ${userId}, ${packageVersionId}, ${variantId},
            1500, 90)`

  return { organizationId, userId, packageVersionId, variantId, assignmentId, runId }
}

async function createClaim(packageVersionId: string): Promise<string> {
  const claimId = crypto.randomUUID()
  await testSql`
    insert into scenario_claims (id, package_version_id, key, text, source_kind, importance,
                                 consequence_level, verification_cost, concept_key, position)
    values (${claimId}, ${packageVersionId}, 'C1', 'Churn fell 12% after the pilot.', 'assistant',
            'load_bearing', 'high', 'cheap', 'segmentation', 1)`
  return claimId
}

describe('runs schema', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('creates a run with its defaults', async () => {
    const { runId } = await createRunChain()
    const [row] = await testSql<
      {
        state: string
        mode: string
        attempt_no: number
        scoring_status: string
        next_event_seq: number
      }[]
    >`select state, mode, attempt_no, scoring_status, next_event_seq from runs where id = ${runId}`
    expect(row).toMatchObject({
      state: 'assigned',
      mode: 'standard',
      attempt_no: 1,
      scoring_status: 'idle',
      next_event_seq: 1,
    })
  })

  it('refuses a second attempt with the same (assignment_id, student_id, attempt_no)', async () => {
    const { organizationId, userId, packageVersionId, variantId, assignmentId } =
      await createRunChain()
    await expect(
      testSql`
        insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
                          working_clock_seconds, turn_delay_seconds)
        values (${organizationId}, ${assignmentId}, ${userId}, ${packageVersionId}, ${variantId},
                1500, 90)`,
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('refuses a confidence outside 0–100 on the run', async () => {
    const { runId } = await createRunChain()
    await expect(
      testSql`update runs set confidence_at_frame = 101 where id = ${runId}`,
    ).rejects.toThrow(/check/)
  })

  it('keeps the trace unique per (run_id, seq)', async () => {
    const { runId, userId } = await createRunChain()
    await testSql`
      insert into run_events (run_id, seq, type, occurred_at, actor_id, payload)
      values (${runId}, 1, 'lifecycle', now(), ${userId}, '{"from":"assigned","to":"readiness"}'::jsonb)`
    await expect(
      testSql`
        insert into run_events (run_id, seq, type, occurred_at, payload)
        values (${runId}, 1, 'policy_displayed', now(), '{}'::jsonb)`,
    ).rejects.toThrow(/unique|duplicate/)

    const [row] = await testSql<{ id: string; seq: number }[]>`
      select id, seq from run_events where run_id = ${runId}`
    expect(row?.seq).toBe(1)
    expect(Number(row?.id)).toBeGreaterThan(0)
  })

  it('refuses updates to a brief once locked_at is set', async () => {
    const { runId } = await createRunChain()
    await testSql`insert into run_briefs (run_id) values (${runId})`

    const [draft] = await testSql<{ assumptions: string[]; recommendation: string }[]>`
      select assumptions, recommendation from run_briefs where run_id = ${runId}`
    expect(draft).toMatchObject({ assumptions: ['', '', ''], recommendation: '' })

    await testSql`update run_briefs set recommendation = 'Launch in Q3' where run_id = ${runId}`
    await testSql`update run_briefs set locked_at = now() where run_id = ${runId}`

    await expect(
      testSql`update run_briefs set recommendation = 'Delay to Q4' where run_id = ${runId}`,
    ).rejects.toThrow(/BRIEF_LOCKED/)

    const [locked] = await testSql<{ recommendation: string }[]>`
      select recommendation from run_briefs where run_id = ${runId}`
    expect(locked?.recommendation).toBe('Launch in Q3')
  })

  it('maintains updated_at on run_briefs while unlocked', async () => {
    const { runId } = await createRunChain()
    await testSql`insert into run_briefs (run_id, updated_at) values (${runId}, now() - interval '1 hour')`
    const [before] = await testSql<{ updated_at: Date }[]>`
      select updated_at from run_briefs where run_id = ${runId}`
    await testSql`update run_briefs set rationale = 'Because' where run_id = ${runId}`
    const [after] = await testSql<{ updated_at: Date }[]>`
      select updated_at from run_briefs where run_id = ${runId}`
    expect(after?.updated_at.getTime()).toBeGreaterThan(before?.updated_at.getTime() ?? Infinity)
  })

  it('gives run_frames no updated_at column and exactly three assumptions', async () => {
    const columns = await testSql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'run_frames'`
    const names = columns.map((c) => c.column_name)
    expect(names).not.toContain('updated_at')
    expect(names).toEqual(
      expect.arrayContaining([
        'run_id',
        'decision',
        'assumptions',
        'position',
        'confidence',
        'locked_at',
      ]),
    )

    const { runId } = await createRunChain()
    await expect(
      testSql`
        insert into run_frames (run_id, decision, assumptions, position, confidence, locked_at)
        values (${runId}, 'Launch', '{"a","b"}'::text[], 'defensible', 60, now())`,
    ).rejects.toThrow(/check/)
    await testSql`
      insert into run_frames (run_id, decision, assumptions, position, confidence, locked_at)
      values (${runId}, 'Launch', '{"a","b","c"}'::text[], 'defensible', 60, now())`
    const [frame] = await testSql<{ assumptions: string[] }[]>`
      select assumptions from run_frames where run_id = ${runId}`
    expect(frame?.assumptions).toEqual(['a', 'b', 'c'])
  })

  it('derives run_claims.relied_on from relied_on_via', async () => {
    const { runId, packageVersionId } = await createRunChain()
    const claimId = await createClaim(packageVersionId)
    const runClaimId = crypto.randomUUID()
    await testSql`
      insert into run_claims (id, run_id, claim_id, surfaced_at, surfaced_by)
      values (${runClaimId}, ${runId}, ${claimId}, now(), 'delegation')`

    const [empty] = await testSql<{ relied_on: boolean; relied_on_via: string[] }[]>`
      select relied_on, relied_on_via from run_claims where id = ${runClaimId}`
    expect(empty).toMatchObject({ relied_on: false, relied_on_via: [] })

    await testSql`
      update run_claims set relied_on_via = '{log_mark}'::text[] where id = ${runClaimId}`
    const [marked] = await testSql<{ relied_on: boolean }[]>`
      select relied_on from run_claims where id = ${runClaimId}`
    expect(marked?.relied_on).toBe(true)

    await testSql`update run_claims set relied_on_via = '{}'::text[] where id = ${runClaimId}`
    const [cleared] = await testSql<{ relied_on: boolean }[]>`
      select relied_on from run_claims where id = ${runClaimId}`
    expect(cleared?.relied_on).toBe(false)

    await expect(
      testSql`
        insert into run_claims (run_id, claim_id, surfaced_at, surfaced_by)
        values (${runId}, ${claimId}, now(), 'document')`,
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('has no updated_at on the append-only tables', async () => {
    const rows = await testSql<{ table_name: string }[]>`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'updated_at'
        and table_name in ('run_events', 'run_actions', 'run_escalations', 'run_pauses',
                           'run_frames', 'run_addenda', 'run_turn_responses')`
    expect(rows).toEqual([])
  })
})
