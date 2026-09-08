// Public interface of the `authoring` module (docs/tech/10-backend-spec-modules.md §5).
// Other modules, Server Components and the `generate_package_step` job handler import from here;
// never from ./service, ./repository, ./steps or ./errors.
//
// `scenarios` takes exactly one function through this door — `listGenerationRunsForVersion`, for the
// authoring record and FR-198's generation counters on the package view — and this module never
// imports `scenarios`' own index in return. That asymmetry is deliberate and is what keeps the pair
// acyclic (D-530): the heavier edge, which needs `findVersionFull`, `upsertElement`, `elementUnits`
// and `validatePackage`, goes to that module's repository, units and validator instead.
export {
  computeAuthoringMeasures,
  explainWarrantedStance,
  getGenerationStatus,
  isStance,
  listGenerationRunsForVersion,
  noItemNamesAClaim,
  proposeWarrantedStance,
  regenerateElement,
  runGenerationStep,
  startGeneration,
  WARRANTED_STANCE_RULES,
} from './service'

export type {
  CheckedClaim,
  CheckedReadinessItem,
  ClaimEcho,
  ClaimEchoCheck,
  GenerationStepOutcome,
  RunGenerationStepInput,
  StanceProposalClaim,
  StanceProposalState,
  WarrantedStanceProposal,
  WarrantedStanceRule,
} from './service'

export {
  GENERATION_RUN_STATUSES,
  GENERATION_STEPS,
  GenerationRunStatusSchema,
  GenerationStepSchema,
  MAX_GENERATION_PASSES,
  RegenerateElementSchema,
} from './schema'

export type {
  AuthoringMeasures,
  GenerationRunStatusValue,
  GenerationRunView,
  GenerationStatusView,
  GenerationStepValue,
  RegenerateElementInput,
  RegenerateElementView,
  StartGenerationView,
} from './schema'
