// Module `records` — repository (docs/tech/10-backend-spec-modules.md §14; tables run_records and
// course_exports, 06-data-model.md §3.5). Query bodies only: the record and export forms are built
// by the service. course_exports is tenant-scoped (D-006) and append-only, so its functions take
// `tenantId` first, filter on `organizationId`, and never update or delete; run_records has no
// organization_id and is scoped through the run id the service already resolved in the tenant. The
// database handle is always the last parameter (10 §6).
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import { assignments, runs, scenarioVariants, sections } from '@/server/db/schema'
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
  courseExports,
  runRecords,
  type CourseExport,
  type NewCourseExport,
  type NewRunRecord,
  type RunRecord,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type { DbOrTx, Tx } from '@/server/db/tx'
export type { Page, PageInput } from '@/server/db/pagination'
/** The row types the service names in its signatures; a service may not reach `src/server/db`. */
export type { CourseExport, RunRecord, RunRecordSnapshot } from '@/server/db/schema'

/** The record snapshot (and, optionally, the export flag); the run id comes from the parameter. */
export type RecordUpsert = Omit<NewRunRecord, 'runId' | 'createdAt' | 'updatedAt'>

/** An export as the service hands it over; `organizationId` and the next `version` are set here. */
export type ExportInsert = Omit<NewCourseExport, 'organizationId' | 'version'>

/** `INSERT … RETURNING` always yields its row; an empty result is a driver fault, not a domain case. */
function returned<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

// ---------------------------------------------------------------------------------------------
// Judgment Record (DATA-045)
// ---------------------------------------------------------------------------------------------

/** Writes or rewrites the run's record; `hidden_from_export` only changes when the caller sets it. */
export async function upsertRecord(
  runId: string,
  values: RecordUpsert,
  dbx: DbOrTx = db,
): Promise<RunRecord> {
  const set: PgUpdateSetSource<typeof runRecords> = { snapshot: sql`excluded.snapshot` }
  if (values.hiddenFromExport !== undefined) set.hiddenFromExport = values.hiddenFromExport
  const rows = await dbx
    .insert(runRecords)
    .values({ ...values, runId })
    .onConflictDoUpdate({ target: runRecords.runId, set })
    .returning()
  return returned(rows)
}

export async function findRecord(runId: string, dbx: DbOrTx = db): Promise<RunRecord | undefined> {
  const rows = await dbx.select().from(runRecords).where(eq(runRecords.runId, runId)).limit(1)
  return rows[0]
}

// ---------------------------------------------------------------------------------------------
// Course exports (DATA-046; append-only, versioned per run)
// ---------------------------------------------------------------------------------------------

/** Appends the next export version of the run (`max(version) + 1`, 1 for the first). */
export async function insertExport(
  tenantId: string,
  values: ExportInsert,
  dbx: DbOrTx = db,
): Promise<CourseExport> {
  const nextVersion = sql<number>`(
    select coalesce(max(${courseExports.version}), 0) + 1
    from ${courseExports}
    where ${courseExports.runId} = ${values.runId}
  )`
  const rows = await dbx
    .insert(courseExports)
    .values({ ...values, organizationId: tenantId, version: nextVersion })
    .returning()
  return returned(rows)
}

/** One export of the run by version number, or the newest with `'latest'`. */
export async function findExport(
  tenantId: string,
  runId: string,
  version: number | 'latest',
  dbx: DbOrTx = db,
): Promise<CourseExport | undefined> {
  const rows = await dbx
    .select()
    .from(courseExports)
    .where(
      and(
        eq(courseExports.runId, runId),
        eq(courseExports.organizationId, tenantId),
        version === 'latest' ? undefined : eq(courseExports.version, version),
      ),
    )
    .orderBy(desc(courseExports.version))
    .limit(1)
  return rows[0]
}

/**
 * Export history of an assignment (FR-184), newest first, cursor-paginated on (created_at, id).
 *
 * A voided run's files are not listed (FR-002, D-434). The join is what does it, rather than a
 * filter after the page is cut, so a voided run cannot use up a page slot and leave the caller with
 * fewer rows than they asked for.
 */
export async function listExports(
  tenantId: string,
  assignmentId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<CourseExport>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select({ export: courseExports })
    .from(courseExports)
    .innerJoin(runs, eq(runs.id, courseExports.runId))
    .where(
      and(
        eq(courseExports.assignmentId, assignmentId),
        eq(courseExports.organizationId, tenantId),
        ne(runs.state, 'voided'),
        afterCursor({ createdAt: courseExports.createdAt, id: courseExports.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: courseExports.createdAt, id: courseExports.id }))
    .limit(limit + 1)
  return toPage(
    rows.map((row) => row.export),
    limit,
  )
}

/**
 * The run's state, or `undefined` when the run is not in the tenant.
 *
 * The Judgment Record and its export exist only from `confirmed` (10 §14), and the state is the
 * whole of that rule. It is one column of the `runs` module's table, read and never written — the
 * same narrow reach, for the same reason, as `trace.findRunState` (`owner-view.ts`).
 */
export async function findRunForRecord(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<{ state: string; assignmentId: string } | undefined> {
  const [row] = await dbx
    .select({ state: runs.state, assignmentId: runs.assignmentId })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row
}

/**
 * Every export filed for one run, newest version first (07 §8, FR-184).
 *
 * Not paginated: the versions of one run are the corrections it has had, which is a handful at the
 * outside, and 07 §8 answers this endpoint with an array. The assignment's history next door is the
 * one that pages, because it is every run of a section.
 */
export async function listExportsForRun(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<CourseExport[]> {
  return dbx
    .select()
    .from(courseExports)
    .where(and(eq(courseExports.runId, runId), eq(courseExports.organizationId, tenantId)))
    .orderBy(desc(courseExports.version))
}

/** What the Judgment Record needs from the run row beside its bands and its trace (FR-170). */
export type RecordContext = {
  mode: 'guided' | 'standard' | 'open'
  isWalkthrough: boolean
  variantId: string
  variantKey: 'defective' | 'sound'
  confirmedAt: Date | null
  adjustedAt: Date | null
}

/**
 * The run's mode, its variant and the two instants the record is stamped with.
 *
 * The variant is on it because FR-170 puts it there: after scoring, a student is told which of the
 * two they drew, and the record is the artifact that says so (12 §8.2, D-228). Six columns, read and
 * never written, in the shape `findRunForRecord` above already has.
 */
export async function findRecordContext(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RecordContext | undefined> {
  const [row] = await dbx
    .select({
      mode: runs.mode,
      isWalkthrough: runs.isWalkthrough,
      variantId: runs.variantId,
      variantKey: scenarioVariants.key,
      confirmedAt: runs.confirmedAt,
      adjustedAt: runs.adjustedAt,
    })
    .from(runs)
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row
}

/** The section an assignment belongs to, and the institution both sit in. */
export type AssignmentScope = { organizationId: string; sectionId: string }

/**
 * Where an assignment sits *in this institution*, for the one permission check this module makes by
 * assignment id (`GET /assignments/{assignmentId}/exports`, 07 §8: reviewers only).
 *
 * It reads the `courses` module's tables, which is unusual and narrow on purpose: the question is
 * "which section is this, so `requireSectionRole` can answer", and the alternative — `getAssignment`
 * — admits the students of that section, which is exactly the reader FR-184 does not have in mind.
 * Two columns, read and never written.
 *
 * It takes the tenant first like every other function here (D-006, D-389). The service asks it once
 * per institution the actor belongs to, which is how `courses` and `scenarios` resolve a course, a
 * section, an assignment or a package version to its tenant, and it makes the tenancy check and the
 * lookup the same statement: an assignment in an institution the actor is not in is simply not
 * found, so an id cannot be probed for existence (08 §4 "Cross-tenant"). A soft-deleted section is
 * still answered — an export history is a record of what happened, and archiving the section does
 * not unwrite it.
 */
export async function findAssignmentScope(
  tenantId: string,
  assignmentId: string,
  dbx: DbOrTx = db,
): Promise<AssignmentScope | undefined> {
  const [row] = await dbx
    .select({ organizationId: sections.organizationId, sectionId: assignments.sectionId })
    .from(assignments)
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, tenantId),
        eq(sections.organizationId, tenantId),
      ),
    )
    .limit(1)
  return row
}
