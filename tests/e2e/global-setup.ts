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
//   the purge — nothing in the product deletes a course, a section, an assignment or a started
//     run, so the rows the specs create are taken back out here. Running it at the start as well as
//     in the teardown is what makes a repeated run against the same database idempotent: a run that
//     crashed between the two leaves nothing behind for the next one to trip over.
//
// The purge goes straight to the database because nothing in the product deletes these rows; every
// row it touches is confined to the seeded institution and reached from a course named with
// SUITE_PREFIX, so it can never touch the walkthrough course, its assignments, or the runs taken on
// them. `assertSeededCourseUntouched` states that in full and enforces it.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm'
import { client, db } from '@/server/db/client'
import {
  assignments,
  claimNeutralizations,
  courseExports,
  courses,
  invitation,
  organization,
  answerSpacePositions,
  defenseQuestions,
  elementConfirmations,
  namedFields,
  readinessItems,
  runActions,
  runAddenda,
  runBands,
  runBriefs,
  runClaims,
  runDebriefAnswers,
  runDefenseAnswers,
  runDefenseQuestions,
  runDelegations,
  runDocumentOpens,
  runEscalations,
  runEvents,
  runFrames,
  runPauses,
  runReadinessAnswers,
  runReadinessResults,
  runRecords,
  runScores,
  runTurnResponses,
  runs,
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

/**
 * The seeded course (`SEED_COURSE.name` in `src/server/db/seed.ts`, 06 §5 item 3), named here for
 * one purpose: to assert that the purge below never reaches it. See `assertSeededCourseUntouched`.
 */
const SEED_COURSE_NAME = 'Marketing Strategy Walkthrough'

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
 * Removes every row the suite's specs create: the courses they name with SUITE_PREFIX, the
 * sections, memberships and assignments hanging off them, the runs the student specs take on those
 * assignments, and the invitations the roster spec sends. Deletion runs child-first because no
 * foreign key in 06 §3.2 or §3.4 cascades.
 */
export async function purgeSuiteData(organizationId: string): Promise<void> {
  const courseRows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.organizationId, organizationId), like(courses.name, `${SUITE_PREFIX}%`)))
  const courseIds = courseRows.map((row) => row.id)

  if (courseIds.length > 0) {
    await assertSeededCourseUntouched(organizationId, courseIds)
    const sectionRows = await db
      .select({ id: sections.id })
      .from(sections)
      .where(inArray(sections.courseId, courseIds))
    const sectionIds = sectionRows.map((row) => row.id)
    if (sectionIds.length > 0) {
      const assignmentRows = await db
        .select({ id: assignments.id })
        .from(assignments)
        .where(inArray(assignments.sectionId, sectionIds))
      const assignmentIds = assignmentRows.map((row) => row.id)
      if (assignmentIds.length > 0) await purgeRuns(assignmentIds)
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
 * What keeps the seeded walkthrough out of reach of everything above, stated as an assertion rather
 * than left as a claim.
 *
 * Three things protect it, and this checks the first because the other two follow from it:
 *
 *   1. **The name.** Every course the suite creates is named through `suiteName()`
 *      (./fixture-package.ts), which prefixes `SUITE_PREFIX` — "E2E Phase 4". The seeded course is
 *      `SEED_COURSE.name`, "Marketing Strategy Walkthrough" (06 §5 item 3), and the only rows this
 *      file resolves are the ones matching `like(courses.name, 'E2E Phase 4%')` in the seeded
 *      institution. No seeded name can match that pattern.
 *   2. **The path.** Sections, memberships, assignments and runs are never selected by a name or a
 *      label of their own: each is resolved from the ids above — sections from `courseIds`,
 *      assignments from `sectionIds`, runs from `assignmentIds`. A row the walk cannot reach from a
 *      suite-named course is a row this file cannot see, so section "A", the assignment "Decision
 *      Run 1 (walkthrough)" and every run taken on it are outside the walk by construction.
 *   3. **The tenant.** Every query is also bound to the seeded institution's id, so a course of the
 *      same name in another organization is out of reach as well.
 *
 * Deleting a course was harmless enough to leave at a comment. Deleting a *run* is not: it is a
 * student's work, and the walkthrough assignment's runs are what the PRD's own demo is taken on. So
 * rule 1 is enforced here, and the purge stops rather than proceeding if it is ever broken.
 */
async function assertSeededCourseUntouched(
  organizationId: string,
  courseIds: readonly string[],
): Promise<void> {
  const seeded = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.organizationId, organizationId), eq(courses.name, SEED_COURSE_NAME)))
  const reached = seeded.filter((row) => courseIds.includes(row.id))
  if (reached.length > 0) {
    throw new Error(
      `The e2e purge resolved the seeded course "${SEED_COURSE_NAME}" (${reached
        .map((row) => row.id)
        .join(
          ', ',
        )}) as one of its own. It would delete the walkthrough assignment and every run ` +
        `taken on it. Nothing was deleted. Check that SUITE_PREFIX ("${SUITE_PREFIX}") is still a ` +
        'prefix no seeded row carries.',
    )
  }
}

/**
 * The runs the student specs take, and everything hanging off one.
 *
 * `deleteWalkthroughRun` (D-104) is the one control in the product meant to remove a run, and the
 * database used to refuse it: migration 0005 declared every run child table `ON DELETE no action`,
 * so `DELETE FROM runs` raised 23503 for a run that had done anything at all. That is why a run
 * started on the seeded walkthrough assignment could never be taken back out, and why the student
 * specs start theirs on an assignment of their own (`createStudentAssignment` in
 * ./instructor/api.ts) — which is a row this file owns. Migration `0012_run_delete_cascade` (D-255)
 * has since made every child of a run cascade, so the explicit child deletes below are no longer
 * needed and the `runs` delete alone would empty all of them; they are left in place because this
 * purge also runs against databases a suite did not create, and deleting what it means to delete
 * costs nothing.
 *
 * The order below is the reference order: what points at something else goes before what it points
 * at. Two edges are easy to miss — `run_defense_answers` names its question, and
 * `run_claims.neutralization_id` names a `claim_neutralizations` row (the FK deferred to migration
 * 0008 by D-163) — so both children go before their parents. `course_exports` names the run *and*
 * the assignment, so it goes before either. The whole set of tables with a foreign key to `runs.id`
 * is listed rather than only the five Phase 6 writes, because a phase that starts writing one of
 * the others must not silently stop the purge.
 */
async function purgeRuns(assignmentIds: readonly string[]): Promise<void> {
  const runRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.assignmentId, [...assignmentIds]))
  const runIds = runRows.map((row) => row.id)
  if (runIds.length === 0) return

  await db.delete(courseExports).where(inArray(courseExports.runId, runIds))
  await db.delete(runRecords).where(inArray(runRecords.runId, runIds))
  await db.delete(runDebriefAnswers).where(inArray(runDebriefAnswers.runId, runIds))
  await db.delete(runScores).where(inArray(runScores.runId, runIds))
  await db.delete(runBands).where(inArray(runBands.runId, runIds))
  await db.delete(runDefenseAnswers).where(inArray(runDefenseAnswers.runId, runIds))
  await db.delete(runDefenseQuestions).where(inArray(runDefenseQuestions.runId, runIds))
  await db.delete(runTurnResponses).where(inArray(runTurnResponses.runId, runIds))
  await db.delete(runAddenda).where(inArray(runAddenda.runId, runIds))
  await db.delete(runBriefs).where(inArray(runBriefs.runId, runIds))
  await db.delete(runPauses).where(inArray(runPauses.runId, runIds))
  await db.delete(runEscalations).where(inArray(runEscalations.runId, runIds))
  await db.delete(runActions).where(inArray(runActions.runId, runIds))
  await db.delete(runClaims).where(inArray(runClaims.runId, runIds))
  await db.delete(claimNeutralizations).where(inArray(claimNeutralizations.runId, runIds))
  await db.delete(runDelegations).where(inArray(runDelegations.runId, runIds))
  await db.delete(runFrames).where(inArray(runFrames.runId, runIds))
  await db.delete(runDocumentOpens).where(inArray(runDocumentOpens.runId, runIds))
  await db.delete(runReadinessAnswers).where(inArray(runReadinessAnswers.runId, runIds))
  await db.delete(runReadinessResults).where(inArray(runReadinessResults.runId, runIds))
  await db.delete(runEvents).where(inArray(runEvents.runId, runIds))

  // A re-offer names the run it replaces (FR-183, Phase 11). Both ends are inside `runIds` here, so
  // the delete below would resolve anyway — but only because the two rows go in one statement, and
  // that is too subtle a thing to rely on. The pointers are cleared first instead.
  await db
    .update(runs)
    .set({ reOfferedFromRunId: null, reOfferedToRunId: null })
    .where(inArray(runs.id, runIds))
  await db.delete(runs).where(inArray(runs.id, runIds))
}

/**
 * The packages the author specs create. Nothing in the product deletes a package, so they are taken
 * out here by title, and only ever under SUITE_PREFIX — the seeded Meridian Roast package carries
 * no prefix, so it cannot be reached from here.
 *
 * A version's elements have no cascade, so they go first, then the versions, then the family — and
 * a confirmed version has to be thawed before any of that is possible. The triggers of migration
 * 0004 refuse a DELETE on an element exactly as firmly as an UPDATE (`package_element_frozen`,
 * `variant_claim_state_frozen` fire on all three), so its elements cannot go while `confirmed_at`
 * is set, and the version itself cannot go while those elements still point at it. `thaw` below
 * breaks that circle for the suite's own versions and nothing else.
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
    await thaw(versionIds)
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

/**
 * Clears `confirmed_at` on the suite's own package versions, which is what every element trigger of
 * migration 0004 reads before it refuses a write.
 *
 * `package_version_frozen` is what would otherwise refuse to let that column be cleared — it allows
 * an UPDATE to touch only `status`, `review_requested_at`, `review_reason` and `updated_at` once a
 * version is confirmed — so it is switched off for the length of this one statement and switched
 * back on in a `finally`. Nothing weaker works: the freeze cannot be lifted through the product
 * (NFR-004 means it never is), the version row cannot be deleted before its elements, and its
 * elements cannot be deleted before the freeze is lifted.
 *
 * The step 5.5 confirm-workspace spec is the first to leave a confirmed package behind. Without
 * this the next purge — which is the first thing `globalSetup` does — raises `VERSION_FROZEN`, and
 * the whole suite stops starting until someone resets the database by hand.
 */
async function thaw(versionIds: readonly string[]): Promise<void> {
  await db.execute(
    sql`ALTER TABLE scenario_package_versions DISABLE TRIGGER package_version_frozen`,
  )
  try {
    await db
      .update(scenarioPackageVersions)
      .set({ status: 'draft', confirmedAt: null })
      .where(inArray(scenarioPackageVersions.id, [...versionIds]))
  } finally {
    await db.execute(
      sql`ALTER TABLE scenario_package_versions ENABLE TRIGGER package_version_frozen`,
    )
  }
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
