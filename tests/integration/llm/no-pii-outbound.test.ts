// Step 14.2 — nothing a student wrote leaves the process unredacted
// (docs/tech/11-llm-integration.md §3; D-066, D-650, SYS-025).
//
// This is the test that has to be right. Every other guard in the phase protects the *student* from
// the model; this one protects the student from us. A run holds their frame, their delegation
// requests, their brief, their Turn justification and their defense answers, and all of it is read
// by a third party's model the moment `FEATURE_AI=true`.
//
// **It asserts on the bytes.** Not on `redactPii` in isolation, not on the rendered prompt, not on
// the `CompleteRequest` — on the string MSW captured as the body of the HTTP request, for both
// adapters, because that is the only artefact that is actually what left. A redaction applied
// anywhere the transport can still bypass is a redaction that proves nothing, which is why §1.2's
// custom `fetch` rewrites the body *before* `fetch` rather than after the SDK's last hook.
//
// Two adapters, one property. The Anthropic body is a different shape from the MiMo body — content
// blocks, a `system` field — and asserting the same absence of both is what makes the property about
// the prompt library rather than about one provider's serialiser.
// @db:truncate
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicCalls,
  anthropicCompletion,
  resetAnthropicCalls,
} from '@tests/setup/msw/anthropic'
import { mimoCalls, mimoCompletion, mimoStream, resetMimoCalls } from '@tests/setup/msw/mimo'
import { server } from '@tests/setup/msw/server'
import { truncateAll } from '@tests/setup/integration'

vi.hoisted(() => {
  process.env.FEATURE_AI = 'true'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'test-mimo-key'
  process.env.LLM_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
  process.env.LLM_MODEL = 'mimo-v2.5-pro'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.LLM_FALLBACK_MODEL = 'claude-sonnet-5'
})

// ---------------------------------------------------------------------------------------------
// The personal details a run plausibly carries, and the figures it must keep
// ---------------------------------------------------------------------------------------------

const STUDENT_EMAIL = 'nadia.okonkwo@students.meridian.example'
const COLLEAGUE_EMAIL = 'p.vance+finance@haldenroast.example'
const PHONE = '+44 20 7946 0958'
const US_PHONE = '(555) 010-4477'
const CREDENTIALED_URL = 'https://svc:s3cr3t-token@wiki.internal.example/case-pack.pdf'

/** Every string that must not appear in an outbound body, whatever the shape of the body. */
const FORBIDDEN = [
  STUDENT_EMAIL,
  COLLEAGUE_EMAIL,
  PHONE,
  US_PHONE,
  CREDENTIALED_URL,
  's3cr3t-token',
]

/** Figures the room is made of. A redactor that ate one of these would break the numeric guard. */
const FIGURES = ['61 percent', '11 months', '28.20', '4,200', '2026-09-02']

const REQUEST = [
  'Mail me the payback working at',
  STUDENT_EMAIL,
  'or ring me on',
  PHONE,
  '- premium payback is about 11 months on a contribution of 28.20 dollars, and the line ran at 61 percent of rated hours.',
].join(' ')

const DOCUMENT_EXCERPT = [
  'Contribution is restated on the schedule dated 2026-09-02; the tooling change costs $4,200.',
  `Source pack: ${CREDENTIALED_URL}. Queries to ${COLLEAGUE_EMAIL} or ${US_PHONE}.`,
].join('\n')

type Registry = typeof import('@/server/llm/registry')
type Prompts = typeof import('@/server/llm/prompts/assistant-reply')
type BandRead = typeof import('@/server/llm/prompts/band-read-ownership')
type Anthropic = typeof import('@/server/llm/providers/anthropic')

let registry: Registry
let assistantReplyPrompt: Prompts['assistantReplyPrompt']
let bandReadOwnershipPrompt: BandRead['bandReadOwnershipPrompt']
let anthropicProvider: Anthropic['anthropicProvider']

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterAll(async () => {
  server.close()
  await truncateAll()
})

beforeEach(async () => {
  await truncateAll()
  resetMimoCalls()
  resetAnthropicCalls()
  registry = await import('@/server/llm/registry')
  registry.resetProviderRegistry()
  ;({ assistantReplyPrompt } = await import('@/server/llm/prompts/assistant-reply'))
  ;({ bandReadOwnershipPrompt } = await import('@/server/llm/prompts/band-read-ownership'))
  ;({ anthropicProvider } = await import('@/server/llm/providers/anthropic'))
})

afterEach(() => {
  server.resetHandlers()
})

const assertClean = (rawBody: string): void => {
  for (const secret of FORBIDDEN) expect(rawBody).not.toContain(secret)
  // A marker, not a deletion: the model has to know something was there (§3).
  expect(rawBody).toContain('[redacted]')
}

const assertFiguresKept = (rawBody: string): void => {
  for (const figure of FIGURES) expect(rawBody).toContain(figure)
}

// ---------------------------------------------------------------------------------------------
// The MiMo adapter
// ---------------------------------------------------------------------------------------------

describe('the body sent to MiMo', () => {
  it('carries no address, no telephone number and no credential from a delegation', async () => {
    server.use(mimoStream(['The payback working is in the memo.']))

    const { messages, input } = assistantReplyPrompt.render({
      worldSummary: `Halden Roastworks is choosing its acquisition mix. Reach the founder at ${COLLEAGUE_EMAIL}.`,
      openedDocuments: [{ title: 'Payback memo addendum', excerpt: DOCUMENT_EXCERPT }],
      request: REQUEST,
      claims: [{ id: 'C3', text: 'Premium payback is about 11 months.' }],
      turnContext: null,
    })

    for await (const _chunk of registry.getProvider().stream({
      feature: 'assistant',
      promptName: assistantReplyPrompt.name,
      promptVersion: assistantReplyPrompt.version,
      messages,
      promptInput: input,
      temperature: 0.7,
      context: {
        userId: 'user-under-test',
        runId: '11111111-1111-4111-8111-111111111111',
        requestId: 'req-pii',
      },
    })) {
      void _chunk
    }

    expect(mimoCalls).toHaveLength(1)
    const body = mimoCalls[0]?.rawBody ?? ''
    expect(body.length).toBeGreaterThan(0)
    assertClean(body)
    assertFiguresKept(body)
  })

  it('carries no identifier of the person the call was made for (D-066)', async () => {
    server.use(mimoCompletion('ok'))
    const { messages, input } = assistantReplyPrompt.render({
      worldSummary: 'Halden Roastworks is choosing its acquisition mix.',
      openedDocuments: [],
      request: REQUEST,
      claims: [],
      turnContext: null,
    })

    await registry.getProvider().complete({
      feature: 'assistant',
      promptName: assistantReplyPrompt.name,
      promptVersion: assistantReplyPrompt.version,
      messages,
      promptInput: input,
      context: {
        userId: 'user-under-test',
        runId: '11111111-1111-4111-8111-111111111111',
        packageVersionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-pii-ids',
      },
    })

    // The routing ids are for `llm_calls`, never for the provider: a run is referenced by an opaque
    // id in our own table and by nothing at all on the wire.
    const body = mimoCalls[0]?.rawBody ?? ''
    expect(body).not.toContain('user-under-test')
    expect(body).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(body).not.toContain('22222222-2222-4222-8222-222222222222')
    expect(body).not.toContain('req-pii-ids')
  })

  it('redacts a defense answer on its way into a band read', async () => {
    server.use(mimoCompletion('{"band":"proficient","quotes":[],"rationale":"Accounts for it."}'))

    const { messages, input } = bandReadOwnershipPrompt.render({
      descriptors: {
        appendix: 'A.7',
        title: 'Ownership',
        descriptors: {
          novice: 'No account of the decision.',
          developing: 'Some account, mostly restated.',
          proficient: 'Accounts for the figures and the stances.',
          professional: 'Accounts for all of it, unaided.',
        },
        fixedModifiers: 'Fixed modifiers apply.',
        boundaries: {
          novice_to_developing: 'One answer engages with the question.',
          developing_to_proficient: 'Most answers name a source.',
          proficient_to_professional: 'Every answer names what would have changed their mind.',
        },
      },
      qa: [
        {
          question: 'Where did the payback figure come from?',
          expectedAnswerNotes: 'Names the memo and its date.',
          answer: `I took it from the memo dated 2026-09-02 and mailed ${COLLEAGUE_EMAIL} about it; my own address is ${STUDENT_EMAIL} if the working is needed.`,
          followUp: null,
          followUpAnswer: null,
        },
      ],
      documentTitles: ['Retention and Payback Memo'],
    })

    await registry.getProvider().structured({
      feature: 'band_read',
      promptName: bandReadOwnershipPrompt.name,
      promptVersion: bandReadOwnershipPrompt.version,
      messages,
      promptInput: input,
      temperature: 0.2,
      schema: bandReadOwnershipPrompt.output,
      schemaName: 'OwnershipRead',
      context: { runId: '11111111-1111-4111-8111-111111111111', requestId: 'req-pii-read' },
    })

    const body = mimoCalls[0]?.rawBody ?? ''
    expect(body).not.toContain(STUDENT_EMAIL)
    expect(body).not.toContain(COLLEAGUE_EMAIL)
    expect(body).toContain('[redacted]')
    // The date the answer turns on is still there for the read to assess.
    expect(body).toContain('2026-09-02')
  })
})

// ---------------------------------------------------------------------------------------------
// The Anthropic adapter
// ---------------------------------------------------------------------------------------------

describe('the body sent to Anthropic', () => {
  it('carries the same absences, through a different serialiser', async () => {
    server.use(anthropicCompletion('The payback working is in the memo.'))

    const { messages } = assistantReplyPrompt.render({
      worldSummary: `Halden Roastworks is choosing its acquisition mix. Reach the founder at ${COLLEAGUE_EMAIL}.`,
      openedDocuments: [{ title: 'Payback memo addendum', excerpt: DOCUMENT_EXCERPT }],
      request: REQUEST,
      claims: [{ id: 'C3', text: 'Premium payback is about 11 months.' }],
      turnContext: null,
    })

    await anthropicProvider.complete({
      feature: 'assistant',
      promptName: assistantReplyPrompt.name,
      promptVersion: assistantReplyPrompt.version,
      messages,
      context: { userId: 'user-under-test', requestId: 'req-pii-anthropic' },
    })

    expect(anthropicCalls).toHaveLength(1)
    const body = anthropicCalls[0]?.rawBody ?? ''
    expect(body.length).toBeGreaterThan(0)
    assertClean(body)
    assertFiguresKept(body)
    expect(body).not.toContain('user-under-test')
  })
})

// ---------------------------------------------------------------------------------------------
// The property, stated once more where it cannot be forgotten
// ---------------------------------------------------------------------------------------------

describe('the guarantee', () => {
  it('holds for every prompt in the library, because it is the renderer that applies it', async () => {
    const { untrusted } = await import('@/server/llm/prompts/untrusted')
    // `untrusted()` is the only way an untrusted field reaches a message (asserted prompt by prompt
    // in `tests/unit/llm/prompts-hardening.test.ts`), and it redacts. A new prompt is covered the
    // day it is written, without anybody remembering to cover it.
    const block = untrusted('anything at all', `${STUDENT_EMAIL} ${PHONE} ${CREDENTIALED_URL}`)
    for (const secret of FORBIDDEN) expect(block).not.toContain(secret)
  })
})
