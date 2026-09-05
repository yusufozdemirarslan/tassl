// Step 6.3 — the Readiness Check against Postgres (docs/tech/10-backend-spec-modules.md §6;
// 10-backend-spec.md §8 branch 1; 07-api-spec.md §7; FR-010 to FR-018, DATA-030, NFR-002).
//
// The check runs on the real Meridian Roast package rather than on a hand-built one: sixteen items
// in the 6 / 4 / 6 split, eleven concepts between them, and the answer keys the disciplinary
// authority confirmed. A hand-built set would let this file decide what "sixteen items" means,
// which is the one thing the fixture is for.
//
// **The claim these tests exist to make.** Correctness is computed server-side and no response a
// student can reach carries it as a field (FR-012). So every one of them is read back and searched
// for it: the items they take, the 204 that records an answer, the result they are shown, and their
// own trace. The concept map is the whole of the result — held, not held, unknown — with no total,
// no percentage and no rank anywhere (CLAUDE.md).
//
// The map is not nothing, and the file does not claim it is. It is a reading of correctness by
// concept, returned when the check closes, and on a concept carried by a single item it is that
// item's own marking — which this fixture does for seven of its eleven concepts. That is an
// authoring property, held by the package warning `READINESS_CONCEPT_SINGLE_ITEM` rather than by
// anything the run engine can do about it (D-251).
//
// The service is driven directly for the rules and through the route handlers for the two things
// only the wire can show: the 204, and the test-only clock control's refusal outside `APP_ENV=test`.
// @db:truncate
import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Runs = typeof import('@/server/modules/runs')
type RunsRepo = typeof import('@/server/modules/runs/repository')
type Trace = typeof import('@/server/modules/trace')
type Scenarios = typeof import('@/server/modules/scenarios')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type ReadinessRoute = typeof import('@/app/api/v1/runs/[runId]/readiness/route')
type AnswerRoute = typeof import('@/app/api/v1/runs/[runId]/readiness/answers/[itemId]/route')
type SubmitRoute = typeof import('@/app/api/v1/runs/[runId]/readiness/submit/route')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let runs: Runs
let runsRepo: RunsRepo
let trace: Trace
let scenarios: Scenarios
let f: Factories
let readinessRoute: ReadinessRoute
let answerRoute: AnswerRoute
let submitRoute: SubmitRoute
let advanceClockRoute: AdvanceClockRoute

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

/** The Meridian Roast document the seed imports (06 §5 item 4): sixteen confirmed items. */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../src/server/db/fixtures/meridian-roast.package.json', import.meta.url),
    'utf8',
  ),
) as {
  readinessItems: {
    key: string
    category: 'foundation' | 'defect_concept' | 'ai_behavior'
    conceptKey: string
    answerKey: string
    position: number
    options: { key: string; text: string }[]
  }[]
}

type Fixture = Awaited<ReturnType<typeof setup>>

/**
 * One institution with a course, a section holding an instructor and two students, the fixture
 * package imported and confirmed in the instructor's name, and an assignment on its defective
 * variant. The second student is the classmate every cross-reader refusal is proven against.
 */
async function setup() {
  const { organization } = await f.createInstitution('readiness')
  const orgId = organization.id

  const instructorUser = await f.createUser('readiness-instructor')
  const studentUser = await f.createUser('readiness-student')
  const classmateUser = await f.createUser('readiness-classmate')
  await f.addMember(orgId, instructorUser.id, 'instructor')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, classmateUser.id, 'student')

  const course = await f.createCourse(orgId, 'readiness-course', { createdBy: instructorUser.id })
  const section = await f.createSection(orgId, course.id, 'readiness-section')
  await f.addSectionMember(orgId, section.id, instructorUser.id, 'instructor')
  await f.addSectionMember(orgId, section.id, studentUser.id, 'student')
  await f.addSectionMember(orgId, section.id, classmateUser.id, 'student')

  const instructor = actorFor(instructorUser, orgId)
  // Imported through the service, as `pnpm db:seed` does: the import is what turns the document's
  // element keys into rows, and the confirmation is what an assignment requires (10 §4).
  const imported = await scenarios.importPackage(instructor, orgId, {
    ...(FIXTURE as unknown as Record<string, unknown>),
    confirmOnImport: true,
  })
  await scenarios.confirmVersion(instructor, imported.versionId, { teachingNoteChecked: true })

  const variants = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_variants where package_version_id = ${imported.versionId}`
  const defective = variants.find((variant) => variant.key === 'defective')
  if (!defective) throw new Error('the fixture package has no defective variant')

  const assignment = await f.createAssignment(orgId, section.id, 'readiness-assignment', {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1 (readiness)',
  })

  return {
    orgId,
    versionId: imported.versionId,
    assignment,
    instructor,
    instructorUser,
    student: actorFor(studentUser, orgId),
    studentUser,
    classmate: actorFor(classmateUser, orgId),
  }
}

let fx: Fixture

/** A run in `readiness`: started, and its policy display acknowledged (FR-201, FR-010). */
async function runInReadiness(): Promise<string> {
  const started = await runs.startRun(fx.student, fx.assignment.id)
  const acknowledged = await runs.acknowledgePolicy(fx.student, started.id)
  expect(acknowledged.state).toBe('readiness')
  return started.id
}

/** The item ids of this run's check, in the order the student takes them. */
async function itemIds(runId: string): Promise<string[]> {
  const view = await runs.getReadiness(fx.student, runId)
  return view.items.map((item) => item.id)
}

/** The check's first item and the key that is right for it, which several cases need together. */
async function firstItem(runId: string): Promise<{ id: string; answerKey: string }> {
  const [id] = await itemIds(runId)
  if (!id) throw new Error('the check has no items')
  return { id, answerKey: await authoredKeyOf(id) }
}

/** The authored key of an item, read straight from the table nothing else in this file touches. */
async function authoredKeyOf(itemId: string): Promise<string> {
  const [row] = await testSql<{ answer_key: string }[]>`
    select answer_key from readiness_items where id = ${itemId}`
  if (!row) throw new Error(`no readiness item ${itemId}`)
  return row.answer_key
}

/** A key the item does not accept, for answering deliberately wrongly. */
const wrongKeyFor = (answerKey: string): string => (answerKey === 'a' ? 'b' : 'a')

/**
 * Every property name anywhere in a value — the helper 12 §8.3 uses on student views.
 *
 * The check has to be on names rather than on the serialized text: an item's stem is prose about
 * payback periods and cohort curves, and one of the fixture's options says "correct". A substring
 * search would find that and prove nothing.
 */
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
  runsRepo = await import('@/server/modules/runs/repository')
  trace = await import('@/server/modules/trace')
  scenarios = await import('@/server/modules/scenarios')
  f = await import('@tests/factories')
  readinessRoute = await import('@/app/api/v1/runs/[runId]/readiness/route')
  answerRoute = await import('@/app/api/v1/runs/[runId]/readiness/answers/[itemId]/route')
  submitRoute = await import('@/app/api/v1/runs/[runId]/readiness/submit/route')
  advanceClockRoute = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setup()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// getReadiness (FR-010, FR-011, FR-012, FR-017)
// ---------------------------------------------------------------------------------------------

describe('getReadiness', () => {
  it('serves sixteen items in the 6 / 4 / 6 split, with eight minutes on the clock', async () => {
    const runId = await runInReadiness()
    const view = await runs.getReadiness(fx.student, runId)

    expect(view.items).toHaveLength(16)
    const byCategory = view.items.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1
      return counts
    }, {})
    expect(byCategory).toEqual({ foundation: 6, defect_concept: 4, ai_behavior: 6 })
    expect(view.items.map((item) => item.position)).toEqual([...Array(16).keys()])
    for (const item of view.items) expect(item.options).toHaveLength(4)

    const row = await runsRepo.findRunWithLabels(fx.orgId, runId)
    const startedAt = row?.run.readinessStartedAt?.getTime() ?? 0
    expect(new Date(view.expiresAt).getTime() - startedAt).toBe(480_000)
  })

  it('carries no answer key and no concept: the item view has six fields and no more', async () => {
    const runId = await runInReadiness()
    const view = await runs.getReadiness(fx.student, runId)

    for (const item of view.items) {
      expect(Object.keys(item).sort()).toEqual([
        'answerKey',
        'category',
        'id',
        'options',
        'position',
        'stem',
      ])
      // Unanswered, so the one `answerKey` in the shape is null rather than the item's own key —
      // which is exactly the field 12 §8.1 puts among the things a student view never carries.
      expect(item.answerKey).toBeNull()
    }
    expectNoKeys(view, ['conceptKey', 'concept_key', 'correct', 'answer_key', 'key_'])
  })

  it('comes back with the student’s own answers so an abandoned check resumes (FR-017)', async () => {
    const runId = await runInReadiness()
    const [first, second] = await itemIds(runId)
    const key = await authoredKeyOf(first!)
    await runs.answerReadinessItem(fx.student, runId, first!, { answerKey: key })
    await runs.answerReadinessItem(fx.student, runId, second!, {
      answerKey: wrongKeyFor(await authoredKeyOf(second!)),
    })

    const view = await runs.getReadiness(fx.student, runId)
    // The wrong answer comes back as the student left it. Nothing corrects it, and nothing says so.
    expect(view.items[0]?.answerKey).toBe(key)
    expect(view.items[1]?.answerKey).toBe(wrongKeyFor(await authoredKeyOf(second!)))
    expect(view.items.slice(2).every((item) => item.answerKey === null)).toBe(true)
  })

  it('refuses a run that has not reached the check, and one that has closed it', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect(await codeOf(runs.getReadiness(fx.student, started.id))).toBe('ILLEGAL_TRANSITION')

    await runs.acknowledgePolicy(fx.student, started.id)
    await runs.submitReadiness(fx.student, started.id)
    expect(await codeOf(runs.getReadiness(fx.student, started.id))).toBe('ILLEGAL_TRANSITION')
  })

  it('answers NOT_FOUND to a classmate on the same section', async () => {
    const runId = await runInReadiness()
    expect(await codeOf(runs.getReadiness(fx.classmate, runId))).toBe('NOT_FOUND')
    expect(await codeOf(runs.getReadiness(fx.instructor, runId))).toBe('NOT_FOUND')
  })

  it('matches its own wire contract on the two routes that answer a body', async () => {
    // `defineRoute` validates the handler's result against `spec.output` and, outside production,
    // refuses a mismatch — so driving these two through the handler is what proves `ReadinessView`
    // and `ReadinessResult` serialize as 07 §7 documents them.
    const runId = await runInReadiness()
    const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })

    const view = await readinessRoute.GET(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/readiness`, { headers }),
      { params: Promise.resolve({ runId }) },
    )
    expect(view.status).toBe(200)
    const viewBody = (await view.json()) as { expiresAt: string; items: unknown[] }
    expect(viewBody.items).toHaveLength(16)
    expect(Number.isNaN(Date.parse(viewBody.expiresAt))).toBe(false)

    const mutating = new Headers(headers)
    mutating.set('x-requested-with', 'tassl')
    mutating.set('content-type', 'application/json')
    const submitted = await submitRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/readiness/submit`, {
        method: 'POST',
        headers: mutating,
      }),
      { params: Promise.resolve({ runId }) },
    )
    expect(submitted.status).toBe(200)
    const resultBody = (await submitted.json()) as { skipped: boolean; concepts: unknown[] }
    expect(resultBody.skipped).toBe(false)
    expect(resultBody.concepts.length).toBeGreaterThan(0)
    expectNoKeys(resultBody, ['correct', 'total', 'score', 'answerKey'])
  })

  it('refuses to draw items from a version that is no longer confirmed (FR-011)', async () => {
    const runId = await runInReadiness()
    await testSql`
      update scenario_package_versions set status = 'retired' where id = ${fx.versionId}`
    expect(await codeOf(runs.getReadiness(fx.student, runId))).toBe('PACKAGE_NOT_CONFIRMED')
  })
})

// ---------------------------------------------------------------------------------------------
// answerReadinessItem (FR-012, FR-017)
// ---------------------------------------------------------------------------------------------

describe('answerReadinessItem', () => {
  it('stores correctness and returns nothing at all — the route answers 204', async () => {
    const runId = await runInReadiness()
    const item = await firstItem(runId)

    const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
    const response = await answerRoute.PUT(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/readiness/answers/${item.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ answerKey: item.answerKey }),
      }),
      { params: Promise.resolve({ runId, itemId: item.id }) },
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')

    const [stored] = await testSql<{ answer_key: string; correct: boolean }[]>`
      select answer_key, correct from run_readiness_answers
      where run_id = ${runId} and item_id = ${item.id}`
    expect(stored).toEqual({ answer_key: item.answerKey, correct: true })
  })

  it('answers a wrong choice exactly as it answers a right one', async () => {
    const runId = await runInReadiness()
    const item = await firstItem(runId)

    await expect(
      runs.answerReadinessItem(fx.student, runId, item.id, {
        answerKey: wrongKeyFor(item.answerKey),
      }),
    ).resolves.toBeUndefined()

    const [stored] = await testSql<{ correct: boolean }[]>`
      select correct from run_readiness_answers where run_id = ${runId} and item_id = ${item.id}`
    expect(stored?.correct).toBe(false)
  })

  it('replaces an earlier answer rather than adding a second (FR-017)', async () => {
    const runId = await runInReadiness()
    const item = await firstItem(runId)

    await runs.answerReadinessItem(fx.student, runId, item.id, {
      answerKey: wrongKeyFor(item.answerKey),
    })
    await runs.answerReadinessItem(fx.student, runId, item.id, { answerKey: item.answerKey })

    const rows = await testSql<{ answer_key: string; correct: boolean }[]>`
      select answer_key, correct from run_readiness_answers
      where run_id = ${runId} and item_id = ${item.id}`
    expect(rows).toEqual([{ answer_key: item.answerKey, correct: true }])
  })

  it('writes no trace event: an answer is a scratchpad row until the check closes', async () => {
    const runId = await runInReadiness()
    const [itemId] = await itemIds(runId)
    const before = await trace.listEvents(fx.student, runId)
    await runs.answerReadinessItem(fx.student, runId, itemId!, {
      answerKey: await authoredKeyOf(itemId!),
    })
    expect(await trace.listEvents(fx.student, runId)).toEqual(before)
  })

  it('refuses an option the item does not offer, and an item not on the check', async () => {
    const runId = await runInReadiness()
    const [itemId] = await itemIds(runId)

    expect(
      await codeOf(runs.answerReadinessItem(fx.student, runId, itemId!, { answerKey: 'z' })),
    ).toBe('VALIDATION_ERROR')
    expect(
      await codeOf(
        runs.answerReadinessItem(fx.student, runId, '00000000-0000-4000-8000-000000000000', {
          answerKey: 'a',
        }),
      ),
    ).toBe('NOT_FOUND')
  })

  it('refuses an answer once the check has closed (CLOCK_EXPIRED, 07 §7)', async () => {
    const runId = await runInReadiness()
    const [itemId] = await itemIds(runId)
    await runs.submitReadiness(fx.student, runId)

    expect(
      await codeOf(
        runs.answerReadinessItem(fx.student, runId, itemId!, {
          answerKey: await authoredKeyOf(itemId!),
        }),
      ),
    ).toBe('CLOCK_EXPIRED')
  })

  it('answers NOT_FOUND to a classmate', async () => {
    const runId = await runInReadiness()
    const [itemId] = await itemIds(runId)
    expect(
      await codeOf(runs.answerReadinessItem(fx.classmate, runId, itemId!, { answerKey: 'a' })),
    ).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// submitReadiness (FR-012, FR-013, FR-014)
// ---------------------------------------------------------------------------------------------

describe('submitReadiness', () => {
  /** Answers every item, taking the concepts named in `wrong` deliberately wrongly. */
  async function answerAll(runId: string, wrong: readonly string[] = []): Promise<void> {
    const view = await runs.getReadiness(fx.student, runId)
    const wrongSet = new Set(wrong)
    for (const item of view.items) {
      const authored = FIXTURE.readinessItems.find(
        (fixtureItem) => fixtureItem.position === item.position,
      )
      if (!authored) throw new Error(`no fixture item at position ${item.position}`)
      const key = wrongSet.has(authored.conceptKey)
        ? wrongKeyFor(authored.answerKey)
        : authored.answerKey
      await runs.answerReadinessItem(fx.student, runId, item.id, { answerKey: key })
    }
  }

  it('closes the check, writes sixteen readiness_item events, and moves to framing', async () => {
    const runId = await runInReadiness()
    await answerAll(runId, ['survey_error'])

    const result = await runs.submitReadiness(fx.student, runId)

    // FR-013: the result never blocks entry, and every build run opens Standard Mode.
    const run = await runs.getRun(fx.student, runId)
    expect(run.state).toBe('framing')
    expect(run.mode).toBe('standard')

    const events = await trace.listEvents(fx.student, runId)
    const items = events.filter((event) => event.type === 'readiness_item')
    expect(items).toHaveLength(16)
    // policy_displayed, lifecycle, sixteen items, lifecycle — in that order, no skip.
    expect(events.map((event) => event.type)).toEqual([
      'policy_displayed',
      'lifecycle',
      ...Array<string>(16).fill('readiness_item'),
      'lifecycle',
    ])
    expect(events.at(-1)?.payload).toEqual({
      from: 'readiness',
      to: 'framing',
      cause: 'readiness_submitted',
    })
    expect(events.every((event) => event.type !== 'readiness_skipped')).toBe(true)

    // The result row holds the concept map (DATA-030), and the concept the student answered wrongly
    // is the one that is not held.
    const [row] = await testSql<
      {
        submitted_at: Date | null
        skipped: boolean
        concepts: { concept_key: string; status: string; correct: number; total: number }[]
      }[]
    >`select submitted_at, skipped, concepts from run_readiness_results where run_id = ${runId}`
    expect(row?.submitted_at).not.toBeNull()
    expect(row?.skipped).toBe(false)
    const stored = row?.concepts ?? []
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.find((concept) => concept.concept_key === 'survey_error')?.status).toBe(
      'not_held',
    )
    expect(
      stored
        .filter((concept) => concept.concept_key !== 'survey_error')
        .every((c) => c.status === 'held'),
    ).toBe(true)

    // What the student is handed carries the concepts and nothing that could be read as a score.
    expect(result.skipped).toBe(false)
    expect(result.concepts.map((concept) => concept.conceptKey).sort()).toEqual(
      [...new Set(FIXTURE.readinessItems.map((fixtureItem) => fixtureItem.conceptKey))].sort(),
    )
    for (const concept of result.concepts) {
      expect(Object.keys(concept).sort()).toEqual(['conceptKey', 'status'])
    }
    expectNoKeys(result, ['score', 'total', 'correct', 'percent', 'rank', 'threshold', 'mode'])
  })

  it('an unanswered concept is unknown, and a partly answered one is judged on what it has', async () => {
    const runId = await runInReadiness()
    const view = await runs.getReadiness(fx.student, runId)
    // `payback_period` carries three items (R01, R04, R09); answer one of them, wrongly.
    const paybackPositions = FIXTURE.readinessItems
      .filter((item) => item.conceptKey === 'payback_period')
      .map((item) => item.position)
    const first = view.items.find((item) => item.position === paybackPositions[0])
    const authored = FIXTURE.readinessItems.find((item) => item.position === first?.position)
    await runs.answerReadinessItem(fx.student, runId, first!.id, {
      answerKey: wrongKeyFor(authored!.answerKey),
    })

    const result = await runs.submitReadiness(fx.student, runId)
    const status = (conceptKey: string): string | undefined =>
      result.concepts.find((concept) => concept.conceptKey === conceptKey)?.status

    // One wrong answer settles the concept even though two of its items were never reached.
    expect(status('payback_period')).toBe('not_held')
    expect(status('cohort_retention')).toBe('unknown')
    expect(status('ai_sycophancy')).toBe('unknown')
  })

  it('withholds per-item correctness from the student’s own trace (D-223)', async () => {
    const runId = await runInReadiness()
    await answerAll(runId)
    await runs.submitReadiness(fx.student, runId)

    const owner = await trace.listEvents(fx.student, runId)
    for (const event of owner.filter((row) => row.type === 'readiness_item')) {
      expect(Object.keys(event.payload).sort()).toEqual([
        'answer_key',
        'category',
        'concept_key',
        'item_id',
        'item_key',
      ])
      expect(event.payload).not.toHaveProperty('correct')
    }

    // The reviewer's view is the record, and it keeps it.
    const reviewer = await trace.listEvents(fx.instructor, runId)
    const reviewerItems = reviewer.filter((row) => row.type === 'readiness_item')
    expect(reviewerItems).toHaveLength(16)
    expect(reviewerItems.every((row) => 'correct' in row.payload)).toBe(true)
  })

  it('refuses a second submit and leaves the first result untouched', async () => {
    const runId = await runInReadiness()
    await runs.submitReadiness(fx.student, runId)
    const before = await trace.listEvents(fx.student, runId)

    expect(await codeOf(runs.submitReadiness(fx.student, runId))).toBe('ILLEGAL_TRANSITION')
    expect(await trace.listEvents(fx.student, runId)).toEqual(before)
    // A refusal the student caused is not a failed submission, so the skip stays closed (FR-018).
    const [row] = await testSql<{ flags: Record<string, unknown> }[]>`
      select flags from runs where id = ${runId}`
    expect(row?.flags.readiness_submit_failed).toBeUndefined()
  })

  it('submits with nothing answered: every concept unknown, still sixteen events', async () => {
    const runId = await runInReadiness()
    const result = await runs.submitReadiness(fx.student, runId)

    expect(result.concepts.every((concept) => concept.status === 'unknown')).toBe(true)
    const events = await trace.listEvents(fx.student, runId)
    const items = events.filter((event) => event.type === 'readiness_item')
    expect(items).toHaveLength(16)
    expect(items.every((event) => event.payload.answer_key === null)).toBe(true)
  })

  it('getReadinessResult reads the closed check back for the result page', async () => {
    const runId = await runInReadiness()
    expect(await runs.getReadinessResult(fx.student, runId)).toBeNull()
    const submitted = await runs.submitReadiness(fx.student, runId)
    expect(await runs.getReadinessResult(fx.student, runId)).toEqual(submitted)
  })
})

// ---------------------------------------------------------------------------------------------
// Expiry (10 §8 branch 1, NFR-002) through the test-only clock control (D-109)
// ---------------------------------------------------------------------------------------------

describe('expiry auto-submits', () => {
  type Called = { status: number; body: Record<string, unknown> | null }

  /** `POST /api/v1/test/runs/{runId}/advance-clock` as a client sends it. */
  async function advanceClock(runId: string, ms: number, actorId = fx.student.id): Promise<Called> {
    const headers = await asUser(actorId, { activeOrganizationId: fx.orgId })
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
    const response = await advanceClockRoute.POST(
      new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ms }),
      }),
      { params: Promise.resolve({ runId }) },
    )
    const text = await response.text()
    return {
      status: response.status,
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown>),
    }
  }

  it('closes the check at the instant it expired, with the unanswered items unknown', async () => {
    const runId = await runInReadiness()
    const view = await runs.getReadiness(fx.student, runId)
    const paybackItem = view.items.find(
      (item) =>
        FIXTURE.readinessItems.find((fixture) => fixture.position === item.position)?.conceptKey ===
        'payback_period',
    )
    const authored = FIXTURE.readinessItems.find((item) => item.position === paybackItem?.position)
    await runs.answerReadinessItem(fx.student, runId, paybackItem!.id, {
      answerKey: authored!.answerKey,
    })

    const expiresAt = new Date(view.expiresAt)
    const { status, body } = await advanceClock(runId, 9 * 60_000)
    expect(status).toBe(200)
    expect(body?.state).toBe('framing')

    const [row] = await testSql<
      {
        submitted_at: Date | null
        skipped: boolean
        concepts: { concept_key: string; status: string }[]
      }[]
    >`select submitted_at, skipped, concepts from run_readiness_results where run_id = ${runId}`
    expect(row?.skipped).toBe(true)
    expect(row?.submitted_at).not.toBeNull()
    const status_ = (key: string) => row?.concepts.find((c) => c.concept_key === key)?.status
    // The one answered item still counts; its two siblings on the concept do not, so the concept
    // stays unknown rather than held (FR-018).
    expect(status_('payback_period')).toBe('unknown')
    expect(status_('cohort_retention')).toBe('unknown')

    const events = await trace.listEvents(fx.student, runId)
    expect(events.filter((event) => event.type === 'readiness_item')).toHaveLength(16)
    const skipped = events.find((event) => event.type === 'readiness_skipped')
    expect(skipped?.payload).toEqual({ reason: 'expired', unanswered_count: 15 })
    expect(events.at(-1)?.payload).toMatchObject({ cause: 'readiness_skipped' })

    // NFR-002: the events carry the instant the check expired, not the instant somebody looked, and
    // the expiry was nobody's act (10 §10).
    const shifted = expiresAt.getTime() - 9 * 60_000
    for (const event of events.slice(2)) {
      expect(new Date(event.occurredAt).getTime()).toBe(shifted)
      expect(event.actorId).toBeNull()
    }
  })

  it('a check that was fully answered when the clock ran out is a submit, not a skip', async () => {
    const runId = await runInReadiness()
    const view = await runs.getReadiness(fx.student, runId)
    for (const item of view.items) {
      const authored = FIXTURE.readinessItems.find((row) => row.position === item.position)
      await runs.answerReadinessItem(fx.student, runId, item.id, {
        answerKey: authored!.answerKey,
      })
    }

    await advanceClock(runId, 9 * 60_000)

    const events = await trace.listEvents(fx.student, runId)
    expect(events.some((event) => event.type === 'readiness_skipped')).toBe(false)
    expect(events.at(-1)?.payload).toMatchObject({ cause: 'readiness_submitted' })
    const [row] = await testSql<{ skipped: boolean }[]>`
      select skipped from run_readiness_results where run_id = ${runId}`
    expect(row?.skipped).toBe(false)
  })

  it('an ordinary read materializes the expiry too, without the test route', async () => {
    const runId = await runInReadiness()
    await testSql`
      update runs set readiness_expires_at = now() - interval '1 minute' where id = ${runId}`
    const run = await runs.getRun(fx.student, runId)
    expect(run.state).toBe('framing')
    expect(await codeOf(runs.getReadiness(fx.student, runId))).toBe('ILLEGAL_TRANSITION')
  })

  it('is 404 outside APP_ENV=test, before it asks who is calling (D-109)', async () => {
    const runId = await runInReadiness()
    vi.stubEnv('APP_ENV', 'production')
    try {
      const refused = await advanceClock(runId, 9 * 60_000)
      expect(refused.status).toBe(404)
      expect((refused.body?.error as { code?: string } | undefined)?.code).toBe('NOT_FOUND')

      // Unauthenticated, the answer is the same 404 rather than the 401 an existing route gives.
      const anonymous = await advanceClockRoute.POST(
        new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'tassl' },
          body: JSON.stringify({ ms: 1000 }),
        }),
        { params: Promise.resolve({ runId }) },
      )
      expect(anonymous.status).toBe(404)

      // And the service refuses on its own, so the guard does not live only in the route.
      expect(await codeOf(runs.getRun(fx.student, runId))).toBe('no error')
      const service = await import('@/server/modules/runs/service')
      expect(await codeOf(service.advanceRunClock(fx.student, runId, { ms: 1000 }))).toBe(
        'NOT_FOUND',
      )
    } finally {
      vi.unstubAllEnvs()
    }

    // The clock never moved, so the check is still open.
    expect((await runs.getRun(fx.student, runId)).state).toBe('readiness')
  })

  it('answers NOT_FOUND to a classmate even inside a test process', async () => {
    const runId = await runInReadiness()
    const refused = await advanceClock(runId, 1000, fx.classmate.id)
    expect(refused.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------------------------
// skipReadiness (FR-018)
// ---------------------------------------------------------------------------------------------

describe('skipReadiness', () => {
  /** What a failed submit leaves behind (`runs.flags.readiness_submit_failed`, 06 §3.4). */
  async function armSkip(runId: string): Promise<void> {
    await testSql`
      update runs set flags = flags || '{"readiness_submit_failed": true}'::jsonb
      where id = ${runId}`
  }

  it('is refused before a submission has failed', async () => {
    const runId = await runInReadiness()
    expect(await codeOf(runs.skipReadiness(fx.student, runId))).toBe('READINESS_SKIP_NOT_ALLOWED')

    // Nothing was written by the refusal: the check is still open and still takeable.
    const run = await runs.getRun(fx.student, runId)
    expect(run.state).toBe('readiness')
    expect((await runs.getReadiness(fx.student, runId)).items).toHaveLength(16)
  })

  it('is allowed after one, and marks every concept unknown', async () => {
    const runId = await runInReadiness()
    const [itemId] = await itemIds(runId)
    await runs.answerReadinessItem(fx.student, runId, itemId!, {
      answerKey: await authoredKeyOf(itemId!),
    })
    await armSkip(runId)

    const result = await runs.skipReadiness(fx.student, runId)

    expect(result.skipped).toBe(true)
    expect(result.concepts).toHaveLength(
      new Set(FIXTURE.readinessItems.map((item) => item.conceptKey)).size,
    )
    // PRD §7.1: a check that could not be completed marks competence unknown — including the
    // concept whose one answer happened to be right, because the check did not finish.
    expect(result.concepts.every((concept) => concept.status === 'unknown')).toBe(true)

    const run = await runs.getRun(fx.student, runId)
    expect(run.state).toBe('framing')
    expect(run.mode).toBe('standard')

    const events = await trace.listEvents(fx.student, runId)
    // A skip records no answers (10 §6): the skip event and the transition, and nothing per item.
    expect(events.map((event) => event.type)).toEqual([
      'policy_displayed',
      'lifecycle',
      'readiness_skipped',
      'lifecycle',
    ])
    expect(events[2]?.payload).toEqual({ reason: 'student_skip', unanswered_count: 15 })
    expect(events[2]?.actorId).toBe(fx.student.id)
    expect(events.at(-1)?.payload).toMatchObject({ cause: 'readiness_skipped' })

    const [row] = await testSql<{ submitted_at: Date | null; skipped: boolean }[]>`
      select submitted_at, skipped from run_readiness_results where run_id = ${runId}`
    expect(row?.submitted_at).toBeNull()
    expect(row?.skipped).toBe(true)
  })

  it('is refused once the check has closed, however it closed', async () => {
    const runId = await runInReadiness()
    await armSkip(runId)
    await runs.submitReadiness(fx.student, runId)
    expect(await codeOf(runs.skipReadiness(fx.student, runId))).toBe('ILLEGAL_TRANSITION')
  })

  it('answers NOT_FOUND to a classmate', async () => {
    const runId = await runInReadiness()
    await armSkip(runId)
    expect(await codeOf(runs.skipReadiness(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})
