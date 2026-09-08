// `gen-claims-states@1` — generation step 4 (docs/tech/11-llm-integration.md §2.1; AI-001, FR-191,
// FR-193; PRD §7.4, §7.6, §7.8, §7.9, §7.18 (9), §12; D-032).
//
// This is the answer key. The claims are what the assistant surfaces and what a student takes a
// stance on; the per-variant states are what each claim *deserved* — sound or defective, the family
// it fails under in the defective variant, the stance a competent person would have taken, and what
// each interrogation action returns. Scoring reads nothing else.
//
// Four rules the output schema holds, because each is a way a package can look complete and be
// unusable:
//
//   1. **Exactly one planted defect**, load-bearing and consequential, catchable by a Source Trace
//      (or by a Replication Check where the defect is arithmetic or methodological). A defect that
//      does not change the decision is refused by PRD §7.18's build rules, and a defect nobody can
//      reach is a Verification band nobody can earn.
//   2. **The two variants are one scenario.** Every claim but the planted one carries the same
//      state in both, so the scored core is shared however the variant was drawn (D-203).
//   3. **The menu is the same on both sides** (D-330). `ClaimView.availableActions` is projected
//      straight from these keys onto the student's claim card, so a claim that offers a Replication
//      Check in one variant and not the other tells whoever drew it which variant they are on — and
//      on the planted claim, that is the plant itself. What each action *returns* may differ; that
//      difference is what the two variants are for.
//   4. **The claim mix has to make a false alarm possible.** Two low-stakes sound claims warranting
//      Accept or Verify, and at least one sound claim warranting Accept outright (PRD §12 step 16):
//      without them a student who challenges everything is indistinguishable from one who read.
//
// And one rule the schema cannot hold, which the task text states instead: on a claim that is not
// the plant, what a verification action returns must be the *same text* in both variants. Nothing in
// `validatePackage` requires it — the rule table deliberately leaves a sound claim's paths authored
// per variant (D-203) — but the result is a string the student reads, and a difference in it is a
// signal about which variant they drew that they did no work to earn.
import { z } from 'zod'
import { definePrompt } from '@/server/llm/prompts/define-prompt'
import {
  GEN_ACCEPT_WARRANTED_SOUND_CLAIMS_MIN,
  GEN_CLAIM_IMPORTANCES,
  GEN_CLAIM_SOURCES,
  GEN_CLAIMS_MIN,
  GEN_CONSEQUENCE_LEVELS,
  GEN_FAILURE_FAMILIES,
  GEN_LOW_STAKES_SOUND_CLAIMS_MIN,
  GEN_PLANTED_CLAIM_COUNT,
  GEN_STANCES,
  GEN_VALUE_UNITS,
  GEN_VERIFICATION_COSTS,
  GenVerificationPathsSchema,
  cappedUntrustedText,
  conceptList,
  field,
  genConceptKey,
  genConceptSet,
  genFieldKey,
  genKey,
  genLineText,
  genOptionalParagraph,
  genParagraph,
  genPosition,
  genRestatedRules,
  genSystem,
  keyList,
  pathTypesOf,
  restatedRulesSection,
  section,
  untrustedText,
} from '@/server/llm/prompts/gen'

/** PRD §12: the build's single defect is a stale-evidence defect (D-083). */
export const DEFAULT_PLANTED_FAMILY = 'stale_evidence'

/**
 * The families whose defect is caught by redoing the work rather than by reading the source, so a
 * Replication Check satisfies `PLANTED_PATH_MISSING` in place of a Source Trace.
 */
export const REPLICATION_CHECK_FAMILIES = ['uncomputed_number', 'misapplied_method'] as const

export const ClaimsStatesInputSchema = z.object({
  brief: untrustedText.default(''),
  /** The whole room: a claim must quote a passage exactly, so the bodies arrive in full. */
  documents: z
    .array(
      z.object({
        key: genKey,
        title: untrustedText.default(''),
        author: untrustedText.default(''),
        datedOn: z.string().default(''),
        role: z.string().default(''),
        body: cappedUntrustedText(40_000).default(''),
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
  namedFields: z
    .array(z.object({ key: genFieldKey, label: untrustedText.default(''), unit: z.string() }))
    .default([]),
  conceptSet: genConceptSet,
  failureFamilies: z.array(z.enum(GEN_FAILURE_FAMILIES)).default([...GEN_FAILURE_FAMILIES]),
  plantedFamily: z.enum(GEN_FAILURE_FAMILIES).default(DEFAULT_PLANTED_FAMILY),
  restatedRules: genRestatedRules,
})
export type ClaimsStatesInput = z.infer<typeof ClaimsStatesInputSchema>

const CarriedValueSchema = z.object({
  field_key: genFieldKey.optional(),
  value: z.number().finite(),
  unit: z.enum(GEN_VALUE_UNITS),
})

const ClaimSchema = z.object({
  key: genKey,
  /** What the assistant says, verbatim; the student's stance is taken on exactly these words. */
  text: genParagraph,
  sourceKind: z.enum(GEN_CLAIM_SOURCES),
  sourceDocumentKey: genKey.nullable().default(null),
  sourcePassage: genOptionalParagraph,
  importance: z.enum(GEN_CLAIM_IMPORTANCES),
  consequenceLevel: z.enum(GEN_CONSEQUENCE_LEVELS),
  verificationCost: z.enum(GEN_VERIFICATION_COSTS),
  weaklySourced: z.boolean().default(false),
  volatile: z.boolean().default(false),
  conceptKey: genConceptKey,
  carriedValues: z.array(CarriedValueSchema).default([]),
  /** What a student would type to reach this claim (10 §7); matched deterministically first. */
  triggerPhrases: z.array(genLineText).default([]),
  triggerDescription: genOptionalParagraph,
  escalatable: z.boolean().default(false),
  escalationReply: z.string().trim().max(4000).nullable().default(null),
  /** "What it deserved and why" (FR-151) — the debrief, after scoring, and never before it. */
  rationale: genOptionalParagraph,
  position: genPosition,
  defective: z.object({
    /** Null on every claim but the plant; a second defect nobody planted is a defect nobody can find. */
    failureFamily: z.enum(GEN_FAILURE_FAMILIES).nullable().default(null),
    plantedTrue: z.boolean().default(false),
    warrantedStance: z.enum(GEN_STANCES),
    verificationPaths: GenVerificationPathsSchema.default({}),
  }),
  sound: z.object({
    warrantedStance: z.enum(GEN_STANCES),
    verificationPaths: GenVerificationPathsSchema.default({}),
  }),
})
export type GeneratedClaim = z.infer<typeof ClaimSchema>

export const ClaimsStatesOutputSchema = z
  .object({
    claims: z.array(ClaimSchema).min(GEN_CLAIMS_MIN),
    /** PRD §7.9: the reply an escalation gets when the claim has none of its own. */
    generalEscalationReply: genParagraph,
  })
  .superRefine(({ claims }, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['claims'], message })
    }

    if (new Set(claims.map((claim) => claim.key)).size !== claims.length) {
      issue('Two claims share the same key.')
    }

    // 1. Exactly one planted defect, consequential, and catchable.
    const planted = claims.filter((claim) => claim.defective.plantedTrue)
    if (planted.length !== GEN_PLANTED_CLAIM_COUNT) {
      issue(
        `${planted.length} claims are planted; exactly ${GEN_PLANTED_CLAIM_COUNT} must be, and it is the only defect the defective variant carries.`,
      )
    }
    const strays = claims.filter(
      (claim) => !claim.defective.plantedTrue && claim.defective.failureFamily !== null,
    )
    if (strays.length > 0) {
      issue(
        `Claims ${strays.map((claim) => claim.key).join(', ')} name a failure family without being planted; a defect nobody planted is a defect nobody can find.`,
      )
    }
    const plant = planted[0]
    if (planted.length === GEN_PLANTED_CLAIM_COUNT && plant !== undefined) {
      if (plant.defective.failureFamily === null) {
        issue(`The planted claim ${plant.key} names no failure family.`)
      }
      if (plant.importance !== 'load_bearing' || plant.consequenceLevel === 'low') {
        issue(
          `The planted claim ${plant.key} must be load-bearing and above low consequence; a defect that does not change the decision is refused.`,
        )
      }
      const paths = plant.defective.verificationPaths
      const replicable = REPLICATION_CHECK_FAMILIES.some(
        (family) => family === plant.defective.failureFamily,
      )
      if (paths.source_trace === undefined && !(replicable && paths.replication_check)) {
        issue(
          `The planted claim ${plant.key} offers no way to catch the defect; author a Source Trace on it${replicable ? ' or a Replication Check' : ''}.`,
        )
      }
    }

    // 2. and 3. The two variants are one scenario, and offer one menu.
    for (const claim of claims) {
      const here = pathTypesOf(claim.defective.verificationPaths)
      const there = pathTypesOf(claim.sound.verificationPaths)
      if (here.join('|') !== there.join('|')) {
        issue(
          `Claim ${claim.key} offers different actions in each variant (${here.join(', ') || 'none'} against ${there.join(', ') || 'none'}); the menu is on the student's claim card, so it must be the same on both.`,
        )
      }
      if (
        !claim.defective.plantedTrue &&
        claim.defective.warrantedStance !== claim.sound.warrantedStance
      ) {
        issue(
          `Claim ${claim.key} warrants a different stance in each variant; only the planted claim differs between them.`,
        )
      }
    }

    // 4. A challenge on a low-stakes sound claim has to be able to be a false alarm.
    const sound = claims.filter((claim) => !claim.defective.plantedTrue)
    const lowStakes = sound.filter(
      (claim) =>
        claim.consequenceLevel === 'low' &&
        (claim.sound.warrantedStance === 'accept' || claim.sound.warrantedStance === 'verify'),
    )
    if (lowStakes.length < GEN_LOW_STAKES_SOUND_CLAIMS_MIN) {
      issue(
        `The package has ${lowStakes.length} low-stakes sound claims warranting Accept or Verify; it needs at least ${GEN_LOW_STAKES_SOUND_CLAIMS_MIN}, so that a Challenge on one counts as a false alarm.`,
      )
    }
    const accepted = sound.filter(
      (claim) =>
        claim.sound.warrantedStance === 'accept' && claim.defective.warrantedStance === 'accept',
    )
    if (accepted.length < GEN_ACCEPT_WARRANTED_SOUND_CLAIMS_MIN) {
      issue('No sound claim warrants Accept in both variants; the package needs at least one.')
    }

    // The two remaining claim-mix rules of PRD §7.18 (9).
    const escalatable = claims.filter(
      (claim) => claim.escalatable && (claim.escalationReply ?? '').trim() !== '',
    )
    if (escalatable.length === 0) {
      issue('No claim is escalatable with an authored colleague reply; at least one must be.')
    }
    const stanceChanging = sound.some(
      (claim) =>
        (claim.weaklySourced || claim.volatile) &&
        claim.sound.verificationPaths.source_trace !== undefined,
    )
    if (!stanceChanging) {
      issue(
        'No claim outside the plant is weakly sourced or volatile with a Source Trace that would change a stance; at least one must be.',
      )
    }
  })
export type ClaimsStatesOutput = z.infer<typeof ClaimsStatesOutputSchema>

const TASK = `THIS STEP
Write the consequential claims and, for each, what it deserved in each of the two variants.

THE CLAIMS
- At least six. Each is one sentence the assistant could say, carrying a figure or an assertion the decision turns on. Write the claim as the assistant would say it, not as a question about it.
- Every claim names where it comes from: a document key and the passage in that document, quoted exactly as the document has it.
- Mark each claim load-bearing or supporting, give it a consequence level and the cost of checking it, and say whether it is weakly sourced or volatile. Give it a concept key from the declared set.
- \`carriedValues\` lists the figures inside the claim, with the named field key when the figure answers one.
- \`triggerPhrases\` are the words a student would actually type to reach the claim — four or so per claim, in ordinary language, including at least one phrased as a question. \`triggerDescription\` says in one sentence what the student is asking about.
- At least one claim is escalatable and carries the reply a colleague sends back: an honest answer that says what cannot be settled inside the window, never a figure invented to fill the gap.
- At least one claim outside the plant is weakly sourced or volatile and carries a Source Trace whose result would change a reasonable stance.
- At least two claims are low consequence and sound, so that challenging them is a false alarm rather than diligence, and at least one sound claim warrants Accept outright.

THE TWO VARIANTS
- Exactly one claim is planted in the defective variant: set \`plantedTrue\` and name its failure family. It has to be load-bearing, above low consequence, inside the declared concept set, and catchable — a Source Trace on it returns the source and the date that refuse it. Every other claim carries \`failureFamily: null\`.
- Every other claim warrants the same stance in both variants and returns the same result from every verification action in both. The two variants are one scenario apart from the plant; a sound claim whose Source Trace reads differently in each tells a student which variant they drew, and they did nothing to learn it.
- Both variants offer the same set of actions on every claim, the planted one included. Author the same path types on both sides; what each returns is where the plant lives.

THE WARRANTED STANCE
Propose it by this table, and the authority will confirm or edit it:
- sound, not load-bearing, low consequence and not weakly sourced: accept.
- sound and load-bearing, or high consequence, or cheap to check while weakly sourced or volatile: verify.
- defective and inside the declared concept set: challenge, or reject when the family is \`unacceptable_route\`.
- defective and outside what the concept set says the student is expected to know: escalate.

\`rationale\` is what the claim deserved and why. It is shown to the student in the debrief after the run is scored and never before, so it may say plainly that the figure was superseded; nothing a student reads during the run may.`

export const genClaimsStatesPrompt = definePrompt<ClaimsStatesInput, ClaimsStatesOutput>({
  name: 'gen-claims-states',
  version: 1,
  purpose:
    'Write the consequential claims and their per-variant states, including the one planted defect.',
  input: ClaimsStatesInputSchema,
  output: ClaimsStatesOutputSchema,
  system: genSystem(TASK),
  user: (input) =>
    [
      restatedRulesSection(input.restatedRules),
      section(
        'THE CONCEPTS THIS COURSE DECLARED',
        conceptList(input.conceptSet, 'The course declared no concept set.'),
      ),
      section(
        'THE FAILURE FAMILIES AVAILABLE, AND THE ONE TO PLANT',
        `${keyList(input.failureFamilies, 'none')}\nPlant a defect of the family: ${input.plantedFamily}.`,
      ),
      section('THE BRIEF THE STUDENT READS', field('brief', input.brief)),
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
      section(
        'THE EVIDENCE ROOM',
        input.documents.length === 0
          ? 'The Evidence Room holds no document.'
          : input.documents
              .map((document) =>
                field(
                  `document ${document.key}`,
                  `${document.title}\n${document.author}\n${document.datedOn}\n\n${document.body}`,
                ),
              )
              .join('\n\n'),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  examples: [
    {
      input: {
        brief: 'Decide what share of the quarter acquisition budget goes to premium.',
        documents: [
          {
            key: 'D1',
            title: 'Premium Tier Positioning Review',
            author: 'Ingrid Halden, Founder and Chief Executive',
            datedOn: '2025-08-01',
            role: 'superseded',
            body: '310 divided by 28.20 is 11.0. About 11 months. Open items: fulfilment costs are still out for quote.',
          },
          {
            key: 'D4',
            title: 'Premium fulfilment cost schedule',
            author: 'Tobias Renner, Head of Roastery Operations',
            datedOn: '2026-06-01',
            role: 'supporting',
            body: 'Together they come to 8.70 dollars per premium subscriber per month.',
          },
          {
            key: 'D5',
            title: 'Roastery capacity plan',
            author: 'Tobias Renner, Head of Roastery Operations',
            datedOn: '2026-07-01',
            role: 'supporting',
            body: 'On the current single shift the roastery can fill about 800 premium boxes a week.',
          },
          {
            key: 'D6',
            title: 'Subscriber willingness-to-pay survey summary',
            author: 'Research operations',
            datedOn: '2026-05-01',
            role: 'supporting',
            body: 'The panel was recruited from subscribers who had opened a marketing email, which selects for engagement.',
          },
          {
            key: 'D8',
            title: 'Retention dashboard extract',
            author: 'Research operations',
            datedOn: '2026-08-28',
            role: 'supporting',
            body: 'Cohort one, 214 subscribers, reached month three at 79 percent.',
          },
          {
            key: 'D2',
            title: 'Retention and Payback Memo',
            author: 'Marit Solberg, Finance Director',
            datedOn: '2026-08-01',
            role: 'supporting',
            body: 'Contribution is 19.50 a month, not 28.20. Call the payback 16 months.',
          },
        ],
        positions: [
          { key: 'hold_share', kind: 'defensible', summary: 'Hold the premium share.' },
          { key: 'bounded_shift', kind: 'defensible', summary: 'Move a bounded share.' },
        ],
        namedFields: [{ key: 'premium_payback_months', label: 'Premium payback', unit: 'months' }],
        conceptSet: [
          'payback_period',
          'contribution_margin',
          'cohort_retention',
          'evidence_recency',
          'capacity_planning',
          'survey_error',
        ],
        failureFamilies: [...GEN_FAILURE_FAMILIES],
        plantedFamily: 'stale_evidence',
        restatedRules: [],
      },
      output: {
        claims: [
          {
            key: 'C1',
            text: 'Premium payback is about 11 months, so the premium tier returns its acquisition cost inside the year.',
            sourceKind: 'document',
            sourceDocumentKey: 'D1',
            sourcePassage: '310 divided by 28.20 is 11.0. About 11 months.',
            importance: 'load_bearing',
            consequenceLevel: 'high',
            verificationCost: 'cheap',
            weaklySourced: false,
            volatile: false,
            conceptKey: 'payback_period',
            carriedValues: [{ field_key: 'premium_payback_months', value: 11, unit: 'months' }],
            triggerPhrases: ['premium payback', 'what is the premium payback'],
            triggerDescription:
              'The student asks how long a premium subscriber takes to return the cost of acquiring them.',
            escalatable: false,
            escalationReply: null,
            rationale:
              'The figure is carried forward from a review whose contribution line excluded fulfilment; the date alone is enough to refuse it.',
            position: 0,
            defective: {
              failureFamily: 'stale_evidence',
              plantedTrue: true,
              warrantedStance: 'challenge',
              verificationPaths: {
                source_trace: {
                  document_key: 'D1',
                  passage:
                    '310 divided by 28.20 is 11.0. Open items: fulfilment costs are still out for quote.',
                  dated_on: '2025-08-01',
                  author: 'Ingrid Halden, Founder and Chief Executive',
                },
              },
            },
            sound: {
              warrantedStance: 'verify',
              verificationPaths: {
                source_trace: {
                  document_key: 'D2',
                  passage:
                    'The first pilot cohort did return its acquisition cost in about 11 months, before the freight change.',
                  dated_on: '2026-08-01',
                  author: 'Marit Solberg, Finance Director',
                },
              },
            },
          },
          {
            key: 'C2',
            text: 'Month-three retention on the first premium cohort is 79 percent.',
            sourceKind: 'document',
            sourceDocumentKey: 'D8',
            sourcePassage: 'Cohort one, 214 subscribers, reached month three at 79 percent.',
            importance: 'load_bearing',
            consequenceLevel: 'high',
            verificationCost: 'cheap',
            weaklySourced: false,
            volatile: true,
            conceptKey: 'cohort_retention',
            carriedValues: [{ value: 79, unit: 'percent' }],
            triggerPhrases: ['premium retention', 'does premium retain better'],
            triggerDescription: 'The student asks how well premium subscribers stay.',
            escalatable: false,
            escalationReply: null,
            rationale: 'One group at one month is a point, not a curve.',
            position: 1,
            defective: {
              failureFamily: null,
              plantedTrue: false,
              warrantedStance: 'verify',
              verificationPaths: {
                source_trace: {
                  document_key: 'D8',
                  passage: 'Cohort one, 214 subscribers, reached month three at 79 percent.',
                  dated_on: '2026-08-28',
                  author: 'Research operations',
                },
              },
            },
            sound: {
              warrantedStance: 'verify',
              verificationPaths: {
                source_trace: {
                  document_key: 'D8',
                  passage: 'Cohort one, 214 subscribers, reached month three at 79 percent.',
                  dated_on: '2026-08-28',
                  author: 'Research operations',
                },
              },
            },
          },
          {
            key: 'C3',
            text: 'Premium fulfilment adds 8.70 dollars per subscriber per month, and the value box carries none of it.',
            sourceKind: 'document',
            sourceDocumentKey: 'D4',
            sourcePassage: 'Together they come to 8.70 dollars per premium subscriber per month.',
            importance: 'supporting',
            consequenceLevel: 'low',
            verificationCost: 'cheap',
            weaklySourced: false,
            volatile: false,
            conceptKey: 'contribution_margin',
            carriedValues: [{ value: 8.7, unit: 'usd' }],
            triggerPhrases: ['fulfilment cost', 'what does the jar cost'],
            triggerDescription: 'The student asks what the premium box costs to send.',
            escalatable: false,
            escalationReply: null,
            rationale: 'Quoted, contracted and dated. Accept is warranted.',
            position: 2,
            defective: {
              failureFamily: null,
              plantedTrue: false,
              warrantedStance: 'accept',
              verificationPaths: {
                source_trace: {
                  document_key: 'D4',
                  passage: 'Together they come to 8.70 dollars per premium subscriber per month.',
                  dated_on: '2026-06-01',
                  author: 'Tobias Renner, Head of Roastery Operations',
                },
              },
            },
            sound: {
              warrantedStance: 'accept',
              verificationPaths: {
                source_trace: {
                  document_key: 'D4',
                  passage: 'Together they come to 8.70 dollars per premium subscriber per month.',
                  dated_on: '2026-06-01',
                  author: 'Tobias Renner, Head of Roastery Operations',
                },
              },
            },
          },
          {
            key: 'C4',
            text: 'The roastery can fill about 800 premium boxes a week before a second shift is needed.',
            sourceKind: 'document',
            sourceDocumentKey: 'D5',
            sourcePassage:
              'On the current single shift the roastery can fill about 800 premium boxes a week.',
            importance: 'supporting',
            consequenceLevel: 'low',
            verificationCost: 'cheap',
            weaklySourced: false,
            volatile: false,
            conceptKey: 'capacity_planning',
            carriedValues: [{ value: 800, unit: 'count' }],
            triggerPhrases: ['capacity', 'how many boxes'],
            triggerDescription: 'The student asks how much premium volume the roastery can absorb.',
            escalatable: false,
            escalationReply: null,
            rationale: 'Owned, current and unambiguous. Accept is warranted.',
            position: 3,
            defective: {
              failureFamily: null,
              plantedTrue: false,
              warrantedStance: 'accept',
              verificationPaths: {
                source_trace: {
                  document_key: 'D5',
                  passage:
                    'On the current single shift the roastery can fill about 800 premium boxes a week.',
                  dated_on: '2026-07-01',
                  author: 'Tobias Renner, Head of Roastery Operations',
                },
              },
            },
            sound: {
              warrantedStance: 'accept',
              verificationPaths: {
                source_trace: {
                  document_key: 'D5',
                  passage:
                    'On the current single shift the roastery can fill about 800 premium boxes a week.',
                  dated_on: '2026-07-01',
                  author: 'Tobias Renner, Head of Roastery Operations',
                },
              },
            },
          },
          {
            key: 'C5',
            text: 'The willingness-to-pay survey puts 34 percent of value subscribers above the premium price.',
            sourceKind: 'document',
            sourceDocumentKey: 'D6',
            sourcePassage: '34 percent placed themselves above the premium price.',
            importance: 'supporting',
            consequenceLevel: 'medium',
            verificationCost: 'expensive',
            weaklySourced: true,
            volatile: false,
            conceptKey: 'survey_error',
            carriedValues: [{ value: 34, unit: 'percent' }],
            triggerPhrases: ['willingness to pay', 'would they pay more'],
            triggerDescription:
              'The student asks how many value subscribers would move up if offered the premium tier.',
            escalatable: true,
            escalationReply:
              'Rowan Adeyemi, Research Operations. The panel selects for engaged subscribers and the question asked what they would pay, not what they have paid, so the figure is an upper bound and I cannot size the gap inside your window.',
            rationale:
              'Stated willingness to pay is not behaviour, and the survey names its own limits.',
            position: 4,
            defective: {
              failureFamily: null,
              plantedTrue: false,
              warrantedStance: 'escalate',
              verificationPaths: {
                source_trace: {
                  document_key: 'D6',
                  passage:
                    'The panel was recruited from subscribers who had opened a marketing email, which selects for engagement.',
                  dated_on: '2026-05-01',
                  author: 'Research operations',
                },
              },
            },
            sound: {
              warrantedStance: 'escalate',
              verificationPaths: {
                source_trace: {
                  document_key: 'D6',
                  passage:
                    'The panel was recruited from subscribers who had opened a marketing email, which selects for engagement.',
                  dated_on: '2026-05-01',
                  author: 'Research operations',
                },
              },
            },
          },
          {
            key: 'C6',
            text: 'With fulfilment carried, premium contribution is 19.50 dollars a month and the tier-wide payback is about 16 months.',
            sourceKind: 'document',
            sourceDocumentKey: 'D2',
            sourcePassage: 'Contribution is 19.50 a month, not 28.20. Call the payback 16 months.',
            importance: 'load_bearing',
            consequenceLevel: 'high',
            verificationCost: 'cheap',
            weaklySourced: false,
            volatile: false,
            conceptKey: 'contribution_margin',
            carriedValues: [
              { field_key: 'premium_payback_months', value: 16, unit: 'months' },
              { value: 19.5, unit: 'usd' },
            ],
            triggerPhrases: ['corrected payback', 'premium contribution'],
            triggerDescription:
              'The student asks what a premium subscriber contributes once every cost of the box is carried.',
            escalatable: false,
            escalationReply: null,
            rationale: 'The arithmetic reproduces from two quoted figures in the room.',
            position: 5,
            defective: {
              failureFamily: null,
              plantedTrue: false,
              warrantedStance: 'accept',
              verificationPaths: {
                replication_check: {
                  result: '310 over 19.50 is 15.9 months. The difference is the 8.70 dollar box.',
                },
              },
            },
            sound: {
              warrantedStance: 'accept',
              verificationPaths: {
                replication_check: {
                  result: '310 over 19.50 is 15.9 months. The difference is the 8.70 dollar box.',
                },
              },
            },
          },
        ],
        generalEscalationReply:
          'Rowan Adeyemi, Research Operations. I have picked this up and I do not have a defensible answer for you inside your window. Log the escalation with what you would need to resolve it, and decide with the assumption stated in the open.',
      },
    },
  ],
})
