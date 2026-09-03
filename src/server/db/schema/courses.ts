// Course tables from docs/tech/06-data-model.md §3.2 (courses, sections, section_memberships,
// assignments, course_mapping_changes). DATA-008 to DATA-011, DATA-055.
import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { organization, user } from './auth'
import { outsideAiPolicy, runType, sectionRole } from './enums'
import { scenarioPackageVersions, scenarioVariants } from './scenarios'
import { DEFAULT_BAND_MAPPING, type BandMapping } from './tenancy'

/** Instructor-set policies (future-state); no shape is fixed yet, so an open object. */
export type PolicyOverrides = Record<string, unknown>

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    /** e.g. `2026-fall`. */
    term: text('term').notNull(),
    outsideAiPolicy: outsideAiPolicy('outside_ai_policy').notNull().default('declared'),
    /**
     * Points per band. The service copies `institution_settings.default_mapping` on create; the
     * column default is the platform default for rows created without it.
     */
    mapping: jsonb('mapping').$type<BandMapping>().notNull().default(DEFAULT_BAND_MAPPING),
    /** Percent of the course grade one run is worth (PRD §7.19 example). */
    defaultRunWeight: numeric('default_run_weight', { precision: 6, scale: 3 })
      .notNull()
      .default('2.5'),
    critiqueWeightFactor: numeric('critique_weight_factor', { precision: 4, scale: 3 })
      .notNull()
      .default('0.5'),
    taughtConcepts: text('taught_concepts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    policyOverrides: jsonb('policy_overrides').$type<PolicyOverrides>().notNull().default({}),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Courses list.
    index('courses_organization_id_idx')
      .on(t.organizationId)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('sections_course_id_idx').on(t.courseId)],
)

export const sectionMemberships = pgTable(
  'section_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: sectionRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('section_memberships_section_id_user_id_uidx').on(t.sectionId, t.userId),
    // My runs, my courses.
    index('section_memberships_user_id_idx').on(t.userId),
    // Roster, reviewer checks.
    index('section_memberships_section_id_role_idx').on(t.sectionId, t.role),
  ],
)

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    label: text('label').notNull(),
    runType: runType('run_type').notNull().default('decision'),
    /** FK added in Step 2.3 once the package tables existed (D-163). */
    packageVersionId: uuid('package_version_id')
      .notNull()
      .references(() => scenarioPackageVersions.id),
    /**
     * FK to `scenario_variants.id` and the `assignments_variant_matches_version` trigger are added
     * by Step 2.3 (D-163).
     */
    variantId: uuid('variant_id')
      .notNull()
      .references(() => scenarioVariants.id),
    /** Null = the package value. */
    workingClockSeconds: integer('working_clock_seconds'),
    /** Null = the course default (`courses.default_run_weight`). */
    weight: numeric('weight', { precision: 6, scale: 3 }),
    isWalkthrough: boolean('is_walkthrough').notNull().default(false),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'assignments_working_clock_seconds_check',
      sql`${t.workingClockSeconds} is null or ${t.workingClockSeconds} > 0`,
    ),
    index('assignments_section_id_idx')
      .on(t.sectionId)
      .where(sql`${t.deletedAt} is null`),
    // Find assignments on a version before retirement.
    index('assignments_package_version_id_idx').on(t.packageVersionId),
  ],
)

/** DATA-055 — append-only log of course mapping changes (no updated_at, no deleted_at). */
export const courseMappingChanges = pgTable(
  'course_mapping_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    oldMapping: jsonb('old_mapping').$type<BandMapping>().notNull(),
    newMapping: jsonb('new_mapping').$type<BandMapping>().notNull(),
    changedBy: text('changed_by')
      .notNull()
      .references(() => user.id),
    affectedRunIds: uuid('affected_run_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('course_mapping_changes_course_id_idx').on(t.courseId)],
)

export const coursesRelations = relations(courses, ({ many }) => ({
  sections: many(sections),
  mappingChanges: many(courseMappingChanges),
}))

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  course: one(courses, { fields: [sections.courseId], references: [courses.id] }),
  memberships: many(sectionMemberships),
  assignments: many(assignments),
}))

export const sectionMembershipsRelations = relations(sectionMemberships, ({ one }) => ({
  section: one(sections, { fields: [sectionMemberships.sectionId], references: [sections.id] }),
  user: one(user, { fields: [sectionMemberships.userId], references: [user.id] }),
}))

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  section: one(sections, { fields: [assignments.sectionId], references: [sections.id] }),
}))

export const courseMappingChangesRelations = relations(courseMappingChanges, ({ one }) => ({
  course: one(courses, { fields: [courseMappingChanges.courseId], references: [courses.id] }),
}))

export type Course = typeof courses.$inferSelect
export type NewCourse = typeof courses.$inferInsert
export type Section = typeof sections.$inferSelect
export type NewSection = typeof sections.$inferInsert
export type SectionMembership = typeof sectionMemberships.$inferSelect
export type NewSectionMembership = typeof sectionMemberships.$inferInsert
export type Assignment = typeof assignments.$inferSelect
export type NewAssignment = typeof assignments.$inferInsert
export type CourseMappingChange = typeof courseMappingChanges.$inferSelect
export type NewCourseMappingChange = typeof courseMappingChanges.$inferInsert
