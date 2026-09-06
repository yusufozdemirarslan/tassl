// Public interface of the `trace` module (docs/tech/10-backend-spec-modules.md §10).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, or ./errors.
//
// Every run mutation in this codebase reaches the trace through `append` — one function, taking the
// transaction and the locked run row, so that "every run mutation appends a trace event in the same
// transaction" (CLAUDE.md) is a signature rather than a habit.
//
// `buildExport` and `TraceExportSchema` (FR-240 to FR-243) are the module's other half and land
// with Phase 10; the payload schemas they read are already here.
// `requireOwnerReadAccess` is the second function other modules take from here, and for the same
// kind of reason as `append`. What a run's own student may read of their room in a given state is
// one rule with one table behind it (`owner-view.ts`, D-233); the Delegation Log and the claim
// table are that room read two other ways, so they ask this rather than keeping a state list each
// (D-279).
// `readEvents` is the third, and the same shape of seam as `append`: the run's trace as written,
// for a pipeline inside the server rather than for a reader. The defense's question selection is a
// pure function of the run's own events (10 §9) and Phase 10's scoring builds the graphs from the
// same list; both turn events into something else and guard *that* where they build it. Every
// reader's rule stays on `listEvents`.
export { append, buildExport, listEvents, readEvents, requireOwnerReadAccess } from './service'

export type { AppendOptions, TraceClock, TraceRecordEvent, TraceRun } from './service'

// The exported document and its two forms (FR-240 to FR-243). The `records` module builds both —
// the course file it versions on confirmation, and the record copy a student downloads — and the
// schemas travel with them so a route can declare what it answers with. They come through
// `./service` rather than from `./export-schema` directly for the reason `runs/index.ts` states
// about `TURN_WINDOW_MS`: the service is the one internal file this index may reach (the
// `boundaries` policy), and a public interface assembled from two doors is two doors.
export {
  CourseTraceExportSchema,
  RecordTraceExportSchema,
  TRACE_EXPORT_VERSION,
  TraceExportSchema,
  X_TASSL_EXTENSIONS,
  traceExportSchema,
} from './service'

export type {
  CourseTraceExport,
  RecordTraceExport,
  TraceExport,
  TraceExportClaimRow,
  TraceExportForm,
} from './service'

export {
  EVENT_PAYLOAD_SCHEMAS,
  RUN_EVENT_TYPES,
  RunEventTypeSchema,
  TraceEventViewSchema,
} from './schema'

export type { EventPayload, RunEventTypeValue, StoredEventPayload, TraceEventView } from './schema'
