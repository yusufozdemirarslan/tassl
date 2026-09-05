// `RunSummary` — one run row as every run endpoint reports it (docs/tech/07-api-spec.md §7, §10).
//
// It is its own file, and a pure one, for two reasons. It is read by both modules that list runs:
// the runs service answers the student's own poll, and `courses.listAssignmentRuns` answers the
// reviewer's table on UI-032, so a second implementation of the clock or of the next-route map
// would be a second answer to the same question. And going through this module's public index for
// it would make `courses` and `runs` a cycle — the runs service already imports the courses one for
// the assignment behind a run — which is the same reading, and the same resolution, as the trace
// module's import of `./clock` (10 §10).
//
// Nothing here reads or writes anything: give it a row and it answers. `materializeTimers` in
// `./service.ts` is what acts on a clock that has run out; this only reports it.
import { remainingMs } from './clock'
import type { RunRowForSummary, RunStateValue, RunSummary } from './schema'

/** What the run's owner does next, per state (09-frontend-spec-screens.md UI-020 to UI-029). */
const NEXT_ROUTE: Record<RunStateValue, (runId: string) => string> = {
  assigned: (id) => `/runs/${id}/start`,
  readiness: (id) => `/runs/${id}/readiness`,
  framing: (id) => `/runs/${id}/work`,
  working: (id) => `/runs/${id}/work`,
  paused: (id) => `/runs/${id}/work`,
  decision_locked: (id) => `/runs/${id}/locked`,
  turn_open: (id) => `/runs/${id}/turn`,
  turn_locked: (id) => `/runs/${id}/defense`,
  defense_pending: (id) => `/runs/${id}/defense`,
  defense_complete: (id) => `/runs/${id}`,
  scored: (id) => `/runs/${id}/debrief`,
  confirmed: (id) => `/runs/${id}/debrief`,
  recorded: (id) => `/records/${id}`,
  // A voided run has no next step of its own; the re-offer, when there is one, is its own run.
  voided: () => '/runs',
  // Future-state states (10 §9): the status screen is the only honest answer.
  abandoned: (id) => `/runs/${id}`,
  defense_missed: (id) => `/runs/${id}`,
  under_appeal: (id) => `/runs/${id}`,
  expired: (id) => `/runs/${id}`,
}

const iso = (value: Date): string => value.toISOString()
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value))

/**
 * The run as a reader receives it.
 *
 * The clock is computed here rather than stored (D-042), and floored at zero: the arithmetic goes
 * negative once a run has overrun, the trace keeps that true number, and a countdown has nothing to
 * say about minus four seconds.
 *
 * The row's variant is deliberately not read: this is the shape the run's own student receives, and
 * which variant they drew is the one thing about the scenario they may not know before scoring
 * (see `RunSummarySchema` in ./schema.ts). A reviewer's list adds it on top, from the row it
 * already joined.
 */
export function toRunSummary(run: RunRowForSummary): RunSummary {
  const remaining = remainingMs(run)
  return {
    id: run.id,
    assignmentId: run.assignmentId,
    attemptNo: run.attemptNo,
    state: run.state,
    mode: run.mode,
    isWalkthrough: run.isWalkthrough,
    clock:
      remaining === null
        ? null
        : {
            remainingMs: Math.max(0, remaining),
            paused: run.state === 'paused',
            creditedMs: run.creditedMs,
            chargedMs: run.chargedMs,
          },
    turn: run.turnDueAt
      ? { dueAt: iso(run.turnDueAt), windowEndsAt: isoOrNull(run.turnWindowEndsAt) }
      : null,
    scoringStatus: run.scoringStatus,
    timestamps: {
      policyDisplayedAt: isoOrNull(run.policyDisplayedAt),
      workingStartedAt: isoOrNull(run.workingStartedAt),
      decisionLockedAt: isoOrNull(run.decisionLockedAt),
      turnDeliveredAt: isoOrNull(run.turnDeliveredAt),
      turnLockedAt: isoOrNull(run.turnLockedAt),
      defenseCompletedAt: isoOrNull(run.defenseCompletedAt),
      scoredAt: isoOrNull(run.scoredAt),
      confirmedAt: isoOrNull(run.confirmedAt),
      recordedAt: isoOrNull(run.recordedAt),
      voidedAt: isoOrNull(run.voidedAt),
    },
    // D-123: the number of events written. `next_event_seq` is the allocator, so the last sequence
    // handed out — and therefore the count — is one less.
    version: Math.max(0, run.nextEventSeq - 1),
    links: { next: NEXT_ROUTE[run.state](run.id) },
  }
}
