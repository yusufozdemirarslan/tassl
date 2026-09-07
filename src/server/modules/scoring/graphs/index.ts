// The four graph builders (docs/tech/10-backend-spec-modules.md §11.1; PRD §7.13; FR-132 to
// FR-136, FR-212, D-034, D-074).
//
// `buildGraphs` is step two of the scoring pipeline — trace, **graphs**, bands, mapping, points —
// and it is the only step that is pure all the way down. Give it a run's events, the authored
// package version, and the variant's claim states, and it answers the four payloads that go into
// `run_scores.graphs` and out through the export (DATA-042, FR-240). It touches no database, reads
// no clock, and cannot fail: a run that did not write the events a graph is drawn from produces
// that graph with `available: false` and the event types it looked for, which is what makes the
// dimensions reading from it *unassessed* rather than wrong (FR-136, 10 §11.3).
//
// Everything in this folder is a **reviewer** artifact. The payloads legitimately carry warranted
// stances, evidence status and the authored disruptions, because that is what plotting a run
// against the authored standard means — and it is why no student payload carries a graph before
// the run is scored (`src/server/auth/student-view.ts`, `trace/owner-view.ts`), and why nothing
// here is reachable from a student route.
export {
  buildConfidenceLine,
  type ConfidenceLineGraph,
  type ConfidencePoint,
  type ConfidencePointAt,
} from './confidence-line'
export {
  buildClockTimeline,
  formatSpan,
  type ClockTimelineGraph,
  type TimelineMark,
  type TimelineMarkKind,
  type TimelineSegment,
  type TimelineSegmentType,
  type TimelineTrack,
} from './clock-timeline'
export {
  buildStanceMatrix,
  falseChallengeRate,
  type FalseChallengeRate,
  type PrecedingAction,
  type ReadinessContext,
  type StanceMatrixGraph,
  type StanceMatrixRow,
  type SurfacedByValue,
} from './stance-matrix'
export {
  buildFrameBesideDecision,
  contentTokens,
  matchDisruptions,
  type FiledRecordPayload,
  type FrameBesideDecisionGraph,
  type FramedRecordPayload,
  type TurnRecordPayload,
} from './frame-beside-decision'
export {
  GRAPH_KEYS,
  STANCES,
  type ClaimImportanceValue,
  type EvidenceStatusValue,
  type GraphClaim,
  type GraphDataTable,
  type GraphDocument,
  type GraphEvent,
  type GraphInput,
  type GraphKey,
  type GraphNamedField,
  type GraphPackageVersion,
  type GraphTurnSpec,
  type GraphVariantClaimState,
  type StanceValue,
  type TurnResponseValue,
  type ValueUnitValue,
} from './types'

import { buildClockTimeline, type ClockTimelineGraph } from './clock-timeline'
import { buildConfidenceLine, type ConfidenceLineGraph } from './confidence-line'
import { buildFrameBesideDecision, type FrameBesideDecisionGraph } from './frame-beside-decision'
import { buildStanceMatrix, type StanceMatrixGraph } from './stance-matrix'
import type { GraphInput } from './types'

/** The four payloads, keyed exactly as `run_scores.graphs` stores them (DATA-042). */
export type RunGraphs = {
  confidence_line: ConfidenceLineGraph
  clock_timeline: ClockTimelineGraph
  stance_matrix: StanceMatrixGraph
  frame_beside_decision: FrameBesideDecisionGraph
}

/** Plots a run. Pure, total, and the only thing the four graphs are ever built by. */
export function buildGraphs(input: GraphInput): RunGraphs {
  return {
    confidence_line: buildConfidenceLine(input),
    clock_timeline: buildClockTimeline(input),
    stance_matrix: buildStanceMatrix(input),
    frame_beside_decision: buildFrameBesideDecision(input),
  }
}

/** The graph keys whose payload could not be built — the input to `graph_unavailable` (FR-136). */
export function unavailableGraphKeys(graphs: RunGraphs): string[] {
  return Object.entries(graphs)
    .filter(([, payload]) => !payload.available)
    .map(([key]) => key)
}
