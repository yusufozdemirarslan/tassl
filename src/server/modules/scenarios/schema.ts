// Wire contract of the `scenarios` module (docs/tech/10-backend-spec-modules.md §4, §17;
// 06-data-model.md §3.3; 07-api-spec.md §6). One Zod schema per input, shared by the route, the
// Server Action, and the form that submits it; one schema per view, which the route validates
// against before serializing.
//
// Like every module schema this file is the server-side authority and carries no server import
// (ESLint `boundaries` gives the `schema` category no dependencies), so the enum vocabularies of
// `src/server/db/schema/enums.ts` are restated here rather than imported, exactly as `courses`
// does. Dates leave the service as ISO strings, not `Date`s: the same view travels in a JSON body
// and in an RSC payload.
//
// Two families of element schema live here and the difference is deliberate:
//
//   *Input*  — what `updateElement` and the confirmation workspace write. References between
//              elements are database ids, because the rows already exist.
//   *Export* — what `exportPackage` returns and `importPackage` accepts. References between
//              elements are element **keys** (`D4`, `C3`, `finance_lead`), so a package exported by
//              one institution imports into another where every id is new (SYS-026). This is the
//              only shape that round-trips.
//
// Countable package rules (document counts, the 6/4/6 readiness split, exactly one planted claim,
// three counterfactual sentences) are *not* enforced here. They belong to `validatePackage`, which
// answers with the rule code an author can act on; a schema rejection would only ever produce
// `VALIDATION_ERROR` and would hide the rule. The schemas check shape, vocabulary and the two hard
// caps the database also carries (the seed text, the Turn delay).
import { z } from 'zod'
import { wordLimit } from '@/lib/words'

// ---------------------------------------------------------------------------------------------
// Optional-key tightening
// ---------------------------------------------------------------------------------------------

/**
 * Zod spells an optional key `k?: T | undefined`; the stored jsonb payload types in
 * `src/server/db/schema/scenarios.ts` spell it `k?: T`, and under `exactOptionalPropertyTypes` the
 * two are different types. Every exported element type is tightened so a parsed element assigns
 * straight into a row insert without a cast at the call site.
 */
type ExactOptional<T> = T extends (infer E)[]
  ? ExactOptional<E>[]
  : T extends object
    ? { [K in keyof T]: ExactOptional<Exclude<T[K], undefined>> }
    : T

/** The parsed output of `schema`, with optional keys spelled the way the row types spell them. */
type Parsed<S extends z.ZodType> = ExactOptional<z.infer<S>>

type WithoutDefault<S> = S extends z.ZodDefault<infer Inner> ? Inner : S

/**
 * The patch form of an element schema. `.partial()` alone is not enough: a field carrying a
 * `.default()` still fills that default when its key is absent, so `PATCH { "body": "…" }` would
 * quietly reset every other defaulted column of the row. Unwrapping the default first leaves a
 * field that is simply not there when the editor did not send it, which is what a patch means.
 */
function patchOf<Shape extends z.ZodRawShape>(shape: Shape) {
  const undefaulted = Object.fromEntries(
    Object.entries(shape).map(([name, field]) => [
      name,
      field instanceof z.ZodDefault ? field.def.innerType : field,
    ]),
  ) as { [K in keyof Shape]: WithoutDefault<Shape[K]> }
  return z.object(undefaulted).partial()
}

// ---------------------------------------------------------------------------------------------
// Enumerations (06-data-model.md §3.3, restated from the Postgres enums)
// ---------------------------------------------------------------------------------------------

export const PACKAGE_STATUSES = ['draft', 'confirmed', 'retired'] as const
export const PackageStatusSchema = z.enum(PACKAGE_STATUSES)
export type PackageStatusValue = z.infer<typeof PackageStatusSchema>

export const CALIBRATION_STATUSES = ['uncalibrated', 'calibrated'] as const
export const CalibrationStatusSchema = z.enum(CALIBRATION_STATUSES)
export type CalibrationStatusValue = z.infer<typeof CalibrationStatusSchema>

export const DOCUMENT_ROLES = [
  'supporting',
  'superseded',
  'interpretation_as_fact',
  'irrelevant',
] as const
export const DocumentRoleSchema = z.enum(DOCUMENT_ROLES)
export type DocumentRoleValue = z.infer<typeof DocumentRoleSchema>

export const POSITION_KINDS = ['defensible', 'evidence_inconsistent'] as const
export const PositionKindSchema = z.enum(POSITION_KINDS)
export type PositionKindValue = z.infer<typeof PositionKindSchema>

export const VALUE_UNITS = ['percent', 'ratio', 'months', 'usd', 'count', 'other'] as const
export const ValueUnitSchema = z.enum(VALUE_UNITS)
export type ValueUnitValue = z.infer<typeof ValueUnitSchema>

export const CLAIM_SOURCES = ['assistant', 'document'] as const
export const ClaimSourceSchema = z.enum(CLAIM_SOURCES)
export type ClaimSourceValue = z.infer<typeof ClaimSourceSchema>

export const CLAIM_IMPORTANCES = ['load_bearing', 'supporting'] as const
export const ClaimImportanceSchema = z.enum(CLAIM_IMPORTANCES)
export type ClaimImportanceValue = z.infer<typeof ClaimImportanceSchema>

export const CONSEQUENCE_LEVELS = ['low', 'medium', 'high'] as const
export const ConsequenceLevelSchema = z.enum(CONSEQUENCE_LEVELS)
export type ConsequenceLevelValue = z.infer<typeof ConsequenceLevelSchema>

export const VERIFICATION_COSTS = ['cheap', 'moderate', 'expensive'] as const
export const VerificationCostSchema = z.enum(VERIFICATION_COSTS)
export type VerificationCostValue = z.infer<typeof VerificationCostSchema>

export const VARIANT_KEYS = ['defective', 'sound'] as const
export const VariantKeySchema = z.enum(VARIANT_KEYS)
export type VariantKeyValue = z.infer<typeof VariantKeySchema>

export const EVIDENCE_STATUSES = ['sound', 'defective'] as const
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES)
export type EvidenceStatusValue = z.infer<typeof EvidenceStatusSchema>

export const FAILURE_FAMILIES = [
  'near_neighbor',
  'unstated_assumption',
  'stale_evidence',
  'uncomputed_number',
  'extrapolation',
  'reversal_to_agree',
  'omitted_alternative',
  'misapplied_method',
  'misattributed_source',
  'unacceptable_route',
] as const
export const FailureFamilySchema = z.enum(FAILURE_FAMILIES)
export type FailureFamilyValue = z.infer<typeof FailureFamilySchema>

export const STANCES = ['accept', 'verify', 'challenge', 'reject', 'escalate'] as const
export const StanceSchema = z.enum(STANCES)
export type StanceValue = z.infer<typeof StanceSchema>

export const TURN_VOICES = [
  'stakeholder_message',
  'corrected_number',
  'supplier_notice',
  'competitor_move',
  'retracted_source',
  'regulatory_note',
] as const
export const TurnVoiceSchema = z.enum(TURN_VOICES)
export type TurnVoiceValue = z.infer<typeof TurnVoiceSchema>

export const TURN_RESPONSES = ['hold', 'revise', 'reverse'] as const
export const TurnResponseSchema = z.enum(TURN_RESPONSES)
export type TurnResponseValue = z.infer<typeof TurnResponseSchema>

export const QUESTION_KINDS = [
  'provenance',
  'figure_provenance',
  'verification',
  'assumption',
  'confidence',
  'frame_vs_response',
  'counterfactual',
  'default',
] as const
export const QuestionKindSchema = z.enum(QUESTION_KINDS)
export type QuestionKindValue = z.infer<typeof QuestionKindSchema>

export const READINESS_CATEGORIES = ['foundation', 'defect_concept', 'ai_behavior'] as const
export const ReadinessCategorySchema = z.enum(READINESS_CATEGORIES)
export type ReadinessCategoryValue = z.infer<typeof ReadinessCategorySchema>

/** `element_type` (DATA-026): the fifteen things an author confirms one at a time. */
export const ELEMENT_TYPES = [
  'brief',
  'document',
  'stakeholder',
  'answer_space_position',
  'named_field',
  'claim',
  'variant_claim_state',
  'probe',
  'turn',
  'defense_question',
  'readiness_item',
  'counterfactual',
  'general_escalation_reply',
  'clock_and_difficulty',
  'seed_reskin',
] as const
export const ElementTypeSchema = z.enum(ELEMENT_TYPES)
export type ElementTypeValue = z.infer<typeof ElementTypeSchema>

export const CONFIRMATION_DECISIONS = ['confirmed', 'edited', 'rejected'] as const
export const ConfirmationDecisionSchema = z.enum(CONFIRMATION_DECISIONS)
export type ConfirmationDecisionValue = z.infer<typeof ConfirmationDecisionSchema>

/** `generation_runs.step` and `.status` (DATA-027); the package view reports them (07 §6). */
export const GENERATION_STEPS = [
  'reskin_brief_stakeholders',
  'documents',
  'answer_space_fields',
  'claims_and_states',
  'turn_and_probe',
  'question_bank_and_counterfactual',
  'readiness_items',
] as const
export const GenerationStepSchema = z.enum(GENERATION_STEPS)
export type GenerationStepValue = z.infer<typeof GenerationStepSchema>

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export const JobStatusSchema = z.enum(JOB_STATUSES)
export type JobStatusValue = z.infer<typeof JobStatusSchema>

export const RESKIN_KINDS = ['renamed_entity', 'altered_number', 'restructured_document'] as const
export const ReskinKindSchema = z.enum(RESKIN_KINDS)
export type ReskinKindValue = z.infer<typeof ReskinKindSchema>

/**
 * What an author should look at before a package is used. A warning never blocks a confirmation
 * (D-083) — that is what separates it from a `validatePackage` rule.
 *
 * `FAMILY_LACKS_ETHICAL_DEFECT` is about the family, so the packages list carries it and one
 * version clears it for the whole row. `READINESS_CONCEPT_SINGLE_ITEM` is about one version's
 * readiness items, so it appears on the version's own screen: a concept carried by a single item
 * makes that item's correctness the concept map's status, returned to the student when the check
 * closes and before the run is scored (D-251).
 */
export const PACKAGE_WARNINGS = [
  'FAMILY_LACKS_ETHICAL_DEFECT',
  'READINESS_CONCEPT_SINGLE_ITEM',
] as const
export const PackageWarningSchema = z.enum(PACKAGE_WARNINGS)
export type PackageWarningValue = z.infer<typeof PackageWarningSchema>

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

const NAME_MAX = 200
const LINE_MAX = 400
const TEXT_MAX = 4000
const BODY_MAX = 40_000

/** D-081: at most 2,000 words per document body ("at most four pages"). */
export const DOCUMENT_WORD_LIMIT = 2000
/** PRD §7.2: the brief is at most 200 words. */
export const BRIEF_WORD_LIMIT = 200
/** 06 §3.3: the database refuses a longer seed text, so the schema refuses it first. */
export const SEED_TEXT_MAX = 200_000
/** 06 §3.3 check `turn_delay_seconds between 60 and 120`. */
export const TURN_DELAY_SECONDS_MIN = 60
export const TURN_DELAY_SECONDS_MAX = 120
/** PRD §7.5 working clock; the column has no check, so the schema carries a sane envelope. */
export const WORKING_CLOCK_SECONDS_MIN = 300
export const WORKING_CLOCK_SECONDS_MAX = 7200

/** Stand-in `element_id` for a singleton element (`authoring.SINGLETON_ELEMENT_KEY`, DATA-026). */
export const SINGLETON_ELEMENT_ID = '00000000-0000-0000-0000-000000000000'

/**
 * An element key (`D4`, `C3`, `finance_lead`): the name an export references instead of a database
 * id. Kept to letters, digits, `_` and `-` so a key is safe in a URL, a filename and a JSON pointer.
 */
export const ElementKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/)
export type ElementKey = z.infer<typeof ElementKeySchema>

/** A named field key (`premium_payback_months`): snake_case, because the brief interpolates it. */
export const FieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,59}$/)

/** A concept key; 10 §17 sets the floor at two characters. */
export const ConceptKeySchema = z.string().trim().min(2).max(60)

/** The package family key; stable across versions and unique per institution (10 §17). */
export const FamilyKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{3,60}$/)

const shortText = z.string().trim().min(1).max(NAME_MAX)
const lineText = z.string().trim().min(1).max(LINE_MAX)
const paragraphText = z.string().trim().min(1).max(TEXT_MAX)
const optionalParagraph = z.string().trim().max(TEXT_MAX).default('')
const positionIndex = z.int().min(0)
const isoDate = z.iso.date()
const isoDateTime = z.iso.datetime()

// ---------------------------------------------------------------------------------------------
// jsonb payloads (keys stay snake_case: these travel into the trace and the export unchanged)
// ---------------------------------------------------------------------------------------------

/** One of the four options of a readiness item (`readiness_items.options`, DATA-025). */
export const ReadinessOptionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9]$/),
  text: paragraphText,
})
export type ReadinessOption = Parsed<typeof ReadinessOptionSchema>

/** `scenario_package_versions.difficulty_profile`; `uncalibrated` stays true until calibration. */
export const DifficultyProfileSchema = z.object({
  estimate: z.string().trim().min(1).max(NAME_MAX).default('unknown'),
  note: optionalParagraph,
  uncalibrated: z.boolean().default(true),
})
export type DifficultyProfile = Parsed<typeof DifficultyProfileSchema>

export const DEFAULT_DIFFICULTY_PROFILE: DifficultyProfile = {
  estimate: 'unknown',
  note: '',
  uncalibrated: true,
}

/** One entry of `seed_records.reskin_log` (FR-028): what was changed from the licensed case. */
export const ReskinLogEntrySchema = z.object({
  kind: ReskinKindSchema,
  from: z.string().trim().min(1).max(LINE_MAX),
  to: z.string().trim().min(1).max(LINE_MAX),
  note: optionalParagraph,
})
export type ReskinLogEntry = Parsed<typeof ReskinLogEntrySchema>

/** One entry of `scenario_claims.carried_values`: the figure a claim carries (D-076 matching). */
export const CarriedValueSchema = z.object({
  field_key: FieldKeySchema.optional(),
  value: z.number().finite(),
  unit: ValueUnitSchema,
})
export type CarriedValue = Parsed<typeof CarriedValueSchema>

const replicationCheck = z.object({ result: paragraphText })
const decompositionCheck = z.object({
  steps: z.array(z.object({ label: lineText, result: paragraphText })).min(1),
})

/**
 * `variant_claim_states.verification_paths`: what an interrogation action returns for this claim in
 * this variant. The Source Trace path names the document by id here and by key in the export.
 */
export const VerificationPathsSchema = z.object({
  source_trace: z
    .object({
      document_id: z.uuid(),
      passage: paragraphText,
      dated_on: isoDate,
      author: shortText,
    })
    .optional(),
  replication_check: replicationCheck.optional(),
  decomposition_check: decompositionCheck.optional(),
})
export type VerificationPaths = Parsed<typeof VerificationPathsSchema>

export const VerificationPathsExportSchema = z.object({
  source_trace: z
    .object({
      document_key: ElementKeySchema,
      passage: paragraphText,
      dated_on: isoDate,
      author: shortText,
    })
    .optional(),
  replication_check: replicationCheck.optional(),
  decomposition_check: decompositionCheck.optional(),
})
export type VerificationPathsExport = Parsed<typeof VerificationPathsExportSchema>

/** `defense_questions.condition`; the selector (10 §9) narrows it by question kind. */
export const DefenseQuestionConditionSchema = z.record(z.string(), z.unknown())
export type DefenseQuestionCondition = Parsed<typeof DefenseQuestionConditionSchema>

// ---------------------------------------------------------------------------------------------
// Elements — brief (DATA-013 column)
// ---------------------------------------------------------------------------------------------

/**
 * The brief the student reads. `wordLimit` strips markup and counts tokens (D-075): the brief is
 * rendered as plain text, so the limit and the stripping belong to the field the author edits. An
 * imported brief is checked by `validatePackage` instead, which answers `BRIEF_TOO_LONG`.
 */
export const BriefInputSchema = z.object({ brief: wordLimit(BRIEF_WORD_LIMIT).max(BODY_MAX) })
export type BriefInput = Parsed<typeof BriefInputSchema>

// ---------------------------------------------------------------------------------------------
// Elements — documents (DATA-015)
// ---------------------------------------------------------------------------------------------

/**
 * `word_count` is absent from both shapes on purpose: it is derived from the body, and a package
 * that could declare its own count could declare a false one and walk past `DOCUMENT_TOO_LONG`.
 * The service computes it with `countWords` when it writes the row.
 */
const documentFields = {
  key: ElementKeySchema,
  title: shortText,
  author: shortText,
  datedOn: isoDate,
  role: DocumentRoleSchema,
  position: positionIndex,
}

/**
 * `variant_claim_states_failure_family_check` (drizzle/0003_scenario_packages.sql): a defective
 * state names the family it fails under. Mirrored here so the author is told which field is missing
 * instead of meeting the constraint as an unmapped database error.
 */
const requireFailureFamilyWhenDefective = <
  T extends { evidenceStatus: string; failureFamily: string | null },
>(
  state: T,
  ctx: z.RefinementCtx,
): void => {
  if (state.evidenceStatus === 'defective' && state.failureFamily === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['failureFamily'],
      message: 'A defective claim state names the failure family it belongs to.',
    })
  }
}

/**
 * `scenario_documents_superseded_by_check`: a superseded document names the document that
 * supersedes it. `DOCUMENT_ROLES_MISSING` then checks that the successor is in the room and later.
 */
const requireSuccessorWhenSuperseded = <T extends { role: string }>(
  document: T,
  successor: string | null,
  ctx: z.RefinementCtx,
): void => {
  if (document.role === 'superseded' && successor === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['supersededByDocumentId'],
      message: 'A superseded document names the document that supersedes it.',
    })
  }
}

export const DocumentInputSchema = z
  .object({
    ...documentFields,
    body: wordLimit(DOCUMENT_WORD_LIMIT).min(1).max(BODY_MAX),
    supersededByDocumentId: z.uuid().nullable().default(null),
    stakeholderId: z.uuid().nullable().default(null),
  })
  .superRefine((document, ctx) =>
    requireSuccessorWhenSuperseded(document, document.supersededByDocumentId, ctx),
  )
export type DocumentInput = Parsed<typeof DocumentInputSchema>

export const DocumentExportSchema = z
  .object({
    ...documentFields,
    // Characters, not words: the same cap the edit path carries, so nothing that can be stored is
    // refused here — a body one path accepts and the other rejects would leave a confirmed version
    // unexportable and its snapshot unwritable. The word limit is a package rule, and an imported
    // document that breaks it is answered by `validatePackage` with `DOCUMENT_TOO_LONG` and the
    // element id, which is what an author can act on.
    body: z.string().min(1).max(BODY_MAX),
    supersededByKey: ElementKeySchema.nullable().default(null),
    stakeholderKey: ElementKeySchema.nullable().default(null),
  })
  .superRefine((document, ctx) =>
    requireSuccessorWhenSuperseded(document, document.supersededByKey, ctx),
  )
export type DocumentExport = Parsed<typeof DocumentExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — stakeholders (DATA-016)
// ---------------------------------------------------------------------------------------------

const stakeholderFields = {
  key: ElementKeySchema,
  name: shortText,
  roleTitle: shortText,
  positionStatement: paragraphText,
  incentives: paragraphText,
  blindSpots: paragraphText,
  contradictionPoint: z.string().trim().max(TEXT_MAX).nullable().default(null),
}

export const StakeholderInputSchema = z.object({
  ...stakeholderFields,
  contradictsStakeholderId: z.uuid().nullable().default(null),
})
export type StakeholderInput = Parsed<typeof StakeholderInputSchema>

export const StakeholderExportSchema = z.object({
  ...stakeholderFields,
  contradictsStakeholderKey: ElementKeySchema.nullable().default(null),
})
export type StakeholderExport = Parsed<typeof StakeholderExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — answer space (DATA-017)
// ---------------------------------------------------------------------------------------------

const answerSpaceFields = {
  key: ElementKeySchema,
  kind: PositionKindSchema,
  summary: paragraphText,
  /** Required for an `evidence_inconsistent` position; `ANSWER_SPACE_NO_INCONSISTENT` says so. */
  ignoredEvidence: z.string().trim().max(TEXT_MAX).nullable().default(null),
  isMinimumCommitment: z.boolean().default(false),
  position: positionIndex,
}

export const AnswerSpacePositionInputSchema = z.object({
  ...answerSpaceFields,
  supportingDocumentIds: z.array(z.uuid()).default([]),
})
export type AnswerSpacePositionInput = Parsed<typeof AnswerSpacePositionInputSchema>

export const AnswerSpacePositionExportSchema = z.object({
  ...answerSpaceFields,
  supportingDocumentKeys: z.array(ElementKeySchema).default([]),
})
export type AnswerSpacePositionExport = Parsed<typeof AnswerSpacePositionExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — named fields (DATA-018); no reference to another element, so one shape serves both
// ---------------------------------------------------------------------------------------------

export const NamedFieldSchema = z.object({
  key: FieldKeySchema,
  label: shortText,
  unit: ValueUnitSchema,
  position: positionIndex,
})
export type NamedFieldInput = Parsed<typeof NamedFieldSchema>
export type NamedFieldExport = NamedFieldInput

// ---------------------------------------------------------------------------------------------
// Elements — claims (DATA-019)
// ---------------------------------------------------------------------------------------------

const claimFields = {
  key: ElementKeySchema,
  text: paragraphText,
  sourceKind: ClaimSourceSchema,
  sourcePassage: optionalParagraph,
  importance: ClaimImportanceSchema,
  consequenceLevel: ConsequenceLevelSchema,
  verificationCost: VerificationCostSchema,
  weaklySourced: z.boolean().default(false),
  volatile: z.boolean().default(false),
  conceptKey: ConceptKeySchema,
  carriedValues: z.array(CarriedValueSchema).default([]),
  triggerPhrases: z.array(z.string().trim().min(1).max(LINE_MAX)).default([]),
  triggerDescription: optionalParagraph,
  escalatable: z.boolean().default(false),
  /** Required when `escalatable`; `NO_ESCALATABLE_CLAIM` needs one claim that has both. */
  escalationReply: z.string().trim().max(TEXT_MAX).nullable().default(null),
  /** "What it deserved and why" (FR-151); shown in the debrief, never before scoring. */
  rationale: optionalParagraph,
  position: positionIndex,
}

export const ClaimInputSchema = z.object({
  ...claimFields,
  sourceDocumentId: z.uuid().nullable().default(null),
})
export type ClaimInput = Parsed<typeof ClaimInputSchema>

export const ClaimExportSchema = z.object({
  ...claimFields,
  sourceDocumentKey: ElementKeySchema.nullable().default(null),
})
export type ClaimExport = Parsed<typeof ClaimExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — variants and per-variant claim states (DATA-020, DATA-021)
// ---------------------------------------------------------------------------------------------

const variantClaimStateFields = {
  evidenceStatus: EvidenceStatusSchema,
  /** Required when the state is defective (database check); null on a sound state. */
  failureFamily: FailureFamilySchema.nullable().default(null),
  warrantedStance: StanceSchema,
  /** The one consequential defect of the defective variant (`DEFECTIVE_VARIANT_PLANT`). */
  planted: z.boolean().default(false),
}

export const VariantClaimStateInputSchema = z
  .object({
    variantId: z.uuid(),
    claimId: z.uuid(),
    ...variantClaimStateFields,
    verificationPaths: VerificationPathsSchema.default({}),
  })
  .superRefine(requireFailureFamilyWhenDefective)
export type VariantClaimStateInput = Parsed<typeof VariantClaimStateInputSchema>

/** Inside an export a state hangs off its variant, so it names only the claim it is about. */
export const VariantClaimStateExportSchema = z
  .object({
    claimKey: ElementKeySchema,
    ...variantClaimStateFields,
    verificationPaths: VerificationPathsExportSchema.default({}),
  })
  .superRefine(requireFailureFamilyWhenDefective)
export type VariantClaimStateExport = Parsed<typeof VariantClaimStateExportSchema>

/**
 * A variant with its states. `retired_at` is left out: retirement is operational state of one
 * institution's version, not authored content, and an export must not carry it into another.
 */
export const VariantExportSchema = z.object({
  key: VariantKeySchema,
  label: shortText,
  claimStates: z.array(VariantClaimStateExportSchema).default([]),
})
export type VariantExport = Parsed<typeof VariantExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — sycophancy probe (DATA-022)
// ---------------------------------------------------------------------------------------------

const probeFields = {
  originalPosition: paragraphText,
  scriptedReversal: paragraphText,
}

export const SycophancyProbeInputSchema = z.object({ claimId: z.uuid(), ...probeFields })
export type SycophancyProbeInput = Parsed<typeof SycophancyProbeInputSchema>

export const SycophancyProbeExportSchema = z.object({
  claimKey: ElementKeySchema,
  ...probeFields,
})
export type SycophancyProbeExport = Parsed<typeof SycophancyProbeExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — the Turn (DATA-023)
// ---------------------------------------------------------------------------------------------

const turnFields = {
  text: paragraphText,
  voice: TurnVoiceSchema,
  warrantsChange: z.boolean(),
  proportionateResponse: TurnResponseSchema,
  evidence: paragraphText,
  /** Frame assumptions the Turn disrupts, by named field or assumption key (FR-114). */
  disruptedAssumptionKeys: z.array(z.string().trim().min(1).max(NAME_MAX)).default([]),
}

export const TurnInputSchema = z.object({
  ...turnFields,
  stakeholderId: z.uuid().nullable().default(null),
  windowClaimIds: z.array(z.uuid()).default([]),
})
export type TurnInput = Parsed<typeof TurnInputSchema>

export const TurnExportSchema = z.object({
  ...turnFields,
  stakeholderKey: ElementKeySchema.nullable().default(null),
  windowClaimKeys: z.array(ElementKeySchema).default([]),
})
export type TurnExport = Parsed<typeof TurnExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — defense question bank (DATA-024). Never returned to a student (D-117)
// ---------------------------------------------------------------------------------------------

const defenseQuestionFields = {
  key: ElementKeySchema,
  kind: QuestionKindSchema,
  /** Frame assumption 0–2 for an `assumption` question; null for every other kind. */
  assumptionIndex: z.int().min(0).max(2).nullable().default(null),
  /** Placeholders `{claim_text}`, `{figure}`, `{stance}`, `{document_title}`, `{assumption}`. */
  template: paragraphText,
  condition: DefenseQuestionConditionSchema.default({}),
  followUp: optionalParagraph,
  expectedAnswerNotes: optionalParagraph,
  isDefault: z.boolean().default(false),
  position: positionIndex,
}

export const DefenseQuestionInputSchema = z.object({
  ...defenseQuestionFields,
  claimId: z.uuid().nullable().default(null),
})
export type DefenseQuestionInput = Parsed<typeof DefenseQuestionInputSchema>

export const DefenseQuestionExportSchema = z.object({
  ...defenseQuestionFields,
  claimKey: ElementKeySchema.nullable().default(null),
})
export type DefenseQuestionExport = Parsed<typeof DefenseQuestionExportSchema>

// ---------------------------------------------------------------------------------------------
// Elements — readiness items (DATA-025); no reference to another element
// ---------------------------------------------------------------------------------------------

export const ReadinessItemSchema = z.object({
  key: ElementKeySchema,
  category: ReadinessCategorySchema,
  conceptKey: ConceptKeySchema,
  stem: paragraphText,
  options: z.array(ReadinessOptionSchema).min(2).max(8),
  answerKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]$/),
  position: positionIndex,
})
export type ReadinessItemInput = Parsed<typeof ReadinessItemSchema>
export type ReadinessItemExport = ReadinessItemInput

// ---------------------------------------------------------------------------------------------
// Version-level singletons (columns on `scenario_package_versions`, DATA-014 for the seed record)
// ---------------------------------------------------------------------------------------------

/** Exactly three sentences at confirmation (`COUNTERFACTUAL_SENTENCES`, PRD §7.14). */
export const CounterfactualInputSchema = z.object({
  debriefCounterfactual: z.string().trim().min(1).max(TEXT_MAX),
})
export type CounterfactualInput = Parsed<typeof CounterfactualInputSchema>

/** The reply the assistant gives to an escalation with no authored claim reply (PRD §7.9). */
export const GeneralEscalationReplyInputSchema = z.object({
  generalEscalationReply: paragraphText,
})
export type GeneralEscalationReplyInput = Parsed<typeof GeneralEscalationReplyInputSchema>

export const ClockAndDifficultyInputSchema = z.object({
  workingClockSeconds: z.int().min(WORKING_CLOCK_SECONDS_MIN).max(WORKING_CLOCK_SECONDS_MAX),
  turnDelaySeconds: z.int().min(TURN_DELAY_SECONDS_MIN).max(TURN_DELAY_SECONDS_MAX),
  difficultyProfile: DifficultyProfileSchema,
})
export type ClockAndDifficultyInput = Parsed<typeof ClockAndDifficultyInputSchema>

/**
 * The licensed case a package was re-skinned from (FR-028). Never returned to a student, a TA, or
 * any route outside authoring; the export carries it so a receiving institution keeps the record of
 * what the package is derived from.
 */
export const SeedRecordInputSchema = z.object({
  caseTitle: z.string().trim().min(1).max(NAME_MAX),
  publisher: z.string().trim().min(1).max(NAME_MAX),
  licenseTerms: z.string().trim().min(1).max(TEXT_MAX),
  licensePermitsAdaptation: z.boolean(),
  seedText: z.string().min(1).max(SEED_TEXT_MAX),
  /** `RESKIN_LOG_EMPTY`: three entries with at least one of each kind, checked at confirmation. */
  reskinLog: z.array(ReskinLogEntrySchema).default([]),
})
export type SeedRecordInput = Parsed<typeof SeedRecordInputSchema>
export const SeedRecordExportSchema = SeedRecordInputSchema
export type SeedRecordExport = SeedRecordInput

// ---------------------------------------------------------------------------------------------
// The element registry: what `updateElement` validates for a given `elementType`
// ---------------------------------------------------------------------------------------------

/** One schema per `element_type`, in the order the confirmation workspace lists them. */
export const ELEMENT_INPUT_SCHEMAS = {
  brief: BriefInputSchema,
  document: DocumentInputSchema,
  stakeholder: StakeholderInputSchema,
  answer_space_position: AnswerSpacePositionInputSchema,
  named_field: NamedFieldSchema,
  claim: ClaimInputSchema,
  variant_claim_state: VariantClaimStateInputSchema,
  probe: SycophancyProbeInputSchema,
  turn: TurnInputSchema,
  defense_question: DefenseQuestionInputSchema,
  readiness_item: ReadinessItemSchema,
  counterfactual: CounterfactualInputSchema,
  general_escalation_reply: GeneralEscalationReplyInputSchema,
  clock_and_difficulty: ClockAndDifficultyInputSchema,
  seed_reskin: SeedRecordInputSchema,
} as const satisfies Record<ElementTypeValue, z.ZodObject>

/**
 * The same schemas with every field optional: `PATCH .../elements/{type}/{id}` sends only the
 * fields the editor changed (07 §6), and `updateElement` merges the patch onto the stored row.
 */
export const ELEMENT_PATCH_SCHEMAS = {
  brief: patchOf(BriefInputSchema.shape),
  document: patchOf(DocumentInputSchema.shape),
  stakeholder: patchOf(StakeholderInputSchema.shape),
  answer_space_position: patchOf(AnswerSpacePositionInputSchema.shape),
  named_field: patchOf(NamedFieldSchema.shape),
  claim: patchOf(ClaimInputSchema.shape),
  variant_claim_state: patchOf(VariantClaimStateInputSchema.shape),
  probe: patchOf(SycophancyProbeInputSchema.shape),
  turn: patchOf(TurnInputSchema.shape),
  defense_question: patchOf(DefenseQuestionInputSchema.shape),
  readiness_item: patchOf(ReadinessItemSchema.shape),
  counterfactual: patchOf(CounterfactualInputSchema.shape),
  general_escalation_reply: patchOf(GeneralEscalationReplyInputSchema.shape),
  clock_and_difficulty: patchOf(ClockAndDifficultyInputSchema.shape),
  seed_reskin: patchOf(SeedRecordInputSchema.shape),
} as const satisfies Record<ElementTypeValue, z.ZodObject>

/** The parsed element of a given type, e.g. `ElementInputOf<'claim'>` is `ClaimInput`. */
export type ElementInputOf<T extends ElementTypeValue> = Parsed<(typeof ELEMENT_INPUT_SCHEMAS)[T]>
export type ElementPatchOf<T extends ElementTypeValue> = Parsed<(typeof ELEMENT_PATCH_SCHEMAS)[T]>

// ---------------------------------------------------------------------------------------------
// The portable package document (SYS-026)
// ---------------------------------------------------------------------------------------------

/**
 * The export format's own version. It is bumped when a field is removed or its meaning changes;
 * an importer that meets a version it does not know refuses with `IMPORT_INVALID` rather than
 * guessing. Added fields with defaults do not need a bump, because an older document still parses.
 */
export const PACKAGE_EXPORT_SCHEMA_VERSION = 1

/**
 * The whole package as one JSON document: `exportPackage` returns it, `importPackage` accepts it,
 * and `confirmVersion` stores it as `scenario_package_versions.snapshot`. Every reference between
 * elements is an element key, so the document is portable between institutions and round-trips —
 * export ∘ import is the identity on it.
 */
/**
 * Element keys are unique within a version (06 §3.3), and the writes behind an import are upserts
 * on `(package_version_id, key)`, so a document that repeats a key would lose an element quietly
 * and fail a later rule that names the wrong fault. The document says what it says: a repeat is a
 * malformed document, answered as `IMPORT_INVALID` by the caller that parses it.
 */
const uniqueKeys =
  (collection: string) =>
  (rows: readonly { key: string }[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      if (seen.has(row.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `Two ${collection} share the key "${row.key}"; keys are unique inside a version.`,
        })
      }
      seen.add(row.key)
    })
  }

export const PackageExportSchema = z.object({
  schemaVersion: z.literal(PACKAGE_EXPORT_SCHEMA_VERSION),
  package: z.object({
    title: z.string().trim().min(1).max(NAME_MAX),
    familyKey: FamilyKeySchema,
    discipline: z.string().trim().min(1).max(NAME_MAX).default('marketing_strategy'),
  }),
  // No `calibrationStatus`: calibration is field evidence about one version in front of one
  // cohort (PRD §7.18), not part of the package text, and it does not travel to the institution
  // that imports it — an imported version starts uncalibrated, which is the column's default.
  version: z.object({
    conceptSet: z.array(ConceptKeySchema).min(4),
    brief: z.string().max(BODY_MAX).default(''),
    workingClockSeconds: z
      .int()
      .min(WORKING_CLOCK_SECONDS_MIN)
      .max(WORKING_CLOCK_SECONDS_MAX)
      .default(1500),
    turnDelaySeconds: z.int().min(TURN_DELAY_SECONDS_MIN).max(TURN_DELAY_SECONDS_MAX).default(90),
    difficultyProfile: DifficultyProfileSchema.default(DEFAULT_DIFFICULTY_PROFILE),
    generalEscalationReply: z.string().trim().max(TEXT_MAX).default(''),
    debriefCounterfactual: z.string().trim().max(TEXT_MAX).default(''),
  }),
  seedRecord: SeedRecordExportSchema.nullable().default(null),
  documents: z.array(DocumentExportSchema).default([]).superRefine(uniqueKeys('documents')),
  stakeholders: z
    .array(StakeholderExportSchema)
    .default([])
    .superRefine(uniqueKeys('stakeholders')),
  answerSpacePositions: z
    .array(AnswerSpacePositionExportSchema)
    .default([])
    .superRefine(uniqueKeys('answer space positions')),
  namedFields: z.array(NamedFieldSchema).default([]).superRefine(uniqueKeys('named fields')),
  claims: z.array(ClaimExportSchema).default([]).superRefine(uniqueKeys('claims')),
  variants: z.array(VariantExportSchema).default([]).superRefine(uniqueKeys('variants')),
  probe: SycophancyProbeExportSchema.nullable().default(null),
  turn: TurnExportSchema.nullable().default(null),
  defenseQuestions: z
    .array(DefenseQuestionExportSchema)
    .default([])
    .superRefine(uniqueKeys('defense questions')),
  readinessItems: z
    .array(ReadinessItemSchema)
    .default([])
    .superRefine(uniqueKeys('readiness items')),
})
export type PackageExport = Parsed<typeof PackageExportSchema>

/** `POST /institutions/{orgId}/packages/import`: the document plus the fixture-loading flag. */
export const ImportPackageSchema = PackageExportSchema.extend({
  /** Marks every element confirmed by the importing actor; the seed uses it (06 §5). */
  confirmOnImport: z.boolean().default(false),
})
export type ImportPackageInput = Parsed<typeof ImportPackageSchema>

// ---------------------------------------------------------------------------------------------
// Service inputs (10 §4, §17; 07 §6)
// ---------------------------------------------------------------------------------------------

/**
 * The rule 10 §17 states for the license tick. The wire schema below takes a plain boolean so the
 * service can answer the documented `LICENSE_NOT_CONFIRMED` (07 §6) instead of the generic
 * `VALIDATION_ERROR` a literal would produce; the form uses this one for its field message.
 */
export const LicensePermitsAdaptationSchema = z.literal(true)

export const CreatePackageFromSeedSchema = z.object({
  title: z.string().trim().min(1).max(NAME_MAX),
  familyKey: FamilyKeySchema,
  conceptSet: z.array(ConceptKeySchema).min(4),
  seed: z.object({
    caseTitle: z.string().trim().min(1).max(NAME_MAX),
    publisher: z.string().trim().min(1).max(NAME_MAX),
    licenseTerms: z.string().trim().min(1).max(TEXT_MAX),
    licensePermitsAdaptation: z.boolean(),
    seedText: z.string().min(200).max(SEED_TEXT_MAX),
  }),
})
export type CreatePackageFromSeedInput = Parsed<typeof CreatePackageFromSeedSchema>

/**
 * One element decision (FR-198). `openedAt` comes from the client — it is when the element was
 * opened, which only the browser knows — and `decided_at` is the server's clock. `edited` is not
 * offered here: an author's edit writes that decision itself through `updateElement`.
 */
export const ElementDecisionSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  note: z.string().trim().max(1000).default(''),
  openedAt: isoDateTime,
})
export type ElementDecisionInput = Parsed<typeof ElementDecisionSchema>

/**
 * Confirming the version. The tick is a plain boolean, not a literal, so an unticked teaching-note
 * check is answered with `TEACHING_NOTE_UNCHECKED` (409) rather than a validation error.
 */
export const ConfirmVersionSchema = z.object({ teachingNoteChecked: z.boolean() })
export type ConfirmVersionInput = Parsed<typeof ConfirmVersionSchema>

/** A new draft version copied from this one (FR-195); the reason goes on the audit row. */
export const RegenerateVersionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
})
export type RegenerateVersionInput = Parsed<typeof RegenerateVersionSchema>

/** Re-running one element's generation step (Phase 12); the rule is restated to the model. */
export const RegenerateElementSchema = z.object({
  restatedRule: z.string().trim().min(1).max(1000).optional(),
})
export type RegenerateElementInput = Parsed<typeof RegenerateElementSchema>

// ---------------------------------------------------------------------------------------------
// Path parameters and queries (07 §6)
// ---------------------------------------------------------------------------------------------

export const OrgIdParamsSchema = z.object({ orgId: z.string().min(1) })
export const PackageIdParamsSchema = z.object({ packageId: z.uuid() })
export const VersionIdParamsSchema = z.object({ versionId: z.uuid() })
export const ClaimParamsSchema = z.object({ versionId: z.uuid(), claimId: z.uuid() })

/** Singleton elements address themselves with `SINGLETON_ELEMENT_ID`, as their audit rows do. */
export const ElementParamsSchema = z.object({
  versionId: z.uuid(),
  elementType: ElementTypeSchema,
  elementId: z.uuid(),
})
export type ElementParams = Parsed<typeof ElementParamsSchema>

/** Without `variantId` the claim object shows both variants side by side (FR-180). */
export const ClaimObjectQuerySchema = z.strictObject({ variantId: z.uuid().optional() })
export type ClaimObjectQuery = Parsed<typeof ClaimObjectQuerySchema>

export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type PageQuery = Parsed<typeof PageQuerySchema>

// ---------------------------------------------------------------------------------------------
// Validation result (`validate.ts` owns the rule table and its codes)
// ---------------------------------------------------------------------------------------------

/**
 * One failed rule of `validatePackage`, as the confirmation workspace renders it and as
 * `PACKAGE_INVALID` carries it in `details`. `code` is a plain string here because the rule table
 * lives in `validate.ts`, which imports this file and not the other way round; its narrower union
 * of rule codes is a subtype of this.
 */
export const ValidationFailureSchema = z.object({
  code: z.string().min(1),
  elementIds: z.array(z.string()).default([]),
  message: z.string(),
})
export type ValidationFailure = Parsed<typeof ValidationFailureSchema>

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  failures: z.array(ValidationFailureSchema).default([]),
})
export type ValidationResult = Parsed<typeof ValidationResultSchema>

// ---------------------------------------------------------------------------------------------
// Views (07 §6 response shapes)
// ---------------------------------------------------------------------------------------------

export const ElementConfirmationViewSchema = z.object({
  id: z.uuid(),
  elementType: ElementTypeSchema,
  elementId: z.uuid().nullable(),
  revision: z.int(),
  decision: ConfirmationDecisionSchema,
  note: z.string(),
  openedAt: isoDateTime,
  decidedAt: isoDateTime,
  decidedBy: z.string(),
  decidedByName: z.string(),
})
export type ElementConfirmationView = Parsed<typeof ElementConfirmationViewSchema>

/**
 * FR-198 authoring measures. `computeAuthoringMeasures` lives in the `authoring` module (10 §5);
 * the shape is restated here because a module schema may not import another module, and the
 * package version view is where it is read.
 */
export const AuthoringMeasuresSchema = z.object({
  seedToConfirmedMs: z.number().nullable(),
  editRate: z.number(),
  rejectedShare: z.number(),
  generationPasses: z.int(),
  reviewMsPerElement: z.number().nullable(),
})
export type AuthoringMeasures = Parsed<typeof AuthoringMeasuresSchema>

/** How the version came to be: the generation runs behind it and the people who decided on it. */
export const AuthoringRecordViewSchema = z.object({
  generationModel: z.string().nullable(),
  generatedAt: isoDateTime.nullable(),
  runs: z.array(
    z.object({
      step: GenerationStepSchema,
      passNumber: z.int(),
      status: JobStatusSchema,
      failedRules: z.array(z.string()).default([]),
      startedAt: isoDateTime.nullable(),
      finishedAt: isoDateTime.nullable(),
    }),
  ),
  editors: z.array(z.object({ userId: z.string(), name: z.string(), decisions: z.int() })),
})
export type AuthoringRecordView = Parsed<typeof AuthoringRecordViewSchema>

export const SeedRecordViewSchema = z.object({
  caseTitle: z.string(),
  publisher: z.string(),
  licenseTerms: z.string(),
  licensePermitsAdaptation: z.boolean(),
  seedText: z.string(),
  reskinLog: z.array(ReskinLogEntrySchema),
})
export type SeedRecordView = Parsed<typeof SeedRecordViewSchema>

export const VersionSummaryViewSchema = z.object({
  id: z.uuid(),
  version: z.int(),
  status: PackageStatusSchema,
  calibrationStatus: CalibrationStatusSchema,
  confirmedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
})
export type VersionSummaryView = Parsed<typeof VersionSummaryViewSchema>

/** A row of the packages list (07 §6, UI-040). */
export const PackageSummaryViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  familyKey: z.string(),
  discipline: z.string(),
  latestVersion: VersionSummaryViewSchema.nullable(),
  versionCount: z.int(),
  warnings: z.array(PackageWarningSchema),
  updatedAt: isoDateTime,
})
export type PackageSummaryView = Parsed<typeof PackageSummaryViewSchema>

export const PackageViewSchema = PackageSummaryViewSchema.extend({
  createdAt: isoDateTime,
  versions: z.array(VersionSummaryViewSchema),
})
export type PackageView = Parsed<typeof PackageViewSchema>

/** How many of each element the version holds; the version header reads it (UI-044). */
export const ElementCountsSchema = z.object({
  documents: z.int(),
  stakeholders: z.int(),
  answerSpacePositions: z.int(),
  namedFields: z.int(),
  claims: z.int(),
  variants: z.int(),
  defenseQuestions: z.int(),
  readinessItems: z.int(),
})
export type ElementCounts = Parsed<typeof ElementCountsSchema>

/**
 * `GET /package-versions/{versionId}` (FR-180, FR-195, FR-198). `seedRecord` is null for every
 * actor who may not read it — TAs, students and reviewers outside the institution (FR-028, D-117).
 */
export const PackageVersionViewSchema = z.object({
  id: z.uuid(),
  packageId: z.uuid(),
  packageTitle: z.string(),
  familyKey: z.string(),
  version: z.int(),
  status: PackageStatusSchema,
  calibrationStatus: CalibrationStatusSchema,
  conceptSet: z.array(z.string()),
  brief: z.string(),
  workingClockSeconds: z.int(),
  turnDelaySeconds: z.int(),
  difficultyProfile: DifficultyProfileSchema,
  generalEscalationReply: z.string(),
  debriefCounterfactual: z.string(),
  teachingNoteChecked: z.boolean(),
  confirmedAt: isoDateTime.nullable(),
  confirmedBy: z.string().nullable(),
  counts: ElementCountsSchema,
  confirmationRecord: z.array(ElementConfirmationViewSchema),
  authoringRecord: AuthoringRecordViewSchema,
  measures: AuthoringMeasuresSchema,
  validation: ValidationResultSchema,
  warnings: z.array(PackageWarningSchema),
  seedRecord: SeedRecordViewSchema.nullable(),
  /**
   * True when the reader is admitted to the measures and nothing else (08 §4: the program lead's
   * row reads "✓ org (measures only)"). The withheld fields are empty rather than absent, so one
   * shape serves the endpoint; the flag is what lets a screen say so instead of rendering a package
   * with no brief.
   */
  restricted: z.boolean(),
  capabilities: z.object({
    canEdit: z.boolean(),
    canConfirm: z.boolean(),
    /** False until Phase 12 adds generation; the workspace hides the regenerate buttons. */
    canRegenerate: z.boolean(),
  }),
})
export type PackageVersionView = Parsed<typeof PackageVersionViewSchema>

/** One variant's reading of a claim, as the claim object view shows it (FR-180). */
export const ClaimStateViewSchema = z.object({
  variantId: z.uuid(),
  variantKey: VariantKeySchema,
  evidenceStatus: EvidenceStatusSchema,
  failureFamily: FailureFamilySchema.nullable(),
  warrantedStance: StanceSchema,
  planted: z.boolean(),
  verificationPaths: VerificationPathsSchema,
})
export type ClaimStateView = Parsed<typeof ClaimStateViewSchema>

/**
 * `GET /package-versions/{versionId}/claims/{claimId}` (FR-180): everything the claim is, what it
 * deserved, and how it could have been checked. Reviewers and authors only — a student who could
 * read this would be reading the answer key.
 */
export const ClaimObjectViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  text: z.string(),
  sourceKind: ClaimSourceSchema,
  source: z
    .object({
      documentId: z.uuid(),
      key: z.string(),
      title: z.string(),
      author: z.string(),
      datedOn: isoDate,
      passage: z.string(),
    })
    .nullable(),
  importance: ClaimImportanceSchema,
  consequenceLevel: ConsequenceLevelSchema,
  verificationCost: VerificationCostSchema,
  weaklySourced: z.boolean(),
  volatile: z.boolean(),
  conceptKey: z.string(),
  carriedValues: z.array(CarriedValueSchema),
  triggerPhrases: z.array(z.string()),
  triggerDescription: z.string(),
  escalatable: z.boolean(),
  escalationReply: z.string().nullable(),
  rationale: z.string(),
  states: z.array(ClaimStateViewSchema),
  confirmation: ElementConfirmationViewSchema.nullable(),
})
export type ClaimObjectView = Parsed<typeof ClaimObjectViewSchema>

/** `POST /institutions/{orgId}/packages` and the import route return the ids they created. */
export const CreatedPackageViewSchema = z.object({
  packageId: z.uuid(),
  versionId: z.uuid(),
})
export type CreatedPackageView = Parsed<typeof CreatedPackageViewSchema>

export const ImportedPackageViewSchema = CreatedPackageViewSchema.extend({
  validation: ValidationResultSchema,
})
export type ImportedPackageView = Parsed<typeof ImportedPackageViewSchema>

/**
 * What a student may read of a package (`getStudentScenario`): the brief, the documents as the
 * Evidence Room *lists* them, and the named fields the brief asks for. Nothing else — no roles,
 * no stakeholders, no claims, no answer space (D-117).
 *
 * **A document body is not here.** FR-022 records which documents a student opened, in what order
 * and for how long, and this shape is what the workspace reads when the room is drawn: a list
 * carrying nine bodies would hand over the whole room in one response, and every `document_open`
 * event written afterwards would be describing a click rather than a read. The body comes from
 * `runs.openDocument`, which writes that event in the transaction that returns it (D-243).
 */
export const StudentScenarioViewSchema = z.object({
  brief: z.string(),
  documents: z.array(
    z.object({
      id: z.uuid(),
      key: z.string(),
      title: z.string(),
      author: z.string(),
      datedOn: isoDate,
    }),
  ),
  namedFields: z.array(z.object({ key: z.string(), label: z.string(), unit: ValueUnitSchema })),
})
export type StudentScenarioView = Parsed<typeof StudentScenarioViewSchema>
