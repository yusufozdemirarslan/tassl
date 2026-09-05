// Public interface of the `runs` module (docs/tech/10-backend-spec-modules.md §6).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, or ./errors.
//
// One exception is documented at its call site: `courses.listAssignmentRuns` reaches `./summary`
// and `./schema` directly, because this module's service imports the courses one for the assignment
// behind a run and the index would close that into a cycle (the same reading as the trace module's
// import of `./clock`, 10 §10). Both files it reaches are pure and import nothing outside `src/lib`.
// `materializeTimers` is deliberately absent. 10 §6 lists it among this module's service functions,
// but it is a mutation — filled in, its branches transition runs and append trace events — and it
// is reached by a run id and a tenant id rather than by an actor, so exporting it would put a
// writing entry point outside the permission helpers every other mutation here starts with (08 §5).
// It stays internal, behind the reads and mutations below, each of which names its actor first
// (D-230).
export {
  acknowledgePolicy,
  findMyRunOnAssignment,
  getRun,
  getRunStatus,
  listMyRuns,
  startRun,
  toRunSummary,
} from './service'

export type {
  Clock,
  PageQuery,
  RunReviewSummary,
  RunRowForSummary,
  RunStateValue,
  RunStatus,
  RunSummary,
  RunsQuery,
  VariantKeyValue,
} from './schema'
