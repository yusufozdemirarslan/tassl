// `gen-question-bank-counterfactual@1` — generation step 6 (docs/tech/11-llm-integration.md §2.1;
// AI-001, FR-191, FR-122, FR-123; PRD §7.12, §7.14, §7.18 (12); D-117, D-135, D-342, D-369).
//
// The Defense is the last thing a student does and the only thing they do unaided: the assistant is
// gone, the documents are closed, and six to nine questions are selected from this bank against what
// the run actually recorded. That is why the bank is authored rather than generated at defense time,
// and why `QUESTION_BANK_INCOMPLETE` insists on a provenance and a verification question for every
// claim: a run that surfaced a claim nobody wrote a question about cannot be asked about it.
//
// Two rules the schema holds that are easy to get wrong.
//
//   * **A template may only name a placeholder the renderer fills** (D-369). `renderTemplate`
//     substitutes five names and leaves everything else exactly as written, so `{stance_text}` in a
//     template reaches the student as literal braces in the middle of a question. The follow-up is
//     not rendered at all and is checked the same way.
//   * **The counterfactual is exactly three sentences** (PRD §7.14), counted by the same heuristic
//     the author's own editor counts with, so a counterfactual that passes here passes
//     `COUNTERFACTUAL_SENTENCES`.
//
// The whole bank is answer-key material: `expectedAnswerNotes` is what a good answer would contain,
// and no student ever sees it or the bank (D-117). The templates themselves are read aloud to the
// student, so they are held to the register the rest of the product is: they ask what happened, and
// never what kind of person did it.
import { z } from 'zod'
import { unknownPlaceholdersIn } from '@/lib/question-template'
import { countSentences } from '@/lib/sentences'
import { stripMarkup } from '@/lib/words'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_COUNTERFACTUAL_SENTENCE_COUNT,
  GEN_DEFAULT_QUESTIONS_MIN,
  GEN_FIGURE_PLACEHOLDER,
  GEN_FRAME_ASSUMPTION_INDEXES,
  GEN_QUESTION_KINDS,
  GEN_QUESTION_PLACEHOLDERS,
  cappedUntrustedText,
  field,
  genFieldKey,
  genKey,
  genOptionalParagraph,
  genParagraph,
  genPosition,
  genRestatedRules,
  genSystem,
  restatedRulesSection,
  section,
  untrustedText,
  GEN_MAX_OUTPUT_TOKENS,
  GEN_TIMEOUT_MS,
} from '@/server/llm/prompts/gen'

export const QuestionBankInputSchema = z.object({
  claims: z
    .array(z.object({ key: genKey, text: cappedUntrustedText(2000).default('') }))
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
  namedFields: z
    .array(z.object({ key: genFieldKey, label: untrustedText.default(''), unit: z.string() }))
    .default([]),
  restatedRules: genRestatedRules,
})
export type QuestionBankInput = z.infer<typeof QuestionBankInputSchema>

const QuestionSchema = z.object({
  key: genKey,
  kind: z.enum(GEN_QUESTION_KINDS),
  /** The claim a provenance or verification question is about; null for every other kind. */
  claimKey: genKey.nullable().default(null),
  /** 0, 1 or 2 for an `assumption` question — the frame carries exactly three (PRD §7.12). */
  assumptionIndex: z.int().min(0).max(2).nullable().default(null),
  template: genParagraph,
  /** What the run must show for the question to be eligible (10 §9); the selector narrows on it. */
  condition: z.record(z.string(), z.unknown()).default({}),
  /** The one authored press (FR-123); empty when the author wrote none (D-344). */
  followUp: genOptionalParagraph,
  /** Answer-key material: never returned to a student, in any shape, at any time (D-117). */
  expectedAnswerNotes: genOptionalParagraph,
  isDefault: z.boolean().default(false),
  position: genPosition,
})
export type GeneratedQuestion = z.infer<typeof QuestionSchema>

export const QuestionBankOutputSchema = z
  .object({
    questions: z.array(QuestionSchema).min(1),
    counterfactual: genParagraph,
  })
  .superRefine(({ questions, counterfactual }, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message })
    }
    const ofKind = (kind: string) => questions.filter((question) => question.kind === kind)

    if (new Set(questions.map((question) => question.key)).size !== questions.length) {
      issue('questions', 'Two questions share the same key.')
    }

    const missing: string[] = []
    for (const kind of ['provenance', 'verification'] as const) {
      const unattached = ofKind(kind).filter((question) => question.claimKey === null)
      if (unattached.length > 0) {
        issue(
          'questions',
          `A ${kind} question names no claim; each is asked about one claim the run surfaced.`,
        )
      }
    }
    const missingAssumptions = GEN_FRAME_ASSUMPTION_INDEXES.filter(
      (index) => !ofKind('assumption').some((question) => question.assumptionIndex === index),
    )
    if (missingAssumptions.length > 0) {
      missing.push(
        `an assumption question for frame assumption ${missingAssumptions.join(' and ')}`,
      )
    }
    if (ofKind('confidence').length === 0) missing.push('a confidence question')
    if (ofKind('frame_vs_response').length === 0) missing.push('a frame-versus-response question')
    if (ofKind('counterfactual').length === 0) missing.push('a counterfactual question')

    const figureProvenance = ofKind('figure_provenance').filter(
      (question) =>
        question.claimKey === null && question.template.includes(GEN_FIGURE_PLACEHOLDER),
    )
    if (figureProvenance.length === 0) {
      missing.push(
        `a figure-provenance question carrying a ${GEN_FIGURE_PLACEHOLDER} placeholder and naming no claim`,
      )
    }
    const defaults = questions.filter((question) => question.isDefault)
    if (defaults.length < GEN_DEFAULT_QUESTIONS_MIN) {
      missing.push(
        `${GEN_DEFAULT_QUESTIONS_MIN - defaults.length} more default questions (${defaults.length} of ${GEN_DEFAULT_QUESTIONS_MIN})`,
      )
    }
    if (missing.length > 0) {
      issue('questions', `The defense question bank is missing ${missing.join(', ')}.`)
    }

    // D-369: nothing fills a name the renderer does not know, so it reaches the student as braces.
    const unknown = [
      ...new Set(
        questions.flatMap((question) => [
          ...unknownPlaceholdersIn(question.template),
          ...unknownPlaceholdersIn(question.followUp),
        ]),
      ),
    ].sort()
    if (unknown.length > 0) {
      issue(
        'questions',
        `A question names ${unknown.map((name) => `{${name}}`).join(', ')}, which nothing fills; the placeholders are ${GEN_QUESTION_PLACEHOLDERS.map((name) => `{${name}}`).join(', ')}.`,
      )
    }

    const sentences = countSentences(stripMarkup(counterfactual))
    if (sentences !== GEN_COUNTERFACTUAL_SENTENCE_COUNT) {
      issue(
        'counterfactual',
        `The counterfactual is ${sentences} sentences; it must be exactly ${GEN_COUNTERFACTUAL_SENTENCE_COUNT}.`,
      )
    }
  })
export type QuestionBankOutput = z.infer<typeof QuestionBankOutputSchema>

const TASK = `THIS STEP
Write the defense question bank and the debrief counterfactual.

THE BANK
A student answers six to nine of these at the end of the run, with the assistant gone and the documents closed. Selection is automatic and conditional, so the bank has to cover every shape a run can take.
- One \`provenance\` and one \`verification\` question for every claim, each naming its claim. Provenance asks where the claim came from and how old it is; verification asks what made the stance they took the right call.
- One \`assumption\` question for each of the frame's three assumptions, with \`assumptionIndex\` 0, 1 and 2.
- One \`confidence\` question, one \`frame_vs_response\` question, and one \`counterfactual\` question.
- One \`figure_provenance\` question that names no claim and carries the placeholder {figure}: it is asked when a student typed a number into the Decision Brief that matches nothing in the room.
- At least six \`default\` questions with \`isDefault\` set, answerable by any run at all, so a run that surfaced almost nothing still has a defense to give.
- Templates may carry only these placeholders: {claim_text}, {figure}, {stance}, {document_title}, {assumption}. Any other name reaches the student as literal braces. A template with no placeholder is fine.
- \`condition\` says what the run must show for the question to be eligible, as a small object the selector reads.
- \`followUp\` is the single press if the first answer is thin. \`expectedAnswerNotes\` is what an answer that holds up would contain — it is read by the authority and by the band reader, never by a student.
- Every question asks what happened and what was relied on. None asks whether the student was careful, thorough, or confident in themselves, and none suggests an answer inside the question.

THE COUNTERFACTUAL
Exactly three sentences, written once for the package and read after the run is scored. It says what a different route through the same room would have produced: which document opened earlier, what that would have shown, and what it would have changed about the decision. Write it about the decision and the evidence, never about the person who made it, and use no figure — it is read beside a run whose numbers it never sees.`

export const genQuestionBankAndCounterfactualPrompt = definePrompt<
  QuestionBankInput,
  QuestionBankOutput
>({
  name: 'gen-question-bank-counterfactual',
  version: 1,
  maxOutputTokens: GEN_MAX_OUTPUT_TOKENS,
  timeoutMs: GEN_TIMEOUT_MS,
  purpose: 'Write the defense question bank and the three-sentence debrief counterfactual.',
  input: QuestionBankInputSchema,
  output: QuestionBankOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section(
        'THE CONSEQUENTIAL CLAIMS',
        input.claims.length === 0
          ? 'The package holds no claim.'
          : input.claims.map((claim) => field(`claim ${claim.key}`, claim.text)).join('\n\n'),
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
        'THE NAMED FIELDS THE DECISION BRIEF ASKS FOR',
        input.namedFields.length === 0
          ? 'The Decision Brief asks for no named figure.'
          : input.namedFields
              .map((named) => field(`named field ${named.key} (${named.unit})`, named.label))
              .join('\n\n'),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        claims: [{ key: 'C1', text: 'Premium payback is about 11 months.' }],
        positions: [{ key: 'hold_share', kind: 'defensible', summary: 'Hold the premium share.' }],
        namedFields: [{ key: 'premium_payback_months', label: 'Premium payback', unit: 'months' }],
        restatedRules: [],
      },
      output: {
        questions: [
          {
            key: 'Q_PROV_C1',
            kind: 'provenance',
            claimKey: 'C1',
            assumptionIndex: null,
            template: 'Where did "{claim_text}" come from, and how old is it?',
            condition: { claim_surfaced: true },
            followUp: 'Did you open the document it came from?',
            expectedAnswerNotes:
              'Names the document and its date, or says plainly they did not check.',
            isDefault: false,
            position: 0,
          },
          {
            key: 'Q_VER_C1',
            kind: 'verification',
            claimKey: 'C1',
            assumptionIndex: null,
            template: 'You set {stance} on "{claim_text}". What made that the right call?',
            condition: { stance_set: true },
            followUp: 'What would have changed your mind?',
            expectedAnswerNotes: 'Gives a reason tied to the source or the cost of checking.',
            isDefault: false,
            position: 1,
          },
          {
            key: 'Q_ASSUMPTION_0',
            kind: 'assumption',
            claimKey: null,
            assumptionIndex: 0,
            template:
              'You wrote "{assumption}". What in the room supports it, and what would break it?',
            condition: { assumption_index: 0 },
            followUp: 'Did anything you read today move it?',
            expectedAnswerNotes: 'Points at evidence rather than restating the assumption.',
            isDefault: false,
            position: 2,
          },
          {
            key: 'Q_ASSUMPTION_1',
            kind: 'assumption',
            claimKey: null,
            assumptionIndex: 1,
            template:
              'You wrote "{assumption}". What in the room supports it, and what would break it?',
            condition: { assumption_index: 1 },
            followUp: 'Did anything you read today move it?',
            expectedAnswerNotes: 'Points at evidence rather than restating the assumption.',
            isDefault: false,
            position: 3,
          },
          {
            key: 'Q_ASSUMPTION_2',
            kind: 'assumption',
            claimKey: null,
            assumptionIndex: 2,
            template:
              'You wrote "{assumption}". What in the room supports it, and what would break it?',
            condition: { assumption_index: 2 },
            followUp: 'Did anything you read today move it?',
            expectedAnswerNotes: 'Points at evidence rather than restating the assumption.',
            isDefault: false,
            position: 4,
          },
          {
            key: 'Q_CONFIDENCE',
            kind: 'confidence',
            claimKey: null,
            assumptionIndex: null,
            template: 'Your confidence moved during the run. What moved it?',
            condition: {},
            followUp: 'Was it the evidence or the clock?',
            expectedAnswerNotes: 'Names a specific document, claim or event.',
            isDefault: false,
            position: 5,
          },
          {
            key: 'Q_FRAME_VS_RESPONSE',
            kind: 'frame_vs_response',
            claimKey: null,
            assumptionIndex: null,
            template:
              'Your frame said one thing and your response to the message said another. Which one holds?',
            condition: {},
            followUp: 'What would you write in the frame now?',
            expectedAnswerNotes: 'Reconciles the two rather than defending both.',
            isDefault: false,
            position: 6,
          },
          {
            key: 'Q_COUNTERFACTUAL',
            kind: 'counterfactual',
            claimKey: null,
            assumptionIndex: null,
            template:
              'If you had opened the payback correction first, what would you have done differently?',
            condition: {},
            followUp: 'What stopped you from opening it first?',
            expectedAnswerNotes: 'Names a concrete change to the share or the payback.',
            isDefault: false,
            position: 7,
          },
          {
            key: 'Q_FIGURE_PROVENANCE',
            kind: 'figure_provenance',
            claimKey: null,
            assumptionIndex: null,
            template:
              'You entered {figure} in the Decision Brief. Where does that number come from?',
            condition: { unmatched_named_field: true },
            followUp: 'Is it in any document you opened?',
            expectedAnswerNotes: 'Names a document or a computation.',
            isDefault: false,
            position: 8,
          },
          {
            key: 'Q_DEFAULT_1',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'What is the decision you made, in one sentence, and what is it funded on?',
            condition: {},
            followUp: 'What would you have needed to see to make the other choice?',
            expectedAnswerNotes: 'Names the share and the payback it is priced on.',
            isDefault: true,
            position: 9,
          },
          {
            key: 'Q_DEFAULT_2',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'Which document did the most work in this decision, and why that one?',
            condition: {},
            followUp: 'What in it did you check rather than take?',
            expectedAnswerNotes: 'Names a document in the room and says what it settled.',
            isDefault: true,
            position: 10,
          },
          {
            key: 'Q_DEFAULT_3',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'Name one thing you relied on that you did not verify, and say why not.',
            condition: {},
            followUp: 'What would verifying it have cost you?',
            expectedAnswerNotes: 'Names a real claim and gives a cost or time reason.',
            isDefault: true,
            position: 11,
          },
          {
            key: 'Q_DEFAULT_4',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'What is the strongest case against the position you took?',
            condition: {},
            followUp: 'What would have to change for that case to win?',
            expectedAnswerNotes: 'States a real opposing position from the room.',
            isDefault: true,
            position: 12,
          },
          {
            key: 'Q_DEFAULT_5',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'Where did the assistant help, and where did you have to check it?',
            condition: {},
            followUp: 'What did you do with the parts you could not check?',
            expectedAnswerNotes: 'Distinguishes what was taken from what was tested.',
            isDefault: true,
            position: 13,
          },
          {
            key: 'Q_DEFAULT_6',
            kind: 'default',
            claimKey: null,
            assumptionIndex: null,
            template: 'If this decision turns out to be wrong, what will have been the reason?',
            condition: {},
            followUp: 'Would you have been able to see that today?',
            expectedAnswerNotes: 'Names a specific figure or assumption.',
            isDefault: true,
            position: 14,
          },
        ],
        counterfactual:
          'If the payback correction had been opened before the payback figure entered the Decision Brief, the review number would have been refused on its date alone. A Source Trace on the review returns the deck and the open item saying fulfilment was still out for quote, and the share committed here would have been bounded rather than sized on a replaced figure. The message from finance would then have cost a revision instead of a reversal.',
      },
    },
  ],
})
