// `band-read-adaptation@1` (docs/tech/11-llm-integration.md §2.1, AI-003, FR-115, FR-137;
// PRD Appendix A.6, §7.11).
//
// One thing arrives after the decision is locked and cannot be unlocked: the Turn. A.6 reads what
// the student did with it — held, revised or reversed — beside the frame they locked before any of
// it, and the justification they wrote for the move.
//
// **Holding with a reason and revising where revision was warranted score identically** (PRD §7.11,
// FR-139). That is a property of `scoring/bands.ts`, not of this prompt: the categorical rule places
// over-adaptation, under-adaptation and an unanswered window on its own, and a response that matched
// its warrant is Proficient before anyone reads a word. Only this read can lift such a run to
// Professional, and it can never lower one — so the direction the student moved in is not an input
// to the band, only whether the justification engages with what arrived and with what it disturbs.
//
// `warrantsChange` and `proportionateResponse` are the Turn's authored warrant, and §2.1 puts both
// in this input because "was the response proportionate" is the question A.6 asks. They are authored
// properties of the Turn, not the per-claim answer key — no warranted stance, evidence status,
// failure family or planted flag is anywhere in this prompt — and they never leave the server: 12
// §8.1 forbids both field names in any student payload in any state, and D-396 keeps the band's
// rationale from naming what the Turn warranted.
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

export const AdaptationReadInputSchema = z.object({
  descriptors: RubricDescriptorsSchema,
  frame: z.object({
    decision: untrustedText.default(''),
    assumptions: z.array(untrustedText).default([]),
    position: untrustedText.default(''),
    confidence: z.number().nullable().default(null),
  }),
  turnText: untrustedText.default(''),
  /** The authored warrant: whether the message calls for any change at all. */
  warrantsChange: z.boolean().default(false),
  /** The authored proportionate move: `hold`, `revise` or `reverse`. */
  proportionateResponse: z.enum(['hold', 'revise', 'reverse']).default('hold'),
  /** What the student filed. Empty when the window closed unanswered (FR-115). */
  response: z.enum(['hold', 'revise', 'reverse', '']).default(''),
  justification: untrustedText.default(''),
})
export type AdaptationReadInput = z.infer<typeof AdaptationReadInputSchema>

const TASK = `THIS DIMENSION
You are reading Adaptation: whether the justification shows the student understood what arrived and what it disturbs in the frame they locked before it.

Holding a position with a stated reason and revising it where revision was called for are read the same way. Do not reward movement and do not reward standing firm; read only whether the justification engages with the message and names what in the frame it bears on. A response filed with no justification cannot reach the upper descriptors whichever direction it went.`

export const bandReadAdaptationPrompt = definePrompt<AdaptationReadInput, BandReadOutput>({
  name: 'band-read-adaptation',
  version: 1,
  purpose:
    'Place a Turn response and its justification in one of the four Appendix A.6 bands, with quotes.',
  input: AdaptationReadInputSchema,
  output: BandReadOutputSchema,
  system: bandReadSystem(TASK),
  user: (input) =>
    [
      descriptorBlock(input.descriptors),
      section('WHAT ARRIVED AFTER THE DECISION WAS LOCKED', field('turn', input.turnText)),
      section(
        'WHAT THE MESSAGE CALLS FOR',
        `The message ${input.warrantsChange ? 'calls for a change' : 'calls for no change'}; the proportionate move is to ${input.proportionateResponse}.`,
      ),
      section('THE FRAME LOCKED BEFORE ANY HELP', field('decision', input.frame.decision)),
      section(
        'THE FRAME’S ASSUMPTIONS',
        listBlock('assumption', input.frame.assumptions, 'No assumption was written.'),
      ),
      section('THE FRAME’S POSITION', field('position', input.frame.position)),
      section(
        'WHAT THE STUDENT FILED',
        input.response === ''
          ? 'The window closed with nothing filed, which the run records as a hold.'
          : `The student chose to ${input.response}.`,
      ),
      section(
        'THE JUSTIFICATION',
        input.justification === ''
          ? 'No justification was written.'
          : field('justification', input.justification),
      ),
      'Quote from the field named justification.',
    ].join('\n\n'),
  examples: [
    {
      input: {
        descriptors: {
          appendix: 'A.6',
          title: 'Adaptation',
          descriptors: {
            novice:
              'A move out of proportion to what arrived, or a filed response with no justification.',
            developing: 'A proportionate move whose justification restates the message.',
            proficient: 'A proportionate move whose justification engages with the message.',
            professional:
              'A proportionate move whose justification names the framed assumption it disturbs.',
          },
          fixedModifiers:
            'Fixed modifiers. Holding with a stated reason scores as highly as warranted revision.',
          boundaries: {
            novice_to_developing: '[EDIT] Novice to Developing: a justification is written at all.',
            developing_to_proficient:
              '[EDIT] Developing to Proficient: the justification engages with the message.',
            proficient_to_professional:
              '[EDIT] Proficient to Professional: the justification names the assumption disturbed.',
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
          position: 'Lean toward holding the spend where it is.',
          confidence: 40,
        },
        turnText:
          'The pilot cohort was acquired under the old pricing, so its retention is not comparable.',
        warrantsChange: true,
        proportionateResponse: 'revise',
        response: 'revise',
        justification:
          'The pilot cohort was priced differently, so my first assumption that premium retention holds near the piloted level no longer stands and the share sized on it comes down.',
      },
      output: {
        band: 'professional',
        quotes: [
          {
            field: 'justification',
            text: 'The pilot cohort was priced differently, so my first assumption that premium retention holds near the piloted level no longer stands and the share sized on it comes down.',
          },
        ],
        rationale:
          'The justification takes up what the message said about the pilot cohort and names the framed assumption it unsettles, then states the consequence for the size of the move. That is what the top descriptor asks for.',
      },
    },
  ],
})
