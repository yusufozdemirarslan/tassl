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
// `advanceRunClock` and `assertTestEnvironment` are absent for the same reason: they exist only
// under `APP_ENV=test` (D-109), and the module's public interface is what the product is made of.
// The one caller is the route, which reaches the router as every endpoint does.
// Seven of the exports below take a transaction and a locked run row rather than an actor, and they
// are the seam another module's mutation reaches this one through (`trace.append` and
// `reliance.surfaceClaims` have the same shape and the same reason). `lockRunForMutation` hands over
// the row with every fired timer already applied, so no module applies its rules to a stale run;
// `noteFirstDelegation` stamps the column FR-022's `before_first_delegation` flag is read from;
// `markDefenseOpened` and `markDefenseComplete` write the two `runs` columns the defense moves
// (`defense_opened_at`, and the transition with `scoring_status` and `flags.nothing_answered`),
// because the state machine and `runs.flags` are this module's; `markScored` is the other end of
// the same seam, the `defense_complete → scored` move the scoring job makes once it has written the
// bands (10 §11); and `pauseRun` is FR-001's standing rule, which belongs to the module that owns
// the clock rather than to each module that can fail.
// `resumeRun` is the student's own act and takes an actor like every other mutation here.
export {
  acknowledgePolicy,
  addAddendum,
  answerReadinessItem,
  briefSignal,
  closeDocument,
  consumeForcedAssistantFailure,
  findMyRunOnAssignment,
  forceAssistantFailure,
  getDecision,
  getReadiness,
  getReadinessResult,
  getRun,
  getRunStatus,
  getRunWorkspace,
  getTurn,
  listMyRuns,
  listMyRunsForAssignments,
  lockDecision,
  lockFrame,
  lockRunForMutation,
  markAdjusted,
  markConfirmed,
  markDefenseComplete,
  markDefenseOpened,
  markRecorded,
  markReplayOpened,
  markScored,
  noteFirstDelegation,
  openDocument,
  pauseRun,
  respondToTurn,
  resumeRun,
  saveBriefDraft,
  skipReadiness,
  startRun,
  submitReadiness,
  toRunSummary,
  voidRun,
} from './service'

export type { PauseOptions, PausingRun } from './service'

// The Turn window's length, so a screen that names it in prose and a screen that counts it down
// read one number (`decision.turnBody`, D-327). It is a pilot parameter rather than a constant of
// the product, which is exactly why no page may restate it; it travels through the service because
// that is the one internal file this index may reach (the `boundaries` policy).
export { TURN_WINDOW_MS } from './service'

// The void's own wire contract, so the `review` router can declare what 07 §8's endpoint takes and
// answers without restating the enum or `RunSummary` (04 §2 keeps a module schema free of every
// import but `src/lib`, so the shape has to be published from where it is written).
export { VOID_NOTE_MAX_CHARS, VoidReasonSchema, VoidRunResultSchema, VoidRunSchema } from './schema'
export { RunSummarySchema, RunReviewSummarySchema } from './schema'

export type {
  AddendumInput,
  AddendumView,
  AnswerReadinessItemInput,
  Brief,
  BriefDraftInput,
  BriefFieldUnitValue,
  BriefInput,
  BriefNamedField,
  BriefSignalInput,
  BriefView,
  Clock,
  DecisionRecord,
  DocumentOpened,
  DocumentSummary,
  ForcedFailure,
  Frame,
  LockFrame,
  LockFrameInput,
  OpenDocument,
  PageQuery,
  PauseCauseValue,
  PauseView,
  ReadinessConceptStatusValue,
  ReadinessItemView,
  ReadinessResult,
  ReadinessView,
  RunReviewSummary,
  RunRowForSummary,
  RunStateValue,
  RunStatus,
  RunSummary,
  RunWorkspace,
  RunsQuery,
  TurnResponse,
  TurnResponseInput,
  TurnResponseKindValue,
  TurnResponseView,
  TurnView,
  TurnVoiceValue,
  VariantKeyValue,
  VoidReasonValue,
  VoidRunInput,
  VoidRunResult,
  WorkspaceCapabilities,
} from './schema'
