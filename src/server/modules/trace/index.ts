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
export { append, listEvents } from './service'

export type { AppendOptions, TraceClock, TraceRun } from './service'

export {
  EVENT_PAYLOAD_SCHEMAS,
  RUN_EVENT_TYPES,
  RunEventTypeSchema,
  TraceEventViewSchema,
} from './schema'

export type { EventPayload, RunEventTypeValue, StoredEventPayload, TraceEventView } from './schema'
