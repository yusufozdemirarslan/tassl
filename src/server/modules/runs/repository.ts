// Module `runs` — repository (docs/tech/10-backend-spec-modules.md §6; tables 06-data-model.md §3.4).
// Query bodies only: no state rules, no permission checks, no trace writes (the service appends
// events through the `trace` module in the same transaction). `runs` is tenant-scoped (D-006), so
// every function that touches it takes `tenantId` first and filters on `organizationId`; the child
// tables (run_frames, run_briefs, …) have no organization_id and are scoped through the run id the
// service already resolved. The database handle is always the last parameter (10 §6).
import { and, eq, isNull, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  afterCursor,
  clampLimit,
  decodeCursor,
  toPage,
  type Page,
  type PageInput,
  cursorOrder,
} from '@/server/db/pagination'
import {
  assignments,
  runAddenda,
  runBriefs,
  runDocumentOpens,
  runFrames,
  runPauses,
  runReadinessAnswers,
  runReadinessResults,
  runTurnResponses,
  runs,
  scenarioVariants,
  type Assignment,
  type NewRun,
  type NewRunBrief,
  type NewRunDocumentOpen,
  type NewRunFrame,
  type NewRunPause,
  type NewRunReadinessAnswer,
  type NewRunReadinessResult,
  type NewRunTurnResponse,
  type Run,
  type RunAddendum,
  type RunBrief,
  type RunDocumentOpen,
  type RunFrame,
  type RunPause,
  type RunReadinessAnswer,
  type RunReadinessResult,
  type RunTurnResponse,
  type ScenarioVariant,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// ---------------------------------------------------------------------------------------------
// Input and result shapes (rows come straight from the schema; nothing is spread into new shapes)
// ---------------------------------------------------------------------------------------------

/** Everything the service supplies for a new run; `organizationId` comes from `tenantId`. */
export type RunInsert = Omit<NewRun, 'organizationId'>

/** Column patch for `updateRun`; identity and tenancy columns never change. */
export type RunPatch = Partial<Omit<NewRun, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>

export type RunState = Run['state']

/** The run row with the read models the run module owns (delegations and claims live in theirs). */
export type RunFull = {
  run: Run
  frame: RunFrame | null
  brief: RunBrief | null
  addendum: RunAddendum | null
  turnResponse: RunTurnResponse | null
  readiness: RunReadinessResult | null
  documentOpens: RunDocumentOpen[]
  pauses: RunPause[]
}

export type ReadinessAnswerInsert = Omit<
  NewRunReadinessAnswer,
  'id' | 'runId' | 'createdAt' | 'updatedAt'
>
export type ReadinessResultInsert = Omit<NewRunReadinessResult, 'runId' | 'createdAt' | 'updatedAt'>
export type DocumentOpenInsert = Omit<
  NewRunDocumentOpen,
  'id' | 'runId' | 'createdAt' | 'updatedAt'
>
export type DocumentOpenClose = {
  closedAt: Date
  durationMs: number
  skim: boolean | null
}
export type FrameInsert = Omit<NewRunFrame, 'runId' | 'createdAt'>

/** The editable brief fields (FR-100); the service validates them, the repository stores them. */
export type BriefDraft = Partial<
  Pick<
    NewRunBrief,
    'recommendation' | 'rationale' | 'assumptions' | 'changeMyMind' | 'confidence' | 'namedValues'
  >
>
export type BriefLock = BriefDraft & {
  lockedAt: Date
  autoLocked?: boolean
  speedOutlier?: boolean
}
export type TurnResponseInsert = Omit<NewRunTurnResponse, 'runId' | 'createdAt'>
export type PauseInsert = Omit<NewRunPause, 'id' | 'runId' | 'createdAt'>
export type PauseResume = { resumedAt: Date; creditedMs: number }

/** One row of the student's run list: the run plus the labels the summary shows. */
export type RunListItem = {
  id: string
  createdAt: Date
  run: Run
  assignment: Pick<Assignment, 'id' | 'label' | 'runType'>
  variant: Pick<ScenarioVariant, 'id' | 'key'>
}
export type RunListInput = PageInput & { state?: RunState | null | undefined }

/** `INSERT … RETURNING` always yields its row; an empty result is a driver fault, not a domain case. */
function returned<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

// ---------------------------------------------------------------------------------------------
// The run row
// ---------------------------------------------------------------------------------------------

export async function insertRun(
  tenantId: string,
  values: RunInsert,
  dbx: DbOrTx = db,
): Promise<Run> {
  const rows = await dbx
    .insert(runs)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return returned(rows)
}

/** `SELECT … FOR UPDATE` on the run row: every run mutation starts here (10 §6). */
export async function findRunForUpdate(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<Run | undefined> {
  const [row] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .for('update')
  return row
}

/** The run with its own read models; `undefined` when the run is not in the tenant. */
export async function findRunFull(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunFull | undefined> {
  const [run] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  if (!run) return undefined

  const [frames, briefs, addenda, turnResponses, readiness, documentOpens, pauses] =
    await Promise.all([
      dbx.select().from(runFrames).where(eq(runFrames.runId, run.id)),
      dbx.select().from(runBriefs).where(eq(runBriefs.runId, run.id)),
      dbx.select().from(runAddenda).where(eq(runAddenda.runId, run.id)),
      dbx.select().from(runTurnResponses).where(eq(runTurnResponses.runId, run.id)),
      dbx.select().from(runReadinessResults).where(eq(runReadinessResults.runId, run.id)),
      dbx
        .select()
        .from(runDocumentOpens)
        .where(eq(runDocumentOpens.runId, run.id))
        .orderBy(runDocumentOpens.openedAt, runDocumentOpens.id),
      dbx
        .select()
        .from(runPauses)
        .where(eq(runPauses.runId, run.id))
        .orderBy(runPauses.pausedAt, runPauses.id),
    ])

  return {
    run,
    frame: frames[0] ?? null,
    brief: briefs[0] ?? null,
    addendum: addenda[0] ?? null,
    turnResponse: turnResponses[0] ?? null,
    readiness: readiness[0] ?? null,
    documentOpens,
    pauses,
  }
}

export async function updateRun(
  tenantId: string,
  runId: string,
  patch: RunPatch,
  dbx: DbOrTx = db,
): Promise<Run | undefined> {
  const [row] = await dbx
    .update(runs)
    .set(patch)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .returning()
  return row
}

/** `max(attempt_no) + 1` for the student on the assignment; 1 when there is no run yet. */
export async function nextAttemptNo(
  tenantId: string,
  assignmentId: string,
  studentId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const [row] = await dbx
    .select({ next: sql<number>`coalesce(max(${runs.attemptNo}), 0) + 1` })
    .from(runs)
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.assignmentId, assignmentId),
        eq(runs.studentId, studentId),
      ),
    )
  return Number(row?.next ?? 1)
}

// ---------------------------------------------------------------------------------------------
// Readiness (DATA-030)
// ---------------------------------------------------------------------------------------------

/** Upsert on `(run_id, item_id)`: re-answering an item replaces the earlier answer. */
export async function insertReadinessAnswer(
  runId: string,
  values: ReadinessAnswerInsert,
  dbx: DbOrTx = db,
): Promise<RunReadinessAnswer> {
  const rows = await dbx
    .insert(runReadinessAnswers)
    .values({ ...values, runId })
    .onConflictDoUpdate({
      target: [runReadinessAnswers.runId, runReadinessAnswers.itemId],
      set: {
        answerKey: sql`excluded.answer_key`,
        correct: sql`excluded.correct`,
        answeredAt: sql`excluded.answered_at`,
      },
    })
    .returning()
  return returned(rows)
}

export async function listReadinessAnswers(
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunReadinessAnswer[]> {
  return dbx
    .select()
    .from(runReadinessAnswers)
    .where(eq(runReadinessAnswers.runId, runId))
    .orderBy(runReadinessAnswers.answeredAt, runReadinessAnswers.id)
}

export async function insertReadinessResult(
  runId: string,
  values: ReadinessResultInsert,
  dbx: DbOrTx = db,
): Promise<RunReadinessResult> {
  const rows = await dbx
    .insert(runReadinessResults)
    .values({ ...values, runId })
    .returning()
  return returned(rows)
}

// ---------------------------------------------------------------------------------------------
// Evidence Room opens (DATA-031)
// ---------------------------------------------------------------------------------------------

export async function insertDocumentOpen(
  runId: string,
  values: DocumentOpenInsert,
  dbx: DbOrTx = db,
): Promise<RunDocumentOpen> {
  const rows = await dbx
    .insert(runDocumentOpens)
    .values({ ...values, runId })
    .returning()
  return returned(rows)
}

/** Closes one still-open record; `undefined` when it is unknown to the run or already closed. */
export async function closeDocumentOpen(
  runId: string,
  openId: string,
  close: DocumentOpenClose,
  dbx: DbOrTx = db,
): Promise<RunDocumentOpen | undefined> {
  const [row] = await dbx
    .update(runDocumentOpens)
    .set(close)
    .where(
      and(
        eq(runDocumentOpens.runId, runId),
        eq(runDocumentOpens.id, openId),
        isNull(runDocumentOpens.closedAt),
      ),
    )
    .returning()
  return row
}

// ---------------------------------------------------------------------------------------------
// Frame, brief, addendum, Turn response (DATA-032, DATA-037, DATA-038)
// ---------------------------------------------------------------------------------------------

export async function insertFrame(
  runId: string,
  values: FrameInsert,
  dbx: DbOrTx = db,
): Promise<RunFrame> {
  const rows = await dbx
    .insert(runFrames)
    .values({ ...values, runId })
    .returning()
  return returned(rows)
}

/**
 * Creates or replaces the unlocked draft and stamps `draft_updated_at`. Returns `undefined` when the
 * brief is already locked (the `run_briefs_locked` trigger would refuse the write; the guard keeps
 * that a domain result rather than a database error).
 */
export async function upsertBriefDraft(
  runId: string,
  draft: BriefDraft,
  dbx: DbOrTx = db,
): Promise<RunBrief | undefined> {
  const draftUpdatedAt = new Date()
  const [row] = await dbx
    .insert(runBriefs)
    .values({ ...draft, runId, draftUpdatedAt })
    .onConflictDoUpdate({
      target: runBriefs.runId,
      set: { ...draft, draftUpdatedAt },
      setWhere: isNull(runBriefs.lockedAt),
    })
    .returning()
  return row
}

/**
 * Stores the final brief and sets `locked_at` in one statement, whether or not a draft row exists.
 * Returns `undefined` when the brief was already locked; the row is immutable from here on.
 */
export async function lockBrief(
  runId: string,
  values: BriefLock,
  dbx: DbOrTx = db,
): Promise<RunBrief | undefined> {
  const [row] = await dbx
    .insert(runBriefs)
    .values({ ...values, runId, draftUpdatedAt: values.lockedAt })
    .onConflictDoUpdate({
      target: runBriefs.runId,
      set: { ...values, draftUpdatedAt: values.lockedAt },
      setWhere: isNull(runBriefs.lockedAt),
    })
    .returning()
  return row
}

/** One addendum per run: a second insert returns `undefined` and leaves the first untouched. */
export async function insertAddendum(
  runId: string,
  text: string,
  dbx: DbOrTx = db,
): Promise<RunAddendum | undefined> {
  const [row] = await dbx
    .insert(runAddenda)
    .values({ runId, text })
    .onConflictDoNothing({ target: runAddenda.runId })
    .returning()
  return row
}

export async function insertTurnResponse(
  runId: string,
  values: TurnResponseInsert,
  dbx: DbOrTx = db,
): Promise<RunTurnResponse> {
  const rows = await dbx
    .insert(runTurnResponses)
    .values({ ...values, runId })
    .returning()
  return returned(rows)
}

// ---------------------------------------------------------------------------------------------
// Pauses (DATA-040)
// ---------------------------------------------------------------------------------------------

export async function insertPause(
  runId: string,
  values: PauseInsert,
  dbx: DbOrTx = db,
): Promise<RunPause> {
  const rows = await dbx
    .insert(runPauses)
    .values({ ...values, runId })
    .returning()
  return returned(rows)
}

/** Sets `resumed_at` and the credit on one open pause; `undefined` when it is not open. */
export async function resumePause(
  runId: string,
  pauseId: string,
  resume: PauseResume,
  dbx: DbOrTx = db,
): Promise<RunPause | undefined> {
  const [row] = await dbx
    .update(runPauses)
    .set(resume)
    .where(and(eq(runPauses.runId, runId), eq(runPauses.id, pauseId), isNull(runPauses.resumedAt)))
    .returning()
  return row
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

/** The student's run list in the tenant, newest first, with assignment and variant labels (D-020). */
export async function listRunsForStudent(
  tenantId: string,
  studentId: string,
  input: RunListInput = {},
  dbx: DbOrTx = db,
): Promise<Page<RunListItem>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select({
      id: runs.id,
      createdAt: runs.createdAt,
      run: runs,
      assignment: { id: assignments.id, label: assignments.label, runType: assignments.runType },
      variant: { id: scenarioVariants.id, key: scenarioVariants.key },
    })
    .from(runs)
    .innerJoin(
      assignments,
      and(eq(assignments.id, runs.assignmentId), eq(assignments.organizationId, tenantId)),
    )
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.studentId, studentId),
        input.state ? eq(runs.state, input.state) : undefined,
        afterCursor({ createdAt: runs.createdAt, id: runs.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: runs.createdAt, id: runs.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}
