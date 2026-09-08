// MSW handlers for the MiMo endpoint (docs/tech/11-llm-integration.md §1.2, D-028; step 14.1).
//
// Steps 14.1 to 14.3 never call the real provider — 14.4 is where a key belongs — so every test of
// the adapter, the guardrails and the degradation ladder answers from here. The handlers are
// deliberately **not** in `handlers` on `tests/setup/msw/server.ts`: the unit project runs with
// `onUnhandledRequest: 'error'`, and leaving these off by default is what makes "the mock provider
// reached no network at all" a fact a test can prove by not installing them.
//
// Every handler records the call first — headers, the raw bytes, and the parsed body — because two
// of this phase's assertions are about the request rather than the answer:
// `tests/unit/llm/openai-compatible.test.ts` reads the `thinking` field and the two auth headers off
// it, and `tests/integration/llm/no-pii-outbound.test.ts` reads the raw string to prove that nothing
// a student wrote left the process unredacted.
import { HttpResponse, delay, http, type HttpHandler } from 'msw'

export const MIMO_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
export const MIMO_COMPLETIONS_URL = `${MIMO_BASE_URL}/chat/completions`

export type RecordedCall = {
  headers: Record<string, string>
  /** The bytes on the wire, exactly. The PII assertions read this and not the parsed object. */
  rawBody: string
  body: Record<string, unknown>
}

export const mimoCalls: RecordedCall[] = []

export function resetMimoCalls(): void {
  mimoCalls.length = 0
}

async function record(request: Request): Promise<void> {
  const rawBody = await request.clone().text()
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = {}
  }
  mimoCalls.push({
    headers: Object.fromEntries(request.headers.entries()),
    rawBody,
    body,
  })
}

const completion = (text: string, model: string) => ({
  id: 'chatcmpl-tassl-test',
  object: 'chat.completion',
  created: 1_780_000_000,
  model,
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 41, completion_tokens: 17, total_tokens: 58 },
})

/** A non-streaming answer. `text` is returned verbatim, so a JSON-mode answer is just a JSON string. */
export function mimoCompletion(text: string, model = 'mimo-v2.5-pro'): HttpHandler {
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    await record(request)
    return HttpResponse.json(completion(text, model))
  })
}

/**
 * A queue of answers, one per call, so a repair call (§1.2) can be given a different answer from the
 * first. The last entry is repeated once the queue is exhausted.
 */
export function mimoCompletionSequence(
  texts: readonly string[],
  model = 'mimo-v2.5-pro',
): HttpHandler {
  let index = 0
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    await record(request)
    const text = texts[Math.min(index, texts.length - 1)] ?? ''
    index += 1
    return HttpResponse.json(completion(text, model))
  })
}

const sseChunk = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

/** The OpenAI streaming shape: one `delta.content` per chunk, then a usage block, then `[DONE]`. */
export function mimoStream(chunks: readonly string[], model = 'mimo-v2.5-pro'): HttpHandler {
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    await record(request)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const [index, content] of chunks.entries()) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: 'chatcmpl-tassl-test',
                object: 'chat.completion.chunk',
                created: 1_780_000_000,
                model,
                choices: [
                  {
                    index: 0,
                    delta: index === 0 ? { role: 'assistant', content } : { content },
                    finish_reason: null,
                  },
                ],
              }),
            ),
          )
        }
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: 'chatcmpl-tassl-test',
              object: 'chat.completion.chunk',
              created: 1_780_000_000,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 41, completion_tokens: 17, total_tokens: 58 },
            }),
          ),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new HttpResponse(body, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  })
}

/**
 * An HTTP failure. `times` answers that many calls and then falls through to whatever handler is
 * installed after it — which is how a test proves that a retry succeeded on the second attempt.
 */
export function mimoStatus(status: number, times = Number.POSITIVE_INFINITY): HttpHandler {
  let served = 0
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    if (served >= times) return undefined
    served += 1
    await record(request)
    return HttpResponse.json(
      { error: { message: `mimo test failure ${String(status)}`, type: 'server_error' } },
      { status },
    )
  })
}

/** An answer that takes longer than the caller's `timeoutMs`; the abort path of §3. */
export function mimoSlow(delayMs: number, text = 'too late'): HttpHandler {
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    await record(request)
    await delay(delayMs)
    return HttpResponse.json(completion(text, 'mimo-v2.5-pro'))
  })
}

/** A connection that never completes: the network case §3 names first. */
export function mimoNetworkError(times = Number.POSITIVE_INFINITY): HttpHandler {
  let served = 0
  return http.post(MIMO_COMPLETIONS_URL, async ({ request }) => {
    if (served >= times) return undefined
    served += 1
    await record(request)
    return HttpResponse.error()
  })
}
