// Step 11.1 — the faculty surface of docs/tech/07-api-spec.md §8, driven as Next drives it: a real
// `Request` through the handler each `src/app/api/v1/**/route.ts` exports, with the session cookie
// `asUser()` mints and the `X-Requested-With: tassl` header every cookie-authenticated mutation
// carries (08 §2.7).
//
//   GET  /review/queue                                         the labelled sample and the real runs
//   GET  /review/sections/{sectionId}/runs                     a section's runs with progress
//   GET  /review/runs/{runId}                                  the replay bundle (FR-180)
//   PUT  /review/runs/{runId}/bands/{dimension}                confirm, override, unassessed
//   POST /review/runs/{runId}/confirm-remaining                the rest at their drafts
//   POST /review/runs/{runId}/claims/{claimId}/neutralize      the correction (FR-003)
//   POST /review/runs/{runId}/void                             void and re-offer (FR-002)
//   POST /review/runs/{runId}/delegations/{id}/flag            out-of-scenario (FR-055)
//   GET  /runs/{runId}/exports, /runs/{runId}/exports/{version} the filed course files (FR-184)
//   GET  /assignments/{assignmentId}/exports                   the history (UI-035)
//   GET  /runs/{runId}/record                                  the student's own record (FR-170)
//
// **The matrix is the point of this file.** 08 §4 gives the replay to an instructor and a TA of the
// run's section and to nobody else; void and neutralize to the instructor alone; the course exports
// to both reviewers and to no student; and the Judgment Record to the run's own student. The replay
// carries warranted stances, evidence status, failure families, the probe and the expected-answer
// notes, so "a student is refused outright" is not a nicety — it is the invariant, and it is checked
// against the real bundle rather than against an empty one.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import { findForbiddenKeys } from '@/server/auth/student-view'
import {
  claimByKey,
  runInWorking,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from '../review/fixture'

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let fx: AssistantFixture
let routes: {
  queue: RouteHandler
  sectionRuns: RouteHandler
  replay: RouteHandler
  band: RouteHandler
  confirmRemaining: RouteHandler
  manualBands: RouteHandler
  neutralize: RouteHandler
  void: RouteHandler
  flag: RouteHandler
  runExports: RouteHandler
  runExportVersion: RouteHandler
  assignmentExports: RouteHandler
  record: RouteHandler
  recordExport: RouteHandler
}

type Called = { status: number; body: unknown }

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  const response = await handler(
    new Request(`http://localhost:3000/api/v1${options.path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  )
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}

const errorOf = (called: Called) =>
  ((called.body as { error?: { code?: unknown; details?: unknown } } | null)?.error ?? {}) as {
    code?: unknown
    details?: unknown
  }

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

beforeEach(async () => {
  await truncateAll()
  routes = {
    queue: (await import('@/app/api/v1/review/queue/route')).GET,
    sectionRuns: (await import('@/app/api/v1/review/sections/[sectionId]/runs/route')).GET,
    replay: (await import('@/app/api/v1/review/runs/[runId]/route')).GET,
    band: (await import('@/app/api/v1/review/runs/[runId]/bands/[dimension]/route')).PUT,
    confirmRemaining: (await import('@/app/api/v1/review/runs/[runId]/confirm-remaining/route'))
      .POST,
    manualBands: (await import('@/app/api/v1/review/runs/[runId]/manual-bands/route')).POST,
    neutralize: (await import('@/app/api/v1/review/runs/[runId]/claims/[claimId]/neutralize/route'))
      .POST,
    void: (await import('@/app/api/v1/review/runs/[runId]/void/route')).POST,
    flag: (await import('@/app/api/v1/review/runs/[runId]/delegations/[delegationId]/flag/route'))
      .POST,
    runExports: (await import('@/app/api/v1/runs/[runId]/exports/route')).GET,
    runExportVersion: (await import('@/app/api/v1/runs/[runId]/exports/[version]/route')).GET,
    assignmentExports: (await import('@/app/api/v1/assignments/[assignmentId]/exports/route')).GET,
    record: (await import('@/app/api/v1/runs/[runId]/record/route')).GET,
    recordExport: (await import('@/app/api/v1/runs/[runId]/record/export/route')).GET,
  }
  fx = await setupAssistantFixture('api-review')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The replay (FR-180) and the row of 08 §4 that matters most
// ---------------------------------------------------------------------------------------------

describe('GET /review/runs/{runId}', () => {
  it('answers a reviewer with the whole bundle, and records the first open (D-120)', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    expect(called.status).toBe(200)

    const bundle = called.body as Record<string, unknown>
    for (const key of [
      'run',
      'events',
      'graphs',
      'defense',
      'bands',
      'delegations',
      'readiness',
      'package',
      'claims',
      'declarations',
      'unverifiedNumbers',
      'neutralizations',
      'exports',
      'flags',
      'labels',
      'capabilities',
    ]) {
      expect(bundle, key).toHaveProperty(key)
    }
    expect((bundle.bands as unknown[]).length).toBe(7)
    expect((bundle.events as unknown[]).length).toBeGreaterThan(0)
    expect(bundle.labels).toMatchObject({ uncalibrated: true })
    expect(bundle.capabilities).toMatchObject({
      canDecide: true,
      canVoid: true,
      canNeutralize: true,
      isInstructor: true,
    })

    // D-120: the first open is stamped once, and reopening does not restamp it.
    const flags = bundle.flags as { replay_first_opened_at?: string }
    expect(typeof flags.replay_first_opened_at).toBe('string')
    const again = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    expect(
      (again.body as { flags: { replay_first_opened_at?: string } }).flags.replay_first_opened_at,
    ).toBe(flags.replay_first_opened_at)
  })

  it('carries the answer key a student may never see, which is why the seat gate is the invariant', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    const document = JSON.stringify(called.body)
    // If any of these ever stopped being in the bundle, the 403 below would be guarding nothing.
    expect(document).toContain('warrantedStance')
    expect(document).toContain('evidenceStatus')
    expect(document).toContain('expectedAnswerNotes')

    // And the same document is full of what 12 §8.1 forbids a student, at real depth.
    const findings = findForbiddenKeys(called.body, { scored: true })
    expect(findings.length).toBeGreaterThan(0)
  })

  it('refuses the run’s own student, a classmate, and a signed-out caller', async () => {
    const runId = await scoredRun(fx)

    // The owner holds a `student` membership on the section, so the reviewer guard reaches them and
    // refuses the role: FORBIDDEN. They read their run through the debrief and the record.
    const owner = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(owner.status).toBe(403)
    expect(errorOf(owner).code).toBe('FORBIDDEN')

    const classmate = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('classmate'),
      params: { runId },
    })
    expect(classmate.status).toBe(404)

    const anonymous = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: null,
      params: { runId },
    })
    expect(anonymous.status).toBe(401)
  })

  it('answers a TA with the bundle and the capabilities of their seat (08 §4)', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.replay, {
      path: `/review/runs/${runId}`,
      session: await sessionFor('ta'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    expect((called.body as { capabilities: Record<string, boolean> }).capabilities).toMatchObject({
      canDecide: true,
      canVoid: false,
      canNeutralize: false,
      canForceFailure: false,
      isInstructor: false,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The decisions, the correction and the void, on the wire
// ---------------------------------------------------------------------------------------------

describe('the faculty mutations', () => {
  it('decides a band and confirms the rest', async () => {
    const runId = await scoredRun(fx)
    const decided = await call(routes.band, {
      method: 'PUT',
      path: `/review/runs/${runId}/bands/framing`,
      session: await sessionFor('instructor'),
      params: { runId, dimension: 'framing' },
      body: { decision: 'overridden', band: 'developing', note: 'A wider net is defensible.' },
    })
    expect(decided.status).toBe(200)
    expect((decided.body as { band: { decision: string } }).band.decision).toBe('overridden')

    const rest = await call(routes.confirmRemaining, {
      method: 'POST',
      path: `/review/runs/${runId}/confirm-remaining`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    expect(rest.status).toBe(200)
    expect((rest.body as { state: string }).state).toBe('confirmed')
  })

  it('refuses an override with no band, in the envelope 07 §1 specifies', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.band, {
      method: 'PUT',
      path: `/review/runs/${runId}/bands/framing`,
      session: await sessionFor('instructor'),
      params: { runId, dimension: 'framing' },
      body: { decision: 'overridden' },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called)).toMatchObject({ code: 'BAND_DECISION_INVALID' })
    expect((called.body as { error: { requestId?: string } }).error.requestId).toBeTruthy()
  })

  it('gives void and neutralize to the instructor and refuses the TA (08 §4)', async () => {
    const runId = await scoredRun(fx)
    const claimId = fx.claimId(claimByKey('C3').key)

    const taNeutralize = await call(routes.neutralize, {
      method: 'POST',
      path: `/review/runs/${runId}/claims/${claimId}/neutralize`,
      session: await sessionFor('ta'),
      params: { runId, claimId },
      body: { reason: 'unintended_defect', creditChallenge: false, note: '' },
    })
    expect(taNeutralize.status).toBe(403)

    const neutralized = await call(routes.neutralize, {
      method: 'POST',
      path: `/review/runs/${runId}/claims/${claimId}/neutralize`,
      session: await sessionFor('instructor'),
      params: { runId, claimId },
      body: {
        reason: 'unintended_defect',
        creditChallenge: true,
        note: 'Unintended contradiction.',
      },
    })
    expect(neutralized.status).toBe(200)
    expect(
      (neutralized.body as { recompute: { dimensions: string[] } }).recompute.dimensions,
    ).toEqual(['verification', 'calibration'])

    const taVoid = await call(routes.void, {
      method: 'POST',
      path: `/review/runs/${runId}/void`,
      session: await sessionFor('ta'),
      params: { runId },
      body: { reason: 'other', reoffer: false },
    })
    expect(taVoid.status).toBe(403)
  })

  it('voids and re-offers through the wire', async () => {
    const runId = await runInWorking(fx)
    const called = await call(routes.void, {
      method: 'POST',
      path: `/review/runs/${runId}/void`,
      session: await sessionFor('instructor'),
      params: { runId },
      body: { reason: 'walkthrough', note: 'auto-lock test run', reoffer: true },
    })
    expect(called.status).toBe(200)
    const body = called.body as { voided: { state: string }; reoffered: { state: string } | null }
    expect(body.voided.state).toBe('voided')
    expect(body.reoffered?.state).toBe('assigned')
  })

  it('flags an out-of-scenario delegation (FR-055)', async () => {
    const { delegate } = await import('../review/fixture')
    const runId = await runInWorking(fx)
    const delegationId = await delegate(fx, runId, 'What is the premium payback?')

    const called = await call(routes.flag, {
      method: 'POST',
      path: `/review/runs/${runId}/delegations/${delegationId}/flag`,
      session: await sessionFor('instructor'),
      params: { runId, delegationId },
      body: { flag: 'out_of_scenario' },
    })
    expect(called.status).toBe(200)
    expect((called.body as { flags?: string[] }).flags).toContain('out_of_scenario')
  })
})

// ---------------------------------------------------------------------------------------------
// The queue and the section list
// ---------------------------------------------------------------------------------------------

describe('the queue and the section list', () => {
  it('answers a reviewer with the labelled sample beside their real runs (D-035, D-096)', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.queue, {
      path: '/review/queue',
      session: await sessionFor('instructor'),
    })
    expect(called.status).toBe(200)
    const body = called.body as { illustrative: unknown[]; runs: { id: string }[] }
    expect(body.runs.map((row) => row.id)).toContain(runId)
    // The two lists are separate keys and are never merged (D-096).
    expect(Array.isArray(body.illustrative)).toBe(true)
  })

  it('answers a section’s runs to its reviewers and refuses a student', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.sectionRuns, {
      path: `/review/sections/${fx.assignment.sectionId}/runs`,
      session: await sessionFor('ta'),
      params: { sectionId: fx.assignment.sectionId },
    })
    expect(called.status).toBe(200)
    const rows = called.body as { id: string; decisionsMade: number; variantKey: string }[]
    const row = rows.find((entry) => entry.id === runId)
    expect(row).toMatchObject({ decisionsMade: 0 })
    expect(['defective', 'sound']).toContain(row?.variantKey)

    const student = await call(routes.sectionRuns, {
      path: `/review/sections/${fx.assignment.sectionId}/runs`,
      session: await sessionFor('student'),
      params: { sectionId: fx.assignment.sectionId },
    })
    expect(student.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------------------------
// The exports and the record (FR-170, FR-184, FR-204, D-421, D-434)
// ---------------------------------------------------------------------------------------------

describe('the course exports', () => {
  it('lists and downloads for a reviewer, and refuses every student', async () => {
    const runId = await scoredRun(fx)
    await call(routes.confirmRemaining, {
      method: 'POST',
      path: `/review/runs/${runId}/confirm-remaining`,
      session: await sessionFor('instructor'),
      params: { runId },
    })

    const listed = await call(routes.runExports, {
      path: `/runs/${runId}/exports`,
      session: await sessionFor('ta'),
      params: { runId },
    })
    expect(listed.status).toBe(200)
    expect((listed.body as { version: number; reason: string }[])[0]).toMatchObject({
      version: 1,
      reason: 'initial',
    })

    const file = await call(routes.runExportVersion, {
      path: `/runs/${runId}/exports/latest`,
      session: await sessionFor('instructor'),
      params: { runId, version: 'latest' },
    })
    expect(file.status).toBe(200)
    // The course form is the one that carries the course's arithmetic (FR-243).
    expect((file.body as { computed: { points: number | null } }).computed.points).not.toBeNull()

    const history = await call(routes.assignmentExports, {
      path: `/assignments/${fx.assignment.id}/exports`,
      session: await sessionFor('instructor'),
      params: { assignmentId: fx.assignment.id },
    })
    expect(history.status).toBe(200)
    expect((history.body as { items: unknown[] }).items).toHaveLength(1)

    // 08 §4 gives the course export to no student at all — not the run's own.
    for (const seat of ['student', 'classmate'] as const) {
      const refused = await call(routes.runExports, {
        path: `/runs/${runId}/exports`,
        session: await sessionFor(seat),
        params: { runId },
      })
      expect([403, 404]).toContain(refused.status)
    }
    const refusedHistory = await call(routes.assignmentExports, {
      path: `/assignments/${fx.assignment.id}/exports`,
      session: await sessionFor('student'),
      params: { assignmentId: fx.assignment.id },
    })
    expect(refusedHistory.status).toBe(403)
  })

  it('refuses the history of a run whose bands nobody has confirmed', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.runExports, {
      path: `/runs/${runId}/exports`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    expect(called.status).toBe(409)
    expect(errorOf(called)).toMatchObject({
      code: 'RUN_NOT_CONFIRMED',
      details: { state: 'scored' },
    })
  })
})

describe('GET /runs/{runId}/record', () => {
  it('answers the owner from confirmed, and carries no weight, mapping or points at any depth', async () => {
    const runId = await scoredRun(fx)

    const early = await call(routes.record, {
      path: `/runs/${runId}/record`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(early.status).toBe(409)
    expect(errorOf(early)).toMatchObject({
      code: 'RECORD_NOT_AVAILABLE',
      details: { state: 'scored' },
    })

    await call(routes.confirmRemaining, {
      method: 'POST',
      path: `/review/runs/${runId}/confirm-remaining`,
      session: await sessionFor('instructor'),
      params: { runId },
    })

    const called = await call(routes.record, {
      path: `/runs/${runId}/record`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    const record = called.body as {
      bands: { dimension: string; band: string | null }[]
      graphs: Record<string, unknown>
      variant: { key: string }
      trace: Record<string, unknown>
    }
    expect(record.bands).toHaveLength(7)
    expect(Object.keys(record.graphs).sort()).toEqual([
      'clock_timeline',
      'confidence_line',
      'frame_beside_decision',
      'stance_matrix',
    ])
    expect(['defective', 'sound']).toContain(record.variant.key)
    expect(record.trace).toHaveProperty('header')

    // D-421: name containment at any depth, over a record built from a run that actually happened.
    // A sweep whose fixture is empty passes vacuously, so the assertions above — seven bands, four
    // graphs, a real trace — are what make this one mean something.
    //
    // Two exceptions, both named rather than assumed. `confidence_line.points` are the three
    // plotted readings of the student's own confidence, not the course's arithmetic (D-438); the
    // embedded trace legitimately holds `readiness_item.answer_key`, the key the student themselves
    // chose, which `tests/integration/trace/export.test.ts` audits key by key (D-370).
    const { trace: _trace, ...own } = called.body as Record<string, unknown>
    const sweep = findForbiddenKeys(own, { scored: true, form: 'record' })
    expect(sweep.map((finding) => finding.path)).toEqual(['graphs.confidence_line.points'])

    // FR-106: the graph a student reads carries no instructor flag. The reviewer's copy of the same
    // graph does — which is what makes this a projection rather than a coincidence.
    const graphs = record.graphs as {
      frame_beside_decision: { brief: Record<string, unknown> | null }
    }
    expect(graphs.frame_beside_decision.brief).not.toHaveProperty('speed_outlier')
    expect(graphs.frame_beside_decision.brief).toHaveProperty('recommendation')

    const traceSweep = findForbiddenKeys(_trace, { scored: true, form: 'record' })
    expect(traceSweep.filter((finding) => finding.set === 'record_form')).toEqual([])
  })

  it('is the owner’s alone: a reviewer and a classmate are refused', async () => {
    const runId = await scoredRun(fx)
    await call(routes.confirmRemaining, {
      method: 'POST',
      path: `/review/runs/${runId}/confirm-remaining`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    for (const seat of ['instructor', 'ta', 'classmate'] as const) {
      const refused = await call(routes.record, {
        path: `/runs/${runId}/record`,
        session: await sessionFor(seat),
        params: { runId },
      })
      expect(refused.status).toBe(404)
    }
  })

  it('and the record-form file it downloads carries none of it either (FR-243)', async () => {
    const runId = await scoredRun(fx)
    await call(routes.confirmRemaining, {
      method: 'POST',
      path: `/review/runs/${runId}/confirm-remaining`,
      session: await sessionFor('instructor'),
      params: { runId },
    })
    const called = await call(routes.recordExport, {
      path: `/runs/${runId}/record/export`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    // The same rule as the record view, over the file itself: no key whose name contains `weight`,
    // `mapping` or `points`, at any depth (FR-243, D-421).
    const sweep = findForbiddenKeys(called.body, { scored: true, form: 'record' })
    expect(sweep.filter((finding) => finding.set === 'record_form')).toEqual([])
  })
})
