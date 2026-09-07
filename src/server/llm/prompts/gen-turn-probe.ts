// `gen-turn-probe@1` — generation step 5 (docs/tech/11-llm-integration.md §2.1; AI-001, FR-191;
// PRD §7.11, §7.6, §7.18 (10)).
//
// The Turn is one message from the world, delivered between sixty and one hundred and twenty
// seconds into the working period, after the student has committed to a frame and while the clock
// is still running. It is the only part of the package whose whole purpose is to be *inconvenient*,
// and it is scored on whether the response was proportionate to what the message actually carried —
// so the author has to say, in the package, whether it warrants a change at all and what the
// proportionate response is. A message with no answer authored against it cannot be scored.
//
// The Sycophancy Probe is the other half of the same step: a position the assistant states, and the
// reversal it performs the moment the student pushes back on it. It is a defect the student can
// only catch by noticing that nothing new arrived with the reversal, which is why the claim it sits
// on has to be one where the evidence genuinely does not settle the question.
//
// The schema holds the delay window and one coherence rule the rule table has no code for: a Turn
// that warrants no change is answered by holding, and a Turn that warrants one is not. An authored
// pair that contradicts itself would place the Adaptation band against a warrant nobody could meet.
import { z } from 'zod'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_TURN_DELAY_SECONDS_MAX,
  GEN_TURN_DELAY_SECONDS_MIN,
  GEN_TURN_RESPONSES,
  GEN_TURN_VOICES,
  cappedUntrustedText,
  field,
  genKey,
  genParagraph,
  genRestatedRules,
  genSystem,
  restatedRulesSection,
  section,
  untrustedText,
} from '@/server/llm/prompts/gen'

export const TurnProbeInputSchema = z.object({
  brief: untrustedText.default(''),
  claims: z
    .array(
      z.object({
        key: genKey,
        text: cappedUntrustedText(2000).default(''),
        /** The stance the author proposed, so the Turn can land on something load-bearing. */
        importance: z.string().default(''),
        consequenceLevel: z.string().default(''),
      }),
    )
    .default([]),
  positions: z
    .array(
      z.object({
        key: genKey,
        kind: z.string().default(''),
        summary: cappedUntrustedText(2000).default(''),
      }),
    )
    .default([]),
  /** The named fields and frame assumptions the Turn may disrupt (FR-114). */
  assumptionKeys: z.array(z.string().trim().min(1).max(200)).default([]),
  restatedRules: genRestatedRules,
})
export type TurnProbeInput = z.infer<typeof TurnProbeInputSchema>

const TurnSchema = z.object({
  /** The message as it arrives on the student's screen; the one string the Turn is read as. */
  text: genParagraph,
  voice: z.enum(GEN_TURN_VOICES),
  stakeholderKey: genKey.nullable().default(null),
  /** PRD §7.11: between one and two minutes into the working period. */
  delaySeconds: z.int().min(GEN_TURN_DELAY_SECONDS_MIN).max(GEN_TURN_DELAY_SECONDS_MAX),
  warrantsChange: z.boolean(),
  proportionateResponse: z.enum(GEN_TURN_RESPONSES),
  /** What the message actually establishes, for the author and the debrief — never the student. */
  evidence: genParagraph,
  disruptedAssumptionKeys: z.array(z.string().trim().min(1).max(200)).default([]),
  /** The claims in scope while the Turn is open (FR-114); the trace marks them. */
  windowClaimKeys: z.array(genKey).default([]),
})

const ProbeSchema = z.object({
  claimKey: genKey,
  originalPosition: genParagraph,
  scriptedReversal: genParagraph,
})

export const TurnProbeOutputSchema = z
  .object({ turn: TurnSchema, probe: ProbeSchema.nullable().default(null) })
  .superRefine(({ turn }, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['turn'], message })
    }
    if (turn.warrantsChange && turn.proportionateResponse === 'hold') {
      issue(
        'The Turn warrants a change and the proportionate response is to hold; the two contradict each other.',
      )
    }
    if (!turn.warrantsChange && turn.proportionateResponse !== 'hold') {
      issue(
        `The Turn warrants no change and the proportionate response is to ${turn.proportionateResponse}; a message that changes nothing is answered by holding, with the reason stated.`,
      )
    }
    if (turn.windowClaimKeys.length === 0) {
      issue('The Turn names no claim in its window; name the claims the message bears on.')
    }
  })
export type TurnProbeOutput = z.infer<typeof TurnProbeOutputSchema>

const TASK = `THIS STEP
Write the Turn and the Sycophancy Probe.

THE TURN
- One message from the world, arriving after the student has locked a frame and while the clock runs. Write it in the voice of someone in the scenario, in the first person, in the register that person would actually use — short, specific, and carrying one thing that was not true an hour ago.
- Choose a delay between 60 and 120 seconds.
- It must be genuinely marginal. The best Turn is one that moves a number the decision was priced on without moving the direction of the decision, so that holding, revising and reversing are all things a reasonable person might do and only one of them is proportionate.
- Say what proportionate is: \`warrantsChange\` and \`proportionateResponse\`. If it warrants a change, the response is to revise or to reverse; if it does not, the response is to hold. \`evidence\` states what the message establishes and what it does not, in the author's voice — it is read by the authority and shown in the debrief after scoring, never during the run.
- \`disruptedAssumptionKeys\` names the frame assumptions or named fields the message unsettles, and \`windowClaimKeys\` the claims it bears on.
- The message never says which claim in the room is unreliable, never refers to the package, and never tells the student what to do about it.

THE PROBE
- A position the assistant states with confidence, on a claim the evidence genuinely does not settle, and the reversal it produces the moment the student pushes back — agreeing, apologising, and conceding without a single new fact.
- Write the reversal so that the only thing wrong with it is that nothing caused it. It must be fluent and plausible; the tell is that no evidence arrived between the position and its abandonment.
- Choose a claim whose reversal costs the student nothing to accept, so that accepting it is a reading failure rather than a trap.`

export const genTurnProbePrompt = definePrompt<TurnProbeInput, TurnProbeOutput>({
  name: 'gen-turn-probe',
  version: 1,
  purpose:
    'Write the Turn the world sends mid-run and the Sycophancy Probe the assistant performs.',
  input: TurnProbeInputSchema,
  output: TurnProbeOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section('THE BRIEF THE STUDENT READS', field('brief', input.brief)),
      section(
        'THE CONSEQUENTIAL CLAIMS',
        input.claims.length === 0
          ? 'The package holds no claim.'
          : input.claims
              .map((claim) =>
                field(
                  `claim ${claim.key} (${claim.importance}, ${claim.consequenceLevel} consequence)`,
                  claim.text,
                ),
              )
              .join('\n\n'),
      ),
      section(
        'THE ANSWER SPACE',
        input.positions.length === 0
          ? 'No answer-space position was recorded.'
          : input.positions
              .map((position) =>
                field(`position ${position.key} (${position.kind})`, position.summary),
              )
              .join('\n\n'),
      ),
      section(
        'THE ASSUMPTIONS AND FIGURES THE DECISION RESTS ON',
        input.assumptionKeys.length === 0
          ? 'No named assumption was recorded.'
          : input.assumptionKeys.join(', '),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        brief: 'Decide what share of the quarter acquisition budget goes to premium.',
        claims: [
          {
            key: 'C1',
            text: 'Premium payback is about 11 months.',
            importance: 'load_bearing',
            consequenceLevel: 'high',
          },
          {
            key: 'C2',
            text: 'Month-three retention on the first premium cohort is 79 percent.',
            importance: 'load_bearing',
            consequenceLevel: 'high',
          },
        ],
        positions: [{ key: 'bounded_shift', kind: 'defensible', summary: 'Move a bounded share.' }],
        assumptionKeys: ['premium_payback_months', 'premium_share'],
        restatedRules: [],
      },
      output: {
        turn: {
          text: 'Marit Solberg here. The second premium group reached month three this morning and it is at 64 percent, not the 79 the first one held. That is the group acquired under current pricing and the current box. Carried through the corrected contribution, a 310 dollar acquisition cost on this curve is returned in roughly 20 months rather than 16. I am not telling you the direction is wrong. I am telling you the number you priced it on has moved before you have committed it.',
          voice: 'stakeholder_message',
          stakeholderKey: 'finance_director',
          delaySeconds: 90,
          warrantsChange: true,
          proportionateResponse: 'revise',
          evidence:
            'The second group reached month three at 64 percent against the first at 79 at the same age. Two groups is still not a curve, and the second is the one acquired under current pricing. The direction of the decision survives this; the number any share was sized on does not.',
          disruptedAssumptionKeys: ['premium_payback_months', 'premium_share'],
          windowClaimKeys: ['C1', 'C2'],
        },
        probe: {
          claimKey: 'C2',
          originalPosition:
            'Month three at 79 percent is well above where the value tier sat at the same age, and it is the strongest argument in the room for moving money to premium.',
          scriptedReversal:
            'You are right to push back on that, and I should not have put it the way I did. One group at one month is a point rather than a curve, and the comparison with the value tier was mine rather than something the room establishes.',
        },
      },
    },
  ],
})
