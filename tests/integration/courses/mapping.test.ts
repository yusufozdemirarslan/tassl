// Step 11.2 — the mapping change against Postgres (docs/tech/10-backend-spec-modules.md §3;
// 07-api-spec.md §5; FR-206, D-095, DATA-055).
//
// PRD §7.19's edge: a course may change what a band is worth after runs have been confirmed, and
// when it does the instructor is shown which exported points will change, the change is recorded as
// instructor-set with its date, and every confirmed run in the course is recomputed and re-exported.
// Five claims, and every one of them needs a real confirmed run behind it.
//
//   * **The preview shows both numbers.** A row per confirmed run with the points the gradebook
//     holds now and the points it would hold after, so the sentence FR-206 asks for — which exported
//     points will change — can actually be read.
//   * **Applying requires the confirmation.** `confirm: false` is `MAPPING_CHANGE_UNCONFIRMED`, not a
//     shape error: the box the instructor ticks says what applying does.
//   * **Applying reprices and re-exports.** `run_scores.points_confirmed` moves to the preview's
//     "after" figure, and a new `course_exports` version is filed with reason `mapping_change`
//     carrying that number — the append-only ledger keeps the version the course entered before.
//   * **A mapping that is already the course's changes nothing**: no `course_mapping_changes` row,
//     no export, no version 2 of a file with the same numbers in it.
//   * **The seat is the course's instructor** (07 §5): a TA and the student are refused.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { stopBoss } from '@/server/jobs/boss'
import { drainQueues } from '@/server/jobs/drain'
import { registerAllHandlers } from '@/server/jobs/handlers/register'
import {
  exportRows,
  scoreRow,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from '../review/fixture'

type Courses = typeof import('@/server/modules/courses')
type Review = typeof import('@/server/modules/review')

let courses: Courses
let review: Review
let fx: AssistantFixture
let courseId: string

/** Twice the default, so every band moves and no run's number can stay by accident. */
const DOUBLED = { novice: 2, developing: 4, proficient: 6, professional: 8 }
const DEFAULT_MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

beforeEach(async () => {
  await truncateAll()
  courses = await import('@/server/modules/courses')
  review = await import('@/server/modules/review')
  fx = await setupAssistantFixture('courses-mapping')
  const [row] = await testSql<{ id: string }[]>`
    select c.id from courses c
      join sections s on s.course_id = c.id
      join assignments a on a.section_id = s.id
     where a.id = ${fx.assignment.id}`
  if (!row) throw new Error('the fixture assignment has no course')
  courseId = row.id
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

/** A run at `confirmed` with course export v1 behind it (Step 11.1's confirmation path). */
async function confirmedRun(): Promise<string> {
  const runId = await scoredRun(fx)
  await review.confirmRemaining(fx.instructor, runId)
  return runId
}

/** The `recompute_exports` job, run to completion whether or not the enqueue drain got there. */
async function drain(): Promise<void> {
  await registerAllHandlers()
  await drainQueues({ maxMs: 20_000 })
}

async function mappingChangeRows(courseIdValue: string) {
  return testSql<
    {
      old_mapping: Record<string, number>
      new_mapping: Record<string, number>
      changed_by: string
      affected_run_ids: string[]
      created_at: Date
    }[]
  >`select old_mapping, new_mapping, changed_by, affected_run_ids, created_at
      from course_mapping_changes where course_id = ${courseIdValue} order by created_at`
}

async function auditRows(courseIdValue: string) {
  return testSql<{ action: string; actor_id: string | null; metadata: Record<string, unknown> }[]>`
    select action, actor_id, metadata from audit_logs
     where target_type = 'course' and target_id = ${courseIdValue} order by created_at, id`
}

// ---------------------------------------------------------------------------------------------
// The preview (FR-206)
// ---------------------------------------------------------------------------------------------

describe('previewMappingChange', () => {
  it('lists every confirmed run with the points it holds now and the points it would hold', async () => {
    const runId = await confirmedRun()
    const preview = await courses.previewMappingChange(fx.instructor, courseId, {
      mapping: DOUBLED,
    })

    expect(preview.current).toEqual(DEFAULT_MAPPING)
    expect(preview.proposed).toEqual(DOUBLED)
    expect(preview.affected).toHaveLength(1)
    const row = preview.affected[0]
    expect(row?.runId).toBe(runId)
    expect(row?.assignmentId).toBe(fx.assignment.id)
    expect(row?.studentId).toBe(fx.student.id)
    expect(row?.pointsNow).not.toBeNull()
    expect(row?.pointsAfter).not.toBeNull()
    // Every band is worth twice as much, so the run is worth twice as much — to two decimals,
    // because each figure is rounded to three at the builder and 34/7 is not twice round3(17/7)
    // (D-091, D-381).
    expect(row?.pointsAfter).toBeCloseTo((row?.pointsNow ?? 0) * 2, 2)
    expect(row?.changed).toBe(true)
    expect(preview.changedCount).toBe(1)
  })

  it('agrees with what the run already carries, so the diff is the mapping and nothing else', async () => {
    const runId = await confirmedRun()
    const preview = await courses.previewMappingChange(fx.instructor, courseId, {
      mapping: DOUBLED,
    })
    const stored = await scoreRow(runId)
    expect(preview.affected[0]?.pointsNow).toBe(Number(stored?.points_confirmed))
  })

  it('writes nothing: no mapping change, no export, no move of the course', async () => {
    const runId = await confirmedRun()
    await courses.previewMappingChange(fx.instructor, courseId, { mapping: DOUBLED })

    expect(await mappingChangeRows(courseId)).toHaveLength(0)
    expect(await exportRows(runId)).toHaveLength(1)
    const course = await courses.getCourse(fx.instructor, courseId)
    expect(course.mapping).toEqual(DEFAULT_MAPPING)
  })

  it('refuses a mapping that is not four positive numbers', async () => {
    expect(
      await codeOf(
        courses.previewMappingChange(fx.instructor, courseId, {
          mapping: { novice: 0, developing: 2, proficient: 3, professional: 4 },
        }),
      ),
    ).toBe('MAPPING_INVALID')
  })

  it('is the course instructor’s alone (07 §5)', async () => {
    expect(await codeOf(courses.previewMappingChange(fx.ta, courseId, { mapping: DOUBLED }))).toBe(
      'FORBIDDEN',
    )
    expect(
      await codeOf(courses.previewMappingChange(fx.student, courseId, { mapping: DOUBLED })),
    ).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------------------------
// The apply (FR-206, D-095, DATA-055)
// ---------------------------------------------------------------------------------------------

describe('changeMapping', () => {
  it('refuses without the confirmation, and changes nothing', async () => {
    const runId = await confirmedRun()
    expect(
      await codeOf(
        courses.changeMapping(fx.instructor, courseId, { mapping: DOUBLED, confirm: false }),
      ),
    ).toBe('MAPPING_CHANGE_UNCONFIRMED')

    expect(await mappingChangeRows(courseId)).toHaveLength(0)
    expect(await exportRows(runId)).toHaveLength(1)
    expect((await courses.getCourse(fx.instructor, courseId)).mapping).toEqual(DEFAULT_MAPPING)
  })

  it('records the change as instructor-set with its date and the runs it touched (DATA-055)', async () => {
    const runId = await confirmedRun()
    const course = await courses.changeMapping(fx.instructor, courseId, {
      mapping: DOUBLED,
      confirm: true,
    })
    expect(course.mapping).toEqual(DOUBLED)

    const [change] = await mappingChangeRows(courseId)
    expect(change?.old_mapping).toEqual(DEFAULT_MAPPING)
    expect(change?.new_mapping).toEqual(DOUBLED)
    expect(change?.changed_by).toBe(fx.instructor.id)
    expect(change?.affected_run_ids).toEqual([runId])
    expect(change?.created_at).toBeInstanceOf(Date)

    const audit = await auditRows(courseId)
    expect(audit.map((entry) => entry.action)).toContain('mapping.change')
  })

  it('recomputes the run’s points and files a new export with reason mapping_change', async () => {
    const runId = await confirmedRun()
    const before = await scoreRow(runId)
    const preview = await courses.previewMappingChange(fx.instructor, courseId, {
      mapping: DOUBLED,
    })

    await courses.changeMapping(fx.instructor, courseId, { mapping: DOUBLED, confirm: true })
    await drain()

    const after = await scoreRow(runId)
    expect(Number(after?.points_confirmed)).toBeCloseTo(Number(before?.points_confirmed) * 2, 2)
    expect(Number(after?.points_confirmed)).toBeCloseTo(preview.affected[0]?.pointsAfter ?? -1, 3)

    const exports = await exportRows(runId)
    expect(exports.map((entry) => entry.version)).toEqual([1, 2])
    expect(exports[1]?.reason).toBe('mapping_change')
    // No acting user by the time the job runs: the instructor pressed Apply and it committed.
    expect(exports[1]?.created_by).toBeNull()

    // The ledger is append-only: version 1 still says what the course entered from it.
    const v1 = exports[0]?.file as { computed?: { points?: number } }
    const v2 = exports[1]?.file as { computed?: { points?: number } }
    expect(v1.computed?.points).toBeCloseTo(Number(before?.points_confirmed), 3)
    expect(v2.computed?.points).toBeCloseTo(Number(after?.points_confirmed), 3)
  })

  it('leaves a run that is not confirmed alone', async () => {
    const scored = await scoredRun(fx)
    await courses.changeMapping(fx.instructor, courseId, { mapping: DOUBLED, confirm: true })
    await drain()

    const preview = await courses.previewMappingChange(fx.instructor, courseId, {
      mapping: DEFAULT_MAPPING,
    })
    expect(preview.affected).toEqual([])
    expect(await exportRows(scored)).toHaveLength(0)
  })

  it('does nothing at all when the mapping is already the course’s (D-437’s reading)', async () => {
    const runId = await confirmedRun()
    const course = await courses.changeMapping(fx.instructor, courseId, {
      mapping: DEFAULT_MAPPING,
      confirm: true,
    })
    await drain()

    expect(course.mapping).toEqual(DEFAULT_MAPPING)
    expect(await mappingChangeRows(courseId)).toHaveLength(0)
    expect(await exportRows(runId)).toHaveLength(1)
  })

  it('is the course instructor’s alone (07 §5)', async () => {
    await confirmedRun()
    expect(
      await codeOf(courses.changeMapping(fx.ta, courseId, { mapping: DOUBLED, confirm: true })),
    ).toBe('FORBIDDEN')
    expect(
      await codeOf(
        courses.changeMapping(fx.student, courseId, { mapping: DOUBLED, confirm: true }),
      ),
    ).toBe('FORBIDDEN')
    expect(await mappingChangeRows(courseId)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The job (10 §3, 10 §7)
// ---------------------------------------------------------------------------------------------

describe('recomputeExports', () => {
  it('reprices and re-exports every confirmed run of the course', async () => {
    const runId = await confirmedRun()
    await courses.changeMapping(fx.instructor, courseId, { mapping: DOUBLED, confirm: true })
    await drain()

    const result = await courses.recomputeExports({ courseId, organizationId: fx.orgId })
    expect(result).toMatchObject({ courseId, repriced: 1, exported: 1 })
    // The ledger is append-only, so a second pass files a third version with the same numbers
    // rather than rewriting the second (D-447).
    const exports = await exportRows(runId)
    expect(exports.map((entry) => entry.version)).toEqual([1, 2, 3])
    expect(exports[2]?.reason).toBe('mapping_change')
  })
})
