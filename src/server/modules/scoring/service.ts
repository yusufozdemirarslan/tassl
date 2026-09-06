// Module `scoring` (docs/tech/10-backend-spec-modules.md §11) — service.
//
// Step 10.2 lands the graph step of the pipeline and nothing else. The rest of §11 — the
// categorical facts, the five band reads, the draft bands, points, the held path and the
// neutralization recompute — arrives in Steps 10.3 and 10.4 and is added to this file.
//
// What is here is a door rather than logic. The four builders under `graphs/` are pure functions
// and are the whole of the implementation; a `src/app` reader may reach a module only through its
// public `index.ts`, and an `index.ts` may re-export only from `service.ts` and `schema.ts`
// (04 §2, enforced by eslint-plugin-boundaries). The component gallery renders all four graphs on
// the Marco fixture (UI-060), so the builders need that door now.
export {
  buildClockTimeline,
  buildConfidenceLine,
  buildFrameBesideDecision,
  buildGraphs,
  buildStanceMatrix,
  falseChallengeRate,
  formatSpan,
  matchDisruptions,
  unavailableGraphKeys,
  GRAPH_KEYS,
  STANCES,
  type ClockTimelineGraph,
  type ConfidenceLineGraph,
  type ConfidencePoint,
  type ConfidencePointAt,
  type FalseChallengeRate,
  type FiledRecordPayload,
  type FrameBesideDecisionGraph,
  type FramedRecordPayload,
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
  type PrecedingAction,
  type ReadinessContext,
  type RunGraphs,
  type StanceMatrixGraph,
  type StanceMatrixRow,
  type StanceValue,
  type TimelineMark,
  type TimelineMarkKind,
  type TimelineSegment,
  type TimelineSegmentType,
  type TimelineTrack,
  type TurnRecordPayload,
  type TurnResponseValue,
} from './graphs'
