// Step 2.8 (D-006, D-020): the `runs`, `trace`, `assistant`, and `reliance` repositories against the
// test database — one insert-and-read pair per function, tenant filtering on the run row, cursor
// pagination on the student's run list, and the upsert/guard semantics the services rely on.
// @db:truncate
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

// The db client reads DATABASE_URL when it is first imported; point it at the test database before
// the repositories (and everything under @/server) load, hence the dynamic imports in beforeAll.
process.env.DATABASE_URL = TEST_DATABASE_URL

type RunsRepo = typeof import('@/server/modules/runs/repository')
type TraceRepo = typeof import('@/server/modules/trace/repository')
type AssistantRepo = typeof import('@/server/modules/assistant/repository')
type RelianceRepo = typeof import('@/server/modules/reliance/repository')
type TxModule = typeof import('@/server/db/tx')

let runsRepo: RunsRepo
let traceRepo: TraceRepo
let assistantRepo: AssistantRepo
let relianceRepo: RelianceRepo
let withTransaction: TxModule['withTransaction']

beforeAll(async () => {
  ;[runsRepo, traceRepo, assistantRepo, relianceRepo] = await Promise.all([
    import('@/server/modules/runs/repository'),
    import('@/server/modules/trace/repository'),
    import('@/server/modules/assistant/repository'),
    import('@/server/modules/reliance/repository'),
  ])
  withTransaction = (await import('@/server/db/tx')).withTransaction
})

afterEach(async () => {
  await truncateAll()
})

type Chain = {
  organizationId: string
  userId: string
  packageVersionId: string
  variantId: string
  sectionId: string
  assignmentId: string
  claimId: string
  documentId: string
  itemId: string
}

/** The minimal parent chain a run needs, plus one claim, one document, and one readiness item. */
async function seedChain(): Promise<Chain> {
  const organizationId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const courseId = crypto.randomUUID()
  const sectionId = crypto.randomUUID()
  const packageId = crypto.randomUUID()
  const packageVersionId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const assignmentId = crypto.randomUUID()
  const claimId = crypto.randomUUID()
  const documentId = crypto.randomUUID()
  const itemId = crypto.randomUUID()

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
    insert into scenario_documents (id, package_version_id, key, title, author, dated_on, body,
                                    word_count, role, position)
    values (${documentId}, ${packageVersionId}, 'D1', 'Pilot results', 'Ops', '2026-06-01',
            'Churn fell after the pilot.', 5, 'supporting', 1)`
  await testSql`
    insert into scenario_claims (id, package_version_id, key, text, source_kind, source_document_id,
                                 importance, consequence_level, verification_cost, concept_key,
                                 escalatable, escalation_reply, position)
    values (${claimId}, ${packageVersionId}, 'C1', 'Churn fell 12% after the pilot.', 'document',
            ${documentId}, 'load_bearing', 'high', 'cheap', 'segmentation', true,
            'The pilot covered one region.', 1)`
  await testSql`
    insert into readiness_items (id, package_version_id, key, category, concept_key, stem, options,
                                 answer_key, position)
    values (${itemId}, ${packageVersionId}, 'R1', 'foundation', 'segmentation', 'What is churn?',
            '[{"key":"a","text":"Lost customers"},{"key":"b","text":"New customers"}]'::jsonb,
            'a', 1)`

  return {
    organizationId,
    userId,
    packageVersionId,
    variantId,
    sectionId,
    assignmentId,
    claimId,
    documentId,
    itemId,
  }
}

/** Another seat, for a second run on the same assignment. */
async function seedStudent(name: string): Promise<string> {
  const userId = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, ${name}, ${`${userId}@example.test`}, true, now(), now())`
  return userId
}

/** Another assignment in the same section, for a second run by the same student. */
async function seedAssignment(chain: Chain, label: string): Promise<string> {
  const assignmentId = crypto.randomUUID()
  await testSql`
    insert into assignments (id, organization_id, section_id, label, package_version_id, variant_id)
    values (${assignmentId}, ${chain.organizationId}, ${chain.sectionId}, ${label},
            ${chain.packageVersionId}, ${chain.variantId})`
  return assignmentId
}

/**
 * One run, by default the chain's student on the chain's assignment.
 *
 * Bumping `attemptNo` is not how a second run is made: one run per student per assignment is live
 * at a time (D-041), which `runs_assignment_id_student_id_live_uidx` enforces (D-259). A second run
 * belongs to another student (`seedStudent`), to another assignment (`seedAssignment`), or to a
 * re-offer, which voids the attempt it replaces first — `reofferRun`.
 */
async function seedRun(
  chain: Chain,
  where: { studentId?: string; assignmentId?: string; attemptNo?: number } = {},
) {
  const { studentId = chain.userId, assignmentId = chain.assignmentId, attemptNo = 1 } = where
  return runsRepo.insertRun(chain.organizationId, {
    assignmentId,
    studentId,
    packageVersionId: chain.packageVersionId,
    variantId: chain.variantId,
    attemptNo,
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })
}

/**
 * The only way a student holds a second run on one assignment (FR-183, D-041): the re-offer voids
 * the attempt it replaces *first*, and then writes the next one, the two rows pointing at each
 * other. Returns the new attempt.
 */
async function reofferRun(
  chain: Chain,
  previous: { id: string; assignmentId: string; studentId: string; attemptNo: number },
) {
  await runsRepo.updateRun(chain.organizationId, previous.id, {
    state: 'voided',
    voidedAt: new Date(),
  })
  const next = await runsRepo.insertRun(chain.organizationId, {
    assignmentId: previous.assignmentId,
    studentId: previous.studentId,
    packageVersionId: chain.packageVersionId,
    variantId: chain.variantId,
    attemptNo: previous.attemptNo + 1,
    reOfferedFromRunId: previous.id,
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })
  await runsRepo.updateRun(chain.organizationId, previous.id, { reOfferedToRunId: next.id })
  return next
}

const OTHER_TENANT = 'org_other_tenant'

describe('runs repository', () => {
  it('inserts a run and reads it back only within its tenant', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    expect(run).toMatchObject({
      organizationId: chain.organizationId,
      state: 'assigned',
      attemptNo: 1,
      nextEventSeq: 1,
    })

    const locked = await withTransaction((tx) =>
      runsRepo.findRunForUpdate(chain.organizationId, run.id, tx),
    )
    expect(locked?.id).toBe(run.id)
    expect(await runsRepo.findRunForUpdate(OTHER_TENANT, run.id)).toBeUndefined()

    const full = await runsRepo.findRunFull(chain.organizationId, run.id)
    expect(full?.run.id).toBe(run.id)
    expect(full).toMatchObject({
      frame: null,
      brief: null,
      addendum: null,
      turnResponse: null,
      readiness: null,
      documentOpens: [],
      pauses: [],
    })
    expect(await runsRepo.findRunFull(OTHER_TENANT, run.id)).toBeUndefined()
  })

  it('updates the run row within its tenant and allocates the next attempt number', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)

    expect(await runsRepo.updateRun(OTHER_TENANT, run.id, { state: 'readiness' })).toBeUndefined()
    const now = new Date()
    const updated = await runsRepo.updateRun(chain.organizationId, run.id, {
      state: 'readiness',
      readinessStartedAt: now,
      flags: { readiness_submit_failed: true },
    })
    expect(updated).toMatchObject({
      state: 'readiness',
      readinessStartedAt: now,
      flags: { readiness_submit_failed: true },
    })

    expect(
      await runsRepo.nextAttemptNo(chain.organizationId, chain.assignmentId, chain.userId),
    ).toBe(2)
    expect(await runsRepo.nextAttemptNo(OTHER_TENANT, chain.assignmentId, chain.userId)).toBe(1)
  })

  it('upserts readiness answers per item and stores the result', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)

    const first = await runsRepo.insertReadinessAnswer(run.id, {
      itemId: chain.itemId,
      answerKey: 'b',
      correct: false,
    })
    const second = await runsRepo.insertReadinessAnswer(run.id, {
      itemId: chain.itemId,
      answerKey: 'a',
      correct: true,
    })
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ answerKey: 'a', correct: true })

    const answers = await runsRepo.listReadinessAnswers(run.id)
    expect(answers).toHaveLength(1)
    expect(answers[0]?.answerKey).toBe('a')

    const result = await runsRepo.insertReadinessResult(run.id, {
      submittedAt: new Date(),
      concepts: [{ concept_key: 'segmentation', status: 'held', correct: 1, total: 1 }],
    })
    expect(result.concepts[0]?.status).toBe('held')
    const full = await runsRepo.findRunFull(chain.organizationId, run.id)
    expect(full?.readiness?.runId).toBe(run.id)
  })

  it('records document opens and closes an open record once', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    const openedAt = new Date()

    const open = await runsRepo.insertDocumentOpen(run.id, {
      documentId: chain.documentId,
      openedAt,
      beforeFirstDelegation: true,
    })
    expect(open).toMatchObject({ runId: run.id, closedAt: null, inTurnWindow: false })

    const closedAt = new Date(openedAt.getTime() + 12_000)
    const closed = await runsRepo.closeDocumentOpen(run.id, open.id, {
      closedAt,
      durationMs: 12_000,
      skim: false,
    })
    expect(closed).toMatchObject({ id: open.id, closedAt, durationMs: 12_000, skim: false })

    expect(
      await runsRepo.closeDocumentOpen(run.id, open.id, { closedAt, durationMs: 1, skim: true }),
    ).toBeUndefined()
    expect(
      await runsRepo.closeDocumentOpen(crypto.randomUUID(), open.id, {
        closedAt,
        durationMs: 1,
        skim: true,
      }),
    ).toBeUndefined()

    const full = await runsRepo.findRunFull(chain.organizationId, run.id)
    expect(full?.documentOpens.map((o) => o.id)).toEqual([open.id])
  })

  it('locks the frame, drafts and locks the brief, and keeps one addendum', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)

    const frame = await runsRepo.insertFrame(run.id, {
      decision: 'Launch in Q3',
      assumptions: ['a', 'b', 'c'],
      position: 'defensible',
      confidence: 60,
      lockedAt: new Date(),
    })
    expect(frame.assumptions).toEqual(['a', 'b', 'c'])

    const draft = await runsRepo.upsertBriefDraft(run.id, { recommendation: 'Launch' })
    expect(draft).toMatchObject({ runId: run.id, recommendation: 'Launch', lockedAt: null })
    const redraft = await runsRepo.upsertBriefDraft(run.id, {
      rationale: 'Because',
      namedValues: { churn_pct: 12 },
    })
    expect(redraft).toMatchObject({
      recommendation: 'Launch',
      rationale: 'Because',
      namedValues: { churn_pct: 12 },
    })
    expect(redraft?.draftUpdatedAt.getTime()).toBeGreaterThanOrEqual(
      draft?.draftUpdatedAt.getTime() ?? Infinity,
    )

    const lockedAt = new Date()
    const locked = await runsRepo.lockBrief(run.id, {
      recommendation: 'Launch in Q3',
      confidence: 70,
      lockedAt,
      speedOutlier: true,
    })
    expect(locked).toMatchObject({
      recommendation: 'Launch in Q3',
      rationale: 'Because',
      confidence: 70,
      lockedAt,
      autoLocked: false,
      speedOutlier: true,
    })
    // Locked briefs are immutable: both the draft path and a second lock return nothing.
    expect(await runsRepo.upsertBriefDraft(run.id, { recommendation: 'Delay' })).toBeUndefined()
    expect(await runsRepo.lockBrief(run.id, { lockedAt: new Date() })).toBeUndefined()

    // A lock with no prior draft creates the row. That second run is the other seat on the same
    // assignment, not a second attempt by this student: one live run per pair (D-041, D-259).
    const other = await seedRun(chain, { studentId: await seedStudent('Seat Two') })
    const direct = await runsRepo.lockBrief(other.id, { recommendation: 'Hold', lockedAt })
    expect(direct).toMatchObject({ runId: other.id, recommendation: 'Hold', lockedAt })

    const addendum = await runsRepo.insertAddendum(run.id, 'One more thing.')
    expect(addendum?.text).toBe('One more thing.')
    expect(await runsRepo.insertAddendum(run.id, 'Another.')).toBeUndefined()

    const full = await runsRepo.findRunFull(chain.organizationId, run.id)
    expect(full?.frame?.decision).toBe('Launch in Q3')
    expect(full?.brief?.lockedAt).toEqual(lockedAt)
    expect(full?.addendum?.text).toBe('One more thing.')
  })

  it('stores the Turn response and credits pauses on resume', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)

    const response = await runsRepo.insertTurnResponse(run.id, {
      response: 'revise',
      justification: 'The supplier notice changes the timeline.',
      confidence: 55,
      lockedAt: new Date(),
    })
    expect(response).toMatchObject({ runId: run.id, response: 'revise', implicit: false })

    const pausedAt = new Date()
    const pause = await runsRepo.insertPause(run.id, { cause: 'assistant_failure', pausedAt })
    expect(pause).toMatchObject({ resumedAt: null, creditedMs: 0 })

    const resumedAt = new Date(pausedAt.getTime() + 5_000)
    const resumed = await runsRepo.resumePause(run.id, pause.id, { resumedAt, creditedMs: 5_000 })
    expect(resumed).toMatchObject({ id: pause.id, resumedAt, creditedMs: 5_000 })
    expect(
      await runsRepo.resumePause(run.id, pause.id, { resumedAt, creditedMs: 1 }),
    ).toBeUndefined()

    const full = await runsRepo.findRunFull(chain.organizationId, run.id)
    expect(full?.turnResponse?.response).toBe('revise')
    expect(full?.pauses).toHaveLength(1)
  })

  it('lists a student runs newest first with cursor pagination inside the tenant', async () => {
    const chain = await seedChain()
    // The three runs a student can actually hold: a first attempt that was voided and re-offered,
    // the attempt taken in its place, and a run on a second assignment. Two live runs on one
    // assignment is not a state the product can reach (D-041, D-259).
    const first = await seedRun(chain)
    const second = await reofferRun(chain, first)
    const secondAssignmentId = await seedAssignment(chain, 'Run 2')
    const third = await seedRun(chain, { assignmentId: secondAssignmentId })

    const page1 = await runsRepo.listRunsForStudent(chain.organizationId, chain.userId, {
      limit: 2,
    })
    expect(page1.items.map((i) => i.run.id)).toEqual([third.id, second.id])
    // The labels are per row, not per list: the newest run is the one on the second assignment.
    expect(page1.items[0]).toMatchObject({
      id: third.id,
      assignment: { id: secondAssignmentId, label: 'Run 2', runType: 'decision' },
      variant: { id: chain.variantId, key: 'defective' },
    })
    expect(page1.items[1]).toMatchObject({
      id: second.id,
      run: { attemptNo: 2, reOfferedFromRunId: first.id },
      assignment: { id: chain.assignmentId, label: 'Run 1' },
    })
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await runsRepo.listRunsForStudent(chain.organizationId, chain.userId, {
      limit: 2,
      cursor: page1.nextCursor,
    })
    expect(page2.items.map((i) => i.run.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeNull()

    // The voided attempt stays in the student's list and is the one the state filter finds.
    const voided = await runsRepo.listRunsForStudent(chain.organizationId, chain.userId, {
      state: 'voided',
    })
    expect(voided.items.map((i) => i.run.id)).toEqual([first.id])

    const other = await runsRepo.listRunsForStudent(OTHER_TENANT, chain.userId)
    expect(other.items).toEqual([])
  })
})

describe('trace repository', () => {
  it('appends events at the seq the service allocated and lists them in order', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    const occurredAt = new Date()

    const first = await traceRepo.insertEvent(run.id, {
      seq: 1,
      type: 'policy_displayed',
      occurredAt,
      actorId: chain.userId,
      payload: { outside_ai_policy: 'declared', run_type: 'decision', counts_statement: true },
    })
    const second = await traceRepo.insertEvent(run.id, {
      seq: 2,
      type: 'lifecycle',
      occurredAt,
      payload: { from: 'assigned', to: 'readiness', cause: 'policy_acknowledged' },
    })
    await traceRepo.insertEvent(run.id, {
      seq: 3,
      type: 'lifecycle',
      occurredAt,
      clockRemainingMs: null,
      payload: { from: 'readiness', to: 'framing', cause: 'readiness_submitted' },
    })
    expect(first).toMatchObject({ runId: run.id, seq: 1, actorId: chain.userId })
    expect(second.actorId).toBeNull()

    const all = await traceRepo.listEventsForRun(run.id)
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(all[0]?.payload).toEqual({
      outside_ai_policy: 'declared',
      run_type: 'decision',
      counts_statement: true,
    })

    const lifecycle = await traceRepo.listEventsByType(run.id, 'lifecycle')
    expect(lifecycle.map((e) => e.seq)).toEqual([2, 3])
    const several = await traceRepo.listEventsByType(run.id, ['policy_displayed', 'lifecycle'])
    expect(several).toHaveLength(3)
    expect(await traceRepo.listEventsByType(run.id, [])).toEqual([])
    expect(await traceRepo.listEventsByType(run.id, 'delegation')).toEqual([])
    expect(await traceRepo.listEventsForRun(crypto.randomUUID())).toEqual([])
  })

  it('refuses a duplicate seq on the same run', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    await traceRepo.insertEvent(run.id, {
      seq: 1,
      type: 'lifecycle',
      occurredAt: new Date(),
      payload: {},
    })
    // Drizzle wraps the driver error; the Postgres unique_violation code travels in `cause`.
    const failure: unknown = await traceRepo
      .insertEvent(run.id, { seq: 1, type: 'lifecycle', occurredAt: new Date(), payload: {} })
      .then(() => undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    const cause = (failure as Error).cause as { code?: string; message?: string } | undefined
    expect(cause?.code).toBe('23505')
    expect(cause?.message).toMatch(/unique|duplicate/)
  })
})

describe('assistant repository', () => {
  it('allocates delegation seqs, completes, fails, and edits delegations on the run', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)

    const first = await assistantRepo.insertDelegation(run.id, {
      requestText: 'Summarize the pilot results.',
      clockRemainingMs: 1_400_000,
    })
    expect(first).toMatchObject({ runId: run.id, seq: 1, responseText: '', failed: false })

    const second = await assistantRepo.insertDelegation(run.id, {
      requestText: 'What did the supplier say?',
      inTurnWindow: true,
    })
    expect(second.seq).toBe(2)

    const explicit = await assistantRepo.insertDelegation(run.id, {
      seq: 7,
      requestText: 'Explicit seq.',
    })
    expect(explicit.seq).toBe(7)

    const completed = await assistantRepo.completeDelegation(run.id, first.id, {
      responseText: 'Churn fell 12% after the pilot.',
      claimIds: [chain.claimId],
      flags: ['numeric_guard'],
      unverifiedNumbers: [{ value: '12%', context: 'churn' }],
    })
    expect(completed).toMatchObject({
      id: first.id,
      responseText: 'Churn fell 12% after the pilot.',
      claimIds: [chain.claimId],
      flags: ['numeric_guard'],
      unverifiedNumbers: [{ value: '12%', context: 'churn' }],
    })

    const failed = await assistantRepo.failDelegation(run.id, second.id)
    expect(failed).toMatchObject({ id: second.id, failed: true, responseText: '' })

    const edited = await assistantRepo.updateDelegation(run.id, first.id, {
      why: 'Needed the headline number.',
      flags: ['numeric_guard', 'out_of_scenario'],
    })
    expect(edited).toMatchObject({
      why: 'Needed the headline number.',
      flags: ['numeric_guard', 'out_of_scenario'],
    })

    const list = await assistantRepo.listDelegations(run.id)
    expect(list.map((d) => d.seq)).toEqual([1, 2, 7])

    // Another run id never reaches these rows.
    const stranger = crypto.randomUUID()
    expect(await assistantRepo.updateDelegation(stranger, first.id, { why: 'x' })).toBeUndefined()
    expect(await assistantRepo.failDelegation(stranger, first.id)).toBeUndefined()
    expect(
      await assistantRepo.completeDelegation(stranger, first.id, { responseText: 'x' }),
    ).toBeUndefined()
    expect(await assistantRepo.listDelegations(stranger)).toEqual([])
  })
})

describe('reliance repository', () => {
  it('surfaces a claim once, sets stances, and tracks reliance routes', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    const surfacedAt = new Date()

    const first = await relianceRepo.upsertRunClaim(run.id, {
      claimId: chain.claimId,
      surfacedAt,
      surfacedBy: 'delegation',
      surfacedById: crypto.randomUUID(),
    })
    expect(first.inserted).toBe(true)
    expect(first.runClaim).toMatchObject({
      runId: run.id,
      claimId: chain.claimId,
      stance: null,
      reliedOn: false,
      reliedOnVia: [],
    })

    const again = await relianceRepo.upsertRunClaim(run.id, {
      claimId: chain.claimId,
      surfacedAt: new Date(),
      surfacedBy: 'document',
    })
    expect(again.inserted).toBe(false)
    expect(again.runClaim.id).toBe(first.runClaim.id)
    expect(again.runClaim.surfacedBy).toBe('delegation')

    expect((await relianceRepo.findRunClaim(run.id, chain.claimId))?.id).toBe(first.runClaim.id)
    expect(await relianceRepo.findRunClaim(crypto.randomUUID(), chain.claimId)).toBeUndefined()

    const accepted = await relianceRepo.setStance(run.id, chain.claimId, {
      stance: 'accept',
      stanceSetAt: new Date(),
    })
    expect(accepted).toMatchObject({ stance: 'accept', previousStance: null })
    const challenged = await relianceRepo.setStance(run.id, chain.claimId, {
      stance: 'challenge',
      stanceSetAt: new Date(),
    })
    expect(challenged).toMatchObject({ stance: 'challenge', previousStance: 'accept' })

    const marked = await relianceRepo.updateReliedOn(run.id, chain.claimId, {
      via: 'log_mark',
      usedMarked: true,
    })
    expect(marked).toMatchObject({ reliedOn: true, reliedOnVia: ['log_mark'], usedMarked: true })
    const repeated = await relianceRepo.updateReliedOn(run.id, chain.claimId, { via: 'log_mark' })
    expect(repeated?.reliedOnVia).toEqual(['log_mark'])
    const field = await relianceRepo.updateReliedOn(run.id, chain.claimId, { via: 'named_field' })
    expect(field?.reliedOnVia).toEqual(['log_mark', 'named_field'])
    expect(field?.usedMarked).toBe(true)
    expect(
      await relianceRepo.updateReliedOn(crypto.randomUUID(), chain.claimId, { via: 'log_mark' }),
    ).toBeUndefined()
  })

  it('lists run claims with their scenario claims and the lock-gate filter', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    const secondClaimId = crypto.randomUUID()
    await testSql`
      insert into scenario_claims (id, package_version_id, key, text, source_kind, importance,
                                   consequence_level, verification_cost, concept_key, position)
      values (${secondClaimId}, ${chain.packageVersionId}, 'C2', 'Margins hold at 40%.', 'assistant',
              'supporting', 'medium', 'moderate', 'pricing', 2)`

    await relianceRepo.upsertRunClaim(run.id, {
      claimId: chain.claimId,
      surfacedAt: new Date('2026-09-01T09:00:00Z'),
      surfacedBy: 'document',
      surfacedById: chain.documentId,
    })
    await relianceRepo.upsertRunClaim(run.id, {
      claimId: secondClaimId,
      surfacedAt: new Date('2026-09-01T09:05:00Z'),
      surfacedBy: 'turn',
      inTurnWindow: true,
      reliedOnVia: ['turn_window'],
    })

    const all = await relianceRepo.listRunClaims(run.id)
    expect(all.map((r) => r.claim.key)).toEqual(['C1', 'C2'])
    expect(all[0]?.claim).toMatchObject({
      text: 'Churn fell 12% after the pilot.',
      sourceDocumentId: chain.documentId,
      escalatable: true,
    })
    expect(all[1]?.runClaim).toMatchObject({ reliedOn: true, inTurnWindow: true })

    const unstancedReliedOn = await relianceRepo.listRunClaims(run.id, {
      reliedOn: true,
      unstanced: true,
    })
    expect(unstancedReliedOn.map((r) => r.runClaim.claimId)).toEqual([secondClaimId])

    await relianceRepo.setStance(run.id, secondClaimId, {
      stance: 'verify',
      stanceSetAt: new Date(),
    })
    expect(await relianceRepo.listRunClaims(run.id, { reliedOn: true, unstanced: true })).toEqual(
      [],
    )
    expect(
      (await relianceRepo.listRunClaims(run.id, { reliedOn: false })).map((r) => r.claim.key),
    ).toEqual(['C1'])
    expect(await relianceRepo.listRunClaims(crypto.randomUUID())).toEqual([])
  })

  it('records actions and escalations and counts only the ones against the limit', async () => {
    const chain = await seedChain()
    const run = await seedRun(chain)
    const startedAt = new Date()

    const action = await relianceRepo.insertAction(run.id, {
      claimId: chain.claimId,
      type: 'source_trace',
      clockCostMs: 60_000,
      result: { passage: 'Churn fell after the pilot.', document_id: chain.documentId },
      startedAt,
      completedAt: new Date(startedAt.getTime() + 60_000),
      clockRemainingMs: 1_300_000,
    })
    expect(action).toMatchObject({ runId: run.id, type: 'source_trace', inTurnWindow: false })

    const secondClaimId = crypto.randomUUID()
    await testSql`
      insert into scenario_claims (id, package_version_id, key, text, source_kind, importance,
                                   consequence_level, verification_cost, concept_key, position)
      values (${secondClaimId}, ${chain.packageVersionId}, 'C2', 'Margins hold at 40%.', 'assistant',
              'supporting', 'medium', 'moderate', 'pricing', 2)`
    await relianceRepo.insertAction(run.id, {
      claimId: secondClaimId,
      type: 'replication_check',
      clockCostMs: 120_000,
      result: { matches: false },
      startedAt: new Date(startedAt.getTime() + 1_000),
      completedAt: new Date(startedAt.getTime() + 121_000),
    })

    expect((await relianceRepo.listActions(run.id)).map((a) => a.type)).toEqual([
      'source_trace',
      'replication_check',
    ])
    expect(
      (await relianceRepo.listActions(run.id, { claimId: chain.claimId })).map((a) => a.id),
    ).toEqual([action.id])
    expect(await relianceRepo.listActions(crypto.randomUUID())).toEqual([])

    const counted = await relianceRepo.insertEscalation(run.id, {
      claimId: chain.claimId,
      statement: 'The pilot was one region only.',
      responseId: 'claim',
      responseText: 'The pilot covered one region.',
      countsAgainstLimit: true,
    })
    expect(counted).toMatchObject({ clockCostMs: 300_000, countsAgainstLimit: true })
    await relianceRepo.insertEscalation(run.id, {
      claimId: secondClaimId,
      statement: 'Margins depend on volume.',
      responseId: 'general',
      responseText: 'Noted; the brief should say so.',
      countsAgainstLimit: false,
    })

    expect(await relianceRepo.countCountedEscalations(run.id)).toBe(1)
    expect(await relianceRepo.countCountedEscalations(crypto.randomUUID())).toBe(0)
  })
})
