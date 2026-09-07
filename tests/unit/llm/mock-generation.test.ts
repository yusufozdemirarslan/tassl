// Step 12.1 — the mock provider's generation pipeline (docs/tech/11-llm-integration.md §1.4 the
// `gen-*` row, §2.1; AI-001, AI-005, FR-191; D-063, D-064).
//
// `FEATURE_AI=false` is the default in every environment until Phase 14, so this is not a stub being
// exercised: it is the author that produces a whole scenario package in the walkthrough, and the
// authoring evals must score it at 100 percent. Two things therefore have to be true of it, and this
// file is where both are proved.
//
//   1. **What the seven steps produce is a package that confirms.** Not "looks like one" — the seven
//      replies are assembled into the portable document `importPackage` accepts and run through
//      `validateExport`, which is `validatePackage` over every rule of 10 §4. A rule the mock breaks
//      is a rule the pipeline of step 12.2 would meet at the end of seven jobs.
//   2. **The mock encodes nothing observable about the plant.** This is the hazard the generation
//      mock carries that no earlier mock did. Phase 7 shipped an assistant whose wording moved with
//      a claim's evidence status; Phase 10 shipped a reader that emitted the Turn's authored
//      proportionate response into a student-visible rationale. Here the mock writes the whole
//      package, both variants of it, so the question is whether anything a student can *see* —
//      a claim's text, its length, the actions its card offers, what those actions return, the
//      document it cites — tells them which claim was planted, or which variant they drew, without
//      doing the work. Section 3 answers that field by field.
import { describe, expect, it } from 'vitest'
import { noItemNamesAClaim } from '@/server/modules/authoring/checks'
import {
  PACKAGE_EXPORT_SCHEMA_VERSION,
  PackageExportSchema,
  type PackageExport,
} from '@/server/modules/scenarios/schema'
import { validateExport } from '@/server/modules/scenarios/validate-export'
import { genAnswerSpaceFieldsPrompt } from '@/server/llm/prompts/gen-answer-space-fields'
import { genClaimsStatesPrompt } from '@/server/llm/prompts/gen-claims-states'
import { genDocumentsPrompt } from '@/server/llm/prompts/gen-documents'
import { genQuestionBankAndCounterfactualPrompt } from '@/server/llm/prompts/gen-question-bank-and-counterfactual'
import { genReadinessItemsPrompt } from '@/server/llm/prompts/gen-readiness-items'
import { genReskinBriefStakeholdersPrompt } from '@/server/llm/prompts/gen-reskin-brief-stakeholders'
import { genTurnProbePrompt } from '@/server/llm/prompts/gen-turn-probe'
import {
  DEFAULT_CONCEPT_SET,
  drawsFromBrief,
  figuresFor,
  figuresFromDraws,
  generationReply,
  type Figures,
} from '@/server/llm/providers/mock/generation'

// ---------------------------------------------------------------------------------------------
// Running the seven steps the way the pipeline will (10 §5)
// ---------------------------------------------------------------------------------------------
//
// Each step is given what §2.1 says it is given and nothing else: step 1 alone sees the seed text,
// and steps 2 to 6 see the brief that step 1 wrote. That is the property the assembly below is
// really testing — a package assembled out of one `buildMockPackage` call would agree with itself
// whatever the steps did.

const CONCEPT_SET = [...DEFAULT_CONCEPT_SET]

type Steps = {
  one: ReturnType<typeof genReskinBriefStakeholdersPrompt.output.parse>
  two: ReturnType<typeof genDocumentsPrompt.output.parse>
  three: ReturnType<typeof genAnswerSpaceFieldsPrompt.output.parse>
  four: ReturnType<typeof genClaimsStatesPrompt.output.parse>
  five: ReturnType<typeof genTurnProbePrompt.output.parse>
  six: ReturnType<typeof genQuestionBankAndCounterfactualPrompt.output.parse>
  seven: ReturnType<typeof genReadinessItemsPrompt.output.parse>
}

/**
 * The seven replies, each validated against the output schema of the prompt that asked for it.
 *
 * Parsing rather than casting is deliberate: it is the mock's contract with the prompt library, and
 * it is what makes a shape drift between the two a failure here rather than a `LLM_OUTPUT_INVALID`
 * on the first real generation run.
 */
function runSteps(seedText: string, conceptSet: readonly string[] = CONCEPT_SET): Steps {
  const one = genReskinBriefStakeholdersPrompt.output.parse(
    generationReply('gen-reskin-brief-stakeholders', { seedText, conceptSet }),
  )
  const brief = one.brief
  return {
    one,
    two: genDocumentsPrompt.output.parse(generationReply('gen-documents', { brief, conceptSet })),
    three: genAnswerSpaceFieldsPrompt.output.parse(
      generationReply('gen-answer-space-fields', { brief }),
    ),
    four: genClaimsStatesPrompt.output.parse(
      generationReply('gen-claims-states', { brief, conceptSet }),
    ),
    five: genTurnProbePrompt.output.parse(generationReply('gen-turn-probe', { brief })),
    six: genQuestionBankAndCounterfactualPrompt.output.parse(
      generationReply('gen-question-bank-counterfactual', { brief }),
    ),
    seven: genReadinessItemsPrompt.output.parse(
      generationReply('gen-readiness-items', { conceptSet }),
    ),
  }
}

/**
 * The seven step outputs as the portable package document (SYS-026), which is what step 12.2's
 * pipeline writes as rows and what `validateExport` runs the whole rule table over.
 *
 * The two joins the pipeline also performs are here: the contradiction pair of step 1 becomes the
 * `contradictsStakeholderKey` of one stakeholder, and each claim's `defective`/`sound` blocks become
 * the two variants' claim states. `evidenceStatus` is read off the failure family rather than taken
 * on trust, because a state that named a family without being defective would be a defect nobody
 * planted.
 */
function assemble(seedText: string, conceptSet: readonly string[] = CONCEPT_SET): PackageExport {
  const steps = runSteps(seedText, conceptSet)
  const [contradicting, contradicted] = steps.one.contradictionPair

  const document = {
    schemaVersion: PACKAGE_EXPORT_SCHEMA_VERSION,
    package: {
      title: `${steps.one.company} — acquisition mix`,
      familyKey: 'halden-roastworks',
      discipline: 'marketing_strategy',
    },
    version: {
      conceptSet,
      brief: steps.one.brief,
      workingClockSeconds: 1500,
      turnDelaySeconds: steps.five.turn.delaySeconds,
      difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
      generalEscalationReply: steps.four.generalEscalationReply,
      debriefCounterfactual: steps.six.counterfactual,
    },
    seedRecord: {
      caseTitle: 'The licensed seed case',
      publisher: 'A case publisher',
      licenseTerms: 'Adaptation permitted for classroom use.',
      licensePermitsAdaptation: true,
      seedText,
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
    throw new Error(`MOCK_PACKAGE_UNPARSEABLE: ${JSON.stringify(parsed.error.issues, null, 2)}`)
  }
  return parsed.data as PackageExport
}

/** Every failure on one line, so a broken package says which rule broke and where. */
const report = (failures: readonly { code: string; elementIds: string[]; message: string }[]) =>
  failures.length === 0
    ? 'no failures'
    : failures
        .map((failure) => `${failure.code} [${failure.elementIds.join(', ')}]: ${failure.message}`)
        .join('\n')

/** Two seeds a person could plausibly paste in, and long enough to be a case rather than a title. */
const SEED_A = [
  'Northbank Dairy Cooperative: pricing the chilled delivery tier.',
  'In 2019 the cooperative piloted a chilled home-delivery tier at a premium price. The pilot deck put the payback at nine months on a margin that excluded cold-chain freight. A later finance note put the freight at 1.10 dollars a delivery and the payback at fourteen months. The board must decide the share of the marketing budget going to the chilled tier.',
].join('\n\n')

const SEED_B = [
  'Vantage Learning Group: renewing the enterprise seat contract.',
  'A corporate training publisher piloted a per-seat licence with three anchor accounts. The pilot summary reported a contribution per seat that omitted the support desk. The renewal committee must decide how many seats to price for the coming year and on what unit economics.',
].join('\n\n')

const packageA = assemble(SEED_A)
const packageB = assemble(SEED_B)

// ---------------------------------------------------------------------------------------------
// 1. The package the seven steps produce
// ---------------------------------------------------------------------------------------------

describe('the mock generation pipeline produces a package that confirms', () => {
  it.each([
    ['seed A', packageA],
    ['seed B', packageB],
  ])('passes every rule of the package validator for %s', (_name, document) => {
    const result = validateExport(document)
    expect(report(result.failures)).toBe('no failures')
    expect(result.ok).toBe(true)
  })

  it('answers every one of the seven steps with its own prompt’s output shape', () => {
    // `runSteps` parses each reply against the prompt that asked for it, so reaching here at all is
    // the assertion; the counts below say the answers are the package and not seven empty objects.
    const steps = runSteps(SEED_A)
    expect(steps.one.stakeholders.length).toBeGreaterThanOrEqual(3)
    expect(steps.two.documents.length).toBeGreaterThanOrEqual(6)
    expect(steps.three.positions.length).toBeGreaterThanOrEqual(3)
    expect(steps.four.claims.length).toBeGreaterThanOrEqual(6)
    expect(steps.five.turn.delaySeconds).toBeGreaterThanOrEqual(60)
    expect(steps.six.questions.length).toBeGreaterThanOrEqual(6)
    expect(steps.seven.items).toHaveLength(16)
  })

  it('is deterministic: the same seed produces the same package, twice', () => {
    expect(JSON.stringify(assemble(SEED_A))).toBe(JSON.stringify(packageA))
  })

  it('writes no readiness item that repeats a claim of the package it belongs to (AI-005)', () => {
    const check = noItemNamesAClaim(
      packageA.readinessItems.map((item) => ({ id: item.key, stem: item.stem })),
      packageA.claims.map((claim) => ({ id: claim.key, text: claim.text })),
    )
    expect(check.echoes).toEqual([])
    expect(check.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. What the seed changes (§1.4: "the seed text influences only the titles and the numbers")
// ---------------------------------------------------------------------------------------------

describe('the seed decides the titles and the numbers, and nothing else', () => {
  it('gives the two seeds different document titles', () => {
    const titlesA = packageA.documents.map((document) => document.title)
    const titlesB = packageB.documents.map((document) => document.title)
    expect(titlesA).not.toEqual(titlesB)
    expect(titlesA.some((title, index) => title !== titlesB[index])).toBe(true)
  })

  it('keeps the invented identity fixed, so no lookup resolves a claim (D-063)', () => {
    expect(packageB.stakeholders.map((stakeholder) => stakeholder.name)).toEqual(
      packageA.stakeholders.map((stakeholder) => stakeholder.name),
    )
    expect(packageB.documents.map((document) => document.key)).toEqual(
      packageA.documents.map((document) => document.key),
    )
    // And it names neither seed case anywhere outside the re-skin log, which exists to record it.
    const outsideTheLog = JSON.stringify({ ...packageA, seedRecord: null })
    expect(outsideTheLog).not.toContain('Northbank')
    expect(JSON.stringify({ ...packageB, seedRecord: null })).not.toContain('Vantage')
  })

  it('derives every figure from hash(seedText) by arithmetic the documents reproduce', () => {
    for (const [seed, document] of [
      [SEED_A, packageA],
      [SEED_B, packageB],
    ] as const) {
      const draws = drawsFromBrief(document.version.brief)
      if (draws === null) throw new Error('MOCK_BRIEF_CARRIES_NO_DRAWS')
      const figures: Figures = figuresFromDraws(draws)

      // The figures the package carries are the ones a seeded PRNG over `hash(seedText)` draws:
      // step 1 draws them from the seed and writes them into the brief, and steps 2 to 5 read them
      // back out of the brief, so the two derivations have to agree or the package would not
      // reconcile with itself.
      expect(figuresFor({ seedText: seed, brief: '', conceptSet: [] })).toEqual(figures)

      // The brief's own numbers are the draws, and the corrected payback is the quotient of two of
      // them: the claim states the number the memo computes, whatever the seed drew.
      expect(document.version.brief).toContain(String(figures.acquisitionCost))
      const corrected = document.claims.find((claim) =>
        claim.text.includes(`${figures.paybackTrueMonths} months`),
      )
      expect(corrected).toBeDefined()
      expect(
        Math.round((figures.acquisitionCost / (figures.contributionTrueCents / 100)) * 10) / 10,
      ).toBe(figures.paybackTrue)
      expect(document.version.turnDelaySeconds).toBe(figures.turnDelaySeconds)
    }
  })

  it('draws different numbers for the two seeds', () => {
    const a = drawsFromBrief(packageA.version.brief)
    const b = drawsFromBrief(packageB.version.brief)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toEqual(b)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. The mock encodes nothing observable about the plant
// ---------------------------------------------------------------------------------------------
//
// "Observable" is not a matter of taste here. A student sees a claim as `ClaimView` (10 §8): its
// text, the actions its card offers, what an action returned when they spent one, and an escalation
// reply. They see the brief, the Evidence Room list and the bodies they opened, the Turn message,
// the named-field labels, the readiness items and the defense questions. They never see the
// authored order of the claims, the importance, the consequence level, the concept key, the
// rationale, the evidence status, the failure family or the planted flag.
//
// So there are exactly two channels a package could leak through, and each has a test.
//   A. *Between the variants* — anything a student can see that differs between the sound and the
//      defective variant tells whoever drew one which one they are on, and on the planted claim it
//      is the plant itself.
//   B. *Within one variant* — anything about the planted claim's own presentation that marks it out
//      from the other seven, before any evidence is traced.

/** The claim as a student meets it in one variant: the text, the menu, and what the menu returns. */
type ObservedClaim = {
  key: string
  text: string
  actions: string[]
  results: string
  escalationReply: string | null
}

function observe(document: PackageExport, variantKey: string): ObservedClaim[] {
  const variant = document.variants.find((candidate) => candidate.key === variantKey)
  return document.claims.map((claim) => {
    const state = variant?.claimStates.find((candidate) => candidate.claimKey === claim.key)
    const paths = state?.verificationPaths ?? {}
    return {
      key: claim.key,
      text: claim.text,
      // `ClaimView.availableActions` is projected verbatim from these keys (D-330).
      actions: Object.keys(paths).sort(),
      // Key order is the output schema's, so two paths that say the same thing serialise the same.
      results: JSON.stringify(paths),
      escalationReply: claim.escalationReply,
    }
  })
}

const plantedKeyOf = (document: PackageExport): string => {
  const planted = document.variants
    .flatMap((variant) => variant.claimStates)
    .filter((state) => state.planted)
  expect(planted).toHaveLength(1)
  return planted[0]?.claimKey ?? ''
}

describe('A. the two variants are indistinguishable except where the plant is authored', () => {
  it.each([
    ['seed A', packageA],
    ['seed B', packageB],
  ])('shows the same claim menu on both variants of %s (D-330)', (_name, document) => {
    const defective = observe(document, 'defective')
    const sound = observe(document, 'sound')
    expect(defective.map((claim) => `${claim.key}:${claim.actions.join('+')}`)).toEqual(
      sound.map((claim) => `${claim.key}:${claim.actions.join('+')}`),
    )
    // And the menus are not empty, or the assertion above would hold vacuously.
    expect(defective.every((claim) => claim.actions.length > 0)).toBe(true)
  })

  it.each([
    ['seed A', packageA],
    ['seed B', packageB],
  ])(
    'returns the same result from every action on every claim but the plant, in %s',
    (_name, document) => {
      const planted = plantedKeyOf(document)
      const defective = observe(document, 'defective')
      const sound = observe(document, 'sound')

      const differing = defective
        .filter((claim, index) => JSON.stringify(claim) !== JSON.stringify(sound[index]))
        .map((claim) => claim.key)

      // Nothing in `validatePackage` requires this — `VARIANTS_DIFFER_BEYOND_PLANT` deliberately
      // excludes verification paths, because a sound claim's paths are authored per variant (D-203).
      // The result of a Source Trace is nevertheless a string the student reads, so a sound claim
      // that traced differently in each variant would tell them which variant they drew for nothing.
      expect(differing).toEqual([planted])
    },
  )

  it.each([
    ['seed A', packageA],
    ['seed B', packageB],
  ])('changes nothing else a student can see between the variants of %s', (_name, document) => {
    // Everything outside the claim states is version-level: one brief, one room, one Turn, one bank.
    // The assertion is that the observable projection is a function of the package and not of the
    // variant, which is what makes the two variants one scenario.
    const observable = (variantKey: string) =>
      JSON.stringify({
        brief: document.version.brief,
        documents: document.documents.map((entry) => ({
          key: entry.key,
          title: entry.title,
          author: entry.author,
          datedOn: entry.datedOn,
          body: entry.body,
        })),
        turn: document.turn?.text,
        questions: document.defenseQuestions.map((question) => question.template),
        items: document.readinessItems.map((item) => item.stem),
        claims: observe(document, variantKey).map((claim) => ({
          text: claim.text,
          actions: claim.actions,
        })),
      })
    expect(observable('defective')).toBe(observable('sound'))
  })
})

describe('B. nothing about the planted claim marks it out inside its own variant', () => {
  const cases = [
    ['seed A', packageA],
    ['seed B', packageB],
  ] as const

  it.each(cases)(
    'is not the only claim whose card offers a second action, in %s',
    (_name, built) => {
      const observed = observe(built, 'defective')
      const planted = observed.find((claim) => claim.key === plantedKeyOf(built))
      expect(planted).toBeDefined()

      // A card that is the only one in the room offering more than a Source Trace is a card that
      // points at itself before anything is traced. The claim that shares the property is the
      // corrected-payback claim, and it shares it for the same reason the plant has it: both are
      // ratios, so both can be taken apart. What is asserted is that the property is shared — the
      // exact menu is not, and cannot be, because the two ratios come apart in different ways.
      const alsoDeep = observed.filter(
        (claim) =>
          claim.key !== planted?.key && claim.actions.length >= (planted?.actions.length ?? 0),
      )
      expect(alsoDeep.length).toBeGreaterThanOrEqual(1)
    },
  )

  it.each(cases)('is neither the longest nor the shortest claim in %s', (_name, document) => {
    const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
    const planted = plantedKeyOf(document)
    const lengths = document.claims.map((claim) => words(claim.text))
    const plantedLength = words(document.claims.find((claim) => claim.key === planted)?.text ?? '')
    expect(plantedLength).toBeGreaterThan(Math.min(...lengths))
    expect(plantedLength).toBeLessThan(Math.max(...lengths))
  })

  it.each(cases)(
    'carries the same number of trigger phrases as every claim in %s',
    (_name, doc) => {
      const counts = new Set(doc.claims.map((claim) => claim.triggerPhrases.length))
      expect(counts.size).toBe(1)
      expect(Number([...counts][0])).toBeGreaterThan(0)
    },
  )

  it.each(cases)('cites a document no more and no less used than the others, in %s', (_n, doc) => {
    const planted = plantedKeyOf(doc)
    const citations = new Map<string, number>()
    for (const claim of doc.claims) {
      const key = claim.sourceDocumentKey
      if (key !== null) citations.set(key, (citations.get(key) ?? 0) + 1)
    }
    const plantedSource = doc.claims.find((claim) => claim.key === planted)?.sourceDocumentKey ?? ''
    const here = citations.get(plantedSource) ?? 0
    const sameLoad = [...citations.values()].filter((count) => count === here)
    expect(sameLoad.length).toBeGreaterThanOrEqual(2)
  })

  it.each(cases)('moves with the seed the way the other claims do, in %s', (_name, built) => {
    // If the planted claim were the only one whose text the seed touched, its figure would be the
    // only figure that ever changed, and a reader with two packages could name it.
    const other = built === packageA ? packageB : packageA
    const changed = built.claims.filter((claim, index) => claim.text !== other.claims[index]?.text)
    expect(changed.map((claim) => claim.key)).toContain(plantedKeyOf(built))
    expect(changed.length).toBeGreaterThanOrEqual(4)
  })

  it.each(cases)('never names the answer key in a string a student reads, in %s', (_name, doc) => {
    // The vocabulary of the answer key. `rationale` and `expectedAnswerNotes` are excluded: FR-151
    // shows the rationale in the debrief *after* the run is scored, and the bank is never returned
    // to a student at all (D-117), so both are entitled to say plainly that a figure was superseded.
    const forbidden = [
      'planted',
      'defective',
      'evidence status',
      'failure family',
      'warranted stance',
      'sound variant',
      'stale_evidence',
      'answer key',
    ]
    const studentReads = [
      doc.version.brief,
      doc.version.generalEscalationReply,
      doc.version.debriefCounterfactual,
      ...doc.documents.flatMap((entry) => [entry.title, entry.author, entry.body]),
      ...doc.claims.flatMap((claim) => [claim.text, claim.escalationReply ?? '']),
      ...doc.stakeholders.map((stakeholder) => stakeholder.positionStatement),
      doc.turn?.text ?? '',
      doc.probe?.originalPosition ?? '',
      doc.probe?.scriptedReversal ?? '',
      ...doc.defenseQuestions.flatMap((question) => [question.template, question.followUp]),
      ...doc.readinessItems.flatMap((item) => [
        item.stem,
        ...item.options.map((option) => option.text),
      ]),
      ...doc.namedFields.map((named) => named.label),
    ].join('\n')

    const hits = forbidden.filter((word) => studentReads.toLowerCase().includes(word))
    expect(hits).toEqual([])
    // The scan can still fail, or it would be proving nothing.
    expect(`${studentReads}\nthe planted claim`.toLowerCase()).toContain('planted')
  })
})
