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
import { wordLimit } from '@/lib/words'

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

/** `PUT /runs/{runId}/readiness/answers/{itemId}` (07 §7) addresses one item of one run. */
export const ReadinessItemParamsSchema = z.object({ runId: z.uuid(), itemId: z.uuid() })

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
// The Readiness Check (07 §7, §10; FR-010 to FR-018)
// ---------------------------------------------------------------------------------------------

export const ReadinessCategorySchema = z.enum(['foundation', 'defect_concept', 'ai_behavior'])
export type ReadinessCategoryValue = z.infer<typeof ReadinessCategorySchema>

/** One of the four options an item offers; the key is what an answer names. */
export const ReadinessOptionSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
})

/**
 * One item as UI-022 renders it.
 *
 * **`answerKey` is the key the student chose, and there is no field for the key that is right.**
 * FR-012 and 12 §8.1 put `readiness_items.answer_key` among the things a student view never carries;
 * correctness is computed server-side, stored, traced, and reduced to the concept map — no response
 * carries it as a field, and the map that closes the check reports by concept, not by item (D-251;
 * `runs/readiness.ts` says how much that discloses). What is returned is their own answer so far,
 * null until they pick one, which is what lets a check reopened after the browser closed resume at
 * the first unanswered item (FR-017). 07 §7's example shows the field null on a fresh item, which
 * is this.
 */
export const ReadinessItemViewSchema = z.object({
  id: z.uuid(),
  position: z.int().min(0),
  category: ReadinessCategorySchema,
  stem: z.string().min(1),
  options: z.array(ReadinessOptionSchema),
  answerKey: z.string().nullable(),
})
export type ReadinessItemView = z.infer<typeof ReadinessItemViewSchema>

/**
 * `GET /runs/{runId}/readiness` (07 §7): the sixteen items in position order and the instant the
 * check closes. The countdown is the client's arithmetic over `expiresAt`, because the timer is a
 * server timestamp materialized lazily on read and nothing counts down anywhere (D-042, ADR-019).
 */
export const ReadinessViewSchema = z.object({
  expiresAt: z.iso.datetime(),
  items: z.array(ReadinessItemViewSchema),
})
export type ReadinessView = z.infer<typeof ReadinessViewSchema>

/** The answer a student sends; the service checks it is one of the keys the item offers. */
export const AnswerReadinessItemSchema = z.strictObject({
  answerKey: z.string().trim().min(1).max(8),
})
export type AnswerReadinessItemInput = z.infer<typeof AnswerReadinessItemSchema>

export const ReadinessConceptStatusSchema = z.enum(['held', 'not_held', 'unknown'])
export type ReadinessConceptStatusValue = z.infer<typeof ReadinessConceptStatusSchema>

/** One named concept and how it stands, in the words UI-022 turns into a sentence. */
export const ReadinessConceptSchema = z.object({
  conceptKey: z.string().min(1),
  status: ReadinessConceptStatusSchema,
})

/**
 * The whole result of a check (07 §7): named concepts, and whether it was completed.
 *
 * **There is no total here, and none may be added.** No score, no percentage, no threshold
 * placement, no rank (FR-012, PRD §7.1, CLAUDE.md). The per-concept counts `run_readiness_results`
 * stores are the reviewer's context in the replay and the export header (FR-014); a count in this
 * shape would be a score by another name on the one screen that must not have one.
 */
export const ReadinessResultSchema = z.object({
  skipped: z.boolean(),
  concepts: z.array(ReadinessConceptSchema),
})
export type ReadinessResult = z.infer<typeof ReadinessResultSchema>

// ---------------------------------------------------------------------------------------------
// The workspace: the Scenario Brief, the Evidence Room, and the frame (07 §7, §10; FR-020 to
// FR-024, FR-040 to FR-044)
//
// One rule governs every shape below, and it is the product invariant rather than a preference:
// **each is a list of the fields a student may see, and nothing is ever built by removing a field
// from something wider** (12 §8, D-117). A document row carries `role`, `superseded_by_document_id`
// and `stakeholder_id` — which document supersedes which is the missed-defect section of the
// debrief, after scoring — so `DocumentSummary` names its five fields and a sixth cannot appear by
// somebody adding a column.
// ---------------------------------------------------------------------------------------------

/** A calendar date as `scenario_documents.dated_on` stores it: `YYYY-MM-DD`, not an instant. */
const isoDate = z.iso.date()

/**
 * One document as the Evidence Room lists it (10 §6: "ids, titles, dates, authors; body on open").
 *
 * **There is no `body` here.** FR-022 records which documents were opened and for how long, and a
 * list that carried every body would make that record a fiction — the student would have read the
 * room from one response and every `document_open` event after it would be describing a click.
 * The body arrives from `POST /runs/{runId}/documents/{documentId}/open`, which is the event.
 */
export const DocumentSummarySchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  title: z.string().min(1),
  author: z.string(),
  datedOn: isoDate,
})
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>

/**
 * An open the run still has outstanding: a document the student's browser has open, or one it left
 * open when the tab closed (FR-117).
 *
 * The workspace carries them so a screen that has just been reloaded can close what the previous
 * page left behind, rather than leaving a read that never ends. A close is idempotent, so sending
 * one for an open somebody else already closed costs nothing.
 */
export const OpenDocumentSchema = z.object({
  openId: z.uuid(),
  documentId: z.uuid(),
  openedAt: z.iso.datetime(),
})
export type OpenDocument = z.infer<typeof OpenDocumentSchema>

/**
 * The locked frame (FR-041): the student's own words, read back to them for the rest of the run.
 *
 * It is the same four fields the `frame_locked` event carries, because it is the same frame — the
 * row and the event are written in one transaction and neither can be edited afterwards.
 */
export const FrameSchema = z.object({
  decision: z.string(),
  assumptions: z.array(z.string()).length(3),
  position: z.string(),
  confidence: z.int().min(0).max(100),
  lockedAt: z.iso.datetime(),
})
export type Frame = z.infer<typeof FrameSchema>

/**
 * What the workspace can do *now*, so a screen renders from the run's state rather than restating
 * the state machine (10 §9).
 *
 * `assistantUnlocked` is FR-020 and FR-041 in one boolean: the assistant is locked while the run is
 * framing and unlocks at the frame lock, without evaluation or comment. The panel behind it lands
 * in Phase 7; the fact it reads is true now.
 */
export const WorkspaceCapabilitiesSchema = z.object({
  canOpenDocuments: z.boolean(),
  canLockFrame: z.boolean(),
  assistantUnlocked: z.boolean(),
})
export type WorkspaceCapabilities = z.infer<typeof WorkspaceCapabilitiesSchema>

/**
 * `GET /runs/{runId}/workspace` (07 §7, §10): the room as its student sees it.
 *
 * 07 §10's `RunWorkspace` also lists `delegations`, `claims`, `briefDraft`, `addendum`,
 * `declarations`, `pause` and `turn`. Each arrives with the phase that makes it true — the
 * assistant and the log in Phase 7, the claims and the brief draft in Phase 8, the pause and the
 * Turn in Phases 8 and 9 — and none is declared here as an empty array in the meantime: a field
 * that is always empty is a shape a reader has to learn to disbelieve.
 */
export const RunWorkspaceSchema = z.object({
  run: RunSummarySchema,
  /** The Scenario Brief (FR-020), at most 200 words; not the student's decision brief. */
  brief: z.object({ text: z.string() }),
  documents: z.array(DocumentSummarySchema),
  openDocuments: z.array(OpenDocumentSchema),
  /** Null while the run is framing; the locked frame from the moment it is locked (FR-041). */
  frame: FrameSchema.nullable(),
  capabilities: WorkspaceCapabilitiesSchema,
})
export type RunWorkspace = z.infer<typeof RunWorkspaceSchema>

/** `POST /runs/{runId}/documents/{documentId}/open` addresses one document of one run. */
export const DocumentParamsSchema = z.object({ runId: z.uuid(), documentId: z.uuid() })

/** `POST /runs/{runId}/document-opens/{openId}/close` addresses one open of one run. */
export const DocumentOpenParamsSchema = z.object({ runId: z.uuid(), openId: z.uuid() })

/**
 * What an open answers (07 §7): the id the close will name, and the document itself.
 *
 * The body is here and nowhere else. This response *is* the open — the trace event is written in
 * the same transaction that produced it — so a student cannot read a document without the run
 * recording that they did (FR-022).
 */
export const DocumentOpenedSchema = z.object({
  openId: z.uuid(),
  document: DocumentSummarySchema.extend({ body: z.string() }),
})
export type DocumentOpened = z.infer<typeof DocumentOpenedSchema>

/**
 * The frame as it arrives on the wire (07 §7, FR-040).
 *
 * Shape only: four fields of the right kinds, and no rule about what is in them. The rules —
 * every field filled, 50 / 25 / 100 words, three assumptions, confidence 0 to 100 — are
 * `LockFrameSchema` below, applied by the service so that a frame that breaks one is answered
 * `FRAME_INVALID` naming the field (10 §6) rather than the generic validation failure a route-level
 * refinement would produce. It is the shape `courses` uses for `MAPPING_INVALID`, for the same
 * reason.
 */
export const LockFrameInputSchema = z.strictObject({
  decision: z.string(),
  assumptions: z.array(z.string()),
  position: z.string(),
  confidence: z.number(),
})
export type LockFrameInput = z.infer<typeof LockFrameInputSchema>

/**
 * The frame's rules (FR-040, FR-042), and the schema the form counts words against.
 *
 * `wordLimit(n)` strips markup and trims before it counts, so the string the form counted, the
 * string the service validated and the string stored are the same string (D-075). `.min(1)` after
 * it means "not empty once the markup is gone", which is what makes one word per field pass and an
 * empty field fail — FR-042 wants the first and FR-040 the second.
 */
export const LockFrameSchema = z.strictObject({
  /** The real decision, at most 50 words (FR-040). */
  decision: wordLimit(50).min(1),
  /** Exactly three load-bearing assumptions, 25 words each. */
  assumptions: z.array(wordLimit(25).min(1)).length(3),
  /** The initial position, at most 100 words; it may be a lean (PRD §7.4). */
  position: wordLimit(100).min(1),
  /** 0 to 100. A low number with a reason is credited above a confident guess (PRD §7.4). */
  confidence: z.int().min(0).max(100),
})
export type LockFrame = z.infer<typeof LockFrameSchema>

/**
 * Test-only (D-109, 07 §7): how far back `POST /api/v1/test/runs/{runId}/advance-clock` shifts the
 * run's clock columns, so an end-to-end test can reach an expiry without waiting for one. Bounded at
 * a day, which is longer than any timer in the build.
 */
export const AdvanceClockSchema = z.strictObject({
  ms: z.int().positive().max(86_400_000),
})
export type AdvanceClockInput = z.infer<typeof AdvanceClockSchema>

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
