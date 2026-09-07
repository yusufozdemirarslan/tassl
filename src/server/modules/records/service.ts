// Service of the `records` module (docs/tech/10-backend-spec-modules.md §14; 07-api-spec.md §7, §8;
// 08-auth-authz.md §4; FR-170, FR-184, FR-204, FR-243, D-087).
//
// Three artifacts: the record-form file a student downloads (FR-243), the versioned course files a
// reviewer reads back (FR-184, FR-204), and the Judgment Record itself (FR-170).
//
// The first two differ in more than their contents, and the difference is the shape of this file.
//
//   * **The course export is written.** It is the provenance ledger for grade input: append-only,
//     versioned per run, with the reason it was written and who wrote it (D-087, 12 §5). Phase 11
//     calls `writeCourseExport` from inside the transaction that confirms the bands, so the file
//     and the decision it records commit together — and so the file carries the decision, which is
//     why it builds through the caller's transaction rather than the pool.
//   * **The record export is built on the way out.** Nothing versions it, because it is not a
//     record of anything: it is the student's copy of a run whose bands are already confirmed, and
//     two downloads of it are the same file. Which is also why it is refused before `confirmed` —
//     a draft band never leaves Tassl (PRD §7.13).
import {
  requireCourseExportReader,
  requireRunOwner,
  requireRunReviewer,
  requireSectionReviewer,
} from '@/server/auth/permissions'
import { findForbiddenKeys } from '@/server/auth/student-view'
import type { SessionUser } from '@/server/auth/types'
import { AppError, isAppError } from '@/lib/errors'
import { flagsFromEnv } from '@/lib/flags'
import { t } from '@/lib/i18n/t'
import { env } from '@/server/config'
import { audit } from '@/server/modules/admin'
import { notify } from '@/server/modules/notifications'
import { readGraphsForOwner, readScore, type BandView } from '@/server/modules/scoring'
import { listMyInstitutions } from '@/server/modules/tenancy'
import { buildExport, type CourseTraceExport, type RecordTraceExport } from '@/server/modules/trace'
import { exportNotFound, recordNotAvailable, runNotConfirmed } from './errors'
import {
  findAssignmentScope,
  findExport,
  findRecordContext,
  findRunForRecord,
  insertExport,
  listExports,
  listExportsForRun,
  upsertRecord,
  type CourseExport,
  type Page,
  type PageInput,
  type RunRecordSnapshot,
  type Tx,
} from './repository'
import trajectoryFixture from './sample/four-run-trajectory.json'
import queueFixture from './sample/review-queue.json'
import type {
  ExportReason,
  ExportSummary,
  RecordBand,
  RecordView,
  SampleQueue,
  SampleTrajectory,
} from './schema'

export type { ExportReason, ExportSummary, RecordBand, RecordView } from './schema'
export type { SampleQueue, SampleTrajectory } from './schema'

/** The run states in which a Judgment Record and its export exist (10 §14, PRD §7.16). */
const RECORD_STATES = new Set(['confirmed', 'recorded'])

/** The run columns `writeCourseExport` needs; the confirmation already holds the locked row. */
export type ExportableRun = { id: string; organizationId: string; assignmentId: string }

// ---------------------------------------------------------------------------------------------
// The record copy (FR-243)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}/record/export`: the record-form trace, as a JSON file.
 *
 * Read by the run's own student, and by an instructor or TA of its section — the matrix row that
 * reads "Read own debrief, graphs, record; export record copy" (08 §4). The student is asked for
 * first, because a run belongs to one and every other reader is an exception to that.
 *
 * The file is the *record* form, for every one of those readers. A reviewer who wants the run's
 * whole record has the replay and the course export; what this endpoint answers is the student's
 * copy, and building a different document for the instructor would mean the two of them arguing
 * about a grade from two files.
 */
export async function exportRecord(actor: SessionUser, runId: string): Promise<RecordTraceExport> {
  const scope = await requireRecordReader(actor, runId)
  const run = await findRunForRecord(scope.organizationId, runId)
  // The guard above already resolved the run inside this tenant, so a miss here is the run
  // disappearing between two statements; NOT_FOUND is the same answer that guard would have given,
  // and a state of "unknown" would be a worse one.
  if (!run) throw new AppError('NOT_FOUND')
  if (!RECORD_STATES.has(run.state)) recordNotAvailable(run.state)

  return (await buildExport(scope.organizationId, runId, 'record')) as RecordTraceExport
}

/**
 * The owner, or a reviewer of the run's section (08 §4).
 *
 * `requireRunOwner` answers NOT_FOUND both for a run that does not exist and for one belonging to
 * another student, so a reviewer arrives here too and is asked for their role next; a classmate is
 * refused by both and keeps the NOT_FOUND, because 08 §4 gives a student no read of another
 * student's run at all. The same two-step `trace.listEvents` makes, for the same reason.
 */
async function requireRecordReader(
  actor: SessionUser,
  runId: string,
): Promise<{ organizationId: string }> {
  try {
    return await requireRunOwner(actor, runId)
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error
  }
  try {
    return await requireRunReviewer(actor, runId)
  } catch (error) {
    // The reviewer guard answers FORBIDDEN to a section member holding the wrong role, which here
    // is one thing only: a classmate of the run's owner. Passing that through would confirm the run
    // exists to the one reader 08 §4 gives no read of it at all.
    if (isAppError(error) && error.code === 'FORBIDDEN') throw new AppError('NOT_FOUND')
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Course exports (FR-184, FR-204, D-087)
// ---------------------------------------------------------------------------------------------

/**
 * Writes the next course export of a run, inside the transaction that caused it (10 §14).
 *
 * The reason is the provenance: `initial` at confirmation, `override` when a band decision changes
 * after one, `neutralization` after a correction (FR-005), `mapping_change` when the course's
 * mapping moves under a confirmed run (FR-203), `unassessed` when a dimension is excluded. The
 * table is append-only and `tassl_app` holds no UPDATE or DELETE on it, so a version once written
 * is the file that was handed over, whatever happens next.
 *
 * `actorId` is null for the job that re-exports a whole course after a mapping change: there is no
 * acting user, and the column says so rather than borrowing the last instructor who touched it.
 *
 * The `export_ready` notice goes to the section's instructors and TAs and never to the student
 * (SYS-010, 10 §14): the course export is the reviewer's document for the gradebook of record, and
 * the student's own copy is the Judgment Record they download from their run (12 §8.1). It carries
 * no band, no reason and no number — the same rule every other notification in this codebase keeps,
 * because a notification is delivered by e-mail as well as in the app (D-015).
 *
 * `reviewerIds` is passed by the caller rather than looked up here. The caller has just taken the
 * run's row lock and knows the section; a second query for the same list inside this function would
 * be a second answer to "who reviews this run" — and the mapping-change job, which has no acting
 * user, passes none at all.
 */
export async function writeCourseExport(
  tx: Tx,
  run: ExportableRun,
  reason: ExportReason,
  opts: { actorId?: string | null; reviewerIds?: readonly string[] } = {},
): Promise<CourseExport> {
  const file = (await buildExport(run.organizationId, run.id, 'course', tx)) as CourseTraceExport
  const row = await insertExport(
    run.organizationId,
    {
      runId: run.id,
      assignmentId: run.assignmentId,
      file,
      reason,
      createdBy: opts.actorId ?? null,
    },
    tx,
  )
  await audit(tx, {
    actorId: opts.actorId ?? null,
    orgId: run.organizationId,
    action: 'export.write',
    targetType: 'run',
    targetId: run.id,
    metadata: { version: row.version, reason },
  })
  if (opts.reviewerIds && opts.reviewerIds.length > 0) {
    await notify(tx, {
      userIds: [...opts.reviewerIds],
      type: 'export_ready',
      title: t('notifications.exportReady.title'),
      body: t('notifications.exportReady.body'),
      link: `/assignments/${run.assignmentId}/exports`,
      payload: { runId: run.id },
      orgId: run.organizationId,
    })
  }
  return row
}

/**
 * `GET /runs/{runId}/exports/{version}`: one filed course export, for a reviewer of the section.
 *
 * It answers the file as it was written, never a rebuild of it. That is the whole point of keeping
 * the versions: an instructor who entered points from version 2 can read version 2 back after a
 * neutralization has produced version 3, and see what they entered.
 *
 * `requireCourseExportReader`, not `requireRunReviewer`: 08 §4 puts this act on the same row as the
 * export history, so it admits the same seats — including the instructor of the course who holds no
 * row in the section (D-483). Every row of the history the seat can now open carries a download, and
 * a page of links that all answer 404 is the defect it was fixing, one level down.
 */
export async function getCourseExport(
  actor: SessionUser,
  runId: string,
  version: number | 'latest',
): Promise<CourseTraceExport> {
  const scope = await requireCourseExportReader(actor, runId)
  // FR-002, D-434: a voided run's bands are absent from any export. The ledger is append-only and
  // nothing may unwrite a file that was handed over, so what enforces the rule is the read — a run
  // the instructor voided serves nothing to a gradebook, whatever was written before they did.
  const run = await findRunForRecord(scope.organizationId, runId)
  if (!run) throw new AppError('NOT_FOUND')
  if (run.state === 'voided') exportNotFound(runId, version)
  const row = await findExport(scope.organizationId, runId, version)
  if (!row) exportNotFound(runId, version)
  return row.file as CourseTraceExport
}

/**
 * `GET /assignments/{assignmentId}/exports`: the export history of an assignment (FR-184), newest
 * first.
 *
 * Summaries, not files: the history answers what was written, when, and why, and each file is its
 * own download. A reviewer of the assignment's section only — a student's own exports are their
 * record, which they reach by run.
 *
 * "A reviewer of the section" is `canReviewSection`, which is the section's instructor or TA *and*
 * the instructor of the course above it (08 §5, D-062, D-483). The same predicate answers
 * `courses.listAssignmentRuns` one screen up, so the "Course exports" link on the assignment screen
 * and the history behind it are one question asked twice rather than two guards that have to be
 * kept in step by hand — which they were not: a course's creator holding no section row saw the
 * link and got a 404.
 */
export async function listCourseExports(
  actor: SessionUser,
  assignmentId: string,
  input: PageInput = {},
): Promise<Page<ExportSummary>> {
  const scope = await resolveAssignment(actor, assignmentId)
  await requireSectionReviewer(actor, scope.courseId, scope.sectionId)
  const page = await listExports(scope.organizationId, assignmentId, input)
  return { items: page.items.map(toExportSummary), nextCursor: page.nextCursor }
}

/**
 * The assignment's section and institution, found by asking each institution the actor belongs to.
 *
 * This is the shape `courses.resolveAssignment` and `scenarios.resolveVersion` already have, and it
 * is here for both of their reasons. An assignment id does not name its institution, so the tenant
 * has to be discovered before the repository can be called `tenantId`-first (D-006) — and asking
 * only the actor's own institutions makes the discovery the tenancy check as well: an assignment in
 * an institution they are not a member of is not found rather than refused, so an id cannot be
 * probed for existence (08 §4 "Cross-tenant"). An id that names no assignment at all lands in
 * exactly the same place, which is the point: the two are indistinguishable from outside.
 *
 * NOT_FOUND is answered here, before any role is asked for: there is no section to hold a role in.
 */
async function resolveAssignment(
  actor: SessionUser,
  assignmentId: string,
): Promise<{ organizationId: string; sectionId: string; courseId: string }> {
  const institutions = await listMyInstitutions(actor)
  const ids = institutions.map((institution) => institution.id)
  // The session's active institution is tried first, which is the only one in the common case.
  const active = actor.activeOrganizationId
  const tenants =
    active && ids.includes(active) ? [active, ...ids.filter((id) => id !== active)] : ids
  for (const tenantId of tenants) {
    const scope = await findAssignmentScope(tenantId, assignmentId)
    if (scope) return scope
  }
  throw new AppError('NOT_FOUND')
}

function toExportSummary(row: CourseExport): ExportSummary {
  return {
    id: row.id,
    runId: row.runId,
    assignmentId: row.assignmentId,
    version: row.version,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------------------------
// The Judgment Record (FR-170, FR-172, DATA-045)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}/record`: the student's own Judgment Record (FR-170).
 *
 * The four graphs, the confirmed bands with their notes, the mode and the variant, and the run's
 * trace in the record form. **Never the weight, the mapping or the points** — FR-172 says the
 * record "carries bands and never course points", and the guard below applies that by *name
 * containment at any depth*, so `points_before` inside a nested block is refused the way `points`
 * is (D-421). The debrief is the screen that shows a student their points, because the debrief is
 * teaching and the record is the artifact that leaves Tassl (12 §8.3).
 *
 * Owner only, from `confirmed`. A reviewer reads the run through the replay, which carries
 * everything; what makes this endpoint the student's is that it is theirs to keep.
 *
 * **Built on every read, and stored** (D-436). 10 §14 says "builds or returns the snapshot", and a
 * stored snapshot returned unconditionally would go stale the moment a neutralization corrected the
 * run (FR-005, FR-232) — the debrief would show the raised band and the record would show the one
 * before it. So the snapshot is rebuilt and written back: `run_records` is the row DATA-045 asks
 * for and `hidden_from_export` rides on it untouched (FR-173), and the reader always sees what the
 * run actually stands on.
 *
 * The bands carry no `quotes` and no `evidenceEventSeqs`. Both are `reviewer_only` in every state
 * (`trace/owner-view.ts`): a quote is what a model read took from the student's own words to place
 * a band, and a stored sequence number would carry the trace's real numbering past the renumbering
 * that hides the probe (FR-053). What FR-170 means by "with evidence" is the graphs the band was
 * read from, which travel as `graphKeys` beside the four graphs themselves.
 */
export async function getRecord(actor: SessionUser, runId: string): Promise<RecordView> {
  const scope = await requireRunOwner(actor, runId)
  const run = await findRunForRecord(scope.organizationId, runId)
  if (!run) throw new AppError('NOT_FOUND')
  if (!RECORD_STATES.has(run.state)) recordNotAvailable(run.state)

  const [score, graphs, context, trace] = await Promise.all([
    readScore(runId),
    readGraphsForOwner(runId),
    findRecordContext(scope.organizationId, runId),
    buildExport(scope.organizationId, runId, 'record') as Promise<RecordTraceExport>,
  ])
  if (!context) throw new AppError('NOT_FOUND')

  const bands = (score?.bands ?? []).map(toRecordBand)
  const snapshot: RunRecordSnapshot = {
    graphs: (graphs ?? {}) as RunRecordSnapshot['graphs'],
    // `run_records.snapshot` is a jsonb body and its type says so; the bands inside it are the ones
    // built just above, and the view below carries the same objects with their real shape.
    bands: bands as unknown as Record<string, unknown>[],
    mode: context.mode,
    variant: { id: context.variantId, key: context.variantKey },
    trace: trace as unknown as Record<string, unknown>,
  }
  const stored = await upsertRecord(runId, { snapshot })

  const view: RecordView = {
    runId,
    // Narrowed by `RECORD_STATES` a few lines above; the repository answers the column as a string
    // because it reads one column of another module's table and takes no view of its enum.
    state: run.state as RecordView['state'],
    uncalibrated: true,
    isWalkthrough: context.isWalkthrough,
    confirmedAt: context.confirmedAt?.toISOString() ?? null,
    adjustedAt: context.adjustedAt?.toISOString() ?? null,
    hiddenFromExport: stored.hiddenFromExport,
    graphs: snapshot.graphs as unknown as Record<string, unknown>,
    bands,
    mode: snapshot.mode,
    variant: snapshot.variant,
    trace: snapshot.trace,
  }
  assertRecordIsStudentSafe(view)
  return view
}

/**
 * The record, checked against `student-view.ts` in the two ways that document allows (D-370, D-421).
 *
 * It is deliberately **not** one `assertNoForbiddenKeys` over the whole view. The record embeds the
 * record-form trace export, and that document legitimately carries `readiness_item.answer_key` —
 * the key the *student themselves* chose, which is a different thing from the item's answer key and
 * is why `owner-view.ts` exists at all. A single sweep would refuse the record for holding the
 * student's own answers.
 *
 * So the record's own fields — the bands, the graphs, the variant, the timestamps — are swept
 * against every set, because this file builds them and a field added to one later must not slip
 * through. And the embedded trace is swept against the record-form terms alone: `weight`, `mapping`
 * and `points` by *name containment at any depth*, which is FR-170 and FR-172, and is exactly the
 * check `points_before` nested inside `claim_neutralized.recompute` walked past when the rule was an
 * exact-name match (D-421). Everything else about the trace is `owner-view.ts`'s to decide, and
 * `tests/integration/trace/export.test.ts` audits it key by key.
 */
function assertRecordIsStudentSafe(view: RecordView): void {
  const { trace, ...own } = view
  const findings = [
    ...findForbiddenKeys(own, { scored: true, form: 'record' }),
    ...findForbiddenKeys(trace, { scored: true, form: 'record' }).filter(
      (finding) => finding.set === 'record_form',
    ),
  ].filter((finding) => finding.path !== CONFIDENCE_LINE_POINTS)
  if (findings.length > 0) {
    throw new AppError('INTERNAL_ERROR', 'This payload carries fields a student may not see.', {
      details: { forbiddenKeys: findings },
    })
  }
}

/**
 * The one legitimate collision with the record-form rule, named rather than assumed (D-438).
 *
 * `confidence_line.points` are the three plotted readings of FR-132's line — confidence at the
 * frame, at the lock and after the Turn — and every one of them is the student's own number. They
 * are not the course's arithmetic, which is what 12 §8.1's last row forbids and what D-421 matches
 * by name containment; D-421's own note that "no student payload has a legitimate field whose name
 * contains points" is true of every payload in the product except this one, and FR-170 puts this one
 * *in* the record by name.
 *
 * The exception is this exact path and nothing else. The array's contents are still walked, so a
 * `points_confirmed` inside a reading would still be refused, and every other graph, band and field
 * of the record is swept exactly as before — the same shape `tests/integration/trace/export.test.ts`
 * uses to name `readiness_item.answer_key` as the one survivor of the always-set (D-370).
 */
const CONFIDENCE_LINE_POINTS = 'graphs.confidence_line.points'

/** One confirmed band as the record carries it: what it says, and why, never how it was read. */
function toRecordBand(band: BandView): RecordBand {
  return {
    dimension: band.dimension,
    band: band.effectiveBand,
    status: band.effectiveBand === null ? 'unassessed' : 'drafted',
    decision: band.decision,
    note: band.note,
    rationale: band.rationale,
    graphKeys: [...band.graphKeys],
  }
}

// ---------------------------------------------------------------------------------------------
// Illustrative sample data (FR-171, FR-254, D-035)
// ---------------------------------------------------------------------------------------------

/**
 * The two static fixtures, behind `FEATURE_SAMPLE_DATA`.
 *
 * They describe no student and are never mixed with a walkthrough record. Each file carries its own
 * `label` — "Illustrative sample data" — as data rather than as a prop the screen supplies, so the
 * component that renders one cannot render it unlabelled (FR-254): the label is part of the thing.
 *
 * `null` when the flag is off, and not an empty shape: a screen that receives nothing draws nothing,
 * where a screen that received an empty trajectory would draw an empty chart of a student's runs.
 */
export const sample = {
  trajectory: (): SampleTrajectory | null =>
    flagsFromEnv(env).sampleData ? (trajectoryFixture as SampleTrajectory) : null,
  queue: (): SampleQueue | null =>
    flagsFromEnv(env).sampleData ? (queueFixture as SampleQueue) : null,
} as const

// ---------------------------------------------------------------------------------------------
// The export history of one run (07 §8, FR-184)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}/exports`: every course export filed for one run, newest version first.
 *
 * A reviewer of the run's section (08 §4). `RUN_NOT_CONFIRMED` when there is nothing to list,
 * because there is a difference worth telling between "no file has been written" and "no file
 * exists": the first names the step the run is waiting on.
 *
 * **A voided run has no export history** (D-434). FR-002's acceptance is that "the run's bands are
 * absent from any export", and the ledger is append-only, so what enforces it is the read: a run
 * the instructor voided contributes nothing to a gradebook, whatever was written before they did.
 */
export async function listRunExports(actor: SessionUser, runId: string): Promise<ExportSummary[]> {
  const scope = await requireRunReviewer(actor, runId)
  const run = await findRunForRecord(scope.organizationId, runId)
  if (!run) throw new AppError('NOT_FOUND')
  if (run.state === 'voided') runNotConfirmed(run.state)
  const rows = await listExportsForRun(scope.organizationId, runId)
  if (rows.length === 0) runNotConfirmed(run.state)
  return rows.map(toExportSummary)
}

export type { DbOrTx, Tx } from './repository'
