// The run state machine (docs/tech/10-backend-spec.md §9; PRD §8; FR-231, D-133).
//
// `TRANSITIONS` is the table of 10 §9, one row per legal move, and it is the whole of the rule:
// nothing anywhere else decides whether a run may go from one state to another. A pair that is not
// in the table is `ILLEGAL_TRANSITION` (409), which is what makes a double-submitted form or a
// second tab harmless — the first request moves the run, the second is refused by the table rather
// than by a check somebody remembered to write.
//
// Void is the one rule the table does not spell out row by row: 10 §9's last row reads "any except
// voided → voided", and writing seventeen rows for it would invite the eighteenth state to be
// forgotten. `canTransition` applies it as a rule, and the unit test walks every state to prove it.
//
// `transition()` is pure: it answers what to write and refuses what may not be written, and the
// service commits both halves in the transaction that made the change. It cannot do the writing
// itself — a module-internal file may not reach the repository or another module's index (04 §2) —
// and that turns out to be the better shape anyway: the whole table is testable without a database,
// and a caller cannot stamp a column without also writing the lifecycle event that explains it.
import { illegalTransition } from './errors'

/** `runs.state` (06 §3.4). Restated here; the table below is this file's reason to exist. */
export const RUN_STATES = [
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
  // Future-state (10 §9): reachable by no transition in this build.
  'abandoned',
  'defense_missed',
  'under_appeal',
  'expired',
] as const

export type RunStateValue = (typeof RUN_STATES)[number]

/**
 * The `*_at` columns a transition stamps. Named as a closed union rather than `keyof Run` so this
 * file stays free of the database schema and a typo cannot become a silently ignored patch key.
 */
export type StampColumn =
  | 'readinessStartedAt'
  | 'workingStartedAt'
  | 'pausedAt'
  | 'decisionLockedAt'
  | 'turnDeliveredAt'
  | 'turnLockedAt'
  | 'defenseCompletedAt'
  | 'scoredAt'
  | 'confirmedAt'
  | 'recordedAt'
  | 'voidedAt'

/**
 * What moved the run, recorded in the `lifecycle` payload's `cause` (10 §10). A closed union, not
 * free text: `cause` is read by the replay and by the export, and two spellings of "the clock ran
 * out" would be two facts to whoever reads them.
 */
export const TRANSITION_CAUSES = [
  'policy_acknowledged',
  'readiness_submitted',
  'readiness_skipped',
  'frame_locked',
  'component_failure',
  'resumed',
  'decision_locked',
  'clock_expired',
  'turn_due',
  'turn_response_locked',
  'turn_window_expired',
  'automatic',
  'defense_completed',
  'scored',
  'bands_confirmed',
  'debrief_answered',
  'voided',
] as const

export type TransitionCause = (typeof TRANSITION_CAUSES)[number]

/** One row of 10 §9. */
export type TransitionRow = {
  readonly from: RunStateValue
  readonly to: RunStateValue
  /** The `*_at` column this move stamps with the transition instant, if any. */
  readonly stamp?: StampColumn
  /** The column this move clears; only ever `paused_at`, on the way out of `paused`. */
  readonly clear?: StampColumn
  /** 10 §9's "Irreversible" column: whether what the run just did can be undone. */
  readonly irreversible: boolean
  /** The trigger 10 §9 names, in prose, for whoever reads the table next. */
  readonly trigger: string
}

/**
 * The transition table of 10 §9, in its order.
 *
 * Two readings the table itself does not make explicit:
 *
 *   * The stamp belongs to the *pair*, not to the target state. `framing → working` starts the
 *     working clock and so stamps `working_started_at`; `paused → working` is a resume and must not,
 *     or every component failure would hand the student a fresh clock.
 *   * `framing`, `turn_locked → defense_pending` and the two resumes stamp nothing, because no
 *     column of `runs` names them. `defense_opened_at` is stamped when the student opens the
 *     defense, not when it becomes pending, and `turn_window_ends_at` is set by the timer that
 *     delivers the Turn (10 §8), which knows the window length.
 *
 * 10 §9's "confirmed, recorded → (same, `adjusted_at` set)" row is not here: a neutralization
 * recompute sets a column without changing the state, so it is not a transition and does not write
 * a `lifecycle` event.
 */
export const TRANSITIONS: readonly TransitionRow[] = [
  // Irreversible "until submit": the Readiness Check can still be re-answered item by item until
  // it is submitted, but the run never returns to `assigned` — the policy display was shown.
  {
    from: 'assigned',
    to: 'readiness',
    stamp: 'readinessStartedAt',
    irreversible: false,
    trigger: 'acknowledgePolicy (policy display acknowledged)',
  },
  { from: 'readiness', to: 'framing', irreversible: true, trigger: 'submit or skip' },
  {
    from: 'framing',
    to: 'working',
    stamp: 'workingStartedAt',
    irreversible: true,
    trigger: 'lockFrame',
  },
  {
    from: 'working',
    to: 'paused',
    stamp: 'pausedAt',
    irreversible: false,
    trigger: 'component failure',
  },
  { from: 'paused', to: 'working', clear: 'pausedAt', irreversible: false, trigger: 'resume' },
  {
    from: 'turn_open',
    to: 'paused',
    stamp: 'pausedAt',
    irreversible: false,
    trigger: 'component failure in the Turn window (D-133)',
  },
  {
    from: 'paused',
    to: 'turn_open',
    clear: 'pausedAt',
    irreversible: false,
    trigger: 'resume; turn_window_ends_at extended by the paused time',
  },
  {
    from: 'working',
    to: 'decision_locked',
    stamp: 'decisionLockedAt',
    irreversible: true,
    trigger: 'lockDecision or clock expiry',
  },
  {
    from: 'decision_locked',
    to: 'turn_open',
    stamp: 'turnDeliveredAt',
    irreversible: true,
    trigger: 'turn_due_at reached',
  },
  {
    from: 'turn_open',
    to: 'turn_locked',
    stamp: 'turnLockedAt',
    irreversible: true,
    trigger: 'response or window expiry',
  },
  { from: 'turn_locked', to: 'defense_pending', irreversible: true, trigger: 'automatic' },
  {
    from: 'defense_pending',
    to: 'defense_complete',
    stamp: 'defenseCompletedAt',
    irreversible: true,
    trigger: 'completeDefense',
  },
  {
    from: 'defense_complete',
    to: 'scored',
    stamp: 'scoredAt',
    irreversible: true,
    trigger: 'scoreRun',
  },
  {
    from: 'scored',
    to: 'confirmed',
    stamp: 'confirmedAt',
    irreversible: true,
    trigger: 'last band decision',
  },
  {
    from: 'confirmed',
    to: 'recorded',
    stamp: 'recordedAt',
    irreversible: true,
    trigger: 'debrief answered',
  },
]

/** The void row of 10 §9, kept as a rule so a new state cannot be left out of it. */
const VOID_ROW = {
  to: 'voided' as const,
  stamp: 'voidedAt' as const,
  irreversible: true,
  trigger: 'voidRun',
}

const BY_PAIR = new Map(TRANSITIONS.map((row) => [`${row.from}->${row.to}`, row]))

/** The row for a pair, including the void rule; `undefined` when the pair is not listed. */
export function findTransition(from: RunStateValue, to: RunStateValue): TransitionRow | undefined {
  if (to === 'voided') return from === 'voided' ? undefined : { from, ...VOID_ROW }
  return BY_PAIR.get(`${from}->${to}`)
}

/** Whether 10 §9 lists the pair. Every state but `voided` may be voided. */
export function canTransition(from: RunStateValue, to: RunStateValue): boolean {
  return findTransition(from, to) !== undefined
}

/** The states a run in `from` can reach, in table order, with `voided` last where it applies. */
export function nextStates(from: RunStateValue): RunStateValue[] {
  const listed = TRANSITIONS.filter((row) => row.from === from).map((row) => row.to)
  return from === 'voided' ? listed : [...listed, 'voided']
}

/** The column patch a transition writes: the new state plus its stamp and its clear. */
export type TransitionPatch = { state: RunStateValue } & Partial<Record<StampColumn, Date | null>>

/** What `transition()` answers: the patch to write and the `lifecycle` payload to append. */
export type Transition = {
  readonly row: TransitionRow
  readonly patch: TransitionPatch
  readonly payload: { from: RunStateValue; to: RunStateValue; cause: TransitionCause }
}

/**
 * Moves a run from its current state to `to`, or refuses.
 *
 * The run is given structurally — the state is all this needs — and nothing is written here: the
 * caller applies `patch` through `runs.repository.updateRun` and appends `payload` as a `lifecycle`
 * event through `trace.append`, in the transaction that holds the run row's lock. The two belong
 * together (CLAUDE.md: every run mutation appends its event in the same transaction), which is why
 * they arrive together from one call.
 *
 * `at` is the instant the stamp records. It is normally now; a materialized timer passes the expiry
 * instant it computed, so a run that expired while the browser was closed is stamped when it
 * expired rather than when somebody next looked (NFR-002).
 */
export function transition(
  run: { state: RunStateValue },
  to: RunStateValue,
  event: { cause: TransitionCause; at?: Date },
): Transition {
  const from = run.state
  const row = findTransition(from, to)
  if (!row) illegalTransition(from, to)

  const at = event.at ?? new Date()
  const patch: TransitionPatch = { state: to }
  if (row.stamp) patch[row.stamp] = at
  if (row.clear) patch[row.clear] = null

  return { row, patch, payload: { from, to, cause: event.cause } }
}
