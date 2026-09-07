// Public interface of the `review` module (docs/tech/10-backend-spec-modules.md §12).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, or ./errors.
//
// Every function below names an actor first, like every other endpoint in the codebase: each is
// reached from a route or a Server Action, applies 08 §4's matrix itself, and takes the run's row
// lock where it writes. There is no `trace.append`-shaped seam here, because nothing else in the
// product decides a band.
//
// Three of 07 §8's rows are deliberately absent from this list and answered by the module that owns
// the column instead — `runs.voidRun` and `runs.forceAssistantFailure`, and
// `assistant.flagDelegation`. The router mounts them under `/review` because that is the seat that
// presses them; the rules stay where the data is.
export {
  bandHeldRunManually,
  confirmRemaining,
  decideBand,
  getQueue,
  getReplay,
  listSectionRunsForReview,
  neutralizeClaim,
} from './service'

export type {
  BandDecisionResult,
  NeutralizeResult,
  ReplayBundle,
  ReplayDefenseEntry,
  ReviewQueue,
} from './service'

export {
  BandDecisionInputSchema,
  BandDecisionKindSchema,
  BandParamsSchema,
  ClaimParamsSchema,
  DelegationParamsSchema,
  FlagDelegationInputSchema,
  ForcedFailureSchema,
  ManualBandsInputSchema,
  NOTE_MAX_CHARS,
  NeutralizeInputSchema,
  NeutralizeReasonSchema,
  ReplayBundleSchema,
  ReviewQueueSchema,
  RunIdParamsSchema,
  SectionIdParamsSchema,
} from './schema'

export type {
  BandDecisionInput,
  BandDecisionKind,
  ForcedFailure,
  ManualBandsInput,
  NeutralizeInput,
  NeutralizeReasonValue,
  ReplayCapabilities,
  ReplayConcept,
  ReplayDeclaration,
  ReplayExport,
  ReplayLabels,
  ReplayNeutralization,
  ReplayUnverifiedNumber,
} from './schema'
