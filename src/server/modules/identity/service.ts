// Service of the `identity` module (docs/tech/10-backend-spec-modules.md §1): the current user,
// the profile, the data export, account deletion, and the purge job behind them (SYS-003, SYS-004,
// NFR-009, D-093, D-112).
//
// Every function takes the actor first and opens with `requireActiveUser(actor)`, the module's own
// permission statement: identity has no resource to authorize beyond the person themselves, and the
// one way to lose that permission is the soft delete (`USER_DELETED`, 08 §2.6).
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { auth } from '@/server/auth/auth'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { getLogger } from '@/server/http/request-context'
import { createMemoryRateLimiter, type RateLimiter } from '@/server/rate-limit/memory'
import { createPostgresRateLimiter } from '@/server/rate-limit/sliding-window'
import { audit } from '@/server/modules/admin'
// `/me/assignments` is the courses module's list behind an identity route (10 §3
// `listMyAssignments`), so it is called through that module's public interface. `/me/runs` was the
// same debt in reverse (D-173) and is now the runs module's own route: identity holds nothing about
// a run, so there is nothing left here to serve it through.
import { listMyAssignments as listAssignmentsForActor } from '@/server/modules/courses'
import { exportRateLimited, userDeleted } from './errors'
import {
  anonymizeUserReferences,
  countUserReferences,
  createPlaceholderUser,
  deleteMemberships,
  deleteNotifications,
  deletePendingInvitations,
  deleteSectionMemberships,
  deleteSessions,
  deleteUser,
  findPlaceholderUser,
  findUserById,
  listAuditEntriesForActor,
  listDeletedBefore,
  listMembershipsForUser,
  listNotificationsForUser,
  listOrganizationIds,
  listSectionMembershipsForUser,
  repointUserReferences,
  softDeleteUser,
  updateProfile as updateProfileRow,
  withTransaction,
  type MembershipRow,
  type Page,
  type User,
} from './repository'
import { PURGE_AFTER_DAYS, purgeCutoff } from './retention'
import {
  organizationRoleSchema,
  platformRoleSchema,
  sectionRoleSchema,
  type Capabilities,
  type MeView,
  type Membership,
  type OrganizationRole,
  type PageQuery,
  type PlatformRole,
  type SectionRole,
  type StudentAssignment,
  type UpdateProfileInput,
  type UserExport,
} from './schema'

// ---------------------------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------------------------

/**
 * The identity module's permission helper. `getSession` already refuses a soft-deleted user (08
 * §2.6), so this is the write-time re-check: it closes the window between the session read and the
 * statement, and hands back the live row every function below needs anyway.
 */
async function requireActiveUser(actor: SessionUser): Promise<User> {
  const row = await findUserById(actor.id)
  if (!row) throw new AppError('NOT_FOUND', t('identity.accountNotFound'))
  if (row.deleted_at !== null) throw userDeleted()
  return row
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const iso = (value: Date): string => value.toISOString()
const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null)

/**
 * Better Auth's built-in `owner`, `admin`, and `member` organization roles are not used for people
 * (08 §3), so a `member` row that carries one is shown as the least-privileged seat rather than
 * dropped: the person still sees the institution, and no capability is granted by a role we do not
 * recognize.
 */
function toOrganizationRole(role: string): OrganizationRole {
  const parsed = organizationRoleSchema.safeParse(role)
  return parsed.success ? parsed.data : 'student'
}

function toSectionRole(role: string): SectionRole {
  const parsed = sectionRoleSchema.safeParse(role)
  return parsed.success ? parsed.data : 'student'
}

function toPlatformRole(role: string): PlatformRole {
  const parsed = platformRoleSchema.safeParse(role)
  return parsed.success ? parsed.data : 'none'
}

function toMembership(row: MembershipRow): Membership {
  return {
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    role: toOrganizationRole(row.role),
    joinedAt: iso(row.joinedAt),
  }
}

/** Which panels the shell renders (08 §5 "UI"); the service check is what actually enforces them. */
function capabilitiesFor(platformRole: PlatformRole, memberships: Membership[]): Capabilities {
  const roles = new Set(memberships.map((m) => m.role))
  return {
    canTakeRuns: roles.has('student'),
    canReviewRuns: roles.has('instructor') || roles.has('teaching_assistant'),
    canAuthorPackages: roles.has('instructor') || roles.has('scenario_author'),
    canManageInstitution: roles.has('program_lead') || platformRole === 'admin',
    canCreateInstitution: platformRole === 'admin',
  }
}

function toMeView(row: User, actor: SessionUser, membershipRows: MembershipRow[]): MeView {
  const memberships = membershipRows.map(toMembership)
  const platformRole = toPlatformRole(row.platform_role)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    createdAt: iso(row.createdAt),
    platformRole,
    memberships,
    activeOrganizationId: actor.activeOrganizationId,
    capabilities: capabilitiesFor(platformRole, memberships),
  }
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * The institution an audit row is attributed to: the session's active organization when it has one,
 * otherwise the first the person belongs to. Someone with no membership has none.
 */
function resolveTenant(actor: SessionUser, memberships: MembershipRow[]): string | null {
  if (actor.activeOrganizationId) return actor.activeOrganizationId
  return memberships[0]?.organizationId ?? null
}

export async function getCurrentUser(actor: SessionUser): Promise<MeView> {
  const row = await requireActiveUser(actor)
  const memberships = await listMembershipsForUser(actor.id)
  return toMeView(row, actor, memberships)
}

/**
 * Assignments in the actor's sections with their latest attempt (07-api-spec.md §3). The list is
 * the courses module's (10 §3 `listMyAssignments`); identity adds the one thing it owns, the check
 * that the account is still live, and serves it under `/me`.
 */
export async function listMyAssignments(
  actor: SessionUser,
  input: PageQuery = {},
): Promise<Page<StudentAssignment>> {
  await requireActiveUser(actor)
  return listAssignmentsForActor(actor, input)
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export async function updateProfile(
  actor: SessionUser,
  input: UpdateProfileInput,
): Promise<MeView> {
  await requireActiveUser(actor)
  const row = await withTransaction((tx) => updateProfileRow(actor.id, { name: input.name }, tx))
  const memberships = await listMembershipsForUser(actor.id)
  return toMeView(row, actor, memberships)
}

// Two downloads an hour per account (08 §2.9). The bucket is `auth`, but its window is an hour
// rather than the minute the wrappers enforce, so it is its own limiter instance: memory under
// APP_ENV=test, the Postgres sliding window everywhere else, exactly like getRateLimiter() (D-164).
//
// Caveat to fix with the limiter, not here: `createPostgresRateLimiter` sweeps
// `rate_limit_buckets` of rows older than three of *its own* windows, so the 60-second instance the
// wrappers use deletes this hour-long bucket a few minutes into every hour and the count restarts.
// The cap still holds against a burst; making it hold for the full hour needs the sweep in
// src/server/rate-limit/sliding-window.ts to keep the window size it is deleting for.
const EXPORTS_PER_HOUR = 2
const HOUR_MS = 60 * 60 * 1000
let exportLimiter: RateLimiter | undefined

function getExportLimiter(): RateLimiter {
  exportLimiter ??=
    env.APP_ENV === 'test' ? createMemoryRateLimiter(HOUR_MS) : createPostgresRateLimiter(HOUR_MS)
  return exportLimiter
}

/** Everything Tassl holds about the person, as the file `/settings/data` downloads (SYS-004). */
export async function exportUserData(actor: SessionUser): Promise<UserExport> {
  const row = await requireActiveUser(actor)

  const decision = await getExportLimiter().hit(`auth:me-export:${actor.id}`, EXPORTS_PER_HOUR)
  if (!decision.allowed) {
    getLogger().warn(
      { event: 'rate_limit', bucket: 'auth', limit: EXPORTS_PER_HOUR },
      'data export rate limit exceeded',
    )
    throw exportRateLimited(decision.retryAfterSeconds)
  }

  const [memberships, notifications, auditEntries] = await Promise.all([
    listMembershipsForUser(actor.id),
    listNotificationsForUser(actor.id),
    listAuditEntriesForActor(actor.id),
  ])
  // Enrolments are read one institution at a time: every **T** table is tenant-scoped (D-006).
  const sectionMemberships = (
    await Promise.all(
      memberships.map((m) => listSectionMembershipsForUser(m.organizationId, actor.id)),
    )
  ).flat()

  return {
    exportedAt: iso(new Date()),
    profile: {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      platformRole: toPlatformRole(row.platform_role),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    },
    memberships: memberships.map(toMembership),
    sectionMemberships: sectionMemberships.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      courseId: s.courseId,
      courseName: s.courseName,
      organizationId: s.organizationId,
      role: toSectionRole(s.role),
      joinedAt: iso(s.joinedAt),
    })),
    // Record-form run exports arrive with the record module (Phase 10, FR-192).
    runs: [],
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: isoOrNull(n.readAt),
      createdAt: iso(n.createdAt),
    })),
    auditLog: auditEntries.map((a) => ({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      organizationId: a.organizationId,
      createdAt: iso(a.createdAt),
    })),
  }
}

/**
 * The soft delete (08 §2.9, D-093): the account stops working immediately — `deleted_at` is what
 * `getSession` reads — and the purge job removes the person 30 days later. Memberships and pending
 * invitations go now, so no institution keeps a seat for someone who left.
 */
export async function requestAccountDeletion(
  actor: SessionUser,
  options: { headers?: Headers } = {},
): Promise<void> {
  const row = await requireActiveUser(actor)
  const memberships = await listMembershipsForUser(actor.id)
  const organizationId = resolveTenant(actor, memberships)

  await withTransaction(async (tx) => {
    const deleted = await softDeleteUser(actor.id, new Date(), tx)
    // A concurrent DELETE won: the first one did the work and wrote the audit row.
    if (!deleted) return
    for (const membership of memberships) {
      await deleteSectionMemberships(membership.organizationId, actor.id, tx)
    }
    await deleteMemberships(actor.id, tx)
    await deletePendingInvitations(row.email, tx)
    await audit(tx, {
      actorId: actor.id,
      orgId: organizationId,
      action: 'account.delete',
      targetType: 'user',
      targetId: actor.id,
      metadata: { purgeAfterDays: PURGE_AFTER_DAYS },
    })
  })

  await revokeEverySession(actor, options.headers)
}

/**
 * Better Auth owns session revocation, so the request's own headers drive it; the sweep afterwards
 * is what guarantees the outcome when there are none (a Bearer caller, a job) or when the endpoint
 * refuses. Both are idempotent.
 */
async function revokeEverySession(actor: SessionUser, headers?: Headers): Promise<void> {
  if (headers) {
    try {
      await auth.api.revokeSessions({ headers })
    } catch (error) {
      getLogger().warn(
        { event: 'session_revoke_failed', err: error },
        'auth.api.revokeSessions failed; falling back to the session sweep',
      )
    }
  }
  await withTransaction((tx) => deleteSessions(actor.id, tx))
}

// ---------------------------------------------------------------------------------------------
// Purge job (NFR-009, D-093, D-112, D-167)
// ---------------------------------------------------------------------------------------------

/**
 * Removes every account soft-deleted more than `PURGE_AFTER_DAYS` ago. Per user, in one
 * transaction: every institution is asked whether it still names the person, each one that does
 * gets its `deleted-user@<slug>` seat (created on demand) and has its run rows, trace events, and
 * audit rows moved onto it, the append-only rows that belong to no institution lose the actor
 * entirely, the personal rows go, and the user row with its accounts, sessions, and verification
 * tokens is deleted.
 *
 * One account that cannot be purged — a reference no re-pointing rule covers yet — is logged and
 * skipped rather than failing the daily job for everyone else.
 */
export async function purgeDeletedAccounts(now: Date = new Date()): Promise<{ purged: number }> {
  const candidates = await listDeletedBefore(purgeCutoff(now))
  let purged = 0

  for (const candidate of candidates) {
    try {
      await withTransaction(async (tx) => {
        for (const orgId of await listOrganizationIds(tx)) {
          await deleteSectionMemberships(orgId, candidate.id, tx)
          // Only an institution that still names the person needs a placeholder seat.
          if ((await countUserReferences(orgId, candidate.id, tx)) === 0) continue
          const placeholder =
            (await findPlaceholderUser(orgId, tx)) ?? (await createPlaceholderUser(orgId, tx))
          await repointUserReferences(orgId, candidate.id, placeholder.id, tx)
        }
        await anonymizeUserReferences(candidate.id, tx)
        await deleteMemberships(candidate.id, tx)
        await deleteNotifications(candidate.id, tx)
        await deletePendingInvitations(candidate.email, tx)
        await deleteUser(candidate.id, tx)
      })
      purged += 1
    } catch (error) {
      getLogger().error(
        { event: 'purge_failed', err: error },
        'account could not be purged; it stays for the next run',
      )
    }
  }

  getLogger().info(
    { event: 'purge_deleted_accounts', purged, candidates: candidates.length },
    'purge completed',
  )
  return { purged }
}
