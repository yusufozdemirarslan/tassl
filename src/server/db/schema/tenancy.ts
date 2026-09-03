// Tenancy tables from docs/tech/06-data-model.md §3.1 (institution_settings, data_agreements).
// Better Auth owns the identity tables in ./auth.ts; these two hang off `organization`.
import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organization } from './auth'
import { agreementPurpose, planTier } from './enums'

/** Points per confirmed band: four positive numbers keyed by band (06 §3.1, §3.2; PRD §7.19). */
export type BandMapping = {
  novice: number
  developing: number
  proficient: number
  professional: number
}

/** The institution default mapping; courses copy it at creation (06 §3.1 `default_mapping`). */
export const DEFAULT_BAND_MAPPING: BandMapping = {
  novice: 1,
  developing: 2,
  proficient: 3,
  professional: 4,
}

/** DATA-005 — one row per institution; the organization id is the primary key. */
export const institutionSettings = pgTable('institution_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id),
  plan: planTier('plan').notNull().default('pilot'),
  defaultMapping: jsonb('default_mapping')
    .$type<BandMapping>()
    .notNull()
    .default(DEFAULT_BAND_MAPPING),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/** DATA-052 — data-sharing agreements that gate `canReadIdentifiedRecords`. */
export const dataAgreements = pgTable(
  'data_agreements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    /** Institution legal name. */
    counterparty: text('counterparty').notNull(),
    /** Subset of `tassl_scenario_editor` (the platform roles the agreement admits). */
    permittedPlatformRoles: text('permitted_platform_roles').array().notNull(),
    purposes: agreementPurpose('purposes').array().notNull(),
    recordTypesCovered: text('record_types_covered')
      .array()
      .notNull()
      .default(sql`'{run_records,defense_transcripts,debriefs,instructor_decisions}'::text[]`),
    recordTypesExcluded: text('record_types_excluded')
      .array()
      .notNull()
      .default(sql`'{accommodation_information,diagnostic_information,defense_audio}'::text[]`),
    retentionDays: integer('retention_days').notNull(),
    documentReference: text('document_reference').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // `cardinality` rather than `array_length`: array_length('{}', 1) is NULL and a NULL check passes.
    check('data_agreements_purposes_check', sql`cardinality(${t.purposes}) >= 1`),
    check('data_agreements_retention_days_check', sql`${t.retentionDays} > 0`),
    // Active-agreement lookup: `where organization_id = $1 and deleted_at is null and (ends_at is null
    // or ends_at > now())`. now() is STABLE, not IMMUTABLE, so it cannot sit in the index predicate;
    // ends_at rides as the second key instead.
    index('data_agreements_organization_id_ends_at_idx')
      .on(t.organizationId, t.endsAt)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export type InstitutionSettings = typeof institutionSettings.$inferSelect
export type NewInstitutionSettings = typeof institutionSettings.$inferInsert
export type DataAgreement = typeof dataAgreements.$inferSelect
export type NewDataAgreement = typeof dataAgreements.$inferInsert
