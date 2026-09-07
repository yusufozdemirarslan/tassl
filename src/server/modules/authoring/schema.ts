// Validation schemas and wire shapes of the `authoring` module (docs/tech/10-backend-spec-modules.md
// §5; 07-api-spec.md §6 rows `POST/GET /package-versions/{versionId}/generation` and
// `POST /package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate`).
//
// A module schema may import `src/lib` and nothing else (04 §2), which is what makes it readable
// from a Server Component. So the two vocabularies this file shares with `scenarios` — the seven
// generation steps and the four job statuses — are restated here rather than imported, exactly as
// `scenarios/schema.ts` restates the Postgres enums it needs. The copies cannot drift silently:
// `tests/integration/authoring/pipeline.test.ts` drives the pipeline through both.
import { z } from 'zod'

type Parsed<T extends z.ZodType> = z.infer<T>

/** `generation_runs.step` (06 §3.3 DATA-027), in the order the pipeline runs them (11 §2.1). */
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
export type GenerationStepValue = Parsed<typeof GenerationStepSchema>

/** `generation_runs.status`, the `job_status` enum (06 §3.3). */
export const GENERATION_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export const GenerationRunStatusSchema = z.enum(GENERATION_RUN_STATUSES)
export type GenerationRunStatusValue = Parsed<typeof GenerationRunStatusSchema>

/** 10 §5: exactly one retry per step, with the failed rules restated in the prompt input. */
export const MAX_GENERATION_PASSES = 2

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/**
 * `regenerateElement`'s body (07 §6). `restatedRule` is the author's own sentence about what is
 * wrong with the element they rejected; it travels into the prompt through the same channel a
 * failed validation rule does (`gen.ts` `restatedRulesSection`), because from the model's side they
 * are the same thing — a rule this answer has to satisfy that the last one did not.
 */
export const RegenerateElementSchema = z.object({
  restatedRule: z.string().trim().min(1).max(2000).optional(),
})
export type RegenerateElementInput = Parsed<typeof RegenerateElementSchema>

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/** One run of one step: what it cost, what it broke, and whether it is still going (DATA-027). */
export const GenerationRunViewSchema = z.object({
  id: z.uuid(),
  step: GenerationStepSchema,
  passNumber: z.int(),
  status: GenerationRunStatusSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  inputTokens: z.int().nullable(),
  outputTokens: z.int().nullable(),
  costEstimateUsd: z.number().nullable(),
  failedRules: z.array(z.string()),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type GenerationRunView = Parsed<typeof GenerationRunViewSchema>

/**
 * The generation status screen's read (UI-042, 07 §6 `GenerationStatus`).
 *
 * `steps` is one row per step of the pipeline whatever has happened to it, so the screen can draw
 * the seven in order rather than only the ones that have started: a step nothing has run for is
 * reported `queued` with pass 1 and no numbers. `validation` is the whole package's rule report,
 * which is empty of failures until step 7 has run and is what the "generation complete" notice
 * carries (10 §5).
 */
export const GenerationStatusViewSchema = z.object({
  packageVersionId: z.uuid(),
  packageId: z.uuid(),
  version: z.int(),
  /** `running` while any step is queued or running; otherwise the pipeline's own outcome. */
  state: z.enum(['not_started', 'running', 'failed', 'complete']),
  steps: z.array(
    z.object({
      step: GenerationStepSchema,
      status: GenerationRunStatusSchema,
      passNumber: z.int(),
      inputTokens: z.int().nullable(),
      outputTokens: z.int().nullable(),
      costEstimateUsd: z.number().nullable(),
      failedRules: z.array(z.string()),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  runs: z.array(GenerationRunViewSchema),
  validation: z.object({ ok: z.boolean(), failures: z.array(z.string()) }),
})
export type GenerationStatusView = Parsed<typeof GenerationStatusViewSchema>

/** `POST /package-versions/{versionId}/generation` (07 §6): 202 with nothing else to say. */
export const StartGenerationViewSchema = z.object({ started: z.boolean() })
export type StartGenerationView = Parsed<typeof StartGenerationViewSchema>

/**
 * `POST …/elements/{elementType}/{elementId}/regenerate` (07 §6): the work that was queued.
 *
 * `jobId` is the `generation_runs` row, not the pg-boss job. The queue's id does not exist until
 * after the transaction that guards the enqueue has committed — enqueueing inside it would start a
 * drain while the version row's lock is still held, and the job it started would wait on that lock
 * for ever — and the run row is the id `getGenerationStatus` addresses the work by anyway (D-533).
 */
export const RegenerateElementViewSchema = z.object({
  jobId: z.string(),
  step: GenerationStepSchema,
})
export type RegenerateElementView = Parsed<typeof RegenerateElementViewSchema>

/**
 * FR-198's operating measures, as 10 §5 spells `computeAuthoringMeasures`. The package version view
 * publishes the same five fields (`scenarios/schema.ts` restates the shape, which is the seam a
 * module boundary leaves), and the two extra counters here are what `package_confirmed` reports:
 * how many generation runs there were and how deep the deepest retry went (17 §3.2).
 */
export const AuthoringMeasuresSchema = z.object({
  seedToConfirmedMs: z.number().nullable(),
  editRate: z.number(),
  rejectedShare: z.number(),
  generationPasses: z.int(),
  generationMaxPass: z.int(),
  reviewMsPerElement: z.number().nullable(),
  elementsCount: z.int(),
  reviewMsTotal: z.int(),
})
export type AuthoringMeasures = Parsed<typeof AuthoringMeasuresSchema>
