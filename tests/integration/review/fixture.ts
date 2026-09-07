// The room the review suites work in (Step 11.1), built on the same fixture package every run suite
// uses: Meridian Roast, nine documents, eight claims, two variants, one section with a student, an
// instructor, a TA and a classmate (`tests/integration/assistant/fixture`).
//
// What these suites need that the earlier ones did not is a run that has been *scored*: seven draft
// bands, a score row with the four graphs, and a state of `scored`. Building one means taking a run
// all the way through — readiness, frame, delegation, stances, an action, the Decision Lock, the
// Turn, the defense — and then running the pipeline, which is what `scoredRun` below does. Nothing
// here fakes a band: a decision suite that decided bands nobody drafted would be testing a form.
import { testSql } from '@tests/setup/integration'

export {
  FIXTURE,
  FRAME,
  actorFor,
  claimByKey,
  eventsOfType,
  runInWorking,
  setupAssistantFixture,
} from '../assistant/fixture'
export type { AssistantFixture } from '../assistant/fixture'

import { delegate, inLockedRun } from '../reliance/fixture'
import { FIXTURE, claimByKey, type AssistantFixture } from '../assistant/fixture'

export { delegate, inLockedRun } from '../reliance/fixture'

/** The brief the fixture student files: one figure traced, one taken on trust. */
export const BRIEF = {
  recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
  rationale:
    'The premium payback figure is load-bearing and has not been traced to the cohort table, so moving spend on it would be a bet on a number nobody has checked.',
  assumptions: [
    'Premium retention holds near the piloted level',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable through the crop year',
  ],
  changeMyMind: 'A cohort table showing premium payback under six months would change this.',
  confidence: 45,
  namedValues: { budget_share_to_premium: 35, premium_payback_months: 19 },
}

export const TURN_RESPONSE = {
  response: 'revise' as const,
  justification:
    'The 78 percent was one cohort acquired under the old pricing, so the payback the recommendation was priced on does not hold and the share sized on it comes down.',
  confidence: 55,
}

const DEFENSE_ANSWER =
  'The assistant gave me the 11 month payback figure and I did not check its date against the payback model, so I priced the recommendation on a number I had not traced.'

/** Moves the run's whole timeline back by `ms` through the test-only route (07 §7, D-364). */
export async function advanceClock(fx: AssistantFixture, runId: string, ms: number): Promise<void> {
  const { asUser } = await import('@tests/setup/integration')
  const route = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })
  headers.set('x-requested-with', 'tassl')
  headers.set('content-type', 'application/json')
  const response = await route.POST(
    new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ms }),
    }),
    { params: Promise.resolve({ runId }) },
  )
  if (response.status !== 200) throw new Error(`advance-clock answered ${response.status}`)
}

/**
 * A run at `defense_complete`: everything the student does, done.
 *
 * The claim path is deliberate rather than incidental. C1 is traced and then challenged, which is a
 * *matched* stance on the defective variant and the thing the neutralization suite later corrects
 * around; C3 is the assistant's 11-month figure, named in the brief, so the lock's reliance gate has
 * something to bite on.
 */
export async function runToDefenseComplete(fx: AssistantFixture): Promise<string> {
  const runs = await import('@/server/modules/runs')
  const reliance = await import('@/server/modules/reliance')
  const defense = await import('@/server/modules/defense')
  const { runInWorking } = await import('../assistant/fixture')

  const runId = await runInWorking(fx)
  await runs.openDocument(fx.student, runId, fx.documentId('D5'))
  await delegate(fx, runId, 'What is the premium payback?')

  const c1 = fx.claimId(claimByKey('C1').key)
  await reliance.setStance(fx.student, runId, c1, 'verify')
  await reliance.runAction(fx.student, runId, c1, 'source_trace')
  await reliance.setStance(fx.student, runId, c1, 'challenge')

  await runs.lockDecision(fx.student, runId, BRIEF)
  await advanceClock(fx, runId, FIXTURE.version.turnDelaySeconds * 1000 + 2_000)
  for (const claim of await reliance.listRunClaims(fx.student, runId)) {
    if (claim.inTurnWindow && claim.stance === null) {
      await reliance.setStance(fx.student, runId, claim.id, 'verify')
    }
  }
  await runs.respondToTurn(fx.student, runId, TURN_RESPONSE)

  for (let round = 0; round < 40; round += 1) {
    const view = await defense.openDefense(fx.student, runId)
    const next = view.questions.find((question) => !question.answered)
    if (!next) break
    await defense.answerQuestion(fx.student, runId, next.runQuestionId, {
      text: DEFENSE_ANSWER,
      durationMs: 1_000,
    })
  }

  await inLockedRun(fx, runId, async (tx, run) => {
    await runs.markDefenseComplete(tx, run, {
      at: new Date(),
      actorId: fx.student.id,
      nothingAnswered: false,
    })
  })
  return runId
}

/** A run at `scored`, with seven drafted bands and a score row (FR-130). */
export async function scoredRun(fx: AssistantFixture): Promise<string> {
  const scoring = await import('@/server/modules/scoring')
  const runId = await runToDefenseComplete(fx)
  const result = await scoring.scoreRun(runId)
  if (result.outcome !== 'scored') throw new Error(`the fixture run came back ${result.outcome}`)
  return runId
}

/** A run at `defense_complete` with `scoring_status = 'held'` (FR-140, 11 §3). */
export async function heldRun(fx: AssistantFixture): Promise<string> {
  const scoring = await import('@/server/modules/scoring')
  const runId = await runToDefenseComplete(fx)
  process.env.MOCK_FAIL_READS = 'true'
  try {
    const result = await scoring.scoreRun(runId)
    if (result.outcome !== 'held') throw new Error(`the fixture run came back ${result.outcome}`)
  } finally {
    delete process.env.MOCK_FAIL_READS
  }
  return runId
}

// ---------------------------------------------------------------------------------------------
// Reading the record back — the tables as written, not a projection of them
// ---------------------------------------------------------------------------------------------

export async function bandRows(runId: string) {
  return testSql<
    {
      dimension: string
      draft_band: string | null
      draft_status: string
      draft_reason: string
      basis: string
      provisional: boolean
      graph_keys: string[]
      evidence_event_seqs: number[]
      quotes: { event_seq: number; text: string }[]
      rationale: string
      decision: string | null
      decided_band: string | null
      decided_by: string | null
      note: string | null
      band_before_correction: string | null
      band_after_correction: string | null
    }[]
  >`select dimension, draft_band, draft_status, draft_reason, basis, provisional, graph_keys,
           evidence_event_seqs, quotes, rationale, decision, decided_band, decided_by, note,
           band_before_correction, band_after_correction
      from run_bands where run_id = ${runId} order by dimension`
}

export async function scoreRow(runId: string) {
  const [row] = await testSql<
    {
      rubric_version: string
      false_challenge_rate: string | null
      matched_stance_share: string | null
      points_draft: string | null
      points_confirmed: string | null
      points_before_correction: string | null
      points_after_correction: string | null
      points_effective: string | null
      flags: string[]
    }[]
  >`select rubric_version, false_challenge_rate, matched_stance_share, points_draft,
           points_confirmed, points_before_correction, points_after_correction, points_effective,
           flags
      from run_scores where run_id = ${runId}`
  return row
}

export async function runRow(runId: string) {
  const [row] = await testSql<
    {
      state: string
      scoring_status: string
      confirmed_at: Date | null
      recorded_at: Date | null
      adjusted_at: Date | null
      voided_at: Date | null
      void_reason: string | null
      variant_id: string
      attempt_no: number
      re_offered_from_run_id: string | null
      re_offered_to_run_id: string | null
      flags: Record<string, unknown>
    }[]
  >`select state, scoring_status, confirmed_at, recorded_at, adjusted_at, voided_at, void_reason,
           variant_id, attempt_no, re_offered_from_run_id, re_offered_to_run_id, flags
      from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return row
}

export async function exportRows(runId: string) {
  return testSql<
    {
      version: number
      reason: string
      created_by: string | null
      file: Record<string, unknown>
    }[]
  >`select version, reason, created_by, file from course_exports
      where run_id = ${runId} order by version`
}

export async function auditRows(runId: string) {
  return testSql<{ action: string; actor_id: string | null; metadata: Record<string, unknown> }[]>`
    select action, actor_id, metadata from audit_logs
     where target_type = 'run' and target_id = ${runId} order by created_at, id`
}

export async function notificationRows(runId: string) {
  return testSql<
    { user_id: string; type: string; title: string; body: string; link: string | null }[]
  >`select user_id, type, title, body, link from notifications
      where payload->>'runId' = ${runId} order by user_id, type`
}

export async function runClaimRow(runId: string, claimId: string) {
  const [row] = await testSql<
    { neutralization_id: string | null; inconsistency_credited: boolean; stance: string | null }[]
  >`select neutralization_id, inconsistency_credited, stance from run_claims
      where run_id = ${runId} and claim_id = ${claimId}`
  return row
}

export async function packageVersionReview(versionId: string) {
  const [row] = await testSql<{ review_requested_at: Date | null; review_reason: string | null }[]>`
    select review_requested_at, review_reason from scenario_package_versions where id = ${versionId}`
  return row
}
