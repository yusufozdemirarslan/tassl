// Wire contract of the `review` module (docs/tech/10-backend-spec-modules.md §12, §17;
// 07-api-spec.md §8). One Zod schema per input, shared by the route, the Server Action and the form
// that submits it; one schema per view, which the route validates against before serializing.
//
// Like every module schema this file carries no server import, so a Server Component may read its
// types and a Client Component never imports it (D-186). That is also why the large documents the
// replay bundle carries — the four graphs, the package view, the claim object views, the defense
// transcript, the delegations' unverified numbers — are declared here as plain JSON objects rather
// than restated field by field: each is owned, built and validated by the module whose tables it
// comes from (`scoring`, `scenarios`, `defense`, `assistant`), a module schema may reach nothing but
// `src/lib` (04 §2), and a second copy here would be a second thing to keep true. It is the same
// choice `07-api-spec.md`'s own `ReplayBundle` makes with `additionalProperties: true`, and the
// service's `ReplayBundle` type names the real shape for the screens that read it.
//
// **Nothing in this file is a student payload.** Every shape here carries warranted stances,
// evidence status, failure families, planted flags and expected-answer notes, because the replay is
// the reviewer's view of the answer key; `getReplay` is gated by `requireRunReviewer` and no student
// route reaches any of it (12 §8.1).
import { z } from 'zod'

/** Every run-addressed route of this module (07 §8's `/review/runs/{runId}/…`). */
export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export type RunIdParams = z.infer<typeof RunIdParamsSchema>

/** `runs.state` and `run_bands.dimension` restated; a module schema imports nothing but `src/lib`. */
export const DimensionSchema = z.enum([
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
export type DimensionValue = z.infer<typeof DimensionSchema>

export const BandSchema = z.enum(['novice', 'developing', 'proficient', 'professional'])
export type BandValue = z.infer<typeof BandSchema>

export const BandDecisionKindSchema = z.enum(['confirmed', 'overridden', 'unassessed'])
export type BandDecisionKind = z.infer<typeof BandDecisionKindSchema>

/** `PUT /review/runs/{runId}/bands/{dimension}` addresses one dimension of one run. */
export const BandParamsSchema = z.object({ runId: z.uuid(), dimension: DimensionSchema })
export type BandParams = z.infer<typeof BandParamsSchema>

export const ClaimParamsSchema = z.object({ runId: z.uuid(), claimId: z.uuid() })
export type ClaimParams = z.infer<typeof ClaimParamsSchema>

export const DelegationParamsSchema = z.object({ runId: z.uuid(), delegationId: z.uuid() })
export type DelegationParams = z.infer<typeof DelegationParamsSchema>

export const SectionIdParamsSchema = z.object({ sectionId: z.uuid() })
export type SectionIdParams = z.infer<typeof SectionIdParamsSchema>

/** How long the free text on a decision or a correction may be (10 §17). */
export const NOTE_MAX_CHARS = 1000

/**
 * What arming the test control answers (07 §8).
 *
 * A literal `true` rather than a boolean: the endpoint has one outcome, and a refusal is an error
 * envelope (`TEST_CONTROLS_DISABLED`, FORBIDDEN, NOT_FOUND) rather than `{ armed: false }`. A shape
 * that could say "no" would invite a caller to read the answer instead of the status.
 */
export const ForcedFailureSchema = z.object({ armed: z.literal(true) })
export type ForcedFailure = z.infer<typeof ForcedFailureSchema>

// ---------------------------------------------------------------------------------------------
// The band decision (FR-181, FR-182; 10 §17 `BandDecisionSchema`)
// ---------------------------------------------------------------------------------------------

/**
 * `PUT /review/runs/{runId}/bands/{dimension}` (07 §8).
 *
 * `band` is required for `overridden` and refused for `unassessed`, and the rule is applied in the
 * service rather than here so that it holds for every caller and answers `BAND_DECISION_INVALID`
 * rather than a shape error (D-287). `confirmed` takes the draft, so a band sent with it is
 * ignored: the whole meaning of confirming is that the reviewer is not choosing a band.
 *
 * **The note is optional and stays optional** (FR-182: "an override requires no justification"). It
 * is the one thing the student reads about the decision, and a field that had to be filled would be
 * filled with something.
 */
export const BandDecisionInputSchema = z.object({
  decision: BandDecisionKindSchema,
  band: BandSchema.optional(),
  note: z.string().trim().max(NOTE_MAX_CHARS).optional(),
})
export type BandDecisionInput = z.infer<typeof BandDecisionInputSchema>

/**
 * `POST /review/runs/{runId}/manual-bands` (07 §8, FR-140): a band or `unassessed` per dimension.
 *
 * Every one of the seven is required. A held run has no draft to fall back on for the dimensions
 * the reviewer skipped, and a partial hand-banding would leave a run in `scored` with dimensions
 * that hold neither a band nor a reason — which is the exact state FR-004 forbids.
 */
export const ManualBandsInputSchema = z.object({
  bands: z.record(DimensionSchema, z.union([BandSchema, z.literal('unassessed')])),
})
export type ManualBandsInput = z.infer<typeof ManualBandsInputSchema>

/**
 * `POST /review/runs/{runId}/claims/{claimId}/neutralize` (07 §8, FR-003; 10 §17 `NeutralizeSchema`).
 *
 * `creditChallenge` is D-092's checkbox — "credit the student's challenge as correct" — and marks
 * the run claim `inconsistency_credited`, which counts the row as a match in Verification and
 * Calibration for that run only. It is required rather than defaulted: an instructor entering a
 * correction has to say whether the student was right, and a silent `false` would answer for them.
 */
export const NeutralizeReasonSchema = z.enum([
  'unintended_defect',
  'wrong_verification_result',
  'misbehaving_material',
  'adaptation_failed',
  'record_lost',
  'other',
])
export type NeutralizeReasonValue = z.infer<typeof NeutralizeReasonSchema>

export const NeutralizeInputSchema = z.object({
  reason: NeutralizeReasonSchema,
  creditChallenge: z.boolean(),
  note: z.string().trim().max(NOTE_MAX_CHARS).default(''),
})
export type NeutralizeInput = z.infer<typeof NeutralizeInputSchema>

/** `POST /review/runs/{runId}/delegations/{delegationId}/flag` (07 §8, FR-055). */
export const FlagDelegationInputSchema = z.object({ flag: z.literal('out_of_scenario') })
export type FlagDelegationInput = z.infer<typeof FlagDelegationInputSchema>

// ---------------------------------------------------------------------------------------------
// The replay bundle (07 §8, §10; UI-033)
// ---------------------------------------------------------------------------------------------

/**
 * A document another module owns, carried through this one unchanged.
 *
 * See the file header: the shape is validated where it is built, and this module's schema may not
 * import the schema that describes it. The route still declares an object, so a handler that
 * answered a string or a number would be caught.
 */
const foreignDocument = z.record(z.string(), z.unknown())

/** One concept of the Readiness Check as the replay lists it (FR-012, UI-033's `ConceptMap`). */
export const ReplayConceptSchema = z.object({
  conceptKey: z.string().min(1),
  status: z.enum(['held', 'not_held', 'unknown']),
})
export type ReplayConcept = z.infer<typeof ReplayConceptSchema>

/**
 * One outside-tool declaration, beside the policy the course had set when it was made (FR-061).
 *
 * The policy travels with the declaration rather than beside the run because that is the only way
 * the sentence reads correctly: "declared, and this course asks for declarations" is a different
 * fact from "declared, and this course said in-environment only". Nothing Tassl observes is
 * treated as misconduct (PRD §7 standing rules), and this pair is what lets the replay say so
 * without the reviewer having to look the policy up.
 */
export const ReplayDeclarationSchema = z.object({
  purpose: z.string(),
  at: z.iso.datetime(),
  coursePolicy: z.enum(['open', 'declared', 'in_environment_only']),
})
export type ReplayDeclaration = z.infer<typeof ReplayDeclarationSchema>

/** One figure the assistant asserted with no source behind it (D-068), for the faculty seat alone. */
export const ReplayUnverifiedNumberSchema = z.object({
  delegationId: z.uuid(),
  value: z.string(),
  context: z.string(),
})
export type ReplayUnverifiedNumber = z.infer<typeof ReplayUnverifiedNumberSchema>

/** One correction entered on the run (DATA-044), newest first. */
export const ReplayNeutralizationSchema = z.object({
  id: z.uuid(),
  claimId: z.uuid(),
  reason: NeutralizeReasonSchema,
  creditChallenge: z.boolean(),
  note: z.string(),
  createdAt: z.iso.datetime(),
})
export type ReplayNeutralization = z.infer<typeof ReplayNeutralizationSchema>

/** One filed course export, as the replay and UI-035 list it (FR-184). */
export const ReplayExportSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  assignmentId: z.uuid(),
  version: z.int().min(1),
  reason: z.enum(['initial', 'override', 'neutralization', 'mapping_change', 'unassessed']),
  createdAt: z.iso.datetime(),
})
export type ReplayExport = z.infer<typeof ReplayExportSchema>

/**
 * What this seat may do on this run (07 §8's `capabilities`).
 *
 * It is the permission matrix of 08 §4 answered once, on the server, so the screen draws what the
 * reviewer can actually press rather than offering a control that will refuse. `canDecide` is true
 * for an instructor and a TA alike; whether *this* band is theirs to change is a per-dimension
 * question the band's own `decidedByInstructor` answers, because a TA may decide the six an
 * instructor has not touched.
 */
export const ReplayCapabilitiesSchema = z.object({
  canDecide: z.boolean(),
  canVoid: z.boolean(),
  canNeutralize: z.boolean(),
  canForceFailure: z.boolean(),
  canBandManually: z.boolean(),
  isInstructor: z.boolean(),
})
export type ReplayCapabilities = z.infer<typeof ReplayCapabilitiesSchema>

/**
 * Appendix A.0's standing label, and the walkthrough's (FR-141, FR-235).
 *
 * `uncalibrated` is always true in this build and is on the wire anyway: every band is a
 * descriptive draft until the pilot calibrates the rubric, and a screen that had to remember to say
 * so would one day forget.
 */
export const ReplayLabelsSchema = z.object({
  uncalibrated: z.boolean(),
  isWalkthrough: z.boolean(),
})
export type ReplayLabels = z.infer<typeof ReplayLabelsSchema>

/**
 * `courses.mapping` restated: what each band is worth in this course's gradebook (FR-202).
 *
 * It is on the replay because UI-033's points sentence shows the arithmetic rather than asserting a
 * number, and the arithmetic is the mapping applied to the seven bands on the page. A module schema
 * may import nothing but `src/lib` (04 §2), so the four keys are written out here as they are in
 * `debrief/schema.ts`; `scoring`'s `BandMapping` is the type they satisfy.
 */
export const ReplayMappingSchema = z.object({
  novice: z.number(),
  developing: z.number(),
  proficient: z.number(),
  professional: z.number(),
})
export type ReplayMapping = z.infer<typeof ReplayMappingSchema>

/**
 * The course's arithmetic over this run's bands (FR-202, FR-203, D-091, D-445).
 *
 * The figures are priced from the bands the replay is carrying, through the same
 * `scoring.priceBands` the confirmation and the mapping change write with, rather than read back
 * from `run_scores`: a neutralization on a confirmed run raises a band and writes the two
 * correction columns without rewriting `points_confirmed`, so the stored figure can name a number
 * the bands beside it no longer support. One arithmetic over the seven bands on the page is the
 * only way the screen and the exported file cannot disagree.
 */
/**
 * Which set of bands the total was priced from, so a screen showing the arithmetic shows the terms
 * the total was actually computed over.
 *
 * FR-005's floor is what makes this necessary: after a correction the run keeps the *higher* of the
 * pre- and post-correction totals, so on a run where the correction lowered nothing the effective
 * figure is priced over the bands as they stood *before* it. A page that printed the effective
 * bands beside that total would print a sum that does not add up — on the one panel whose whole
 * purpose is that the figure can be checked rather than taken on trust.
 */
export const ReplayPointsBasisSchema = z.enum([
  'draft',
  'confirmed',
  'before_correction',
  'after_correction',
])
export type ReplayPointsBasisValue = z.infer<typeof ReplayPointsBasisSchema>

export const ReplayPointsSchema = z.object({
  mapping: ReplayMappingSchema,
  /** Which bands `effective ?? confirmed ?? draft` was priced from. */
  basis: ReplayPointsBasisSchema,
  /** How many of the seven dimensions the arithmetic divides by (FR-202). */
  assessed: z.int().min(0),
  draft: z.number().nullable(),
  confirmed: z.number().nullable(),
  effective: z.number().nullable(),
})
export type ReplayPoints = z.infer<typeof ReplayPointsSchema>

/**
 * What the pipeline and the run recorded about *how the run went*, as UI-033's flags panel lists it.
 *
 * One flat list rather than three raw records, because the three live in three tables — `runs.flags`
 * (FR-018, FR-118, FR-125), `run_scores.flags` (FR-141) and the locked brief's `speed_outlier`
 * (FR-106) — and a screen that read all three would be deciding which keys are observations. It is
 * the service that knows; the screen labels what it is handed.
 *
 * **None of these is a finding about a person.** Nothing Tassl observes is treated as misconduct
 * (PRD §7 standing rules): each names something that happened in the run, and the panel that draws
 * them says so.
 */
export const ReplayObservationSchema = z.enum([
  'nothing_answered',
  'all_novice',
  'all_professional',
  'speed_outlier',
  'readiness_submit_failed',
  'forced_failure_armed',
])
export type ReplayObservationValue = z.infer<typeof ReplayObservationSchema>

export const ReplayBundleSchema = z.object({
  run: foreignDocument,
  events: z.array(foreignDocument),
  graphs: foreignDocument.nullable(),
  defense: z.array(foreignDocument),
  bands: z.array(foreignDocument),
  delegations: z.array(foreignDocument),
  readiness: z.array(ReplayConceptSchema),
  package: foreignDocument,
  claims: z.array(foreignDocument),
  declarations: z.array(ReplayDeclarationSchema),
  unverifiedNumbers: z.array(ReplayUnverifiedNumberSchema),
  neutralizations: z.array(ReplayNeutralizationSchema),
  exports: z.array(ReplayExportSchema),
  points: ReplayPointsSchema,
  /**
   * Who decided each band, by id: their display name, and whether they hold the instructor role on
   * this section. `run_bands.decided_by` is a user id, which is neither of the two things a screen
   * needs from it (08 §4's TA rule, and the colleague's name).
   */
  deciders: z.record(z.string(), z.object({ name: z.string(), isInstructor: z.boolean() })),
  /** `runs.flags` — instructor observations, forbidden in every student payload (12 §8.1). */
  flags: z.record(z.string(), z.unknown()),
  /** The same observations, named and de-duplicated across the three tables that hold them. */
  observations: z.array(ReplayObservationSchema),
  labels: ReplayLabelsSchema,
  capabilities: ReplayCapabilitiesSchema,
})

/** What `PUT /review/runs/{runId}/bands/{dimension}` answers (07 §8). */
export const BandDecisionResultSchema = z.object({
  band: foreignDocument,
  run: foreignDocument,
})

/** What `POST /review/runs/{runId}/claims/{claimId}/neutralize` answers (07 §8). */
export const NeutralizeResultSchema = z.object({
  recompute: z.object({
    dimensions: z.array(DimensionSchema),
    bandsBefore: z.partialRecord(DimensionSchema, BandSchema.nullable()),
    bandsAfter: z.partialRecord(DimensionSchema, BandSchema.nullable()),
    bandsEffective: z.partialRecord(DimensionSchema, BandSchema.nullable()),
    pointsBefore: z.number().nullable(),
    pointsAfter: z.number().nullable(),
    pointsEffective: z.number().nullable(),
  }),
  run: foreignDocument,
  exportVersion: z.int().min(1).nullable(),
})
export type NeutralizeResultView = z.infer<typeof NeutralizeResultSchema>

/**
 * `GET /review/queue` (07 §8, FR-186, D-096).
 *
 * Two lists that are never mixed. `illustrative` is the static sample of PRD §12, rendered only
 * inside the labelled wrapper (D-035), and `runs` is the real scored runs of the actor's own
 * sections. A screen that merged them would be a screen where a reviewer cannot tell which rows are
 * about their students.
 */
export const ReviewQueueSchema = z.object({
  illustrative: z.array(foreignDocument),
  runs: z.array(foreignDocument),
})
