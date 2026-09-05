// Structured output without native JSON-schema enforcement (docs/tech/11-llm-integration.md §1.2).
//
// Every provider Tassl talks to gets structured output the same way: ask for a JSON object, describe
// the shape as a JSON Schema in the system message, extract the object from whatever came back,
// validate it with the caller's Zod schema, and on a failure spend exactly one repair call before
// giving up. Nothing here depends on tool calling or on `response_format: json_schema`, because MiMo
// enforces neither (§1.2) and the mock has no such machinery at all.
//
// One repair, not a loop: a second wrong answer is a prompt or schema problem, and retrying it costs
// tokens and latency to arrive at the same place. `LLM_OUTPUT_INVALID` is honest about that, and the
// wrapper logs the call as `validation_failed` so the rate of it is visible (§4).
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type {
  CompleteResult,
  LlmMessage,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
} from '@/server/llm/provider'

/** How the caller reaches its own provider; the adapter closes over `temperature: 0.2` (§1.2). */
export type CompleteMessages = (messages: LlmMessage[]) => Promise<CompleteResult>

export const JSON_INSTRUCTION =
  'Respond with a single JSON object and nothing else. It must validate against this JSON Schema:'

const REPAIR_INSTRUCTION = 'Return the corrected JSON object only.'

/**
 * The schema as JSON Schema, in its *input* form: the model has to produce something the schema
 * accepts, so defaults and transforms are described the way they arrive, not the way they leave.
 *
 * A schema JSON Schema cannot express (a refinement, a custom type) is not a reason to fail the
 * call — Zod still validates the answer, which is what actually decides the outcome — so it is
 * rendered as `any` and, if even that throws, the instruction falls back to naming the schema.
 */
export function schemaText<T>(schema: StructuredRequest<T>['schema'], schemaName: string): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }))
  } catch {
    return JSON.stringify({ title: schemaName, type: 'object' })
  }
}

/**
 * Appends the JSON instruction to the system message, or opens one when the prompt had none.
 *
 * Appending rather than adding a second system message keeps every adapter honest: the Anthropic API
 * takes one system string, and two would have to be joined somewhere anyway.
 */
export function withJsonInstruction<T>(req: StructuredRequest<T>): LlmMessage[] {
  const instruction = `${JSON_INSTRUCTION}\n${schemaText(req.schema, req.schemaName)}`
  const index = req.messages.findIndex((message) => message.role === 'system')
  if (index === -1) return [{ role: 'system', content: instruction }, ...req.messages]
  return req.messages.map((message, at) =>
    at === index ? { ...message, content: `${message.content}\n\n${instruction}` } : message,
  )
}

/**
 * The first balanced `{…}` block, or null when the text holds none.
 *
 * Brace counting rather than a regex, because a JSON object nests and a regex cannot count. Strings
 * are tracked so a brace inside `"a } b"` does not close the object, and the backslash escape is
 * honoured so `"a \" }"` does not leave string state early. Everything before the first `{` is
 * dropped, which is what strips a ```json fence, a preamble sentence, or a reasoning trace.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let at = start; at < text.length; at += 1) {
    const character = text[at]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, at + 1)
    }
  }
  return null
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; issues: string }

function parseAndValidate<T>(
  text: string,
  schema: StructuredRequest<T>['schema'],
): ParseOutcome<T> {
  const block = extractJsonObject(text)
  if (block === null) return { ok: false, issues: 'The response contained no JSON object.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch (error) {
    return { ok: false, issues: `The JSON did not parse: ${(error as Error).message}` }
  }

  const result = schema.safeParse(parsed)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: z.prettifyError(result.error) }
}

const addUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

/**
 * §1.2, in order: instruct, call, extract, validate; on failure one repair call carrying the raw
 * output and the Zod issues; on a second failure `LLM_OUTPUT_INVALID`.
 *
 * The usage of both calls is summed, so a repaired call costs what it actually cost in the budget
 * and in the cost estimate. `repaired` is what makes the wrapper log the outcome `repaired` rather
 * than `ok` — the rate of repairs is the signal that a prompt or a schema has drifted.
 */
export async function structuredViaPrompt<T>(
  req: StructuredRequest<T>,
  complete: CompleteMessages,
): Promise<StructuredResult<T>> {
  const messages = withJsonInstruction(req)

  const first = await complete(messages)
  const firstAttempt = parseAndValidate(first.text, req.schema)
  if (firstAttempt.ok) {
    return {
      value: firstAttempt.value,
      repaired: false,
      raw: first.text,
      usage: first.usage,
      model: first.model,
      provider: first.provider,
    }
  }

  const repair = await complete([
    ...messages,
    { role: 'assistant', content: first.text },
    {
      role: 'user',
      content: `The JSON failed validation: ${firstAttempt.issues}. ${REPAIR_INSTRUCTION}`,
    },
  ])
  const usage = addUsage(first.usage, repair.usage)
  const secondAttempt = parseAndValidate(repair.text, req.schema)
  if (secondAttempt.ok) {
    return {
      value: secondAttempt.value,
      repaired: true,
      raw: repair.text,
      usage,
      model: repair.model,
      provider: repair.provider,
    }
  }

  throw new AppError(
    'LLM_OUTPUT_INVALID',
    `The ${req.promptName} response did not match ${req.schemaName} after one repair.`,
    {
      details: {
        prompt: req.promptName,
        schema: req.schemaName,
        firstIssues: firstAttempt.issues,
        repairIssues: secondAttempt.issues,
        usage,
      },
    },
  )
}
