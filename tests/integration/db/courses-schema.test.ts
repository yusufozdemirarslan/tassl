// Step 2.2 (DATA-005, DATA-008 to DATA-011, DATA-052, DATA-055): the tenancy and course tables
// carry their constraints, the set_updated_at() trigger maintains updated_at, and the D-162 member
// index exists. The assignments variant-matches-version trigger is asserted by Step 2.3's test (D-163).
import { afterEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

type IdRow = { id: string }

function first<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('expected at least one row')
  return row
}

async function seedTenant(): Promise<{ orgId: string; userId: string }> {
  const orgId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${orgId}, 'Walkthrough University', ${`org-${orgId}`}, now())`
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Seat One', ${`${userId}@example.test`}, false, now(), now())`
  return { orgId, userId }
}

async function insertCourse(orgId: string, userId: string): Promise<string> {
  const rows = await testSql<IdRow[]>`
    insert into courses (organization_id, name, term, created_by)
    values (${orgId}, 'Managerial Decisions', '2026-fall', ${userId})
    returning id`
  return first(rows).id
}

async function insertSection(orgId: string, courseId: string): Promise<string> {
  const rows = await testSql<IdRow[]>`
    insert into sections (organization_id, course_id, name)
    values (${orgId}, ${courseId}, 'Section A')
    returning id`
  return first(rows).id
}

describe('tenancy and courses schema', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('maintains updated_at through the set_updated_at trigger on courses', async () => {
    const { orgId, userId } = await seedTenant()
    const courseId = await insertCourse(orgId, userId)
    const before = first(
      await testSql<{ created_at: Date; updated_at: Date }[]>`
        select created_at, updated_at from courses where id = ${courseId}`,
    )
    expect(before.updated_at.getTime()).toBe(before.created_at.getTime())

    await testSql`select pg_sleep(0.02)`
    await testSql`update courses set name = 'Managerial Decisions II' where id = ${courseId}`

    const after = first(
      await testSql<{ name: string; created_at: Date; updated_at: Date }[]>`
        select name, created_at, updated_at from courses where id = ${courseId}`,
    )
    expect(after.name).toBe('Managerial Decisions II')
    expect(after.created_at.getTime()).toBe(before.created_at.getTime())
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
  })

  it('applies the platform defaults to a new course', async () => {
    const { orgId, userId } = await seedTenant()
    const courseId = await insertCourse(orgId, userId)
    const row = first(
      await testSql<
        {
          outside_ai_policy: string
          mapping: Record<string, number>
          default_run_weight: string
          critique_weight_factor: string
          taught_concepts: string[]
          policy_overrides: Record<string, unknown>
          deleted_at: Date | null
        }[]
      >`
        select outside_ai_policy, mapping, default_run_weight, critique_weight_factor,
               taught_concepts, policy_overrides, deleted_at
        from courses where id = ${courseId}`,
    )
    expect(row).toMatchObject({
      outside_ai_policy: 'declared',
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
      default_run_weight: '2.500',
      critique_weight_factor: '0.500',
      taught_concepts: [],
      policy_overrides: {},
      deleted_at: null,
    })
  })

  it('rejects a second membership for the same section and user', async () => {
    const { orgId, userId } = await seedTenant()
    const courseId = await insertCourse(orgId, userId)
    const sectionId = await insertSection(orgId, courseId)
    await testSql`
      insert into section_memberships (organization_id, section_id, user_id, role)
      values (${orgId}, ${sectionId}, ${userId}, 'student')`

    await expect(
      testSql`
        insert into section_memberships (organization_id, section_id, user_id, role)
        values (${orgId}, ${sectionId}, ${userId}, 'ta')`,
    ).rejects.toThrow(/section_memberships_section_id_user_id_uidx/)
  })

  it('keeps member unique per organization and user (D-162 index)', async () => {
    const { orgId, userId } = await seedTenant()
    await testSql`
      insert into member (id, organization_id, user_id, role, created_at)
      values (${crypto.randomUUID()}, ${orgId}, ${userId}, 'student', now())`

    await expect(
      testSql`
        insert into member (id, organization_id, user_id, role, created_at)
        values (${crypto.randomUUID()}, ${orgId}, ${userId}, 'instructor', now())`,
    ).rejects.toThrow(/member_organization_user_uidx/)
  })

  it('rejects a data agreement with no purposes and accepts one with defaults', async () => {
    const { orgId } = await seedTenant()

    await expect(
      testSql`
        insert into data_agreements
          (organization_id, counterparty, permitted_platform_roles, purposes, retention_days,
           document_reference, signed_at)
        values
          (${orgId}, 'Walkthrough University', '{tassl_scenario_editor}'::text[],
           '{}'::agreement_purpose[], 365, 'DSA-2026-001', now())`,
    ).rejects.toThrow(/data_agreements_purposes_check/)

    await expect(
      testSql`
        insert into data_agreements
          (organization_id, counterparty, permitted_platform_roles, purposes, retention_days,
           document_reference, signed_at)
        values
          (${orgId}, 'Walkthrough University', '{tassl_scenario_editor}'::text[],
           '{scoring_audit}'::agreement_purpose[], 0, 'DSA-2026-001', now())`,
    ).rejects.toThrow(/data_agreements_retention_days_check/)

    const row = first(
      await testSql<
        { record_types_covered: string[]; record_types_excluded: string[]; ends_at: Date | null }[]
      >`
        insert into data_agreements
          (organization_id, counterparty, permitted_platform_roles, purposes, retention_days,
           document_reference, signed_at)
        values
          (${orgId}, 'Walkthrough University', '{tassl_scenario_editor}'::text[],
           '{scoring_audit,drift_review}'::agreement_purpose[], 365, 'DSA-2026-001', now())
        returning record_types_covered, record_types_excluded, ends_at`,
    )
    expect(row).toEqual({
      record_types_covered: [
        'run_records',
        'defense_transcripts',
        'debriefs',
        'instructor_decisions',
      ],
      record_types_excluded: [
        'accommodation_information',
        'diagnostic_information',
        'defense_audio',
      ],
      ends_at: null,
    })
  })

  it('defaults institution_settings to the pilot plan and the standard mapping', async () => {
    const { orgId } = await seedTenant()
    await testSql`insert into institution_settings (organization_id) values (${orgId})`
    const row = first(
      await testSql<{ plan: string; default_mapping: Record<string, number> }[]>`
        select plan, default_mapping from institution_settings where organization_id = ${orgId}`,
    )
    expect(row).toEqual({
      plan: 'pilot',
      default_mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
    })
  })
})
