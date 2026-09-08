// Analytics event catalogue: docs/tech/17-analytics-events.md §3 and §5.1.
// Every schema is a z.strictObject (allowlist by construction, rule 3). An event that is not in
// EVENTS does not compile. Events are appended per phase; the primitive vocabulary lives here.
import { z } from 'zod'
import { FORBIDDEN_PROPERTY_PATTERN, MAX_PROPERTY_STRING_LENGTH } from './property-guard'

export { FORBIDDEN_PROPERTY_PATTERN, MAX_PROPERTY_STRING_LENGTH }

// Primitive vocabulary. Only these leaf kinds are allowed (tests/unit/analytics/events.test.ts enforces it).
export const Uuid = z.uuid()
export const Int = z.int().nonnegative()
export const Share = z.number().min(0).max(1)
export const RuleCode = z.string().regex(/^[A-Z0-9_]+$/)
/** The three outside-AI policies a course can set (06 §3.2). */
export const OutsideAiPolicy = z.enum(['open', 'declared', 'in_environment_only'])
/** The two variants of a scenario package version (06 §3.3). */
export const Variant = z.enum(['defective', 'sound'])
/** A route template such as /runs/[runId]/work, never a concrete path. */
export const RouteTemplate = z.string().regex(/^\/[A-Za-z0-9[\]/-]*$/)
/** How much of the environment the run offers (06 §3.2). */
export const Mode = z.enum(['guided', 'standard', 'open'])
/** The five stances a student may take on a claim (FR-080). */
export const Stance = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
/** The four bands, plus the value that says a dimension could not be assessed (FR-130). */
export const Band = z.enum(['novice', 'developing', 'proficient', 'professional', 'unassessed'])
/** The seven dimensions the rubric bands (FR-130). */
export const Dimension = z.enum([
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
/** Which provider answered (11 §2); `mock` is the default and the one CI ever sees. */
export const Provider = z.enum(['mock', 'openai-compatible', 'anthropic'])
/** The thirteen states of a run (10 §4). */
export const RunState = z.enum([
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
])
/** A confidence reading, 0 to 100 (FR-041); null wherever the student did not give one. */
const Confidence = z.int().min(0).max(100)
/** `element_type` (06 §3.3 DATA-026): the fifteen things an author confirms one at a time. */
export const ElementType = z.enum([
  'brief',
  'document',
  'stakeholder',
  'answer_space_position',
  'named_field',
  'claim',
  'variant_claim_state',
  'probe',
  'turn',
  'defense_question',
  'readiness_item',
  'counterfactual',
  'general_escalation_reply',
  'clock_and_difficulty',
  'seed_reskin',
])

/** `generation_step` (06 §3.3 DATA-027): the seven steps of the authoring pipeline, in order. */
export const GenerationStep = z.enum([
  'reskin_brief_stakeholders',
  'documents',
  'answer_space_fields',
  'claims_and_states',
  'turn_and_probe',
  'question_bank_and_counterfactual',
  'readiness_items',
])

/** The package a measure is about (17 §5.1 `P`); every AN-001 event carries it. */
const packageContext = { package_id: Uuid, package_version_id: Uuid, version: z.int().positive() }
const pkg = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...packageContext, ...shape })

/** The run an event is about (17 §3 `R`); every AN-003 event and the two run AN-002 events carry it. */
const runContext = {
  run_id: Uuid,
  assignment_id: Uuid,
  package_version_id: Uuid,
  variant: Variant,
  mode: Mode,
  attempt_no: z.int().positive(),
  is_walkthrough: z.boolean(),
}
const run = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...runContext, ...shape })

/** The claim an event is about (17 §3 `C`). Never the claim's text — only what kind of claim it is. */
const claimContext = {
  claim_id: Uuid,
  importance: z.enum(['load_bearing', 'supporting']),
  consequence_level: z.enum(['low', 'medium', 'high']),
  in_turn_window: z.boolean(),
}
const claim = <T extends z.ZodRawShape>(shape: T) => run({ ...claimContext, ...shape })

export const EVENTS = {
  // AN-002 activation
  sign_up_completed: z.strictObject({ method: z.enum(['password', 'google']) }),
  email_verified: z.strictObject({ ms_since_sign_up: Int }),
  sign_in_succeeded: z.strictObject({ method: z.enum(['password', 'google', 'verification']) }),
  invitation_accepted: z.strictObject({
    invitation_id: Uuid,
    role: z.enum([
      'student',
      'instructor',
      'teaching_assistant',
      'scenario_author',
      'program_lead',
    ]),
    ms_since_invited: Int,
  }),

  // AN-001 activation: the two writes an instructor makes before a run can exist (17 §5.2)
  course_created: z.strictObject({
    course_id: Uuid,
    outside_ai_policy: OutsideAiPolicy,
    mapping_is_default: z.boolean(),
    ms_since_first_sign_in: Int,
  }),
  assignment_configured: z.strictObject({
    assignment_id: Uuid,
    course_id: Uuid,
    section_id: Uuid,
    package_version_id: Uuid,
    variant: Variant,
    is_new: z.boolean(),
    is_walkthrough: z.boolean(),
    working_clock_seconds: z.int().positive(),
    weight_overridden: z.boolean(),
    ms_since_first_sign_in: Int,
  }),

  // AN-002 activation, the run half (17 §3.1). `run_started` fires where the run row is written and
  // `policy_displayed` where its trace event is — see D-223; both are the student's Begin, one
  // screen apart. `weight_percent` is what the run is worth in the course, never a student's mark.
  run_started: run({ is_reoffer: z.boolean(), run_index_for_student: z.int().positive() }),
  policy_displayed: run({
    outside_ai_policy: OutsideAiPolicy,
    weight_percent: z.number(),
    mapping_is_default: z.boolean(),
  }),

  // AN-001 authoring operating measures (17 §3.2, FR-198). Three are written by the scenarios
  // service, where the act they measure happens; `generation_step_completed` is written by the
  // `generate_package_step` job handler, which is the only place that knows what a pass cost.
  package_created_from_seed: pkg({ seed_chars: Int, concept_count: Int }),
  generation_step_completed: pkg({
    generation_run_id: Uuid,
    step: GenerationStep,
    pass_number: z.int().positive(),
    status: z.enum(['succeeded', 'failed']),
    duration_ms: Int,
    failed_rules: z.array(RuleCode),
    input_tokens: Int,
    output_tokens: Int,
    provider: z.enum(['mock', 'openai-compatible', 'anthropic']),
  }),
  element_decided: pkg({
    element_type: ElementType,
    revision: z.int().positive(),
    decision: z.enum(['confirmed', 'edited', 'rejected']),
    review_ms: Int,
    edited_fields_count: Int,
  }),
  package_confirmed: pkg({
    seed_to_confirmed_ms: Int,
    edit_rate: Share,
    rejected_share: Share,
    generation_passes: Int,
    generation_max_pass: Int,
    elements_count: Int,
    review_ms_total: Int,
    review_ms_per_element: Int,
    claims_count: Int,
    documents_count: Int,
  }),

  // AN-003 engagement inside a run (17 §3.3). Every property is a count, a duration, an id, or an
  // enum: what the student wrote — the brief, the "why" line, an escalation statement, a defense
  // answer, a declaration purpose — never travels, and the schemas have no field it could go in.
  readiness_submitted: run({
    skipped: z.boolean(),
    expired: z.boolean(),
    answered_count: Int,
    held_count: Int,
    not_held_count: Int,
    unknown_count: Int,
    duration_ms: Int,
  }),
  document_opened: run({
    document_id: Uuid,
    document_role: z.enum(['supporting', 'superseded', 'interpretation_as_fact', 'irrelevant']),
    open_index: z.int().positive(),
    before_first_delegation: z.boolean(),
    in_turn_window: z.boolean(),
    skim: z.boolean(),
    duration_ms: Int,
  }),
  frame_locked: run({
    confidence: Confidence,
    ms_since_room_opened: Int,
    documents_opened_count: Int,
    words_total: Int,
  }),
  delegation_made: run({
    delegation_id: Uuid,
    seq: z.int().positive(),
    claims_surfaced: Int,
    in_turn_window: z.boolean(),
    unverified_numbers_count: Int,
    failed: z.boolean(),
    has_why: z.boolean(),
    latency_ms: Int,
    before_any_document_open: z.boolean(),
  }),
  claim_marked_used: claim({ via: z.enum(['log_mark', 'named_field', 'turn_window']) }),
  stance_set: claim({
    stance: Stance,
    previous_stance: Stance.nullable(),
    had_prior_action: z.boolean(),
    is_change: z.boolean(),
    ms_since_surfaced: Int,
  }),
  action_run: claim({
    action_id: Uuid,
    type: z.enum(['source_trace', 'replication_check', 'decomposition_check']),
    clock_cost_ms: Int,
    // The clock can be negative once the working window is spent (10 §5), so this one is signed.
    clock_remaining_ms: z.int(),
  }),
  escalation_made: claim({
    escalation_id: Uuid,
    response_kind: z.enum(['claim', 'general']),
    counts_against_limit: z.boolean(),
    clock_cost_ms: Int,
  }),
  probe_fired: run({ claim_id: Uuid }),
  outside_tool_declared: run({ course_policy: OutsideAiPolicy }),
  lock_refused: run({
    claim_id: Uuid,
    unstanced_relied_on_count: z.int().positive(),
    clock_remaining_ms: z.int(),
  }),
  decision_locked: run({
    auto_locked: z.boolean(),
    speed_outlier: z.boolean(),
    elapsed_ms: Int,
    confidence: Confidence.nullable(),
    relied_on_count: Int,
    unstanced_count: Int,
    empty_fields_count: Int,
    clock_remaining_ms: z.int(),
  }),
  addendum_added: run({ ms_since_lock: Int }),
  run_paused: run({
    pause_id: Uuid,
    cause: z.enum(['assistant_failure', 'document_failure', 'action_failure', 'connection']),
    forced_by_test_control: z.boolean(),
  }),
  run_resumed: run({ pause_id: Uuid, paused_ms: Int, credited_ms: Int }),
  turn_delivered: run({ lag_ms: Int, delivered_offline: z.boolean() }),
  turn_response_locked: run({
    response: z.enum(['hold', 'revise', 'reverse']),
    implicit: z.boolean(),
    confidence: Confidence.nullable(),
    ms_since_delivered: Int,
    window_claims_count: Int,
  }),
  defense_completed: run({
    questions_count: z.int().min(6).max(9),
    follow_ups_count: Int,
    answered_count: Int,
    duration_ms: Int,
    nothing_answered: z.boolean(),
  }),
  debrief_opened: run({
    bands_status: z.enum(['draft', 'confirmed']),
    first_open: z.boolean(),
    ms_since_scored: Int,
  }),
  debrief_answered: run({ ms_since_first_open: Int }),
  record_opened: run({ viewer: z.enum(['owner', 'reviewer']) }),

  // AN-004 faculty review (17 §3.4). A band decision travels as its decision, never as the note the
  // instructor wrote with it; `has_note` is the whole of what is said about that note.
  replay_opened: run({
    first_open: z.boolean(),
    scoring_status: z.enum(['idle', 'queued', 'running', 'held', 'done']),
  }),
  band_decided: run({
    dimension: Dimension,
    decision: z.enum(['confirmed', 'overridden', 'unassessed']),
    draft_status: z.enum(['drafted', 'unassessed']),
    changed_from_draft: z.boolean(),
    has_note: z.boolean(),
    ms_since_replay_opened: Int,
  }),
  run_confirmed: run({
    review_duration_ms: Int,
    override_count: z.int().min(0).max(7),
    unassessed_count: z.int().min(0).max(7),
    points_present: z.boolean(),
    ms_since_scored: Int,
  }),
  export_written: run({
    export_id: Uuid,
    version: z.int().positive(),
    reason: z.enum(['initial', 'override', 'neutralization', 'mapping_change', 'unassessed']),
  }),
  claim_neutralized: run({
    claim_id: Uuid,
    reason: z.enum([
      'unintended_defect',
      'wrong_verification_result',
      'misbehaving_material',
      'adaptation_failed',
      'record_lost',
      'other',
    ]),
    credit_challenge: z.boolean(),
    dimensions_recomputed: Int,
    bands_raised_count: Int,
    review_requested: z.boolean(),
  }),
  run_voided: run({
    state_at_void: RunState,
    reason: z.enum(['unscoreable', 'scoring_held', 'walkthrough', 'other']),
  }),
  run_reoffered: run({ from_run_id: Uuid, same_variant: z.boolean() }),

  // AN-005 per-run product measures at scoring (17 §3.5). This is the one event the PRD §10 metrics
  // are computed from. When scoring is held (FR-140) it still fires, with `held: true`, every band
  // `unassessed`, and null shares — a held run is a fact the dashboard must show, not a gap.
  run_scored: run({
    false_challenge_rate: Share.nullable(),
    matched_stance_share: Share.nullable(),
    accept_share: Share.nullable(),
    unassessed_count: z.int().min(0).max(7),
    provisional_count: z.int().min(0).max(7),
    scoring_latency_ms: Int,
    rubric_version: z.string().regex(/^v[0-9]+$/),
    provider: Provider,
    consequential_claims_count: Int,
    surfaced_claims_count: Int,
    delegations_count: Int,
    actions_count: Int,
    escalations_count: Int,
    documents_opened_count: Int,
    duration_ms: Int,
    confidence_at_frame: Confidence.nullable(),
    confidence_at_lock: Confidence.nullable(),
    confidence_after_turn: Confidence.nullable(),
    accuracy_at_lock: Share.nullable(),
    band_framing: Band,
    band_delegation: Band,
    band_verification: Band,
    band_calibration: Band,
    band_decision_quality: Band,
    band_adaptation: Band,
    band_ownership: Band,
    all_novice: z.boolean(),
    all_professional: z.boolean(),
    held: z.boolean(),
  }),

  // Operations, no screen: src/server/llm/calls.ts right after the llm_calls row is inserted
  // (17 §3.6, NFR-016). The prompt is named, never quoted; D-066 applies here exactly as it does
  // to the llm_calls table, which stores counts and a prompt hash and no text at all.
  llm_call: z.strictObject({
    feature: z.enum(['assistant', 'band_read', 'generation', 'trigger_classify', 'eval']),
    prompt: z.string().regex(/^[a-z0-9-]+$/),
    version: z.int().positive(),
    provider: Provider,
    model: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    outcome: z.enum([
      'ok',
      'validation_failed',
      'repaired',
      'timeout',
      'error',
      'budget_exceeded',
      'circuit_open',
    ]),
    latency_ms: Int,
    input_tokens: Int,
    output_tokens: Int,
    cost_usd: z.number().nonnegative(),
    fallback_used: z.boolean(),
    run_id: Uuid.nullable(),
    package_version_id: Uuid.nullable(),
  }),

  // SYS-008, SYS-022 (client: ErrorView and the ActionResult failure toast)
  error_shown: z.strictObject({
    code: RuleCode,
    status: z.int().min(100).max(599).nullable(),
    route: RouteTemplate,
  }),

  // Server, no screen: src/server/rate-limit/enforce.ts on refusal (D-026)
  rate_limited: z.strictObject({
    bucket: z.enum(['user_writes', 'user_reads', 'auth', 'llm', 'run_events']),
    scope: z.enum(['user', 'ip']),
  }),
} as const

export type EventName = keyof typeof EVENTS
export type EventProps<E extends EventName> = z.input<(typeof EVENTS)[E]>
/** A discriminated union of every event, so a call site can be checked exhaustively (17 §5.1). */
export type AnyEvent = { [E in EventName]: { name: E; props: EventProps<E> } }[EventName]
/** Used by the catalogue test and by the PostHog data-management import (17 §7). */
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]
