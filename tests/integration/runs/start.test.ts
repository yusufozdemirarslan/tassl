// Step 6.2 — starting a run and acknowledging the policy display, against Postgres
// (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §9; FR-201, FR-231, D-041, D-123).
//
// The service is driven directly here, because these are its rules rather than its wire shape (the
// endpoints are exercised in tests/integration/api/runs.test.ts). What is asserted is what the walk
// from `assigned` to `readiness` has to leave behind: one run row carrying the two numbers the run
// will be judged under, a refusal for a second run and for someone who is not a student on the
// section, and a policy acknowledgement whose trace event repeats the course's own values.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Runs = typeof import('@/server/modules/runs')
type RunsRepo = typeof import('@/server/modules/runs/repository')
type Trace = typeof import('@/server/modules/trace')
type Courses = typeof import('@/server/modules/courses')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let runs: Runs
let runsRepo: RunsRepo
let trace: Trace
let courses: Courses
let f: Factories

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

type Fixture = Awaited<ReturnType<typeof setup>>

/**
 * The walkthrough shape: one institution, a course with a section holding an instructor and two
 * students, a confirmed package version, and the assignment on its defective variant. A second
 * institution supplies the outsider every cross-tenant refusal is proven against.
 */
async function setup() {
  const w = await f.buildWalkthroughFixture()
  const orgId = w.organization.id
  // The fixture's package version is a draft; an assignment may only point at a confirmed one.
  await testSql`
    update scenario_package_versions set status = 'confirmed', confirmed_at = now(),
      confirmed_by = ${w.instructor.id}, teaching_note_checked = true
    where id = ${w.pkg.version.id}`

  const outsiderOrg = (await f.createInstitution('runs-start-b')).organization.id
  const outsider = await f.createUser('runs-start-outsider')
  await f.addMember(outsiderOrg, outsider.id, 'instructor')

  // A student of the institution who is not on the section.
  const bystander = await f.createUser('runs-start-bystander')
  await f.addMember(orgId, bystander.id, 'student')

  return {
    orgId,
    outsiderOrg,
    assignment: w.assignment,
    section: w.section,
    course: w.course,
    pkg: w.pkg,
    student: actorFor(w.student1, orgId),
    student2: actorFor(w.student2, orgId),
    instructor: actorFor(w.instructor, orgId),
    bystander: actorFor(bystander, orgId),
    outsider: actorFor(outsider, outsiderOrg),
  }
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  runsRepo = await import('@/server/modules/runs/repository')
  trace = await import('@/server/modules/trace')
  courses = await import('@/server/modules/courses')
  f = await import('@tests/factories')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

describe('startRun (FR-231, 10 §6)', () => {
  it('creates the first attempt in `assigned` with the numbers the run is judged under', async () => {
    const run = await runs.startRun(fx.student, fx.assignment.id)

    expect(run.state).toBe('assigned')
    expect(run.attemptNo).toBe(1)
    expect(run.assignmentId).toBe(fx.assignment.id)
    expect(run.isWalkthrough).toBe(true)
    expect(run.mode).toBe('standard')
    expect(run.scoringStatus).toBe('idle')
    // No frame yet, so no working clock and no Turn (D-042).
    expect(run.clock).toBeNull()
    expect(run.turn).toBeNull()
    expect(run.version).toBe(0)
    expect(run.links.next).toBe(`/runs/${run.id}/start`)

    const row = await runsRepo.findRunWithLabels(fx.orgId, run.id)
    const assignment = await courses.getAssignment(fx.instructor, fx.assignment.id)
    expect(row?.run.workingClockSeconds).toBe(assignment.effectiveWorkingClockSeconds)
    expect(row?.run.turnDelaySeconds).toBe(assignment.turnDelaySeconds)
    expect(row?.run.packageVersionId).toBe(fx.pkg.version.id)
    expect(row?.run.studentId).toBe(fx.student.id)
    // Nothing has happened yet, so the trace is empty and the allocator is untouched.
    expect(row?.run.nextEventSeq).toBe(1)
    expect(await trace.listEvents(fx.student, run.id)).toEqual([])
  })

  it('copies the assignment override of the working clock when there is one', async () => {
    await testSql`
      update assignments set working_clock_seconds = 1800 where id = ${fx.assignment.id}`
    const run = await runs.startRun(fx.student, fx.assignment.id)
    const row = await runsRepo.findRunWithLabels(fx.orgId, run.id)
    expect(row?.run.workingClockSeconds).toBe(1800)
  })

  it('refuses a second run while the first is not voided (RUN_ACTIVE_EXISTS, D-041)', async () => {
    await runs.startRun(fx.student, fx.assignment.id)
    expect(await codeOf(runs.startRun(fx.student, fx.assignment.id))).toBe('RUN_ACTIVE_EXISTS')
  })

  it('refuses a second run even once the first has been recorded', async () => {
    const first = await runs.startRun(fx.student, fx.assignment.id)
    await testSql`update runs set state = 'recorded' where id = ${first.id}`
    expect(await codeOf(runs.startRun(fx.student, fx.assignment.id))).toBe('RUN_ACTIVE_EXISTS')
  })

  it('allows the next attempt once the first is voided, and numbers it 2', async () => {
    const first = await runs.startRun(fx.student, fx.assignment.id)
    await testSql`update runs set state = 'voided', voided_at = now() where id = ${first.id}`
    const second = await runs.startRun(fx.student, fx.assignment.id)
    expect(second.attemptNo).toBe(2)
    expect(second.id).not.toBe(first.id)
  })

  it('gives each student on the section their own attempt 1', async () => {
    const one = await runs.startRun(fx.student, fx.assignment.id)
    const two = await runs.startRun(fx.student2, fx.assignment.id)
    expect(one.attemptNo).toBe(1)
    expect(two.attemptNo).toBe(1)
  })

  it('refuses a member of the institution who is not on the section', async () => {
    // `getAssignment` never resolves for them, so the id itself stays unconfirmed (08 §4).
    expect(await codeOf(runs.startRun(fx.bystander, fx.assignment.id))).toBe('FORBIDDEN')
  })

  it('refuses the section instructor with FORBIDDEN, not NOT_FOUND', async () => {
    // They can read the assignment; they simply do not take it (08 §4 "Start a run": a dash).
    expect(await codeOf(runs.startRun(fx.instructor, fx.assignment.id))).toBe('FORBIDDEN')
  })

  it('answers NOT_FOUND to another institution', async () => {
    expect(await codeOf(runs.startRun(fx.outsider, fx.assignment.id))).toBe('NOT_FOUND')
  })

  it('refuses an assignment that has not opened yet', async () => {
    const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await testSql`update assignments set opens_at = ${opensAt} where id = ${fx.assignment.id}`
    expect(await codeOf(runs.startRun(fx.student, fx.assignment.id))).toBe('FORBIDDEN')
  })

  it('allows an assignment whose opening time has passed', async () => {
    await testSql`
      update assignments set opens_at = now() - interval '1 hour' where id = ${fx.assignment.id}`
    await expect(runs.startRun(fx.student, fx.assignment.id)).resolves.toMatchObject({
      state: 'assigned',
    })
  })
})

describe('acknowledgePolicy (FR-201, 10 §6)', () => {
  it('records the course values, opens the check, and traces both in order', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    const policy = await courses.getPolicyDisplay(fx.student, fx.assignment.id)

    const before = Date.now()
    const acknowledged = await runs.acknowledgePolicy(fx.student, started.id)
    const after = Date.now()

    expect(acknowledged.state).toBe('readiness')
    expect(acknowledged.links.next).toBe(`/runs/${started.id}/readiness`)
    // Two events written, so the poll version moved (D-123).
    expect(acknowledged.version).toBe(2)
    expect(acknowledged.timestamps.policyDisplayedAt).not.toBeNull()

    const row = await runsRepo.findRunWithLabels(fx.orgId, started.id)
    const startedAt = row?.run.readinessStartedAt?.getTime() ?? 0
    const expiresAt = row?.run.readinessExpiresAt?.getTime() ?? 0
    expect(startedAt).toBeGreaterThanOrEqual(before)
    expect(startedAt).toBeLessThanOrEqual(after)
    // Eight minutes (FR-010); the same instant the countdown on UI-022 reads.
    expect(expiresAt - startedAt).toBe(480_000)

    const events = await trace.listEvents(fx.student, started.id)
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'policy_displayed'],
      [2, 'lifecycle'],
    ])
    expect(events[0]?.payload).toEqual({
      outside_ai_policy: policy.outsideAiPolicy,
      weight: policy.weight,
      mapping: policy.mapping,
      run_type: policy.runType,
      counts_statement: true,
    })
    expect(events[1]?.payload).toEqual({
      from: 'assigned',
      to: 'readiness',
      cause: 'policy_acknowledged',
    })
    // Both are the student's own act, and neither is inside a clock (D-042).
    for (const event of events) {
      expect(event.actorId).toBe(fx.student.id)
      expect(event.clockRemainingMs).toBeNull()
    }
  })

  it('records the course policy as the course sets it, not a default', async () => {
    await courses.updateCoursePolicy(fx.instructor, fx.course.id, {
      outsideAiPolicy: 'in_environment_only',
      defaultRunWeight: 4.5,
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
    })
    const started = await runs.startRun(fx.student, fx.assignment.id)
    await runs.acknowledgePolicy(fx.student, started.id)

    const events = await trace.listEvents(fx.student, started.id)
    expect(events[0]?.payload).toMatchObject({
      outside_ai_policy: 'in_environment_only',
      weight: 4.5,
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
      run_type: 'decision',
      counts_statement: true,
    })
  })

  it('refuses a second acknowledgement with ILLEGAL_TRANSITION and writes nothing more', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    await runs.acknowledgePolicy(fx.student, started.id)

    expect(await codeOf(runs.acknowledgePolicy(fx.student, started.id))).toBe('ILLEGAL_TRANSITION')
    expect(await trace.listEvents(fx.student, started.id)).toHaveLength(2)
  })

  it('refuses everyone but the run owner', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    // A reviewer may read the run and may not act in it; a classmate may not even see it.
    expect(await codeOf(runs.acknowledgePolicy(fx.instructor, started.id))).toBe('NOT_FOUND')
    expect(await codeOf(runs.acknowledgePolicy(fx.student2, started.id))).toBe('NOT_FOUND')
    expect(await codeOf(runs.acknowledgePolicy(fx.outsider, started.id))).toBe('NOT_FOUND')
    expect(await trace.listEvents(fx.student, started.id)).toEqual([])
  })
})

describe('getRun, getRunStatus and listMyRuns (07 §7, §3)', () => {
  it('answers the owner and the section reviewers, and nobody else', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)

    await expect(runs.getRun(fx.student, started.id)).resolves.toMatchObject({ id: started.id })
    await expect(runs.getRun(fx.instructor, started.id)).resolves.toMatchObject({ id: started.id })
    expect(await codeOf(runs.getRun(fx.student2, started.id))).toBe('NOT_FOUND')
    expect(await codeOf(runs.getRun(fx.outsider, started.id))).toBe('NOT_FOUND')
    expect(await codeOf(runs.getRun(fx.bystander, started.id))).toBe('NOT_FOUND')
  })

  it('moves the version with every event, which is what the poll compares (D-123)', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect((await runs.getRun(fx.student, started.id)).version).toBe(0)
    await runs.acknowledgePolicy(fx.student, started.id)
    expect((await runs.getRun(fx.student, started.id)).version).toBe(2)
  })

  it('reports a held run as under review and nothing else about scoring (FR-140)', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect(await runs.getRunStatus(fx.student, started.id)).toMatchObject({ underReview: false })
    await testSql`update runs set scoring_status = 'held' where id = ${started.id}`
    const status = await runs.getRunStatus(fx.student, started.id)
    expect(status.underReview).toBe(true)
    expect(status.run.scoringStatus).toBe('held')
  })

  it('lists the actor’s own runs, newest first, and never another student’s', async () => {
    const mine = await runs.startRun(fx.student, fx.assignment.id)
    const theirs = await runs.startRun(fx.student2, fx.assignment.id)

    const page = await runs.listMyRuns(fx.student)
    expect(page.items.map((item) => item.id)).toEqual([mine.id])
    expect(page.nextCursor).toBeNull()

    const other = await runs.listMyRuns(fx.student2)
    expect(other.items.map((item) => item.id)).toEqual([theirs.id])
    expect(await runs.listMyRuns(fx.instructor)).toEqual({ items: [], nextCursor: null })
  })

  it('filters the list by state', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect((await runs.listMyRuns(fx.student, { state: 'assigned' })).items).toHaveLength(1)
    expect((await runs.listMyRuns(fx.student, { state: 'working' })).items).toEqual([])
    await runs.acknowledgePolicy(fx.student, started.id)
    expect((await runs.listMyRuns(fx.student, { state: 'readiness' })).items).toHaveLength(1)
  })
})

describe('the variant never reaches the student (12 §8, D-228)', () => {
  /** Every key in a payload, at every depth: what a projection actually hands over. */
  function keysOf(value: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach((item) => keysOf(item, out))
    else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        out.add(key)
        keysOf(nested, out)
      }
    }
    return out
  }

  const carriesVariant = (payload: unknown): boolean => {
    const keys = keysOf(payload)
    if (keys.has('variantKey') || keys.has('variantId') || keys.has('variant')) return true
    return JSON.stringify(payload).includes('defective')
  }

  it('withholds it from the Start response, the poll, the status and the list', async () => {
    // The run is on the *defective* variant, so a leak would tell the student a defect is planted;
    // on the sound variant the same field would tell them there is nothing to find, and 10 §11.3
    // bands Calibration Professional for accepting everything on a defect-free variant.
    const started = await runs.startRun(fx.student, fx.assignment.id)
    expect(carriesVariant(started)).toBe(false)
    expect(carriesVariant(await runs.getRun(fx.student, started.id))).toBe(false)
    expect(carriesVariant(await runs.getRunStatus(fx.student, started.id))).toBe(false)
    expect(carriesVariant(await runs.listMyRuns(fx.student))).toBe(false)
    expect(carriesVariant(await runs.acknowledgePolicy(fx.student, started.id))).toBe(false)
  })

  it('withholds it from a reviewer’s single-run read too, and keeps it in the reviewer’s list', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    // `GET /runs/{runId}` answers one shape to both readers, so the shape carries nothing a student
    // may not see; the reviewer reads the variant from their own list, which no student receives.
    expect(carriesVariant(await runs.getRun(fx.instructor, started.id))).toBe(false)

    const page = await courses.listAssignmentRuns(fx.instructor, fx.assignment.id)
    expect(page.items[0]?.variantKey).toBe('defective')
  })
})

describe('listAssignmentRuns (UI-032, 10 §3)', () => {
  it('gives a reviewer every run of the assignment with the student behind it', async () => {
    const mine = await runs.startRun(fx.student, fx.assignment.id)
    const theirs = await runs.startRun(fx.student2, fx.assignment.id)

    const page = await courses.listAssignmentRuns(fx.instructor, fx.assignment.id)
    expect(page.items.map((item) => item.id).sort()).toEqual([mine.id, theirs.id].sort())
    const row = page.items.find((item) => item.id === mine.id)
    expect(row).toMatchObject({
      studentId: fx.student.id,
      state: 'assigned',
      attemptNo: 1,
      decisionsMade: 0,
      latestExportVersion: null,
      variantKey: 'defective',
    })
  })

  it('refuses a student, including for their own run', async () => {
    await runs.startRun(fx.student, fx.assignment.id)
    expect(await codeOf(courses.listAssignmentRuns(fx.student, fx.assignment.id))).toBe('FORBIDDEN')
    expect(await codeOf(courses.listAssignmentRuns(fx.outsider, fx.assignment.id))).toBe(
      'NOT_FOUND',
    )
  })
})
