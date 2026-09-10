// Step 11 audit — `records.getRecord` and `requireCourseExportReader`, which had no test at all
// (10 §14, 08 §4 and §5; FR-170, FR-172, FR-204; D-421, D-436, D-438, D-439, D-483, D-519, D-521).
//
//   * **`getRecord`** had no unit test and no integration test at all. The only rows that touched
//     it were `tests/integration/auth/matrix.json`'s eight, and the matrix fixture's run is not
//     confirmed — so the one *allowed* seat never got past `RECORD_NOT_AVAILABLE`, and the body of
//     the endpoint, including D-421's name-containment sweep and D-439's single named exemption,
//     was never run once.
//   * **`requireCourseExportReader`** was reported as asserted by nothing — that replacing its two
//     refusals with `return run` left the whole suite green. It does not: `tests/integration/trace/
//     export.test.ts`'s D-483 case asserts FORBIDDEN for a student of the section and NOT_FOUND for
//     a seat outside it, and the mutation fails it. What that case cannot see is what a mutation
//     would actually *hand over*, because its run has filed nothing and every admitted seat meets
//     `EXPORT_NOT_FOUND`. The cases below run against a **confirmed** run with a real filed version,
//     so the difference between a refusal and the run's grade is on the wire.
//
// So the plants below are the point of the file. A guard is only proven by what it refuses, and a
// containment rule is only proven by something it must let through beside something it must not.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { stopBoss } from '@/server/jobs/boss'
import {
  claimByKey,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from '../review/fixture'

type Records = typeof import('@/server/modules/records')
type Review = typeof import('@/server/modules/review')
type Factories = typeof import('@tests/factories')

let records: Records
let review: Review
let f: Factories
let fx: AssistantFixture

beforeEach(async () => {
  await truncateAll()
  records = await import('@/server/modules/records')
  review = await import('@/server/modules/review')
  f = (await import('@tests/factories')) as Factories
  fx = await setupAssistantFixture('records-record')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

/** The error code an awaited call answered with, or `null` when it resolved. */
async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    if (isAppError(error)) return error.code
    throw error
  }
}

/** A run confirmed by the section's instructor: seven decisions, `confirmed`, course export v1. */
async function confirmedRun(): Promise<string> {
  const runId = await scoredRun(fx)
  await review.confirmRemaining(fx.instructor, runId)
  return runId
}

/** The course and the section the fixture's assignment belongs to. */
async function courseAndSection(): Promise<{ courseId: string; sectionId: string }> {
  const [row] = await testSql<{ course_id: string; section_id: string }[]>`
    select s.course_id, s.id as section_id
      from assignments a join sections s on s.id = a.section_id
     where a.id = ${fx.assignment.id}`
  if (!row) throw new Error('the fixture assignment has no section')
  return { courseId: row.course_id, sectionId: row.section_id }
}

/**
 * Overwrites `run_scores.graphs` with a plant, so the record's own sweep is what runs.
 *
 * The plants are the whole point: `findForbiddenKeys` walks a payload by name at any depth, and a
 * containment rule with a named exemption is only proven by something it must let through beside
 * something it must not.
 */
type PlantableGraphs = Record<
  string,
  Record<string, unknown> & { points?: Record<string, unknown>[] }
>

async function plantInGraphs(runId: string, mutate: (graphs: PlantableGraphs) => void) {
  const [row] = await testSql<{ graphs: Record<string, unknown> }[]>`
    select graphs from run_scores where run_id = ${runId}`
  if (!row) throw new Error('the run has no score row')
  const graphs = row.graphs as PlantableGraphs
  mutate(graphs)
  await testSql`update run_scores set graphs = ${testSql.json(
    graphs as unknown as Record<string, never>,
  )} where run_id = ${runId}`
}

describe('records.getRecord', () => {
  it('answers the run’s own student, from confirmed, with the bands and the four graphs', async () => {
    const runId = await confirmedRun()
    const view = await records.getRecord(fx.student, runId)

    expect(view.runId).toBe(runId)
    expect(view.state).toBe('confirmed')
    expect(view.uncalibrated).toBe(true)
    expect(view.hiddenFromExport).toBe(false)
    expect(view.confirmedAt).not.toBeNull()
    expect(view.bands).toHaveLength(7)
    expect(Object.keys(view.graphs).sort()).toEqual([
      'clock_timeline',
      'confidence_line',
      'frame_beside_decision',
      'stance_matrix',
    ])
    expect(view.trace).not.toBeNull()

    // The bands carry what FR-170 means by "with evidence" — the graphs they were read from — and
    // neither of the two reviewer-only fields (D-438).
    for (const band of view.bands) {
      expect(band.graphKeys.length).toBeGreaterThan(0)
      expect(band).not.toHaveProperty('quotes')
      expect(band).not.toHaveProperty('evidenceEventSeqs')
    }
  })

  it('is refused before the bands are confirmed, and says which state', async () => {
    const runId = await scoredRun(fx)
    expect(await codeOf(records.getRecord(fx.student, runId))).toBe('RECORD_NOT_AVAILABLE')
  })

  it('is the owner’s and nobody else’s — every other seat is NOT_FOUND (08 §4, D-519)', async () => {
    const runId = await confirmedRun()
    // A reviewer reads the run through the replay and the course export; a classmate has no read of
    // it at all. Both answer NOT_FOUND, so a run id cannot be probed for existence.
    expect(await codeOf(records.getRecord(fx.instructor, runId))).toBe('NOT_FOUND')
    expect(await codeOf(records.getRecord(fx.ta, runId))).toBe('NOT_FOUND')
    expect(await codeOf(records.getRecord(fx.classmate, runId))).toBe('NOT_FOUND')
  })

  it('stores the snapshot and rebuilds it, so a correction reaches the record (D-436)', async () => {
    const runId = await confirmedRun()
    const before = await records.getRecord(fx.student, runId)
    const [stored] = await testSql<{ count: string }[]>`
      select count(*)::text as count from run_records where run_id = ${runId}`
    expect(stored?.count).toBe('1')

    await review.neutralizeClaim(fx.instructor, runId, fx.claimId(claimByKey('C3').key), {
      reason: 'unintended_defect',
      creditChallenge: false,
      note: 'Document D4 contradicts D2 unintentionally, so this claim was never fair to judge.',
    })

    const after = await records.getRecord(fx.student, runId)
    expect(after.adjustedAt).not.toBeNull()
    // The bands the record shows are the effective ones, so the correction's floor is in them
    // rather than in a snapshot taken before it (FR-005, FR-232).
    const bandOf = (view: typeof before, dimension: string) =>
      view.bands.find((band) => band.dimension === dimension)?.band ?? null
    for (const dimension of ['verification', 'calibration']) {
      const now = bandOf(after, dimension)
      const then = bandOf(before, dimension)
      if (then !== null) expect(now).not.toBeNull()
    }
    const [again] = await testSql<{ count: string }[]>`
      select count(*)::text as count from run_records where run_id = ${runId}`
    expect(again?.count, 'the snapshot is upserted, never appended').toBe('1')
  })
})

describe('the record’s name-containment sweep, and its one exemption (D-421, D-439)', () => {
  it('lets the confidence line keep its own `points`, which FR-170 puts in the record by name', async () => {
    const runId = await confirmedRun()
    const view = await records.getRecord(fx.student, runId)
    const line = view.graphs.confidence_line as { points?: unknown[] }
    // The three plotted readings: the student's own confidence at the frame, at the lock and after
    // the Turn. This is the survivor the exemption names — and the reason the rule needs one.
    expect(Array.isArray(line.points)).toBe(true)
  })

  it('refuses a `points_confirmed` nested inside a confidence-line reading', async () => {
    const runId = await confirmedRun()
    await plantInGraphs(runId, (graphs) => {
      const first = (graphs.confidence_line?.points ?? [])[0]
      if (!first) throw new Error('the confidence line has no readings to plant in')
      first.points_confirmed = 2.857
    })
    // The exemption is the path `graphs.confidence_line.points` and nothing under it: the array's
    // contents are still walked.
    expect(await codeOf(records.getRecord(fx.student, runId))).toBe('INTERNAL_ERROR')
  })

  it('refuses a `points`-containing name at a path the exemption does not cover', async () => {
    const runId = await confirmedRun()
    await plantInGraphs(runId, (graphs) => {
      graphs.clock_timeline!.points = [{ at: 0 }]
    })
    expect(await codeOf(records.getRecord(fx.student, runId))).toBe('INTERNAL_ERROR')
  })

  it.each([['weight'], ['mapping']])(
    'refuses a nested `%s` anywhere in the record',
    async (key) => {
      const runId = await confirmedRun()
      await plantInGraphs(runId, (graphs) => {
        const matrix = graphs.stance_matrix!
        matrix.summary = { ...((matrix.summary as Record<string, unknown>) ?? {}), [key]: 1 }
      })
      expect(await codeOf(records.getRecord(fx.student, runId))).toBe('INTERNAL_ERROR')
    },
  )
})

describe('requireCourseExportReader (08 §4, D-483)', () => {
  it('hands a filed version to a reviewer of the run’s section', async () => {
    const runId = await confirmedRun()
    for (const actor of [fx.instructor, fx.ta]) {
      const file = await records.getCourseExport(actor, runId, 'latest')
      expect((file as { computed?: { points?: number | null } }).computed?.points).not.toBe(
        undefined,
      )
    }
  })

  it('hands one to the course’s own instructor, who holds no row in the run’s section', async () => {
    // D-483's seat: 08 §5 reads "the section's instructor" as the course's creator or an instructor
    // in *one of* its sections, because between creating a section and putting anyone in it the
    // creator is the only instructor who exists.
    const runId = await confirmedRun()
    const { courseId } = await courseAndSection()
    const other = await f.createUser('records-record-other-instructor')
    await f.addMember(fx.orgId, other.id, 'instructor')
    const otherSection = await f.createSection(fx.orgId, courseId, 'records-record-section-b')
    await f.addSectionMember(fx.orgId, otherSection.id, other.id, 'instructor')

    const file = await records.getCourseExport({ ...fx.instructor, id: other.id }, runId, 'latest')
    expect(file).toBeTruthy()
  })

  it('refuses the run’s own student with FORBIDDEN and a classmate with NOT_FOUND, never with the file', async () => {
    // The branch a mutation test kills silently: replacing it with `return run` leaves every suite
    // green and hands the run's grade — and its whole trace in the reviewer's form — to a classmate.
    // The classmate is not told the run exists (D-703); the student whose run it is already knows.
    const runId = await confirmedRun()
    expect(await codeOf(records.getCourseExport(fx.classmate, runId, 'latest'))).toBe('NOT_FOUND')
    expect(await codeOf(records.getCourseExport(fx.student, runId, 'latest'))).toBe('FORBIDDEN')
  })

  it('refuses a seat with no section row and no course with NOT_FOUND', async () => {
    // The second branch, and the reason it is NOT_FOUND rather than FORBIDDEN: a refusal that says
    // "you may not" says the run exists (08 §4 "Cross-tenant").
    const runId = await confirmedRun()
    const stranger = await f.createUser('records-record-stranger')
    await f.addMember(fx.orgId, stranger.id, 'instructor')
    expect(
      await codeOf(records.getCourseExport({ ...fx.instructor, id: stranger.id }, runId, 'latest')),
    ).toBe('NOT_FOUND')
  })
})

describe('requireCourseInstructor no longer outlives the seat that created the course (D-516)', () => {
  it('refuses a creator who has been demoted out of the instructor role', async () => {
    const runId = await confirmedRun()
    const { courseId } = await courseAndSection()
    const creator = await f.createUser('records-record-demoted')
    await f.addMember(fx.orgId, creator.id, 'instructor')
    await testSql`update courses set created_by = ${creator.id} where id = ${courseId}`

    const actor = { ...fx.instructor, id: creator.id }
    // While they hold the role, `created_by` is the whole of their claim and it is enough.
    expect(await codeOf(records.getCourseExport(actor, runId, 'latest'))).toBeNull()

    // `courses.created_by` is a record of who made the row, not a grant that outlives the seat.
    await f.addMember(fx.orgId, creator.id, 'student')
    expect(await codeOf(records.getCourseExport(actor, runId, 'latest'))).toBe('NOT_FOUND')
  })
})
