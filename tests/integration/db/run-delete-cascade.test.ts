// Migration 0012 (D-255; D-104, D-193, NFR-005): a run is deletable whole, and only whole.
//
// `courses.deleteWalkthroughRun` is the one control in the product meant to remove a run (D-104),
// and since Phase 6 gave a run children it could not remove one that had done anything: migration
// 0005 declared every child foreign key `ON DELETE no action`, so `DELETE FROM runs` raised 23503 on
// the first trace event. Deleting the children first was never open to the application either —
// migration 0009 revokes DELETE on `run_events`, `run_frames`, `run_turn_responses` and
// `run_addenda` from `tassl_app`, because the trace and the frame are the record.
//
// **The claims these tests exist to make.**
//
//   1. Every foreign key that points at `runs.id` cascades — read out of `pg_constraint`, not out of
//      a list this file keeps, so a table a later phase adds with `no action` fails here rather than
//      in a walkthrough. The two exceptions are named: the re-offer links join two runs, and a
//      delete must never reach across into the other attempt.
//   2. One row in all twenty-one child tables, and the run takes every one of them with it — while
//      the assignment, the package, the student and the institution are untouched.
//   3. The delete works **as `tassl_app`**, the role preview and production connect with, which is
//      the whole point: a referential action runs with the owning table's privileges rather than the
//      deleting role's. That is what lets an instructor discard a walkthrough run through a role that
//      may not rewrite a single trace event.
//   4. Nothing about that weakens 0009. The same role, in the same connection, is still refused a
//      direct DELETE and a direct UPDATE on all four append-only tables. Nobody may edit a record;
//      an instructor may discard a whole run.
// @db:truncate
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

/** The application role as preview and production run it (D-085, D-110); the password is local. */
const appSql = postgres(
  (() => {
    const url = new URL(TEST_DATABASE_URL)
    url.username = 'tassl_app'
    url.password = 'test'
    return url.toString()
  })(),
  { max: 1, prepare: false },
)

/**
 * The two references that must survive a delete, by column. Everything else that points at
 * `runs.id` is a child of the run and follows it.
 */
const NOT_A_CHILD = ['re_offered_from_run_id', 're_offered_to_run_id'] as const

type Chain = {
  organizationId: string
  userId: string
  assignmentId: string
  packageVersionId: string
  claimId: string
  documentId: string
  readinessItemId: string
  defenseQuestionId: string
  runId: string
  partnerRunId: string
}

/** The parent chain a run needs, plus the package elements its children point at, in one draft
 *  version — the `package_element_frozen` triggers of migration 0004 refuse element writes once a
 *  version is confirmed, and nothing here needs it confirmed. */
async function createRunChain(): Promise<Chain> {
  const organizationId = crypto.randomUUID()
  const userId = crypto.randomUUID()

  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${organizationId}, 'Walkthrough U', ${`org-${organizationId.slice(0, 8)}`}, now())`
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Seat One', ${`${userId}@example.test`}, true, now(), now())`
  const [course] = await testSql<{ id: string }[]>`
    insert into courses (organization_id, name, term, created_by)
    values (${organizationId}, 'Marketing Strategy', '2026-fall', ${userId}) returning id`
  const [section] = await testSql<{ id: string }[]>`
    insert into sections (organization_id, course_id, name)
    values (${organizationId}, ${course!.id}, 'A') returning id`
  const [pkg] = await testSql<{ id: string }[]>`
    insert into scenario_packages (organization_id, title, family_key, created_by)
    values (${organizationId}, 'Meridian Roast', ${`fam-${organizationId.slice(0, 8)}`}, ${userId})
    returning id`
  const [version] = await testSql<{ id: string }[]>`
    insert into scenario_package_versions (organization_id, package_id, version, concept_set)
    values (${organizationId}, ${pkg!.id}, 1, '{pricing,cannibalization,unit_economics,evidence}')
    returning id`
  const [variant] = await testSql<{ id: string }[]>`
    insert into scenario_variants (package_version_id, key, label)
    values (${version!.id}, 'defective', 'Defective') returning id`
  const [assignment] = await testSql<{ id: string }[]>`
    insert into assignments (organization_id, section_id, label, package_version_id, variant_id,
      is_walkthrough)
    values (${organizationId}, ${section!.id}, 'Decision Run 1 (walkthrough)', ${version!.id},
      ${variant!.id}, true)
    returning id`

  const [claim] = await testSql<{ id: string }[]>`
    insert into scenario_claims (package_version_id, key, text, source_kind, importance,
      consequence_level, verification_cost, concept_key, position)
    values (${version!.id}, 'premium-payback', 'Premium payback is four months', 'assistant',
      'load_bearing', 'high', 'moderate', 'unit_economics', 0)
    returning id`
  const [document] = await testSql<{ id: string }[]>`
    insert into scenario_documents (package_version_id, key, title, author, dated_on, body,
      word_count, role, position)
    values (${version!.id}, 'cohort-table', 'Cohort table', 'Finance', '2026-03-01',
      'The cohort table.', 3, 'supporting', 0)
    returning id`
  const [item] = await testSql<{ id: string }[]>`
    insert into readiness_items (package_version_id, key, category, concept_key, stem, options,
      answer_key, position)
    values (${version!.id}, 'payback', 'foundation', 'unit_economics', 'What is payback?',
      '[{"key":"a","text":"One"},{"key":"b","text":"Two"}]'::jsonb, 'a', 0)
    returning id`
  const [question] = await testSql<{ id: string }[]>`
    insert into defense_questions (package_version_id, key, kind, template, condition, follow_up,
      expected_answer_notes, position)
    values (${version!.id}, 'provenance-1', 'provenance', 'Where did that figure come from?',
      '{}'::jsonb, 'And how did you check it?', 'Names the cohort table.', 0)
    returning id`

  const insertRun = async (attemptNo: number): Promise<string> => {
    const [run] = await testSql<{ id: string }[]>`
      insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
        attempt_no, is_walkthrough, working_clock_seconds, turn_delay_seconds)
      values (${organizationId}, ${assignment!.id}, ${userId}, ${version!.id}, ${variant!.id},
        ${attemptNo}, true, 1500, 90)
      returning id`
    return run!.id
  }
  const runId = await insertRun(1)
  const partnerRunId = await insertRun(2)
  // The re-offer pair, pointing both ways (10 §3): attempt 2 was offered in place of attempt 1.
  await testSql`update runs set re_offered_to_run_id = ${partnerRunId} where id = ${runId}`
  await testSql`update runs set re_offered_from_run_id = ${runId} where id = ${partnerRunId}`

  return {
    organizationId,
    userId,
    assignmentId: assignment!.id,
    packageVersionId: version!.id,
    claimId: claim!.id,
    documentId: document!.id,
    readinessItemId: item!.id,
    defenseQuestionId: question!.id,
    runId,
    partnerRunId,
  }
}

/** One row in every table that references `runs.id`, so the delete has something to take. */
async function fillEveryChild(c: Chain): Promise<void> {
  const run = c.runId

  await testSql`
    insert into run_events (run_id, seq, type, occurred_at, actor_id, payload)
    values (${run}, 1, 'lifecycle', now(), ${c.userId}, '{"from":"assigned","to":"readiness"}')`
  await testSql`
    insert into run_readiness_answers (run_id, item_id, answer_key, correct)
    values (${run}, ${c.readinessItemId}, 'a', true)`
  await testSql`
    insert into run_readiness_results (run_id, submitted_at, concepts)
    values (${run}, now(), '{"unit_economics":"held"}'::jsonb)`
  await testSql`
    insert into run_document_opens (run_id, document_id, opened_at, before_first_delegation)
    values (${run}, ${c.documentId}, now(), true)`
  await testSql`
    insert into run_frames (run_id, decision, assumptions, position, confidence, locked_at)
    values (${run}, 'Hold the value tier', '{"a","b","c"}', 'Lean toward holding', 40, now())`
  await testSql`
    insert into run_delegations (run_id, seq, request_text) values (${run}, 1, 'Summarize the room')`
  const [claimRow] = await testSql<{ id: string }[]>`
    insert into run_claims (run_id, claim_id, surfaced_at, surfaced_by, stance)
    values (${run}, ${c.claimId}, now(), 'delegation', 'accept') returning id`
  await testSql`
    insert into run_actions (run_id, claim_id, type, clock_cost_ms, result, started_at, completed_at)
    values (${run}, ${c.claimId}, 'source_trace', 180000, '{"found":true}'::jsonb, now(), now())`
  await testSql`
    insert into run_escalations (run_id, claim_id, statement, response_id, response_text,
      counts_against_limit)
    values (${run}, ${c.claimId}, 'Are you sure?', 'claim', 'I am', true)`
  await testSql`insert into run_briefs (run_id) values (${run})`
  await testSql`insert into run_addenda (run_id, text) values (${run}, 'One more thing')`
  await testSql`
    insert into run_turn_responses (run_id, response, justification, confidence, locked_at)
    values (${run}, 'hold', 'The payback figure still stands', 45, now())`
  const [questionRow] = await testSql<{ id: string }[]>`
    insert into run_defense_questions (run_id, question_id, seq, rendered_text, asked_at)
    values (${run}, ${c.defenseQuestionId}, 1, 'Where did that figure come from?', now())
    returning id`
  // A follow-up of the question above: the self-reference has to fall with its parent too.
  await testSql`
    insert into run_defense_questions (run_id, question_id, seq, rendered_text, follow_up_of, asked_at)
    values (${run}, ${c.defenseQuestionId}, 2, 'And how did you check it?', ${questionRow!.id}, now())`
  await testSql`
    insert into run_defense_answers (run_id, run_defense_question_id, text, duration_ms, answered_at)
    values (${run}, ${questionRow!.id}, 'The cohort table', 40000, now())`
  await testSql`
    insert into run_pauses (run_id, cause, paused_at) values (${run}, 'assistant_failure', now())`
  await testSql`
    insert into run_bands (run_id, dimension, draft_status, basis)
    values (${run}, 'framing', 'drafted', 'trace')`
  await testSql`
    insert into run_scores (run_id, rubric_version, graphs, scored_at)
    values (${run}, 'v1', '{}'::jsonb, now())`
  const [neutralization] = await testSql<{ id: string }[]>`
    insert into claim_neutralizations (run_id, claim_id, reason, actor_id)
    values (${run}, ${c.claimId}, 'unintended_defect', ${c.userId}) returning id`
  // The one reference that is SET NULL rather than CASCADE, exercised inside the run's own delete.
  await testSql`
    update run_claims set neutralization_id = ${neutralization!.id} where id = ${claimRow!.id}`
  await testSql`
    insert into run_debrief_answers (run_id, stance_to_change, do_differently, answered_at)
    values (${run}, 'The payback claim', 'Check the cohort table first', now())`
  await testSql`
    insert into run_records (run_id, snapshot) values (${run}, '{"bands":[]}'::jsonb)`
  await testSql`
    insert into course_exports (organization_id, run_id, assignment_id, version, file, reason,
      created_by)
    values (${c.organizationId}, ${run}, ${c.assignmentId}, 1, '{"run_id":"x"}'::jsonb, 'initial',
      ${c.userId})`
}

/** Every table that references `runs.id`, read from the catalogue rather than from a list here. */
async function childTables(): Promise<string[]> {
  const rows = await testSql<{ child: string }[]>`
    select distinct r.relname as child
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where c.contype = 'f' and c.confrelid = 'public.runs'::regclass and r.relname <> 'runs'
    order by 1`
  return rows.map((row) => row.child)
}

/** How many rows each child table holds for one run. */
async function childCounts(runId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of await childTables()) {
    const [row] = await testSql.unsafe<{ count: string }[]>(
      `select count(*)::text as count from "public"."${table}" where run_id = $1`,
      [runId],
    )
    counts[table] = Number(row?.count ?? 0)
  }
  return counts
}

let chain: Chain

beforeAll(async () => {
  await truncateAll()
  chain = await createRunChain()
  await fillEveryChild(chain)
})

afterAll(async () => {
  await appSql.end({ timeout: 5 })
  await truncateAll()
})

describe('foreign keys that reference runs.id', () => {
  it('all cascade, except the re-offer links, which are set null', async () => {
    const rows = await testSql<{ conname: string; child: string; col: string; action: string }[]>`
      select c.conname, r.relname as child, a.attname as col, c.confdeltype::text as action
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join unnest(c.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.confrelid = 'public.runs'::regclass
      order by r.relname, a.attname`

    // Something is being asserted about: the run has twenty-one child tables today.
    expect(rows.length).toBeGreaterThanOrEqual(23)

    const wrong = rows.filter((row) => {
      const expected = (NOT_A_CHILD as readonly string[]).includes(row.col) ? 'n' : 'c'
      return row.action !== expected
    })
    expect(wrong.map((row) => `${row.conname} (${row.action})`)).toEqual([])
  })

  it('the trace and the frame still refuse the application role directly', async () => {
    // 0009 is untouched by 0012: the cascade is the only way these rows can go, and it can only be
    // reached by deleting the run they belong to.
    for (const table of ['run_events', 'run_frames', 'run_turn_responses', 'run_addenda']) {
      await expect(
        appSql.unsafe(`delete from "public"."${table}" where run_id = $1`, [chain.runId]),
      ).rejects.toThrow(/permission denied/)
      await expect(
        appSql.unsafe(`update "public"."${table}" set run_id = run_id where run_id = $1`, [
          chain.runId,
        ]),
      ).rejects.toThrow(/permission denied/)
    }
  })
})

describe('deleting a run', () => {
  it('takes every child row with it, as tassl_app, and leaves the run it was re-offered to', async () => {
    const before = await childCounts(chain.runId)
    // Every child table holds a row, so every one of them is actually under test.
    expect(Object.entries(before).filter(([, count]) => count === 0)).toEqual([])

    const deleted = await appSql`delete from runs where id = ${chain.runId} returning id`
    expect(deleted).toHaveLength(1)

    const after = await childCounts(chain.runId)
    expect(Object.entries(after).filter(([, count]) => count !== 0)).toEqual([])

    // The other attempt of the pair is a run, not a child of one: it stays, and only the pointer
    // to the discarded attempt is cleared.
    const [partner] = await testSql<{ id: string; re_offered_from_run_id: string | null }[]>`
      select id, re_offered_from_run_id from runs where id = ${chain.partnerRunId}`
    expect(partner).toMatchObject({ id: chain.partnerRunId, re_offered_from_run_id: null })

    // Nothing above the run moves: the delete is confined to the run and what belongs to it.
    for (const [table, id] of [
      ['assignments', chain.assignmentId],
      ['scenario_package_versions', chain.packageVersionId],
      ['scenario_claims', chain.claimId],
      ['scenario_documents', chain.documentId],
      ['readiness_items', chain.readinessItemId],
      ['defense_questions', chain.defenseQuestionId],
      ['organization', chain.organizationId],
    ] as const) {
      const rows = await testSql.unsafe(`select 1 from "public"."${table}" where id = $1`, [id])
      expect(rows, table).toHaveLength(1)
    }
    const users = await testSql`select 1 from "user" where id = ${chain.userId}`
    expect(users).toHaveLength(1)
  })
})
