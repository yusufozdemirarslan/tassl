// Step 2.5 (DATA-041 to DATA-050): the uniqueness rules of the scoring, records, and platform
// tables, and the foreign key deferred from Step 2.4 under D-163 (run_claims.neutralization_id).
import { afterEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

const STEP_TABLES = [
  'run_bands',
  'run_scores',
  'claim_neutralizations',
  'run_debrief_answers',
  'run_records',
  'course_exports',
  'notifications',
  'audit_logs',
  'llm_calls',
  'rate_limit_buckets',
]

const DUPLICATE_KEY = /duplicate key value violates unique constraint/
const FOREIGN_KEY = /violates foreign key constraint/

type Chain = {
  orgId: string
  userId: string
  versionId: string
  assignmentId: string
  runId: string
}

function idOf(rows: { id: string }[]): string {
  const row = rows[0]
  if (!row) throw new Error('insert returned no row')
  return row.id
}

/** organization → user → course → section → package → version → variant → assignment → run. */
async function createRunChain(): Promise<Chain> {
  const orgId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${orgId}, 'Walkthrough University', ${`org-${orgId}`}, now())`
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Seat One', ${`${userId}@example.test`}, true, now(), now())`
  const courseId = idOf(
    await testSql<{ id: string }[]>`
      insert into courses (organization_id, name, term, mapping, created_by)
      values (${orgId}, 'Marketing Strategy', '2026-fall',
        '{"novice":1,"developing":2,"proficient":3,"professional":4}'::jsonb, ${userId})
      returning id`,
  )
  const sectionId = idOf(
    await testSql<{ id: string }[]>`
      insert into sections (organization_id, course_id, name)
      values (${orgId}, ${courseId}, 'Section A')
      returning id`,
  )
  const packageId = idOf(
    await testSql<{ id: string }[]>`
      insert into scenario_packages (organization_id, title, family_key, created_by)
      values (${orgId}, 'Northwind Launch', ${`northwind-${orgId}`}, ${userId})
      returning id`,
  )
  const versionId = idOf(
    await testSql<{ id: string }[]>`
      insert into scenario_package_versions (organization_id, package_id, version, concept_set)
      values (${orgId}, ${packageId}, 1,
        '{unit_economics,segmentation,pricing,channel_fit}'::text[])
      returning id`,
  )
  const variantId = idOf(
    await testSql<{ id: string }[]>`
      insert into scenario_variants (package_version_id, key, label)
      values (${versionId}, 'defective', 'Defective')
      returning id`,
  )
  const assignmentId = idOf(
    await testSql<{ id: string }[]>`
      insert into assignments (organization_id, section_id, label, package_version_id, variant_id)
      values (${orgId}, ${sectionId}, 'Decision Run 1', ${versionId}, ${variantId})
      returning id`,
  )
  const runId = idOf(
    await testSql<{ id: string }[]>`
      insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
        working_clock_seconds, turn_delay_seconds)
      values (${orgId}, ${assignmentId}, ${userId}, ${versionId}, ${variantId}, 1500, 90)
      returning id`,
  )
  return { orgId, userId, versionId, assignmentId, runId }
}

describe('scoring, records, and platform schema', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('creates the ten tables of step 2.5', async () => {
    const rows = await testSql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`
    const names = new Set(rows.map((r) => r.tablename))
    for (const table of STEP_TABLES) expect(names.has(table), table).toBe(true)
  })

  it('keeps one run_bands row per (run_id, dimension) and applies the draft defaults', async () => {
    const { runId } = await createRunChain()
    const insertBand = (dimension: string) => testSql`
      insert into run_bands (run_id, dimension, draft_status, basis)
      values (${runId}, ${dimension}, 'drafted', 'trace')`

    await insertBand('framing')
    await expect(insertBand('framing')).rejects.toThrow(DUPLICATE_KEY)
    await insertBand('delegation')

    const [row] = await testSql<
      { provisional: boolean; graph_keys: string[]; quotes: unknown; decision: string | null }[]
    >`
      select provisional, graph_keys, quotes, decision from run_bands
      where run_id = ${runId} and dimension = 'framing'`
    expect(row).toMatchObject({ provisional: true, graph_keys: [], quotes: [], decision: null })
  })

  it('keeps one course_exports row per (run_id, version)', async () => {
    const { orgId, userId, assignmentId, runId } = await createRunChain()
    const insertExport = (version: number) => testSql`
      insert into course_exports (organization_id, run_id, assignment_id, version, file, reason, created_by)
      values (${orgId}, ${runId}, ${assignmentId}, ${version}, '{"run_id":"x"}'::jsonb, 'initial', ${userId})`

    await insertExport(1)
    await expect(insertExport(1)).rejects.toThrow(DUPLICATE_KEY)
    await insertExport(2)

    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from course_exports where run_id = ${runId}`
    expect(count?.n).toBe(2)
  })

  it('keys rate_limit_buckets by (key, window_start)', async () => {
    const windowOne = new Date('2026-09-03T10:00:00Z')
    const windowTwo = new Date('2026-09-03T10:01:00Z')
    const insertBucket = (windowStart: Date) => testSql`
      insert into rate_limit_buckets (key, window_start, count)
      values ('write:seat-one', ${windowStart}, 1)`

    await insertBucket(windowOne)
    await insertBucket(windowTwo)
    await expect(insertBucket(windowOne)).rejects.toThrow(DUPLICATE_KEY)

    // The limiter's own statement (10-backend-spec.md §4) relies on exactly this key.
    const [row] = await testSql<{ count: number }[]>`
      insert into rate_limit_buckets (key, window_start, count)
      values ('write:seat-one', ${windowOne}, 1)
      on conflict (key, window_start) do update set count = rate_limit_buckets.count + 1
      returning count`
    expect(row?.count).toBe(2)
  })

  it('references claim_neutralizations from run_claims.neutralization_id (D-163)', async () => {
    const { userId, versionId, runId } = await createRunChain()
    const claimId = idOf(
      await testSql<{ id: string }[]>`
        insert into scenario_claims (package_version_id, key, text, source_kind, importance,
          consequence_level, verification_cost, concept_key, position)
        values (${versionId}, 'C1', 'Monthly churn is 4 percent.', 'assistant', 'load_bearing',
          'high', 'cheap', 'unit_economics', 1)
        returning id`,
    )
    const insertRunClaim = (neutralizationId: string) => testSql`
      insert into run_claims (run_id, claim_id, surfaced_at, surfaced_by, neutralization_id)
      values (${runId}, ${claimId}, now(), 'delegation', ${neutralizationId})`

    await expect(insertRunClaim(crypto.randomUUID())).rejects.toThrow(FOREIGN_KEY)

    const neutralizationId = idOf(
      await testSql<{ id: string }[]>`
        insert into claim_neutralizations (run_id, claim_id, reason, actor_id)
        values (${runId}, ${claimId}, 'unintended_defect', ${userId})
        returning id`,
    )
    await insertRunClaim(neutralizationId)
    const [row] = await testSql<{ neutralization_id: string }[]>`
      select neutralization_id from run_claims where run_id = ${runId} and claim_id = ${claimId}`
    expect(row?.neutralization_id).toBe(neutralizationId)
  })
})
