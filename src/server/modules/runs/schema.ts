// Wire contract of the `runs` module (docs/tech/10-backend-spec-modules.md §6; 07-api-spec.md §7,
// §10). One Zod schema per input, shared by the route, the Server Action and the form that submits
// it; one schema per view, which the route validates against before serializing.
//
// Like every module schema this file carries no server import, so a Server Component may read its
// types, and a Client Component never imports it (D-186) — the browser copy of a bound lives in
// `src/lib`.
//
// Instants leave as ISO strings and durations as milliseconds: the same view travels in a JSON body
// and in an RSC payload, and the client turns a deadline into a countdown itself (D-042). Nothing
// here is a `Date`.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Enumerations (06-data-model.md §3.3, §3.4), restated rather than imported from the db
// ---------------------------------------------------------------------------------------------

export const RunStateSchema = z.enum([
  'assigned',
  'readiness',
  'framing',
  'working',
  'paused',
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
  'defense_complete',
  'scored',
  'confirmed',
  'recorded',
  'voided',
  'abandoned',
  'defense_missed',
  'under_appeal',
  'expired',
])
export type RunStateValue = z.infer<typeof RunStateSchema>

export const RunModeSchema = z.enum(['guided', 'standard', 'open'])
export type RunModeValue = z.infer<typeof RunModeSchema>

export const ScoringStatusSchema = z.enum(['idle', 'queued', 'running', 'held', 'done'])
export type ScoringStatusValue = z.infer<typeof ScoringStatusSchema>

export const VariantKeySchema = z.enum(['defective', 'sound'])
export type VariantKeyValue = z.infer<typeof VariantKeySchema>

// ---------------------------------------------------------------------------------------------
// Path parameters and pagination
// ---------------------------------------------------------------------------------------------

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export const AssignmentIdParamsSchema = z.object({ assignmentId: z.uuid() })

/** Cursor pagination (10 §11, D-020); unknown query parameters are rejected. */
export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type PageQuery = z.infer<typeof PageQuerySchema>

/** `GET /me/runs` and `GET /assignments/{id}/runs` both filter by state (07 §3, §7). */
export const RunsQuerySchema = PageQuerySchema.extend({ state: RunStateSchema.optional() })
export type RunsQuery = z.infer<typeof RunsQuerySchema>

/** `{ items, nextCursor }` around any item schema (07 §1 "Pagination"). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

// ---------------------------------------------------------------------------------------------
// RunSummary (07 §10) — the run as every run endpoint reports it
// ---------------------------------------------------------------------------------------------

/**
 * The working clock as the student's countdown reads it (D-042). `remainingMs` is floored at zero:
 * the arithmetic may be negative once the clock has run out, and the trace keeps that true number,
 * but a screen has nothing to say about minus four seconds — `materializeTimers` is what turns an
 * overrun into the auto-lock.
 */
export const ClockSchema = z.object({
  remainingMs: z.int().min(0),
  paused: z.boolean(),
  creditedMs: z.int().min(0),
  chargedMs: z.int().min(0),
})
export type Clock = z.infer<typeof ClockSchema>

/** The Turn's two instants, from the Decision Lock onwards (FR-110, FR-115). */
export const RunTurnSchema = z.object({
  dueAt: z.iso.datetime(),
  /** Set when the Turn is delivered; null while the run is only waiting for it. */
  windowEndsAt: z.iso.datetime().nullable(),
})

/**
 * The instants 07 §10 names, one per state the run has passed through. A screen reads them to say
 * when something happened; the trace is what says what happened.
 */
export const RunTimestampsSchema = z.object({
  policyDisplayedAt: z.iso.datetime().nullable(),
  workingStartedAt: z.iso.datetime().nullable(),
  decisionLockedAt: z.iso.datetime().nullable(),
  turnDeliveredAt: z.iso.datetime().nullable(),
  turnLockedAt: z.iso.datetime().nullable(),
  defenseCompletedAt: z.iso.datetime().nullable(),
  scoredAt: z.iso.datetime().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  recordedAt: z.iso.datetime().nullable(),
  voidedAt: z.iso.datetime().nullable(),
})

/**
 * The run as `GET /runs/{runId}` answers and as every other run response embeds it (07 §7, §10).
 *
 * **There is no `variantKey` here, and none may be added.** The run's variant says whether a defect
 * was planted in the scenario the student drew, and the student is the reader of every endpoint
 * this shape travels on — their own poll, their own list, the response to their own Start. Telling
 * them "sound" tells them there is nothing to find: 10 §11.3 bands Calibration Professional on the
 * defect-free variant for `acceptEverything`, so a student who reads it can accept every claim and
 * band Professional without doing any of the work the run measures. CLAUDE.md's invariant — a
 * student never sees planted flags — and 12 §8 both forbid it. The variant reaches the student in
 * their own debrief and Judgment Record after scoring (UI-028, PRD §7.14), which are their own
 * shapes; the reviewer reads it from `RunReviewSummary` below, which no student ever receives.
 * 07 §10 listed it here and is corrected with this (D-228).
 *
 * `version` is D-123's poll version — the number of events written, `runs.next_event_seq − 1` — and
 * is what `ETag: "v<version>"` and `X-Run-Version` are built from. It is in the body as well as in
 * the headers because 07 §7 embeds `run: RunSummary` in every other run response too: a workspace
 * or a Turn read then carries the same counter, so a client that has just written knows whether the
 * poll it receives next is older than what it already holds.
 */
export const RunSummarySchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  attemptNo: z.int().positive(),
  state: RunStateSchema,
  mode: RunModeSchema,
  isWalkthrough: z.boolean(),
  /** Null outside `working` and `paused`: there is no working clock before the frame or after the lock. */
  clock: ClockSchema.nullable(),
  turn: RunTurnSchema.nullable(),
  scoringStatus: ScoringStatusSchema,
  timestamps: RunTimestampsSchema,
  /** D-123: events written so far. Changes exactly when something a reader would see changed. */
  version: z.int().min(0),
  links: z.object({
    /** The route this run's owner continues at, derived from the state (09 §UI-020 to UI-029). */
    next: z.string(),
  }),
})
export type RunSummary = z.infer<typeof RunSummarySchema>

export const RunSummaryPageSchema = pageOf(RunSummarySchema)

/**
 * UI-027 `/runs/[runId]`: the state and what it means for the student. `underReview` is 10 §6's
 * "scoring status (`held` → under review)" — the one thing about scoring a student is told, in
 * place of a status they cannot act on (FR-140).
 */
export const RunStatusSchema = z.object({
  run: RunSummarySchema,
  underReview: z.boolean(),
})
export type RunStatus = z.infer<typeof RunStatusSchema>

// ---------------------------------------------------------------------------------------------
// The row a summary is built from
// ---------------------------------------------------------------------------------------------

/**
 * The `runs` columns `toRunSummary` reads. Declared structurally so that a caller outside this
 * module — `courses.listAssignmentRuns` builds the reviewer's list — can hand over the row its own
 * repository returned without importing the database schema, which its layer may not do (04 §2).
 * A Drizzle `Run` row satisfies it.
 */
export type RunRowForSummary = {
  id: string
  assignmentId: string
  attemptNo: number
  state: RunStateValue
  mode: RunModeValue
  isWalkthrough: boolean
  scoringStatus: ScoringStatusValue
  workingClockSeconds: number
  workingStartedAt: Date | null
  pausedAt: Date | null
  totalPausedMs: number
  creditedMs: number
  chargedMs: number
  policyDisplayedAt: Date | null
  decisionLockedAt: Date | null
  turnDueAt: Date | null
  turnDeliveredAt: Date | null
  turnWindowEndsAt: Date | null
  turnLockedAt: Date | null
  defenseCompletedAt: Date | null
  scoredAt: Date | null
  confirmedAt: Date | null
  recordedAt: Date | null
  voidedAt: Date | null
  nextEventSeq: number
}

/**
 * `GET /assignments/{assignmentId}/runs` (07 §7, §10): a run as its section's reviewers list it on
 * UI-032 — the same summary the student's own poll returns, plus who took it, how far the band
 * decisions have got, and the newest course export written for it.
 *
 * It lives here rather than in `courses`, whose service answers the endpoint: a module schema may
 * import nothing but `src/lib` (04 §2), so the extension has to be written where `RunSummary` is.
 * A student never receives this shape — `studentId` alone would breach 08 §4.
 */
export const RunReviewSummarySchema = RunSummarySchema.extend({
  studentId: z.string().min(1),
  studentName: z.string(),
  /**
   * Which variant the student drew. It is here rather than in `RunSummary` because this shape is
   * the reviewer's alone (see above), and a re-offer is written on the other variant of the family
   * (FR-183), so a run's variant cannot be read off its assignment.
   */
  variantKey: VariantKeySchema,
  decisionsMade: z.int().min(0),
  latestExportVersion: z.int().nullable(),
})
export type RunReviewSummary = z.infer<typeof RunReviewSummarySchema>

export const RunReviewSummaryPageSchema = pageOf(RunReviewSummarySchema)
