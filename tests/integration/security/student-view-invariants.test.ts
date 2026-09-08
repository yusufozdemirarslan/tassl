// Step 5.2 — the product invariant of CLAUDE.md and D-117, proven against a real database:
// "students never see warranted stances, evidence status, failure families, planted flags, or
// verification results before their run is scored; never the question bank, expected-answer notes,
// the seed record, or other students' runs" (docs/tech/12-security.md §8; 08-auth-authz.md §4).
//
// A test of this shape fails in one specific way: it passes because it looked at the wrong object.
// Two habits keep it honest, and both are load-bearing here.
//
//   1. *A negative control before every assertion of absence.* The suite first proves the key sets
//      fire on the payloads this codebase actually produces — the author's `findVersionFull` view
//      in camelCase, and raw `select *` rows in snake_case. A set that matched nothing would pass
//      every student assertion below and protect nothing.
//   2. *The student's payload, not a payload built here.* The end-to-end assertion runs
//      `scenarios.getStudentScenario(student, runId)` — the function the run screens call — over a
//      confirmed version whose every element carries something forbidden.
//
// This file is the whole of the invariant. Step 5.2 wrote the package projection, Phase 6 the
// workspace, Phases 8 and 9 the three acts, the locked record, the Turn and the defense; Step 13.4
// closes it with the run summary the client polls, the Delegation Log, the debrief on both sides of
// scoring, the Judgment Record and its export file, and the two refusals — a classmate and another
// institution (build-plan phase-13 §13.4).
//
// The last block runs a real run all the way to `recorded`, because the after-scoring half of D-117
// cannot be tested any other way: what the debrief may reveal is defined by the run having been
// scored, and a fixture that wrote `state = 'scored'` in SQL would be testing a string.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { countWords } from '@/lib/words'
import { stopBoss } from '@/server/jobs/boss'
import {
  STUDENT_FORBIDDEN_KEYS_ALWAYS,
  STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED,
  STUDENT_FORBIDDEN_KEYS_RECORD_FORM,
  assertNoForbiddenKeys,
  findForbiddenKeys,
} from '@/server/auth/student-view'
import type { SessionUser } from '@/server/auth/types'
import { StudentScenarioViewSchema } from '@/server/modules/scenarios/schema'

// ---------------------------------------------------------------------------------------------
// `getStudentScenario`, when it is there
//
// Step 5.2's service is written alongside this file. The suite loads it if it exists and skips the
// one end-to-end assertion if it does not, rather than failing a security suite on a missing
// import — every other test here still bites. A skip in this file is a hole in the invariant: if
// the line below reports the service as absent after Step 5.2 lands, that is the bug.
// ---------------------------------------------------------------------------------------------

type StudentScenarioFn = (actor: SessionUser, runId: string) => Promise<unknown>

const SERVICE_FILE = fileURLToPath(
  new URL('../../../src/server/modules/scenarios/service.ts', import.meta.url),
)

/**
 * Typed `string`, not left as a literal, on purpose: TypeScript resolves `import()` of a string
 * literal at compile time, and `pnpm typecheck` runs while the service is still being written. The
 * specifier is relative so the module runner resolves it against this file, and it is only reached
 * once `existsSync` has said the file is there.
 */
const SERVICE_MODULE: string = '../../../src/server/modules/scenarios/service'

async function loadGetStudentScenario(): Promise<StudentScenarioFn | undefined> {
  if (!existsSync(SERVICE_FILE)) return undefined
  try {
    const mod = (await import(SERVICE_MODULE)) as Record<string, unknown>
    const fn = mod.getStudentScenario
    return typeof fn === 'function' ? (fn as StudentScenarioFn) : undefined
  } catch {
    return undefined
  }
}

const getStudentScenario = await loadGetStudentScenario()

// ---------------------------------------------------------------------------------------------
// Fixture: a confirmed version whose every element carries something a student may not see
// ---------------------------------------------------------------------------------------------

type Factories = typeof import('@tests/factories')
type ScenariosRepo = typeof import('@/server/modules/scenarios/repository')
type RunsRepo = typeof import('@/server/modules/runs/repository')
type Runs = typeof import('@/server/modules/runs')
type Reliance = typeof import('@/server/modules/reliance')
type Trace = typeof import('@/server/modules/trace')
type Defense = typeof import('@/server/modules/defense')

let f: Factories
let repo: ScenariosRepo
let runsRepo: RunsRepo
let runs: Runs
let reliance: Reliance
let trace: Trace
let defense: Defense

const actorFor = (
  user: { id: string; email: string; name: string },
  orgId: string,
): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

/**
 * One institution, an instructor and a student, and a confirmed package version holding every
 * element type with its forbidden fields populated — the seed record, the question bank with its
 * expected-answer notes, both variants' claim states with the planted defect and its verification
 * paths, the Turn's internals, the probe, the readiness answer keys and the answer space.
 *
 * Elements are written while the version is still a draft: the `package_frozen` triggers refuse
 * every element write once `confirmed_at` is set, which is the order `confirmVersion` uses too.
 */
async function setup() {
  const orgId = (await f.createInstitution('student-view')).organization.id
  const instructor = await f.createUser('student-view-instructor')
  const student = await f.createUser('student-view-student')
  await f.addMember(orgId, instructor.id, 'instructor')
  await f.addMember(orgId, student.id, 'student')

  const pkg = await f.createPackageVersion(orgId, 'student-view-package', {
    createdBy: instructor.id,
  })
  const versionId = pkg.version.id

  // Version columns: the brief a student reads, and two fields they must not.
  await repo.upsertElement(orgId, versionId, 'brief', {
    brief: 'Meridian Roast must decide how much of next year’s spend moves to the premium tier.',
  })
  await repo.upsertElement(orgId, versionId, 'general_escalation_reply', {
    generalEscalationReply: 'That is a judgement for your finance lead, not for me.',
  })
  await repo.upsertElement(orgId, versionId, 'counterfactual', {
    debriefCounterfactual:
      'The payback figure was stale. A Source Trace would have shown it. The premium shift was not yet warranted.',
  })

  await repo.insertSeedRecord(versionId, {
    caseTitle: 'Meridian Roast (fixture)',
    publisher: 'Tassl',
    licenseTerms: 'internal fixture',
    licensePermitsAdaptation: true,
    seedText: 'The licensed case text this package was re-skinned from.',
    reskinLog: [
      { kind: 'renamed_entity', from: 'Northwind Coffee', to: 'Meridian Roast', note: '' },
    ],
  })

  const finance = await repo.upsertElement(orgId, versionId, 'stakeholder', {
    key: 'finance_lead',
    name: 'Dana Ruiz',
    roleTitle: 'Finance lead',
    positionStatement: 'Hold spend in the value tier until payback is proven.',
    incentives: 'Rewarded on gross margin, not on growth.',
    blindSpots: 'Treats the pilot cohort as representative of the whole base.',
    contradictsStakeholderId: null,
    contradictionPoint: null,
  })
  const growth = await repo.upsertElement(orgId, versionId, 'stakeholder', {
    key: 'growth_lead',
    name: 'Priya Shah',
    roleTitle: 'Growth lead',
    positionStatement: 'Move a bounded share to premium now.',
    incentives: 'Rewarded on new-tier revenue.',
    blindSpots: 'Reads the pilot retention number as settled.',
    contradictsStakeholderId: finance.id,
    contradictionPoint: 'Finance dates the payback at 20 months; growth at 11.',
  })

  // The successor is written first: `scenario_documents_superseded_by_check` refuses a superseded
  // document that names nothing.
  const retention = await repo.upsertElement(orgId, versionId, 'document', {
    key: 'D2',
    title: 'Retention memo',
    author: 'Priya Shah',
    datedOn: '2026-04-02',
    body: 'Month-three retention in the premium pilot is 61 percent.',
    wordCount: countWords('Month-three retention in the premium pilot is 61 percent.'),
    role: 'supporting',
    supersededByDocumentId: null,
    stakeholderId: growth.id,
    position: 1,
  })
  const deck = await repo.upsertElement(orgId, versionId, 'document', {
    key: 'D1',
    title: 'Positioning deck',
    author: 'Dana Ruiz',
    datedOn: '2025-02-10',
    body: 'Premium payback lands at 11 months on the pilot cohort.',
    wordCount: countWords('Premium payback lands at 11 months on the pilot cohort.'),
    role: 'superseded',
    supersededByDocumentId: retention.id,
    stakeholderId: finance.id,
    position: 0,
  })

  await repo.upsertElement(orgId, versionId, 'answer_space_position', {
    key: 'P1',
    kind: 'defensible',
    summary: 'Hold spend in the value tier.',
    supportingDocumentIds: [retention.id],
    ignoredEvidence: null,
    isMinimumCommitment: true,
    position: 0,
  })
  await repo.upsertElement(orgId, versionId, 'answer_space_position', {
    key: 'P2',
    kind: 'evidence_inconsistent',
    summary: 'Move 60 percent of spend on the 11-month payback.',
    supportingDocumentIds: [deck.id],
    ignoredEvidence: 'The retention memo supersedes the deck the payback rests on.',
    isMinimumCommitment: false,
    position: 1,
  })

  await repo.upsertElement(orgId, versionId, 'named_field', {
    key: 'premium_payback_months',
    label: 'Premium payback',
    unit: 'months',
    position: 0,
  })

  const planted = await repo.upsertElement(orgId, versionId, 'claim', {
    key: 'C3',
    text: 'Premium payback is 11 months.',
    sourceKind: 'assistant',
    sourceDocumentId: deck.id,
    sourcePassage: 'Premium payback lands at 11 months on the pilot cohort.',
    importance: 'load_bearing',
    consequenceLevel: 'high',
    verificationCost: 'cheap',
    weaklySourced: false,
    volatile: true,
    conceptKey: 'unit_economics',
    carriedValues: [{ field_key: 'premium_payback_months', value: 11, unit: 'months' }],
    triggerPhrases: ['payback', 'eleven months'],
    triggerDescription: 'The assistant states the payback period as settled.',
    escalatable: true,
    escalationReply: 'Finance owns the payback model; ask Dana before committing.',
    rationale: 'The deck it rests on is superseded by the retention memo, so this deserved Verify.',
    position: 0,
  })
  const sound = await repo.upsertElement(orgId, versionId, 'claim', {
    key: 'C4',
    text: 'The value tier is saturated in the core metros.',
    sourceKind: 'document',
    sourceDocumentId: retention.id,
    sourcePassage: 'Core-metro value-tier share has been flat for four quarters.',
    importance: 'supporting',
    consequenceLevel: 'low',
    verificationCost: 'moderate',
    weaklySourced: true,
    volatile: false,
    conceptKey: 'pricing_power',
    carriedValues: [],
    triggerPhrases: ['saturated'],
    triggerDescription: 'The assistant calls the value tier saturated.',
    escalatable: false,
    escalationReply: null,
    rationale: 'Low stakes and adequately sourced, so Accept was warranted.',
    position: 1,
  })

  // The defective variant carries the plant; the sound variant reads the same claim as sound.
  await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
    variantId: pkg.defective.id,
    claimId: planted.id,
    evidenceStatus: 'defective',
    failureFamily: 'stale_evidence',
    warrantedStance: 'verify',
    planted: true,
    verificationPaths: {
      source_trace: {
        document_id: deck.id,
        passage: 'Premium payback lands at 11 months on the pilot cohort.',
        dated_on: '2025-02-10',
        author: 'Dana Ruiz',
      },
    },
  })
  await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
    variantId: pkg.sound.id,
    claimId: planted.id,
    evidenceStatus: 'sound',
    failureFamily: null,
    warrantedStance: 'accept',
    planted: false,
    verificationPaths: {
      replication_check: { result: 'The cohort comparison reproduces 11 months.' },
    },
  })
  for (const variantId of [pkg.defective.id, pkg.sound.id]) {
    await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
      variantId,
      claimId: sound.id,
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      planted: false,
      // A Source Trace on the claim a document surfaces, so the suite can run an interrogation
      // action as a student and read what comes back (Step 8.1). Its result is authored content a
      // student *may* see once they have paid for it (FR-070) — which is why `verificationPaths`
      // is forbidden as a map and its individual paths are not (`student-view.ts`).
      verificationPaths: {
        source_trace: {
          document_id: retention.id,
          passage: 'Core-metro value-tier share has been flat for four quarters.',
          dated_on: '2026-04-02',
          author: 'Priya Shah',
        },
      },
    })
  }

  await repo.upsertElement(orgId, versionId, 'probe', {
    claimId: sound.id,
    originalPosition: 'The value tier is saturated.',
    scriptedReversal: 'You are right to push back — the value tier still has room.',
  })

  await repo.upsertElement(orgId, versionId, 'turn', {
    text: 'Month-three retention in the premium pilot is 61 percent, not 78.',
    voice: 'stakeholder_message',
    stakeholderId: growth.id,
    warrantsChange: true,
    proportionateResponse: 'revise',
    evidence: 'The corrected cohort table from the pilot dashboard.',
    disruptedAssumptionKeys: ['premium_payback_months'],
    windowClaimIds: [planted.id],
  })

  await repo.upsertElement(orgId, versionId, 'defense_question', {
    key: 'Q1',
    kind: 'provenance',
    claimId: planted.id,
    assumptionIndex: null,
    template: 'Where does {claim_text} come from?',
    condition: { stance: ['accept'] },
    followUp: 'What date does that document carry?',
    expectedAnswerNotes: 'Names the positioning deck and its 2025-02-10 date.',
    isDefault: false,
    position: 0,
  })
  // A figure-provenance question and six defaults, so the defense the sweep below opens is a real
  // interview rather than one question. Every one of them carries a follow-up prompt and
  // expected-answer notes, which is what the sweep is looking for: the bank is the instrument, and
  // none of it may travel with the question a student is asked (FR-123, 12 §8.1).
  await repo.upsertElement(orgId, versionId, 'defense_question', {
    key: 'Q2',
    kind: 'figure_provenance',
    claimId: null,
    assumptionIndex: null,
    template: 'You wrote {figure} into the brief. Which document is that from?',
    condition: {},
    followUp: 'If the assistant gave it to you, say so.',
    expectedAnswerNotes: 'A named-field value resolves to a document or to an assumption they own.',
    isDefault: false,
    position: 1,
  })
  for (const index of [0, 1, 2, 3, 4, 5]) {
    await repo.upsertElement(orgId, versionId, 'defense_question', {
      key: `D${index}`,
      kind: 'default',
      claimId: null,
      assumptionIndex: null,
      template: `What would you have had to see to decide the other way? (${index})`,
      condition: {},
      followUp: `Name the document or the number, not the feeling. (${index})`,
      expectedAnswerNotes: `The expected answer notes for default ${index}.`,
      isDefault: true,
      position: 2 + index,
    })
  }
  await repo.upsertElement(orgId, versionId, 'readiness_item', {
    key: 'R1',
    category: 'defect_concept',
    conceptKey: 'evidence_quality',
    stem: 'A figure rests on a document a later memo supersedes. What does it deserve?',
    options: [
      { key: 'a', text: 'Accept' },
      { key: 'b', text: 'Verify' },
      { key: 'c', text: 'Reject' },
      { key: 'd', text: 'Escalate' },
    ],
    answerKey: 'b',
    position: 0,
  })

  const version = await repo.updateVersionStatus(orgId, versionId, {
    status: 'confirmed',
    confirmedAt: f.FROZEN_TIME,
    confirmedBy: instructor.id,
    teachingNoteChecked: true,
  })
  if (!version) throw new Error('the fixture version was not confirmed')

  const course = await f.createCourse(orgId, 'student-view-course', { createdBy: instructor.id })
  const section = await f.createSection(orgId, course.id, 'student-view-section')
  await f.addSectionMember(orgId, section.id, instructor.id, 'instructor')
  await f.addSectionMember(orgId, section.id, student.id, 'student')
  const assignment = await f.createAssignment(orgId, section.id, 'student-view-assignment', {
    packageVersionId: versionId,
    variantId: pkg.defective.id,
  })
  const run = await runsRepo.insertRun(orgId, {
    assignmentId: assignment.id,
    studentId: student.id,
    packageVersionId: versionId,
    variantId: pkg.defective.id,
    state: 'working',
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })

  return {
    orgId,
    versionId,
    instructor,
    student,
    run,
    learner: actorFor(student, orgId),
  }
}

type Fixture = Awaited<ReturnType<typeof setup>>

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  f ??= await import('@tests/factories')
  repo ??= await import('@/server/modules/scenarios/repository')
  runsRepo ??= await import('@/server/modules/runs/repository')
  runs ??= await import('@/server/modules/runs')
  reliance ??= await import('@/server/modules/reliance')
  trace ??= await import('@/server/modules/trace')
  defense ??= await import('@/server/modules/defense')
  fx = await setup()
})

afterAll(async () => {
  // The scored-run block below runs the scoring pipeline, which opens pg-boss; without this the
  // worker keeps the process alive after the last assertion (D-176).
  await stopBoss()
  await truncateAll()
})

const keysFound = (payload: unknown, scored: boolean): string[] =>
  findForbiddenKeys(payload, { scored }).map((finding) => finding.key)

/**
 * Every statement the application client sent while `call` ran (D-252).
 *
 * `postgres.js` reads `options.debug` from the live options object once per statement it writes
 * (`src/connection.js`), so assigning it here instruments the very client the service uses — no
 * mock, no second connection, and the service is called exactly as a route handler calls it. It is
 * restored in `finally`, and only one test at a time uses it (`fileParallelism: false`).
 */
async function capturingSql(call: () => Promise<unknown>): Promise<string[]> {
  const { client } = await import('@/server/db/client')
  const options = (client as unknown as { options: { debug: unknown } }).options
  const previous = options.debug
  const statements: string[] = []
  options.debug = (_id: number, statement: string) => {
    statements.push(statement)
  }
  try {
    await call()
  } finally {
    options.debug = previous
  }
  return statements
}

/**
 * Every property name anywhere in a value (12 §8.3). The key sets answer "is anything forbidden in
 * here"; this answers "is this exact field in here", which is what a projection assertion needs when
 * the field is allowed elsewhere and forbidden on this payload.
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

// ---------------------------------------------------------------------------------------------
// The negative control: the sets fire on the payloads this codebase produces
// ---------------------------------------------------------------------------------------------

describe('the forbidden-key sets match this codebase, not a spec transcribed by hand', () => {
  it('flags the camelCase keys of the authoring view a student must never receive', async () => {
    const full = await repo.findVersionFull(fx.orgId, fx.versionId)
    const found = keysFound(full, false)

    // One key from every row of 12 §8.1 that a package version can carry.
    for (const key of [
      'seedRecord',
      'seedText',
      'reskinLog',
      'expectedAnswerNotes',
      'followUp',
      'condition',
      'generalEscalationReply',
      'escalationReply',
      'escalatable',
      'triggerPhrases',
      'carriedValues',
      'weaklySourced',
      'incentives',
      'blindSpots',
      'contradictionPoint',
      'warrantsChange',
      'proportionateResponse',
      'disruptedAssumptionKeys',
      'windowClaimIds',
      'originalPosition',
      'scriptedReversal',
      'answerKey',
    ]) {
      expect(found, `STUDENT_FORBIDDEN_KEYS_ALWAYS misses ${key}`).toContain(key)
    }

    // And every row of 12 §8.2.
    for (const key of [
      'warrantedStance',
      'evidenceStatus',
      'failureFamily',
      'planted',
      'verificationPaths',
      'rationale',
      'conceptKey',
      'role',
      'supersededByDocumentId',
      'stakeholderId',
      'answerSpacePositions',
      'ignoredEvidence',
      'isMinimumCommitment',
      'debriefCounterfactual',
    ]) {
      expect(found, `STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED misses ${key}`).toContain(key)
    }
  })

  it('flags the snake_case keys of the rows themselves (jsonb bodies and raw selects)', async () => {
    const [states, questions, seed, turn] = await Promise.all([
      testSql`select * from variant_claim_states`,
      testSql`select * from defense_questions`,
      testSql`select * from seed_records`,
      testSql`select * from scenario_turns`,
    ])
    const found = keysFound([...states, ...questions, ...seed, ...turn], false)

    for (const key of [
      'warranted_stance',
      'evidence_status',
      'failure_family',
      'verification_paths',
      'expected_answer_notes',
      'is_default',
      'seed_text',
      'license_terms',
      'reskin_log',
      'warrants_change',
      'disrupted_assumption_keys',
      'window_claim_ids',
    ]) {
      expect(found, `the key sets miss the snake_case spelling ${key}`).toContain(key)
    }
  })

  it('scores the payload against the stage it is in', async () => {
    const full = await repo.findVersionFull(fx.orgId, fx.versionId)

    // After scoring the debrief may show what each claim warranted (D-117) …
    expect(keysFound(full, true)).not.toContain('warrantedStance')
    // … but never the seed record or the question bank.
    expect(keysFound(full, true)).toContain('seedText')
    expect(keysFound(full, true)).toContain('expectedAnswerNotes')
  })
})

// ---------------------------------------------------------------------------------------------
// The student's package projection
// ---------------------------------------------------------------------------------------------

describe('the package a student receives carries no forbidden key', () => {
  /**
   * The loader above is allowed to answer `undefined`, and the projection test below is written to
   * skip when it does — which was fine while the service was being written and is a hole in the
   * invariant now that it exists. A broken module graph, a renamed export, or an import that throws
   * would leave this suite green with the one end-to-end assertion never run. This test is what
   * makes that a failure instead: the file reports the missing service rather than hiding it.
   */
  it('loaded getStudentScenario, so the projection test below is not silently skipped', () => {
    expect(existsSync(SERVICE_FILE), `${SERVICE_FILE} is missing`).toBe(true)
    expect(typeof getStudentScenario, `${SERVICE_MODULE} exports no getStudentScenario`).toBe(
      'function',
    )
  })

  it('the declared view (StudentScenarioViewSchema) admits only brief, documents and named fields', () => {
    // A row-shaped payload: every field of a document row, plus package fields from elsewhere.
    const wide = {
      brief: 'Meridian Roast must decide how much of next year’s spend moves to premium.',
      documents: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          key: 'D1',
          title: 'Positioning deck',
          author: 'Dana Ruiz',
          datedOn: '2025-02-10',
          body: 'Premium payback lands at 11 months.',
          wordCount: 6,
          position: 0,
          role: 'superseded',
          supersededByDocumentId: '22222222-2222-4222-8222-222222222222',
          stakeholderId: '33333333-3333-4333-8333-333333333333',
        },
      ],
      namedFields: [
        { key: 'premium_payback_months', label: 'Premium payback', unit: 'months', position: 0 },
      ],
      debriefCounterfactual: 'Three sentences the debrief owns.',
      generalEscalationReply: 'Ask your finance lead.',
      answerSpacePositions: [{ key: 'P1', isMinimumCommitment: true }],
    }

    // The control: the input really does carry what the view must drop.
    expect(keysFound(wide, false)).toContain('role')
    expect(keysFound(wide, false)).toContain('generalEscalationReply')

    const parsed = StudentScenarioViewSchema.parse(wide)
    expect(findForbiddenKeys(parsed, { scored: false })).toEqual([])
    expect(Object.keys(parsed)).toEqual(['brief', 'documents', 'namedFields'])
  })

  it.skipIf(getStudentScenario === undefined)(
    'getStudentScenario returns the run’s brief, documents and named fields and nothing else',
    async () => {
      const view = await getStudentScenario!(fx.learner, fx.run.id)

      expect(findForbiddenKeys(view, { scored: false })).toEqual([])
      // The projection is not empty: it is the payload the Evidence Room renders.
      const parsed = StudentScenarioViewSchema.parse(view)
      expect(parsed.documents.length).toBeGreaterThan(0)
      expect(parsed.brief).not.toEqual('')
      expect(parsed.namedFields.map((field) => field.key)).toContain('premium_payback_months')
    },
  )

  /**
   * The assertion above is about the answer. This one is about the *row the answer is made of*
   * (D-252), and it is the difference between a projection and a query.
   *
   * `GET /runs/{runId}/workspace` is the read a student's screen polls for the whole working
   * period, and `getStudentScenario` is what it calls for the package half. A read that loaded the
   * version whole to pick three fields off it would put the warranted stances, the evidence
   * statuses, the failure families, the verification paths, the question bank and the readiness
   * answer keys into the request that answers it — clean on the wire, and in the object any Sentry
   * `extra` or pino error field would carry. The control is the author's own read of the same
   * version, which does carry all of it.
   */
  it('the row behind the student’s package carries no forbidden key either (D-252)', async () => {
    // The control: the wide read of this very version is full of things a student may not see.
    const author = await repo.findVersionFull(fx.orgId, fx.versionId)
    expect(keysFound(author, false).length).toBeGreaterThan(0)

    const row = await repo.findRunScenario(fx.orgId, fx.run.id)
    expect(row, 'the run’s package was not found by its own tenant').toBeDefined()
    expect(findForbiddenKeys(row, { scored: false })).toEqual([])
    expect(Object.keys(row!).sort()).toEqual(['brief', 'documents', 'namedFields'])
    expect(row!.documents.length).toBeGreaterThan(0)
    for (const document of row!.documents) {
      // No body, and nothing authored about the document: five columns, named in the select.
      expect(Object.keys(document).sort()).toEqual(['author', 'datedOn', 'id', 'key', 'title'])
    }
    expect(row!.namedFields.length).toBeGreaterThan(0)
    for (const field of row!.namedFields) {
      expect(Object.keys(field).sort()).toEqual(['key', 'label', 'unit'])
    }
  })

  it.skipIf(getStudentScenario === undefined)(
    'the student’s package is that row, not a projection over a wider one (D-252)',
    async () => {
      // Nothing is dropped between the query and the answer, because nothing wider was loaded.
      const view = await getStudentScenario!(fx.learner, fx.run.id)
      expect(view).toEqual(await repo.findRunScenario(fx.orgId, fx.run.id))
    },
  )

  /**
   * The one assertion that can tell "never loaded" from "loaded and then dropped": the SQL the
   * student path actually sends. Both readings answer the same clean object, so a shape assertion
   * cannot separate them — `postgres.js` calls `options.debug` for every statement it writes, which
   * can, and the columns named below exist only on authored elements.
   *
   * The control is `findVersionForRun`, the wide read of the same version through the same client:
   * it names every one of them, which is what makes their absence above a fact about the query
   * rather than about the fixture.
   */
  it.skipIf(getStudentScenario === undefined)(
    'the student path never sends an answer key or a warranted stance to Postgres (D-252)',
    async () => {
      /** Columns of the authored elements 12 §8.1 and §8.2 withhold until a run is scored. */
      const withheld = [
        'answer_key',
        'warranted_stance',
        'evidence_status',
        'failure_family',
        'verification_paths',
        'planted',
        'expected_answer_notes',
        'scripted_reversal',
        'trigger_phrases',
      ]

      const namedIn = (statements: readonly string[]): string[] =>
        withheld.filter((column) => statements.some((statement) => statement.includes(column)))

      // The control first: the wide read of the same version, through the same client, names them.
      expect(
        namedIn(await capturingSql(() => repo.findVersionForRun(fx.orgId, fx.versionId))).length,
        'the control read named none of the withheld columns',
      ).toBeGreaterThan(0)

      const sent = await capturingSql(() => getStudentScenario!(fx.learner, fx.run.id))
      expect(sent.length, 'no statement was captured, so this test proves nothing').toBeGreaterThan(
        0,
      )
      expect(namedIn(sent)).toEqual([])
    },
  )

  it('answers undefined for a run another institution owns (D-252)', async () => {
    const other = (await f.createInstitution('student-view-other')).organization.id
    expect(await repo.findRunScenario(other, fx.run.id)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// The workspace a student works in (Step 6.4)
//
// The package projection above is one function; the workspace is what a student actually receives
// while the run is open, and it is assembled from three modules — the run itself, the package, and
// the claims a document surfaces. Each is built by picking fields, and this is where that is proven
// against a version whose every element carries something forbidden.
// ---------------------------------------------------------------------------------------------

describe('the workspace a student works in carries no forbidden key', () => {
  /** The fixture's two documents, by the keys `setup()` gives them. */
  async function documentIds(): Promise<{ deck: string; retention: string }> {
    const rows = await testSql<{ id: string; key: string }[]>`
      select id, key from scenario_documents where package_version_id = ${fx.versionId}`
    const deck = rows.find((row) => row.key === 'D1')?.id
    const retention = rows.find((row) => row.key === 'D2')?.id
    if (!deck || !retention) throw new Error('the fixture room is missing a document')
    return { deck, retention }
  }

  it('the room the workspace lists carries no body and nothing authored about a document', async () => {
    // The brief is saved first, deliberately (D-329). This sweep used to run over a workspace whose
    // `briefDraft` was null, so the branch that carries the student's own 250 words was never
    // walked — and a `BriefView` field named `rationale` would have passed a sweep that could not
    // see it. The draft is written before the read so the payload the assertion walks is the one a
    // student actually holds.
    await runs.saveBriefDraft(fx.learner, fx.run.id, {
      rationale: 'The payback figure is load-bearing and has not been traced to the cohort table.',
      recommendation: 'Hold the acquisition spend in the value tier this quarter.',
    })

    const workspace = await runs.getRunWorkspace(fx.learner, fx.run.id)

    expect(workspace.briefDraft, 'the sweep must have a brief to walk').not.toBeNull()
    expect(workspace.briefDraft?.briefRationale.length).toBeGreaterThan(0)
    expect(findForbiddenKeys(workspace, { scored: false })).toEqual([])
    expect(keysOf(workspace.briefDraft).has('rationale')).toBe(false)
    expect(workspace.documents.length).toBeGreaterThan(0)
    for (const document of workspace.documents) {
      // `role` and `supersededByDocumentId` are the missed-defect section of the debrief (12 §8.2):
      // which document supersedes which is the finding the run is measuring.
      expect(Object.keys(document).sort()).toEqual(['author', 'datedOn', 'id', 'key', 'title'])
    }
    // And no variant: which variant they drew says whether a defect was planted at all (D-228).
    expect(keysOf(workspace).has('variantKey')).toBe(false)
  })

  it('an open hands over the body and nothing else about the document', async () => {
    const { deck } = await documentIds()
    const opened = await runs.openDocument(fx.learner, fx.run.id, deck)

    expect(findForbiddenKeys(opened, { scored: false })).toEqual([])
    expect(opened.document.body.length).toBeGreaterThan(0)
    expect(Object.keys(opened.document).sort()).toEqual([
      'author',
      'body',
      'datedOn',
      'id',
      'key',
      'title',
    ])
  })

  it('a claim surfaced by a document carries the claim, and nothing authored about it', async () => {
    // The fixture's sound claim is sourced from the retention memo, so opening it surfaces the
    // claim (FR-031) — and the claim's row carries the trigger phrases, the escalation reply, the
    // author's rationale and, next to it, the warranted stance and the planted flag.
    const { retention } = await documentIds()
    await runs.openDocument(fx.learner, fx.run.id, retention)

    const claims = await reliance.listRunClaims(fx.learner, fx.run.id)
    expect(claims.length).toBeGreaterThan(0)
    expect(findForbiddenKeys(claims, { scored: false })).toEqual([])
    expect(Object.keys(claims[0]!).sort()).toEqual([
      'actions',
      'availableActions',
      'canEscalate',
      'escalation',
      'id',
      'inTurnWindow',
      'key',
      'previousStance',
      'reliedOn',
      'remainingEscalations',
      'stance',
      'stanceSetAt',
      'surfacedAt',
      'surfacedBy',
      'text',
      'usedMarked',
    ])
    // `escalatable` is the flag 12 §8.1 keeps out of every student view in every state (D-244), and
    // `canEscalate` is the fact about the run that replaces it. The set forbids the first by name;
    // this is the assertion that the second did not quietly become the first.
    expect(keysOf(claims).has('escalatable')).toBe(false)
    expect(claims.every((claim) => claim.canEscalate)).toBe(true)
  })

  it('the skim flag is not in the workspace, the open, or the owner’s trace (12 §8.2)', async () => {
    const { deck } = await documentIds()
    const { openId } = await runs.openDocument(fx.learner, fx.run.id, deck)
    await runs.closeDocument(fx.learner, fx.run.id, openId)

    const owned = await trace.listEvents(fx.learner, fx.run.id)
    const close = owned.find((event) => event.type === 'document_close')
    expect(close).toBeDefined()
    // D-082's reading of *how* they read is an input to the Verification band. Handing it back
    // mid-run is in-run feedback on the assessment (D-223).
    expect(keysOf(close?.payload).has('skim')).toBe(false)
    expect(keysOf(await runs.getRunWorkspace(fx.learner, fx.run.id)).has('skim')).toBe(false)
  })

  // ---------------------------------------------------------------------------------------------
  // What a student gets back for spending their clock (Step 8.1)
  //
  // The three acts of 10 §8 are the only routes by which authored content about a claim legitimately
  // reaches a student before their run is scored, and each one is a place the pick could slip:
  //
  //   * an interrogation action returns one `verification_paths` entry — the *path*, which FR-070
  //     says a student may read once they have paid a minute for it, and never the map, which would
  //     say which checks the author wrote for this claim and so which ones they thought it needed;
  //   * an escalation returns the colleague's reply and neither `responseId` nor `countsAgainstLimit`
  //     (D-116), which together would say whether the author wrote a reply for this claim;
  //   * the claim view after both carries all of it and still no warranted stance, evidence status,
  //     failure family, planted flag or rationale.
  // ---------------------------------------------------------------------------------------------

  describe('the three acts a student spends their clock on carry no forbidden key', () => {
    /** The fixture run is inserted straight into `working`; an action needs a clock to charge. */
    async function startTheClock(): Promise<void> {
      await testSql`update runs set working_started_at = now() where id = ${fx.run.id}`
    }

    it('an interrogation action hands over one authored path and nothing around it', async () => {
      const { retention } = await documentIds()
      await startTheClock()
      await runs.openDocument(fx.learner, fx.run.id, retention)
      const [claim] = await reliance.listRunClaims(fx.learner, fx.run.id)
      expect(claim).toBeDefined()

      const result = await reliance.runAction(fx.learner, fx.run.id, claim!.id, 'source_trace')

      expect(findForbiddenKeys(result, { scored: false })).toEqual([])
      expect(Object.keys(result).sort()).toEqual([
        'actionId',
        'clockCostMs',
        'inTurnWindow',
        'result',
        'type',
      ])
      // The path, not the map: `verificationPaths` in either spelling would say which checks exist
      // on this claim, which is the author's reading of what it needed.
      expect(keysOf(result).has('verification_paths')).toBe(false)
      expect(keysOf(result).has('verificationPaths')).toBe(false)
      expect(keysOf(result).has('warranted_stance')).toBe(false)
      expect(keysOf(result).has('evidence_status')).toBe(false)
      expect(keysOf(result).has('planted')).toBe(false)
    })

    it('an escalation hands over the reply, the cost and the budget, and not the bookkeeping', async () => {
      const { retention } = await documentIds()
      await startTheClock()
      await runs.openDocument(fx.learner, fx.run.id, retention)
      const [claim] = await reliance.listRunClaims(fx.learner, fx.run.id)

      const result = await reliance.escalate(fx.learner, fx.run.id, claim!.id, {
        statement: 'I cannot tell how settled this saturation reading is.',
      })

      expect(findForbiddenKeys(result, { scored: false })).toEqual([])
      // A closed set, widened once and deliberately: `statement` is D-318's addition and is the
      // student's own typed sentence read back off `run_escalations.statement`. Nothing authored
      // reaches it — they wrote it, the server only stripped its markup — so it is not a leak, and
      // `student-view.ts` forbids no key by that name in either set. Everything else on that row
      // stays behind, which is what this assertion exists to keep true.
      expect(Object.keys(result).sort()).toEqual([
        'clockCostMs',
        'remainingEscalations',
        'responseText',
        'statement',
      ])
      expect(result.statement).toBe('I cannot tell how settled this saturation reading is.')
      // D-116: both keys are on `run_escalations` and on the reviewer's trace, and on neither of the
      // two payloads a student can reach before their run is scored.
      expect(keysOf(result).has('responseId')).toBe(false)
      expect(keysOf(result).has('countsAgainstLimit')).toBe(false)
    })

    it('the claim view after a stance, an action and an escalation is still only the claim', async () => {
      const { retention } = await documentIds()
      await startTheClock()
      await runs.openDocument(fx.learner, fx.run.id, retention)
      const [surfaced] = await reliance.listRunClaims(fx.learner, fx.run.id)
      const claimId = surfaced!.id

      await reliance.runAction(fx.learner, fx.run.id, claimId, 'source_trace')
      await reliance.escalate(fx.learner, fx.run.id, claimId, {
        statement: 'I cannot tell how settled this saturation reading is.',
      })
      const view = await reliance.setStance(fx.learner, fx.run.id, claimId, 'verify')

      expect(findForbiddenKeys(view, { scored: false })).toEqual([])
      expect(view.actions).toHaveLength(1)
      expect(view.escalation).not.toBeNull()
      expect(view.availableActions).toEqual(['source_trace'])
      // The whole point of the exercise, in one assertion: the student has traced the claim, argued
      // with it and taken a position on it, and nothing in front of them says what it deserved.
      for (const key of [
        'warrantedStance',
        'warranted_stance',
        'evidenceStatus',
        'evidence_status',
        'failureFamily',
        'failure_family',
        'planted',
        'rationale',
        'escalatable',
        'escalationReply',
        'escalation_reply',
      ]) {
        expect([key, keysOf(view).has(key)]).toEqual([key, false])
      }
    })
  })

  // -------------------------------------------------------------------------------------------
  // The locked screen (Step 8.2, D-302, D-329)
  //
  // `getDecision` had no sweep here at all, and could not have had one: the record carries the
  // brief the student filed, and `BriefView` called the student's own 250 words `rationale` — the
  // name `student-view.ts` reserves for a claim's authored "what it deserved and why". The field
  // is `briefRationale` now, so the record can be swept like everything else a student receives.
  // -------------------------------------------------------------------------------------------

  describe('the record of a filed decision (D-302)', () => {
    async function lockOne(): Promise<void> {
      await testSql`update runs set working_started_at = now() where id = ${fx.run.id}`
      await runs.lockDecision(fx.learner, fx.run.id, {
        recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
        rationale:
          'The premium payback figure is load-bearing and has not been traced to the cohort table, so moving spend on it would be a bet on a number nobody has checked.',
        assumptions: [
          'Premium retention holds near the piloted level',
          'Value tier payback stays close to four months',
          'Green coffee cost per bag is stable through the crop year',
        ],
        changeMyMind: 'A cohort table showing premium payback under six months would change this.',
        confidence: 45,
        namedValues: {},
      })
    }

    it('carries no forbidden key, and names the student’s own prose unambiguously', async () => {
      await lockOne()
      const record = await runs.getDecision(fx.learner, fx.run.id)

      expect(findForbiddenKeys(record, { scored: false })).toEqual([])
      expect(record.brief).not.toBeNull()
      expect(record.brief?.briefRationale.length).toBeGreaterThan(0)
      // The name the sweep reserves for a claim's authored rationale is not on this payload under
      // either meaning, which is the whole of D-329.
      expect(keysOf(record).has('rationale')).toBe(false)
    })

    it('is a closed set of fields, and the brief inside it is another', async () => {
      await lockOne()
      const record = await runs.getDecision(fx.learner, fx.run.id)

      expect(Object.keys(record).sort()).toEqual([
        'addendum',
        'brief',
        'canAddAddendum',
        'frame',
        'namedFields',
        'run',
        'turnRemainingMs',
        // D-341: the frozen record carries the Turn response too, so the defense's artifacts panel
        // is one read of one shape. It is null here, before the Turn has arrived.
        'turnResponse',
      ])
      expect(record.turnResponse).toBeNull()
      expect(Object.keys(record.brief!).sort()).toEqual([
        'assumptions',
        'briefRationale',
        'changeMyMind',
        'confidence',
        'lockedAt',
        'namedValues',
        'recommendation',
        'updatedAt',
      ])
      // FR-106: the speed outlier is an instructor observation, and a student told their lock was
      // flagged is a student being penalised by being told.
      expect(keysOf(record).has('speedOutlier')).toBe(false)
      expect(keysOf(record).has('autoLocked')).toBe(false)
    })

    // -------------------------------------------------------------------------------------------
    // The Turn (FR-114, D-336)
    //
    // The one payload in the run whose *own* row is mostly oracle. `scenario_turns` carries
    // `warrants_change`, `proportionate_response`, `evidence`, `disrupted_assumption_keys` and
    // `window_claim_ids` beside the two fields the student reads, and every one of them is what the
    // student's response is measured against — so the sweep here is over a Turn row that carries a
    // real value in each, written by `setup()` above.
    // -------------------------------------------------------------------------------------------
    describe('the Turn a student answers', () => {
      /** Files the decision, then puts `turn_due_at` in the past so the next read delivers. */
      async function deliverTheTurn() {
        await lockOne()
        await testSql`update runs set turn_due_at = now() - interval '2 seconds'
                       where id = ${fx.run.id}`
        return runs.getTurn(fx.learner, fx.run.id)
      }

      it('carries no forbidden key, over a payload with something in every field', async () => {
        const view = await deliverTheTurn()

        // The negative control for this sweep: the brief and the named fields are populated, so an
        // empty finding list is a statement about a payload rather than about two nulls.
        expect(view.frozen.brief?.recommendation.length).toBeGreaterThan(0)
        expect(view.namedFields.length).toBeGreaterThan(0)
        expect(view.text.length).toBeGreaterThan(0)

        expect(findForbiddenKeys(view, { scored: false })).toEqual([])
      })

      it('is a closed set of fields, and says nothing the Turn declares about itself', async () => {
        const view = await deliverTheTurn()

        expect(Object.keys(view).sort()).toEqual([
          'frozen',
          'namedFields',
          'remainingMs',
          'run',
          'text',
          'voice',
          'windowEndsAt',
        ])
        expect(Object.keys(view.frozen).sort()).toEqual(['brief', 'frame'])

        // FR-114: what the Turn warrants, what response is proportionate, the evidence behind it,
        // the assumptions it disrupts and the claims it lands on are the instrument, not the
        // interview — under either spelling, and at any depth.
        const keys = keysOf(view)
        for (const forbidden of [
          'warrantsChange',
          'warrants_change',
          'proportionateResponse',
          'proportionate_response',
          'evidence',
          'disruptedAssumptionKeys',
          'disrupted_assumption_keys',
          'windowClaimIds',
          'window_claim_ids',
          'stakeholderId',
        ]) {
          expect([forbidden, keys.has(forbidden)]).toEqual([forbidden, false])
        }
        // Nor as a value under another name: the authored evidence sentence is nowhere in it.
        expect(JSON.stringify(view)).not.toContain('The corrected cohort table')
      })
    })

    // -----------------------------------------------------------------------------------------
    // The defense (Step 9.2, FR-120 to FR-126, UI-026)
    //
    // The sharpest test of the invariant in the run, because a rendered question *quotes the run*:
    // it is the one payload in the product where authored prose and the student's own record are
    // joined into a sentence they read. What it may quote is their own record and the author's
    // scenario text; what it may never quote is the author's assessment text — the follow-up prompt
    // before their answer earns it, the expected-answer notes the faculty seat reads against, the
    // selecting condition, or the bank row's own id (12 §8.1).
    //
    // The fixture is deliberately full: a brief with a figure in it, a frame, a filed Turn response
    // and a bank of eight questions with notes on every one. Phase 8 shipped a sweep that passed
    // because its fixture had never saved a brief, so the negative control here is an assertion and
    // not a comment.
    // -----------------------------------------------------------------------------------------
    describe('the defense a student takes', () => {
      /** Files the decision, locks a frame beside it, delivers the Turn and answers it. */
      async function reachTheDefense(): Promise<void> {
        await runsRepo.insertFrame(fx.run.id, {
          decision: 'Whether to move acquisition spend to the premium tier this quarter',
          assumptions: [
            'Premium retention holds at the piloted level',
            'Value tier payback stays near four months',
            'Supplier cost per bag is stable through the year',
          ],
          position: 'Lean toward holding spend until the payback figure is rechecked',
          confidence: 40,
          lockedAt: new Date(),
        })
        await testSql`update runs set working_started_at = now() where id = ${fx.run.id}`
        await runs.lockDecision(fx.learner, fx.run.id, {
          recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
          rationale:
            'The premium payback figure is load-bearing and has not been traced to the deck it rests on, so moving spend on it would be a bet on a number nobody has checked.',
          assumptions: [
            'Premium retention holds near the piloted level',
            'Value tier payback stays close to four months',
            'Supplier cost per bag is stable through the crop year',
          ],
          changeMyMind:
            'A cohort table showing premium payback under six months would change this.',
          confidence: 45,
          // 19 months matches no claim (the deck says 11) and appears in no document body, so
          // FR-025's figure-provenance question is drawn and `{figure}` is rendered from it.
          namedValues: { premium_payback_months: 19 },
        })
        await testSql`update runs set turn_due_at = now() - interval '2 seconds'
                       where id = ${fx.run.id}`
        await runs.getTurn(fx.learner, fx.run.id)
        for (const claim of await reliance.listRunClaims(fx.learner, fx.run.id)) {
          if (claim.stance === null) {
            await reliance.setStance(fx.learner, fx.run.id, claim.id, 'verify')
          }
        }
        await runs.respondToTurn(fx.learner, fx.run.id, {
          response: 'revise',
          justification:
            'The corrected retention figure is one cohort under the old pricing, so the share sized on that payback comes down.',
          confidence: 55,
        })
      }

      it('carries no forbidden key, over an interview with something in every field', async () => {
        await reachTheDefense()
        const view = await defense.openDefense(fx.learner, fx.run.id)

        // The negative control: an empty finding list must be a statement about a payload.
        expect(view.questions.length).toBeGreaterThanOrEqual(6)
        expect(view.questions.every((question) => question.text.length > 0)).toBe(true)
        expect(view.artifacts.brief?.recommendation.length).toBeGreaterThan(0)
        expect(view.artifacts.frame?.decision.length).toBeGreaterThan(0)
        expect(view.artifacts.turnResponse?.justification?.length).toBeGreaterThan(0)
        expect(view.artifacts.namedFields.length).toBeGreaterThan(0)

        expect(findForbiddenKeys(view, { scored: false })).toEqual([])
      })

      it('is a closed set of fields, and quotes no authored assessment text', async () => {
        await reachTheDefense()
        const view = await defense.openDefense(fx.learner, fx.run.id)

        expect(Object.keys(view).sort()).toEqual(['artifacts', 'questions'])
        expect(Object.keys(view.artifacts).sort()).toEqual([
          'addendum',
          'brief',
          'frame',
          'namedFields',
          'turnResponse',
        ])
        expect(Object.keys(view.questions[0] ?? {}).sort()).toEqual([
          'answer',
          'answered',
          'followUpOf',
          'kind',
          'runQuestionId',
          'seq',
          'text',
        ])

        // FR-123 and 12 §8.1: the bank's own machinery, under either spelling and at any depth.
        const keys = keysOf(view)
        for (const forbidden of [
          'questionId',
          'question_id',
          'selectingEventSeq',
          'selecting_event_seq',
          'expectedAnswerNotes',
          'condition',
          'isDefault',
          'template',
        ]) {
          expect([forbidden, keys.has(forbidden)]).toEqual([forbidden, false])
        }

        // Nor as a value under another name. The rendered questions quote the *scenario* — the
        // claim's own text, the student's own figure — and never the author's reading of it.
        const serialized = JSON.stringify(view)
        expect(serialized).not.toContain('Names the positioning deck')
        expect(serialized).not.toContain('expected answer notes for default')
        expect(serialized).not.toContain('What date does that document carry?')
        expect(serialized).not.toContain('Name the document or the number, not the feeling.')
        // And nothing about what the claim deserved or why (D-117).
        expect(serialized).not.toContain('deserved Verify')
        expect(serialized).not.toContain('stale_evidence')
      })

      it('hands the follow-up over only once the answer has earned it (FR-123)', async () => {
        await reachTheDefense()
        const view = await defense.openDefense(fx.learner, fx.run.id)
        const first = view.questions[0]
        if (!first) throw new Error('expected a question')

        const result = await defense.answerQuestion(fx.learner, fx.run.id, first.runQuestionId, {
          text: 'The assistant said so.',
          durationMs: 5_000,
        })
        expect(findForbiddenKeys(result, { scored: false })).toEqual([])
        expect(result.followUpQuestion?.text.length).toBeGreaterThan(0)
      })

      it('keeps the trace and the claim table sealed while it is open (D-279)', async () => {
        await reachTheDefense()
        await defense.openDefense(fx.learner, fx.run.id)

        await expect(trace.listEvents(fx.learner, fx.run.id)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        })
        await expect(reliance.listRunClaims(fx.learner, fx.run.id)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        })
      })
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------------------------

describe('assertNoForbiddenKeys', () => {
  const codeOf = (call: () => void): string => {
    try {
      call()
    } catch (error) {
      return isAppError(error) ? error.code : 'NOT_AN_APP_ERROR'
    }
    return 'NO_THROW'
  }

  it('refuses a leak with INTERNAL_ERROR and names the path, never the value', () => {
    const payload = { claims: [{ key: 'C3', states: { warrantedStance: 'verify' } }] }
    let thrown: unknown
    try {
      assertNoForbiddenKeys(payload, { scored: false })
    } catch (error) {
      thrown = error
    }

    expect(isAppError(thrown)).toBe(true)
    if (!isAppError(thrown)) return
    expect(thrown.code).toBe('INTERNAL_ERROR')
    expect(thrown.opts.details).toEqual({
      forbiddenKeys: [
        { key: 'warrantedStance', path: 'claims[0].states.warrantedStance', set: 'before_scored' },
      ],
    })
    expect(JSON.stringify(thrown.opts.details)).not.toContain('verify')
  })

  it('finds both spellings, however deeply they are nested', () => {
    expect(
      codeOf(() =>
        assertNoForbiddenKeys({ a: [{ b: { warranted_stance: 'x' } }] }, { scored: false }),
      ),
    ).toBe('INTERNAL_ERROR')
    expect(
      codeOf(() =>
        assertNoForbiddenKeys({ a: [{ b: { expected_answer_notes: 'x' } }] }, { scored: true }),
      ),
    ).toBe('INTERNAL_ERROR')
  })

  it('relaxes the before-scored set once the run is scored, and never the always set', () => {
    expect(
      codeOf(() => assertNoForbiddenKeys({ failureFamily: 'stale_evidence' }, { scored: false })),
    ).toBe('INTERNAL_ERROR')
    expect(
      codeOf(() => assertNoForbiddenKeys({ failureFamily: 'stale_evidence' }, { scored: true })),
    ).toBe('NO_THROW')
    expect(
      codeOf(() => assertNoForbiddenKeys({ seedText: 'the licensed case' }, { scored: true })),
    ).toBe('INTERNAL_ERROR')
  })

  it('keeps weight, mapping and points out of the record form only (FR-170)', () => {
    const debrief = { bands: [], weight: 2, mapping: { novice: 1 }, points: 4 }
    expect(codeOf(() => assertNoForbiddenKeys(debrief, { scored: true }))).toBe('NO_THROW')
    expect(codeOf(() => assertNoForbiddenKeys(debrief, { scored: true, form: 'record' }))).toBe(
      'INTERNAL_ERROR',
    )
    expect(
      findForbiddenKeys(debrief, { scored: true, form: 'record' }).map((finding) => finding.key),
    ).toEqual(['weight', 'mapping', 'points'])
  })

  it('walks a cyclic payload once instead of hanging', () => {
    const node: Record<string, unknown> = { title: 'Positioning deck' }
    node.self = node
    node.children = [node]
    expect(findForbiddenKeys(node, { scored: false })).toEqual([])
  })

  it('passes a payload that carries none of them', () => {
    expect(codeOf(() => assertNoForbiddenKeys(fx.run.id, { scored: false }))).toBe('NO_THROW')
    expect(codeOf(() => assertNoForbiddenKeys(null, { scored: false }))).toBe('NO_THROW')
  })
})

describe('the key sets themselves', () => {
  it('carry both spellings of every multi-word key and are frozen', () => {
    for (const set of [
      STUDENT_FORBIDDEN_KEYS_ALWAYS,
      STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED,
      STUDENT_FORBIDDEN_KEYS_RECORD_FORM,
    ]) {
      expect(Object.isFrozen(set)).toBe(true)
      expect(new Set(set).size).toBe(set.length)
      for (const key of set) {
        const snake = key.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`)
        expect(set, `${key} is present without its snake_case spelling`).toContain(snake)
      }
    }
  })

  it('never forbid a field the student view is built from', () => {
    const allowed = [
      'brief',
      'documents',
      'id',
      'key',
      'title',
      'author',
      'datedOn',
      'body',
      'namedFields',
      'label',
      'unit',
    ]
    const forbidden = new Set([
      ...STUDENT_FORBIDDEN_KEYS_ALWAYS,
      ...STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED,
    ])
    for (const key of allowed) expect(forbidden.has(key), `${key} is forbidden`).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The rest of the student's run (Step 13.4)
//
// Everything above is built on a version this file writes element by element, which is what lets it
// put something forbidden in every field. What it cannot do is *finish a run*: the after-scoring
// half of D-117 is defined by the run having been scored, and the reads that matter — the five
// second poll, the Delegation Log, the debrief on both sides of the confirmation, the Judgment
// Record and the file it exports — only exist on a run that has been through the pipeline.
//
// So this block works in the room the review suites work in (`../review/fixture`): the Meridian
// Roast package, a section with a student, an instructor, a TA and a classmate, and `scoredRun`,
// which drives readiness, the frame, a delegation, stances, an action, the Decision Lock, the Turn
// and the whole defense before running the scorer. Nothing is written into a state.
//
// The non-vacuity rule of this file is sharper here than anywhere else in it, because after scoring
// the before-scored set is *allowed*: `expect(findForbiddenKeys(view, { scored: true })).toEqual([])`
// would pass over an empty object, over a payload with no answer key in it, and over a debrief that
// failed to draw. Every sweep below is therefore preceded by an assertion that the payload is the
// real one and full — and the debrief sweeps additionally assert that the *same payload* is a pile
// of findings under `{ scored: false }`, which is the only way to say "this is the answer key, and
// scoring is the whole of what makes it legal to be here".
// ---------------------------------------------------------------------------------------------

type ReviewFixture = typeof import('../review/fixture')
type Assistant = typeof import('@/server/modules/assistant')
type Debrief = typeof import('@/server/modules/debrief')
type Records = typeof import('@/server/modules/records')
type Review = typeof import('@/server/modules/review')

/** The error code an AppError-throwing read answered with, or how it failed to throw one. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return isAppError(error) ? error.code : 'NOT_AN_APP_ERROR'
  }
}

describe('the reads a student makes while the run is open', () => {
  it('the run summary and the Delegation Log carry nothing authored about the run', async () => {
    const rf: ReviewFixture = await import('../review/fixture')
    const assistant: Assistant = await import('@/server/modules/assistant')
    const rx = await rf.setupAssistantFixture('student-view-open')
    const runId = await rf.runInWorking(rx)
    await runs.openDocument(rx.student, runId, rx.documentId('D5'))
    const delegationId = await rf.delegate(rx, runId, 'What is the premium payback?')

    const summary = await runs.getRun(rx.student, runId)
    const log = await assistant.listDelegations(rx.student, runId)

    // The controls. An empty log and a summary of a run that never started would pass every
    // assertion below, and the delegation is the payload most worth sweeping in the whole run: it
    // is assembled from the claims the author wrote, with their stances and their defects next to
    // them in the same table.
    expect(delegationId).not.toBe('')
    expect(log.length).toBeGreaterThan(0)
    expect(log[0]?.responseText.length).toBeGreaterThan(0)
    expect(log[0]?.claims.length).toBeGreaterThan(0)
    expect(summary.state).toBe('working')

    expect(findForbiddenKeys(summary, { scored: false })).toEqual([])
    expect(findForbiddenKeys(log, { scored: false })).toEqual([])

    // `flags` and `unverifiedNumbers` are on `DelegationViewSchema` as optional and are the
    // reviewer's half of it (12 §8.1, D-068): the guard flags a delegation carries and the figures
    // the numeric guard could not source. `flags` is forbidden by name, so the sweep above already
    // bit; `unverifiedNumbers` is not, and is the reason this line is here as well.
    expect(keysOf(log).has('flags')).toBe(false)
    expect(keysOf(log).has('unverifiedNumbers')).toBe(false)
    // D-228: which variant they drew is whether a defect was planted at all.
    for (const key of ['variantId', 'variantKey', 'variant_id', 'variant_key']) {
      expect([key, keysOf(summary).has(key)]).toEqual([key, false])
    }
  })

  it('the debrief and the record are not readable at all before the bands are drafted', async () => {
    const rf: ReviewFixture = await import('../review/fixture')
    const debriefModule: Debrief = await import('@/server/modules/debrief')
    const records: Records = await import('@/server/modules/records')
    const rx = await rf.setupAssistantFixture('student-view-early')
    const runId = await rf.runInWorking(rx)

    // Not "empty", and not "redacted": refused, with the state the caller is actually in. The two
    // reads that reveal the answer key are closed by the run's state before any projection runs.
    expect(await codeOf(debriefModule.getDebrief(rx.student, runId))).toBe('DEBRIEF_NOT_AVAILABLE')
    expect(await codeOf(records.getRecord(rx.student, runId))).toBe('RECORD_NOT_AVAILABLE')
    expect(await codeOf(records.exportRecord(rx.student, runId))).toBe('RECORD_NOT_AVAILABLE')
  })
})

describe('the reads a student makes after their run is scored', () => {
  it('the debrief reveals the answer key, and only because the run was scored (D-117)', async () => {
    const rf: ReviewFixture = await import('../review/fixture')
    const debriefModule: Debrief = await import('@/server/modules/debrief')
    const review: Review = await import('@/server/modules/review')
    const rx = await rf.setupAssistantFixture('student-view-scored')
    const runId = await rf.scoredRun(rx)

    // ---- the draft debrief (FR-150) -------------------------------------------------------
    const draft = await debriefModule.getDebrief(rx.student, runId)

    expect(draft.labels.version).toBe('draft')
    expect(draft.bands).toHaveLength(7)
    expect(draft.sections.some((section) => section.available)).toBe(true)

    // The assertion that makes the next line mean something. Under `{ scored: false }` this exact
    // payload is a pile of findings — the warranted stances, the evidence statuses, the failure
    // families, the planted flags. Scoring is the whole of what makes them legal to be here, which
    // is D-117 in one pair of expectations.
    const beforeScored = new Set(keysFound(draft, false))
    expect(beforeScored.size, 'the debrief revealed no answer key at all').toBeGreaterThan(0)
    expect([...beforeScored]).toEqual(
      expect.arrayContaining(['warrantedStance', 'evidenceStatus', 'failureFamily']),
    )

    expect(findForbiddenKeys(draft, { scored: true })).toEqual([])

    // ---- the confirmed debrief (FR-170) ---------------------------------------------------
    await review.confirmRemaining(rx.instructor, runId)
    const confirmed = await debriefModule.getDebrief(rx.student, runId)

    expect(confirmed.labels.version).toBe('confirmed')
    expect(confirmed.bands.every((band) => band.decision !== null)).toBe(true)
    expect(findForbiddenKeys(confirmed, { scored: true })).toEqual([])

    // FR-170 is why `weight`, `mapping` and `points` are a third set rather than part of the always
    // set: the debrief *does* show a student the course's arithmetic. This is the assertion that
    // says so, and the record assertion below is the one that says where it stops.
    expect(confirmed.points.mapping).toBeTruthy()
    expect(findForbiddenKeys(confirmed, { scored: true, form: 'record' }).length).toBeGreaterThan(0)

    // ---- the Judgment Record and its file (FR-170, FR-243, D-421) -------------------------
    const records: Records = await import('@/server/modules/records')
    const record = await records.getRecord(rx.student, runId)
    const file = await records.exportRecord(rx.student, runId)

    const { trace: recordTrace, ...recordOwn } = record
    expect(record.bands.length).toBe(7)
    expect(findForbiddenKeys(recordOwn, { scored: true })).toEqual([])
    // D-438: the one legitimate collision with the record-form rule, named rather than swept under.
    // `graphs.confidence_line.points` are the student's own three confidence readings; every other
    // path carrying `points`, `weight` or `mapping` at any depth would be the course's arithmetic
    // inside the artifact that leaves Tassl for the course.
    expect(
      findForbiddenKeys(recordOwn, { scored: true, form: 'record' }).map((f) => f.path),
    ).toEqual(['graphs.confidence_line.points'])

    // The trace the record embeds is the *other* documented collision, and this is the assertion
    // that it is still only that one. `owner-view.ts` classifies field by field inside a known
    // payload precisely because two payloads use one word for opposite things: `readiness_item`'s
    // `answer_key` is the option the **student** picked, never the item's key, which never enters a
    // payload at all. So the name sweep finds it, and the value is what proves which of the two it
    // is — read back from `run_readiness_answers`, which is where the student's own answers live.
    const answers = await testSql<{ item_id: string; answer_key: string | null }[]>`
      select item_id, answer_key from run_readiness_answers where run_id = ${runId}`
    const chosen = new Map(answers.map((row) => [row.item_id, row.answer_key]))

    type ReadinessEvent = {
      type: string
      payload?: { item_id?: string; answer_key?: string | null }
    }

    /**
     * Asserts a trace's only forbidden-key findings are that collision, structurally and by value.
     *
     * Structurally: every finding sits on a `readiness_item` event, the one payload
     * `owner-view.ts` classifies `answer_key` as `owner` on. By value: each one is exactly what
     * `run_readiness_answers` holds for that item — the option this student picked, or `null` where
     * they picked none (a submitted check with an item left blank writes `answer_key: null`, which
     * is the fixture's own case). An item's authored key never enters a payload at all, so a
     * finding that failed either half would be the leak this file exists to catch, reported with
     * its path.
     */
    const onlyTheReadinessCollision = (trace: unknown, what: string): void => {
      const events = (trace as { events: ReadinessEvent[] }).events
      const findings = findForbiddenKeys(trace, { scored: true })

      expect(
        findings.filter((finding) => finding.key !== 'answer_key'),
        `${what} carries something other than the readiness collision`,
      ).toEqual([])

      const readiness = events.filter((event) => event.type === 'readiness_item')
      expect(
        readiness.length,
        `${what}: no readiness_item event, so this proves nothing`,
      ).toBeGreaterThan(0)
      expect(findings.length, `${what}: the sweep and the payloads disagree`).toBe(readiness.length)

      for (const finding of findings) {
        const index = Number(/^events\[(\d+)]\.payload\.answer_key$/.exec(finding.path)?.[1] ?? -1)
        expect(events[index]?.type, `${what}: ${finding.path}`).toBe('readiness_item')
        const itemId = events[index]?.payload?.item_id ?? ''
        expect(events[index]?.payload?.answer_key ?? null, `${what}: ${finding.path}`).toBe(
          chosen.get(itemId) ?? null,
        )
      }

      // And the record form's own rule holds inside the trace too, which is the half D-421 fixed:
      // no `points`, `weight` or `mapping` at any depth, under any spelling.
      expect(
        findForbiddenKeys(trace, { scored: true, form: 'record' }).filter(
          (finding) => finding.set === 'record_form',
        ),
        `${what} carries the course's arithmetic`,
      ).toEqual([])
    }

    onlyTheReadinessCollision(recordTrace, 'the record’s embedded trace')

    expect(JSON.stringify(file).length).toBeGreaterThan(1_000)
    onlyTheReadinessCollision(file, 'the record export file')
    // And the seed record and the question bank are still out, scored or not (12 §8.1).
    for (const key of ['seedText', 'seed_text', 'expectedAnswerNotes', 'expected_answer_notes']) {
      expect([key, keysOf(file).has(key)]).toEqual([key, false])
      expect([key, keysOf(record).has(key)]).toEqual([key, false])
    }
  })
})

describe('another student’s run is not a payload at all', () => {
  it('a classmate and another institution both get NOT_FOUND, on every owner read', async () => {
    const rf: ReviewFixture = await import('../review/fixture')
    const assistant: Assistant = await import('@/server/modules/assistant')
    const records: Records = await import('@/server/modules/records')
    const rx = await rf.setupAssistantFixture('student-view-refusals')
    const runId = await rf.runInWorking(rx)

    // A student of another institution entirely. `foreign.activeOrganizationId` is their own org,
    // so the run is not merely someone else's — it is outside the tenant the actor resolves to.
    const foreignOrg = (await f.createInstitution('student-view-foreign')).organization.id
    const foreignUser = await f.createUser('student-view-foreign-student')
    await f.addMember(foreignOrg, foreignUser.id, 'student')
    const foreign = actorFor(foreignUser, foreignOrg)

    // 12 §8.3 sketches a 403 for the classmate. This build answers NOT_FOUND, deliberately and in
    // one place: `requireRunOwner` (08 §5) answers NOT_FOUND both for a run that does not exist and
    // for one belonging to another student, and every owner read that also admits a reviewer —
    // `runs.getRun`, `records.exportRecord`, `trace.listEvents` — converts the reviewer guard's
    // FORBIDDEN back to NOT_FOUND for exactly this reader. A 403 would confirm the run exists to
    // the one seat 08 §4 gives no read of it at all, which is FR-154 (D-612).
    for (const [name, reader] of [
      ['classmate', rx.classmate],
      ['another institution', foreign],
    ] as const) {
      expect([name, await codeOf(runs.getRun(reader, runId))]).toEqual([name, 'NOT_FOUND'])
      expect([name, await codeOf(runs.getRunWorkspace(reader, runId))]).toEqual([name, 'NOT_FOUND'])
      expect([name, await codeOf(reliance.listRunClaims(reader, runId))]).toEqual([
        name,
        'NOT_FOUND',
      ])
      expect([name, await codeOf(assistant.listDelegations(reader, runId))]).toEqual([
        name,
        'NOT_FOUND',
      ])
      expect([name, await codeOf(trace.listEvents(reader, runId))]).toEqual([name, 'NOT_FOUND'])
      expect([name, await codeOf(records.getRecord(reader, runId))]).toEqual([name, 'NOT_FOUND'])
      expect([name, await codeOf(records.exportRecord(reader, runId))]).toEqual([name, 'NOT_FOUND'])
    }

    // The control: the run's own student reads it, so the refusals above are about the reader.
    expect(await codeOf(runs.getRun(rx.student, runId))).toBe('NO_THROW')
    // And the section's instructor is not refused either, which is what makes NOT_FOUND above a
    // statement about a *student's* relation to the run rather than about the run being invisible.
    expect(await codeOf(runs.getRun(rx.instructor, runId))).toBe('NO_THROW')
  })
})
