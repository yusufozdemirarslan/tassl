// Step 10.1 — the exported trace against Postgres (docs/prd/Tassl-PRD.md §12;
// docs/tech/10-backend-spec-modules.md §10; FR-170, FR-240 to FR-243, D-107, D-370).
//
// The export is the one artifact of this build that is assembled from every table a run touched:
// the run row, the package version and its confirmation record, the variant's claim states, the
// readiness result, the claims, the actions, and the append-only trace itself. A unit test can say
// what the document's shape is — `tests/unit/trace/export-schema.test.ts` does — and only a
// database can say whether a real run fills it.
//
// Five claims are worth a database to prove.
//
//   * **The header is the run** (FR-240): its package, version and variant, the confirmation record
//     the disciplinary authority wrote before any student saw the scenario, the policy as it was
//     displayed, the readiness result, and every lifecycle transition in order.
//   * **Every event is in the file, in sequence order**, with the clock reading it was stamped at.
//   * **One claim-table row per consequential claim in the variant**, surfaced or not (D-107), with
//     the authored standard beside what the student did.
//   * **The two forms differ by exactly the course-only keys** — `weight`, `mapping` and `points`,
//     at every depth (FR-170) — and, because the record form is also a student view, by the fields
//     12 §8.1 withholds from a student in any state (D-370). Nothing else about them differs: the
//     header, the events, the claim table and the computed block are otherwise the same document.
//   * **The record export is refused before the bands are confirmed**, and refused to a classmate.
// @db:truncate
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  FRAME,
  claimByKey,
  codeOf,
  keysOf,
  runInWorking,
  setupAssistantFixture,
  delegate,
  type AssistantFixture,
} from '../reliance/fixture'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { fieldPolicyFor } from '@/server/modules/trace/owner-view'
import { RUN_EVENT_TYPES } from '@/server/modules/trace/schema'
import { stopBoss } from '@/server/jobs/boss'

type Defense = typeof import('@/server/modules/defense')
type Records = typeof import('@/server/modules/records')
type Reliance = typeof import('@/server/modules/reliance')
type Runs = typeof import('@/server/modules/runs')
type Trace = typeof import('@/server/modules/trace')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let defense: Defense
let records: Records
let reliance: Reliance
let runs: Runs
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

// ---------------------------------------------------------------------------------------------
// Building a run that fills the document
// ---------------------------------------------------------------------------------------------

/** `POST /api/v1/test/runs/{runId}/advance-clock` (D-109): the only honest way to reach a timer. */
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

/**
 * A run at `defense_complete`, having done enough that every part of the export has something in
 * it: a document opened, a delegation answered, a claim traced and stanced again after the action,
 * a brief locked, the Turn answered, and the whole interview typed.
 */
async function runThroughDefense(): Promise<string> {
  const runId = await runInWorking(fx)
  await runs.openDocument(fx.student, runId, fx.documentId('D5'))
  await delegate(fx, runId, 'What is the premium payback?')

  // C1 comes from document D5 and carries a Source Trace path; running it and then stancing gives
  // the claim table a row with an action, a previous stance and a stance set after it.
  const c1 = fx.claimId(claimByKey('C1').key)
  await reliance.setStance(fx.student, runId, c1, 'verify')
  await reliance.runAction(fx.student, runId, c1, 'source_trace')
  await reliance.setStance(fx.student, runId, c1, 'accept')

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
      text: 'The assistant gave me the figure and I did not check its date.',
      durationMs: 1_000,
    })
  }
  await defense.completeDefense(fx.student, runId)
  return runId
}

/** The run's events as written, for the assertions that compare the file with the record. */
async function eventRows(runId: string) {
  return testSql<{ seq: number; type: string; clock_remaining_ms: number | null }[]>`
    select seq, type, clock_remaining_ms from run_events where run_id = ${runId} order by seq`
}

/** Moves a run to `confirmed` without the review module, which is Phase 11's. */
async function markConfirmed(runId: string): Promise<void> {
  await testSql`update runs set state = 'confirmed', confirmed_at = now() where id = ${runId}`
}

type Json = Record<string, unknown>
const asJson = (value: unknown): Json => value as Json
const header = (document: unknown): Json => asJson(asJson(document).header)
const computed = (document: unknown): Json => asJson(asJson(document).computed)
const events = (document: unknown): Json[] => asJson(document).events as Json[]
const claims = (document: unknown): Json[] => asJson(document).claims as Json[]

beforeEach(async () => {
  await truncateAll()
  defense = await import('@/server/modules/defense')
  records = await import('@/server/modules/records')
  reliance = await import('@/server/modules/reliance')
  runs = await import('@/server/modules/runs')
  trace = await import('@/server/modules/trace')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('trace-export')
  await testSql`delete from pgboss.job where name = 'score_run'`
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The header (FR-240)
// ---------------------------------------------------------------------------------------------

describe('the export header', () => {
  it('names the run, its package version, its variant and the policy it displayed', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const [row] = await testSql<
      {
        package_id: string
        version: number
        variant_key: string
        working_clock_seconds: number
        is_walkthrough: boolean
      }[]
    >`select v.package_id, v.version, sv.key as variant_key, r.working_clock_seconds,
             r.is_walkthrough
        from runs r
        join scenario_package_versions v on v.id = r.package_version_id
        join scenario_variants sv on sv.id = r.variant_id
       where r.id = ${runId}`

    expect(header(document)).toMatchObject({
      run_id: runId,
      package_id: row?.package_id,
      package_version: row?.version,
      variant_key: row?.variant_key,
      mode: 'standard',
      working_clock_seconds: row?.working_clock_seconds,
      working_clock_uncalibrated: true,
      is_walkthrough: row?.is_walkthrough,
    })
    // Read back from the `policy_displayed` event, so it is what the student was shown (FR-201).
    expect(header(document).policy).toMatchObject({ outside_ai_policy: expect.any(String) })
  })

  it('carries the package confirmation record and the readiness result', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const confirmations = header(document).package_confirmation_record as Json[]
    const [{ count } = { count: '0' }] = await testSql<{ count: string }[]>`
      select count(*)::text as count from element_confirmations c
        join runs r on r.package_version_id = c.package_version_id where r.id = ${runId}`
    expect(confirmations).toHaveLength(Number(count))
    expect(confirmations.length).toBeGreaterThan(0)
    expect(Object.keys(confirmations[0] ?? {}).sort()).toEqual([
      'decided_at',
      'decided_by_role',
      'decision',
      'element_id',
      'element_type',
    ])

    const readiness = header(document).readiness as Json[]
    const [result] = await testSql<{ concepts: { concept_key: string; status: string }[] }[]>`
      select concepts from run_readiness_results where run_id = ${runId}`
    expect(readiness).toEqual(
      (result?.concepts ?? []).map((concept) => ({
        concept_key: concept.concept_key,
        status: concept.status,
      })),
    )
    expect(readiness.length).toBeGreaterThan(0)
  })

  it('lists every lifecycle transition, in order, and ends where the run does', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const written = await testSql<{ to: string; occurred_at: Date }[]>`
      select payload->>'to' as to, occurred_at from run_events
       where run_id = ${runId} and type = 'lifecycle' order by seq`
    expect(header(document).transitions).toEqual(
      written.map((row) => ({ state: row.to, at: row.occurred_at.toISOString() })),
    )
    const states = (header(document).transitions as Json[]).map((entry) => entry.state)
    expect(states).toContain('defense_complete')
    // `completeDefense` enqueues `score_run` and the drain runs it in the same call (D-046), so a
    // run built by this helper is `scored` by the time it is exported. The list is the `lifecycle`
    // events and nothing else, so it ends wherever the run has actually got to.
    expect(states.at(-1)).toBe('scored')
  })

  it('declares the build’s additions to the PRD’s event list (FR-241)', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')
    expect(header(document).x_tassl_extensions).toEqual([...trace.X_TASSL_EXTENSIONS])
  })
})

// ---------------------------------------------------------------------------------------------
// The events (FR-241)
// ---------------------------------------------------------------------------------------------

describe('the exported events', () => {
  it('are every event of the run, in sequence order, with their clock readings', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')
    const written = await eventRows(runId)

    expect(written.length).toBeGreaterThan(20)
    expect(events(document).map((event) => event.seq)).toEqual(written.map((row) => row.seq))
    expect(events(document).map((event) => event.type)).toEqual(written.map((row) => row.type))
    expect(events(document).map((event) => event.clock_remaining_ms)).toEqual(
      written.map((row) => row.clock_remaining_ms),
    )
    expect(Object.keys(events(document)[0] ?? {}).sort()).toEqual([
      'clock_remaining_ms',
      'occurred_at',
      'payload',
      'seq',
      'type',
    ])
  })

  it('carry the payload as written, in the course form', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const [written] = await testSql<{ payload: Json }[]>`
      select payload from run_events where run_id = ${runId} and type = 'delegation' order by seq`
    const exported = events(document).find((event) => event.type === 'delegation')
    expect(exported?.payload).toEqual(written?.payload)
  })

  it('never name the actor: an export is a file that leaves Tassl', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')
    expect([...keysOf(document)]).not.toContain('actor_id')
    expect([...keysOf(document)]).not.toContain('actorId')
  })
})

// ---------------------------------------------------------------------------------------------
// The claim table (FR-240, D-107)
// ---------------------------------------------------------------------------------------------

describe('the claim table', () => {
  it('has one row per consequential claim in the variant, surfaced or not', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const authored = await testSql<{ key: string }[]>`
      select c.key from scenario_claims c
        join runs r on r.package_version_id = c.package_version_id
       where r.id = ${runId} order by c.position, c.key`
    expect(claims(document).map((row) => row.key)).toEqual(authored.map((row) => row.key))

    const surfaced = await testSql<{ count: string }[]>`
      select count(*)::text as count from run_claims where run_id = ${runId}`
    // The point of D-107: the table is longer than the list of claims the student actually met.
    expect(claims(document).length).toBeGreaterThan(Number(surfaced[0]?.count ?? '0'))
  })

  it('carries the authored standard beside what the run did, field for field', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const row = claims(document).find((entry) => entry.key === claimByKey('C1').key)
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'actions',
      'claim_id',
      'claim_version',
      'consequence_level',
      'evidence_status',
      'failure_family',
      'importance',
      'inconsistency_credited',
      'key',
      'neutralized',
      'previous_stance',
      'readiness_context',
      'relied_on',
      'relied_on_via',
      'stance_taken',
      'stance_taken_at',
      'warranted_stance',
    ])
    expect(row).toMatchObject({
      stance_taken: 'accept',
      previous_stance: 'verify',
      actions: ['source_trace'],
      neutralized: false,
      inconsistency_credited: false,
    })
    expect(row?.stance_taken_at).toEqual(expect.any(String))

    const [authored] = await testSql<
      { evidence_status: string; warranted_stance: string; concept_key: string }[]
    >`select vcs.evidence_status, vcs.warranted_stance, c.concept_key
        from scenario_claims c
        join runs r on r.package_version_id = c.package_version_id
        join variant_claim_states vcs
          on vcs.claim_id = c.id and vcs.variant_id = r.variant_id
       where r.id = ${runId} and c.key = ${claimByKey('C1').key}`
    expect(row?.evidence_status).toBe(authored?.evidence_status)
    expect(row?.warranted_stance).toBe(authored?.warranted_stance)
    // FR-015: the readiness verdict on the concept this claim teaches, per row.
    expect(row?.readiness_context).toMatchObject({ concept_key: authored?.concept_key })
  })

  it('leaves an unsurfaced claim unstanced rather than absent', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const met = await testSql<{ key: string }[]>`
      select c.key from run_claims rc join scenario_claims c on c.id = rc.claim_id
       where rc.run_id = ${runId}`
    const metKeys = new Set(met.map((row) => row.key))
    const unmet = claims(document).filter((row) => !metKeys.has(String(row.key)))
    expect(unmet.length).toBeGreaterThan(0)
    for (const row of unmet) {
      expect(row.stance_taken).toBeNull()
      expect(row.stance_taken_at).toBeNull()
      expect(row.relied_on).toBe(false)
      expect(row.actions).toEqual([])
      // The authored standard is still there: the denominator of the False Challenge Rate is every
      // consequential claim in the variant, met or not (D-107).
      expect(row.warranted_stance).toEqual(expect.any(String))
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The computed block (FR-240)
// ---------------------------------------------------------------------------------------------

describe('the computed block', () => {
  it('carries the three confidences and the figures the scoring job wrote', async () => {
    const runId = await runThroughDefense()
    const document = await trace.buildExport(fx.orgId, runId, 'course')

    const [score] = await testSql<{ false_challenge_rate: string; rubric_version: string }[]>`
      select false_challenge_rate, rubric_version from run_scores where run_id = ${runId}`

    expect(computed(document)).toMatchObject({
      confidence: { frame: FRAME.confidence, lock: BRIEF.confidence, turn: RESPONSE.confidence },
      // Step 10.2's stance matrix computes the rate and Step 10.4's job writes it to `run_scores`;
      // this reads it back from that column and recomputes nothing.
      false_challenge_rate: Number(score?.false_challenge_rate),
      rubric_version: score?.rubric_version,
      // 10 §11.4 keeps `points_draft` out of every export: only confirmed points are exported, and
      // this run's bands have not been confirmed.
      points: null,
      export_version: 1,
    })
    expect(computed(document).exported_at).toEqual(expect.any(String))
  })

  it('carries null for the scored figures on a run the job has not written a score for', async () => {
    const runId = await runThroughDefense()
    await testSql`delete from run_scores where run_id = ${runId}`

    expect(computed(await trace.buildExport(fx.orgId, runId, 'course'))).toMatchObject({
      false_challenge_rate: null,
      rubric_version: null,
      points: null,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The tenant (D-006, D-389)
// ---------------------------------------------------------------------------------------------

describe('the export’s tenancy', () => {
  it('answers NOT_FOUND for a run asked for from another institution', async () => {
    const runId = await runThroughDefense()
    // The run resolves in its own institution and in no other, so a caller that reached
    // `buildExport` without resolving the run first gets nothing rather than a file — which is the
    // whole reason the tenant is a parameter and not an assumption.
    expect(await codeOf(trace.buildExport('org-that-is-not-this-one', runId, 'course'))).toBe(
      'NOT_FOUND',
    )
    expect(await codeOf(trace.buildExport('org-that-is-not-this-one', runId, 'record'))).toBe(
      'NOT_FOUND',
    )
    expect(header(await trace.buildExport(fx.orgId, runId, 'course')).run_id).toBe(runId)
  })
})

// ---------------------------------------------------------------------------------------------
// The two forms (FR-170, FR-243, D-370)
// ---------------------------------------------------------------------------------------------

/**
 * The payload fields `owner-view.ts` withholds from the run's own student in any state, **by event
 * type**.
 *
 * Per type and not as one set of names, because the same word is a different field in two payloads:
 * `probe_fired.claim_id` is `reviewer_only` and `stance_set.claim_id` is the student's own act.
 * That is the collision `owner-view.ts` exists to resolve, and a test that flattened the table
 * would report the resolution as a leak.
 */
const REVIEWER_ONLY_BY_TYPE = new Map(
  RUN_EVENT_TYPES.map((type) => [
    String(type),
    new Set(
      Object.entries(fieldPolicyFor(type) ?? {})
        .filter(([, visibility]) => visibility === 'reviewer_only')
        .map(([key]) => key),
    ),
  ]),
)

/** `type.field` for every reviewer-only field an event stream actually carries. */
function reviewerOnlyFieldsIn(document: unknown): string[] {
  return events(document).flatMap((event) => {
    const forbidden = REVIEWER_ONLY_BY_TYPE.get(String(event.type)) ?? new Set<string>()
    return Object.keys(asJson(event.payload))
      .filter((key) => forbidden.has(key))
      .map((key) => `${String(event.type)}.${key}`)
  })
}

describe('the two forms', () => {
  it('differ by the three course-only keys and nothing else outside the payloads', async () => {
    const runId = await runThroughDefense()
    const course = await trace.buildExport(fx.orgId, runId, 'course')
    const record = await trace.buildExport(fx.orgId, runId, 'record')

    // The header: the policy loses `weight` and `mapping`, and every other field is identical.
    expect(Object.keys(header(record)).sort()).toEqual(Object.keys(header(course)).sort())
    expect(Object.keys(asJson(header(course).policy)).sort()).toEqual([
      'mapping',
      'outside_ai_policy',
      'weight',
    ])
    expect(Object.keys(asJson(header(record).policy))).toEqual(['outside_ai_policy'])
    expect({ ...header(record), policy: undefined }).toEqual({
      ...header(course),
      policy: undefined,
    })

    // The claim table is present in both forms, whole: the PRD says the record carries it.
    expect(claims(record)).toEqual(claims(course))

    // The computed block loses `points` and nothing else. `exported_at` differs by construction —
    // the two documents were built a moment apart — so it is compared for presence, not value.
    expect(Object.keys(computed(course)).sort()).toEqual([
      'confidence',
      'export_version',
      'exported_at',
      'false_challenge_rate',
      'points',
      'rubric_version',
    ])
    expect(Object.keys(computed(record)).sort()).toEqual([
      'confidence',
      'export_version',
      'exported_at',
      'false_challenge_rate',
      'rubric_version',
    ])
    expect({ ...computed(record), exported_at: null }).toEqual({
      ...computed(course),
      exported_at: null,
      points: undefined,
    })

    // The events: same list, same order, same envelopes.
    expect(events(record).map((event) => [event.seq, event.type, event.occurred_at])).toEqual(
      events(course).map((event) => [event.seq, event.type, event.occurred_at]),
    )
  })

  it('carries no weight, mapping or points key anywhere in the record form (FR-170)', async () => {
    const runId = await runThroughDefense()
    const record = await trace.buildExport(fx.orgId, runId, 'record')

    // A *name-containment* filter, not the three literal names. `points_before` satisfied the
    // literal list to the letter and carried the run's points into a student's downloaded record
    // (D-421); the rule §8.1's last row states is the course's arithmetic, however it is spelled.
    const found = [...keysOf(record)].filter((key) =>
      ['weight', 'mapping', 'points'].some((term) =>
        key
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
          .includes(term),
      ),
    )
    expect(found).toEqual([])

    // And the course form does carry them, so the assertion above is about the form and not about
    // a run that happened to have none of the three.
    const course = await trace.buildExport(fx.orgId, runId, 'course')
    expect([...keysOf(course)]).toContain('weight')
    expect([...keysOf(course)]).toContain('mapping')
    expect([...keysOf(course)]).toContain('points')
  })

  it('reduces the policy_displayed payload to the three fields FR-243 leaves (D-370)', async () => {
    const runId = await runThroughDefense()
    const course = await trace.buildExport(fx.orgId, runId, 'course')
    const record = await trace.buildExport(fx.orgId, runId, 'record')

    const shown = (document: unknown) =>
      events(document).find((event) => event.type === 'policy_displayed')?.payload as Json
    expect(Object.keys(shown(course)).sort()).toEqual([
      'counts_statement',
      'mapping',
      'outside_ai_policy',
      'run_type',
      'weight',
    ])
    expect(Object.keys(shown(record)).sort()).toEqual([
      'counts_statement',
      'outside_ai_policy',
      'run_type',
    ])
  })

  it('withholds from the record form every field 12 §8.1 forbids a student (D-370)', async () => {
    const runId = await runThroughDefense()
    const course = await trace.buildExport(fx.orgId, runId, 'course')
    const record = await trace.buildExport(fx.orgId, runId, 'record')

    // The reviewer's copy of this run does carry several of them, so the next assertion is about
    // the projection rather than about a run with nothing to hide.
    const inCourse = new Set(reviewerOnlyFieldsIn(course))
    expect(inCourse).toContain('delegation.flags')
    expect(inCourse).toContain('decision_locked.speed_outlier')
    expect(inCourse).toContain('defense_question.question_id')
    expect(inCourse).toContain('defense_question.selecting_event_seq')
    expect(inCourse).toContain('turn_delivered.window_claim_ids')

    expect(reviewerOnlyFieldsIn(record)).toEqual([])
  })

  it('is audited against student-view.ts, and the only survivor is the documented collision', async () => {
    const runId = await runThroughDefense()
    const record = await trace.buildExport(fx.orgId, runId, 'record')

    // `assertNoForbiddenKeys` is deliberately not applied to this document: it matches names across
    // every payload, and `owner-view.ts` exists because two payloads use the same word for opposite
    // things. This is that guard run as an audit rather than a gate, so the exceptions have to be
    // named one at a time instead of assumed (D-370).
    //
    // The run is `confirmed` before a record exists, so `{ scored: true }` is the stage; `form:
    // 'record'` adds the three keys FR-170 keeps out.
    const findings = findForbiddenKeys(record, { scored: true, form: 'record' })

    // Nothing from the record-form set: FR-170, said a second way.
    expect(findings.filter((finding) => finding.set === 'record_form')).toEqual([])

    // From the never-in-any-state set, exactly one key survives, in exactly one payload:
    // `readiness_item.answer_key` is the key the *student themselves* chose, not the item's answer
    // key, which never enters a payload (`owner-view.ts` header; 12 §8.1's row names
    // `readiness_items` as its source).
    const always = findings.filter((finding) => finding.set === 'always')
    expect([...new Set(always.map((finding) => finding.key))]).toEqual(['answer_key'])
    expect(
      always.every((finding) => /^events\[\d+]\.payload\.answer_key$/.test(finding.path)),
    ).toBe(true)
    for (const finding of always) {
      const index = Number(/^events\[(\d+)]/.exec(finding.path)?.[1])
      expect(events(record)[index]?.type).toBe('readiness_item')
    }

    // And the course form is not a student's document at all, which is why it is never served to
    // one: the same audit over it finds the three course-only keys.
    const course = await trace.buildExport(fx.orgId, runId, 'course')
    const courseFindings = findForbiddenKeys(course, { scored: true, form: 'record' })
    expect([...new Set(courseFindings.map((finding) => finding.key))].sort()).toEqual([
      'answer_key',
      'flags',
      'mapping',
      'points',
      'selecting_event_seq',
      'speed_outlier',
      'weight',
      'window_claim_ids',
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// The endpoint's gate (07 §7, 08 §4)
// ---------------------------------------------------------------------------------------------

describe('the record export', () => {
  it('is refused before the run’s bands are confirmed', async () => {
    const runId = await runThroughDefense()
    expect(await codeOf(records.exportRecord(fx.student, runId))).toBe('RECORD_NOT_AVAILABLE')
  })

  it('is served to the owner from confirmed, in the record form', async () => {
    const runId = await runThroughDefense()
    await markConfirmed(runId)

    const document = await records.exportRecord(fx.student, runId)
    expect(header(document).run_id).toBe(runId)
    expect(
      findForbiddenKeys(document, { scored: true, form: 'record' }).filter(
        (finding) => finding.set === 'record_form',
      ),
    ).toEqual([])
  })

  it('is served to an instructor and a TA of the section, and to no other student', async () => {
    const runId = await runThroughDefense()
    await markConfirmed(runId)

    expect(header(await records.exportRecord(fx.instructor, runId)).run_id).toBe(runId)
    expect(header(await records.exportRecord(fx.ta, runId)).run_id).toBe(runId)
    // A classmate is told nothing, not even that the run exists (08 §4).
    expect(await codeOf(records.exportRecord(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})

describe('the assignment’s export history', () => {
  it('resolves the assignment in the reader’s own institutions and nowhere else', async () => {
    // Nothing has been filed yet — Phase 11's confirmation writes the first version — so the page
    // is empty. What is under test is the resolution above it (D-389): which institution the
    // assignment is looked for in, and in what order the two refusals are made.
    const page = await records.listCourseExports(fx.instructor, fx.assignment.id)
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()

    // A section member holding the wrong role can already see the section, so they are refused
    // rather than told the assignment does not exist.
    expect(await codeOf(records.listCourseExports(fx.student, fx.assignment.id))).toBe('FORBIDDEN')

    // An id that names no assignment at all: NOT_FOUND, before any role is asked for.
    expect(await codeOf(records.listCourseExports(fx.instructor, randomUUID()))).toBe('NOT_FOUND')

    // And an instructor of another institution gets that same answer rather than the FORBIDDEN
    // that would confirm the id resolves to something (08 §4 "Cross-tenant").
    const other = await setupAssistantFixture('trace-export-other')
    expect(await codeOf(records.listCourseExports(other.instructor, fx.assignment.id))).toBe(
      'NOT_FOUND',
    )
  })

  // D-483. The history was guarded on a `section_memberships` row alone while the assignment screen
  // one click up admitted the course's own instructor, so a course creator holding no row in the
  // section saw the "Course exports" link and got a 404 behind it. The two now ask one predicate,
  // and this test is that arrangement: the same seat, with the section row taken away.
  it('draws the replay link for a reviewer who does hold a row in the section (D-517)', async () => {
    const courses = await import('@/server/modules/courses')
    for (const actor of [fx.instructor, fx.ta]) {
      const assignment = await courses.getAssignment(actor, fx.assignment.id)
      expect(assignment.canViewExports).toBe(true)
      expect(assignment.canOpenRuns).toBe(true)
    }
    // And a student of the section gets neither, which is the same answer both endpoints give.
    const forStudent = await courses.getAssignment(fx.student, fx.assignment.id)
    expect(forStudent.canViewExports).toBe(false)
    expect(forStudent.canOpenRuns).toBe(false)
  })

  it('is served to the instructor of the course, who may hold no row in its section (D-483)', async () => {
    const courses = await import('@/server/modules/courses')

    await testSql`delete from section_memberships where user_id = ${fx.instructor.id}`
    // Precondition: this seat really is outside the section now, so the old guard would refuse.
    const [row] = await testSql<{ n: string }[]>`
      select count(*)::text as n from section_memberships where user_id = ${fx.instructor.id}`
    expect(row?.n).toBe('0')

    const page = await records.listCourseExports(fx.instructor, fx.assignment.id)
    expect(page.items).toEqual([])

    // The link's visibility and the endpoint's answer are one bit, published by the service that
    // draws the screen the link is on.
    const assignment = await courses.getAssignment(fx.instructor, fx.assignment.id)
    expect(assignment.canViewExports).toBe(true)
    expect((await courses.listAssignmentRuns(fx.instructor, fx.assignment.id)).items).toEqual([])

    // D-517: and the *replay* link that history draws per row is a different bit, because it is a
    // different guard. `requireRunReviewer` is untouched by D-483 and is still a section row alone,
    // so this seat — which may read the whole export history — may not open a run from it, and the
    // screen has to say so rather than draw a hundred links that all answer 404. That was D-483's
    // own defect, one level over.
    expect(assignment.canOpenRuns).toBe(false)

    // Every row of that history carries a download, and 08 §4 puts the two acts on one row: the
    // same seat reaches `getCourseExport`. This run has filed nothing, so the honest answer is
    // `EXPORT_NOT_FOUND` — which is the point, because the guard's own refusal is `NOT_FOUND` and
    // the two are told apart by their codes.
    const runId = await runInWorking(fx)
    expect(await codeOf(records.getCourseExport(fx.instructor, runId, 'latest'))).toBe(
      'EXPORT_NOT_FOUND',
    )

    // And the widening stops there: a student of the section is still refused — FORBIDDEN, because
    // they can see the section, and never the NOT_FOUND that would confirm an id — and is still
    // told nothing by the screen either.
    expect(await codeOf(records.listCourseExports(fx.student, fx.assignment.id))).toBe('FORBIDDEN')
    expect((await courses.getAssignment(fx.student, fx.assignment.id)).canViewExports).toBe(false)
    expect(await codeOf(records.getCourseExport(fx.student, runId, 'latest'))).toBe('FORBIDDEN')

    // A seat outside the section and outside the course is told the run does not exist (08 §4).
    const other = await setupAssistantFixture('trace-export-outsider')
    expect(await codeOf(records.getCourseExport(other.instructor, runId, 'latest'))).toBe(
      'NOT_FOUND',
    )
  })
})
