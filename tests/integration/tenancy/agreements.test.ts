// Step 3.2 — data agreements (DATA-052, D-055) as records the Platform Admin keeps of what an
// institution has signed. Since D-748 an agreement grants no one anything, and every read and write
// of one belongs to the admin alone: a member of the institution — whatever their platform role —
// is refused, and a person outside it is told the institution does not exist.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

type Tenancy = typeof import('@/server/modules/tenancy')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let tenancy: Tenancy
let f: Factories

let orgId: string
let otherOrgId: string
let admin: UserRow
let members: UserRow[]
let outsider: UserRow

const DAY_MS = 24 * 60 * 60 * 1000

function actorOf(user: UserRow, activeOrganizationId: string | null = null): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    activeOrganizationId,
    platformRole: user.platform_role as PlatformRole,
  }
}

const AGREEMENT = {
  counterparty: 'Walkthrough University',
  permittedPlatformRoles: ['tassl_scenario_editor' as const],
  purposes: ['scoring_audit' as const],
  retentionDays: 365,
  documentReference: 'DSA-2026-01',
  signedAt: new Date(Date.now() - DAY_MS),
}

describe('data agreements are the Platform Admin’s (D-055, D-748)', () => {
  beforeAll(async () => {
    await truncateAll()
    tenancy = await import('@/server/modules/tenancy')
    f = await import('@tests/factories')

    orgId = (await f.createInstitution('agreements')).organization.id
    otherOrgId = (await f.createInstitution('agreements-other')).organization.id
    admin = await f.createUser('agreements-admin', { platformRole: 'admin' })
    members = [
      await f.createUser('agreements-student'),
      await f.createUser('agreements-editor', { platformRole: 'tassl_scenario_editor' }),
      await f.createUser('agreements-instructor', { platformRole: 'instructor' }),
    ]
    for (const member of members) await f.addMember(orgId, member.id)
    outsider = await f.createUser('agreements-outsider', { platformRole: 'instructor' })
    await f.addMember(otherOrgId, outsider.id)
  })

  afterEach(async () => {
    await testSql`delete from data_agreements`
    await testSql`delete from audit_logs`
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('lets the admin write, list, and end an agreement without a member row, audited', async () => {
    const created = await tenancy.upsertDataAgreement(actorOf(admin), orgId, AGREEMENT)
    expect(created).toMatchObject({ organizationId: orgId, purposes: ['scoring_audit'] })

    const listed = await tenancy.listDataAgreements(actorOf(admin), orgId)
    expect(listed.map((row) => row.id)).toEqual([created.id])

    const endsAt = new Date(Date.now() + 30 * DAY_MS)
    const ended = await tenancy.updateDataAgreement(actorOf(admin, orgId), created.id, { endsAt })
    expect(ended).toMatchObject({ id: created.id, endsAt: endsAt.toISOString() })

    const audits = await testSql<{ actor_id: string }[]>`
      select actor_id from audit_logs where action = 'agreement.upsert'`
    expect(audits).toEqual([{ actor_id: admin.id }, { actor_id: admin.id }])
    expect(await testSql`select 1 from member where user_id = ${admin.id}`).toHaveLength(0)
  })

  it('refuses every member of the institution, whatever their platform role', async () => {
    const existing = await tenancy.upsertDataAgreement(actorOf(admin), orgId, AGREEMENT)
    for (const member of members) {
      const actor = actorOf(member, orgId)
      await expect(tenancy.listDataAgreements(actor, orgId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(tenancy.upsertDataAgreement(actor, orgId, AGREEMENT)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(
        tenancy.updateDataAgreement(actor, existing.id, { retentionDays: 1 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(await testSql`select 1 from data_agreements`).toHaveLength(1)
  })

  it('answers NOT_FOUND to a person outside the institution and to an unknown institution', async () => {
    await expect(tenancy.listDataAgreements(actorOf(outsider), orgId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      tenancy.upsertDataAgreement(actorOf(admin), 'no-such-institution', AGREEMENT),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('keeps institution settings the admin’s too, while any member reads them', async () => {
    for (const member of members) {
      await expect(tenancy.getInstitutionSettings(actorOf(member), orgId)).resolves.toMatchObject({
        id: orgId,
      })
      await expect(
        tenancy.updateInstitutionSettings(actorOf(member), orgId, { plan: 'department' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(
      tenancy.updateInstitutionSettings(actorOf(outsider), orgId, { plan: 'department' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const updated = await tenancy.updateInstitutionSettings(actorOf(admin), orgId, {
      plan: 'department',
    })
    expect(updated.settings.plan).toBe('department')
    await expect(tenancy.getInstitutionSettings(actorOf(admin), orgId)).resolves.toMatchObject({
      settings: { plan: 'department' },
    })
  })
})
