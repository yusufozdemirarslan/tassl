// Step 3.2 — D-055 / FR-234: a platform `tassl_scenario_editor` may read identified institution
// records only while an active `data_agreements` row admits their role for at least one purpose.
// Agreements are written through the tenancy repository (10-backend-spec-modules.md §2); the guard
// under test is `canReadIdentifiedRecords` in src/server/auth/permissions.ts.
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

type Permissions = typeof import('@/server/auth/permissions')
type Tenancy = typeof import('@/server/modules/tenancy/repository')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let permissions: Permissions
let tenancy: Tenancy
let f: Factories

let orgId: string
let editor: UserRow
let instructor: UserRow

const DAY_MS = 24 * 60 * 60 * 1000

function actorOf(user: UserRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    activeOrganizationId: null,
    platformRole: user.platform_role as PlatformRole,
  }
}

/** A signed agreement with the fields D-055 gates on; `endsAt` null means open-ended. */
function agreement(overrides: {
  permittedPlatformRoles?: string[]
  purposes?: Array<'scoring_audit' | 'scenario_calibration' | 'drift_review'>
  signedAt?: Date
  endsAt?: Date | null
}) {
  return {
    counterparty: 'Walkthrough University',
    permittedPlatformRoles: overrides.permittedPlatformRoles ?? ['tassl_scenario_editor'],
    purposes: overrides.purposes ?? (['scoring_audit'] as const).slice(),
    retentionDays: 365,
    documentReference: 'DSA-2026-01',
    signedAt: overrides.signedAt ?? new Date(Date.now() - DAY_MS),
    endsAt: overrides.endsAt ?? null,
  }
}

describe('canReadIdentifiedRecords and data agreements (D-055)', () => {
  beforeAll(async () => {
    await truncateAll()
    permissions = await import('@/server/auth/permissions')
    tenancy = await import('@/server/modules/tenancy/repository')
    f = await import('@tests/factories')

    const institution = await f.createInstitution('agreements')
    orgId = institution.organization.id
    editor = await f.createUser('agreements-editor', { platformRole: 'tassl_scenario_editor' })
    instructor = await f.createUser('agreements-instructor')
    await f.addMember(orgId, editor.id, 'scenario_author')
    await f.addMember(orgId, instructor.id, 'instructor')
  })

  afterEach(async () => {
    await testSql`delete from data_agreements`
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('is false while the institution has no agreement', async () => {
    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(false)
  })

  it('is true under an open-ended agreement that names the role and a purpose', async () => {
    const row = await tenancy.upsertAgreement(orgId, agreement({}))
    expect(row).not.toBeNull()

    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(true)
    await expect(
      permissions.requireIdentifiedRecordsAccess(actorOf(editor), orgId),
    ).resolves.toBeUndefined()
  })

  it('is true while ends_at is in the future and false once it has passed', async () => {
    await tenancy.upsertAgreement(orgId, agreement({ endsAt: new Date(Date.now() + DAY_MS) }))
    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(true)

    await testSql`delete from data_agreements`
    await tenancy.upsertAgreement(orgId, agreement({ endsAt: new Date(Date.now() - DAY_MS) }))
    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(false)
  })

  it('is false when the agreement does not admit the platform role of the actor', async () => {
    await tenancy.upsertAgreement(orgId, agreement({ permittedPlatformRoles: ['none'] }))
    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(false)
  })

  it('is false for a soft-deleted agreement', async () => {
    const row = await tenancy.upsertAgreement(orgId, agreement({}))
    await tenancy.softDeleteAgreement(orgId, row!.id)
    await expect(permissions.canReadIdentifiedRecords(actorOf(editor), orgId)).resolves.toBe(false)
  })

  it('is false for a non-editor even under an active agreement, and for another organization', async () => {
    await tenancy.upsertAgreement(orgId, agreement({}))
    await expect(permissions.canReadIdentifiedRecords(actorOf(instructor), orgId)).resolves.toBe(
      false,
    )

    const other = await f.createInstitution('agreements-other')
    await expect(
      permissions.canReadIdentifiedRecords(actorOf(editor), other.organization.id),
    ).resolves.toBe(false)
  })
})
