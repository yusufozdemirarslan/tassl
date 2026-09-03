// Module `scoring` (docs/tech/10-backend-spec-modules.md §11) — repository. Query bodies only: the
// per-dimension bands and the score row (DATA-041, DATA-042), both children scoped through the
// runId the service resolved, plus the run row's `scoring_status`, which is tenant-scoped and so
// takes tenantId first (D-006). `updated_at` is maintained by the set_updated_at() trigger.
import { and, eq, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type NewRunBand,
  type NewRunScore,
  type Run,
  type RunBand,
  type RunScore,
  runBands,
  runScores,
  runs,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type ScoringStatus = Run['scoringStatus']

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** `excluded.<column>` for an upsert's SET clause: the value the conflicting insert carried. */
const excluded = (column: PgColumn) => sql`excluded.${sql.identifier(column.name)}`

/**
 * Inserts or replaces bands keyed by (run, dimension): the draft fields, the decision fields, and
 * the correction fields all come from the given rows, so callers pass complete rows (drafts from
 * the pipeline, decided rows from review, corrected rows from a neutralization recompute).
 */
export async function upsertBands(
  runId: string,
  rows: Omit<NewRunBand, 'runId'>[],
  dbx: DbOrTx = db,
): Promise<RunBand[]> {
  if (rows.length === 0) return []
  return dbx
    .insert(runBands)
    .values(rows.map((row) => ({ ...row, runId })))
    .onConflictDoUpdate({
      target: [runBands.runId, runBands.dimension],
      set: {
        draftBand: excluded(runBands.draftBand),
        draftStatus: excluded(runBands.draftStatus),
        draftReason: excluded(runBands.draftReason),
        basis: excluded(runBands.basis),
        provisional: excluded(runBands.provisional),
        graphKeys: excluded(runBands.graphKeys),
        evidenceEventSeqs: excluded(runBands.evidenceEventSeqs),
        quotes: excluded(runBands.quotes),
        rationale: excluded(runBands.rationale),
        decision: excluded(runBands.decision),
        decidedBand: excluded(runBands.decidedBand),
        decidedBy: excluded(runBands.decidedBy),
        decidedAt: excluded(runBands.decidedAt),
        note: excluded(runBands.note),
        bandBeforeCorrection: excluded(runBands.bandBeforeCorrection),
        bandAfterCorrection: excluded(runBands.bandAfterCorrection),
      },
    })
    .returning()
}

/** Inserts or replaces the one score row of a run (graphs, FCR, matched share, points, flags). */
export async function upsertScore(
  runId: string,
  row: Omit<NewRunScore, 'runId'>,
  dbx: DbOrTx = db,
): Promise<RunScore> {
  const [score] = await dbx
    .insert(runScores)
    .values({ ...row, runId })
    .onConflictDoUpdate({
      target: runScores.runId,
      set: {
        rubricVersion: excluded(runScores.rubricVersion),
        graphs: excluded(runScores.graphs),
        falseChallengeRate: excluded(runScores.falseChallengeRate),
        matchedStanceShare: excluded(runScores.matchedStanceShare),
        pointsDraft: excluded(runScores.pointsDraft),
        pointsConfirmed: excluded(runScores.pointsConfirmed),
        pointsBeforeCorrection: excluded(runScores.pointsBeforeCorrection),
        pointsAfterCorrection: excluded(runScores.pointsAfterCorrection),
        pointsEffective: excluded(runScores.pointsEffective),
        flags: excluded(runScores.flags),
        scoredAt: excluded(runScores.scoredAt),
      },
    })
    .returning()
  return one(score)
}

/** The score row of a run, or null before the pipeline has written one. */
export async function findScore(runId: string, dbx: DbOrTx = db): Promise<RunScore | null> {
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  return score ?? null
}

/** Sets `scoring_status` on the run row inside the tenant; null when no such run exists there. */
export async function updateScoringStatus(
  tenantId: string,
  runId: string,
  status: ScoringStatus,
  dbx: DbOrTx = db,
): Promise<Run | null> {
  const [run] = await dbx
    .update(runs)
    .set({ scoringStatus: status })
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .returning()
  return run ?? null
}
