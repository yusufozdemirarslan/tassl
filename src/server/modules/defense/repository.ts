// Module `defense` (docs/tech/10-backend-spec-modules.md §9) — repository. Query bodies only: the
// rendered defense questions and their answers (DATA-039). Both tables are children of the run row
// and are scoped through the runId the service already resolved, so they take no tenantId (D-006).
//
// Five reads below are of the **package**, not of this module's tables: the question bank and its
// authored follow-up prompts, the claims, the room's documents and the named fields. They are here
// rather than behind the `scenarios` module for the reason D-242 gives one module along — selection
// asks what *this version* authored, the answer is one indexed read per table, and a projection
// assembled from another module's views would carry fields this one has no business loading.
// `findRunPackage` is the same two columns of `runs` that `reliance/repository.ts` reads, for the
// same reason and with the same name.
//
// **Every one of them names its columns.** `defense_questions.expected_answer_notes` is the faculty
// seat's reading of a good answer (FR-123) and `variant_claim_states` is the answer key itself
// (D-117); neither is selected, so neither is loaded and then dropped — 12 §8's rule, and the same
// reading D-336 applied to the Turn's own row.
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type CarriedValue,
  type DefenseQuestionCondition,
  type NewRunDefenseAnswer,
  type NewRunDefenseQuestion,
  type RunDefenseAnswer,
  type RunDefenseQuestion,
  defenseQuestions,
  namedFields,
  runDefenseAnswers,
  runDefenseQuestions,
  runs,
  scenarioClaims,
  scenarioDocuments,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The transaction boundary, re-exported the way every other repository does it: a service may reach
// its own repository and never `src/server/db` (the `boundaries` policy), so this is the one door.
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

export type { RunDefenseAnswer, RunDefenseQuestion }

/** `defense_questions.kind` (DATA-024), which the rendered row does not store (06 §3.4). */
export type QuestionKind = BankQuestionRow['kind']

/**
 * One rendered question with its answer (null while unanswered) and the bank kind behind it.
 *
 * `kind` is joined rather than stored: `run_defense_questions` keeps what was *asked* — the
 * sequence, the rendered sentence, the follow-up link, the selecting event — and which condition
 * selected it is a fact about the bank row, which the version freezes at confirmation. It is the one
 * field of that row a student may see (`trace/owner-view.ts` classifies `defense_question.kind`
 * `owner`, and `question_id` `reviewer_only` beside it).
 */
export type RunQuestionWithAnswer = {
  question: RunDefenseQuestion
  kind: QuestionKind
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
    .select({
      question: runDefenseQuestions,
      kind: defenseQuestions.kind,
      answer: runDefenseAnswers,
    })
    .from(runDefenseQuestions)
    .innerJoin(defenseQuestions, eq(defenseQuestions.id, runDefenseQuestions.questionId))
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(asc(runDefenseQuestions.seq))
}

/**
 * The next free `seq` for this run's questions (`run_defense_questions_run_id_seq_uidx`).
 *
 * Read under the run's row lock, which every writer of this table already holds, so two follow-ups
 * cannot take the same number. A follow-up goes at the end rather than after its parent: the rows
 * already written are the record of what was asked and when, and renumbering them to make room
 * would rewrite it.
 */
export async function nextQuestionSeq(runId: string, dbx: DbOrTx = db): Promise<number> {
  const [row] = await dbx
    .select({ seq: runDefenseQuestions.seq })
    .from(runDefenseQuestions)
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(desc(runDefenseQuestions.seq))
    .limit(1)
  return (row?.seq ?? 0) + 1
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
    .select({
      question: runDefenseQuestions,
      kind: defenseQuestions.kind,
      answer: runDefenseAnswers,
      followUp: followUps,
    })
    .from(runDefenseQuestions)
    .innerJoin(defenseQuestions, eq(defenseQuestions.id, runDefenseQuestions.questionId))
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .leftJoin(followUps, eq(followUps.followUpOf, runDefenseQuestions.id))
    .where(and(eq(runDefenseQuestions.runId, runId), eq(runDefenseQuestions.id, runQuestionId)))
    .limit(1)
  return row ?? null
}

/**
 * Whether this run has already been asked the follow-up authored on one bank question (D-366).
 *
 * A follow-up row carries its parent's `question_id` — there is one authored sentence per bank row
 * and nothing renders it — so two run questions drawn from the *same* bank row would earn the same
 * sentence twice. `question_id` is therefore not unique per run, which is the fact this query is
 * built on: it looks for a row that is a follow-up (`follow_up_of` set) and carries the id.
 */
export async function hasFollowUpFor(
  runId: string,
  questionId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ id: runDefenseQuestions.id })
    .from(runDefenseQuestions)
    .where(
      and(
        eq(runDefenseQuestions.runId, runId),
        eq(runDefenseQuestions.questionId, questionId),
        isNotNull(runDefenseQuestions.followUpOf),
      ),
    )
    .limit(1)
  return row !== undefined
}

// ---------------------------------------------------------------------------------------------
// The package selection is drawn from (10 §9 step 1)
// ---------------------------------------------------------------------------------------------

/** The two columns of the run row a defense read needs: which package version, and which variant. */
export type RunPackage = { packageVersionId: string; variantId: string }

/**
 * The run's package version and variant, in the tenant the caller's guard resolved.
 *
 * `variantId` is read and never used by selection — no condition and no template may depend on the
 * variant (see the header of `selection.ts`) — and it is here because it is the second half of the
 * pair every other module reads together, and because a reader of this file should be able to see
 * that the variant was available and was not taken.
 */
export async function findRunPackage(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunPackage | null> {
  const [row] = await dbx
    .select({ packageVersionId: runs.packageVersionId, variantId: runs.variantId })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row ?? null
}

/** One authored claim, in the fields a selection condition or a template may read. */
export type SelectionClaimRow = {
  id: string
  text: string
  sourceKind: string
  sourceDocumentId: string | null
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
  carriedValues: CarriedValue[]
  position: number
}

/**
 * The version's claims, in the author's order.
 *
 * Eight columns of twenty-two. `rationale` ("what it deserved and why"), `concept_key`,
 * `escalation_reply`, `weakly_sourced`, `volatile` and the trigger phrases are not among them: none
 * is a condition or a placeholder, and D-117 keeps most of them out of a student's sight entirely.
 */
export async function listVersionClaims(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<SelectionClaimRow[]> {
  return dbx
    .select({
      id: scenarioClaims.id,
      text: scenarioClaims.text,
      sourceKind: scenarioClaims.sourceKind,
      sourceDocumentId: scenarioClaims.sourceDocumentId,
      importance: scenarioClaims.importance,
      consequenceLevel: scenarioClaims.consequenceLevel,
      carriedValues: scenarioClaims.carriedValues,
      position: scenarioClaims.position,
    })
    .from(scenarioClaims)
    .where(eq(scenarioClaims.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
}

/** One Evidence Room document: the title `{document_title}` renders, and the body FR-025 reads. */
export type SelectionDocumentRow = { id: string; title: string; body: string }

/**
 * The room's documents, in the author's order.
 *
 * The body is loaded, and it is the one place in this module where authored prose that a student
 * has not paid for is read into memory. It never reaches a payload: FR-025 asks whether a figure in
 * the brief appears anywhere in the room, which is a question about numbers, and what leaves this
 * module is one rendered question containing the student's own figure. `role`,
 * `superseded_by_document_id` and `stakeholder_id` — the missed-defect section of the debrief
 * (12 §8.2) — are not selected.
 */
export async function listVersionDocuments(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<SelectionDocumentRow[]> {
  return dbx
    .select({
      id: scenarioDocuments.id,
      title: scenarioDocuments.title,
      body: scenarioDocuments.body,
    })
    .from(scenarioDocuments)
    .where(eq(scenarioDocuments.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioDocuments.position), asc(scenarioDocuments.key))
}

/** One named numeric field of the Decision Brief (DATA-018). */
export type SelectionNamedFieldRow = {
  key: string
  label: string
  unit: 'percent' | 'ratio' | 'months' | 'usd' | 'count' | 'other'
  position: number
}

/** The version's named fields, in the author's order (D-301). */
export async function listVersionNamedFields(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<SelectionNamedFieldRow[]> {
  return dbx
    .select({
      key: namedFields.key,
      label: namedFields.label,
      unit: namedFields.unit,
      position: namedFields.position,
    })
    .from(namedFields)
    .where(eq(namedFields.packageVersionId, packageVersionId))
    .orderBy(asc(namedFields.position), asc(namedFields.key))
}

/** One bank row, in the fields selection reads; `expected_answer_notes` is not among them. */
export type BankQuestionRow = {
  id: string
  kind:
    | 'provenance'
    | 'figure_provenance'
    | 'verification'
    | 'assumption'
    | 'confidence'
    | 'frame_vs_response'
    | 'counterfactual'
    | 'default'
  claimId: string | null
  assumptionIndex: number | null
  template: string
  condition: DefenseQuestionCondition
  isDefault: boolean
  position: number
}

/** The confirmed question bank of one package version, in the author's order (DATA-024). */
export async function listQuestionBank(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<BankQuestionRow[]> {
  return dbx
    .select({
      id: defenseQuestions.id,
      kind: defenseQuestions.kind,
      claimId: defenseQuestions.claimId,
      assumptionIndex: defenseQuestions.assumptionIndex,
      template: defenseQuestions.template,
      condition: defenseQuestions.condition,
      isDefault: defenseQuestions.isDefault,
      position: defenseQuestions.position,
    })
    .from(defenseQuestions)
    .where(eq(defenseQuestions.packageVersionId, packageVersionId))
    .orderBy(asc(defenseQuestions.position), asc(defenseQuestions.key))
}

/**
 * The authored follow-up prompts for a set of bank questions (FR-123).
 *
 * Read on its own, and only for the question that was just answered: the follow-up is authored text
 * a student meets once, when their own answer earned it, and loading the whole bank's follow-ups
 * into the open would put every one of them in the process that renders the interview.
 */
export async function findFollowUpTexts(
  questionIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<Map<string, string>> {
  if (questionIds.length === 0) return new Map()
  const rows = await dbx
    .select({ id: defenseQuestions.id, followUp: defenseQuestions.followUp })
    .from(defenseQuestions)
    .where(inArray(defenseQuestions.id, [...questionIds]))
  return new Map(rows.map((row) => [row.id, row.followUp]))
}
