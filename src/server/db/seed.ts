// Seed (docs/tech/06-data-model.md §5, items 1–3; SYS-024 part 1, D-040, D-111). Idempotent: every
// row is looked up by its natural key first, so `pnpm db:seed` twice changes nothing. The scenario
// package and the assignments (items 4–5) arrive in Phase 5.
//   pnpm db:seed
import 'dotenv/config'
import { and, desc, eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { auth } from '@/server/auth/auth'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { client, db } from '@/server/db/client'
import { stopBoss } from '@/server/jobs/boss'
import {
  assignments,
  courses,
  institutionSettings,
  member,
  organization,
  scenarioPackages,
  scenarioPackageVersions,
  scenarioVariants,
  sectionMemberships,
  sections,
  user,
} from '@/server/db/schema'
import { rootLogger } from '@/server/logging/logger'
import { confirmVersion, importPackage } from '@/server/modules/scenarios'

// The documented local default (05 §1); D-111 refuses it outside local and test.
export const SEED_PASSWORD_DEFAULT = 'Walkthrough-Pass-2026' // gitleaks:allow

export const SEED_ORGANIZATION = { slug: 'walkthrough', name: 'Walkthrough University' } as const

export type SeatRole = 'student' | 'instructor' | 'scenario_author'

export type Seat = {
  email: string
  name: string
  platformRole: 'none' | 'tassl_scenario_editor' | 'admin'
  memberRole: SeatRole | null
}

export const SEED_USERS: ReadonlyArray<Seat> = [
  {
    email: 'student1@tassl.local',
    name: 'Student One',
    platformRole: 'none',
    memberRole: 'student',
  },
  {
    email: 'student2@tassl.local',
    name: 'Student Two',
    platformRole: 'none',
    memberRole: 'student',
  },
  {
    email: 'instructor@tassl.local',
    name: 'Instructor Seat',
    platformRole: 'none',
    memberRole: 'instructor',
  },
  {
    email: 'editor@tassl.local',
    name: 'Scenario Editor',
    platformRole: 'tassl_scenario_editor',
    memberRole: 'scenario_author',
  },
  { email: 'admin@tassl.local', name: 'Platform Admin', platformRole: 'admin', memberRole: null },
]

export const SEED_COURSE = { name: 'Marketing Strategy Walkthrough', term: '2026-fall' } as const
export const SEED_SECTION = 'A'

const log = rootLogger.child({ event: 'seed' })

export type SeedSummary = {
  organizationId: string
  courseId: string
  sectionId: string
  /** The confirmed Meridian Roast version the walkthrough assignments point at (06 §5 item 4). */
  packageVersionId: string
  users: Record<string, string>
}

async function ensureOrganization(): Promise<string> {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, SEED_ORGANIZATION.slug))
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await db.insert(organization).values({
    id,
    name: SEED_ORGANIZATION.name,
    slug: SEED_ORGANIZATION.slug,
    createdAt: new Date(),
  })
  return id
}

async function ensureSettings(organizationId: string): Promise<void> {
  await db
    .insert(institutionSettings)
    .values({ organizationId, plan: 'pilot' })
    .onConflictDoNothing()
}

async function ensureUser(seat: Seat, password: string): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, seat.email))
  let id = existing?.id
  if (!id) {
    // Better Auth hashes the password and creates the credential account (08 §1).
    const created = await auth.api.signUpEmail({
      body: { name: seat.name, email: seat.email, password },
    })
    id = created.user.id
  }
  await db
    .update(user)
    .set({ emailVerified: true, platform_role: seat.platformRole, name: seat.name })
    .where(eq(user.id, id))
  return id
}

async function ensureMember(organizationId: string, userId: string, role: SeatRole): Promise<void> {
  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  if (existing) {
    await db.update(member).set({ role }).where(eq(member.id, existing.id))
    return
  }
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

async function ensureCourse(organizationId: string, createdBy: string): Promise<string> {
  const [existing] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, organizationId),
        eq(courses.name, SEED_COURSE.name),
        eq(courses.term, SEED_COURSE.term),
      ),
    )
  if (existing) return existing.id
  const [row] = await db
    .insert(courses)
    .values({
      organizationId,
      name: SEED_COURSE.name,
      term: SEED_COURSE.term,
      outsideAiPolicy: 'declared',
      defaultRunWeight: '2.500',
      createdBy,
    })
    .returning({ id: courses.id })
  return row!.id
}

async function ensureSection(organizationId: string, courseId: string): Promise<string> {
  const [existing] = await db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.courseId, courseId), eq(sections.name, SEED_SECTION)))
  if (existing) return existing.id
  const [row] = await db
    .insert(sections)
    .values({ organizationId, courseId, name: SEED_SECTION })
    .returning({ id: sections.id })
  return row!.id
}

async function ensureSectionMembership(
  organizationId: string,
  sectionId: string,
  userId: string,
  role: 'student' | 'instructor' | 'ta',
): Promise<void> {
  await db
    .insert(sectionMemberships)
    .values({ organizationId, sectionId, userId, role })
    .onConflictDoUpdate({
      target: [sectionMemberships.sectionId, sectionMemberships.userId],
      set: { role },
    })
}

/** Creates or refreshes the walkthrough institution, seat accounts, course, and section. */

/** 06 §5 item 4: the Meridian Roast fixture, imported confirmed by the instructor who owns it. */
const SEED_PACKAGE_FAMILY_KEY = 'meridian-roast'

/** 06 §5 item 5. The auto-lock assignment's short clock is what makes a lock observable in a demo. */
// All three are walkthrough assignments (PRD §12 takes every one of them in the walkthrough), so a
// rehearsal run on any of them can be deleted from the assignment page and the seat is free again
// (D-104; before this only the first was flagged, and a run on the other two could only be voided).
type WantedAssignment = {
  label: string
  variant: 'defective' | 'sound'
  isWalkthrough: boolean
  workingClockSeconds?: number
}

const SEED_ASSIGNMENTS: ReadonlyArray<WantedAssignment> = [
  { label: 'Decision Run 1 (walkthrough)', variant: 'defective', isWalkthrough: true },
  { label: 'Decision Run 1 (sound)', variant: 'sound', isWalkthrough: true },
  {
    label: 'Auto-lock test run',
    variant: 'defective',
    isWalkthrough: true,
    workingClockSeconds: 120,
  },
]

/**
 * The fixture package, imported through the service rather than written row by row: the import is
 * what resolves the document's element keys into ids, and seeding it any other way would be a
 * second implementation of that resolution which could drift from the one authors use.
 *
 * `confirmOnImport` files a confirmation for every element in the instructor's name, which is the
 * fixture path 10 §4 describes — the seat is the disciplinary authority for this institution, and
 * the walkthrough needs a version that is already confirmed and frozen.
 */
async function ensurePackage(organizationId: string, instructorId: string): Promise<string> {
  const [existing] = await db
    .select({ id: scenarioPackages.id })
    .from(scenarioPackages)
    .where(
      and(
        eq(scenarioPackages.organizationId, organizationId),
        eq(scenarioPackages.familyKey, SEED_PACKAGE_FAMILY_KEY),
      ),
    )
  if (existing) {
    const [version] = await db
      .select({ id: scenarioPackageVersions.id })
      .from(scenarioPackageVersions)
      .where(eq(scenarioPackageVersions.packageId, existing.id))
      .orderBy(desc(scenarioPackageVersions.version))
      .limit(1)
    if (version) return version.id
  }

  const document: unknown = JSON.parse(
    readFileSync(new URL('./fixtures/meridian-roast.package.json', import.meta.url), 'utf8'),
  )
  const instructor: SessionUser = {
    id: instructorId,
    email: 'instructor@tassl.local',
    name: 'Instructor One',
    emailVerified: true,
    activeOrganizationId: organizationId,
    platformRole: 'none',
  }
  const imported = await importPackage(instructor, organizationId, {
    ...(document as Record<string, unknown>),
    confirmOnImport: true,
  })
  // Signing every element is not the same act as confirming the version (10 §4): the import files
  // the decisions, and this is the authority freezing what they add up to. The walkthrough needs a
  // confirmed version, because an assignment refuses any other (PACKAGE_NOT_CONFIRMED).
  await confirmVersion(instructor, imported.versionId, { teachingNoteChecked: true })
  return imported.versionId
}

/** The three assignments of 06 §5 item 5, keyed by label so a re-run changes nothing. */
async function ensureAssignments(
  organizationId: string,
  sectionId: string,
  packageVersionId: string,
  wantedAssignments: ReadonlyArray<WantedAssignment> = SEED_ASSIGNMENTS,
): Promise<number> {
  const variants = await db
    .select({ id: scenarioVariants.id, key: scenarioVariants.key })
    .from(scenarioVariants)
    .where(eq(scenarioVariants.packageVersionId, packageVersionId))
  const variantByKey = new Map(variants.map((row) => [row.key, row.id]))

  let written = 0
  for (const wanted of wantedAssignments) {
    const [existing] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.sectionId, sectionId), eq(assignments.label, wanted.label)))
    if (existing) continue

    const variantId = variantByKey.get(wanted.variant)
    if (!variantId) throw new Error(`SEED_VARIANT_MISSING:${wanted.variant}`)
    await db.insert(assignments).values({
      organizationId,
      sectionId,
      label: wanted.label,
      packageVersionId,
      variantId,
      isWalkthrough: wanted.isWalkthrough,
      ...(wanted.workingClockSeconds === undefined
        ? {}
        : { workingClockSeconds: wanted.workingClockSeconds }),
    })
    written += 1
  }
  return written
}

export async function runSeed(): Promise<SeedSummary> {
  const deployed = env.APP_ENV === 'preview' || env.APP_ENV === 'production'
  if (deployed && env.SEED_PASSWORD === SEED_PASSWORD_DEFAULT) {
    throw new Error('SEED_PASSWORD_DEFAULT_REFUSED')
  }

  const organizationId = await ensureOrganization()
  await ensureSettings(organizationId)

  const users: Record<string, string> = {}
  for (const seat of SEED_USERS) {
    const id = await ensureUser(seat, env.SEED_PASSWORD)
    users[seat.email] = id
    if (seat.memberRole) await ensureMember(organizationId, id, seat.memberRole)
  }

  const instructorId = users['instructor@tassl.local']!
  const courseId = await ensureCourse(organizationId, instructorId)
  const sectionId = await ensureSection(organizationId, courseId)
  await ensureSectionMembership(organizationId, sectionId, instructorId, 'instructor')
  await ensureSectionMembership(
    organizationId,
    sectionId,
    users['student1@tassl.local']!,
    'student',
  )
  await ensureSectionMembership(
    organizationId,
    sectionId,
    users['student2@tassl.local']!,
    'student',
  )

  const packageVersionId = await ensurePackage(organizationId, instructorId)
  const assignmentsWritten = await ensureAssignments(organizationId, sectionId, packageVersionId)

  log.info(
    {
      organizationId,
      courseId,
      sectionId,
      packageVersionId,
      assignmentsWritten,
      users: Object.keys(users).length,
    },
    'seed applied',
  )
  return { organizationId, courseId, sectionId, packageVersionId, users }
}

/** The assignment the load accounts run (`tests/load/core-flow.js`; 15 §16.2). */
export const LOAD_ASSIGNMENT_LABEL = 'Load test run'

/** `load-student-01@tassl.local` … : one account per virtual user of the load test. */
export const loadSeatEmail = (index: number): string =>
  `load-student-${String(index).padStart(2, '0')}@tassl.local`

/**
 * The load accounts and their assignment (`pnpm demo:reset --load-users[=N]`, D-711). Idempotent
 * like the seed: an account that exists keeps its id, and the assignment is written once. The
 * accounts are ordinary students of the seeded section with the seed password, so the load test
 * signs them in through the same door a real student uses; the assignment is a walkthrough one so
 * the runs it accumulates can be deleted from the assignment page or by the next reset.
 */
export async function ensureLoadSeats(
  summary: SeedSummary,
  count: number,
): Promise<{ seats: number; assignmentId: string }> {
  if (!Number.isInteger(count) || count < 1 || count > 99) {
    throw new Error('LOAD_SEAT_COUNT_OUT_OF_RANGE')
  }
  for (let index = 1; index <= count; index += 1) {
    const seat: Seat = {
      email: loadSeatEmail(index),
      name: `Load Student ${String(index).padStart(2, '0')}`,
      platformRole: 'none',
      memberRole: 'student',
    }
    const id = await ensureUser(seat, env.SEED_PASSWORD)
    await ensureMember(summary.organizationId, id, 'student')
    await ensureSectionMembership(summary.organizationId, summary.sectionId, id, 'student')
  }
  await ensureAssignments(summary.organizationId, summary.sectionId, summary.packageVersionId, [
    { label: LOAD_ASSIGNMENT_LABEL, variant: 'defective', isWalkthrough: true },
  ])
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.sectionId, summary.sectionId),
        eq(assignments.label, LOAD_ASSIGNMENT_LABEL),
      ),
    )
  if (!assignment) throw new Error('LOAD_ASSIGNMENT_MISSING')
  return { seats: count, assignmentId: assignment.id }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

/**
 * Signing a seat up sends its verification email, which enqueues a `send_email` job and so starts
 * pg-boss; its pool keeps the event loop alive, so the script closes both connections before it
 * returns (D-180).
 */
async function shutdown(): Promise<void> {
  await stopBoss()
  await client.end({ timeout: 5 })
}

if (invokedDirectly) {
  runSeed()
    .then(async (summary) => {
      log.info(
        { seats: Object.keys(summary.users).length, courseId: summary.courseId },
        'seed complete',
      )
      await shutdown()
    })
    .catch(async (error: unknown) => {
      log.error({ err: error instanceof Error ? error.message : String(error) }, 'seed failed')
      await shutdown()
      process.exit(1)
    })
}
