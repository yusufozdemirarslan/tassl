// The exported trace document (docs/prd/Tassl-PRD.md §12 "The exportable event trace";
// docs/tech/10-backend-spec-modules.md §10; FR-240 to FR-243, FR-170, D-136).
//
// One file per run, in two forms. Both carry the same four parts — `header`, `events`,
// `claim_table`, `computed` — and every key in all four is `snake_case`, because the export is a
// data artefact an instructor files rather than a view a screen renders (D-136). API JSON elsewhere
// stays camelCase; the two conventions meet at the route, and nothing rewrites the document on the
// way out.
//
// **The two forms.** The `course` form carries the run's `weight`, the band `mapping` and the
// `points` they produce, because the instructor enters them in the gradebook of record (PRD §7.19).
// The `record` form is the copy the student's Judgment Record holds, and it omits those three at
// every depth (FR-170, FR-243): the header `policy` reduces to `{ outside_ai_policy }`, and the
// `policy_displayed` event payload to `{ outside_ai_policy, run_type, counts_statement }`. Nothing
// enforces that by deleting keys — every object here is a `strictObject`, so a course-form key in a
// record-form document is a parse error rather than a leak nobody noticed.
//
// **The record form is also a student view** (12-security.md §8), which is the second difference
// between the forms and the one 10 §10 did not name. Its event payloads are projected through
// `owner-view.ts` at the `scored` tier, so the five fields 12 §8.1 forbids a student in *any*
// state — a reviewer's `delegation.flags`, `decision_locked.speed_outlier`, the bank's
// `defense_question.question_id` and `selecting_event_seq`, and the Turn's `window_claim_ids` —
// are not in the file the student downloads. The claim table is carried whole in both forms,
// because FR-240 puts it in the record and 12 §8.2 names the record's claim table as the surface
// that reveals `failure_family` after scoring (D-370).
//
// Enumerations that already exist on a payload schema are taken from it (`.shape.x`) rather than
// restated, so a stance added to the run's trace cannot be missing from its export. The rest mirror
// `src/server/db/schema/enums.ts`, restated for the same reason `schema.ts` restates them: a module
// file below `schema.ts` may reach `src/lib` and nothing else.
import { z } from 'zod'
import { fieldPolicyFor } from './owner-view'
import {
  ActionPayloadSchema,
  ClaimUsedPayloadSchema,
  EVENT_PAYLOAD_SCHEMAS,
  LifecyclePayloadSchema,
  PolicyDisplayedPayloadSchema,
  RUN_EVENT_TYPES,
  StanceSetPayloadSchema,
  type RunEventTypeValue,
} from './schema'

// ---------------------------------------------------------------------------------------------
// Document version and the build's additions to the PRD's event list (FR-241)
// ---------------------------------------------------------------------------------------------

/** `computed.export_version`: the shape of this document, not the run's data. */
export const TRACE_EXPORT_VERSION = 1

/**
 * The event types PRD §12 names in "The exportable event trace", in its order.
 *
 * Everything the build added to that list is declared in the header as `x_tassl_extensions`
 * (FR-241), and the extension list is *derived* from this one rather than written beside it: a
 * thirty-third event type added to `RUN_EVENT_TYPES` announces itself in every export from the
 * first one, instead of waiting for somebody to remember two lists.
 */
const PRD_EVENT_TYPES: readonly RunEventTypeValue[] = [
  'readiness_item',
  'document_open',
  'document_close',
  'frame_locked',
  'delegation',
  'claim_used',
  'stance_set',
  'action',
  'escalation',
  'outside_tool_declared',
  'pause',
  'resume',
  'lock_refused',
  'decision_locked',
  'brief_opened',
  'brief_closed',
  'addendum',
  'turn_delivered',
  'turn_response_locked',
  'defense_question',
  'defense_answer',
  'draft_band',
  'band_decision',
  'claim_neutralized',
  'run_voided',
  'debrief_opened',
  'debrief_answer',
]

/**
 * The event types this build records that PRD §12 does not list (FR-241): `policy_displayed`,
 * `lifecycle`, `readiness_skipped`, `run_reoffered` and `probe_fired`. The header carries them so a
 * reader of the file can tell an extension from a type they have missed.
 */
export const X_TASSL_EXTENSIONS: readonly RunEventTypeValue[] = RUN_EVENT_TYPES.filter(
  (type) => !PRD_EVENT_TYPES.includes(type),
)

/** Which of the two documents (10 §10). */
export type TraceExportForm = 'course' | 'record'

// ---------------------------------------------------------------------------------------------
// Shared field shapes
// ---------------------------------------------------------------------------------------------

const uuid = z.uuid()
const isoDate = z.iso.datetime()

/** Taken from the payload schemas, so the export and the trace can never name different values. */
const RunStateEnum = LifecyclePayloadSchema.shape.to
const StanceEnum = StanceSetPayloadSchema.shape.stance
const ActionTypeEnum = ActionPayloadSchema.shape.type
const ReliedOnViaEnum = ClaimUsedPayloadSchema.shape.via
const OutsideAiPolicyEnum = PolicyDisplayedPayloadSchema.shape.outside_ai_policy
const MappingShape = PolicyDisplayedPayloadSchema.shape.mapping

/** `scenario_variants.key` (06 §3.2). */
const VariantKeyEnum = z.enum(['defective', 'sound'])
/** `runs.mode` (06 §3.4); the build runs every run in `standard` (PRD §12 step 3). */
const RunModeEnum = z.enum(['guided', 'standard', 'open'])
/** `run_readiness_results.concepts[].status` (06 §3.4, FR-012). */
const ReadinessStatusEnum = z.enum(['held', 'not_held', 'unknown'])
/** `element_confirmations.element_type` (06 §3.3). */
const ElementTypeEnum = z.enum([
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
])
/** `element_confirmations.decision` (06 §3.3). */
const ConfirmationDecisionEnum = z.enum(['confirmed', 'edited', 'rejected'])
/** `variant_claim_states.evidence_status` and `.failure_family` (06 §3.2). */
const EvidenceStatusEnum = z.enum(['sound', 'defective'])
const FailureFamilyEnum = z.enum([
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
])
/** `scenario_claims.importance` and `.consequence_level` (06 §3.2). */
const ImportanceEnum = z.enum(['load_bearing', 'supporting'])
const ConsequenceLevelEnum = z.enum(['low', 'medium', 'high'])

// ---------------------------------------------------------------------------------------------
// The header (FR-240)
// ---------------------------------------------------------------------------------------------

/** One element the disciplinary authority decided on before any student saw the scenario (FR-192). */
const ConfirmationEntrySchema = z.strictObject({
  element_type: ElementTypeEnum,
  /** Null for a singleton element (the brief, the counterfactual, the clock). */
  element_id: uuid.nullable(),
  decision: ConfirmationDecisionEnum,
  /** The confirmer's organization role; null when they hold no membership row any more. */
  decided_by_role: z.string().nullable(),
  decided_at: isoDate,
})

/** FR-012: the Readiness Check result as a list of concepts, each held, not held, or unknown. */
const ReadinessEntrySchema = z.strictObject({
  concept_key: z.string().min(1),
  status: ReadinessStatusEnum,
})

/** One lifecycle transition and when it happened (PRD §8 lifecycle table). */
const TransitionSchema = z.strictObject({ state: RunStateEnum, at: isoDate })

/**
 * The policy the run start screen displayed (FR-201), read back from the `policy_displayed` event
 * rather than recomputed from the course: the header says what the student was shown, and the
 * course's mapping may have moved since (FR-203).
 *
 * The record form is the same object with `weight` and `mapping` gone (FR-170).
 */
const CoursePolicySchema = z.strictObject({
  outside_ai_policy: OutsideAiPolicyEnum.nullable(),
  weight: z.number().nullable(),
  mapping: MappingShape.nullable(),
})

const RecordPolicySchema = z.strictObject({
  outside_ai_policy: OutsideAiPolicyEnum.nullable(),
})

function headerSchema(form: TraceExportForm) {
  return z.strictObject({
    run_id: uuid,
    package_id: uuid,
    package_version: z.int().min(1),
    variant_key: VariantKeyEnum,
    mode: RunModeEnum,
    package_confirmation_record: z.array(ConfirmationEntrySchema),
    policy: form === 'course' ? CoursePolicySchema : RecordPolicySchema,
    working_clock_seconds: z.int().min(0),
    /** PRD §12: the build's clock is a hypothesis, and the file says so wherever it is read. */
    working_clock_uncalibrated: z.literal(true),
    readiness: z.array(ReadinessEntrySchema),
    transitions: z.array(TransitionSchema),
    is_walkthrough: z.boolean(),
    x_tassl_extensions: z.array(z.enum(RUN_EVENT_TYPES)),
  })
}

// ---------------------------------------------------------------------------------------------
// The events (FR-241)
// ---------------------------------------------------------------------------------------------

/**
 * The record form's payload for one event type: the course payload without the fields
 * `owner-view.ts` marks `reviewer_only`, and — for `policy_displayed` alone — without `weight` and
 * `mapping` (FR-243).
 *
 * The mask is read from the same table `ownerPayload` picks with, so the schema and the builder
 * cannot disagree about what a student's copy contains: one of them would have to be changed
 * without the other, and neither would compile against a field nobody classified.
 */
function recordPayloadSchema(type: RunEventTypeValue): z.ZodObject {
  const base: z.ZodObject = EVENT_PAYLOAD_SCHEMAS[type]
  const mask: Record<string, true> = {}
  for (const [key, visibility] of Object.entries(fieldPolicyFor(type) ?? {})) {
    if (visibility === 'reviewer_only') mask[key] = true
  }
  if (type === 'policy_displayed') {
    mask.weight = true
    mask.mapping = true
  }
  return Object.keys(mask).length === 0 ? base : base.omit(mask as never)
}

/**
 * One event as the file carries it: PRD §12's "a sequence number, a wall-clock timestamp, clock
 * remaining, and a payload", plus the `type` that says which payload it is.
 *
 * The actor id is deliberately absent. Nothing in the PRD's list asks for it, every event of a run
 * is either the student's or the system's, and an export is a file that leaves Tassl — a user id in
 * it is PII the document has no use for (12 §6.1).
 */
function eventSchemaFor(type: RunEventTypeValue, form: TraceExportForm) {
  return z.strictObject({
    seq: z.int().min(1),
    type: z.literal(type),
    occurred_at: isoDate,
    /** Null outside the working period and the Turn window (D-042). */
    clock_remaining_ms: z.int().nullable(),
    payload: form === 'course' ? EVENT_PAYLOAD_SCHEMAS[type] : recordPayloadSchema(type),
  })
}

function eventsSchema(form: TraceExportForm) {
  const options = RUN_EVENT_TYPES.map((type) => eventSchemaFor(type, form))
  return z.array(
    z.discriminatedUnion('type', options as unknown as [z.ZodObject, ...z.ZodObject[]]),
  )
}

// ---------------------------------------------------------------------------------------------
// The claim table (FR-240) — present in both forms, because the PRD says the record carries it
// ---------------------------------------------------------------------------------------------

/**
 * One row per consequential claim in the run's variant, surfaced or not (D-107).
 *
 * `readiness_context` is per row (10 §10): the Readiness Check's verdict on the concept this claim
 * teaches, which is what FR-015 puts beside the row in the debrief. `claim_version` is the package
 * version the claim was frozen at, so a row can be read against the scenario it came from.
 */
const ClaimTableRowSchema = z.strictObject({
  claim_id: uuid,
  claim_version: z.int().min(1),
  key: z.string().min(1),
  evidence_status: EvidenceStatusEnum,
  failure_family: FailureFamilyEnum.nullable(),
  importance: ImportanceEnum,
  consequence_level: ConsequenceLevelEnum,
  warranted_stance: StanceEnum,
  /** Null when the claim never surfaced, or surfaced and was never stanced (D-107). */
  stance_taken: StanceEnum.nullable(),
  stance_taken_at: isoDate.nullable(),
  previous_stance: StanceEnum.nullable(),
  /** The interrogation actions run on this claim, in the order they were run. */
  actions: z.array(ActionTypeEnum),
  relied_on: z.boolean(),
  relied_on_via: z.array(ReliedOnViaEnum),
  neutralized: z.boolean(),
  inconsistency_credited: z.boolean(),
  readiness_context: z.strictObject({
    concept_key: z.string().min(1),
    /** `unknown` when the Readiness Check was skipped or never reached this concept. */
    status: ReadinessStatusEnum,
  }),
})

// ---------------------------------------------------------------------------------------------
// The computed block (FR-240)
// ---------------------------------------------------------------------------------------------

function computedSchema(form: TraceExportForm) {
  const shape = {
    /** Confidence at the frame, at the lock, and after the Turn (FR-132). */
    confidence: z.strictObject({
      frame: z.int().min(0).max(100).nullable(),
      lock: z.int().min(0).max(100).nullable(),
      turn: z.int().min(0).max(100).nullable(),
    }),
    /**
     * FR-134, with all consequential claims in the run as its denominator. Computed by the stance
     * matrix and written to `run_scores` by the scoring job; null until the run is scored.
     */
    false_challenge_rate: z.number().min(0).max(1).nullable(),
    /** The rubric the bands were drafted against; null until the run is scored. */
    rubric_version: z.string().min(1).nullable(),
    exported_at: isoDate,
    export_version: z.int().min(1),
  }
  return form === 'course'
    ? z.strictObject({
        ...shape,
        /**
         * The run's points under the displayed mapping (FR-202). Confirmed points only: 10 §11.4
         * keeps `points_draft` out of every export, because a draft band never reaches a gradebook.
         */
        points: z.number().nullable(),
      })
    : z.strictObject(shape)
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

/**
 * The four parts, named as `openapi.yaml`'s `TraceExport` component names them: `header`, `events`,
 * `claims`, `computed`. 10 §10 and the PRD call the third one the claim *table*, which is what it
 * is; the key stays `claims` because the API contract was written with it and a rename would be a
 * breaking change to a document nobody needed changed.
 */
function traceExportSchemaFor(form: TraceExportForm) {
  return z.strictObject({
    header: headerSchema(form),
    events: eventsSchema(form),
    claims: z.array(ClaimTableRowSchema),
    computed: computedSchema(form),
  })
}

/**
 * The instructor's copy: weight, mapping and points included (PRD §7.19).
 *
 * `.meta({ id })` names the schema in `components/schemas`, so the two export endpoints reference
 * one definition instead of inlining a thousand lines of event payloads each.
 */
export const CourseTraceExportSchema = traceExportSchemaFor('course').meta({
  id: 'TraceExportCourseForm',
})

/** The student's copy: those three nowhere, at any depth (FR-170, FR-243). */
export const RecordTraceExportSchema = traceExportSchemaFor('record').meta({
  id: 'TraceExportRecordForm',
})

/** The schema of one form. `10 §17`'s `TraceExportSchema` is the pair of them. */
export function traceExportSchema(form: TraceExportForm) {
  return form === 'course' ? CourseTraceExportSchema : RecordTraceExportSchema
}

/**
 * Either form, for a reader that accepts a file without being told which it is (`openapi.yaml`'s
 * `TraceExport`). It is a union rather than one widened object on purpose: a document is valid only
 * if it is entirely one form or entirely the other, and a course header beside a record computed
 * block matches neither.
 */
export const TraceExportSchema = z.union([CourseTraceExportSchema, RecordTraceExportSchema])

export type CourseTraceExport = z.infer<typeof CourseTraceExportSchema>
export type RecordTraceExport = z.infer<typeof RecordTraceExportSchema>
export type TraceExport = CourseTraceExport | RecordTraceExport
export type TraceExportClaimRow = z.infer<typeof ClaimTableRowSchema>
