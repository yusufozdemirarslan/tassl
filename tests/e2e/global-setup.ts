// Playwright global setup (docs/tech/build-plan/phase-04-courses-and-assignments.md step 4.4;
// 14-testing-strategy.md §2). It runs once, in the runner process, before any worker starts.
//
// Two jobs, both about the database rather than the browser:
//
//   the fixture package — `createAssignment` requires a confirmed package version
//     (`PACKAGE_NOT_CONFIRMED`) and a variant of that version (`VARIANT_MISMATCH`), and the seeded
//     database holds no confirmed version until Phase 5 ships the Meridian Roast package (06 §5
//     item 4). `minimalConfirmedVersion()` writes the smallest one an assignment may point at,
//     under the deterministic ids of ./fixture-package.ts.
//
//   the purge — nothing in the product deletes a course, a section, or an assignment, so the rows
//     the instructor specs create are taken back out here. Running it at the start as well as in
//     the teardown is what makes a repeated run against the same database idempotent: a run that
//     crashed between the two leaves nothing behind for the next one to trip over.
//
// The write goes straight to the database rather than through the app because the screens that
// author a package are Phase 5's; every row is confined to the seeded institution and named with
// SUITE_PREFIX, so the purge can never reach the walkthrough course the other specs read.
import 'dotenv/config'
import { and, eq, inArray, like } from 'drizzle-orm'
import { client, db } from '@/server/db/client'
import {
  assignments,
  courses,
  invitation,
  organization,
  scenarioPackageVersions,
  sectionMemberships,
  sections,
  user,
} from '@/server/db/schema'
import { minimalConfirmedVersion } from '../factories/package'
import {
  FIXTURE_PACKAGE_LABEL,
  FIXTURE_VERSION_ID,
  SUITE_INVITE_PREFIX,
  SUITE_PREFIX,
} from './fixture-package'

/** The seeded institution and the seat that owns its courses (06 §5, `src/server/db/seed.ts`). */
const SEED_ORGANIZATION_SLUG = 'walkthrough'
const SEED_INSTRUCTOR_EMAIL = 'instructor@tassl.local'

/** The seeded institution, or the sentence that says the database was never seeded. */
export async function walkthroughOrganizationId(): Promise<string> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, SEED_ORGANIZATION_SLUG))
  if (!row) {
    throw new Error(
      `No "${SEED_ORGANIZATION_SLUG}" institution in the database. Run \`pnpm db:seed\` first.`,
    )
  }
  return row.id
}

/**
 * Removes every row the instructor specs create: the courses they name with SUITE_PREFIX, the
 * sections, memberships and assignments hanging off them, and the invitations the roster spec
 * sends. Deletion runs child-first because no foreign key in 06 §3.2 cascades.
 */
export async function purgeSuiteData(organizationId: string): Promise<void> {
  const courseRows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.organizationId, organizationId), like(courses.name, `${SUITE_PREFIX}%`)))
  const courseIds = courseRows.map((row) => row.id)

  if (courseIds.length > 0) {
    const sectionRows = await db
      .select({ id: sections.id })
      .from(sections)
      .where(inArray(sections.courseId, courseIds))
    const sectionIds = sectionRows.map((row) => row.id)
    if (sectionIds.length > 0) {
      await db.delete(assignments).where(inArray(assignments.sectionId, sectionIds))
      await db.delete(sectionMemberships).where(inArray(sectionMemberships.sectionId, sectionIds))
      await db.delete(sections).where(inArray(sections.id, sectionIds))
    }
    await db.delete(courses).where(inArray(courses.id, courseIds))
  }

  await db
    .delete(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        like(invitation.email, `${SUITE_INVITE_PREFIX}%`),
      ),
    )
}

/** Writes the confirmed fixture version once; a second run finds it and leaves it alone. */
export async function ensureFixturePackage(organizationId: string): Promise<void> {
  const [existing] = await db
    .select({ id: scenarioPackageVersions.id, status: scenarioPackageVersions.status })
    .from(scenarioPackageVersions)
    .where(eq(scenarioPackageVersions.id, FIXTURE_VERSION_ID))
  if (existing) {
    // A version that exists is already frozen by the `package_frozen` triggers (migration 0004),
    // so a half-written one is a state to report rather than one to repair.
    if (existing.status !== 'confirmed') {
      throw new Error(
        `Fixture package version ${FIXTURE_VERSION_ID} is "${existing.status}", not "confirmed". ` +
          'Delete it and run the suite again.',
      )
    }
    return
  }

  const [instructor] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SEED_INSTRUCTOR_EMAIL))
  if (!instructor) {
    throw new Error(`No ${SEED_INSTRUCTOR_EMAIL} account. Run \`pnpm db:seed\` first.`)
  }

  await minimalConfirmedVersion(organizationId, FIXTURE_PACKAGE_LABEL, {
    createdBy: instructor.id,
  })
}

export default async function globalSetup(): Promise<void> {
  const organizationId = await walkthroughOrganizationId()
  await purgeSuiteData(organizationId)
  await ensureFixturePackage(organizationId)
  // The connection is left open on purpose: the runner process shares this client with
  // ./global-teardown.ts, which closes it once the last worker has finished.
}

export { client }
