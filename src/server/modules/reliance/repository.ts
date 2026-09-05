// Module `reliance` — repository (docs/tech/10-backend-spec-modules.md §8; tables run_claims,
// run_actions, run_escalations, 06 §3.4). The stance matrix rows, the interrogation actions, and the
// escalations of one run. None of these tables carries organization_id; every function is scoped
// through the run id the service already resolved in the tenant. `relied_on` is a generated column
// (`cardinality(relied_on_via) > 0`), so reliance is written only through `relied_on_via`.
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  runActions,
  runClaims,
  runEscalations,
  scenarioClaims,
  type NewRunAction,
  type NewRunClaim,
  type NewRunEscalation,
  type RunAction,
  type RunClaim,
  type RunEscalation,
  type ScenarioClaim,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service layer may not import `src/server/db` (04 §2), so the handles and row types it names
// reach it through here, the one file in this module that may.
export type { DbOrTx, Tx } from '@/server/db/tx'
export type { RunAction, RunClaim, RunEscalation, ScenarioClaim }

/** How a claim came to count as relied on (06 §3.4 `relied_on_via`). */
export type ReliedOnVia = 'log_mark' | 'named_field' | 'turn_window'

export type Stance = NonNullable<RunClaim['stance']>

/** A surfaced claim: which scenario claim, when, by what, and whether inside the Turn window. */
export type RunClaimInsert = Omit<NewRunClaim, 'id' | 'runId' | 'createdAt' | 'updatedAt'>

/** Result of `upsertRunClaim`: the row, and whether this call surfaced the claim. */
export type RunClaimUpsert = { runClaim: RunClaim; inserted: boolean }

/** A run claim joined to the scenario claim it refers to (text, source, escalatability). */
export type RunClaimWithClaim = { runClaim: RunClaim; claim: ScenarioClaim }

/** Optional narrowing for `listRunClaims`; the lock gate asks for `reliedOn` + `unstanced`. */
export type RunClaimFilter = { reliedOn?: boolean; unstanced?: boolean }

export type StanceUpdate = { stance: Stance; stanceSetAt: Date }
export type ReliedOnUpdate = { via: ReliedOnVia; usedMarked?: boolean }

export type ActionInsert = Omit<NewRunAction, 'id' | 'runId' | 'createdAt'>
export type ActionFilter = { claimId?: string }
export type EscalationInsert = Omit<NewRunEscalation, 'id' | 'runId' | 'createdAt'>

// ---------------------------------------------------------------------------------------------
// scenario_claims — the authored claims of the run's package version
//
// Read here rather than through the `scenarios` module for the reason D-242 gives: surfacing asks
// which claims of *this version* a document carries, and the answer is one indexed read on the
// table this module already joins for every claim view.
// ---------------------------------------------------------------------------------------------

/** Narrow a version's claims: by id (what a delegation matched) or by the document they come from. */
export type VersionClaimFilter = {
  ids?: readonly string[]
  /** `scenario_claims.source_document_id`, with `source_kind = 'document'` (FR-031). */
  sourceDocumentId?: string
}

/**
 * The version's claims matching the filter, in authored order. An empty `ids` list answers nothing
 * rather than everything: `inArray` with no values is not a filter, and surfacing an empty match
 * must surface nothing.
 */
export async function listVersionClaims(
  versionId: string,
  filter: VersionClaimFilter,
  dbx: DbOrTx = db,
): Promise<ScenarioClaim[]> {
  if (filter.ids && filter.ids.length === 0) return []
  return dbx
    .select()
    .from(scenarioClaims)
    .where(
      and(
        eq(scenarioClaims.packageVersionId, versionId),
        filter.ids ? inArray(scenarioClaims.id, [...filter.ids]) : undefined,
        filter.sourceDocumentId
          ? and(
              eq(scenarioClaims.sourceKind, 'document'),
              eq(scenarioClaims.sourceDocumentId, filter.sourceDocumentId),
            )
          : undefined,
      ),
    )
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
}

// ---------------------------------------------------------------------------------------------
// run_claims — the stance matrix (DATA-034)
// ---------------------------------------------------------------------------------------------

/**
 * Surfaces a claim once per run: the first call inserts the row and reports `inserted: true`; later
 * calls leave the existing row untouched (already-surfaced claims are referenced, not re-surfaced).
 */
export async function upsertRunClaim(
  runId: string,
  values: RunClaimInsert,
  dbx: DbOrTx = db,
): Promise<RunClaimUpsert> {
  const [inserted] = await dbx
    .insert(runClaims)
    .values({ ...values, runId })
    .onConflictDoNothing({ target: [runClaims.runId, runClaims.claimId] })
    .returning()
  if (inserted) return { runClaim: inserted, inserted: true }

  const existing = await findRunClaim(runId, values.claimId, dbx)
  if (!existing) throw new AppError('INTERNAL_ERROR', 'The surfaced claim could not be read back.')
  return { runClaim: existing, inserted: false }
}

/** Surfaced claims in surfacing order, each with its scenario claim. */
export async function listRunClaims(
  runId: string,
  filter: RunClaimFilter = {},
  dbx: DbOrTx = db,
): Promise<RunClaimWithClaim[]> {
  return dbx
    .select({ runClaim: runClaims, claim: scenarioClaims })
    .from(runClaims)
    .innerJoin(scenarioClaims, eq(scenarioClaims.id, runClaims.claimId))
    .where(
      and(
        eq(runClaims.runId, runId),
        filter.reliedOn === undefined ? undefined : eq(runClaims.reliedOn, filter.reliedOn),
        filter.unstanced ? isNull(runClaims.stance) : undefined,
      ),
    )
    .orderBy(asc(runClaims.surfacedAt), asc(runClaims.id))
}

/** The run's row for one scenario claim, by the claim id the API uses. */
export async function findRunClaim(
  runId: string,
  claimId: string,
  dbx: DbOrTx = db,
): Promise<RunClaim | undefined> {
  const [row] = await dbx
    .select()
    .from(runClaims)
    .where(and(eq(runClaims.runId, runId), eq(runClaims.claimId, claimId)))
  return row
}

/** Records a stance and keeps the one it replaces in `previous_stance` (FR-080). */
export async function setStance(
  runId: string,
  claimId: string,
  update: StanceUpdate,
  dbx: DbOrTx = db,
): Promise<RunClaim | undefined> {
  const [row] = await dbx
    .update(runClaims)
    .set({
      previousStance: sql`${runClaims.stance}`,
      stance: update.stance,
      stanceSetAt: update.stanceSetAt,
    })
    .where(and(eq(runClaims.runId, runId), eq(runClaims.claimId, claimId)))
    .returning()
  return row
}

/** Adds one route to `relied_on_via` (idempotent) and optionally sets the used mark (FR-084). */
export async function updateReliedOn(
  runId: string,
  claimId: string,
  update: ReliedOnUpdate,
  dbx: DbOrTx = db,
): Promise<RunClaim | undefined> {
  const via = sql`${update.via}::text`
  const [row] = await dbx
    .update(runClaims)
    .set({
      reliedOnVia: sql`case when ${via} = any(${runClaims.reliedOnVia}) then ${runClaims.reliedOnVia} else array_append(${runClaims.reliedOnVia}, ${via}) end`,
      ...(update.usedMarked === undefined ? {} : { usedMarked: update.usedMarked }),
    })
    .where(and(eq(runClaims.runId, runId), eq(runClaims.claimId, claimId)))
    .returning()
  return row
}

// ---------------------------------------------------------------------------------------------
// run_actions — interrogation actions (DATA-035). Append-only.
// ---------------------------------------------------------------------------------------------

export async function insertAction(
  runId: string,
  values: ActionInsert,
  dbx: DbOrTx = db,
): Promise<RunAction> {
  const [row] = await dbx
    .insert(runActions)
    .values({ ...values, runId })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Actions on the run, oldest first; narrow to one claim with `filter.claimId`. */
export async function listActions(
  runId: string,
  filter: ActionFilter = {},
  dbx: DbOrTx = db,
): Promise<RunAction[]> {
  return dbx
    .select()
    .from(runActions)
    .where(
      and(
        eq(runActions.runId, runId),
        filter.claimId ? eq(runActions.claimId, filter.claimId) : undefined,
      ),
    )
    .orderBy(asc(runActions.startedAt), asc(runActions.id))
}

// ---------------------------------------------------------------------------------------------
// run_escalations (DATA-036). Append-only.
// ---------------------------------------------------------------------------------------------

export async function insertEscalation(
  runId: string,
  values: EscalationInsert,
  dbx: DbOrTx = db,
): Promise<RunEscalation> {
  const [row] = await dbx
    .insert(runEscalations)
    .values({ ...values, runId })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Escalations that count against the per-run limit (FR-090 to FR-092). */
export async function countCountedEscalations(runId: string, dbx: DbOrTx = db): Promise<number> {
  const [row] = await dbx
    .select({ total: count() })
    .from(runEscalations)
    .where(and(eq(runEscalations.runId, runId), eq(runEscalations.countsAgainstLimit, true)))
  return Number(row?.total ?? 0)
}
