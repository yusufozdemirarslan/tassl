// Step 6.4 — the Evidence Room against Postgres (docs/tech/10-backend-spec-modules.md §6;
// 07-api-spec.md §7; FR-020 to FR-024, FR-031, FR-117, DATA-031, D-082).
//
// The room is the Meridian Roast one: nine dated, attributed documents, four of them carrying a
// claim a student can read for themselves (FR-031). A hand-built room would let this file decide
// what "a document" is, and the two things under test are exactly the ones a fixture must not be
// allowed to soften — what the student is handed, and what the run records about it.
//
// **The claims these tests exist to make.**
//
//   1. A body is never handed over without the run recording that it was (FR-022). The workspace
//      lists the room without bodies; the open returns one and writes `document_open` in the same
//      transaction; the close writes `document_close` with the duration and the skim flag.
//   2. The flags are facts about *when* the reading started: `before_first_delegation` is whether
//      the assistant has been used at all, `in_turn_window` whether the read was inside the Turn's
//      twelve minutes, and neither is recomputed at the close.
//   3. The clock bounds the record, not the wall (FR-117): a laptop closed on an open document
//      comes back to a close capped at what the clock had left.
//   4. Nothing in any of it tells the student anything about the claims they are being measured on
//      (12 §8): no evidence status, no warranted stance, no verification path, no skim flag.
//   5. Neither bound invents a reading. An open the clock outlived is not a skim, and one older
//      than the record can hold still closes, so a run is never stuck on it (D-249, D-250).
// @db:truncate
import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Runs = typeof import('@/server/modules/runs')
type RunsService = typeof import('@/server/modules/runs/service')
type Reliance = typeof import('@/server/modules/reliance')
type Trace = typeof import('@/server/modules/trace')
type Scenarios = typeof import('@/server/modules/scenarios')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type OpenRoute = typeof import('@/app/api/v1/runs/[runId]/documents/[documentId]/open/route')
type CloseRoute = typeof import('@/app/api/v1/runs/[runId]/document-opens/[openId]/close/route')
type WorkspaceRoute = typeof import('@/app/api/v1/runs/[runId]/workspace/route')

let runs: Runs
let service: RunsService
let reliance: Reliance
let trace: Trace
let scenarios: Scenarios
let f: Factories
let openRoute: OpenRoute
let closeRoute: CloseRoute
let workspaceRoute: WorkspaceRoute

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

/** The fixture the seed imports (06 §5 item 4): nine documents, eight claims, both variants. */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../src/server/db/fixtures/meridian-roast.package.json', import.meta.url),
    'utf8',
  ),
) as {
  version: { workingClockSeconds: number }
  documents: { key: string; title: string; body: string }[]
  claims: { key: string; sourceKind: string; sourceDocumentKey: string | null }[]
}

const WORKING_CLOCK_MS = FIXTURE.version.workingClockSeconds * 1000

/** A frame that passes FR-040 without saying anything the tests depend on. */
const FRAME = {
  decision:
    'Whether to move acquisition spend from the value tier to the premium tier this quarter',
  assumptions: [
    'Premium retention holds at the piloted level',
    'Value tier payback stays near four months',
    'Supplier cost per bag is stable through the year',
  ],
  position:
    'Lean toward holding spend in the value tier until the premium payback figure is rechecked',
  confidence: 40,
}

async function setup() {
  const { organization } = await f.createInstitution('room')
  const orgId = organization.id

  const instructorUser = await f.createUser('room-instructor')
  const studentUser = await f.createUser('room-student')
  const classmateUser = await f.createUser('room-classmate')
  await f.addMember(orgId, instructorUser.id, 'instructor')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, classmateUser.id, 'student')

  const course = await f.createCourse(orgId, 'room-course', { createdBy: instructorUser.id })
  const section = await f.createSection(orgId, course.id, 'room-section')
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

  const assignment = await f.createAssignment(orgId, section.id, 'room-assignment', {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1 (room)',
  })

  const documents = await testSql<{ id: string; key: string; word_count: number }[]>`
    select id, key, word_count from scenario_documents
    where package_version_id = ${imported.versionId} order by position`

  return {
    orgId,
    versionId: imported.versionId,
    assignment,
    instructor,
    student: actorFor(studentUser, orgId),
    studentUser,
    classmate: actorFor(classmateUser, orgId),
    documents,
  }
}

type Fixture = Awaited<ReturnType<typeof setup>>

let fx: Fixture

/** A run in `framing`: started, policy acknowledged, check submitted (FR-020 opens the room). */
async function runInFraming(): Promise<string> {
  const started = await runs.startRun(fx.student, fx.assignment.id)
  await runs.acknowledgePolicy(fx.student, started.id)
  await runs.submitReadiness(fx.student, started.id)
  return started.id
}

/** The same run, one frame later: `working`, with the clock running (FR-041). */
async function runInWorking(): Promise<string> {
  const runId = await runInFraming()
  await runs.lockFrame(fx.student, runId, FRAME)
  return runId
}

const documentByKey = (key: string): { id: string; key: string; word_count: number } => {
  const row = fx.documents.find((document) => document.key === key)
  if (!row) throw new Error(`the fixture room has no document ${key}`)
  return row
}

/** The raw open rows of a run, oldest first — the table, not a projection of it. */
async function openRows(runId: string) {
  return testSql<
    {
      id: string
      document_id: string
      opened_at: Date
      closed_at: Date | null
      duration_ms: number | null
      before_first_delegation: boolean
      in_turn_window: boolean
      skim: boolean | null
    }[]
  >`select id, document_id, opened_at, closed_at, duration_ms, before_first_delegation,
           in_turn_window, skim
      from run_document_opens where run_id = ${runId} order by opened_at, id`
}

/**
 * Moves one open's `opened_at` back, so that a test can have an open older than the test is.
 *
 * The same instrument the FR-117 case uses on the run's own columns (D-109): timers and durations
 * are server timestamps read lazily (ADR-019), so shifting the timestamp is the only honest way to
 * reach an open that has been open for a month.
 */
async function ageOpen(openId: string, ms: number): Promise<void> {
  await testSql`
    update run_document_opens
    set opened_at = opened_at - ${`${ms} milliseconds`}::interval
    where id = ${openId}`
}

/** The run's events as written, by type — the reviewer's record rather than the owner's view. */
async function eventsOfType(runId: string, type: string) {
  return testSql<{ seq: number; payload: Record<string, unknown> }[]>`
    select seq, payload from run_events where run_id = ${runId} and type = ${type} order by seq`
}

/** Every property name anywhere in a value (12 §8.3). */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => keysOf(entry, out))
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out.add(key)
      keysOf(nested, out)
    }
  }
  return out
}

const expectNoKeys = (value: unknown, forbidden: readonly string[]): void => {
  const present = keysOf(value)
  expect(forbidden.filter((key) => present.has(key))).toEqual([])
}

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  service = await import('@/server/modules/runs/service')
  reliance = await import('@/server/modules/reliance')
  trace = await import('@/server/modules/trace')
  scenarios = await import('@/server/modules/scenarios')
  f = await import('@tests/factories')
  openRoute = await import('@/app/api/v1/runs/[runId]/documents/[documentId]/open/route')
  closeRoute = await import('@/app/api/v1/runs/[runId]/document-opens/[openId]/close/route')
  workspaceRoute = await import('@/app/api/v1/runs/[runId]/workspace/route')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The workspace (FR-020, FR-023)
// ---------------------------------------------------------------------------------------------

describe('getRunWorkspace', () => {
  it('opens with the brief and the whole room, and no document body in it', async () => {
    const runId = await runInFraming()
    const workspace = await runs.getRunWorkspace(fx.student, runId)

    expect(workspace.brief.text.length).toBeGreaterThan(0)
    expect(workspace.documents).toHaveLength(FIXTURE.documents.length)
    // FR-023: nothing is hidden, nothing is locked, and nothing is ordered for them — the room is
    // the room. What is not here is the text: a list carrying nine bodies would make every
    // `document_open` event after it a record of a click rather than of a read (D-243).
    for (const document of workspace.documents) {
      expect(Object.keys(document).sort()).toEqual(['author', 'datedOn', 'id', 'key', 'title'])
    }
    expect(workspace.frame).toBeNull()
    expect(workspace.openDocuments).toEqual([])
    expect(workspace.capabilities).toEqual({
      canOpenDocuments: true,
      canLockFrame: true,
      // FR-020: the room opens with the assistant still locked; the frame is what unlocks it.
      assistantUnlocked: false,
    })
  })

  it('carries the run, and no hint about the claims behind the room (12 §8)', async () => {
    const runId = await runInFraming()
    const workspace = await runs.getRunWorkspace(fx.student, runId)

    expect(workspace.run.id).toBe(runId)
    expect(workspace.run.state).toBe('framing')
    expectNoKeys(workspace, [
      'variantKey',
      'variant',
      'warrantedStance',
      'warranted_stance',
      'evidenceStatus',
      'failureFamily',
      'planted',
      'verificationPaths',
      'role',
      'supersededByDocumentId',
      'stakeholderId',
      'wordCount',
      'escalatable',
      'triggerPhrases',
      'rationale',
      'answerKey',
      'skim',
    ])
  })

  it('lists what is still open, so a reloaded screen can close it', async () => {
    const runId = await runInFraming()
    const deck = documentByKey('D1')
    const { openId } = await runs.openDocument(fx.student, runId, deck.id)

    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.openDocuments).toHaveLength(1)
    expect(workspace.openDocuments[0]).toMatchObject({ openId, documentId: deck.id })
  })

  it('refuses a run that has not reached the room', async () => {
    // The brief and the room open when the Readiness Check closes (FR-020), so a run still on the
    // policy display or in the check has no workspace to draw — and the refusal carries the state,
    // which is what sends the screen to the run's own `links.next`.
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect(await codeOf(runs.getRunWorkspace(fx.student, started.id))).toBe('ILLEGAL_TRANSITION')

    await runs.acknowledgePolicy(fx.student, started.id)
    expect(await codeOf(runs.getRunWorkspace(fx.student, started.id))).toBe('ILLEGAL_TRANSITION')
  })

  it('answers NOT_FOUND to a classmate and to an instructor of the section', async () => {
    const runId = await runInFraming()
    expect(await codeOf(runs.getRunWorkspace(fx.classmate, runId))).toBe('NOT_FOUND')
    expect(await codeOf(runs.getRunWorkspace(fx.instructor, runId))).toBe('NOT_FOUND')
  })

  it('matches its wire contract on the route', async () => {
    // `defineRoute` validates the handler's result against `spec.output` outside production, so
    // driving it through the handler is what proves `RunWorkspace` serializes as 07 §10 documents.
    const runId = await runInFraming()
    const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })
    const response = await workspaceRoute.GET(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/workspace`, { headers }),
      { params: Promise.resolve({ runId }) },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { documents: unknown[]; brief: { text: string } }
    expect(body.documents).toHaveLength(FIXTURE.documents.length)
    expect(body.brief.text.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Opening (FR-022, FR-031)
// ---------------------------------------------------------------------------------------------

describe('openDocument', () => {
  it('is refused before the Readiness Check closes (FR-020)', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    const deck = documentByKey('D1')

    // `assigned`: the policy display has not been acknowledged.
    expect(await codeOf(runs.openDocument(fx.student, started.id, deck.id))).toBe(
      'ILLEGAL_TRANSITION',
    )

    // `readiness`: the check is open, and the room is not.
    await runs.acknowledgePolicy(fx.student, started.id)
    expect(await codeOf(runs.openDocument(fx.student, started.id, deck.id))).toBe(
      'ILLEGAL_TRANSITION',
    )
    expect(await openRows(started.id)).toEqual([])
    expect(await eventsOfType(started.id, 'document_open')).toEqual([])

    // And the moment the check closes, the same call works.
    await runs.submitReadiness(fx.student, started.id)
    const opened = await runs.openDocument(fx.student, started.id, deck.id)
    expect(opened.document.body.length).toBeGreaterThan(0)
  })

  it('returns the document with its body and nothing authored about it', async () => {
    const runId = await runInFraming()
    const deck = documentByKey('D1')
    const opened = await runs.openDocument(fx.student, runId, deck.id)

    expect(Object.keys(opened).sort()).toEqual(['document', 'openId'])
    expect(Object.keys(opened.document).sort()).toEqual([
      'author',
      'body',
      'datedOn',
      'id',
      'key',
      'title',
    ])
    const fixtureBody = FIXTURE.documents.find((document) => document.key === 'D1')?.body
    expect(opened.document.body).toBe(fixtureBody)
    // `role` says this deck is superseded by the retention memo, which is the missed-defect section
    // of the debrief and is withheld until the run is scored (12 §8.2).
    expectNoKeys(opened, ['role', 'supersededByDocumentId', 'stakeholderId', 'wordCount'])
  })

  it('records the open with the flags the payload table names (FR-022)', async () => {
    const runId = await runInFraming()
    const memo = documentByKey('D2')
    const { openId } = await runs.openDocument(fx.student, runId, memo.id)

    const [row] = await openRows(runId)
    expect(row).toMatchObject({
      id: openId,
      document_id: memo.id,
      closed_at: null,
      duration_ms: null,
      // No delegation has been made — the assistant is still locked in `framing` — so the read
      // came before the first use of the assistant, which is the measure FR-022 exists for.
      before_first_delegation: true,
      in_turn_window: false,
      skim: null,
    })

    const [event] = await eventsOfType(runId, 'document_open')
    expect(event?.payload).toEqual({
      open_id: openId,
      document_id: memo.id,
      document_key: 'D2',
      before_first_delegation: true,
      in_turn_window: false,
    })
  })

  it('closes a document still open when the next one is opened (10 §6)', async () => {
    const runId = await runInFraming()
    const first = await runs.openDocument(fx.student, runId, documentByKey('D1').id)
    const second = await runs.openDocument(fx.student, runId, documentByKey('D2').id)

    const rows = await openRows(runId)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.id).toBe(first.openId)
    expect(rows[0]?.closed_at).not.toBeNull()
    expect(rows[1]?.id).toBe(second.openId)
    expect(rows[1]?.closed_at).toBeNull()

    const closes = await eventsOfType(runId, 'document_close')
    expect(closes).toHaveLength(1)
    expect(closes[0]?.payload).toMatchObject({ open_id: first.openId })
  })

  it('surfaces the claims the document carries, once (FR-031)', async () => {
    const runId = await runInFraming()
    const cohortTable = documentByKey('D5')
    const expected = FIXTURE.claims
      .filter((claim) => claim.sourceKind === 'document' && claim.sourceDocumentKey === 'D5')
      .map((claim) => claim.key)
    expect(expected.length).toBeGreaterThan(0)

    await runs.openDocument(fx.student, runId, cohortTable.id)
    const claims = await reliance.listRunClaims(fx.student, runId)
    expect(claims.map((claim) => claim.key)).toEqual(expected)
    expect(claims[0]).toMatchObject({ surfacedBy: 'document', stance: null, reliedOn: false })

    // A claim is surfaced once per run: re-reading the document does not surface it again, and does
    // not move the instant the student first met it.
    const surfacedAt = claims[0]?.surfacedAt
    await runs.openDocument(fx.student, runId, cohortTable.id)
    const again = await reliance.listRunClaims(fx.student, runId)
    expect(again).toHaveLength(claims.length)
    expect(again[0]?.surfacedAt).toBe(surfacedAt)
  })

  it('surfaces nothing from a document no claim is sourced from', async () => {
    const runId = await runInFraming()
    // D1 is the board deck: the claims that rest on it are the assistant's, and they surface when
    // the assistant makes them (Phase 7), not when the student reads the deck.
    await runs.openDocument(fx.student, runId, documentByKey('D1').id)
    expect(await reliance.listRunClaims(fx.student, runId)).toEqual([])
  })

  it('tells a student nothing about the claim beyond the claim (12 §8)', async () => {
    const runId = await runInFraming()
    await runs.openDocument(fx.student, runId, documentByKey('D5').id)
    const claims = await reliance.listRunClaims(fx.student, runId)

    expect(claims.length).toBeGreaterThan(0)
    expectNoKeys(claims, [
      'warrantedStance',
      'warranted_stance',
      'evidenceStatus',
      'failureFamily',
      'planted',
      'verificationPaths',
      'escalatable',
      'escalationReply',
      'triggerPhrases',
      'carriedValues',
      'weaklySourced',
      'volatile',
      'conceptKey',
      'rationale',
    ])
  })

  it('refuses a document that is not in this run’s room, and a classmate', async () => {
    const runId = await runInFraming()
    const other = await f.createUser('room-outsider')
    expect(await codeOf(runs.openDocument(fx.student, runId, crypto.randomUUID()))).toBe(
      'NOT_FOUND',
    )
    expect(await codeOf(runs.openDocument(fx.classmate, runId, documentByKey('D1').id))).toBe(
      'NOT_FOUND',
    )
    expect(
      await codeOf(runs.openDocument(actorFor(other, fx.orgId), runId, documentByKey('D1').id)),
    ).toBe('NOT_FOUND')
  })

  it('matches its wire contract on the route', async () => {
    const runId = await runInFraming()
    const documentId = documentByKey('D3').id
    const headers = new Headers(await asUser(fx.student.id, { activeOrganizationId: fx.orgId }))
    headers.set('x-requested-with', 'tassl')

    const response = await openRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/documents/${documentId}/open`, {
        method: 'POST',
        headers,
      }),
      { params: Promise.resolve({ runId, documentId }) },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { openId: string; document: { body: string } }
    expect(body.document.body.length).toBeGreaterThan(0)
    expect((await openRows(runId))[0]?.id).toBe(body.openId)
  })
})

// ---------------------------------------------------------------------------------------------
// Closing (FR-022, FR-024, FR-117, D-082)
// ---------------------------------------------------------------------------------------------

describe('closeDocument', () => {
  it('records the duration and the skim flag, and writes the close event', async () => {
    const runId = await runInFraming()
    const memo = documentByKey('D2')
    const { openId } = await runs.openDocument(fx.student, runId, memo.id)
    await runs.closeDocument(fx.student, runId, openId)

    const [row] = await openRows(runId)
    expect(row?.closed_at).not.toBeNull()
    expect(row?.duration_ms).toBeGreaterThanOrEqual(0)
    // The memo is 300-odd words, so its threshold is the four-second ceiling and a close that
    // arrives in the same test is a skim (D-082). Nothing anywhere says so to the student.
    expect(row?.duration_ms).toBeLessThan(4_000)
    expect(row?.skim).toBe(true)

    const [event] = await eventsOfType(runId, 'document_close')
    expect(event?.payload).toMatchObject({
      open_id: openId,
      document_id: memo.id,
      duration_ms: row?.duration_ms,
      before_first_delegation: true,
      skim: true,
      in_turn_window: false,
    })
  })

  it('withholds the skim flag from the student’s own trace until the run is scored (D-223)', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D2').id)
    await runs.closeDocument(fx.student, runId, openId)

    const owned = await trace.listEvents(fx.student, runId)
    const close = owned.find((event) => event.type === 'document_close')
    expect(close).toBeDefined()
    expect(close?.payload).toMatchObject({ open_id: openId })
    // Telling a student mid-run that Tassl read their open as a skim is in-run feedback on the
    // thing they are being measured on (12 §8.2).
    expect('skim' in (close?.payload ?? {})).toBe(false)
  })

  it('is idempotent: the client sends close on unmount, on hide, and on unload', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D1').id)

    await runs.closeDocument(fx.student, runId, openId)
    const [afterFirst] = await openRows(runId)
    await runs.closeDocument(fx.student, runId, openId)
    await runs.closeDocument(fx.student, runId, openId)

    const [afterThird] = await openRows(runId)
    expect(afterThird?.closed_at).toEqual(afterFirst?.closed_at)
    expect(afterThird?.duration_ms).toBe(afterFirst?.duration_ms)
    expect(await eventsOfType(runId, 'document_close')).toHaveLength(1)
  })

  it('caps the duration at the clock the open was running against (FR-117)', async () => {
    const runId = await runInWorking()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D4').id)

    // The laptop closed on the supply agreement and came back an hour after the clock ran out.
    // Timers are server timestamps materialized lazily on read (ADR-019), so the only honest way to
    // reach an expiry is to shift the timestamps: D-109's control does the run's clock columns, and
    // the open row is shifted with it so that both describe the same laptop, closed at the frame
    // lock and reopened the next morning.
    const shiftMs = WORKING_CLOCK_MS + 3_600_000
    await service.advanceRunClock(fx.student, runId, { ms: shiftMs })
    await testSql`
      update run_document_opens
      set opened_at = opened_at - ${`${shiftMs} milliseconds`}::interval
      where id = ${openId}`

    await runs.closeDocument(fx.student, runId, openId)

    const [row] = await openRows(runId)
    // The read is recorded as having lasted until the clock ended — twenty-five minutes — not until
    // the student came back, which would have been four hours.
    expect(row?.duration_ms).toBeLessThanOrEqual(WORKING_CLOCK_MS)
    expect(row?.duration_ms).toBeGreaterThan(WORKING_CLOCK_MS - 10_000)
    // And a twenty-five minute read of a 238-word agreement is not a skim, whatever the wall says.
    expect(row?.skim).toBe(false)
  })

  it('refuses an open that does not belong to the run, and a classmate', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D1').id)

    expect(await codeOf(runs.closeDocument(fx.student, runId, crypto.randomUUID()))).toBe(
      'NOT_FOUND',
    )
    expect(await codeOf(runs.closeDocument(fx.classmate, runId, openId))).toBe('NOT_FOUND')
  })

  it('does not mark a read the clock outlived by a second as a skim (D-250)', async () => {
    // The student opened the supply agreement two seconds before their working clock ran out and
    // read it for the next hour. `duration_ms` is the two seconds, because the clock is what the
    // duration is capped at (FR-117) — but the document was in front of them for an hour, and
    // reading the skim flag off the capped number would file that hour as a four-second open.
    const runId = await runInWorking()
    const agreement = documentByKey('D4')
    const { openId } = await runs.openDocument(fx.student, runId, agreement.id)

    // The open is placed exactly two seconds before the clock's zero, from the run's own columns,
    // and the run's clock is then moved back an hour past that zero: an hour of reading, of which
    // the clock was running for two seconds.
    await testSql`
      update run_document_opens o
      set opened_at = (
        select r.working_started_at + r.working_clock_seconds * interval '1 second'
             - interval '2 seconds'
        from runs r where r.id = o.run_id)
      where o.id = ${openId}`
    await service.advanceRunClock(fx.student, runId, { ms: WORKING_CLOCK_MS + 3_600_000 })
    await ageOpen(openId, WORKING_CLOCK_MS + 3_600_000)

    await runs.closeDocument(fx.student, runId, openId)

    const [row] = await openRows(runId)
    expect(row?.duration_ms).toBe(2_000)
    expect(row?.skim).toBe(false)
    const [event] = await eventsOfType(runId, 'document_close')
    expect(event?.payload).toMatchObject({ open_id: openId, duration_ms: 2_000, skim: false })
  })

  it('does not mark a read that began after the clock ran out as a skim (D-250)', async () => {
    // No auto-lock applier lands in this phase (10 §8 branch 2), so a run whose working clock has
    // reached zero sits in `working` with the Evidence Room still open. Every document read from
    // there begins after the clock ended: there is no clock left to cap the read at, and capping it
    // at an instant before it began would file every one of them as a nought-millisecond skim.
    const runId = await runInWorking()
    await service.advanceRunClock(fx.student, runId, { ms: WORKING_CLOCK_MS + 3_600_000 })
    expect((await runs.getRun(fx.student, runId)).state).toBe('working')

    const agreement = documentByKey('D4')
    const { openId } = await runs.openDocument(fx.student, runId, agreement.id)
    await ageOpen(openId, 10 * 60_000)
    await runs.closeDocument(fx.student, runId, openId)

    const [row] = await openRows(runId)
    expect(row?.duration_ms).toBeGreaterThanOrEqual(10 * 60_000)
    expect(row?.duration_ms).toBeLessThan(11 * 60_000)
    expect(row?.skim).toBe(false)
    const [event] = await eventsOfType(runId, 'document_close')
    expect(event?.payload).toMatchObject({ open_id: openId, skim: false })
  })

  it('answers 204 on the route', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D1').id)
    const headers = new Headers(await asUser(fx.student.id, { activeOrganizationId: fx.orgId }))
    headers.set('x-requested-with', 'tassl')

    const response = await closeRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/document-opens/${openId}/close`, {
        method: 'POST',
        headers,
      }),
      { params: Promise.resolve({ runId, openId }) },
    )
    expect(response.status).toBe(204)
    expect((await openRows(runId))[0]?.closed_at).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// An open older than any reading (D-249)
//
// Framing has no clock — the room opens before the frame — so nothing bounds an open made there,
// and `run_document_opens.duration_ms` is an `integer` (DATA-031). A run left in `framing` with a
// document open for twenty-five days therefore reaches a duration int4 cannot hold, and *every*
// writer that closes an open computes it: the close, the next open, and the frame lock. Without a
// ceiling those three are all the student has, they all fail the same way (Postgres 22003, a 500
// with no code any screen can act on), and the run can never leave `framing` again.
// ---------------------------------------------------------------------------------------------

describe('an open older than the record can hold (D-249)', () => {
  /** Past int4 milliseconds (24.8 days), so this is the write that used to be impossible. */
  const AGE_MS = 25 * 86_400_000
  const ABANDONED_OPEN_MS = 86_400_000

  it('closes it at a day, and says so in the row and in the trace', async () => {
    const runId = await runInFraming()
    const memo = documentByKey('D2')
    const { openId } = await runs.openDocument(fx.student, runId, memo.id)
    await ageOpen(openId, AGE_MS)

    await runs.closeDocument(fx.student, runId, openId)

    const [row] = await openRows(runId)
    expect(row?.closed_at).not.toBeNull()
    // Not twenty-five days: the student shut the laptop on the memo and came back a month later,
    // and they were not reading it in between. The row keeps both instants, so the gap between
    // `opened_at` and `closed_at` is where an abandoned open still shows itself.
    expect(row?.duration_ms).toBe(ABANDONED_OPEN_MS)
    expect(row?.skim).toBe(false)
    const [event] = await eventsOfType(runId, 'document_close')
    expect(event?.payload).toMatchObject({
      open_id: openId,
      duration_ms: ABANDONED_OPEN_MS,
      skim: false,
    })
  })

  it('lets the student open the next document, which closes it', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D2').id)
    await ageOpen(openId, AGE_MS)

    const second = await runs.openDocument(fx.student, runId, documentByKey('D1').id)

    const rows = await openRows(runId)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: openId, duration_ms: ABANDONED_OPEN_MS, skim: false })
    expect(rows[1]).toMatchObject({ id: second.openId, closed_at: null })
  })

  it('lets the student lock the frame on top of it', async () => {
    const runId = await runInFraming()
    const { openId } = await runs.openDocument(fx.student, runId, documentByKey('D2').id)
    await ageOpen(openId, AGE_MS)

    const locked = await runs.lockFrame(fx.student, runId, FRAME)

    // The framing period ends at the lock, so the open ends with it — and the run goes on, which
    // is the whole point: an abandoned read is not a reason a student can never decide (FR-041).
    expect(locked.state).toBe('working')
    const [row] = await openRows(runId)
    expect(row).toMatchObject({ id: openId, duration_ms: ABANDONED_OPEN_MS, skim: false })
    expect((await eventsOfType(runId, 'document_close'))[0]?.payload).toMatchObject({
      duration_ms: ABANDONED_OPEN_MS,
    })
  })
})
