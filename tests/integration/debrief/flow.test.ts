// Step 11.2 — the Run Debrief against Postgres (docs/tech/10-backend-spec-modules.md §13;
// 07-api-spec.md §7; 08-auth-authz.md §4; FR-150 to FR-155, D-091).
//
// What only a database can say about this screen is what the *same URL* answers at two different
// points in the run's life, and what the trace holds afterwards. Six claims are worth a suite.
//
//   * **The draft debrief is the scored run's** (FR-150): every band a draft, provisional points
//     drawn from the draft bands, and the twelve sections in the order FR-151 walks the run in.
//   * **The confirmed debrief is the same route** (FR-150): after the seventh decision the bands the
//     instructor decided replace the drafts in place, with the note they wrote, and the points the
//     course exports appear beside the provisional ones.
//   * **`debrief_opened` is written once per version** (10 §13), so a student who read the draft and
//     came back after the confirmation has opened a debrief the trace records them opening.
//   * **Answering closes the run** (FR-152): the `debrief_answer` event, the `run_debrief_answers`
//     row, and `confirmed → recorded` — or, when the bands are still draft, the answer waits and the
//     confirmation makes the transition.
//   * **The reviewer reads the same document with no form** (FR-154): identical sections and
//     identical graphs, and `questions.canAnswer` false — the two questions are the student's
//     reflection on their own run, not a field a reviewer fills.
//   * **Nothing on this page is a thing a student may not see** (12 §8.1, D-117), checked against the
//     *real* payload of a real run rather than against an empty fixture: the band reads' quotes and
//     stored sequence numbers, `runs.flags`, the expected-answer notes and the question bank are all
//     absent, at any depth, in both versions.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { stopBoss } from '@/server/jobs/boss'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { DEBRIEF_SECTION_ORDER } from '@/server/modules/debrief'
import {
  runInWorking,
  runRow,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from '../review/fixture'

type Debrief = typeof import('@/server/modules/debrief')
type Review = typeof import('@/server/modules/review')
type Scoring = typeof import('@/server/modules/scoring')

let debrief: Debrief
let review: Review
let scoring: Scoring
let fx: AssistantFixture

beforeEach(async () => {
  await truncateAll()
  debrief = await import('@/server/modules/debrief')
  review = await import('@/server/modules/review')
  scoring = await import('@/server/modules/scoring')
  fx = await setupAssistantFixture('debrief-flow')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

async function eventsOfType(runId: string, type: string) {
  return testSql<{ seq: number; payload: Record<string, unknown>; actor_id: string | null }[]>`
    select seq, payload, actor_id from run_events
     where run_id = ${runId} and type = ${type} order by seq`
}

async function answerRow(runId: string) {
  const [row] = await testSql<
    { stance_to_change: string; do_differently: string; answered_at: Date }[]
  >`select stance_to_change, do_differently, answered_at from run_debrief_answers
      where run_id = ${runId}`
  return row
}

/** The whole confirmation, with one dimension overridden and a note on it (FR-181, FR-182). */
const NOTE = 'A wider net is defensible when the information is thin.'
async function confirmAll(runId: string): Promise<void> {
  await review.decideBand(fx.instructor, runId, 'framing', {
    decision: 'overridden',
    band: 'proficient',
    note: NOTE,
  })
  await review.confirmRemaining(fx.instructor, runId)
}

const ANSWERS = {
  stanceToChange: 'I would have verified C3 before pricing the recommendation on it.',
  doDifferently: 'Read the retention memo before opening the assistant.',
}

// ---------------------------------------------------------------------------------------------
// The draft debrief (FR-150, FR-151, D-091)
// ---------------------------------------------------------------------------------------------

describe('the draft debrief', () => {
  it('walks the run in the fixed order, with a reason on every section it cannot draw', async () => {
    const runId = await scoredRun(fx)
    const view = await debrief.getDebrief(fx.student, runId)

    expect(view.sections.map((section) => section.key)).toEqual([...DEBRIEF_SECTION_ORDER])
    for (const section of view.sections) {
      if (section.available) continue
      expect(section.reason, section.key).toBeTruthy()
    }
    // A run that reached `scored` has all four graphs, so these four are drawn from real payloads.
    for (const key of [
      'frame_beside_decision',
      'stance_matrix',
      'confidence_line',
      'clock_timeline',
    ]) {
      expect(view.sections.find((section) => section.key === key)?.available, key).toBe(true)
    }
  })

  it('shows every band as a draft, with provisional points and no confirmed points (D-091)', async () => {
    const runId = await scoredRun(fx)
    const view = await debrief.getDebrief(fx.student, runId)
    const score = await scoring.readScore(runId)

    expect(view.labels.version).toBe('draft')
    expect(view.labels.uncalibrated).toBe(true)
    expect(view.bands).toHaveLength(7)
    expect(view.bands.every((band) => band.decision === null)).toBe(true)
    expect(view.bands.every((band) => band.note === null)).toBe(true)
    expect(view.points.draft).toBe(score?.pointsDraft ?? null)
    expect(view.points.confirmed).toBeNull()
    expect(view.points.mapping).toEqual({
      novice: 1,
      developing: 2,
      proficient: 3,
      professional: 4,
    })
    expect(view.points.weight).toBeGreaterThan(0)
  })

  it('walks every consequential claim, with the authored reason beside the student stance', async () => {
    const runId = await scoredRun(fx)
    const view = await debrief.getDebrief(fx.student, runId)
    const matrix = view.sections.find((section) => section.key === 'stance_matrix')
    const claims = (
      matrix?.data as { claims: { key: string; rationale: string; lines: string[] }[] }
    ).claims

    const versionClaims = await testSql<{ total: number }[]>`
      select count(*)::int as total from scenario_claims
       where package_version_id = ${fx.versionId}`
    expect(claims).toHaveLength(versionClaims[0]?.total ?? 0)
    const c1 = claims.find((claim) => claim.key === 'C1')
    expect(c1?.rationale.length).toBeGreaterThan(0)
    expect(c1?.lines.length).toBeGreaterThan(0)
  })

  it('names at least one thing this run did (FR-153)', async () => {
    const runId = await scoredRun(fx)
    const view = await debrief.getDebrief(fx.student, runId)
    expect(view.doneWell.length).toBeGreaterThan(0)
  })

  it('writes `debrief_opened { version: draft }` once, however often it is opened', async () => {
    const runId = await scoredRun(fx)
    await debrief.getDebrief(fx.student, runId)
    await debrief.getDebrief(fx.student, runId)
    await debrief.getDebrief(fx.student, runId)

    const opened = await eventsOfType(runId, 'debrief_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0]?.payload.version).toBe('draft')
  })

  it('is refused before the run has bands, and names the state it is waiting on', async () => {
    const runId = await runInWorking(fx)
    const error = await debrief
      .getDebrief(fx.student, runId)
      .then(() => null)
      .catch((caught: unknown) => caught)
    expect(isAppError(error) && error.code).toBe('DEBRIEF_NOT_AVAILABLE')
    expect(isAppError(error) && error.opts.details).toMatchObject({ state: 'working' })
  })

  it('is not another student’s to read (08 §4)', async () => {
    const runId = await scoredRun(fx)
    expect(await codeOf(debrief.getDebrief(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The confirmed debrief, on the same route (FR-150)
// ---------------------------------------------------------------------------------------------

describe('the confirmed debrief', () => {
  it('replaces the drafts with what the instructor decided, with the note', async () => {
    const runId = await scoredRun(fx)
    const draft = await debrief.getDebrief(fx.student, runId)
    await confirmAll(runId)
    const confirmed = await debrief.getDebrief(fx.student, runId)

    expect(draft.labels.version).toBe('draft')
    expect(confirmed.labels.version).toBe('confirmed')
    expect(confirmed.bands.every((band) => band.decision !== null)).toBe(true)
    const framing = confirmed.bands.find((band) => band.dimension === 'framing')
    expect(framing).toMatchObject({ decision: 'overridden', band: 'proficient', note: NOTE })
    // The other six carry the drafts they were confirmed at, and no note.
    for (const band of confirmed.bands) {
      if (band.dimension === 'framing') continue
      expect(band.note, band.dimension).toBeNull()
    }
  })

  it('shows the points the course exports, computed from the confirmed bands', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    const view = await debrief.getDebrief(fx.student, runId)
    const score = await scoring.readScore(runId)

    expect(view.points.confirmed).not.toBeNull()
    expect(view.points.confirmed).toBe(score?.pointsConfirmed ?? null)
    expect(view.points.assessed).toBe(view.bands.filter((band) => band.band !== null).length)
  })

  it('writes a second `debrief_opened` for the confirmed version and no more (10 §13)', async () => {
    const runId = await scoredRun(fx)
    await debrief.getDebrief(fx.student, runId)
    await confirmAll(runId)
    await debrief.getDebrief(fx.student, runId)
    await debrief.getDebrief(fx.student, runId)

    const opened = await eventsOfType(runId, 'debrief_opened')
    expect(opened.map((event) => event.payload.version)).toEqual(['draft', 'confirmed'])
  })
})

// ---------------------------------------------------------------------------------------------
// The two questions (FR-152, DATA-043)
// ---------------------------------------------------------------------------------------------

describe('answerDebrief', () => {
  it('files both answers, writes the event, and moves a confirmed run to recorded', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    const summary = await debrief.answerDebrief(fx.student, runId, ANSWERS)

    expect(summary.state).toBe('recorded')
    expect(await runRow(runId)).toMatchObject({ state: 'recorded' })
    expect(await answerRow(runId)).toMatchObject({
      stance_to_change: ANSWERS.stanceToChange,
      do_differently: ANSWERS.doDifferently,
    })
    const events = await eventsOfType(runId, 'debrief_answer')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      stance_to_change: ANSWERS.stanceToChange,
      do_differently: ANSWERS.doDifferently,
    })
    expect(events[0]?.actor_id).toBe(fx.student.id)
  })

  it('waits when the bands are still draft, and the confirmation makes the transition (FR-152)', async () => {
    const runId = await scoredRun(fx)
    const answered = await debrief.answerDebrief(fx.student, runId, ANSWERS)
    expect(answered.state).toBe('scored')

    await confirmAll(runId)
    expect(await runRow(runId)).toMatchObject({ state: 'recorded' })
  })

  it('shows the filed answers back and closes the form', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    await debrief.answerDebrief(fx.student, runId, ANSWERS)
    const view = await debrief.getDebrief(fx.student, runId)

    expect(view.questions).toMatchObject({
      answered: true,
      canAnswer: false,
      stanceToChange: ANSWERS.stanceToChange,
      doDifferently: ANSWERS.doDifferently,
    })
    expect(view.questions.answeredAt).not.toBeNull()
  })

  it('takes one answer per run (FR-152)', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    await debrief.answerDebrief(fx.student, runId, ANSWERS)
    expect(await codeOf(debrief.answerDebrief(fx.student, runId, ANSWERS))).toBe('DEBRIEF_ANSWERED')
  })

  it('is the student’s alone: neither the instructor nor a classmate may file it', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    expect(await codeOf(debrief.answerDebrief(fx.instructor, runId, ANSWERS))).toBe('NOT_FOUND')
    expect(await codeOf(debrief.answerDebrief(fx.classmate, runId, ANSWERS))).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The reviewer's view (FR-154)
// ---------------------------------------------------------------------------------------------

describe('the reviewer reads the same document', () => {
  it('has no answer form, and says so on the wire rather than by role', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    const view = await debrief.getDebrief(fx.instructor, runId)

    expect(view.labels.viewer).toBe('reviewer')
    expect(view.questions.canAnswer).toBe(false)
    expect(view.questions.answered).toBe(false)
    expect(t('debrief.questions.readOnly').length).toBeGreaterThan(0)
  })

  it('sees identical sections and identical graphs, from the same trace', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    const student = await debrief.getDebrief(fx.student, runId)
    const instructor = await debrief.getDebrief(fx.instructor, runId)
    const ta = await debrief.getDebrief(fx.ta, runId)

    const sectionsOf = (view: typeof student) =>
      view.sections.map(({ key, available, data }) => ({ key, available, data }))
    expect(sectionsOf(instructor)).toEqual(sectionsOf(student))
    expect(sectionsOf(ta)).toEqual(sectionsOf(student))
    expect(instructor.bands).toEqual(student.bands)
    expect(instructor.doneWell).toBe(student.doneWell)
    expect(instructor.points).toEqual(student.points)
  })

  it('does not consume the student’s own first open (D-444)', async () => {
    const runId = await scoredRun(fx)
    await debrief.getDebrief(fx.instructor, runId)
    expect(await eventsOfType(runId, 'debrief_opened')).toHaveLength(0)

    await debrief.getDebrief(fx.student, runId)
    const opened = await eventsOfType(runId, 'debrief_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0]?.payload.version).toBe('draft')
  })
})

// ---------------------------------------------------------------------------------------------
// The student-view sweep, with real data (12 §8.1, D-117)
// ---------------------------------------------------------------------------------------------

describe('what the debrief may not carry', () => {
  /** Every key of the payload, at any depth, so an assertion below cannot pass vacuously. */
  function keysOf(payload: unknown, out: Set<string> = new Set()): Set<string> {
    if (payload === null || typeof payload !== 'object') return out
    if (Array.isArray(payload)) {
      for (const entry of payload) keysOf(entry, out)
      return out
    }
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      out.add(key)
      keysOf(value, out)
    }
    return out
  }

  it('carries nothing `student-view.ts` withholds, in either version, for either reader', async () => {
    const runId = await scoredRun(fx)
    const draft = await debrief.getDebrief(fx.student, runId)
    await confirmAll(runId)
    const confirmed = await debrief.getDebrief(fx.student, runId)
    const reviewer = await debrief.getDebrief(fx.instructor, runId)

    // The fixture is not empty: this is a real scored run with a real trace behind it.
    expect(keysOf(draft).size).toBeGreaterThan(40)
    for (const [name, view] of [
      ['draft', draft],
      ['confirmed', confirmed],
      ['reviewer', reviewer],
    ] as const) {
      expect(findForbiddenKeys(view, { scored: true }), name).toEqual([])
    }
  })

  it('carries no reviewer-only band evidence at any depth', async () => {
    const runId = await scoredRun(fx)
    await confirmAll(runId)
    const view = await debrief.getDebrief(fx.student, runId)
    const keys = keysOf(view)

    // The bands really do carry these for a reviewer, so the absence below is a projection rather
    // than an empty run.
    const bandViews = await scoring.readBands(runId)
    expect(bandViews.some((band) => band.evidenceEventSeqs.length > 0)).toBe(true)

    for (const forbidden of ['quotes', 'evidenceEventSeqs', 'evidence_event_seqs', 'decidedBy']) {
      expect(keys.has(forbidden), forbidden).toBe(false)
    }
  })

  it('carries the four graphs the record does, with FR-106’s instructor flag withheld (D-438)', async () => {
    const runId = await scoredRun(fx)
    const view = await debrief.getDebrief(fx.student, runId)
    const frame = view.sections.find((section) => section.key === 'frame_beside_decision')
    const graph = (frame?.data as { graph: Record<string, unknown> }).graph
    const brief = graph.brief as Record<string, unknown>

    expect(Object.keys(brief)).not.toContain('speed_outlier')
    expect(brief.recommendation).toBeTruthy()
  })
})
