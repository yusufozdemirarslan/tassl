// `band-read-decision-quality@1` (docs/tech/11-llm-integration.md §2.1, AI-003, FR-109, FR-137;
// PRD Appendix A.5, §7.10).
//
// The brief as locked: a recommendation, the rationale under it, and three assumptions. A.5 asks
// whether the recommendation is a decision somebody could act on, whether it sits inside the
// authored answer space, and whether the rationale actually carries it.
//
// This is the one read that reports something besides a band. FR-109 fixes three placements the
// band rules apply afterwards and this prompt cannot: a recommendation outside the answer space, a
// recommendation matching the position the author built to be inconsistent with the evidence, and a
// declining recommendation where the answer space states a minimum commitment. So the output names
// the position it matched — `matchedPositionKey`, null when none — and `scoring/bands.ts` turns that
// into the placement (D-395). Asking the model for the key rather than the verdict keeps the fixed
// placements in code where they can be tested.
//
// `superseded` is the pairs of claim text and the title of the document that superseded it, so a
// rationale resting on a figure the room has already replaced can be seen for what it is. It carries
// no evidence status: a superseded document is an authored fact about the Evidence Room, the same
// one the debrief shows, not a mark on which claims were defective.
import { z } from 'zod'
import {
  DecisionQualityOutputSchema,
  type DecisionQualityOutput,
  RubricDescriptorsSchema,
  bandReadSystem,
  descriptorBlock,
  field,
  listBlock,
  section,
  untrustedText,
} from '@/server/llm/prompts/band-read'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import { untrusted } from '@/server/llm/prompts/untrusted'

export const DecisionQualityReadInputSchema = z.object({
  descriptors: RubricDescriptorsSchema,
  recommendation: untrustedText.default(''),
  rationale: untrustedText.default(''),
  assumptions: z.array(untrustedText).default([]),
  answerSpace: z.object({
    positions: z
      .array(
        z.object({
          key: z.string().default(''),
          kind: z.enum(['defensible', 'evidence_inconsistent']).default('defensible'),
          summary: untrustedText.default(''),
          /** Present on the position the author built to ignore something in the room. */
          ignoredEvidence: untrustedText.nullable().default(null),
          isMinimumCommitment: z.boolean().default(false),
        }),
      )
      .default([]),
  }),
  /** Claims whose source document another document supersedes (DATA-017 `role = superseded`). */
  superseded: z
    .array(
      z.object({ claimText: untrustedText.default(''), documentTitle: untrustedText.default('') }),
    )
    .default([]),
})
export type DecisionQualityReadInput = z.infer<typeof DecisionQualityReadInputSchema>

const TASK = `THIS DIMENSION
You are reading Decision Quality: whether the recommendation is a decision that can be acted on, whether it is one of the positions this scenario authors, and whether the rationale under it carries it.

Also name the authored position the recommendation matches, in "matchedPositionKey", using the key exactly as listed below. Match on what the recommendation commits to, not on wording. Use null when it commits to none of them — a recommendation outside the listed positions, or one that declines to recommend anything. Never invent a key.`

const positionLine = (
  position: DecisionQualityReadInput['answerSpace']['positions'][number],
  index: number,
): string =>
  [
    `Position ${index + 1} — key: ${position.key}${position.isMinimumCommitment ? ' (the minimum commitment this scenario states)' : ''}${position.kind === 'evidence_inconsistent' ? ' (inconsistent with the material in the room)' : ''}`,
    untrusted(`position ${position.key}`, position.summary),
    position.ignoredEvidence === null || position.ignoredEvidence === ''
      ? ''
      : untrusted(`position ${position.key} ignores`, position.ignoredEvidence),
  ]
    .filter((line) => line !== '')
    .join('\n')

const supersededLine = (
  entry: DecisionQualityReadInput['superseded'][number],
  index: number,
): string =>
  [
    untrusted(`superseded claim ${index + 1}`, entry.claimText),
    untrusted(`superseded by ${index + 1}`, entry.documentTitle),
  ].join('\n')

export const bandReadDecisionQualityPrompt = definePrompt<
  DecisionQualityReadInput,
  DecisionQualityOutput
>({
  name: 'band-read-decision-quality',
  version: 1,
  purpose:
    'Place a locked brief in one of the four Appendix A.5 bands and name the authored position it matched.',
  input: DecisionQualityReadInputSchema,
  output: DecisionQualityOutputSchema,
  system: bandReadSystem(TASK),
  user: (input) =>
    [
      descriptorBlock(input.descriptors),
      section(
        'THE POSITIONS THIS SCENARIO AUTHORS',
        input.answerSpace.positions.length === 0
          ? 'No answer space was recorded for this scenario.'
          : input.answerSpace.positions.map(positionLine).join('\n\n'),
      ),
      section(
        'MATERIAL THE ROOM HAS ALREADY SUPERSEDED',
        input.superseded.length === 0
          ? 'Nothing in the room was superseded.'
          : input.superseded.map(supersededLine).join('\n\n'),
      ),
      section('THE RECOMMENDATION', field('recommendation', input.recommendation)),
      section('THE RATIONALE', field('rationale', input.rationale)),
      section(
        'THE BRIEF’S ASSUMPTIONS',
        listBlock('assumption', input.assumptions, 'No assumption was written.'),
      ),
      'Quote from the fields named recommendation, rationale, or assumption.',
    ].join('\n\n'),
  examples: [
    {
      input: {
        descriptors: {
          appendix: 'A.5',
          title: 'Decision Quality',
          descriptors: {
            novice: 'No recommendation, or one outside the positions this scenario authors.',
            developing:
              'A recommendation inside the answer space with a rationale that does not carry it.',
            proficient:
              'A recommendation inside the answer space with a rationale that carries it.',
            professional: 'A recommendation that names what it commits to and what it gives up.',
          },
          fixedModifiers:
            'Fixed modifiers. A quick lock is a signal for the instructor, not a penalty.',
          boundaries: {
            novice_to_developing:
              '[EDIT] Novice to Developing: the recommendation names an action.',
            developing_to_proficient:
              '[EDIT] Developing to Proficient: the rationale names the evidence it rests on.',
            proficient_to_professional:
              '[EDIT] Proficient to Professional: the brief names what the choice gives up.',
          },
        },
        recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
        rationale:
          'The premium payback figure is load-bearing and has not been traced to the cohort table, so moving spend on it would be a bet on a number nobody has checked.',
        assumptions: [
          'Premium retention holds near the piloted level',
          'Value tier payback stays close to four months',
          'Green coffee cost per bag is stable through the crop year',
        ],
        answerSpace: {
          positions: [
            {
              key: 'hold_current_mix',
              kind: 'defensible',
              summary: 'Hold the acquisition mix where it is until the payback figure is traced.',
              ignoredEvidence: null,
              isMinimumCommitment: true,
            },
            {
              key: 'shift_full_share',
              kind: 'evidence_inconsistent',
              summary:
                'Move the full share to premium on the strength of the piloted retention number.',
              ignoredEvidence: 'The cohort table showing the pilot ran under the old pricing.',
              isMinimumCommitment: false,
            },
          ],
        },
        superseded: [],
      },
      output: {
        band: 'proficient',
        matchedPositionKey: 'hold_current_mix',
        quotes: [
          {
            field: 'recommendation',
            text: 'Hold the acquisition spend in the value tier for this quarter.',
          },
        ],
        rationale:
          'The recommendation commits to one of the authored positions and the rationale names the untraced figure it turns on. It does not say what holding gives up, which the top descriptor asks for.',
      },
    },
  ],
})
