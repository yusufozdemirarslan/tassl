// The numbers a run is bounded by (docs/tech/10-backend-spec.md §10; FR-010, FR-070, FR-071,
// FR-090, FR-115). Every one of them is a pilot parameter: the PRD sets them from a pilot that has
// not run yet, and PRD §7.19 says a working clock is uncalibrated until it has. So they live in one
// file, each with the requirement it comes from and the reason it is the number it is, and nothing
// else in the codebase writes any of them as a literal.
//
// `PILOT_PARAMETERS` is the annotated form — `pilotParameter: true` on every entry — and the named
// exports below it are the values, so arithmetic elsewhere reads `now + READINESS_MS` rather than
// `now + PILOT_PARAMETERS.READINESS_MS.value`. Retuning one is a one-line edit here; nothing but
// this file needs to change, and a future institution-level override reads the same registry.

/** One tunable number, with where it comes from and why it is what it is. */
export type PilotParameter = {
  readonly value: number
  /** Always true: this file holds nothing that is not a pilot parameter. */
  readonly pilotParameter: true
  readonly unit: 'ms' | 'count'
  /** The requirement or decision that sets it. */
  readonly source: string
  readonly why: string
}

const pilot = (
  value: number,
  unit: PilotParameter['unit'],
  source: string,
  why: string,
): PilotParameter => ({ value, pilotParameter: true, unit, source, why })

const PARAMETERS = {
  READINESS_MS: pilot(
    480_000,
    'ms',
    'FR-010, NFR-002',
    'Eight minutes for sixteen items — thirty seconds each — long enough to read a stem and short ' +
      'enough that the check stays a warm-up rather than a test. Expiry auto-submits; it never blocks.',
  ),
  TURN_WINDOW_MS: pilot(
    720_000,
    'ms',
    'FR-115',
    'Twelve minutes to hold, revise or reverse after the Turn lands. The window is its own clock: ' +
      'the working clock ended at the Decision Lock.',
  ),
  ESCALATIONS_PER_RUN: pilot(
    2,
    'count',
    'FR-090',
    'Two escalations per run. Enough that escalation is a real move, few enough that it cannot ' +
      'become the whole strategy.',
  ),
  ESCALATION_COST_MS: pilot(
    300_000,
    'ms',
    'FR-090',
    'Five minutes. Escalation is the most expensive move because it asks the assistant to defend ' +
      'itself rather than to check something.',
  ),
  SOURCE_TRACE_MS: pilot(
    60_000,
    'ms',
    'FR-070',
    'One minute to be shown where a claim came from: the cheapest check there is, so that tracing ' +
      'a load-bearing claim is never the expensive option.',
  ),
  REPLICATION_CHECK_MS: pilot(
    180_000,
    'ms',
    'FR-070',
    'Three minutes to recompute a figure from the documents.',
  ),
  DECOMPOSITION_CHECK_MS: pilot(
    240_000,
    'ms',
    'FR-070',
    'Four minutes to take a claim apart into its steps; offered only where the author wrote one.',
  ),
  STAKEHOLDER_INTERVIEW_MS: pilot(
    240_000,
    'ms',
    'FR-032',
    'Four minutes. Future-state (PRD §12): the action type exists in `run_actions.type` and the ' +
      'cost is recorded here, but no build screen offers it.',
  ),
} as const satisfies Record<string, PilotParameter>

export type PilotParameterName = keyof typeof PARAMETERS

/** Every tunable number of a run, annotated. Read it; do not compute from it. */
export const PILOT_PARAMETERS: Readonly<Record<PilotParameterName, PilotParameter>> = PARAMETERS

// ---------------------------------------------------------------------------------------------
// The values
// ---------------------------------------------------------------------------------------------

/** How long the Readiness Check stays open from `readiness_started_at` (FR-010). */
export const READINESS_MS = PARAMETERS.READINESS_MS.value

/** How long the Turn window stays open from delivery (FR-115). */
export const TURN_WINDOW_MS = PARAMETERS.TURN_WINDOW_MS.value

/** How many escalations count against the limit in one run (FR-090). */
export const ESCALATIONS_PER_RUN = PARAMETERS.ESCALATIONS_PER_RUN.value

/** What one escalation costs the clock, charged when it starts (FR-090, D-132). */
export const ESCALATION_COST_MS = PARAMETERS.ESCALATION_COST_MS.value

/**
 * `run_actions.type` (06 §3.4). Restated here rather than imported: this file is the module's
 * arithmetic and must not depend on the database schema or on another module's vocabulary.
 */
export type ActionTypeValue =
  'source_trace' | 'replication_check' | 'decomposition_check' | 'stakeholder_interview'

/**
 * What each interrogation action costs the clock (FR-070, FR-071). The cost is charged when the
 * action starts, and an action that started with time left completes even if the cost outruns the
 * clock (FR-072) — see `chargeCost` in `./clock.ts`.
 */
export const ACTION_COSTS: Readonly<Record<ActionTypeValue, number>> = {
  source_trace: PARAMETERS.SOURCE_TRACE_MS.value,
  replication_check: PARAMETERS.REPLICATION_CHECK_MS.value,
  decomposition_check: PARAMETERS.DECOMPOSITION_CHECK_MS.value,
  stakeholder_interview: PARAMETERS.STAKEHOLDER_INTERVIEW_MS.value,
}
