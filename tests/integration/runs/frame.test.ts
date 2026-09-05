// Step 6.4 — the frame against Postgres (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md
// §9; 07-api-spec.md §7; PRD §7.4; FR-040 to FR-044, DATA-032).
//
// Framing is the most important control in the product: without a position captured before AI
// enters, nothing distinguishes the student's reasoning from the assistant's (PRD §7.4). So the
// tests here are about one word — *permanent*. The frame is locked in three senses at once, and all
// three are asserted:
//
//   * the run moves `framing → working` and cannot move back (10 §9);
//   * the service offers no way to write a second frame, and a second lock is refused;
//   * the row itself cannot be rewritten by the application role, because migration 0009 revoked
//     UPDATE and DELETE on `run_frames` — which is what makes FR-043's "never restored, edited, or
//     replaced, including by an instructor" a grant rather than a promise.
//
// The validation half is FR-040 and FR-042 together: every field filled, within its limit, and one
// word per field passes. Every refusal names the field, because that is what the form binds to.
// @db:truncate
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, asUser, testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Runs = typeof import('@/server/modules/runs')
type Scenarios = typeof import('@/server/modules/scenarios')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>
type FrameRoute = typeof import('@/app/api/v1/runs/[runId]/frame/route')

let runs: Runs
let scenarios: Scenarios
let f: Factories
let frameRoute: FrameRoute

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

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

type Refusal = { code: string; details: unknown }

const refusalOf = async (promise: Promise<unknown>): Promise<Refusal> => {
  try {
    await promise
    return { code: 'no error', details: null }
  } catch (error) {
    if (!isAppError(error)) return { code: String(error), details: null }
    return { code: error.code, details: error.opts.details }
  }
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../src/server/db/fixtures/meridian-roast.package.json', import.meta.url),
    'utf8',
  ),
) as { version: { workingClockSeconds: number }; documents: { key: string }[] }

/** A frame that meets FR-040: 50 / 25 / 25 / 25 / 100 words at most, confidence 0 to 100. */
const FRAME = {
  decision:
    'Whether the premium tier’s economics justify moving acquisition spend out of the value tier this quarter',
  assumptions: [
    'Premium retention holds near the piloted level for three months',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable through the crop year',
  ],
  position:
    'Lean toward holding spend in the value tier until the premium payback figure has been rechecked against the cohort table',
  confidence: 40,
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

async function setup() {
  const { organization } = await f.createInstitution('frame')
  const orgId = organization.id

  const instructorUser = await f.createUser('frame-instructor')
  const studentUser = await f.createUser('frame-student')
  const classmateUser = await f.createUser('frame-classmate')
  await f.addMember(orgId, instructorUser.id, 'instructor')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, classmateUser.id, 'student')

  const course = await f.createCourse(orgId, 'frame-course', { createdBy: instructorUser.id })
  const section = await f.createSection(orgId, course.id, 'frame-section')
  await f.addSectionMember(orgId, section.id, instructorUser.id, 'instructor')
  await f.addSectionMember(orgId, section.id, studentUser.id, 'student')
  await f.addSectionMember(orgId, section.id, classmateUser.id, 'student')

  const instructor = actorFor(instructorUser, orgId)
  const imported = await scenarios.importPackage(instructor, orgId, {
    ...(FIXTURE as unknown as Record<string, unknown>),
    confirmOnImport: true,
  })
  await scenarios.confirmVersion(instructor, imported.versionId, { teachingNoteChecked: true })

  const variants = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_variants where package_version_id = ${imported.versionId}`
  const defective = variants.find((variant) => variant.key === 'defective')
  if (!defective) throw new Error('the fixture package has no defective variant')

  const assignment = await f.createAssignment(orgId, section.id, 'frame-assignment', {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1 (frame)',
  })

  const documents = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_documents where package_version_id = ${imported.versionId}
    order by position`

  return {
    orgId,
    assignment,
    instructor,
    student: actorFor(studentUser, orgId),
    classmate: actorFor(classmateUser, orgId),
    documents,
  }
}

type Fixture = Awaited<ReturnType<typeof setup>>

let fx: Fixture

async function runInFraming(): Promise<string> {
  const started = await runs.startRun(fx.student, fx.assignment.id)
  await runs.acknowledgePolicy(fx.student, started.id)
  await runs.submitReadiness(fx.student, started.id)
  return started.id
}

async function frameRow(runId: string) {
  const [row] = await testSql<
    {
      decision: string
      assumptions: string[]
      position: string
      confidence: number
      locked_at: Date
    }[]
  >`select decision, assumptions, position, confidence, locked_at
      from run_frames where run_id = ${runId}`
  return row
}

async function eventsOf(runId: string) {
  return testSql<{ seq: number; type: string; payload: Record<string, unknown> }[]>`
    select seq, type, payload from run_events where run_id = ${runId} order by seq`
}

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  scenarios = await import('@/server/modules/scenarios')
  f = await import('@tests/factories')
  frameRoute = await import('@/app/api/v1/runs/[runId]/frame/route')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
  await appSql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------------------------
// Validation (FR-040, FR-042)
// ---------------------------------------------------------------------------------------------

describe('lockFrame validation', () => {
  it('names the empty field', async () => {
    const runId = await runInFraming()

    expect(await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, decision: '' }))).toEqual({
      code: 'FRAME_INVALID',
      details: { field: 'decision', reason: 'required' },
    })
    expect(
      await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, position: '   ' })),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'position', reason: 'required' } })
    expect(
      await refusalOf(
        runs.lockFrame(fx.student, runId, {
          ...FRAME,
          assumptions: [FRAME.assumptions[0]!, '', FRAME.assumptions[2]!],
        }),
      ),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'assumptions.1', reason: 'required' } })
  })

  it('names the field that is over its word limit', async () => {
    const runId = await runInFraming()

    expect(
      await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, decision: words(51) })),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'decision', reason: 'word_limit' } })
    expect(
      await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, position: words(101) })),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'position', reason: 'word_limit' } })
    expect(
      await refusalOf(
        runs.lockFrame(fx.student, runId, {
          ...FRAME,
          assumptions: [FRAME.assumptions[0]!, FRAME.assumptions[1]!, words(26)],
        }),
      ),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'assumptions.2', reason: 'word_limit' } })
  })

  it('requires exactly three assumptions, and names them', async () => {
    const runId = await runInFraming()
    expect(
      await refusalOf(
        runs.lockFrame(fx.student, runId, { ...FRAME, assumptions: FRAME.assumptions.slice(0, 2) }),
      ),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'assumptions', reason: 'required' } })
    expect(
      await refusalOf(
        runs.lockFrame(fx.student, runId, {
          ...FRAME,
          assumptions: [...FRAME.assumptions, 'A fourth thought'],
        }),
      ),
    ).toEqual({ code: 'FRAME_INVALID', details: { field: 'assumptions', reason: 'invalid' } })
  })

  it('requires a whole confidence number between 0 and 100', async () => {
    const runId = await runInFraming()
    for (const confidence of [101, -1, 40.5]) {
      expect(await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, confidence }))).toEqual({
        code: 'FRAME_INVALID',
        details: { field: 'confidence', reason: 'invalid' },
      })
    }
    // The two ends are legal: an honest zero is a reading, not a missing answer (PRD §7.4).
    await runs.lockFrame(fx.student, runId, { ...FRAME, confidence: 0 })
    expect((await frameRow(runId))?.confidence).toBe(0)
  })

  it('writes nothing when it refuses', async () => {
    const runId = await runInFraming()
    await refusalOf(runs.lockFrame(fx.student, runId, { ...FRAME, decision: '' }))

    expect(await frameRow(runId)).toBeUndefined()
    expect((await eventsOf(runId)).filter((event) => event.type === 'frame_locked')).toEqual([])
    expect((await runs.getRun(fx.student, runId)).state).toBe('framing')
  })

  it('accepts one word per field (FR-042)', async () => {
    // "One word per field: passes the gate; costs the student twice, in Framing and in the defense."
    // The gate is not where thin work is dealt with, and this is that decision in one assertion.
    const runId = await runInFraming()
    const summary = await runs.lockFrame(fx.student, runId, {
      decision: 'Pricing',
      assumptions: ['Retention', 'Payback', 'Supply'],
      position: 'Hold',
      confidence: 5,
    })

    expect(summary.state).toBe('working')
    expect(await frameRow(runId)).toMatchObject({
      decision: 'Pricing',
      assumptions: ['Retention', 'Payback', 'Supply'],
      position: 'Hold',
      confidence: 5,
    })
  })

  it('stores the student’s words with pasted markup stripped (10 §5, D-075)', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, {
      ...FRAME,
      decision: '<b>Whether</b> to move spend',
    })
    expect((await frameRow(runId))?.decision).toBe('Whether to move spend')
  })
})

// ---------------------------------------------------------------------------------------------
// The lock (FR-041, 10 §9)
// ---------------------------------------------------------------------------------------------

describe('lockFrame', () => {
  it('moves the run to working and starts the clock', async () => {
    const runId = await runInFraming()
    const before = await runs.getRun(fx.student, runId)
    expect(before.state).toBe('framing')
    expect(before.clock).toBeNull()

    const after = await runs.lockFrame(fx.student, runId, FRAME)

    expect(after.state).toBe('working')
    expect(after.timestamps.workingStartedAt).not.toBeNull()
    // The clock starts full: 25 minutes from the fixture package version, copied onto the run at
    // start so a later edit to the package cannot change a run already under way.
    expect(after.clock?.remainingMs).toBeGreaterThan(
      FIXTURE.version.workingClockSeconds * 1000 - 5_000,
    )
    expect(after.clock?.remainingMs).toBeLessThanOrEqual(FIXTURE.version.workingClockSeconds * 1000)
    expect(after.clock?.paused).toBe(false)
    // FR-041: the assistant unlocks, and nothing is evaluated or said back.
    expect((await runs.getRunWorkspace(fx.student, runId)).capabilities).toEqual({
      canOpenDocuments: true,
      canLockFrame: false,
      assistantUnlocked: true,
    })
  })

  it('writes frame_locked and then the lifecycle event, in that order', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, FRAME)

    const events = await eventsOf(runId)
    const locked = events.find((event) => event.type === 'frame_locked')
    expect(locked?.payload).toEqual({
      decision: FRAME.decision,
      assumptions: FRAME.assumptions,
      position: FRAME.position,
      confidence: FRAME.confidence,
    })

    const lifecycle = events.filter((event) => event.type === 'lifecycle').at(-1)
    expect(lifecycle?.payload).toEqual({ from: 'framing', to: 'working', cause: 'frame_locked' })
    // The frame is written before the run moves: the trace reads as the student locking their
    // frame and the run following, which is the order it happened in.
    expect(locked!.seq).toBeLessThan(lifecycle!.seq)
  })

  it('records the confidence as the run’s first reading (FR-133)', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, { ...FRAME, confidence: 35 })

    const [row] = await testSql<{ confidence_at_frame: number }[]>`
      select confidence_at_frame from runs where id = ${runId}`
    expect(row?.confidence_at_frame).toBe(35)
  })

  it('closes a document left open, before the clock starts (10 §6, FR-117)', async () => {
    const runId = await runInFraming()
    const deck = fx.documents[0]!
    const { openId } = await runs.openDocument(fx.student, runId, deck.id)

    await runs.lockFrame(fx.student, runId, FRAME)

    const [row] = await testSql<{ closed_at: Date | null; duration_ms: number | null }[]>`
      select closed_at, duration_ms from run_document_opens where id = ${openId}`
    expect(row?.closed_at).not.toBeNull()
    // Uncapped: the framing period has no clock to run against, so the read is as long as it was.
    expect(row?.duration_ms).toBeGreaterThanOrEqual(0)

    const closes = (await eventsOf(runId)).filter((event) => event.type === 'document_close')
    expect(closes).toHaveLength(1)
    expect(closes[0]?.payload).toMatchObject({ open_id: openId })
    expect((await runs.getRunWorkspace(fx.student, runId)).openDocuments).toEqual([])
  })

  it('refuses a run that has not reached framing', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect(await refusalOf(runs.lockFrame(fx.student, started.id, FRAME))).toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      details: { from: 'assigned', to: 'working' },
    })

    await runs.acknowledgePolicy(fx.student, started.id)
    expect(await refusalOf(runs.lockFrame(fx.student, started.id, FRAME))).toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      details: { from: 'readiness', to: 'working' },
    })
    expect(await frameRow(started.id)).toBeUndefined()
  })

  it('answers NOT_FOUND to a classmate and to an instructor', async () => {
    const runId = await runInFraming()
    expect((await refusalOf(runs.lockFrame(fx.classmate, runId, FRAME))).code).toBe('NOT_FOUND')
    expect((await refusalOf(runs.lockFrame(fx.instructor, runId, FRAME))).code).toBe('NOT_FOUND')
    expect(await frameRow(runId)).toBeUndefined()
  })

  it('matches its wire contract on the route', async () => {
    const runId = await runInFraming()
    const headers = new Headers(await asUser(fx.student.id, { activeOrganizationId: fx.orgId }))
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')

    const response = await frameRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/frame`, {
        method: 'POST',
        headers,
        body: JSON.stringify(FRAME),
      }),
      { params: Promise.resolve({ runId }) },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { state: string; clock: { remainingMs: number } | null }
    expect(body.state).toBe('working')
    expect(body.clock?.remainingMs).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Permanence (FR-041, FR-043, NFR-004)
// ---------------------------------------------------------------------------------------------

describe('the lock is permanent', () => {
  it('refuses a second lock and leaves the first frame untouched', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, FRAME)

    const refusal = await refusalOf(
      runs.lockFrame(fx.student, runId, { ...FRAME, decision: 'A different decision entirely' }),
    )
    expect(refusal).toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      details: { from: 'working', to: 'working' },
    })

    expect((await frameRow(runId))?.decision).toBe(FRAME.decision)
    expect((await eventsOf(runId)).filter((event) => event.type === 'frame_locked')).toHaveLength(1)
  })

  it('cannot be rewritten or deleted by the application role (migration 0009)', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, FRAME)

    await expect(
      appSql`update run_frames set decision = 'Rewritten after the fact' where run_id = ${runId}`,
    ).rejects.toThrow(/permission denied/)
    await expect(appSql`delete from run_frames where run_id = ${runId}`).rejects.toThrow(
      /permission denied/,
    )

    // And the row is still exactly what the student locked. This is FR-043's "never restored,
    // edited, or replaced, including by an instructor": there is no seat with the grant.
    const [after] = await appSql<{ decision: string; confidence: number }[]>`
      select decision, confidence from run_frames where run_id = ${runId}`
    expect(after).toMatchObject({ decision: FRAME.decision, confidence: FRAME.confidence })
  })

  it('stays visible for the rest of the run (FR-041)', async () => {
    const runId = await runInFraming()
    await runs.lockFrame(fx.student, runId, FRAME)

    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.frame).toMatchObject({
      decision: FRAME.decision,
      assumptions: FRAME.assumptions,
      position: FRAME.position,
      confidence: FRAME.confidence,
    })
    expect(typeof workspace.frame?.lockedAt).toBe('string')
  })
})
