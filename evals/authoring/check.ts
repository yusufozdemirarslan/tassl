// The authoring eval suite (docs/tech/11-llm-integration.md §5, AI-001, AI-005, FR-191, D-064).
//
// Four licensed cases — a short one, a long one, one whose last page is a teaching note that gives
// away the answer, and one whose text addresses the model reading it — each run through the seven
// generation steps against `getProvider()`, in the order and with the inputs the pipeline gives
// them, and with the pipeline's own validation and retry around them (10 §5, §2.1). The seven
// answers are then
// assembled into the portable package document `importPackage` accepts and put through
// `validateExport`, which is `validatePackage` over the whole rule table of 10 §4.
//
// **Why the steps are run rather than the service.** `runGenerationStep` writes rows: it needs a
// version, a seed record, a tenant and the job queue. So this file does what the pipeline does to a
// provider and nothing it does to a database: render each prompt, ask, validate the answer against
// the prompt's output schema (`structured` does that, with one repair), run **the step's own subset
// of the rule table** over the package as the steps so far have written it, and — where that subset
// fails, or where the answer never came back — ask the step once more with the rules the last pass
// broke restated at the top of the prompt (D-676). Those last two are `writeAndValidate` and
// `recordOutcome`, and leaving them out measured a pipeline the product does not have: one pass per
// step with nothing restated, failing on rules production catches and fixes before the next step
// runs. The singleton key and the element reconciliation are still the integration test's
// (`tests/integration/authoring/pipeline.test.ts`), because they are about rows.
//
// **The checks are §5's, and they are properties rather than strings.** A real provider writes a
// different company, different documents and different numbers every run; what must be true is the
// same every run:
//
//   1. the package passes every rule of `validatePackage`;
//   2. the Evidence Room carries all three document roles PRD §7.2 requires;
//   3. there are at least six claims (PRD §7.18 (9));
//   4. the planted claim has a verification path a student could actually walk (Source Trace);
//   5. at least one sound claim is warranted Accept — a package where the right answer is always
//      to doubt teaches doubt, not judgment (PRD §7.18 (11));
//   6. the Readiness Check is 6 foundation, 4 defect-concept and 6 application items (AI-005);
//   7. no item repeats a claim of the package it belongs to (AI-005, `noItemNamesAClaim`);
//   8. the re-skin log is not empty — an adaptation that recorded no change is a copy (FR-028);
//   9. nothing a case says must not survive the re-skin appears anywhere outside the seed record,
//      which is what the third case is for: a teaching note names the trap, and a package that
//      carried it would hand the student the answer key inside the scenario.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { LlmProvider } from '@/server/llm/provider'
import { genAnswerSpaceFieldsPrompt } from '@/server/llm/prompts/gen-answer-space-fields'
import { genClaimsStatesPrompt } from '@/server/llm/prompts/gen-claims-states'
import { genDocumentsPrompt } from '@/server/llm/prompts/gen-documents'
import { genQuestionBankAndCounterfactualPrompt } from '@/server/llm/prompts/gen-question-bank-and-counterfactual'
import { genReadinessItemsPrompt } from '@/server/llm/prompts/gen-readiness-items'
import { genReskinBriefStakeholdersPrompt } from '@/server/llm/prompts/gen-reskin-brief-stakeholders'
import { genTurnProbePrompt } from '@/server/llm/prompts/gen-turn-probe'
// `./checks` rather than the module's index: the index is the service, which reaches the
// session and therefore `server-only`, and this runner is a script rather than a Server Component.
// `noItemNamesAClaim` is a pure function of two lists (10 §5), which is why it lives in its own file.
import { noItemNamesAClaim } from '@/server/modules/authoring/checks'
import { MAX_GENERATION_PASSES, type GenerationStepValue } from '@/server/modules/authoring/schema'
import { GENERATION_STEP_DEFINITIONS } from '@/server/modules/authoring/steps'
import {
  PACKAGE_EXPORT_SCHEMA_VERSION,
  PackageExportSchema,
  type PackageExport,
} from '@/server/modules/scenarios/schema'
import { validatePackage } from '@/server/modules/scenarios/validate'
import { toValidatedVersion, validateExport } from '@/server/modules/scenarios/validate-export'
import {
  EVAL_FEATURE,
  outputHash,
  type EvalCaseResult,
  type EvalCheck,
  type EvalSuite,
} from '../config'

const CASES_DIR = join(process.cwd(), 'evals', 'authoring', 'cases')

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  conceptSet: z.array(z.string().min(2)).min(4),
  licenseTerms: z.string().min(1),
  seedText: z.string().min(200),
  /** Words of the licensed case that must not survive the re-skin (FR-028, PRD §7.18). */
  mustNotAppear: z.array(z.string().min(1)).default([]),
})
export type AuthoringEvalCase = z.infer<typeof EvalCaseSchema>

export function loadCases(): AuthoringEvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => EvalCaseSchema.parse(JSON.parse(readFileSync(join(CASES_DIR, name), 'utf8'))))
}

// ---------------------------------------------------------------------------------------------
// The seven steps, as the pipeline gives them (10 §5 `GENERATION_STEP_DEFINITIONS`)
// ---------------------------------------------------------------------------------------------

/**
 * One step: render, ask, and take the answer the prompt's own output schema accepts.
 *
 * `raws` collects the raw text of each step so the case can be reported by the digest of what the
 * seven steps actually returned (§5, D-661). It is written to and never read here: nothing in this
 * file prints a word of it.
 */
async function ask<P extends { name: string; version: number }, T>(
  provider: LlmProvider,
  prompt: P & {
    render: (input: never) => {
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
      input: unknown
    }
    output: z.ZodType<T>
    maxOutputTokens?: number
    timeoutMs?: number
  },
  input: unknown,
  evalCase: AuthoringEvalCase,
  raws: string[],
): Promise<T> {
  const rendered = prompt.render(input as never)
  const result = await provider.structured<T>({
    feature: EVAL_FEATURE,
    promptName: prompt.name,
    promptVersion: prompt.version,
    messages: rendered.messages,
    promptInput: rendered.input,
    temperature: 0.2,
    // The prompt's own output ceiling and timeout, exactly as `runGenerationStep` passes them
    // (D-666). Without them the eval would measure a call the pipeline never makes: the sixty-second
    // default cut every one of these steps off on the first real-provider run.
    ...(prompt.maxOutputTokens === undefined ? {} : { maxOutputTokens: prompt.maxOutputTokens }),
    ...(prompt.timeoutMs === undefined ? {} : { timeoutMs: prompt.timeoutMs }),
    schema: prompt.output,
    schemaName: `${prompt.name}-output`,
    context: { requestId: `eval-authoring-${evalCase.id}-${prompt.name}` },
  })
  raws.push(result.raw)
  return result.value
}

type Steps = {
  one: z.infer<typeof genReskinBriefStakeholdersPrompt.output>
  two: z.infer<typeof genDocumentsPrompt.output>
  three: z.infer<typeof genAnswerSpaceFieldsPrompt.output>
  four: z.infer<typeof genClaimsStatesPrompt.output>
  five: z.infer<typeof genTurnProbePrompt.output>
  six: z.infer<typeof genQuestionBankAndCounterfactualPrompt.output>
  seven: z.infer<typeof genReadinessItemsPrompt.output>
}

/** Which of 10 §5's seven steps writes each of the seven answers, so the rules can be looked up. */
const STEP_OF: Record<keyof Steps, GenerationStepValue> = {
  one: 'reskin_brief_stakeholders',
  two: 'documents',
  three: 'answer_space_fields',
  four: 'claims_and_states',
  five: 'turn_and_probe',
  six: 'question_bank_and_counterfactual',
  seven: 'readiness_items',
}

/**
 * The pipeline's own retry, in the eval (D-676).
 *
 * `runGenerationStep` does three things around a model call that the eval used to do none of:
 * after the answer is written it runs **the step's own subset** of `validatePackage`
 * (`writeAndValidate`), a failing subset — or a throw the answer never came back from — closes the
 * pass out as failed, and `recordOutcome` enqueues **exactly one more pass** with the rules the
 * last one broke restated at the top of the prompt (`gen.ts` `restatedRulesSection`,
 * `MAX_GENERATION_PASSES`). Every one of the seven prompts takes `restatedRules` for that reason,
 * and `tests/integration/authoring/pipeline.test.ts` proves the path against Postgres on the very
 * rule the eval kept failing on, `STAKEHOLDER_NO_DOCUMENT`.
 *
 * Running one pass per step with `restatedRules: []` therefore measured a pipeline the product does
 * not have. An eval easier than production is worthless; an eval *harder* than production fails on
 * things no author will ever see, and then the failures cannot be told apart from the ones that
 * matter. So this runs what `runGenerationStep` runs.
 *
 * Two differences from production, both deliberate. A step whose second pass also fails is left in
 * place rather than stopping the run, because the eval's job is to report every property of the
 * finished package rather than to protect a database; the final `passes_validate_package` reports
 * what is still broken. And there is no `generationRetryable` check, because neither failure it
 * excludes — an exhausted budget, an open circuit — is a thing a suite that got that far is in.
 */
type Pipeline = {
  provider: LlmProvider
  evalCase: AuthoringEvalCase
  raws: string[]
  steps: Partial<Steps>
}

/** The step's subset of the rule table, over the package as the steps so far have written it. */
function subsetFailures(pipeline: Pipeline, key: keyof Steps): { code: string; message: string }[] {
  const rules: readonly string[] = GENERATION_STEP_DEFINITIONS[STEP_OF[key]].rules
  const version = toValidatedVersion(buildDocument(pipeline.steps, pipeline.evalCase))
  return validatePackage(version).failures.filter((failure) => rules.includes(failure.code))
}

async function pass<K extends keyof Steps>(
  pipeline: Pipeline,
  key: K,
  prompt: Parameters<typeof ask>[1],
  buildInput: (restatedRules: readonly string[]) => unknown,
): Promise<Steps[K]> {
  let restatedRules: readonly string[] = []
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= MAX_GENERATION_PASSES
    try {
      const answer = (await ask(
        pipeline.provider,
        prompt,
        buildInput(restatedRules),
        pipeline.evalCase,
        pipeline.raws,
      )) as Steps[K]
      pipeline.steps[key] = answer
      const failures = subsetFailures(pipeline, key)
      if (failures.length === 0 || last) return answer
      // The messages rather than the codes, because the validator's sentence names the elements at
      // fault and the codes alone would tell the model nothing it could act on (D-522).
      restatedRules = failures.map((failure) => failure.message)
    } catch (error) {
      if (last) throw error
      restatedRules = [error instanceof Error ? error.message : String(error)]
    }
  }
}

async function runSteps(
  provider: LlmProvider,
  evalCase: AuthoringEvalCase,
  raws: string[],
): Promise<Steps> {
  const conceptSet = [...evalCase.conceptSet]
  const pipeline: Pipeline = { provider, evalCase, raws, steps: {} }

  // Step 1 is the only step given the seed text (§2.1): everything after it reads the brief step 1
  // wrote, which is what makes the re-skin the pipeline's own rather than the case's.
  const one = await pass(pipeline, 'one', genReskinBriefStakeholdersPrompt, (restatedRules) => ({
    seedText: evalCase.seedText,
    conceptSet,
    licenseTerms: evalCase.licenseTerms,
    restatedRules: [...restatedRules],
  }))

  const two = await pass(pipeline, 'two', genDocumentsPrompt, (restatedRules) => ({
    brief: one.brief,
    stakeholders: one.stakeholders.map((stakeholder) => ({
      key: stakeholder.key,
      name: stakeholder.name,
      roleTitle: stakeholder.roleTitle,
      positionStatement: stakeholder.positionStatement,
    })),
    reskinLog: one.reskinLog.map((entry) => ({
      kind: entry.kind,
      from: entry.from,
      to: entry.to,
    })),
    conceptSet,
    restatedRules: [...restatedRules],
  }))

  const three = await pass(pipeline, 'three', genAnswerSpaceFieldsPrompt, (restatedRules) => ({
    brief: one.brief,
    documents: two.documents.map((document) => ({
      key: document.key,
      title: document.title,
      excerpt: document.body,
    })),
    restatedRules: [...restatedRules],
  }))

  const four = await pass(pipeline, 'four', genClaimsStatesPrompt, (restatedRules) => ({
    brief: one.brief,
    documents: two.documents.map((document) => ({
      key: document.key,
      title: document.title,
      author: document.author,
      datedOn: document.datedOn,
      role: document.role,
      body: document.body,
    })),
    positions: three.positions.map((position) => ({
      key: position.key,
      kind: position.kind,
      summary: position.summary,
    })),
    namedFields: three.namedFields.map((field) => ({
      key: field.key,
      label: field.label,
      unit: field.unit,
    })),
    conceptSet,
    restatedRules: [...restatedRules],
  }))

  const five = await pass(pipeline, 'five', genTurnProbePrompt, (restatedRules) => ({
    brief: one.brief,
    claims: four.claims.map((claim) => ({
      key: claim.key,
      text: claim.text,
      importance: claim.importance,
      consequenceLevel: claim.consequenceLevel,
    })),
    positions: three.positions.map((position) => ({
      key: position.key,
      kind: position.kind,
      summary: position.summary,
    })),
    assumptionKeys: three.namedFields.map((field) => field.key),
    restatedRules: [...restatedRules],
  }))

  const six = await pass(
    pipeline,
    'six',
    genQuestionBankAndCounterfactualPrompt,
    (restatedRules) => ({
      claims: four.claims.map((claim) => ({ key: claim.key, text: claim.text })),
      positions: three.positions.map((position) => ({
        key: position.key,
        kind: position.kind,
        summary: position.summary,
      })),
      namedFields: three.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
      restatedRules: [...restatedRules],
    }),
  )

  const defective = four.claims.filter((claim) => claim.defective.failureFamily !== null)
  const seven = await pass(pipeline, 'seven', genReadinessItemsPrompt, (restatedRules) => ({
    conceptSet,
    defectConcepts: [...new Set(defective.map((claim) => claim.conceptKey))],
    failureFamiliesUsed: [
      ...new Set(
        defective.flatMap((claim) =>
          claim.defective.failureFamily === null ? [] : [claim.defective.failureFamily],
        ),
      ),
    ],
    claimTexts: four.claims.map((claim) => claim.text),
    restatedRules: [...restatedRules],
  }))

  return { one, two, three, four, five, six, seven }
}

// ---------------------------------------------------------------------------------------------
// The package the seven answers make (SYS-026), which is what the rule table is run over
// ---------------------------------------------------------------------------------------------

/**
 * The document the seven answers make, tolerant of the ones that have not been written yet.
 *
 * Partial because the pipeline validates a step against the version *as it then stands* — after
 * step 2 the version holds a brief, its stakeholders and its documents and nothing else — and the
 * eval mirrors that (D-676). `toValidatedVersion` maps rather than parses, so a document with empty
 * arrays where later steps will write is a version `validatePackage` runs over happily; every rule
 * that needs an element the step has not reached fails, and `subsetFailures` keeps only the rules
 * the step owns. `assemble` is the same object once, parsed, at the end.
 */
function buildDocument(steps: Partial<Steps>, evalCase: AuthoringEvalCase): PackageExport {
  const [contradicting, contradicted] = steps.one?.contradictionPair ?? ['', '']
  const claims = steps.four?.claims ?? []

  return {
    schemaVersion: PACKAGE_EXPORT_SCHEMA_VERSION,
    package: {
      title: `${steps.one?.company ?? ''} — ${steps.one?.market ?? ''}`,
      familyKey: `eval-${evalCase.id}`,
      discipline: 'marketing_strategy',
    },
    version: {
      conceptSet: [...evalCase.conceptSet],
      brief: steps.one?.brief ?? '',
      workingClockSeconds: 1500,
      turnDelaySeconds: steps.five?.turn.delaySeconds ?? 0,
      difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
      generalEscalationReply: steps.four?.generalEscalationReply ?? '',
      debriefCounterfactual: steps.six?.counterfactual ?? '',
    },
    seedRecord: {
      caseTitle: evalCase.title,
      publisher: 'An eval case publisher',
      licenseTerms: evalCase.licenseTerms,
      licensePermitsAdaptation: true,
      seedText: evalCase.seedText,
      reskinLog: steps.one?.reskinLog ?? [],
    },
    documents: steps.two?.documents ?? [],
    stakeholders: (steps.one?.stakeholders ?? []).map((stakeholder) => ({
      ...stakeholder,
      contradictsStakeholderKey: stakeholder.key === contradicting ? contradicted : null,
      contradictionPoint:
        stakeholder.key === contradicting ? (steps.one?.contradictionPoint ?? null) : null,
    })),
    answerSpacePositions: steps.three?.positions ?? [],
    namedFields: steps.three?.namedFields ?? [],
    claims: claims.map((claim) => ({
      key: claim.key,
      text: claim.text,
      sourceKind: claim.sourceKind,
      sourceDocumentKey: claim.sourceDocumentKey,
      sourcePassage: claim.sourcePassage,
      importance: claim.importance,
      consequenceLevel: claim.consequenceLevel,
      verificationCost: claim.verificationCost,
      weaklySourced: claim.weaklySourced,
      volatile: claim.volatile,
      conceptKey: claim.conceptKey,
      carriedValues: claim.carriedValues,
      triggerPhrases: claim.triggerPhrases,
      triggerDescription: claim.triggerDescription,
      escalatable: claim.escalatable,
      escalationReply: claim.escalationReply,
      rationale: claim.rationale,
      position: claim.position,
    })),
    variants: [
      {
        key: 'defective',
        label: 'Defective',
        claimStates: claims.map((claim) => ({
          claimKey: claim.key,
          // Read off the family rather than taken on trust: a state that named a family without
          // being defective would be a defect nobody planted.
          evidenceStatus: claim.defective.failureFamily === null ? 'sound' : 'defective',
          failureFamily: claim.defective.failureFamily,
          warrantedStance: claim.defective.warrantedStance,
          planted: claim.defective.plantedTrue,
          verificationPaths: claim.defective.verificationPaths,
        })),
      },
      {
        key: 'sound',
        label: 'Sound',
        claimStates: claims.map((claim) => ({
          claimKey: claim.key,
          evidenceStatus: 'sound',
          failureFamily: null,
          warrantedStance: claim.sound.warrantedStance,
          planted: false,
          verificationPaths: claim.sound.verificationPaths,
        })),
      },
    ],
    probe: steps.five?.probe ?? null,
    turn:
      steps.five === undefined
        ? null
        : {
            text: steps.five.turn.text,
            voice: steps.five.turn.voice,
            stakeholderKey: steps.five.turn.stakeholderKey,
            warrantsChange: steps.five.turn.warrantsChange,
            proportionateResponse: steps.five.turn.proportionateResponse,
            evidence: steps.five.turn.evidence,
            disruptedAssumptionKeys: steps.five.turn.disruptedAssumptionKeys,
            windowClaimKeys: steps.five.turn.windowClaimKeys,
          },
    defenseQuestions: steps.six?.questions ?? [],
    readinessItems: steps.seven?.items ?? [],
  } as PackageExport
}

/** The finished document, parsed: what `validateExport` and the property checks are run over. */
function assemble(steps: Steps, evalCase: AuthoringEvalCase): PackageExport {
  const parsed = PackageExportSchema.safeParse(buildDocument(steps, evalCase))
  if (!parsed.success) {
    // The path and the issue *code*, never the issue message: a Zod message can quote the value it
    // rejected, and an unrecognised-key message names a key the model invented (D-661). A path and
    // a code say which field of which element was wrong, which is what a prompt fix needs.
    throw new Error(
      `GENERATED_PACKAGE_UNPARSEABLE: ${parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.')} ${issue.code}`)
        .join('; ')}`,
    )
  }
  return parsed.data as PackageExport
}

// ---------------------------------------------------------------------------------------------
// The properties (§5)
// ---------------------------------------------------------------------------------------------

const check = (name: string, ok: boolean, detail?: string): EvalCheck =>
  ok ? { name, ok } : { name, ok: false, ...(detail === undefined ? {} : { detail }) }

/** Every document role PRD §7.2 requires in the room, whatever else is in it. */
const REQUIRED_ROLES = ['superseded', 'interpretation_as_fact', 'irrelevant'] as const

/**
 * The Readiness Check's fixed split (AI-005, PRD §7.6): six items on the concepts the run needs,
 * four on the concepts the planted defect turns on, six on what the assistant does and does not do.
 * The third category is `ai_behavior` — the "application" of §5's shorthand is applying a concept
 * to the assistant, and `READINESS_CATEGORIES` is the authority on its name.
 */
const ITEM_SPLIT: Record<string, number> = {
  foundation: 6,
  defect_concept: 4,
  ai_behavior: 6,
}

function checksFor(document: PackageExport, evalCase: AuthoringEvalCase): EvalCheck[] {
  const validation = validateExport(document)

  const roles = new Set(document.documents.map((row) => row.role))
  const missingRoles = REQUIRED_ROLES.filter((role) => !roles.has(role))

  const defective = document.variants.find((variant) => variant.key === 'defective')
  const planted = (defective?.claimStates ?? []).filter((state) => state.planted)
  const plantedPaths = planted.filter(
    (state) => Object.values(state.verificationPaths ?? {}).filter(Boolean).length > 0,
  )

  const sound = document.variants.find((variant) => variant.key === 'sound')
  const acceptable = (sound?.claimStates ?? []).filter(
    (state) => state.evidenceStatus === 'sound' && state.warrantedStance === 'accept',
  )

  const counts = new Map<string, number>()
  for (const item of document.readinessItems) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }
  const splitWrong = Object.entries(ITEM_SPLIT).filter(
    ([category, wanted]) => (counts.get(category) ?? 0) !== wanted,
  )

  const echoes = noItemNamesAClaim(
    document.readinessItems.map((item) => ({ id: item.key, stem: item.stem })),
    document.claims.map((claim) => ({ id: claim.key, text: claim.text })),
  )

  // Everything but the seed record, which exists to hold the licensed case and its re-skin log.
  const outsideTheSeed = JSON.stringify({ ...document, seedRecord: null })
  const survived = evalCase.mustNotAppear
    .map((phrase, at) => ({ at, hit: outsideTheSeed.toLowerCase().includes(phrase.toLowerCase()) }))
    .filter((entry) => entry.hit)
    .map((entry) => `#${entry.at + 1}`)

  return [
    // The rule codes, not the rule messages: a `validatePackage` message quotes the brief's word
    // count, a claim's concept key, a stakeholder's key — package prose the model wrote, which §5
    // keeps out of the report (D-661). The code names the rule, and 10 §4 says what each one wants.
    check(
      'passes_validate_package',
      validation.ok,
      validation.failures.map((failure) => failure.code).join(', '),
    ),
    check(
      'document_roles_present',
      missingRoles.length === 0,
      `missing ${missingRoles.join(', ')} of ${document.documents.length} documents`,
    ),
    check('six_claims_or_more', document.claims.length >= 6, `${document.claims.length} claims`),
    check(
      'planted_claim_has_a_verification_path',
      planted.length > 0 && plantedPaths.length === planted.length,
      planted.length === 0
        ? 'the defective variant plants nothing'
        : `${planted.length - plantedPaths.length} planted claim(s) with no path a student could walk`,
    ),
    check(
      'a_sound_claim_is_warranted_accept',
      acceptable.length > 0,
      'no claim in the sound variant is warranted accept: the package teaches doubt, not judgment',
    ),
    check(
      'readiness_items_six_four_six',
      splitWrong.length === 0 && document.readinessItems.length === 16,
      splitWrong
        .map(([category, wanted]) => `${category} ${counts.get(category) ?? 0}, wanted ${wanted}`)
        .join('; '),
    ),
    check(
      'no_item_names_a_claim',
      echoes.ok,
      echoes.echoes.map((echo) => `${echo.itemId} echoes ${echo.claimId}`).join(', '),
    ),
    check(
      'reskin_log_not_empty',
      (document.seedRecord?.reskinLog.length ?? 0) > 0,
      'the adaptation recorded no change from the licensed case',
    ),
    // By position in the case's own `mustNotAppear` list, not by the phrase: the phrases are the
    // licensed case's proper nouns, they go into the prompt, and a report that printed them would
    // print the one thing the re-skin exists to remove (D-661).
    check(
      'licensed_case_did_not_survive_the_reskin',
      survived.length === 0,
      `mustNotAppear ${survived.join(', ')} still in the package`,
    ),
  ]
}

async function runCase(
  provider: LlmProvider,
  evalCase: AuthoringEvalCase,
): Promise<EvalCaseResult> {
  const raws: string[] = []
  // The digest of what the seven steps returned, in order (§5). Partial when a step threw, which is
  // itself informative: two runs that failed the same way at the same step share the digest.
  const hash = (): string | undefined => (raws.length === 0 ? undefined : outputHash(...raws))
  try {
    const steps = await runSteps(provider, evalCase, raws)
    const digest = hash()
    return {
      id: evalCase.id,
      title: evalCase.title,
      ...(digest === undefined ? {} : { outputHash: digest }),
      checks: checksFor(assemble(steps, evalCase), evalCase),
    }
  } catch (error) {
    // A step that would not answer at all is one failed case, not a crashed suite: the report says
    // which case and what the pipeline said about it. Both messages that reach here are written by
    // this repository — `LLM_OUTPUT_INVALID` names the prompt and the schema, and
    // `GENERATED_PACKAGE_UNPARSEABLE` names paths and issue codes — so neither carries model text.
    const digest = hash()
    return {
      id: evalCase.id,
      title: evalCase.title,
      ...(digest === undefined ? {} : { outputHash: digest }),
      checks: [
        check(
          'seven_steps_answered',
          false,
          `${raws.length} of 7 steps answered; ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
    }
  }
}

export const authoringSuite: EvalSuite = {
  name: 'authoring',
  async run(provider) {
    const results: EvalCaseResult[] = []
    // Sequentially: seven model calls a case, and the provider is rate-limited and budgeted.
    for (const evalCase of loadCases()) results.push(await runCase(provider, evalCase))
    return results
  },
}
