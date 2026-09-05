// Playwright global setup (docs/tech/build-plan/phase-04-courses-and-assignments.md step 4.4;
// 14-testing-strategy.md §2). It runs once, in the runner process, before any worker starts.
//
// Two jobs, both about the database rather than the browser:
//
//   the fixture package — `createAssignment` requires a confirmed package version
//     (`PACKAGE_NOT_CONFIRMED`) and a variant of that version (`VARIANT_MISMATCH`). Since Phase 5
//     the seed supplies one: it imports the Meridian Roast package and confirms it (06 §5 item 4),
//     so the suite reads the ids of that version instead of writing a stand-in of its own. They are
//     database-generated, so they are looked up here and left in a file for the workers.
//
//   the purge — nothing in the product deletes a course, a section, or an assignment, so the rows
//     the instructor specs create are taken back out here. Running it at the start as well as in
//     the teardown is what makes a repeated run against the same database idempotent: a run that
//     crashed between the two leaves nothing behind for the next one to trip over.
//
// The purge goes straight to the database because nothing in the product deletes these rows; every
// row it touches is confined to the seeded institution and named with SUITE_PREFIX, so it can never
// reach the walkthrough course and assignments the other specs read.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { and, asc, eq, inArray, like } from 'drizzle-orm'
import { client, db } from '@/server/db/client'
import {
  assignments,
  courses,
  invitation,
  organization,
  answerSpacePositions,
  defenseQuestions,
  elementConfirmations,
  namedFields,
  readinessItems,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackages,
  scenarioPackageVersions,
  scenarioTurns,
  scenarioVariants,
  sectionMemberships,
  seedRecords,
  stakeholders,
  sycophancyProbes,
  variantClaimStates,
  sections,
} from '@/server/db/schema'
import {
  FIXTURE_FILE,
  SUITE_INVITE_PREFIX,
  SUITE_PREFIX,
  type SeededPackage,
} from './fixture-package'

/** The seeded institution (06 §5, `src/server/db/seed.ts`). */
const SEED_ORGANIZATION_SLUG = 'walkthrough'

/** The family key `src/server/db/seed.ts` imports the fixture under (06 §5 item 4). */
const SEED_PACKAGE_FAMILY_KEY = 'meridian-roast'

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

  await purgeSuitePackages(organizationId)
}

/**
 * The packages the author specs create. Nothing in the product deletes a package, so they are taken
 * out here by title, and only ever under SUITE_PREFIX — the seeded Meridian Roast package carries
 * no prefix, so it cannot be reached from here.
 *
 * A version's elements have no cascade, so they go first, then the versions, then the family. The
 * confirmed ones are frozen by the triggers of migration 0004, which refuse an UPDATE and not a
 * DELETE, so a confirmed version can be removed but never edited.
 */
async function purgeSuitePackages(organizationId: string): Promise<void> {
  const packageRows = await db
    .select({ id: scenarioPackages.id })
    .from(scenarioPackages)
    .where(
      and(
        eq(scenarioPackages.organizationId, organizationId),
        like(scenarioPackages.title, `${SUITE_PREFIX}%`),
      ),
    )
  const packageIds = packageRows.map((row) => row.id)
  if (packageIds.length === 0) return

  const versionRows = await db
    .select({ id: scenarioPackageVersions.id })
    .from(scenarioPackageVersions)
    .where(inArray(scenarioPackageVersions.packageId, packageIds))
  const versionIds = versionRows.map((row) => row.id)

  if (versionIds.length > 0) {
    // Element rows in reference order: what points at something else goes before what it points at.
    const variantRows = await db
      .select({ id: scenarioVariants.id })
      .from(scenarioVariants)
      .where(inArray(scenarioVariants.packageVersionId, versionIds))
    const variantIds = variantRows.map((row) => row.id)
    if (variantIds.length > 0) {
      await db.delete(variantClaimStates).where(inArray(variantClaimStates.variantId, variantIds))
    }
    await db
      .delete(elementConfirmations)
      .where(inArray(elementConfirmations.packageVersionId, versionIds))
    await db.delete(sycophancyProbes).where(inArray(sycophancyProbes.packageVersionId, versionIds))
    await db.delete(scenarioTurns).where(inArray(scenarioTurns.packageVersionId, versionIds))
    await db.delete(defenseQuestions).where(inArray(defenseQuestions.packageVersionId, versionIds))
    await db.delete(readinessItems).where(inArray(readinessItems.packageVersionId, versionIds))
    await db.delete(scenarioClaims).where(inArray(scenarioClaims.packageVersionId, versionIds))
    await db.delete(scenarioVariants).where(inArray(scenarioVariants.packageVersionId, versionIds))
    await db.delete(namedFields).where(inArray(namedFields.packageVersionId, versionIds))
    await db
      .delete(answerSpacePositions)
      .where(inArray(answerSpacePositions.packageVersionId, versionIds))
    // A superseded document names its successor, so the reference is cleared before the rows go —
    // and the role with it, because `scenario_documents_superseded_by_check` refuses a row that is
    // still superseded with no successor. Clearing only the pointer aborted the whole purge, and
    // with it the setup and teardown of every spec (found by the Step 5.4 critique).
    await db
      .update(scenarioDocuments)
      .set({ role: 'supporting', supersededByDocumentId: null, stakeholderId: null })
      .where(inArray(scenarioDocuments.packageVersionId, versionIds))
    await db
      .delete(scenarioDocuments)
      .where(inArray(scenarioDocuments.packageVersionId, versionIds))
    await db.delete(stakeholders).where(inArray(stakeholders.packageVersionId, versionIds))
    await db.delete(seedRecords).where(inArray(seedRecords.packageVersionId, versionIds))
    await db.delete(scenarioPackageVersions).where(inArray(scenarioPackageVersions.id, versionIds))
  }
  await db.delete(scenarioPackages).where(inArray(scenarioPackages.id, packageIds))
}

/** Writes the confirmed fixture version once; a second run finds it and leaves it alone. */
/**
 * The seeded Meridian Roast version, written where every worker can read it (./fixture-package.ts).
 *
 * A missing or unconfirmed version is a state to report, not one to repair: the seed is what makes
 * it, and a suite that quietly built its own would be testing something the walkthrough is not.
 */
export async function ensureFixturePackage(organizationId: string): Promise<SeededPackage> {
  const [version] = await db
    .select({
      packageId: scenarioPackageVersions.packageId,
      versionId: scenarioPackageVersions.id,
      versionNumber: scenarioPackageVersions.version,
      status: scenarioPackageVersions.status,
      title: scenarioPackages.title,
      workingClockSeconds: scenarioPackageVersions.workingClockSeconds,
    })
    .from(scenarioPackageVersions)
    .innerJoin(scenarioPackages, eq(scenarioPackages.id, scenarioPackageVersions.packageId))
    .where(
      and(
        eq(scenarioPackages.organizationId, organizationId),
        eq(scenarioPackages.familyKey, SEED_PACKAGE_FAMILY_KEY),
      ),
    )
    .orderBy(asc(scenarioPackageVersions.version))
  if (!version) {
    throw new Error(
      `No seeded package "${SEED_PACKAGE_FAMILY_KEY}" in the walkthrough institution. ` +
        'Run pnpm db:seed (or pnpm db:reset -- --dev) and try again.',
    )
  }
  if (version.status !== 'confirmed') {
    throw new Error(
      `The seeded package version is "${version.status}", not "confirmed". Re-seed the database.`,
    )
  }

  const variants = await db
    .select({ id: scenarioVariants.id, key: scenarioVariants.key })
    .from(scenarioVariants)
    .where(eq(scenarioVariants.packageVersionId, version.versionId))
  const byKey = new Map(variants.map((row) => [row.key, row.id]))
  const defective = byKey.get('defective')
  const sound = byKey.get('sound')
  if (!defective || !sound)
    throw new Error('The seeded version is missing one of its two variants.')

  const seeded: SeededPackage = {
    packageId: version.packageId,
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    title: version.title,
    workingClockSeconds: version.workingClockSeconds,
    variantIds: { defective, sound },
  }
  mkdirSync(dirname(FIXTURE_FILE), { recursive: true })
  writeFileSync(FIXTURE_FILE, JSON.stringify(seeded, null, 2))
  return seeded
}

export default async function globalSetup(): Promise<void> {
  const organizationId = await walkthroughOrganizationId()
  await purgeSuiteData(organizationId)
  await ensureFixturePackage(organizationId)
  // The connection is left open on purpose: the runner process shares this client with
  // ./global-teardown.ts, which closes it once the last worker has finished.
}

export { client }
