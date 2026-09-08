// The fixture behind B13 (docs/tech/16-performance-a11y-budgets.md §5.5): enough rows in
// `run_events` and `run_claims` that the planner has a real choice to make.
//
// A plan gate on an empty table proves nothing — Postgres reads ten rows sequentially whatever
// indexes exist, and would go on doing so with every index dropped. So this seeds 100 runs x 100
// events and 1,250 runs x 8 claims, which is 10,000 rows in each of the two tables the run screens
// read whole (§5.4), and the test then runs `ANALYZE` so the choice is made on statistics rather
// than on the planner's defaults.
//
// The rows are written in bulk rather than through the run services: the services would append a
// trace event per mutation and take the run row's lock 10,000 times, which is minutes of setup for
// a fixture whose only job is to have a shape and a size. What matters here is the shape — every
// run_claims row belongs to a run and names a claim, one in eight without a stance so the partial
// lock-gate index has something to hold — and the shape is the schema's, not a service's.
//
// The scenario claims are inserted while the version is still a draft: the `package_frozen`
// triggers (migration 0004) refuse every element write once `confirmed_at` is set, and the
// assignment the runs hang off needs a confirmed version (`PACKAGE_NOT_CONFIRMED`).
import { db } from '@/server/db/client'
import {
  runClaims,
  runEvents,
  runs,
  scenarioClaims,
  user,
  type NewRunClaim,
  type NewRunEvent,
  type NewRun,
  type NewScenarioClaim,
} from '@/server/db/schema'
import { updateVersionStatus } from '@/server/modules/scenarios/repository'
import { createAssignment } from './assignment'
import { createCourse } from './course'
import { uuidFrom } from './ids'
import { addMember, createInstitution } from './institution'
import { createPackageVersion } from './package'
import { createSection } from './section'
import { FROZEN_TIME } from './time'
import { createUser } from './user'

export type PlanFixtureInput = {
  /** Runs that carry a trace. */
  eventRuns: number
  /** Events per traced run; `eventRuns * eventsPerRun` is the `run_events` row count. */
  eventsPerRun: number
  /** Runs that carry claims. */
  claimRuns: number
  /** Claims per run; `claimRuns * claimsPerRun` is the `run_claims` row count. */
  claimsPerRun: number
}

/** A statement's parameters are capped at 65,535; a thousand rows of a dozen columns is well under. */
const CHUNK = 1_000

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

async function insertInChunks<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    await insert(rows.slice(start, start + CHUNK))
  }
}

/**
 * The event types the trace of a working run is mostly made of. Cycling through five of them gives
 * `type IN (...)` something to be selective about; a single type would make the index pointless and
 * the test vacuous.
 */
const EVENT_TYPES = [
  'delegation',
  'claim_used',
  'stance_set',
  'action',
  'document_open',
] as const satisfies readonly NewRunEvent['type'][]

/**
 * Seeds the two tables and returns the id of a run that carries both a trace and claims, which is
 * what every query in the plan gate is run against.
 */
export async function seedRunsForPlans(input: PlanFixtureInput): Promise<string> {
  const { organization } = await createInstitution('perf')
  const instructor = await createUser('perf-instructor')
  await addMember(organization.id, instructor.id, 'instructor')
  const course = await createCourse(organization.id, 'perf-course', { createdBy: instructor.id })
  const section = await createSection(organization.id, course.id, 'perf-section')

  const draft = await createPackageVersion(organization.id, 'perf-package', {
    createdBy: instructor.id,
  })
  const claimRows: NewScenarioClaim[] = range(input.claimsPerRun).map((index) => ({
    id: uuidFrom(`perf-claim:${index}`),
    packageVersionId: draft.version.id,
    key: `P${index + 1}`,
    text: `Perf claim ${index + 1}`,
    sourceKind: 'assistant',
    importance: index % 2 === 0 ? 'load_bearing' : 'supporting',
    consequenceLevel: 'medium',
    verificationCost: 'moderate',
    conceptKey: 'pricing_power',
    position: index,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
  }))
  const claims = await db.insert(scenarioClaims).values(claimRows).returning()

  const version = await updateVersionStatus(organization.id, draft.version.id, {
    status: 'confirmed',
    confirmedAt: FROZEN_TIME,
    confirmedBy: instructor.id,
    teachingNoteChecked: true,
  })
  if (!version) throw new Error(`version ${draft.version.id} is not in ${organization.id}`)

  const assignment = await createAssignment(organization.id, section.id, 'perf-assignment', {
    packageVersionId: version.id,
    variantId: draft.defective.id,
  })

  // One student per run: D-041's partial unique index allows one live run per (assignment, student).
  const runCount = Math.max(input.eventRuns, input.claimRuns)
  const students = range(runCount).map((index) => ({
    id: `perf-student-${index}`,
    name: `Perf student ${index}`,
    email: `perf-student-${index}@example.test`,
    emailVerified: true,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
  }))
  await insertInChunks((rows) => db.insert(user).values(rows), students)

  const runRows: NewRun[] = students.map((student, index) => ({
    id: uuidFrom(`perf-run:${index}`),
    organizationId: organization.id,
    assignmentId: assignment.id,
    studentId: student.id,
    packageVersionId: version.id,
    variantId: draft.defective.id,
    state: 'working',
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
    workingStartedAt: FROZEN_TIME,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
  }))
  await insertInChunks((rows) => db.insert(runs).values(rows), runRows)

  const events: NewRunEvent[] = []
  for (const run of runRows.slice(0, input.eventRuns)) {
    for (const seq of range(input.eventsPerRun)) {
      events.push({
        runId: run.id!,
        seq: seq + 1,
        type: EVENT_TYPES[seq % EVENT_TYPES.length]!,
        occurredAt: FROZEN_TIME,
        payload: {},
        createdAt: FROZEN_TIME,
      })
    }
  }
  await insertInChunks((rows) => db.insert(runEvents).values(rows), events)

  const stanced: NewRunClaim[] = []
  for (const run of runRows.slice(0, input.claimRuns)) {
    for (const [index, claim] of claims.entries()) {
      stanced.push({
        runId: run.id!,
        claimId: claim.id,
        surfacedAt: FROZEN_TIME,
        surfacedBy: 'delegation',
        // One claim in every run left unstanced: the lock gate's partial index is only worth
        // measuring if it has rows to hold (§5.3, `run_claims (run_id) where stance is null`).
        stance: index === 0 ? null : 'accept',
        stanceSetAt: index === 0 ? null : FROZEN_TIME,
        createdAt: FROZEN_TIME,
        updatedAt: FROZEN_TIME,
      })
    }
  }
  await insertInChunks((rows) => db.insert(runClaims).values(rows), stanced)

  return runRows[0]!.id!
}
