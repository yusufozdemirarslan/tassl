// Module `trace` — repository (docs/tech/10-backend-spec-modules.md §10; table run_events, 06 §3.4).
// The trace is append-only: `insertEvent` is the only write, and it takes the `seq` the service
// allocated from the locked run row (`next_event_seq`). run_events has no organization_id; it is
// scoped through the run id the service already resolved in the tenant.
//
// Three functions here read or write `runs`, which is the `runs` module's table everywhere else,
// and each has its reason:
//
//   * `allocateSeq` moves `runs.next_event_seq`. That column is not a run fact — 06 §3.4 documents
//     it as the trace's sequence allocator and it exists for nothing else. What makes the committed
//     sequence 1..N with no hole and no repeat is the compare-and-set in that one statement plus
//     the fact that a rolled-back transaction takes its allocation back with it; the run row lock
//     every mutation already holds is what makes a contending writer *wait* instead of failing.
//     Keeping the statement here is what lets the trace own that property end to end.
//   * The same statement returns the run's clock columns, so `append` never has to trust a copy of
//     the row the caller read earlier (see `service.ts`).
//   * `findRunState` reads `runs.state`, which decides what the run's own student may read back
//     (`owner-view.ts`). It is one column and it is read, never written.
//
// The export reads at the foot of this file go wider still — the package version, the variant's
// claim states, the confirmation record, the run's claims, actions and readiness result, and the
// score. That is what an export *is* (FR-240): one file holding the whole of a run, assembled from
// every table the run touched. The `defense` module's repository reaches across the same way and
// for the same reason (10 §9), and each read here names its columns, so the two tables a student
// may never see — `defense_questions.expected_answer_notes` and the *other* variant's
// `variant_claim_states` — are never loaded rather than loaded and dropped (12 §8).
import { and, asc, eq, inArray } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  elementConfirmations,
  member,
  runActions,
  runClaims,
  runEvents,
  runReadinessResults,
  runScores,
  runs,
  scenarioClaims,
  scenarioPackageVersions,
  scenarioVariants,
  variantClaimStates,
  type NewRunEvent,
  type Run,
  type RunEvent,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

export type RunEventType = RunEvent['type']
export type { RunEvent }

/**
 * The run columns `append` takes from its caller: the tenant, the run, and the allocator. A `Run`
 * row satisfies it, and so does any projection carrying these three — which is what a caller inside
 * a mutation already holds from `findRunForUpdate`.
 *
 * The clock columns are deliberately *not* here. They used to be, and the event's
 * `clock_remaining_ms` was computed from whatever the caller's copy of the row happened to say: a
 * mutation that charged an action's cost and then appended stamped the event from the pre-charge
 * columns, and no type, check or test could tell. `append` now reads the clock from the row the
 * transaction itself returns (`allocateSeq`), so there is no copy left to go stale.
 */
export type TraceRun = Pick<Run, 'id' | 'organizationId' | 'nextEventSeq'>

/**
 * The run's clock, as the transaction sees it at the instant of an append (D-042, D-132). Returned
 * by `allocateSeq` and consumed by `service.clockReadingFor`; a `Run` row satisfies it too, which
 * is what lets `runs/clock.ts` read both.
 */
export type TraceClock = Pick<
  Run,
  | 'state'
  | 'workingClockSeconds'
  | 'workingStartedAt'
  | 'pausedAt'
  | 'totalPausedMs'
  | 'creditedMs'
  | 'chargedMs'
  | 'turnDeliveredAt'
  | 'turnWindowEndsAt'
  | 'turnLockedAt'
>

/** What `allocateSeq` answers: the sequence taken, and the clock it was taken at. */
export type SeqAllocation = { seq: number; clock: TraceClock }

/** One event as the service hands it over: seq, type, timestamps, actor, and the typed payload. */
export type RunEventInsert = Omit<NewRunEvent, 'id' | 'runId' | 'createdAt'>

export async function insertEvent(
  runId: string,
  event: RunEventInsert,
  dbx: DbOrTx = db,
): Promise<RunEvent> {
  const [row] = await dbx
    .insert(runEvents)
    .values({ ...event, runId })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/**
 * Takes the next sequence for the run, moves the allocator on, and answers the run's clock — in one
 * statement.
 *
 * `expected` is `next_event_seq` as the caller read it under `select … for update`. The statement
 * is a compare-and-set, and that is what makes the committed sequence gapless: two transactions
 * cannot both take the same number, and neither can skip one, because the second's `where` no
 * longer matches. It is also what catches a caller that never held the lock — it gets `undefined`,
 * which the service turns into `SEQUENCE_CONFLICT` rather than a duplicate key from the
 * `(run_id, seq)` unique index. The lock is not what makes this correct; it is what makes it
 * *live*: under the required discipline a contending mutation blocks in `findRunForUpdate` and
 * arrives here with a fresh `expected`, so it waits rather than fails. A rollback releases the
 * allocation with everything else, so committed sequences stay 1..N.
 *
 * `returning` carries the clock columns because an `update … returning` answers the row *after* the
 * statement, which in a transaction means after every write that transaction has already made. That
 * is precisely the reading an event must be stamped with, and it is why `append` no longer takes
 * the clock from its caller: there is nothing here that a caller could hand over stale.
 */
export async function allocateSeq(
  tenantId: string,
  runId: string,
  expected: number,
  dbx: DbOrTx = db,
): Promise<SeqAllocation | undefined> {
  const [row] = await dbx
    .update(runs)
    .set({ nextEventSeq: expected + 1 })
    .where(
      and(eq(runs.organizationId, tenantId), eq(runs.id, runId), eq(runs.nextEventSeq, expected)),
    )
    .returning({
      state: runs.state,
      workingClockSeconds: runs.workingClockSeconds,
      workingStartedAt: runs.workingStartedAt,
      pausedAt: runs.pausedAt,
      totalPausedMs: runs.totalPausedMs,
      creditedMs: runs.creditedMs,
      chargedMs: runs.chargedMs,
      turnDeliveredAt: runs.turnDeliveredAt,
      turnWindowEndsAt: runs.turnWindowEndsAt,
      turnLockedAt: runs.turnLockedAt,
    })
  return row ? { seq: expected, clock: row } : undefined
}

/**
 * The run's state, or `undefined` when the run is not in the tenant.
 *
 * `listEvents` needs it because what the run's own student may read back depends on where the run
 * has got to (`owner-view.ts`): the trace is sealed through the defense and opens again once the
 * run is scored. Reading it here rather than through the `runs` module's index is the same
 * resolution as `service.ts`'s import of `runs/clock` — the runs service writes trace events, so
 * the index would make the two modules a cycle.
 */
export async function findRunState(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<Run['state'] | undefined> {
  const [row] = await dbx
    .select({ state: runs.state })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  return row?.state
}

/** The whole trace in sequence order. */
export async function listEventsForRun(runId: string, dbx: DbOrTx = db): Promise<RunEvent[]> {
  return dbx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.seq))
}

/** Events of one or more types, in sequence order (graph builders filter this way). */
export async function listEventsByType(
  runId: string,
  types: RunEventType | readonly RunEventType[],
  dbx: DbOrTx = db,
): Promise<RunEvent[]> {
  const wanted = Array.isArray(types) ? [...types] : [types as RunEventType]
  if (wanted.length === 0) return []
  return dbx
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), inArray(runEvents.type, wanted)))
    .orderBy(asc(runEvents.seq))
}

// ---------------------------------------------------------------------------------------------
// The export (FR-240 to FR-243)
//
// Six reads, each returning exactly the columns `export.ts` names and no more.
//
// Only the first of them names a tenant-scoped table, and it takes `tenantId` first and filters on
// it (D-006, D-389). The other five do not, and that is a fact about their tables rather than a
// convenience: `run_events`, `run_readiness_results`, `run_claims`, `run_actions` and `run_scores`
// carry no `organization_id` and are reached only by the run id `findExportRun` has just resolved
// inside the tenant — the `findFrame`/`findBrief` shape (10 §6) — and `element_confirmations`,
// `scenario_claims`, `scenario_variants` and `variant_claim_states` carry none either, hanging off
// the `package_version_id` and `variant_id` that same tenant-scoped row returned. There is no id in
// any of them that did not come through the tenant filter above it.
// ---------------------------------------------------------------------------------------------

/** The run row's own facts, joined to the version and variant the header names. */
export type ExportRunRow = {
  runId: string
  organizationId: string
  assignmentId: string
  state: Run['state']
  mode: Run['mode']
  isWalkthrough: boolean
  workingClockSeconds: number
  confidenceAtFrame: number | null
  confidenceAtLock: number | null
  confidenceAfterTurn: number | null
  packageVersionId: string
  packageId: string
  packageVersion: number
  variantId: string
  variantKey: 'defective' | 'sound'
}

/**
 * The run, in this tenant, with the version and variant the header names — or `undefined`.
 *
 * Both tables it reads are tenant-scoped, so both are filtered — the shape
 * `findAssignmentWithContext` already has for the same pair. The five reads below take their ids
 * from the row this one returns, so this filter is the whole export's tenancy.
 */
export async function findExportRun(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ExportRunRow | undefined> {
  const [row] = await dbx
    .select({
      runId: runs.id,
      organizationId: runs.organizationId,
      assignmentId: runs.assignmentId,
      state: runs.state,
      mode: runs.mode,
      isWalkthrough: runs.isWalkthrough,
      workingClockSeconds: runs.workingClockSeconds,
      confidenceAtFrame: runs.confidenceAtFrame,
      confidenceAtLock: runs.confidenceAtLock,
      confidenceAfterTurn: runs.confidenceAfterTurn,
      packageVersionId: runs.packageVersionId,
      packageId: scenarioPackageVersions.packageId,
      packageVersion: scenarioPackageVersions.version,
      variantId: runs.variantId,
      variantKey: scenarioVariants.key,
    })
    .from(runs)
    .innerJoin(scenarioPackageVersions, eq(scenarioPackageVersions.id, runs.packageVersionId))
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.organizationId, tenantId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )
    .limit(1)
  return row
}

/** One decision of the disciplinary authority on one element of the confirmed version (FR-192). */
export type ExportConfirmationRow = {
  elementType: string
  elementId: string | null
  decision: string
  decidedByRole: string | null
  decidedAt: Date
}

/**
 * The package confirmation record, oldest decision first.
 *
 * `decidedByRole` is the confirmer's organization role, joined through `member`. It is the role PRD
 * §12 step 1 asks the header to show — "the builder's confirmation record" is a record of who, in
 * what capacity — and it is null when the confirmer no longer holds a membership in the
 * institution, which a file exported long after the fact can legitimately meet.
 */
export async function listExportConfirmations(
  packageVersionId: string,
  organizationId: string,
  dbx: DbOrTx = db,
): Promise<ExportConfirmationRow[]> {
  return dbx
    .select({
      elementType: elementConfirmations.elementType,
      elementId: elementConfirmations.elementId,
      decision: elementConfirmations.decision,
      decidedByRole: member.role,
      decidedAt: elementConfirmations.decidedAt,
    })
    .from(elementConfirmations)
    .leftJoin(
      member,
      and(
        eq(member.userId, elementConfirmations.decidedBy),
        eq(member.organizationId, organizationId),
      ),
    )
    .where(eq(elementConfirmations.packageVersionId, packageVersionId))
    .orderBy(
      asc(elementConfirmations.decidedAt),
      asc(elementConfirmations.elementType),
      asc(elementConfirmations.revision),
    )
}

/** The Readiness Check result as FR-012 records it: one status per concept. */
export type ExportReadinessRow = { conceptKey: string; status: string }

export async function listExportReadiness(
  runId: string,
  dbx: DbOrTx = db,
): Promise<ExportReadinessRow[]> {
  const [row] = await dbx
    .select({ concepts: runReadinessResults.concepts })
    .from(runReadinessResults)
    .where(eq(runReadinessResults.runId, runId))
    .limit(1)
  return (row?.concepts ?? []).map((concept) => ({
    conceptKey: concept.concept_key,
    status: concept.status,
  }))
}

/** One row of the claim table: the authored claim, its state in this variant, and what the run did. */
export type ExportClaimRow = {
  claimId: string
  key: string
  conceptKey: string
  evidenceStatus: string
  failureFamily: string | null
  importance: string
  consequenceLevel: string
  warrantedStance: string
  stanceTaken: string | null
  stanceTakenAt: Date | null
  previousStance: string | null
  reliedOn: boolean
  reliedOnVia: string[]
  neutralized: boolean
  inconsistencyCredited: boolean
}

/**
 * Every consequential claim of the run's variant, in the author's order — surfaced or not.
 *
 * The join to `run_claims` is a left join and that is the whole of D-107: a claim the student never
 * met still has a row, with no stance, because it counts in the False Challenge Rate's denominator
 * and because a defect never met is part of the record of the run. `variant_claim_states` is
 * filtered to *this* run's variant, so the other variant's answer key is never in the result set.
 */
export async function listExportClaims(
  runId: string,
  packageVersionId: string,
  variantId: string,
  dbx: DbOrTx = db,
): Promise<ExportClaimRow[]> {
  const rows = await dbx
    .select({
      claimId: scenarioClaims.id,
      key: scenarioClaims.key,
      conceptKey: scenarioClaims.conceptKey,
      evidenceStatus: variantClaimStates.evidenceStatus,
      failureFamily: variantClaimStates.failureFamily,
      importance: scenarioClaims.importance,
      consequenceLevel: scenarioClaims.consequenceLevel,
      warrantedStance: variantClaimStates.warrantedStance,
      stanceTaken: runClaims.stance,
      stanceTakenAt: runClaims.stanceSetAt,
      previousStance: runClaims.previousStance,
      reliedOn: runClaims.reliedOn,
      reliedOnVia: runClaims.reliedOnVia,
      neutralizationId: runClaims.neutralizationId,
      inconsistencyCredited: runClaims.inconsistencyCredited,
    })
    .from(scenarioClaims)
    .innerJoin(
      variantClaimStates,
      and(
        eq(variantClaimStates.claimId, scenarioClaims.id),
        eq(variantClaimStates.variantId, variantId),
      ),
    )
    .leftJoin(runClaims, and(eq(runClaims.claimId, scenarioClaims.id), eq(runClaims.runId, runId)))
    .where(eq(scenarioClaims.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))

  return rows.map(({ neutralizationId, ...rest }) => ({
    ...rest,
    reliedOn: rest.reliedOn ?? false,
    reliedOnVia: rest.reliedOnVia ?? [],
    inconsistencyCredited: rest.inconsistencyCredited ?? false,
    neutralized: neutralizationId !== null,
  }))
}

/** The interrogation actions run on each claim, in the order they were run (FR-070 to FR-072). */
export async function listExportActionsByClaim(
  runId: string,
  dbx: DbOrTx = db,
): Promise<Map<string, string[]>> {
  const rows = await dbx
    .select({ claimId: runActions.claimId, type: runActions.type })
    .from(runActions)
    .where(eq(runActions.runId, runId))
    .orderBy(asc(runActions.startedAt), asc(runActions.id))
  const byClaim = new Map<string, string[]>()
  for (const row of rows) {
    const types = byClaim.get(row.claimId)
    if (types) types.push(row.type)
    else byClaim.set(row.claimId, [row.type])
  }
  return byClaim
}

/** The computed block's scored half, or nothing before the scoring job has run (10 §11). */
export type ExportScoreRow = {
  falseChallengeRate: number | null
  points: number | null
  rubricVersion: string
}

/**
 * `run_scores`, as the export reads it.
 *
 * `false_challenge_rate` is Step 10.2's stance-matrix arithmetic, written here by Step 10.4's
 * scoring job; the export reads the column rather than recomputing it, so the file and the graph
 * cannot disagree. `points` is the confirmed figure and never the draft: 10 §11.4 keeps
 * `points_draft` out of every export, because a draft band has not reached a gradebook.
 * `points_effective` wins where a neutralization has moved it (FR-005).
 *
 * The `numeric` columns arrive as strings from postgres-js, which is what keeps their precision;
 * they are parsed here so the document carries numbers.
 */
export async function findExportScore(
  runId: string,
  dbx: DbOrTx = db,
): Promise<ExportScoreRow | undefined> {
  const [row] = await dbx
    .select({
      falseChallengeRate: runScores.falseChallengeRate,
      pointsEffective: runScores.pointsEffective,
      pointsConfirmed: runScores.pointsConfirmed,
      rubricVersion: runScores.rubricVersion,
    })
    .from(runScores)
    .where(eq(runScores.runId, runId))
    .limit(1)
  if (!row) return undefined
  const points = row.pointsEffective ?? row.pointsConfirmed
  return {
    falseChallengeRate: row.falseChallengeRate === null ? null : Number(row.falseChallengeRate),
    points: points === null ? null : Number(points),
    rubricVersion: row.rubricVersion,
  }
}
