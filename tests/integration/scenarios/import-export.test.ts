// Step 5.2 — the portable package document against Postgres (SYS-026;
// docs/tech/10-backend-spec-modules.md §4 `importPackage` / `exportPackage`; 07-api-spec.md §6).
//
// The claim the format makes is that export ∘ import is the identity on it: every reference between
// elements travels as an element key, so a package can leave one institution and arrive whole at
// another. That claim is only worth as much as the document it is tested with, so the document
// below is a *complete* package — every element type, every optional field filled with something
// that would be noticed if it were dropped, and both variants — and it passes `validatePackage`,
// which is what lets the `confirmOnImport` half of the test confirm the version it just read.
//
// The document is written here rather than loaded from `src/server/db/fixtures/`: the Meridian Roast
// fixture arrives in Step 5.3, and a round-trip test that depended on it would fail for reasons that
// belong to the fixture rather than to the format.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import type { PackageExport } from '@/server/modules/scenarios'

type Scenarios = typeof import('@/server/modules/scenarios')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let scenarios: Scenarios
let f: Factories

const actorFor = (
  user: UserRow,
  orgId: string,
  platformRole: SessionUser['platformRole'] = 'none',
): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole,
})

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

type Claim = PackageExport['claims'][number]
type ClaimState = PackageExport['variants'][number]['claimStates'][number]
type Question = PackageExport['defenseQuestions'][number]
type ReadinessItem = PackageExport['readinessItems'][number]

const CONCEPTS = ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification']

/** Every field spelled out, so a field the round trip drops shows up as a difference, not a default. */
const claim = (
  row: Pick<Claim, 'key' | 'text' | 'importance' | 'consequenceLevel' | 'conceptKey' | 'position'> &
    Partial<Claim>,
): Claim => ({
  sourceKind: 'assistant',
  sourceDocumentKey: null,
  sourcePassage: '',
  verificationCost: 'cheap',
  weaklySourced: false,
  volatile: false,
  carriedValues: [],
  triggerPhrases: [],
  triggerDescription: '',
  escalatable: false,
  escalationReply: null,
  rationale: '',
  ...row,
})

const state = (
  row: Pick<ClaimState, 'claimKey' | 'warrantedStance'> & Partial<ClaimState>,
): ClaimState => ({
  evidenceStatus: 'sound',
  failureFamily: null,
  planted: false,
  verificationPaths: {},
  ...row,
})

let questionCount = 0
const question = (row: Pick<Question, 'kind' | 'template'> & Partial<Question>): Question => {
  questionCount += 1
  return {
    key: `Q${questionCount}`,
    claimKey: null,
    assumptionIndex: null,
    condition: {},
    followUp: '',
    expectedAnswerNotes: 'Names the document the figure came from and its date.',
    isDefault: row.kind === 'default',
    position: questionCount - 1,
    ...row,
  }
}

const CLAIM_KEYS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const

/** One provenance and one verification question per claim, three frame assumptions, the four
 *  singles and six defaults: the bank `QUESTION_BANK_INCOMPLETE` asks for (PRD §7.12). */
function defenseQuestions(): Question[] {
  questionCount = 0
  return [
    ...CLAIM_KEYS.flatMap((key) => [
      question({
        kind: 'provenance',
        claimKey: key,
        template: 'Where does {claim_text} come from?',
      }),
      question({
        kind: 'verification',
        claimKey: key,
        template: 'What would you check to test {claim_text}?',
      }),
    ]),
    ...[0, 1, 2].map((index) =>
      question({
        kind: 'assumption',
        assumptionIndex: index,
        template: 'What happens to the decision if {assumption} is wrong?',
      }),
    ),
    question({ kind: 'confidence', template: 'How confident are you in {stance}?' }),
    question({
      kind: 'frame_vs_response',
      template: 'Did the response you locked match the frame you set?',
    }),
    question({ kind: 'counterfactual', template: 'What if {figure} were twenty percent worse?' }),
    question({ kind: 'figure_provenance', template: 'Where did the figure {figure} come from?' }),
    ...[1, 2, 3, 4, 5, 6].map((index) =>
      question({ kind: 'default', template: `Default ${index}: what did you rely on here?` }),
    ),
  ]
}

/** Sixteen items split 6 / 4 / 6, four options each, no stem echoing a claim (READINESS_SPLIT). */
function readinessItems(): ReadinessItem[] {
  const plan = [
    ['foundation', 6],
    ['defect_concept', 4],
    ['ai_behavior', 6],
  ] as const
  let items = 0
  return plan.flatMap(([category, count]) =>
    Array.from({ length: count }, (): ReadinessItem => {
      items += 1
      return {
        key: `R${items}`,
        category,
        conceptKey: CONCEPTS[items % CONCEPTS.length] ?? 'payback_period',
        stem: `Item ${items}: which measure answers this ${category.replace(/_/g, ' ')} question?`,
        options: [
          { key: 'a', text: 'The first measure.' },
          { key: 'b', text: 'The second measure.' },
          { key: 'c', text: 'The third measure.' },
          { key: 'd', text: 'The fourth measure.' },
        ],
        answerKey: 'a',
        position: items - 1,
      }
    }),
  )
}

/** The state every claim but the plant carries in both variants (D-203). */
const SHARED_STATES: ClaimState[] = [
  state({
    claimKey: 'C2',
    warrantedStance: 'verify',
    verificationPaths: {
      source_trace: {
        document_key: 'D6',
        passage: 'Cost per acquisition by channel, April.',
        dated_on: '2025-04-02',
        author: 'Finance',
      },
    },
  }),
  state({ claimKey: 'C3', warrantedStance: 'escalate' }),
  state({ claimKey: 'C4', warrantedStance: 'accept' }),
  state({ claimKey: 'C5', warrantedStance: 'accept' }),
  state({
    claimKey: 'C6',
    warrantedStance: 'verify',
    verificationPaths: {
      replication_check: { result: 'The cohort comparison reproduces 71 percent.' },
    },
  }),
]

function document(): PackageExport {
  return {
    schemaVersion: 1,
    package: {
      title: 'Meridian Roast',
      familyKey: 'meridian-roast',
      discipline: 'marketing_strategy',
    },
    version: {
      conceptSet: CONCEPTS,
      brief:
        'Meridian Roast must decide how much of next year’s marketing budget to move from the ' +
        'value tier to the premium subscription, and how fast. The board wants a number and a date.',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
      difficultyProfile: {
        estimate: 'moderate',
        note: 'Calibrate against the first cohort.',
        uncalibrated: true,
      },
      generalEscalationReply: 'A colleague reviews the claim and reports what the record supports.',
      debriefCounterfactual:
        'A twenty percent worse churn would have pushed payback past fourteen months. ' +
        'The premium shift would then have failed its own test. ' +
        'The defensible response was to hold spend in the value tier.',
    },
    seedRecord: {
      caseTitle: 'Northwind Coffee: the premium subscription',
      publisher: 'Harbour Case Press',
      licenseTerms: 'Educational adaptation permitted with attribution.',
      licensePermitsAdaptation: true,
      seedText: 'The licensed case this package was re-skinned from, in full.',
      reskinLog: [
        { kind: 'renamed_entity', from: 'Northwind Coffee', to: 'Meridian Roast', note: '' },
        { kind: 'altered_number', from: '9 months', to: '11 months', note: 'Kept the ratio.' },
        {
          kind: 'restructured_document',
          from: 'One exhibit pack',
          to: 'Six separate documents',
          note: '',
        },
      ],
    },
    documents: [
      {
        key: 'D1',
        title: 'Positioning deck',
        author: 'Priya Shah',
        datedOn: '2025-02-10',
        role: 'superseded',
        position: 0,
        body: 'The value tier carries the brand and should keep the spend it has. Premium payback lands at eleven months on the pilot cohort.',
        supersededByKey: 'D2',
        stakeholderKey: 'growth_lead',
      },
      {
        key: 'D2',
        title: 'Retention memo',
        author: 'Dana Ruiz',
        datedOn: '2025-06-01',
        role: 'supporting',
        position: 1,
        body: 'Retention in the premium cohort is measured on a rolling three-month window, and payback lands at fourteen months.',
        supersededByKey: null,
        stakeholderKey: null,
      },
      {
        key: 'D3',
        title: 'Founder note',
        author: 'Ari Meridian',
        datedOn: '2025-03-04',
        role: 'interpretation_as_fact',
        position: 2,
        body: 'The founder writes that the value tier is saturated, and states it as settled fact.',
        supersededByKey: null,
        stakeholderKey: 'finance_lead',
      },
      {
        key: 'D4',
        title: 'Green-bean supplier contract',
        author: 'Legal',
        datedOn: '2024-11-20',
        role: 'irrelevant',
        position: 3,
        body: 'The green-bean supplier contract runs to 2027 at a fixed rate. Accurate, and beside the point.',
        supersededByKey: null,
        stakeholderKey: null,
      },
      {
        key: 'D5',
        title: 'Premium pilot readout',
        author: 'Growth team',
        datedOn: '2025-05-12',
        role: 'supporting',
        position: 4,
        body: 'The premium pilot readout lists sign-ups, churn and basket size by month.',
        supersededByKey: null,
        stakeholderKey: null,
      },
      {
        key: 'D6',
        title: 'Channel cost table',
        author: 'Finance',
        datedOn: '2025-04-02',
        role: 'supporting',
        position: 5,
        body: 'Cost per acquisition for each of the four channels, as of April.',
        supersededByKey: null,
        stakeholderKey: null,
      },
    ],
    stakeholders: [
      {
        key: 'finance_lead',
        name: 'Dana Ruiz',
        roleTitle: 'Finance lead',
        positionStatement: 'Hold spend in the value tier until payback is proven.',
        incentives: 'Rewarded on gross margin, not on growth.',
        blindSpots: 'Treats the pilot cohort as representative of the whole base.',
        contradictsStakeholderKey: null,
        contradictionPoint: null,
      },
      {
        key: 'growth_lead',
        name: 'Priya Shah',
        roleTitle: 'Growth lead',
        positionStatement: 'Move a bounded share of the budget to premium now.',
        incentives: 'Rewarded on new-tier revenue.',
        blindSpots: 'Reads the pilot retention number as settled.',
        contradictsStakeholderKey: 'finance_lead',
        contradictionPoint: 'Whether the value tier can absorb another price rise.',
      },
    ],
    answerSpacePositions: [
      {
        key: 'hold_value_tier',
        kind: 'defensible',
        summary: 'Hold spend in the value tier and re-test premium next quarter.',
        ignoredEvidence: null,
        isMinimumCommitment: true,
        position: 0,
        supportingDocumentKeys: ['D2'],
      },
      {
        key: 'shift_bounded_share',
        kind: 'defensible',
        summary: 'Move a bounded share of the budget to premium, with a stated review date.',
        ignoredEvidence: null,
        isMinimumCommitment: false,
        position: 1,
        supportingDocumentKeys: ['D5', 'D2'],
      },
      {
        key: 'move_sixty_percent',
        kind: 'evidence_inconsistent',
        summary: 'Move sixty percent of the budget on the eleven-month payback.',
        ignoredEvidence: 'The eleven-month payback rests on a deck the retention memo supersedes.',
        isMinimumCommitment: false,
        position: 2,
        supportingDocumentKeys: ['D1'],
      },
    ],
    namedFields: [
      {
        key: 'budget_share_to_premium',
        label: 'Budget share to premium',
        unit: 'percent',
        position: 0,
      },
      { key: 'premium_payback_months', label: 'Premium payback', unit: 'months', position: 1 },
    ],
    claims: [
      claim({
        key: 'C1',
        text: 'Premium payback lands at eleven months on the pilot cohort.',
        importance: 'load_bearing',
        consequenceLevel: 'high',
        conceptKey: 'payback_period',
        position: 0,
        sourceKind: 'document',
        sourceDocumentKey: 'D1',
        sourcePassage: 'Premium payback lands at eleven months on the pilot cohort.',
        volatile: true,
        carriedValues: [{ field_key: 'premium_payback_months', value: 11, unit: 'months' }],
        triggerPhrases: ['payback', 'eleven months'],
        triggerDescription: 'The assistant states the payback period as settled.',
        rationale: 'The deck it rests on is superseded by the retention memo.',
      }),
      claim({
        key: 'C2',
        text: 'The channel cost table still reflects the terms in force today.',
        importance: 'supporting',
        consequenceLevel: 'medium',
        conceptKey: 'segmentation',
        position: 1,
        sourceDocumentKey: 'D6',
        weaklySourced: true,
        verificationCost: 'moderate',
      }),
      claim({
        key: 'C3',
        text: 'The survey behind the saturation estimate carries a wide margin of error.',
        importance: 'supporting',
        consequenceLevel: 'medium',
        conceptKey: 'ai_verification',
        position: 2,
        escalatable: true,
        escalationReply: 'A colleague confirms the survey ran on 140 respondents in one district.',
      }),
      claim({
        key: 'C4',
        text: 'Footfall in the north district rose slightly last spring.',
        importance: 'supporting',
        consequenceLevel: 'low',
        conceptKey: 'segmentation',
        position: 3,
      }),
      claim({
        key: 'C5',
        text: 'The roastery added a second grinder over the summer.',
        importance: 'supporting',
        consequenceLevel: 'low',
        conceptKey: 'segmentation',
        position: 4,
      }),
      claim({
        key: 'C6',
        text: 'Retention holds above seventy percent after the third month.',
        importance: 'load_bearing',
        consequenceLevel: 'high',
        conceptKey: 'retention_cohorts',
        position: 5,
        verificationCost: 'expensive',
      }),
    ],
    variants: [
      {
        key: 'defective',
        label: 'Defective',
        claimStates: [
          state({
            claimKey: 'C1',
            evidenceStatus: 'defective',
            failureFamily: 'stale_evidence',
            warrantedStance: 'challenge',
            planted: true,
            verificationPaths: {
              source_trace: {
                document_key: 'D1',
                passage: 'Premium payback lands at eleven months on the pilot cohort.',
                dated_on: '2025-02-10',
                author: 'Priya Shah',
              },
            },
          }),
          ...SHARED_STATES,
        ],
      },
      {
        key: 'sound',
        label: 'Sound',
        claimStates: [
          state({
            claimKey: 'C1',
            warrantedStance: 'accept',
            verificationPaths: {
              source_trace: {
                document_key: 'D2',
                passage: 'Payback on the premium tier is fourteen months.',
                dated_on: '2025-06-01',
                author: 'Dana Ruiz',
              },
              decomposition_check: {
                steps: [
                  { label: 'Acquisition cost', result: 'Unchanged at 38 currency units.' },
                  { label: 'Monthly margin', result: 'Two point seven currency units.' },
                ],
              },
            },
          }),
          ...SHARED_STATES,
        ],
      },
    ],
    probe: {
      claimKey: 'C2',
      originalPosition: 'The channel cost table still reflects the terms in force today.',
      scriptedReversal: 'You are right to push back — the table is a quarter out of date.',
    },
    turn: {
      text: 'Month-three retention in the premium pilot is 61 percent, not 78.',
      voice: 'stakeholder_message',
      warrantsChange: true,
      proportionateResponse: 'revise',
      evidence: 'The corrected cohort table from the pilot dashboard.',
      disruptedAssumptionKeys: ['premium_payback_months'],
      stakeholderKey: 'growth_lead',
      windowClaimKeys: ['C1', 'C6'],
    },
    defenseQuestions: defenseQuestions(),
    readinessItems: readinessItems(),
  }
}

/**
 * Every element of the document: 1 brief + 6 documents + 2 stakeholders + 3 positions + 2 named
 * fields + 6 claims + 12 claim states + probe + Turn + 25 questions + 16 readiness items +
 * counterfactual + escalation reply + clock + seed record.
 */
const ELEMENT_COUNT = 79

// ---------------------------------------------------------------------------------------------
// Comparing two documents
//
// Storage order is not part of the format: a claim state has no position column and the relational
// read returns whatever order the rows come back in. So both sides are sorted by the keys the
// document itself uses before they are compared, and the comparison is total — every collection,
// every field, not a spot check.
// ---------------------------------------------------------------------------------------------

const byKey = <T extends { key: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.key.localeCompare(b.key))

function normalize(pkg: PackageExport): PackageExport {
  return {
    ...pkg,
    documents: byKey(pkg.documents),
    stakeholders: byKey(pkg.stakeholders),
    answerSpacePositions: byKey(pkg.answerSpacePositions),
    namedFields: byKey(pkg.namedFields),
    claims: byKey(pkg.claims),
    variants: byKey(pkg.variants).map((variant) => ({
      ...variant,
      claimStates: [...variant.claimStates].sort((a, b) => a.claimKey.localeCompare(b.claimKey)),
    })),
    defenseQuestions: byKey(pkg.defenseQuestions),
    readinessItems: byKey(pkg.readinessItems),
  }
}

/** The element keys of a document, collection by collection. */
function elementKeys(pkg: PackageExport): Record<string, string[]> {
  return {
    documents: byKey(pkg.documents).map((row) => row.key),
    stakeholders: byKey(pkg.stakeholders).map((row) => row.key),
    answerSpacePositions: byKey(pkg.answerSpacePositions).map((row) => row.key),
    namedFields: byKey(pkg.namedFields).map((row) => row.key),
    claims: byKey(pkg.claims).map((row) => row.key),
    variants: byKey(pkg.variants).flatMap((variant) =>
      [...variant.claimStates].map((row) => `${variant.key}:${row.claimKey}`).sort(),
    ),
    defenseQuestions: byKey(pkg.defenseQuestions).map((row) => row.key),
    readinessItems: byKey(pkg.readinessItems).map((row) => row.key),
  }
}

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

async function setup() {
  const orgId = (await f.createInstitution('import-export')).organization.id
  const instructor = await f.createUser('import-export-instructor')
  await f.addMember(orgId, instructor.id, 'instructor')
  // A reviewer of the same institution: admitted to the package (08 §4) and never to the licensed
  // case behind it (FR-028), which is what the seed-record rows below are about.
  const ta = await f.createUser('import-export-ta')
  await f.addMember(orgId, ta.id, 'teaching_assistant')
  return {
    orgId,
    instructor,
    ta,
    author: actorFor(instructor, orgId),
    reviewer: actorFor(ta, orgId),
  }
}

/** The same document under another family key: an institution holds one package per key. */
function documentKeyed(familyKey: string): PackageExport {
  const sent = document()
  return { ...sent, package: { ...sent.package, familyKey } }
}

type Fixture = Awaited<ReturnType<typeof setup>>

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  scenarios ??= await import('@/server/modules/scenarios')
  f ??= await import('@tests/factories')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

/** The `AppError` a call was refused with; a call that succeeds fails the test. */
async function refusal(call: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await call
  } catch (error) {
    if (!isAppError(error)) throw error
    return { code: error.code, details: error.opts.details }
  }
  throw new Error('expected the call to be refused')
}

// ---------------------------------------------------------------------------------------------
// The round trip (SYS-026)
// ---------------------------------------------------------------------------------------------

describe('importPackage then exportPackage', () => {
  it('returns the document it was given, element for element and field for field', async () => {
    const sent = document()
    const imported = await scenarios.importPackage(fx.author, fx.orgId, sent)
    expect(imported.validation).toEqual({ ok: true, failures: [] })

    const exported = await scenarios.exportPackage(fx.author, imported.versionId)

    // The keys first, so a lost element is reported as a missing key rather than as a wall of diff.
    expect(elementKeys(exported)).toEqual(elementKeys(sent))
    // Then the whole document: nothing added, nothing dropped, nothing rewritten.
    expect(normalize(exported)).toEqual(normalize(sent))

    // The references really were resolved through the database and back, not copied across.
    const stored = await scenarios.getPackageVersion(fx.author, imported.versionId)
    expect(stored).toMatchObject({
      packageId: imported.packageId,
      packageTitle: 'Meridian Roast',
      familyKey: 'meridian-roast',
      version: 1,
      // An import arrives as a draft: the receiving institution confirms it for itself (FR-192).
      status: 'draft',
      // D-205: calibration is field evidence about one cohort, so it does not travel.
      calibrationStatus: 'uncalibrated',
      counts: {
        documents: 6,
        stakeholders: 2,
        answerSpacePositions: 3,
        namedFields: 2,
        claims: 6,
        variants: 2,
        defenseQuestions: 25,
        readinessItems: 16,
      },
    })
    expect(stored.confirmationRecord).toEqual([])
  })

  it('survives a second trip through another institution', async () => {
    const sent = document()
    const first = await scenarios.importPackage(fx.author, fx.orgId, sent)
    const once = await scenarios.exportPackage(fx.author, first.versionId)

    const otherOrgId = (await f.createInstitution('import-export-two')).organization.id
    const author = await f.createUser('import-export-author')
    await f.addMember(otherOrgId, author.id, 'scenario_author')
    const second = await scenarios.importPackage(actorFor(author, otherOrgId), otherOrgId, once)
    const twice = await scenarios.exportPackage(actorFor(author, otherOrgId), second.versionId)

    expect(normalize(twice)).toEqual(normalize(sent))
    // The two institutions hold two packages; the document carries no ids that could collide.
    expect(second.packageId).not.toBe(first.packageId)
  })
})

// ---------------------------------------------------------------------------------------------
// The seed record does not travel to a reviewer (FR-028, 08 §4)
//
// `exportPackage` admits a TA — they may read the package their section runs — and the seed record
// is the one thing inside the document they may not read: it is the licensed case the package was
// re-skinned from. The export has two paths to the document and both have to withhold it, which is
// what these two tests separate: a draft is rebuilt from its rows, and a confirmed version answers
// from the snapshot frozen with it, where the record is already sitting in the stored JSON.
// ---------------------------------------------------------------------------------------------

describe('exportPackage withholds the seed record from a teaching assistant', () => {
  it('on the row-built path of a draft, while the author takes the whole record', async () => {
    const sent = document()
    const imported = await scenarios.importPackage(fx.author, fx.orgId, sent)

    // The control: the record really is stored, so `null` below is a refusal and not an absence.
    const asAuthor = await scenarios.exportPackage(fx.author, imported.versionId)
    expect(asAuthor.seedRecord).toEqual(sent.seedRecord)

    const asReviewer = await scenarios.exportPackage(fx.reviewer, imported.versionId)
    expect(asReviewer.seedRecord).toBeNull()
    // And nothing else was withheld: the reviewer's copy is the package, minus the licensed case.
    expect(normalize({ ...asReviewer, seedRecord: sent.seedRecord })).toEqual(normalize(sent))
  })

  it('on the snapshot path of a confirmed version', async () => {
    const sent = document()
    const imported = await scenarios.importPackage(fx.author, fx.orgId, {
      ...sent,
      confirmOnImport: true,
    })
    const confirmed = await scenarios.confirmVersion(fx.author, imported.versionId, {
      teachingNoteChecked: true,
    })
    expect(confirmed.status).toBe('confirmed')

    // The control for "snapshot path": the frozen JSON exists and carries the record, so an export
    // that read it straight out would hand the reviewer the case.
    const [row] = await testSql<{ seed_title: string | null }[]>`
      select snapshot -> 'seedRecord' ->> 'caseTitle' as seed_title
      from scenario_package_versions where id = ${imported.versionId}`
    expect(row?.seed_title).toBe(sent.seedRecord?.caseTitle)

    const asReviewer = await scenarios.exportPackage(fx.reviewer, imported.versionId)
    expect(asReviewer.seedRecord).toBeNull()
    expect(normalize({ ...asReviewer, seedRecord: sent.seedRecord })).toEqual(normalize(sent))

    const asAuthor = await scenarios.exportPackage(fx.author, imported.versionId)
    expect(asAuthor.seedRecord).toEqual(sent.seedRecord)
  })
})

// ---------------------------------------------------------------------------------------------
// confirmOnImport (06 §5, the seed path)
// ---------------------------------------------------------------------------------------------

describe('importPackage with confirmOnImport', () => {
  it('leaves every element confirmed by the importing actor', async () => {
    const imported = await scenarios.importPackage(fx.author, fx.orgId, {
      ...document(),
      confirmOnImport: true,
    })

    const view = await scenarios.getPackageVersion(fx.author, imported.versionId)
    expect(view.confirmationRecord).toHaveLength(ELEMENT_COUNT)
    for (const row of view.confirmationRecord) {
      expect(row).toMatchObject({
        decision: 'confirmed',
        revision: 1,
        decidedBy: fx.instructor.id,
        note: '',
      })
    }
    // The singletons are filed under a null element id (06 §3.3), one row each.
    expect(
      view.confirmationRecord
        .filter((row) => row.elementId === null)
        .map((row) => row.elementType)
        .sort(),
    ).toEqual([
      'brief',
      'clock_and_difficulty',
      'counterfactual',
      'general_escalation_reply',
      'probe',
      'seed_reskin',
      'turn',
    ])

    // Which is the whole point of the flag: the version can go straight on to be confirmed.
    const confirmed = await scenarios.confirmVersion(fx.author, imported.versionId, {
      teachingNoteChecked: true,
    })
    expect(confirmed.status).toBe('confirmed')

    // A confirmed version exports its snapshot, and the snapshot is the same document (SYS-026).
    const exported = await scenarios.exportPackage(fx.author, imported.versionId)
    expect(normalize(exported)).toEqual(normalize(document()))
  })

  it('confirms nothing when the flag is absent', async () => {
    const imported = await scenarios.importPackage(fx.author, fx.orgId, document())
    const view = await scenarios.getPackageVersion(fx.author, imported.versionId)
    expect(view.confirmationRecord).toEqual([])
    await expect(
      scenarios.confirmVersion(fx.author, imported.versionId, { teachingNoteChecked: true }),
    ).rejects.toMatchObject({ code: 'ELEMENTS_UNCONFIRMED' })
  })

  /**
   * 08 §4 and PRD §8: a platform editor reaches an institution's packages through a
   * `scenario_author` membership, and that membership is enough to import. It is not enough to sign
   * for the package: `confirmOnImport` files a confirmation for every element in the actor's name,
   * which is the act `decideElement` and `confirmVersion` already reserve for the institution's own
   * authority. Without the check one request signs for all seventy-nine and skips the review FR-192
   * exists to require.
   */
  it('refuses the flag to a platform editor, who may still import, and admits the instructor', async () => {
    const editorUser = await f.createUser('import-export-editor', {
      platformRole: 'tassl_scenario_editor',
    })
    await f.addMember(fx.orgId, editorUser.id, 'scenario_author')
    const editor = actorFor(editorUser, fx.orgId, 'tassl_scenario_editor')

    // The editor's membership admits the import itself (08 §5).
    const plain = await scenarios.importPackage(
      editor,
      fx.orgId,
      documentKeyed('meridian-roast-editor'),
    )
    expect(plain.validation).toEqual({ ok: true, failures: [] })
    const before = await scenarios.listPackages(fx.author, fx.orgId)
    expect(before.items.map((row) => row.familyKey)).toEqual(['meridian-roast-editor'])

    const refused = await refusal(
      scenarios.importPackage(editor, fx.orgId, {
        ...documentKeyed('meridian-roast-signed'),
        confirmOnImport: true,
      }),
    )
    expect(refused.code).toBe('FORBIDDEN')

    // The refusal wrote nothing: the shelf is what it was, and the family key is still free.
    const after = await scenarios.listPackages(fx.author, fx.orgId)
    expect(after.items.map((row) => row.familyKey)).toEqual(['meridian-roast-editor'])

    // The institution's own instructor signs for the same document, one confirmed row per element.
    const signed = await scenarios.importPackage(fx.author, fx.orgId, {
      ...documentKeyed('meridian-roast-signed'),
      confirmOnImport: true,
    })
    const view = await scenarios.getPackageVersion(fx.author, signed.versionId)
    expect(view.confirmationRecord).toHaveLength(ELEMENT_COUNT)
    expect(new Set(view.confirmationRecord.map((row) => row.decision))).toEqual(
      new Set(['confirmed']),
    )
    expect(new Set(view.confirmationRecord.map((row) => row.decidedBy))).toEqual(
      new Set([fx.instructor.id]),
    )
  })

  /**
   * A refused `confirmOnImport` has to leave the shelf as it found it. The refusal used to arrive
   * after the commit, so the invalid package stayed, the family key stayed taken, and the corrected
   * re-run answered `CONFLICT` about a fault that no longer existed — a dead end with no way out
   * but a delete the API does not offer. The re-import at the end is the point of this test.
   */
  it('leaves nothing on the shelf when the package is invalid, so the corrected re-run succeeds', async () => {
    const broken = documentKeyed('meridian-roast')
    const refused = await refusal(
      scenarios.importPackage(fx.author, fx.orgId, {
        ...broken,
        version: { ...broken.version, brief: '' },
        confirmOnImport: true,
      }),
    )
    expect(refused.code).toBe('PACKAGE_INVALID')
    expect(refused.details).toMatchObject({ rules: expect.arrayContaining(['BRIEF_TOO_LONG']) })

    const listed = await scenarios.listPackages(fx.author, fx.orgId)
    expect(listed.items).toEqual([])

    const corrected = await scenarios.importPackage(fx.author, fx.orgId, {
      ...documentKeyed('meridian-roast'),
      confirmOnImport: true,
    })
    const view = await scenarios.getPackageVersion(fx.author, corrected.versionId)
    expect(view.confirmationRecord).toHaveLength(ELEMENT_COUNT)
    expect(view.familyKey).toBe('meridian-roast')
  })
})

// ---------------------------------------------------------------------------------------------
// A document that is not a package export
// ---------------------------------------------------------------------------------------------

describe('importPackage refuses a malformed document', () => {
  it('refuses a document that is not a package export at all', async () => {
    const refused = await refusal(scenarios.importPackage(fx.author, fx.orgId, { hello: 'world' }))
    expect(refused.code).toBe('IMPORT_INVALID')
    expect(refused.details).toMatchObject({ issues: expect.any(Array) })
  })

  it('refuses an export format it does not know', async () => {
    // The version is bumped when a field is removed or its meaning changes; a reader that met a
    // version it does not know would be guessing.
    const refused = await refusal(
      scenarios.importPackage(fx.author, fx.orgId, { ...document(), schemaVersion: 2 }),
    )
    expect(refused.code).toBe('IMPORT_INVALID')
  })

  it('refuses a document whose element is missing a required field', async () => {
    const sent = document()
    const refused = await refusal(
      scenarios.importPackage(fx.author, fx.orgId, {
        ...sent,
        // A defective state that names no failure family: the database check the element schema
        // mirrors (D-206).
        variants: sent.variants.map((variant) => ({
          ...variant,
          claimStates: variant.claimStates.map((row) =>
            row.planted ? { ...row, failureFamily: null } : row,
          ),
        })),
      }),
    )
    expect(refused.code).toBe('IMPORT_INVALID')
  })

  it('refuses a reference to an element the document does not define, and writes nothing', async () => {
    const sent = document()
    const refused = await refusal(
      scenarios.importPackage(fx.author, fx.orgId, {
        ...sent,
        claims: sent.claims.map((row) =>
          row.key === 'C1' ? { ...row, sourceDocumentKey: 'D9' } : row,
        ),
      }),
    )
    expect(refused.code).toBe('IMPORT_INVALID')
    expect(refused.details).toEqual({ reference: 'document', key: 'D9' })

    // The refusal is a rollback, not a half-written package: the shelf is still empty.
    const listed = await scenarios.listPackages(fx.author, fx.orgId)
    expect(listed.items).toEqual([])
  })

  /**
   * Element keys are unique inside a version (06 §3.3) and the import writes elements by upsert on
   * `(package_version_id, key)`, so a repeated key used to overwrite quietly: sixteen readiness
   * items went in and fifteen came out, and the reader was told the bank was the wrong size rather
   * than that the document repeats a name. The refusal belongs to the parse, and the issues it
   * carries name the collection and the row.
   */
  describe('refuses a document that repeats an element key', () => {
    const repeatKeyAt = <T extends { key: string }>(rows: readonly T[]): T[] => {
      const [first, second, ...rest] = rows
      if (!first || !second) throw new Error('the collection needs two rows to repeat one key')
      return [first, { ...second, key: first.key }, ...rest]
    }

    const cases = [
      [
        'readinessItems',
        (sent: PackageExport) => ({ readinessItems: repeatKeyAt(sent.readinessItems) }),
      ],
      ['documents', (sent: PackageExport) => ({ documents: repeatKeyAt(sent.documents) })],
      ['claims', (sent: PackageExport) => ({ claims: repeatKeyAt(sent.claims) })],
    ] as const

    for (const [collection, repeat] of cases) {
      it(`refuses two ${collection} sharing one key`, async () => {
        const sent = document()
        const refused = await refusal(
          scenarios.importPackage(fx.author, fx.orgId, { ...sent, ...repeat(sent) }),
        )

        expect(refused.code).toBe('IMPORT_INVALID')
        // The issues, not `{ reference, key }`: this is the document contradicting itself, which the
        // parse catches, and not a key that names nothing, which the writer catches later.
        const issues = (refused.details as { issues?: { path: unknown[]; message: string }[] })
          .issues
        expect(issues).toBeDefined()
        expect(
          issues?.some(
            (issue) => issue.path[0] === collection && /share the key/.test(issue.message),
          ),
          `no duplicate-key issue for ${collection} in ${JSON.stringify(issues)}`,
        ).toBe(true)

        const listed = await scenarios.listPackages(fx.author, fx.orgId)
        expect(listed.items).toEqual([])
      })
    }
  })

  it('refuses documents that supersede each other, naming the cycle', async () => {
    const sent = document()
    const refused = await refusal(
      scenarios.importPackage(fx.author, fx.orgId, {
        ...sent,
        documents: [
          ...sent.documents,
          {
            key: 'D7',
            title: 'First circular memo',
            author: 'Nobody',
            datedOn: '2025-07-01',
            role: 'superseded',
            position: 6,
            body: 'This memo is superseded by the second, which is superseded by this one.',
            supersededByKey: 'D8',
            stakeholderKey: null,
          },
          {
            key: 'D8',
            title: 'Second circular memo',
            author: 'Nobody',
            datedOn: '2025-07-02',
            role: 'superseded',
            position: 7,
            body: 'This memo is superseded by the first, which is superseded by this one.',
            supersededByKey: 'D7',
            stakeholderKey: null,
          },
        ],
      }),
    )
    expect(refused.code).toBe('IMPORT_INVALID')
    expect(refused.details).toEqual({ reference: 'document', cycle: ['D7', 'D8'] })

    const listed = await scenarios.listPackages(fx.author, fx.orgId)
    expect(listed.items).toEqual([])
  })
})
