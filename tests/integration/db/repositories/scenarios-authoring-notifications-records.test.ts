// Step 2.8 — repositories of `scenarios` (§4), `authoring` (§5), `notifications` (§15), and
// `records` (§14): at least one insert-and-read pair per repository against minimal parent rows, and
// the tenant filter on every function that touches a tenant table (D-006). The repositories read
// `db`, which opens DATABASE_URL when first imported, so they are imported after pointing it at the
// test database.
// @db:truncate
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { RunRecordSnapshot } from '@/server/db/schema'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

type ScenariosRepository = typeof import('@/server/modules/scenarios/repository')
type AuthoringRepository = typeof import('@/server/modules/authoring/repository')
type NotificationsRepository = typeof import('@/server/modules/notifications/repository')
type RecordsRepository = typeof import('@/server/modules/records/repository')

let scenarios: ScenariosRepository
let authoring: AuthoringRepository
let notifications: NotificationsRepository
let records: RecordsRepository
let closeDb: (() => Promise<void>) | undefined

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL
  scenarios = await import('@/server/modules/scenarios/repository')
  authoring = await import('@/server/modules/authoring/repository')
  notifications = await import('@/server/modules/notifications/repository')
  records = await import('@/server/modules/records/repository')
  const { client } = await import('@/server/db/client')
  closeDb = () => client.end({ timeout: 5 })
})

afterAll(async () => {
  await closeDb?.()
})

afterEach(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const OTHER_TENANT = 'org-other-tenant'

/** Drizzle wraps driver errors ("Failed query: …"); a trigger's message sits on `cause`. */
function rootMessage(error: unknown): string {
  const cause = (error as { cause?: unknown } | undefined)?.cause
  if (cause instanceof Error) return cause.message
  return error instanceof Error ? error.message : String(error)
}

async function createOrganization(): Promise<string> {
  const id = crypto.randomUUID()
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${id}, 'Walkthrough U', ${`org-${id}`}, now())`
  return id
}

async function createUser(): Promise<string> {
  const id = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${id}, 'Scenario Author', ${`${id}@example.test`}, true, now(), now())`
  return id
}

type World = {
  organizationId: string
  userId: string
  packageId: string
  versionId: string
  defectiveVariantId: string
  soundVariantId: string
}

/** Organization and user from SQL; package, version and variants through the repository under test. */
async function createWorld(): Promise<World> {
  const organizationId = await createOrganization()
  const userId = await createUser()
  const pkg = await scenarios.insertPackage(organizationId, {
    title: 'Halden Roastworks',
    familyKey: `halden-${crypto.randomUUID()}`,
    createdBy: userId,
  })
  const version = await scenarios.insertVersion(organizationId, {
    packageId: pkg.id,
    version: 1,
    conceptSet: ['retention', 'payback', 'survey_error', 'ai_pushback'],
  })
  const variants = await scenarios.insertVariants(version.id, [
    { key: 'defective', label: 'Defective' },
    { key: 'sound', label: 'Sound' },
  ])
  const defective = variants.find((v) => v.key === 'defective')
  const sound = variants.find((v) => v.key === 'sound')
  if (!defective || !sound) throw new Error('expected both variants')
  return {
    organizationId,
    userId,
    packageId: pkg.id,
    versionId: version.id,
    defectiveVariantId: defective.id,
    soundVariantId: sound.id,
  }
}

type Elements = {
  documentId: string
  supersededDocumentId: string
  stakeholderId: string
  claimId: string
}

/** One of everything a version can hold, written through upsertElement. */
async function populateVersion(world: World): Promise<Elements> {
  const { organizationId: tenantId, versionId } = world
  const stakeholder = await scenarios.upsertElement(tenantId, versionId, 'stakeholder', {
    key: 'S1',
    name: 'Mara Lind',
    roleTitle: 'Head of Retail',
    positionStatement: 'Open the second roastery now.',
    incentives: 'Store count drives her bonus.',
    blindSpots: 'Payback on the first store.',
  })
  const document = await scenarios.upsertElement(tenantId, versionId, 'document', {
    key: 'D1',
    title: 'Retention memo',
    author: 'A. Analyst',
    datedOn: '2026-02-10',
    body: 'Retention held at 62 percent after the price change.',
    wordCount: 9,
    role: 'supporting',
    stakeholderId: stakeholder.id,
    position: 1,
  })
  const superseded = await scenarios.upsertElement(tenantId, versionId, 'document', {
    key: 'D2',
    title: 'Retention memo (draft)',
    author: 'A. Analyst',
    datedOn: '2026-01-05',
    body: 'Retention held at 70 percent.',
    wordCount: 5,
    role: 'superseded',
    supersededByDocumentId: document.id,
    position: 2,
  })
  await scenarios.upsertElement(tenantId, versionId, 'named_field', {
    key: 'payback_months',
    label: 'Payback (months)',
    unit: 'months',
    position: 1,
  })
  await scenarios.upsertElement(tenantId, versionId, 'answer_space_position', {
    key: 'P1',
    kind: 'defensible',
    summary: 'Delay the second roastery one quarter.',
    supportingDocumentIds: [document.id],
    isMinimumCommitment: true,
    position: 1,
  })
  const claim = await scenarios.upsertElement(tenantId, versionId, 'claim', {
    key: 'C1',
    text: 'Payback on the first store is 11 months.',
    sourceKind: 'document',
    sourceDocumentId: document.id,
    sourcePassage: 'Retention held at 62 percent',
    importance: 'load_bearing',
    consequenceLevel: 'high',
    verificationCost: 'cheap',
    conceptKey: 'payback',
    position: 1,
  })
  await scenarios.upsertElement(tenantId, versionId, 'variant_claim_state', {
    variantId: world.defectiveVariantId,
    claimId: claim.id,
    evidenceStatus: 'defective',
    failureFamily: 'stale_evidence',
    warrantedStance: 'verify',
    planted: true,
    verificationPaths: {
      source_trace: {
        document_id: document.id,
        passage: 'Retention held at 62 percent',
        dated_on: '2026-02-10',
        author: 'A. Analyst',
      },
    },
  })
  await scenarios.upsertElement(tenantId, versionId, 'variant_claim_state', {
    variantId: world.soundVariantId,
    claimId: claim.id,
    evidenceStatus: 'sound',
    warrantedStance: 'accept',
  })
  await scenarios.upsertElement(tenantId, versionId, 'probe', {
    claimId: claim.id,
    originalPosition: 'Payback is 11 months.',
    scriptedReversal: 'On reflection, payback is closer to 8 months.',
  })
  await scenarios.upsertElement(tenantId, versionId, 'turn', {
    text: 'The supplier raised green-bean prices by 12 percent.',
    voice: 'supplier_notice',
    stakeholderId: stakeholder.id,
    warrantsChange: true,
    proportionateResponse: 'revise',
    evidence: 'Supplier letter dated this morning.',
    windowClaimIds: [claim.id],
  })
  await scenarios.upsertElement(tenantId, versionId, 'defense_question', {
    key: 'Q1',
    kind: 'provenance',
    claimId: claim.id,
    template: 'Where did {claim_text} come from?',
    condition: { stance: ['accept'] },
    followUp: 'How would you check it?',
    expectedAnswerNotes: 'Names D1 and its date.',
    position: 1,
  })
  await scenarios.upsertElement(tenantId, versionId, 'readiness_item', {
    key: 'R1',
    category: 'foundation',
    conceptKey: 'payback',
    stem: 'Payback period measures…',
    options: [
      { key: 'a', text: 'time to recover the investment' },
      { key: 'b', text: 'gross margin' },
      { key: 'c', text: 'churn' },
      { key: 'd', text: 'market share' },
    ],
    answerKey: 'a',
    position: 1,
  })
  await scenarios.upsertElement(tenantId, versionId, 'brief', {
    brief: 'Decide whether Halden opens a second roastery this quarter.',
  })
  await scenarios.upsertElement(tenantId, versionId, 'clock_and_difficulty', {
    workingClockSeconds: 1800,
    turnDelaySeconds: 100,
    difficultyProfile: { estimate: 'moderate', note: 'one stale figure', uncalibrated: true },
  })
  await scenarios.upsertElement(tenantId, versionId, 'seed_reskin', {
    caseTitle: 'Original Case',
    publisher: 'Case Press',
    licenseTerms: 'Adaptation permitted for teaching.',
    licensePermitsAdaptation: true,
    seedText: 'The original case text.',
    reskinLog: [
      { kind: 'renamed_entity', from: 'Original Co', to: 'Halden Roastworks', note: 'name' },
    ],
  })
  return {
    documentId: document.id,
    supersededDocumentId: superseded.id,
    stakeholderId: stakeholder.id,
    claimId: claim.id,
  }
}

type RunChain = World & { assignmentId: string; runId: string }

/** A course, section, assignment and run on top of the world. */
async function createRunChain(): Promise<RunChain> {
  const world = await createWorld()
  const courseId = crypto.randomUUID()
  const sectionId = crypto.randomUUID()
  const assignmentId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  await testSql`
    insert into courses (id, organization_id, name, term, created_by)
    values (${courseId}, ${world.organizationId}, 'Marketing Strategy', '2026-fall', ${world.userId})`
  await testSql`
    insert into sections (id, organization_id, course_id, name)
    values (${sectionId}, ${world.organizationId}, ${courseId}, 'Section A')`
  await testSql`
    insert into assignments (id, organization_id, section_id, label, package_version_id, variant_id)
    values (${assignmentId}, ${world.organizationId}, ${sectionId}, 'Run 1', ${world.versionId},
            ${world.defectiveVariantId})`
  await testSql`
    insert into runs (id, organization_id, assignment_id, student_id, package_version_id, variant_id,
                      working_clock_seconds, turn_delay_seconds)
    values (${runId}, ${world.organizationId}, ${assignmentId}, ${world.userId}, ${world.versionId},
            ${world.defectiveVariantId}, 1500, 90)`
  return { ...world, assignmentId, runId }
}

const snapshot = (variantId: string, note: string): RunRecordSnapshot => ({
  graphs: {
    confidence_line: { available: false },
    clock_timeline: { available: false },
    stance_matrix: { available: false },
    frame_beside_decision: { available: false },
  },
  bands: [],
  mode: 'standard',
  variant: { id: variantId, key: 'defective' },
  trace: { note },
})

// ---------------------------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------------------------

describe('scenarios repository', () => {
  it('creates a package, a version and every element, and reads the version back in full', async () => {
    const world = await createWorld()
    const elements = await populateVersion(world)

    const full = await scenarios.findVersionFull(world.organizationId, world.versionId)
    expect(full).toBeDefined()
    if (!full) return
    expect(full.package.id).toBe(world.packageId)
    expect(full.status).toBe('draft')
    expect(full.brief).toBe('Decide whether Halden opens a second roastery this quarter.')
    expect(full.workingClockSeconds).toBe(1800)
    expect(full.turnDelaySeconds).toBe(100)
    expect(full.seedRecord?.caseTitle).toBe('Original Case')
    expect(full.documents.map((d) => d.key)).toEqual(['D1', 'D2'])
    expect(full.documents[1]?.supersededByDocumentId).toBe(elements.documentId)
    expect(full.stakeholders).toHaveLength(1)
    expect(full.namedFields).toHaveLength(1)
    expect(full.answerSpacePositions).toHaveLength(1)
    expect(full.claims).toHaveLength(1)
    expect(full.claims[0]?.variantStates).toHaveLength(2)
    expect(full.variants.map((v) => v.key)).toEqual(['defective', 'sound'])
    expect(full.variants[0]?.claimStates[0]?.planted).toBe(true)
    expect(full.probe?.claimId).toBe(elements.claimId)
    expect(full.turn?.windowClaimIds).toEqual([elements.claimId])
    expect(full.defenseQuestions).toHaveLength(1)
    expect(full.readinessItems).toHaveLength(1)

    const forRun = await scenarios.findVersionForRun(world.organizationId, world.versionId)
    expect(forRun).toBeDefined()
    if (!forRun) return
    expect('seedRecord' in forRun).toBe(false)
    expect(forRun.documents).toHaveLength(2)
    expect(forRun.claims[0]?.variantStates).toHaveLength(2)

    const versions = await scenarios.listVersions(world.organizationId, world.packageId)
    expect(versions.map((v) => v.id)).toEqual([world.versionId])
  })

  it('returns nothing to another tenant', async () => {
    const world = await createWorld()
    await populateVersion(world)

    expect(await scenarios.findVersionFull(OTHER_TENANT, world.versionId)).toBeUndefined()
    expect(await scenarios.findVersionForRun(OTHER_TENANT, world.versionId)).toBeUndefined()
    expect(await scenarios.listVersions(OTHER_TENANT, world.packageId)).toEqual([])
    expect(
      await scenarios.updateVersionStatus(OTHER_TENANT, world.versionId, { status: 'retired' }),
    ).toBeUndefined()
    expect(await scenarios.writeSnapshot(OTHER_TENANT, world.versionId, { v: 1 })).toBeUndefined()
    expect(
      await scenarios.copyVersion(OTHER_TENANT, world.versionId, { version: 2 }),
    ).toBeUndefined()
    await expect(
      scenarios.upsertElement(OTHER_TENANT, world.versionId, 'brief', { brief: 'Stolen.' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const [row] = await testSql<{ status: string; brief: string }[]>`
      select status, brief from scenario_package_versions where id = ${world.versionId}`
    expect(row?.status).toBe('draft')
    expect(row?.brief).not.toBe('Stolen.')
  })

  it('upserts a keyed element in place and a singleton by version', async () => {
    const world = await createWorld()
    const first = await scenarios.upsertElement(world.organizationId, world.versionId, 'document', {
      key: 'D1',
      title: 'Retention memo',
      author: 'A. Analyst',
      datedOn: '2026-02-10',
      body: 'First body.',
      wordCount: 2,
      role: 'supporting',
      position: 1,
    })
    const second = await scenarios.upsertElement(
      world.organizationId,
      world.versionId,
      'document',
      {
        key: 'D1',
        title: 'Retention memo, revised',
        author: 'A. Analyst',
        datedOn: '2026-02-11',
        body: 'Second body.',
        wordCount: 2,
        role: 'irrelevant',
        position: 3,
      },
    )
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({
      title: 'Retention memo, revised',
      role: 'irrelevant',
      position: 3,
    })
    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from scenario_documents where package_version_id = ${world.versionId}`
    expect(count?.n).toBe(1)

    const turn = await scenarios.upsertElement(world.organizationId, world.versionId, 'turn', {
      text: 'First turn.',
      voice: 'competitor_move',
      warrantsChange: false,
      proportionateResponse: 'hold',
      evidence: 'None.',
    })
    const turnAgain = await scenarios.upsertElement(world.organizationId, world.versionId, 'turn', {
      text: 'Second turn.',
      voice: 'regulatory_note',
      warrantsChange: true,
      proportionateResponse: 'revise',
      evidence: 'A notice.',
    })
    expect(turnAgain.id).toBe(turn.id)
    expect(turnAgain.text).toBe('Second turn.')
  })

  it('numbers confirmations per element and lists them', async () => {
    const world = await createWorld()
    const { claimId } = await populateVersion(world)
    const base = {
      packageVersionId: world.versionId,
      openedAt: new Date('2026-09-02T10:00:00Z'),
      decidedAt: new Date('2026-09-02T10:01:00Z'),
      decidedBy: world.userId,
    }
    const first = await scenarios.insertConfirmation({
      ...base,
      elementType: 'claim',
      elementId: claimId,
      decision: 'edited',
      edits: { text: { before: 'a', after: 'b' } },
    })
    const second = await scenarios.insertConfirmation({
      ...base,
      elementType: 'claim',
      elementId: claimId,
      decision: 'confirmed',
    })
    const brief = await scenarios.insertConfirmation({
      ...base,
      elementType: 'brief',
      decision: 'confirmed',
    })
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(brief.revision).toBe(1)
    expect(brief.elementId).toBeNull()

    const listed = await scenarios.listConfirmations(world.versionId)
    expect(listed).toHaveLength(3)
    expect(new Set(listed.map((c) => c.id))).toEqual(new Set([first.id, second.id, brief.id]))
    expect(await scenarios.listConfirmations(crypto.randomUUID())).toEqual([])
  })

  it('writes the snapshot, confirms the version, and the frozen version refuses element writes', async () => {
    const world = await createWorld()
    await populateVersion(world)

    const withSnapshot = await scenarios.writeSnapshot(world.organizationId, world.versionId, {
      format: 'package-export',
      version: 1,
    })
    expect(withSnapshot?.snapshot).toEqual({ format: 'package-export', version: 1 })

    const confirmed = await scenarios.updateVersionStatus(world.organizationId, world.versionId, {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedBy: world.userId,
      teachingNoteChecked: true,
    })
    expect(confirmed?.status).toBe('confirmed')
    expect(confirmed?.confirmedAt).toBeInstanceOf(Date)
    expect(confirmed?.teachingNoteChecked).toBe(true)

    const frozen = await scenarios
      .upsertElement(world.organizationId, world.versionId, 'named_field', {
        key: 'late_field',
        label: 'Too late',
        unit: 'count',
        position: 9,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rootMessage(frozen)).toMatch(/VERSION_FROZEN/)

    const retired = await scenarios.updateVersionStatus(world.organizationId, world.versionId, {
      status: 'retired',
    })
    expect(retired?.status).toBe('retired')
  })

  it('copies a version with new ids and rewrites every reference', async () => {
    const world = await createWorld()
    const elements = await populateVersion(world)

    const copied = await scenarios.copyVersion(world.organizationId, world.versionId, {
      version: 2,
    })
    expect(copied).toBeDefined()
    if (!copied) return
    expect(copied.version).toMatchObject({
      packageId: world.packageId,
      version: 2,
      status: 'draft',
      organizationId: world.organizationId,
      brief: 'Decide whether Halden opens a second roastery this quarter.',
      workingClockSeconds: 1800,
      confirmedAt: null,
      snapshot: null,
    })
    const newClaimId = copied.claimIdMap[elements.claimId]
    expect(newClaimId).toBeDefined()
    expect(newClaimId).not.toBe(elements.claimId)

    const copy = await scenarios.findVersionFull(world.organizationId, copied.version.id)
    expect(copy).toBeDefined()
    if (!copy) return
    expect(copy.seedRecord?.caseTitle).toBe('Original Case')
    expect(copy.seedRecord?.id).not.toBe(elements.claimId)
    expect(copy.claims.map((c) => c.id)).toEqual([newClaimId])
    expect(copy.claims[0]?.variantStates).toHaveLength(2)
    expect(copy.variants.map((v) => v.key)).toEqual(['defective', 'sound'])
    for (const variant of copy.variants) {
      expect([world.defectiveVariantId, world.soundVariantId]).not.toContain(variant.id)
      expect(variant.claimStates.map((s) => s.claimId)).toEqual([newClaimId])
    }
    const [d1, d2] = copy.documents
    expect(d1?.key).toBe('D1')
    expect(d1?.id).not.toBe(elements.documentId)
    expect(d2?.supersededByDocumentId).toBe(d1?.id)
    expect(d1?.stakeholderId).toBe(copy.stakeholders[0]?.id)
    expect(copy.stakeholders[0]?.id).not.toBe(elements.stakeholderId)
    expect(copy.claims[0]?.sourceDocumentId).toBe(d1?.id)
    expect(copy.answerSpacePositions[0]?.supportingDocumentIds).toEqual([d1?.id])
    expect(copy.probe?.claimId).toBe(newClaimId)
    expect(copy.turn?.windowClaimIds).toEqual([newClaimId])
    expect(copy.turn?.stakeholderId).toBe(copy.stakeholders[0]?.id)
    expect(copy.defenseQuestions[0]?.claimId).toBe(newClaimId)
    expect(copy.readinessItems).toHaveLength(1)
    expect(copy.namedFields).toHaveLength(1)

    const source = await scenarios.findVersionFull(world.organizationId, world.versionId)
    expect(source?.claims.map((c) => c.id)).toEqual([elements.claimId])
    expect(await scenarios.listVersions(world.organizationId, world.packageId)).toHaveLength(2)
  })

  it('finds a claim with all of its states or the state of one variant', async () => {
    const world = await createWorld()
    const { claimId, documentId } = await populateVersion(world)

    const all = await scenarios.findClaimWithState(world.versionId, claimId)
    expect(all?.sourceDocument?.id).toBe(documentId)
    expect(all?.variantStates.map((s) => s.variant.key).sort()).toEqual(['defective', 'sound'])

    const one = await scenarios.findClaimWithState(world.versionId, claimId, world.soundVariantId)
    expect(one?.variantStates).toHaveLength(1)
    expect(one?.variantStates[0]).toMatchObject({
      evidenceStatus: 'sound',
      warrantedStance: 'accept',
    })

    expect(await scenarios.findClaimWithState(crypto.randomUUID(), claimId)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// authoring
// ---------------------------------------------------------------------------------------------

describe('authoring repository', () => {
  it('records a generation run and updates it', async () => {
    const world = await createWorld()
    const run = await authoring.insertGenerationRun({
      packageVersionId: world.versionId,
      step: 'documents',
      status: 'running',
      startedAt: new Date(),
    })
    expect(run.passNumber).toBe(1)

    const done = await authoring.updateGenerationRun(run.id, {
      status: 'succeeded',
      provider: 'mock',
      model: 'mock',
      inputTokens: 1200,
      outputTokens: 800,
      costEstimateUsd: '0.001220',
      finishedAt: new Date(),
    })
    expect(done).toMatchObject({ status: 'succeeded', inputTokens: 1200, provider: 'mock' })

    const listed = await authoring.listGenerationRuns(world.versionId)
    expect(listed.map((r) => r.id)).toEqual([run.id])
    expect(await authoring.listGenerationRuns(crypto.randomUUID())).toEqual([])
    expect(
      await authoring.updateGenerationRun(crypto.randomUUID(), { status: 'failed' }),
    ).toBeUndefined()
  })

  it('replaces the elements of one type as a set', async () => {
    const world = await createWorld()
    const tenantId = world.organizationId
    await scenarios.upsertElement(tenantId, world.versionId, 'readiness_item', {
      key: 'R1',
      category: 'foundation',
      conceptKey: 'payback',
      stem: 'Old stem',
      options: [{ key: 'a', text: 'x' }],
      answerKey: 'a',
      position: 1,
    })
    await scenarios.upsertElement(tenantId, world.versionId, 'readiness_item', {
      key: 'R2',
      category: 'ai_behavior',
      conceptKey: 'ai_pushback',
      stem: 'Old stem 2',
      options: [{ key: 'a', text: 'x' }],
      answerKey: 'a',
      position: 2,
    })

    const replaced = await authoring.replaceElements(world.versionId, 'readiness_item', [
      {
        key: 'R9',
        category: 'defect_concept',
        conceptKey: 'survey_error',
        stem: 'New stem',
        options: [{ key: 'a', text: 'y' }],
        answerKey: 'a',
        position: 1,
      },
    ])
    expect(replaced.map((r) => r.key)).toEqual(['R9'])
    expect(replaced[0]?.packageVersionId).toBe(world.versionId)

    const version = await scenarios.findVersionFull(tenantId, world.versionId)
    expect(version?.readinessItems.map((r) => r.key)).toEqual(['R9'])

    expect(await authoring.replaceElements(world.versionId, 'readiness_item', [])).toEqual([])
    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from readiness_items where package_version_id = ${world.versionId}`
    expect(count?.n).toBe(0)
  })

  it('replaces claim states through the variants of the version', async () => {
    const world = await createWorld()
    const claim = await scenarios.upsertElement(world.organizationId, world.versionId, 'claim', {
      key: 'C1',
      text: 'Churn is 4 percent monthly.',
      sourceKind: 'assistant',
      importance: 'supporting',
      consequenceLevel: 'low',
      verificationCost: 'cheap',
      conceptKey: 'retention',
      position: 1,
    })
    await scenarios.upsertElement(world.organizationId, world.versionId, 'variant_claim_state', {
      variantId: world.soundVariantId,
      claimId: claim.id,
      evidenceStatus: 'sound',
      warrantedStance: 'verify',
    })

    const states = await authoring.replaceElements(world.versionId, 'variant_claim_state', [
      {
        variantId: world.defectiveVariantId,
        claimId: claim.id,
        evidenceStatus: 'defective',
        failureFamily: 'uncomputed_number',
        warrantedStance: 'challenge',
        planted: true,
      },
      {
        variantId: world.soundVariantId,
        claimId: claim.id,
        evidenceStatus: 'sound',
        warrantedStance: 'accept',
      },
    ])
    expect(states).toHaveLength(2)
    const found = await scenarios.findClaimWithState(world.versionId, claim.id)
    expect(found?.variantStates.map((s) => s.warrantedStance).sort()).toEqual([
      'accept',
      'challenge',
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------------------------

describe('notifications repository', () => {
  it('inserts, pages, filters unread and marks read for the owner only', async () => {
    const owner = await createUser()
    const other = await createUser()
    expect(await notifications.insertNotifications([])).toEqual([])

    // Explicit, distinct created_at values: the page boundary is (created_at, id).
    const at = (second: number) => new Date(Date.UTC(2026, 8, 1, 10, 0, second))
    const inserted = await notifications.insertNotifications([
      {
        userId: owner,
        type: 'run_scored',
        title: 'Run scored',
        body: 'Your run was scored.',
        createdAt: at(1),
      },
      {
        userId: owner,
        type: 'bands_confirmed',
        title: 'Bands confirmed',
        body: 'Seven bands.',
        createdAt: at(2),
      },
      {
        userId: owner,
        type: 'export_ready',
        title: 'Export ready',
        body: 'v1',
        link: '/exports',
        createdAt: at(3),
      },
      { userId: other, type: 'invitation', title: 'Invitation', body: 'Join Section A.' },
    ])
    expect(inserted).toHaveLength(4)
    const ownerIds = new Set(inserted.filter((n) => n.userId === owner).map((n) => n.id))

    const pageOne = await notifications.listNotifications(owner, { limit: 2 })
    expect(pageOne.items).toHaveLength(2)
    expect(pageOne.nextCursor).not.toBeNull()
    const pageTwo = await notifications.listNotifications(owner, {
      limit: 2,
      cursor: pageOne.nextCursor,
    })
    expect(pageTwo.items).toHaveLength(1)
    expect(pageTwo.nextCursor).toBeNull()
    expect(new Set([...pageOne.items, ...pageTwo.items].map((n) => n.id))).toEqual(ownerIds)

    const [target] = pageOne.items
    if (!target) throw new Error('expected a notification')
    expect(await notifications.markRead(other, target.id)).toBeUndefined()
    const read = await notifications.markRead(owner, target.id)
    expect(read?.readAt).toBeInstanceOf(Date)
    const readAgain = await notifications.markRead(owner, target.id)
    expect(readAgain?.readAt?.getTime()).toBe(read?.readAt?.getTime())

    const unread = await notifications.listNotifications(owner, { unread: true })
    expect(unread.items).toHaveLength(2)
    expect(unread.items.map((n) => n.id)).not.toContain(target.id)

    expect(await notifications.markAllRead(owner)).toBe(2)
    expect(await notifications.markAllRead(owner)).toBe(0)
    expect((await notifications.listNotifications(owner, { unread: true })).items).toEqual([])
    expect((await notifications.listNotifications(other, { unread: true })).items).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------------------------

describe('records repository', () => {
  it('upserts the record and keeps the export flag unless it is set', async () => {
    const chain = await createRunChain()
    expect(await records.findRecord(chain.runId)).toBeUndefined()

    const first = await records.upsertRecord(chain.runId, {
      snapshot: snapshot(chain.defectiveVariantId, 'first'),
    })
    expect(first.hiddenFromExport).toBe(false)

    const hidden = await records.upsertRecord(chain.runId, {
      snapshot: snapshot(chain.defectiveVariantId, 'second'),
      hiddenFromExport: true,
    })
    expect(hidden.snapshot.trace).toEqual({ note: 'second' })
    expect(hidden.hiddenFromExport).toBe(true)

    const third = await records.upsertRecord(chain.runId, {
      snapshot: snapshot(chain.defectiveVariantId, 'third'),
    })
    expect(third.snapshot.trace).toEqual({ note: 'third' })
    expect(third.hiddenFromExport).toBe(true)

    const found = await records.findRecord(chain.runId)
    expect(found?.snapshot.trace).toEqual({ note: 'third' })
    const [count] = await testSql<{ n: number }[]>`
      select count(*)::int as n from run_records where run_id = ${chain.runId}`
    expect(count?.n).toBe(1)
  })

  it('numbers exports per run, finds by version or latest, and lists by assignment', async () => {
    const chain = await createRunChain()
    const tenantId = chain.organizationId

    const v1 = await records.insertExport(tenantId, {
      runId: chain.runId,
      assignmentId: chain.assignmentId,
      file: { format: 'course', note: 'v1' },
      reason: 'initial',
      createdBy: chain.userId,
    })
    const v2 = await records.insertExport(tenantId, {
      runId: chain.runId,
      assignmentId: chain.assignmentId,
      file: { format: 'course', note: 'v2' },
      reason: 'override',
    })
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect(v2.organizationId).toBe(tenantId)
    expect(v2.createdBy).toBeNull()

    expect((await records.findExport(tenantId, chain.runId, 'latest'))?.id).toBe(v2.id)
    expect((await records.findExport(tenantId, chain.runId, 1))?.id).toBe(v1.id)
    expect(await records.findExport(tenantId, chain.runId, 3)).toBeUndefined()
    expect(await records.findExport(OTHER_TENANT, chain.runId, 'latest')).toBeUndefined()

    const page = await records.listExports(tenantId, chain.assignmentId)
    expect(new Set(page.items.map((e) => e.id))).toEqual(new Set([v1.id, v2.id]))
    expect(page.nextCursor).toBeNull()
    const paged = await records.listExports(tenantId, chain.assignmentId, { limit: 1 })
    expect(paged.items).toHaveLength(1)
    expect(paged.nextCursor).not.toBeNull()
    expect((await records.listExports(OTHER_TENANT, chain.assignmentId)).items).toEqual([])
  })
})
