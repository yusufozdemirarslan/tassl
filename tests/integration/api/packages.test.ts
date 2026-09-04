// Step 5.2 — every endpoint of docs/tech/07-api-spec.md §6 that this step owns, called as a real
// `Request` through the handler `src/app/api/v1/**/route.ts` exports. Each row gets its happy path,
// the error envelope of every code the spec names for it, and the cells of 08-auth-authz.md §4 the
// route answers — including the three the phase file calls out by name: a student is refused the
// claim object view, a TA is given the version view without its seed record, and an id belonging to
// another institution answers 404 rather than 403.
//
// The two generation rows (`POST` and `GET /package-versions/{versionId}/generation`) and the
// element-level `.../regenerate` row belong to Phase 12 and have no handler yet.
//
// The fixture package is a hand-written `PackageExport` that breaks none of the thirty rules of
// `validatePackage`: it is what lets `POST .../confirm` be tested green rather than only by its
// refusals, and what gives every other route a version with real documents, claims and states to
// answer about. It is deliberately not the Meridian Roast fixture of Step 5.3 — that one is the
// product's own content and belongs to the seed; this one exists to exercise the endpoints.
//
// `asUser()` supplies the session cookie; non-GET requests carry `X-Requested-With: tassl`, the
// CSRF header `defineRoute` requires of cookie-authenticated mutations (08 §2.7).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { toAppError } from '@/server/http/errors'
import { SINGLETON_ELEMENT_ID } from '@/server/modules/scenarios/schema'
import type { PackageExport } from '@/server/modules/scenarios/schema'

type OrgPackages = typeof import('@/app/api/v1/institutions/[orgId]/packages/route')
type ImportRoute = typeof import('@/app/api/v1/institutions/[orgId]/packages/import/route')
type PackageRoute = typeof import('@/app/api/v1/packages/[packageId]/route')
type VersionRoute = typeof import('@/app/api/v1/package-versions/[versionId]/route')
type ExportRoute = typeof import('@/app/api/v1/package-versions/[versionId]/export/route')
type ClaimRoute = typeof import('@/app/api/v1/package-versions/[versionId]/claims/[claimId]/route')
type ElementRoute =
  typeof import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/route')
type DecisionRoute =
  typeof import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/decision/route')
type ConfirmRoute = typeof import('@/app/api/v1/package-versions/[versionId]/confirm/route')
type RegenerateRoute = typeof import('@/app/api/v1/package-versions/[versionId]/regenerate/route')
type Factories = typeof import('@tests/factories')
type ScenariosRepo = typeof import('@/server/modules/scenarios/repository')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let orgPackages: OrgPackages
let importRoute: ImportRoute
let packageRoute: PackageRoute
let versionRoute: VersionRoute
let exportRoute: ExportRoute
let claimRoute: ClaimRoute
let elementRoute: ElementRoute
let decisionRoute: DecisionRoute
let confirmRoute: ConfirmRoute
let regenerateRoute: RegenerateRoute
let f: Factories
let repo: ScenariosRepo

type Called = { status: number; headers: Headers; body: Record<string, unknown> | null }

/** Calls one route handler with a session, the CSRF header, and the matched path parameters. */
async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  const request = new Request(`http://localhost:3000/api/v1${options.path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? null : (JSON.parse(text) as never),
  }
}

const errorCode = (called: Called): unknown =>
  (called.body?.error as { code?: unknown } | undefined)?.code

const errorDetails = (called: Called): Record<string, unknown> =>
  ((called.body?.error as { details?: unknown } | undefined)?.details ?? {}) as Record<
    string,
    unknown
  >

/** Elements the export format identifies by name rather than by order, indexed by that name. */
const byKey = <T extends { key: string }>(rows: readonly T[]): Record<string, T> =>
  Object.fromEntries(rows.map((row) => [row.key, row]))

const byClaimKey = <T extends { claimKey: string }>(rows: readonly T[]): Record<string, T> =>
  Object.fromEntries(rows.map((row) => [row.claimKey, row]))

// ---------------------------------------------------------------------------------------------
// The fixture package: a document that passes every rule of `validatePackage`
// ---------------------------------------------------------------------------------------------

const CONCEPTS = ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification']

/** Exactly three sentences, which is what `COUNTERFACTUAL_SENTENCES` asks for. */
const COUNTERFACTUAL =
  'A twenty percent worse churn would have pushed payback past fourteen months. ' +
  'The premium shift would then have failed its own test. ' +
  'The defensible response was to hold spend in the value tier.'

type DocumentExport = PackageExport['documents'][number]
type ClaimExport = PackageExport['claims'][number]
type ClaimStateExport = PackageExport['variants'][number]['claimStates'][number]
type QuestionExport = PackageExport['defenseQuestions'][number]
type ReadinessExport = PackageExport['readinessItems'][number]

function document(
  key: string,
  title: string,
  role: DocumentExport['role'],
  datedOn: string,
  body: string,
  position: number,
  refs: { supersededByKey?: string; stakeholderKey?: string } = {},
): DocumentExport {
  return {
    key,
    title,
    author: 'Meridian analysis desk',
    datedOn,
    role,
    position,
    body,
    supersededByKey: refs.supersededByKey ?? null,
    stakeholderKey: refs.stakeholderKey ?? null,
  }
}

function documents(): DocumentExport[] {
  return [
    document(
      'D1',
      'Positioning deck',
      'superseded',
      '2025-02-10',
      'Payback on the premium tier is eleven months on the first pilot cohort.',
      0,
      { supersededByKey: 'D2', stakeholderKey: 'growth_lead' },
    ),
    document(
      'D2',
      'Retention memo',
      'supporting',
      '2025-06-01',
      'Payback on the premium tier is fourteen months once the second cohort is included.',
      1,
    ),
    document(
      'D3',
      'Founder note',
      'interpretation_as_fact',
      '2025-03-04',
      'The founder writes that the value tier is saturated, and states it as settled fact.',
      2,
      { stakeholderKey: 'finance_lead' },
    ),
    document(
      'D4',
      'Supplier contract',
      'irrelevant',
      '2024-11-20',
      'The green-bean supplier contract runs to 2027; it is accurate and beside the point.',
      3,
    ),
    document(
      'D5',
      'Pilot readout',
      'supporting',
      '2025-05-12',
      'The premium pilot readout lists sign-ups, churn and basket size by month.',
      4,
    ),
    document(
      'D6',
      'Channel cost table',
      'supporting',
      '2025-04-02',
      'Cost per acquisition for each of the four channels, measured in April.',
      5,
    ),
  ]
}

function claim(
  key: string,
  text: string,
  fields: {
    importance: ClaimExport['importance']
    consequenceLevel: ClaimExport['consequenceLevel']
    conceptKey: string
    position: number
    sourceDocumentKey?: string
    weaklySourced?: boolean
    escalatable?: boolean
    escalationReply?: string
  },
): ClaimExport {
  return {
    key,
    text,
    sourceKind: fields.sourceDocumentKey ? 'document' : 'assistant',
    sourceDocumentKey: fields.sourceDocumentKey ?? null,
    sourcePassage: '',
    importance: fields.importance,
    consequenceLevel: fields.consequenceLevel,
    verificationCost: 'cheap',
    weaklySourced: fields.weaklySourced ?? false,
    volatile: false,
    conceptKey: fields.conceptKey,
    carriedValues: [],
    triggerPhrases: [],
    triggerDescription: '',
    escalatable: fields.escalatable ?? false,
    escalationReply: fields.escalationReply ?? null,
    rationale: '',
    position: fields.position,
  }
}

function claims(): ClaimExport[] {
  return [
    claim('C1', 'Premium payback lands at eleven months on the pilot cohort.', {
      importance: 'load_bearing',
      consequenceLevel: 'high',
      conceptKey: 'payback_period',
      sourceDocumentKey: 'D1',
      position: 0,
    }),
    claim('C2', 'The channel cost table still reflects the terms in force today.', {
      importance: 'supporting',
      consequenceLevel: 'medium',
      conceptKey: 'segmentation',
      sourceDocumentKey: 'D6',
      weaklySourced: true,
      position: 1,
    }),
    claim('C3', 'The survey behind the saturation estimate carries a wide margin of error.', {
      importance: 'supporting',
      consequenceLevel: 'medium',
      conceptKey: 'ai_verification',
      escalatable: true,
      escalationReply: 'A colleague confirms the survey ran on 140 respondents in one district.',
      position: 2,
    }),
    claim('C4', 'Footfall in the north district rose slightly last spring.', {
      importance: 'supporting',
      consequenceLevel: 'low',
      conceptKey: 'segmentation',
      position: 3,
    }),
    claim('C5', 'The roastery added a second grinder over the summer.', {
      importance: 'supporting',
      consequenceLevel: 'low',
      conceptKey: 'segmentation',
      position: 4,
    }),
    claim('C6', 'Retention holds above seventy percent after the third month.', {
      importance: 'load_bearing',
      consequenceLevel: 'high',
      conceptKey: 'retention_cohorts',
      sourceDocumentKey: 'D5',
      position: 5,
    }),
  ]
}

/** The five claims both variants share; only C1 differs, which is what the plant means. */
function sharedStates(): ClaimStateExport[] {
  return [
    {
      claimKey: 'C2',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'verify',
      planted: false,
      verificationPaths: {
        source_trace: {
          document_key: 'D6',
          passage: 'Cost per acquisition by channel, April.',
          dated_on: '2025-04-02',
          author: 'Finance',
        },
      },
    },
    {
      claimKey: 'C3',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'escalate',
      planted: false,
      verificationPaths: {},
    },
    {
      claimKey: 'C4',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      planted: false,
      verificationPaths: {},
    },
    {
      claimKey: 'C5',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      planted: false,
      verificationPaths: {},
    },
    {
      claimKey: 'C6',
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'verify',
      planted: false,
      verificationPaths: {
        replication_check: { result: 'The cohort comparison reproduces seventy-one percent.' },
      },
    },
  ]
}

function variants(): PackageExport['variants'] {
  return [
    {
      key: 'defective',
      label: 'Defective',
      claimStates: [
        {
          claimKey: 'C1',
          evidenceStatus: 'defective',
          failureFamily: 'stale_evidence',
          warrantedStance: 'challenge',
          planted: true,
          verificationPaths: {
            source_trace: {
              document_key: 'D1',
              passage: 'Payback on the premium tier is eleven months.',
              dated_on: '2025-02-10',
              author: 'Growth team',
            },
          },
        },
        ...sharedStates(),
      ],
    },
    {
      key: 'sound',
      label: 'Sound',
      claimStates: [
        {
          claimKey: 'C1',
          evidenceStatus: 'sound',
          failureFamily: null,
          warrantedStance: 'accept',
          planted: false,
          verificationPaths: {
            source_trace: {
              document_key: 'D2',
              passage: 'Payback on the premium tier is fourteen months.',
              dated_on: '2025-06-01',
              author: 'Finance',
            },
          },
        },
        ...sharedStates(),
      ],
    },
  ]
}

function question(
  key: string,
  kind: QuestionExport['kind'],
  template: string,
  position: number,
  fields: { claimKey?: string; assumptionIndex?: number; isDefault?: boolean } = {},
): QuestionExport {
  return {
    key,
    kind,
    claimKey: fields.claimKey ?? null,
    assumptionIndex: fields.assumptionIndex ?? null,
    template,
    condition: {},
    followUp: '',
    expectedAnswerNotes: '',
    isDefault: fields.isDefault ?? false,
    position,
  }
}

/** One provenance and one verification question per claim, the three frame assumptions, the four
 *  singletons the bank needs, and the six defaults a short run falls back on (PRD §7.18 (12)). */
function defenseQuestions(): QuestionExport[] {
  const rows: QuestionExport[] = []
  const next = () => rows.length
  for (const row of claims()) {
    rows.push(
      question(`QP${row.key}`, 'provenance', `Where does {claim_text} come from?`, next(), {
        claimKey: row.key,
      }),
    )
    rows.push(
      question(
        `QV${row.key}`,
        'verification',
        `What would you check to test {claim_text}?`,
        next(),
        {
          claimKey: row.key,
        },
      ),
    )
  }
  for (const index of [0, 1, 2]) {
    rows.push(
      question(
        `QA${index}`,
        'assumption',
        'What happens to the decision if {assumption} is wrong?',
        next(),
        { assumptionIndex: index },
      ),
    )
  }
  rows.push(question('QC', 'confidence', 'How confident are you in {stance}?', next()))
  rows.push(
    question('QF', 'frame_vs_response', 'Did the response you locked match the frame?', next()),
  )
  rows.push(question('QX', 'counterfactual', 'What if {figure} were twenty percent worse?', next()))
  rows.push(question('QG', 'figure_provenance', 'Where did the figure {figure} come from?', next()))
  for (let index = 1; index <= 6; index += 1) {
    rows.push(
      question(
        `QD${index}`,
        'default',
        `Default question ${index}: what did you rely on here?`,
        next(),
        { isDefault: true },
      ),
    )
  }
  return rows
}

const READINESS_PLAN = [
  ['foundation', 6],
  ['defect_concept', 4],
  ['ai_behavior', 6],
] as const

/** 6/4/6 with four distinctly keyed options each; no stem echoes a claim (`READINESS_SPLIT`). */
function readinessItems(): ReadinessExport[] {
  let counter = 0
  return READINESS_PLAN.flatMap(([category, count]) =>
    Array.from({ length: count }, (): ReadinessExport => {
      counter += 1
      return {
        key: `R${counter}`,
        category,
        conceptKey: CONCEPTS[counter % CONCEPTS.length] as string,
        stem: `Item ${counter}: which measure answers this ${category.replace(/_/g, ' ')} question?`,
        options: [
          { key: 'a', text: 'The first measure.' },
          { key: 'b', text: 'The second measure.' },
          { key: 'c', text: 'The third measure.' },
          { key: 'd', text: 'The fourth measure.' },
        ],
        answerKey: 'a',
        position: counter - 1,
      }
    }),
  )
}

/** A complete package document under `familyKey`, valid against every rule of `validatePackage`. */
function fixtureExport(familyKey: string): PackageExport {
  return {
    schemaVersion: 1,
    package: {
      title: `Halden Roastworks (${familyKey})`,
      familyKey,
      discipline: 'marketing_strategy',
    },
    version: {
      conceptSet: [...CONCEPTS],
      brief:
        'Halden Roastworks must decide how much of next year’s marketing budget to move from the ' +
        'value tier to the premium subscription, and how fast. The board wants a number and a date.',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
      difficultyProfile: { estimate: 'moderate', note: '', uncalibrated: true },
      generalEscalationReply: 'A colleague reviews the claim and reports what the record supports.',
      debriefCounterfactual: COUNTERFACTUAL,
    },
    seedRecord: {
      caseTitle: 'Halden Roastworks (licensed case)',
      publisher: 'Tassl',
      licenseTerms: 'internal fixture',
      licensePermitsAdaptation: true,
      seedText: 'The licensed case this package was re-skinned from, kept for the record.',
      reskinLog: [
        { kind: 'renamed_entity', from: 'Meridian Roast', to: 'Halden Roastworks', note: '' },
        { kind: 'altered_number', from: '11 months', to: '14 months', note: '' },
        { kind: 'restructured_document', from: 'one deck', to: 'a deck and a memo', note: '' },
      ],
    },
    documents: documents(),
    stakeholders: [
      {
        key: 'growth_lead',
        name: 'Growth lead',
        roleTitle: 'Head of growth',
        positionStatement: 'The premium tier is where the next year of margin comes from.',
        incentives: 'Paid on premium sign-ups.',
        blindSpots: 'Reads the pilot cohort as the whole market.',
        contradictionPoint: 'Whether the value tier can absorb another price rise.',
        contradictsStakeholderKey: 'finance_lead',
      },
      {
        key: 'finance_lead',
        name: 'Finance lead',
        roleTitle: 'Head of finance',
        positionStatement: 'The value tier still pays for the roastery.',
        incentives: 'Paid on gross margin.',
        blindSpots: 'Discounts anything that has not yet shown up in a ledger.',
        contradictionPoint: null,
        contradictsStakeholderKey: null,
      },
    ],
    answerSpacePositions: [
      {
        key: 'hold_value_tier',
        kind: 'defensible',
        summary: 'Hold the spend in the value tier and re-measure after the next cohort.',
        ignoredEvidence: null,
        isMinimumCommitment: true,
        position: 0,
        supportingDocumentKeys: ['D2'],
      },
      {
        key: 'shift_bounded_share',
        kind: 'defensible',
        summary: 'Move a bounded share of the budget to premium and cap it at one quarter.',
        ignoredEvidence: null,
        isMinimumCommitment: false,
        position: 1,
        supportingDocumentKeys: ['D5'],
      },
      {
        key: 'move_sixty_percent',
        kind: 'evidence_inconsistent',
        summary: 'Move sixty percent of the budget to premium on the eleven-month payback.',
        ignoredEvidence: 'The eleven-month payback rests on a deck the retention memo supersedes.',
        isMinimumCommitment: false,
        position: 2,
        supportingDocumentKeys: [],
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
    claims: claims(),
    variants: variants(),
    probe: {
      claimKey: 'C2',
      originalPosition: 'The value tier is saturated and cannot absorb more spend.',
      scriptedReversal: 'On reflection you are right; the value tier has room after all.',
    },
    turn: {
      text: 'Premium pilot month-three retention is 61 percent, not 78.',
      voice: 'stakeholder_message',
      stakeholderKey: 'growth_lead',
      warrantsChange: true,
      proportionateResponse: 'revise',
      evidence: 'The corrected cohort table from the pilot readout.',
      disruptedAssumptionKeys: ['premium_payback_months'],
      windowClaimKeys: ['C6'],
    },
    defenseQuestions: defenseQuestions(),
    readinessItems: readinessItems(),
  }
}

/** The seed a `POST /institutions/{orgId}/packages` body carries; `seedText` has a 200-char floor. */
const SEED = {
  caseTitle: 'Halden Roastworks (licensed case)',
  publisher: 'Tassl',
  licenseTerms: 'internal fixture',
  licensePermitsAdaptation: true,
  seedText:
    'A regional coffee roaster with a value subscription tier and a premium tier decides how much ' +
    'of next year’s marketing budget to move between them, and how fast, against a retention ' +
    'record that has been revised once since the original positioning deck was written.',
}

// ---------------------------------------------------------------------------------------------
// The fixture: two institutions, six seats, one imported package and one created from a seed
// ---------------------------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof seed>>

/**
 * Each test gets its own seats.
 *
 * The rate limiter is a process-wide in-memory sliding window keyed by `write:{userId}` (D-026,
 * 10 §4: 60 writes a minute), and nothing in `truncateAll` reaches it — it is not a table. The
 * fixture below spends two write requests per test before a single assertion runs, so a suite of
 * this size sharing one instructor would exhaust that budget partway through and fail the rest of
 * the file with 429s that say nothing about the endpoints. Fresh ids per test keep each test's
 * fixture inside its own window; every other property of the fixture is unchanged.
 */
let seat = 0

async function seed() {
  seat += 1
  const who = (role: string): string => `api-packages-${role}-${seat}`

  const orgA = (await f.createInstitution('api-packages-a')).organization.id
  const orgB = (await f.createInstitution('api-packages-b')).organization.id

  const instructor = await f.createUser(who('instructor'))
  const author = await f.createUser(who('author'))
  const ta = await f.createUser(who('ta'))
  const student = await f.createUser(who('student'))
  const lead = await f.createUser(who('lead'))
  const editor = await f.createUser(who('editor'), {
    platformRole: 'tassl_scenario_editor',
  })
  const outsider = await f.createUser(who('outsider'))

  await f.addMember(orgA, instructor.id, 'instructor')
  await f.addMember(orgA, author.id, 'scenario_author')
  await f.addMember(orgA, ta.id, 'teaching_assistant')
  await f.addMember(orgA, student.id, 'student')
  await f.addMember(orgA, lead.id, 'program_lead')
  await f.addMember(orgA, editor.id, 'scenario_author')
  await f.addMember(orgB, outsider.id, 'instructor')

  const session = await asUser(instructor.id, { activeOrganizationId: orgA })

  // The package every read and write row is answered about: complete, valid, and confirmed element
  // by element, so `POST .../confirm` has something it can actually freeze.
  const imported = await call(importRoute.POST, {
    method: 'POST',
    path: `/institutions/${orgA}/packages/import`,
    session,
    params: { orgId: orgA },
    body: { ...fixtureExport('api-packages-fixture'), confirmOnImport: true },
  })
  if (imported.status !== 201) {
    throw new Error(`fixture import failed: ${imported.status} ${JSON.stringify(imported.body)}`)
  }
  const pkg = imported.body as unknown as { packageId: string; versionId: string }

  // A package with no elements decided, which is the only shape `ELEMENTS_UNCONFIRMED` can be seen in.
  const created = await call(orgPackages.POST, {
    method: 'POST',
    path: `/institutions/${orgA}/packages`,
    session,
    params: { orgId: orgA },
    body: {
      title: 'Undecided package',
      familyKey: 'api-packages-undecided',
      conceptSet: [...CONCEPTS],
      seed: SEED,
    },
  })
  if (created.status !== 201) {
    throw new Error(`seed package failed: ${created.status} ${JSON.stringify(created.body)}`)
  }
  const undecided = created.body as unknown as { packageId: string; versionId: string }

  // The other institution's own package, for the cross-tenant rows.
  const otherPackage = await f.createPackageVersion(orgB, 'api-packages-other', {
    createdBy: outsider.id,
  })

  const full = await repo.findVersionFull(orgA, pkg.versionId)
  if (!full) throw new Error('the imported version is not in institution A')

  const claimIdByKey = new Map(full.claims.map((row) => [row.key, row.id]))
  const documentIdByKey = new Map(full.documents.map((row) => [row.key, row.id]))
  const variantIdByKey = new Map(full.variants.map((row) => [row.key, row.id]))

  return {
    orgA,
    orgB,
    instructor,
    author,
    ta,
    student,
    lead,
    editor,
    outsider,
    pkg,
    undecided,
    otherPackage,
    full,
    claimIdByKey,
    documentIdByKey,
    variantIdByKey,
  }
}

let fx: Fixture

const sessionFor = (user: UserRow, orgId: string | null): Promise<Headers> =>
  asUser(user.id, { activeOrganizationId: orgId })

const asInstructor = (): Promise<Headers> => sessionFor(fx.instructor, fx.orgA)
const asAuthor = (): Promise<Headers> => sessionFor(fx.author, fx.orgA)
const asTa = (): Promise<Headers> => sessionFor(fx.ta, fx.orgA)
const asStudent = (): Promise<Headers> => sessionFor(fx.student, fx.orgA)
const asLead = (): Promise<Headers> => sessionFor(fx.lead, fx.orgA)
const asEditor = (): Promise<Headers> => sessionFor(fx.editor, fx.orgA)
const asOutsider = (): Promise<Headers> => sessionFor(fx.outsider, fx.orgB)

const claimId = (key: string): string => {
  const id = fx.claimIdByKey.get(key)
  if (!id) throw new Error(`no claim keyed ${key}`)
  return id
}

const documentId = (key: string): string => {
  const id = fx.documentIdByKey.get(key)
  if (!id) throw new Error(`no document keyed ${key}`)
  return id
}

const questionId = (key: string): string => {
  const id = fx.full.defenseQuestions.find((row) => row.key === key)?.id
  if (!id) throw new Error(`no defense question keyed ${key}`)
  return id
}

/** Confirms and freezes the fixture version, which every `VERSION_FROZEN` row needs first. */
async function freezeFixtureVersion(): Promise<void> {
  const frozen = await call(confirmRoute.POST, {
    method: 'POST',
    path: `/package-versions/${fx.pkg.versionId}/confirm`,
    session: await asInstructor(),
    params: { versionId: fx.pkg.versionId },
    body: { teachingNoteChecked: true },
  })
  if (frozen.status !== 200) {
    throw new Error(`confirm failed: ${frozen.status} ${JSON.stringify(frozen.body)}`)
  }
}

beforeAll(async () => {
  orgPackages = await import('@/app/api/v1/institutions/[orgId]/packages/route')
  importRoute = await import('@/app/api/v1/institutions/[orgId]/packages/import/route')
  packageRoute = await import('@/app/api/v1/packages/[packageId]/route')
  versionRoute = await import('@/app/api/v1/package-versions/[versionId]/route')
  exportRoute = await import('@/app/api/v1/package-versions/[versionId]/export/route')
  claimRoute = await import('@/app/api/v1/package-versions/[versionId]/claims/[claimId]/route')
  elementRoute =
    await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/route')
  decisionRoute =
    await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/decision/route')
  confirmRoute = await import('@/app/api/v1/package-versions/[versionId]/confirm/route')
  regenerateRoute = await import('@/app/api/v1/package-versions/[versionId]/regenerate/route')
  f = await import('@tests/factories')
  repo = await import('@/server/modules/scenarios/repository')
})

beforeEach(async () => {
  await truncateAll()
  fx = await seed()
})

afterAll(async () => {
  await truncateAll()
})

describe('GET /institutions/{orgId}/packages', () => {
  it('lists the institution packages with the latest version and the family warning', async () => {
    const listed = await call(orgPackages.GET, {
      path: `/institutions/${fx.orgA}/packages?limit=10`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
    })

    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ nextCursor: null })
    const items = listed.body?.items as { familyKey: string; warnings: string[] }[]
    expect(items.map((row) => row.familyKey).sort()).toEqual([
      'api-packages-fixture',
      'api-packages-undecided',
    ])
    const fixtureRow = items.find((row) => row.familyKey === 'api-packages-fixture')
    // D-083: the family carries no `unacceptable_route` defect, so the shelf says so and lets it be.
    expect(fixtureRow).toMatchObject({
      versionCount: 1,
      warnings: ['FAMILY_LACKS_ETHICAL_DEFECT'],
      latestVersion: { version: 1, status: 'draft', calibrationStatus: 'uncalibrated' },
    })
  })

  it('refuses a TA and a student, 404s another institution, and rejects an unknown parameter', async () => {
    for (const session of [await asTa(), await asStudent(), await asLead()]) {
      const denied = await call(orgPackages.GET, {
        path: `/institutions/${fx.orgA}/packages`,
        session,
        params: { orgId: fx.orgA },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }

    const crossTenant = await call(orgPackages.GET, {
      path: `/institutions/${fx.orgA}/packages`,
      session: await asOutsider(),
      params: { orgId: fx.orgA },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')

    const rejected = await call(orgPackages.GET, {
      path: `/institutions/${fx.orgA}/packages?sort=title`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
    })
    expect(rejected.status).toBe(400)
    expect(errorCode(rejected)).toBe('VALIDATION_ERROR')
  })
})

describe('POST /institutions/{orgId}/packages', () => {
  it('creates a package family with a version 1 draft from a seed', async () => {
    const created = await call(orgPackages.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        title: 'Halden Roastworks',
        familyKey: 'halden-roastworks',
        conceptSet: [...CONCEPTS],
        seed: SEED,
      },
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      packageId: expect.any(String),
      versionId: expect.any(String),
    })

    const versionId = (created.body as unknown as { versionId: string }).versionId
    const read = await call(versionRoute.GET, {
      path: `/package-versions/${versionId}`,
      session: await asAuthor(),
      params: { versionId },
    })
    expect(read.body).toMatchObject({
      version: 1,
      status: 'draft',
      familyKey: 'halden-roastworks',
      // Generation is Phase 12: the version is created empty and filled by hand or by import.
      counts: { claims: 0, documents: 0, variants: 2 },
      capabilities: { canEdit: true, canConfirm: true, canRegenerate: false },
    })
  })

  it('refuses an unconfirmed license, a duplicate family key, and a student', async () => {
    const unlicensed = await call(orgPackages.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        title: 'Unlicensed',
        familyKey: 'api-packages-unlicensed',
        conceptSet: [...CONCEPTS],
        seed: { ...SEED, licensePermitsAdaptation: false },
      },
    })
    expect(unlicensed.status).toBe(400)
    expect(errorCode(unlicensed)).toBe('LICENSE_NOT_CONFIRMED')

    const duplicate = await call(orgPackages.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        title: 'Same family',
        familyKey: 'api-packages-fixture',
        conceptSet: [...CONCEPTS],
        seed: SEED,
      },
    })
    expect(duplicate.status).toBe(409)
    expect(errorCode(duplicate)).toBe('CONFLICT')

    const tooFewConcepts = await call(orgPackages.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        title: 'Two concepts',
        familyKey: 'api-packages-thin',
        conceptSet: ['payback_period', 'segmentation'],
        seed: SEED,
      },
    })
    expect(tooFewConcepts.status).toBe(400)
    expect(errorCode(tooFewConcepts)).toBe('VALIDATION_ERROR')

    for (const session of [await asStudent(), await asTa()]) {
      const denied = await call(orgPackages.POST, {
        method: 'POST',
        path: `/institutions/${fx.orgA}/packages`,
        session,
        params: { orgId: fx.orgA },
        body: {
          title: 'Not mine',
          familyKey: 'api-packages-not-mine',
          conceptSet: [...CONCEPTS],
          seed: SEED,
        },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }
  })
})

describe('POST /institutions/{orgId}/packages/import', () => {
  it('imports a package JSON and reports the rules it passes', async () => {
    const imported = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: fixtureExport('api-packages-second'),
    })

    expect(imported.status).toBe(201)
    expect(imported.body).toMatchObject({ validation: { ok: true, failures: [] } })

    const versionId = (imported.body as unknown as { versionId: string }).versionId
    const read = await call(versionRoute.GET, {
      path: `/package-versions/${versionId}`,
      session: await asAuthor(),
      params: { versionId },
    })
    expect(read.body).toMatchObject({
      status: 'draft',
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
      // Imported without `confirmOnImport`, so nothing has been signed for yet.
      confirmationRecord: [],
    })
  })

  it('refuses a document that is not a package export, an invalid confirm-on-import, and a TA', async () => {
    const notAnExport = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: { schemaVersion: 99, package: { title: 'Nope' } },
    })
    expect(notAnExport.status).toBe(400)
    expect(errorCode(notAnExport)).toBe('IMPORT_INVALID')

    const danglingReference = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        ...fixtureExport('api-packages-dangling'),
        // A document that names a stakeholder the document does not define.
        documents: documents().map((row) =>
          row.key === 'D5' ? { ...row, stakeholderKey: 'nobody' } : row,
        ),
      },
    })
    expect(danglingReference.status).toBe(400)
    expect(errorCode(danglingReference)).toBe('IMPORT_INVALID')
    expect(errorDetails(danglingReference)).toMatchObject({
      reference: 'stakeholder',
      key: 'nobody',
    })

    const broken = fixtureExport('api-packages-broken')
    const invalid = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: {
        ...broken,
        version: { ...broken.version, brief: '' },
        confirmOnImport: true,
      },
    })
    expect(invalid.status).toBe(422)
    expect(errorCode(invalid)).toBe('PACKAGE_INVALID')
    expect(errorDetails(invalid)['rules']).toContain('BRIEF_TOO_LONG')

    const denied = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asTa(),
      params: { orgId: fx.orgA },
      body: fixtureExport('api-packages-by-a-ta'),
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('GET /packages/{packageId}', () => {
  it('returns the family with every version, for an author and for a reviewer', async () => {
    for (const session of [await asAuthor(), await asTa()]) {
      const read = await call(packageRoute.GET, {
        path: `/packages/${fx.pkg.packageId}`,
        session,
        params: { packageId: fx.pkg.packageId },
      })
      expect(read.status).toBe(200)
      expect(read.body).toMatchObject({
        id: fx.pkg.packageId,
        familyKey: 'api-packages-fixture',
        versionCount: 1,
        warnings: ['FAMILY_LACKS_ETHICAL_DEFECT'],
      })
      const versions = read.body?.versions as { id: string; version: number }[]
      expect(versions).toEqual([expect.objectContaining({ id: fx.pkg.versionId, version: 1 })])
    }
  })

  it('refuses a student and answers 404 for a package in another institution', async () => {
    const denied = await call(packageRoute.GET, {
      path: `/packages/${fx.pkg.packageId}`,
      session: await asStudent(),
      params: { packageId: fx.pkg.packageId },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    const crossTenant = await call(packageRoute.GET, {
      path: `/packages/${fx.otherPackage.pkg.id}`,
      session: await asAuthor(),
      params: { packageId: fx.otherPackage.pkg.id },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})

describe('GET /package-versions/{versionId}', () => {
  it('returns the version with its counts, confirmation record, measures and seed record', async () => {
    const read = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
    })

    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      id: fx.pkg.versionId,
      packageId: fx.pkg.packageId,
      version: 1,
      status: 'draft',
      calibrationStatus: 'uncalibrated',
      teachingNoteChecked: false,
      confirmedAt: null,
      validation: { ok: true, failures: [] },
      warnings: ['FAMILY_LACKS_ETHICAL_DEFECT'],
      seedRecord: { caseTitle: 'Halden Roastworks (licensed case)', publisher: 'Tassl' },
      capabilities: { canEdit: true, canConfirm: true, canRegenerate: false },
    })
    // Every element was signed for by the import, so nothing is left undecided and no edit was made.
    const record = read.body?.confirmationRecord as { decision: string }[]
    expect(record.length).toBeGreaterThan(60)
    expect(new Set(record.map((row) => row.decision))).toEqual(new Set(['confirmed']))
    expect(read.body?.measures).toMatchObject({
      editRate: 0,
      rejectedShare: 0,
      generationPasses: 0,
    })
  })

  it('omits the seed record for a TA, admits a program lead, refuses a student, 404s cross-tenant', async () => {
    // FR-028 and 08 §4: the seed record is the licensed case behind the package; a TA never reads it.
    const asReviewer = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asTa(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(asReviewer.status).toBe(200)
    expect(asReviewer.body?.seedRecord).toBeNull()
    expect(asReviewer.body?.capabilities).toMatchObject({ canEdit: false, canConfirm: false })

    // 08 §4 gives the program lead the measures, which hang off this view.
    const asProgramLead = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asLead(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(asProgramLead.status).toBe(200)
    expect(asProgramLead.body?.seedRecord).toBeNull()
    expect(asProgramLead.body?.measures).toBeDefined()

    const denied = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asStudent(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    const crossTenant = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asOutsider(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })

  /**
   * 08 §4 gives the program lead "✓ org (measures only)" on this line, which is the institution's
   * own accounting of how long confirmation took and who signed — not the brief, not the
   * element-by-element record, and above all not the rule failures, which name where the defects
   * are. So the content fields come back empty rather than absent (one shape serves the endpoint)
   * and `restricted` is what lets the screen say so instead of drawing a blank package.
   */
  it('empties the package for a program lead, keeps their measures, and says it is restricted', async () => {
    const read = async (session: Headers): Promise<Called> =>
      call(versionRoute.GET, {
        path: `/package-versions/${fx.pkg.versionId}`,
        session,
        params: { versionId: fx.pkg.versionId },
      })

    const lead = await read(await asLead())
    const instructor = await read(await asInstructor())

    expect(lead.status).toBe(200)
    expect(lead.body).toMatchObject({
      restricted: true,
      brief: '',
      conceptSet: [],
      generalEscalationReply: '',
      debriefCounterfactual: '',
      confirmationRecord: [],
      validation: { ok: true, failures: [] },
      warnings: [],
      seedRecord: null,
    })
    // The measures are the whole of what they get, and they are the institution's real numbers.
    expect(lead.body?.measures).toEqual(instructor.body?.measures)
    expect(Object.keys(lead.body?.measures as object).sort()).toEqual([
      'editRate',
      'generationPasses',
      'rejectedShare',
      'reviewMsPerElement',
      'seedToConfirmedMs',
    ])
    // The version is still identified, so the screen can name what it is refusing to show.
    expect(lead.body).toMatchObject({
      id: fx.pkg.versionId,
      familyKey: 'api-packages-fixture',
      version: 1,
      status: 'draft',
    })

    // The control: an instructor on the same version gets the package itself.
    expect(instructor.status).toBe(200)
    expect(instructor.body?.restricted).toBe(false)
    expect(instructor.body?.brief).toContain('Halden Roastworks')
    expect(instructor.body?.conceptSet).toEqual(CONCEPTS)
    expect(instructor.body?.warnings).toEqual(['FAMILY_LACKS_ETHICAL_DEFECT'])
    expect((instructor.body?.confirmationRecord as unknown[]).length).toBeGreaterThan(60)

    // And the rule failures in particular: with a broken brief the instructor is told which rule
    // broke and on which element, while the lead's report stays empty.
    const emptied = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
      session: await asInstructor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'brief',
        elementId: SINGLETON_ELEMENT_ID,
      },
      body: { brief: '' },
    })
    expect(emptied.status).toBe(200)

    const brokenForInstructor = await read(await asInstructor())
    expect(
      (brokenForInstructor.body?.validation as { failures: { code: string }[] }).failures.map(
        (failure) => failure.code,
      ),
    ).toContain('BRIEF_TOO_LONG')

    const brokenForLead = await read(await asLead())
    expect(brokenForLead.body?.validation).toEqual({ ok: true, failures: [] })
    expect(brokenForLead.body?.restricted).toBe(true)
  })
})

describe('GET /package-versions/{versionId}/export', () => {
  it('answers the package JSON as a download that round-trips every element key', async () => {
    const exported = await call(exportRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/export`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId },
    })

    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-disposition')).toBe(
      'attachment; filename="tassl-package-api-packages-fixture.json"',
    )

    const document = exported.body as unknown as PackageExport
    const source = fixtureExport('api-packages-fixture')
    expect(document.schemaVersion).toBe(source.schemaVersion)
    expect(document.package).toEqual(source.package)
    expect(document.version).toEqual(source.version)
    expect(document.seedRecord).toEqual(source.seedRecord)
    // The elements that carry a `position` come back in it; stakeholders and claim states do not
    // carry one, so they are compared by the key that identifies them instead of by order.
    expect(document.documents).toEqual(source.documents)
    expect(document.answerSpacePositions).toEqual(source.answerSpacePositions)
    expect(document.namedFields).toEqual(source.namedFields)
    expect(document.claims).toEqual(source.claims)
    expect(document.probe).toEqual(source.probe)
    expect(document.turn).toEqual(source.turn)
    expect(document.defenseQuestions).toEqual(source.defenseQuestions)
    expect(document.readinessItems).toEqual(source.readinessItems)
    expect(byKey(document.stakeholders)).toEqual(byKey(source.stakeholders))
    expect(document.variants.map((variant) => variant.key)).toEqual(['defective', 'sound'])
    for (const [index, variant] of document.variants.entries()) {
      const authored = source.variants[index] as PackageExport['variants'][number]
      expect(variant.label).toBe(authored.label)
      expect(byClaimKey(variant.claimStates)).toEqual(byClaimKey(authored.claimStates))
    }
  })

  it('admits a reviewer, refuses a program lead and a student, and 404s cross-tenant', async () => {
    const reviewer = await call(exportRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/export`,
      session: await asTa(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(reviewer.status).toBe(200)

    for (const session of [await asLead(), await asStudent()]) {
      const denied = await call(exportRoute.GET, {
        path: `/package-versions/${fx.pkg.versionId}/export`,
        session,
        params: { versionId: fx.pkg.versionId },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }

    const crossTenant = await call(exportRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/export`,
      session: await asOutsider(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})

describe('GET /package-versions/{versionId}/claims/{claimId}', () => {
  it('returns the claim, its source document, both variant states and its confirmation', async () => {
    const read = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })

    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      key: 'C1',
      text: 'Premium payback lands at eleven months on the pilot cohort.',
      importance: 'load_bearing',
      consequenceLevel: 'high',
      conceptKey: 'payback_period',
      source: { key: 'D1', title: 'Positioning deck', datedOn: '2025-02-10' },
      confirmation: { elementType: 'claim', decision: 'confirmed' },
    })
    const states = read.body?.states as {
      variantKey: string
      evidenceStatus: string
      failureFamily: string | null
      warrantedStance: string
      planted: boolean
      verificationPaths: { source_trace?: { document_id: string } }
    }[]
    expect(states.map((state) => state.variantKey)).toEqual(['defective', 'sound'])
    expect(states[0]).toMatchObject({
      evidenceStatus: 'defective',
      failureFamily: 'stale_evidence',
      warrantedStance: 'challenge',
      planted: true,
    })
    expect(states[1]).toMatchObject({
      evidenceStatus: 'sound',
      failureFamily: null,
      warrantedStance: 'accept',
      planted: false,
    })
    // The trace is stored by document id, not by the key the export carries (SYS-026).
    expect(states[0]?.verificationPaths.source_trace?.document_id).toBe(documentId('D1'))
  })

  it('narrows to one variant when ?variantId names one, and rejects an unknown parameter', async () => {
    const soundVariantId = fx.variantIdByKey.get('sound')
    const narrowed = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}?variantId=${soundVariantId}`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })
    expect(narrowed.status).toBe(200)
    const states = narrowed.body?.states as { variantKey: string }[]
    expect(states.map((state) => state.variantKey)).toEqual(['sound'])

    const rejected = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}?variant=sound`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })
    expect(rejected.status).toBe(400)
    expect(errorCode(rejected)).toBe('VALIDATION_ERROR')
  })

  it('refuses a student and a program lead, and 404s a claim outside the version or the tenant', async () => {
    // D-117: the claim object is the answer key — warranted stances, the planted flag, the paths.
    const denied = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}`,
      session: await asStudent(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    // 08 §4 leaves the program lead off this line; the measures are all they see of a package.
    const lead = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}`,
      session: await asLead(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })
    expect(lead.status).toBe(403)
    expect(errorCode(lead)).toBe('FORBIDDEN')

    const otherVersion = fx.undecided.versionId
    const wrongVersion = await call(claimRoute.GET, {
      path: `/package-versions/${otherVersion}/claims/${claimId('C1')}`,
      session: await asAuthor(),
      params: { versionId: otherVersion, claimId: claimId('C1') },
    })
    expect(wrongVersion.status).toBe(404)
    expect(errorCode(wrongVersion)).toBe('NOT_FOUND')

    const crossTenant = await call(claimRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/claims/${claimId('C1')}`,
      session: await asOutsider(),
      params: { versionId: fx.pkg.versionId, claimId: claimId('C1') },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})

describe('PATCH /package-versions/{versionId}/elements/{elementType}/{elementId}', () => {
  it('edits a draft element and records the edit as a confirmation', async () => {
    const patched = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/document/${documentId('D5')}`,
      session: await asAuthor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'document',
        elementId: documentId('D5'),
      },
      body: { body: 'The premium pilot readout now lists refunds beside churn.' },
    })

    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({
      elementType: 'document',
      elementId: documentId('D5'),
      key: 'D5',
      values: {
        body: 'The premium pilot readout now lists refunds beside churn.',
        title: 'Pilot readout',
      },
      // 10 §4: an author's edit is itself a confirmation.
      confirmation: { decision: 'edited', elementType: 'document' },
    })
  })

  it('edits a singleton addressed by the singleton id', async () => {
    const patched = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
      session: await asInstructor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'brief',
        elementId: SINGLETON_ELEMENT_ID,
      },
      body: { brief: 'Halden Roastworks must choose a budget share and a date.' },
    })
    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({
      elementType: 'brief',
      elementId: null,
      confirmation: { decision: 'edited' },
    })
  })

  it('refuses a renamed key, an unknown element, a TA, and a confirmed version', async () => {
    const renamed = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/document/${documentId('D5')}`,
      session: await asAuthor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'document',
        elementId: documentId('D5'),
      },
      body: { key: 'D9' },
    })
    expect(renamed.status).toBe(400)
    expect(errorCode(renamed)).toBe('VALIDATION_ERROR')

    const unknown = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/document/${claimId('C1')}`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId, elementType: 'document', elementId: claimId('C1') },
      body: { title: 'Nothing here' },
    })
    expect(unknown.status).toBe(404)
    expect(errorCode(unknown)).toBe('NOT_FOUND')

    for (const session of [await asTa(), await asStudent(), await asLead()]) {
      const denied = await call(elementRoute.PATCH, {
        method: 'PATCH',
        path: `/package-versions/${fx.pkg.versionId}/elements/document/${documentId('D5')}`,
        session,
        params: {
          versionId: fx.pkg.versionId,
          elementType: 'document',
          elementId: documentId('D5'),
        },
        body: { title: 'Not mine' },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }

    await freezeFixtureVersion()
    const frozen = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/document/${documentId('D5')}`,
      session: await asAuthor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'document',
        elementId: documentId('D5'),
      },
      body: { title: 'Too late' },
    })
    expect(frozen.status).toBe(409)
    expect(errorCode(frozen)).toBe('VERSION_FROZEN')
  })
})

/**
 * Every id in a PATCH body is a bare uuid, and the foreign keys behind them are global: nothing in
 * the database says `scenario_claims.source_document_id` names a document of the *same* version, and
 * `validatePackage` has no rule for it. An id from a neighbouring version — or, worse, from another
 * institution — was accepted here and dereferenced later by `GET .../claims/{claimId}`, which is a
 * cross-tenant read through a write that trusted the request body (08 §4 "Cross-tenant"). It also
 * plants a foreign key that stops the other version from being deleted.
 *
 * The neighbour below is a second complete package in the same institution, so the refusal cannot be
 * mistaken for the tenancy check that already answers 404 across institutions.
 */
describe('PATCH .../elements: a reference must name a row of the version being edited', () => {
  let other: NonNullable<Awaited<ReturnType<ScenariosRepo['findVersionFull']>>>

  beforeEach(async () => {
    const imported = await call(importRoute.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/packages/import`,
      session: await asAuthor(),
      params: { orgId: fx.orgA },
      body: fixtureExport('api-packages-neighbour'),
    })
    if (imported.status !== 201) {
      throw new Error(
        `neighbour import failed: ${imported.status} ${JSON.stringify(imported.body)}`,
      )
    }
    const versionId = (imported.body as unknown as { versionId: string }).versionId
    const full = await repo.findVersionFull(fx.orgA, versionId)
    if (!full) throw new Error('the neighbouring version is not in institution A')
    other = full
  })

  const otherDocumentId = (key: string): string => {
    const id = other.documents.find((row) => row.key === key)?.id
    if (!id) throw new Error(`the neighbouring version has no document keyed ${key}`)
    return id
  }

  const otherClaimId = (key: string): string => {
    const id = other.claims.find((row) => row.key === key)?.id
    if (!id) throw new Error(`the neighbouring version has no claim keyed ${key}`)
    return id
  }

  const patchElement = async (
    elementType: string,
    elementId: string,
    body: Record<string, unknown>,
  ): Promise<Called> =>
    call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/${elementType}/${elementId}`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId, elementType, elementId },
      body,
    })

  it('refuses a claim whose sourceDocumentId is a document of another version', async () => {
    const refused = await patchElement('claim', claimId('C1'), {
      sourceDocumentId: otherDocumentId('D2'),
    })
    expect(refused.status).toBe(400)
    expect(errorCode(refused)).toBe('VALIDATION_ERROR')
    expect(errorDetails(refused)).toMatchObject({ field: 'sourceDocumentId' })
  })

  it('refuses a document whose supersededByDocumentId is a document of another version', async () => {
    const refused = await patchElement('document', documentId('D1'), {
      supersededByDocumentId: otherDocumentId('D2'),
    })
    expect(refused.status).toBe(400)
    expect(errorCode(refused)).toBe('VALIDATION_ERROR')
    expect(errorDetails(refused)).toMatchObject({ field: 'supersededByDocumentId' })
  })

  it('refuses a defense question whose claimId is a claim of another version', async () => {
    const refused = await patchElement('defense_question', questionId('QPC1'), {
      claimId: otherClaimId('C1'),
    })
    expect(refused.status).toBe(400)
    expect(errorCode(refused)).toBe('VALIDATION_ERROR')
    expect(errorDetails(refused)).toMatchObject({ field: 'claimId' })
  })

  it('refuses a document that names itself as its own successor', async () => {
    // D1 is already `superseded`, so the row schema and the database check are both satisfied and
    // only the service stands between the request and a document that supersedes itself.
    const refused = await patchElement('document', documentId('D1'), {
      supersededByDocumentId: documentId('D1'),
    })
    expect(refused.status).toBe(400)
    expect(errorCode(refused)).toBe('VALIDATION_ERROR')
  })

  it('accepts a reference to a document of the same version', async () => {
    const patched = await patchElement('claim', claimId('C1'), {
      sourceDocumentId: documentId('D2'),
    })
    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({
      key: 'C1',
      values: { sourceDocumentId: documentId('D2') },
      confirmation: { decision: 'edited', elementType: 'claim' },
    })
  })

  it('left the neighbouring version alone through all of it', async () => {
    await patchElement('claim', claimId('C1'), { sourceDocumentId: otherDocumentId('D2') })
    const after = await repo.findVersionFull(fx.orgA, other.id)
    expect(after?.claims.map((row) => row.key).sort()).toEqual(
      other.claims.map((row) => row.key).sort(),
    )
    expect(after?.documents.map((row) => row.id).sort()).toEqual(
      other.documents.map((row) => row.id).sort(),
    )
  })
})

describe('POST /package-versions/{versionId}/elements/{elementType}/{elementId}/decision', () => {
  it('records a decision with the instant the element was opened', async () => {
    const openedAt = '2026-09-02T10:00:00.000Z'
    const decided = await call(decisionRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/elements/claim/${claimId('C3')}/decision`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId, elementType: 'claim', elementId: claimId('C3') },
      body: { decision: 'rejected', note: 'The margin of error needs a number.', openedAt },
    })

    expect(decided.status).toBe(200)
    expect(decided.body).toMatchObject({
      elementType: 'claim',
      elementId: claimId('C3'),
      decision: 'rejected',
      note: 'The margin of error needs a number.',
      openedAt,
      // The import wrote revision 1, so the author's own decision is the second.
      revision: 2,
    })
  })

  it('refuses a bad decision, a platform editor, a TA, and a confirmed version', async () => {
    const invalid = await call(decisionRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/elements/claim/${claimId('C3')}/decision`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId, elementType: 'claim', elementId: claimId('C3') },
      body: { decision: 'edited', openedAt: '2026-09-02T10:00:00.000Z' },
    })
    expect(invalid.status).toBe(400)
    expect(errorCode(invalid)).toBe('VALIDATION_ERROR')

    // 08 §4, PRD §8: nobody at Tassl signs for an element in place of the institution's authority.
    const platform = await call(decisionRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/elements/claim/${claimId('C3')}/decision`,
      session: await asEditor(),
      params: { versionId: fx.pkg.versionId, elementType: 'claim', elementId: claimId('C3') },
      body: { decision: 'confirmed', openedAt: '2026-09-02T10:00:00.000Z' },
    })
    expect(platform.status).toBe(403)
    expect(errorCode(platform)).toBe('FORBIDDEN')

    const denied = await call(decisionRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/elements/claim/${claimId('C3')}/decision`,
      session: await asTa(),
      params: { versionId: fx.pkg.versionId, elementType: 'claim', elementId: claimId('C3') },
      body: { decision: 'confirmed', openedAt: '2026-09-02T10:00:00.000Z' },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    await freezeFixtureVersion()
    const frozen = await call(decisionRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/elements/claim/${claimId('C3')}/decision`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId, elementType: 'claim', elementId: claimId('C3') },
      body: { decision: 'confirmed', openedAt: '2026-09-02T10:00:00.000Z' },
    })
    expect(frozen.status).toBe(409)
    expect(errorCode(frozen)).toBe('VERSION_FROZEN')
  })
})

describe('POST /package-versions/{versionId}/confirm', () => {
  it('freezes the version and answers with the confirmed view', async () => {
    const confirmed = await call(confirmRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/confirm`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
      body: { teachingNoteChecked: true },
    })

    expect(confirmed.status).toBe(200)
    expect(confirmed.body).toMatchObject({
      id: fx.pkg.versionId,
      status: 'confirmed',
      teachingNoteChecked: true,
      confirmedBy: fx.instructor.id,
      capabilities: { canEdit: false, canConfirm: false },
    })
    expect(confirmed.body?.confirmedAt).toEqual(expect.any(String))

    // The snapshot is written with the transition, so the export now answers from it.
    const exported = await call(exportRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}/export`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(exported.status).toBe(200)
    expect((exported.body as unknown as PackageExport).claims).toHaveLength(6)

    const again = await call(confirmRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/confirm`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
      body: { teachingNoteChecked: true },
    })
    expect(again.status).toBe(409)
    expect(errorCode(again)).toBe('VERSION_FROZEN')
  })

  it('refuses undecided elements, an unticked teaching note, an invalid package, and an editor', async () => {
    const undecided = await call(confirmRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.undecided.versionId}/confirm`,
      session: await asInstructor(),
      params: { versionId: fx.undecided.versionId },
      body: { teachingNoteChecked: true },
    })
    expect(undecided.status).toBe(409)
    expect(errorCode(undecided)).toBe('ELEMENTS_UNCONFIRMED')
    const elements = errorDetails(undecided)['elements'] as { elementType: string; key: string }[]
    expect(elements.map((element) => element.elementType)).toContain('brief')

    const unticked = await call(confirmRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/confirm`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
      body: { teachingNoteChecked: false },
    })
    expect(unticked.status).toBe(409)
    expect(errorCode(unticked)).toBe('TEACHING_NOTE_UNCHECKED')

    // An edit that breaks a rule leaves the element confirmed and the package unconfirmable.
    const emptied = await call(elementRoute.PATCH, {
      method: 'PATCH',
      path: `/package-versions/${fx.pkg.versionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
      session: await asInstructor(),
      params: {
        versionId: fx.pkg.versionId,
        elementType: 'brief',
        elementId: SINGLETON_ELEMENT_ID,
      },
      body: { brief: '' },
    })
    expect(emptied.status).toBe(200)

    const invalid = await call(confirmRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/confirm`,
      session: await asInstructor(),
      params: { versionId: fx.pkg.versionId },
      body: { teachingNoteChecked: true },
    })
    expect(invalid.status).toBe(422)
    expect(errorCode(invalid)).toBe('PACKAGE_INVALID')
    expect(errorDetails(invalid)['rules']).toContain('BRIEF_TOO_LONG')

    for (const session of [await asEditor(), await asTa(), await asStudent()]) {
      const denied = await call(confirmRoute.POST, {
        method: 'POST',
        path: `/package-versions/${fx.pkg.versionId}/confirm`,
        session,
        params: { versionId: fx.pkg.versionId },
        body: { teachingNoteChecked: true },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }
  })
})

/**
 * The freeze on a confirmed version is enforced twice: `requireDraftForWrite` refuses first, and
 * `package_version_frozen` / `package_element_frozen` / `variant_claim_state_frozen`
 * (drizzle/0004_package_frozen.sql) raise P0001 with the message `VERSION_FROZEN` when two authors
 * race past that check. The service check is unreachable from a route once it has fired, so these
 * drive the repository straight at the trigger — which is what a racing request does — and assert
 * the guarantee arrives as the 409 it is, not as the 500 an unmapped raise used to be.
 */
describe('the database freeze triggers, reached past the service check', () => {
  const refusalOf = async (call_: Promise<unknown>): Promise<unknown> => {
    try {
      await call_
    } catch (error) {
      return error
    }
    throw new Error('expected the write to be refused by the trigger')
  }

  it('answers an element write on a confirmed version VERSION_FROZEN (409), not INTERNAL_ERROR', async () => {
    await freezeFixtureVersion()
    const stored = fx.full.documents.find((row) => row.key === 'D5')
    if (!stored) throw new Error('no document keyed D5')

    const raised = await refusalOf(
      repo.upsertElement(fx.orgA, fx.pkg.versionId, 'document', {
        key: stored.key,
        title: 'Past the service check',
        author: stored.author,
        datedOn: stored.datedOn,
        body: stored.body,
        wordCount: stored.wordCount,
        role: stored.role,
        supersededByDocumentId: stored.supersededByDocumentId,
        stakeholderId: stored.stakeholderId,
        position: stored.position,
      }),
    )

    // The control: this is a raw driver error, not the AppError the service would have thrown.
    expect(isAppError(raised)).toBe(false)

    const mapped = toAppError(raised)
    expect(mapped.code).toBe('VERSION_FROZEN')
    expect(mapped.status).toBe(409)
  })

  it('answers a version-row write on a confirmed version VERSION_FROZEN (409)', async () => {
    await freezeFixtureVersion()

    const raised = await refusalOf(
      repo.writeSnapshot(fx.orgA, fx.pkg.versionId, {
        ...fixtureExport('api-packages-fixture'),
        version: {
          ...fixtureExport('api-packages-fixture').version,
          brief: 'Rewritten after the freeze.',
        },
      }),
    )

    expect(isAppError(raised)).toBe(false)
    const mapped = toAppError(raised)
    expect(mapped.code).toBe('VERSION_FROZEN')
    expect(mapped.status).toBe(409)
  })

  it('leaves an unrelated database error as INTERNAL_ERROR', async () => {
    // The mapper reads the trigger's message, not merely its SQLSTATE, so nothing else is dressed
    // up as a 409 the caller could act on.
    expect(toAppError(new Error('boom')).code).toBe('INTERNAL_ERROR')
    expect(toAppError({ code: 'P0001', message: 'VARIANT_VERSION_MISMATCH' }).code).toBe(
      'INTERNAL_ERROR',
    )
  })
})

describe('POST /package-versions/{versionId}/regenerate', () => {
  it('copies the confirmed version into a version 2 draft whose claims have new ids', async () => {
    await freezeFixtureVersion()

    const copied = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/regenerate`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId },
      body: { reason: 'The retention memo has been revised again.' },
    })

    expect(copied.status).toBe(201)
    expect(copied.body).toMatchObject({ packageId: fx.pkg.packageId })
    const versionId = (copied.body as unknown as { versionId: string }).versionId
    expect(versionId).not.toBe(fx.pkg.versionId)

    const next = await repo.findVersionFull(fx.orgA, versionId)
    expect(next).toBeDefined()
    expect(next?.version).toBe(2)
    expect(next?.status).toBe('draft')
    // FR-195: runs already taken keep the version they were taken on, which is why the ids differ.
    expect(next?.claims.map((row) => row.key).sort()).toEqual(
      fx.full.claims.map((row) => row.key).sort(),
    )
    for (const row of next?.claims ?? []) {
      expect(row.id).not.toBe(claimId(row.key))
    }

    // The source is untouched and still usable.
    const source = await call(versionRoute.GET, {
      path: `/package-versions/${fx.pkg.versionId}`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId },
    })
    expect(source.body).toMatchObject({ status: 'confirmed', version: 1 })
  })

  it('refuses a reviewer and a student, and 404s a version in another institution', async () => {
    for (const session of [await asTa(), await asStudent(), await asLead()]) {
      const denied = await call(regenerateRoute.POST, {
        method: 'POST',
        path: `/package-versions/${fx.pkg.versionId}/regenerate`,
        session,
        params: { versionId: fx.pkg.versionId },
        body: { reason: 'Not mine to copy.' },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    }

    const missingReason = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/regenerate`,
      session: await asAuthor(),
      params: { versionId: fx.pkg.versionId },
      body: {},
    })
    expect(missingReason.status).toBe(400)
    expect(errorCode(missingReason)).toBe('VALIDATION_ERROR')

    const crossTenant = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/package-versions/${fx.pkg.versionId}/regenerate`,
      session: await asOutsider(),
      params: { versionId: fx.pkg.versionId },
      body: { reason: 'Not my institution.' },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})
