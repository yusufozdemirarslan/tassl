// Module `scenarios` — repository (docs/tech/10-backend-spec-modules.md §4; tables 06-data-model.md
// §3.3). Query bodies only: no validation rules, no permission checks, no audit rows. Packages and
// versions are tenant-scoped (D-006): every function that touches them takes `tenantId` first and
// filters on `organizationId`. The element tables carry no organization_id and are scoped through
// the version id the service already resolved. Confirmed versions are frozen by the package_frozen
// trigger family, so a write against one surfaces as `VERSION_FROZEN` from the database. The
// database handle is always the last parameter (10 §6).
import { and, desc, eq, inArray, isNull, getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  afterCursor,
  clampLimit,
  cursorOrder,
  decodeCursor,
  toPage,
  type Page,
  type PageInput,
} from '@/server/db/pagination'
import {
  SINGLETON_ELEMENT_KEY,
  answerSpacePositions,
  defenseQuestions,
  elementConfirmations,
  elementType,
  namedFields,
  readinessItems,
  runs,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioPackages,
  scenarioTurns,
  scenarioVariants,
  seedRecords,
  stakeholders,
  sycophancyProbes,
  user,
  variantClaimStates,
  type AnswerSpacePosition,
  type DefenseQuestion,
  type ElementConfirmation,
  type NamedField,
  type NewAnswerSpacePosition,
  type NewDefenseQuestion,
  type NewElementConfirmation,
  type NewNamedField,
  type NewReadinessItem,
  type NewScenarioClaim,
  type NewScenarioDocument,
  type NewScenarioPackage,
  type NewScenarioPackageVersion,
  type NewScenarioTurn,
  type NewScenarioVariant,
  type NewSeedRecord,
  type NewStakeholder,
  type NewSycophancyProbe,
  type NewVariantClaimState,
  type PackageSnapshot,
  type ReadinessItem,
  type ScenarioClaim,
  type ScenarioDocument,
  type ScenarioPackage,
  type ScenarioPackageVersion,
  type ScenarioTurn,
  type ScenarioVariant,
  type SeedRecord,
  type Stakeholder,
  type SycophancyProbe,
  type VariantClaimState,
  type VerificationPaths,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service may not import `@/server/db` (04 §2), so the row types it hands out, the page shape
// its lists return, and the transaction boundary its writes open are re-exported by the layer that
// owns database access — the same seam `courses/repository.ts` keeps.
export type {
  ElementConfirmation,
  PackageSnapshot,
  ScenarioClaim,
  ScenarioDocument,
  ScenarioPackage,
  ScenarioPackageVersion,
  ScenarioVariant,
  SeedRecord,
} from '@/server/db/schema'
export type { Page, PageInput } from '@/server/db/pagination'
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

// ---------------------------------------------------------------------------------------------
// Input and result shapes (rows come straight from the schema; nothing is spread into new shapes)
// ---------------------------------------------------------------------------------------------

export type ElementType = (typeof elementType.enumValues)[number]

/** Element types that live as columns on the version row rather than in their own table. */
export type VersionColumnElementType =
  'brief' | 'counterfactual' | 'general_escalation_reply' | 'clock_and_difficulty'

/** Element types stored in their own table under the version. */
export type TableElementType = Exclude<ElementType, VersionColumnElementType>

/** `organizationId` comes from `tenantId`. */
export type PackageInsert = Omit<NewScenarioPackage, 'organizationId'>
export type VersionInsert = Omit<NewScenarioPackageVersion, 'organizationId'>

type WithoutVersion<T> = Omit<T, 'packageVersionId'>

export type SeedRecordInsert = WithoutVersion<NewSeedRecord>
export type VariantInsert = WithoutVersion<NewScenarioVariant>

/** The version-row columns an element edit may touch (the four column-backed element types). */
export type VersionColumnPatch = Partial<
  Pick<
    NewScenarioPackageVersion,
    | 'brief'
    | 'debriefCounterfactual'
    | 'generalEscalationReply'
    | 'workingClockSeconds'
    | 'turnDelaySeconds'
    | 'difficultyProfile'
  >
>

/**
 * Status change of a version. Confirmation sets `status`, `confirmed_at/by` and the teaching-note
 * flag in one statement; the snapshot may ride along because the frozen trigger refuses every later
 * write to the row except status and review fields.
 */
export type VersionStatusPatch = { status: ScenarioPackageVersion['status'] } & Partial<
  Pick<
    NewScenarioPackageVersion,
    | 'confirmedAt'
    | 'confirmedBy'
    | 'teachingNoteChecked'
    | 'reviewRequestedAt'
    | 'reviewReason'
    | 'snapshot'
  >
>

/** What the service hands `upsertElement` per element type; the version id comes from the parameter. */
export type ElementInput = {
  brief: Pick<NewScenarioPackageVersion, 'brief'>
  document: WithoutVersion<NewScenarioDocument>
  stakeholder: WithoutVersion<NewStakeholder>
  answer_space_position: WithoutVersion<NewAnswerSpacePosition>
  named_field: WithoutVersion<NewNamedField>
  claim: WithoutVersion<NewScenarioClaim>
  variant_claim_state: NewVariantClaimState
  probe: WithoutVersion<NewSycophancyProbe>
  turn: WithoutVersion<NewScenarioTurn>
  defense_question: WithoutVersion<NewDefenseQuestion>
  readiness_item: WithoutVersion<NewReadinessItem>
  counterfactual: Pick<NewScenarioPackageVersion, 'debriefCounterfactual'>
  general_escalation_reply: Pick<NewScenarioPackageVersion, 'generalEscalationReply'>
  clock_and_difficulty: Pick<
    NewScenarioPackageVersion,
    'workingClockSeconds' | 'turnDelaySeconds' | 'difficultyProfile'
  >
  seed_reskin: WithoutVersion<NewSeedRecord>
}

/** The row `upsertElement` returns per element type (the version row for its column elements). */
export type ElementRow = {
  brief: ScenarioPackageVersion
  document: ScenarioDocument
  stakeholder: Stakeholder
  answer_space_position: AnswerSpacePosition
  named_field: NamedField
  claim: ScenarioClaim
  variant_claim_state: VariantClaimState
  probe: SycophancyProbe
  turn: ScenarioTurn
  defense_question: DefenseQuestion
  readiness_item: ReadinessItem
  counterfactual: ScenarioPackageVersion
  general_escalation_reply: ScenarioPackageVersion
  clock_and_difficulty: ScenarioPackageVersion
  seed_reskin: SeedRecord
}

/** A confirmation row as the service hands it over; `revision` defaults to the next one per element. */
export type ConfirmationInsert = Omit<NewElementConfirmation, 'id' | 'createdAt'>

/** The person behind a decision, as the confirmation and authoring records name them. */
export type UserSummary = { id: string; name: string }

/** Result of `copyVersion`: the new draft row and the old→new id map of its claims (FR-195). */
export type CopiedVersion = { version: ScenarioPackageVersion; claimIdMap: Record<string, string> }

// ---------------------------------------------------------------------------------------------
// Helpers (declared before the exports: the tenant guard attributes trailing text to the
// preceding exported function)
// ---------------------------------------------------------------------------------------------

/** `INSERT … RETURNING` always yields its row; an empty result is a driver fault, not a domain case. */
function returned<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Columns never rewritten by an upsert: identity, parent, natural key, timestamps. */
const ROW_META = ['id', 'packageVersionId', 'createdAt', 'updatedAt'] as const
const KEYED_META = [...ROW_META, 'key'] as const
const STATE_META = ['id', 'variantId', 'claimId', 'createdAt', 'updatedAt'] as const
const STATE_COPY_META = ['id', 'createdAt', 'updatedAt'] as const

/** `set` clause of `ON CONFLICT DO UPDATE`: every column except `skip`, taken from `excluded`. */
function excludedSet<TTable extends PgTable>(
  table: TTable,
  skip: readonly string[],
): PgUpdateSetSource<TTable> {
  const set: Record<string, SQL> = {}
  for (const [name, column] of Object.entries(getTableColumns(table)) as [string, PgColumn][]) {
    if (skip.includes(name)) continue
    set[name] = sql`excluded.${sql.identifier(column.name)}`
  }
  return set as PgUpdateSetSource<TTable>
}

/** Insert-or-update on the table's natural key; the callers re-attach the row type through ElementRow. */
async function upsertRow<TTable extends PgTable>(
  table: TTable,
  values: TTable['$inferInsert'],
  target: PgColumn[],
  skip: readonly string[],
  dbx: DbOrTx,
): Promise<TTable['$inferSelect']> {
  const rows = await dbx
    .insert(table)
    .values(values as PgInsertValue<TTable>)
    .onConflictDoUpdate({ target, set: excludedSet(table, skip) })
    .returning()
  return returned(rows) as TTable['$inferSelect']
}

/** The column-backed elements live on the version row itself. */
async function updateVersionColumns(
  tenantId: string,
  versionId: string,
  patch: VersionColumnPatch,
  dbx: DbOrTx,
): Promise<ScenarioPackageVersion> {
  const rows = await dbx
    .update(scenarioPackageVersions)
    .set(patch)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .returning()
  const row = rows[0]
  if (!row) throw new AppError('NOT_FOUND', 'Package version not found.')
  return row
}

type ElementHandler<K extends ElementType> = (
  tenantId: string,
  versionId: string,
  row: ElementInput[K],
  dbx: DbOrTx,
) => Promise<ElementRow[K]>

const elementHandlers: { [K in ElementType]: ElementHandler<K> } = {
  brief: (tenantId, versionId, row, dbx) => updateVersionColumns(tenantId, versionId, row, dbx),
  counterfactual: (tenantId, versionId, row, dbx) =>
    updateVersionColumns(tenantId, versionId, row, dbx),
  general_escalation_reply: (tenantId, versionId, row, dbx) =>
    updateVersionColumns(tenantId, versionId, row, dbx),
  clock_and_difficulty: (tenantId, versionId, row, dbx) =>
    updateVersionColumns(tenantId, versionId, row, dbx),
  document: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      scenarioDocuments,
      { ...row, packageVersionId: versionId },
      [scenarioDocuments.packageVersionId, scenarioDocuments.key],
      KEYED_META,
      dbx,
    ),
  stakeholder: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      stakeholders,
      { ...row, packageVersionId: versionId },
      [stakeholders.packageVersionId, stakeholders.key],
      KEYED_META,
      dbx,
    ),
  answer_space_position: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      answerSpacePositions,
      { ...row, packageVersionId: versionId },
      [answerSpacePositions.packageVersionId, answerSpacePositions.key],
      KEYED_META,
      dbx,
    ),
  named_field: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      namedFields,
      { ...row, packageVersionId: versionId },
      [namedFields.packageVersionId, namedFields.key],
      KEYED_META,
      dbx,
    ),
  claim: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      scenarioClaims,
      { ...row, packageVersionId: versionId },
      [scenarioClaims.packageVersionId, scenarioClaims.key],
      KEYED_META,
      dbx,
    ),
  variant_claim_state: (_tenantId, _versionId, row, dbx) =>
    upsertRow(
      variantClaimStates,
      row,
      [variantClaimStates.variantId, variantClaimStates.claimId],
      STATE_META,
      dbx,
    ),
  probe: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      sycophancyProbes,
      { ...row, packageVersionId: versionId },
      [sycophancyProbes.packageVersionId],
      ROW_META,
      dbx,
    ),
  turn: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      scenarioTurns,
      { ...row, packageVersionId: versionId },
      [scenarioTurns.packageVersionId],
      ROW_META,
      dbx,
    ),
  defense_question: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      defenseQuestions,
      { ...row, packageVersionId: versionId },
      [defenseQuestions.packageVersionId, defenseQuestions.key],
      KEYED_META,
      dbx,
    ),
  readiness_item: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      readinessItems,
      { ...row, packageVersionId: versionId },
      [readinessItems.packageVersionId, readinessItems.key],
      KEYED_META,
      dbx,
    ),
  seed_reskin: (_tenantId, versionId, row, dbx) =>
    upsertRow(
      seedRecords,
      { ...row, packageVersionId: versionId },
      [seedRecords.packageVersionId],
      ROW_META,
      dbx,
    ),
}

/** A copy of `row` without `keys` (the identity and timestamp columns a copied row must not carry). */
function without<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...row } as Record<string, unknown>
  for (const key of keys) delete copy[key as string]
  return copy as Omit<T, K>
}

/** New ids for copied rows, allocated up front so references can be rewritten before any insert. */
function freshIds(rows: readonly { id: string }[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, crypto.randomUUID()] as const))
}

const mapped = (ids: Map<string, string>, id: string): string => ids.get(id) ?? id
const mappedOrNull = (ids: Map<string, string>, id: string | null): string | null =>
  id === null ? null : mapped(ids, id)

/**
 * `verification_paths.source_trace.document_id` is a reference between two elements like any other,
 * and jsonb hides it from the column rewrites a copy does. Left alone, a copied Source Trace points
 * at the *source* version's document: the path renders nothing in the copy, which is exactly the
 * uncatchable defect `PLANTED_PATH_MISSING` exists to refuse, so version n+1 could not be confirmed.
 */
function copiedPaths(
  paths: VerificationPaths,
  documentIds: Map<string, string>,
): VerificationPaths {
  const trace = paths.source_trace
  if (!trace) return paths
  return {
    ...paths,
    source_trace: { ...trace, document_id: mapped(documentIds, trace.document_id) },
  }
}

// ---------------------------------------------------------------------------------------------
// Packages and versions
// ---------------------------------------------------------------------------------------------

export async function insertPackage(
  tenantId: string,
  values: PackageInsert,
  dbx: DbOrTx = db,
): Promise<ScenarioPackage> {
  const rows = await dbx
    .insert(scenarioPackages)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return returned(rows)
}

export async function insertVersion(
  tenantId: string,
  values: VersionInsert,
  dbx: DbOrTx = db,
): Promise<ScenarioPackageVersion> {
  const rows = await dbx
    .insert(scenarioPackageVersions)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return returned(rows)
}

/** The version with every element, seed record included (authors, reviewers, editors; never students). */
export async function findVersionFull(tenantId: string, versionId: string, dbx: DbOrTx = db) {
  return dbx.query.scenarioPackageVersions.findFirst({
    where: and(
      eq(scenarioPackageVersions.id, versionId),
      eq(scenarioPackageVersions.organizationId, tenantId),
    ),
    with: {
      package: true,
      seedRecord: true,
      documents: { orderBy: (t, { asc }) => [asc(t.position)] },
      stakeholders: { orderBy: (t, { asc }) => [asc(t.key)] },
      answerSpacePositions: { orderBy: (t, { asc }) => [asc(t.position)] },
      namedFields: { orderBy: (t, { asc }) => [asc(t.position)] },
      claims: { orderBy: (t, { asc }) => [asc(t.position)], with: { variantStates: true } },
      variants: { orderBy: (t, { asc }) => [asc(t.key)], with: { claimStates: true } },
      probe: true,
      turn: true,
      defenseQuestions: { orderBy: (t, { asc }) => [asc(t.position)] },
      readinessItems: { orderBy: (t, { asc }) => [asc(t.position)] },
    },
  })
}

export type VersionFull = NonNullable<Awaited<ReturnType<typeof findVersionFull>>>

/**
 * The version with every element the run engine needs; the seed record never leaves authoring.
 *
 * **Not the student's read.** This loads the warranted stances, the evidence statuses, the failure
 * families, the verification paths, the question bank with its expected-answer notes and the probe's
 * scripted reversal — everything 12 §8.1 withholds until a run is scored. It is for server-side
 * work that needs them (surfacing a claim, selecting a question, scoring); anything a student
 * receives is read by `findRunScenario` below (D-252).
 */
export async function findVersionForRun(tenantId: string, versionId: string, dbx: DbOrTx = db) {
  return dbx.query.scenarioPackageVersions.findFirst({
    where: and(
      eq(scenarioPackageVersions.id, versionId),
      eq(scenarioPackageVersions.organizationId, tenantId),
    ),
    with: {
      package: true,
      documents: { orderBy: (t, { asc }) => [asc(t.position)] },
      stakeholders: { orderBy: (t, { asc }) => [asc(t.key)] },
      answerSpacePositions: { orderBy: (t, { asc }) => [asc(t.position)] },
      namedFields: { orderBy: (t, { asc }) => [asc(t.position)] },
      claims: { orderBy: (t, { asc }) => [asc(t.position)], with: { variantStates: true } },
      variants: { orderBy: (t, { asc }) => [asc(t.key)], with: { claimStates: true } },
      probe: true,
      turn: true,
      defenseQuestions: { orderBy: (t, { asc }) => [asc(t.position)] },
      readinessItems: { orderBy: (t, { asc }) => [asc(t.position)] },
    },
  })
}

export type VersionForRun = NonNullable<Awaited<ReturnType<typeof findVersionForRun>>>

// ---------------------------------------------------------------------------------------------
// The student's read of the package their run is on (`getStudentScenario`, D-117, D-252)
//
// Rooted at the run row for the reason `runs/repository.ts` gives for `scenario_documents`: the
// question is about *this run* — which package it is on, what its brief says, which documents its
// room holds — and the join that answers it starts at the run, which is also where the tenant
// filter lives.
//
// Both reads name their columns, and that is the point of them. `GET /runs/{runId}/workspace` is
// the read a student's screen polls for the whole working period; loading the version whole to pick
// three fields off it would materialize the warranted stances, the failure families, the question
// bank and the answer keys into the request that answers it, where any Sentry `extra` or pino error
// carrying the in-flight object would carry the answer key with it. Naming eleven columns means the
// rest are never loaded, rather than loaded and then dropped by a projection somewhere above.
// ---------------------------------------------------------------------------------------------

/** One document of the room as the Evidence Room *lists* it: no body, nothing authored about it. */
export type RunScenarioDocument = Pick<
  ScenarioDocument,
  'id' | 'key' | 'title' | 'author' | 'datedOn'
>

/** One named field the Decision Brief asks for (FR-021). */
export type RunScenarioNamedField = Pick<NamedField, 'key' | 'label' | 'unit'>

/** Everything a student may read of their package, and nothing else (`StudentScenarioView`). */
export type RunScenario = {
  brief: string
  documents: RunScenarioDocument[]
  namedFields: RunScenarioNamedField[]
}

const RUN_SCENARIO_DOCUMENT_COLUMNS = {
  id: scenarioDocuments.id,
  key: scenarioDocuments.key,
  title: scenarioDocuments.title,
  author: scenarioDocuments.author,
  datedOn: scenarioDocuments.datedOn,
} as const

const RUN_SCENARIO_NAMED_FIELD_COLUMNS = {
  key: namedFields.key,
  label: namedFields.label,
  unit: namedFields.unit,
} as const

/**
 * The brief, the room as a list, and the named fields, for the run's own package version;
 * `undefined` when the run is not in the tenant, which is the same answer as a run that is not
 * there at all (08 §4).
 */
export async function findRunScenario(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunScenario | undefined> {
  const inTenant = and(eq(runs.organizationId, tenantId), eq(runs.id, runId))

  const [version] = await dbx
    .select({ brief: scenarioPackageVersions.brief })
    .from(runs)
    .innerJoin(scenarioPackageVersions, eq(scenarioPackageVersions.id, runs.packageVersionId))
    .where(inTenant)
    .limit(1)
  if (!version) return undefined

  const [documents, fields] = await Promise.all([
    dbx
      .select(RUN_SCENARIO_DOCUMENT_COLUMNS)
      .from(runs)
      .innerJoin(scenarioDocuments, eq(scenarioDocuments.packageVersionId, runs.packageVersionId))
      .where(inTenant)
      .orderBy(scenarioDocuments.position, scenarioDocuments.key),
    dbx
      .select(RUN_SCENARIO_NAMED_FIELD_COLUMNS)
      .from(runs)
      .innerJoin(namedFields, eq(namedFields.packageVersionId, runs.packageVersionId))
      .where(inTenant)
      .orderBy(namedFields.position, namedFields.key),
  ])

  return { brief: version.brief, documents, namedFields: fields }
}

/**
 * One live package of the institution (`GET /packages/{packageId}`, 07 §6). A soft-deleted row is
 * not found, exactly as `pagePackages` omits it, so a deleted package cannot be reached by id.
 */
export async function findPackage(
  tenantId: string,
  packageId: string,
  dbx: DbOrTx = db,
): Promise<ScenarioPackage | undefined> {
  return dbx.query.scenarioPackages.findFirst({
    where: and(
      eq(scenarioPackages.id, packageId),
      eq(scenarioPackages.organizationId, tenantId),
      isNull(scenarioPackages.deletedAt),
    ),
  })
}

/** A page of the institution's live packages, newest first (10 §4 `listPackages`, D-020). */
export async function pagePackages(
  tenantId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<ScenarioPackage>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select()
    .from(scenarioPackages)
    .where(
      and(
        eq(scenarioPackages.organizationId, tenantId),
        isNull(scenarioPackages.deletedAt),
        afterCursor({ createdAt: scenarioPackages.createdAt, id: scenarioPackages.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: scenarioPackages.createdAt, id: scenarioPackages.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/**
 * Every version of the given packages, newest version number first. One statement for a page of
 * packages, so the list screen costs two queries rather than one per row.
 */
export async function listVersionsForPackages(
  tenantId: string,
  packageIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<ScenarioPackageVersion[]> {
  if (packageIds.length === 0) return []
  return dbx
    .select()
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.organizationId, tenantId),
        inArray(scenarioPackageVersions.packageId, [...packageIds]),
      ),
    )
    .orderBy(desc(scenarioPackageVersions.version))
}

/**
 * Which of the given versions carry an ethical-shortcut defect — a claim state whose failure family
 * is `unacceptable_route`. The packages list turns the answer into the `FAMILY_LACKS_ETHICAL_DEFECT`
 * warning (D-083), which is why it is one grouped statement rather than a read of every state.
 */
export async function listVersionsWithEthicalDefect(
  versionIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<string[]> {
  if (versionIds.length === 0) return []
  const rows = await dbx
    .selectDistinct({ packageVersionId: scenarioVariants.packageVersionId })
    .from(variantClaimStates)
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, variantClaimStates.variantId))
    .where(
      and(
        inArray(scenarioVariants.packageVersionId, [...versionIds]),
        eq(variantClaimStates.failureFamily, 'unacceptable_route'),
      ),
    )
  return rows.map((row) => row.packageVersionId)
}

/** Every version of a package, newest version number first. */
export async function listVersions(
  tenantId: string,
  packageId: string,
  dbx: DbOrTx = db,
): Promise<ScenarioPackageVersion[]> {
  return dbx
    .select()
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.packageId, packageId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .orderBy(desc(scenarioPackageVersions.version))
}

/** Status transition (draft → confirmed → retired) with the columns that travel with it. */
export async function updateVersionStatus(
  tenantId: string,
  versionId: string,
  patch: VersionStatusPatch,
  dbx: DbOrTx = db,
): Promise<ScenarioPackageVersion | undefined> {
  const rows = await dbx
    .update(scenarioPackageVersions)
    .set(patch)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .returning()
  return rows[0]
}

/** The export-format snapshot; written before the confirming update because the row freezes after it. */
export async function writeSnapshot(
  tenantId: string,
  versionId: string,
  snapshot: PackageSnapshot,
  dbx: DbOrTx = db,
): Promise<ScenarioPackageVersion | undefined> {
  const rows = await dbx
    .update(scenarioPackageVersions)
    .set({ snapshot })
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .returning()
  return rows[0]
}

// ---------------------------------------------------------------------------------------------
// Elements (scoped through the version id the service resolved in the tenant)
// ---------------------------------------------------------------------------------------------

export async function insertSeedRecord(
  versionId: string,
  values: SeedRecordInsert,
  dbx: DbOrTx = db,
): Promise<SeedRecord> {
  const rows = await dbx
    .insert(seedRecords)
    .values({ ...values, packageVersionId: versionId })
    .returning()
  return returned(rows)
}

/** The defective and sound variants a new version starts with (createPackageFromSeed). */
export async function insertVariants(
  versionId: string,
  values: VariantInsert[],
  dbx: DbOrTx = db,
): Promise<ScenarioVariant[]> {
  if (values.length === 0) return []
  return dbx
    .insert(scenarioVariants)
    .values(values.map((value) => ({ ...value, packageVersionId: versionId })))
    .returning()
}

/**
 * Insert-or-update one element of a draft version by its natural key: `(version, key)` for keyed
 * tables, `(variant, claim)` for claim states, the version alone for the singletons (probe, turn,
 * seed record), and the version row itself for the column-backed types.
 */
export async function upsertElement<T extends ElementType>(
  tenantId: string,
  versionId: string,
  type: T,
  row: ElementInput[T],
  dbx: DbOrTx = db,
): Promise<ElementRow[T]> {
  const handler = elementHandlers[type] as ElementHandler<T>
  return handler(tenantId, versionId, row, dbx)
}

/** Every confirmation decision of the version, newest first; the service picks the latest per element. */
export async function listConfirmations(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<ElementConfirmation[]> {
  return dbx
    .select()
    .from(elementConfirmations)
    .where(eq(elementConfirmations.packageVersionId, versionId))
    .orderBy(desc(elementConfirmations.createdAt), desc(elementConfirmations.id))
}

/**
 * The people behind a set of decisions, as the confirmation record and the authoring record name
 * them (07 §6 `confirmationRecord`, `authoringRecord.editors`). Not tenant-scoped: a user id read
 * off a confirmation row of a version the caller already resolved in its institution, turned back
 * into the name that row's author signed with.
 */
export async function findUserSummaries(
  userIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<UserSummary[]> {
  if (userIds.length === 0) return []
  return dbx
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...userIds]))
}

/** Appends a decision; without an explicit `revision` it takes the next one for that element. */
export async function insertConfirmation(
  values: ConfirmationInsert,
  dbx: DbOrTx = db,
): Promise<ElementConfirmation> {
  const nextRevision = sql<number>`(
    select coalesce(max(${elementConfirmations.revision}), 0) + 1
    from ${elementConfirmations}
    where ${elementConfirmations.packageVersionId} = ${values.packageVersionId}
      and ${elementConfirmations.elementType} = ${values.elementType}
      and ${elementConfirmations.elementKey} = coalesce(${values.elementId ?? null}::uuid, ${SINGLETON_ELEMENT_KEY}::uuid)
  )`
  const rows = await dbx
    .insert(elementConfirmations)
    .values({ ...values, revision: values.revision ?? nextRevision })
    .returning()
  return returned(rows)
}

/**
 * Copies a version into a new draft (`regenerateVersion`, FR-195): the version columns, the seed
 * record, every element and both variants get new ids, and every reference between elements is
 * rewritten to the copy. Runs on the source keep their claim ids; the returned map lets the service
 * relate the two. Returns undefined when the source is not in the tenant.
 */
export async function copyVersion(
  tenantId: string,
  sourceVersionId: string,
  target: { version: number },
  dbx: DbOrTx = db,
): Promise<CopiedVersion | undefined> {
  const source = await findVersionFull(tenantId, sourceVersionId, dbx)
  if (!source) return undefined

  const version = returned(
    await dbx
      .insert(scenarioPackageVersions)
      .values({
        organizationId: tenantId,
        packageId: source.packageId,
        version: target.version,
        status: 'draft',
        calibrationStatus: source.calibrationStatus,
        conceptSet: source.conceptSet,
        brief: source.brief,
        workingClockSeconds: source.workingClockSeconds,
        turnDelaySeconds: source.turnDelaySeconds,
        difficultyProfile: source.difficultyProfile,
        generalEscalationReply: source.generalEscalationReply,
        debriefCounterfactual: source.debriefCounterfactual,
        generationModel: source.generationModel,
        generatedAt: source.generatedAt,
      })
      .returning(),
  )

  const stakeholderIds = freshIds(source.stakeholders)
  const documentIds = freshIds(source.documents)
  const claimIds = freshIds(source.claims)
  const variantIds = freshIds(source.variants)

  if (source.stakeholders.length > 0) {
    await dbx.insert(stakeholders).values(
      source.stakeholders.map((row) => ({
        ...without(row, ROW_META),
        id: mapped(stakeholderIds, row.id),
        packageVersionId: version.id,
        contradictsStakeholderId: mappedOrNull(stakeholderIds, row.contradictsStakeholderId),
      })),
    )
  }
  if (source.documents.length > 0) {
    // One statement: the superseded_by self-reference is checked at statement end.
    await dbx.insert(scenarioDocuments).values(
      source.documents.map((row) => ({
        ...without(row, ROW_META),
        id: mapped(documentIds, row.id),
        packageVersionId: version.id,
        supersededByDocumentId: mappedOrNull(documentIds, row.supersededByDocumentId),
        stakeholderId: mappedOrNull(stakeholderIds, row.stakeholderId),
      })),
    )
  }
  if (source.answerSpacePositions.length > 0) {
    await dbx.insert(answerSpacePositions).values(
      source.answerSpacePositions.map((row) => ({
        ...without(row, ROW_META),
        packageVersionId: version.id,
        supportingDocumentIds: row.supportingDocumentIds.map((id) => mapped(documentIds, id)),
      })),
    )
  }
  if (source.namedFields.length > 0) {
    await dbx.insert(namedFields).values(
      source.namedFields.map((row) => ({
        ...without(row, ROW_META),
        packageVersionId: version.id,
      })),
    )
  }
  if (source.claims.length > 0) {
    await dbx.insert(scenarioClaims).values(
      source.claims.map((row) => ({
        ...without(row, [...ROW_META, 'variantStates']),
        id: mapped(claimIds, row.id),
        packageVersionId: version.id,
        sourceDocumentId: mappedOrNull(documentIds, row.sourceDocumentId),
      })),
    )
  }
  if (source.variants.length > 0) {
    await dbx.insert(scenarioVariants).values(
      source.variants.map((row) => ({
        ...without(row, [...ROW_META, 'claimStates']),
        id: mapped(variantIds, row.id),
        packageVersionId: version.id,
      })),
    )
  }
  const states = source.variants.flatMap((variant) => variant.claimStates)
  if (states.length > 0) {
    await dbx.insert(variantClaimStates).values(
      states.map((row) => ({
        ...without(row, STATE_COPY_META),
        variantId: mapped(variantIds, row.variantId),
        claimId: mapped(claimIds, row.claimId),
        verificationPaths: copiedPaths(row.verificationPaths, documentIds),
      })),
    )
  }
  if (source.probe) {
    await dbx.insert(sycophancyProbes).values({
      ...without(source.probe, ROW_META),
      packageVersionId: version.id,
      claimId: mapped(claimIds, source.probe.claimId),
    })
  }
  if (source.turn) {
    await dbx.insert(scenarioTurns).values({
      ...without(source.turn, ROW_META),
      packageVersionId: version.id,
      stakeholderId: mappedOrNull(stakeholderIds, source.turn.stakeholderId),
      windowClaimIds: source.turn.windowClaimIds.map((id) => mapped(claimIds, id)),
    })
  }
  if (source.defenseQuestions.length > 0) {
    await dbx.insert(defenseQuestions).values(
      source.defenseQuestions.map((row) => ({
        ...without(row, ROW_META),
        packageVersionId: version.id,
        claimId: mappedOrNull(claimIds, row.claimId),
      })),
    )
  }
  if (source.readinessItems.length > 0) {
    await dbx.insert(readinessItems).values(
      source.readinessItems.map((row) => ({
        ...without(row, ROW_META),
        packageVersionId: version.id,
      })),
    )
  }
  if (source.seedRecord) {
    await dbx.insert(seedRecords).values({
      ...without(source.seedRecord, ROW_META),
      packageVersionId: version.id,
    })
  }

  return { version, claimIdMap: Object.fromEntries(claimIds) }
}

/** The claim object (FR-180): the claim, its source document, and its per-variant states (or one). */
export async function findClaimWithState(
  versionId: string,
  claimId: string,
  variantId: string | null = null,
  dbx: DbOrTx = db,
) {
  return dbx.query.scenarioClaims.findFirst({
    where: and(eq(scenarioClaims.id, claimId), eq(scenarioClaims.packageVersionId, versionId)),
    with: {
      sourceDocument: true,
      variantStates:
        variantId === null
          ? { with: { variant: true } }
          : { where: (t, { eq }) => eq(t.variantId, variantId), with: { variant: true } },
    },
  })
}

export type ClaimWithState = NonNullable<Awaited<ReturnType<typeof findClaimWithState>>>
