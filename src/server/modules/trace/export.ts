// Assembling the exported trace (docs/prd/Tassl-PRD.md §12; docs/tech/10-backend-spec-modules.md
// §10; FR-240 to FR-243, FR-170).
//
// A pure function of the run's record: `buildTraceExport(input, form)` takes rows somebody else
// loaded and returns the document `export-schema.ts` describes. It reads no database and applies no
// permission rule — `service.buildExport` does both, and the graph builders of 10 §11.1 have the
// same shape for the same reason: what a file says about a run is worth testing without one.
//
// Two rules run through the whole file.
//
//   1. **Nothing is inferred** (PRD §12): every field is an act the student took, a value they
//      typed, a decision the faculty seat made, an authored attribute of the package, or a figure
//      the scoring job computed and stored. The header's policy is read back from the
//      `policy_displayed` event rather than recomputed from the course, and the transitions are the
//      `lifecycle` events — not a reconstruction from timestamp columns.
//   2. **Pick, never delete** (12-security.md §8). The record form's payloads are picked field by
//      field through `owner-view.ts`, and its `policy_displayed` payload is picked again by name.
//      A field added to a payload schema later is either classified in that table — a compile
//      error until it is — or it is absent from the student's copy, which is the safe direction.
import { ownerPayload } from './owner-view'
import {
  TRACE_EXPORT_VERSION,
  X_TASSL_EXTENSIONS,
  type TraceExport,
  type TraceExportForm,
} from './export-schema'
import type { RunEventTypeValue, StoredEventPayload } from './schema'

// ---------------------------------------------------------------------------------------------
// What the builder is given
// ---------------------------------------------------------------------------------------------

/** The run row's own facts, as the header names them (FR-240). */
export type ExportRunFacts = {
  runId: string
  packageId: string
  packageVersion: number
  variantKey: 'defective' | 'sound'
  mode: 'guided' | 'standard' | 'open'
  isWalkthrough: boolean
  workingClockSeconds: number
  confidenceAtFrame: number | null
  confidenceAtLock: number | null
  confidenceAfterTurn: number | null
}

/** One event as `run_events` holds it. The payload is the open jsonb; the builder narrows by type. */
export type ExportEvent = {
  seq: number
  type: RunEventTypeValue
  occurredAt: Date
  clockRemainingMs: number | null
  payload: Record<string, unknown>
}

/** One row of the package confirmation record (FR-192, PRD §12 step 1). */
export type ExportConfirmation = {
  elementType: string
  elementId: string | null
  decision: string
  decidedByRole: string | null
  decidedAt: Date
}

/** One concept of the Readiness Check result (FR-012). */
export type ExportReadinessConcept = { conceptKey: string; status: string }

/** One consequential claim of the variant, joined to what the run did with it. */
export type ExportClaim = {
  claimId: string
  key: string
  conceptKey: string
  evidenceStatus: string
  failureFamily: string | null
  importance: string
  consequenceLevel: string
  warrantedStance: string
  stanceTaken: string | null
  stanceTakenAt: Date | null
  previousStance: string | null
  actions: string[]
  reliedOn: boolean
  reliedOnVia: string[]
  neutralized: boolean
  inconsistencyCredited: boolean
}

/**
 * The figures the scoring pipeline computed, or nulls before it has run.
 *
 * `falseChallengeRate` is the one field of this document that is neither an act nor an authored
 * attribute: FR-134's rate over all consequential claims in the run. **Step 10.2's
 * `scoring/graphs/stance-matrix.ts` computes it**, Step 10.4's `scoreRun` writes it to
 * `run_scores.false_challenge_rate`, and `service.buildExport` reads it back from that column — so
 * a run exported before it is scored carries `null` here rather than a number nobody computed.
 * That column is the seam; nothing in this module recomputes the arithmetic.
 */
export type ExportScore = {
  falseChallengeRate: number | null
  /** Confirmed points only; 10 §11.4 keeps `points_draft` out of every export. */
  points: number | null
  rubricVersion: string | null
}

export type TraceExportInput = {
  run: ExportRunFacts
  events: ExportEvent[]
  confirmations: ExportConfirmation[]
  readiness: ExportReadinessConcept[]
  claims: ExportClaim[]
  score: ExportScore
  exportedAt: Date
}

// ---------------------------------------------------------------------------------------------
// Reading the record back
// ---------------------------------------------------------------------------------------------

const iso = (at: Date): string => at.toISOString()

/** The payload of the first event of `type`, or nothing when the run never reached it. */
function firstPayload<T extends RunEventTypeValue>(
  events: readonly ExportEvent[],
  type: T,
): Partial<StoredEventPayload<T>> | undefined {
  const event = events.find((candidate) => candidate.type === type)
  return event?.payload as Partial<StoredEventPayload<T>> | undefined
}

/**
 * The policy as the run start screen displayed it (FR-201), from the event that recorded the
 * display. A run exported before the student acknowledged the policy has no such event, and the
 * three fields are null rather than filled in from a course row that may have moved since (FR-203).
 */
function policyOf(events: readonly ExportEvent[], form: TraceExportForm) {
  const shown = firstPayload(events, 'policy_displayed')
  const outsideAiPolicy = shown?.outside_ai_policy ?? null
  // A pick, by name, not a delete: this is the student's copy and FR-170 is the whole rule.
  if (form === 'record') return { outside_ai_policy: outsideAiPolicy }
  return {
    outside_ai_policy: outsideAiPolicy,
    weight: shown?.weight ?? null,
    mapping: shown?.mapping ?? null,
  }
}

/**
 * Every lifecycle transition with its instant (PRD §12 header, §8 lifecycle table).
 *
 * The list is the `lifecycle` events and nothing else. `assigned` is the state a run is created in
 * rather than a transition it made, so it is not invented here: the run's first row is the move the
 * policy acknowledgement caused, and the `policy_displayed` event beside it carries that instant.
 */
function transitionsOf(events: readonly ExportEvent[]) {
  return events
    .filter((event) => event.type === 'lifecycle')
    .map((event) => ({
      state: (event.payload as StoredEventPayload<'lifecycle'>).to,
      at: iso(event.occurredAt),
    }))
}

/**
 * One event's payload in the form asked for.
 *
 * The course form is the payload as written — a reviewer's copy is the record. The record form is
 * the owner's projection at the `scored` tier (`owner-view.ts`), which is this codebase's one
 * compiler-total statement of which payload fields a student may read, and then a second pick on
 * `policy_displayed` for the two keys FR-170 keeps out of the record (D-370).
 *
 * **Where this and `service.listEvents` deliberately differ, and why** (D-428). That endpoint drops
 * `probe_fired` entirely and renumbers what is left densely, so a hole in the sequence cannot tell a
 * student where the Sycophancy Probe fired (FR-053, D-088). This file drops the probe's *payload* —
 * both fields are `reviewer_only`, so the record carries an empty body — and keeps the envelope,
 * with the trace's own `seq`. Three reasons, and none of them applies to the endpoint:
 *
 *   1. The endpoint answers from `assigned` onward, including while the probe has not fired yet and
 *      while the run is live. A record exists only from `confirmed` (`records.exportRecord`), by
 *      which point 10 §13 has shown that same student the probe transcript in their own debrief.
 *      There is nothing left for the envelope to give away.
 *   2. The record is the student's copy of a file the course also holds, and FR-243 makes the two
 *      forms differ by the course's arithmetic and by 12 §8.1's fields and by nothing else. Dropping
 *      an event would make the student's file a different list of events from the instructor's.
 *   3. Dropping one would force this file to renumber, and then `seq 14` in the student's record and
 *      `seq 14` in the course's would name two different events — of a document whose whole use is
 *      being read beside the run it records (FR-240).
 */
function payloadFor(event: ExportEvent, form: TraceExportForm): Record<string, unknown> {
  if (form === 'course') return event.payload
  const owned = ownerPayload(event.type, event.payload, 'scored')
  if (event.type !== 'policy_displayed') return owned
  return {
    outside_ai_policy: owned.outside_ai_policy,
    run_type: owned.run_type,
    counts_statement: owned.counts_statement,
  }
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

/**
 * The run's trace as one file, in the form asked for.
 *
 * The return type is the union of the two forms because the form is a runtime argument; a caller
 * that knows which it asked for narrows with `traceExportSchema(form)`, which is what
 * `service.buildExport` does before it hands the document over.
 */
export function buildTraceExport(input: TraceExportInput, form: TraceExportForm): TraceExport {
  const { run, events, confirmations, readiness, claims, score, exportedAt } = input
  const readinessOf = new Map(readiness.map((concept) => [concept.conceptKey, concept.status]))

  const document = {
    header: {
      run_id: run.runId,
      package_id: run.packageId,
      package_version: run.packageVersion,
      variant_key: run.variantKey,
      mode: run.mode,
      package_confirmation_record: confirmations.map((entry) => ({
        element_type: entry.elementType,
        element_id: entry.elementId,
        decision: entry.decision,
        decided_by_role: entry.decidedByRole,
        decided_at: iso(entry.decidedAt),
      })),
      policy: policyOf(events, form),
      working_clock_seconds: run.workingClockSeconds,
      // PRD §12 "Demo-grade and uncalibrated": the clock is a hypothesis until the pilot, and the
      // file says so wherever it is read rather than leaving the reader to remember.
      working_clock_uncalibrated: true,
      readiness: readiness.map((concept) => ({
        concept_key: concept.conceptKey,
        status: concept.status,
      })),
      transitions: transitionsOf(events),
      is_walkthrough: run.isWalkthrough,
      x_tassl_extensions: [...X_TASSL_EXTENSIONS],
    },
    events: events.map((event) => ({
      seq: event.seq,
      type: event.type,
      occurred_at: iso(event.occurredAt),
      clock_remaining_ms: event.clockRemainingMs,
      payload: payloadFor(event, form),
    })),
    claims: claims.map((claim) => ({
      claim_id: claim.claimId,
      // The claim is frozen with its version, so the row can be read against the scenario it came
      // from even after a later version has changed the wording.
      claim_version: run.packageVersion,
      key: claim.key,
      evidence_status: claim.evidenceStatus,
      failure_family: claim.failureFamily,
      importance: claim.importance,
      consequence_level: claim.consequenceLevel,
      warranted_stance: claim.warrantedStance,
      stance_taken: claim.stanceTaken,
      stance_taken_at: claim.stanceTakenAt ? iso(claim.stanceTakenAt) : null,
      previous_stance: claim.previousStance,
      actions: claim.actions,
      relied_on: claim.reliedOn,
      relied_on_via: claim.reliedOnVia,
      neutralized: claim.neutralized,
      inconsistency_credited: claim.inconsistencyCredited,
      readiness_context: {
        concept_key: claim.conceptKey,
        // A concept the check never reached is `unknown`, which is one of FR-012's three answers.
        status: readinessOf.get(claim.conceptKey) ?? 'unknown',
      },
    })),
    computed: {
      confidence: {
        frame: run.confidenceAtFrame,
        lock: run.confidenceAtLock,
        turn: run.confidenceAfterTurn,
      },
      false_challenge_rate: score.falseChallengeRate,
      ...(form === 'course' ? { points: score.points } : {}),
      rubric_version: score.rubricVersion,
      exported_at: iso(exportedAt),
      export_version: TRACE_EXPORT_VERSION,
    },
  }

  return document as TraceExport
}
