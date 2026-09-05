// Step 7.1 — `structuredViaPrompt` (docs/tech/11-llm-integration.md §1.2).
//
// Structured output is the path every band read and every generation step takes, on the mock today
// and on MiMo in Phase 14, and neither provider enforces a JSON schema. So the contract this file
// pins is the whole guarantee the callers have: the schema reaches the model as an instruction, the
// object is found inside whatever prose came back, it is validated, one repair is spent when it
// fails, and a second failure is `LLM_OUTPUT_INVALID` rather than a silently wrong object.
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { isAppError } from '@/lib/errors'
import type { CompleteResult, LlmMessage, StructuredRequest } from '@/server/llm/provider'
import {
  JSON_INSTRUCTION,
  extractJsonObject,
  structuredViaPrompt,
  withJsonInstruction,
} from '@/server/llm/structured'

const Schema = z.object({ band: z.enum(['novice', 'professional']), quotes: z.array(z.string()) })
type Shape = z.infer<typeof Schema>

const request = (): StructuredRequest<Shape> => ({
  feature: 'band_read',
  promptName: 'band-read-framing',
  promptVersion: 1,
  messages: [
    { role: 'system', content: 'You read a frame.' },
    { role: 'user', content: 'Here is the frame.' },
  ],
  schema: Schema,
  schemaName: 'FramingRead',
  context: { requestId: 'req-structured' },
})

const answer = (text: string): CompleteResult => ({
  text,
  usage: { inputTokens: 10, outputTokens: 5 },
  model: 'mock-v1',
  provider: 'mock',
})

const VALID = '{"band":"professional","quotes":["the position"]}'

describe('withJsonInstruction', () => {
  it('appends the schema instruction to the existing system message', () => {
    const messages = withJsonInstruction(request())
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('You read a frame.')
    expect(messages[0]?.content).toContain(JSON_INSTRUCTION)
    expect(messages[0]?.content).toContain('"band"')
    expect(messages[1]?.content).toBe('Here is the frame.')
  })

  it('opens a system message when the prompt had none', () => {
    const messages: LlmMessage[] = [{ role: 'user', content: 'only a user turn' }]
    const built = withJsonInstruction({ ...request(), messages })
    expect(built[0]?.role).toBe('system')
    expect(built[0]?.content).toContain(JSON_INSTRUCTION)
    expect(built).toHaveLength(2)
  })
})

describe('extractJsonObject', () => {
  it('finds the first balanced object after a preamble or a fence', () => {
    expect(extractJsonObject('Sure! ```json\n{"a":1}\n``` done')).toBe('{"a":1}')
    expect(extractJsonObject('{"a":{"b":2}} trailing')).toBe('{"a":{"b":2}}')
  })

  it('is not closed by a brace inside a string, escaped or not', () => {
    expect(extractJsonObject('{"a":"} not the end","b":1}')).toBe('{"a":"} not the end","b":1}')
    expect(extractJsonObject('{"a":"quote \\" then }","b":1}')).toBe(
      '{"a":"quote \\" then }","b":1}',
    )
  })

  it('answers null when there is no object and when it never closes', () => {
    expect(extractJsonObject('no object here')).toBeNull()
    expect(extractJsonObject('{"a":1')).toBeNull()
  })
})

describe('structuredViaPrompt', () => {
  it('parses and validates a first answer, and does not repair', async () => {
    const complete = vi.fn(async () => answer(VALID))
    const result = await structuredViaPrompt(request(), complete)

    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.value).toEqual({ band: 'professional', quotes: ['the position'] })
    expect(result.repaired).toBe(false)
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('repairs once, reports repaired, and sums the usage of both calls', async () => {
    const complete = vi
      .fn<(messages: LlmMessage[]) => Promise<CompleteResult>>()
      .mockResolvedValueOnce(answer('{"band":"legendary","quotes":[]}'))
      .mockResolvedValueOnce(answer(VALID))

    const result = await structuredViaPrompt(request(), complete)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.repaired).toBe(true)
    expect(result.value.band).toBe('professional')
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 })

    // The repair call carries the raw answer and the Zod issues, per §1.2 step 4.
    const repairMessages = complete.mock.calls[1]?.[0] ?? []
    expect(repairMessages.at(-2)).toEqual({
      role: 'assistant',
      content: '{"band":"legendary","quotes":[]}',
    })
    const followUp = repairMessages.at(-1)?.content ?? ''
    expect(followUp).toContain('The JSON failed validation')
    expect(followUp).toContain('Return the corrected JSON object only.')
  })

  it('repairs an answer that held no JSON at all', async () => {
    const complete = vi
      .fn<(messages: LlmMessage[]) => Promise<CompleteResult>>()
      .mockResolvedValueOnce(answer('I would rather explain it in prose.'))
      .mockResolvedValueOnce(answer(VALID))

    const result = await structuredViaPrompt(request(), complete)
    expect(result.repaired).toBe(true)
    expect(complete.mock.calls[1]?.[0]?.at(-1)?.content).toContain('no JSON object')
  })

  it('throws LLM_OUTPUT_INVALID after a second failure and does not call again', async () => {
    const complete = vi.fn(async () => answer('{"band":"legendary"}'))

    await expect(structuredViaPrompt(request(), complete)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'LLM_OUTPUT_INVALID',
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('carries the summed usage on the thrown error, so the call is still logged for what it cost', async () => {
    const complete = vi.fn(async () => answer('{"band":"legendary"}'))
    const error = await structuredViaPrompt(request(), complete).catch((e: unknown) => e)

    expect(isAppError(error)).toBe(true)
    const details = isAppError(error) ? (error.opts.details as { usage?: unknown }) : {}
    expect(details.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
  })
})
