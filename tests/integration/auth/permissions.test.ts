// Step 3.2 — the permission helpers of docs/tech/08-auth-authz.md §5, allow and deny cases for each,
// against the test database. The matrix test that walks 08 §4 endpoint by endpoint is
// tests/integration/auth/matrix.test.ts; this file proves the helpers those endpoints call.
//
// One role per account (D-748): Student, Scenario Editor, Instructor, Platform Admin. Memberships
// say where a person is — which institution, which section roster — and never what they may do.
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
  /** Created the course and teaches its section. */
  instructor: UserRow
  /** An Instructor of institution A who runs no course there. */
  otherInstructor: UserRow
  student1: UserRow
  student2: UserRow
  /** A Scenario Editor of institution A, also on the section roster. */
  editor: UserRow
  admin: UserRow
  /** An Instructor of institution B. */
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

  const instructor = await f.createUser('perm-instructor', { platformRole: 'instructor' })
  const otherInstructor = await f.createUser('perm-instructor-2', { platformRole: 'instructor' })
  const student1 = await f.createUser('perm-student-1')
  const student2 = await f.createUser('perm-student-2')
  const editor = await f.createUser('perm-editor', { platformRole: 'tassl_scenario_editor' })
  const admin = await f.createUser('perm-admin', { platformRole: 'admin' })
  const outsider = await f.createUser('perm-outsider', { platformRole: 'instructor' })

  for (const person of [instructor, otherInstructor, student1, student2, editor]) {
    await f.addMember(a.organization.id, person.id)
  }
  await f.addMember(b.organization.id, outsider.id)

  const course = await f.createCourse(a.organization.id, 'perm-course', {
    createdBy: instructor.id,
  })
  const section = await f.createSection(a.organization.id, course.id, 'perm-section')
  for (const person of [instructor, student1, student2, editor]) {
    await f.addSectionMember(a.organization.id, section.id, person.id)
  }

  const pkg = await f.createPackageVersion(a.organization.id, 'perm-pkg', {
    createdBy: editor.id,
  })
  const assignment = await f.createAssignment(a.organization.id, section.id, 'perm-assignment', {
    packageVersionId: pkg.version.id,
    variantId: pkg.defective.id,
  })

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
    otherInstructor,
    student1,
    student2,
    editor,
    admin,
    outsider,
    courseId: course.id,
    sectionId: section.id,
    packageId: pkg.pkg.id,
    runId,
  }
}

describe('permission helpers (08 §5, D-748)', () => {
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
    it('resolves the actor behind a real session cookie, with its one role', async () => {
      const headers = await asUser(fx.instructor.id, { activeOrganizationId: fx.orgA })
      await expect(permissions.requireSession(headers)).resolves.toMatchObject({
        id: fx.instructor.id,
        email: fx.instructor.email,
        platformRole: 'instructor',
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

    it('stores nothing but the four roles', async () => {
      await expect(
        testSql`update "user" set platform_role = 'none' where id = ${fx.student2.id}`,
      ).rejects.toThrow(/user_platform_role_check/)
      await expect(
        testSql`update "member" set role = 'instructor' where user_id = ${fx.instructor.id}`,
      ).rejects.toThrow(/member_role_is_membership/)
    })
  })

  describe('requirePlatformRole and requireAnyRole', () => {
    it('allows the exact role and lets the admin satisfy every check', () => {
      expect(permissions.requirePlatformRole(actorOf(fx.editor), 'tassl_scenario_editor')).toBe(
        'tassl_scenario_editor',
      )
      expect(permissions.requirePlatformRole(actorOf(fx.admin), 'tassl_scenario_editor')).toBe(
        'admin',
      )
      expect(permissions.requireAnyRole(actorOf(fx.student1), permissions.LEARNER_ROLES)).toBe(
        'student',
      )
    })

    it('denies every other role', async () => {
      expect(
        await codeOf(async () => permissions.requirePlatformRole(actorOf(fx.student1), 'admin')),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(async () =>
          permissions.requireAnyRole(actorOf(fx.instructor), permissions.LEARNER_ROLES),
        ),
      ).toBe('FORBIDDEN')
    })
  })

  describe('requireMembership', () => {
    it('returns the platform role of a member, and narrows it when roles are given', async () => {
      await expect(permissions.requireMembership(actorOf(fx.instructor), fx.orgA)).resolves.toBe(
        'instructor',
      )
      await expect(
        permissions.requireMembership(actorOf(fx.editor), fx.orgA, ['tassl_scenario_editor']),
      ).resolves.toBe('tassl_scenario_editor')
    })

    it('denies a non-member and a member holding a role outside the list', async () => {
      expect(await codeOf(() => permissions.requireMembership(actorOf(fx.outsider), fx.orgA))).toBe(
        'FORBIDDEN',
      )
      expect(
        await codeOf(() =>
          permissions.requireMembership(actorOf(fx.student1), fx.orgA, ['instructor']),
        ),
      ).toBe('FORBIDDEN')
    })

    it('admits the platform admin to every institution that exists, and none that does not', async () => {
      await expect(permissions.requireMembership(actorOf(fx.admin), fx.orgA)).resolves.toBe('admin')
      expect(await codeOf(() => permissions.requireMembership(actorOf(fx.admin), UNKNOWN_ID))).toBe(
        'NOT_FOUND',
      )
    })
  })

  describe('requireSectionSeat', () => {
    it('returns the scope carrying the organization of the section itself', async () => {
      await expect(
        permissions.requireSectionSeat(
          actorOf(fx.student1),
          fx.sectionId,
          permissions.LEARNER_ROLES,
        ),
      ).resolves.toEqual({ sectionId: fx.sectionId, role: 'student', organizationId: fx.orgA })
      await expect(
        permissions.requireSectionSeat(actorOf(fx.admin), fx.sectionId, permissions.LEARNER_ROLES),
      ).resolves.toMatchObject({ role: 'admin', organizationId: fx.orgA })
    })

    it('denies the wrong role or no roster row with FORBIDDEN, and an outsider with NOT_FOUND', async () => {
      // An Instructor on the roster teaches the section; they do not take runs on it.
      expect(
        await codeOf(() =>
          permissions.requireSectionSeat(
            actorOf(fx.instructor),
            fx.sectionId,
            permissions.LEARNER_ROLES,
          ),
        ),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(() =>
          permissions.requireSectionSeat(
            actorOf(fx.otherInstructor),
            fx.sectionId,
            permissions.TEACHING_ROLES,
          ),
        ),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(() =>
          permissions.requireSectionSeat(
            actorOf(fx.outsider),
            fx.sectionId,
            permissions.TEACHING_ROLES,
          ),
        ),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() =>
          permissions.requireSectionSeat(actorOf(fx.outsider), UNKNOWN_ID, ['instructor']),
        ),
      ).toBe('NOT_FOUND')
    })
  })

  describe('requireCourseInstructor', () => {
    it('allows the Instructor who runs the course, and the admin', async () => {
      await expect(
        permissions.requireCourseInstructor(actorOf(fx.instructor), fx.courseId),
      ).resolves.toEqual({ courseId: fx.courseId, organizationId: fx.orgA })
      await expect(
        permissions.requireCourseInstructor(actorOf(fx.admin), fx.courseId),
      ).resolves.toEqual({ courseId: fx.courseId, organizationId: fx.orgA })
    })

    it('denies an Instructor who does not run it, and a learner on its roster, with FORBIDDEN', async () => {
      expect(
        await codeOf(() =>
          permissions.requireCourseInstructor(actorOf(fx.otherInstructor), fx.courseId),
        ),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(() => permissions.requireCourseInstructor(actorOf(fx.editor), fx.courseId)),
      ).toBe('FORBIDDEN')
    })

    it('stops admitting a creator whose role is no longer Instructor (D-516)', async () => {
      const demoted = { ...actorOf(fx.instructor), platformRole: 'student' as const }
      expect(await codeOf(() => permissions.requireCourseInstructor(demoted, fx.courseId))).toBe(
        'FORBIDDEN',
      )
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
    it('allows the learner the run belongs to, and the admin', async () => {
      await expect(
        permissions.requireRunOwner(actorOf(fx.student1), fx.runId),
      ).resolves.toMatchObject({
        runId: fx.runId,
        studentId: fx.student1.id,
        sectionId: fx.sectionId,
        organizationId: fx.orgA,
      })
      await expect(permissions.requireRunOwner(actorOf(fx.admin), fx.runId)).resolves.toMatchObject(
        { studentId: fx.student1.id },
      )
    })

    it('hides a run belonging to someone else, and an unknown run, behind NOT_FOUND', async () => {
      expect(await codeOf(() => permissions.requireRunOwner(actorOf(fx.student2), fx.runId))).toBe(
        'NOT_FOUND',
      )
      expect(
        await codeOf(() => permissions.requireRunOwner(actorOf(fx.instructor), fx.runId)),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() => permissions.requireRunOwner(actorOf(fx.student1), UNKNOWN_ID)),
      ).toBe('NOT_FOUND')
    })
  })

  describe('requireRunReviewer and requireRunInstructor', () => {
    it('allows the Instructor of the section and the admin', async () => {
      for (const actor of [actorOf(fx.instructor), actorOf(fx.admin)]) {
        await expect(permissions.requireRunReviewer(actor, fx.runId)).resolves.toMatchObject({
          runId: fx.runId,
        })
        await expect(permissions.requireRunInstructor(actor, fx.runId)).resolves.toMatchObject({
          runId: fx.runId,
        })
      }
    })

    it('denies the owning learner with FORBIDDEN and every other seat with NOT_FOUND', async () => {
      expect(
        await codeOf(() => permissions.requireRunReviewer(actorOf(fx.student1), fx.runId)),
      ).toBe('FORBIDDEN')
      // A classmate, a Scenario Editor on the roster, an Instructor of another course, a stranger.
      for (const seat of [fx.student2, fx.editor, fx.otherInstructor, fx.outsider]) {
        expect(await codeOf(() => permissions.requireRunReviewer(actorOf(seat), fx.runId))).toBe(
          'NOT_FOUND',
        )
      }
    })
  })

  describe('requireAuthorOnPackage and requirePackageReader', () => {
    it('lets the Scenario Editor author, and the Instructor only read', async () => {
      await expect(
        permissions.requireAuthorOnPackage(actorOf(fx.editor), fx.packageId),
      ).resolves.toEqual({
        packageId: fx.packageId,
        organizationId: fx.orgA,
        role: 'tassl_scenario_editor',
      })
      await expect(
        permissions.requirePackageReader(actorOf(fx.instructor), fx.packageId),
      ).resolves.toMatchObject({ role: 'instructor' })
      expect(
        await codeOf(() =>
          permissions.requireAuthorOnPackage(actorOf(fx.instructor), fx.packageId),
        ),
      ).toBe('FORBIDDEN')
      await expect(
        permissions.requireAuthorOnPackage(actorOf(fx.admin), fx.packageId),
      ).resolves.toMatchObject({ role: 'admin' })
    })

    it('denies a Student of the same organization both, and answers NOT_FOUND outside it', async () => {
      expect(
        await codeOf(() => permissions.requirePackageReader(actorOf(fx.student1), fx.packageId)),
      ).toBe('FORBIDDEN')
      expect(
        await codeOf(() => permissions.requirePackageReader(actorOf(fx.outsider), fx.packageId)),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() => permissions.requireAuthorOnPackage(actorOf(fx.editor), UNKNOWN_ID)),
      ).toBe('NOT_FOUND')
    })
  })
})
