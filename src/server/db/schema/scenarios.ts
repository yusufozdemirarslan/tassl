// Scenario package tables from docs/tech/06-data-model.md §3.3 (DATA-012 to DATA-025): packages,
// versions, and every authored element that hangs off a version. Confirmed versions are frozen by
// the `package_version_frozen` / `package_element_frozen` trigger family (drizzle migration
// `package_frozen`, NFR-004); element_confirmations and generation_runs live in ./authoring.ts.
import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'
import {
  calibrationStatus,
  claimImportance,
  claimSource,
  consequenceLevel,
  documentRole,
  evidenceStatus,
  failureFamily,
  packageStatus,
  positionKind,
  questionKind,
  readinessCategory,
  stance,
  turnResponse,
  turnVoice,
  valueUnit,
  variantKey,
  verificationCost,
} from './enums'

// ---------------------------------------------------------------------------------------------
// jsonb shapes (keys are snake_case like the trace payloads they end up in)
// ---------------------------------------------------------------------------------------------

export type ValueUnit = (typeof valueUnit.enumValues)[number]

/** `scenario_package_versions.difficulty_profile`; `uncalibrated` stays true until calibration. */
export type DifficultyProfile = { estimate: string; note: string; uncalibrated: boolean }

/** `scenario_package_versions.snapshot` — the export format, written at confirmation. */
export type PackageSnapshot = Record<string, unknown>

/** One entry of `seed_records.reskin_log`. */
export type ReskinLogEntry = {
  kind: 'renamed_entity' | 'altered_number' | 'restructured_document'
  from: string
  to: string
  note: string
}

/** One entry of `scenario_claims.carried_values` (D-076 matching). */
export type CarriedValue = { field_key?: string; value: number; unit: ValueUnit }

/** `variant_claim_states.verification_paths`. */
export type VerificationPaths = {
  source_trace?: { document_id: string; passage: string; dated_on: string; author: string }
  replication_check?: { result: string }
  decomposition_check?: { steps: Array<{ label: string; result: string }> }
}

/** `defense_questions.condition`; the selector (10-backend-spec-modules.md §9) narrows it by kind. */
export type DefenseQuestionCondition = Record<string, unknown>

/** One of the four `readiness_items.options`. */
export type ReadinessOption = { key: string; text: string }

const DEFAULT_DIFFICULTY_PROFILE: DifficultyProfile = {
  estimate: 'unknown',
  note: '',
  uncalibrated: true,
}

// ---------------------------------------------------------------------------------------------
// Packages and versions (tenant-scoped)
// ---------------------------------------------------------------------------------------------

export const scenarioPackages = pgTable(
  'scenario_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    title: text('title').notNull(),
    discipline: text('discipline').notNull().default('marketing_strategy'),
    /** Stable key of the package family across versions; unique per organization. */
    familyKey: text('family_key').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('scenario_packages_organization_id_family_key_uidx').on(
      t.organizationId,
      t.familyKey,
    ),
  ],
)

export const scenarioPackageVersions = pgTable(
  'scenario_package_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    packageId: uuid('package_id')
      .notNull()
      .references(() => scenarioPackages.id),
    version: integer('version').notNull(),
    status: packageStatus('status').notNull().default('draft'),
    calibrationStatus: calibrationStatus('calibration_status').notNull().default('uncalibrated'),
    conceptSet: text('concept_set').array().notNull(),
    /** ≤ 200 words at confirmation (validatePackage). */
    brief: text('brief').notNull().default(''),
    workingClockSeconds: integer('working_clock_seconds').notNull().default(1500),
    turnDelaySeconds: integer('turn_delay_seconds').notNull().default(90),
    difficultyProfile: jsonb('difficulty_profile')
      .$type<DifficultyProfile>()
      .notNull()
      .default(DEFAULT_DIFFICULTY_PROFILE),
    generalEscalationReply: text('general_escalation_reply').notNull().default(''),
    /** Exactly three sentences at confirmation (validatePackage). */
    debriefCounterfactual: text('debrief_counterfactual').notNull().default(''),
    generationModel: text('generation_model'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    /** Once set, the row and every element under it are frozen (trigger family). */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: text('confirmed_by').references(() => user.id),
    teachingNoteChecked: boolean('teaching_note_checked').notNull().default(false),
    reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
    reviewReason: text('review_reason'),
    /** Written at confirmation; the export format. */
    snapshot: jsonb('snapshot').$type<PackageSnapshot>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('scenario_package_versions_version_check', sql`${t.version} > 0`),
    check(
      'scenario_package_versions_concept_set_check',
      sql`array_length(${t.conceptSet}, 1) >= 4`,
    ),
    check(
      'scenario_package_versions_turn_delay_seconds_check',
      sql`${t.turnDelaySeconds} between 60 and 120`,
    ),
    uniqueIndex('scenario_package_versions_package_id_version_uidx').on(t.packageId, t.version),
    index('scenario_package_versions_package_id_status_idx').on(t.packageId, t.status),
  ],
)

// ---------------------------------------------------------------------------------------------
// Elements (frozen with their version; never returned to students before scoring where noted)
// ---------------------------------------------------------------------------------------------

/** DATA-014 — the licensed seed case and its reskin log. Never returned by student routes. */
export const seedRecords = pgTable(
  'seed_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    caseTitle: text('case_title').notNull(),
    publisher: text('publisher').notNull(),
    licenseTerms: text('license_terms').notNull(),
    licensePermitsAdaptation: boolean('license_permits_adaptation').notNull(),
    /** Hard cap protects the database (06 §1); everything else is limited in Zod. */
    seedText: text('seed_text').notNull(),
    reskinLog: jsonb('reskin_log').$type<ReskinLogEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('seed_records_seed_text_length_check', sql`length(${t.seedText}) <= 200000`),
    uniqueIndex('seed_records_package_version_id_uidx').on(t.packageVersionId),
  ],
)

/** DATA-016 — stakeholders the student can interview. */
export const stakeholders = pgTable(
  'stakeholders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    roleTitle: text('role_title').notNull(),
    positionStatement: text('position_statement').notNull(),
    incentives: text('incentives').notNull(),
    blindSpots: text('blind_spots').notNull(),
    /** Another stakeholder of the same version (plain uuid per 06; generation writes in any order). */
    contradictsStakeholderId: uuid('contradicts_stakeholder_id'),
    contradictionPoint: text('contradiction_point'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('stakeholders_package_version_id_key_uidx').on(t.packageVersionId, t.key)],
)

/** DATA-015 — the document set (`D1`…). */
export const scenarioDocuments = pgTable(
  'scenario_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    /** Attribution. */
    author: text('author').notNull(),
    datedOn: date('dated_on').notNull(),
    body: text('body').notNull(),
    /** ≤ 2000 at confirmation (D-081, `DOCUMENT_TOO_LONG`). */
    wordCount: integer('word_count').notNull(),
    role: documentRole('role').notNull(),
    /** Required when role = superseded (check). */
    supersededByDocumentId: uuid('superseded_by_document_id').references(
      (): AnyPgColumn => scenarioDocuments.id,
    ),
    stakeholderId: uuid('stakeholder_id').references(() => stakeholders.id),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'scenario_documents_superseded_by_check',
      sql`${t.role} <> 'superseded' or ${t.supersededByDocumentId} is not null`,
    ),
    uniqueIndex('scenario_documents_package_version_id_key_uidx').on(t.packageVersionId, t.key),
    index('scenario_documents_package_version_id_position_idx').on(t.packageVersionId, t.position),
  ],
)

/** DATA-017 — the answer space: defensible and evidence-inconsistent positions. */
export const answerSpacePositions = pgTable(
  'answer_space_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    kind: positionKind('kind').notNull(),
    summary: text('summary').notNull(),
    supportingDocumentIds: uuid('supporting_document_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Required for evidence_inconsistent positions (validatePackage). */
    ignoredEvidence: text('ignored_evidence'),
    isMinimumCommitment: boolean('is_minimum_commitment').notNull().default(false),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('answer_space_positions_package_version_id_key_uidx').on(t.packageVersionId, t.key),
  ],
)

/** DATA-018 — the named fields a brief carries (snake_case keys). */
export const namedFields = pgTable(
  'named_fields',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    unit: valueUnit('unit').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('named_fields_package_version_id_key_uidx').on(t.packageVersionId, t.key)],
)

/** DATA-019 — claims as the assistant states them; ids are stable across the version (run_claims). */
export const scenarioClaims = pgTable(
  'scenario_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    text: text('text').notNull(),
    sourceKind: claimSource('source_kind').notNull(),
    /** Required when a Source Trace path exists (validatePackage). */
    sourceDocumentId: uuid('source_document_id').references(() => scenarioDocuments.id),
    sourcePassage: text('source_passage').notNull().default(''),
    importance: claimImportance('importance').notNull(),
    consequenceLevel: consequenceLevel('consequence_level').notNull(),
    verificationCost: verificationCost('verification_cost').notNull(),
    weaklySourced: boolean('weakly_sourced').notNull().default(false),
    volatile: boolean('volatile').notNull().default(false),
    /** Must be in the version's concept_set (validatePackage at confirmation). */
    conceptKey: text('concept_key').notNull(),
    carriedValues: jsonb('carried_values').$type<CarriedValue[]>().notNull().default([]),
    triggerPhrases: text('trigger_phrases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** For the trigger classifier (AI-004). */
    triggerDescription: text('trigger_description').notNull().default(''),
    escalatable: boolean('escalatable').notNull().default(false),
    /** Required when escalatable (validatePackage). */
    escalationReply: text('escalation_reply'),
    /** "What it deserved and why" (FR-151). */
    rationale: text('rationale').notNull().default(''),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('scenario_claims_package_version_id_key_uidx').on(t.packageVersionId, t.key),
    index('scenario_claims_package_version_id_position_idx').on(t.packageVersionId, t.position),
  ],
)

/** DATA-020 — the defective and sound variants of a version. */
export const scenarioVariants = pgTable(
  'scenario_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: variantKey('key').notNull(),
    label: text('label').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('scenario_variants_package_version_id_key_uidx').on(t.packageVersionId, t.key),
  ],
)

/**
 * DATA-021 — per-variant evidence status of each claim. Frozen through `scenario_variants`
 * (trigger `variant_claim_state_frozen`). Never shown to students before their run is scored.
 */
export const variantClaimStates = pgTable(
  'variant_claim_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => scenarioVariants.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    evidenceStatus: evidenceStatus('evidence_status').notNull(),
    /** Required when defective (check). */
    failureFamily: failureFamily('failure_family'),
    warrantedStance: stance('warranted_stance').notNull(),
    verificationPaths: jsonb('verification_paths').$type<VerificationPaths>().notNull().default({}),
    /** The consequential defect (exactly one per defective variant, validatePackage). */
    planted: boolean('planted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'variant_claim_states_failure_family_check',
      sql`${t.evidenceStatus} <> 'defective' or ${t.failureFamily} is not null`,
    ),
    uniqueIndex('variant_claim_states_variant_id_claim_id_uidx').on(t.variantId, t.claimId),
  ],
)

/** DATA-022 — the scripted reversal probe (one per version). */
export const sycophancyProbes = pgTable(
  'sycophancy_probes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => scenarioClaims.id),
    originalPosition: text('original_position').notNull(),
    scriptedReversal: text('scripted_reversal').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('sycophancy_probes_package_version_id_uidx').on(t.packageVersionId)],
)

/** DATA-023 — the Turn (one per version). */
export const scenarioTurns = pgTable(
  'scenario_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    text: text('text').notNull(),
    voice: turnVoice('voice').notNull(),
    stakeholderId: uuid('stakeholder_id').references(() => stakeholders.id),
    warrantsChange: boolean('warrants_change').notNull(),
    proportionateResponse: turnResponse('proportionate_response').notNull(),
    evidence: text('evidence').notNull(),
    disruptedAssumptionKeys: text('disrupted_assumption_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    windowClaimIds: uuid('window_claim_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('scenario_turns_package_version_id_uidx').on(t.packageVersionId)],
)

/** DATA-024 — the defense question bank. Never shown to students. */
export const defenseQuestions = pgTable(
  'defense_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    kind: questionKind('kind').notNull(),
    claimId: uuid('claim_id').references(() => scenarioClaims.id),
    /** Frame assumption index 0–2 (check). */
    assumptionIndex: integer('assumption_index'),
    /** Placeholders `{claim_text}`, `{figure}`, `{stance}`, `{document_title}`, `{assumption}`. */
    template: text('template').notNull(),
    condition: jsonb('condition').$type<DefenseQuestionCondition>().notNull(),
    followUp: text('follow_up').notNull(),
    expectedAnswerNotes: text('expected_answer_notes').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'defense_questions_assumption_index_check',
      sql`${t.assumptionIndex} is null or ${t.assumptionIndex} between 0 and 2`,
    ),
    uniqueIndex('defense_questions_package_version_id_key_uidx').on(t.packageVersionId, t.key),
    index('defense_questions_package_version_id_kind_idx').on(t.packageVersionId, t.kind),
  ],
)

/** DATA-025 — readiness check items (6 foundation / 4 defect_concept / 6 ai_behavior at confirmation). */
export const readinessItems = pgTable(
  'readiness_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    key: text('key').notNull(),
    category: readinessCategory('category').notNull(),
    conceptKey: text('concept_key').notNull(),
    stem: text('stem').notNull(),
    /** Four options `[{key:'a', text}]`. */
    options: jsonb('options').$type<ReadinessOption[]>().notNull(),
    answerKey: text('answer_key').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('readiness_items_package_version_id_key_uidx').on(t.packageVersionId, t.key)],
)

// ---------------------------------------------------------------------------------------------
// Relations (the package view loads a version with every element)
// ---------------------------------------------------------------------------------------------

export const scenarioPackagesRelations = relations(scenarioPackages, ({ many }) => ({
  versions: many(scenarioPackageVersions),
}))

export const scenarioPackageVersionsRelations = relations(
  scenarioPackageVersions,
  ({ one, many }) => ({
    package: one(scenarioPackages, {
      fields: [scenarioPackageVersions.packageId],
      references: [scenarioPackages.id],
    }),
    seedRecord: one(seedRecords, {
      fields: [scenarioPackageVersions.id],
      references: [seedRecords.packageVersionId],
    }),
    documents: many(scenarioDocuments),
    stakeholders: many(stakeholders),
    answerSpacePositions: many(answerSpacePositions),
    namedFields: many(namedFields),
    claims: many(scenarioClaims),
    variants: many(scenarioVariants),
    probe: one(sycophancyProbes, {
      fields: [scenarioPackageVersions.id],
      references: [sycophancyProbes.packageVersionId],
    }),
    turn: one(scenarioTurns, {
      fields: [scenarioPackageVersions.id],
      references: [scenarioTurns.packageVersionId],
    }),
    defenseQuestions: many(defenseQuestions),
    readinessItems: many(readinessItems),
  }),
)

export const scenarioDocumentsRelations = relations(scenarioDocuments, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [scenarioDocuments.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
  stakeholder: one(stakeholders, {
    fields: [scenarioDocuments.stakeholderId],
    references: [stakeholders.id],
  }),
}))

export const stakeholdersRelations = relations(stakeholders, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [stakeholders.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
}))

export const answerSpacePositionsRelations = relations(answerSpacePositions, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [answerSpacePositions.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
}))

export const namedFieldsRelations = relations(namedFields, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [namedFields.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
}))

export const scenarioClaimsRelations = relations(scenarioClaims, ({ one, many }) => ({
  version: one(scenarioPackageVersions, {
    fields: [scenarioClaims.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
  sourceDocument: one(scenarioDocuments, {
    fields: [scenarioClaims.sourceDocumentId],
    references: [scenarioDocuments.id],
  }),
  variantStates: many(variantClaimStates),
}))

export const scenarioVariantsRelations = relations(scenarioVariants, ({ one, many }) => ({
  version: one(scenarioPackageVersions, {
    fields: [scenarioVariants.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
  claimStates: many(variantClaimStates),
}))

export const variantClaimStatesRelations = relations(variantClaimStates, ({ one }) => ({
  variant: one(scenarioVariants, {
    fields: [variantClaimStates.variantId],
    references: [scenarioVariants.id],
  }),
  claim: one(scenarioClaims, {
    fields: [variantClaimStates.claimId],
    references: [scenarioClaims.id],
  }),
}))

export const defenseQuestionsRelations = relations(defenseQuestions, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [defenseQuestions.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
  claim: one(scenarioClaims, {
    fields: [defenseQuestions.claimId],
    references: [scenarioClaims.id],
  }),
}))

export const readinessItemsRelations = relations(readinessItems, ({ one }) => ({
  version: one(scenarioPackageVersions, {
    fields: [readinessItems.packageVersionId],
    references: [scenarioPackageVersions.id],
  }),
}))

// ---------------------------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------------------------

export type ScenarioPackage = typeof scenarioPackages.$inferSelect
export type NewScenarioPackage = typeof scenarioPackages.$inferInsert
export type ScenarioPackageVersion = typeof scenarioPackageVersions.$inferSelect
export type NewScenarioPackageVersion = typeof scenarioPackageVersions.$inferInsert
export type SeedRecord = typeof seedRecords.$inferSelect
export type NewSeedRecord = typeof seedRecords.$inferInsert
export type ScenarioDocument = typeof scenarioDocuments.$inferSelect
export type NewScenarioDocument = typeof scenarioDocuments.$inferInsert
export type Stakeholder = typeof stakeholders.$inferSelect
export type NewStakeholder = typeof stakeholders.$inferInsert
export type AnswerSpacePosition = typeof answerSpacePositions.$inferSelect
export type NewAnswerSpacePosition = typeof answerSpacePositions.$inferInsert
export type NamedField = typeof namedFields.$inferSelect
export type NewNamedField = typeof namedFields.$inferInsert
export type ScenarioClaim = typeof scenarioClaims.$inferSelect
export type NewScenarioClaim = typeof scenarioClaims.$inferInsert
export type ScenarioVariant = typeof scenarioVariants.$inferSelect
export type NewScenarioVariant = typeof scenarioVariants.$inferInsert
export type VariantClaimState = typeof variantClaimStates.$inferSelect
export type NewVariantClaimState = typeof variantClaimStates.$inferInsert
export type SycophancyProbe = typeof sycophancyProbes.$inferSelect
export type NewSycophancyProbe = typeof sycophancyProbes.$inferInsert
export type ScenarioTurn = typeof scenarioTurns.$inferSelect
export type NewScenarioTurn = typeof scenarioTurns.$inferInsert
export type DefenseQuestion = typeof defenseQuestions.$inferSelect
export type NewDefenseQuestion = typeof defenseQuestions.$inferInsert
export type ReadinessItem = typeof readinessItems.$inferSelect
export type NewReadinessItem = typeof readinessItems.$inferInsert
