// Module `authoring` — repository (docs/tech/10-backend-spec-modules.md §5; tables 06-data-model.md
// §3.3: generation_runs and the element tables a generation step writes). Query bodies only: the
// pipeline, its retries and its validation subsets live in the service and the job handler. None of
// these tables carries an organization_id; every function is scoped through the version id the
// service already resolved in the tenant. Writes to a confirmed version surface as `VERSION_FROZEN`
// from the package_frozen trigger family. The database handle is always the last parameter (10 §6).
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PgColumn, PgInsertValue, PgTable } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  answerSpacePositions,
  defenseQuestions,
  elementConfirmations,
  generationRuns,
  namedFields,
  readinessItems,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioTurns,
  scenarioVariants,
  seedRecords,
  stakeholders,
  sycophancyProbes,
  variantClaimStates,
  type AnswerSpacePosition,
  type DefenseQuestion,
  type GenerationRun,
  type NamedField,
  type NewAnswerSpacePosition,
  type NewDefenseQuestion,
  type NewGenerationRun,
  type NewNamedField,
  type NewReadinessItem,
  type NewScenarioClaim,
  type NewScenarioDocument,
  type NewScenarioTurn,
  type NewSeedRecord,
  type NewStakeholder,
  type NewSycophancyProbe,
  type NewVariantClaimState,
  type ReadinessItem,
  type ScenarioClaim,
  type ScenarioDocument,
  type ScenarioTurn,
  type SeedRecord,
  type Stakeholder,
  type SycophancyProbe,
  type ElementConfirmation,
  type ScenarioPackageVersion,
  type VariantClaimState,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service may not import `@/server/db` (04 §2), so the row types it hands out and the
// transaction boundary its writes open are re-exported by the layer that owns database access —
// the same seam `scenarios/repository.ts` keeps.
export type { ElementConfirmation, GenerationRun, NewGenerationRun } from '@/server/db/schema'
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

// ---------------------------------------------------------------------------------------------
// Input and result shapes (rows come straight from the schema; nothing is spread into new shapes)
// ---------------------------------------------------------------------------------------------

/** Everything a generation step reports after it ran; identity and parent never change. */
export type GenerationRunPatch = Partial<
  Omit<NewGenerationRun, 'id' | 'packageVersionId' | 'createdAt'>
>

/** The element types a generation step writes as a set (the table-backed ones; 06 §3.3). */
export type TableElementType =
  | 'document'
  | 'stakeholder'
  | 'answer_space_position'
  | 'named_field'
  | 'claim'
  | 'variant_claim_state'
  | 'probe'
  | 'turn'
  | 'defense_question'
  | 'readiness_item'
  | 'seed_reskin'

type WithoutVersion<T> = Omit<T, 'packageVersionId'>

/** Rows as the step hands them over; the version id comes from the parameter. */
export type ElementInput = {
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
  seed_reskin: WithoutVersion<NewSeedRecord>
}

export type ElementRow = {
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
  seed_reskin: SeedRecord
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** `INSERT … RETURNING` always yields its row; an empty result is a driver fault, not a domain case. */
function returned<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Deletes the version's rows of one table and inserts the replacement set (empty set = clear). */
async function replaceRows<TTable extends PgTable>(
  table: TTable,
  versionColumn: PgColumn,
  versionId: string,
  values: TTable['$inferInsert'][],
  dbx: DbOrTx,
): Promise<TTable['$inferSelect'][]> {
  await dbx.delete(table).where(eq(versionColumn, versionId))
  if (values.length === 0) return []
  const rows = await dbx
    .insert(table)
    .values(values as PgInsertValue<TTable>[])
    .returning()
  return rows as TTable['$inferSelect'][]
}

type Replacer<K extends TableElementType> = (
  versionId: string,
  rows: ElementInput[K][],
  dbx: DbOrTx,
) => Promise<ElementRow[K][]>

const withVersion = <T>(versionId: string, rows: WithoutVersion<T>[]) =>
  rows.map((row) => ({ ...row, packageVersionId: versionId }))

const replacers: { [K in TableElementType]: Replacer<K> } = {
  document: (versionId, rows, dbx) =>
    replaceRows(
      scenarioDocuments,
      scenarioDocuments.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  stakeholder: (versionId, rows, dbx) =>
    replaceRows(
      stakeholders,
      stakeholders.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  answer_space_position: (versionId, rows, dbx) =>
    replaceRows(
      answerSpacePositions,
      answerSpacePositions.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  named_field: (versionId, rows, dbx) =>
    replaceRows(
      namedFields,
      namedFields.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  claim: (versionId, rows, dbx) =>
    replaceRows(
      scenarioClaims,
      scenarioClaims.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  // Claim states reach the version through their variant.
  variant_claim_state: async (versionId, rows, dbx) => {
    await dbx
      .delete(variantClaimStates)
      .where(
        inArray(
          variantClaimStates.variantId,
          dbx
            .select({ id: scenarioVariants.id })
            .from(scenarioVariants)
            .where(eq(scenarioVariants.packageVersionId, versionId)),
        ),
      )
    if (rows.length === 0) return []
    return dbx.insert(variantClaimStates).values(rows).returning()
  },
  probe: (versionId, rows, dbx) =>
    replaceRows(
      sycophancyProbes,
      sycophancyProbes.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  turn: (versionId, rows, dbx) =>
    replaceRows(
      scenarioTurns,
      scenarioTurns.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  defense_question: (versionId, rows, dbx) =>
    replaceRows(
      defenseQuestions,
      defenseQuestions.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  readiness_item: (versionId, rows, dbx) =>
    replaceRows(
      readinessItems,
      readinessItems.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
  seed_reskin: (versionId, rows, dbx) =>
    replaceRows(
      seedRecords,
      seedRecords.packageVersionId,
      versionId,
      withVersion(versionId, rows),
      dbx,
    ),
}

// ---------------------------------------------------------------------------------------------
// Generation runs (DATA-027)
// ---------------------------------------------------------------------------------------------

export async function insertGenerationRun(
  values: NewGenerationRun,
  dbx: DbOrTx = db,
): Promise<GenerationRun> {
  const rows = await dbx.insert(generationRuns).values(values).returning()
  return returned(rows)
}

export async function updateGenerationRun(
  id: string,
  patch: GenerationRunPatch,
  dbx: DbOrTx = db,
): Promise<GenerationRun | undefined> {
  const rows = await dbx
    .update(generationRuns)
    .set(patch)
    .where(eq(generationRuns.id, id))
    .returning()
  return rows[0]
}

/** Every step run of the version, newest first (the status view groups them by step and pass). */
export async function listGenerationRuns(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<GenerationRun[]> {
  return dbx
    .select()
    .from(generationRuns)
    .where(eq(generationRuns.packageVersionId, versionId))
    .orderBy(desc(generationRuns.createdAt), desc(generationRuns.id))
}

// ---------------------------------------------------------------------------------------------
// Element sets
// ---------------------------------------------------------------------------------------------

/**
 * Replaces the version's elements of one type with `rows` (a generation step's output, or an empty
 * set to clear them). Rows that reference the replaced ones (claims → documents, states → claims)
 * are the service's ordering concern; the database refuses a dangling reference.
 */
export async function replaceElements<T extends TableElementType>(
  versionId: string,
  type: T,
  rows: ElementInput[T][],
  dbx: DbOrTx = db,
): Promise<ElementRow[T][]> {
  const replacer = replacers[type] as Replacer<T>
  return replacer(versionId, rows, dbx)
}

// ---------------------------------------------------------------------------------------------
// The generation lock (D-400, D-531)
// ---------------------------------------------------------------------------------------------

/**
 * Takes the version row's write lock and answers with the row as it stands under it.
 *
 * This is what makes a second `startGeneration`, or a second job for the same step, harmless. It is
 * **not** the queue's singleton key: pg-boss applies a key as a dedupe only under a
 * `singleton`-family policy, and every queue here is created with the default `standard` policy, so
 * a second `send` with the same key makes a second job (D-400). The key stays because it makes the
 * queue table readable; the guarantee is here, and `tests/integration/authoring/pipeline.test.ts`
 * asserts the behaviour that exists rather than the one that was assumed.
 *
 * Must be called inside a transaction: outside one the lock is released the moment the statement
 * returns, which is the same as no lock at all.
 */
export async function lockVersionForGeneration(
  tenantId: string,
  versionId: string,
  tx: DbOrTx,
): Promise<ScenarioPackageVersion | undefined> {
  const rows = await tx
    .select()
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .for('update')
  return rows[0]
}

/** A step of this version that has not finished: the reason a second start is refused (10 §5). */
export async function findUnfinishedGenerationRun(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<GenerationRun | undefined> {
  const rows = await dbx
    .select()
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.packageVersionId, versionId),
        inArray(generationRuns.status, ['queued', 'running']),
      ),
    )
    .orderBy(asc(generationRuns.createdAt))
    .limit(1)
  return rows[0]
}

/** The one row for a `(version, step, pass)`, which is how a job finds the work it was sent for. */
export async function findGenerationRun(
  versionId: string,
  step: GenerationRun['step'],
  passNumber: number,
  dbx: DbOrTx = db,
): Promise<GenerationRun | undefined> {
  const rows = await dbx
    .select()
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.packageVersionId, versionId),
        eq(generationRuns.step, step),
        eq(generationRuns.passNumber, passNumber),
      ),
    )
    .orderBy(desc(generationRuns.createdAt))
    .limit(1)
  return rows[0]
}

/**
 * Stamps the version with the model that generated it and when (07 §6 `authoringRecord`).
 *
 * A separate statement from `upsertElement`'s column patches because these two columns are not an
 * element: no author confirms them, and nothing in `element_confirmations` addresses them.
 */
export async function markGenerated(
  tenantId: string,
  versionId: string,
  values: { generationModel: string; generatedAt: Date },
  dbx: DbOrTx = db,
): Promise<void> {
  await dbx
    .update(scenarioPackageVersions)
    .set(values)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
}

// ---------------------------------------------------------------------------------------------
// Removing elements a regenerated set no longer holds
// ---------------------------------------------------------------------------------------------

/** The table and the version column of each element type a step writes as a set. */
const elementTables = {
  document: [scenarioDocuments, scenarioDocuments.packageVersionId, scenarioDocuments.id],
  stakeholder: [stakeholders, stakeholders.packageVersionId, stakeholders.id],
  answer_space_position: [
    answerSpacePositions,
    answerSpacePositions.packageVersionId,
    answerSpacePositions.id,
  ],
  named_field: [namedFields, namedFields.packageVersionId, namedFields.id],
  claim: [scenarioClaims, scenarioClaims.packageVersionId, scenarioClaims.id],
  defense_question: [defenseQuestions, defenseQuestions.packageVersionId, defenseQuestions.id],
  readiness_item: [readinessItems, readinessItems.packageVersionId, readinessItems.id],
  probe: [sycophancyProbes, sycophancyProbes.packageVersionId, sycophancyProbes.id],
  turn: [scenarioTurns, scenarioTurns.packageVersionId, scenarioTurns.id],
  seed_reskin: [seedRecords, seedRecords.packageVersionId, seedRecords.id],
} as const satisfies Partial<Record<TableElementType, readonly [PgTable, PgColumn, PgColumn]>>

/** The element types a generation step can delete a row of by id. */
export type DeletableElementType = keyof typeof elementTables

/**
 * Deletes the named rows of one element type, and only those.
 *
 * The counterpart of `replaceElements` for the path 10 §5 actually asks for: a step replaces the
 * *unconfirmed* elements of its type, so the confirmed ones are never named here and the delete
 * cannot reach them. A row a later element still points at (a claim behind a question, a document
 * behind a claim) makes the database refuse, which the step reports as its failure rather than
 * silently cutting the reference.
 */
export async function deleteElements(
  versionId: string,
  type: DeletableElementType,
  ids: readonly string[],
  dbx: DbOrTx = db,
): Promise<number> {
  if (ids.length === 0) return 0
  const [table, versionColumn, idColumn] = elementTables[type]
  const deleted = await dbx
    .delete(table)
    .where(and(eq(versionColumn, versionId), inArray(idColumn, [...ids])))
    .returning({ id: idColumn })
  return deleted.length
}

/** Claim states of claims a regenerated claim set dropped; step 4 owns both tables (10 §5). */
export async function deleteClaimStatesForClaims(
  claimIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<number> {
  if (claimIds.length === 0) return 0
  const deleted = await dbx
    .delete(variantClaimStates)
    .where(inArray(variantClaimStates.claimId, [...claimIds]))
    .returning({ id: variantClaimStates.id })
  return deleted.length
}

/** Claim states of the version, with the variant key each belongs to (the natural key of a state). */
export async function listClaimStates(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<{ id: string; variantId: string; variantKey: string; claimId: string }[]> {
  return dbx
    .select({
      id: variantClaimStates.id,
      variantId: variantClaimStates.variantId,
      variantKey: sql<string>`${scenarioVariants.key}`,
      claimId: variantClaimStates.claimId,
    })
    .from(variantClaimStates)
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, variantClaimStates.variantId))
    .where(eq(scenarioVariants.packageVersionId, versionId))
}

/**
 * Drops the confirmation rows filed against elements that no longer exist.
 *
 * Only for rows a step actually deleted: an element that was *replaced* keeps its history, because
 * `rejectedShare` (FR-198) counts the elements an author sent back and a regeneration that erased
 * the rejection would erase the measure with it.
 */
export async function deleteConfirmationsForElements(
  versionId: string,
  elementIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<number> {
  if (elementIds.length === 0) return 0
  const deleted = await dbx
    .delete(elementConfirmations)
    .where(
      and(
        eq(elementConfirmations.packageVersionId, versionId),
        inArray(elementConfirmations.elementId, [...elementIds]),
      ),
    )
    .returning({ id: elementConfirmations.id })
  return deleted.length
}

/** Every confirmation decision of the version, newest first (the same read `scenarios` makes). */
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
