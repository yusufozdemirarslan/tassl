// `courses.deleteWalkthroughRun` (D-104) on a run that has actually been taken — the case that
// migration 0012 (D-255) exists for, and the one `tests/integration/courses/service.test.ts` cannot
// make, because the run it deletes is a bare row inserted by the repository.
//
// A run acquires children the moment a student touches it. Migration 0005 declared every one of
// those foreign keys `ON DELETE no action`, so the Delete control on UI-032 raised 23503 on any run
// past `assigned`: dead for every real run. This file drives the whole opening of a run through the
// services a student uses — start, policy, a readiness answer, submit, a document opened, the frame
// locked — and then asks the instructor to discard it.
//
// **The claims these tests exist to make.**
//
//   1. The run goes whole. Every child table that held a row for it holds none afterwards, counted
//      from the catalogue rather than from a list kept here, and the audit row that records the
//      deletion survives, because `audit_logs` is not a child of a run (08 §4).
//   2. Only that run goes. The classmate's run on the same assignment, and the student's own run on
//      the other assignment, are untouched.
//   3. The refusals still hold, each against a run with children, and each leaving it intact: a run
//      whose assignment is not a walkthrough is refused whoever asks, the run's own student and the
//      section's TA are forbidden, and an instructor who does not teach the section is not told the
//      run exists.
// @db:truncate
import { readFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Courses = typeof import('@/server/modules/courses')
type Runs = typeof import('@/server/modules/runs')
type Scenarios = typeof import('@/server/modules/scenarios')
type Admin = typeof import('@/server/modules/admin/repository')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let courses: Courses
let runs: Runs
let scenarios: Scenarios
let admin: Admin
let f: Factories

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

/** The Meridian Roast package the seed imports (06 §5 item 4): a real room and a real check. */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../src/server/db/fixtures/meridian-roast.package.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>

/** The frame a run has to lock to leave `framing` (FR-040): every field filled, inside its limit. */
const FRAME = {
  decision:
    'Whether the premium tier’s economics justify moving acquisition spend out of the value tier',
  assumptions: [
    'Premium retention holds near the piloted level for three months',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable through the crop year',
  ],
  position: 'Lean toward holding spend in the value tier until the payback figure is rechecked',
  confidence: 40,
}

type Fixture = Awaited<ReturnType<typeof setup>>

/**
 * One institution: a course whose section holds the instructor, a TA, the student and a classmate,
 * and a second course under a second instructor who teaches none of them. Two assignments on the
 * confirmed fixture package — one walkthrough, one not — because the refusal is a property of the
 * assignment, not of the run.
 */
async function setup() {
  const { organization } = await f.createInstitution('delete-run')
  const orgId = organization.id

  const instructorUser = await f.createUser('delete-run-instructor')
  const taUser = await f.createUser('delete-run-ta')
  const studentUser = await f.createUser('delete-run-student')
  const classmateUser = await f.createUser('delete-run-classmate')
  const otherInstructorUser = await f.createUser('delete-run-other-instructor')
  await f.addMember(orgId, instructorUser.id, 'instructor')
  await f.addMember(orgId, taUser.id, 'teaching_assistant')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, classmateUser.id, 'student')
  await f.addMember(orgId, otherInstructorUser.id, 'instructor')

  const course = await f.createCourse(orgId, 'delete-run-course', { createdBy: instructorUser.id })
  const section = await f.createSection(orgId, course.id, 'delete-run-section')
  await f.addSectionMember(orgId, section.id, instructorUser.id, 'instructor')
  await f.addSectionMember(orgId, section.id, taUser.id, 'ta')
  await f.addSectionMember(orgId, section.id, studentUser.id, 'student')
  await f.addSectionMember(orgId, section.id, classmateUser.id, 'student')

  // A second section under a different instructor: a section they do not teach is a section they
  // are not a member of, which is the shape `requireRunInstructor` answers NOT_FOUND to.
  const otherCourse = await f.createCourse(orgId, 'delete-run-other-course', {
    createdBy: otherInstructorUser.id,
  })
  const otherSection = await f.createSection(orgId, otherCourse.id, 'delete-run-other-section')
  await f.addSectionMember(orgId, otherSection.id, otherInstructorUser.id, 'instructor')

  const instructor = actorFor(instructorUser, orgId)
  const imported = await scenarios.importPackage(instructor, orgId, {
    ...FIXTURE,
    confirmOnImport: true,
  })
  await scenarios.confirmVersion(instructor, imported.versionId, { teachingNoteChecked: true })

  const variants = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_variants where package_version_id = ${imported.versionId}`
  const defective = variants.find((variant) => variant.key === 'defective')
  if (!defective) throw new Error('the fixture package has no defective variant')

  const walkthrough = await f.createAssignment(orgId, section.id, 'delete-run-walkthrough', {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1 (walkthrough)',
    isWalkthrough: true,
  })
  const graded = await f.createAssignment(orgId, section.id, 'delete-run-graded', {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1',
    isWalkthrough: false,
  })

  return {
    orgId,
    walkthrough,
    graded,
    instructor,
    ta: actorFor(taUser, orgId),
    student: actorFor(studentUser, orgId),
    classmate: actorFor(classmateUser, orgId),
    otherInstructor: actorFor(otherInstructorUser, orgId),
  }
}

/**
 * A run taken as far as Phase 6 goes: started, the policy acknowledged, one readiness item answered,
 * the check submitted, a document opened, the frame locked. Every one of those writes a row
 * somewhere — the trace above all — which is exactly what used to make the run undeletable.
 */
async function takeRun(actor: SessionUser, assignmentId: string): Promise<string> {
  const started = await runs.startRun(actor, assignmentId)
  await runs.acknowledgePolicy(actor, started.id)

  const check = await runs.getReadiness(actor, started.id)
  const [item] = check.items
  if (!item) throw new Error('the check has no items')
  const [authored] = await testSql<{ answer_key: string }[]>`
    select answer_key from readiness_items where id = ${item.id}`
  await runs.answerReadinessItem(actor, started.id, item.id, { answerKey: authored!.answer_key })
  await runs.submitReadiness(actor, started.id)

  const workspace = await runs.getRunWorkspace(actor, started.id)
  const [document] = workspace.documents
  if (!document) throw new Error('the evidence room is empty')
  await runs.openDocument(actor, started.id, document.id)

  await runs.lockFrame(actor, started.id, FRAME)
  return started.id
}

/** Every table that references `runs.id`, read from the catalogue rather than from a list here. */
async function childCounts(runId: string): Promise<Record<string, number>> {
  const tables = await testSql<{ child: string }[]>`
    select distinct r.relname as child
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    where c.contype = 'f' and c.confrelid = 'public.runs'::regclass and r.relname <> 'runs'
    order by 1`
  const counts: Record<string, number> = {}
  for (const { child } of tables) {
    const [row] = await testSql.unsafe<{ count: string }[]>(
      `select count(*)::text as count from "public"."${child}" where run_id = $1`,
      [runId],
    )
    counts[child] = Number(row?.count ?? 0)
  }
  return counts
}

const runExists = async (runId: string): Promise<boolean> =>
  (await testSql`select 1 from runs where id = ${runId}`).length === 1

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  courses ??= await import('@/server/modules/courses')
  runs ??= await import('@/server/modules/runs')
  scenarios ??= await import('@/server/modules/scenarios')
  admin ??= await import('@/server/modules/admin/repository')
  f ??= await import('@tests/factories')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

describe('deleteWalkthroughRun on a run that has been taken (D-104, D-255)', () => {
  it('deletes the run and every child row it wrote', async () => {
    const runId = await takeRun(fx.student, fx.walkthrough.id)

    // The four things the task's walkthrough does, each of which used to make the delete impossible.
    const before = await childCounts(runId)
    expect(before.run_events).toBeGreaterThan(0)
    expect(before.run_readiness_answers).toBe(1)
    expect(before.run_readiness_results).toBe(1)
    expect(before.run_document_opens).toBe(1)
    expect(before.run_frames).toBe(1)

    await courses.deleteWalkthroughRun(fx.instructor, runId)

    expect(await runExists(runId)).toBe(false)
    const after = await childCounts(runId)
    expect(Object.entries(after).filter(([, count]) => count !== 0)).toEqual([])

    // The audit row is the point of the deletion being auditable at all: it is written in the same
    // transaction and is not a child of the run, so it outlives it (08 §4).
    const log = await admin.listAuditLog({ orgId: fx.orgId })
    expect(
      log.items.filter((row) => row.action === 'run.delete' && row.targetId === runId),
    ).toHaveLength(1)
  })

  it('deletes only that run: the classmate keeps theirs, and so does the same student on the other assignment', async () => {
    const runId = await takeRun(fx.student, fx.walkthrough.id)
    const classmateRunId = await takeRun(fx.classmate, fx.walkthrough.id)
    const gradedRunId = await takeRun(fx.student, fx.graded.id)

    await courses.deleteWalkthroughRun(fx.instructor, runId)

    expect(await runExists(classmateRunId)).toBe(true)
    expect(await runExists(gradedRunId)).toBe(true)
    for (const survivor of [classmateRunId, gradedRunId]) {
      const counts = await childCounts(survivor)
      expect(counts.run_events, survivor).toBeGreaterThan(0)
      expect(counts.run_frames, survivor).toBe(1)
    }
  })
})

describe('the refusals, against a run that has children', () => {
  it('refuses a run whose assignment is not a walkthrough, and leaves it whole', async () => {
    const runId = await takeRun(fx.student, fx.graded.id)
    const before = await childCounts(runId)

    expect(await codeOf(courses.deleteWalkthroughRun(fx.instructor, runId))).toBe('FORBIDDEN')

    expect(await runExists(runId)).toBe(true)
    expect(await childCounts(runId)).toEqual(before)
  })

  it('refuses everyone who is not the section instructor, walkthrough or not', async () => {
    const runId = await takeRun(fx.student, fx.walkthrough.id)

    // In the section but not teaching it: refused, and told so.
    expect(await codeOf(courses.deleteWalkthroughRun(fx.student, runId))).toBe('FORBIDDEN')
    expect(await codeOf(courses.deleteWalkthroughRun(fx.ta, runId))).toBe('FORBIDDEN')
    expect(await codeOf(courses.deleteWalkthroughRun(fx.classmate, runId))).toBe('FORBIDDEN')
    // An instructor of another course in the same institution is not a member of this section, so
    // the run is not theirs to know about (08 §5).
    expect(await codeOf(courses.deleteWalkthroughRun(fx.otherInstructor, runId))).toBe('NOT_FOUND')

    expect(await runExists(runId)).toBe(true)
    const counts = await childCounts(runId)
    expect(counts.run_events).toBeGreaterThan(0)
    expect(counts.run_frames).toBe(1)
  })
})
