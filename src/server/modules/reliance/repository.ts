// Module `reliance` — repository (docs/tech/10-backend-spec-modules.md §8; tables run_claims,
// run_actions, run_escalations, 06 §3.4). The stance matrix rows, the interrogation actions, and the
// escalations of one run. None of those three carries organization_id; each is scoped through the
// run id the service already resolved in the tenant. `relied_on` is a generated column
// (`cardinality(relied_on_via) > 0`), so reliance is written only through `relied_on_via`.
//
// Four reads and one write go to tables this module does not own, and each has a reason. The
// authored side — `scenario_claims`, `variant_claim_states`, `named_fields`, and one column of
// `scenario_package_versions` — is read here for the reason D-242 gives, and every one of those
// queries names its columns so the answer key is never selected (12 §8). The run row is read for
// the two columns a claim view needs and written for the two columns a clock charge touches
// (D-286). The three that reach a tenant-scoped table — `scenario_package_versions` and `runs` —
// take `tenantId` first and filter on it, like every tenant-scoped repository function (D-006).
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  namedFields,
  runActions,
  runClaims,
  runEscalations,
  runs,
  scenarioClaims,
  scenarioPackageVersions,
  scenarioVariants,
  variantClaimStates,
  type NamedField,
  type NewRunAction,
  type NewRunClaim,
  type NewRunEscalation,
  type RunAction,
  type RunClaim,
  type RunEscalation,
  type ScenarioClaim,
  type VerificationPaths,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service layer may not import `src/server/db` (04 §2), so the handles and row types it names
// reach it through here, the one file in this module that may.
export { withTransaction } from '@/server/db/tx'
export type { DbOrTx, Tx } from '@/server/db/tx'
export type { NamedField, RunAction, RunClaim, RunEscalation, ScenarioClaim, VerificationPaths }

/** How a claim came to count as relied on (06 §3.4 `relied_on_via`). */
export type ReliedOnVia = 'log_mark' | 'named_field' | 'turn_window'

export type Stance = NonNullable<RunClaim['stance']>

/** A surfaced claim: which scenario claim, when, by what, and whether inside the Turn window. */
export type RunClaimInsert = Omit<NewRunClaim, 'id' | 'runId' | 'createdAt' | 'updatedAt'>

/** Result of `upsertRunClaim`: the row, and whether this call surfaced the claim. */
export type RunClaimUpsert = { runClaim: RunClaim; inserted: boolean }

/** A run claim joined to the scenario claim it refers to (text, source, escalatability). */
export type RunClaimWithClaim = { runClaim: RunClaim; claim: ScenarioClaim }

/**
 * Optional narrowing for `listRunClaims`. The Decision Lock's gate asks for `reliedOn` +
 * `unstanced` (FR-084); the Turn's asks for `inTurnWindow` + `unstanced` (FR-111).
 */
export type RunClaimFilter = { reliedOn?: boolean; unstanced?: boolean; inTurnWindow?: boolean }

export type StanceUpdate = { stance: Stance; stanceSetAt: Date }
export type ReliedOnUpdate = { via: ReliedOnVia; usedMarked?: boolean }

export type ActionInsert = Omit<NewRunAction, 'id' | 'runId' | 'createdAt'>
export type ActionFilter = { claimId?: string }
export type EscalationInsert = Omit<NewRunEscalation, 'id' | 'runId' | 'createdAt'>

/** The two `runs` columns a read of the claim table needs: which package, and which variant. */
export type RunPackage = { packageVersionId: string; variantId: string }

/**
 * The clock columns an interrogation action or an escalation writes (10 §10, D-132).
 *
 * It is the shape `runs.clock.chargeCost` answers with, narrowed to the two members a *charge* can
 * touch: the working clock's `charged_ms`, and the Turn window's end instant. Structural rather
 * than imported, because a repository may reach the database and `src/lib` and nothing else — and
 * a charge that could also write `paused_at` or `credited_ms` from here would be a second way to
 * pause or credit a run, beside the one `runs` owns.
 */
export type ClockCharge = { chargedMs?: number; turnWindowEndsAt?: Date }

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

/**
 * Surfaced claims in surfacing order, each with its scenario claim.
 *
 * The tiebreak is the *authored* position, not `run_claims.id`. Several claims are routinely
 * surfaced in one instant — one delegation matching two triggers, one document carrying three
 * claims — and `run_claims.id` is a random uuid, so ordering on it puts the same run's claim list in
 * a different order on every read. The student's workspace polls this list while they work, and a
 * list that reshuffles under a cursor is a defect they would rightly report (D-274).
 */
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
        filter.inTurnWindow === undefined
          ? undefined
          : eq(runClaims.inTurnWindow, filter.inTurnWindow),
        filter.unstanced ? isNull(runClaims.stance) : undefined,
      ),
    )
    .orderBy(asc(runClaims.surfacedAt), asc(scenarioClaims.position), asc(scenarioClaims.key))
}

/** One surfaced claim with its scenario claim — the pair every mutation here reads. */
export async function findRunClaimWithClaim(
  runId: string,
  claimId: string,
  dbx: DbOrTx = db,
): Promise<RunClaimWithClaim | undefined> {
  const [row] = await dbx
    .select({ runClaim: runClaims, claim: scenarioClaims })
    .from(runClaims)
    .innerJoin(scenarioClaims, eq(scenarioClaims.id, runClaims.claimId))
    .where(and(eq(runClaims.runId, runId), eq(runClaims.claimId, claimId)))
  return row
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

/**
 * Marks a run claim neutralized, and credited when the challenge was upheld (FR-003, D-092).
 *
 * The two columns are written together because they are one act: `neutralization_id` says the row
 * is out of the arithmetic, and `inconsistency_credited` says the student's challenge is counted as
 * a match anyway. The row itself stays — the debrief shows it struck through, because the student
 * did something on that claim and deserves to see what (§11.5).
 */
export async function markClaimNeutralized(
  runId: string,
  claimId: string,
  update: { neutralizationId: string; inconsistencyCredited: boolean },
  dbx: DbOrTx = db,
): Promise<RunClaim | undefined> {
  const [row] = await dbx
    .update(runClaims)
    .set({
      neutralizationId: update.neutralizationId,
      inconsistencyCredited: update.inconsistencyCredited,
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

/**
 * How many escalations this run has spent (FR-092, D-328).
 *
 * Every row, with no filter on `counts_against_limit`. The column is still written and still
 * travels on the trace — it records which kind of reply answered, which is what the reviewer reads
 * — but it stopped governing the budget in D-328: a limit that only bit on claims carrying an
 * authored reply published, through the counter, exactly which claims those were.
 */
export async function countEscalations(runId: string, dbx: DbOrTx = db): Promise<number> {
  const [row] = await dbx
    .select({ total: count() })
    .from(runEscalations)
    .where(eq(runEscalations.runId, runId))
  return Number(row?.total ?? 0)
}

/**
 * The run's escalations, newest first.
 *
 * Newest first because the claim view shows one reply per claim and the latest is the one the
 * student is looking at; `desc(createdAt)` with the id as the tiebreak keeps that answer stable
 * when two escalations share an instant, which a polled list needs (D-274).
 */
export async function listEscalations(runId: string, dbx: DbOrTx = db): Promise<RunEscalation[]> {
  return dbx
    .select()
    .from(runEscalations)
    .where(eq(runEscalations.runId, runId))
    .orderBy(desc(runEscalations.createdAt), desc(runEscalations.id))
}

// ---------------------------------------------------------------------------------------------
// The authored side: verification paths, the general escalation reply, the named fields
//
// Read here rather than through the `scenarios` module for the reason D-242 gives, and with one
// rule that is not a matter of taste: **the answer key is never selected.**
// `variant_claim_states` carries `evidence_status`, `failure_family`, `warranted_stance` and
// `planted` in the same row as `verification_paths`, and every query below names its columns, so
// what a student's claim view is built from cannot contain them — a payload cannot leak a field
// the query never fetched (12 §8, D-265, D-117).
// ---------------------------------------------------------------------------------------------

/**
 * The confirmed verification paths of the run's variant, by claim id (FR-070, FR-071).
 *
 * The whole variant in one read: the claim list is polled while the student works, and a path
 * lookup per claim would be one query per card.
 */
export async function listVerificationPaths(
  variantId: string,
  dbx: DbOrTx = db,
): Promise<Map<string, VerificationPaths>> {
  const rows = await dbx
    .select({ claimId: variantClaimStates.claimId, paths: variantClaimStates.verificationPaths })
    .from(variantClaimStates)
    .where(eq(variantClaimStates.variantId, variantId))
  return new Map(rows.map((row) => [row.claimId, row.paths]))
}

/** One claim's confirmed verification paths on the run's variant. */
export async function findVerificationPaths(
  variantId: string,
  claimId: string,
  dbx: DbOrTx = db,
): Promise<VerificationPaths | undefined> {
  const [row] = await dbx
    .select({ paths: variantClaimStates.verificationPaths })
    .from(variantClaimStates)
    .where(
      and(eq(variantClaimStates.variantId, variantId), eq(variantClaimStates.claimId, claimId)),
    )
  return row?.paths
}

/**
 * The version's general colleague reply (FR-091), which answers an escalation on a claim with no
 * authored reply of its own.
 *
 * One column, never the version row: 12 §8.1 keeps the general reply out of every student view, and
 * it reaches a student only as the answer to an escalation they raised. `scenario_package_versions`
 * is tenant-scoped (06 §3.2), so the tenant id comes first and the query filters on it — the run
 * this is asked for names the version, and a run and its package belong to one institution.
 */
export async function findGeneralEscalationReply(
  tenantId: string,
  versionId: string,
  dbx: DbOrTx = db,
): Promise<string | undefined> {
  const [row] = await dbx
    .select({ reply: scenarioPackageVersions.generalEscalationReply })
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
  return row?.reply
}

/** The version's named brief fields in authored order, with the unit each is entered in (FR-101). */
export async function listVersionNamedFields(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<NamedField[]> {
  return dbx
    .select()
    .from(namedFields)
    .where(eq(namedFields.packageVersionId, versionId))
    .orderBy(asc(namedFields.position), asc(namedFields.key))
}

// ---------------------------------------------------------------------------------------------
// The run row: which package it draws from, and the clock a check charges (10 §10, D-132)
// ---------------------------------------------------------------------------------------------

/**
 * The two run columns a claim read needs: which version's claims, and which variant's paths.
 *
 * Tenant-scoped, so the tenant id comes first: a run row carries `organization_id`, and this is the
 * one read in this module that goes to it. A mutation does not need it — `lockRunForMutation` has
 * already handed over the whole locked row.
 */
export async function findRunPackage(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunPackage | undefined> {
  const [row] = await dbx
    .select({ packageVersionId: runs.packageVersionId, variantId: runs.variantId })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  return row
}

/**
 * Which variant the run was given, as the analytics `R` group names it (17 §3.3).
 *
 * `runs.variant_id` is a uuid and the property is the key, so one indexed read stands between the
 * two. It is copied from `runs/repository.ts` rather than reached through the runs module for the
 * reason every other authored read here is copied (D-242): a repository may reach the database and
 * `src/lib`, and a query is a smaller thing to repeat than a door to open.
 *
 * `null` when the variant row is gone, which the foreign key does not allow; the caller drops the
 * event rather than sending a guessed variant, because `variant` is the breakdown almost every
 * insight in 17 §8 splits on.
 */
export async function findVariantKey(
  variantId: string,
  dbx: DbOrTx = db,
): Promise<'defective' | 'sound' | null> {
  const [row] = await dbx
    .select({ key: scenarioVariants.key })
    .from(scenarioVariants)
    .where(eq(scenarioVariants.id, variantId))
  return row?.key ?? null
}

/**
 * Writes the clock charge an interrogation action or an escalation cost (FR-072, D-132).
 *
 * **It is called before the result is returned, and that ordering is the requirement**: FR-072 puts
 * the deduction at the moment the action starts, and `trace.append` stamps `clock_remaining_ms`
 * from the run row as the transaction has it — so a charge written after the event would record the
 * clock the student had before they spent it.
 *
 * This module writes the column rather than asking the `runs` module to, because the `runs` service
 * already calls this one when a document is opened and reaching back through its public index would
 * close the two into an import cycle (D-286). The arithmetic still belongs to `runs`:
 * `runs/clock.ts`'s `chargeCost` decides *what* to write, including the cap that lets an action
 * begun with one minute left cost one minute, and this writes exactly that patch and nothing else.
 */
export async function applyClockCharge(
  tenantId: string,
  runId: string,
  charge: ClockCharge,
  dbx: DbOrTx = db,
): Promise<void> {
  if (charge.chargedMs === undefined && charge.turnWindowEndsAt === undefined) return
  const [row] = await dbx
    .update(runs)
    .set(charge)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .returning({ id: runs.id })
  if (!row) throw new AppError('INTERNAL_ERROR', 'The clock charge matched no run.')
}
