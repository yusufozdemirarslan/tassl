// Step 5.1 — `validatePackage` (docs/tech/10-backend-spec-modules.md §4, the rule table).
//
// The shape of this file follows the shape of the rule: `validVersion()` returns a package that
// breaks nothing, and every test mutates exactly one thing in it. A failing test therefore names one
// rule and nothing else, and — where the rules do not overlap — asserts the *whole* code list, so a
// rule that starts firing on a package it should not is caught here rather than by an author.
//
// Two rule pairs overlap by construction and the tests say so out loud: `DEFECT_OUTSIDE_CONCEPTS` is
// `CLAIM_CONCEPT_UNKNOWN` narrowed to the planted claim, so a defect outside the concept set trips
// both.
import { describe, expect, it } from 'vitest'
import type { VersionFull } from '@/server/modules/scenarios/repository'
import type { ValidationResult } from '@/server/modules/scenarios/schema'
import {
  READINESS_ITEMS_PER_CONCEPT_MIN,
  VALIDATION_RULE_CODES,
  thinlyCarriedConcepts,
  validatePackage,
  type PackageValidationFailure,
  type PackageValidationResult,
  type ValidatedClaim,
  type ValidatedClaimState,
  type ValidatedDocument,
  type ValidatedReadinessItem,
  type ValidatedVariant,
  type ValidatedVersion,
} from '@/server/modules/scenarios/validate'

// ---------------------------------------------------------------------------------------------
// The valid package
// ---------------------------------------------------------------------------------------------

const CONCEPTS = ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification']

/** Three sentences, which is what `COUNTERFACTUAL_SENTENCES` asks for. */
const COUNTERFACTUAL =
  'A twenty percent worse churn would have pushed payback past fourteen months. ' +
  'The premium shift would then have failed its own test. ' +
  'The defensible response was to hold spend in the value tier.'

/** `n` words of filler, for the two rules that count them. */
function words(n: number): string {
  return Array.from({ length: n }, (_unused, index) => `w${index}`).join(' ')
}

function documents(): ValidatedDocument[] {
  return [
    {
      id: 'doc-1',
      key: 'D1',
      body: 'The value tier carries the brand and should keep the spend it has.',
      role: 'superseded',
      datedOn: '2025-02-10',
      supersededByDocumentId: 'doc-2',
      stakeholderId: 'sh-1',
    },
    {
      id: 'doc-2',
      key: 'D2',
      body: 'Retention in the premium cohort is measured on a rolling three-month window.',
      role: 'supporting',
      datedOn: '2025-06-01',
      supersededByDocumentId: null,
      stakeholderId: null,
    },
    {
      id: 'doc-3',
      key: 'D3',
      body: 'The founder writes that the value tier is saturated, stated as settled fact.',
      role: 'interpretation_as_fact',
      datedOn: '2025-03-04',
      supersededByDocumentId: null,
      stakeholderId: 'sh-2',
    },
    {
      id: 'doc-4',
      key: 'D4',
      body: 'The green-bean supplier contract runs to 2027 and is accurate but beside the point.',
      role: 'irrelevant',
      datedOn: '2024-11-20',
      supersededByDocumentId: null,
      stakeholderId: null,
    },
    {
      id: 'doc-5',
      key: 'D5',
      body: 'The premium pilot readout lists sign-ups, churn, and basket size by month.',
      role: 'supporting',
      datedOn: '2025-05-12',
      supersededByDocumentId: null,
      stakeholderId: null,
    },
    {
      id: 'doc-6',
      key: 'D6',
      body: 'The channel cost table gives cost per acquisition for each of the four channels.',
      role: 'supporting',
      datedOn: '2025-04-02',
      supersededByDocumentId: null,
      stakeholderId: null,
    },
  ]
}

function claims(): ValidatedClaim[] {
  return [
    {
      id: 'claim-1',
      key: 'C1',
      text: 'Premium payback lands at eleven months on the pilot cohort.',
      importance: 'load_bearing',
      consequenceLevel: 'high',
      conceptKey: 'payback_period',
      weaklySourced: false,
      volatile: false,
      escalatable: false,
      escalationReply: null,
    },
    {
      id: 'claim-2',
      key: 'C2',
      text: 'The channel cost table still reflects the terms in force today.',
      importance: 'supporting',
      consequenceLevel: 'medium',
      conceptKey: 'segmentation',
      weaklySourced: true,
      volatile: false,
      escalatable: false,
      escalationReply: null,
    },
    {
      id: 'claim-3',
      key: 'C3',
      text: 'The survey behind the saturation estimate carries a wide margin of error.',
      importance: 'supporting',
      consequenceLevel: 'medium',
      conceptKey: 'ai_verification',
      weaklySourced: false,
      volatile: false,
      escalatable: true,
      escalationReply: 'A colleague confirms the survey ran on 140 respondents in one district.',
    },
    {
      id: 'claim-4',
      key: 'C4',
      text: 'Footfall in the north district rose slightly last spring.',
      importance: 'supporting',
      consequenceLevel: 'low',
      conceptKey: 'segmentation',
      weaklySourced: false,
      volatile: false,
      escalatable: false,
      escalationReply: null,
    },
    {
      id: 'claim-5',
      key: 'C5',
      text: 'The roastery added a second grinder over the summer.',
      importance: 'supporting',
      consequenceLevel: 'low',
      conceptKey: 'segmentation',
      weaklySourced: false,
      volatile: false,
      escalatable: false,
      escalationReply: null,
    },
    {
      id: 'claim-6',
      key: 'C6',
      text: 'Retention holds above seventy percent after the third month.',
      importance: 'load_bearing',
      consequenceLevel: 'high',
      conceptKey: 'retention_cohorts',
      weaklySourced: false,
      volatile: false,
      escalatable: false,
      escalationReply: null,
    },
  ]
}

function defectiveStates(): ValidatedClaimState[] {
  return [
    {
      id: 'state-d-1',
      claimId: 'claim-1',
      evidenceStatus: 'defective',
      failureFamily: 'stale_evidence',
      warrantedStance: 'challenge',
      verificationPaths: {
        source_trace: {
          document_id: 'doc-1',
          passage: 'Payback on the premium tier is eleven months.',
          dated_on: '2025-02-10',
          author: 'Growth team',
        },
      },
      planted: true,
    },
    {
      id: 'state-d-2',
      claimId: 'claim-2',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'verify',
      verificationPaths: {
        source_trace: {
          document_id: 'doc-6',
          passage: 'Cost per acquisition by channel, April.',
          dated_on: '2025-04-02',
          author: 'Finance',
        },
      },
      planted: false,
    },
    {
      id: 'state-d-3',
      claimId: 'claim-3',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'escalate',
      verificationPaths: {},
      planted: false,
    },
    {
      id: 'state-d-4',
      claimId: 'claim-4',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      verificationPaths: {},
      planted: false,
    },
    {
      id: 'state-d-5',
      claimId: 'claim-5',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      verificationPaths: {},
      planted: false,
    },
    {
      id: 'state-d-6',
      claimId: 'claim-6',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'verify',
      verificationPaths: { replication_check: { result: 'The cohort comparison reproduces 71%.' } },
      planted: false,
    },
  ]
}

/** The sound variant differs from the defective one only in the planted claim (PRD §7.18 (9)). */
function soundStates(): ValidatedClaimState[] {
  return defectiveStates().map((state) =>
    state.claimId === 'claim-1'
      ? {
          ...state,
          id: 'state-s-1',
          evidenceStatus: 'sound',
          failureFamily: null,
          warrantedStance: 'accept',
          verificationPaths: {
            source_trace: {
              document_id: 'doc-2',
              passage: 'Payback on the premium tier is fourteen months.',
              dated_on: '2025-06-01',
              author: 'Finance',
            },
          },
          planted: false,
        }
      : { ...state, id: state.id.replace('state-d-', 'state-s-') },
  )
}

function variants(): ValidatedVariant[] {
  return [
    { key: 'defective', claimStates: defectiveStates() },
    { key: 'sound', claimStates: soundStates() },
  ]
}

function defenseQuestions(): ValidatedVersion['defenseQuestions'] {
  return [
    ...claims().flatMap((claim) => [
      {
        kind: 'provenance',
        claimId: claim.id,
        assumptionIndex: null,
        template: 'Where does {claim_text} come from?',
      },
      {
        kind: 'verification',
        claimId: claim.id,
        assumptionIndex: null,
        template: 'What would you check to test {claim_text}?',
      },
    ]),
    ...[0, 1, 2].map((index) => ({
      kind: 'assumption',
      claimId: null,
      assumptionIndex: index,
      template: 'What happens to the decision if {assumption} is wrong?',
    })),
    {
      kind: 'confidence',
      claimId: null,
      assumptionIndex: null,
      template: 'How confident are you in {stance}?',
    },
    {
      kind: 'frame_vs_response',
      claimId: null,
      assumptionIndex: null,
      template: 'Did the response you locked match the frame you set?',
    },
    {
      kind: 'counterfactual',
      claimId: null,
      assumptionIndex: null,
      template: 'What if {figure} were twenty percent worse?',
    },
    {
      kind: 'figure_provenance',
      claimId: null,
      assumptionIndex: null,
      template: 'Where did the figure {figure} come from?',
    },
    ...Array.from({ length: 6 }, (_unused, index) => ({
      kind: 'default',
      claimId: null,
      assumptionIndex: null,
      template: `Default question ${index + 1}: what did you rely on here?`,
    })),
  ]
}

const READINESS_PLAN = [
  ['foundation', 6],
  ['defect_concept', 4],
  ['ai_behavior', 6],
] as const

function readinessItems(): ValidatedReadinessItem[] {
  let counter = 0
  return READINESS_PLAN.flatMap(([category, count]) =>
    Array.from({ length: count }, () => {
      counter += 1
      return {
        id: `item-${counter}`,
        key: `R${counter}`,
        category,
        stem: `Item ${counter}: which measure answers this ${category.replace(/_/g, ' ')} question?`,
        options: [
          { key: 'a', text: 'The first measure.' },
          { key: 'b', text: 'The second measure.' },
          { key: 'c', text: 'The third measure.' },
          { key: 'd', text: 'The fourth measure.' },
        ],
        answerKey: 'a',
      }
    }),
  )
}

/** A package that breaks no rule; every test mutates one thing in a fresh copy of it. */
function validVersion(): ValidatedVersion {
  return {
    conceptSet: [...CONCEPTS],
    brief:
      'Meridian Roast must decide how much of next year’s marketing budget to move from the ' +
      'value tier to the premium subscription, and how fast. The board wants a number and a date.',
    turnDelaySeconds: 90,
    generalEscalationReply: 'A colleague reviews the claim and reports what the record supports.',
    debriefCounterfactual: COUNTERFACTUAL,
    seedRecord: {
      reskinLog: [
        { kind: 'renamed_entity' },
        { kind: 'altered_number' },
        { kind: 'restructured_document' },
      ],
    },
    documents: documents(),
    stakeholders: [
      {
        id: 'sh-1',
        key: 'growth_lead',
        contradictsStakeholderId: 'sh-2',
        contradictionPoint: 'Whether the value tier can absorb another price rise.',
      },
      {
        id: 'sh-2',
        key: 'finance_lead',
        contradictsStakeholderId: null,
        contradictionPoint: null,
      },
    ],
    answerSpacePositions: [
      {
        id: 'pos-1',
        key: 'hold_value_tier',
        kind: 'defensible',
        ignoredEvidence: null,
        isMinimumCommitment: true,
      },
      {
        id: 'pos-2',
        key: 'shift_bounded_share',
        kind: 'defensible',
        ignoredEvidence: null,
        isMinimumCommitment: false,
      },
      {
        id: 'pos-3',
        key: 'move_sixty_percent',
        kind: 'evidence_inconsistent',
        ignoredEvidence: 'The eleven-month payback rests on a deck the retention memo supersedes.',
        isMinimumCommitment: false,
      },
    ],
    namedFields: [{ key: 'budget_share_to_premium' }, { key: 'premium_payback_months' }],
    claims: claims(),
    variants: variants(),
    turn: { id: 'turn-1' },
    defenseQuestions: defenseQuestions(),
    readinessItems: readinessItems(),
  }
}

// ---------------------------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------------------------

// `ok` is the field `confirmVersion` branches on, and it is the one part of the result no test would
// notice going wrong if the helpers only read `failures`. Both helpers pin it: `codes` in both
// directions against the list it returns, `failure` at `false`, so every negative test below proves
// the package was refused as well as naming the rule that refused it.
function codes(version: ValidatedVersion): string[] {
  const { ok, failures } = validatePackage(version)
  expect(ok).toBe(failures.length === 0)
  return failures.map((item) => item.code)
}

function failure(version: ValidatedVersion, code: string): PackageValidationFailure {
  const result = validatePackage(version)
  expect(result.ok).toBe(false)
  const found = result.failures.find((item) => item.code === code)
  if (!found) throw new Error(`expected a ${code} failure, got ${codes(version).join(', ') || '—'}`)
  return found
}

function pick<T extends { key: string }>(elements: readonly T[], key: string): T {
  const found = elements.find((element) => element.key === key)
  if (!found) throw new Error(`no element keyed ${key}`)
  return found
}

function claim(version: ValidatedVersion, key: string): ValidatedClaim {
  return pick(version.claims, key)
}

function variant(version: ValidatedVersion, key: string): ValidatedVariant {
  return pick(version.variants, key)
}

function state(version: ValidatedVersion, variantKey: string, claimKey: string) {
  const claimId = claim(version, claimKey).id
  const found = variant(version, variantKey).claimStates.find((item) => item.claimId === claimId)
  if (!found) throw new Error(`no ${claimKey} state in the ${variantKey} variant`)
  return found
}

// ---------------------------------------------------------------------------------------------
// The rule table itself
// ---------------------------------------------------------------------------------------------

describe('the rule table', () => {
  it('carries every code of 10-backend-spec-modules.md §4, once, in table order', () => {
    expect(VALIDATION_RULE_CODES).toEqual([
      'BRIEF_TOO_LONG',
      'DOCUMENT_COUNT',
      'DOCUMENT_TOO_LONG',
      'DOCUMENT_ROLES_MISSING',
      'STAKEHOLDER_NO_DOCUMENT',
      'STAKEHOLDER_NO_CONTRADICTION',
      'ANSWER_SPACE_SINGLE',
      'ANSWER_SPACE_NO_INCONSISTENT',
      'ANSWER_SPACE_NO_MINIMUM',
      'NAMED_FIELDS_MISSING',
      'CLAIMS_TOO_FEW',
      'CLAIM_STATE_MISSING',
      'DEFECTIVE_VARIANT_PLANT',
      'VARIANTS_DIFFER_BEYOND_PLANT',
      'PLANTED_PATH_MISSING',
      'DEFECT_OUTSIDE_CONCEPTS',
      'DEFECT_NOT_CONSEQUENTIAL',
      'NO_STANCE_CHANGING_TRACE',
      'NO_ESCALATABLE_CLAIM',
      'NO_LOW_STAKES_SOUND',
      'NO_ACCEPT_WARRANTED_SOUND',
      'WARRANTED_STANCE_UNSET',
      'TURN_MISSING',
      'TURN_DELAY',
      'QUESTION_BANK_INCOMPLETE',
      'COUNTERFACTUAL_SENTENCES',
      'READINESS_SPLIT',
      'CLAIM_CONCEPT_UNKNOWN',
      'GENERAL_REPLY_MISSING',
      'RESKIN_LOG_EMPTY',
    ])
  })

  it('accepts the version shape the repository returns', () => {
    // `findVersionFull` is what the service hands the validator; if a column is renamed or a
    // relation dropped, this stops compiling rather than failing at run time in Phase 5.2.
    const asInput: (version: VersionFull) => ValidatedVersion = (version) => version
    expect(typeof asInput).toBe('function')
  })

  it('returns the result the wire carries', () => {
    // `PACKAGE_INVALID` details and `PackageVersionView.validation` take the result unchanged
    // (`ValidationResult`, schema.ts); the narrow code list is a subtype of the wire's `string`.
    const asWire: (result: PackageValidationResult) => ValidationResult = (result) => result
    expect(typeof asWire).toBe('function')
  })
})

describe('a valid package', () => {
  it('passes every rule with no failures', () => {
    expect(validatePackage(validVersion())).toEqual({ ok: true, failures: [] })
  })

  it('reports every broken rule, not the first', () => {
    const version = validVersion()
    version.brief = ''
    version.turn = null

    expect(codes(version)).toEqual(['BRIEF_TOO_LONG', 'TURN_MISSING'])
  })
})

// ---------------------------------------------------------------------------------------------
// One rule at a time
// ---------------------------------------------------------------------------------------------

describe('BRIEF_TOO_LONG', () => {
  it('passes a brief of exactly the limit', () => {
    const version = validVersion()
    version.brief = words(200)

    expect(codes(version)).toEqual([])
  })

  it('fails a brief one word over the limit', () => {
    const version = validVersion()
    version.brief = words(201)

    expect(codes(version)).toEqual(['BRIEF_TOO_LONG'])
    expect(failure(version, 'BRIEF_TOO_LONG')).toMatchObject({
      elementIds: [],
      message: 'The scenario brief is 201 words; the limit is 200 words.',
    })
  })

  it('fails an empty brief', () => {
    const version = validVersion()
    version.brief = '   '

    expect(failure(version, 'BRIEF_TOO_LONG').message).toContain('empty')
  })
})

describe('DOCUMENT_COUNT', () => {
  it('passes an Evidence Room at the lower bound', () => {
    expect(validVersion().documents).toHaveLength(6)
    expect(codes(validVersion())).toEqual([])
  })

  it('fails an Evidence Room of five documents', () => {
    const version = validVersion()
    version.documents = version.documents.filter((document) => document.key !== 'D6')

    expect(codes(version)).toEqual(['DOCUMENT_COUNT'])
    expect(failure(version, 'DOCUMENT_COUNT')).toMatchObject({
      elementIds: [],
      message: 'The Evidence Room holds 5 documents; it must hold between 6 and 12.',
    })
  })

  it('fails an Evidence Room of thirteen documents', () => {
    const version = validVersion()
    const extra = Array.from({ length: 7 }, (_unused, index) => ({
      ...pick(version.documents, 'D5'),
      id: `doc-extra-${index}`,
      key: `DX${index}`,
    }))
    version.documents = [...version.documents, ...extra]

    expect(codes(version)).toEqual(['DOCUMENT_COUNT'])
  })
})

describe('DOCUMENT_TOO_LONG', () => {
  it('passes a document body of exactly 2000 words', () => {
    const version = validVersion()
    pick(version.documents, 'D6').body = words(2000)

    expect(codes(version)).toEqual([])
  })

  it('fails a document body of 2001 words and names it', () => {
    const version = validVersion()
    pick(version.documents, 'D6').body = words(2001)

    expect(codes(version)).toEqual(['DOCUMENT_TOO_LONG'])
    expect(failure(version, 'DOCUMENT_TOO_LONG')).toMatchObject({
      elementIds: ['doc-6'],
      message: 'Document D6 exceeds the 2000-word limit; shorten the body.',
    })
  })
})

describe('DOCUMENT_ROLES_MISSING', () => {
  it('passes when one valid supersession stands beside a broken one (the rule is a floor)', () => {
    const version = validVersion()
    version.documents = [
      ...version.documents,
      { ...pick(version.documents, 'D1'), id: 'doc-7', key: 'D7', supersededByDocumentId: null },
    ]

    expect(codes(version)).toEqual([])
  })

  it('fails when no document is superseded', () => {
    const version = validVersion()
    pick(version.documents, 'D1').role = 'supporting'

    expect(codes(version)).toEqual(['DOCUMENT_ROLES_MISSING'])
    expect(failure(version, 'DOCUMENT_ROLES_MISSING')).toMatchObject({
      elementIds: [],
      message:
        'The Evidence Room is missing a superseded document named by a later document in the room.',
    })
  })

  it('fails when the superseding document is not later, and names the superseded document', () => {
    const version = validVersion()
    // D4 is dated 2024-11-20, before D1's 2025-02-10: it cannot supersede it.
    pick(version.documents, 'D1').supersededByDocumentId = 'doc-4'

    expect(codes(version)).toEqual(['DOCUMENT_ROLES_MISSING'])
    expect(failure(version, 'DOCUMENT_ROLES_MISSING')).toMatchObject({ elementIds: ['doc-1'] })
    expect(failure(version, 'DOCUMENT_ROLES_MISSING').message).toContain(
      'Document D1 is marked superseded but names no later document in the room.',
    )
  })

  it('fails when the superseding document is not in the room', () => {
    const version = validVersion()
    pick(version.documents, 'D1').supersededByDocumentId = 'doc-elsewhere'

    expect(codes(version)).toEqual(['DOCUMENT_ROLES_MISSING'])
  })

  it('fails when no document is an interpretation presented as fact', () => {
    const version = validVersion()
    pick(version.documents, 'D3').role = 'supporting'

    expect(failure(version, 'DOCUMENT_ROLES_MISSING').message).toContain(
      'an interpretation presented as fact',
    )
  })

  it('fails when no document is accurate and irrelevant', () => {
    const version = validVersion()
    pick(version.documents, 'D4').role = 'supporting'

    expect(failure(version, 'DOCUMENT_ROLES_MISSING').message).toContain(
      'an accurate and irrelevant document',
    )
  })
})

describe('STAKEHOLDER_NO_DOCUMENT', () => {
  it('passes when every stakeholder owns one document', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a stakeholder with no document and names the stakeholder', () => {
    const version = validVersion()
    pick(version.documents, 'D3').stakeholderId = null

    expect(codes(version)).toEqual(['STAKEHOLDER_NO_DOCUMENT'])
    expect(failure(version, 'STAKEHOLDER_NO_DOCUMENT')).toMatchObject({
      elementIds: ['sh-2'],
      message:
        'Stakeholder finance_lead has no document in the Evidence Room; every stakeholder needs at least one.',
    })
  })
})

describe('STAKEHOLDER_NO_CONTRADICTION', () => {
  it('passes one pair naming each other and the point', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails when the contradiction has no point', () => {
    const version = validVersion()
    pick(version.stakeholders, 'growth_lead').contradictionPoint = null

    expect(codes(version)).toEqual(['STAKEHOLDER_NO_CONTRADICTION'])
    expect(failure(version, 'STAKEHOLDER_NO_CONTRADICTION').elementIds).toEqual([])
  })

  it('fails when the contradicted stakeholder is not in the package', () => {
    const version = validVersion()
    pick(version.stakeholders, 'growth_lead').contradictsStakeholderId = 'sh-elsewhere'

    expect(codes(version)).toEqual(['STAKEHOLDER_NO_CONTRADICTION'])
  })
})

describe('ANSWER_SPACE_SINGLE', () => {
  it('passes two defensible positions', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a single defensible position', () => {
    const version = validVersion()
    version.answerSpacePositions = version.answerSpacePositions.filter(
      (position) => position.key !== 'shift_bounded_share',
    )

    expect(codes(version)).toEqual(['ANSWER_SPACE_SINGLE'])
    expect(failure(version, 'ANSWER_SPACE_SINGLE').message).toBe(
      'The answer space has 1 defensible position; it needs at least 2.',
    )
  })
})

describe('ANSWER_SPACE_NO_INCONSISTENT', () => {
  it('passes one evidence-inconsistent position naming its ignored evidence', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails an evidence-inconsistent position with no ignored evidence, and names it', () => {
    const version = validVersion()
    pick(version.answerSpacePositions, 'move_sixty_percent').ignoredEvidence = null

    expect(codes(version)).toEqual(['ANSWER_SPACE_NO_INCONSISTENT'])
    expect(failure(version, 'ANSWER_SPACE_NO_INCONSISTENT')).toMatchObject({
      elementIds: ['pos-3'],
    })
  })

  it('fails when the answer space has no evidence-inconsistent position at all', () => {
    const version = validVersion()
    version.answerSpacePositions = version.answerSpacePositions.filter(
      (position) => position.kind !== 'evidence_inconsistent',
    )

    expect(codes(version)).toEqual(['ANSWER_SPACE_NO_INCONSISTENT'])
    expect(failure(version, 'ANSWER_SPACE_NO_INCONSISTENT').elementIds).toEqual([])
  })
})

describe('ANSWER_SPACE_NO_MINIMUM', () => {
  it('passes exactly one minimum defensible commitment', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails when no position is the minimum commitment', () => {
    const version = validVersion()
    pick(version.answerSpacePositions, 'hold_value_tier').isMinimumCommitment = false

    expect(codes(version)).toEqual(['ANSWER_SPACE_NO_MINIMUM'])
    expect(failure(version, 'ANSWER_SPACE_NO_MINIMUM').elementIds).toEqual([])
  })

  it('fails when two positions are the minimum commitment, and names both', () => {
    const version = validVersion()
    pick(version.answerSpacePositions, 'shift_bounded_share').isMinimumCommitment = true

    expect(codes(version)).toEqual(['ANSWER_SPACE_NO_MINIMUM'])
    expect(failure(version, 'ANSWER_SPACE_NO_MINIMUM').elementIds).toEqual(['pos-1', 'pos-2'])
  })
})

describe('NAMED_FIELDS_MISSING', () => {
  it('passes a Decision Brief with named fields', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a Decision Brief with none', () => {
    const version = validVersion()
    version.namedFields = []

    expect(codes(version)).toEqual(['NAMED_FIELDS_MISSING'])
  })
})

describe('CLAIMS_TOO_FEW', () => {
  it('passes exactly six consequential claims', () => {
    expect(validVersion().claims).toHaveLength(6)
    expect(codes(validVersion())).toEqual([])
  })

  it('fails five consequential claims', () => {
    const version = validVersion()
    const dropped = claim(version, 'C6').id
    version.claims = version.claims.filter((item) => item.id !== dropped)
    version.variants = version.variants.map((item) => ({
      ...item,
      claimStates: item.claimStates.filter((claimState) => claimState.claimId !== dropped),
    }))

    expect(codes(version)).toEqual(['CLAIMS_TOO_FEW'])
    expect(failure(version, 'CLAIMS_TOO_FEW').message).toBe(
      'The package has 5 consequential claims; it needs at least 6.',
    )
  })
})

describe('CLAIM_STATE_MISSING', () => {
  it('passes when every claim has a state in both variants', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a claim with no state in the sound variant, and names the claim', () => {
    const version = validVersion()
    const orphaned = claim(version, 'C6').id
    variant(version, 'sound').claimStates = variant(version, 'sound').claimStates.filter(
      (item) => item.claimId !== orphaned,
    )

    expect(codes(version)).toEqual(['CLAIM_STATE_MISSING'])
    expect(failure(version, 'CLAIM_STATE_MISSING')).toMatchObject({
      elementIds: ['claim-6'],
      message: 'Claim C6 has no state in one of the variants.',
    })
  })

  it('fails when a whole variant is missing', () => {
    const version = validVersion()
    version.variants = version.variants.filter((item) => item.key !== 'sound')

    expect(codes(version)).toContain('CLAIM_STATE_MISSING')
    expect(failure(version, 'CLAIM_STATE_MISSING').message).toContain('no sound variant')
  })
})

describe('DEFECTIVE_VARIANT_PLANT', () => {
  it('passes one planted defective claim in the defective variant and none in the sound one', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails two planted claims and names both', () => {
    const version = validVersion()
    const second = state(version, 'defective', 'C6')
    second.planted = true
    second.evidenceStatus = 'defective'
    second.failureFamily = 'extrapolation'

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT').elementIds).toEqual(['claim-1', 'claim-6'])
  })

  it('fails no planted claim at all', () => {
    const version = validVersion()
    state(version, 'defective', 'C1').planted = false

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT').message).toContain(
      'plants no defective claim',
    )
  })

  it('fails a defect carried by the sound variant', () => {
    const version = validVersion()
    const soundState = state(version, 'sound', 'C2')
    soundState.evidenceStatus = 'defective'
    soundState.failureFamily = 'near_neighbor'

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    // The plant itself is well formed, so the failure names only the claim at fault.
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({ elementIds: ['claim-2'] })
  })

  it('fails a package with no defective variant at all', () => {
    const version = validVersion()
    version.variants = version.variants.filter((item) => item.key !== 'defective')

    // Losing the variant loses every state in it, so the claim-mix rules that read both variants
    // speak too; this rule is the one that says the plant itself is gone.
    expect(codes(version)).toEqual([
      'CLAIM_STATE_MISSING',
      'DEFECTIVE_VARIANT_PLANT',
      'NO_LOW_STAKES_SOUND',
      'NO_ACCEPT_WARRANTED_SOUND',
    ])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({
      elementIds: [],
      message:
        'The package has no defective variant; it must carry exactly one planted defective claim.',
    })
  })

  it('fails a planted state whose evidence status is not defective', () => {
    const version = validVersion()
    const planted = state(version, 'defective', 'C1')
    planted.evidenceStatus = 'sound'
    planted.failureFamily = null

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({
      elementIds: ['claim-1'],
      message:
        'The defective variant marks C1 planted but not defective; the planted claim must be defective.',
    })
  })

  it('fails a claim state naming no claim of this version, and names the state', () => {
    const version = validVersion()
    const defective = variant(version, 'defective')
    defective.claimStates = [
      ...defective.claimStates,
      {
        ...state(version, 'defective', 'C4'),
        id: 'state-d-orphan',
        claimId: 'claim-elsewhere',
      },
    ]

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({
      elementIds: ['state-d-orphan'],
      message:
        '1 claim state names no claim in this version; every state belongs to one of its claims.',
    })
  })

  it('does not let a state naming no claim stand in for the plant', () => {
    const version = validVersion()
    const real = state(version, 'defective', 'C1')
    real.planted = false
    const defective = variant(version, 'defective')
    // Planted and defective, but it names a claim the version does not hold: it must not be
    // counted as the plant, or a package with no findable defect would validate clean.
    defective.claimStates = [
      ...defective.claimStates,
      { ...real, id: 'state-d-orphan', claimId: 'claim-elsewhere', planted: true },
    ]

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({
      elementIds: ['state-d-orphan'],
      message:
        '1 claim state names no claim in this version; every state belongs to one of its claims. ' +
        'The defective variant plants no defective claim; exactly one claim must be planted and defective.',
    })
  })

  it('fails a planted flag left on a sound variant state', () => {
    const version = validVersion()
    state(version, 'sound', 'C5').planted = true

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
    expect(failure(version, 'DEFECTIVE_VARIANT_PLANT')).toMatchObject({
      elementIds: ['claim-5'],
      message: 'The sound variant marks C5 planted; nothing is planted in the sound variant.',
    })
  })
})

describe('VARIANTS_DIFFER_BEYOND_PLANT', () => {
  it('passes two variants that differ only in the planted claim', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a second defective claim carried only by the defective variant', () => {
    // The rule the table did not have (D-203): a defective variant carrying a defect nobody planted
    // breaks the scored core the two variants share, and every other rule stays silent about it.
    const version = validVersion()
    const extra = state(version, 'defective', 'C6')
    extra.evidenceStatus = 'defective'
    extra.failureFamily = 'extrapolation'

    expect(codes(version)).toContain('VARIANTS_DIFFER_BEYOND_PLANT')
    expect(failure(version, 'VARIANTS_DIFFER_BEYOND_PLANT')).toMatchObject({
      elementIds: ['claim-6'],
    })
    expect(failure(version, 'VARIANTS_DIFFER_BEYOND_PLANT').message).toContain(
      'C6 differs between the variants in its evidence status',
    )
  })

  it('fails a claim warranted one stance in one variant and another in the other', () => {
    const version = validVersion()
    state(version, 'sound', 'C2').warrantedStance = 'challenge'

    expect(codes(version)).toContain('VARIANTS_DIFFER_BEYOND_PLANT')
    expect(failure(version, 'VARIANTS_DIFFER_BEYOND_PLANT').message).toContain('warranted stance')
  })

  it('says nothing while the plant itself is broken', () => {
    // One fault, one failure: with the plant unresolved every claim would look like a difference,
    // and the author would be sent looking for a second problem that is really the first.
    const version = validVersion()
    state(version, 'defective', 'C1').planted = false

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT'])
  })

  it('says nothing about a stance that is simply missing', () => {
    const version = validVersion()
    state(version, 'sound', 'C2').warrantedStance = ''

    expect(codes(version)).toEqual(['WARRANTED_STANCE_UNSET'])
  })
})

describe('PLANTED_PATH_MISSING', () => {
  it('passes a Replication Check when the failure family is an uncomputed number', () => {
    const version = validVersion()
    const planted = state(version, 'defective', 'C1')
    planted.failureFamily = 'uncomputed_number'
    planted.verificationPaths = {
      replication_check: { result: 'Redone, the payback is 14 months.' },
    }

    expect(codes(version)).toEqual([])
  })

  it('fails a planted claim with no verification path', () => {
    const version = validVersion()
    state(version, 'defective', 'C1').verificationPaths = {}

    expect(codes(version)).toEqual(['PLANTED_PATH_MISSING'])
    expect(failure(version, 'PLANTED_PATH_MISSING')).toMatchObject({
      elementIds: ['claim-1'],
      message:
        'The planted claim C1 has no Source Trace path; the student must be able to catch the defect.',
    })
  })

  it('passes a Replication Check when the failure family is a misapplied method', () => {
    const version = validVersion()
    const planted = state(version, 'defective', 'C1')
    planted.failureFamily = 'misapplied_method'
    planted.verificationPaths = {
      replication_check: { result: 'Redone on the right base, retention is 61%.' },
    }

    expect(codes(version)).toEqual([])
  })

  it('fails a replicable family carrying neither path', () => {
    const version = validVersion()
    const planted = state(version, 'defective', 'C1')
    planted.failureFamily = 'uncomputed_number'
    planted.verificationPaths = {}

    expect(codes(version)).toEqual(['PLANTED_PATH_MISSING'])
    expect(failure(version, 'PLANTED_PATH_MISSING')).toMatchObject({
      elementIds: ['claim-1'],
      message:
        'The planted claim C1 has neither a Source Trace nor a Replication Check path; ' +
        'a defect in the uncomputed_number family needs one of them.',
    })
  })

  it('fails a Source Trace pointing at a document outside the Evidence Room', () => {
    const version = validVersion()
    const trace = state(version, 'defective', 'C1').verificationPaths.source_trace
    if (!trace) throw new Error('the planted claim should start with a Source Trace')
    trace.document_id = 'doc-elsewhere'

    expect(codes(version)).toEqual(['PLANTED_PATH_MISSING'])
    expect(failure(version, 'PLANTED_PATH_MISSING')).toMatchObject({
      elementIds: ['claim-1'],
      message:
        'The Source Trace on the planted claim C1 points at a document that is not in the ' +
        'Evidence Room; the student must be able to open what the trace names.',
    })
  })
})

describe('DEFECT_OUTSIDE_CONCEPTS', () => {
  it('passes a planted claim whose concept is declared', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a planted claim needing an undeclared concept', () => {
    const version = validVersion()
    claim(version, 'C1').conceptKey = 'behavioral_pricing'

    // The general rule sees the same claim: a defect outside the concept set is also a claim
    // outside it, and the author is told both, in table order.
    expect(codes(version)).toEqual(['DEFECT_OUTSIDE_CONCEPTS', 'CLAIM_CONCEPT_UNKNOWN'])
    expect(failure(version, 'DEFECT_OUTSIDE_CONCEPTS').elementIds).toEqual(['claim-1'])
  })
})

describe('DEFECT_NOT_CONSEQUENTIAL', () => {
  it('passes a load-bearing planted claim with high consequence', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a planted claim that is not load-bearing', () => {
    const version = validVersion()
    claim(version, 'C1').importance = 'supporting'

    expect(codes(version)).toEqual(['DEFECT_NOT_CONSEQUENTIAL'])
    expect(failure(version, 'DEFECT_NOT_CONSEQUENTIAL')).toMatchObject({
      elementIds: ['claim-1'],
      message:
        'The planted claim C1 is not load-bearing; a planted defect must change the decision.',
    })
  })

  it('fails a planted claim with low consequence', () => {
    const version = validVersion()
    claim(version, 'C1').consequenceLevel = 'low'

    expect(codes(version)).toEqual(['DEFECT_NOT_CONSEQUENTIAL'])
    expect(failure(version, 'DEFECT_NOT_CONSEQUENTIAL').message).toContain('has low consequence')
  })
})

describe('NO_STANCE_CHANGING_TRACE', () => {
  it('passes a volatile claim whose Source Trace would move a stance', () => {
    const version = validVersion()
    claim(version, 'C2').weaklySourced = false
    claim(version, 'C2').volatile = true

    expect(codes(version)).toEqual([])
  })

  it('fails when the only traced claim is neither weakly sourced nor volatile', () => {
    const version = validVersion()
    claim(version, 'C2').weaklySourced = false

    expect(codes(version)).toEqual(['NO_STANCE_CHANGING_TRACE'])
    expect(failure(version, 'NO_STANCE_CHANGING_TRACE').elementIds).toEqual([])
  })

  it('does not count the planted claim towards the rule', () => {
    const version = validVersion()
    claim(version, 'C2').weaklySourced = false
    claim(version, 'C1').weaklySourced = true

    expect(codes(version)).toEqual(['NO_STANCE_CHANGING_TRACE'])
  })

  it('does not count a planted claim the broken plant failed to resolve', () => {
    const version = validVersion()
    claim(version, 'C2').weaklySourced = false
    claim(version, 'C1').weaklySourced = true
    // A second plant leaves `DEFECTIVE_VARIANT_PLANT` carrying the report and the resolved plant
    // undefined. Reading "planted" off the resolution rather than off the states would let C1 —
    // still flagged planted in the defective variant — satisfy the rule it is excluded from.
    const second = state(version, 'defective', 'C6')
    second.planted = true
    second.evidenceStatus = 'defective'
    second.failureFamily = 'extrapolation'

    expect(codes(version)).toEqual(['DEFECTIVE_VARIANT_PLANT', 'NO_STANCE_CHANGING_TRACE'])
  })
})

describe('NO_ESCALATABLE_CLAIM', () => {
  it('passes one escalatable claim with an authored reply', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails an escalatable claim with no reply, and names it', () => {
    const version = validVersion()
    claim(version, 'C3').escalationReply = null

    expect(codes(version)).toEqual(['NO_ESCALATABLE_CLAIM'])
    expect(failure(version, 'NO_ESCALATABLE_CLAIM')).toMatchObject({ elementIds: ['claim-3'] })
  })

  it('fails when no claim is escalatable', () => {
    const version = validVersion()
    claim(version, 'C3').escalatable = false

    expect(codes(version)).toEqual(['NO_ESCALATABLE_CLAIM'])
    expect(failure(version, 'NO_ESCALATABLE_CLAIM').elementIds).toEqual([])
  })
})

describe('NO_LOW_STAKES_SOUND', () => {
  it('passes low-stakes sound claims warranting Verify as well as Accept', () => {
    const version = validVersion()
    state(version, 'defective', 'C5').warrantedStance = 'verify'
    state(version, 'sound', 'C5').warrantedStance = 'verify'

    expect(codes(version)).toEqual([])
  })

  it('fails when only one low-stakes sound claim remains', () => {
    const version = validVersion()
    claim(version, 'C5').consequenceLevel = 'medium'

    expect(codes(version)).toEqual(['NO_LOW_STAKES_SOUND'])
    expect(failure(version, 'NO_LOW_STAKES_SOUND').message).toBe(
      'The package has 1 low-stakes sound claim warranting Accept or Verify; it needs at least 2, ' +
        'so that a Challenge on one counts as a false alarm.',
    )
  })

  it('does not count a low-stakes claim warranting Challenge', () => {
    const version = validVersion()
    state(version, 'defective', 'C5').warrantedStance = 'challenge'
    state(version, 'sound', 'C5').warrantedStance = 'challenge'

    expect(codes(version)).toEqual(['NO_LOW_STAKES_SOUND'])
  })
})

describe('NO_ACCEPT_WARRANTED_SOUND', () => {
  it('passes one sound claim warranting Accept in both variants', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails when every sound claim warrants something other than Accept', () => {
    const version = validVersion()
    for (const key of ['C4', 'C5']) {
      state(version, 'defective', key).warrantedStance = 'verify'
      state(version, 'sound', key).warrantedStance = 'verify'
    }

    expect(codes(version)).toEqual(['NO_ACCEPT_WARRANTED_SOUND'])
    expect(failure(version, 'NO_ACCEPT_WARRANTED_SOUND').elementIds).toEqual([])
  })
})

describe('WARRANTED_STANCE_UNSET', () => {
  it('passes when every state carries a stance', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a state with no stance, and names the state', () => {
    const version = validVersion()
    state(version, 'defective', 'C3').warrantedStance = ''

    expect(codes(version)).toEqual(['WARRANTED_STANCE_UNSET'])
    expect(failure(version, 'WARRANTED_STANCE_UNSET')).toMatchObject({
      elementIds: ['state-d-3'],
      message:
        'No warranted stance is set for C3 in the defective variant; every claim state needs one.',
    })
  })
})

describe('TURN_MISSING', () => {
  it('passes a package with a Turn', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a package with none', () => {
    const version = validVersion()
    version.turn = null

    expect(codes(version)).toEqual(['TURN_MISSING'])
  })
})

describe('TURN_DELAY', () => {
  it('passes both ends of the 60 to 120 second window', () => {
    const early = validVersion()
    early.turnDelaySeconds = 60
    const late = validVersion()
    late.turnDelaySeconds = 120

    expect(codes(early)).toEqual([])
    expect(codes(late)).toEqual([])
  })

  it('fails a delay outside the window', () => {
    const version = validVersion()
    version.turnDelaySeconds = 45

    expect(codes(version)).toEqual(['TURN_DELAY'])
    expect(failure(version, 'TURN_DELAY').message).toBe(
      'The Turn arrives after 45 seconds; the delay must be between 60 and 120 seconds.',
    )
  })

  it('fails a delay one second over the window', () => {
    const version = validVersion()
    version.turnDelaySeconds = 121

    expect(codes(version)).toEqual(['TURN_DELAY'])
    expect(failure(version, 'TURN_DELAY').message).toBe(
      'The Turn arrives after 121 seconds; the delay must be between 60 and 120 seconds.',
    )
  })
})

describe('QUESTION_BANK_INCOMPLETE', () => {
  it('passes a bank with a question for every claim, every frame assumption, and six defaults', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a claim with no provenance question, and names the claim', () => {
    const version = validVersion()
    const orphaned = claim(version, 'C4').id
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => !(question.kind === 'provenance' && question.claimId === orphaned),
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE')).toMatchObject({
      elementIds: ['claim-4'],
      message: 'The defense question bank is missing a provenance question for C4.',
    })
  })

  it('fails a claim with no verification question, and names the claim', () => {
    const version = validVersion()
    const orphaned = claim(version, 'C5').id
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => !(question.kind === 'verification' && question.claimId === orphaned),
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE')).toMatchObject({
      elementIds: ['claim-5'],
      message: 'The defense question bank is missing a verification question for C5.',
    })
  })

  it('fails a bank with no confidence question', () => {
    const version = validVersion()
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question.kind !== 'confidence',
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE')).toMatchObject({
      elementIds: [],
      message: 'The defense question bank is missing a confidence question.',
    })
  })

  it('fails a bank with no frame-versus-response question', () => {
    const version = validVersion()
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question.kind !== 'frame_vs_response',
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE')).toMatchObject({
      elementIds: [],
      message: 'The defense question bank is missing a frame-versus-response question.',
    })
  })

  it('fails a bank with no counterfactual question', () => {
    const version = validVersion()
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question.kind !== 'counterfactual',
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE')).toMatchObject({
      elementIds: [],
      message: 'The defense question bank is missing a counterfactual question.',
    })
  })

  it('fails a missing frame assumption question', () => {
    const version = validVersion()
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question.assumptionIndex !== 2,
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE').message).toContain(
      'an assumption question for frame assumption 2',
    )
  })

  it('fails five default questions', () => {
    const version = validVersion()
    const defaults = version.defenseQuestions.filter((question) => question.kind === 'default')
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question !== defaults[0],
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE').message).toContain(
      '1 more default question (5 of 6)',
    )
  })

  it('fails a figure-provenance question that names a claim or drops the placeholder', () => {
    const version = validVersion()
    version.defenseQuestions = version.defenseQuestions.map((question) =>
      question.kind === 'figure_provenance'
        ? { ...question, template: 'Where did that number come from?' }
        : question,
    )

    expect(codes(version)).toEqual(['QUESTION_BANK_INCOMPLETE'])
    expect(failure(version, 'QUESTION_BANK_INCOMPLETE').message).toContain('{figure}')
  })

  it('asks for no figure-provenance question when the package has no named fields', () => {
    const version = validVersion()
    version.namedFields = []
    version.defenseQuestions = version.defenseQuestions.filter(
      (question) => question.kind !== 'figure_provenance',
    )

    expect(codes(version)).toEqual(['NAMED_FIELDS_MISSING'])
  })
})

describe('COUNTERFACTUAL_SENTENCES', () => {
  it('passes a counterfactual of exactly three sentences', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a counterfactual of two sentences', () => {
    const version = validVersion()
    version.debriefCounterfactual =
      'Payback would have run past fourteen months. The premium shift would have failed.'

    expect(codes(version)).toEqual(['COUNTERFACTUAL_SENTENCES'])
    expect(failure(version, 'COUNTERFACTUAL_SENTENCES').message).toBe(
      'The debrief counterfactual is 2 sentences; it must be exactly 3.',
    )
  })

  it('fails a counterfactual of four sentences', () => {
    const version = validVersion()
    version.debriefCounterfactual = `${COUNTERFACTUAL} The board would have asked for the memo anyway.`

    expect(codes(version)).toEqual(['COUNTERFACTUAL_SENTENCES'])
    expect(failure(version, 'COUNTERFACTUAL_SENTENCES').message).toBe(
      'The debrief counterfactual is 4 sentences; it must be exactly 3.',
    )
  })
})

describe('READINESS_SPLIT', () => {
  it('passes sixteen items split six, four, and six', () => {
    expect(validVersion().readinessItems).toHaveLength(16)
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a split of six, four, and five', () => {
    const version = validVersion()
    version.readinessItems = version.readinessItems.filter((item) => item.key !== 'R16')

    expect(codes(version)).toEqual(['READINESS_SPLIT'])
    expect(failure(version, 'READINESS_SPLIT').message).toBe(
      'The Readiness Check has 15 items; it needs exactly 16. It needs 6 ai_behavior items and has 5.',
    )
  })

  it('fails an item with three options, and names the item', () => {
    const version = validVersion()
    const item = pick(version.readinessItems, 'R1')
    item.options = item.options.slice(0, 3)

    expect(codes(version)).toEqual(['READINESS_SPLIT'])
    expect(failure(version, 'READINESS_SPLIT')).toMatchObject({ elementIds: ['item-1'] })
  })

  it('fails four options that do not carry four distinct keys', () => {
    const version = validVersion()
    const item = pick(version.readinessItems, 'R3')
    // Four options, an answer key naming one of them, and still unanswerable: two of them are the
    // same choice, so "b" selects whichever the renderer reaches first.
    item.options = [...item.options.slice(0, 3), { key: 'b', text: 'The fourth measure.' }]

    expect(codes(version)).toEqual(['READINESS_SPLIT'])
    expect(failure(version, 'READINESS_SPLIT')).toMatchObject({
      elementIds: ['item-3'],
      message: 'Item R3 needs 4 distinctly keyed options and an answer key naming one of them.',
    })
  })

  it('fails an answer key that names no option', () => {
    const version = validVersion()
    pick(version.readinessItems, 'R2').answerKey = 'z'

    expect(codes(version)).toEqual(['READINESS_SPLIT'])
    expect(failure(version, 'READINESS_SPLIT').elementIds).toEqual(['item-2'])
  })

  it('fails a stem repeating eight consecutive words of a claim (AI-005)', () => {
    const version = validVersion()
    pick(version.readinessItems, 'R1').stem =
      'Which check shows whether premium payback lands at eleven months on the pilot report?'

    expect(codes(version)).toEqual(['READINESS_SPLIT'])
    expect(failure(version, 'READINESS_SPLIT')).toMatchObject({ elementIds: ['item-1'] })
    expect(failure(version, 'READINESS_SPLIT').message).toContain('Item R1 (repeating C1)')
  })
})

// ---------------------------------------------------------------------------------------------
// The floor `READINESS_SPLIT` deliberately does not enforce (D-251)
//
// How thinly the sixteen items are spread over concepts is not a defect in a package, so it is not
// a rule: it is what decides how specific the concept map's reading of correctness is, and it
// reaches the author as the package warning `READINESS_CONCEPT_SINGLE_ITEM`. The rule and the floor
// are tested apart because they answer different questions — `codes()` below must stay empty for a
// package the floor would flag, or the warning would have become a block.
// ---------------------------------------------------------------------------------------------

describe('thinlyCarriedConcepts (READINESS_CONCEPT_SINGLE_ITEM)', () => {
  const on = (...concepts: string[]) => concepts.map((conceptKey) => ({ conceptKey }))

  it('names a concept carried by one item, whose map status is that item’s own marking', () => {
    expect(thinlyCarriedConcepts(on('payback', 'payback', 'survey_error'))).toEqual([
      'survey_error',
    ])
  })

  it('names none when every concept carries the floor of two', () => {
    expect(READINESS_ITEMS_PER_CONCEPT_MIN).toBe(2)
    expect(thinlyCarriedConcepts(on('payback', 'segmentation', 'payback', 'segmentation'))).toEqual(
      [],
    )
  })

  it('names sixteen concepts for sixteen items — the answer sheet the floor exists to catch', () => {
    const oneEach = Array.from({ length: 16 }, (_unused, index) => ({ conceptKey: `c${index}` }))
    expect(thinlyCarriedConcepts(oneEach)).toHaveLength(16)
  })

  it('lists them in the order the check first reaches them, which is the map’s order', () => {
    expect(thinlyCarriedConcepts(on('b', 'a', 'c', 'a', 'd'))).toEqual(['b', 'c', 'd'])
  })

  it('answers nothing for a check with no items, rather than inventing a concept', () => {
    expect(thinlyCarriedConcepts([])).toEqual([])
  })

  it('is a floor and not a rule: a package it flags still breaks nothing', () => {
    // Every item of `validVersion()` on its own concept would be the worst case the floor names,
    // and `validatePackage` must still pass it — a warning that blocked a confirmation would be a
    // rule wearing a warning's name (D-083, D-251).
    const version = validVersion()
    const concepts = version.readinessItems.map((_unused, index) => ({ conceptKey: `c${index}` }))

    expect(thinlyCarriedConcepts(concepts)).toHaveLength(16)
    expect(codes(version)).toEqual([])
  })
})

describe('CLAIM_CONCEPT_UNKNOWN', () => {
  it('passes when every claim names a declared concept', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails a claim naming an undeclared concept', () => {
    const version = validVersion()
    claim(version, 'C2').conceptKey = 'queueing_theory'

    expect(codes(version)).toEqual(['CLAIM_CONCEPT_UNKNOWN'])
    expect(failure(version, 'CLAIM_CONCEPT_UNKNOWN')).toMatchObject({
      elementIds: ['claim-2'],
      message:
        'Claim C2 ("queueing_theory") names a concept that is not in the declared concept set.',
    })
  })
})

describe('GENERAL_REPLY_MISSING', () => {
  it('passes a package with a general escalation reply', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('fails an empty general escalation reply', () => {
    const version = validVersion()
    version.generalEscalationReply = '  '

    expect(codes(version)).toEqual(['GENERAL_REPLY_MISSING'])
  })
})

describe('RESKIN_LOG_EMPTY', () => {
  it('passes a re-skin log with one entry of each kind', () => {
    expect(codes(validVersion())).toEqual([])
  })

  it('passes a hand-authored package with no seed record', () => {
    const version = validVersion()
    version.seedRecord = null

    expect(codes(version)).toEqual([])
  })

  it('fails a re-skin log of two entries', () => {
    const version = validVersion()
    version.seedRecord = {
      reskinLog: [{ kind: 'renamed_entity' }, { kind: 'altered_number' }],
    }

    expect(codes(version)).toEqual(['RESKIN_LOG_EMPTY'])
    expect(failure(version, 'RESKIN_LOG_EMPTY').message).toBe(
      'The re-skin log has 2 entries; it needs at least 3. It records no restructured document.',
    )
  })

  it('fails a re-skin log of three entries that are all the same kind', () => {
    const version = validVersion()
    version.seedRecord = {
      reskinLog: [
        { kind: 'renamed_entity' },
        { kind: 'renamed_entity' },
        { kind: 'renamed_entity' },
      ],
    }

    expect(codes(version)).toEqual(['RESKIN_LOG_EMPTY'])
    expect(failure(version, 'RESKIN_LOG_EMPTY').message).toBe(
      'It records no altered number and restructured document.',
    )
  })
})
