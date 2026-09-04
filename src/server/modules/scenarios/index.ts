// Public interface of the `scenarios` module (docs/tech/10-backend-spec-modules.md §4).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, ./validate, or ./errors.
//
// `validatePackage` and its rule vocabulary reach this file through `./service`, which re-exports
// them: `validate.ts` is an internal module file, and the public index may import only `service`
// and `schema` (04 §2). The rule codes travel with it because `PACKAGE_INVALID` carries them in
// `details` and the confirmation workspace renders them by code (FR-194).
export {
  SINGLETON_ELEMENT_TYPES,
  VALIDATION_RULE_CODES,
  confirmVersion,
  createPackageFromSeed,
  decideElement,
  exportPackage,
  getClaimObject,
  getPackage,
  getPackageVersion,
  getStudentScenario,
  importPackage,
  listPackages,
  regenerateVersion,
  updateElement,
  validatePackage,
} from './service'

export type {
  ElementUnit,
  ElementView,
  PackageValidationFailure,
  PackageValidationResult,
  ValidationRuleCode,
} from './service'

export type {
  AuthoringMeasures,
  AuthoringRecordView,
  CalibrationStatusValue,
  ClaimObjectView,
  ClaimStateView,
  ConfirmVersionInput,
  ConfirmationDecisionValue,
  CreatePackageFromSeedInput,
  CreatedPackageView,
  ElementConfirmationView,
  ElementCounts,
  ElementDecisionInput,
  ElementTypeValue,
  EvidenceStatusValue,
  FailureFamilyValue,
  ImportPackageInput,
  ImportedPackageView,
  PackageExport,
  PackageStatusValue,
  PackageSummaryView,
  PackageVersionView,
  PackageView,
  PackageWarningValue,
  PageQuery,
  RegenerateVersionInput,
  SeedRecordView,
  StanceValue,
  StudentScenarioView,
  ValidationFailure,
  ValidationResult,
  VariantKeyValue,
  VersionSummaryView,
} from './schema'
