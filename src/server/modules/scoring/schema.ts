// Wire contract of the `scoring` module (docs/tech/10-backend-spec-modules.md §11; 06-data-model.md
// §3.5). One Zod schema per view, shared by the service that builds it and — from Phase 11 — the
// faculty replay and the debrief that render it.
//
// Like every module schema this file is the client-safe surface, so it holds no server imports and
// restates the four enumerations rather than importing the Drizzle ones or the trace module's
// copies (04 §2: a module schema may reach `src/lib` and nothing else).
//
// Dates leave the service as ISO strings and the `numeric` columns as numbers: `run_scores` stores
// rates and points as Postgres `numeric`, which postgres-js hands back as a string, and a view that
// carried the string would make every reader parse it again and disagree about how.
//
// Two things are deliberately absent. There is no `score`, `total`, `rank` or `percentile` field —
// FR-131, enforced by `tests/unit/scoring/field-names.test.ts` walking this file (D-430). And there is no
// student projection: a student reads their bands in the debrief once the run is scored (10 §13),
// through that module's own projection, because `evidence_event_seqs` and `quotes` are
// `reviewer_only` in every state (`trace/owner-view.ts`).
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// The enumerations (06 §3.2, restated)
// ---------------------------------------------------------------------------------------------

export const DimensionSchema = z.enum([
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
export type DimensionValue = z.infer<typeof DimensionSchema>

export const BandSchema = z.enum(['novice', 'developing', 'proficient', 'professional'])
export type BandValue = z.infer<typeof BandSchema>

export const DraftStatusSchema = z.enum(['drafted', 'unassessed'])
export const BandBasisSchema = z.enum(['trace', 'defense_only', 'categorical_only', 'none'])
export const BandDecisionSchema = z.enum(['confirmed', 'overridden', 'unassessed'])
export const GraphKeySchema = z.enum([
  'confidence_line',
  'clock_timeline',
  'stance_matrix',
  'frame_beside_decision',
])
export const ScoringStatusSchema = z.enum(['idle', 'queued', 'running', 'held', 'done'])
export type ScoringStatusValue = z.infer<typeof ScoringStatusSchema>

/** FR-141's two placements plus FR-125's, as `run_scores.flags` carries them. */
export const RUN_SCORE_FLAGS = ['all_novice', 'all_professional', 'nothing_answered'] as const
export const RunScoreFlagSchema = z.enum(RUN_SCORE_FLAGS)
export type RunScoreFlag = z.infer<typeof RunScoreFlagSchema>

/** Why a run is held rather than scored (13 §3.7's `ops_run_held` breakdown, FR-140). */
export const HOLD_REASONS = [
  'read_failed',
  'budget_exceeded',
  'provider_error',
  'record_lost',
] as const
export const HoldReasonSchema = z.enum(HOLD_REASONS)
export type HoldReason = z.infer<typeof HoldReasonSchema>

// ---------------------------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------------------------

/** A quote a read took from the run's own free text, anchored to the event it came from. */
export const bandQuoteSchema = z.object({
  event_seq: z.int().min(1),
  text: z.string(),
})

/**
 * One dimension of a scored run, as a reviewer reads it.
 *
 * `effectiveBand` is the one derived field, and the value points are computed from (10 §11.4): the
 * instructor's decision where a reviewer made one and the draft where they did not, with the
 * recomputed band as a floor under it that raises and never lowers (FR-182, FR-005, D-422). An
 * `unassessed` decision is terminal and answers null. It is on the view rather than in every reader
 * because three readers would be three chances to compose those two rules differently.
 */
export const bandViewSchema = z.object({
  dimension: DimensionSchema,
  band: BandSchema.nullable(),
  status: DraftStatusSchema,
  reason: z.string(),
  basis: BandBasisSchema,
  provisional: z.boolean(),
  graphKeys: z.array(GraphKeySchema),
  evidenceEventSeqs: z.array(z.int().min(1)),
  quotes: z.array(bandQuoteSchema),
  rationale: z.string(),
  decision: BandDecisionSchema.nullable(),
  decidedBand: BandSchema.nullable(),
  note: z.string().nullable(),
  bandBeforeCorrection: BandSchema.nullable(),
  bandAfterCorrection: BandSchema.nullable(),
  effectiveBand: BandSchema.nullable(),
})
export type BandView = z.infer<typeof bandViewSchema>

/** The run's score row with its seven bands (DATA-041, DATA-042). */
export const runScoreViewSchema = z.object({
  runId: z.uuid(),
  rubricVersion: z.string(),
  /** Appendix A.0: every band is a descriptive draft until the pilot calibrates it (FR-141). */
  uncalibrated: z.boolean(),
  scoringStatus: ScoringStatusSchema,
  falseChallengeRate: z.number().nullable(),
  matchedStanceShare: z.number().nullable(),
  pointsDraft: z.number().nullable(),
  pointsConfirmed: z.number().nullable(),
  pointsBeforeCorrection: z.number().nullable(),
  pointsAfterCorrection: z.number().nullable(),
  pointsEffective: z.number().nullable(),
  flags: z.array(z.string()),
  scoredAt: z.iso.datetime(),
  bands: z.array(bandViewSchema),
})
export type RunScoreView = z.infer<typeof runScoreViewSchema>

/**
 * What `scoreRun` reports back to the job handler and the tests (never to a reader).
 *
 * `already_held` is the held path's counterpart to `already_scored` (D-424). A hold leaves the run
 * at `defense_complete` (D-405), so the second job of a pair cannot report the outcome by the run's
 * state the way the scored path does: it says the run was already held, and writes nothing.
 */
export const scoreRunResultSchema = z.object({
  runId: z.uuid(),
  outcome: z.enum(['scored', 'held', 'already_scored', 'already_held']),
  holdReason: HoldReasonSchema.nullable(),
  durationMs: z.int().nonnegative(),
  provider: z.string(),
})
export type ScoreRunResult = z.infer<typeof scoreRunResultSchema>

export const runIdParamsSchema = z.object({ runId: z.uuid() })
export type RunIdParams = z.infer<typeof runIdParamsSchema>
