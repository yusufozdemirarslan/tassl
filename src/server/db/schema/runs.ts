// Phase 2 step 2.4 — every table of docs/tech/06-data-model.md §3.4 (DATA-028 to DATA-040): the run
// row, the append-only trace (`run_events`), and the read models a run writes as it moves through
// its states. Enums come from ./enums; identity from ./auth; parents from ./courses and ./scenarios.
//
// Conventions (06 §1): timestamptz everywhere; `updated_at` is maintained by the `set_updated_at()`
// trigger (attached in the step's hand-written migration), so no `$onUpdate`. Append-only tables
// (`run_events`, `run_actions`, `run_escalations`, `run_pauses`) and the locked artifacts
// (`run_frames`, `run_addenda`, `run_turn_responses`) carry no `updated_at`.
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'
import { assignments } from './courses'
import {
  actionType,
  pauseCause,
  runEventType,
  runMode,
  runState,
  scoringStatus,
  stance,
  surfacedBy,
  turnResponse,
  voidReason,
} from './enums'
import {
  defenseQuestions,
  readinessItems,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioVariants,
} from './scenarios'

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()

// ---------------------------------------------------------------------------------------------
// runs (DATA-028)
// ---------------------------------------------------------------------------------------------

/** `runs.flags` (06 §3.4): sparse booleans plus the first replay open, written by services. */
export type RunFlags = {
  nothing_answered?: boolean
  all_novice?: boolean
  all_professional?: boolean
  forced_failure_armed?: boolean
  readiness_submit_failed?: boolean
  /** ISO-8601 instant of the first reviewer replay open (D-120). */
  replay_first_opened_at?: string
}

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => scenarioVariants.id),
    attemptNo: integer('attempt_no').notNull().default(1),
    state: runState('state').notNull().default('assigned'),
    mode: runMode('mode').notNull().default('standard'),
    isWalkthrough: boolean('is_walkthrough').notNull().default(false),
    workingClockSeconds: integer('working_clock_seconds').notNull(),
    turnDelaySeconds: integer('turn_delay_seconds').notNull(),
    policyDisplayedAt: timestamp('policy_displayed_at', { withTimezone: true }),
    readinessStartedAt: timestamp('readiness_started_at', { withTimezone: true }),
    readinessExpiresAt: timestamp('readiness_expires_at', { withTimezone: true }),
    /** Set at frame lock; the working clock starts here (D-042). */
    workingStartedAt: timestamp('working_started_at', { withTimezone: true }),
    firstDelegationAt: timestamp('first_delegation_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    totalPausedMs: bigint('total_paused_ms', { mode: 'number' }).notNull().default(0),
    creditedMs: bigint('credited_ms', { mode: 'number' }).notNull().default(0),
    chargedMs: bigint('charged_ms', { mode: 'number' }).notNull().default(0),
    decisionLockedAt: timestamp('decision_locked_at', { withTimezone: true }),
    turnDueAt: timestamp('turn_due_at', { withTimezone: true }),
    turnDeliveredAt: timestamp('turn_delivered_at', { withTimezone: true }),
    turnWindowEndsAt: timestamp('turn_window_ends_at', { withTimezone: true }),
    turnLockedAt: timestamp('turn_locked_at', { withTimezone: true }),
    defenseOpenedAt: timestamp('defense_opened_at', { withTimezone: true }),
    defenseCompletedAt: timestamp('defense_completed_at', { withTimezone: true }),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    adjustedAt: timestamp('adjusted_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    /** D-120: the free-text note lives in the `run_voided` event payload, not here. */
    voidReason: voidReason('void_reason'),
    reOfferedFromRunId: uuid('re_offered_from_run_id').references((): AnyPgColumn => runs.id),
    reOfferedToRunId: uuid('re_offered_to_run_id').references((): AnyPgColumn => runs.id),
    scoringStatus: scoringStatus('scoring_status').notNull().default('idle'),
    confidenceAtFrame: integer('confidence_at_frame'),
    confidenceAtLock: integer('confidence_at_lock'),
    confidenceAfterTurn: integer('confidence_after_turn'),
    flags: jsonb('flags')
      .$type<RunFlags>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    accommodationApplied: boolean('accommodation_applied').notNull().default(false),
    /** Trace sequence allocator; incremented under `select … for update` on the run row. */
    nextEventSeq: integer('next_event_seq').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('runs_assignment_id_student_id_attempt_no_uidx').on(
      t.assignmentId,
      t.studentId,
      t.attemptNo,
    ),
    // My runs.
    index('runs_student_id_state_idx').on(t.studentId, t.state),
    // Instructor list.
    index('runs_assignment_id_idx').on(t.assignmentId),
    // Held-for-review queue.
    index('runs_state_scoring_status_idx')
      .on(t.state, t.scoringStatus)
      .where(sql`scoring_status = 'held'`),
    // Turn-delivery diagnostics.
    index('runs_turn_due_at_idx')
      .on(t.turnDueAt)
      .where(sql`state = 'decision_locked'`),
    check('runs_confidence_at_frame_check', sql`confidence_at_frame between 0 and 100`),
    check('runs_confidence_at_lock_check', sql`confidence_at_lock between 0 and 100`),
    check('runs_confidence_after_turn_check', sql`confidence_after_turn between 0 and 100`),
  ],
)

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_events — the trace (DATA-029)
// ---------------------------------------------------------------------------------------------

/** Payload shapes are per event type (10-backend-spec-modules.md §trace); the trace module narrows. */
export type RunEventPayload = Record<string, unknown>

export const runEvents = pgTable(
  'run_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    type: runEventType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Null outside the working period and the Turn window (D-042). */
    clockRemainingMs: integer('clock_remaining_ms'),
    /** Student or faculty seat that caused the event; null for system events. */
    actorId: text('actor_id').references(() => user.id),
    payload: jsonb('payload').$type<RunEventPayload>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('run_events_run_id_seq_uidx').on(t.runId, t.seq),
    // Graph builders filter by type.
    index('run_events_run_id_type_idx').on(t.runId, t.type),
  ],
)

export type RunEvent = typeof runEvents.$inferSelect
export type NewRunEvent = typeof runEvents.$inferInsert

// ---------------------------------------------------------------------------------------------
// Readiness (DATA-030)
// ---------------------------------------------------------------------------------------------

export type ReadinessConceptStatus = 'held' | 'not_held' | 'unknown'

export type ReadinessConceptResult = {
  concept_key: string
  status: ReadinessConceptStatus
  correct: number
  total: number
}

export const runReadinessResults = pgTable('run_readiness_results', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  skipped: boolean('skipped').notNull().default(false),
  concepts: jsonb('concepts').$type<ReadinessConceptResult[]>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export type RunReadinessResult = typeof runReadinessResults.$inferSelect
export type NewRunReadinessResult = typeof runReadinessResults.$inferInsert

export const runReadinessAnswers = pgTable(
  'run_readiness_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => readinessItems.id),
    answerKey: text('answer_key'),
    correct: boolean('correct'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('run_readiness_answers_run_id_item_id_uidx').on(t.runId, t.itemId)],
)

export type RunReadinessAnswer = typeof runReadinessAnswers.$inferSelect
export type NewRunReadinessAnswer = typeof runReadinessAnswers.$inferInsert

// ---------------------------------------------------------------------------------------------
// Document opens (DATA-031)
// ---------------------------------------------------------------------------------------------

export const runDocumentOpens = pgTable(
  'run_document_opens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => scenarioDocuments.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    beforeFirstDelegation: boolean('before_first_delegation').notNull(),
    inTurnWindow: boolean('in_turn_window').notNull().default(false),
    skim: boolean('skim'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('run_document_opens_run_id_opened_at_idx').on(t.runId, t.openedAt)],
)

export type RunDocumentOpen = typeof runDocumentOpens.$inferSelect
export type NewRunDocumentOpen = typeof runDocumentOpens.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_frames — the locked frame (DATA-032). Immutable: no updated_at; no UPDATE/DELETE grant (2.6).
// ---------------------------------------------------------------------------------------------

export const runFrames = pgTable(
  'run_frames',
  {
    runId: uuid('run_id')
      .primaryKey()
      .references(() => runs.id),
    decision: text('decision').notNull(),
    assumptions: text('assumptions').array().notNull(),
    position: text('position').notNull(),
    confidence: integer('confidence').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  () => [
    check('run_frames_assumptions_check', sql`array_length(assumptions, 1) = 3`),
    check('run_frames_confidence_check', sql`confidence between 0 and 100`),
  ],
)

export type RunFrame = typeof runFrames.$inferSelect
export type NewRunFrame = typeof runFrames.$inferInsert

// ---------------------------------------------------------------------------------------------
// Delegations (DATA-033)
// ---------------------------------------------------------------------------------------------

/** A number the assistant produced without a document source (10-backend-spec-modules.md §trace). */
export type UnverifiedNumber = { value: string; context: string }

export const runDelegations = pgTable(
  'run_delegations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    requestText: text('request_text').notNull(),
    /** Empty until the stream completes; a failed stream leaves it empty and sets `failed`. */
    responseText: text('response_text').notNull().default(''),
    failed: boolean('failed').notNull().default(false),
    why: text('why'),
    claimIds: uuid('claim_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    unverifiedNumbers: jsonb('unverified_numbers')
      .$type<UnverifiedNumber[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    inTurnWindow: boolean('in_turn_window').notNull().default(false),
    clockRemainingMs: integer('clock_remaining_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('run_delegations_run_id_seq_uidx').on(t.runId, t.seq)],
)

export type RunDelegation = typeof runDelegations.$inferSelect
export type NewRunDelegation = typeof runDelegations.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_claims — the stance matrix (DATA-034)
// ---------------------------------------------------------------------------------------------

export const runClaims = pgTable(
  'run_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    surfacedAt: timestamp('surfaced_at', { withTimezone: true }).notNull(),
    surfacedBy: surfacedBy('surfaced_by').notNull(),
    /** Delegation id or document id, by `surfaced_by`. */
    surfacedById: uuid('surfaced_by_id'),
    inTurnWindow: boolean('in_turn_window').notNull().default(false),
    stance: stance('stance'),
    previousStance: stance('previous_stance'),
    stanceSetAt: timestamp('stance_set_at', { withTimezone: true }),
    usedMarked: boolean('used_marked').notNull().default(false),
    /** Values: `log_mark`, `named_field`, `turn_window`. */
    reliedOnVia: text('relied_on_via')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reliedOn: boolean('relied_on')
      .notNull()
      .generatedAlwaysAs(sql`cardinality(relied_on_via) > 0`),
    inconsistencyCredited: boolean('inconsistency_credited').notNull().default(false),
    stanceRecordLost: boolean('stance_record_lost').notNull().default(false),
    // D-163: FK to claim_neutralizations is added by step 2.5 (scoring.ts), which creates that table.
    neutralizationId: uuid('neutralization_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('run_claims_run_id_claim_id_uidx').on(t.runId, t.claimId),
    // Lock gate: relied-on claims still without a stance.
    index('run_claims_run_id_stance_null_idx')
      .on(t.runId)
      .where(sql`stance is null`),
  ],
)

export type RunClaim = typeof runClaims.$inferSelect
export type NewRunClaim = typeof runClaims.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_actions — verification actions (DATA-035). Append-only.
// ---------------------------------------------------------------------------------------------

/** Per action type (10-backend-spec-modules.md §reliance); the reliance module narrows. */
export type RunActionResult = Record<string, unknown>

export const runActions = pgTable(
  'run_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    type: actionType('type').notNull(),
    clockCostMs: integer('clock_cost_ms').notNull(),
    result: jsonb('result').$type<RunActionResult>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    inTurnWindow: boolean('in_turn_window').notNull().default(false),
    clockRemainingMs: integer('clock_remaining_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('run_actions_run_id_claim_id_idx').on(t.runId, t.claimId)],
)

export type RunAction = typeof runActions.$inferSelect
export type NewRunAction = typeof runActions.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_escalations (DATA-036). Append-only.
// ---------------------------------------------------------------------------------------------

export const runEscalations = pgTable(
  'run_escalations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    statement: text('statement').notNull(),
    /** `claim` (the claim's scripted reply) or `general` (the version's general reply). */
    responseId: text('response_id').notNull(),
    responseText: text('response_text').notNull(),
    clockCostMs: integer('clock_cost_ms').notNull().default(300000),
    countsAgainstLimit: boolean('counts_against_limit').notNull(),
    inTurnWindow: boolean('in_turn_window').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // Escalation limit check.
    index('run_escalations_run_id_counts_idx')
      .on(t.runId)
      .where(sql`counts_against_limit`),
    check('run_escalations_response_id_check', sql`response_id in ('claim', 'general')`),
  ],
)

export type RunEscalation = typeof runEscalations.$inferSelect
export type NewRunEscalation = typeof runEscalations.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_briefs — the decision brief draft, immutable once locked (DATA-037; trigger run_briefs_locked)
// ---------------------------------------------------------------------------------------------

/** Named-field values keyed by `named_fields.key` (BriefSchema: `z.record(fieldKey, number)`). */
export type BriefNamedValues = Record<string, number>

export const runBriefs = pgTable(
  'run_briefs',
  {
    runId: uuid('run_id')
      .primaryKey()
      .references(() => runs.id),
    recommendation: text('recommendation').notNull().default(''),
    rationale: text('rationale').notNull().default(''),
    assumptions: text('assumptions')
      .array()
      .notNull()
      .default(sql`'{"","",""}'::text[]`),
    changeMyMind: text('change_my_mind').notNull().default(''),
    confidence: integer('confidence'),
    namedValues: jsonb('named_values')
      .$type<BriefNamedValues>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    draftUpdatedAt: timestamp('draft_updated_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    autoLocked: boolean('auto_locked').notNull().default(false),
    speedOutlier: boolean('speed_outlier').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('run_briefs_confidence_check', sql`confidence between 0 and 100`)],
)

export type RunBrief = typeof runBriefs.$inferSelect
export type NewRunBrief = typeof runBriefs.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_addenda — the one post-lock addendum (DATA-037). Immutable: no updated_at, no UPDATE grant.
// ---------------------------------------------------------------------------------------------

export const runAddenda = pgTable('run_addenda', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  /** ≤ 50 words (enforced in Zod). */
  text: text('text').notNull(),
  createdAt: createdAt(),
})

export type RunAddendum = typeof runAddenda.$inferSelect
export type NewRunAddendum = typeof runAddenda.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_turn_responses (DATA-038). Immutable: no updated_at, no UPDATE/DELETE grant.
// ---------------------------------------------------------------------------------------------

export const runTurnResponses = pgTable(
  'run_turn_responses',
  {
    runId: uuid('run_id')
      .primaryKey()
      .references(() => runs.id),
    response: turnResponse('response').notNull(),
    justification: text('justification'),
    confidence: integer('confidence'),
    /** True when the window closed without an explicit response (recorded as `hold`). */
    implicit: boolean('implicit').notNull().default(false),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  () => [check('run_turn_responses_confidence_check', sql`confidence between 0 and 100`)],
)

export type RunTurnResponse = typeof runTurnResponses.$inferSelect
export type NewRunTurnResponse = typeof runTurnResponses.$inferInsert

// ---------------------------------------------------------------------------------------------
// Defense (DATA-039)
// ---------------------------------------------------------------------------------------------

export const runDefenseQuestions = pgTable(
  'run_defense_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => defenseQuestions.id),
    seq: integer('seq').notNull(),
    renderedText: text('rendered_text').notNull(),
    followUpOf: uuid('follow_up_of').references((): AnyPgColumn => runDefenseQuestions.id),
    /** The trace event whose payload the question was rendered from, when it was selected by one. */
    selectingEventSeq: integer('selecting_event_seq'),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('run_defense_questions_run_id_seq_uidx').on(t.runId, t.seq)],
)

export type RunDefenseQuestion = typeof runDefenseQuestions.$inferSelect
export type NewRunDefenseQuestion = typeof runDefenseQuestions.$inferInsert

export const runDefenseAnswers = pgTable(
  'run_defense_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    runDefenseQuestionId: uuid('run_defense_question_id')
      .notNull()
      .references(() => runDefenseQuestions.id),
    text: text('text').notNull(),
    durationMs: integer('duration_ms').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('run_defense_answers_run_defense_question_id_uidx').on(t.runDefenseQuestionId),
  ],
)

export type RunDefenseAnswer = typeof runDefenseAnswers.$inferSelect
export type NewRunDefenseAnswer = typeof runDefenseAnswers.$inferInsert

// ---------------------------------------------------------------------------------------------
// run_pauses — system-caused pauses that credit the clock (DATA-040). Append-only.
// ---------------------------------------------------------------------------------------------

export const runPauses = pgTable(
  'run_pauses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    cause: pauseCause('cause').notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }).notNull(),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    creditedMs: integer('credited_ms').notNull().default(0),
    /** The delegation whose failure caused the pause, when there was one (no FK per 06 §3.4). */
    relatedDelegationId: uuid('related_delegation_id'),
    createdAt: createdAt(),
  },
  (t) => [index('run_pauses_run_id_idx').on(t.runId)],
)

export type RunPause = typeof runPauses.$inferSelect
export type NewRunPause = typeof runPauses.$inferInsert
