// Module `records` — repository (docs/tech/10-backend-spec-modules.md §14; tables run_records and
// course_exports, 06-data-model.md §3.5). Query bodies only: the record and export forms are built
// by the service. course_exports is tenant-scoped (D-006) and append-only, so its functions take
// `tenantId` first, filter on `organizationId`, and never update or delete; run_records has no
// organization_id and is scoped through the run id the service already resolved in the tenant. The
// database handle is always the last parameter (10 §6).
import { and, desc, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
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
  courseExports,
  runRecords,
  type CourseExport,
  type NewCourseExport,
  type NewRunRecord,
  type RunRecord,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

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

/** Export history of an assignment (FR-184), newest first, cursor-paginated on (created_at, id). */
export async function listExports(
  tenantId: string,
  assignmentId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<CourseExport>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select()
    .from(courseExports)
    .where(
      and(
        eq(courseExports.assignmentId, assignmentId),
        eq(courseExports.organizationId, tenantId),
        afterCursor({ createdAt: courseExports.createdAt, id: courseExports.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: courseExports.createdAt, id: courseExports.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}
