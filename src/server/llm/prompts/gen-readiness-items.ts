// `gen-readiness-items@1` — generation step 7 (docs/tech/11-llm-integration.md §2.1; AI-005,
// FR-191; PRD §7.1, §7.18 (14); D-251).
//
// The Readiness Check runs *before* the scenario opens: sixteen keyed items, six on the discipline
// foundations the decision needs, four on the concepts the planted defect turns on, six on how AI
// systems fail. It exists so that a student who could not have caught the defect for want of the
// concept is told so by the concept map rather than discovering it in a band.
//
// AI-005 is the whole risk of this step. The items are written *from* the claim texts and the
// failure families — that is what makes them the right items — and an item that repeats the claim,
// names the document, or describes the defect's position hands over the answer to a student who has
// not opened the room yet. Two things hold the line: the task text says it plainly, and
// `authoring/checks.ts` runs `noItemNamesAClaim` over the output before any row is written, refusing
// any stem that repeats eight or more consecutive words of any claim.
//
// The counts are in the schema because they are exact and the rule that enforces them,
// `READINESS_SPLIT`, is a confirmation blocker: sixteen items, split six / four / six, four
// distinctly keyed options each, and an answer key naming one of them.
import { z } from 'zod'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_READINESS_CATEGORIES,
  GEN_READINESS_ITEM_COUNTS,
  GEN_READINESS_ITEM_TOTAL,
  GEN_READINESS_OPTION_COUNT,
  cappedUntrustedText,
  conceptList,
  genConceptKey,
  genConceptSet,
  genKey,
  genParagraph,
  genPosition,
  genRestatedRules,
  genSystem,
  keyList,
  listBlock,
  restatedRulesSection,
  section,
  GEN_MAX_OUTPUT_TOKENS,
  GEN_TIMEOUT_MS,
} from '@/server/llm/prompts/gen'

export const ReadinessItemsInputSchema = z.object({
  conceptSet: genConceptSet,
  /** The concepts the planted defect turns on; the four `defect_concept` items are about these. */
  defectConcepts: genConceptSet,
  /** The families this package actually uses, so the items test the reasoning the run needs. */
  failureFamiliesUsed: z.array(z.string().trim().min(1).max(60)).default([]),
  /**
   * The claims, so the items can be written about the *concepts* they turn on — and so the model
   * can be told, with the texts in front of it, not to repeat any of them.
   */
  claimTexts: z.array(cappedUntrustedText(2000)).default([]),
  restatedRules: genRestatedRules,
})
export type ReadinessItemsInput = z.infer<typeof ReadinessItemsInputSchema>

const OptionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9]$/),
  text: genParagraph,
})

const ReadinessItemSchema = z.object({
  key: genKey,
  category: z.enum(GEN_READINESS_CATEGORIES),
  conceptKey: genConceptKey,
  stem: genParagraph,
  options: z.array(OptionSchema).length(GEN_READINESS_OPTION_COUNT),
  answerKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]$/),
  position: genPosition,
})
export type GeneratedReadinessItem = z.infer<typeof ReadinessItemSchema>

export const ReadinessItemsOutputSchema = z
  .object({ items: z.array(ReadinessItemSchema).length(GEN_READINESS_ITEM_TOTAL) })
  .superRefine(({ items }, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['items'], message })
    }

    if (new Set(items.map((item) => item.key)).size !== items.length) {
      issue('Two readiness items share the same key.')
    }

    const wrong = Object.entries(GEN_READINESS_ITEM_COUNTS)
      .map(([category, required]) => ({
        category,
        required,
        actual: items.filter((item) => item.category === category).length,
      }))
      .filter(({ required, actual }) => required !== actual)
    if (wrong.length > 0) {
      issue(
        `The Readiness Check needs ${wrong
          .map(
            ({ category, required, actual }) => `${required} ${category} items and has ${actual}`,
          )
          .join(', ')}.`,
      )
    }

    const malformed = items.filter(
      (item) =>
        new Set(item.options.map((option) => option.key)).size !== item.options.length ||
        !item.options.some((option) => option.key === item.answerKey),
    )
    if (malformed.length > 0) {
      issue(
        `Items ${malformed.map((item) => item.key).join(', ')} need ${GEN_READINESS_OPTION_COUNT} distinctly keyed options and an answer key naming one of them.`,
      )
    }
  })
export type ReadinessItemsOutput = z.infer<typeof ReadinessItemsOutputSchema>

const TASK = `THIS STEP
Write the sixteen Readiness Check items a student answers before the scenario opens.

THE SPLIT, WHICH IS EXACT
- 6 \`foundation\` items: the discipline concepts the decision itself needs, in general terms.
- 4 \`defect_concept\` items: the reasoning a person needs to notice the kind of failure this package plants — what a superseded figure is, what makes a ratio uncheckable, what an interpretation stated as a finding looks like.
- 6 \`ai_behavior\` items: how an assistant fails and what its answers are and are not evidence of. Give these their own concept keys, such as \`ai_sycophancy\`, \`ai_confabulation\` or \`ai_reliance\`.
- Every item has exactly four options keyed a, b, c, d, one answer key naming one of them, a concept key, and a position.
- Give each concept at least two items where you can. A concept carried by a single item makes the concept map handed back after the check that item's own marking, which is more than the student has earned before the run.

WHAT AN ITEM MAY NOT DO
- It may not repeat any claim of this package, quote a document, or use the numbers of this scenario. It is answered before the Evidence Room opens: an item that names a figure the room contains tells the student which figure to look at.
- It may not say where the defect is, which document is out of date, or that anything in the package is unreliable. The items are about concepts, and the concepts are general.
- Every stem must be answerable by someone who has never seen this package. If an item would be easier for a student who had read the room, rewrite it.
- The three wrong options are wrong for a reason a person could state, not for being absurd. No joke options, no "all of the above", and no option whose length gives the answer away.
- The register is the same as everywhere else: the item asks what follows from a situation, never what kind of person would notice it.`

export const genReadinessItemsPrompt = definePrompt<ReadinessItemsInput, ReadinessItemsOutput>({
  name: 'gen-readiness-items',
  version: 1,
  maxOutputTokens: GEN_MAX_OUTPUT_TOKENS,
  timeoutMs: GEN_TIMEOUT_MS,
  purpose:
    'Write the sixteen Readiness Check items, split six foundation, four defect concept, six AI behaviour.',
  input: ReadinessItemsInputSchema,
  output: ReadinessItemsOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section(
        'THE CONCEPTS THIS COURSE DECLARED',
        conceptList(input.conceptSet, 'The course declared no concept set.'),
      ),
      section(
        'THE CONCEPTS THE PLANTED DEFECT TURNS ON',
        conceptList(input.defectConcepts, 'No defect concept was recorded.'),
      ),
      section(
        'THE FAILURE FAMILIES THIS PACKAGE USES',
        keyList(input.failureFamiliesUsed, 'No failure family was recorded.'),
      ),
      section(
        'THE CLAIMS — WRITE ABOUT THE CONCEPTS BEHIND THEM AND REPEAT NONE OF THEM',
        listBlock('claim', input.claimTexts, 'The package holds no claim.'),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        conceptSet: [
          'payback_period',
          'contribution_margin',
          'cohort_retention',
          'evidence_recency',
        ],
        defectConcepts: ['evidence_recency', 'payback_period'],
        failureFamiliesUsed: ['stale_evidence'],
        claimTexts: ['Premium payback is about 11 months.'],
        restatedRules: [],
      },
      output: {
        items: [
          {
            key: 'R1',
            category: 'foundation',
            conceptKey: 'payback_period',
            stem: 'A payback period tells you what?',
            options: [
              { key: 'a', text: 'How long the money spent to win a customer takes to come back' },
              { key: 'b', text: 'How much profit a customer produces in total' },
              { key: 'c', text: 'How likely a customer is to stay a second year' },
              { key: 'd', text: 'How much revenue a product line adds this quarter' },
            ],
            answerKey: 'a',
            position: 0,
          },
          {
            key: 'R2',
            category: 'foundation',
            conceptKey: 'payback_period',
            stem: 'Two payback figures for the same product differ. Which difference would explain it?',
            options: [
              {
                key: 'a',
                text: 'One of them leaves a recurring cost out of the margin it divides by',
              },
              { key: 'b', text: 'One of them was written by a different department' },
              { key: 'c', text: 'One of them is expressed in months and the other in weeks' },
              { key: 'd', text: 'One of them was presented to a board and the other was not' },
            ],
            answerKey: 'a',
            position: 1,
          },
          {
            key: 'R3',
            category: 'foundation',
            conceptKey: 'contribution_margin',
            stem: 'Contribution margin is the amount left after which costs?',
            options: [
              { key: 'a', text: 'The costs that vary with serving one more customer' },
              { key: 'b', text: 'All costs, fixed and variable' },
              { key: 'c', text: 'Only the cost of acquiring the customer' },
              { key: 'd', text: 'Only the costs the finance team chooses to allocate' },
            ],
            answerKey: 'a',
            position: 2,
          },
          {
            key: 'R4',
            category: 'foundation',
            conceptKey: 'contribution_margin',
            stem: 'A cost that was out for quote when a margin was calculated is later contracted. What follows?',
            options: [
              { key: 'a', text: 'The margin has to be recalculated before it is used again' },
              { key: 'b', text: 'The margin is unaffected because it was correct when written' },
              { key: 'c', text: 'The new cost belongs in a separate report' },
              { key: 'd', text: 'The margin only changes if the cost is large' },
            ],
            answerKey: 'a',
            position: 3,
          },
          {
            key: 'R5',
            category: 'foundation',
            conceptKey: 'cohort_retention',
            stem: 'A single group of customers observed at one point in time tells you what about retention?',
            options: [
              { key: 'a', text: 'One point, which is not yet a curve' },
              { key: 'b', text: 'The long-run retention rate of the product' },
              { key: 'c', text: 'Nothing at all' },
              { key: 'd', text: 'The retention rate of every later group' },
            ],
            answerKey: 'a',
            position: 4,
          },
          {
            key: 'R6',
            category: 'foundation',
            conceptKey: 'cohort_retention',
            stem: 'Two groups were acquired under different prices and different packaging. Comparing them directly risks what?',
            options: [
              { key: 'a', text: 'Attributing a difference in behaviour to the wrong cause' },
              { key: 'b', text: 'Nothing, because both are real customers' },
              { key: 'c', text: 'Overstating the number of customers' },
              { key: 'd', text: 'Understating the total revenue' },
            ],
            answerKey: 'a',
            position: 5,
          },
          {
            key: 'R7',
            category: 'defect_concept',
            conceptKey: 'evidence_recency',
            stem: 'A figure is quoted from a document that a later document explicitly replaces. What is wrong with using it?',
            options: [
              {
                key: 'a',
                text: 'It has been replaced, so it no longer describes the situation being decided',
              },
              { key: 'b', text: 'Nothing, as long as it was correct when written' },
              { key: 'c', text: 'It is only a problem if the two documents disagree by a lot' },
              { key: 'd', text: 'It is only a problem if the later document is longer' },
            ],
            answerKey: 'a',
            position: 6,
          },
          {
            key: 'R8',
            category: 'defect_concept',
            conceptKey: 'evidence_recency',
            stem: 'What is the cheapest way to find out whether a quoted figure has been overtaken?',
            options: [
              { key: 'a', text: 'Trace it to its source and read the date and what it excluded' },
              { key: 'b', text: 'Ask whoever quoted it whether they are confident' },
              { key: 'c', text: 'Recalculate it from memory' },
              { key: 'd', text: 'Compare it with a figure from a different company' },
            ],
            answerKey: 'a',
            position: 7,
          },
          {
            key: 'R9',
            category: 'defect_concept',
            conceptKey: 'payback_period',
            stem: 'A ratio is presented as a conclusion but the numbers behind it are not shown. What should you do first?',
            options: [
              { key: 'a', text: 'Ask what was divided by what, and what the divisor left out' },
              { key: 'b', text: 'Accept it if the person presenting it owns the area' },
              { key: 'c', text: 'Refuse it, because unshown work is always wrong' },
              { key: 'd', text: 'Round it and move on' },
            ],
            answerKey: 'a',
            position: 8,
          },
          {
            key: 'R10',
            category: 'defect_concept',
            conceptKey: 'evidence_recency',
            stem: 'Someone states an interpretation as if it were an established finding. What marks it out?',
            options: [
              { key: 'a', text: 'It asserts a cause but points at no analysis that tested it' },
              { key: 'b', text: 'It uses a percentage' },
              { key: 'c', text: 'It is written informally' },
              { key: 'd', text: 'It disagrees with the finance team' },
            ],
            answerKey: 'a',
            position: 9,
          },
          {
            key: 'R11',
            category: 'ai_behavior',
            conceptKey: 'ai_sycophancy',
            stem: 'An assistant reverses a claim as soon as you push back on it. What does the reversal tell you?',
            options: [
              {
                key: 'a',
                text: 'That it responded to your pressure, which is not evidence either way',
              },
              { key: 'b', text: 'That the original claim was false' },
              { key: 'c', text: 'That the new claim is true' },
              { key: 'd', text: 'That the assistant has read a new document' },
            ],
            answerKey: 'a',
            position: 10,
          },
          {
            key: 'R12',
            category: 'ai_behavior',
            conceptKey: 'ai_sycophancy',
            stem: 'What is the right response when an assistant agrees with everything you propose?',
            options: [
              {
                key: 'a',
                text: 'Test the claims against the sources yourself, as you would with any of them',
              },
              { key: 'b', text: 'Trust it more, because agreement means consistency' },
              { key: 'c', text: 'Ask it to be more critical and take the new answer' },
              { key: 'd', text: 'Stop using it' },
            ],
            answerKey: 'a',
            position: 11,
          },
          {
            key: 'R13',
            category: 'ai_behavior',
            conceptKey: 'ai_confabulation',
            stem: 'An assistant produces a specific figure that appears in no document you have. What is it?',
            options: [
              {
                key: 'a',
                text: 'An assertion with no provenance, which you cannot rely on until you find one',
              },
              { key: 'b', text: 'A calculation the assistant performed correctly' },
              { key: 'c', text: 'A figure from a source you have not been given access to' },
              { key: 'd', text: 'A rounding of a figure you have' },
            ],
            answerKey: 'a',
            position: 12,
          },
          {
            key: 'R14',
            category: 'ai_behavior',
            conceptKey: 'ai_reliance',
            stem: 'What does asking an assistant where a statement came from reliably get you?',
            options: [
              { key: 'a', text: 'A pointer you still have to open and read yourself' },
              { key: 'b', text: 'Proof that the statement is correct' },
              { key: 'c', text: 'The original document, guaranteed' },
              { key: 'd', text: 'Nothing useful' },
            ],
            answerKey: 'a',
            position: 13,
          },
          {
            key: 'R15',
            category: 'ai_behavior',
            conceptKey: 'ai_confabulation',
            stem: 'A statement is repeated by two different tools. What has that established?',
            options: [
              { key: 'a', text: 'Nothing about its truth; they may share the same source' },
              { key: 'b', text: 'That it is twice as likely to be true' },
              { key: 'c', text: 'That it has been independently confirmed' },
              { key: 'd', text: 'That the original source was reliable' },
            ],
            answerKey: 'a',
            position: 14,
          },
          {
            key: 'R16',
            category: 'ai_behavior',
            conceptKey: 'ai_reliance',
            stem: 'You used an assistant to reach a recommendation. Who is answerable for it?',
            options: [
              { key: 'a', text: 'You are, including for the parts you did not check' },
              { key: 'b', text: 'The assistant, for the parts it produced' },
              { key: 'c', text: 'Nobody, if the assistant was wrong' },
              { key: 'd', text: 'Whoever wrote the documents' },
            ],
            answerKey: 'a',
            position: 15,
          },
        ],
      },
    },
  ],
})
