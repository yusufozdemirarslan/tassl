// Step 13.5 — the `admin` service against Postgres (docs/tech/10-backend-spec-modules.md §16;
// SYS-006, UI-050, D-016, D-007).
//
// Four claims, and three of them need a database to mean anything:
//
//   * **Every function refuses anybody who is not a platform admin.** The screens hide themselves
//     from a student and the layout answers 404, but neither is the fence: the fence is
//     `requirePlatformRole(actor, 'admin')` as the first statement of each function, and the only
//     way to prove it is to call each one as a student and as a scenario editor.
//   * **A role change writes three things or none.** The role, the revocation of that person's
//     sessions, and the `role.set` audit row commit together (08 §5): a session that outlives a
//     demotion carries the old seat until it expires, and a revocation nobody can trace is worse
//     than either. It is also *that* person's sessions and nobody else's.
//   * **A role change is refused on the actor's own row** (D-571): the revocation would end the
//     session the change is being made from.
//   * **The audit list filters by institution**, and the flags read `effectiveLlmProvider()`.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

type Factories = typeof import('@tests/factories')
type Admin = typeof import('@/server/modules/admin')
type Tx = typeof import('@/server/db/tx')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let f: Factories
let admin: Admin
let tx: Tx

let adminUser: UserRow
let student: UserRow
let editor: UserRow
let orgA: string
let orgB: string

function actorOf(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified,
    activeOrganizationId: null,
    platformRole: row.platform_role as PlatformRole,
  }
}

/** A live session row for `userId`; sessions are Better Auth's table, so they are written directly. */
async function giveSession(userId: string, token: string): Promise<void> {
  await testSql`
    insert into "session" (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
    values (${`session-${token}`}, now() + interval '30 days', ${token}, now(), now(),
            '198.18.0.1', 'test', ${userId})`
}

const sessionCount = async (userId: string): Promise<number> => {
  const rows = await testSql<{ count: string }[]>`
    select count(*)::text as count from "session" where user_id = ${userId}`
  return Number(rows[0]?.count ?? '0')
}

/** The code an AppError carried, or the error itself when it was not one. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (isAppError(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal, and the call returned')
}

describe('admin service', () => {
  beforeEach(async () => {
    await truncateAll()
    f = await import('@tests/factories')
    admin = await import('@/server/modules/admin')
    tx = await import('@/server/db/tx')

    adminUser = await f.createUser('platform-admin', {
      platformRole: 'admin',
      email: 'aa-admin@tassl.local',
    })
    editor = await f.createUser('platform-editor', {
      platformRole: 'tassl_scenario_editor',
      email: 'bb-editor@tassl.local',
    })
    student = await f.createUser('plain-student', { email: 'cc-student@tassl.local' })

    orgA = (await f.createInstitution('admin-a')).organization.id
    orgB = (await f.createInstitution('admin-b')).organization.id
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe('every function is platform-admin only', () => {
    it('refuses a student and a scenario editor on all four', async () => {
      for (const seat of [student, editor]) {
        const actor = actorOf(seat)
        expect(await codeOf(() => admin.listUsers(actor))).toBe('FORBIDDEN')
        expect(await codeOf(() => admin.listAuditLog(actor))).toBe('FORBIDDEN')
        expect(await codeOf(() => admin.listInstitutions(actor))).toBe('FORBIDDEN')
        expect(await codeOf(async () => admin.getFlags(actor))).toBe('FORBIDDEN')
        expect(
          await codeOf(() =>
            admin.setPlatformRole(actor, { userId: student.id, role: 'tassl_scenario_editor' }),
          ),
        ).toBe('FORBIDDEN')
      }
    })
  })

  describe('listUsers', () => {
    it('lists every account and filters on an email prefix', async () => {
      const page = await admin.listUsers(actorOf(adminUser))
      expect(page.items.map((row) => row.email).sort()).toEqual([
        'aa-admin@tassl.local',
        'bb-editor@tassl.local',
        'cc-student@tassl.local',
      ])

      const filtered = await admin.listUsers(actorOf(adminUser), { q: 'bb-' })
      expect(filtered.items.map((row) => row.email)).toEqual(['bb-editor@tassl.local'])
      expect(filtered.nextCursor).toBeNull()

      // The prefix is matched literally: a LIKE metacharacter is not a wildcard.
      const escaped = await admin.listUsers(actorOf(adminUser), { q: '%' })
      expect(escaped.items).toEqual([])
    })

    it('pages, and the cursor carries the filter', async () => {
      const first = await admin.listUsers(actorOf(adminUser), { limit: 2 })
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).not.toBeNull()
      const second = await admin.listUsers(actorOf(adminUser), {
        limit: 2,
        cursor: first.nextCursor!,
      })
      expect(second.items).toHaveLength(1)
      const seen = [...first.items, ...second.items].map((row) => row.id)
      expect(new Set(seen).size).toBe(3)
    })
  })

  describe('setPlatformRole', () => {
    it('sets the role, revokes that person’s sessions, and audits the change', async () => {
      await giveSession(student.id, 'student-one')
      await giveSession(student.id, 'student-two')
      await giveSession(editor.id, 'editor-one')

      const saved = await admin.setPlatformRole(actorOf(adminUser), {
        userId: student.id,
        role: 'tassl_scenario_editor',
      })
      expect(saved.platformRole).toBe('tassl_scenario_editor')

      const rows = await testSql<{ platform_role: string }[]>`
        select platform_role from "user" where id = ${student.id}`
      expect(rows[0]?.platform_role).toBe('tassl_scenario_editor')

      // Their sessions, and only theirs.
      expect(await sessionCount(student.id)).toBe(0)
      expect(await sessionCount(editor.id)).toBe(1)

      const audit = await testSql<
        { action: string; actor_id: string; target_id: string; metadata: Record<string, unknown> }[]
      >`select action, actor_id, target_id, metadata from audit_logs order by created_at desc`
      expect(audit).toHaveLength(1)
      expect(audit[0]?.action).toBe('role.set')
      expect(audit[0]?.actor_id).toBe(adminUser.id)
      expect(audit[0]?.target_id).toBe(student.id)
      expect(audit[0]?.metadata).toMatchObject({
        from: 'none',
        to: 'tassl_scenario_editor',
        sessionsRevoked: 2,
      })
    })

    it('refuses the actor’s own row and changes nothing', async () => {
      await giveSession(adminUser.id, 'admin-one')
      expect(
        await codeOf(() =>
          admin.setPlatformRole(actorOf(adminUser), { userId: adminUser.id, role: 'none' }),
        ),
      ).toBe('ROLE_INVALID')

      const rows = await testSql<{ platform_role: string }[]>`
        select platform_role from "user" where id = ${adminUser.id}`
      expect(rows[0]?.platform_role).toBe('admin')
      expect(await sessionCount(adminUser.id)).toBe(1)
      const audit = await testSql`select 1 from audit_logs`
      expect(audit).toHaveLength(0)
    })

    it('refuses a value outside the three roles', async () => {
      expect(
        await codeOf(() =>
          admin.setPlatformRole(actorOf(adminUser), {
            userId: student.id,
            // The route and the action validate first; this is the service's own guard.
            role: 'superuser' as never,
          }),
        ),
      ).toBe('ROLE_INVALID')
    })

    it('is NOT_FOUND for an unknown id and for a deleted account', async () => {
      expect(
        await codeOf(() =>
          admin.setPlatformRole(actorOf(adminUser), { userId: 'nobody', role: 'admin' }),
        ),
      ).toBe('NOT_FOUND')

      await testSql`update "user" set deleted_at = now() where id = ${student.id}`
      await giveSession(student.id, 'ghost')
      expect(
        await codeOf(() =>
          admin.setPlatformRole(actorOf(adminUser), { userId: student.id, role: 'admin' }),
        ),
      ).toBe('NOT_FOUND')
      // Nothing was written on the way to the refusal.
      expect(await sessionCount(student.id)).toBe(1)
    })
  })

  describe('listAuditLog', () => {
    beforeEach(async () => {
      await tx.withTransaction(async (t) => {
        await admin.audit(t, {
          actorId: adminUser.id,
          orgId: orgA,
          action: 'export.write',
          targetType: 'run',
          targetId: 'run-a',
        })
        await admin.audit(t, {
          actorId: adminUser.id,
          orgId: orgB,
          action: 'mapping.change',
          targetType: 'course',
          targetId: 'course-b',
        })
        await admin.audit(t, {
          actorId: null,
          orgId: null,
          action: 'account.delete',
          targetType: 'user',
          targetId: 'someone',
        })
      })
    })

    it('lists every row newest first, and filters by institution', async () => {
      const all = await admin.listAuditLog(actorOf(adminUser))
      expect(all.items).toHaveLength(3)

      const a = await admin.listAuditLog(actorOf(adminUser), { orgId: orgA })
      expect(a.items.map((row) => row.action)).toEqual(['export.write'])
      expect(a.items[0]?.organizationId).toBe(orgA)

      const b = await admin.listAuditLog(actorOf(adminUser), { orgId: orgB })
      expect(b.items.map((row) => row.action)).toEqual(['mapping.change'])
    })

    it('carries the system actor and the platform row as nulls', async () => {
      const all = await admin.listAuditLog(actorOf(adminUser))
      const platform = all.items.find((row) => row.action === 'account.delete')
      expect(platform?.actorId).toBeNull()
      expect(platform?.organizationId).toBeNull()
      expect(platform?.requestId).toBe('system')
    })

    it('offers every institution to the filter', async () => {
      const institutions = await admin.listInstitutions(actorOf(adminUser))
      expect(institutions.map((row) => row.id).sort()).toEqual([orgA, orgB].sort())
    })
  })

  describe('getFlags', () => {
    it('answers the three flags and the provider the run loop would call', async () => {
      const config = await import('@/server/config')
      const flags = await admin.getFlags(actorOf(adminUser))
      expect(flags).toEqual({
        ai: config.env.FEATURE_AI,
        sampleData: config.env.FEATURE_SAMPLE_DATA,
        testControls: config.env.FEATURE_TEST_CONTROLS,
        effectiveLlmProvider: config.effectiveLlmProvider(),
        // Step 14.5: nothing has been spent in this suite, and the two ceilings are the environment's
        // (D-065). A mock call would not move these — the sums count what was billed (D-651).
        llmUsage: {
          today: { calls: 0, tokens: 0, costUsd: 0 },
          month: { calls: 0, tokens: 0, costUsd: 0 },
          budgets: {
            userDaily: config.env.LLM_USER_DAILY_TOKEN_BUDGET,
            globalMonthly: config.env.LLM_GLOBAL_MONTHLY_TOKEN_BUDGET,
          },
        },
      })
      // FEATURE_AI is off in the test environment, so the effective provider is the mock whatever
      // LLM_PROVIDER says — which is the whole reason the screen shows this and not the variable.
      expect(flags.ai).toBe(false)
      expect(flags.effectiveLlmProvider).toBe('mock')
    })
  })
})
