// The prompt library's one shape (docs/tech/11-llm-integration.md §2). Every prompt is a file
// `src/server/llm/prompts/<name>.ts` exporting `definePrompt({...})`, and nothing else in the
// codebase builds an `LlmMessage[]` by hand.
//
// What the wrapper is for, beyond tidiness:
//   - The name and version travel to `llm_calls` on every call (DATA-049), so a reply can always be
//     traced back to the wording that produced it. Bumping `version` on a wording change is the
//     only way that stays true, which is why both are required here rather than passed per call.
//   - The system message always ends with `UNTRUSTED_INSTRUCTION` (§2). Appending it here means a
//     prompt cannot be written without it, rather than being reviewed for it later.
//   - Input is validated before rendering. A prompt whose input is wrong renders a prompt that is
//     wrong, and the failure would surface as a strange model answer rather than a bad call.
import type { ZodType } from 'zod'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { LlmMessage } from '@/server/llm/provider'
import { UNTRUSTED_INSTRUCTION } from '@/server/llm/prompts/untrusted'

export type PromptExample<I, O> = { input: I; output: O }

export type PromptDef<I, O> = {
  /** kebab-case, e.g. `band-read-framing`; logged as `llm_calls.prompt_name`. */
  name: string
  /** Bump on any wording change; logged as `llm_calls.prompt_version`. */
  version: number
  purpose: string
  input: ZodType<I>
  /** The structured output schema; `z.string()` for a free-text prompt. */
  output: ZodType<O>
  system: string
  /** Must wrap every untrusted field with `untrusted(label, text)`. */
  user: (input: I) => string
  examples: PromptExample<I, O>[]
  /**
   * What one call to this prompt is allowed to cost, when the environment's defaults are wrong for
   * it (step 14.4, D-666). Both are optional and both default to the environment
   * (`LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS`); a prompt that says nothing is unchanged.
   *
   * They exist because the library's prompts are not one kind of call. An assistant reply is six
   * sentences with a student watching a cursor, and `LLM_TIMEOUT_MS=60000` is generous for it. A
   * generation step writes a whole Evidence Room inside a background job, and the first
   * real-provider run measured it wanting more than the 4,096-token ceiling and more than sixty
   * seconds — the ceiling truncated its JSON mid-document and the repair call then truncated too, so
   * the step failed as `LLM_OUTPUT_INVALID` twice over. Raising either default globally would give a
   * student-facing delegation a three-minute hang and a runaway reply room to run in, so the budget
   * belongs to the prompt that needs it.
   *
   * Every call site that renders a prompt passes these through; `structuredViaPrompt` applies them
   * to the repair call as well, which is what makes the repair as able to finish as the first pass.
   */
  maxOutputTokens?: number
  timeoutMs?: number
}

export type Prompt<I, O> = Omit<PromptDef<I, O>, 'system'> & {
  /** `name@version`, the form §2.1 and the eval reports name a prompt by. */
  readonly id: string
  /** The authored system text with `UNTRUSTED_INSTRUCTION` as its last paragraph. */
  readonly system: string
  /** Validates `rawInput` against `input`, then renders the two messages. */
  render(rawInput: unknown): { messages: LlmMessage[]; input: I }
  /** Every example's input and output parsed against the schemas; for the prompt unit tests. */
  validateExamples(): void
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The instruction is appended, not required: a prompt author writes what the model should do, and
 * the sentence that makes untrusted text safe to include is the library's job, not theirs. Idempotent,
 * so a prompt that quotes it for emphasis does not carry it twice.
 */
const withUntrustedInstruction = (system: string): string => {
  const authored = system.trim()
  return authored.includes(UNTRUSTED_INSTRUCTION)
    ? authored
    : `${authored}\n\n${UNTRUSTED_INSTRUCTION}`
}

export function definePrompt<I, O>(def: PromptDef<I, O>): Prompt<I, O> {
  if (!NAME_PATTERN.test(def.name)) {
    throw new Error(`PROMPT_NAME_INVALID: ${def.name} is not kebab-case`)
  }
  if (!Number.isInteger(def.version) || def.version < 1) {
    throw new Error(`PROMPT_VERSION_INVALID: ${def.name} version must be a positive integer`)
  }

  const system = withUntrustedInstruction(def.system)

  return {
    ...def,
    system,
    id: `${def.name}@${def.version}`,
    render(rawInput: unknown) {
      const parsed = def.input.safeParse(rawInput)
      if (!parsed.success) {
        // A prompt input is assembled by a service from data it already validated, so a failure
        // here is a bug on our side, not a bad request: it is reported as an internal error with the
        // issues, never as VALIDATION_ERROR on a student's action.
        throw new AppError('INTERNAL_ERROR', `Prompt ${def.name} received an invalid input.`, {
          details: { prompt: def.name, issues: z.prettifyError(parsed.error) },
        })
      }
      const input = parsed.data
      return {
        input,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: def.user(input) },
        ],
      }
    },
    validateExamples() {
      def.examples.forEach((example, index) => {
        const input = def.input.safeParse(example.input)
        if (!input.success) {
          throw new Error(
            `PROMPT_EXAMPLE_INPUT_INVALID: ${def.name}[${index}] ${z.prettifyError(input.error)}`,
          )
        }
        const output = def.output.safeParse(example.output)
        if (!output.success) {
          throw new Error(
            `PROMPT_EXAMPLE_OUTPUT_INVALID: ${def.name}[${index}] ${z.prettifyError(output.error)}`,
          )
        }
      })
    },
  }
}
