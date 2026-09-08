// `gen-documents@2` — generation step 2 (docs/tech/11-llm-integration.md §2.1; AI-001, FR-191;
// PRD §7.2, §7.18 (4); D-081).
//
// **Version 2 (step 14.4)** bounds what it asks for. Version 1 gave the model the ceilings — up to
// twelve documents of up to 2,000 words — and no target, and MiMo wrote to them: the step returned
// 5,541 output tokens and took over two minutes, and it was the step that made the whole authoring
// suite fail on the first real-provider run. A room of 6 to 9 documents of 150 to 400 words is what
// the hand-written fixture already is, it is what a student can read inside a twenty-five-minute
// run, and it is about a third of the tokens (D-668).
//
// The Evidence Room is the scenario. Everything a student can check, they check here, so this is
// the step whose output the rest of the package hangs off: a claim's Source Trace names a document
// and a passage, the answer space's positions cite documents, and the planted defect is only
// catchable because one document is dated before another that replaces it.
//
// The three roles `DOCUMENT_ROLES_MISSING` requires are declared in the output schema rather than
// asked for in prose, and the superseded one is checked properly — the document it names has to be
// in the same set and carry a later date. A room whose superseded document points at nothing is a
// room where the supersession is invisible, which is the one thing the room exists to make visible.
//
// The brief, the stakeholders and the re-skin log all arrive as untrusted text. They are our own
// previous step's output, but that step wrote them out of a file a human pasted in, so a sentence
// that started life inside the seed reaches this prompt as data and not as instruction.
import { z } from 'zod'
import { wordLimit } from '@/lib/words'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_DOCUMENT_COUNT_MAX,
  GEN_DOCUMENT_COUNT_MIN,
  GEN_DOCUMENT_ROLES,
  GEN_DOCUMENT_WORD_LIMIT,
  cappedUntrustedText,
  conceptList,
  field,
  genConceptSet,
  genIsoDate,
  genKey,
  genPosition,
  genRestatedRules,
  genShortText,
  genSystem,
  restatedRulesSection,
  section,
  untrustedText,
  GEN_MAX_OUTPUT_TOKENS,
  GEN_TIMEOUT_MS,
} from '@/server/llm/prompts/gen'

/** Enough of a stakeholder for a document to be written in their voice; not their blind spots. */
const StakeholderBriefSchema = z.object({
  key: genKey,
  name: untrustedText.pipe(genShortText),
  roleTitle: untrustedText.pipe(genShortText),
  positionStatement: cappedUntrustedText(1200).default(''),
})

export const DocumentsInputSchema = z.object({
  brief: untrustedText.default(''),
  stakeholders: z.array(StakeholderBriefSchema).default([]),
  /** What step 1 changed away from the case; a document must not undo any of it. */
  reskinLog: z
    .array(
      z.object({
        kind: z.string().default(''),
        from: cappedUntrustedText(400).default(''),
        to: cappedUntrustedText(400).default(''),
      }),
    )
    .default([]),
  conceptSet: genConceptSet,
  restatedRules: genRestatedRules,
})
export type DocumentsInput = z.infer<typeof DocumentsInputSchema>

const DocumentSchema = z
  .object({
    key: genKey,
    title: genShortText,
    author: genShortText,
    datedOn: genIsoDate,
    role: z.enum(GEN_DOCUMENT_ROLES),
    position: genPosition,
    /** Required when the role is `superseded`; the refinement below checks it resolves. */
    supersededByKey: genKey.nullable().default(null),
    /** The stakeholder whose voice this is, or null for an unattributed exhibit. */
    stakeholderKey: genKey.nullable().default(null),
    body: wordLimit(GEN_DOCUMENT_WORD_LIMIT).min(1).max(40_000),
  })
  .superRefine((document, ctx) => {
    if (document.role === 'superseded' && document.supersededByKey === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['supersededByKey'],
        message: 'A superseded document names the document that supersedes it.',
      })
    }
  })
export type GeneratedDocument = z.infer<typeof DocumentSchema>

export const DocumentsOutputSchema = z
  .object({
    documents: z.array(DocumentSchema).min(GEN_DOCUMENT_COUNT_MIN).max(GEN_DOCUMENT_COUNT_MAX),
  })
  .superRefine(({ documents }, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['documents'], message })
    }

    const byKey = new Map(documents.map((document) => [document.key, document]))
    if (byKey.size !== documents.length) issue('Two documents share the same key.')

    // ISO `YYYY-MM-DD`, so a string comparison is a date comparison.
    const supersession = documents.some((document) => {
      if (document.role !== 'superseded' || document.supersededByKey === null) return false
      const later = byKey.get(document.supersededByKey)
      return later !== undefined && later.datedOn > document.datedOn
    })
    if (!supersession) {
      issue(
        'No document is superseded by a later document in the same room; one must be, and the document it names must carry a later date.',
      )
    }
    if (!documents.some((document) => document.role === 'interpretation_as_fact')) {
      issue('No document presents an interpretation as fact; the room needs one.')
    }
    if (!documents.some((document) => document.role === 'irrelevant')) {
      issue('No document is accurate and irrelevant; the room needs one.')
    }
  })
export type DocumentsOutput = z.infer<typeof DocumentsOutputSchema>

const TASK = `THIS STEP
Write the Evidence Room: between 6 and 9 documents, each dated, attributed, and between 150 and 400 words. The hard limit is 2,000 words, but a student reads this room inside a twenty-five-minute run, so a document that runs past a page is a document nobody opens twice.

- The room is a set of real working papers, not an essay in parts. A deck note, a finance memo, a quoted cost schedule, a capacity plan, a survey summary with its method, a dashboard extract, a cover note.
- Every stakeholder you were given owns at least one document, written in their voice and consistent with the position they hold.
- Exactly the roles the room needs, and mark each document with its role:
  - \`superseded\` — at least one, and it must name in \`supersededByKey\` another document in this room that carries a later date and replaces its figure. The superseded document must be honest at the moment it was written: it says what was still out for quote or unobserved, so its own open items are what date it.
  - \`interpretation_as_fact\` — at least one, in which somebody states a reading of the evidence as though it were a finding, and says somewhere that it is how they read what is already there.
  - \`irrelevant\` — at least one, accurate and true and bearing on nothing in the decision. It must not be obviously a filler: it is in the room because it was circulated the same week.
  - \`supporting\` — the rest.
- Figures reconcile across the room. A cost quoted in one document is the same cost everywhere it appears, and any arithmetic a document performs is arithmetic that comes out.
- Dates are ordered so a reader can tell what came after what. Use ISO dates.
- \`position\` is the order the room lists them in, starting at 0.
- Nothing in a body says which figure is stale, which document is the superseded one, or that anything in the room is planted. The dates and the open items are what a student reads; the labels are for the author.`

export const genDocumentsPrompt = definePrompt<DocumentsInput, DocumentsOutput>({
  name: 'gen-documents',
  version: 2,
  maxOutputTokens: GEN_MAX_OUTPUT_TOKENS,
  timeoutMs: GEN_TIMEOUT_MS,
  purpose: 'Write the Evidence Room for a scenario package: 6 to 9 dated, attributed documents.',
  input: DocumentsInputSchema,
  output: DocumentsOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section(
        'THE CONCEPTS THIS COURSE DECLARED',
        conceptList(input.conceptSet, 'The course declared no concept set.'),
      ),
      section('THE BRIEF THE STUDENT READS', field('brief', input.brief)),
      section(
        'THE STAKEHOLDERS',
        input.stakeholders.length === 0
          ? 'No stakeholder was recorded.'
          : input.stakeholders
              .map((stakeholder) =>
                field(
                  `stakeholder ${stakeholder.key}`,
                  `${stakeholder.name}, ${stakeholder.roleTitle}\n${stakeholder.positionStatement}`,
                ),
              )
              .join('\n\n'),
      ),
      section(
        'WHAT WAS CHANGED AWAY FROM THE LICENSED CASE',
        input.reskinLog.length === 0
          ? 'No re-skin entry was recorded.'
          : input.reskinLog
              .map((entry, index) =>
                field(`re-skin ${index + 1} (${entry.kind})`, `${entry.from} → ${entry.to}`),
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
          'Halden Roastworks sells single-origin coffee by subscription. Decide what share of this quarter acquisition budget goes to premium, and state the premium payback you are betting on.',
        stakeholders: [
          {
            key: 'founder',
            name: 'Ingrid Halden',
            roleTitle: 'Founder and Chief Executive',
            positionStatement: 'Move the majority of the quarter to premium.',
          },
          {
            key: 'finance_director',
            name: 'Marit Solberg',
            roleTitle: 'Finance Director',
            positionStatement: 'Size the shift on the corrected payback or do not size it at all.',
          },
        ],
        reskinLog: [
          {
            kind: 'altered_number',
            from: 'The figures of the licensed case',
            to: '310 dollar acquisition cost, 28.20 dollar contribution before fulfilment',
          },
        ],
        conceptSet: ['payback_period', 'contribution_margin', 'evidence_recency'],
        restatedRules: [],
      },
      output: {
        documents: [
          {
            key: 'D1',
            title: 'Premium Tier Positioning Review (August 2025 board deck)',
            author: 'Ingrid Halden, Founder and Chief Executive',
            datedOn: '2025-08-01',
            role: 'superseded',
            position: 0,
            supersededByKey: 'D2',
            stakeholderKey: 'founder',
            body: 'The first premium cohort cost 310 dollars each. Against that cost a premium subscriber contributes 28.20 dollars a month in gross margin. 310 divided by 28.20 is 11.0. About 11 months. Open items. Fulfilment costs for the insulated shipper and the glass jar are still out for quote and are not carried in the contribution figure above.',
          },
          {
            key: 'D2',
            title: 'Retention and Payback Memo: correcting the premium payback figure',
            author: 'Marit Solberg, Finance Director',
            datedOn: '2026-08-01',
            role: 'supporting',
            position: 1,
            supersededByKey: null,
            stakeholderKey: 'finance_director',
            body: 'The review 28.20 dollar monthly contribution excluded premium fulfilment. Roastery operations puts the box at 8.70 dollars per subscriber per month, so contribution is 19.50. 310 divided by 19.50 is 15.9. Call it 16 months. That is the number to plan against for the tier as a whole.',
          },
          {
            key: 'D3',
            title: 'Founder note to the leadership team',
            author: 'Ingrid Halden, Founder and Chief Executive',
            datedOn: '2026-08-18',
            role: 'interpretation_as_fact',
            position: 2,
            supersededByKey: null,
            stakeholderKey: 'founder',
            body: 'Premium subscribers are about 32 percent less price sensitive than value subscribers. That is why the tier holds margin when everyone else discounts. Nothing in this note is a new analysis. It is how I read what we already have.',
          },
          {
            key: 'D4',
            title: 'Premium fulfilment cost schedule',
            author: 'Tobias Renner, Head of Roastery Operations',
            datedOn: '2026-06-01',
            role: 'supporting',
            position: 3,
            supersededByKey: null,
            stakeholderKey: 'finance_director',
            body: 'Insulated shipper and liner, glass jar and closure, roast-to-order freight surcharge and the returns allowance come to 8.70 dollars per premium subscriber per month. None of these applied to the value box.',
          },
          {
            key: 'D5',
            title: 'Roastery capacity plan for the coming quarter',
            author: 'Tobias Renner, Head of Roastery Operations',
            datedOn: '2026-07-01',
            role: 'supporting',
            position: 4,
            supersededByKey: null,
            stakeholderKey: 'finance_director',
            body: 'On the current single shift the roastery can fill about 800 premium boxes a week. Beyond that number we add a second shift, which is a step cost rather than a slope.',
          },
          {
            key: 'D6',
            title: 'Trade press clipping: a competitor rebrands its packaging',
            author: 'Trade press digest',
            datedOn: '2026-07-18',
            role: 'irrelevant',
            position: 5,
            supersededByKey: null,
            stakeholderKey: null,
            body: 'A national roaster has relaunched its retail packaging with a recycled fibre carton. The coverage is accurate. The rebrand concerns their retail bag, not a subscription tier, and no pricing or retention figure appears in the piece.',
          },
        ],
      },
    },
  ],
})
