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
// This file is the package half of the invariant. Phase 6 adds the workspace projection and Phase
// 13 completes it with the run summary, claims, delegations, defense, debrief and record export
// (build-plan phase-13 §13.4), including the after-scoring reveal and the 403/404 rows.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { countWords } from '@/lib/words'
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

let f: Factories
let repo: ScenariosRepo
let runsRepo: RunsRepo

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
      verificationPaths: {},
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
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

const keysFound = (payload: unknown, scored: boolean): string[] =>
  findForbiddenKeys(payload, { scored }).map((finding) => finding.key)

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
