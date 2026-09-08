// The seven generation steps as a table (docs/tech/10-backend-spec-modules.md §5; 11 §2.1; AI-001).
//
// One row per step, and every row answers four questions the pipeline asks of it:
//
//   1. **Which prompt.** The `gen-*` prompt of 11 §2.1, with its own input and output schemas.
//   2. **What it is given.** `buildInput` projects the version as it currently stands onto that
//      prompt's input. Step 1 is the only step handed the seed text; every later step reads what an
//      earlier one wrote, which is why the prompts wrap their inputs as untrusted (`gen.ts`).
//   3. **Which elements it owns.** The element types it replaces — and therefore the ones whose
//      *confirmed* rows it must leave alone (FR-192, and the single most damaging thing to get
//      wrong: an author who has signed three documents keeps those three).
//   4. **Which rules it is held to.** Its subset of `validatePackage`'s table. A step that breaks
//      one of them is re-enqueued once with the rule's own sentence restated in the prompt input.
//
// The seven subsets partition `validatePackage`'s rules exactly: every code appears in one step and
// no code appears twice, which `tests/unit/authoring/steps.test.ts` asserts against
// `VALIDATION_RULE_CODES` so a rule added to the validator cannot go unowned. The count is left to
// that assertion rather than written out here — the sentence said thirty-one while the table held
// thirty-two, which is what a hand-copied number does.
//
// This file is pure. It reads no database and calls no provider: the rows are read and written by
// `service.ts`, because an internal module file may not reach a repository (04 §2). What it takes
// is a structural view of the version — the same shape `validate.ts` takes for the same reason.
import type { LlmMessage } from '@/server/llm/provider'
import type { GenerationStepValue } from '@/server/modules/authoring/schema'
import type { ValidationRuleCode } from '@/server/modules/scenarios/validate'
import { genAnswerSpaceFieldsPrompt } from '@/server/llm/prompts/gen-answer-space-fields'
import {
  DEFAULT_PLANTED_FAMILY,
  genClaimsStatesPrompt,
} from '@/server/llm/prompts/gen-claims-states'
import { genDocumentsPrompt } from '@/server/llm/prompts/gen-documents'
import { genQuestionBankAndCounterfactualPrompt } from '@/server/llm/prompts/gen-question-bank-and-counterfactual'
import { genReadinessItemsPrompt } from '@/server/llm/prompts/gen-readiness-items'
import { genReskinBriefStakeholdersPrompt } from '@/server/llm/prompts/gen-reskin-brief-stakeholders'
import { genTurnProbePrompt } from '@/server/llm/prompts/gen-turn-probe'
import { GENERATION_STEPS } from '@/server/modules/authoring/schema'
import type { ElementTypeValue } from '@/server/modules/scenarios/schema'

/** The pipeline, in order: each step enqueues the next on success (10 §5). */
export const GENERATION_STEP_ORDER = GENERATION_STEPS

/** The step after this one, or null when this was the last (step 7 runs `validatePackage`). */
export function nextStep(step: GenerationStepValue): GenerationStepValue | null {
  const index = GENERATION_STEP_ORDER.indexOf(step)
  return GENERATION_STEP_ORDER[index + 1] ?? null
}

// ---------------------------------------------------------------------------------------------
// What a step is given (a structural view of the version, like `validate.ts`'s)
// ---------------------------------------------------------------------------------------------

export type StepSourceDocument = {
  key: string
  title: string
  author: string
  datedOn: string
  role: string
  body: string
}

export type StepSourceStakeholder = {
  key: string
  name: string
  roleTitle: string
  positionStatement: string
}

export type StepSourcePosition = { key: string; kind: string; summary: string }
export type StepSourceNamedField = { key: string; label: string; unit: string }
export type StepSourceClaim = {
  key: string
  text: string
  importance: string
  consequenceLevel: string
  conceptKey: string
  failureFamilies: string[]
}

/** Everything any of the seven prompts reads off the version as it currently stands. */
export type StepSource = {
  conceptSet: readonly string[]
  brief: string
  seed: { seedText: string; licenseTerms: string } | null
  reskinLog: readonly { kind: string; from: string; to: string }[]
  stakeholders: readonly StepSourceStakeholder[]
  documents: readonly StepSourceDocument[]
  positions: readonly StepSourcePosition[]
  namedFields: readonly StepSourceNamedField[]
  claims: readonly StepSourceClaim[]
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

/**
 * As much of `Prompt<I, O>` as a step needs; the seven prompts satisfy it as written.
 *
 * `output` is left `unknown` rather than a `ZodType<unknown>`: a Zod schema is invariant in its
 * input, so the seven concrete schemas do not widen, and the runner casts once at the one place it
 * hands the schema to `structured()`. `render` answers with the *validated* input as well as the
 * messages, which is what the mock provider is given as `promptInput` — the same string the model
 * read, after the untrusted normalisation the prompt applied (D-265).
 */
export type StepPrompt = {
  name: string
  version: number
  output: unknown
  render(rawInput: unknown): { messages: LlmMessage[]; input: unknown }
  /**
   * The call budget the prompt declares for itself, when the environment's defaults are wrong for it
   * (D-666). Optional here as it is on `Prompt`, so a prompt that says nothing keeps
   * `LLM_MAX_OUTPUT_TOKENS` and `LLM_TIMEOUT_MS`; all seven generation prompts say something,
   * because a step writes a package element in a job rather than a reply a student is waiting on.
   */
  maxOutputTokens?: number
  timeoutMs?: number
}

export type StepDefinition = {
  step: GenerationStepValue
  prompt: StepPrompt
  /** The element types this step replaces; a confirmed element of one of them survives it. */
  elementTypes: readonly ElementTypeValue[]
  /** The step's subset of `validatePackage` (10 §5, "runs the step's validation subset"). */
  rules: readonly ValidationRuleCode[]
  buildInput: (source: StepSource, restatedRules: readonly string[]) => Record<string, unknown>
}

const define = (definition: StepDefinition): StepDefinition => definition

export const GENERATION_STEP_DEFINITIONS: Record<GenerationStepValue, StepDefinition> = {
  reskin_brief_stakeholders: define({
    step: 'reskin_brief_stakeholders',
    prompt: genReskinBriefStakeholdersPrompt,
    elementTypes: ['brief', 'stakeholder', 'seed_reskin'],
    rules: ['BRIEF_TOO_LONG', 'STAKEHOLDER_NO_CONTRADICTION', 'RESKIN_LOG_EMPTY'],
    buildInput: (source, restatedRules) => ({
      seedText: source.seed?.seedText ?? '',
      conceptSet: [...source.conceptSet],
      licenseTerms: source.seed?.licenseTerms ?? '',
      restatedRules: [...restatedRules],
    }),
  }),

  documents: define({
    step: 'documents',
    prompt: genDocumentsPrompt,
    elementTypes: ['document'],
    rules: [
      'DOCUMENT_COUNT',
      'DOCUMENT_TOO_LONG',
      'DOCUMENT_ROLES_MISSING',
      'STAKEHOLDER_NO_DOCUMENT',
    ],
    buildInput: (source, restatedRules) => ({
      brief: source.brief,
      stakeholders: source.stakeholders.map((stakeholder) => ({
        key: stakeholder.key,
        name: stakeholder.name,
        roleTitle: stakeholder.roleTitle,
        positionStatement: stakeholder.positionStatement,
      })),
      reskinLog: source.reskinLog.map((entry) => ({
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
      })),
      conceptSet: [...source.conceptSet],
      restatedRules: [...restatedRules],
    }),
  }),

  answer_space_fields: define({
    step: 'answer_space_fields',
    prompt: genAnswerSpaceFieldsPrompt,
    elementTypes: ['answer_space_position', 'named_field'],
    rules: [
      'ANSWER_SPACE_SINGLE',
      'ANSWER_SPACE_NO_INCONSISTENT',
      'ANSWER_SPACE_NO_MINIMUM',
      'NAMED_FIELDS_MISSING',
    ],
    buildInput: (source, restatedRules) => ({
      brief: source.brief,
      // The prompt's own schema cuts the body to its first 300 words (11 §2.1), so the cut is the
      // text the model actually reads rather than one this file guessed at.
      documents: source.documents.map((document) => ({
        key: document.key,
        title: document.title,
        excerpt: document.body,
      })),
      restatedRules: [...restatedRules],
    }),
  }),

  claims_and_states: define({
    step: 'claims_and_states',
    prompt: genClaimsStatesPrompt,
    elementTypes: ['claim', 'variant_claim_state', 'general_escalation_reply'],
    rules: [
      'CLAIMS_TOO_FEW',
      'CLAIM_STATE_MISSING',
      'DEFECTIVE_VARIANT_PLANT',
      'VARIANTS_DIFFER_BEYOND_PLANT',
      'VARIANT_ACTIONS_DIFFER',
      'PLANTED_PATH_MISSING',
      'TRACE_DOCUMENT_MISSING',
      'DEFECT_OUTSIDE_CONCEPTS',
      'DEFECT_NOT_CONSEQUENTIAL',
      'NO_STANCE_CHANGING_TRACE',
      'NO_ESCALATABLE_CLAIM',
      'NO_LOW_STAKES_SOUND',
      'NO_ACCEPT_WARRANTED_SOUND',
      'WARRANTED_STANCE_UNSET',
      'CLAIM_CONCEPT_UNKNOWN',
      'GENERAL_REPLY_MISSING',
    ],
    buildInput: (source, restatedRules) => ({
      brief: source.brief,
      documents: source.documents.map((document) => ({
        key: document.key,
        title: document.title,
        author: document.author,
        datedOn: document.datedOn,
        role: document.role,
        body: document.body,
      })),
      positions: source.positions.map((position) => ({
        key: position.key,
        kind: position.kind,
        summary: position.summary,
      })),
      namedFields: source.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
      conceptSet: [...source.conceptSet],
      plantedFamily: DEFAULT_PLANTED_FAMILY,
      restatedRules: [...restatedRules],
    }),
  }),

  turn_and_probe: define({
    step: 'turn_and_probe',
    prompt: genTurnProbePrompt,
    // The Turn's delay is a version column, not a column of `scenario_turns` (06 §3.3), and
    // `TURN_DELAY` reads it there — so the clock element is one this step writes.
    elementTypes: ['turn', 'probe', 'clock_and_difficulty'],
    rules: ['TURN_MISSING', 'TURN_DELAY'],
    buildInput: (source, restatedRules) => ({
      brief: source.brief,
      claims: source.claims.map((claim) => ({
        key: claim.key,
        text: claim.text,
        importance: claim.importance,
        consequenceLevel: claim.consequenceLevel,
      })),
      positions: source.positions.map((position) => ({
        key: position.key,
        kind: position.kind,
        summary: position.summary,
      })),
      assumptionKeys: source.namedFields.map((field) => field.key),
      restatedRules: [...restatedRules],
    }),
  }),

  question_bank_and_counterfactual: define({
    step: 'question_bank_and_counterfactual',
    prompt: genQuestionBankAndCounterfactualPrompt,
    elementTypes: ['defense_question', 'counterfactual'],
    rules: [
      'QUESTION_BANK_INCOMPLETE',
      'QUESTION_TEMPLATE_PLACEHOLDER',
      'COUNTERFACTUAL_SENTENCES',
    ],
    buildInput: (source, restatedRules) => ({
      claims: source.claims.map((claim) => ({ key: claim.key, text: claim.text })),
      positions: source.positions.map((position) => ({
        key: position.key,
        kind: position.kind,
        summary: position.summary,
      })),
      namedFields: source.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
      restatedRules: [...restatedRules],
    }),
  }),

  readiness_items: define({
    step: 'readiness_items',
    prompt: genReadinessItemsPrompt,
    elementTypes: ['readiness_item'],
    rules: ['READINESS_SPLIT'],
    buildInput: (source, restatedRules) => {
      const defective = source.claims.filter((claim) => claim.failureFamilies.length > 0)
      return {
        conceptSet: [...source.conceptSet],
        defectConcepts: [...new Set(defective.map((claim) => claim.conceptKey))],
        failureFamiliesUsed: [...new Set(defective.flatMap((claim) => claim.failureFamilies))],
        claimTexts: source.claims.map((claim) => claim.text),
        restatedRules: [...restatedRules],
      }
    },
  }),
}

/** Every rule any step is held to, which is the whole of `validatePackage`'s table (10 §5). */
export const RULES_OWNED_BY_STEPS: readonly ValidationRuleCode[] = GENERATION_STEP_ORDER.flatMap(
  (step) => GENERATION_STEP_DEFINITIONS[step].rules,
)

/** The step that owns an element type: what `regenerateElement` re-runs for it (10 §5). */
export function stepOwningElement(elementType: ElementTypeValue): GenerationStepValue | null {
  for (const step of GENERATION_STEP_ORDER) {
    if (GENERATION_STEP_DEFINITIONS[step].elementTypes.includes(elementType)) return step
  }
  return null
}
