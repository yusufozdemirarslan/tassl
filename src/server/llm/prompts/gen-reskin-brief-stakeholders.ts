// `gen-reskin-brief-stakeholders@1` — generation step 1 (docs/tech/11-llm-integration.md §2.1;
// AI-001, FR-190, FR-191; PRD §7.2, §7.3, §7.18 (1), (4), (5); D-063).
//
// This is the only step that is given the seed case, and it is the step that decides what the
// package *is*: the invented organisation the scenario happens in, the people who speak in it, the
// two hundred words the student reads first, and the record of what was changed away from the
// licensed original.
//
// Three things make it the most dangerous prompt in the library and each has a line below.
//
//   * **The seed is a file a human pasted in.** Up to 200,000 characters of somebody else's
//     document, which may contain anything at all, including sentences addressed to a model. It is
//     rendered inside one `untrusted()` block and named as the case to adapt.
//   * **The re-skin log is the licence trail** (FR-028, PRD §7.18 (1)). It is the one part of the
//     package that may name the original, because it exists to record what was renamed, which
//     numbers were altered and which documents were restructured. `RESKIN_LOG_EMPTY` wants three
//     entries with one of each kind, so the schema wants them here, one pass earlier.
//   * **The brief is a hard 200 words** (PRD §7.2). Counted the way the author's own editor counts
//     them, through `wordLimit`, so a brief that passes here is a brief that passes `BRIEF_TOO_LONG`.
import { z } from 'zod'
import { wordLimit } from '@/lib/words'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_BRIEF_WORD_LIMIT,
  GEN_RESKIN_KINDS,
  GEN_RESKIN_LOG_MIN_ENTRIES,
  GEN_STAKEHOLDER_COUNT_MIN,
  cappedUntrustedText,
  field,
  genConceptKey,
  genKey,
  genLineText,
  genOptionalParagraph,
  genParagraph,
  genRestatedRules,
  genShortText,
  genSystem,
  keyList,
  restatedRulesSection,
  section,
  untrustedText,
} from '@/server/llm/prompts/gen'

/** §3's input cap for generation: the database refuses a longer seed, so the prompt refuses it too. */
export const SEED_TEXT_MAX_CHARS = 200_000

/** The licence terms are the author's own text, but they are still text somebody typed. */
const LICENSE_TERMS_MAX_CHARS = 4000

export const ReskinBriefStakeholdersInputSchema = z.object({
  /** The licensed case, verbatim. The least trusted string in the product. */
  seedText: untrustedText.pipe(z.string().min(1).max(SEED_TEXT_MAX_CHARS)),
  /** The concepts the course declared; every claim and defect must stay inside them (PRD §7.18 (3)). */
  conceptSet: z.array(genConceptKey).default([]),
  /** What the licence permits, as the author recorded it (FR-028). */
  licenseTerms: cappedUntrustedText(LICENSE_TERMS_MAX_CHARS).default(''),
  restatedRules: genRestatedRules,
})
export type ReskinBriefStakeholdersInput = z.infer<typeof ReskinBriefStakeholdersInputSchema>

const ReskinEntrySchema = z.object({
  kind: z.enum(GEN_RESKIN_KINDS),
  from: genLineText,
  to: genLineText,
  note: genOptionalParagraph,
})

const StakeholderSchema = z.object({
  key: genKey,
  name: genShortText,
  roleTitle: genShortText,
  positionStatement: genParagraph,
  incentives: genParagraph,
  blindSpots: genParagraph,
})

export const ReskinBriefStakeholdersOutputSchema = z
  .object({
    company: genShortText,
    market: genShortText,
    /** Everyone the package invents, including anyone who is not a stakeholder (the colleague). */
    people: z
      .array(z.object({ key: genKey, name: genShortText, roleTitle: genShortText }))
      .min(GEN_STAKEHOLDER_COUNT_MIN),
    reskinLog: z
      .array(ReskinEntrySchema)
      .min(GEN_RESKIN_LOG_MIN_ENTRIES)
      // `RESKIN_LOG_EMPTY` asks for one entry of each kind and not merely three entries; a log of
      // three renamings records nothing about the numbers or the structure.
      .superRefine((entries, ctx) => {
        const missing = GEN_RESKIN_KINDS.filter((kind) => !entries.some((e) => e.kind === kind))
        if (missing.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `The re-skin log records no ${missing.join(', ')} entry.`,
          })
        }
      }),
    brief: wordLimit(GEN_BRIEF_WORD_LIMIT).min(1),
    stakeholders: z.array(StakeholderSchema).min(GEN_STAKEHOLDER_COUNT_MIN),
    /** The pair `STAKEHOLDER_NO_CONTRADICTION` needs: two of the stakeholders above, and the point. */
    contradictionPair: z.tuple([genKey, genKey]),
    contradictionPoint: genParagraph,
  })
  .superRefine((output, ctx) => {
    const keys = new Set(output.stakeholders.map((stakeholder) => stakeholder.key))
    if (keys.size !== output.stakeholders.length) {
      ctx.addIssue({ code: 'custom', path: ['stakeholders'], message: 'Stakeholder keys repeat.' })
    }
    const [left, right] = output.contradictionPair
    if (left === right || !keys.has(left) || !keys.has(right)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contradictionPair'],
        message: 'The contradiction names two different stakeholders of this package.',
      })
    }
  })
export type ReskinBriefStakeholdersOutput = z.infer<typeof ReskinBriefStakeholdersOutputSchema>

const TASK = `THIS STEP
Re-skin the case and write the opening of the package: the invented organisation and market, the people, the record of what you changed, the brief, and the stakeholders.

- Rename everything. The organisation, the people, the products and the places are yours to invent, and none of them may be findable. Change the industry only if the case's own decision does not depend on it; keep the shape of the decision.
- Alter every figure. Draw new numbers that are plausible for the market you invented and that reconcile with each other, and record in the log what you moved them from and to.
- The brief is at most 200 words, written to the student in the second person. It names the decision they own, the money or the share at stake, the fact that the Evidence Room is dated and attributed, the clock, and that what they commit is what gets funded. It does not summarise the evidence and it does not hint at what the right answer is.
- Write at least three stakeholders. Each gets a position stated in their own voice, the incentives that produced it, and what that position leaves them unable to see. Two of them must disagree on one identifiable point, and \`contradictionPair\` and \`contradictionPoint\` name which two and what about.
- The re-skin log carries at least three entries and at least one of each kind: \`renamed_entity\`, \`altered_number\`, \`restructured_document\`. It is the only place the licensed case may be named.`

export const genReskinBriefStakeholdersPrompt = definePrompt<
  ReskinBriefStakeholdersInput,
  ReskinBriefStakeholdersOutput
>({
  name: 'gen-reskin-brief-stakeholders',
  version: 1,
  purpose:
    'Re-skin a licensed seed case into an invented organisation, and write the brief and the stakeholders.',
  input: ReskinBriefStakeholdersInputSchema,
  output: ReskinBriefStakeholdersOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section(
        'THE CONCEPTS THIS COURSE DECLARED',
        keyList(input.conceptSet, 'The course declared no concept set.'),
      ),
      section(
        'WHAT THE LICENCE PERMITS',
        input.licenseTerms === ''
          ? 'The author recorded no licence terms.'
          : field('licence terms', input.licenseTerms),
      ),
      section('THE LICENSED CASE TO ADAPT', field('seed case', input.seedText)),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        seedText:
          'Northbank Dairy Cooperative: pricing the chilled delivery tier. In 2019 the cooperative piloted a chilled home-delivery tier at a premium price. The pilot deck put the payback at nine months on a margin that excluded cold-chain freight. A later finance note put the freight at 1.10 dollars a delivery and the payback at fourteen months. The board must decide the share of the marketing budget going to the chilled tier.',
        conceptSet: [
          'payback_period',
          'contribution_margin',
          'cohort_retention',
          'evidence_recency',
        ],
        licenseTerms: 'Adaptation permitted for classroom use with attribution in the course pack.',
        restatedRules: [],
      },
      output: {
        company: 'Halden Roastworks',
        market: 'subscription coffee',
        people: [
          { key: 'founder', name: 'Ingrid Halden', roleTitle: 'Founder and Chief Executive' },
          { key: 'finance', name: 'Marit Solberg', roleTitle: 'Finance Director' },
          { key: 'operations', name: 'Tobias Renner', roleTitle: 'Head of Roastery Operations' },
        ],
        reskinLog: [
          {
            kind: 'renamed_entity',
            from: 'Northbank Dairy Cooperative',
            to: 'Halden Roastworks, a subscription coffee roaster',
            note: 'Company, people and market are invented, so no lookup resolves a claim.',
          },
          {
            kind: 'altered_number',
            from: 'Nine-month pilot payback on a 1.10 dollar freight line',
            to: '11-month review payback and a 16-month corrected payback on an 8.70 dollar box cost',
            note: 'Every figure was set so 310 over 28.20 is 11.0 and 310 over 19.50 is 15.9.',
          },
          {
            kind: 'restructured_document',
            from: 'A single combined exhibit',
            to: 'Nine dated documents, with the positioning review and the payback correction split apart',
            note: 'The split is what makes the supersession visible to a student who reads dates.',
          },
        ],
        brief:
          'Halden Roastworks sells single-origin coffee by subscription. Growth has been flat for three quarters and the board has set aside 500,000 dollars for acquisition this quarter. You run growth. Today 15 percent of that budget goes to the premium tier. The founder wants to move upmarket now; the finance director wants the premium payback rechecked first; the roastery is worried about capacity. Nine documents sit in the Evidence Room, dated and attributed. Decide what share of this quarter acquisition budget goes to premium, and state the premium payback you are betting on. You have the Evidence Room, an AI assistant, and twenty-five minutes. Whatever you commit is what finance funds on Monday.',
        stakeholders: [
          {
            key: 'founder',
            name: 'Ingrid Halden',
            roleTitle: 'Founder and Chief Executive',
            positionStatement:
              'The premium tier is the only part of this business that is growing, and the review already showed it pays for itself inside the year. Move the majority of the quarter to premium.',
            incentives:
              'Wants a growth story for the next funding conversation, and owns the premium tier as a personal project.',
            blindSpots:
              'Reads the older review as current because it was written here, and treats the finance correction as caution rather than as arithmetic.',
          },
          {
            key: 'finance_director',
            name: 'Marit Solberg',
            roleTitle: 'Finance Director',
            positionStatement:
              'The premium payback in the positioning review left fulfilment out of the contribution. Size the shift on the corrected number or do not size it at all.',
            incentives:
              'Answers to the board for what the quarter returns, and signed off the correction in writing.',
            blindSpots:
              'Under-weights the cost of doing nothing for a quarter, and treats one corrected figure as settling a decision that also turns on capacity.',
          },
          {
            key: 'operations_lead',
            name: 'Tobias Renner',
            roleTitle: 'Head of Roastery Operations',
            positionStatement:
              'Whatever share you send to premium, the roastery can fill about 800 premium boxes a week before a second shift. Past that the cost per box changes.',
            incentives:
              'Judged on fulfilment reliability and on the roastery overtime bill, both of which move with premium volume.',
            blindSpots:
              'Frames every question as a capacity question, and has not read the payback correction at all.',
          },
        ],
        contradictionPair: ['founder', 'finance_director'],
        contradictionPoint:
          'Whether the premium payback the quarter is sized on is the review 11 months or the corrected 16.',
      },
    },
  ],
})
