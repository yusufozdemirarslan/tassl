// The four graph builders' shared input and output vocabulary (docs/tech/10-backend-spec-modules.md
// §11.1; PRD §7.13; FR-132 to FR-136, FR-212).
//
// **The graphs are plotted from the trace and nothing else.** That is the product claim (FR-212,
// PRD §7.13: "Four graphs are plotted per run, from the run trace and nothing else"), and it is why
// every builder in this folder is a pure function of `(events, packageVersion, variantStates,
// flaggedDelegationIds)` with no database handle in sight. What a builder may read is exactly four
// things:
//
//   1. `events` — the run's own `run_events` rows, in sequence order, with their payloads as they
//      were written. Nothing about the run's *current* row state (`run_claims.stance`,
//      `runs.confidence_lock`) is admissible: those are read models built from the same events, and
//      a graph that read them could disagree with the export beside it.
//   2. `packageVersion` — the authored standard the run is read against: the consequential claims,
//      the documents, the named fields, the Turn.
//   3. `variantStates` — the per-variant evidence status, warranted stance and planted flag of each
//      claim (DATA-021). These are the answer key, which is why the whole of this folder is a
//      **reviewer** artifact: no student payload carries a graph before the run is scored
//      (`src/server/auth/student-view.ts`, `trace/owner-view.ts`).
//   4. `flaggedDelegationIds` — the exchanges a reviewer marked out of scenario (FR-055, D-481).
//      This is the one input that is *not* the run's own record, and it is here because FR-055 asks
//      for exactly that: "offensive or out-of-scenario content is flagged in one action and excluded
//      from scoring", which 01 §FR-055 spells out as "excluded from the clock timeline's scored
//      segments and from Delegation reads". It is a subtraction and never an addition — the widest
//      thing it can do to a graph is turn a delegation segment into unattributed time.
//
// The shapes are stated structurally rather than imported from Drizzle: a module-internal file may
// not import `src/server/db` (04 §2), and a pure function of a dozen authored fields has no
// business asking for a whole row. A `ScenarioClaim` row satisfies `GraphClaim`, a
// `VariantClaimState` satisfies `GraphVariantClaimState`, and a `TraceEventView`'s stored twin
// satisfies `GraphEvent`.
//
// Payload keys stay snake_case throughout, because a graph payload is stored in
// `run_scores.graphs` and read back by the export (FR-240): it is a record, not a view built for a
// screen. The component props that draw it restate the same shape in the same spelling (D-348's
// rule for `FrameBesideDecision`, applied to all four).
import type { RunEventTypeValue, StoredEventPayload } from '@/server/modules/trace/schema'

// ---------------------------------------------------------------------------------------------
// Enumerations (06-data-model.md §3.2, restated)
// ---------------------------------------------------------------------------------------------

export type StanceValue = 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate'

/** The order every 5×5 summary, legend and table column uses (06 §3.2 declares the enum this way). */
export const STANCES: readonly StanceValue[] = [
  'accept',
  'verify',
  'challenge',
  'reject',
  'escalate',
]

export type EvidenceStatusValue = 'sound' | 'defective'
export type ClaimImportanceValue = 'load_bearing' | 'supporting'
export type ConsequenceLevelValue = 'low' | 'medium' | 'high'
export type ClaimSourceValue = 'assistant' | 'document'
export type ActionTypeValue =
  'source_trace' | 'replication_check' | 'decomposition_check' | 'stakeholder_interview'
export type TurnResponseValue = 'hold' | 'revise' | 'reverse'
export type ValueUnitValue = 'percent' | 'ratio' | 'months' | 'usd' | 'count' | 'other'

/** The four graph keys of 10 §11.1, in the order the debrief draws them (UI-028). */
export const GRAPH_KEYS = [
  'confidence_line',
  'clock_timeline',
  'stance_matrix',
  'frame_beside_decision',
] as const
export type GraphKey = (typeof GRAPH_KEYS)[number]

// ---------------------------------------------------------------------------------------------
// The input
// ---------------------------------------------------------------------------------------------

/**
 * One trace event as a builder reads it.
 *
 * `payload` is the jsonb column as it was stored. `trace.append` parses every payload against
 * `EVENT_PAYLOAD_SCHEMAS` before the insert, so a stored payload always matches its type's schema;
 * `payloadOf` below narrows on that guarantee rather than re-parsing every event on every read.
 * `tests/unit/scoring/graphs/fixtures.test.ts` parses all thirteen fixtures through the same
 * registry, so the fixtures this folder is tested against are traces the database would accept.
 */
export type GraphEvent = {
  seq: number
  type: RunEventTypeValue
  /** ISO-8601 with a timezone, as `run_events.occurred_at` reads back. */
  occurredAt: string
  /** Null outside the working period and the Turn window (D-042). */
  clockRemainingMs: number | null
  payload: Record<string, unknown>
}

/** An event narrowed to one type, with its payload typed. */
export type TypedEvent<T extends RunEventTypeValue> = Omit<GraphEvent, 'type' | 'payload'> & {
  type: T
  payload: StoredEventPayload<T>
}

/** One authored consequential claim (`scenario_claims`, DATA-019). */
export type GraphClaim = {
  id: string
  key: string
  text: string
  sourceKind: ClaimSourceValue
  /** The document a `document` claim is read from; what makes opening that document surface it. */
  sourceDocumentId: string | null
  importance: ClaimImportanceValue
  consequenceLevel: ConsequenceLevelValue
  /** The Readiness Check concept the claim turns on (FR-012, carried beside the row as context). */
  conceptKey: string
  weaklySourced: boolean
  position: number
}

/** One claim's authored state in the variant the run drew (`variant_claim_states`, DATA-021). */
export type GraphVariantClaimState = {
  claimId: string
  evidenceStatus: EvidenceStatusValue
  failureFamily: string | null
  warrantedStance: StanceValue
  planted: boolean
}

/** One Evidence Room document, named so a reading segment reads back as a title (DATA-017). */
export type GraphDocument = { id: string; key: string; title: string }

/** One named field of the brief (DATA-018). */
export type GraphNamedField = { key: string; label: string; unit: ValueUnitValue }

/** The authored Turn (DATA-023). `disruptedAssumptionKeys` is D-079's matching input. */
export type GraphTurnSpec = {
  text: string
  warrantsChange: boolean
  proportionateResponse: TurnResponseValue
  disruptedAssumptionKeys: readonly string[]
}

/** The authored standard, as much of it as the four graphs read. */
export type GraphPackageVersion = {
  workingClockSeconds: number
  claims: readonly GraphClaim[]
  documents: readonly GraphDocument[]
  namedFields: readonly GraphNamedField[]
  turn: GraphTurnSpec | null
}

/** What every builder takes. Pure in, pure out. */
export type GraphInput = {
  events: readonly GraphEvent[]
  packageVersion: GraphPackageVersion
  variantStates: readonly GraphVariantClaimState[]
  /**
   * `run_delegations.id` for every exchange a reviewer marked `out_of_scenario` (FR-055, D-481).
   *
   * The mark lives on the row and not on the `delegation` event, because the event was written when
   * the exchange happened and the trace is append-only (D-272 draws the same line for the why line).
   * So the ids are read alongside the package version and the variant states, and every consumer
   * filters on this set rather than on `payload.flags` — which carries the *guard's* marks
   * (`rebuilt`, `filtered`, `no_commentary`, `probe`) and never a reviewer's.
   */
  flaggedDelegationIds: readonly string[]
}

/** The flagged ids as a set, for the filters that ask "was this exchange marked?" (FR-055). */
export const flaggedDelegations = (input: GraphInput): ReadonlySet<string> =>
  new Set(input.flaggedDelegationIds)

// ---------------------------------------------------------------------------------------------
// The output envelope
// ---------------------------------------------------------------------------------------------

/**
 * The table under every graph (FR-136, FR-212). `null` in a cell is rendered as the i18n string
 * "not available" by `GraphFrame`, never as an empty cell — a blank says nothing about whether the
 * run had no value or the graph could not compute one.
 */
export type GraphDataTable = {
  caption: string
  columns: readonly string[]
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>
}

/**
 * What every graph carries whether or not it could be built.
 *
 * An unavailable graph is not an error and never throws: it is a run that did not produce the
 * events the graph is drawn from, and the dimensions that read from it are reported *unassessed*
 * with `graph_unavailable` (FR-136, 10 §11.3). So the payload still carries its description and its
 * table — with the rows that exist, possibly none — and names the event types it went looking for
 * and did not find.
 */
export type GraphBase = {
  available: boolean
  missing_event_types: RunEventTypeValue[]
  data_table: GraphDataTable
  description: string
}

// ---------------------------------------------------------------------------------------------
// Reading the trace
// ---------------------------------------------------------------------------------------------

/**
 * Every event of one type, in sequence order, with its payload narrowed.
 *
 * The narrowing is an assertion rather than a parse, and the assertion is `trace.append`'s: it
 * refuses a payload that does not match its type's schema before the insert, so `run_events` cannot
 * hold one that does. Re-parsing here would buy nothing at run time and would make a builder able
 * to *fail*, which is the one thing 10 §11.1 says a graph must not do — an input it cannot read is
 * an unavailable graph, not an exception.
 */
export function eventsOfType<T extends RunEventTypeValue>(
  events: readonly GraphEvent[],
  type: T,
): TypedEvent<T>[] {
  return events.filter((event): event is TypedEvent<T> => event.type === type)
}

/** The first event of a type, or null. Most of the run's spine is a single event of its kind. */
export function firstOfType<T extends RunEventTypeValue>(
  events: readonly GraphEvent[],
  type: T,
): TypedEvent<T> | null {
  return eventsOfType(events, type)[0] ?? null
}

/** The last event of a type, or null. */
export function lastOfType<T extends RunEventTypeValue>(
  events: readonly GraphEvent[],
  type: T,
): TypedEvent<T> | null {
  const all = eventsOfType(events, type)
  return all[all.length - 1] ?? null
}

/**
 * The event types a graph needs and the run did not write.
 *
 * Ordered by the `required` list rather than by the trace, so two runs missing the same events
 * produce the same `missing_event_types` and the same description.
 */
export function missingEventTypes(
  events: readonly GraphEvent[],
  required: readonly RunEventTypeValue[],
): RunEventTypeValue[] {
  const present = new Set(events.map((event) => event.type))
  return required.filter((type) => !present.has(type))
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

/**
 * Three decimals, the precision every rate and share in this module is reported at.
 *
 * D-091 rounds points to three decimals and `run_scores` stores rates as `numeric(5,4)`; three
 * decimals is inside that column and is what reproduces the PRD's own arithmetic exactly — Marco's
 * eight false alarms over eleven claims is `0.727`, which prints as the 73 percent PRD §6 states.
 * A rate carried at full float precision would make that assertion an approximation.
 */
export function rate3(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 1000
}

/** A share of 1 as a whole-number percentage, for the description templates. */
export function percent(share: number): number {
  return Math.round(share * 100)
}

/** Milliseconds between two ISO instants; negative spans are clamped to zero. */
export function msBetween(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from))
}
