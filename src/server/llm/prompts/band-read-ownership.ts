// `band-read-ownership@1` (docs/tech/11-llm-integration.md §2.1, AI-003, FR-125, FR-137;
// PRD Appendix A.7, §7.12).
//
// The defense is the last thing a student does and the only part of the run they do with nothing in
// front of them (FR-120). A.7 reads whether they can account for their own decision: where a figure
// came from, why a stance was set, what they would have needed to change their mind.
//
// The expected-answer notes are the authored standard each question is read against and they are in
// this prompt because §2.1 puts them there. They are also one of the strings a student may never see
// in any state (12 §8.1) — the read happens on the server, the band's rationale is written from the
// i18n template plus the model's own sentence, and the notes never travel to a student payload.
//
// Two placements the categorical rules keep: an interview where nothing was answered is the bottom
// band with an instructor flag (FR-124), and a run that reached Defense Missed is the bottom band
// and nothing else about the run moves (FR-125). Both are counted from the trace, so this prompt is
// never asked about a run in either state (D-395).
//
// `documentTitles` is the Evidence Room's titles, so an answer that cites one can be recognised as
// citing one. D-266 named it as the key this prompt would add to §2.1's list, and this is that.
import { z } from 'zod'
import {
  BandReadOutputSchema,
  type BandReadOutput,
  DEFENSE_ANSWER_MAX_CHARS,
  RubricDescriptorsSchema,
  bandReadSystem,
  cappedUntrustedText,
  descriptorBlock,
  listBlock,
  section,
  untrustedText,
} from '@/server/llm/prompts/band-read'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import { untrusted } from '@/server/llm/prompts/untrusted'

export const OwnershipReadInputSchema = z.object({
  descriptors: RubricDescriptorsSchema,
  qa: z
    .array(
      z.object({
        question: untrustedText.default(''),
        /** The authored standard for this question (DATA-024); never shown to a student. */
        expectedAnswerNotes: untrustedText.default(''),
        answer: cappedUntrustedText(DEFENSE_ANSWER_MAX_CHARS).default(''),
        followUp: untrustedText.nullable().default(null),
        followUpAnswer: cappedUntrustedText(DEFENSE_ANSWER_MAX_CHARS).nullable().default(null),
      }),
    )
    .default([]),
  /** Evidence Room titles, so an answer that names a source can be seen to name one. */
  documentTitles: z.array(untrustedText).default([]),
})
export type OwnershipReadInput = z.infer<typeof OwnershipReadInputSchema>

const TASK = `THIS DIMENSION
You are reading Ownership: whether the student can account for the decision they filed — where a figure came from, why a stance was set, what would have changed their mind — in their own words, with nothing in front of them.

Each question carries the notes its author wrote about what a sound answer covers. Read the answer against those notes: an answer that reaches the same ground in different words is a good answer, and matching the author's phrasing is not what is being read. An answer that says plainly "I do not know, and here is why" is an account of the work; an answer that restates the question is not. Where a follow-up was asked, read the pair together.`

const qaBlock = (entry: OwnershipReadInput['qa'][number], index: number): string =>
  [
    `Question ${index + 1}`,
    untrusted(`question ${index + 1}`, entry.question),
    untrusted(`expected answer notes ${index + 1}`, entry.expectedAnswerNotes),
    entry.answer === ''
      ? 'The student answered with nothing.'
      : untrusted(`answer ${index + 1}`, entry.answer),
    entry.followUp === null || entry.followUp === ''
      ? ''
      : untrusted(`follow-up ${index + 1}`, entry.followUp),
    entry.followUpAnswer === null || entry.followUpAnswer === ''
      ? ''
      : untrusted(`follow-up answer ${index + 1}`, entry.followUpAnswer),
  ]
    .filter((line) => line !== '')
    .join('\n')

export const bandReadOwnershipPrompt = definePrompt<OwnershipReadInput, BandReadOutput>({
  name: 'band-read-ownership',
  version: 1,
  purpose:
    'Place a defense transcript in one of the four Appendix A.7 bands, with quotes from the answers.',
  input: OwnershipReadInputSchema,
  output: BandReadOutputSchema,
  system: bandReadSystem(TASK),
  user: (input) =>
    [
      descriptorBlock(input.descriptors),
      section(
        'THE EVIDENCE ROOM’S DOCUMENTS',
        listBlock(
          'document title',
          input.documentTitles,
          'No document titles were recorded for this scenario.',
        ),
      ),
      section(
        'THE DEFENSE',
        input.qa.length === 0
          ? 'The defense recorded no questions.'
          : input.qa.map(qaBlock).join('\n\n'),
      ),
      'Quote from the fields named answer or follow-up answer.',
    ].join('\n\n'),
  examples: [
    {
      input: {
        descriptors: {
          appendix: 'A.7',
          title: 'Ownership',
          descriptors: {
            novice:
              'Answers that restate the question or say nothing about where anything came from.',
            developing:
              'Some answers account for the work; most do not reach the ground the notes name.',
            proficient: 'Most answers account for the work in the student’s own words.',
            professional:
              'Every answer accounts for the work, sources included, unknowns named as unknowns.',
          },
          fixedModifiers:
            'Fixed modifiers. An honest "I do not know" with a reason sits above a confident guess.',
          boundaries: {
            novice_to_developing:
              '[EDIT] Novice to Developing: one answer says where something came from.',
            developing_to_proficient:
              '[EDIT] Developing to Proficient: half the answers reach the ground the notes name.',
            proficient_to_professional:
              '[EDIT] Proficient to Professional: every answer names its source or its unknown.',
          },
        },
        qa: [
          {
            question: 'Where did the eleven-month payback figure come from?',
            expectedAnswerNotes:
              'A sound answer names the assistant as the source and says whether it was traced to a document.',
            answer:
              'The assistant gave me that figure and I did not trace it to the payback model, so I priced the recommendation on a number I had not checked.',
            followUp: null,
            followUpAnswer: null,
          },
        ],
        documentTitles: ['Payback model', 'Premium retention memo'],
      },
      output: {
        band: 'professional',
        quotes: [
          {
            field: 'answer',
            text: 'The assistant gave me that figure and I did not trace it to the payback model, so I priced the recommendation on a number I had not checked.',
          },
        ],
        rationale:
          'The answer names the source of the figure, states that it was never traced, and says what that meant for the recommendation. It reaches the ground the notes name without repeating their wording.',
      },
    },
  ],
})
