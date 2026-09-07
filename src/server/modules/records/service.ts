// Service of the `records` module (docs/tech/10-backend-spec-modules.md §14; 07-api-spec.md §7, §8;
// 08-auth-authz.md §4; FR-170, FR-184, FR-204, FR-243, D-087).
//
// Phase 10 lands the export half: the record-form file (FR-243) and the versioned course files
// (FR-184, FR-204). The Judgment Record view — `getRecord`, the snapshot with the four graphs and
// the confirmed bands — is Phase 11's, and arrives with the screen that renders it.
//
// The two artifacts differ in more than their contents, and the difference is the shape of this
// file.
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
import { requireRunOwner, requireRunReviewer, requireSectionRole } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { AppError, isAppError } from '@/lib/errors'
import { audit } from '@/server/modules/admin'
import { listMyInstitutions } from '@/server/modules/tenancy'
import { buildExport, type CourseTraceExport, type RecordTraceExport } from '@/server/modules/trace'
import { exportNotFound, recordNotAvailable } from './errors'
import {
  findAssignmentScope,
  findExport,
  findRunForRecord,
  insertExport,
  listExports,
  type CourseExport,
  type Page,
  type PageInput,
  type Tx,
} from './repository'
import type { ExportReason, ExportSummary } from './schema'

export type { ExportReason, ExportSummary } from './schema'

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
 * The `export_ready` notification 10 §14 lists is Phase 10.4's, and lands with the notifications
 * module it needs; the audit row, which is 08 §5's requirement and needs nothing that does not
 * exist, is written here.
 */
export async function writeCourseExport(
  tx: Tx,
  run: ExportableRun,
  reason: ExportReason,
  opts: { actorId?: string | null } = {},
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
  return row
}

/**
 * `GET /runs/{runId}/exports/{version}`: one filed course export, for a reviewer of the section.
 *
 * It answers the file as it was written, never a rebuild of it. That is the whole point of keeping
 * the versions: an instructor who entered points from version 2 can read version 2 back after a
 * neutralization has produced version 3, and see what they entered.
 */
export async function getCourseExport(
  actor: SessionUser,
  runId: string,
  version: number | 'latest',
): Promise<CourseTraceExport> {
  const scope = await requireRunReviewer(actor, runId)
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
 */
export async function listCourseExports(
  actor: SessionUser,
  assignmentId: string,
  input: PageInput = {},
): Promise<Page<ExportSummary>> {
  const scope = await resolveAssignment(actor, assignmentId)
  await requireSectionRole(actor, scope.sectionId, ['instructor', 'ta'])
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
): Promise<{ organizationId: string; sectionId: string }> {
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

export type { DbOrTx, Tx } from './repository'
