// Wire contract of the `records` module (docs/tech/10-backend-spec-modules.md §14; 07-api-spec.md
// §7, §8; 06-data-model.md §3.5 `run_records`, `course_exports`).
//
// Phase 10 lands the export half of this module: the record-form file a student downloads
// (FR-243), and the versioned course files a reviewer reads back (FR-184, FR-204). The Judgment
// Record view itself — the four graphs, the confirmed bands, the snapshot — is Phase 11's, and its
// schemas land with the screen that renders them.
//
// The exported document's own shape is not restated here. It is `TraceExportSchema` in the `trace`
// module (10 §10, §17), one schema shared by the file, the route's declared output and the tests,
// and a second copy of it in this file would be a second thing to keep true.
import { z } from 'zod'

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export type RunIdParams = z.infer<typeof RunIdParamsSchema>

/**
 * `GET /runs/{runId}/exports/{version}`: a version number, or the word `latest` (07 §8).
 *
 * `latest` is a path segment rather than a query flag because 07 §8 writes it that way, and because
 * "the newest export of this run" is a resource an instructor links to, not a filter on a list.
 */
export const ExportVersionParamsSchema = z.object({
  runId: z.uuid(),
  version: z.union([z.literal('latest'), z.coerce.number().int().min(1)]),
})
export type ExportVersionParams = z.infer<typeof ExportVersionParamsSchema>

export const AssignmentIdParamsSchema = z.object({ assignmentId: z.uuid() })
export type AssignmentIdParams = z.infer<typeof AssignmentIdParamsSchema>

export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type PageQuery = z.infer<typeof PageQuerySchema>

/**
 * One course export as the history lists it (FR-184): what it is and where it came from, without
 * the file. The file is a separate download, and a page of them would be megabytes of JSON nobody
 * asked for.
 */
export const ExportSummarySchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  assignmentId: z.uuid(),
  version: z.int().min(1),
  reason: z.enum(['initial', 'override', 'neutralization', 'mapping_change', 'unassessed']),
  createdAt: z.iso.datetime(),
})
export type ExportSummary = z.infer<typeof ExportSummarySchema>

/** The reason a course export was written (`course_exports.reason`, D-087). */
export type ExportReason = ExportSummary['reason']
