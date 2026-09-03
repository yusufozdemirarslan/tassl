// Module `defense` (docs/tech/10-backend-spec-modules.md §9) — repository. Query bodies only: the
// rendered defense questions and their answers (DATA-039). Both tables are children of the run row
// and are scoped through the runId the service already resolved, so they take no tenantId (D-006).
import { and, asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type NewRunDefenseAnswer,
  type NewRunDefenseQuestion,
  type RunDefenseAnswer,
  type RunDefenseQuestion,
  runDefenseAnswers,
  runDefenseQuestions,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/** One rendered question with its answer (null while unanswered). */
export type RunQuestionWithAnswer = {
  question: RunDefenseQuestion
  answer: RunDefenseAnswer | null
}

/** A question with its answer and the follow-up already asked for it, when there is one. */
export type RunQuestionDetail = RunQuestionWithAnswer & { followUp: RunDefenseQuestion | null }

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** Inserts the selected (or follow-up) questions for one run; every row lands on `runId`. */
export async function insertRunQuestions(
  runId: string,
  rows: Omit<NewRunDefenseQuestion, 'runId'>[],
  dbx: DbOrTx = db,
): Promise<RunDefenseQuestion[]> {
  if (rows.length === 0) return []
  return dbx
    .insert(runDefenseQuestions)
    .values(rows.map((row) => ({ ...row, runId })))
    .returning()
}

/** The questions asked in one run in `seq` order, each with its answer or null (FR-120). */
export async function listRunQuestions(
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunQuestionWithAnswer[]> {
  return dbx
    .select({ question: runDefenseQuestions, answer: runDefenseAnswers })
    .from(runDefenseQuestions)
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(asc(runDefenseQuestions.seq))
}

/** Inserts one answer; the unique index on `run_defense_question_id` refuses a second one. */
export async function insertAnswer(
  row: NewRunDefenseAnswer,
  dbx: DbOrTx = db,
): Promise<RunDefenseAnswer> {
  const [answer] = await dbx.insert(runDefenseAnswers).values(row).returning()
  return one(answer)
}

/** One question of one run with its answer and its follow-up (both null when absent). */
export async function findRunQuestion(
  runId: string,
  runQuestionId: string,
  dbx: DbOrTx = db,
): Promise<RunQuestionDetail | null> {
  const followUps = alias(runDefenseQuestions, 'follow_ups')
  const [row] = await dbx
    .select({ question: runDefenseQuestions, answer: runDefenseAnswers, followUp: followUps })
    .from(runDefenseQuestions)
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .leftJoin(followUps, eq(followUps.followUpOf, runDefenseQuestions.id))
    .where(and(eq(runDefenseQuestions.runId, runId), eq(runDefenseQuestions.id, runQuestionId)))
    .limit(1)
  return row ?? null
}
