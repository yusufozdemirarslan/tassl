// Module `runs` — repository (docs/tech/10-backend-spec-modules.md §6; tables 06-data-model.md §3.4).
// Query bodies only: no state rules, no permission checks, no trace writes (the service appends
// events through the `trace` module in the same transaction). `runs` is tenant-scoped (D-006), so
// every function that touches it takes `tenantId` first and filters on `organizationId`; the child
// tables (run_frames, run_briefs, …) have no organization_id and are scoped through the run id the
// service already resolved. The database handle is always the last parameter (10 §6).
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
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
  readinessItems,
  runAddenda,
  runBriefs,
  runDocumentOpens,
  runFrames,
  runPauses,
  runReadinessAnswers,
  runReadinessResults,
  runTurnResponses,
  runs,
  scenarioDocuments,
  scenarioPackageVersions,
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
  type ReadinessItem,
  type Run,
  type RunAddendum,
  type RunBrief,
  type RunDocumentOpen,
  type RunFrame,
  type RunPause,
  type RunReadinessAnswer,
  type RunReadinessResult,
  type RunTurnResponse,
  type ScenarioPackageVersion,
  type ScenarioVariant,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service layer may not import `src/server/db` (04 §2), so the handles and row types it needs
// to name reach it through here, the one file in this module that may.
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'
export type { Page, PageInput } from '@/server/db/pagination'
export type { Run, RunDocumentOpen, RunFrame }

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

/**
 * The student's live run on the assignment, if there is one: the highest attempt that is not
 * voided (D-041). `startRun` refuses a second one (`RUN_ACTIVE_EXISTS`); a re-offer voids the old
 * run first and then writes the new one itself, so it never meets this.
 */
export async function findActiveRunForStudent(
  tenantId: string,
  assignmentId: string,
  studentId: string,
  dbx: DbOrTx = db,
): Promise<Run | undefined> {
  const [row] = await dbx
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.assignmentId, assignmentId),
        eq(runs.studentId, studentId),
        ne(runs.state, 'voided'),
      ),
    )
    .orderBy(desc(runs.attemptNo))
    .limit(1)
  return row
}

/**
 * Every run the student has started in the institution, voided ones included. It is the analytics
 * property `run_index_for_student` (17 §3.1) and nothing else: a count across assignments, which
 * `attempt_no` cannot answer because that counts attempts on one.
 */
export async function countRunsForStudent(
  tenantId: string,
  studentId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const [row] = await dbx
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.studentId, studentId)))
  return row?.total ?? 0
}

/**
 * One run with the labels a `RunSummary` carries — the single-row form of `listRunsForStudent`.
 * `undefined` when the run is not in the tenant, which is how a cross-tenant id stays a 404.
 */
export async function findRunWithLabels(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunListItem | undefined> {
  const [row] = await dbx
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
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  return row
}

// ---------------------------------------------------------------------------------------------
// Readiness (DATA-030, DATA-025)
// ---------------------------------------------------------------------------------------------

/**
 * The check a run draws, with the status of the package version it belongs to (FR-011).
 *
 * `readiness_items` is a `scenarios` table, read here rather than through that module because the
 * question is about *this run* — which sixteen items it draws — and the two joins that answer it
 * start at `runs`. It is the same reading as the assignment and variant labels
 * `findRunWithLabels` joins: the runs repository owns queries rooted in a run, whatever they reach.
 * The version's status travels with them so the service can apply FR-011 ("an unconfirmed item is
 * never drawn") without a second round trip.
 */
export type ReadinessSet = {
  versionStatus: ScenarioPackageVersion['status']
  items: ReadinessItem[]
}

/** The run's check in position order; `undefined` when the run is not in the tenant. */
export async function findReadinessSet(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ReadinessSet | undefined> {
  const rows = await dbx
    .select({ status: scenarioPackageVersions.status, item: readinessItems })
    .from(runs)
    .innerJoin(scenarioPackageVersions, eq(scenarioPackageVersions.id, runs.packageVersionId))
    .leftJoin(readinessItems, eq(readinessItems.packageVersionId, scenarioPackageVersions.id))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .orderBy(readinessItems.position, readinessItems.key)
  const first = rows[0]
  if (!first) return undefined
  return {
    versionStatus: first.status,
    items: rows.flatMap((row) => (row.item ? [row.item] : [])),
  }
}

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

/** The closed check's result, or `undefined` while the check is still open. */
export async function findReadinessResult(
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunReadinessResult | undefined> {
  const [row] = await dbx
    .select()
    .from(runReadinessResults)
    .where(eq(runReadinessResults.runId, runId))
  return row
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
// The Evidence Room (DATA-031, and `scenario_documents` through the run)
//
// `scenario_documents` is a `scenarios` table, read here for the reason D-242 gives for
// `readiness_items`: the question is about *this run* — which documents its room holds, and what
// one of them says — and the join that answers it starts at the run row, which is also where the
// tenant filter lives. This repository owns queries rooted in a run, whatever they reach.
//
// Both reads name their columns. `scenario_documents` also carries `role`,
// `superseded_by_document_id` and `stakeholder_id`, which 12 §8.2 withholds from a student until
// their run is scored: selecting the seven columns the room needs means the other three are never
// loaded, rather than loaded and then dropped by a projection somewhere above (D-117).
// ---------------------------------------------------------------------------------------------

/** One document of the room, as the student may read it. */
export type RunDocument = {
  id: string
  key: string
  title: string
  author: string
  datedOn: string
  body: string
  /** `scenario_documents.word_count`, computed at import; the skim threshold reads it (D-082). */
  wordCount: number
}

const DOCUMENT_COLUMNS = {
  id: scenarioDocuments.id,
  key: scenarioDocuments.key,
  title: scenarioDocuments.title,
  author: scenarioDocuments.author,
  datedOn: scenarioDocuments.datedOn,
  body: scenarioDocuments.body,
  wordCount: scenarioDocuments.wordCount,
} as const

/** The run's room in the order the author placed it; empty when the run is not in the tenant. */
export async function listRunDocuments(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunDocument[]> {
  return dbx
    .select(DOCUMENT_COLUMNS)
    .from(runs)
    .innerJoin(scenarioDocuments, eq(scenarioDocuments.packageVersionId, runs.packageVersionId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .orderBy(scenarioDocuments.position, scenarioDocuments.key)
}

/** One document of the run's room; `undefined` when it belongs to another package version. */
export async function findRunDocument(
  tenantId: string,
  runId: string,
  documentId: string,
  dbx: DbOrTx = db,
): Promise<RunDocument | undefined> {
  const [row] = await dbx
    .select(DOCUMENT_COLUMNS)
    .from(runs)
    .innerJoin(scenarioDocuments, eq(scenarioDocuments.packageVersionId, runs.packageVersionId))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.id, runId),
        eq(scenarioDocuments.id, documentId),
      ),
    )
  return row
}

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

/** One open of the run, closed or not; `undefined` when the id belongs to another run. */
export async function findDocumentOpen(
  runId: string,
  openId: string,
  dbx: DbOrTx = db,
): Promise<RunDocumentOpen | undefined> {
  const [row] = await dbx
    .select()
    .from(runDocumentOpens)
    .where(and(eq(runDocumentOpens.runId, runId), eq(runDocumentOpens.id, openId)))
  return row
}

/**
 * The run's opens that have no close, oldest first: what the next open, or the frame lock, has to
 * close (10 §6), and what the workspace hands a reloaded screen.
 */
export async function listOpenDocumentOpens(
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunDocumentOpen[]> {
  return dbx
    .select()
    .from(runDocumentOpens)
    .where(and(eq(runDocumentOpens.runId, runId), isNull(runDocumentOpens.closedAt)))
    .orderBy(runDocumentOpens.openedAt, runDocumentOpens.id)
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

/** The run's locked frame, or `undefined` while it is still being written (FR-041). */
export async function findFrame(runId: string, dbx: DbOrTx = db): Promise<RunFrame | undefined> {
  const [row] = await dbx.select().from(runFrames).where(eq(runFrames.runId, runId))
  return row
}

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
