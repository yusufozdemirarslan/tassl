// `band-read-framing@1` (docs/tech/11-llm-integration.md §2.1, AI-003, FR-137; PRD Appendix A.1).
//
// The frame is the five fields a student locks *before the assistant is in the room* (FR-040): the
// decision they think they are making, three assumptions it rests on, a position, and a confidence
// number. It is immutable from that moment, which is what makes it worth reading — it is the one
// statement in the run that no help could have shaped.
//
// What the read decides and what it does not. `scoring/bands.ts` keeps two rules to itself: a field
// filled with a single token is A.1's Novice descriptor whatever the words say, and a run that
// opened no document before its first delegation cannot reach Professional however good the frame
// is. Both are counted from the trace, so this prompt is never told either — it reads the words
// against the descriptors and the placement is combined afterwards (D-395).
//
// `answerSpace` is the authored set of defensible positions in one paragraph, because A.1's
// Proficient and Professional descriptors both turn on whether the position sits inside it. It says
// nothing about which claims were sound: the answer space is about the decision, not the evidence.
import { z } from 'zod'
import {
  BandReadOutputSchema,
  type BandReadOutput,
  RubricDescriptorsSchema,
  bandReadSystem,
  descriptorBlock,
  field,
  listBlock,
  section,
  untrustedText,
} from '@/server/llm/prompts/band-read'
import { definePrompt } from '@/server/llm/prompts/define-prompt'

export const FramingReadInputSchema = z.object({
  descriptors: RubricDescriptorsSchema,
  frame: z.object({
    decision: untrustedText.default(''),
    assumptions: z.array(untrustedText).default([]),
    position: untrustedText.default(''),
    confidence: z.number().nullable().default(null),
  }),
  /** The authored defensible positions, joined; A.1 asks whether the position sits inside them. */
  answerSpace: untrustedText.default(''),
  /** Titles of the Evidence Room documents opened before the assistant was first used (FR-022). */
  documentsRead: z.array(untrustedText).default([]),
})
export type FramingReadInput = z.infer<typeof FramingReadInputSchema>

const TASK = `THIS DIMENSION
You are reading Framing: whether the frame names the decision the brief actually owns, whether its three assumptions are things the decision would fail without, and whether the position and the confidence number are consistent with the material named as read. Read the three fields together — a decision stated well with assumptions that restate it is not a framed decision — and read the confidence number as a claim the position has to support.`

export const bandReadFramingPrompt = definePrompt<FramingReadInput, BandReadOutput>({
  name: 'band-read-framing',
  version: 1,
  purpose:
    'Place a locked frame in one of the four Appendix A.1 bands, with quotes from its fields.',
  input: FramingReadInputSchema,
  output: BandReadOutputSchema,
  system: bandReadSystem(TASK),
  user: (input) =>
    [
      descriptorBlock(input.descriptors),
      section(
        'THE ANSWER SPACE THIS SCENARIO AUTHORS',
        input.answerSpace === ''
          ? 'No answer space was recorded for this scenario.'
          : field('answer space', input.answerSpace),
      ),
      section(
        'DOCUMENTS READ BEFORE THE ASSISTANT WAS USED',
        listBlock(
          'document title',
          input.documentsRead,
          'No document was opened before the assistant was first used.',
        ),
      ),
      section('THE FRAME — DECISION', field('decision', input.frame.decision)),
      section(
        'THE FRAME — ASSUMPTIONS',
        listBlock('assumption', input.frame.assumptions, 'No assumption was written.'),
      ),
      section('THE FRAME — POSITION', field('position', input.frame.position)),
      section(
        'THE FRAME — CONFIDENCE',
        input.frame.confidence === null
          ? 'No confidence number was recorded.'
          : `The student stated confidence ${String(input.frame.confidence)} out of 100.`,
      ),
      'Quote from the fields named decision, assumption, or position.',
    ].join('\n\n'),
  examples: [
    {
      input: {
        descriptors: {
          appendix: 'A.1',
          title: 'Framing',
          descriptors: {
            novice: 'Fields filled to pass the gate without stating a decision.',
            developing: 'The decision the brief owns is stated, but the position is a guess.',
            proficient:
              'The decision matches, two assumptions bear on it, the position is inside the answer space.',
            professional: 'Decision, all three assumptions and lean are inside the answer space.',
          },
          fixedModifiers:
            'Fixed modifiers. The frame is immutable and is the baseline for Adaptation.',
          boundaries: {
            novice_to_developing:
              '[EDIT] Novice to Developing: a frame leaves Novice when it states the decision the brief owns.',
            developing_to_proficient:
              '[EDIT] Developing to Proficient: the position sits inside the answer space.',
            proficient_to_professional:
              '[EDIT] Proficient to Professional: all three assumptions are load-bearing.',
          },
        },
        frame: {
          decision:
            'Whether to move a quarter of the acquisition budget from the value tier to premium.',
          assumptions: [
            'Premium retention holds near the piloted level',
            'Value tier payback stays close to four months',
            'Green coffee cost per bag is stable through the crop year',
          ],
          position:
            'Lean toward holding the spend where it is until the premium payback figure is traced to a cohort table.',
          confidence: 40,
        },
        answerSpace:
          'Hold the current mix; shift a limited share with a review gate; shift the full share.',
        documentsRead: ['Premium retention memo', 'Payback model'],
      },
      output: {
        band: 'proficient',
        quotes: [
          {
            field: 'position',
            text: 'Lean toward holding the spend where it is until the premium payback figure is traced to a cohort table.',
          },
        ],
        rationale:
          'The decision names the budget move the brief owns and the position sits inside the authored answer space with a stated reason. Two of the three assumptions are testable against material in the room; the third is asserted rather than traced, which holds it below the top descriptor.',
      },
    },
  ],
})
