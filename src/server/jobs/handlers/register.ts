// Handler registration: importing this module once registers every job handler that exists, so the
// drain route and the local worker never poll a queue whose handler simply was not imported
// (10-backend-spec.md §7). Later phases add one import line each: score_run (scoring),
// generate_package_step (authoring), purge_deleted_accounts (identity), recompute_exports (courses).
import '@/server/jobs/handlers/send-email'

/** Imported for its side effect; call it (or import the module) before draining or polling. */
export function registerAllHandlers(): void {
  // The imports above did the work; this function exists so a caller cannot tree-shake them away.
}
