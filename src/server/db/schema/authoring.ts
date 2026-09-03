// Authoring records from docs/tech/06-data-model.md §3.3 (DATA-026, DATA-027): per-element
// confirmation decisions and generation job runs. Both are written after a version is confirmed as
// well as before, so neither carries the `package_element_frozen` trigger.
import { relations, sql } from 'drizzle-orm'
import {
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
import { confirmationDecision, elementType, generationStep, jobStatus } from './enums'
import { scenarioPackageVersions } from './scenarios'

/** `element_confirmations.edits`: field → before/after. */
export type ElementEdits = Record<string, { before: unknown; after: unknown }>

/** Stand-in for `element_id` on singleton elements so the unique index can include it. */
export const SINGLETON_ELEMENT_KEY = '00000000-0000-0000-0000-000000000000'

export const elementConfirmations = pgTable(
  'element_confirmations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    elementType: elementType('element_type').notNull(),
    /** Null for singleton elements (brief, counterfactual, clock_and_difficulty …). */
    elementId: uuid('element_id'),
    /** Generated: `coalesce(element_id, SINGLETON_ELEMENT_KEY)`; the unique index uses it. */
    elementKey: uuid('element_key')
      .notNull()
      .generatedAlwaysAs(sql`coalesce("element_id", '00000000-0000-0000-0000-000000000000'::uuid)`),
    revision: integer('revision').notNull().default(1),
    decision: confirmationDecision('decision').notNull(),
    edits: jsonb('edits').$type<ElementEdits>().notNull().default({}),
    note: text('note').notNull().default(''),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('element_confirmations_version_type_key_revision_uidx').on(
      t.packageVersionId,
      t.elementType,
      t.elementKey,
      t.revision,
    ),
    // Measures (edit and rejection rates).
    index('element_confirmations_package_version_id_decision_idx').on(
      t.packageVersionId,
      t.decision,
    ),
  ],
)

export const generationRuns = pgTable(
  'generation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    step: generationStep('step').notNull(),
    passNumber: integer('pass_number').notNull().default(1),
    status: jobStatus('status').notNull().default('queued'),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 6 }),
    failedRules: text('failed_rules')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('generation_runs_version_step_pass_idx').on(t.packageVersionId, t.step, t.passNumber),
  ],
)

export const elementConfirmationsRelations = relations(elementConfirmations, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [elementConfirmations.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
  decidedByUser: one(user, { fields: [elementConfirmations.decidedBy], references: [user.id] }),
}))

export const generationRunsRelations = relations(generationRuns, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [generationRuns.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
}))

export type ElementConfirmation = typeof elementConfirmations.$inferSelect
export type NewElementConfirmation = typeof elementConfirmations.$inferInsert
export type GenerationRun = typeof generationRuns.$inferSelect
export type NewGenerationRun = typeof generationRuns.$inferInsert
