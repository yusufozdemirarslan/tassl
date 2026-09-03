// Step 2.5 (DATA-041 to DATA-044): scoring and review tables from docs/tech/06-data-model.md §3.5.
// Bands are drafted per dimension and decided by the instructor; scores hold the four graphs and
// points; neutralizations correct a run claim after the fact; debrief answers close the run.
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import {
  band,
  bandBasis,
  bandDecision,
  dimension,
  draftStatus,
  neutralizationReason,
} from './enums'
import { runs } from './runs'
import { scenarioClaims } from './scenarios'

/** The four graph keys of 10-backend-spec-modules.md §11.1. */
export type RunGraphKey =
  'confidence_line' | 'clock_timeline' | 'stance_matrix' | 'frame_beside_decision'

/** One graph payload; every graph carries `available`, the scoring module owns the full Zod shapes. */
export type RunGraphPayload = { available: boolean } & Record<string, unknown>

/** `run_scores.graphs`: the four payloads keyed by graph key. */
export type RunScoreGraphs = Record<RunGraphKey, RunGraphPayload>

/** `run_bands.quotes` entries: a quote from a model read anchored to the trace event it came from. */
export type RunBandQuote = { event_seq: number; text: string }

export const runBands = pgTable(
  'run_bands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    dimension: dimension('dimension').notNull(),
    draftBand: band('draft_band'),
    draftStatus: draftStatus('draft_status').notNull(),
    // Why the band is unassessed or provisional (graph_unavailable, no_evidence, ...).
    draftReason: text('draft_reason').notNull().default(''),
    basis: bandBasis('basis').notNull(),
    provisional: boolean('provisional').notNull().default(true),
    graphKeys: text('graph_keys')
      .array()
      .$type<RunGraphKey[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    evidenceEventSeqs: integer('evidence_event_seqs')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    quotes: jsonb('quotes')
      .$type<RunBandQuote[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rationale: text('rationale').notNull().default(''),
    decision: bandDecision('decision'),
    decidedBand: band('decided_band'),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    // Set by a neutralization recompute; effective_band = max(before, after) is computed in code.
    bandBeforeCorrection: band('band_before_correction'),
    bandAfterCorrection: band('band_after_correction'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('run_bands_run_id_dimension_uidx').on(table.runId, table.dimension)],
)

export const runScores = pgTable('run_scores', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  rubricVersion: text('rubric_version').notNull(),
  graphs: jsonb('graphs').$type<RunScoreGraphs>().notNull(),
  falseChallengeRate: numeric('false_challenge_rate', { precision: 5, scale: 4 }),
  matchedStanceShare: numeric('matched_stance_share', { precision: 5, scale: 4 }),
  pointsDraft: numeric('points_draft', { precision: 6, scale: 3 }),
  pointsConfirmed: numeric('points_confirmed', { precision: 6, scale: 3 }),
  pointsBeforeCorrection: numeric('points_before_correction', { precision: 6, scale: 3 }),
  pointsAfterCorrection: numeric('points_after_correction', { precision: 6, scale: 3 }),
  pointsEffective: numeric('points_effective', { precision: 6, scale: 3 }),
  flags: text('flags')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const claimNeutralizations = pgTable(
  'claim_neutralizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    reason: neutralizationReason('reason').notNull(),
    creditChallenge: boolean('credit_challenge').notNull().default(false),
    note: text('note').notNull().default(''),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('claim_neutralizations_run_id_idx').on(table.runId)],
)

export const runDebriefAnswers = pgTable('run_debrief_answers', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => runs.id),
  stanceToChange: text('stance_to_change').notNull(),
  doDifferently: text('do_differently').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
})

export type RunBand = typeof runBands.$inferSelect
export type NewRunBand = typeof runBands.$inferInsert
export type RunScore = typeof runScores.$inferSelect
export type NewRunScore = typeof runScores.$inferInsert
export type ClaimNeutralization = typeof claimNeutralizations.$inferSelect
export type NewClaimNeutralization = typeof claimNeutralizations.$inferInsert
export type RunDebriefAnswer = typeof runDebriefAnswers.$inferSelect
export type NewRunDebriefAnswer = typeof runDebriefAnswers.$inferInsert
