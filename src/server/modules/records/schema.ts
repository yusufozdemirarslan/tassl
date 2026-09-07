// Wire contract of the `records` module (docs/tech/10-backend-spec-modules.md §14; 07-api-spec.md
// §7, §8; 06-data-model.md §3.5 `run_records`, `course_exports`).
//
// Two halves. The export half is the record-form file a student downloads (FR-243) and the
// versioned course files a reviewer reads back (FR-184, FR-204). The record half is the Judgment
// Record itself — the four graphs, the confirmed bands, the snapshot (FR-170, DATA-045) — and the
// two illustrative fixtures that are never mixed with it (FR-171, FR-254, D-035).
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

/** `{ items, nextCursor }` around any item schema (07 §1 "Pagination"). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

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

export const ExportSummaryPageSchema = pageOf(ExportSummarySchema)

/** The reason a course export was written (`course_exports.reason`, D-087). */
export type ExportReason = ExportSummary['reason']

// ---------------------------------------------------------------------------------------------
// The Judgment Record (07 §7 `RecordView`; FR-170, FR-172, DATA-045)
// ---------------------------------------------------------------------------------------------

/**
 * One band as the record carries it: what it says, and why, never how it was read.
 *
 * `band` is the *effective* band (D-422) — the instructor's decision with a correction as a floor
 * under it — because that is the one number the record is a record of. There is no `quotes` and no
 * `evidenceEventSeqs`: both are `reviewer_only` in every state, a quote being what a model read took
 * from the student's own words, and a stored sequence carrying the trace's real numbering past the
 * renumbering that hides the probe (FR-053, `trace/owner-view.ts`).
 */
export const RecordBandSchema = z.object({
  dimension: z.enum([
    'framing',
    'delegation',
    'verification',
    'calibration',
    'decision_quality',
    'adaptation',
    'ownership',
  ]),
  band: z.enum(['novice', 'developing', 'proficient', 'professional']).nullable(),
  status: z.enum(['drafted', 'unassessed']),
  decision: z.enum(['confirmed', 'overridden', 'unassessed']).nullable(),
  note: z.string().nullable(),
  rationale: z.string(),
  graphKeys: z.array(
    z.enum(['confidence_line', 'clock_timeline', 'stance_matrix', 'frame_beside_decision']),
  ),
})
export type RecordBand = z.infer<typeof RecordBandSchema>

/**
 * `GET /runs/{runId}/record` (07 §7, FR-170).
 *
 * The graphs and the trace are carried as they were built — `scoring` owns the four graph shapes
 * and `trace` owns the export document, and a module schema may import neither (04 §2). What this
 * file states is the frame around them, and the one rule that matters about the whole shape is
 * enforced in the service by `assertNoForbiddenKeys(view, { scored: true, form: 'record' })`: no key
 * whose name contains `weight`, `mapping` or `points`, at any depth (FR-172, D-421).
 */
export const RecordViewSchema = z.object({
  runId: z.uuid(),
  state: z.enum(['confirmed', 'recorded']),
  /** Appendix A.0: every band is a descriptive draft until the pilot calibrates it (FR-141). */
  uncalibrated: z.boolean(),
  isWalkthrough: z.boolean(),
  confirmedAt: z.iso.datetime().nullable(),
  /** Set when a correction moved something after confirmation (FR-005, FR-232). */
  adjustedAt: z.iso.datetime().nullable(),
  /** FR-173's future-state column: present, always false, and read by nothing. */
  hiddenFromExport: z.boolean(),
  graphs: z.record(z.string(), z.unknown()),
  bands: z.array(RecordBandSchema),
  mode: z.enum(['guided', 'standard', 'open']),
  variant: z.object({ id: z.uuid(), key: z.enum(['defective', 'sound']) }),
  trace: z.record(z.string(), z.unknown()),
})
export type RecordView = z.infer<typeof RecordViewSchema>

// ---------------------------------------------------------------------------------------------
// Illustrative sample data (FR-171, FR-254, D-035)
// ---------------------------------------------------------------------------------------------

/**
 * The label every illustrative fixture carries **inside itself**.
 *
 * FR-254 requires the label on every screen where illustrative material appears, and D-035 puts the
 * component that renders it behind a label prop. Carrying the sentence in the data as well is the
 * belt to that brace: a fixture handed to a component that forgot the prop still says what it is,
 * and a test can assert the string is there without rendering anything.
 */
export const SAMPLE_LABEL = 'Illustrative sample data'

export const SampleTrajectorySchema = z.object({
  label: z.literal(SAMPLE_LABEL),
  note: z.string(),
  runs: z.array(z.object({ runIndex: z.int().positive(), label: z.string() })),
  bands: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })),
  falseChallengeRate: z.array(z.number()),
  confidenceVsAccuracy: z.array(
    z.object({
      runIndex: z.int().positive(),
      confidenceAtLock: z.int().min(0).max(100),
      accuracyAtLock: z.number().min(0).max(1),
    }),
  ),
  escalations: z.array(
    z.object({
      runIndex: z.int().positive(),
      used: z.int().min(0),
      outsideCompetence: z.int().min(0),
    }),
  ),
})
export type SampleTrajectory = z.infer<typeof SampleTrajectorySchema>

export const SampleQueueSchema = z.object({
  label: z.literal(SAMPLE_LABEL),
  note: z.string(),
  rows: z.array(
    z.object({
      key: z.string(),
      heading: z.string(),
      body: z.string(),
      count: z.int().min(0),
    }),
  ),
})
export type SampleQueue = z.infer<typeof SampleQueueSchema>
