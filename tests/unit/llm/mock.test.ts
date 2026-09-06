// Step 7.1 — the mock provider (docs/tech/11-llm-integration.md §1.4, D-029, D-063, D-064).
//
// The mock is the product's default provider, not a test fixture: `FEATURE_AI=false` everywhere
// until Phase 14, so what this file asserts is what a student meets. Four things have to hold.
//
//   *Determinism.* The same request answers the same way, every process, every run — and "the same
//   request" means the same call a real provider would have received, because the mock's answer is
//   keyed by the rendered prompt and nothing else (D-265). The walkthrough, the E2E suite and the
//   100-percent eval threshold all rest on it (D-064).
//   *One marker per claim.* The reply assembly and the workspace both key on `[[claim:<id>]]`
//   appearing exactly once for each surfaced claim (§2.1).
//   *No invented figures.* §1.4: the mock never emits a digit that is not in the claims or the
//   request — which is the same promise the numeric guard enforces on a real provider (FR-052).
//   *No defect status.* FR-056: nothing in a reply may tell a student whether a claim is sound.
//
// And the generation half, per D-063: the package the seven `gen-*` steps produce passes every rule
// of `validatePackage`, because Phase 12's pipeline and the authoring evals run on exactly this.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validatePackage, type ValidatedVersion } from '@/server/modules/scenarios/validate'
import type { CompleteRequest, StreamChunk } from '@/server/llm/provider'
import { MOCK_MODEL } from '@/server/llm/provider'
import { assistantReplyPrompt } from '@/server/llm/prompts/assistant-reply'
import { mockProvider, renderMock } from '@/server/llm/providers/mock'
import {
  DEFAULT_CONCEPT_SET,
  GENERATION_PROMPTS,
  GenerationMockInput,
  buildMockPackage,
  drawsFromBrief,
  type MockPackage,
} from '@/server/llm/providers/mock/generation'
import {
  AdaptationInput,
  DecisionQualityInput,
  DelegationInput,
  FramingInput,
  OwnershipInput,
} from '@/server/llm/providers/mock/readers'
import {
  AssistantReplyMockInput,
  CLAIM_MARKER_PATTERN,
  TriggerClassifyMockInput,
} from '@/server/llm/providers/mock/templates'

const CLAIMS = [
  {
    id: 'c-payback',
    text: 'Premium payback is about 11 months on a contribution of 28.20 dollars.',
  },
  { id: 'c-retention', text: 'Month-three retention on the first premium cohort is 78 percent.' },
]

const DELEGATION = {
  worldSummary: 'Halden Roastworks is deciding its acquisition mix.',
  openedDocuments: [],
  request: 'What is the premium payback?',
  claims: CLAIMS,
  turnContext: null,
}

/**
 * A delegation as the service makes one: rendered by the prompt, so the `messages` the mock is keyed
 * on and the `promptInput` it reads its content from are two halves of one call.
 *
 * Writing the two by hand is what let the determinism suite pass over a mock that was not
 * deterministic. The seed used to be taken from the raw `promptInput`, which `untrusted()` trims and
 * normalises on its way into the prompt, so a request with a trailing space rendered a byte-identical
 * prompt and produced a different reply — invisible to any fixture that set the two independently
 * (D-265). Every request below therefore starts here.
 */
const assistantRequest = (
  input: Partial<typeof DELEGATION> = {},
  overrides: Partial<CompleteRequest> = {},
): CompleteRequest => {
  const rendered = assistantReplyPrompt.render({ ...DELEGATION, ...input })
  return {
    feature: 'assistant',
    promptName: assistantReplyPrompt.name,
    promptVersion: assistantReplyPrompt.version,
    messages: rendered.messages,
    promptInput: rendered.input,
    context: { requestId: 'req-1', runId: '11111111-1111-4111-8111-111111111111' },
    ...overrides,
  }
}

/** A caller that puts keys no prompt renders into the prompt input — Step 7.3's shape of mistake. */
const withHiddenState = (req: CompleteRequest, status: 'defective' | 'sound'): CompleteRequest => {
  const input = req.promptInput as { claims: { id: string; text: string }[] }
  return {
    ...req,
    promptInput: {
      ...input,
      evidenceStatus: status,
      failureFamily: status === 'defective' ? 'stale_evidence' : null,
      claims: input.claims.map((claim) => ({
        ...claim,
        evidenceStatus: status,
        failureFamily: status === 'defective' ? 'stale_evidence' : null,
        planted: status === 'defective',
      })),
    },
  }
}

const collect = async (stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> => {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const markersIn = (text: string): string[] =>
  [...text.matchAll(CLAIM_MARKER_PATTERN)].map((match) => match[1] ?? '')

// Words a reply may never contain (§3 defect-word filter, FR-056). The filter itself is Step 7.2;
// the mock must never produce one in the first place.
const FORBIDDEN = [
  'defective',
  'planted',
  'sound claim',
  'novice',
  'developing',
  'proficient',
  'professional',
]

describe('mock provider — determinism', () => {
  const textOf = async (req: CompleteRequest): Promise<string> =>
    (await mockProvider.complete(req)).text

  it('answers the same text for the same request', async () => {
    expect(await textOf(assistantRequest())).toBe(await textOf(assistantRequest()))
  })

  it('ignores the request id, so the same delegation asked twice reads the same', async () => {
    expect(
      await textOf(
        assistantRequest(
          {},
          { context: { requestId: 'req-2', runId: '11111111-1111-4111-8111-111111111111' } },
        ),
      ),
    ).toBe(await textOf(assistantRequest()))
  })

  // The failure this replaces: `untrusted()` trims and normalises line endings, so both of these
  // render one prompt — and the mock, keyed on the un-normalised input object, answered them two
  // ways. A student who typed a trailing space got a different reply to the same question, and the
  // eval suite's 100 percent (D-064) rested on nobody doing that.
  it('is keyed by the prompt it rendered, not by the object it was handed', async () => {
    const plain = assistantRequest()
    const padded = assistantRequest({ request: `\r\n  ${DELEGATION.request}  ` })

    expect(padded.messages).toEqual(plain.messages)
    expect(await textOf(padded)).toBe(await textOf(plain))
  })

  // FR-056, and the reason the seed is what it is. Step 7.3 surfaces claims by loading claim rows,
  // which carry `evidenceStatus`, `failureFamily` and `planted` beside the id and the text; a caller
  // that hands those to the prompt input renders exactly the same prompt, because no prompt renders
  // them. If the mock's wording turned on them, two students on different variants would get
  // systematically different replies to the same question and nothing downstream — not the rendered
  // prompt, not the call digest, not the defect-word filter — could see it.
  it('cannot be moved by a key the prompt does not render, whatever it says', async () => {
    const defective = withHiddenState(assistantRequest(), 'defective')
    const sound = withHiddenState(assistantRequest(), 'sound')

    expect(defective.messages).toEqual(sound.messages)
    expect(await textOf(defective)).toBe(await textOf(sound))
    expect(await textOf(defective)).toBe(await textOf(assistantRequest()))
  })

  it('answers differently when the student asks a different question', async () => {
    const first = await textOf(assistantRequest())
    const second = await textOf(
      assistantRequest({ request: 'How well does the premium cohort retain by month three?' }),
    )
    expect(second).not.toBe(first)
  })

  it('reports usage and the mock model', async () => {
    const result = await mockProvider.complete(assistantRequest())
    expect(result.provider).toBe('mock')
    expect(result.model).toBe(MOCK_MODEL)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })
})

describe('mock provider — the assistant reply', () => {
  it('places one marker per surfaced claim and quotes the claim verbatim', async () => {
    const { text } = await mockProvider.complete(assistantRequest())
    expect(markersIn(text)).toEqual(['c-payback', 'c-retention'])
    for (const claim of CLAIMS) expect(text).toContain(claim.text)
  })

  it('emits no digit that is not in a claim or the request', async () => {
    const { text } = await mockProvider.complete(assistantRequest())
    const connective = text
      .split('\n\n')
      .map((paragraph) => paragraph.replace(CLAIM_MARKER_PATTERN, '|'))
      .join(' ')
    const withoutClaims = CLAIMS.reduce(
      (prose, claim) => prose.split(claim.text).join(' '),
      connective,
    )
    expect(withoutClaims).not.toMatch(/\d/)
  })

  it('never names a band, a defect or an evidence status', async () => {
    const { text } = await mockProvider.complete(assistantRequest())
    for (const word of FORBIDDEN) expect(text.toLowerCase()).not.toContain(word)
  })

  it('says it has nothing rather than inventing one when no claim matched', async () => {
    const { text } = await mockProvider.complete(assistantRequest({ claims: [] }))
    expect(markersIn(text)).toEqual([])
    expect(text).not.toMatch(/\d/)
    expect(text.length).toBeGreaterThan(40)
  })

  it('streams the reply in order, breaking at each marker, and closes with usage', async () => {
    const chunks = await collect(mockProvider.stream(assistantRequest()))
    const done = chunks.at(-1)
    expect(done?.type).toBe('done')

    const textChunks = chunks.filter((chunk) => chunk.type === 'text')
    expect(textChunks.length).toBeGreaterThan(1)
    const joined = textChunks.map((chunk) => chunk.text).join('')
    expect(joined).toBe((await mockProvider.complete(assistantRequest())).text)
    expect(textChunks.some((chunk) => chunk.text === '[[claim:c-payback]]')).toBe(true)
  })
})

describe('mock provider — the classification path (AI-004)', () => {
  const classify = (request: string) =>
    renderMock({
      feature: 'trigger_classify',
      promptName: 'trigger-classify',
      promptVersion: 1,
      messages: [{ role: 'user', content: request }],
      promptInput: {
        request,
        candidates: [
          {
            id: 'c-payback',
            description: 'asks how long premium takes to pay back',
            triggerPhrases: ['premium payback', 'payback period'],
          },
          {
            id: 'c-retention',
            description: 'asks how well premium retains',
            triggerPhrases: ['premium retention'],
          },
        ],
      },
      context: { requestId: 'req-classify' },
    })

  it('returns the deterministic matcher’s result, normalised', () => {
    expect(JSON.parse(classify('What is the PREMIUM  payback, exactly?'))).toEqual({
      matched_claim_ids: ['c-payback'],
    })
    expect(JSON.parse(classify('Tell me about the weather'))).toEqual({ matched_claim_ids: [] })
  })

  it('matches a phrase whose tokens are all present but not adjacent', () => {
    expect(JSON.parse(classify('for premium, what does the payback look like'))).toEqual({
      matched_claim_ids: ['c-payback'],
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The prompt-input boundary (D-266): the mock reads what the prompt declares, and nothing else
// ---------------------------------------------------------------------------------------------

/**
 * Every mock input schema, by the prompt name it answers. Adding a prompt family to the mock without
 * adding it here fails the sweep below, which is the point: the two lists are the same list.
 */
const MOCK_INPUTS: Record<string, z.ZodType> = {
  'assistant-reply': AssistantReplyMockInput,
  'trigger-classify': TriggerClassifyMockInput,
  'band-read-framing': FramingInput,
  'band-read-delegation': DelegationInput,
  'band-read-decision-quality': DecisionQualityInput,
  'band-read-adaptation': AdaptationInput,
  'band-read-ownership': OwnershipInput,
  ...Object.fromEntries(GENERATION_PROMPTS.map((name) => [name, GenerationMockInput])),
}

/** The JSON Schema of a Zod schema as it reads its *input*, before defaults and transforms. */
const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>

/** Every property path an object schema declares, `a.b.c`, arrays transparent. */
function propertyPaths(schema: z.ZodType): Set<string> {
  const paths = new Set<string>()
  const walk = (node: unknown, prefix: string): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    for (const branch of ['anyOf', 'oneOf', 'allOf']) {
      const options = record[branch]
      if (Array.isArray(options)) for (const option of options) walk(option, prefix)
    }
    walk(record.items, prefix)
    const properties = record.properties
    if (properties !== null && typeof properties === 'object') {
      for (const [key, child] of Object.entries(properties)) {
        const path = prefix === '' ? key : `${prefix}.${key}`
        paths.add(path)
        walk(child, path)
      }
    }
  }
  walk(jsonSchemaOf(schema), '')
  return paths
}

/** Object nodes that would keep a key they never declared; `z.looseObject` is how one gets here. */
function looseNodes(schema: z.ZodType): string[] {
  const loose: string[] = []
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.properties !== undefined && record.additionalProperties !== undefined) {
      if (record.additionalProperties !== false) loose.push(path === '' ? '(root)' : path)
    }
    walk(record.items, path)
    for (const [key, child] of Object.entries((record.properties ?? {}) as object)) {
      walk(child, path === '' ? key : `${path}.${key}`)
    }
  }
  walk(jsonSchemaOf(schema), '')
  return loose
}

/** The prompt library as it stands, discovered rather than listed, so a new prompt is picked up. */
const promptsInLibrary = Object.values(
  import.meta.glob('../../../src/server/llm/prompts/*.ts', { eager: true }) as Record<
    string,
    Record<string, unknown>
  >,
).flatMap((module) =>
  Object.values(module).filter(
    (value): value is { name: string; input: z.ZodType } =>
      typeof value === 'object' &&
      value !== null &&
      'render' in value &&
      'input' in value &&
      typeof (value as { name?: unknown }).name === 'string',
  ),
)

describe('mock provider — what it will read (D-266)', () => {
  it.each(Object.keys(MOCK_INPUTS))('%s strips a key it did not declare', (prompt) => {
    const schema = MOCK_INPUTS[prompt]
    expect(looseNodes(schema as z.ZodType)).toEqual([])
  })

  // The channel of the previous test, at the other end: even if the seed were taken from this object
  // again, there would be nothing in it to take. A claim row's own fields do not survive the parse.
  it('drops evidence status, failure family and planted from a claim it was handed', () => {
    const parsed = AssistantReplyMockInput.parse({
      request: 'What is the premium payback?',
      claims: [
        {
          ...CLAIMS[0],
          evidenceStatus: 'defective',
          failureFamily: 'stale_evidence',
          planted: true,
        },
      ],
      evidenceStatus: 'defective',
      variantKey: 'defective',
    })

    expect(parsed.claims).toEqual([{ id: CLAIMS[0]?.id, text: CLAIMS[0]?.text }])
    expect(JSON.stringify(parsed)).not.toContain('defective')
    expect(JSON.stringify(parsed)).not.toContain('planted')
  })

  // The mock may read less than the prompt sends — a heuristic cannot use the rubric descriptors —
  // but never more: a key it reads that no prompt renders is a key only a caller could set, which is
  // a channel from the caller's data to the student's reply that no rendered prompt would show.
  it.each(promptsInLibrary.map((prompt) => prompt.name))(
    '%s declares everything the mock reads out of it',
    (name) => {
      const prompt = promptsInLibrary.find((candidate) => candidate.name === name)
      const mockInput = MOCK_INPUTS[name]
      expect(mockInput, `the mock has no scripted input for ${name}`).toBeDefined()

      const declared = propertyPaths((prompt as { input: z.ZodType }).input)
      const read = [...propertyPaths(mockInput as z.ZodType)]
      expect(read.filter((path) => !declared.has(path))).toEqual([])
    },
  )
})

describe('mock provider — structured output runs the real path', () => {
  it('validates a band read against the caller’s schema', async () => {
    const Schema = z.object({
      band: z.enum(['novice', 'developing', 'proficient', 'professional']),
      quotes: z.array(z.object({ field: z.string(), text: z.string() })),
      rationale: z.string().min(1),
    })
    const result = await mockProvider.structured({
      feature: 'band_read',
      promptName: 'band-read-framing',
      promptVersion: 1,
      messages: [{ role: 'system', content: 'Read the frame.' }],
      promptInput: {
        frame: {
          decision: 'How much of this quarter to move to the premium tier, and on what payback.',
          assumptions: [
            'The corrected contribution holds for the coming quarter',
            'Roastery capacity is not the binding constraint at this share',
            'The second cohort behaves like the first at month three',
          ],
          position:
            'A bounded shift of about a third, priced on the corrected payback and capped under the weekly roastery capacity, is the most I would fund before the second cohort lands.',
          confidence: 55,
        },
        answerSpace: 'bounded shift premium payback corrected capacity quarter',
        documentsRead: ['Retention and Payback Memo'],
      },
      schema: Schema,
      schemaName: 'FramingRead',
      context: { requestId: 'req-band' },
    })

    expect(result.repaired).toBe(false)
    expect(result.value.band).toBe('professional')
    expect(result.value.quotes[0]?.field).toBe('position')
  })
})

// ---------------------------------------------------------------------------------------------
// Generation (D-063): the seven steps produce one package, and it is a valid one
// ---------------------------------------------------------------------------------------------

/**
 * The generated package as `validatePackage` reads it. The mock speaks in element keys, because
 * that is what a model can produce before any row exists; the validator speaks in ids, because it
 * also runs over stored rows. Using the key as the id is the whole translation.
 */
function asValidatedVersion(built: MockPackage, conceptSet: readonly string[]): ValidatedVersion {
  const paths = (
    source: MockPackage['claims'][number]['defective']['verificationPaths'],
  ): ValidatedVersion['variants'][number]['claimStates'][number]['verificationPaths'] => ({
    ...(source.source_trace
      ? {
          source_trace: {
            document_id: source.source_trace.document_key,
            passage: source.source_trace.passage,
            dated_on: source.source_trace.dated_on,
            author: source.source_trace.author,
          },
        }
      : {}),
    ...(source.replication_check ? { replication_check: source.replication_check } : {}),
    ...(source.decomposition_check ? { decomposition_check: source.decomposition_check } : {}),
  })

  const [contradicts, contradicted] = built.contradictionPair

  return {
    conceptSet,
    brief: built.brief,
    turnDelaySeconds: built.turnDelaySeconds,
    generalEscalationReply: built.generalEscalationReply,
    debriefCounterfactual: built.counterfactual,
    seedRecord: { reskinLog: built.reskinLog },
    documents: built.documents.map((document) => ({
      id: document.key,
      key: document.key,
      body: document.body,
      role: document.role,
      datedOn: document.datedOn,
      supersededByDocumentId: document.supersededByKey,
      stakeholderId: document.stakeholderKey,
    })),
    stakeholders: built.stakeholders.map((stakeholder) => ({
      id: stakeholder.key,
      key: stakeholder.key,
      contradictsStakeholderId: stakeholder.key === contradicts ? contradicted : null,
      contradictionPoint: stakeholder.key === contradicts ? built.contradictionPoint : null,
    })),
    answerSpacePositions: built.positions.map((position) => ({
      id: position.key,
      key: position.key,
      kind: position.kind,
      ignoredEvidence: position.ignoredEvidence,
      isMinimumCommitment: position.isMinimumCommitment,
    })),
    namedFields: built.namedFields.map((field) => ({ key: field.key })),
    claims: built.claims.map((claim) => ({
      id: claim.key,
      key: claim.key,
      text: claim.text,
      importance: claim.importance,
      consequenceLevel: claim.consequenceLevel,
      conceptKey: claim.conceptKey,
      weaklySourced: claim.weaklySourced,
      volatile: claim.volatile,
      escalatable: claim.escalatable,
      escalationReply: claim.escalationReply,
    })),
    variants: [
      {
        key: 'defective',
        claimStates: built.claims.map((claim) => ({
          id: `${claim.key}-defective`,
          claimId: claim.key,
          evidenceStatus: claim.defective.failureFamily === null ? 'sound' : 'defective',
          failureFamily: claim.defective.failureFamily,
          warrantedStance: claim.defective.warrantedStance,
          planted: claim.defective.plantedTrue,
          verificationPaths: paths(claim.defective.verificationPaths),
        })),
      },
      {
        key: 'sound',
        claimStates: built.claims.map((claim) => ({
          id: `${claim.key}-sound`,
          claimId: claim.key,
          evidenceStatus: 'sound',
          failureFamily: null,
          warrantedStance: claim.sound.warrantedStance,
          planted: false,
          verificationPaths: paths(claim.sound.verificationPaths),
        })),
      },
    ],
    turn: { id: 'turn' },
    defenseQuestions: built.questions.map((question) => ({
      id: question.key,
      kind: question.kind,
      claimId: question.claimKey,
      assumptionIndex: question.assumptionIndex,
      template: question.template,
      followUp: question.followUp,
    })),
    readinessItems: built.readinessItems.map((item) => ({
      id: item.key,
      key: item.key,
      category: item.category,
      stem: item.stem,
      options: item.options,
      answerKey: item.answerKey,
    })),
  }
}

describe('mock provider — generation (D-063)', () => {
  const SEEDS = [
    'Northwind Coffee Company (A). A subscription roaster deciding its acquisition mix.',
    'Case study: a specialty tea business reconsiders its premium tier after a margin correction.',
  ]

  it.each(SEEDS)('builds a package that passes every rule of validatePackage', (seed) => {
    const built = buildMockPackage(seed, DEFAULT_CONCEPT_SET)
    const result = validatePackage(asValidatedVersion(built, DEFAULT_CONCEPT_SET))
    expect(result.failures.map((failure) => `${failure.code}: ${failure.message}`)).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('passes validation against a concept set the caller declared', () => {
    const conceptSet = ['unit_economics', 'evidence_recency', 'retention']
    const built = buildMockPackage(SEEDS[0] ?? '', conceptSet)
    expect(built.claims.every((claim) => conceptSet.includes(claim.conceptKey))).toBe(true)
    expect(validatePackage(asValidatedVersion(built, conceptSet)).failures).toEqual([])
  })

  it('is a pure function of the seed', () => {
    expect(buildMockPackage(SEEDS[0] ?? '')).toEqual(buildMockPackage(SEEDS[0] ?? ''))
  })

  it('derives its figures and its dated titles from the seed, so two seeds differ', () => {
    const first = buildMockPackage(SEEDS[0] ?? '')
    const second = buildMockPackage(SEEDS[1] ?? '')
    expect(second.figures).not.toEqual(first.figures)
    expect(second.brief).not.toBe(first.brief)
    expect(second.documents[0]?.title).not.toBe(first.documents[0]?.title)
  })

  it('keeps the arithmetic honest: the stale payback is the one the review computes', () => {
    const { figures, documents } = buildMockPackage(SEEDS[0] ?? '')
    const review = documents.find((document) => document.key === 'D1')?.body ?? ''
    expect(review).toContain(`${figures.acquisitionCost} divided by`)
    expect(figures.paybackTrue).toBeGreaterThan(figures.paybackStale)
    expect(figures.contributionTrueCents).toBeLessThan(figures.contributionStaleCents)
  })

  it('carries the seeded figures between steps through the brief it wrote', () => {
    const built = buildMockPackage(SEEDS[1] ?? '')
    const recovered = drawsFromBrief(built.brief)
    expect(recovered).toEqual({
      revenueMillions: built.figures.revenueMillions,
      budget: built.figures.budget,
      premiumSharePct: built.figures.premiumSharePct,
      acquisitionCost: built.figures.acquisitionCost,
      contributionStaleCents: built.figures.contributionStaleCents,
    })
  })

  it('answers each generation step with the same package the seed produced', () => {
    const seed = SEEDS[0] ?? ''
    const built = buildMockPackage(seed, DEFAULT_CONCEPT_SET)
    const step = (promptName: string, promptInput: unknown): unknown =>
      JSON.parse(
        renderMock({
          feature: 'generation',
          promptName,
          promptVersion: 1,
          messages: [{ role: 'user', content: promptName }],
          promptInput,
          context: { requestId: 'req-gen' },
        }),
      )

    const first = step('gen-reskin-brief-stakeholders', {
      seedText: seed,
      conceptSet: DEFAULT_CONCEPT_SET,
    }) as { brief: string }
    expect(first.brief).toBe(built.brief)

    const documents = step('gen-documents', {
      brief: first.brief,
      conceptSet: DEFAULT_CONCEPT_SET,
    }) as { documents: { key: string; title: string }[] }
    expect(documents.documents).toEqual(built.documents)

    const claims = step('gen-claims-states', {
      brief: first.brief,
      conceptSet: DEFAULT_CONCEPT_SET,
    }) as { claims: unknown[]; generalEscalationReply: string }
    expect(claims.claims).toEqual(built.claims)

    const items = step('gen-readiness-items', { conceptSet: DEFAULT_CONCEPT_SET }) as {
      items: unknown[]
    }
    expect(items.items).toEqual(built.readinessItems)
  })
})
