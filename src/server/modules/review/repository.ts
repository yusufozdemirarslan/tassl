// Module `review` (docs/tech/10-backend-spec-modules.md §12) — repository. Query bodies only: the
// stored pieces of the replay bundle read in one call, and claim neutralizations (DATA-044).
// findReplayData reads the tenant-scoped run row and takes tenantId first (D-006); the children
// (events, bands, score, questions, neutralizations, claims) are scoped through that run.
import { and, asc, desc, eq } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type ClaimNeutralization,
  type NewClaimNeutralization,
  type Run,
  type RunBand,
  type RunClaim,
  type RunDefenseAnswer,
  type RunDefenseQuestion,
  type RunEvent,
  type RunScore,
  claimNeutralizations,
  runBands,
  runClaims,
  runDefenseAnswers,
  runDefenseQuestions,
  runEvents,
  runScores,
  runs,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/** Everything the replay reads from the run's own tables; package elements come from `scenarios`. */
export type ReplayData = {
  run: Run
  /** In `seq` order. */
  events: RunEvent[]
  /** In rubric (enum) order. */
  bands: RunBand[]
  score: RunScore | null
  /** In `seq` order, each with its answer or null. */
  questions: { question: RunDefenseQuestion; answer: RunDefenseAnswer | null }[]
  /** Newest first. */
  neutralizations: ClaimNeutralization[]
  /** In surfacing order. */
  claims: RunClaim[]
}

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** The replay bundle's stored pieces for one run of the tenant, or null when it is not there. */
export async function findReplayData(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ReplayData | null> {
  const [run] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  if (!run) return null

  const events = await dbx
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq))
  const bands = await dbx
    .select()
    .from(runBands)
    .where(eq(runBands.runId, runId))
    .orderBy(asc(runBands.dimension))
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  const questions = await dbx
    .select({ question: runDefenseQuestions, answer: runDefenseAnswers })
    .from(runDefenseQuestions)
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(asc(runDefenseQuestions.seq))
  const neutralizations = await listNeutralizations(runId, dbx)
  const claims = await dbx
    .select()
    .from(runClaims)
    .where(eq(runClaims.runId, runId))
    .orderBy(asc(runClaims.surfacedAt), asc(runClaims.id))

  return { run, events, bands, score: score ?? null, questions, neutralizations, claims }
}

/** Inserts one neutralization; the service checks for an existing one on the claim first. */
export async function insertNeutralization(
  row: NewClaimNeutralization,
  dbx: DbOrTx = db,
): Promise<ClaimNeutralization> {
  const [neutralization] = await dbx.insert(claimNeutralizations).values(row).returning()
  return one(neutralization)
}

/** The neutralizations entered on one run, newest first (`created_at desc, id desc`). */
export async function listNeutralizations(
  runId: string,
  dbx: DbOrTx = db,
): Promise<ClaimNeutralization[]> {
  return dbx
    .select()
    .from(claimNeutralizations)
    .where(eq(claimNeutralizations.runId, runId))
    .orderBy(desc(claimNeutralizations.createdAt), desc(claimNeutralizations.id))
}
