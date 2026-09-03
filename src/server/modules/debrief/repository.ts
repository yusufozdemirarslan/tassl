// Module `debrief` (docs/tech/10-backend-spec-modules.md §13) — repository. Query bodies only: the
// stored pieces the debrief assembles in one call, and the two-question answer row (DATA-043).
// findDebriefData reads the tenant-scoped run row and takes tenantId first (D-006); the children
// (locked artifacts, claims, actions, bands, score, record, answer) are scoped through that run.
import { and, asc, eq } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type NewRunDebriefAnswer,
  type Run,
  type RunAction,
  type RunAddendum,
  type RunBand,
  type RunBrief,
  type RunClaim,
  type RunDebriefAnswer,
  type RunFrame,
  type RunRecord,
  type RunScore,
  type RunTurnResponse,
  runActions,
  runAddenda,
  runBands,
  runBriefs,
  runClaims,
  runDebriefAnswers,
  runFrames,
  runRecords,
  runScores,
  runTurnResponses,
  runs,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/** Everything the debrief reads from the run's own tables; package elements come from `scenarios`. */
export type DebriefData = {
  run: Run
  frame: RunFrame | null
  brief: RunBrief | null
  addendum: RunAddendum | null
  turnResponse: RunTurnResponse | null
  /** In surfacing order. */
  claims: RunClaim[]
  /** In completion order. */
  actions: RunAction[]
  /** In rubric (enum) order. */
  bands: RunBand[]
  score: RunScore | null
  /** The Judgment Record snapshot once confirmed; null before. */
  record: RunRecord | null
  debriefAnswer: RunDebriefAnswer | null
}

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** The debrief's stored pieces for one run of the tenant, or null when it is not there. */
export async function findDebriefData(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<DebriefData | null> {
  const [run] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  if (!run) return null

  const [frame] = await dbx.select().from(runFrames).where(eq(runFrames.runId, runId)).limit(1)
  const [brief] = await dbx.select().from(runBriefs).where(eq(runBriefs.runId, runId)).limit(1)
  const [addendum] = await dbx.select().from(runAddenda).where(eq(runAddenda.runId, runId)).limit(1)
  const [turnResponse] = await dbx
    .select()
    .from(runTurnResponses)
    .where(eq(runTurnResponses.runId, runId))
    .limit(1)
  const claims = await dbx
    .select()
    .from(runClaims)
    .where(eq(runClaims.runId, runId))
    .orderBy(asc(runClaims.surfacedAt), asc(runClaims.id))
  const actions = await dbx
    .select()
    .from(runActions)
    .where(eq(runActions.runId, runId))
    .orderBy(asc(runActions.completedAt), asc(runActions.id))
  const bands = await dbx
    .select()
    .from(runBands)
    .where(eq(runBands.runId, runId))
    .orderBy(asc(runBands.dimension))
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  const [record] = await dbx.select().from(runRecords).where(eq(runRecords.runId, runId)).limit(1)
  const [debriefAnswer] = await dbx
    .select()
    .from(runDebriefAnswers)
    .where(eq(runDebriefAnswers.runId, runId))
    .limit(1)

  return {
    run,
    frame: frame ?? null,
    brief: brief ?? null,
    addendum: addendum ?? null,
    turnResponse: turnResponse ?? null,
    claims,
    actions,
    bands,
    score: score ?? null,
    record: record ?? null,
    debriefAnswer: debriefAnswer ?? null,
  }
}

/** Inserts the one debrief answer row; the primary key on `run_id` refuses a second one. */
export async function insertDebriefAnswer(
  row: NewRunDebriefAnswer,
  dbx: DbOrTx = db,
): Promise<RunDebriefAnswer> {
  const [answer] = await dbx.insert(runDebriefAnswers).values(row).returning()
  return one(answer)
}
