// Step 10.4 — `score_run` against Postgres (docs/tech/10-backend-spec-modules.md §11;
// 11-llm-integration.md §3; FR-130, FR-137, FR-140, FR-141, NFR-001, D-046, D-047).
//
// The pipeline is pure until its last transaction, and the unit suites cover every pure part of it:
// the graphs against thirteen fixtures, the facts, the band rules, the points, and the five reads.
// What only a database can say is whether a *run somebody actually took* comes out the other end —
// seven bands with evidence behind them, a score row, a state change, and the people who need to
// know told — and whether it does so once however many times the job runs.
//
// Six claims are worth a database to prove.
//
//   * **A finished defense becomes a scored run**, with seven `draft_band` events, seven `run_bands`
//     rows, a `run_scores` row carrying the four graphs and the False Challenge Rate, and the
//     transition to `scored` with `scoring_status = 'done'` (FR-130).
//   * **Every band cites something.** `evidence_event_seqs` is non-empty, and a band a model read
//     carries a quote taken from the run's own words and anchored to the event they were written in
//     (FR-137, FR-138).
//   * **Under five seconds on the mock** (NFR-001).
//   * **Scoring twice is scoring once** (D-046's singleton key, and the row lock behind it): no
//     second set of events, no second notification, no second set of points.
//   * **A read that does not come back holds the run** (FR-140, 11 §3): `scoring_status = 'held'`,
//     the run still at `defense_complete`, no band written, and the section's instructors told.
//   * **The student's copy carries nothing the instructor's does**, and their trace carries no
//     stored sequence numbers (12 §8.1, `trace/owner-view.ts`).
// @db:truncate
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  claimByKey,
  delegate,
  inLockedRun,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'
import { stopBoss } from '@/server/jobs/boss'

type Defense = typeof import('@/server/modules/defense')
type Reliance = typeof import('@/server/modules/reliance')
type Runs = typeof import('@/server/modules/runs')
type Scoring = typeof import('@/server/modules/scoring')
type Trace = typeof import('@/server/modules/trace')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let defense: Defense
let reliance: Reliance
let runs: Runs
let scoring: Scoring
let trace: Trace
let advanceClock: AdvanceClockRoute
let fx: AssistantFixture

const TURN_DELAY_MS = FIXTURE.version.turnDelaySeconds * 1000

const BRIEF = {
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

const RESPONSE = {
  response: 'revise' as const,
  justification:
    'The 78 percent was one cohort acquired under the old pricing, so the payback the recommendation was priced on does not hold and the share sized on it comes down.',
  confidence: 55,
}

const ANSWER =
  'The assistant gave me the 11 month payback figure and I did not check its date against the payback model, so I priced the recommendation on a number I had not traced.'

// ---------------------------------------------------------------------------------------------
// Building a run the pipeline has something to read
// ---------------------------------------------------------------------------------------------

async function advance(runId: string, ms: number): Promise<Response> {
  const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })
  headers.set('x-requested-with', 'tassl')
  headers.set('content-type', 'application/json')
  return advanceClock.POST(
    new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ms }),
    }),
    { params: Promise.resolve({ runId }) },
  )
}

/** A run with every question answered, sitting at `defense_pending`. */
async function runThroughDefenseAnswers(answer = ANSWER): Promise<string> {
  const runId = await runInWorking(fx)
  await runs.openDocument(fx.student, runId, fx.documentId('D5'))
  await delegate(fx, runId, 'What is the premium payback?')

  const c1 = fx.claimId(claimByKey('C1').key)
  await reliance.setStance(fx.student, runId, c1, 'verify')
  await reliance.runAction(fx.student, runId, c1, 'source_trace')
  await reliance.setStance(fx.student, runId, c1, 'challenge')

  await runs.lockDecision(fx.student, runId, BRIEF)
  await advance(runId, TURN_DELAY_MS + 2_000)
  for (const claim of await reliance.listRunClaims(fx.student, runId)) {
    if (claim.inTurnWindow && claim.stance === null) {
      await reliance.setStance(fx.student, runId, claim.id, 'verify')
    }
  }
  await runs.respondToTurn(fx.student, runId, RESPONSE)

  for (let round = 0; round < 40; round += 1) {
    const view = await defense.openDefense(fx.student, runId)
    const next = view.questions.find((question) => !question.answered)
    if (!next) break
    await defense.answerQuestion(fx.student, runId, next.runQuestionId, {
      text: answer,
      durationMs: 1_000,
    })
  }
  return runId
}

/**
 * `defense_pending → defense_complete` without the queue.
 *
 * `completeDefense` enqueues `score_run` and the drain runs it in the same call (D-046), which is
 * exactly what the last test in this file asserts. Every other test needs to call the pipeline
 * itself — to time it, to read its answer, to run it twice — so those reach the same transition
 * through the `runs` module's own seam and leave the queue out of it.
 */
async function reachDefenseComplete(runId: string): Promise<void> {
  await inLockedRun(fx, runId, async (tx, run) => {
    await runs.markDefenseComplete(tx, run, {
      at: new Date(),
      actorId: fx.student.id,
      nothingAnswered: false,
    })
  })
}

async function scorableRun(answer = ANSWER): Promise<string> {
  const runId = await runThroughDefenseAnswers(answer)
  await reachDefenseComplete(runId)
  return runId
}

// ---------------------------------------------------------------------------------------------
// Reading the record back
// ---------------------------------------------------------------------------------------------

const runRow = async (runId: string) => {
  const [row] = await testSql<
    { state: string; scoring_status: string; scored_at: Date | null }[]
  >`select state, scoring_status, scored_at from runs where id = ${runId}`
  return row
}

const bandRows = async (runId: string) =>
  testSql<
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
    }[]
  >`select dimension, draft_band, draft_status, draft_reason, basis, provisional, graph_keys,
           evidence_event_seqs, quotes, rationale
      from run_bands where run_id = ${runId} order by dimension`

const scoreRow = async (runId: string) => {
  const [row] = await testSql<
    {
      rubric_version: string
      graphs: Record<string, { available: boolean }>
      false_challenge_rate: string | null
      matched_stance_share: string | null
      points_draft: string | null
      points_confirmed: string | null
      flags: string[]
    }[]
  >`select rubric_version, graphs, false_challenge_rate, matched_stance_share, points_draft,
           points_confirmed, flags
      from run_scores where run_id = ${runId}`
  return row
}

const notificationRows = async (runId: string) =>
  testSql<
    {
      user_id: string
      type: string
      title: string
      body: string
      link: string | null
      payload: Record<string, unknown>
    }[]
  >`select user_id, type, title, body, link, payload from notifications
      where payload->>'runId' = ${runId} order by user_id, type`

const draftBandEvents = async (runId: string) =>
  testSql<{ seq: number; payload: Record<string, unknown> }[]>`
    select seq, payload from run_events where run_id = ${runId} and type = 'draft_band'
     order by seq`

const eventCount = async (runId: string, type: string) => {
  const [row] = await testSql<{ n: string }[]>`
    select count(*)::text as n from run_events where run_id = ${runId} and type = ${type}`
  return Number(row?.n ?? '0')
}

beforeEach(async () => {
  await truncateAll()
  defense = await import('@/server/modules/defense')
  reliance = await import('@/server/modules/reliance')
  runs = await import('@/server/modules/runs')
  scoring = await import('@/server/modules/scoring')
  trace = await import('@/server/modules/trace')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('scoring-run')
  await testSql`delete from pgboss.job where name in ('score_run', 'send_email')`
})

afterEach(() => {
  delete process.env.MOCK_FAIL_READS
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The scored run (FR-130, FR-137, DATA-041, DATA-042)
// ---------------------------------------------------------------------------------------------

describe('scoreRun on a finished defense', () => {
  it('writes seven bands, a score row, and the transition to scored', async () => {
    const runId = await scorableRun()
    const result = await scoring.scoreRun(runId)

    expect(result.outcome).toBe('scored')
    expect(result.holdReason).toBeNull()
    expect(result.provider).toBe('mock')

    expect(await runRow(runId)).toMatchObject({ state: 'scored', scoring_status: 'done' })
    expect((await runRow(runId))?.scored_at).not.toBeNull()

    const bands = await bandRows(runId)
    expect(bands.map((band) => band.dimension).sort()).toEqual([
      'adaptation',
      'calibration',
      'decision_quality',
      'delegation',
      'framing',
      'ownership',
      'verification',
    ])
    for (const band of bands) {
      // FR-004: a dimension holds a band or says why it holds none, and never both.
      if (band.draft_status === 'drafted') expect(band.draft_band).not.toBeNull()
      else expect(band.draft_band).toBeNull()
      expect(band.graph_keys.length).toBeGreaterThan(0)
      expect(band.rationale.length).toBeGreaterThan(0)
    }

    const score = await scoreRow(runId)
    expect(score?.rubric_version).toBe('v1')
    expect(Object.keys(score?.graphs ?? {}).sort()).toEqual([
      'clock_timeline',
      'confidence_line',
      'frame_beside_decision',
      'stance_matrix',
    ])
    expect(score?.false_challenge_rate).not.toBeNull()
    expect(score?.matched_stance_share).not.toBeNull()
    expect(score?.points_draft).not.toBeNull()
    // FR-203, D-091: no points are computed from a draft band for the gradebook of record.
    expect(score?.points_confirmed).toBeNull()
  })

  it('cites the events every band was read from, and quotes the run’s own words', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)
    const bands = await bandRows(runId)

    for (const band of bands.filter((row) => row.draft_status === 'drafted')) {
      expect(band.evidence_event_seqs.length, band.dimension).toBeGreaterThan(0)
    }

    // The five read dimensions; the two computed ones carry no quotes by design (PRD §7.13).
    const readBased = bands.filter((band) => band.provisional && band.draft_status === 'drafted')
    expect(readBased.length).toBeGreaterThan(0)
    const quoted = readBased.filter((band) => band.quotes.length > 0)
    expect(quoted.length).toBeGreaterThan(0)

    const [{ seqs, texts } = { seqs: [], texts: [] }] = [
      await testSql<{ seqs: number[]; texts: string[] }[]>`
        select array_agg(seq) as seqs, array_agg(payload::text) as texts
          from run_events where run_id = ${runId}`,
    ].map((rows) => rows[0])

    for (const band of quoted) {
      for (const quote of band.quotes) {
        // Anchored to a real event of this run, and the words are in that event's payload.
        expect(seqs).toContain(quote.event_seq)
        const index = seqs.indexOf(quote.event_seq)
        expect(texts[index]).toContain(quote.text.slice(0, 24))
      }
    }

    for (const band of bands) {
      expect(band.basis).not.toBe('none')
    }
    expect(bands.find((band) => band.dimension === 'verification')?.provisional).toBe(false)
    expect(bands.find((band) => band.dimension === 'calibration')?.provisional).toBe(false)
  })

  it('writes one draft_band event per dimension and notifies the student and the section', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    const events = await draftBandEvents(runId)
    expect(events).toHaveLength(7)
    expect(events.map((event) => event.payload.dimension).sort()).toEqual([
      'adaptation',
      'calibration',
      'decision_quality',
      'delegation',
      'framing',
      'ownership',
      'verification',
    ])

    const notifications = await notificationRows(runId)
    const student = notifications.filter((row) => row.user_id === fx.student.id)
    const reviewers = notifications.filter((row) => row.user_id !== fx.student.id)

    expect(student).toHaveLength(1)
    expect(student[0]).toMatchObject({ type: 'run_scored', link: `/runs/${runId}` })
    expect(reviewers.map((row) => row.user_id).sort()).toEqual([fx.instructor.id, fx.ta.id].sort())
    for (const row of reviewers) {
      expect(row).toMatchObject({ type: 'run_scored', link: `/review/runs/${runId}` })
    }

    // The student's copy carries nothing the instructor's does: a different title, a different body,
    // a different link, and a payload that names only their own run.
    expect(student[0]?.title).not.toBe(reviewers[0]?.title)
    expect(student[0]?.body).not.toBe(reviewers[0]?.body)
    expect(Object.keys(student[0]?.payload ?? {})).toEqual(['runId'])
    expect(reviewers[0]?.payload).toHaveProperty('sectionId')
    // No band, no rate, no count reaches an inbox.
    for (const row of notifications) {
      const text = `${row.title} ${row.body}`.toLowerCase()
      for (const word of ['novice', 'developing', 'proficient', 'professional', 'points']) {
        expect(text, `${row.user_id} was told ${word}`).not.toContain(word)
      }
    }
  })

  it('finishes inside the NFR-001 mock budget of five seconds', async () => {
    const runId = await scorableRun()
    const startedAt = Date.now()
    const result = await scoring.scoreRun(runId)
    const wallClock = Date.now() - startedAt

    expect(result.outcome).toBe('scored')
    expect(result.durationMs).toBeLessThan(5_000)
    expect(wallClock).toBeLessThan(5_000)
  })
})

// ---------------------------------------------------------------------------------------------
// Idempotency (D-046)
// ---------------------------------------------------------------------------------------------

describe('scoring the same run twice', () => {
  it('writes no second band, event, notification or set of points', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    const before = {
      bands: await bandRows(runId),
      score: await scoreRow(runId),
      notifications: await notificationRows(runId),
      draftBandEvents: await eventCount(runId, 'draft_band'),
      lifecycleEvents: await eventCount(runId, 'lifecycle'),
      run: await runRow(runId),
    }

    const second = await scoring.scoreRun(runId)
    expect(second.outcome).toBe('already_scored')

    expect(await bandRows(runId)).toEqual(before.bands)
    expect(await scoreRow(runId)).toEqual(before.score)
    expect(await notificationRows(runId)).toEqual(before.notifications)
    expect(await eventCount(runId, 'draft_band')).toBe(before.draftBandEvents)
    expect(await eventCount(runId, 'lifecycle')).toBe(before.lifecycleEvents)
    expect(await runRow(runId)).toEqual(before.run)
  })

  it('stamps the singleton key, and the row lock is what makes a second job a no-op', async () => {
    const runId = await scorableRun()
    const { enqueue } = await import('@/server/jobs/enqueue')
    await enqueue('score_run', { runId }, { drain: false })
    await enqueue('score_run', { runId }, { drain: false })

    const rows = await testSql<{ singleton_key: string | null }[]>`
      select singleton_key from pgboss.job
       where name = 'score_run' and data->>'runId' = ${runId}`
    expect(rows.every((row) => row.singleton_key === `score_run:${runId}`)).toBe(true)

    // The key alone is not the guarantee: these queues run pg-boss's `standard` policy, under which
    // a singleton key does not dedupe a second send (D-400). Running the pipeline concurrently is
    // still one scoring, because the writing transaction locks the run row and re-reads its state.
    const results = await Promise.all([scoring.scoreRun(runId), scoring.scoreRun(runId)])
    expect(results.filter((result) => result.outcome === 'scored')).toHaveLength(1)
    expect(await bandRows(runId)).toHaveLength(7)
    expect(await eventCount(runId, 'draft_band')).toBe(7)
    expect(await notificationRows(runId)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------------------------
// The held path (FR-140, 11 §3)
// ---------------------------------------------------------------------------------------------

describe('when the band reads do not come back', () => {
  it('holds the run, writes no band, and tells the section’s instructors', async () => {
    const runId = await scorableRun()
    process.env.MOCK_FAIL_READS = 'true'

    const result = await scoring.scoreRun(runId)
    expect(result.outcome).toBe('held')
    expect(result.holdReason).toBe('provider_error')

    // FR-140: the run stays where it is and nobody's band is invented.
    expect(await runRow(runId)).toMatchObject({
      state: 'defense_complete',
      scoring_status: 'held',
      scored_at: null,
    })
    expect(await bandRows(runId)).toEqual([])
    expect(await scoreRow(runId)).toBeUndefined()
    expect(await eventCount(runId, 'draft_band')).toBe(0)

    const notifications = await notificationRows(runId)
    expect(notifications.map((row) => row.user_id).sort()).toEqual(
      [fx.instructor.id, fx.ta.id].sort(),
    )
    for (const row of notifications) {
      expect(row).toMatchObject({ type: 'run_held', link: `/review/runs/${runId}` })
      expect(row.payload).toMatchObject({ runId, reason: 'provider_error' })
    }
    // The student is told nothing: their run already reads "under review" (10 §6).
    expect(notifications.some((row) => row.user_id === fx.student.id)).toBe(false)
  })

  it('scores the run when the reads come back on a later attempt', async () => {
    const runId = await scorableRun()
    process.env.MOCK_FAIL_READS = 'true'
    expect((await scoring.scoreRun(runId)).outcome).toBe('held')

    delete process.env.MOCK_FAIL_READS
    expect((await scoring.scoreRun(runId)).outcome).toBe('scored')
    expect(await runRow(runId)).toMatchObject({ state: 'scored', scoring_status: 'done' })
    expect(await bandRows(runId)).toHaveLength(7)
  })

  // D-424. Holding twice is holding once, and the state cannot be what says so: a hold moves nothing
  // on purpose (D-405), so the run is still `defense_complete` afterwards and the scored path's own
  // idempotency guard — "the second job finds the run already moved" — does not apply here.
  it('holds once however many jobs arrive, sequentially', async () => {
    const runId = await scorableRun()
    process.env.MOCK_FAIL_READS = 'true'

    const first = await scoring.scoreRun(runId)
    expect(first.outcome).toBe('held')
    const before = await notificationRows(runId)
    expect(before).toHaveLength(2) // one instructor, one TA

    const second = await scoring.scoreRun(runId)
    expect(second.outcome).toBe('already_held')
    expect(second.holdReason).toBeNull()

    // No second notice, no second row of anything, and the run is exactly where it was.
    expect(await notificationRows(runId)).toEqual(before)
    expect(await runRow(runId)).toMatchObject({
      state: 'defense_complete',
      scoring_status: 'held',
      scored_at: null,
    })
    expect(await bandRows(runId)).toEqual([])
  })

  it('holds once however many jobs arrive, concurrently', async () => {
    const runId = await scorableRun()
    process.env.MOCK_FAIL_READS = 'true'

    const results = await Promise.all([scoring.scoreRun(runId), scoring.scoreRun(runId)])
    expect(results.filter((result) => result.outcome === 'held')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'already_held')).toHaveLength(1)

    // Two reviewers, one notice each — not two each, which is what a second hold wrote before, and
    // with them a second `ops_run_held`, a second `ops_scoring_completed` and a second alert.
    const notifications = await notificationRows(runId)
    expect(notifications).toHaveLength(2)
    expect(notifications.map((row) => row.user_id).sort()).toEqual(
      [fx.instructor.id, fx.ta.id].sort(),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// The two upserts, and the columns their callers do not mention (D-423)
//
// `run_scores` and `run_bands` are each written by more than one caller: `scoreRun` writes the draft
// half, `review` writes the decisions, §11.5's recompute writes the correction. A SET clause written
// out column by column sets every column a caller did not name to `excluded.<column>`, which for a
// column the insert never carried is that column's default — NULL. So the second write of a key
// blanks whatever the first one put there, and only the second write is wrong, which is why nothing
// in the pipeline noticed: `scoreRun` is the only writer today.
// ---------------------------------------------------------------------------------------------

describe('an upsert writes the columns its caller named and leaves the rest alone', () => {
  /** The row the pipeline just wrote. Narrowing here keeps the writes below about the columns. */
  function notNull<T>(value: T | null | undefined): T {
    expect(value).toBeTruthy()
    return value as T
  }

  const fullScoreRow = async (runId: string) => {
    const [row] = await testSql<
      {
        rubric_version: string
        false_challenge_rate: string | null
        points_draft: string | null
        points_confirmed: string | null
        points_before_correction: string | null
        points_after_correction: string | null
        points_effective: string | null
        scored_at: Date | null
        flags: string[]
      }[]
    >`select rubric_version, false_challenge_rate, points_draft, points_confirmed,
             points_before_correction, points_after_correction, points_effective, scored_at, flags
        from run_scores where run_id = ${runId}`
    return row
  }

  it('keeps the confirmed and corrected points a second write does not mention', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    // What Phase 11's confirmation will write: the course's arithmetic, on the row the pipeline made.
    await testSql`update run_scores
                     set points_confirmed = 3.000, points_effective = 3.500,
                         points_before_correction = 3.000, points_after_correction = 3.500
                   where run_id = ${runId}`

    // The pipeline's own write, exactly as `scoreRun` shapes it: the draft half and nothing else.
    const repository = await import('@/server/modules/scoring/repository')
    const existing = await repository.findScore(runId)
    await repository.upsertScore(runId, {
      rubricVersion: 'v1',
      graphs: notNull(existing).graphs,
      falseChallengeRate: '0.2500',
      matchedStanceShare: '0.7500',
      pointsDraft: '2.000',
      flags: [],
      scoredAt: new Date(),
    })

    const row = await fullScoreRow(runId)
    // The four the second caller never named survive it.
    expect(row?.points_confirmed).toBe('3.000')
    expect(row?.points_effective).toBe('3.500')
    expect(row?.points_before_correction).toBe('3.000')
    expect(row?.points_after_correction).toBe('3.500')
    // And the ones it did name are written.
    expect(row?.points_draft).toBe('2.000')
    expect(row?.false_challenge_rate).toBe('0.2500')
  })

  it('keeps the draft half a correction write does not mention', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)
    const before = await fullScoreRow(runId)
    expect(before?.points_draft).not.toBeNull()

    // §11.5's writer: the correction's three numbers, plus the three columns the *insert* path of an
    // upsert cannot leave out because the table declares them not-null. Everything else — the draft
    // points, the two rates, the flags — is the other caller's, and this one does not mention it.
    const repository = await import('@/server/modules/scoring/repository')
    const existing = await repository.findScore(runId)
    await repository.upsertScore(runId, {
      rubricVersion: notNull(existing).rubricVersion,
      graphs: notNull(existing).graphs,
      scoredAt: notNull(existing).scoredAt,
      pointsBeforeCorrection: '3.000',
      pointsAfterCorrection: '3.143',
      pointsEffective: '3.143',
    })

    const row = await fullScoreRow(runId)
    expect(row?.points_effective).toBe('3.143')
    expect(row?.points_before_correction).toBe('3.000')
    expect(row?.points_draft).toBe(before?.points_draft)
    expect(row?.false_challenge_rate).toBe(before?.false_challenge_rate)
    expect(row?.flags).toEqual(before?.flags)
  })

  it('keeps an instructor’s decision when the pipeline re-drafts the same band', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    // What `review.decideBand` will write in Phase 11.
    await testSql`update run_bands
                     set decision = 'overridden', decided_band = 'professional',
                         note = 'The Source Trace was read correctly in the defense.'
                   where run_id = ${runId} and dimension = 'verification'`

    // A second pass of the pipeline's own writer, which names the draft columns only.
    const repository = await import('@/server/modules/scoring/repository')
    await repository.upsertBands(runId, [
      {
        dimension: 'verification',
        draftBand: 'developing',
        draftStatus: 'drafted',
        draftReason: 'redrafted',
        basis: 'trace',
        provisional: true,
        graphKeys: [],
        evidenceEventSeqs: [],
        quotes: [],
        rationale: 'A second draft.',
      },
    ])

    const [row] = await testSql<
      {
        draft_band: string
        decision: string | null
        decided_band: string | null
        note: string | null
      }[]
    >`select draft_band, decision, decided_band, note
        from run_bands where run_id = ${runId} and dimension = 'verification'`
    expect(row?.draft_band).toBe('developing')
    expect(row?.decision).toBe('overridden')
    expect(row?.decided_band).toBe('professional')
    expect(row?.note).toBe('The Source Trace was read correctly in the defense.')
  })
})

// ---------------------------------------------------------------------------------------------
// What the student may read of it (12 §8.1, trace/owner-view.ts)
// ---------------------------------------------------------------------------------------------

describe('the student’s view of a scored run', () => {
  it('withholds the stored sequences and the quotes from their own trace', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    const owner = await trace.listEvents(fx.student, runId)
    const drafts = owner.filter((event) => event.type === 'draft_band')
    expect(drafts).toHaveLength(7)
    for (const event of drafts) {
      expect(event.payload).toHaveProperty('band')
      expect(event.payload).toHaveProperty('rationale')
      expect(event.payload).not.toHaveProperty('evidence_event_seqs')
      expect(event.payload).not.toHaveProperty('quotes')
    }

    // The reviewer's view is the record, sequence numbers and quotes included.
    const reviewer = await trace.listEvents(fx.instructor, runId)
    const reviewerDrafts = reviewer.filter((event) => event.type === 'draft_band')
    expect(reviewerDrafts).toHaveLength(7)
    expect(reviewerDrafts.every((event) => 'evidence_event_seqs' in event.payload)).toBe(true)
  })

  it('answers a reviewer’s getScore and refuses a classmate', async () => {
    const runId = await scorableRun()
    await scoring.scoreRun(runId)

    const view = await scoring.getScore(fx.instructor, runId)
    expect(view.bands).toHaveLength(7)
    expect(view.rubricVersion).toBe('v1')
    expect(view.uncalibrated).toBe(true)
    expect(view.scoringStatus).toBe('done')
    expect(view.pointsDraft).not.toBeNull()

    await expect(scoring.getScore(fx.classmate, runId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('refuses getScore on a run the pipeline has not written a score for', async () => {
    const runId = await scorableRun()
    await expect(scoring.getScore(fx.instructor, runId)).rejects.toMatchObject({
      code: 'RUN_NOT_SCORABLE',
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The queue path (D-046): the handler is registered and the drain runs it
// ---------------------------------------------------------------------------------------------

describe('the score_run job', () => {
  it('is enqueued by the finished defense and scores the run', async () => {
    const runId = await runThroughDefenseAnswers()
    await defense.completeDefense(fx.student, runId)

    // `completeDefense` enqueues after the commit and the drain runs the handler in the same call
    // (D-046, D-181), so the run is scored by the time it returns.
    expect(await runRow(runId)).toMatchObject({ state: 'scored', scoring_status: 'done' })
    expect(await bandRows(runId)).toHaveLength(7)
    expect(await eventCount(runId, 'draft_band')).toBe(7)
  })
})
