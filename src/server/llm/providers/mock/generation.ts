// The mock's authoring pipeline (docs/tech/11-llm-integration.md §1.4, the `gen-*` row; D-063).
//
// AI-001 generates a scenario package from a licensed seed case in seven steps. On the mock those
// seven steps produce one complete, coherent package — Halden Roastworks, a subscription coffee
// roaster — that passes every rule of `validatePackage`. Phase 12 runs its pipeline, its retries and
// its element regeneration against exactly this, and the authoring evals score it, so this file is
// real authored content rather than a placeholder: nine documents, three stakeholders that
// contradict each other, eight consequential claims across two variants with one planted
// stale-evidence defect, a Turn, a Sycophancy Probe, a full question bank and sixteen readiness
// items.
//
// What the seed changes, and what it does not. Per D-063 the entities are fixed — the company, the
// market and the people are invented once, here, so that no lookup resolves a claim (PRD §7.2) — and
// the *numbers* are drawn from `hash(seedText)`. Every figure in the package is either one of five
// seeded draws or exact arithmetic on them, so the payback in a claim is the payback the documents
// compute, whatever the seed.
//
// Carrying the figures between steps. Step 1 is the only step whose input contains the seed text
// (§2.1); steps 2 to 5 are given the brief this step wrote, and a real model writing documents reads
// the brief's numbers and reuses them. The mock does the same: `figuresFor` draws from the seed when
// it has one and otherwise reads the five draws back out of the brief, whose numeric sentence is
// fixed by `renderBrief` below. Steps 6 and 7 need no figures at all — the question bank is
// templates and the readiness items are about concepts, so neither carries a case number, which is
// also what keeps a readiness item from naming the defect (AI-005).
import { z } from 'zod'
import { env } from '@/server/config'
import { numbersIn } from '@/server/llm/guardrails/numeric-guard'
import { intBetween, makeRng, seedOf } from '@/server/llm/providers/mock/deterministic'

export const GENERATION_PROMPTS = [
  'gen-reskin-brief-stakeholders',
  'gen-documents',
  'gen-answer-space-fields',
  'gen-claims-states',
  'gen-turn-probe',
  'gen-question-bank-counterfactual',
  'gen-readiness-items',
] as const
export type GenerationPrompt = (typeof GENERATION_PROMPTS)[number]

export const isGenerationPrompt = (name: string): name is GenerationPrompt =>
  (GENERATION_PROMPTS as readonly string[]).includes(name)

/**
 * What the mock reads from each step's input, declared per step (D-266).
 *
 * One schema for all seven would have been shorter and was wrong: §2.1 gives the seed text to step 1
 * alone, and a mock that read `seedText` on step 7 would be reading a key only a caller could have
 * set — a channel from the caller's data into an answer no rendered prompt would explain. The rule
 * `tests/unit/llm/mock.test.ts` enforces is that the mock may read *less* than the prompt sends and
 * never more, so each entry here is a subset of the keys the prompt of the same name declares.
 *
 * Step 6 reads nothing at all: the question bank is templates keyed by claim, and the
 * counterfactual carries no figure, so neither moves with the seed.
 */
const restatedRules = z.array(z.string()).default([])

export const GENERATION_MOCK_INPUTS = {
  'gen-reskin-brief-stakeholders': z.object({
    seedText: z.string().default(''),
    conceptSet: z.array(z.string()).default([]),
    restatedRules,
  }),
  'gen-documents': z.object({
    brief: z.string().default(''),
    conceptSet: z.array(z.string()).default([]),
    restatedRules,
  }),
  'gen-answer-space-fields': z.object({ brief: z.string().default(''), restatedRules }),
  'gen-claims-states': z.object({
    brief: z.string().default(''),
    conceptSet: z.array(z.string()).default([]),
    restatedRules,
  }),
  'gen-turn-probe': z.object({ brief: z.string().default(''), restatedRules }),
  'gen-question-bank-counterfactual': z.object({ restatedRules }),
  'gen-readiness-items': z.object({
    conceptSet: z.array(z.string()).default([]),
    restatedRules,
  }),
} as const satisfies Record<GenerationPrompt, z.ZodType>

/**
 * The three figures-bearing keys plus the retry channel, normalised, whichever subset the step was
 * allowed to read. `restatedRules` is declared by all seven prompts (`gen.ts` `genRestatedRules`),
 * so reading it breaks no rule of D-266; what it is for here is `MOCK_GEN_FAIL_ONCE` below, which
 * needs to tell a first pass from the retry that follows it.
 */
export type GenerationMockInput = {
  seedText: string
  brief: string
  conceptSet: string[]
  restatedRules: string[]
}

/** Parses the step's own subset and fills the rest with the empty value it would have defaulted to. */
export function readGenerationInput(
  prompt: GenerationPrompt,
  rawInput: unknown,
): GenerationMockInput {
  const parsed = GENERATION_MOCK_INPUTS[prompt].parse(
    rawInput ?? {},
  ) as Partial<GenerationMockInput>
  return {
    seedText: parsed.seedText ?? '',
    brief: parsed.brief ?? '',
    conceptSet: parsed.conceptSet ?? [],
    restatedRules: parsed.restatedRules ?? [],
  }
}

// ---------------------------------------------------------------------------------------------
// Fixed identity (D-063: deterministic entity substitution, invented so nothing resolves)
// ---------------------------------------------------------------------------------------------

export const COMPANY = 'Halden Roastworks'
export const MARKET = 'subscription coffee'

const PEOPLE = {
  founder: { name: 'Ingrid Halden', roleTitle: 'Founder and Chief Executive' },
  finance: { name: 'Marit Solberg', roleTitle: 'Finance Director' },
  operations: { name: 'Tobias Renner', roleTitle: 'Head of Roastery Operations' },
  colleague: { name: 'Rowan Adeyemi', roleTitle: 'Research Operations' },
} as const

const STAKEHOLDER_KEYS = {
  founder: 'founder',
  finance: 'finance_director',
  operations: 'operations_lead',
} as const

/** Used when the caller declares no concept set; claims and items index into whichever set applies. */
export const DEFAULT_CONCEPT_SET = [
  'payback_period',
  'contribution_margin',
  'cohort_retention',
  'price_tier_positioning',
  'evidence_recency',
  'capacity_planning',
  'survey_error',
  'fulfillment_cost',
] as const

/** The board meeting the decision is for; a constant, because generation may never read a clock. */
const ANCHOR_DATE = '2026-09-01'

// ---------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------

/** The five independent draws; everything else in the package is arithmetic on these. */
export type Draws = {
  revenueMillions: number
  budget: number
  premiumSharePct: number
  acquisitionCost: number
  contributionStaleCents: number
}

export type Figures = Draws & {
  valueSharePct: number
  fulfilmentCents: number
  contributionTrueCents: number
  paybackStale: number
  paybackTrue: number
  paybackStaleMonths: number
  paybackTrueMonths: number
  retentionEarly: number
  retentionTurn: number
  paybackTurn: number
  cohortSize: number
  surveyShare: number
  priceSensitivity: number
  premiumPriceCents: number
  valuePriceCents: number
  valueAcquisitionCost: number
  weeklyCapacity: number
  staleOffsetMonths: number
  turnDelaySeconds: number
  workingClockSeconds: number
}

const round1 = (value: number): number => Math.round(value * 10) / 10

function drawsFromSeed(seedText: string): Draws {
  const rng = makeRng(seedOf(seedText))
  return {
    revenueMillions: intBetween(rng, 12, 26),
    budget: intBetween(rng, 6, 14) * 50_000,
    premiumSharePct: intBetween(rng, 10, 20),
    acquisitionCost: intBetween(rng, 24, 38) * 10,
    contributionStaleCents: intBetween(rng, 240, 320) * 10,
  }
}

const DEFAULT_DRAWS: Draws = {
  revenueMillions: 18,
  budget: 500_000,
  premiumSharePct: 15,
  acquisitionCost: 310,
  contributionStaleCents: 2820,
}

/**
 * Everything the package says, derived. Fulfilment is a fixed share of the stale contribution — the
 * costs the review left out are the costs of the same box — so the corrected contribution is always
 * meaningfully smaller and the corrected payback always meaningfully longer, whatever was drawn.
 */
export function figuresFromDraws(draws: Draws): Figures {
  const fulfilmentCents = Math.round((draws.contributionStaleCents * 0.31) / 10) * 10
  const contributionTrueCents = draws.contributionStaleCents - fulfilmentCents
  const paybackStale = round1(draws.acquisitionCost / (draws.contributionStaleCents / 100))
  const paybackTrue = round1(draws.acquisitionCost / (contributionTrueCents / 100))
  const retentionEarly = 72 + (draws.acquisitionCost % 11)
  const retentionTurn = retentionEarly - 12 - ((draws.budget / 50_000) % 5)
  const paybackTurn = round1(paybackTrue * (retentionEarly / retentionTurn))
  const premiumPriceCents = draws.contributionStaleCents + 980
  return {
    ...draws,
    valueSharePct: 100 - draws.premiumSharePct,
    fulfilmentCents,
    contributionTrueCents,
    paybackStale,
    paybackTrue,
    paybackStaleMonths: Math.round(paybackStale),
    paybackTrueMonths: Math.round(paybackTrue),
    retentionEarly,
    retentionTurn,
    paybackTurn,
    cohortSize: 150 + (draws.acquisitionCost % 97),
    surveyShare: 20 + (draws.contributionStaleCents % 19),
    priceSensitivity: 25 + (draws.acquisitionCost % 21),
    premiumPriceCents,
    valuePriceCents: Math.round((premiumPriceCents * 0.58) / 10) * 10,
    valueAcquisitionCost: Math.round((draws.acquisitionCost * 0.31) / 2) * 2,
    weeklyCapacity: 400 + (draws.budget / 50_000) * 40,
    staleOffsetMonths: 13 + (draws.acquisitionCost % 11),
    turnDelaySeconds: 60 + (draws.acquisitionCost % 61),
    workingClockSeconds: 1500,
  }
}

/**
 * Where the five draws sit in the brief's own numeric sentence. `renderBrief` writes exactly these
 * six numbers, in this order, and no others — the document count and the clock are spelled as words
 * there for precisely this reason, so nothing but a draw can move an index.
 */
const BRIEF_DRAW_INDEXES = {
  revenueMillions: 0,
  budget: 1,
  premiumSharePct: 2,
  acquisitionCost: 4,
  contributionStale: 5,
} as const

const BRIEF_NUMBER_COUNT = 6

/** Reads the draws back out of a brief this file wrote; null when the brief is not one of ours. */
export function drawsFromBrief(brief: string): Draws | null {
  const found = numbersIn(brief).map(Number)
  if (found.length !== BRIEF_NUMBER_COUNT || found.some((value) => !Number.isFinite(value))) {
    return null
  }
  const at = (index: number): number => found[index] ?? 0
  const draws: Draws = {
    revenueMillions: at(BRIEF_DRAW_INDEXES.revenueMillions),
    budget: at(BRIEF_DRAW_INDEXES.budget),
    premiumSharePct: at(BRIEF_DRAW_INDEXES.premiumSharePct),
    acquisitionCost: at(BRIEF_DRAW_INDEXES.acquisitionCost),
    contributionStaleCents: Math.round(at(BRIEF_DRAW_INDEXES.contributionStale) * 100),
  }
  return draws.contributionStaleCents > 0 && draws.acquisitionCost > 0 ? draws : null
}

/** The seed when the step has one (step 1), the brief it wrote when it does not (steps 2 to 5). */
export function figuresFor(input: GenerationMockInput): Figures {
  if (input.seedText.trim() !== '') return figuresFromDraws(drawsFromSeed(input.seedText))
  const recovered = input.brief.trim() === '' ? null : drawsFromBrief(input.brief)
  return figuresFromDraws(recovered ?? DEFAULT_DRAWS)
}

// ---------------------------------------------------------------------------------------------
// Formatting and dates (pure; generation never reads a clock, FR-197)
// ---------------------------------------------------------------------------------------------

const usd = (cents: number): string => (cents / 100).toFixed(2)
const grouped = (value: number): string => {
  const [whole = '', fraction] = String(value).split('.')
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? withCommas : `${withCommas}.${fraction}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const isoOf = (date: Date): string => date.toISOString().slice(0, 10)

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return isoOf(date)
}

function shiftMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  const target = date.getUTCMonth() + months
  date.setUTCDate(1)
  date.setUTCMonth(target)
  return isoOf(date)
}

/** "February 2025", for a document title that names when the thing was written. */
function monthAndYear(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return `${MONTHS[date.getUTCMonth()] ?? 'January'} ${date.getUTCFullYear()}`
}

export type PackageDates = Record<
  | 'review'
  | 'fulfilment'
  | 'capacity'
  | 'survey'
  | 'memo'
  | 'press'
  | 'note'
  | 'dashboard'
  | 'board',
  string
>

export function datesFor(figures: Figures): PackageDates {
  return {
    review: shiftMonths(ANCHOR_DATE, -figures.staleOffsetMonths),
    survey: shiftMonths(ANCHOR_DATE, -4),
    fulfilment: shiftMonths(ANCHOR_DATE, -3),
    capacity: shiftMonths(ANCHOR_DATE, -2),
    memo: shiftMonths(ANCHOR_DATE, -1),
    press: shiftDays(ANCHOR_DATE, -45),
    note: shiftDays(ANCHOR_DATE, -14),
    dashboard: shiftDays(ANCHOR_DATE, -4),
    board: ANCHOR_DATE,
  }
}

// ---------------------------------------------------------------------------------------------
// Step 1 — re-skin, brief, stakeholders
// ---------------------------------------------------------------------------------------------

/**
 * The brief the student reads (PRD §7.2, at most 200 words).
 *
 * Its numeric sentence is load-bearing in a way no other prose here is: `drawsFromBrief` reads the
 * five draws back from it by position, so the order of the numbers below is a contract with
 * `BRIEF_DRAW_INDEXES`. Changing it means changing both.
 */
export function renderBrief(figures: Figures): string {
  return [
    `${COMPANY} sells single-origin coffee by subscription. Revenue is ${figures.revenueMillions} million dollars a year, growth has been flat for three consecutive quarters, and the board has set aside ${grouped(figures.budget)} dollars for acquisition this quarter.`,
    `You run growth. Today ${figures.premiumSharePct} percent of that budget goes to the premium tier and ${figures.valueSharePct} percent to the value tier. A premium subscriber costs ${figures.acquisitionCost} dollars to acquire, and the last review of the tier put the monthly contribution behind that number at ${usd(figures.contributionStaleCents)} dollars. The founder wants to move upmarket now; the finance director wants the premium payback rechecked first; the roastery is worried about capacity. Nine documents sit in the Evidence Room, dated and attributed.`,
    `Decide what share of this quarter's acquisition budget goes to premium, and state the premium payback you are betting on. You have the Evidence Room, an AI assistant, and twenty-five minutes. Whatever you commit is what finance funds on Monday; there is no second pass this quarter.`,
  ].join('\n\n')
}

/** The one place the licensed case is named: the record of what was changed away from it (FR-028). */
function seedLabel(seedText: string): string {
  const firstLine =
    seedText.split('\n').find((line) => line.trim() !== '') ?? 'the licensed seed case'
  return firstLine.trim().slice(0, 120)
}

export type MockStakeholder = {
  key: string
  name: string
  roleTitle: string
  positionStatement: string
  incentives: string
  blindSpots: string
}

export function stakeholdersOf(figures: Figures): MockStakeholder[] {
  return [
    {
      key: STAKEHOLDER_KEYS.founder,
      name: PEOPLE.founder.name,
      roleTitle: PEOPLE.founder.roleTitle,
      positionStatement: `The premium tier is the only part of this business that is growing, and the review already showed it pays for itself inside the year. Move the majority of the quarter to premium and stop relitigating a number we published ourselves.`,
      incentives: `Wants a growth story for the next funding conversation, and owns the premium tier as a personal project. A quarter spent on the value tier is a quarter with nothing new to show.`,
      blindSpots: `Reads the ${monthAndYear(datesFor(figures).review)} review as current because it was written here. Treats the finance correction as caution rather than as arithmetic.`,
    },
    {
      key: STAKEHOLDER_KEYS.finance,
      name: PEOPLE.finance.name,
      roleTitle: PEOPLE.finance.roleTitle,
      positionStatement: `The premium payback in the positioning review left fulfilment out of the contribution. With fulfilment carried, the tier pays back in about ${figures.paybackTrueMonths} months, not ${figures.paybackStaleMonths}. Size the shift on the corrected number or do not size it at all.`,
      incentives: `Answers to the board for what the quarter actually returns, and signed off the correction in writing. Being right about the figure matters more than being fast.`,
      blindSpots: `Under-weights the cost of doing nothing for a quarter, and treats a single corrected figure as settling a decision that also turns on capacity and retention.`,
    },
    {
      key: STAKEHOLDER_KEYS.operations,
      name: PEOPLE.operations.name,
      roleTitle: PEOPLE.operations.roleTitle,
      positionStatement: `Whatever share you send to premium, the roastery can fill about ${grouped(figures.weeklyCapacity)} premium boxes a week before a second shift. Past that the cost per box changes and none of these paybacks hold.`,
      incentives: `Judged on fulfilment reliability and on the roastery's overtime bill. A step change in premium volume is a step change in both.`,
      blindSpots: `Frames every question as a capacity question, and has not read the payback correction at all.`,
    },
  ]
}

export type ReskinEntry = { kind: string; from: string; to: string; note: string }

export function reskinLogOf(seedText: string, figures: Figures): ReskinEntry[] {
  const label = seedLabel(seedText)
  return [
    {
      kind: 'renamed_entity',
      from: label,
      to: `${COMPANY}; ${PEOPLE.founder.name}, ${PEOPLE.finance.name}, ${PEOPLE.operations.name}, ${PEOPLE.colleague.name}`,
      note: `Company, people and market are invented, so no lookup resolves a claim (PRD 7.2). The market is ${MARKET}.`,
    },
    {
      kind: 'altered_number',
      from: 'The figures of the licensed case',
      to: `${figures.acquisitionCost} dollar premium acquisition cost, ${usd(figures.contributionStaleCents)} dollar contribution before fulfilment, ${usd(figures.contributionTrueCents)} after, ${figures.paybackTrueMonths}-month corrected payback, ${figures.retentionEarly} percent month-three retention`,
      note: `Every figure was set so the arithmetic reproduces end to end: ${figures.acquisitionCost} over ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)}, and ${figures.acquisitionCost} over ${usd(figures.contributionTrueCents)} is ${figures.paybackTrue.toFixed(1)}.`,
    },
    {
      kind: 'restructured_document',
      from: 'A single combined exhibit',
      to: 'Nine dated documents, with the positioning review and the payback correction split apart and the fulfilment schedule pulled out on its own',
      note: 'The split is what makes the supersession visible to a student who reads dates, and what makes the omitted cost traceable.',
    },
  ]
}

// ---------------------------------------------------------------------------------------------
// Step 2 — documents
// ---------------------------------------------------------------------------------------------

export type MockDocument = {
  key: string
  title: string
  author: string
  datedOn: string
  role: string
  position: number
  supersededByKey: string | null
  stakeholderKey: string | null
  body: string
}

const byline = (person: { name: string; roleTitle: string }): string =>
  `${person.name}, ${person.roleTitle}`

export function documentsOf(figures: Figures): MockDocument[] {
  const dates = datesFor(figures)
  return [
    {
      key: 'D1',
      title: `Premium Tier Positioning Review (${monthAndYear(dates.review)} board deck)`,
      author: byline(PEOPLE.founder),
      datedOn: dates.review,
      role: 'superseded',
      position: 0,
      supersededByKey: 'D2',
      stakeholderKey: STAKEHOLDER_KEYS.founder,
      body: [
        'Prepared for the board session. One question: does a premium subscriber pay for himself fast enough to justify moving acquisition dollars out of the value tier?',
        `What the pilot shows. The first premium cohort cost ${figures.acquisitionCost} dollars each, blended across paid social, the podcast reads and our own list. That is high against the value tier's ${figures.valueAcquisitionCost} dollars, and it should be: the creative is heavier, the audience is narrower, and we are buying a ${usd(figures.premiumPriceCents)} dollar subscription rather than a ${usd(figures.valuePriceCents)} dollar one.`,
        `Against that cost, a premium subscriber contributes ${usd(figures.contributionStaleCents)} dollars a month in gross margin. Green coffee, roasting labour and the standard mailer are inside that figure.`,
        `Payback. ${figures.acquisitionCost} divided by ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)}. About ${figures.paybackStaleMonths} months. The premium subscriber returns his acquisition cost inside the fiscal year, and every month after that is contribution we do not have to buy again.`,
        'Recommendation. Move the majority of quarterly acquisition to premium at the next planning cycle. The value tier is close to saturated in our three strongest metros and the premium creative is working.',
        'Open items. Fulfilment costs for the insulated shipper and the glass jar are still out for quote and are not carried in the contribution figure above. Retention beyond month two is not yet observable on this cohort. Both should be revisited before the tier mix is changed permanently.',
      ].join('\n\n'),
    },
    {
      key: 'D2',
      title: 'Retention and Payback Memo: correcting the premium payback figure',
      author: byline(PEOPLE.finance),
      datedOn: dates.memo,
      role: 'supporting',
      position: 1,
      supersededByKey: null,
      stakeholderKey: STAKEHOLDER_KEYS.finance,
      body: [
        `To leadership, from finance. Subject: the premium payback figure, corrected. The ${figures.paybackStaleMonths}-month premium payback in the positioning review is ${figures.staleOffsetMonths} months old and it is wrong for the decision in front of us. This memo replaces it. Please retire the deck's payback slide from planning material.`,
        `What changed. The review's ${usd(figures.contributionStaleCents)} dollar monthly contribution excluded premium fulfilment. The insulated shipper, the glass jar and the roast-to-order freight schedule were still out for quote then. They are quoted now. Roastery operations puts them at ${usd(figures.fulfilmentCents)} dollars per premium subscriber per month; the schedule of ${monthAndYear(dates.fulfilment)} has the line items. Contribution is therefore ${usd(figures.contributionTrueCents)} dollars a month, not ${usd(figures.contributionStaleCents)}.`,
        `Corrected payback. ${figures.acquisitionCost} dollars of acquisition cost divided by ${usd(figures.contributionTrueCents)} dollars a month is ${figures.paybackTrue.toFixed(1)}. Call it ${figures.paybackTrueMonths} months. That is the number to plan against for the tier as a whole.`,
        `One thing the deck was right about, in a narrower sense. The first pilot cohort, priced before the freight change and before the jar, did return its acquisition cost in about ${figures.paybackStaleMonths} months. That is a pre-fulfilment number, for one cohort of ${figures.cohortSize}, under economics we no longer run. It is not the tier-wide payback and it must not be used as one.`,
        `Retention. The dashboard puts month-three retention on that first premium cohort at ${figures.retentionEarly} percent. I would not build a plan on it yet. It is one cohort, and the second does not reach month three until this month.`,
        `What I would hold to. ${figures.paybackTrueMonths} months is a real payback and it is shorter than this category usually reports. It is not ${figures.paybackStaleMonths}, and it is not inside the fiscal year. A plan that moves a majority of the quarter on the ${figures.paybackStaleMonths}-month number is planning against a figure that has been superseded in writing.`,
      ].join('\n\n'),
    },
    {
      key: 'D3',
      title: 'Founder note to the leadership team',
      author: byline(PEOPLE.founder),
      datedOn: dates.note,
      role: 'interpretation_as_fact',
      position: 2,
      supersededByKey: null,
      stakeholderKey: STAKEHOLDER_KEYS.founder,
      body: [
        'Short note before the planning session, so nobody is surprised.',
        `Premium subscribers are about ${figures.priceSensitivity} percent less price sensitive than value subscribers. That is why the tier holds margin when everyone else discounts, and it is why I keep pushing on it.`,
        `The value tier is saturated in the three strongest metros. New-subscriber volume there has been flat for three quarters at an acquisition cost that has not moved, and that is what a ceiling looks like.`,
        'I have read the finance memo. I do not think a correction to a contribution line changes the direction of travel. We should be arguing about how fast to move, not whether.',
        'Nothing in this note is a new analysis. It is how I read what we already have.',
      ].join('\n\n'),
    },
    {
      key: 'D4',
      title: 'Premium fulfilment cost schedule',
      author: byline(PEOPLE.operations),
      datedOn: dates.fulfilment,
      role: 'supporting',
      position: 3,
      supersededByKey: null,
      stakeholderKey: STAKEHOLDER_KEYS.operations,
      body: [
        'Quoted line items for the premium box, per subscriber per month, now that the shipper and the jar are under contract.',
        `Insulated shipper and liner, glass jar and closure, roast-to-order freight surcharge, and the returns allowance. Together they come to ${usd(figures.fulfilmentCents)} dollars per premium subscriber per month.`,
        'None of these applied to the value box, which ships in the standard mailer on the weekly consolidation.',
        'For the avoidance of doubt: these costs were out for quote when the positioning review was written, and the review says so in its open items. They are not new information about the tier; they are the price of the box we were already sending.',
      ].join('\n\n'),
    },
    {
      key: 'D5',
      title: 'Roastery capacity plan for the coming quarter',
      author: byline(PEOPLE.operations),
      datedOn: dates.capacity,
      role: 'supporting',
      position: 4,
      supersededByKey: null,
      stakeholderKey: STAKEHOLDER_KEYS.operations,
      body: [
        `On the current single shift the roastery can fill about ${grouped(figures.weeklyCapacity)} premium boxes a week. That is the roast-to-order constraint, not a packing constraint: premium is roasted against the order rather than off the weekly batch.`,
        'Beyond that number we add a second shift. The second shift is a step cost, not a slope: overtime, a second quality pass, and a supervisor. It does not come back out until volume falls for a full quarter.',
        'A tier mix that lands anywhere under the weekly number changes nothing here. A mix that clears it changes the cost per box, and every payback in circulation is computed on the cost per box we have today.',
      ].join('\n\n'),
    },
    {
      key: 'D6',
      title: 'Subscriber willingness-to-pay survey summary',
      author: 'Research operations',
      datedOn: dates.survey,
      role: 'supporting',
      position: 5,
      supersededByKey: null,
      stakeholderKey: null,
      body: [
        `A panel of current value-tier subscribers was asked what they would pay for a roast-to-order tier. ${figures.surveyShare} percent placed themselves above the premium price.`,
        'Method and caveats, which matter more than the headline. The panel was recruited from subscribers who had opened a marketing email in the previous month, which selects for engagement. Respondents were told the tier was under consideration, which invites agreement. The question asked what they would pay, not what they have paid.',
        'Stated willingness to pay runs ahead of behaviour in this category, and the size of the gap is not something this survey can measure. Treat the figure as an upper bound on interest, not as a forecast of conversion.',
      ].join('\n\n'),
    },
    {
      key: 'D7',
      title: 'Trade press clipping: a competitor rebrands its packaging',
      author: 'Trade press digest',
      datedOn: dates.press,
      role: 'irrelevant',
      position: 6,
      supersededByKey: null,
      stakeholderKey: null,
      body: [
        'A national roaster has relaunched its retail packaging with a recycled fibre carton and a new wordmark, and has taken trade press coverage for it.',
        'The coverage is accurate. The rebrand concerns their retail bag, not a subscription tier, and their subscription business is not mentioned. No pricing, retention or acquisition figure appears anywhere in the piece.',
        'Filed for completeness because it was circulated internally the same week as the planning pack.',
      ].join('\n\n'),
    },
    {
      key: 'D8',
      title: 'Retention dashboard extract, premium cohorts',
      author: 'Research operations',
      datedOn: dates.dashboard,
      role: 'supporting',
      position: 7,
      supersededByKey: null,
      stakeholderKey: null,
      body: [
        `Cohort one, ${figures.cohortSize} subscribers, reached month three at ${figures.retentionEarly} percent.`,
        'Cohort two, acquired under current pricing and the current box, reaches month three this month. The dashboard will carry it when the month closes.',
        'A note the dashboard prints under every cohort chart: two cohorts is not a curve, and a single cohort at month three is a point. Retention on this tier has not been observed past month six by anyone here.',
      ].join('\n\n'),
    },
    {
      key: 'D9',
      title: 'Board pack cover note: acquisition mix decision',
      author: byline(PEOPLE.finance),
      datedOn: dates.board,
      role: 'supporting',
      position: 8,
      supersededByKey: null,
      stakeholderKey: STAKEHOLDER_KEYS.finance,
      body: [
        `The board expects one number from this session: the share of the quarter's ${grouped(figures.budget)} dollar acquisition budget going to premium, and the payback that share is priced on.`,
        'The decision is funded on Monday. There is no second pass this quarter, and a share committed here is a share the roastery plans against.',
        'What the board has asked to see alongside the number: the payback figure it rests on, where that figure comes from, and what would have to be true for the number to be wrong.',
      ].join('\n\n'),
    },
  ]
}

// ---------------------------------------------------------------------------------------------
// Step 3 — answer space and named fields
// ---------------------------------------------------------------------------------------------

export type MockPosition = {
  key: string
  kind: string
  summary: string
  supportingDocumentKeys: string[]
  ignoredEvidence: string | null
  isMinimumCommitment: boolean
  position: number
}

export type MockNamedField = { key: string; label: string; unit: string; position: number }

export function positionsOf(figures: Figures): MockPosition[] {
  return [
    {
      key: 'hold_share',
      kind: 'defensible',
      summary: `Hold the premium share near where it is this quarter and fund a recheck of the payback before moving money. Defensible on the corrected contribution: at ${figures.paybackTrueMonths} months the tier does not return inside the year, and the second cohort has not reached month three.`,
      supportingDocumentKeys: ['D2', 'D8'],
      ignoredEvidence: null,
      isMinimumCommitment: true,
      position: 0,
    },
    {
      key: 'bounded_shift',
      kind: 'defensible',
      summary: `Move a bounded share — up to about a third of the quarter — to premium, priced on the corrected ${figures.paybackTrueMonths}-month payback and capped under the roastery's weekly capacity. Defensible because the tier is real and the risk is sized.`,
      supportingDocumentKeys: ['D2', 'D5', 'D6'],
      ignoredEvidence: null,
      isMinimumCommitment: false,
      position: 1,
    },
    {
      key: 'majority_to_premium',
      kind: 'evidence_inconsistent',
      summary: `Move the majority of the quarter to premium on the strength of the positioning review's payback and the founder's read of the value tier.`,
      supportingDocumentKeys: ['D1', 'D3'],
      ignoredEvidence: `The payback correction of ${monthAndYear(datesFor(figures).memo)} and the fulfilment schedule behind it: the ${figures.paybackStaleMonths}-month figure this position is sized on was superseded in writing, and the roastery's weekly capacity caps the volume this share would buy.`,
      isMinimumCommitment: false,
      position: 2,
    },
  ]
}

export const NAMED_FIELDS: MockNamedField[] = [
  {
    key: 'premium_share',
    label: "Share of the quarter's acquisition budget going to premium",
    unit: 'percent',
    position: 0,
  },
  {
    key: 'premium_payback_months',
    label: 'Premium payback you are betting on',
    unit: 'months',
    position: 1,
  },
]

// ---------------------------------------------------------------------------------------------
// Step 4 — claims and per-variant states
// ---------------------------------------------------------------------------------------------

export type MockCarriedValue = { field_key?: string; value: number; unit: string }

export type MockVerificationPaths = {
  source_trace?: { document_key: string; passage: string; dated_on: string; author: string }
  replication_check?: { result: string }
  decomposition_check?: { steps: { label: string; result: string }[] }
}

export type MockClaim = {
  key: string
  text: string
  sourceKind: string
  sourceDocumentKey: string | null
  sourcePassage: string
  importance: string
  consequenceLevel: string
  verificationCost: string
  weaklySourced: boolean
  volatile: boolean
  conceptKey: string
  carriedValues: MockCarriedValue[]
  triggerPhrases: string[]
  triggerDescription: string
  escalatable: boolean
  escalationReply: string | null
  rationale: string
  position: number
  /** Per-variant material, in the shape `gen-claims-states@1` returns (§2.1). */
  defective: {
    failureFamily: string | null
    plantedTrue: boolean
    warrantedStance: string
    verificationPaths: MockVerificationPaths
  }
  sound: { warrantedStance: string; verificationPaths: MockVerificationPaths }
}

/** `conceptSet[index % length]`, so every claim names a concept the version actually declared. */
const conceptAt = (conceptSet: readonly string[], index: number): string => {
  const set = conceptSet.length > 0 ? conceptSet : DEFAULT_CONCEPT_SET
  return set[index % set.length] ?? DEFAULT_CONCEPT_SET[0]
}

export function claimsOf(figures: Figures, conceptSet: readonly string[]): MockClaim[] {
  const dates = datesFor(figures)
  const concept = (index: number): string => conceptAt(conceptSet, index)

  return [
    {
      key: 'C1',
      text: `Premium payback is about ${figures.paybackStaleMonths} months, so the premium tier returns its acquisition cost inside the year.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D1',
      sourcePassage: `${figures.acquisitionCost} divided by ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)}. About ${figures.paybackStaleMonths} months.`,
      importance: 'load_bearing',
      consequenceLevel: 'high',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(0),
      carriedValues: [
        { field_key: 'premium_payback_months', value: figures.paybackStaleMonths, unit: 'months' },
      ],
      triggerPhrases: [
        'premium payback',
        'payback period',
        'how long until premium pays back',
        'what is the premium payback',
      ],
      triggerDescription:
        'The student asks how long a premium subscriber takes to return the cost of acquiring them.',
      escalatable: false,
      escalationReply: null,
      rationale: `The figure is carried forward from a review whose contribution line excluded fulfilment. A Source Trace returns the review and its date, and the correction that replaced it is in the room; the date alone is enough to refuse the figure.`,
      position: 0,
      defective: {
        failureFamily: 'stale_evidence',
        plantedTrue: true,
        warrantedStance: 'challenge',
        verificationPaths: {
          source_trace: {
            document_key: 'D1',
            passage: `${figures.acquisitionCost} divided by ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)}. About ${figures.paybackStaleMonths} months. Open items: fulfilment costs are still out for quote and are not carried in the contribution figure above.`,
            dated_on: dates.review,
            author: byline(PEOPLE.founder),
          },
          decomposition_check: {
            steps: [
              {
                label: 'Acquisition cost per premium subscriber',
                result: `${figures.acquisitionCost} dollars, blended across channels.`,
              },
              {
                label: 'Monthly contribution used in the review',
                result: `${usd(figures.contributionStaleCents)} dollars, excluding fulfilment.`,
              },
              {
                label: 'Monthly contribution with fulfilment carried',
                result: `${usd(figures.contributionTrueCents)} dollars, after the ${usd(figures.fulfilmentCents)} dollar box cost quoted since.`,
              },
              {
                label: 'Payback on each',
                result: `${figures.paybackStale.toFixed(1)} months on the review's figure; ${figures.paybackTrue.toFixed(1)} months on the corrected one.`,
              },
            ],
          },
        },
      },
      sound: {
        warrantedStance: 'verify',
        verificationPaths: {
          source_trace: {
            document_key: 'D2',
            passage: `The first pilot cohort, priced before the freight change and before the jar, did return its acquisition cost in about ${figures.paybackStaleMonths} months. That is a pre-fulfilment number, for one cohort of ${figures.cohortSize}.`,
            dated_on: dates.memo,
            author: byline(PEOPLE.finance),
          },
          // The same menu as the defective variant, with the sound variant's own answer behind it
          // (D-330). `availableActions` is projected from these keys straight onto the claim card,
          // so a check offered on one variant and not the other tells whoever drew it which one
          // they are on — and on the planted claim that is the plant itself.
          decomposition_check: {
            steps: [
              {
                label: 'Acquisition cost per premium subscriber',
                result: `${figures.acquisitionCost} dollars, blended across channels.`,
              },
              {
                label: 'Monthly contribution used',
                result: `${usd(figures.contributionStaleCents)} dollars, the pre-fulfilment contribution the pilot cohort was priced on.`,
              },
              {
                label: 'Payback for that cohort',
                result: `${figures.paybackStale.toFixed(1)} months, which is the figure as stated and for the cohort it was stated about.`,
              },
              {
                label: 'What the figure covers',
                result: `One cohort of ${figures.cohortSize} under economics that no longer run; the memo puts the tier as a whole at ${figures.paybackTrue.toFixed(1)} months.`,
              },
            ],
          },
        },
      },
    },
    {
      key: 'C2',
      text: `Month-three retention on the first premium cohort is ${figures.retentionEarly} percent, above the value tier at the same age.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D8',
      sourcePassage: `Cohort one, ${figures.cohortSize} subscribers, reached month three at ${figures.retentionEarly} percent.`,
      importance: 'load_bearing',
      consequenceLevel: 'high',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: true,
      conceptKey: concept(2),
      carriedValues: [{ value: figures.retentionEarly, unit: 'percent' }],
      triggerPhrases: [
        'premium retention',
        'month three retention',
        'does premium retain better',
        'retention',
      ],
      triggerDescription: 'The student asks how well premium subscribers stay.',
      escalatable: false,
      escalationReply: null,
      rationale:
        'One cohort at one month is a point, not a curve, and the second cohort lands inside the run. Verify is warranted before anything is priced on it.',
      position: 1,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'verify',
        verificationPaths: {
          source_trace: {
            document_key: 'D8',
            passage: `Cohort one, ${figures.cohortSize} subscribers, reached month three at ${figures.retentionEarly} percent. Two cohorts is not a curve, and a single cohort at month three is a point.`,
            dated_on: dates.dashboard,
            author: 'Research operations',
          },
        },
      },
      sound: {
        warrantedStance: 'verify',
        verificationPaths: {
          source_trace: {
            document_key: 'D8',
            passage: `Cohort one, ${figures.cohortSize} subscribers, reached month three at ${figures.retentionEarly} percent. Two cohorts is not a curve, and a single cohort at month three is a point.`,
            dated_on: dates.dashboard,
            author: 'Research operations',
          },
        },
      },
    },
    {
      key: 'C3',
      text: `Premium fulfilment adds ${usd(figures.fulfilmentCents)} dollars per subscriber per month, and the value box carries none of it.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D4',
      sourcePassage: `Together they come to ${usd(figures.fulfilmentCents)} dollars per premium subscriber per month.`,
      importance: 'supporting',
      consequenceLevel: 'low',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(7),
      carriedValues: [{ value: figures.fulfilmentCents / 100, unit: 'usd' }],
      triggerPhrases: [
        'fulfilment cost',
        'fulfillment cost',
        'what does the jar cost',
        'shipping cost per subscriber',
      ],
      triggerDescription: 'The student asks what the premium box costs to send.',
      escalatable: false,
      escalationReply: null,
      rationale:
        'Quoted, contracted and dated. Accept is warranted; a Challenge here is a false alarm.',
      position: 2,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D4',
            passage: `Insulated shipper and liner, glass jar and closure, freight surcharge and returns allowance: ${usd(figures.fulfilmentCents)} dollars per premium subscriber per month.`,
            dated_on: dates.fulfilment,
            author: byline(PEOPLE.operations),
          },
        },
      },
      sound: {
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D4',
            passage: `Insulated shipper and liner, glass jar and closure, freight surcharge and returns allowance: ${usd(figures.fulfilmentCents)} dollars per premium subscriber per month.`,
            dated_on: dates.fulfilment,
            author: byline(PEOPLE.operations),
          },
        },
      },
    },
    {
      key: 'C4',
      text: `With fulfilment carried, premium contribution is ${usd(figures.contributionTrueCents)} dollars a month and the tier-wide payback is about ${figures.paybackTrueMonths} months.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D2',
      sourcePassage: `${figures.acquisitionCost} dollars divided by ${usd(figures.contributionTrueCents)} dollars a month is ${figures.paybackTrue.toFixed(1)}.`,
      importance: 'load_bearing',
      consequenceLevel: 'high',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(1),
      carriedValues: [
        { field_key: 'premium_payback_months', value: figures.paybackTrueMonths, unit: 'months' },
        { value: figures.contributionTrueCents / 100, unit: 'usd' },
      ],
      triggerPhrases: [
        'corrected payback',
        'contribution margin',
        'premium contribution',
        'what does premium contribute',
      ],
      triggerDescription:
        'The student asks what a premium subscriber contributes once every cost of the box is carried.',
      escalatable: false,
      escalationReply: null,
      rationale:
        'The arithmetic reproduces from two quoted figures in the room, and the memo that states it supersedes the review. Accept is warranted.',
      position: 3,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'accept',
        verificationPaths: {
          replication_check: {
            result: `${figures.acquisitionCost} over ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)} months; ${figures.acquisitionCost} over ${usd(figures.contributionTrueCents)} is ${figures.paybackTrue.toFixed(1)} months. The difference is the ${usd(figures.fulfilmentCents)} dollar box.`,
          },
          source_trace: {
            document_key: 'D2',
            passage: `Contribution is therefore ${usd(figures.contributionTrueCents)} dollars a month, not ${usd(figures.contributionStaleCents)}. Call the payback ${figures.paybackTrueMonths} months.`,
            dated_on: dates.memo,
            author: byline(PEOPLE.finance),
          },
        },
      },
      sound: {
        warrantedStance: 'accept',
        verificationPaths: {
          replication_check: {
            result: `${figures.acquisitionCost} over ${usd(figures.contributionStaleCents)} is ${figures.paybackStale.toFixed(1)} months; ${figures.acquisitionCost} over ${usd(figures.contributionTrueCents)} is ${figures.paybackTrue.toFixed(1)} months. The difference is the ${usd(figures.fulfilmentCents)} dollar box.`,
          },
          source_trace: {
            document_key: 'D2',
            passage: `Contribution is therefore ${usd(figures.contributionTrueCents)} dollars a month, not ${usd(figures.contributionStaleCents)}. Call the payback ${figures.paybackTrueMonths} months.`,
            dated_on: dates.memo,
            author: byline(PEOPLE.finance),
          },
        },
      },
    },
    {
      key: 'C5',
      text: `Premium subscribers are about ${figures.priceSensitivity} percent less price sensitive than value subscribers.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D3',
      sourcePassage: `Premium subscribers are about ${figures.priceSensitivity} percent less price sensitive than value subscribers.`,
      importance: 'load_bearing',
      consequenceLevel: 'medium',
      verificationCost: 'moderate',
      weaklySourced: true,
      volatile: false,
      conceptKey: concept(3),
      carriedValues: [{ value: figures.priceSensitivity, unit: 'percent' }],
      triggerPhrases: [
        'price sensitivity',
        'can we raise the premium price',
        'less price sensitive',
        'pricing power',
      ],
      triggerDescription: 'The student asks whether premium subscribers tolerate a higher price.',
      escalatable: false,
      escalationReply: null,
      rationale:
        'A reading stated as a finding. The trace returns a note that says of itself that it is not a new analysis, which is what makes Verify the warranted stance.',
      position: 4,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'verify',
        verificationPaths: {
          source_trace: {
            document_key: 'D3',
            passage:
              'Nothing in this note is a new analysis. It is how I read what we already have.',
            dated_on: dates.note,
            author: byline(PEOPLE.founder),
          },
        },
      },
      sound: {
        warrantedStance: 'verify',
        verificationPaths: {
          source_trace: {
            document_key: 'D3',
            passage:
              'Nothing in this note is a new analysis. It is how I read what we already have.',
            dated_on: dates.note,
            author: byline(PEOPLE.founder),
          },
        },
      },
    },
    {
      key: 'C6',
      text: `The roastery can fill about ${grouped(figures.weeklyCapacity)} premium boxes a week before a second shift is needed.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D5',
      sourcePassage: `On the current single shift the roastery can fill about ${grouped(figures.weeklyCapacity)} premium boxes a week.`,
      importance: 'supporting',
      consequenceLevel: 'low',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(5),
      carriedValues: [{ value: figures.weeklyCapacity, unit: 'count' }],
      triggerPhrases: ['capacity', 'how many boxes', 'second shift', 'roastery capacity'],
      triggerDescription: 'The student asks how much premium volume the roastery can absorb.',
      escalatable: false,
      escalationReply: null,
      rationale: 'Owned, current and unambiguous. Accept is warranted.',
      position: 5,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D5',
            passage:
              'That is the roast-to-order constraint, not a packing constraint. Beyond that number we add a second shift.',
            dated_on: dates.capacity,
            author: byline(PEOPLE.operations),
          },
        },
      },
      sound: {
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D5',
            passage:
              'That is the roast-to-order constraint, not a packing constraint. Beyond that number we add a second shift.',
            dated_on: dates.capacity,
            author: byline(PEOPLE.operations),
          },
        },
      },
    },
    {
      key: 'C7',
      text: `The willingness-to-pay survey puts ${figures.surveyShare} percent of value subscribers above the premium price.`,
      sourceKind: 'document',
      sourceDocumentKey: 'D6',
      sourcePassage: `${figures.surveyShare} percent placed themselves above the premium price.`,
      importance: 'supporting',
      consequenceLevel: 'medium',
      verificationCost: 'expensive',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(6),
      carriedValues: [{ value: figures.surveyShare, unit: 'percent' }],
      triggerPhrases: [
        'willingness to pay',
        'survey',
        'how many would upgrade',
        'would they pay more',
      ],
      triggerDescription:
        'The student asks how many value subscribers would move up if offered the premium tier.',
      escalatable: true,
      escalationReply: `${PEOPLE.colleague.name}, ${PEOPLE.colleague.roleTitle}. I have picked this up. The honest answer is that the panel selects for engaged subscribers and the question asked what they would pay, not what they have paid, so the figure is an upper bound and I cannot size the gap for you inside your window. If the share you commit turns on this number, say so in the open and we will run it properly before the next planning cycle.`,
      rationale:
        'Stated willingness to pay is not behaviour, and the panel selects for engagement. The survey names its own limits, so an escalation is the warranted move rather than a stance taken on the number.',
      position: 6,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'escalate',
        verificationPaths: {
          source_trace: {
            document_key: 'D6',
            passage:
              'The panel was recruited from subscribers who had opened a marketing email in the previous month, which selects for engagement. Treat the figure as an upper bound on interest.',
            dated_on: dates.survey,
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
              'The panel was recruited from subscribers who had opened a marketing email in the previous month, which selects for engagement. Treat the figure as an upper bound on interest.',
            dated_on: dates.survey,
            author: 'Research operations',
          },
        },
      },
    },
    {
      key: 'C8',
      text: 'The value tier is close to saturated in the three strongest metros.',
      sourceKind: 'document',
      sourceDocumentKey: 'D3',
      sourcePassage: 'The value tier is saturated in the three strongest metros.',
      importance: 'supporting',
      consequenceLevel: 'low',
      verificationCost: 'moderate',
      weaklySourced: false,
      volatile: false,
      conceptKey: concept(3),
      carriedValues: [],
      triggerPhrases: [
        'saturated',
        'is the value tier out of room',
        'value tier growth',
        'saturation',
      ],
      triggerDescription:
        'The student asks whether there is room left to grow the value tier where it already sells.',
      escalatable: false,
      escalationReply: null,
      rationale:
        'Flat volume at a flat acquisition cost is consistent with saturation and with several other readings, and nothing turns on it here. Accept is warranted; a Challenge is a false alarm.',
      position: 7,
      defective: {
        failureFamily: null,
        plantedTrue: false,
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D3',
            passage:
              'New-subscriber volume there has been flat for three quarters at an acquisition cost that has not moved, and that is what a ceiling looks like.',
            dated_on: dates.note,
            author: byline(PEOPLE.founder),
          },
        },
      },
      sound: {
        warrantedStance: 'accept',
        verificationPaths: {
          source_trace: {
            document_key: 'D3',
            passage:
              'New-subscriber volume there has been flat for three quarters at an acquisition cost that has not moved, and that is what a ceiling looks like.',
            dated_on: dates.note,
            author: byline(PEOPLE.founder),
          },
        },
      },
    },
  ]
}

export function generalEscalationReplyOf(): string {
  return `${PEOPLE.colleague.name}, ${PEOPLE.colleague.roleTitle}. I have picked this up and I do not have a defensible answer for you inside your window. I would rather tell you that than hand you a number you would have to defend on my behalf. Log the escalation with what you would need to resolve it, decide with the assumption stated in the open, and if the assumption turns out to carry the decision we will run it properly before the next planning cycle.`
}

// ---------------------------------------------------------------------------------------------
// Step 5 — the Turn and the Sycophancy Probe
// ---------------------------------------------------------------------------------------------

export type MockTurn = {
  text: string
  voice: string
  stakeholderKey: string | null
  delaySeconds: number
  warrantsChange: boolean
  proportionateResponse: string
  evidence: string
  disruptedAssumptionKeys: string[]
  windowClaimKeys: string[]
}

export type MockProbe = { claimKey: string; originalPosition: string; scriptedReversal: string }

export function turnOf(figures: Figures): MockTurn {
  return {
    text: `${PEOPLE.finance.name} here. The second premium cohort reached month three this morning and it is at ${figures.retentionTurn} percent, not the ${figures.retentionEarly} percent the first cohort held. That is the cohort acquired under current pricing and the current box. Carried through the corrected contribution, a ${figures.acquisitionCost} dollar acquisition cost on this curve is returned in roughly ${figures.paybackTurn.toFixed(0)} months rather than ${figures.paybackTrueMonths}. I am not telling you the direction is wrong. I am telling you the number you priced it on has moved before you have committed it.`,
    voice: 'stakeholder_message',
    stakeholderKey: STAKEHOLDER_KEYS.finance,
    delaySeconds: figures.turnDelaySeconds,
    warrantsChange: true,
    proportionateResponse: 'revise',
    evidence: `Cohort two reached month three at ${figures.retentionTurn} percent against cohort one's ${figures.retentionEarly} percent at the same age. Two cohorts is still not a curve, and the second is the one acquired under current pricing. On the corrected contribution of ${usd(figures.contributionTrueCents)} dollars a month, the ${figures.acquisitionCost} dollar acquisition cost is returned in roughly ${figures.paybackTurn.toFixed(0)} months on the second cohort's curve rather than ${figures.paybackTrueMonths}. The direction of the decision survives this; the number any share was sized on does not.`,
    disruptedAssumptionKeys: ['premium_payback_months', 'premium_share'],
    windowClaimKeys: ['C1', 'C2'],
  }
}

export function probeOf(): MockProbe {
  return {
    claimKey: 'C8',
    originalPosition:
      'Three consecutive quarters of flat new-subscriber volume at an acquisition cost that has not moved is what a ceiling looks like. The metro cohort table shows it, and it is the reason the premium question is in front of you at all.',
    scriptedReversal:
      'You are right to push back on that, and I should not have put it the way I did. Flat volume at a flat cost is consistent with saturation and with several other readings, and the room does not settle between them. Treat the saturation line as mine rather than as something the documents establish.',
  }
}

// ---------------------------------------------------------------------------------------------
// Step 6 — question bank and counterfactual
// ---------------------------------------------------------------------------------------------

export type MockQuestion = {
  key: string
  kind: string
  claimKey: string | null
  assumptionIndex: number | null
  template: string
  condition: Record<string, unknown>
  followUp: string
  expectedAnswerNotes: string
  isDefault: boolean
  position: number
}

const DEFAULT_QUESTIONS: readonly {
  template: string
  followUp: string
  expectedAnswerNotes: string
}[] = [
  {
    template: 'What is the decision you made, in one sentence, and what is it funded on?',
    followUp: 'What would you have needed to see to make the other choice?',
    expectedAnswerNotes:
      'Names the share and the payback it is priced on, and names where that payback came from.',
  },
  {
    template: 'Which document did the most work in this decision, and why that one?',
    followUp: 'What in it did you check rather than take?',
    expectedAnswerNotes: 'Names a document in the room and says what it settled.',
  },
  {
    template: 'Name one thing you relied on that you did not verify, and say why not.',
    followUp: 'What would verifying it have cost you?',
    expectedAnswerNotes:
      'Names a real claim and gives a cost or time reason rather than saying everything was checked.',
  },
  {
    template: 'What is the strongest case against the position you took?',
    followUp: 'What would have to change for that case to win?',
    expectedAnswerNotes: 'States a real opposing position from the room, not a strawman.',
  },
  {
    template: 'Where did the assistant help, and where did you have to check it?',
    followUp: 'What did you do with the parts you could not check?',
    expectedAnswerNotes: 'Distinguishes what was taken from what was tested.',
  },
  {
    template: 'If this decision turns out to be wrong, what will have been the reason?',
    followUp: 'Would you have been able to see that today?',
    expectedAnswerNotes: 'Names a specific figure or assumption rather than bad luck.',
  },
]

export function questionsOf(claims: readonly MockClaim[]): MockQuestion[] {
  const questions: MockQuestion[] = []
  let position = 0
  const push = (question: Omit<MockQuestion, 'position'>): void => {
    questions.push({ ...question, position })
    position += 1
  }

  for (const claim of claims) {
    push({
      key: `Q_PROV_${claim.key}`,
      kind: 'provenance',
      claimKey: claim.key,
      assumptionIndex: null,
      template: 'Where did "{claim_text}" come from, and how old is it?',
      condition: { claim_surfaced: true },
      followUp: 'Did you open the document it came from?',
      expectedAnswerNotes: `Names ${claim.sourceDocumentKey ?? 'the source'} and its date, or says plainly that they did not check.`,
      isDefault: false,
    })
  }
  for (const claim of claims) {
    push({
      key: `Q_VER_${claim.key}`,
      kind: 'verification',
      claimKey: claim.key,
      assumptionIndex: null,
      template: 'You set {stance} on "{claim_text}". What made that the right call?',
      condition: { stance_set: true },
      followUp: 'What would have changed your mind?',
      expectedAnswerNotes:
        'Gives a reason tied to the source, the cost of checking, or the consequence, rather than restating the stance.',
      isDefault: false,
    })
  }
  for (const index of [0, 1, 2]) {
    push({
      key: `Q_ASSUMPTION_${index}`,
      kind: 'assumption',
      claimKey: null,
      assumptionIndex: index,
      template: 'You wrote "{assumption}". What in the room supports it, and what would break it?',
      condition: { assumption_index: index },
      followUp: 'Did anything you read today move it?',
      expectedAnswerNotes: 'Points at evidence rather than restating the assumption.',
      isDefault: false,
    })
  }
  push({
    key: 'Q_CONFIDENCE',
    kind: 'confidence',
    claimKey: null,
    assumptionIndex: null,
    template: 'Your confidence moved during the run. What moved it?',
    condition: {},
    followUp: 'Was it the evidence or the clock?',
    expectedAnswerNotes: 'Names a specific document, claim or event.',
    isDefault: false,
  })
  push({
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
  })
  push({
    key: 'Q_COUNTERFACTUAL',
    kind: 'counterfactual',
    claimKey: null,
    assumptionIndex: null,
    template:
      'If you had opened the payback correction first, what would you have done differently?',
    condition: {},
    followUp: 'What stopped you from opening it first?',
    expectedAnswerNotes:
      'Names a concrete change to the share or the payback, not a general resolve.',
    isDefault: false,
  })
  push({
    key: 'Q_FIGURE_PROVENANCE',
    kind: 'figure_provenance',
    claimKey: null,
    assumptionIndex: null,
    template: 'You entered {figure} in the Decision Brief. Where does that number come from?',
    condition: { unmatched_named_field: true },
    followUp: 'Is it in any document you opened?',
    expectedAnswerNotes:
      'Names a document or a computation; "it seemed about right" is the answer this question exists to surface.',
    isDefault: false,
  })
  DEFAULT_QUESTIONS.forEach((question, index) => {
    push({
      key: `Q_DEFAULT_${index + 1}`,
      kind: 'default',
      claimKey: null,
      assumptionIndex: null,
      template: question.template,
      condition: {},
      followUp: question.followUp,
      expectedAnswerNotes: question.expectedAnswerNotes,
      isDefault: true,
    })
  })

  return questions
}

/**
 * Exactly three sentences (PRD §7.14), and deliberately free of figures: it is written once, read
 * after scoring, and a number in it would have to agree with a package it never sees.
 */
export function counterfactualOf(): string {
  return [
    'If the payback correction had been opened before the payback figure entered the Decision Brief, the review’s number would have failed on its date alone.',
    'A Source Trace on the review returns the deck and the open item saying fulfilment was still out for quote, and the share committed here would have been bounded rather than sized on a superseded figure.',
    'The message from finance would then have cost a revision instead of a reversal.',
  ].join(' ')
}

// ---------------------------------------------------------------------------------------------
// Step 7 — readiness items
// ---------------------------------------------------------------------------------------------

export type MockReadinessOption = { key: string; text: string }
export type MockReadinessItem = {
  key: string
  category: string
  conceptKey: string
  stem: string
  options: MockReadinessOption[]
  answerKey: string
  position: number
}

const OPTION_KEYS = ['a', 'b', 'c', 'd'] as const

type ItemSpec = {
  category: string
  conceptIndex: number | string
  stem: string
  options: [string, string, string, string]
  answer: number
}

/**
 * Sixteen items, 6 / 4 / 6 (PRD §7.1). None names a claim, a document or a figure of the package —
 * the check runs before the scenario opens, and an item that pointed at the defect would hand the
 * student the answer (AI-005, `noItemNamesAClaim`).
 */
const ITEM_SPECS: readonly ItemSpec[] = [
  {
    category: 'foundation',
    conceptIndex: 0,
    stem: 'A payback period tells you what?',
    options: [
      'How long the money spent to win a customer takes to come back',
      'How much profit a customer produces in total',
      'How likely a customer is to stay a second year',
      'How much revenue a product line adds this quarter',
    ],
    answer: 0,
  },
  {
    category: 'foundation',
    conceptIndex: 0,
    stem: 'Two payback figures for the same product differ. Which difference would explain it?',
    options: [
      'One of them leaves a recurring cost out of the margin it divides by',
      'One of them was written by a different department',
      'One of them is expressed in months and the other in weeks',
      'One of them was presented to a board and the other was not',
    ],
    answer: 0,
  },
  {
    category: 'foundation',
    conceptIndex: 1,
    stem: 'Contribution margin is the amount left after which costs?',
    options: [
      'The costs that vary with serving one more customer',
      'All costs, fixed and variable',
      'Only the cost of acquiring the customer',
      'Only the costs the finance team chooses to allocate',
    ],
    answer: 0,
  },
  {
    category: 'foundation',
    conceptIndex: 1,
    stem: 'A cost that was out for quote when a margin was calculated is later contracted. What follows?',
    options: [
      'The margin has to be recalculated before it is used again',
      'The margin is unaffected because it was correct when written',
      'The new cost belongs in a separate report',
      'The margin only changes if the cost is large',
    ],
    answer: 0,
  },
  {
    category: 'foundation',
    conceptIndex: 2,
    stem: 'A single customer cohort observed at one point in time tells you what about retention?',
    options: [
      'One point, which is not yet a curve',
      'The long-run retention rate of the product',
      'Nothing at all',
      'The retention rate of every later cohort',
    ],
    answer: 0,
  },
  {
    category: 'foundation',
    conceptIndex: 2,
    stem: 'Two cohorts were acquired under different prices and different packaging. Comparing them directly risks what?',
    options: [
      'Attributing a difference in behaviour to the wrong cause',
      'Nothing, because both are real customers',
      'Overstating the number of customers',
      'Understating the total revenue',
    ],
    answer: 0,
  },
  {
    category: 'defect_concept',
    conceptIndex: 4,
    stem: 'A figure is quoted from a document that a later document explicitly replaces. What is wrong with using it?',
    options: [
      'It has been superseded, so it no longer describes the situation being decided',
      'Nothing, as long as it was correct when written',
      'It is only a problem if the two documents disagree by a lot',
      'It is only a problem if the later document is longer',
    ],
    answer: 0,
  },
  {
    category: 'defect_concept',
    conceptIndex: 4,
    stem: 'What is the cheapest way to find out whether a quoted figure has been overtaken?',
    options: [
      'Trace it to its source and read the date and what it excluded',
      'Ask whoever quoted it whether they are confident',
      'Recalculate it from memory',
      'Compare it with a figure from a different company',
    ],
    answer: 0,
  },
  {
    category: 'defect_concept',
    conceptIndex: 0,
    stem: 'A ratio is presented as a conclusion but the numbers behind it are not shown. What should you do first?',
    options: [
      'Ask what was divided by what, and what the divisor left out',
      'Accept it if the person presenting it owns the area',
      'Reject it, because unshown work is always wrong',
      'Round it and move on',
    ],
    answer: 0,
  },
  {
    category: 'defect_concept',
    conceptIndex: 4,
    stem: 'Someone states an interpretation as if it were an established finding. What marks it out?',
    options: [
      'It asserts a cause but points at no analysis that tested it',
      'It uses a percentage',
      'It is written informally',
      'It disagrees with the finance team',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_sycophancy',
    stem: 'An assistant reverses a claim as soon as you push back on it. What does the reversal tell you?',
    options: [
      'That it responded to your pressure, which is not evidence either way',
      'That the original claim was false',
      'That the new claim is true',
      'That the assistant has read a new document',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_sycophancy',
    stem: 'What is the right response when an assistant agrees with everything you propose?',
    options: [
      'Test the claims against the sources yourself, as you would with any of them',
      'Trust it more, because agreement means consistency',
      'Ask it to be more critical and take the new answer',
      'Stop using it',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_confabulation',
    stem: 'An assistant produces a specific figure that appears in no document you have. What is it?',
    options: [
      'An assertion with no provenance, which you cannot rely on until you find one',
      'A calculation the assistant performed correctly',
      'A figure from a source you have not been given access to',
      'A rounding of a figure you have',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_reliance',
    stem: 'What does asking an assistant "where did that come from" reliably get you?',
    options: [
      'A pointer you still have to open and read yourself',
      'Proof that the claim is correct',
      'The original document, guaranteed',
      'Nothing useful',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_confabulation',
    stem: 'A claim is repeated by two different tools. What has that established?',
    options: [
      'Nothing about its truth; they may share the same source',
      'That it is twice as likely to be true',
      'That it has been independently confirmed',
      'That the original source was reliable',
    ],
    answer: 0,
  },
  {
    category: 'ai_behavior',
    conceptIndex: 'ai_reliance',
    stem: 'You used an assistant to reach a recommendation. Who is answerable for it?',
    options: [
      'You are, including for the parts you did not check',
      'The assistant, for the parts it produced',
      'Nobody, if the assistant was wrong',
      'Whoever wrote the documents',
    ],
    answer: 0,
  },
]

export function readinessItemsOf(conceptSet: readonly string[]): MockReadinessItem[] {
  return ITEM_SPECS.slice(0, 16).map((spec, index) => ({
    key: `R${index + 1}`,
    category: spec.category,
    conceptKey:
      typeof spec.conceptIndex === 'string'
        ? spec.conceptIndex
        : conceptAt(conceptSet, spec.conceptIndex),
    stem: spec.stem,
    options: spec.options.map((text, at) => ({ key: OPTION_KEYS[at] ?? 'a', text })),
    answerKey: OPTION_KEYS[spec.answer] ?? 'a',
    position: index,
  }))
}

// ---------------------------------------------------------------------------------------------
// The whole package, and the per-step replies
// ---------------------------------------------------------------------------------------------

export type MockPackage = {
  figures: Figures
  company: string
  market: string
  people: { key: string; name: string; roleTitle: string }[]
  brief: string
  reskinLog: ReskinEntry[]
  stakeholders: MockStakeholder[]
  contradictionPair: [string, string]
  contradictionPoint: string
  documents: MockDocument[]
  positions: MockPosition[]
  namedFields: MockNamedField[]
  claims: MockClaim[]
  generalEscalationReply: string
  turn: MockTurn
  probe: MockProbe
  questions: MockQuestion[]
  counterfactual: string
  readinessItems: MockReadinessItem[]
  workingClockSeconds: number
  turnDelaySeconds: number
}

/** The whole package in one object; every step below is a projection of it. */
export function buildMockPackage(
  seedText: string,
  conceptSet: readonly string[] = [],
): MockPackage {
  const figures = figuresFromDraws(seedText.trim() === '' ? DEFAULT_DRAWS : drawsFromSeed(seedText))
  const claims = claimsOf(figures, conceptSet)
  return {
    figures,
    company: COMPANY,
    market: MARKET,
    people: Object.entries(PEOPLE).map(([key, person]) => ({ key, ...person })),
    brief: renderBrief(figures),
    reskinLog: reskinLogOf(seedText, figures),
    stakeholders: stakeholdersOf(figures),
    contradictionPair: [STAKEHOLDER_KEYS.founder, STAKEHOLDER_KEYS.finance],
    contradictionPoint: `Whether the premium payback that the quarter is sized on is the review's ${figures.paybackStaleMonths} months or the corrected ${figures.paybackTrueMonths}.`,
    documents: documentsOf(figures),
    positions: positionsOf(figures),
    namedFields: NAMED_FIELDS,
    claims,
    generalEscalationReply: generalEscalationReplyOf(),
    turn: turnOf(figures),
    probe: probeOf(),
    questions: questionsOf(claims),
    counterfactual: counterfactualOf(),
    readinessItems: readinessItemsOf(conceptSet),
    workingClockSeconds: figures.workingClockSeconds,
    turnDelaySeconds: figures.turnDelaySeconds,
  }
}

/** The package a step should answer from: seeded in step 1, recovered from the brief afterwards. */
function packageFor(input: GenerationMockInput): MockPackage {
  const figures = figuresFor(input)
  const built = buildMockPackage('', input.conceptSet)
  const seeded: MockPackage = {
    ...built,
    figures,
    brief: renderBrief(figures),
    reskinLog: reskinLogOf(input.seedText, figures),
    stakeholders: stakeholdersOf(figures),
    contradictionPoint: `Whether the premium payback that the quarter is sized on is the review's ${figures.paybackStaleMonths} months or the corrected ${figures.paybackTrueMonths}.`,
    documents: documentsOf(figures),
    positions: positionsOf(figures),
    claims: claimsOf(figures, input.conceptSet),
    turn: turnOf(figures),
    workingClockSeconds: figures.workingClockSeconds,
    turnDelaySeconds: figures.turnDelaySeconds,
  }
  return { ...seeded, questions: questionsOf(seeded.claims) }
}

// ---------------------------------------------------------------------------------------------
// The one failure this file can be asked for (10 §5's retry, made testable)
// ---------------------------------------------------------------------------------------------

/** `generation_runs.step` → the prompt that runs it, so the switch below can be named by step. */
const PROMPT_FOR_STEP: Readonly<Record<string, GenerationPrompt>> = {
  reskin_brief_stakeholders: 'gen-reskin-brief-stakeholders',
  documents: 'gen-documents',
  answer_space_fields: 'gen-answer-space-fields',
  claims_and_states: 'gen-claims-states',
  turn_and_probe: 'gen-turn-probe',
  question_bank_and_counterfactual: 'gen-question-bank-counterfactual',
  readiness_items: 'gen-readiness-items',
}

/**
 * `MOCK_GEN_FAIL_ONCE=documents` makes the named step's **first** pass produce a package the step's
 * validation subset refuses, and its retry produce the right one. `MOCK_GEN_FAIL_ONCE=documents:always`
 * makes every pass fail, which is how the second failure — the one that marks the step `failed` and
 * notifies `generation_failed` — is reached.
 *
 * 10 §5's retry is the hardest path in the pipeline to reach honestly. Every rule the seven output
 * schemas *can* enforce is enforced there, which is the point of D-526, so a mock that always
 * answers correctly leaves the re-enqueue, the pass number and the restated-rule channel untested
 * until the day a real model breaks one. The break is chosen to be schema-valid and rule-invalid:
 * the documents come back with no stakeholder attributed to any of them, which the output schema
 * and every `DOCUMENT_*` rule are happy with and `STAKEHOLDER_NO_DOCUMENT` is not.
 *
 * The retry is told apart from the first pass by `restatedRules`, which 10 §5 puts in the second
 * prompt — so a pipeline that re-enqueued the step *without* restating the rule would fail the
 * second time too, and the test that asserts one pass-2 success asserts the channel with it.
 *
 * Read from `process.env` on every call rather than from the parsed `env`, which is frozen at
 * import (D-401), and refused outside development and test, so it can never be a production switch.
 */
type ForcedFailure = { prompt: GenerationPrompt; always: boolean }

function forcedFailures(): ForcedFailure[] {
  const raw = process.env.MOCK_GEN_FAIL_ONCE ?? ''
  if (raw === '') return []
  if (env.APP_ENV === 'production' || env.APP_ENV === 'preview') return []
  const failures: ForcedFailure[] = []
  for (const entry of raw.split(',')) {
    const [name = '', suffix = ''] = entry.trim().split(':')
    const prompt = PROMPT_FOR_STEP[name]
    if (prompt !== undefined) failures.push({ prompt, always: suffix === 'always' })
  }
  return failures
}

const isForcedToFail = (prompt: GenerationPrompt, input: GenerationMockInput): boolean =>
  forcedFailures().some(
    (failure) => failure.prompt === prompt && (failure.always || input.restatedRules.length === 0),
  )

/** The mock's answer to one `gen-*` prompt, as the object the provider serialises to JSON. */
export function generationReply(prompt: GenerationPrompt, rawInput: unknown): unknown {
  const input = readGenerationInput(prompt, rawInput)
  const built = packageFor(input)

  if (prompt === 'gen-documents' && isForcedToFail(prompt, input)) {
    return { documents: built.documents.map((document) => ({ ...document, stakeholderKey: null })) }
  }

  switch (prompt) {
    case 'gen-reskin-brief-stakeholders':
      return {
        company: built.company,
        market: built.market,
        people: built.people,
        reskinLog: built.reskinLog,
        brief: built.brief,
        stakeholders: built.stakeholders,
        contradictionPair: built.contradictionPair,
        contradictionPoint: built.contradictionPoint,
      }
    case 'gen-documents':
      return { documents: built.documents }
    case 'gen-answer-space-fields':
      return { positions: built.positions, namedFields: built.namedFields }
    case 'gen-claims-states':
      return { claims: built.claims, generalEscalationReply: built.generalEscalationReply }
    case 'gen-turn-probe':
      return { turn: built.turn, probe: built.probe }
    case 'gen-question-bank-counterfactual':
      return { questions: built.questions, counterfactual: built.counterfactual }
    case 'gen-readiness-items':
      return { items: built.readinessItems }
  }
}
