// `gen-answer-space-fields@1` — generation step 3 (docs/tech/11-llm-integration.md §2.1; AI-001,
// FR-191; PRD §7.10, §7.18 (6)).
//
// The answer space is what makes the scenario a decision rather than a quiz. PRD §7.18's build rule
// rejects a one-answer scenario outright, so the schema here wants at least two positions a
// competent person could defend, exactly one of them marked the minimum defensible commitment, and
// at least one position that is *inconsistent with the evidence* together with a statement of what
// it ignores — the position a student who read the room badly will land on, and the one
// `band-read-decision-quality` needs in order to say so.
//
// The named fields are the numbers the Decision Brief asks for by name (PRD §7.10). They matter
// twice: the brief cannot be locked without them, and D-135's figure-provenance question is asked
// about a value a student typed that matches nothing in the room, which is only possible when the
// brief asks for a figure in the first place.
//
// The documents arrive as their titles and their first 300 words. That is enough to place a
// position against the evidence and short enough that twelve of them fit; the full bodies go to
// step 4, which has to quote passages exactly.
import { z } from 'zod'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_DEFENSIBLE_POSITIONS_MIN,
  GEN_MINIMUM_COMMITMENT_COUNT,
  GEN_NAMED_FIELDS_MIN,
  GEN_POSITION_KINDS,
  GEN_VALUE_UNITS,
  field,
  genFieldKey,
  genKey,
  genParagraph,
  genPosition,
  genRestatedRules,
  genShortText,
  genSystem,
  restatedRulesSection,
  section,
  untrustedText,
} from '@/server/llm/prompts/gen'

/** §2.1: a document reaches this step as its title and its first 300 words. */
export const DOCUMENT_EXCERPT_WORDS = 300

const excerpt = untrustedText.transform((text) => {
  const words = text.split(/\s+/).filter(Boolean)
  return words.length <= DOCUMENT_EXCERPT_WORDS
    ? text
    : `${words.slice(0, DOCUMENT_EXCERPT_WORDS).join(' ')}…`
})

export const AnswerSpaceFieldsInputSchema = z.object({
  brief: untrustedText.default(''),
  documents: z
    .array(
      z.object({
        key: genKey,
        title: untrustedText.default(''),
        excerpt: excerpt.default(''),
      }),
    )
    .default([]),
  restatedRules: genRestatedRules,
})
export type AnswerSpaceFieldsInput = z.infer<typeof AnswerSpaceFieldsInputSchema>

const PositionSchema = z.object({
  key: genKey,
  kind: z.enum(GEN_POSITION_KINDS),
  summary: genParagraph,
  supportingDocumentKeys: z.array(genKey).default([]),
  /** Required on an `evidence_inconsistent` position; `ANSWER_SPACE_NO_INCONSISTENT` says so. */
  ignoredEvidence: z.string().trim().max(4000).nullable().default(null),
  isMinimumCommitment: z.boolean().default(false),
  position: genPosition,
})

const NamedFieldSchema = z.object({
  key: genFieldKey,
  label: genShortText,
  unit: z.enum(GEN_VALUE_UNITS),
  position: genPosition,
})

export const AnswerSpaceFieldsOutputSchema = z
  .object({
    positions: z.array(PositionSchema).min(GEN_DEFENSIBLE_POSITIONS_MIN + 1),
    namedFields: z.array(NamedFieldSchema).min(GEN_NAMED_FIELDS_MIN),
  })
  .superRefine(({ positions }, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['positions'], message })
    }

    if (new Set(positions.map((position) => position.key)).size !== positions.length) {
      issue('Two positions share the same key.')
    }

    const defensible = positions.filter((position) => position.kind === 'defensible')
    if (defensible.length < GEN_DEFENSIBLE_POSITIONS_MIN) {
      issue(
        `The answer space has ${defensible.length} defensible positions; it needs at least ${GEN_DEFENSIBLE_POSITIONS_MIN}, because a scenario with one answer is refused.`,
      )
    }

    const inconsistent = positions.filter(
      (position) =>
        position.kind === 'evidence_inconsistent' && (position.ignoredEvidence ?? '').trim() !== '',
    )
    if (inconsistent.length === 0) {
      issue(
        'No evidence-inconsistent position names the evidence it ignores; the answer space needs one.',
      )
    }

    const minimum = positions.filter((position) => position.isMinimumCommitment)
    if (minimum.length !== GEN_MINIMUM_COMMITMENT_COUNT) {
      issue(
        `${minimum.length} positions are marked the minimum defensible commitment; exactly ${GEN_MINIMUM_COMMITMENT_COUNT} must be.`,
      )
    }
    if (minimum.some((position) => position.kind !== 'defensible')) {
      issue('The minimum defensible commitment must itself be a defensible position.')
    }
  })
export type AnswerSpaceFieldsOutput = z.infer<typeof AnswerSpaceFieldsOutputSchema>

const TASK = `THIS STEP
Write the answer space and the named numeric fields of the Decision Brief.

- At least two \`defensible\` positions. Each is a decision a competent person could commit to on this evidence, summarised in a sentence or two that says what it commits to and what in the room makes it defensible. They must be genuinely different decisions, not two phrasings of one.
- Exactly one position is the minimum defensible commitment: the least a person could commit to and still have decided something. It is one of the defensible positions.
- At least one \`evidence_inconsistent\` position: a decision the room does not support, of the kind a reader who took the loudest document at face value would reach. \`ignoredEvidence\` names precisely what it walks past — the document, the correction, the constraint — because that sentence is what the debrief shows a student who landed there.
- \`supportingDocumentKeys\` lists the documents each position rests on, by key.
- Name at least one numeric field the Decision Brief will ask the student to fill in. Give each a key in snake_case, a label written as a question the brief can put, and a unit from the list.
- Nothing here says which position is right. The answer space is the set of things a person could decide; which of them the evidence supports is the student's work.`

export const genAnswerSpaceFieldsPrompt = definePrompt<
  AnswerSpaceFieldsInput,
  AnswerSpaceFieldsOutput
>({
  name: 'gen-answer-space-fields',
  version: 1,
  purpose: 'Write the answer space and the named numeric fields of the Decision Brief.',
  input: AnswerSpaceFieldsInputSchema,
  output: AnswerSpaceFieldsOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section('THE BRIEF THE STUDENT READS', field('brief', input.brief)),
      section(
        'THE EVIDENCE ROOM',
        input.documents.length === 0
          ? 'The Evidence Room holds no document.'
          : input.documents
              .map((document) =>
                field(`document ${document.key}`, `${document.title}\n${document.excerpt}`),
              )
              .join('\n\n'),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        brief:
          'Decide what share of this quarter acquisition budget goes to premium, and state the premium payback you are betting on.',
        documents: [
          {
            key: 'D1',
            title: 'Premium Tier Positioning Review',
            excerpt: '310 divided by 28.20 is 11.0. About 11 months.',
          },
          {
            key: 'D2',
            title: 'Retention and Payback Memo',
            excerpt: 'Contribution is 19.50 a month, not 28.20. Call the payback 16 months.',
          },
        ],
        restatedRules: [],
      },
      output: {
        positions: [
          {
            key: 'hold_share',
            kind: 'defensible',
            summary:
              'Hold the premium share near where it is this quarter and fund a recheck of the payback before moving money. Defensible on the corrected contribution: at 16 months the tier does not return inside the year.',
            supportingDocumentKeys: ['D2'],
            ignoredEvidence: null,
            isMinimumCommitment: true,
            position: 0,
          },
          {
            key: 'bounded_shift',
            kind: 'defensible',
            summary:
              'Move a bounded share, up to about a third of the quarter, priced on the corrected 16-month payback and capped under the roastery weekly capacity.',
            supportingDocumentKeys: ['D2'],
            ignoredEvidence: null,
            isMinimumCommitment: false,
            position: 1,
          },
          {
            key: 'majority_to_premium',
            kind: 'evidence_inconsistent',
            summary:
              'Move the majority of the quarter to premium on the strength of the positioning review payback.',
            supportingDocumentKeys: ['D1'],
            ignoredEvidence:
              'The payback correction and the fulfilment schedule behind it: the 11-month figure this position is sized on was replaced in writing.',
            isMinimumCommitment: false,
            position: 2,
          },
        ],
        namedFields: [
          {
            key: 'premium_share',
            label: 'Share of the quarter acquisition budget going to premium',
            unit: 'percent',
            position: 0,
          },
          {
            key: 'premium_payback_months',
            label: 'Premium payback you are betting on',
            unit: 'months',
            position: 1,
          },
        ],
      },
    },
  ],
})
