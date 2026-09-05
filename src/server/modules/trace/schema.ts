// Wire contract of the `trace` module (docs/tech/10-backend-spec-modules.md §10; 07-api-spec.md §7;
// 06-data-model.md §3.4 `run_events`). Two things live here: the payload schema of every event type
// the trace can hold, and the view a reader of `GET /runs/{runId}/trace` receives.
//
// Payload fields are snake_case and ids are UUID strings, because a payload is the jsonb column as
// it was written and as the export document (FR-240) reads it back — not a view built for a screen.
// The envelope around it is camelCase like every other view in this codebase; the two conventions
// meet at `TraceEventViewSchema` on purpose, and nothing rewrites the payload on the way out.
//
// Every payload is a `strictObject`. The trace is append-only and is what scoring, the four graphs,
// the debrief and the record are computed from, so a field nobody meant to write is a defect that
// must fail at the append, not a curiosity found in Phase 10. `append` parses through
// `EVENT_PAYLOAD_SCHEMAS` before it inserts, so a payload that does not match its type is refused
// before it reaches the column.
//
// Enumerations are restated rather than imported: a module schema may reach `src/lib` and nothing
// else (04 §2), which is what keeps it readable from a Server Component. They mirror the Postgres
// enums of `src/server/db/schema/enums.ts` and 06 §3.4 exactly.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Enumerations (06-data-model.md §3.2 to §3.5)
// ---------------------------------------------------------------------------------------------

/** `run_events.type` — the thirty-two event types of 10 §10, in the order the enum declares them. */
export const RUN_EVENT_TYPES = [
  'policy_displayed',
  'lifecycle',
  'readiness_item',
  'readiness_skipped',
  'document_open',
  'document_close',
  'frame_locked',
  'delegation',
  'claim_used',
  'stance_set',
  'action',
  'escalation',
  'outside_tool_declared',
  'pause',
  'resume',
  'lock_refused',
  'decision_locked',
  'brief_opened',
  'brief_closed',
  'addendum',
  'turn_delivered',
  'turn_response_locked',
  'defense_question',
  'defense_answer',
  'draft_band',
  'band_decision',
  'claim_neutralized',
  'run_voided',
  'run_reoffered',
  'debrief_opened',
  'debrief_answer',
  'probe_fired',
] as const

export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES)
export type RunEventTypeValue = z.infer<typeof RunEventTypeSchema>

const RunStateSchema = z.enum([
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

/**
 * `runs.state`, as the trace reads it. Only the type is exported: `owner-view.ts` keys its access
 * table on it so a state added to the enum is a compile error there, and the schema itself stays
 * private because the `runs` module owns the wire form of a run state.
 */
export type RunStateValue = z.infer<typeof RunStateSchema>

const OutsideAiPolicySchema = z.enum(['open', 'declared', 'in_environment_only'])
const RunTypeSchema = z.enum(['decision', 'critique'])
const ReadinessCategorySchema = z.enum(['foundation', 'defect_concept', 'ai_behavior'])
const StanceSchema = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
const ActionTypeSchema = z.enum([
  'source_trace',
  'replication_check',
  'decomposition_check',
  'stakeholder_interview',
])
const PauseCauseSchema = z.enum([
  'assistant_failure',
  'document_failure',
  'action_failure',
  'connection',
])
const TurnVoiceSchema = z.enum([
  'stakeholder_message',
  'corrected_number',
  'supplier_notice',
  'competitor_move',
  'retracted_source',
  'regulatory_note',
])
const TurnResponseSchema = z.enum(['hold', 'revise', 'reverse'])
const QuestionKindSchema = z.enum([
  'provenance',
  'figure_provenance',
  'verification',
  'assumption',
  'confidence',
  'frame_vs_response',
  'counterfactual',
  'default',
])
const DimensionSchema = z.enum([
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
const BandSchema = z.enum(['novice', 'developing', 'proficient', 'professional'])
const DraftStatusSchema = z.enum(['drafted', 'unassessed'])
const BandBasisSchema = z.enum(['trace', 'defense_only', 'categorical_only', 'none'])
const BandDecisionSchema = z.enum(['confirmed', 'overridden', 'unassessed'])
const NeutralizationReasonSchema = z.enum([
  'unintended_defect',
  'wrong_verification_result',
  'misbehaving_material',
  'adaptation_failed',
  'record_lost',
  'other',
])
const VoidReasonSchema = z.enum(['unscoreable', 'scoring_held', 'walkthrough', 'other'])
/** The four graph keys of 10 §11.1. */
const GraphKeySchema = z.enum([
  'confidence_line',
  'clock_timeline',
  'stance_matrix',
  'frame_beside_decision',
])

// ---------------------------------------------------------------------------------------------
// Shared field shapes
// ---------------------------------------------------------------------------------------------

const uuid = z.uuid()
const seq = z.int().min(1)
/** A duration is never negative; `duration_ms` is capped at the clock, not subtracted from it. */
const durationMs = z.int().min(0)
const confidence = z.int().min(0).max(100)
/** Exactly three, as `run_frames.assumptions` and its `array_length = 3` check require. */
const threeAssumptions = z.array(z.string()).length(3)
/** The band mapping as `policy_displayed` shows it (10 §17). */
const MappingSchema = z.strictObject({
  novice: z.number(),
  developing: z.number(),
  proficient: z.number(),
  professional: z.number(),
})

// ---------------------------------------------------------------------------------------------
// The payloads (10-backend-spec-modules.md §10, "Event payloads")
//
// One schema per row of that table, in its order. Where the table writes a field with no type, the
// column or the service function that writes it decides: `run_document_opens.skim` is a boolean by
// the time a close is written, `run_delegations.why` is nullable, `runs.confidence_*` are 0 to 100.
// ---------------------------------------------------------------------------------------------

/** FR-201: the four values the run start screen showed, recorded as shown. */
export const PolicyDisplayedPayloadSchema = z.strictObject({
  outside_ai_policy: OutsideAiPolicySchema,
  weight: z.number(),
  mapping: MappingSchema,
  run_type: RunTypeSchema,
  /** The statement that the run counts is always made (FR-201); the literal records that it was. */
  counts_statement: z.literal(true),
})

/** Written by `transition()` for every state change (10 §9); `cause` names what triggered it. */
export const LifecyclePayloadSchema = z.strictObject({
  from: RunStateSchema,
  to: RunStateSchema,
  cause: z.string().min(1),
})

/** One per readiness item at submit; unanswered items carry `answer_key: null, correct: null`. */
export const ReadinessItemPayloadSchema = z.strictObject({
  item_id: uuid,
  item_key: z.string().min(1),
  category: ReadinessCategorySchema,
  concept_key: z.string().min(1),
  /** The key the student chose, not the key that was right (FR-012). */
  answer_key: z.string().nullable(),
  correct: z.boolean().nullable(),
})

export const ReadinessSkippedPayloadSchema = z.strictObject({
  reason: z.enum(['expired', 'student_skip']),
  unanswered_count: z.int().min(0),
})

export const DocumentOpenPayloadSchema = z.strictObject({
  open_id: uuid,
  document_id: uuid,
  document_key: z.string().min(1),
  before_first_delegation: z.boolean(),
  in_turn_window: z.boolean(),
})

export const DocumentClosePayloadSchema = z.strictObject({
  open_id: uuid,
  document_id: uuid,
  duration_ms: durationMs,
  before_first_delegation: z.boolean(),
  /** D-082: read as a skim by word count against the time the document was open. */
  skim: z.boolean(),
  in_turn_window: z.boolean(),
})

/** FR-040: the frame is irreversible, so this payload is the frame for the rest of the run. */
export const FrameLockedPayloadSchema = z.strictObject({
  decision: z.string(),
  assumptions: threeAssumptions,
  position: z.string(),
  confidence,
})

/** FR-051, FR-060: one delegation, complete. A failed stream is recorded with `failed: true`. */
export const DelegationPayloadSchema = z.strictObject({
  delegation_id: uuid,
  seq,
  request_text: z.string(),
  response_text: z.string(),
  claim_ids: z.array(uuid),
  why: z.string().nullable(),
  in_turn_window: z.boolean(),
  /** Reviewer flags on the delegation, e.g. `out_of_scenario` (FR-055). */
  flags: z.array(z.string()),
  unverified_numbers: z.array(z.strictObject({ value: z.string(), context: z.string() })),
  failed: z.boolean(),
})

/** FR-084, FR-101, D-077: the three ways a claim becomes relied on. */
export const ClaimUsedPayloadSchema = z.strictObject({
  claim_id: uuid,
  via: z.enum(['log_mark', 'named_field', 'turn_window']),
  /** `named_fields.key`, present only for `named_field`. */
  field_key: z.string().min(1).optional(),
  /** Present only when a log mark names the delegation the claim was marked used in. */
  delegation_id: uuid.optional(),
})

export const StanceSetPayloadSchema = z.strictObject({
  claim_id: uuid,
  stance: StanceSchema,
  previous_stance: StanceSchema.nullable(),
  /** The actions run on this claim before the stance was set (FR-080). */
  action_ids: z.array(uuid),
  in_turn_window: z.boolean(),
})

/** FR-070 to FR-072: the authored result is recorded with the cost that bought it. */
export const ActionPayloadSchema = z.strictObject({
  action_id: uuid,
  type: ActionTypeSchema,
  claim_id: uuid,
  clock_cost_ms: durationMs,
  /** The authored verification-path result; its shape is per action type (10 §8). */
  result: z.record(z.string(), z.unknown()),
  in_turn_window: z.boolean(),
})

/** FR-090 to FR-092: `response_id` is `claim` (the claim's scripted reply) or `general`. */
export const EscalationPayloadSchema = z.strictObject({
  escalation_id: uuid,
  claim_id: uuid,
  statement: z.string().min(1),
  response_id: z.enum(['claim', 'general']),
  response_text: z.string(),
  clock_cost_ms: durationMs,
  counts_against_limit: z.boolean(),
  in_turn_window: z.boolean(),
})

/** FR-061: declared, recorded, and without any other effect. */
export const OutsideToolDeclaredPayloadSchema = z.strictObject({ purpose: z.string().min(1) })

export const PausePayloadSchema = z.strictObject({
  pause_id: uuid,
  cause: PauseCauseSchema,
  related_delegation_id: uuid.nullable(),
})

export const ResumePayloadSchema = z.strictObject({
  pause_id: uuid,
  paused_ms: durationMs,
  clock_credited_ms: durationMs,
})

/** FR-084, FR-108: the lock the student asked for and did not get, and why. */
export const LockRefusedPayloadSchema = z.strictObject({
  reason: z.enum(['unstanced_relied_on', 'brief_invalid']),
  claim_id: uuid.optional(),
  claim_text: z.string().optional(),
  /** The brief field at fault, for `brief_invalid`. */
  field: z.string().min(1).optional(),
})

/** FR-102, FR-106: the brief as locked, with what the lock gate computed about it. */
export const DecisionLockedPayloadSchema = z.strictObject({
  recommendation: z.string(),
  rationale: z.string(),
  assumptions: threeAssumptions,
  change_my_mind: z.string(),
  /** `named_fields.key` → the number the student entered (FR-101). */
  named_values: z.record(z.string(), z.number()),
  confidence: confidence.nullable(),
  /** True when the clock expired and the draft was locked for the student (10 §8). */
  auto: z.boolean(),
  /** FR-106: locked under four minutes of working time. An instructor observation. */
  speed_outlier: z.boolean(),
  relied_on_claim_ids: z.array(uuid),
  unstanced_relied_on_claim_ids: z.array(uuid),
  elapsed_ms: durationMs,
})

/** FR-100: brief editor opened. It carries no fields; the instant and the clock are the record. */
export const BriefOpenedPayloadSchema = z.strictObject({})

export const BriefClosedPayloadSchema = z.strictObject({ duration_ms: durationMs })

/** FR-107: one per run, fifty words. */
export const AddendumPayloadSchema = z.strictObject({ text: z.string().min(1) })

/** FR-110, FR-111: the Turn as delivered, with the window it opened. */
export const TurnDeliveredPayloadSchema = z.strictObject({
  turn_id: uuid,
  text: z.string(),
  voice: TurnVoiceSchema,
  window_ends_at: z.iso.datetime(),
  window_claim_ids: z.array(uuid),
})

/** FR-112, FR-115: `implicit` is the hold recorded when the window closed unanswered. */
export const TurnResponseLockedPayloadSchema = z.strictObject({
  response: TurnResponseSchema,
  justification: z.string().nullable(),
  confidence: confidence.nullable(),
  implicit: z.boolean(),
})

/** FR-120, FR-124: one per question asked, follow-ups included. */
export const DefenseQuestionPayloadSchema = z.strictObject({
  run_question_id: uuid,
  question_id: uuid,
  kind: QuestionKindSchema,
  seq,
  rendered_text: z.string().min(1),
  follow_up_of: uuid.nullable(),
  /** The trace event the question was rendered from, when one selected it (10 §9 selection). */
  selecting_event_seq: z.int().min(1).nullable(),
})

export const DefenseAnswerPayloadSchema = z.strictObject({
  run_question_id: uuid,
  /** An empty answer is allowed and is itself evidence (FR-124). */
  text: z.string(),
  duration_ms: durationMs,
})

/** FR-130 to FR-137: one per dimension, written by the scoring job. */
export const DraftBandPayloadSchema = z.strictObject({
  dimension: DimensionSchema,
  /** Null when the dimension is unassessed. */
  band: BandSchema.nullable(),
  status: DraftStatusSchema,
  reason: z.string(),
  basis: BandBasisSchema,
  provisional: z.boolean(),
  graph_keys: z.array(GraphKeySchema),
  evidence_event_seqs: z.array(z.int().min(1)),
  quotes: z.array(z.strictObject({ event_seq: z.int().min(1), text: z.string() })),
  rationale: z.string(),
})

/** FR-181: the instructor's decision on one drafted band. */
export const BandDecisionPayloadSchema = z.strictObject({
  dimension: DimensionSchema,
  decision: BandDecisionSchema,
  /** The band the decision settles on; null for `unassessed`. */
  band: BandSchema.nullable(),
  note: z.string().nullable(),
})

/** FR-005, FR-087, FR-232: the correction and everything it moved. */
export const ClaimNeutralizedPayloadSchema = z.strictObject({
  neutralization_id: uuid,
  claim_id: uuid,
  reason: NeutralizationReasonSchema,
  credit_challenge: z.boolean(),
  note: z.string(),
  recompute: z.strictObject({
    dimensions: z.array(DimensionSchema),
    // Keyed by dimension over the dimensions the recompute touched, so `partialRecord`: a Zod 4
    // `record` with an enum key demands every key, and only the free-text dimensions are exempt
    // from the recompute (10 §11.5), never all seven.
    bands_before: z.partialRecord(DimensionSchema, BandSchema.nullable()),
    bands_after: z.partialRecord(DimensionSchema, BandSchema.nullable()),
    points_before: z.number().nullable(),
    points_after: z.number().nullable(),
  }),
})

/** FR-002, FR-008, D-120: the free-text note lives here, not on the run row. */
export const RunVoidedPayloadSchema = z.strictObject({
  reason: VoidReasonSchema,
  note: z.string(),
  re_offered_run_id: uuid.nullable(),
})

/** FR-183: written on the new run, naming the one it replaces. */
export const RunReofferedPayloadSchema = z.strictObject({
  from_run_id: uuid,
  variant_id: uuid,
})

/** FR-150: first open per version of the bands (10 §13). */
export const DebriefOpenedPayloadSchema = z.strictObject({
  version: z.enum(['draft', 'confirmed']),
})

/** FR-152: the two questions that close the run. */
export const DebriefAnswerPayloadSchema = z.strictObject({
  stance_to_change: z.string(),
  do_differently: z.string(),
})

/** FR-053, D-088: the Sycophancy Probe reversed on a claim the student had challenged. */
export const ProbeFiredPayloadSchema = z.strictObject({
  claim_id: uuid,
  scripted_reversal: z.string(),
})

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/**
 * Every event type joined to the schema its payload must satisfy. `append` looks the type up here,
 * so adding a type to `RUN_EVENT_TYPES` without a schema is a compile error rather than a row with
 * an unchecked payload — which is the property the whole table is for.
 */
export const EVENT_PAYLOAD_SCHEMAS = {
  policy_displayed: PolicyDisplayedPayloadSchema,
  lifecycle: LifecyclePayloadSchema,
  readiness_item: ReadinessItemPayloadSchema,
  readiness_skipped: ReadinessSkippedPayloadSchema,
  document_open: DocumentOpenPayloadSchema,
  document_close: DocumentClosePayloadSchema,
  frame_locked: FrameLockedPayloadSchema,
  delegation: DelegationPayloadSchema,
  claim_used: ClaimUsedPayloadSchema,
  stance_set: StanceSetPayloadSchema,
  action: ActionPayloadSchema,
  escalation: EscalationPayloadSchema,
  outside_tool_declared: OutsideToolDeclaredPayloadSchema,
  pause: PausePayloadSchema,
  resume: ResumePayloadSchema,
  lock_refused: LockRefusedPayloadSchema,
  decision_locked: DecisionLockedPayloadSchema,
  brief_opened: BriefOpenedPayloadSchema,
  brief_closed: BriefClosedPayloadSchema,
  addendum: AddendumPayloadSchema,
  turn_delivered: TurnDeliveredPayloadSchema,
  turn_response_locked: TurnResponseLockedPayloadSchema,
  defense_question: DefenseQuestionPayloadSchema,
  defense_answer: DefenseAnswerPayloadSchema,
  draft_band: DraftBandPayloadSchema,
  band_decision: BandDecisionPayloadSchema,
  claim_neutralized: ClaimNeutralizedPayloadSchema,
  run_voided: RunVoidedPayloadSchema,
  run_reoffered: RunReofferedPayloadSchema,
  debrief_opened: DebriefOpenedPayloadSchema,
  debrief_answer: DebriefAnswerPayloadSchema,
  probe_fired: ProbeFiredPayloadSchema,
} as const satisfies Record<RunEventTypeValue, z.ZodType>

/** The payload a given event type carries, as its writer must supply it. */
export type EventPayload<T extends RunEventTypeValue> = z.input<(typeof EVENT_PAYLOAD_SCHEMAS)[T]>

/** The payload as it is stored and read back. */
export type StoredEventPayload<T extends RunEventTypeValue> = z.infer<
  (typeof EVENT_PAYLOAD_SCHEMAS)[T]
>

// ---------------------------------------------------------------------------------------------
// The read (07-api-spec.md §7, `GET /runs/{runId}/trace`)
// ---------------------------------------------------------------------------------------------

/**
 * One event as a reader receives it. The envelope is camelCase and its instants are ISO strings,
 * like every other view; the payload keeps the snake_case shape it was written in, because it is
 * the record and the export reads the same object back (FR-240).
 *
 * The payload is typed `unknown` at the wire boundary rather than as a union of the thirty-two
 * schemas: a reader narrows it by `type` through `EVENT_PAYLOAD_SCHEMAS`, and an owner's view has
 * fields withheld (see `service.ts`), so a union here would promise a shape the projection does
 * not always keep.
 */
export const TraceEventViewSchema = z.object({
  seq: z.int().min(1),
  type: RunEventTypeSchema,
  occurredAt: z.iso.datetime(),
  /** Null outside the working period and the Turn window (D-042). */
  clockRemainingMs: z.int().nullable(),
  actorId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
})
export type TraceEventView = z.infer<typeof TraceEventViewSchema>

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
