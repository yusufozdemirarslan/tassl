// Step 2.5 (DATA-047 to DATA-050): platform tables from docs/tech/06-data-model.md §3.6.
// audit_logs and llm_calls are append-only logs that outlive their subjects, so their subject ids
// (organization, actor, run, package version) are plain columns without foreign keys.
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { llmFeature, llmOutcome, notificationType } from './enums'

/** `notifications.payload`: type-specific extras (run id, package id, ...); shaped by the notifications module. */
export type NotificationPayload = Record<string, unknown>

/** The audited actions (06 §3.6 DATA-048); services add to this union when they audit a new action. */
export type AuditAction =
  | 'role.set'
  | 'band.decide'
  | 'run.void'
  | 'run.reoffer'
  | 'claim.neutralize'
  | 'export.write'
  | 'account.delete'
  | 'agreement.upsert'
  | 'package.confirm'
  | 'package.regenerate'
  | 'mapping.change'
  | 'test_control.force_failure'
  | 'invitation.create'
  | 'section_member.add'
  | 'run.delete'

/** `audit_logs.metadata`: action-specific details, never secrets or run free text. */
export type AuditLogMetadata = Record<string, unknown>

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    organizationId: text('organization_id'),
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    payload: jsonb('payload')
      .$type<NotificationPayload>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notifications_user_id_read_at_idx').on(table.userId, table.readAt)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id'),
    actorId: text('actor_id'),
    action: text('action').$type<AuditAction>().notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata')
      .$type<AuditLogMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_organization_id_created_at_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    index('audit_logs_actor_id_created_at_idx').on(table.actorId, table.createdAt.desc()),
  ],
)

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    feature: llmFeature('feature').notNull(),
    promptName: text('prompt_name').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 6 })
      .notNull()
      .default('0'),
    outcome: llmOutcome('outcome').notNull(),
    userId: text('user_id'),
    runId: uuid('run_id'),
    packageVersionId: uuid('package_version_id'),
    // Null for calls made by jobs outside a request.
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Daily per-user budget.
    index('llm_calls_user_id_created_at_idx').on(table.userId, table.createdAt),
    // Monthly budget and dashboards.
    index('llm_calls_created_at_idx').on(table.createdAt),
  ],
)

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: 'rate_limit_buckets_key_window_start_pk',
      columns: [table.key, table.windowStart],
    }),
  ],
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type LlmCall = typeof llmCalls.$inferSelect
export type NewLlmCall = typeof llmCalls.$inferInsert
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert
