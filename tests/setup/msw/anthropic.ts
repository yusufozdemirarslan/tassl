// MSW handlers for the Anthropic Messages API (docs/tech/11-llm-integration.md §1.3, D-103;
// step 14.1).
//
// The fallback provider's double. It shares `RecordedCall` and the recording rule with the MiMo
// handlers for one reason: `tests/integration/llm/no-pii-outbound.test.ts` asserts the *same*
// property about *both* outbound bodies, and it can only do that if both are captured the same way.
//
// The Messages API is not the chat-completions API, so the shapes below are Anthropic's own: content
// blocks rather than a message string, `usage.input_tokens` rather than `prompt_tokens`, and a
// stream of named SSE events rather than one chunk shape.
import { HttpResponse, http, type HttpHandler } from 'msw'
import type { RecordedCall } from './mimo'

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

export const anthropicCalls: RecordedCall[] = []

export function resetAnthropicCalls(): void {
  anthropicCalls.length = 0
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
  anthropicCalls.push({ headers: Object.fromEntries(request.headers.entries()), rawBody, body })
}

const message = (text: string, model: string) => ({
  id: 'msg_tassl_test',
  type: 'message',
  role: 'assistant',
  model,
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 33, output_tokens: 14 },
})

export function anthropicCompletion(text: string, model = 'claude-sonnet-5'): HttpHandler {
  return http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
    await record(request)
    return HttpResponse.json(message(text, model))
  })
}

const event = (name: string, payload: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`

export function anthropicStream(chunks: readonly string[], model = 'claude-sonnet-5'): HttpHandler {
  return http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
    await record(request)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (name: string, payload: unknown): void => {
          controller.enqueue(encoder.encode(event(name, payload)))
        }
        send('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_tassl_test',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 33, output_tokens: 0 },
          },
        })
        send('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })
        for (const text of chunks) {
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          })
        }
        send('content_block_stop', { type: 'content_block_stop', index: 0 })
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 14 },
        })
        send('message_stop', { type: 'message_stop' })
        controller.close()
      },
    })
    return new HttpResponse(body, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  })
}

export function anthropicStatus(status: number, times = Number.POSITIVE_INFINITY): HttpHandler {
  let served = 0
  return http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
    if (served >= times) return undefined
    served += 1
    await record(request)
    return HttpResponse.json(
      { type: 'error', error: { type: 'api_error', message: 'anthropic test failure' } },
      { status },
    )
  })
}
