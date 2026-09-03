// Seed (docs/tech/06-data-model.md §5, items 1–3; SYS-024 part 1, D-040, D-111). Idempotent: every
// row is looked up by its natural key first, so `pnpm db:seed` twice changes nothing. The scenario
// package and the assignments (items 4–5) arrive in Phase 5.
//   pnpm db:seed
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { pathToFileURL } from 'node:url'
import { auth } from '@/server/auth/auth'
import { env } from '@/server/config'
import { client, db } from '@/server/db/client'
import {
  courses,
  institutionSettings,
  member,
  organization,
  sectionMemberships,
  sections,
  user,
} from '@/server/db/schema'
import { rootLogger } from '@/server/logging/logger'

export const SEED_PASSWORD_DEFAULT = 'Walkthrough-Pass-2026'

export const SEED_ORGANIZATION = { slug: 'walkthrough', name: 'Walkthrough University' } as const

export type SeatRole = 'student' | 'instructor' | 'scenario_author'

export const SEED_USERS: ReadonlyArray<{
  email: string
  name: string
  platformRole: 'none' | 'tassl_scenario_editor' | 'admin'
  memberRole: SeatRole | null
}> = [
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

async function ensureUser(seat: (typeof SEED_USERS)[number], password: string): Promise<string> {
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

  log.info(
    { organizationId, courseId, sectionId, users: Object.keys(users).length },
    'seed applied',
  )
  return { organizationId, courseId, sectionId, users }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  runSeed()
    .then(async (summary) => {
      console.log(
        `seed: ${Object.keys(summary.users).length} seat accounts, course ${summary.courseId}`,
      )
      await client.end({ timeout: 5 })
    })
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      await client.end({ timeout: 5 })
      process.exit(1)
    })
}
