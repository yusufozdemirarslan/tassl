// Step 2.5 (DATA-045, DATA-046): the student's Judgment Record snapshot and the versioned course
// exports from docs/tech/06-data-model.md §3.5. course_exports is append-only (no updated_at).
import {
  pgTable,
  boolean,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'
import { assignments } from './courses'
import { exportReason } from './enums'
import { runs } from './runs'
import type { RunScoreGraphs } from './scoring'

/**
 * `run_records.snapshot`: the four graphs, the confirmed bands with evidence and notes, mode, variant,
 * and the record-form trace (no weight, mapping, or points at any depth; FR-243). The records module
 * owns the full Zod shape.
 */
export type RunRecordSnapshot = {
  graphs: RunScoreGraphs
  bands: Record<string, unknown>[]
  mode: 'guided' | 'standard' | 'open'
  variant: { id: string; key: 'defective' | 'sound' }
  trace: Record<string, unknown>
}

/** `course_exports.file`: the course-form TraceExport (10-backend-spec-modules.md §10). */
export type CourseExportFile = Record<string, unknown>

export const runRecords = pgTable('run_records', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  snapshot: jsonb('snapshot').$type<RunRecordSnapshot>().notNull(),
  hiddenFromExport: boolean('hidden_from_export').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const courseExports = pgTable(
  'course_exports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    version: integer('version').notNull(),
    file: jsonb('file').$type<CourseExportFile>().notNull(),
    reason: exportReason('reason').notNull(),
    // Null when a job writes the export (mapping_change recompute) with no acting user.
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('course_exports_run_id_version_uidx').on(table.runId, table.version)],
)

export type RunRecord = typeof runRecords.$inferSelect
export type NewRunRecord = typeof runRecords.$inferInsert
export type CourseExport = typeof courseExports.$inferSelect
export type NewCourseExport = typeof courseExports.$inferInsert
