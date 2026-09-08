// The authoring eval suite (docs/tech/11-llm-integration.md §5, AI-001, AI-005, FR-191, D-064).
//
// Three licensed cases — a short one, a long one, and one whose last page is a teaching note that
// gives away the answer — each run through the seven generation steps against `getProvider()`, in
// the order and with the inputs the pipeline gives them (10 §5, §2.1). The seven answers are then
// assembled into the portable package document `importPackage` accepts and put through
// `validateExport`, which is `validatePackage` over the whole rule table of 10 §4.
//
// **Why the steps are run rather than the service.** `runGenerationStep` writes rows: it needs a
// version, a seed record, a tenant and the job queue. What the eval is measuring is the *model's*
// answers — and the pipeline's own behaviour around them (the retry, the singleton key, the
// element reconciliation) belongs to `tests/integration/authoring/pipeline.test.ts`, which proves
// it against Postgres. So this file does what the pipeline does to a provider and nothing it does
// to a database: render each prompt, ask, validate the answer against the prompt's output schema
// (`structured` does that, with one repair), and carry the answer forward as the next step's input.
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
import {
  PACKAGE_EXPORT_SCHEMA_VERSION,
  PackageExportSchema,
  type PackageExport,
} from '@/server/modules/scenarios/schema'
import { validateExport } from '@/server/modules/scenarios/validate-export'
import { EVAL_FEATURE, type EvalCaseResult, type EvalCheck, type EvalSuite } from '../config'

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

/** One step: render, ask, and take the answer the prompt's own output schema accepts. */
async function ask<P extends { name: string; version: number }, T>(
  provider: LlmProvider,
  prompt: P & {
    render: (input: never) => {
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
      input: unknown
    }
    output: z.ZodType<T>
  },
  input: unknown,
  evalCase: AuthoringEvalCase,
): Promise<T> {
  const rendered = prompt.render(input as never)
  const result = await provider.structured<T>({
    feature: EVAL_FEATURE,
    promptName: prompt.name,
    promptVersion: prompt.version,
    messages: rendered.messages,
    promptInput: rendered.input,
    temperature: 0.2,
    schema: prompt.output,
    schemaName: `${prompt.name}-output`,
    context: { requestId: `eval-authoring-${evalCase.id}-${prompt.name}` },
  })
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

async function runSteps(provider: LlmProvider, evalCase: AuthoringEvalCase): Promise<Steps> {
  const conceptSet = [...evalCase.conceptSet]

  // Step 1 is the only step given the seed text (§2.1): everything after it reads the brief step 1
  // wrote, which is what makes the re-skin the pipeline's own rather than the case's.
  const one = await ask(
    provider,
    genReskinBriefStakeholdersPrompt,
    {
      seedText: evalCase.seedText,
      conceptSet,
      licenseTerms: evalCase.licenseTerms,
      restatedRules: [],
    },
    evalCase,
  )

  const two = await ask(
    provider,
    genDocumentsPrompt,
    {
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
      restatedRules: [],
    },
    evalCase,
  )

  const three = await ask(
    provider,
    genAnswerSpaceFieldsPrompt,
    {
      brief: one.brief,
      documents: two.documents.map((document) => ({
        key: document.key,
        title: document.title,
        excerpt: document.body,
      })),
      restatedRules: [],
    },
    evalCase,
  )

  const four = await ask(
    provider,
    genClaimsStatesPrompt,
    {
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
      restatedRules: [],
    },
    evalCase,
  )

  const five = await ask(
    provider,
    genTurnProbePrompt,
    {
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
      restatedRules: [],
    },
    evalCase,
  )

  const six = await ask(
    provider,
    genQuestionBankAndCounterfactualPrompt,
    {
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
      restatedRules: [],
    },
    evalCase,
  )

  const defective = four.claims.filter((claim) => claim.defective.failureFamily !== null)
  const seven = await ask(
    provider,
    genReadinessItemsPrompt,
    {
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
      restatedRules: [],
    },
    evalCase,
  )

  return { one, two, three, four, five, six, seven }
}

// ---------------------------------------------------------------------------------------------
// The package the seven answers make (SYS-026), which is what the rule table is run over
// ---------------------------------------------------------------------------------------------

function assemble(steps: Steps, evalCase: AuthoringEvalCase): PackageExport {
  const [contradicting, contradicted] = steps.one.contradictionPair

  const document = {
    schemaVersion: PACKAGE_EXPORT_SCHEMA_VERSION,
    package: {
      title: `${steps.one.company} — ${steps.one.market}`,
      familyKey: `eval-${evalCase.id}`,
      discipline: 'marketing_strategy',
    },
    version: {
      conceptSet: [...evalCase.conceptSet],
      brief: steps.one.brief,
      workingClockSeconds: 1500,
      turnDelaySeconds: steps.five.turn.delaySeconds,
      difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
      generalEscalationReply: steps.four.generalEscalationReply,
      debriefCounterfactual: steps.six.counterfactual,
    },
    seedRecord: {
      caseTitle: evalCase.title,
      publisher: 'An eval case publisher',
      licenseTerms: evalCase.licenseTerms,
      licensePermitsAdaptation: true,
      seedText: evalCase.seedText,
      reskinLog: steps.one.reskinLog,
    },
    documents: steps.two.documents,
    stakeholders: steps.one.stakeholders.map((stakeholder) => ({
      ...stakeholder,
      contradictsStakeholderKey: stakeholder.key === contradicting ? contradicted : null,
      contradictionPoint: stakeholder.key === contradicting ? steps.one.contradictionPoint : null,
    })),
    answerSpacePositions: steps.three.positions,
    namedFields: steps.three.namedFields,
    claims: steps.four.claims.map((claim) => ({
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
        claimStates: steps.four.claims.map((claim) => ({
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
        claimStates: steps.four.claims.map((claim) => ({
          claimKey: claim.key,
          evidenceStatus: 'sound',
          failureFamily: null,
          warrantedStance: claim.sound.warrantedStance,
          planted: false,
          verificationPaths: claim.sound.verificationPaths,
        })),
      },
    ],
    probe: steps.five.probe,
    turn: {
      text: steps.five.turn.text,
      voice: steps.five.turn.voice,
      stakeholderKey: steps.five.turn.stakeholderKey,
      warrantsChange: steps.five.turn.warrantsChange,
      proportionateResponse: steps.five.turn.proportionateResponse,
      evidence: steps.five.turn.evidence,
      disruptedAssumptionKeys: steps.five.turn.disruptedAssumptionKeys,
      windowClaimKeys: steps.five.turn.windowClaimKeys,
    },
    defenseQuestions: steps.six.questions,
    readinessItems: steps.seven.items,
  }

  const parsed = PackageExportSchema.safeParse(document)
  if (!parsed.success) {
    throw new Error(
      `GENERATED_PACKAGE_UNPARSEABLE: ${parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
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
  const survived = evalCase.mustNotAppear.filter((phrase) =>
    outsideTheSeed.toLowerCase().includes(phrase.toLowerCase()),
  )

  return [
    check(
      'passes_validate_package',
      validation.ok,
      validation.failures.map((failure) => `${failure.code}: ${failure.message}`).join(' | '),
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
    check(
      'licensed_case_did_not_survive_the_reskin',
      survived.length === 0,
      `still in the package: ${survived.join(', ')}`,
    ),
  ]
}

async function runCase(
  provider: LlmProvider,
  evalCase: AuthoringEvalCase,
): Promise<EvalCaseResult> {
  try {
    const steps = await runSteps(provider, evalCase)
    return {
      id: evalCase.id,
      title: evalCase.title,
      checks: checksFor(assemble(steps, evalCase), evalCase),
    }
  } catch (error) {
    // A step that would not answer at all is one failed case, not a crashed suite: the report says
    // which case and what the pipeline said about it.
    return {
      id: evalCase.id,
      title: evalCase.title,
      checks: [
        check(
          'seven_steps_answered',
          false,
          error instanceof Error ? error.message : String(error),
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
