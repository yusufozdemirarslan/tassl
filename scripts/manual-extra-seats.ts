/**
 * Two seats the seed does not create, so the manual can be written from their screens:
 * a teaching assistant of the seeded section, and a program lead of the seeded institution.
 * One-off tooling for docs/manual; not part of any test lane.
 *
 *   pnpm exec tsx --conditions=react-server scripts/manual-extra-seats.ts
 */
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/server/auth/auth'
import { db } from '@/server/db/client'
import { member, user } from '@/server/db/schema/auth'
import { courses, sectionMemberships, sections } from '@/server/db/schema/courses'
import { organization } from '@/server/db/schema/auth'

const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'

type Seat = {
  email: string
  name: string
  organizationRole: 'teaching_assistant' | 'program_lead'
  sectionRole: 'ta' | null
}

const SEATS: Seat[] = [
  {
    email: 'ta@tassl.local',
    name: 'Teaching Assistant Seat',
    organizationRole: 'teaching_assistant',
    sectionRole: 'ta',
  },
  {
    email: 'lead@tassl.local',
    name: 'Program Lead Seat',
    organizationRole: 'program_lead',
    sectionRole: null,
  },
]

async function main(): Promise<void> {
  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.slug, 'walkthrough'))
  if (!org) throw new Error('the seeded institution is missing; run pnpm db:seed first')

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.organizationId, org.id))
  if (!course) throw new Error('the seeded course is missing')
  const [section] = await db
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.courseId, course.id))
  if (!section) throw new Error('the seeded section is missing')

  for (const seat of SEATS) {
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, seat.email))
    let id = existing?.id
    if (!id) {
      const created = await auth.api.signUpEmail({
        body: { name: seat.name, email: seat.email, password: PASSWORD },
      })
      id = created.user.id
    }
    await db
      .update(user)
      .set({ emailVerified: true, name: seat.name, platform_role: 'none' })
      .where(eq(user.id, id))

    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.userId, id)))
    if (row) {
      await db.update(member).set({ role: seat.organizationRole }).where(eq(member.id, row.id))
    } else {
      await db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: id,
        role: seat.organizationRole,
        createdAt: new Date(),
      })
    }

    if (seat.sectionRole !== null) {
      const [membership] = await db
        .select({ id: sectionMemberships.id })
        .from(sectionMemberships)
        .where(and(eq(sectionMemberships.sectionId, section.id), eq(sectionMemberships.userId, id)))
      if (membership) {
        await db
          .update(sectionMemberships)
          .set({ role: seat.sectionRole })
          .where(eq(sectionMemberships.id, membership.id))
      } else {
        await db.insert(sectionMemberships).values({
          organizationId: org.id,
          sectionId: section.id,
          userId: id,
          role: seat.sectionRole,
        })
      }
    }
    console.log(
      `${seat.email}: ${seat.organizationRole}${seat.sectionRole ? ` + section ${seat.sectionRole}` : ''}`,
    )
  }
  process.exit(0)
}

void main()
