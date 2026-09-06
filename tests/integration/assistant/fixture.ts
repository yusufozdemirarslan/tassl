// The room every assistant test works in (Step 7.3), built once per test from the fixture package
// the seed imports: Meridian Roast, nine documents, eight claims, two variants, one Sycophancy
// Probe (06 §5 item 4).
//
// It is a module rather than a copy in each file because all four assistant suites need the same
// three things — a run in `working`, the fixture's claim keys, and a way to read the rows and the
// trace back — and a hand-built package would let each file decide what "a claim" is. The two things
// under test are exactly the ones a fixture must not be allowed to soften: what the student is
// handed, and what the run records about it.
import { readFileSync } from 'node:fs'
import { testSql } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

/** The confirmed fixture package, read from disk so a test names the author's own wordings. */
export const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../src/server/db/fixtures/meridian-roast.package.json', import.meta.url),
    'utf8',
  ),
) as {
  version: { workingClockSeconds: number; turnDelaySeconds: number; brief: string }
  documents: { key: string; title: string; body: string }[]
  stakeholders: { name: string; roleTitle: string }[]
  claims: {
    key: string
    text: string
    triggerPhrases: string[]
    sourceKind: string
    sourceDocumentKey: string | null
  }[]
  probe: { claimKey: string; scriptedReversal: string }
  // `evidence` and `windowClaimKeys` are named here so a test can assert they never reach the
  // student (12 §8.1): the Turn suite checks the payload against the author's own words.
  turn: { text: string; voice: string; evidence: string; windowClaimKeys: string[] }
}

export const claimByKey = (key: string) => {
  const claim = FIXTURE.claims.find((entry) => entry.key === key)
  if (!claim) throw new Error(`the fixture package has no claim ${key}`)
  return claim
}

/** A frame that passes FR-040 without saying anything the tests depend on. */
export const FRAME = {
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

export const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

/** The error code a rejected promise carried, or `'no error'` when it resolved. */
export const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

export type AssistantFixture = Awaited<ReturnType<typeof setupAssistantFixture>>

/**
 * Every fixture gets fresh seats.
 *
 * The rate limiter is a process-wide in-memory sliding window keyed by `<bucket>:{userId}` under
 * `APP_ENV=test` (D-026, D-164), and nothing in `truncateAll` reaches it — it is not a table. The
 * `llm` bucket is ten a minute, which is the smallest budget in 10 §4 and the one these suites spend
 * most: a file sharing one student would run out partway through and fail the rest with 429s that
 * say nothing about the endpoints. A counter in the seat labels keeps each test inside its own
 * window; every other property of the fixture is unchanged. (The same reading, and the same fix, as
 * `tests/integration/api/packages.test.ts`.)
 */
let seat = 0

/**
 * Two institutions' worth of seats is more than these suites need; one section with a student, an
 * instructor, a TA and a classmate is exactly what 07 §7's two readers and 08 §4's two denials ask
 * for.
 */
export async function setupAssistantFixture(prefix: string) {
  const f = (await import('@tests/factories')) as Factories
  const scenarios = await import('@/server/modules/scenarios')
  seat += 1
  const label = `${prefix}-${seat}`

  const { organization } = await f.createInstitution(label)
  const orgId = organization.id

  const instructorUser = await f.createUser(`${label}-instructor`)
  const taUser = await f.createUser(`${label}-ta`)
  const studentUser = await f.createUser(`${label}-student`)
  const classmateUser = await f.createUser(`${label}-classmate`)
  await f.addMember(orgId, instructorUser.id, 'instructor')
  await f.addMember(orgId, taUser.id, 'teaching_assistant')
  await f.addMember(orgId, studentUser.id, 'student')
  await f.addMember(orgId, classmateUser.id, 'student')

  const course = await f.createCourse(orgId, `${label}-course`, { createdBy: instructorUser.id })
  const section = await f.createSection(orgId, course.id, `${label}-section`)
  await f.addSectionMember(orgId, section.id, instructorUser.id, 'instructor')
  await f.addSectionMember(orgId, section.id, taUser.id, 'ta')
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

  const assignment = await f.createAssignment(orgId, section.id, `${label}-assignment`, {
    packageVersionId: imported.versionId,
    variantId: defective.id,
    label: 'Decision Run 1 (assistant)',
  })

  const claimIds = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_claims where package_version_id = ${imported.versionId}`
  const documentIds = await testSql<{ id: string; key: string }[]>`
    select id, key from scenario_documents where package_version_id = ${imported.versionId}`

  return {
    orgId,
    versionId: imported.versionId,
    assignment,
    instructor,
    ta: actorFor(taUser, orgId),
    student: actorFor(studentUser, orgId),
    studentUser,
    classmate: actorFor(classmateUser, orgId),
    /** `scenario_claims.id` by authored key (`C3`), which is what every claim endpoint addresses. */
    claimId: (key: string): string => {
      const row = claimIds.find((claim) => claim.key === key)
      if (!row) throw new Error(`the imported version has no claim ${key}`)
      return row.id
    },
    documentId: (key: string): string => {
      const row = documentIds.find((document) => document.key === key)
      if (!row) throw new Error(`the imported version has no document ${key}`)
      return row.id
    },
  }
}

/** A run in `working`: started, policy acknowledged, check submitted, frame locked (FR-041). */
export async function runInWorking(fx: AssistantFixture): Promise<string> {
  const runs = await import('@/server/modules/runs')
  const started = await runs.startRun(fx.student, fx.assignment.id)
  await runs.acknowledgePolicy(fx.student, started.id)
  await runs.submitReadiness(fx.student, started.id)
  await runs.lockFrame(fx.student, started.id, FRAME)
  return started.id
}

// ---------------------------------------------------------------------------------------------
// Reading the record back — the tables and the trace as written, not a projection of them
// ---------------------------------------------------------------------------------------------

export async function delegationRows(runId: string) {
  return testSql<
    {
      id: string
      seq: number
      request_text: string
      response_text: string
      claim_ids: string[]
      flags: string[]
      unverified_numbers: { value: string; context: string }[]
      why: string | null
      failed: boolean
      in_turn_window: boolean
      clock_remaining_ms: number | null
    }[]
  >`select id, seq, request_text, response_text, claim_ids, flags, unverified_numbers, why,
           failed, in_turn_window, clock_remaining_ms
      from run_delegations where run_id = ${runId} order by seq`
}

export async function runClaimRows(runId: string) {
  return testSql<
    {
      claim_id: string
      key: string
      surfaced_by: string
      surfaced_by_id: string | null
      surfaced_at: Date
      stance: string | null
      used_marked: boolean
      relied_on: boolean
      relied_on_via: string[]
    }[]
  >`select rc.claim_id, sc.key, rc.surfaced_by, rc.surfaced_by_id, rc.surfaced_at, rc.stance,
           rc.used_marked, rc.relied_on, rc.relied_on_via
      from run_claims rc join scenario_claims sc on sc.id = rc.claim_id
     where rc.run_id = ${runId} order by rc.surfaced_at, sc.position, sc.key`
}

/** The run's events as written — the reviewer's record rather than the owner's view. */
export async function eventsOfType(runId: string, type: string) {
  return testSql<{ seq: number; payload: Record<string, unknown> }[]>`
    select seq, payload from run_events where run_id = ${runId} and type = ${type} order by seq`
}

export async function pauseRows(runId: string) {
  return testSql<
    {
      id: string
      cause: string
      paused_at: Date
      resumed_at: Date | null
      credited_ms: number
      related_delegation_id: string | null
    }[]
  >`select id, cause, paused_at, resumed_at, credited_ms, related_delegation_id
      from run_pauses where run_id = ${runId} order by paused_at`
}

export async function llmCallRows(runId: string) {
  return testSql<{ feature: string; prompt_name: string; outcome: string }[]>`
    select feature, prompt_name, outcome from llm_calls where run_id = ${runId} order by created_at`
}

/** Arms FR-118's test control the way Phase 8's instructor screen will. */
export async function armForcedFailure(runId: string): Promise<void> {
  await testSql`
    update runs set flags = flags || '{"forced_failure_armed": true}'::jsonb where id = ${runId}`
}

/** Sets a stance through the table, until Phase 8 exposes `PUT /runs/{id}/claims/{id}/stance`. */
export async function setStanceDirectly(
  runId: string,
  claimId: string,
  stance: string,
): Promise<void> {
  await testSql`
    update run_claims
       set previous_stance = stance, stance = ${stance}::stance, stance_set_at = now()
     where run_id = ${runId} and claim_id = ${claimId}`
}

/** Every property name anywhere in a value (12 §8.3). */
export function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => keysOf(entry, out))
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out.add(key)
      keysOf(nested, out)
    }
  }
  return out
}
