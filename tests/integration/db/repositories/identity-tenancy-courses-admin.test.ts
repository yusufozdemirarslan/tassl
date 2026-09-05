// Step 2.8 (D-006): insert-and-read pairs for the identity, tenancy, courses, and admin
// repositories against the test database, and the tenant filter on every tenant-scoped read (a
// read with another tenantId returns nothing). Parents are created with testSql; the repositories
// run on the app's `db`, which is pointed at TEST_DATABASE_URL before it is imported.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, testSql, truncateAll } from '@tests/setup/integration'

process.env.DATABASE_URL = TEST_DATABASE_URL

type Identity = typeof import('@/server/modules/identity/repository')
type Tenancy = typeof import('@/server/modules/tenancy/repository')
type Courses = typeof import('@/server/modules/courses/repository')
type Admin = typeof import('@/server/modules/admin/repository')
type Client = typeof import('@/server/db/client')

let identity: Identity
let tenancy: Tenancy
let courses: Courses
let admin: Admin
let client: Client['client']

type IdRow = { id: string }

const DAY_MS = 24 * 60 * 60 * 1000

function first<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('expected at least one row')
  return row
}

async function createOrganization(): Promise<{ orgId: string; slug: string }> {
  const orgId = crypto.randomUUID()
  const slug = `org-${orgId}`
  await testSql`
    insert into organization (id, name, slug, created_at)
    values (${orgId}, 'Walkthrough University', ${slug}, now())`
  return { orgId, slug }
}

async function createUser(name = 'Seat One'): Promise<string> {
  const userId = crypto.randomUUID()
  await testSql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, ${name}, ${`${userId}@example.test`}, true, now(), now())`
  return userId
}

type Tenant = { orgId: string; slug: string; userId: string }

async function createTenant(): Promise<Tenant> {
  const { orgId, slug } = await createOrganization()
  const userId = await createUser()
  return { orgId, slug, userId }
}

type PackageRows = { packageId: string; versionId: string; variantId: string }

async function createPackage(orgId: string, userId: string): Promise<PackageRows> {
  const packageId = first(
    await testSql<IdRow[]>`
      insert into scenario_packages (organization_id, title, family_key, created_by)
      values (${orgId}, 'Northwind Launch', ${`northwind-${crypto.randomUUID()}`}, ${userId})
      returning id`,
  ).id
  const versionId = first(
    await testSql<IdRow[]>`
      insert into scenario_package_versions (organization_id, package_id, version, concept_set)
      values (${orgId}, ${packageId}, 1,
        '{unit_economics,segmentation,pricing,channel_fit}'::text[])
      returning id`,
  ).id
  const variantId = first(
    await testSql<IdRow[]>`
      insert into scenario_variants (package_version_id, key, label)
      values (${versionId}, 'defective', 'Defective')
      returning id`,
  ).id
  return { packageId, versionId, variantId }
}

type RunOptions = { attemptNo?: number; state?: string }

async function createRun(
  orgId: string,
  assignmentId: string,
  studentId: string,
  pkg: PackageRows,
  options: RunOptions = {},
): Promise<string> {
  const attemptNo = options.attemptNo ?? 1
  const state = options.state ?? 'assigned'
  return first(
    await testSql<IdRow[]>`
      insert into runs (organization_id, assignment_id, student_id, package_version_id, variant_id,
        attempt_no, state, working_clock_seconds, turn_delay_seconds)
      values (${orgId}, ${assignmentId}, ${studentId}, ${pkg.versionId}, ${pkg.variantId},
        ${attemptNo}, ${state}::run_state, 1500, 90)
      returning id`,
  ).id
}

/** organization → user → course → section → package → assignment, all through the repositories. */
async function createCourseChain(tenant: Tenant) {
  const course = await courses.insertCourse(tenant.orgId, {
    name: 'Managerial Decisions',
    term: '2026-fall',
    createdBy: tenant.userId,
  })
  const section = await courses.insertSection(tenant.orgId, {
    courseId: course.id,
    name: 'Section A',
  })
  const pkg = await createPackage(tenant.orgId, tenant.userId)
  const assignment = await courses.insertAssignment(tenant.orgId, {
    sectionId: section.id,
    label: 'Decision Run 1',
    packageVersionId: pkg.versionId,
    variantId: pkg.variantId,
  })
  return { course, section, pkg, assignment }
}

beforeAll(async () => {
  ;[identity, tenancy, courses, admin] = await Promise.all([
    import('@/server/modules/identity/repository'),
    import('@/server/modules/tenancy/repository'),
    import('@/server/modules/courses/repository'),
    import('@/server/modules/admin/repository'),
  ])
  client = (await import('@/server/db/client')).client
})

afterAll(async () => {
  await client.end({ timeout: 5 })
})

afterEach(async () => {
  await truncateAll()
})

describe('identity repository', () => {
  it('finds a user by id and returns null for an unknown id', async () => {
    const userId = await createUser()
    const found = await identity.findUserById(userId)
    expect(found?.id).toBe(userId)
    expect(found?.platform_role).toBe('none')
    expect(await identity.findUserById(crypto.randomUUID())).toBeNull()
  })

  it('creates the per-organization placeholder user once and finds it by the org slug', async () => {
    const { orgId, slug } = await createOrganization()
    expect(await identity.findPlaceholderUser(orgId)).toBeNull()

    const created = await identity.createPlaceholderUser(orgId)
    expect(created.email).toBe(`deleted-user@${slug}.tassl.local`)
    expect(created.name).toBe(identity.PLACEHOLDER_USER_NAME)

    const again = await identity.createPlaceholderUser(orgId)
    expect(again.id).toBe(created.id)

    const found = await identity.findPlaceholderUser(orgId)
    expect(found?.id).toBe(created.id)

    const other = await createOrganization()
    expect(await identity.findPlaceholderUser(other.orgId)).toBeNull()
  })

  it('throws NOT_FOUND when the organization of a placeholder does not exist', async () => {
    await expect(identity.createPlaceholderUser(crypto.randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('lists users soft-deleted before the cut-off only', async () => {
    const old = await createUser('Old Delete')
    const recent = await createUser('Recent Delete')
    const live = await createUser('Live')
    const now = Date.now()
    await testSql`
      update "user" set deleted_at = ${new Date(now - 40 * DAY_MS)} where id = ${old}`
    await testSql`
      update "user" set deleted_at = ${new Date(now - 1 * DAY_MS)} where id = ${recent}`

    const due = await identity.listDeletedBefore(new Date(now - 30 * DAY_MS))
    expect(due.map((u) => u.id)).toEqual([old])
    expect(due.map((u) => u.id)).not.toContain(live)
  })

  it('re-points run, trace, and audit references within one organization only', async () => {
    const tenant = await createTenant()
    const { pkg, assignment } = await createCourseChain(tenant)
    const runId = await createRun(tenant.orgId, assignment.id, tenant.userId, pkg)
    await testSql`
      insert into run_events (run_id, seq, type, occurred_at, actor_id, payload)
      values (${runId}, 1, 'lifecycle', now(), ${tenant.userId}, '{}'::jsonb)`
    await admin.insertAuditLog({
      organizationId: tenant.orgId,
      actorId: tenant.userId,
      action: 'run.void',
      targetType: 'run',
      targetId: runId,
      requestId: 'req-1',
    })
    // The same user in a second organization must be left alone.
    const other = await createOrganization()
    const otherTenant = { orgId: other.orgId, slug: other.slug, userId: tenant.userId }
    const otherChain = await createCourseChain(otherTenant)
    const otherRunId = await createRun(
      other.orgId,
      otherChain.assignment.id,
      tenant.userId,
      otherChain.pkg,
    )

    const placeholder = await identity.createPlaceholderUser(tenant.orgId)
    const counts = await identity.repointUserReferences(tenant.orgId, tenant.userId, placeholder.id)
    expect(counts).toEqual({ runs: 1, runEvents: 1, auditLogs: 1 })

    const run = first(
      await testSql<{ student_id: string }[]>`
      select student_id from runs where id = ${runId}`,
    )
    expect(run.student_id).toBe(placeholder.id)
    const event = first(
      await testSql<{ actor_id: string }[]>`
      select actor_id from run_events where run_id = ${runId}`,
    )
    expect(event.actor_id).toBe(placeholder.id)
    const audit = first(
      await testSql<{ actor_id: string }[]>`
      select actor_id from audit_logs where target_id = ${runId}`,
    )
    expect(audit.actor_id).toBe(placeholder.id)
    const untouched = first(
      await testSql<{ student_id: string }[]>`
      select student_id from runs where id = ${otherRunId}`,
    )
    expect(untouched.student_id).toBe(tenant.userId)
  })

  it('deletes the user with its sessions, accounts, and verification rows', async () => {
    const userId = await createUser()
    const email = `${userId}@example.test`
    await testSql`
      insert into session (id, expires_at, token, created_at, updated_at, user_id)
      values (${crypto.randomUUID()}, now() + interval '1 day', ${`tok-${userId}`}, now(), now(), ${userId})`
    await testSql`
      insert into account (id, issuer, account_id, provider_id, user_id, created_at, updated_at)
      values (${crypto.randomUUID()}, 'credential', ${userId}, 'credential', ${userId}, now(), now())`
    await testSql`
      insert into verification (id, identifier, value, expires_at, created_at, updated_at)
      values (${crypto.randomUUID()}, ${email}, 'code', now() + interval '1 hour', now(), now())`

    const deleted = await identity.deleteUser(userId)
    expect(deleted?.id).toBe(userId)
    expect(await identity.findUserById(userId)).toBeNull()
    for (const table of ['session', 'account'] as const) {
      const [row] = await testSql<{ n: number }[]>`
        select count(*)::int as n from ${testSql(table)} where user_id = ${userId}`
      expect(row?.n, table).toBe(0)
    }
    const [verificationRow] = await testSql<{ n: number }[]>`
      select count(*)::int as n from verification where identifier = ${email}`
    expect(verificationRow?.n).toBe(0)
    expect(await identity.deleteUser(userId)).toBeNull()
  })
})

describe('tenancy repository', () => {
  it('upserts institution settings and reads them back per tenant', async () => {
    const { orgId } = await createOrganization()
    const created = await tenancy.upsertSettings(orgId, {})
    expect(created).toMatchObject({
      organizationId: orgId,
      plan: 'pilot',
      defaultMapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
    })

    const updated = await tenancy.upsertSettings(orgId, { plan: 'department' })
    expect(updated.plan).toBe('department')
    expect(updated.defaultMapping).toEqual(created.defaultMapping)

    const mapping = { novice: 2, developing: 4, proficient: 6, professional: 8 }
    const remapped = await tenancy.upsertSettings(orgId, { defaultMapping: mapping })
    expect(remapped).toMatchObject({ plan: 'department', defaultMapping: mapping })

    expect((await tenancy.findSettings(orgId))?.plan).toBe('department')
    const other = await createOrganization()
    expect(await tenancy.findSettings(other.orgId)).toBeNull()
  })

  it('inserts, lists, updates, and soft-deletes agreements within the tenant', async () => {
    const { orgId } = await createOrganization()
    const other = await createOrganization()
    const base = {
      counterparty: 'Walkthrough University',
      permittedPlatformRoles: ['tassl_scenario_editor'],
      purposes: ['scoring_audit'] as const,
      retentionDays: 365,
      documentReference: 'DSA-2026-001',
      signedAt: new Date('2026-01-15T00:00:00Z'),
    }

    const inserted = await tenancy.upsertAgreement(orgId, { ...base, purposes: [...base.purposes] })
    expect(inserted).toMatchObject({ organizationId: orgId, retentionDays: 365, endsAt: null })
    expect(inserted?.recordTypesCovered).toEqual([
      'run_records',
      'defense_transcripts',
      'debriefs',
      'instructor_decisions',
    ])
    if (!inserted) throw new Error('insert returned null')

    expect((await tenancy.listAgreements(orgId)).map((a) => a.id)).toEqual([inserted.id])
    expect(await tenancy.listAgreements(other.orgId)).toEqual([])
    expect((await tenancy.findActiveAgreement(orgId))?.id).toBe(inserted.id)
    expect(await tenancy.findActiveAgreement(other.orgId)).toBeNull()

    const updated = await tenancy.upsertAgreement(orgId, {
      ...base,
      id: inserted.id,
      purposes: ['scoring_audit', 'drift_review'],
      retentionDays: 730,
    })
    expect(updated).toMatchObject({
      id: inserted.id,
      retentionDays: 730,
      purposes: ['scoring_audit', 'drift_review'],
    })

    // Another tenant cannot rewrite the row through its id.
    const hijack = await tenancy.upsertAgreement(other.orgId, {
      ...base,
      id: inserted.id,
      purposes: ['scenario_calibration'],
      retentionDays: 1,
    })
    expect(hijack).toBeNull()
    expect((await tenancy.findActiveAgreement(orgId))?.retentionDays).toBe(730)

    expect(await tenancy.softDeleteAgreement(other.orgId, inserted.id)).toBeNull()
    const deleted = await tenancy.softDeleteAgreement(orgId, inserted.id)
    expect(deleted?.deletedAt).toBeInstanceOf(Date)
    expect(await tenancy.softDeleteAgreement(orgId, inserted.id)).toBeNull()
    expect(await tenancy.listAgreements(orgId)).toEqual([])
    expect(await tenancy.findActiveAgreement(orgId)).toBeNull()
  })

  it('does not treat an ended agreement as active and prefers the newest signature', async () => {
    const { orgId } = await createOrganization()
    const shared = {
      counterparty: 'Walkthrough University',
      permittedPlatformRoles: ['tassl_scenario_editor'],
      purposes: ['scoring_audit'],
      retentionDays: 365,
      documentReference: 'DSA-2026-001',
    }
    await tenancy.upsertAgreement(orgId, {
      ...shared,
      purposes: ['scoring_audit'],
      signedAt: new Date('2024-01-01T00:00:00Z'),
      endsAt: new Date('2025-01-01T00:00:00Z'),
    })
    expect(await tenancy.findActiveAgreement(orgId)).toBeNull()

    const older = await tenancy.upsertAgreement(orgId, {
      ...shared,
      purposes: ['scoring_audit'],
      signedAt: new Date('2025-06-01T00:00:00Z'),
    })
    const newer = await tenancy.upsertAgreement(orgId, {
      ...shared,
      purposes: ['scoring_audit'],
      signedAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date(Date.now() + 365 * DAY_MS),
    })
    expect(older).not.toBeNull()
    expect((await tenancy.findActiveAgreement(orgId))?.id).toBe(newer?.id)
  })
})

describe('courses repository', () => {
  it('inserts, finds, lists, and updates courses within the tenant', async () => {
    const tenant = await createTenant()
    const other = await createTenant()
    const course = await courses.insertCourse(tenant.orgId, {
      name: 'Managerial Decisions',
      term: '2026-fall',
      createdBy: tenant.userId,
    })
    expect(course).toMatchObject({
      organizationId: tenant.orgId,
      outsideAiPolicy: 'declared',
      defaultRunWeight: '2.500',
    })

    expect((await courses.findCourse(tenant.orgId, course.id))?.id).toBe(course.id)
    expect(await courses.findCourse(other.orgId, course.id)).toBeNull()
    expect((await courses.listCoursesForOrg(tenant.orgId)).map((c) => c.id)).toEqual([course.id])
    expect(await courses.listCoursesForOrg(other.orgId)).toEqual([])

    expect(await courses.updateCourse(other.orgId, course.id, { name: 'Hijacked' })).toBeNull()
    const updated = await courses.updateCourse(tenant.orgId, course.id, {
      outsideAiPolicy: 'in_environment_only',
      taughtConcepts: ['unit_economics'],
    })
    expect(updated).toMatchObject({
      name: 'Managerial Decisions',
      outsideAiPolicy: 'in_environment_only',
      taughtConcepts: ['unit_economics'],
    })

    await testSql`update courses set deleted_at = now() where id = ${course.id}`
    expect(await courses.findCourse(tenant.orgId, course.id)).toBeNull()
    expect(await courses.listCoursesForOrg(tenant.orgId)).toEqual([])
  })

  it('lists the courses a student belongs to through section memberships', async () => {
    const tenant = await createTenant()
    const student = await createUser('Student')
    const { course, section } = await createCourseChain(tenant)
    await courses.insertCourse(tenant.orgId, {
      name: 'Other Course',
      term: '2026-fall',
      createdBy: tenant.userId,
    })
    expect(await courses.listCoursesForStudent(tenant.orgId, student)).toEqual([])

    const membership = await courses.upsertSectionMembership(tenant.orgId, {
      sectionId: section.id,
      userId: student,
      role: 'student',
    })
    expect(membership).toMatchObject({ sectionId: section.id, userId: student, role: 'student' })
    expect((await courses.listCoursesForStudent(tenant.orgId, student)).map((c) => c.id)).toEqual([
      course.id,
    ])
    const other = await createTenant()
    expect(await courses.listCoursesForStudent(other.orgId, student)).toEqual([])
  })

  it('records mapping changes for the course', async () => {
    const tenant = await createTenant()
    const { course } = await createCourseChain(tenant)
    const change = await courses.insertMappingChange(tenant.orgId, {
      courseId: course.id,
      oldMapping: course.mapping,
      newMapping: { novice: 0, developing: 2, proficient: 3, professional: 4 },
      changedBy: tenant.userId,
      affectedRunIds: [],
    })
    expect(change).toMatchObject({
      organizationId: tenant.orgId,
      courseId: course.id,
      oldMapping: course.mapping,
      affectedRunIds: [],
    })
  })

  it('lists confirmed and recorded runs of a course with their score rows', async () => {
    const tenant = await createTenant()
    const student = await createUser('Student')
    const { course, pkg, assignment } = await createCourseChain(tenant)
    const confirmed = await createRun(tenant.orgId, assignment.id, student, pkg, {
      state: 'confirmed',
    })
    const recorded = await createRun(tenant.orgId, assignment.id, student, pkg, {
      attemptNo: 2,
      state: 'recorded',
    })
    await createRun(tenant.orgId, assignment.id, student, pkg, { attemptNo: 3, state: 'working' })
    await testSql`
      insert into run_scores (run_id, rubric_version, graphs, points_effective, scored_at)
      values (${confirmed}, 'v1', '{}'::jsonb, 3.000, now())`

    const rows = await courses.listConfirmedRunsForCourse(tenant.orgId, course.id)
    expect(rows.map((r) => r.run.id).sort()).toEqual([confirmed, recorded].sort())
    const scored = rows.find((r) => r.run.id === confirmed)
    expect(scored?.assignment.id).toBe(assignment.id)
    expect(scored?.score?.pointsEffective).toBe('3.000')
    expect(rows.find((r) => r.run.id === recorded)?.score).toBeNull()

    const other = await createTenant()
    expect(await courses.listConfirmedRunsForCourse(other.orgId, course.id)).toEqual([])
  })

  it('manages the section roster: upsert, list, and delete memberships', async () => {
    const tenant = await createTenant()
    const other = await createTenant()
    const { section } = await createCourseChain(tenant)
    const student = await createUser('Student')

    await courses.upsertSectionMembership(tenant.orgId, {
      sectionId: section.id,
      userId: student,
      role: 'student',
    })
    const promoted = await courses.upsertSectionMembership(tenant.orgId, {
      sectionId: section.id,
      userId: student,
      role: 'ta',
    })
    expect(promoted?.role).toBe('ta')

    const roster = await courses.listSectionMembers(tenant.orgId, section.id)
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({
      membership: { userId: student, role: 'ta' },
      user: { id: student, name: 'Student', email: `${student}@example.test` },
    })
    expect(await courses.listSectionMembers(other.orgId, section.id)).toEqual([])

    expect(await courses.deleteSectionMembership(other.orgId, section.id, student)).toBeNull()
    const removed = await courses.deleteSectionMembership(tenant.orgId, section.id, student)
    expect(removed?.userId).toBe(student)
    expect(await courses.listSectionMembers(tenant.orgId, section.id)).toEqual([])
  })

  it('inserts, updates, and resolves an assignment with its context', async () => {
    const tenant = await createTenant()
    const other = await createTenant()
    const { course, section, pkg, assignment } = await createCourseChain(tenant)
    expect(assignment).toMatchObject({
      organizationId: tenant.orgId,
      runType: 'decision',
      isWalkthrough: false,
      workingClockSeconds: null,
    })

    expect(await courses.updateAssignment(other.orgId, assignment.id, { label: 'X' })).toBeNull()
    const updated = await courses.updateAssignment(tenant.orgId, assignment.id, {
      label: 'Decision Run 1 (walkthrough)',
      isWalkthrough: true,
      workingClockSeconds: 1200,
    })
    expect(updated).toMatchObject({
      label: 'Decision Run 1 (walkthrough)',
      isWalkthrough: true,
      workingClockSeconds: 1200,
    })

    const context = await courses.findAssignmentWithContext(tenant.orgId, assignment.id)
    expect(context).toMatchObject({
      assignment: { id: assignment.id },
      section: { id: section.id },
      course: { id: course.id },
      packageVersion: { id: pkg.versionId, workingClockSeconds: 1500, turnDelaySeconds: 90 },
      variant: { id: pkg.variantId, key: 'defective' },
    })
    expect(await courses.findAssignmentWithContext(other.orgId, assignment.id)).toBeNull()

    await testSql`update assignments set deleted_at = now() where id = ${assignment.id}`
    expect(await courses.findAssignmentWithContext(tenant.orgId, assignment.id)).toBeNull()
    expect(await courses.updateAssignment(tenant.orgId, assignment.id, { label: 'Y' })).toBeNull()
  })

  it('pages the runs of an assignment with the student, variant, decisions and export version', async () => {
    const tenant = await createTenant()
    const student = await createUser('Student')
    const { pkg, assignment } = await createCourseChain(tenant)
    const exported = await createRun(tenant.orgId, assignment.id, student, pkg, {
      state: 'recorded',
    })
    const fresh = await createRun(tenant.orgId, assignment.id, student, pkg, { attemptNo: 2 })
    for (const version of [1, 2]) {
      await testSql`
        insert into course_exports (organization_id, run_id, assignment_id, version, file, reason)
        values (${tenant.orgId}, ${exported}, ${assignment.id}, ${version}, '{}'::jsonb, 'initial')`
    }

    const page = await courses.pageRunsForAssignment(tenant.orgId, assignment.id)
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBeNull()
    const byId = new Map(page.items.map((row) => [row.run.id, row]))
    expect(byId.get(exported)).toMatchObject({
      run: { attemptNo: 1, state: 'recorded' },
      student: { id: student, name: 'Student' },
      variant: { key: 'defective' },
      decisionsMade: 0,
      latestExportVersion: 2,
    })
    expect(byId.get(fresh)).toMatchObject({ run: { attemptNo: 2 }, latestExportVersion: null })

    const other = await createTenant()
    expect((await courses.pageRunsForAssignment(other.orgId, assignment.id)).items).toEqual([])
  })

  it('lists a student’s assignments with the latest attempt on each', async () => {
    const tenant = await createTenant()
    const student = await createUser('Student')
    const bystander = await createUser('Bystander')
    const { course, section, pkg, assignment } = await createCourseChain(tenant)
    const second = await courses.insertAssignment(tenant.orgId, {
      sectionId: section.id,
      label: 'Decision Run 2',
      packageVersionId: pkg.versionId,
      variantId: pkg.variantId,
    })
    await courses.upsertSectionMembership(tenant.orgId, {
      sectionId: section.id,
      userId: student,
      role: 'student',
    })
    await createRun(tenant.orgId, assignment.id, student, pkg, { state: 'voided' })
    const latest = await createRun(tenant.orgId, assignment.id, student, pkg, { attemptNo: 2 })
    // Another student's run on the same assignment must not leak into this student's list.
    await createRun(tenant.orgId, assignment.id, bystander, pkg, { attemptNo: 1 })

    const rows = await courses.listAssignmentsForStudent(tenant.orgId, student)
    expect(rows.map((r) => r.assignment.id).sort()).toEqual([assignment.id, second.id].sort())
    const withRun = rows.find((r) => r.assignment.id === assignment.id)
    expect(withRun).toMatchObject({
      section: { id: section.id },
      course: { id: course.id },
      membership: { userId: student, role: 'student' },
      latestRun: { id: latest, attemptNo: 2 },
    })
    expect(rows.find((r) => r.assignment.id === second.id)?.latestRun).toBeNull()

    expect(await courses.listAssignmentsForStudent(tenant.orgId, bystander)).toEqual([])
    const other = await createTenant()
    expect(await courses.listAssignmentsForStudent(other.orgId, student)).toEqual([])
  })
})

describe('admin repository', () => {
  it('writes audit rows and pages them newest first, optionally per organization', async () => {
    const { orgId } = await createOrganization()
    const other = await createOrganization()
    const actor = await createUser('Admin')
    const ids: string[] = []
    for (const [index, org] of [orgId, other.orgId, orgId].entries()) {
      const row = await admin.insertAuditLog({
        organizationId: org,
        actorId: actor,
        action: 'role.set',
        targetType: 'user',
        targetId: `target-${index}`,
        metadata: { index },
        requestId: `req-${index}`,
      })
      expect(row.metadata).toEqual({ index })
      ids.push(row.id)
      // Distinct created_at values keep the page order deterministic.
      await testSql`select pg_sleep(0.005)`
    }

    const all = await admin.listAuditLog({ limit: 10 })
    expect(all.items.map((r) => r.id)).toEqual([...ids].reverse())
    expect(all.nextCursor).toBeNull()

    const firstPage = await admin.listAuditLog({ limit: 2 })
    expect(firstPage.items).toHaveLength(2)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await admin.listAuditLog({ limit: 2, cursor: firstPage.nextCursor })
    expect(secondPage.items.map((r) => r.id)).toEqual([ids[0]])
    expect(secondPage.nextCursor).toBeNull()

    const scoped = await admin.listAuditLog({ orgId })
    expect(scoped.items.map((r) => r.targetId).sort()).toEqual(['target-0', 'target-2'])
    expect((await admin.listAuditLog({ orgId: other.orgId })).items).toHaveLength(1)
  })

  it('lists users by email prefix with cursor pagination', async () => {
    const ids: string[] = []
    for (const local of ['alpha', 'alpine', 'beta']) {
      const id = crypto.randomUUID()
      await testSql`
        insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${id}, ${local}, ${`${local}-${id}@example.test`}, true, now(), now())`
      ids.push(id)
      await testSql`select pg_sleep(0.005)`
    }

    const alp = await admin.listUsers({ q: 'ALP' })
    expect(alp.items.map((u) => u.name).sort()).toEqual(['alpha', 'alpine'])
    expect((await admin.listUsers({ q: 'alp_' })).items).toEqual([])
    expect((await admin.listUsers({ q: '%' })).items).toEqual([])

    const page = await admin.listUsers({ limit: 2 })
    expect(page.items.map((u) => u.id)).toEqual([ids[2], ids[1]])
    const rest = await admin.listUsers({ limit: 2, cursor: page.nextCursor })
    expect(rest.items.map((u) => u.id)).toEqual([ids[0]])
    expect(rest.nextCursor).toBeNull()
  })

  it('sets the platform role and returns null for an unknown user', async () => {
    const userId = await createUser()
    const updated = await admin.setPlatformRole(userId, 'tassl_scenario_editor')
    expect(updated?.platform_role).toBe('tassl_scenario_editor')
    expect((await identity.findUserById(userId))?.platform_role).toBe('tassl_scenario_editor')
    expect(await admin.setPlatformRole(crypto.randomUUID(), 'admin')).toBeNull()
  })
})
