// Read-only lookups behind the session and permission helpers (docs/tech/08-auth-authz.md §2.6, §5).
//
// Why this file exists: `permissions.ts` and `session.ts` are server-lib files, and the ESLint
// boundaries policy (docs/tech/04-repo-structure.md §2, eslint.config.mjs) lets server-lib reach
// `src/server/db` but not a module's `repository.ts` — a module is importable only through its
// `index.ts`, and importing a module here would make every module depend on the auth layer that
// guards it. So the few statements the guards need live next to them, the way
// `src/server/http/readiness.ts` reaches the database directly. Query bodies only: nothing here
// throws or decides; `permissions.ts` says what an answer means.
//
// These are the one place the `tenantId`-first repository rule (D-006) cannot apply: a guard's job
// is to resolve an id *to* its organization before any tenant is known. Nothing here is reachable
// from a route or service — only from `permissions.ts`, which turns every answer into an
// organization-scoped decision — so no query widens what a caller can read.
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import {
  assignments,
  courses,
  dataAgreements,
  member,
  runs,
  scenarioPackages,
  sectionMemberships,
  sections,
  user,
  type DataAgreement,
} from '@/server/db/schema'

/** The columns of `user` that decide whether a session is live and what it may do (08 §2.6, §3). */
export type ActorRow = { id: string; platformRole: string; deletedAt: Date | null }

/** The run fields the run guards check, with the section the run's assignment belongs to. */
export type RunContext = {
  runId: string
  organizationId: string
  studentId: string
  sectionId: string
}

export type SectionMembershipRow = { role: string; organizationId: string }

export type CourseRow = { organizationId: string; createdBy: string }

export type PackageRow = { id: string; organizationId: string }

export async function findActorRow(userId: string): Promise<ActorRow | null> {
  const rows = await db
    .select({ id: user.id, platformRole: user.platform_role, deletedAt: user.deleted_at })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return rows[0] ?? null
}

/** The organization role of the user's `member` row, or null when there is none (08 §3). */
export async function findOrganizationRole(userId: string, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1)
  return rows[0]?.role ?? null
}

/** The user's `section_memberships` row for a live section, with the section's organization. */
export async function findSectionMembership(
  userId: string,
  sectionId: string,
): Promise<SectionMembershipRow | null> {
  const rows = await db
    .select({ role: sectionMemberships.role, organizationId: sections.organizationId })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .where(
      and(
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.sectionId, sectionId),
        isNull(sections.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/** The live course's organization and creator; null when the id is unknown or soft-deleted. */
export async function findCourse(courseId: string): Promise<CourseRow | null> {
  const rows = await db
    .select({ organizationId: courses.organizationId, createdBy: courses.createdBy })
    .from(courses)
    .where(and(eq(courses.id, courseId), isNull(courses.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

/** True when the user holds an `instructor` section membership in one of the course's sections. */
export async function teachesCourse(userId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sectionMemberships.id })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .where(
      and(
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.role, 'instructor'),
        eq(sections.courseId, courseId),
        isNull(sections.deletedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/**
 * The organization's most recently signed agreement that is neither deleted nor ended (D-055).
 * Mirrors `tenancy.findActiveAgreement`, which this layer may not import (see the file header).
 */
export async function findActiveAgreement(orgId: string): Promise<DataAgreement | null> {
  const rows = await db
    .select()
    .from(dataAgreements)
    .where(
      and(
        eq(dataAgreements.organizationId, orgId),
        isNull(dataAgreements.deletedAt),
        or(isNull(dataAgreements.endsAt), gt(dataAgreements.endsAt, sql`now()`)),
      ),
    )
    .orderBy(desc(dataAgreements.signedAt), desc(dataAgreements.createdAt), desc(dataAgreements.id))
    .limit(1)
  return rows[0] ?? null
}

/** The run with the section its assignment belongs to; null when no such run exists. */
export async function findRunContext(runId: string): Promise<RunContext | null> {
  const rows = await db
    .select({
      runId: runs.id,
      organizationId: runs.organizationId,
      studentId: runs.studentId,
      sectionId: sections.id,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .where(eq(runs.id, runId))
    .limit(1)
  return rows[0] ?? null
}

/** The package's organization; null when the id is unknown or the package is soft-deleted. */
export async function findPackage(packageId: string): Promise<PackageRow | null> {
  const rows = await db
    .select({ id: scenarioPackages.id, organizationId: scenarioPackages.organizationId })
    .from(scenarioPackages)
    .where(and(eq(scenarioPackages.id, packageId), isNull(scenarioPackages.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}
