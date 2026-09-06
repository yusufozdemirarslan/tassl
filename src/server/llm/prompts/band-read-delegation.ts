// `band-read-delegation@1` (docs/tech/11-llm-integration.md §2.1, AI-003, FR-064, FR-137;
// PRD Appendix A.2).
//
// Delegation is read off the log the run wrote: each request the student put to the assistant, the
// why line they attached to it, and how many of the claims that came back they marked as used. A.2
// is about purpose — whether a request was aimed at something the decision needed — and about
// whether reliance was reasoned rather than assumed.
//
// Two shapes of run reach this prompt without a log to read, and both are FR-064's:
//
//   * **No delegation at all.** Working without the assistant is a legitimate way to run, so the
//     read looks for the stated reason instead. `scoring/reads.ts` fills `reasonForNotDelegating`
//     from the defense answers, which is where a student says how they worked (10 §11.3), and
//     `bands.ts` marks the band `defense_only`.
//   * **An incomplete log** — a delegation whose reply never arrived. The same fallback, the same
//     basis, decided by the trace rather than here.
//
// The response text the assistant produced is deliberately absent. A.2 bands the student's use of
// the assistant, not the assistant's answers, and the replies are the longest untrusted text in the
// run — every claim it carried, verbatim — which would be the widest injection surface in the
// pipeline for material that decides nothing.
import { z } from 'zod'
import {
  BandReadOutputSchema,
  type BandReadOutput,
  DEFENSE_ANSWER_MAX_CHARS,
  RubricDescriptorsSchema,
  bandReadSystem,
  cappedUntrustedText,
  descriptorBlock,
  field,
  listBlock,
  section,
  untrustedText,
} from '@/server/llm/prompts/band-read'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import { untrusted } from '@/server/llm/prompts/untrusted'

export const DelegationReadInputSchema = z.object({
  descriptors: RubricDescriptorsSchema,
  delegations: z
    .array(
      z.object({
        request: untrustedText.default(''),
        /** FR-060's why line; null when the student attached none. */
        why: untrustedText.nullable().default(null),
        /** How many claims from this delegation the student marked used (FR-084). */
        usedClaimCount: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  /** FR-064: what the student said about working without the assistant, when they did. */
  reasonForNotDelegating: untrustedText.nullable().default(null),
  defenseAnswers: z.array(cappedUntrustedText(DEFENSE_ANSWER_MAX_CHARS)).default([]),
})
export type DelegationReadInput = z.infer<typeof DelegationReadInputSchema>

const TASK = `THIS DIMENSION
You are reading Delegation: whether each request to the assistant was aimed at something the decision needed, and whether the student gave a reason for relying on what came back. A run with no delegation is not automatically low — read the stated reason for working without one. Judge the requests and the reasons, never the assistant's answers, which are not shown to you.`

const delegationBlock = (
  entry: DelegationReadInput['delegations'][number],
  index: number,
): string =>
  [
    `Delegation ${index + 1} — ${String(entry.usedClaimCount)} claim(s) marked used`,
    untrusted(`request ${index + 1}`, entry.request),
    entry.why === null || entry.why === ''
      ? 'No why line was attached to this delegation.'
      : untrusted(`why ${index + 1}`, entry.why),
  ].join('\n')

export const bandReadDelegationPrompt = definePrompt<DelegationReadInput, BandReadOutput>({
  name: 'band-read-delegation',
  version: 1,
  purpose:
    'Place a run’s use of the assistant in one of the four Appendix A.2 bands, with quotes from the log.',
  input: DelegationReadInputSchema,
  output: BandReadOutputSchema,
  system: bandReadSystem(TASK),
  user: (input) =>
    [
      descriptorBlock(input.descriptors),
      section(
        'THE DELEGATION LOG',
        input.delegations.length === 0
          ? 'This run made no request to the assistant.'
          : input.delegations.map(delegationBlock).join('\n\n'),
      ),
      section(
        'THE STATED REASON FOR WORKING WITHOUT THE ASSISTANT',
        input.reasonForNotDelegating === null || input.reasonForNotDelegating === ''
          ? 'No reason was stated.'
          : field('reasonForNotDelegating', input.reasonForNotDelegating),
      ),
      section(
        'WHAT THE STUDENT SAID IN THE DEFENSE',
        listBlock('defense answer', input.defenseAnswers, 'The defense recorded no answers.'),
      ),
      'Quote from the fields named request, why, or reasonForNotDelegating.',
    ].join('\n\n'),
  examples: [
    {
      input: {
        descriptors: {
          appendix: 'A.2',
          title: 'Delegation',
          descriptors: {
            novice: 'Requests with no stated purpose and reliance with no reason.',
            developing: 'Some requests are purposeful; reliance is mostly unexplained.',
            proficient:
              'Most requests are aimed at something the decision needs, with reasons attached.',
            professional: 'Every request is aimed and every reliance carries a reason.',
          },
          fixedModifiers:
            'Fixed modifiers. An incomplete log is read from the defense answers instead.',
          boundaries: {
            novice_to_developing:
              '[EDIT] Novice to Developing: at least one request states what it is for.',
            developing_to_proficient:
              '[EDIT] Developing to Proficient: half the delegations carry a why line.',
            proficient_to_professional:
              '[EDIT] Proficient to Professional: every reliance is reasoned.',
          },
        },
        delegations: [
          {
            request: 'What is the premium payback and where does the figure come from?',
            why: 'The recommendation is priced on this number, so I need its source before I lean on it.',
            usedClaimCount: 2,
          },
        ],
        reasonForNotDelegating: null,
        defenseAnswers: [
          'I asked for the payback because the whole recommendation is sized on it.',
        ],
      },
      output: {
        band: 'professional',
        quotes: [
          {
            field: 'why',
            text: 'The recommendation is priced on this number, so I need its source before I lean on it.',
          },
        ],
        rationale:
          'The single request names what it is for and asks for the source rather than the figure alone. The why line states why the answer was relied on, and the claims taken from it were marked used, which is what the top descriptor asks of every reliance.',
      },
    },
  ],
})
