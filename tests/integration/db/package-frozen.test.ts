// Step 2.3 (DATA-013 to DATA-025, NFR-004): a confirmed package version and its elements are
// frozen by the package_frozen trigger family, and the deferred Step 2.2 assertion (D-163) that an
// assignment's variant must belong to its package version.
import { afterEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

type IdRow = { id: string }[]

function one<T>(rows: readonly T[]): T {
  const [row] = rows
  if (row === undefined) throw new Error('expected one row')
  return row
}

async function createOrganization(): Promise<string> {
  const id = crypto.randomUUID()
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${id}, 'Walkthrough University', ${`org-${id}`}, now())`
  return id
}

async function createUser(): Promise<string> {
  const id = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${id}, 'Scenario Editor', ${`${id}@example.test`}, true, now(), now())`
  return id
}

async function createPackage(organizationId: string, createdBy: string): Promise<string> {
  const rows = await testSql<IdRow>`
    insert into scenario_packages (organization_id, title, family_key, created_by)
    values (${organizationId}, 'Northwind Launch', ${`family-${crypto.randomUUID()}`}, ${createdBy})
    returning id`
  return one(rows).id
}

async function createVersion(
  organizationId: string,
  packageId: string,
  version: number,
): Promise<string> {
  const rows = await testSql<IdRow>`
    insert into scenario_package_versions (organization_id, package_id, version, concept_set)
    values (${organizationId}, ${packageId}, ${version}, '{unit_economics,segmentation,pricing,channel_fit}')
    returning id`
  return one(rows).id
}

async function createDocument(versionId: string): Promise<string> {
  const rows = await testSql<IdRow>`
    insert into scenario_documents
      (package_version_id, key, title, author, dated_on, body, word_count, role, position)
    values
      (${versionId}, 'D1', 'Market memo', 'A. Analyst', '2026-01-15', 'Original body.', 2, 'supporting', 1)
    returning id`
  return one(rows).id
}

async function createVariant(versionId: string, key: 'defective' | 'sound'): Promise<string> {
  const rows = await testSql<IdRow>`
    insert into scenario_variants (package_version_id, key, label)
    values (${versionId}, ${key}, ${`${key} variant`})
    returning id`
  return one(rows).id
}

async function confirmVersion(versionId: string, userId: string): Promise<void> {
  await testSql`
    update scenario_package_versions
    set confirmed_at = now(), confirmed_by = ${userId}, status = 'confirmed'
    where id = ${versionId}`
}

async function insertClaim(versionId: string): Promise<void> {
  await testSql`
    insert into scenario_claims
      (package_version_id, key, text, source_kind, importance, consequence_level,
       verification_cost, concept_key, position)
    values
      (${versionId}, 'C1', 'Churn is 4% monthly.', 'assistant', 'load_bearing', 'high',
       'cheap', 'unit_economics', 1)`
}

async function seedConfirmedVersion() {
  const organizationId = await createOrganization()
  const userId = await createUser()
  const packageId = await createPackage(organizationId, userId)
  const versionId = await createVersion(organizationId, packageId, 1)
  const documentId = await createDocument(versionId)
  await confirmVersion(versionId, userId)
  return { organizationId, userId, packageId, versionId, documentId }
}

describe('package_frozen trigger family', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('accepts element writes and the confirmation itself while the version is a draft', async () => {
    const organizationId = await createOrganization()
    const userId = await createUser()
    const packageId = await createPackage(organizationId, userId)
    const versionId = await createVersion(organizationId, packageId, 1)
    const documentId = await createDocument(versionId)

    await testSql`update scenario_documents set body = 'Edited body.' where id = ${documentId}`
    await insertClaim(versionId)
    await confirmVersion(versionId, userId)

    const [row] = await testSql<{ confirmed_at: Date | null; status: string }[]>`
      select confirmed_at, status from scenario_package_versions where id = ${versionId}`
    expect(row?.confirmed_at).toBeInstanceOf(Date)
    expect(row?.status).toBe('confirmed')
  })

  it('refuses to update a document under a confirmed version', async () => {
    const { documentId } = await seedConfirmedVersion()

    await expect(
      testSql`update scenario_documents set body = 'Edited body.' where id = ${documentId}`,
    ).rejects.toThrow(/VERSION_FROZEN/)
  })

  it('refuses to delete a document under a confirmed version', async () => {
    const { documentId } = await seedConfirmedVersion()

    await expect(testSql`delete from scenario_documents where id = ${documentId}`).rejects.toThrow(
      /VERSION_FROZEN/,
    )
  })

  it('refuses to change frozen columns of a confirmed version', async () => {
    const { versionId } = await seedConfirmedVersion()

    await expect(
      testSql`update scenario_package_versions set brief = 'A new brief.' where id = ${versionId}`,
    ).rejects.toThrow(/VERSION_FROZEN/)
    await expect(
      testSql`update scenario_package_versions set confirmed_at = null where id = ${versionId}`,
    ).rejects.toThrow(/VERSION_FROZEN/)
  })

  it('lets status, review_requested_at and review_reason change after confirmation', async () => {
    const { versionId } = await seedConfirmedVersion()

    await testSql`
      update scenario_package_versions set status = 'retired' where id = ${versionId}`
    await testSql`
      update scenario_package_versions
      set review_requested_at = now(), review_reason = 'Stale supplier figures.'
      where id = ${versionId}`

    const [row] = await testSql<
      { status: string; review_reason: string | null; review_requested_at: Date | null }[]
    >`
      select status, review_reason, review_requested_at
      from scenario_package_versions where id = ${versionId}`
    expect(row).toMatchObject({ status: 'retired', review_reason: 'Stale supplier figures.' })
    expect(row?.review_requested_at).toBeInstanceOf(Date)
  })

  it('refuses to insert a claim under a confirmed version', async () => {
    const { versionId } = await seedConfirmedVersion()

    await expect(insertClaim(versionId)).rejects.toThrow(/VERSION_FROZEN/)
  })

  it('refuses variant_claim_states writes through the variant of a confirmed version', async () => {
    const organizationId = await createOrganization()
    const userId = await createUser()
    const packageId = await createPackage(organizationId, userId)
    const versionId = await createVersion(organizationId, packageId, 1)
    const variantId = await createVariant(versionId, 'sound')
    await insertClaim(versionId)
    const claimId = one(
      await testSql<IdRow>`
        select id from scenario_claims where package_version_id = ${versionId}`,
    ).id
    await confirmVersion(versionId, userId)

    await expect(
      testSql`
        insert into variant_claim_states (variant_id, claim_id, evidence_status, warranted_stance)
        values (${variantId}, ${claimId}, 'sound', 'accept')`,
    ).rejects.toThrow(/VERSION_FROZEN/)
  })

  it('caps seed_text at 200,000 characters', async () => {
    const organizationId = await createOrganization()
    const userId = await createUser()
    const packageId = await createPackage(organizationId, userId)
    const versionId = await createVersion(organizationId, packageId, 1)

    await expect(
      testSql`
        insert into seed_records
          (package_version_id, case_title, publisher, license_terms, license_permits_adaptation, seed_text)
        values
          (${versionId}, 'Case', 'Publisher', 'Terms', true, ${'x'.repeat(200_001)})`,
    ).rejects.toThrow(/seed_records_seed_text_length_check/)
  })
})

describe('assignments_variant_matches_version trigger (deferred from Step 2.2, D-163)', () => {
  afterEach(async () => {
    await truncateAll()
  })

  async function seedCourseAndTwoVersions() {
    const organizationId = await createOrganization()
    const userId = await createUser()
    const packageId = await createPackage(organizationId, userId)
    const versionOneId = await createVersion(organizationId, packageId, 1)
    const versionTwoId = await createVersion(organizationId, packageId, 2)
    const variantOneId = await createVariant(versionOneId, 'defective')
    const variantTwoId = await createVariant(versionTwoId, 'defective')

    const courseId = one(
      await testSql<IdRow>`
        insert into courses (organization_id, name, term, outside_ai_policy, mapping, created_by)
        values
          (${organizationId}, 'Marketing Strategy', '2026-fall', 'declared',
           '{"novice":1,"developing":2,"proficient":3,"professional":4}'::jsonb, ${userId})
        returning id`,
    ).id
    const sectionId = one(
      await testSql<IdRow>`
        insert into sections (organization_id, course_id, name)
        values (${organizationId}, ${courseId}, 'Section A')
        returning id`,
    ).id

    return { organizationId, sectionId, versionOneId, variantOneId, variantTwoId }
  }

  it('refuses an assignment whose variant belongs to another version', async () => {
    const { organizationId, sectionId, versionOneId, variantTwoId } =
      await seedCourseAndTwoVersions()

    await expect(
      testSql`
        insert into assignments (organization_id, section_id, label, package_version_id, variant_id)
        values (${organizationId}, ${sectionId}, 'Run 1', ${versionOneId}, ${variantTwoId})`,
    ).rejects.toThrow(/VARIANT_VERSION_MISMATCH/)
  })

  it('accepts an assignment whose variant belongs to its version', async () => {
    const { organizationId, sectionId, versionOneId, variantOneId } =
      await seedCourseAndTwoVersions()

    const rows = await testSql<IdRow>`
      insert into assignments (organization_id, section_id, label, package_version_id, variant_id)
      values (${organizationId}, ${sectionId}, 'Run 1', ${versionOneId}, ${variantOneId})
      returning id`
    expect(one(rows).id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
