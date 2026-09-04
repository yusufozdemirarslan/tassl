// Step 3.2 — the permission helpers of docs/tech/08-auth-authz.md §5, one allow case and one deny
// case each, against the test database. The matrix test that walks 08 §4 endpoint by endpoint
// arrives in Step 3.6; this file proves the helpers those endpoints will call.
//
// Deny cases assert the error *code*, because 08 §4 distinguishes them: a resource in another
// organization answers NOT_FOUND (an id must not be probeable for existence) while a member of the
// right organization holding the wrong role answers FORBIDDEN.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

type Permissions = typeof import('@/server/auth/permissions')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let permissions: Permissions
let f: Factories

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** The actor a route or action would hand a helper, built from a factory user row. */
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

/** The AppError code a call rejects with, or 'resolved' when it does not reject. */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
    return 'resolved'
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

type Fixture = {
  orgA: string
  orgB: string
  instructor: UserRow
  ta: UserRow
  student1: UserRow
  student2: UserRow
  author: UserRow
  lead: UserRow
  editor: UserRow
  admin: UserRow
  outsider: UserRow
  courseId: string
  sectionId: string
  packageId: string
  runId: string
}

let fx: Fixture

async function buildFixture(): Promise<Fixture> {
  const a = await f.createInstitution('perm-a')
  const b = await f.createInstitution('perm-b')

  const instructor = await f.createUser('perm-instructor')
  const ta = await f.createUser('perm-ta')
  const student1 = await f.createUser('perm-student-1')
  const student2 = await f.createUser('perm-student-2')
  const author = await f.createUser('perm-author')
  const lead = await f.createUser('perm-lead')
  const editor = await f.createUser('perm-editor', { platformRole: 'tassl_scenario_editor' })
  const admin = await f.createUser('perm-admin', { platformRole: 'admin' })
  const outsider = await f.createUser('perm-outsider')

  await f.addMember(a.organization.id, instructor.id, 'instructor')
  await f.addMember(a.organization.id, ta.id, 'teaching_assistant')
  await f.addMember(a.organization.id, student1.id, 'student')
  await f.addMember(a.organization.id, student2.id, 'student')
  await f.addMember(a.organization.id, author.id, 'scenario_author')
  await f.addMember(a.organization.id, lead.id, 'program_lead')
  await f.addMember(b.organization.id, outsider.id, 'instructor')

  const course = await f.createCourse(a.organization.id, 'perm-course', {
    createdBy: instructor.id,
  })
  const section = await f.createSection(a.organization.id, course.id, 'perm-section')
  await f.addSectionMember(a.organization.id, section.id, instructor.id, 'instructor')
  await f.addSectionMember(a.organization.id, section.id, ta.id, 'ta')
  await f.addSectionMember(a.organization.id, section.id, student1.id, 'student')
  await f.addSectionMember(a.organization.id, section.id, student2.id, 'student')

  const pkg = await f.createPackageVersion(a.organization.id, 'perm-pkg', {
    createdBy: instructor.id,
  })
  const assignment = await f.createAssignment(a.organization.id, section.id, 'perm-assignment', {
    packageVersionId: pkg.version.id,
    variantId: pkg.defective.id,
  })

  // The runs module lands in Phase 6; the row itself exists from Phase 2, so the run guards are
  // exercised against a real run rather than only against their NOT_FOUND path.
  const runId = crypto.randomUUID()
  await testSql`
    insert into runs (id, organization_id, assignment_id, student_id, package_version_id,
      variant_id, working_clock_seconds, turn_delay_seconds)
    values (${runId}, ${a.organization.id}, ${assignment.id}, ${student1.id}, ${pkg.version.id},
      ${pkg.defective.id}, 5400, 120)`

  return {
    orgA: a.organization.id,
    orgB: b.organization.id,
    instructor,
    ta,
    student1,
    student2,
    author,
    lead,
    editor,
    admin,
    outsider,
    courseId: course.id,
    sectionId: section.id,
    packageId: pkg.pkg.id,
    runId,
  }
}

describe('permission helpers (08 §5)', () => {
  beforeAll(async () => {
    await truncateAll()
    permissions = await import('@/server/auth/permissions')
    f = await import('@tests/factories')
    fx = await buildFixture()
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe('requireSession', () => {
    it('resolves the actor behind a real session cookie and rejects an anonymous request', async () => {
      const headers = await asUser(fx.instructor.id, { activeOrganizationId: fx.orgA })
      await expect(permissions.requireSession(headers)).resolves.toMatchObject({
        id: fx.instructor.id,
        email: fx.instructor.email,
        platformRole: 'none',
        activeOrganizationId: fx.orgA,
      })
      expect(await codeOf(() => permissions.requireSession(new Headers()))).toBe('UNAUTHENTICATED')
    })

    it('treats a soft-deleted user as signed out (08 §2.6)', async () => {
      const headers = await asUser(fx.student2.id)
      await expect(permissions.getSession(headers)).resolves.not.toBeNull()

      await testSql`update "user" set deleted_at = now() where id = ${fx.student2.id}`
      await expect(permissions.getSession(headers)).resolves.toBeNull()
      expect(await codeOf(() => permissions.requireSession(headers))).toBe('UNAUTHENTICATED')
      await testSql`update "user" set deleted_at = null where id = ${fx.student2.id}`
    })
  })

  describe('requirePlatformRole', () => {
    it('allows the exact role and lets admin satisfy every check', () => {
      expect(permissions.requirePlatformRole(actorOf(fx.editor), 'tassl_scenario_editor')).toBe(
        'tassl_scenario_editor',
      )
      expect(permissions.requirePlatformRole(actorOf(fx.admin), 'tassl_scenario_editor')).toBe(
        'admin',
      )
      expect(permissions.requirePlatformRole(actorOf(fx.admin), 'admin')).toBe('admin')
    })

    it('denies a platform-roleless user', async () => {
      expect(
        await codeOf(async () => permissions.requirePlatformRole(actorOf(fx.student1), 'admin')),
      ).toBe('FORBIDDEN')
    })
  })

  describe('requireMembership', () => {
    it('returns the organization role, and narrows it when roles are given', async () => {
      await expect(permissions.requireMembership(actorOf(fx.instructor), fx.orgA)).resolves.toBe(
        'instructor',
      )
      await expect(
        permissions.requireMembership(actorOf(fx.lead), fx.orgA, ['program_lead']),
      ).resolves.toBe('program_lead')
    })

    it('denies a non-member and a member holding a role outside the list', async () => {
      expect(await codeOf(() => permissions.requireMembership(actorOf(fx.outsider), fx.orgA))).toBe(
        'FORBIDDEN',
      )
      expect(
        await codeOf(() =>
          permissions.requireMembership(actorOf(fx.instructor), fx.orgA, ['program_lead']),
        ),
      ).toBe('FORBIDDEN')
    })

    it('does not treat the platform admin as a member of every institution', async () => {
      expect(await codeOf(() => permissions.requireMembership(actorOf(fx.admin), fx.orgA))).toBe(
        'FORBIDDEN',
      )
    })
  })

  describe('requireSectionRole', () => {
    it('returns the scope carrying the organization of the section itself', async () => {
      await expect(
        permissions.requireSectionRole(actorOf(fx.instructor), fx.sectionId, ['instructor']),
      ).resolves.toEqual({
        sectionId: fx.sectionId,
        role: 'instructor',
        organizationId: fx.orgA,
      })
      await expect(
        permissions.requireSectionRole(actorOf(fx.ta), fx.sectionId, ['instructor', 'ta']),
      ).resolves.toMatchObject({ role: 'ta' })
    })

    it('denies the wrong role and a user with no membership on the section', async () => {
      expect(
        await codeOf(() =>
          permissions.requireSectionRole(actorOf(fx.student1), fx.sectionId, ['instructor']),
        ),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(() =>
          permissions.requireSectionRole(actorOf(fx.outsider), fx.sectionId, ['instructor', 'ta']),
        ),
      ).toBe('FORBIDDEN')
    })
  })

  describe('requireCourseInstructor', () => {
    it('allows the creator and a section instructor', async () => {
      await expect(
        permissions.requireCourseInstructor(actorOf(fx.instructor), fx.courseId),
      ).resolves.toEqual({ courseId: fx.courseId, organizationId: fx.orgA })
    })

    it('denies a TA of the course with FORBIDDEN', async () => {
      expect(
        await codeOf(() => permissions.requireCourseInstructor(actorOf(fx.ta), fx.courseId)),
      ).toBe('FORBIDDEN')
    })

    it('answers NOT_FOUND for a course in another organization and for an unknown id', async () => {
      expect(
        await codeOf(() => permissions.requireCourseInstructor(actorOf(fx.outsider), fx.courseId)),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() => permissions.requireCourseInstructor(actorOf(fx.instructor), UNKNOWN_ID)),
      ).toBe('NOT_FOUND')
    })
  })

  describe('requireRunOwner', () => {
    it('allows the student the run belongs to', async () => {
      await expect(
        permissions.requireRunOwner(actorOf(fx.student1), fx.runId),
      ).resolves.toMatchObject({
        runId: fx.runId,
        studentId: fx.student1.id,
        sectionId: fx.sectionId,
        organizationId: fx.orgA,
      })
    })

    it('hides a run belonging to another student, and an unknown run, behind NOT_FOUND', async () => {
      expect(await codeOf(() => permissions.requireRunOwner(actorOf(fx.student2), fx.runId))).toBe(
        'NOT_FOUND',
      )
      expect(
        await codeOf(() => permissions.requireRunOwner(actorOf(fx.student1), UNKNOWN_ID)),
      ).toBe('NOT_FOUND')
    })
  })

  describe('requireRunReviewer and requireRunInstructor', () => {
    it('allows the section instructor and the TA to review, only the instructor to decide', async () => {
      await expect(
        permissions.requireRunReviewer(actorOf(fx.instructor), fx.runId),
      ).resolves.toMatchObject({ runId: fx.runId })
      await expect(permissions.requireRunReviewer(actorOf(fx.ta), fx.runId)).resolves.toMatchObject(
        { runId: fx.runId },
      )
      await expect(
        permissions.requireRunInstructor(actorOf(fx.instructor), fx.runId),
      ).resolves.toMatchObject({ runId: fx.runId })
    })

    it('denies the TA the instructor-only guard and the owning student the reviewer guard', async () => {
      expect(await codeOf(() => permissions.requireRunInstructor(actorOf(fx.ta), fx.runId))).toBe(
        'FORBIDDEN',
      )
      expect(
        await codeOf(() => permissions.requireRunReviewer(actorOf(fx.student1), fx.runId)),
      ).toBe('FORBIDDEN')
    })

    it('answers NOT_FOUND for someone with no membership on the section of the run', async () => {
      expect(
        await codeOf(() => permissions.requireRunReviewer(actorOf(fx.outsider), fx.runId)),
      ).toBe('NOT_FOUND')
    })
  })

  describe('requireAuthorOnPackage', () => {
    it('allows an instructor and a scenario author in the organization owning the package', async () => {
      await expect(
        permissions.requireAuthorOnPackage(actorOf(fx.instructor), fx.packageId),
      ).resolves.toEqual({
        packageId: fx.packageId,
        organizationId: fx.orgA,
        role: 'instructor',
      })
      await expect(
        permissions.requireAuthorOnPackage(actorOf(fx.author), fx.packageId),
      ).resolves.toMatchObject({ role: 'scenario_author' })
    })

    it('denies a student of the same organization', async () => {
      expect(
        await codeOf(() => permissions.requireAuthorOnPackage(actorOf(fx.student1), fx.packageId)),
      ).toBe('FORBIDDEN')
    })

    it('answers NOT_FOUND for a platform editor without a membership there, and for an unknown id', async () => {
      expect(
        await codeOf(() => permissions.requireAuthorOnPackage(actorOf(fx.editor), fx.packageId)),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() => permissions.requireAuthorOnPackage(actorOf(fx.instructor), UNKNOWN_ID)),
      ).toBe('NOT_FOUND')
    })
  })

  describe('canReadIdentifiedRecords', () => {
    it('is false for anyone who is not a platform scenario editor (D-055)', async () => {
      await expect(
        permissions.canReadIdentifiedRecords(actorOf(fx.instructor), fx.orgA),
      ).resolves.toBe(false)
      await expect(permissions.canReadIdentifiedRecords(actorOf(fx.admin), fx.orgA)).resolves.toBe(
        false,
      )
    })

    it('is false for an editor while the institution has no agreement', async () => {
      await expect(permissions.canReadIdentifiedRecords(actorOf(fx.editor), fx.orgA)).resolves.toBe(
        false,
      )
      expect(
        await codeOf(() => permissions.requireIdentifiedRecordsAccess(actorOf(fx.editor), fx.orgA)),
      ).toBe('FORBIDDEN')
    })
  })
})
