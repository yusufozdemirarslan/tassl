// What the run's *owner* may read of their own trace (docs/tech/12-security.md §8; D-117; FR-007,
// FR-012, FR-053, FR-055, FR-106, FR-114, FR-123; 10-backend-spec-modules.md §10).
//
// A reviewer reads the trace as it was written — it is the record. An owner is a student sitting
// the exercise the trace is a recording of, so their read is answered by two tables here, and by
// nothing else:
//
//   `TRACE_OWNER_ACCESS`   — one row per run state, saying whether the owner may read at all, and
//                            whether the run has been scored yet.
//   `OWNER_FIELD_VISIBILITY` — one row per event type, classifying *every* field of its payload.
//
// Both are total, and that is the point of the file. 12 §8 asks that a student projection be built
// by picking allowed fields, never by deleting forbidden ones, because deleting ships the next
// field the shape grows — the person who added it never had to name it. The earlier version of this
// projection deleted from a list of seven withheld names, and had no notion of "scored" at all, so
// the state-dependent half of D-117 ("never before the run is scored") could not be expressed here
// even in principle. These two tables are the fix:
//
//   * `OwnerFieldVisibility` is `Record<keyof StoredEventPayload<T>, FieldVisibility>` per type, so
//     a field added to a payload schema is a **compile error** until somebody classifies it, and
//     `ownerPayload` copies only what the table names — an unclassified field cannot reach a
//     student even if the compiler were somehow satisfied.
//   * `TRACE_OWNER_ACCESS` is `Record<RunStateValue, OwnerAccess>`, so a run state added later is a
//     compile error too, and `ownerAccessFor` answers `sealed` for anything it does not recognise.
//     Default-deny in both directions.
//
// Two collisions with `src/server/auth/student-view.ts` are deliberate and must stay. Those
// name-based key sets are *not* applied to this view: `readiness_item.answer_key` is the key the
// student themselves chose (not the item's key, which never enters a payload),
// `readiness_item.concept_key` is the concept map FR-012 hands them at submit (not a claim's
// authored concept key), and `decision_locked.rationale` is the student's own brief (not the
// authored per-claim rationale of 12 §8.2). Same words, opposite side of the invariant — which is
// exactly why this file classifies field-by-field within a known payload instead of matching names
// across every payload in the codebase.
import type { RunEventTypeValue, RunStateValue, StoredEventPayload } from './schema'

// ---------------------------------------------------------------------------------------------
// Access by run state (10 §9; PRD §7.14; UI-026)
// ---------------------------------------------------------------------------------------------

/**
 * What the owner may read of their trace, given the run's state.
 *
 *   `open`   — the room is on the screen in front of them, so the trace tells them nothing the
 *              workspace does not. Fields marked `owner` only.
 *   `sealed` — the trace is closed to them. Nothing at all.
 *   `scored` — the run has been scored, so D-117's "never before the run is scored" has been
 *              satisfied and the assessment fields open. Fields marked `owner` or `after_scored`.
 */
export type OwnerAccess = 'open' | 'sealed' | 'scored'

/**
 * One row per run state (10 §9). The three groups, and why each is what it is:
 *
 *   **open** — `assigned` through `turn_open`. The student is in the run: the Evidence Room, the
 *   Delegation Log, the claim table and their own frame and brief are all on the screen, and the
 *   Turn window still admits interrogation actions and escalations (D-132). Their trace is a
 *   second view of a room they are standing in.
 *
 *   **sealed** — `turn_locked`, `defense_pending`, `defense_complete`. This is the defense, and the
 *   defense is defined by what a student can say with nothing in front of them but their own frame,
 *   brief, addendum and Turn response (PRD §7.9; UI-026 "no assistant, no room"). The trace holds
 *   every delegation with its request and response text, every action result, every document open
 *   and every stance: handing it over in a second tab would give back exactly the room the screen
 *   takes away, and would make FR-120's "unaided" mean nothing. It stays sealed until scoring.
 *
 *   Also sealed: `voided` and the four future-state states (10 §9). A run that will never be
 *   scored never earns the `scored` reveal, and a voided run is re-offered (FR-183), so its trace
 *   is a live exam's room until the replacement run is finished.
 *
 *   **scored** — `scored`, `confirmed`, `recorded`. The bands are drafted, the debrief exists, and
 *   D-117's state-dependent half is satisfied.
 */
const TRACE_OWNER_ACCESS: Record<RunStateValue, OwnerAccess> = {
  assigned: 'open',
  readiness: 'open',
  framing: 'open',
  working: 'open',
  paused: 'open',
  decision_locked: 'open',
  turn_open: 'open',
  turn_locked: 'sealed',
  defense_pending: 'sealed',
  defense_complete: 'sealed',
  scored: 'scored',
  confirmed: 'scored',
  recorded: 'scored',
  voided: 'sealed',
  abandoned: 'sealed',
  defense_missed: 'sealed',
  under_appeal: 'sealed',
  expired: 'sealed',
}

/**
 * The owner's access for a run state, defaulting to `sealed`.
 *
 * The table above is exhaustive over the enum, so the fallback is unreachable through the type
 * system; it exists because the argument arrives from a database column, and a state written by a
 * migration this build has not seen must close the trace rather than open it.
 */
export function ownerAccessFor(state: string): OwnerAccess {
  return TRACE_OWNER_ACCESS[state as RunStateValue] ?? 'sealed'
}

// ---------------------------------------------------------------------------------------------
// Field visibility by event type (12 §8.1, §8.2)
// ---------------------------------------------------------------------------------------------

/**
 * When the owner may read one payload field.
 *
 *   `owner`         — whenever they may read the trace at all.
 *   `after_scored`  — only once the run has reached `scored` (12 §8.2, D-117).
 *   `reviewer_only` — never, in any state (12 §8.1), or because the field carries a stored trace
 *                     sequence number, which the owner's densely renumbered view must not expose
 *                     (see `service.ts`, FR-053).
 */
export type FieldVisibility = 'owner' | 'after_scored' | 'reviewer_only'

/** Every field of one event type's payload, classified. `Record` makes "every" the compiler's job. */
type PayloadFieldPolicy<T extends RunEventTypeValue> = Record<
  keyof StoredEventPayload<T> & string,
  FieldVisibility
>

type OwnerFieldVisibility = { [T in RunEventTypeValue]: PayloadFieldPolicy<T> }

/**
 * The classification, one entry per event type of 10 §10, in the order that table declares them.
 *
 * The `reviewer_only` and `after_scored` entries carry the requirement that put them there. The
 * `owner` entries are the default and are not annotated one by one: a field is `owner` when the
 * student already met it on a screen — their own answers, their own frame and brief, the
 * assistant's replies, the results of actions they paid for, the Turn as it was delivered.
 */
const OWNER_FIELD_VISIBILITY: OwnerFieldVisibility = {
  // FR-201: the four things the run start screen showed them, recorded as shown. `weight` and
  // `mapping` are student-facing (the debrief shows both, FR-170); it is the *record export form*
  // that omits them, which is `STUDENT_FORBIDDEN_KEYS_RECORD_FORM` and not this table.
  policy_displayed: {
    outside_ai_policy: 'owner',
    weight: 'owner',
    mapping: 'owner',
    run_type: 'owner',
    counts_statement: 'owner',
  },

  lifecycle: { from: 'owner', to: 'owner', cause: 'owner' },

  readiness_item: {
    item_id: 'owner',
    item_key: 'owner',
    category: 'owner',
    // The concept the item teaches. FR-012 hands the student exactly this map at submit, as
    // `{ conceptKey, status }`; it is the claim's authored `concept_key` that 12 §8.2 withholds.
    concept_key: 'owner',
    // The key the *student* chose, not the key that was right.
    answer_key: 'owner',
    // FR-012: correctness is computed server-side and the readiness result gives them the concept
    // map instead. The debrief's readiness context (FR-015) is where per-item correctness lands.
    correct: 'after_scored',
  },

  readiness_skipped: { reason: 'owner', unanswered_count: 'owner' },

  document_open: {
    open_id: 'owner',
    document_id: 'owner',
    document_key: 'owner',
    before_first_delegation: 'owner',
    in_turn_window: 'owner',
  },

  document_close: {
    open_id: 'owner',
    document_id: 'owner',
    duration_ms: 'owner',
    before_first_delegation: 'owner',
    // D-082: a derived reading of *how* they read, and an input to the Verification band. Telling a
    // student mid-run that Tassl scored a read as a skim is in-run feedback on their assessment.
    skim: 'after_scored',
    in_turn_window: 'owner',
  },

  frame_locked: {
    decision: 'owner',
    assumptions: 'owner',
    position: 'owner',
    confidence: 'owner',
  },

  delegation: {
    delegation_id: 'owner',
    // The delegation's own ordinal in the Delegation Log (FR-060), not a trace sequence number.
    seq: 'owner',
    request_text: 'owner',
    response_text: 'owner',
    claim_ids: 'owner',
    why: 'owner',
    in_turn_window: 'owner',
    // FR-055, 12 §8.1: a reviewer's flags on the delegation are an instructor observation.
    flags: 'reviewer_only',
    // The numbers the assistant asserted without a source. Handing a student the list mid-run is
    // the assistant revealing defect status by another route (FR-056); the debrief is where the
    // unverified numbers are named (FR-151).
    unverified_numbers: 'after_scored',
    failed: 'owner',
  },

  claim_used: {
    claim_id: 'owner',
    via: 'owner',
    field_key: 'owner',
    delegation_id: 'owner',
  },

  stance_set: {
    claim_id: 'owner',
    stance: 'owner',
    previous_stance: 'owner',
    action_ids: 'owner',
    in_turn_window: 'owner',
  },

  action: {
    action_id: 'owner',
    type: 'owner',
    claim_id: 'owner',
    clock_cost_ms: 'owner',
    // 12 §8.2 withholds the result of an action the student did *not* run. This event exists only
    // for one they ran and were shown the moment they paid for it (FR-151).
    result: 'owner',
    in_turn_window: 'owner',
  },

  escalation: {
    escalation_id: 'owner',
    claim_id: 'owner',
    statement: 'owner',
    // D-116, 12 §8.2: which authored reply answered, and whether it counted against the limit,
    // appear in the clock timeline after scoring and never before.
    response_id: 'after_scored',
    response_text: 'owner',
    clock_cost_ms: 'owner',
    counts_against_limit: 'after_scored',
    in_turn_window: 'owner',
  },

  outside_tool_declared: { purpose: 'owner' },

  pause: { pause_id: 'owner', cause: 'owner', related_delegation_id: 'owner' },

  resume: { pause_id: 'owner', paused_ms: 'owner', clock_credited_ms: 'owner' },

  lock_refused: {
    reason: 'owner',
    claim_id: 'owner',
    claim_text: 'owner',
    field: 'owner',
  },

  decision_locked: {
    recommendation: 'owner',
    // The student's own brief rationale, not a claim's authored one (12 §8.2).
    rationale: 'owner',
    assumptions: 'owner',
    change_my_mind: 'owner',
    named_values: 'owner',
    confidence: 'owner',
    auto: 'owner',
    // FR-106, 12 §8.1: an instructor observation about the run.
    speed_outlier: 'reviewer_only',
    relied_on_claim_ids: 'owner',
    unstanced_relied_on_claim_ids: 'owner',
    elapsed_ms: 'owner',
  },

  brief_opened: {},

  brief_closed: { duration_ms: 'owner' },

  addendum: { text: 'owner' },

  turn_delivered: {
    turn_id: 'owner',
    text: 'owner',
    voice: 'owner',
    window_ends_at: 'owner',
    // FR-114, 12 §8.1: which claims the Turn lands on is what the response is measured against.
    // The Turn view renders the claims themselves; the authored id list is the instrument.
    window_claim_ids: 'reviewer_only',
  },

  turn_response_locked: {
    response: 'owner',
    justification: 'owner',
    confidence: 'owner',
    implicit: 'owner',
  },

  defense_question: {
    run_question_id: 'owner',
    // FR-123, 12 §8.1: the id of the bank question behind the rendered one.
    question_id: 'reviewer_only',
    kind: 'owner',
    // The question's ordinal in the interview, which the defense screen shows.
    seq: 'owner',
    rendered_text: 'owner',
    follow_up_of: 'owner',
    // FR-123, 12 §8.1, and a stored trace sequence number besides.
    selecting_event_seq: 'reviewer_only',
  },

  defense_answer: { run_question_id: 'owner', text: 'owner', duration_ms: 'owner' },

  // Written by the scoring job, so these rows cannot exist before `scored`; classifying them
  // `after_scored` says so in the one place a reader will look.
  draft_band: {
    dimension: 'after_scored',
    band: 'after_scored',
    status: 'after_scored',
    reason: 'after_scored',
    basis: 'after_scored',
    provisional: 'after_scored',
    graph_keys: 'after_scored',
    // Stored trace sequence numbers: the owner's view is renumbered densely so a hidden event
    // leaves no hole (FR-053), and these would carry the real numbering straight past it.
    evidence_event_seqs: 'reviewer_only',
    // Each quote is `{ event_seq, text }`. The debrief is where a student reads the quotes behind a
    // band (FR-151); it projects them without the sequence, and this endpoint does not project.
    quotes: 'reviewer_only',
    rationale: 'after_scored',
  },

  band_decision: {
    dimension: 'after_scored',
    decision: 'after_scored',
    band: 'after_scored',
    // The instructor's free-text note on the decision.
    note: 'reviewer_only',
  },

  claim_neutralized: {
    neutralization_id: 'after_scored',
    claim_id: 'after_scored',
    reason: 'after_scored',
    credit_challenge: 'after_scored',
    // The instructor's free-text note on the correction; the debrief carries the correction itself.
    note: 'reviewer_only',
    recompute: 'after_scored',
  },

  run_voided: {
    reason: 'owner',
    // D-120, 12 §8.1: the free-text note on a void. FR-183 tells the student the run was voided and
    // offers another; this sentence is not part of that.
    note: 'reviewer_only',
    re_offered_run_id: 'owner',
  },

  run_reoffered: {
    from_run_id: 'owner',
    // Which authored variant the replacement run draws on. `variant_key` is `defective` or `sound`
    // (06 §3.2), so an id a student could carry between attempts is defect status by another name.
    variant_id: 'reviewer_only',
  },

  debrief_opened: { version: 'owner' },

  debrief_answer: { stance_to_change: 'owner', do_differently: 'owner' },

  // FR-053, D-088: the whole type is hidden from the owner by `OWNER_HIDDEN_TYPES` in `service.ts`.
  // Classifying the fields as well is the belt to that buckle — if the type filter were ever
  // removed, the probe's scripted reversal still could not reach the student through this pick.
  probe_fired: { claim_id: 'reviewer_only', scripted_reversal: 'reviewer_only' },
}

/**
 * The same table, widened for a lookup by an event type that arrives as a database column value.
 * The precise type above is what the compiler checks the entries against; this is what reads them.
 */
const FIELD_POLICY = OWNER_FIELD_VISIBILITY as Record<
  string,
  Record<string, FieldVisibility> | undefined
>

/** The classification of one event type's fields, or nothing for a type this build cannot name. */
export function fieldPolicyFor(type: string): Record<string, FieldVisibility> | undefined {
  return FIELD_POLICY[type]
}

/**
 * The owner's copy of one payload: the fields `FIELD_POLICY` allows at this access, and nothing
 * else. A pick, not a deletion (12 §8) — a field present in the stored jsonb but absent from the
 * table is dropped, so a payload written by a newer build cannot leak through an older projection.
 *
 * An event type with no row at all yields `{}` for the same reason: the envelope still says the
 * event happened, which the owner may know, and the body says nothing nobody classified.
 */
export function ownerPayload(
  type: string,
  payload: Record<string, unknown>,
  access: Exclude<OwnerAccess, 'sealed'>,
): Record<string, unknown> {
  const policy = fieldPolicyFor(type)
  if (!policy) return {}
  const picked: Record<string, unknown> = {}
  for (const [key, visibility] of Object.entries(policy)) {
    if (visibility === 'reviewer_only') continue
    if (visibility === 'after_scored' && access !== 'scored') continue
    if (Object.hasOwn(payload, key)) picked[key] = payload[key]
  }
  return picked
}
