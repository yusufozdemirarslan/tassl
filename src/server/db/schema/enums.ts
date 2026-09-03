// Every Postgres enum from docs/tech/06-data-model.md, declared once (phase-02 step 2.2). Table files
// import from here; TypeScript unions are derived with `(typeof x.enumValues)[number]`.
import { pgEnum } from 'drizzle-orm/pg-core'

// 3.1 Identity and tenancy
export const planTier = pgEnum('plan_tier', [
  'pilot',
  'course_license',
  'department',
  'institution',
  'practice_pass',
])
export const agreementPurpose = pgEnum('agreement_purpose', [
  'scoring_audit',
  'scenario_calibration',
  'drift_review',
])

// 3.2 Courses
export const outsideAiPolicy = pgEnum('outside_ai_policy', [
  'open',
  'declared',
  'in_environment_only',
])
export const sectionRole = pgEnum('section_role', ['student', 'instructor', 'ta'])
export const runType = pgEnum('run_type', ['decision', 'critique'])

// 3.3 Scenario packages
export const packageStatus = pgEnum('package_status', ['draft', 'confirmed', 'retired'])
export const calibrationStatus = pgEnum('calibration_status', ['uncalibrated', 'calibrated'])
export const documentRole = pgEnum('document_role', [
  'supporting',
  'superseded',
  'interpretation_as_fact',
  'irrelevant',
])
export const positionKind = pgEnum('position_kind', ['defensible', 'evidence_inconsistent'])
export const valueUnit = pgEnum('value_unit', [
  'percent',
  'ratio',
  'months',
  'usd',
  'count',
  'other',
])
export const claimSource = pgEnum('claim_source', ['assistant', 'document'])
export const claimImportance = pgEnum('claim_importance', ['load_bearing', 'supporting'])
export const consequenceLevel = pgEnum('consequence_level', ['low', 'medium', 'high'])
export const verificationCost = pgEnum('verification_cost', ['cheap', 'moderate', 'expensive'])
export const variantKey = pgEnum('variant_key', ['defective', 'sound'])
export const evidenceStatus = pgEnum('evidence_status', ['sound', 'defective'])
export const failureFamily = pgEnum('failure_family', [
  'near_neighbor',
  'unstated_assumption',
  'stale_evidence',
  'uncomputed_number',
  'extrapolation',
  'reversal_to_agree',
  'omitted_alternative',
  'misapplied_method',
  'misattributed_source',
  'unacceptable_route',
])
export const stance = pgEnum('stance', ['accept', 'verify', 'challenge', 'reject', 'escalate'])
export const turnVoice = pgEnum('turn_voice', [
  'stakeholder_message',
  'corrected_number',
  'supplier_notice',
  'competitor_move',
  'retracted_source',
  'regulatory_note',
])
export const turnResponse = pgEnum('turn_response', ['hold', 'revise', 'reverse'])
export const questionKind = pgEnum('question_kind', [
  'provenance',
  'figure_provenance',
  'verification',
  'assumption',
  'confidence',
  'frame_vs_response',
  'counterfactual',
  'default',
])
export const readinessCategory = pgEnum('readiness_category', [
  'foundation',
  'defect_concept',
  'ai_behavior',
])
export const elementType = pgEnum('element_type', [
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
export const confirmationDecision = pgEnum('confirmation_decision', [
  'confirmed',
  'edited',
  'rejected',
])
export const generationStep = pgEnum('generation_step', [
  'reskin_brief_stakeholders',
  'documents',
  'answer_space_fields',
  'claims_and_states',
  'turn_and_probe',
  'question_bank_and_counterfactual',
  'readiness_items',
])
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed'])

// 3.4 Runs
export const runState = pgEnum('run_state', [
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
export const runMode = pgEnum('run_mode', ['guided', 'standard', 'open'])
export const voidReason = pgEnum('void_reason', [
  'unscoreable',
  'scoring_held',
  'walkthrough',
  'other',
])
export const scoringStatus = pgEnum('scoring_status', ['idle', 'queued', 'running', 'held', 'done'])
export const runEventType = pgEnum('run_event_type', [
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
])
export const surfacedBy = pgEnum('surfaced_by', ['delegation', 'document', 'turn', 'student'])
export const actionType = pgEnum('action_type', [
  'source_trace',
  'replication_check',
  'decomposition_check',
  'stakeholder_interview',
])
export const pauseCause = pgEnum('pause_cause', [
  'assistant_failure',
  'document_failure',
  'action_failure',
  'connection',
])

// 3.5 Scoring, review, records
export const dimension = pgEnum('dimension', [
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
export const band = pgEnum('band', ['novice', 'developing', 'proficient', 'professional'])
export const draftStatus = pgEnum('draft_status', ['drafted', 'unassessed'])
export const bandBasis = pgEnum('band_basis', ['trace', 'defense_only', 'categorical_only', 'none'])
export const bandDecision = pgEnum('band_decision', ['confirmed', 'overridden', 'unassessed'])
export const neutralizationReason = pgEnum('neutralization_reason', [
  'unintended_defect',
  'wrong_verification_result',
  'misbehaving_material',
  'adaptation_failed',
  'record_lost',
  'other',
])
export const exportReason = pgEnum('export_reason', [
  'initial',
  'override',
  'neutralization',
  'mapping_change',
  'unassessed',
])

// 3.6 Platform
export const notificationType = pgEnum('notification_type', [
  'generation_complete',
  'generation_failed',
  'run_scored',
  'run_held',
  'bands_confirmed',
  'invitation',
  'export_ready',
])
export const llmFeature = pgEnum('llm_feature', [
  'assistant',
  'band_read',
  'generation',
  'trigger_classify',
  'eval',
])
export const llmOutcome = pgEnum('llm_outcome', [
  'ok',
  'validation_failed',
  'repaired',
  'timeout',
  'error',
  'budget_exceeded',
  'circuit_open',
])
