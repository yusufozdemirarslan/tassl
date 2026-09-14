// Institution factory (06 §5 item 1, D-006): a Better Auth organization with institution settings
// and memberships. Organization and member rows are Better Auth's tables (written directly, as the
// seed does); settings go through the tenancy repository.
import { and, eq } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { member, organization, type InstitutionSettings } from '@/server/db/schema'
import { upsertSettings } from '@/server/modules/tenancy/repository'
import { MEMBERSHIP_ROLE } from '@/server/auth/access-control-shared'
import { uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export type OrganizationRow = typeof organization.$inferSelect
export type MemberRow = typeof member.$inferSelect

export type Institution = { organization: OrganizationRow; settings: InstitutionSettings }

export async function createInstitution(
  label: string,
  overrides: { name?: string; slug?: string; plan?: InstitutionSettings['plan'] } = {},
): Promise<Institution> {
  const id = uuidFrom(`org:${label}`)
  const [existing] = await db.select().from(organization).where(eq(organization.id, id))
  let org = existing
  if (!org) {
    const [row] = await db
      .insert(organization)
      .values({
        id,
        name: overrides.name ?? `${label} University`,
        slug: overrides.slug ?? label,
        createdAt: FROZEN_TIME,
      })
      .returning()
    org = row!
  }
  const settings = await upsertSettings(id, { plan: overrides.plan ?? 'pilot' })
  return { organization: org, settings }
}

/**
 * Adds an organization membership; one row per user per organization (06 §3.1). A membership is
 * tenancy and carries no role (D-748): what the person may do is the platform role on their account.
 */
export async function addMember(organizationId: string, userId: string): Promise<MemberRow> {
  const [existing] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  if (existing) return existing
  const [row] = await db
    .insert(member)
    .values({
      id: uuidFrom(`member:${organizationId}:${userId}`),
      organizationId,
      userId,
      role: MEMBERSHIP_ROLE,
      createdAt: FROZEN_TIME,
    })
    .returning()
  return row!
}
