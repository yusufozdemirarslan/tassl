// Step 2.8 — repositories of `defense` (§9), `scoring` (§11), `review` (§12), and `debrief` (§13):
// one insert-and-read pair per repository against minimal parent rows, and the tenant filter on
// every function that touches the run row (D-006). The repositories read `db`, which opens
// DATABASE_URL when first imported, so they are imported after pointing it at the test database.
// @db:truncate
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

type DefenseRepository = typeof import('@/server/modules/defense/repository')
type ScoringRepository = typeof import('@/server/modules/scoring/repository')
type ReviewRepository = typeof import('@/server/modules/review/repository')
type DebriefRepository = typeof import('@/server/modules/debrief/repository')

let defense: DefenseRepository
let scoring: ScoringRepository
let review: ReviewRepository
let debrief: DebriefRepository
let closeDb: (() => Promise<void>) | undefined

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL
  defense = await import('@/server/modules/defense/repository')
  scoring = await import('@/server/modules/scoring/repository')
  review = await import('@/server/modules/review/repository')
  debrief = await import('@/server/modules/debrief/repository')
  const { client } = await import('@/server/db/client')
  closeDb = () => client.end({ timeout: 5 })
})

afterAll(async () => {
  await closeDb?.()
})

afterEach(async () => {
  await truncateAll()
})

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

async function createClaim(packageVersionId: string, key = 'C1'): Promise<string> {
  const claimId = crypto.randomUUID()
  await testSql`
    insert into scenario_claims (id, package_version_id, key, text, source_kind, importance,
                                 consequence_level, verification_cost, concept_key, position)
    values (${claimId}, ${packageVersionId}, ${key}, 'Churn fell 12% after the pilot.', 'assistant',
            'load_bearing', 'high', 'cheap', 'segmentation', 1)`
  return claimId
}

async function createBankQuestion(packageVersionId: string, key = 'Q1'): Promise<string> {
  const questionId = crypto.randomUUID()
  await testSql`
    insert into defense_questions (id, package_version_id, key, kind, template, condition, follow_up,
                                   expected_answer_notes, position)
    values (${questionId}, ${packageVersionId}, ${key}, 'provenance',
            'Where did {claim_text} come from?', '{}'::jsonb, 'And how would you check it?',
            'Names the source document.', 1)`
  return questionId
}

async function createRunClaim(runId: string, claimId: string): Promise<string> {
  const runClaimId = crypto.randomUUID()
  await testSql`
    insert into run_claims (id, run_id, claim_id, surfaced_at, surfaced_by)
    values (${runClaimId}, ${runId}, ${claimId}, now(), 'delegation')`
  return runClaimId
}

async function createEvent(runId: string, seq: number, type: string): Promise<void> {
  await testSql`
    insert into run_events (run_id, seq, type, occurred_at, payload)
    values (${runId}, ${seq}, ${type}::run_event_type, now(), '{}'::jsonb)`
}

const graphs = {
  confidence_line: { available: false },
  clock_timeline: { available: false },
  stance_matrix: { available: false },
  frame_beside_decision: { available: true },
}

describe('defense repository', () => {
  it('inserts questions, lists them in seq order with their answers, and finds one with its follow-up', async () => {
    const { runId, packageVersionId } = await createRunChain()
    const other = await createRunChain()
    const questionId = await createBankQuestion(packageVersionId)
    const askedAt = new Date()

    const inserted = await defense.insertRunQuestions(runId, [
      { questionId, seq: 2, renderedText: 'Second question', askedAt },
      { questionId, seq: 1, renderedText: 'First question', askedAt, selectingEventSeq: 4 },
    ])
    expect(inserted).toHaveLength(2)
    expect(inserted.every((q) => q.runId === runId)).toBe(true)
    expect(await defense.insertRunQuestions(runId, [])).toEqual([])

    const first = inserted.find((q) => q.seq === 1)
    const second = inserted.find((q) => q.seq === 2)
    if (!first || !second) throw new Error('expected both questions')

    const listed = await defense.listRunQuestions(runId)
    expect(listed.map((row) => row.question.seq)).toEqual([1, 2])
    expect(listed.map((row) => row.answer)).toEqual([null, null])
    expect(listed[0]?.question.selectingEventSeq).toBe(4)
    expect(await defense.listRunQuestions(other.runId)).toEqual([])

    const answer = await defense.insertAnswer({
      runId,
      runDefenseQuestionId: first.id,
      text: 'It came from the pilot memo.',
      durationMs: 42_000,
      answeredAt: new Date(),
    })
    expect(answer.runDefenseQuestionId).toBe(first.id)

    const afterAnswer = await defense.listRunQuestions(runId)
    expect(afterAnswer[0]?.answer?.text).toBe('It came from the pilot memo.')
    expect(afterAnswer[1]?.answer).toBeNull()

    const before = await defense.findRunQuestion(runId, first.id)
    expect(before?.question.id).toBe(first.id)
    expect(before?.answer?.id).toBe(answer.id)
    expect(before?.followUp).toBeNull()

    const [followUp] = await defense.insertRunQuestions(runId, [
      { questionId, seq: 3, renderedText: 'Follow-up', askedAt, followUpOf: first.id },
    ])
    const detail = await defense.findRunQuestion(runId, first.id)
    expect(detail?.followUp?.id).toBe(followUp?.id)
    expect(detail?.followUp?.followUpOf).toBe(first.id)

    // Scoped through the run: another run cannot see this question.
    expect(await defense.findRunQuestion(other.runId, first.id)).toBeNull()
    expect(await defense.findRunQuestion(runId, crypto.randomUUID())).toBeNull()
  })

  it('refuses a second answer to the same question', async () => {
    const { runId, packageVersionId } = await createRunChain()
    const questionId = await createBankQuestion(packageVersionId)
    const [question] = await defense.insertRunQuestions(runId, [
      { questionId, seq: 1, renderedText: 'First question', askedAt: new Date() },
    ])
    if (!question) throw new Error('expected a question')
    const row = {
      runId,
      runDefenseQuestionId: question.id,
      text: '',
      durationMs: 0,
      answeredAt: new Date(),
    }
    await defense.insertAnswer(row)
    await expect(defense.insertAnswer(row)).rejects.toMatchObject({ cause: { code: '23505' } })
  })
})

describe('scoring repository', () => {
  it('upserts bands per (run, dimension) and returns the stored rows', async () => {
    const { runId, userId } = await createRunChain()

    const drafts = await scoring.upsertBands(runId, [
      {
        dimension: 'framing',
        draftBand: 'proficient',
        draftStatus: 'drafted',
        basis: 'trace',
        graphKeys: ['frame_beside_decision', 'clock_timeline'],
        evidenceEventSeqs: [3, 7],
        quotes: [{ event_seq: 7, text: 'We assumed the pilot cohort was representative.' }],
        rationale: 'Frame complete; assumptions load-bearing.',
      },
      {
        dimension: 'verification',
        draftBand: null,
        draftStatus: 'unassessed',
        draftReason: 'graph_unavailable',
        basis: 'none',
        provisional: false,
      },
    ])
    expect(drafts).toHaveLength(2)
    expect(drafts.every((band) => band.runId === runId)).toBe(true)
    const framing = drafts.find((band) => band.dimension === 'framing')
    expect(framing).toMatchObject({
      draftBand: 'proficient',
      provisional: true,
      graphKeys: ['frame_beside_decision', 'clock_timeline'],
      evidenceEventSeqs: [3, 7],
      decision: null,
    })
    expect(framing?.quotes).toEqual([
      { event_seq: 7, text: 'We assumed the pilot cohort was representative.' },
    ])
    expect(await scoring.upsertBands(runId, [])).toEqual([])

    const decidedAt = new Date()
    const [decided] = await scoring.upsertBands(runId, [
      {
        dimension: 'framing',
        draftBand: 'proficient',
        draftStatus: 'drafted',
        basis: 'trace',
        graphKeys: ['frame_beside_decision', 'clock_timeline'],
        evidenceEventSeqs: [3, 7],
        quotes: framing?.quotes ?? [],
        rationale: 'Frame complete; assumptions load-bearing.',
        decision: 'overridden',
        decidedBand: 'professional',
        decidedBy: userId,
        decidedAt,
        note: 'Assumptions were sharper than the read credited.',
      },
    ])
    expect(decided?.id).toBe(framing?.id)
    expect(decided).toMatchObject({
      decision: 'overridden',
      decidedBand: 'professional',
      decidedBy: userId,
      note: 'Assumptions were sharper than the read credited.',
    })
    expect(decided?.decidedAt?.getTime()).toBe(decidedAt.getTime())

    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from run_bands where run_id = ${runId}`
    expect(count?.n).toBe(2)
  })

  it('upserts the score row and finds it by run', async () => {
    const { runId } = await createRunChain()
    const other = await createRunChain()
    const scoredAt = new Date()

    const written = await scoring.upsertScore(runId, {
      rubricVersion: 'v1',
      graphs,
      falseChallengeRate: '0.2500',
      matchedStanceShare: '0.7500',
      pointsDraft: '3.000',
      flags: ['nothing_answered'],
      scoredAt,
    })
    expect(written.runId).toBe(runId)
    expect(written.graphs.frame_beside_decision.available).toBe(true)

    const found = await scoring.findScore(runId)
    expect(found).toMatchObject({
      rubricVersion: 'v1',
      falseChallengeRate: '0.2500',
      matchedStanceShare: '0.7500',
      pointsDraft: '3.000',
      pointsConfirmed: null,
      flags: ['nothing_answered'],
    })
    expect(found?.scoredAt.getTime()).toBe(scoredAt.getTime())

    const confirmed = await scoring.upsertScore(runId, {
      rubricVersion: 'v1',
      graphs,
      falseChallengeRate: '0.2500',
      matchedStanceShare: '0.7500',
      pointsDraft: '3.000',
      pointsConfirmed: '3.500',
      flags: ['nothing_answered'],
      scoredAt,
    })
    expect(confirmed.pointsConfirmed).toBe('3.500')
    expect((await scoring.findScore(runId))?.pointsConfirmed).toBe('3.500')

    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from run_scores where run_id = ${runId}`
    expect(count?.n).toBe(1)
    expect(await scoring.findScore(other.runId)).toBeNull()
  })

  it('updates scoring_status only inside the tenant', async () => {
    const { organizationId, runId } = await createRunChain()

    expect(await scoring.updateScoringStatus(crypto.randomUUID(), runId, 'held')).toBeNull()
    const [untouched] = await testSql<{ scoring_status: string }[]>`
      select scoring_status from runs where id = ${runId}`
    expect(untouched?.scoring_status).toBe('idle')

    const held = await scoring.updateScoringStatus(organizationId, runId, 'held')
    expect(held).toMatchObject({ id: runId, scoringStatus: 'held' })
    const [after] = await testSql<{ scoring_status: string }[]>`
      select scoring_status from runs where id = ${runId}`
    expect(after?.scoring_status).toBe('held')
  })
})

describe('review repository', () => {
  it('assembles the replay data in one object and filters by tenant', async () => {
    const { organizationId, runId, userId, packageVersionId } = await createRunChain()
    const claimId = await createClaim(packageVersionId)
    const runClaimId = await createRunClaim(runId, claimId)
    await createEvent(runId, 2, 'frame_locked')
    await createEvent(runId, 1, 'lifecycle')
    await scoring.upsertBands(runId, [
      {
        dimension: 'ownership',
        draftBand: 'novice',
        draftStatus: 'drafted',
        basis: 'defense_only',
      },
      { dimension: 'framing', draftBand: 'proficient', draftStatus: 'drafted', basis: 'trace' },
    ])
    await scoring.upsertScore(runId, { rubricVersion: 'v1', graphs, scoredAt: new Date() })
    const questionId = await createBankQuestion(packageVersionId)
    const [question] = await defense.insertRunQuestions(runId, [
      {
        questionId,
        seq: 1,
        renderedText: 'Where did the churn figure come from?',
        askedAt: new Date(),
      },
    ])
    if (!question) throw new Error('expected a question')
    await defense.insertAnswer({
      runId,
      runDefenseQuestionId: question.id,
      text: 'From the assistant.',
      durationMs: 1000,
      answeredAt: new Date(),
    })
    const neutralization = await review.insertNeutralization({
      runId,
      claimId,
      reason: 'unintended_defect',
      creditChallenge: true,
      note: 'The figure was correct in the seed.',
      actorId: userId,
    })
    expect(neutralization).toMatchObject({ runId, claimId, creditChallenge: true })

    const replay = await review.findReplayData(organizationId, runId)
    expect(replay?.run.id).toBe(runId)
    expect(replay?.events.map((event) => event.seq)).toEqual([1, 2])
    expect(replay?.bands.map((band) => band.dimension)).toEqual(['framing', 'ownership'])
    expect(replay?.score?.rubricVersion).toBe('v1')
    expect(replay?.questions).toHaveLength(1)
    expect(replay?.questions[0]?.answer?.text).toBe('From the assistant.')
    expect(replay?.neutralizations.map((row) => row.id)).toEqual([neutralization.id])
    expect(replay?.claims.map((claim) => claim.id)).toEqual([runClaimId])

    expect(await review.findReplayData(crypto.randomUUID(), runId)).toBeNull()
    expect(await review.findReplayData(organizationId, crypto.randomUUID())).toBeNull()
  })

  it('lists neutralizations of a run newest first', async () => {
    const { runId, userId, packageVersionId } = await createRunChain()
    const other = await createRunChain()
    const first = await review.insertNeutralization({
      runId,
      claimId: await createClaim(packageVersionId, 'C1'),
      reason: 'record_lost',
      actorId: userId,
    })
    const second = await review.insertNeutralization({
      runId,
      claimId: await createClaim(packageVersionId, 'C2'),
      reason: 'other',
      note: 'Second',
      actorId: userId,
    })
    expect(first.note).toBe('')
    expect(first.creditChallenge).toBe(false)

    const listed = await review.listNeutralizations(runId)
    expect(listed.map((row) => row.id)).toEqual([second.id, first.id])
    expect(await review.listNeutralizations(other.runId)).toEqual([])
  })
})

describe('debrief repository', () => {
  it('assembles the debrief data in one object and filters by tenant', async () => {
    const { organizationId, runId, packageVersionId } = await createRunChain()
    const claimId = await createClaim(packageVersionId)
    const runClaimId = await createRunClaim(runId, claimId)
    await testSql`
      insert into run_frames (run_id, decision, assumptions, position, confidence, locked_at)
      values (${runId}, 'Launch in Q3', '{"a","b","c"}'::text[], 'defensible', 60, now())`
    await testSql`
      insert into run_briefs (run_id, recommendation, locked_at)
      values (${runId}, 'Launch in Q3 with the pilot pricing.', now())`
    await testSql`
      insert into run_addenda (run_id, text) values (${runId}, 'Revisit the churn figure first.')`
    await testSql`
      insert into run_turn_responses (run_id, response, justification, confidence, locked_at)
      values (${runId}, 'revise', 'The corrected number moves the margin.', 55, now())`
    await testSql`
      insert into run_actions (run_id, claim_id, type, clock_cost_ms, result, started_at, completed_at)
      values (${runId}, ${claimId}, 'source_trace', 60000, '{"found":true}'::jsonb, now(), now())`
    await scoring.upsertBands(runId, [
      { dimension: 'adaptation', draftBand: 'proficient', draftStatus: 'drafted', basis: 'trace' },
    ])
    await scoring.upsertScore(runId, {
      rubricVersion: 'v1',
      graphs,
      pointsDraft: '3.000',
      scoredAt: new Date(),
    })

    const beforeAnswer = await debrief.findDebriefData(organizationId, runId)
    expect(beforeAnswer?.debriefAnswer).toBeNull()
    expect(beforeAnswer?.record).toBeNull()

    const answeredAt = new Date()
    const answer = await debrief.insertDebriefAnswer({
      runId,
      stanceToChange: 'I would have verified the churn figure.',
      doDifferently: 'Open the pilot memo before delegating.',
      answeredAt,
    })
    expect(answer.runId).toBe(runId)

    const data = await debrief.findDebriefData(organizationId, runId)
    expect(data?.run.id).toBe(runId)
    expect(data?.frame?.decision).toBe('Launch in Q3')
    expect(data?.brief?.recommendation).toBe('Launch in Q3 with the pilot pricing.')
    expect(data?.addendum?.text).toBe('Revisit the churn figure first.')
    expect(data?.turnResponse).toMatchObject({ response: 'revise', confidence: 55 })
    expect(data?.claims.map((claim) => claim.id)).toEqual([runClaimId])
    expect(data?.actions.map((action) => action.type)).toEqual(['source_trace'])
    expect(data?.bands.map((band) => band.dimension)).toEqual(['adaptation'])
    expect(data?.score?.pointsDraft).toBe('3.000')
    expect(data?.debriefAnswer).toMatchObject({
      stanceToChange: 'I would have verified the churn figure.',
      doDifferently: 'Open the pilot memo before delegating.',
    })
    expect(data?.debriefAnswer?.answeredAt.getTime()).toBe(answeredAt.getTime())

    expect(await debrief.findDebriefData(crypto.randomUUID(), runId)).toBeNull()
  })

  it('returns nulls for the pieces a fresh run has not written yet', async () => {
    const { organizationId, runId } = await createRunChain()
    const data = await debrief.findDebriefData(organizationId, runId)
    expect(data).toMatchObject({
      frame: null,
      brief: null,
      addendum: null,
      turnResponse: null,
      claims: [],
      actions: [],
      bands: [],
      score: null,
      record: null,
      debriefAnswer: null,
    })
  })

  it('refuses a second debrief answer for the same run', async () => {
    const { runId } = await createRunChain()
    const row = {
      runId,
      stanceToChange: 'Nothing.',
      doDifferently: 'Nothing.',
      answeredAt: new Date(),
    }
    await debrief.insertDebriefAnswer(row)
    await expect(debrief.insertDebriefAnswer(row)).rejects.toMatchObject({
      cause: { code: '23505' },
    })
  })
})
