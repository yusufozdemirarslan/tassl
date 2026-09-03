// Module `authoring` — repository (docs/tech/10-backend-spec-modules.md §5; tables 06-data-model.md
// §3.3: generation_runs and the element tables a generation step writes). Query bodies only: the
// pipeline, its retries and its validation subsets live in the service and the job handler. None of
// these tables carries an organization_id; every function is scoped through the version id the
// service already resolved in the tenant. Writes to a confirmed version surface as `VERSION_FROZEN`
// from the package_frozen trigger family. The database handle is always the last parameter (10 §6).
import { desc, eq, inArray } from 'drizzle-orm'
import type { PgColumn, PgInsertValue, PgTable } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  answerSpacePositions,
  defenseQuestions,
  generationRuns,
  namedFields,
  readinessItems,
  scenarioClaims,
  scenarioDocuments,
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
  type VariantClaimState,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

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
