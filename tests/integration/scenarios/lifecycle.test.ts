// Step 5.2 — the life of one scenario package version against Postgres
// (docs/tech/10-backend-spec-modules.md §4; 07-api-spec.md §6): built from a licensed seed, every
// element decided by its author, the version confirmed and frozen, and the next version copied out
// of it with claim ids of its own (FR-190, FR-192, FR-027, FR-195, NFR-004).
//
// Everything the file is about — the decisions, the three refusals, the freeze, the copy — goes
// through the service. The elements themselves are written through the module's own repository,
// because Phase 5 has no service call that *adds* one: generation writes them in Phase 12 and
// `importPackage` writes them from a document, so a package created from a seed is filled by hand
// until then (UI-041, "edit elements by hand or import"). The rows below are what
// `writeImportedElements` would have written for the same package.
//
// The actor is built by hand rather than through a session: these are service calls, and the
// session path is what tests/integration/api/packages.test.ts exercises.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { countWords } from '@/lib/words'
import type { SessionUser } from '@/server/auth/types'
import {
  SINGLETON_ELEMENT_ID,
  type ElementTypeValue,
  type StanceValue,
  type VerificationPaths,
} from '@/server/modules/scenarios/schema'

type Scenarios = typeof import('@/server/modules/scenarios')
type ScenariosRepo = typeof import('@/server/modules/scenarios/repository')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let scenarios: Scenarios
let repo: ScenariosRepo
let f: Factories

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

// ---------------------------------------------------------------------------------------------
// The seed, and the package the author writes from it
// ---------------------------------------------------------------------------------------------

const CONCEPTS = ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification']

const SEED = {
  caseTitle: 'Northwind Coffee: the premium subscription',
  publisher: 'Harbour Case Press',
  licenseTerms: 'Educational adaptation permitted with attribution.',
  licensePermitsAdaptation: true,
  seedText:
    'Northwind Coffee, a regional roaster with eleven stores, must decide how much of next ' +
    'year’s marketing budget to move from its value tier to a new premium subscription. The ' +
    'board has asked for a number and a date. The licensed case carries a pilot readout, a ' +
    'positioning deck, a retention memo and four supporting exhibits.',
}

const BRIEF =
  'Meridian Roast must decide how much of next year’s marketing budget to move from the value ' +
  'tier to the premium subscription, and how fast. The board wants a number and a date.'

/** Three sentences, which is what `COUNTERFACTUAL_SENTENCES` asks for (D-201). */
const COUNTERFACTUAL =
  'A twenty percent worse churn would have pushed payback past fourteen months. ' +
  'The premium shift would then have failed its own test. ' +
  'The defensible response was to hold spend in the value tier.'

const ESCALATION_REPLY = 'A colleague reviews the claim and reports what the record supports.'

/** The re-skin log `RESKIN_LOG_EMPTY` asks for: three entries, one of each kind (FR-028). */
const RESKIN_LOG = [
  { kind: 'renamed_entity' as const, from: 'Northwind Coffee', to: 'Meridian Roast', note: '' },
  { kind: 'altered_number' as const, from: '9 months', to: '11 months', note: '' },
  {
    kind: 'restructured_document' as const,
    from: 'One exhibit pack',
    to: 'Six separate documents',
    note: '',
  },
]

/**
 * Fills a draft version with a package that breaks no rule of `validatePackage`: six documents
 * carrying the three roles the Evidence Room needs, two stakeholders who contradict each other,
 * three answer-space positions, six claims with a state in both variants, the plant in the
 * defective one, the probe, the Turn, the twenty-five-question bank and sixteen readiness items.
 */
async function fillDraft(orgId: string, versionId: string): Promise<void> {
  const draft = await repo.findVersionFull(orgId, versionId)
  if (!draft) throw new Error(`no draft version ${versionId} in institution ${orgId}`)
  const variantId = (key: 'defective' | 'sound'): string => {
    const found = draft.variants.find((row) => row.key === key)
    if (!found) throw new Error(`the version has no ${key} variant`)
    return found.id
  }

  // The four column-backed elements, and the seed record the create call left with an empty log.
  await repo.upsertElement(orgId, versionId, 'brief', { brief: BRIEF })
  await repo.upsertElement(orgId, versionId, 'counterfactual', {
    debriefCounterfactual: COUNTERFACTUAL,
  })
  await repo.upsertElement(orgId, versionId, 'general_escalation_reply', {
    generalEscalationReply: ESCALATION_REPLY,
  })
  await repo.upsertElement(orgId, versionId, 'clock_and_difficulty', {
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
    difficultyProfile: { estimate: 'moderate', note: '', uncalibrated: true },
  })
  await repo.upsertElement(orgId, versionId, 'seed_reskin', { ...SEED, reskinLog: RESKIN_LOG })

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
    positionStatement: 'Move a bounded share of the budget to premium now.',
    incentives: 'Rewarded on new-tier revenue.',
    blindSpots: 'Reads the pilot retention number as settled.',
    contradictsStakeholderId: finance.id,
    contradictionPoint: 'Whether the value tier can absorb another price rise.',
  })

  const documentIds = new Map<string, string>()
  const document = async (row: {
    key: string
    title: string
    author: string
    datedOn: string
    body: string
    role: 'supporting' | 'superseded' | 'interpretation_as_fact' | 'irrelevant'
    position: number
    supersededByDocumentId?: string
    stakeholderId?: string
  }): Promise<string> => {
    const written = await repo.upsertElement(orgId, versionId, 'document', {
      key: row.key,
      title: row.title,
      author: row.author,
      datedOn: row.datedOn,
      body: row.body,
      wordCount: countWords(row.body),
      role: row.role,
      supersededByDocumentId: row.supersededByDocumentId ?? null,
      stakeholderId: row.stakeholderId ?? null,
      position: row.position,
    })
    documentIds.set(row.key, written.id)
    return written.id
  }
  const documentId = (key: string): string => {
    const id = documentIds.get(key)
    if (id === undefined) throw new Error(`no document keyed ${key}`)
    return id
  }

  // The successor is written first: `scenario_documents_superseded_by_check` refuses a superseded
  // document that names nothing.
  await document({
    key: 'D2',
    title: 'Retention memo',
    author: 'Dana Ruiz',
    datedOn: '2025-06-01',
    body: 'Retention in the premium cohort is measured on a rolling three-month window, and payback lands at fourteen months.',
    role: 'supporting',
    position: 1,
  })
  await document({
    key: 'D1',
    title: 'Positioning deck',
    author: 'Priya Shah',
    datedOn: '2025-02-10',
    body: 'The value tier carries the brand and should keep the spend it has. Premium payback lands at eleven months on the pilot cohort.',
    role: 'superseded',
    position: 0,
    supersededByDocumentId: documentId('D2'),
    stakeholderId: growth.id,
  })
  await document({
    key: 'D3',
    title: 'Founder note',
    author: 'Ari Meridian',
    datedOn: '2025-03-04',
    body: 'The founder writes that the value tier is saturated, and states it as settled fact.',
    role: 'interpretation_as_fact',
    position: 2,
    stakeholderId: finance.id,
  })
  await document({
    key: 'D4',
    title: 'Green-bean supplier contract',
    author: 'Legal',
    datedOn: '2024-11-20',
    body: 'The green-bean supplier contract runs to 2027 at a fixed rate. Accurate, and beside the point.',
    role: 'irrelevant',
    position: 3,
  })
  await document({
    key: 'D5',
    title: 'Premium pilot readout',
    author: 'Growth team',
    datedOn: '2025-05-12',
    body: 'The premium pilot readout lists sign-ups, churn and basket size by month.',
    role: 'supporting',
    position: 4,
  })
  await document({
    key: 'D6',
    title: 'Channel cost table',
    author: 'Finance',
    datedOn: '2025-04-02',
    body: 'Cost per acquisition for each of the four channels, as of April.',
    role: 'supporting',
    position: 5,
  })

  await repo.upsertElement(orgId, versionId, 'answer_space_position', {
    key: 'hold_value_tier',
    kind: 'defensible',
    summary: 'Hold spend in the value tier and re-test premium next quarter.',
    supportingDocumentIds: [documentId('D2')],
    ignoredEvidence: null,
    isMinimumCommitment: true,
    position: 0,
  })
  await repo.upsertElement(orgId, versionId, 'answer_space_position', {
    key: 'shift_bounded_share',
    kind: 'defensible',
    summary: 'Move a bounded share of the budget to premium, with a stated review date.',
    supportingDocumentIds: [documentId('D5')],
    ignoredEvidence: null,
    isMinimumCommitment: false,
    position: 1,
  })
  await repo.upsertElement(orgId, versionId, 'answer_space_position', {
    key: 'move_sixty_percent',
    kind: 'evidence_inconsistent',
    summary: 'Move sixty percent of the budget on the eleven-month payback.',
    supportingDocumentIds: [documentId('D1')],
    ignoredEvidence: 'The eleven-month payback rests on a deck the retention memo supersedes.',
    isMinimumCommitment: false,
    position: 2,
  })

  await repo.upsertElement(orgId, versionId, 'named_field', {
    key: 'budget_share_to_premium',
    label: 'Budget share to premium',
    unit: 'percent',
    position: 0,
  })
  await repo.upsertElement(orgId, versionId, 'named_field', {
    key: 'premium_payback_months',
    label: 'Premium payback',
    unit: 'months',
    position: 1,
  })

  const claimIds = new Map<string, string>()
  const claim = async (row: {
    key: string
    text: string
    sourceDocumentId: string | null
    importance: 'load_bearing' | 'supporting'
    consequenceLevel: 'low' | 'medium' | 'high'
    conceptKey: string
    position: number
    weaklySourced?: boolean
    escalationReply?: string
  }): Promise<void> => {
    const written = await repo.upsertElement(orgId, versionId, 'claim', {
      key: row.key,
      text: row.text,
      sourceKind: 'assistant',
      sourceDocumentId: row.sourceDocumentId,
      sourcePassage: '',
      importance: row.importance,
      consequenceLevel: row.consequenceLevel,
      verificationCost: 'cheap',
      weaklySourced: row.weaklySourced ?? false,
      volatile: false,
      conceptKey: row.conceptKey,
      carriedValues: [],
      triggerPhrases: [],
      triggerDescription: '',
      escalatable: row.escalationReply !== undefined,
      escalationReply: row.escalationReply ?? null,
      rationale: '',
      position: row.position,
    })
    claimIds.set(row.key, written.id)
  }
  const claimId = (key: string): string => {
    const id = claimIds.get(key)
    if (id === undefined) throw new Error(`no claim keyed ${key}`)
    return id
  }

  await claim({
    key: 'C1',
    text: 'Premium payback lands at eleven months on the pilot cohort.',
    sourceDocumentId: documentId('D1'),
    importance: 'load_bearing',
    consequenceLevel: 'high',
    conceptKey: 'payback_period',
    position: 0,
  })
  await claim({
    key: 'C2',
    text: 'The channel cost table still reflects the terms in force today.',
    sourceDocumentId: documentId('D6'),
    importance: 'supporting',
    consequenceLevel: 'medium',
    conceptKey: 'segmentation',
    position: 1,
    weaklySourced: true,
  })
  await claim({
    key: 'C3',
    text: 'The survey behind the saturation estimate carries a wide margin of error.',
    sourceDocumentId: null,
    importance: 'supporting',
    consequenceLevel: 'medium',
    conceptKey: 'ai_verification',
    position: 2,
    escalationReply: 'A colleague confirms the survey ran on 140 respondents in one district.',
  })
  await claim({
    key: 'C4',
    text: 'Footfall in the north district rose slightly last spring.',
    sourceDocumentId: null,
    importance: 'supporting',
    consequenceLevel: 'low',
    conceptKey: 'segmentation',
    position: 3,
  })
  await claim({
    key: 'C5',
    text: 'The roastery added a second grinder over the summer.',
    sourceDocumentId: null,
    importance: 'supporting',
    consequenceLevel: 'low',
    conceptKey: 'segmentation',
    position: 4,
  })
  await claim({
    key: 'C6',
    text: 'Retention holds above seventy percent after the third month.',
    sourceDocumentId: null,
    importance: 'load_bearing',
    consequenceLevel: 'high',
    conceptKey: 'retention_cohorts',
    position: 5,
  })

  // The two variants are one scenario apart from the plant (D-203), so every claim but C1 carries
  // the same evidence status, failure family, warranted stance and planted flag in both.
  const shared: { claim: string; warrantedStance: StanceValue; paths: VerificationPaths }[] = [
    {
      claim: 'C2',
      warrantedStance: 'verify',
      paths: {
        source_trace: {
          document_id: documentId('D6'),
          passage: 'Cost per acquisition by channel, April.',
          dated_on: '2025-04-02',
          author: 'Finance',
        },
      },
    },
    { claim: 'C3', warrantedStance: 'escalate', paths: {} },
    { claim: 'C4', warrantedStance: 'accept', paths: {} },
    { claim: 'C5', warrantedStance: 'accept', paths: {} },
    {
      claim: 'C6',
      warrantedStance: 'verify',
      paths: { replication_check: { result: 'The cohort comparison reproduces 71 percent.' } },
    },
  ]
  for (const variant of ['defective', 'sound'] as const) {
    for (const state of shared) {
      await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
        variantId: variantId(variant),
        claimId: claimId(state.claim),
        evidenceStatus: 'sound',
        failureFamily: null,
        warrantedStance: state.warrantedStance,
        planted: false,
        verificationPaths: state.paths,
      })
    }
  }

  // C1 is the plant: stale in the defective variant, and the same claim read soundly in the other.
  await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
    variantId: variantId('defective'),
    claimId: claimId('C1'),
    evidenceStatus: 'defective',
    failureFamily: 'stale_evidence',
    warrantedStance: 'challenge',
    planted: true,
    verificationPaths: {
      source_trace: {
        document_id: documentId('D1'),
        passage: 'Premium payback lands at eleven months on the pilot cohort.',
        dated_on: '2025-02-10',
        author: 'Priya Shah',
      },
    },
  })
  await repo.upsertElement(orgId, versionId, 'variant_claim_state', {
    variantId: variantId('sound'),
    claimId: claimId('C1'),
    evidenceStatus: 'sound',
    failureFamily: null,
    warrantedStance: 'accept',
    planted: false,
    verificationPaths: {
      source_trace: {
        document_id: documentId('D2'),
        passage: 'Payback on the premium tier is fourteen months.',
        dated_on: '2025-06-01',
        author: 'Dana Ruiz',
      },
    },
  })

  await repo.upsertElement(orgId, versionId, 'probe', {
    claimId: claimId('C2'),
    originalPosition: 'The channel cost table still reflects the terms in force today.',
    scriptedReversal: 'You are right to push back — the table is a quarter out of date.',
  })

  await repo.upsertElement(orgId, versionId, 'turn', {
    text: 'Month-three retention in the premium pilot is 61 percent, not 78.',
    voice: 'stakeholder_message',
    stakeholderId: growth.id,
    warrantsChange: true,
    proportionateResponse: 'revise',
    evidence: 'The corrected cohort table from the pilot dashboard.',
    disruptedAssumptionKeys: ['premium_payback_months'],
    windowClaimIds: [claimId('C1'), claimId('C6')],
  })

  let questions = 0
  const question = async (row: {
    kind:
      | 'provenance'
      | 'figure_provenance'
      | 'verification'
      | 'assumption'
      | 'confidence'
      | 'frame_vs_response'
      | 'counterfactual'
      | 'default'
    template: string
    claimId?: string
    assumptionIndex?: number
  }): Promise<void> => {
    questions += 1
    await repo.upsertElement(orgId, versionId, 'defense_question', {
      key: `Q${questions}`,
      kind: row.kind,
      claimId: row.claimId ?? null,
      assumptionIndex: row.assumptionIndex ?? null,
      template: row.template,
      condition: {},
      followUp: '',
      expectedAnswerNotes: 'Names the document the figure came from and its date.',
      isDefault: row.kind === 'default',
      position: questions - 1,
    })
  }

  // One provenance and one verification question per claim, the three frame assumptions, the four
  // singles, and six defaults: the bank `QUESTION_BANK_INCOMPLETE` asks for (PRD §7.12).
  for (const key of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
    await question({
      kind: 'provenance',
      claimId: claimId(key),
      template: 'Where does {claim_text} come from?',
    })
    await question({
      kind: 'verification',
      claimId: claimId(key),
      template: 'What would you check to test {claim_text}?',
    })
  }
  for (const index of [0, 1, 2]) {
    await question({
      kind: 'assumption',
      assumptionIndex: index,
      template: 'What happens to the decision if {assumption} is wrong?',
    })
  }
  await question({ kind: 'confidence', template: 'How confident are you in {stance}?' })
  await question({
    kind: 'frame_vs_response',
    template: 'Did the response you locked match the frame you set?',
  })
  await question({
    kind: 'counterfactual',
    template: 'What if {figure} were twenty percent worse?',
  })
  await question({
    kind: 'figure_provenance',
    template: 'Where did the figure {figure} come from?',
  })
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await question({ kind: 'default', template: `Default ${index}: what did you rely on here?` })
  }

  // Sixteen items split 6 / 4 / 6, four options each, and no stem echoing a claim (AI-005).
  const plan = [
    ['foundation', 6],
    ['defect_concept', 4],
    ['ai_behavior', 6],
  ] as const
  let items = 0
  for (const [category, count] of plan) {
    for (let index = 0; index < count; index += 1) {
      items += 1
      await repo.upsertElement(orgId, versionId, 'readiness_item', {
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
      })
    }
  }
}

/**
 * Every element of the filled package: 1 brief + 6 documents + 2 stakeholders + 3 positions +
 * 2 named fields + 6 claims + 12 claim states + probe + Turn + 25 questions + 16 readiness items +
 * counterfactual + escalation reply + clock + seed record.
 */
const ELEMENT_COUNT = 79

// ---------------------------------------------------------------------------------------------
// Fixture and helpers
// ---------------------------------------------------------------------------------------------

async function setup() {
  const orgId = (await f.createInstitution('lifecycle')).organization.id
  const instructor = await f.createUser('lifecycle-instructor')
  await f.addMember(orgId, instructor.id, 'instructor')
  return { orgId, instructor, author: actorFor(instructor, orgId) }
}

type Fixture = Awaited<ReturnType<typeof setup>>

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  scenarios ??= await import('@/server/modules/scenarios')
  repo ??= await import('@/server/modules/scenarios/repository')
  f ??= await import('@tests/factories')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

/** A package created from the seed, with every element written but nothing decided. */
async function draftPackage(familyKey = 'meridian-roast'): Promise<{
  packageId: string
  versionId: string
}> {
  const created = await scenarios.createPackageFromSeed(fx.author, fx.orgId, {
    title: 'Meridian Roast',
    familyKey,
    conceptSet: CONCEPTS,
    seed: SEED,
  })
  await fillDraft(fx.orgId, created.versionId)
  return created
}

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

type Unconfirmed = { elementType: ElementTypeValue; elementId: string | null; key: string }

/** The elements `ELEMENTS_UNCONFIRMED` names — the workspace's worklist, and this test's. */
function unconfirmedElements(details: unknown): Unconfirmed[] {
  const elements = (details as { elements?: Unconfirmed[] }).elements
  if (!elements) throw new Error('ELEMENTS_UNCONFIRMED carried no element list')
  return elements
}

/** Confirms every element still waiting on a decision, as an author working through the list. */
async function decideEveryElement(versionId: string): Promise<Unconfirmed[]> {
  const refused = await refusal(
    scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
  )
  expect(refused.code).toBe('ELEMENTS_UNCONFIRMED')
  const pending = unconfirmedElements(refused.details)
  for (const element of pending) {
    await scenarios.decideElement(
      fx.author,
      versionId,
      element.elementType,
      element.elementId ?? SINGLETON_ELEMENT_ID,
      { decision: 'confirmed', note: '', openedAt: new Date().toISOString() },
    )
  }
  return pending
}

async function claimIdsByKey(versionId: string): Promise<Map<string, string>> {
  const version = await repo.findVersionFull(fx.orgId, versionId)
  if (!version) throw new Error(`no version ${versionId} in institution ${fx.orgId}`)
  return new Map(version.claims.map((claim) => [claim.key, claim.id]))
}

// ---------------------------------------------------------------------------------------------
// createPackageFromSeed (FR-190)
// ---------------------------------------------------------------------------------------------

describe('createPackageFromSeed (FR-190)', () => {
  it('opens version 1 as a draft with the seed record, both variants and no decisions', async () => {
    const created = await scenarios.createPackageFromSeed(fx.author, fx.orgId, {
      title: 'Meridian Roast',
      familyKey: 'meridian-roast',
      conceptSet: CONCEPTS,
      seed: SEED,
    })

    const view = await scenarios.getPackageVersion(fx.author, created.versionId)
    expect(view).toMatchObject({
      packageId: created.packageId,
      packageTitle: 'Meridian Roast',
      familyKey: 'meridian-roast',
      version: 1,
      status: 'draft',
      calibrationStatus: 'uncalibrated',
      conceptSet: CONCEPTS,
      teachingNoteChecked: false,
      confirmedAt: null,
      confirmedBy: null,
      confirmationRecord: [],
      // Generation arrives in Phase 12, so the workspace hides its regenerate buttons until then.
      capabilities: { canEdit: true, canConfirm: true, canRegenerate: false },
      // D-083: the family carries no ethical-shortcut defect, which is a warning, not a block.
      warnings: ['FAMILY_LACKS_ETHICAL_DEFECT'],
    })
    // FR-028: the seed record travels with the version for an instructor.
    expect(view.seedRecord).toMatchObject({
      caseTitle: SEED.caseTitle,
      publisher: SEED.publisher,
      licensePermitsAdaptation: true,
    })
    expect(view.counts).toMatchObject({ variants: 2, claims: 0, documents: 0 })
    // Nothing has been authored yet, so the empty version fails the rules it will later pass.
    expect(view.validation.ok).toBe(false)
  })

  it('refuses a seed whose license does not permit adaptation', async () => {
    await expect(
      scenarios.createPackageFromSeed(fx.author, fx.orgId, {
        title: 'Unlicensed',
        familyKey: 'unlicensed',
        conceptSet: CONCEPTS,
        seed: { ...SEED, licensePermitsAdaptation: false },
      }),
    ).rejects.toMatchObject({ code: 'LICENSE_NOT_CONFIRMED' })

    const listed = await scenarios.listPackages(fx.author, fx.orgId)
    expect(listed.items).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// confirmVersion refuses in the order 10 §4 gives (FR-192, FR-027)
// ---------------------------------------------------------------------------------------------

describe('listVersionElements (UI-043)', () => {
  it('answers with every element of the version and the decision standing on it', async () => {
    const { versionId } = await draftPackage()

    const elements = await scenarios.listVersionElements(fx.author, versionId)
    expect(elements).toHaveLength(ELEMENT_COUNT)
    // Nothing is decided yet, so every element says so; the workspace opens on the first of them.
    expect(elements.every((element) => element.confirmation === null)).toBe(true)

    // Every element the version holds, addressed the way updateElement addresses it.
    const types = new Set(elements.map((element) => element.elementType))
    expect(types).toContain('brief')
    expect(types).toContain('document')
    expect(types).toContain('claim')
    expect(types).toContain('variant_claim_state')
    expect(types).toContain('readiness_item')
    expect(types).toContain('seed_reskin')

    const brief = elements.find((element) => element.elementType === 'brief')
    expect(brief?.elementId).toBeNull() // a singleton is filed under a null id, as its row is

    // A singleton is addressed the way a route addresses it, with the sentinel id: the row keeps
    // null, and `SINGLETON_ELEMENT_ID` is what stands in for it on the wire (06 §3.3).
    const [first] = elements
    await scenarios.decideElement(
      fx.author,
      versionId,
      first!.elementType,
      first!.elementId ?? SINGLETON_ELEMENT_ID,
      {
        decision: 'confirmed',
        note: '',
        openedAt: new Date(Date.now() - 4_000).toISOString(),
      },
    )
    const afterDecision = await scenarios.listVersionElements(fx.author, versionId)
    expect(afterDecision[0]?.confirmation).toMatchObject({ decision: 'confirmed' })
  })

  it("is the write side's gate, not the version reader's: a teaching assistant is refused", async () => {
    const { versionId } = await draftPackage()
    const ta = await f.createUser('lifecycle-ta')
    await f.addMember(fx.orgId, ta.id, 'teaching_assistant')

    // A TA reads a package on UI-044 and never in the room where it is signed: the seed record is
    // one of these elements (FR-028), and every action the workspace offers would refuse them.
    await expect(
      scenarios.listVersionElements(actorFor(ta, fx.orgId), versionId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('answers NOT_FOUND for a version another institution owns', async () => {
    const { versionId } = await draftPackage()
    const otherOrg = (await f.createInstitution('lifecycle-other')).organization.id
    const stranger = await f.createUser('lifecycle-stranger')
    await f.addMember(otherOrg, stranger.id, 'instructor')

    // Never FORBIDDEN: an id from another institution must not be probeable for existence (08 §4).
    await expect(
      scenarios.listVersionElements(actorFor(stranger, otherOrg), versionId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('confirmVersion refuses in the order 10 §4 gives', () => {
  it('names every element still waiting on a decision', async () => {
    const { versionId } = await draftPackage()

    const refused = await refusal(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
    )
    expect(refused.code).toBe('ELEMENTS_UNCONFIRMED')

    const pending = unconfirmedElements(refused.details)
    expect(pending).toHaveLength(ELEMENT_COUNT)
    // The singletons are addressed by type with a null element id (06 §3.3); everything else by id.
    expect(pending.filter((element) => element.elementId === null).map((el) => el.key)).toEqual([
      'brief',
      'probe',
      'turn',
      'counterfactual',
      'general_escalation_reply',
      'clock_and_difficulty',
      'seed_reskin',
    ])
    const keysOf = (elementType: ElementTypeValue): string[] =>
      pending.filter((element) => element.elementType === elementType).map((el) => el.key)
    expect(keysOf('claim')).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    expect(keysOf('document')).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'])
    // A claim state is named by its variant and its claim, so both readings are confirmed one by one.
    expect(keysOf('variant_claim_state').sort()).toEqual([
      'defective:C1',
      'defective:C2',
      'defective:C3',
      'defective:C4',
      'defective:C5',
      'defective:C6',
      'sound:C1',
      'sound:C2',
      'sound:C3',
      'sound:C4',
      'sound:C5',
      'sound:C6',
    ])

    // Deciding one element removes exactly that element from the list.
    const first = pending[0]!
    await scenarios.decideElement(
      fx.author,
      versionId,
      first.elementType,
      first.elementId ?? SINGLETON_ELEMENT_ID,
      { decision: 'confirmed', note: 'Reads as written.', openedAt: new Date().toISOString() },
    )
    const again = await refusal(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
    )
    expect(unconfirmedElements(again.details)).toHaveLength(ELEMENT_COUNT - 1)
  })

  it('still refuses an element the author rejected', async () => {
    const { versionId } = await draftPackage()
    await decideEveryElement(versionId)

    const claims = await claimIdsByKey(versionId)
    await scenarios.decideElement(fx.author, versionId, 'claim', claims.get('C4')!, {
      decision: 'rejected',
      note: 'Too close to C5; re-author it.',
      openedAt: new Date().toISOString(),
    })

    const refused = await refusal(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
    )
    expect(refused.code).toBe('ELEMENTS_UNCONFIRMED')
    expect(unconfirmedElements(refused.details)).toEqual([
      { elementType: 'claim', elementId: claims.get('C4'), key: 'C4' },
    ])
  })

  it('refuses an unticked teaching-note check once every element is decided (FR-027)', async () => {
    const { versionId } = await draftPackage()
    await decideEveryElement(versionId)

    const refused = await refusal(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: false }),
    )
    expect(refused.code).toBe('TEACHING_NOTE_UNCHECKED')

    const view = await scenarios.getPackageVersion(fx.author, versionId)
    expect(view.status).toBe('draft')
    expect(view.teachingNoteChecked).toBe(false)
  })

  it('refuses a package that breaks a rule, carrying the rule codes', async () => {
    const { versionId } = await draftPackage()
    await decideEveryElement(versionId)

    // An author's edit is itself a confirmation (10 §4), so C5 stays decided and only the rules
    // change: its concept is no longer one the version declares.
    const claims = await claimIdsByKey(versionId)
    const edited = await scenarios.updateElement(fx.author, versionId, 'claim', claims.get('C5')!, {
      conceptKey: 'brand_equity',
    })
    expect(edited.confirmation).toMatchObject({ decision: 'edited', revision: 2 })

    const refused = await refusal(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
    )
    expect(refused.code).toBe('PACKAGE_INVALID')
    expect(refused.details).toMatchObject({ rules: ['CLAIM_CONCEPT_UNKNOWN'] })
    const failures = (refused.details as { failures: { code: string; elementIds: string[] }[] })
      .failures
    expect(failures[0]?.elementIds).toEqual([claims.get('C5')])

    // The same report reaches the workspace through the version view (FR-194).
    const view = await scenarios.getPackageVersion(fx.author, versionId)
    expect(view.validation.ok).toBe(false)
    expect(view.validation.failures.map((failure) => failure.code)).toEqual([
      'CLAIM_CONCEPT_UNKNOWN',
    ])

    // Putting the concept back makes the package confirmable again.
    await scenarios.updateElement(fx.author, versionId, 'claim', claims.get('C5')!, {
      conceptKey: 'segmentation',
    })
    const confirmed = await scenarios.confirmVersion(fx.author, versionId, {
      teachingNoteChecked: true,
    })
    expect(confirmed.status).toBe('confirmed')
  })
})

// ---------------------------------------------------------------------------------------------
// Confirming freezes the version (NFR-004)
// ---------------------------------------------------------------------------------------------

describe('confirmVersion freezes the version', () => {
  it('records the confirmation, writes the snapshot and refuses every later write', async () => {
    const { versionId } = await draftPackage()
    const decided = await decideEveryElement(versionId)

    const view = await scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true })
    expect(view).toMatchObject({
      status: 'confirmed',
      teachingNoteChecked: true,
      confirmedBy: fx.instructor.id,
      capabilities: { canEdit: false, canConfirm: false, canRegenerate: false },
    })
    expect(view.confirmedAt).not.toBeNull()
    expect(view.validation).toEqual({ ok: true, failures: [] })
    // One decision per element, each signed by the author who made it.
    expect(view.confirmationRecord).toHaveLength(decided.length)
    for (const row of view.confirmationRecord) {
      expect(row).toMatchObject({ decision: 'confirmed', decidedBy: fx.instructor.id })
    }

    // The export-format snapshot was written with the transition (07 §6, SYS-026).
    const exported = await scenarios.exportPackage(fx.author, versionId)
    expect(exported.schemaVersion).toBe(1)
    expect(exported.claims.map((claim) => claim.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])

    // Nothing may change it again: not an edit, not a decision, not a second confirmation.
    const claims = await claimIdsByKey(versionId)
    await expect(
      scenarios.updateElement(fx.author, versionId, 'claim', claims.get('C1')!, {
        text: 'Premium payback lands at twelve months on the pilot cohort.',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_FROZEN' })
    await expect(
      scenarios.updateElement(fx.author, versionId, 'brief', SINGLETON_ELEMENT_ID, {
        brief: 'A shorter brief.',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_FROZEN' })
    await expect(
      scenarios.decideElement(fx.author, versionId, 'claim', claims.get('C1')!, {
        decision: 'rejected',
        note: 'Too late.',
        openedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VERSION_FROZEN' })
    await expect(
      scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true }),
    ).rejects.toMatchObject({ code: 'VERSION_FROZEN' })

    // And the refusals changed nothing.
    const after = await scenarios.getPackageVersion(fx.author, versionId)
    expect(after.confirmedAt).toEqual(view.confirmedAt)
    expect(after.confirmationRecord).toHaveLength(decided.length)
  })
})

// ---------------------------------------------------------------------------------------------
// regenerateVersion (FR-195)
// ---------------------------------------------------------------------------------------------

describe('regenerateVersion (FR-195)', () => {
  it('copies the confirmed version into a draft version 2 whose claims carry new ids', async () => {
    const { packageId, versionId } = await draftPackage()
    await decideEveryElement(versionId)
    await scenarios.confirmVersion(fx.author, versionId, { teachingNoteChecked: true })
    const before = await claimIdsByKey(versionId)

    const next = await scenarios.regenerateVersion(fx.author, versionId, {
      reason: 'The payback figure needs re-authoring after the pilot correction.',
    })
    expect(next.packageId).toBe(packageId)
    expect(next.versionId).not.toBe(versionId)

    const second = await scenarios.getPackageVersion(fx.author, next.versionId)
    expect(second).toMatchObject({
      packageId,
      version: 2,
      status: 'draft',
      confirmedAt: null,
      teachingNoteChecked: false,
      confirmationRecord: [],
      capabilities: { canEdit: true, canConfirm: true },
    })
    // The copy is the same package: every element came with it, and it validates as the source did.
    expect(second.counts).toEqual((await scenarios.getPackageVersion(fx.author, versionId)).counts)
    expect(second.validation).toEqual({ ok: true, failures: [] })
    expect(second.seedRecord).toMatchObject({ caseTitle: SEED.caseTitle })

    // FR-195: the claims of version 2 are new rows, so runs taken on version 1 keep their ids.
    const after = await claimIdsByKey(next.versionId)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [key, id] of after) {
      expect(id).not.toBe(before.get(key))
    }
    const unchanged = await claimIdsByKey(versionId)
    expect([...unchanged.entries()].sort()).toEqual([...before.entries()].sort())

    // Version 1 is untouched and still confirmed; the family now holds both.
    const family = await scenarios.getPackage(fx.author, packageId)
    expect(family.versionCount).toBe(2)
    expect(family.versions.map((row) => [row.version, row.status])).toEqual([
      [2, 'draft'],
      [1, 'confirmed'],
    ])
    expect(family.latestVersion).toMatchObject({ version: 2, status: 'draft' })

    // A copied element is not a decided element: version 2 starts its own confirmation pass.
    const refused = await refusal(
      scenarios.confirmVersion(fx.author, next.versionId, { teachingNoteChecked: true }),
    )
    expect(refused.code).toBe('ELEMENTS_UNCONFIRMED')
    expect(unconfirmedElements(refused.details)).toHaveLength(ELEMENT_COUNT)
  })
})
