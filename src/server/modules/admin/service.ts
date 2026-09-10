// Service of the `admin` module (docs/tech/10-backend-spec-modules.md §16): the four platform
// screens of UI-050 — user list, platform roles, flags, audit log — and `audit()`, the helper every
// module writes its audit row through (SYS-011).
//
// Every function here opens with `requirePlatformRole(actor, 'admin')`. The layout of `/admin`
// checks the same thing before it renders anything, but that check is a courtesy (08 §5 "UI"):
// this one is the enforcement, and it is what the API routes and the Server Action are held to.
//
// `audit()` takes the transaction rather than opening one: 08 §5 requires the audit row and the
// change it records to commit together, so the caller's `withTransaction` is the boundary.
import { AppError } from '@/lib/errors'
import { flagsFromEnv } from '@/lib/flags'
import { t } from '@/lib/i18n/t'
import { requirePlatformRole } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { effectiveLlmProvider, env } from '@/server/config'
import { getRequestContext } from '@/server/http/request-context'
import { AI_MODE_KEY, effectiveAssistantMode, readAiMode, writeAiMode } from '@/server/llm/ai-mode'
import { budgetLimits, startOfUtcDay, startOfUtcMonth } from '@/server/llm/guardrails/budgets'
import { captureOpsTestEvent } from '@/server/logging/ops-events'
import {
  deleteSessionsOfUser,
  findUserById,
  insertAuditLog,
  listAuditLog as listAuditLogRows,
  listInstitutions as listInstitutionRows,
  listUsers as listUserRows,
  readLlmUsage,
  setPlatformRole as writePlatformRole,
  withTransaction,
  type AuditLog as AuditLogRow,
  type UserRow,
} from './repository'
import type { AuditAction, AuditLog, AuditLogMetadata, DbOrTx } from './repository'
import {
  platformRoleSchema,
  type AdminFlags,
  type AdminUser,
  type AdminUserPage,
  type AuditEntry,
  type AuditEntryPage,
  type InstitutionRef,
  type ListAuditLogInput,
  type ListUsersInput,
  type PlatformRole,
  type SetAiModeInput,
  type SentryTestResult,
  type SetPlatformRoleInput,
} from './schema'

export type { AuditAction, AuditLog, AuditLogMetadata } from './repository'

// The one read of the runtime switch's *effect* that lives outside `src/server/llm`: the workspace
// pages and `/api/ready` reach it through this module's index, because the `boundaries` policy lets
// a service import `llm` and lets `app` and `server-lib` import a module's public index, and
// nothing else joins those two (D-691).
export { effectiveAssistantMode } from '@/server/llm/ai-mode'

/** The request id stamped on rows written outside a request or a job (scripts, seeds). */
const NO_REQUEST_ID = 'system'

export type AuditInput = {
  /** The signed-in actor, or null for a system action (a job, the seed, a purge). */
  actorId: string | null
  /** The institution the action belongs to, or null for a platform action. */
  orgId: string | null
  action: AuditAction
  /** The table or concept the id names, e.g. `data_agreement`, `invitation`, `run`. */
  targetType: string
  targetId: string
  /** Action-specific details. Never secrets, run free text, or anything the log redacts. */
  metadata?: AuditLogMetadata
}

/**
 * Appends one audit row inside the caller's transaction, stamped with the current request id
 * (10 §2: jobs carry `job:<jobId>`, so an audited job action is traceable to its run).
 */
export async function audit(tx: DbOrTx, input: AuditInput): Promise<AuditLog> {
  return insertAuditLog(
    {
      organizationId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      requestId: getRequestContext()?.requestId ?? NO_REQUEST_ID,
    },
    tx,
  )
}

// ---------------------------------------------------------------------------------------------
// The platform screens (UI-050, 10 §16, 07 §9)
// ---------------------------------------------------------------------------------------------

/** A `user` row as the users table reads it (07 §9 `AdminUser`). */
function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: platformRoleSchema.parse(row.platform_role),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** An `audit_logs` row as the audit table reads it (07 §9 `AuditEntry`). */
function toAuditEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    actorId: row.actorId,
    organizationId: row.organizationId,
    requestId: row.requestId,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  }
}

/** A page of users, newest first; `q` is an email prefix (10 §16). */
export async function listUsers(
  actor: SessionUser,
  input: ListUsersInput = {},
): Promise<AdminUserPage> {
  requirePlatformRole(actor, 'admin')
  const page = await listUserRows({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.q === undefined ? {} : { q: input.q }),
  })
  return { items: page.items.map(toAdminUser), nextCursor: page.nextCursor }
}

/** A page of audit rows, newest first, optionally one institution's (10 §16, UI-050). */
export async function listAuditLog(
  actor: SessionUser,
  input: ListAuditLogInput = {},
): Promise<AuditEntryPage> {
  requirePlatformRole(actor, 'admin')
  const page = await listAuditLogRows({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.orgId === undefined ? {} : { orgId: input.orgId }),
  })
  return { items: page.items.map(toAuditEntry), nextCursor: page.nextCursor }
}

/**
 * Every institution, for the audit log's filter (UI-050). The admin sees them all, which is the
 * whole point of the screen: the log spans tenants and the filter is how one is picked out.
 */
export async function listInstitutions(actor: SessionUser): Promise<InstitutionRef[]> {
  requirePlatformRole(actor, 'admin')
  return listInstitutionRows()
}

/**
 * The three deployment flags, the provider the run loop would actually call, and what that provider
 * has cost today and this month against its two ceilings (10 §16, NFR-016, step 14.5).
 *
 * `effectiveLlmProvider()` and not `env.LLM_PROVIDER`: `FEATURE_AI=false` forces the mock whatever
 * the provider variable says, and the screen exists to show the reader what is true rather than
 * what was configured. The usage numbers answer the second half of the same question — this is what
 * the deployment is running with, *and* this is what it has spent — and they are the numbers the
 * budgets themselves sum, read against the same UTC day and calendar month (D-065). They are the
 * one place in the product where an operator can see budget consumption without PostHog: 13 §6.3's
 * panels need a key, and Tassl must be fully usable without one (D-098).
 *
 * The flags themselves are still pure environment. The two mode fields are not: `aiMode` is the
 * `ai_mode` row as it stands (D-691) and `assistantMode` is what the environment and that row
 * together make of the assistant — the one answer the screen, `/api/ready` and the assistant
 * panel's chip all print.
 */
export async function getFlags(actor: SessionUser): Promise<AdminFlags> {
  requirePlatformRole(actor, 'admin')
  const now = new Date()
  const [usage, aiMode, assistantMode] = await Promise.all([
    readLlmUsage(startOfUtcMonth(now), startOfUtcDay(now)),
    readAiMode(),
    effectiveAssistantMode(),
  ])
  const limits = budgetLimits()
  return {
    ...flagsFromEnv(env),
    effectiveLlmProvider: effectiveLlmProvider(),
    aiMode,
    assistantMode,
    llmUsage: {
      ...usage,
      budgets: { userDaily: limits.userDaily, globalMonthly: limits.globalMonthly },
    },
  }
}

/**
 * Throws the runtime assistant switch (11 §6, D-691): the `ai_mode` row and the `ai_mode.set`
 * audit row, in one transaction, and the flags as they now stand.
 *
 * Refused with `CONFLICT` while `FEATURE_AI=false`. The environment has already forced the
 * scripted assistant and nothing this row says can change that, so a write would record a choice
 * the deployment cannot honour — an admin reading the audit log later would find a switch to
 * `live` that never made anything live. The screen says the same thing beside a disabled control;
 * this is the enforcement behind it.
 *
 * `from` is read before the transaction opens. The row is a single key an admin writes by hand a
 * few times a year; two admins racing on it would produce two audit rows whose `from` disagree by
 * one write, which is a smaller wrong than holding a lock on the path every model call reads.
 */
export async function setAiMode(actor: SessionUser, input: SetAiModeInput): Promise<AdminFlags> {
  requirePlatformRole(actor, 'admin')
  if (!flagsFromEnv(env).ai) throw new AppError('CONFLICT', t('admin.flags.assistantModeEnvForced'))

  const before = await readAiMode()
  await withTransaction(async (tx) => {
    await writeAiMode(input.mode, actor.id, tx)
    await audit(tx, {
      actorId: actor.id,
      orgId: null,
      action: 'ai_mode.set',
      targetType: 'app_setting',
      targetId: AI_MODE_KEY,
      metadata: { from: before, to: input.mode },
    })
  })
  return getFlags(actor)
}

/**
 * Sets another person's platform role (10 §16): the role, the revocation of their sessions, and
 * the `role.set` audit row, in one transaction.
 *
 * The sessions go because the seat is read from the session's user row at every request and a live
 * session would otherwise carry the old answer for as long as it lasts — a demotion that leaves the
 * demoted seat working is not a demotion. The three writes commit together for the reason 08 §5
 * gives for the audit row: a revocation with no record of who ordered it is worse than either.
 *
 * Two refusals, both `ROLE_INVALID` (D-571): a value outside the three roles, and the actor's own
 * row. Self-demotion revokes the sessions it is being made from, so it would sign the actor out of
 * the only seat that can undo it; a second admin can always do it, which is what makes the refusal
 * a guard rather than a wall.
 */
export async function setPlatformRole(
  actor: SessionUser,
  input: SetPlatformRoleInput,
): Promise<AdminUser> {
  requirePlatformRole(actor, 'admin')
  const parsed = platformRoleSchema.safeParse(input.role)
  if (!parsed.success) throw new AppError('ROLE_INVALID')
  if (input.userId === actor.id) throw new AppError('ROLE_INVALID', t('admin.roleSelfRefused'))

  const role: PlatformRole = parsed.data
  return withTransaction(async (tx) => {
    const before = await findUserById(input.userId, tx)
    if (!before || before.deleted_at !== null)
      throw new AppError('NOT_FOUND', t('admin.userNotFound'))

    const after = await writePlatformRole(input.userId, role, tx)
    if (!after) throw new AppError('NOT_FOUND', t('admin.userNotFound'))

    const revoked = await deleteSessionsOfUser(input.userId, tx)
    await audit(tx, {
      actorId: actor.id,
      orgId: null,
      action: 'role.set',
      targetType: 'user',
      targetId: input.userId,
      metadata: { from: before.platform_role, to: role, sessionsRevoked: revoked },
    })
    return toAdminUser(after)
  })
}

/**
 * Sends one test event to Sentry from inside the deployment (13 §4 row 7, D-708): the launch
 * checklist's proof that events leave production, made a control an admin presses rather than a
 * script an operator runs with the DSN in hand. Platform admin only; the event carries no
 * personal data — a fixed message, the `ops` tag and the environment.
 */
export async function sendSentryTestEvent(actor: SessionUser): Promise<SentryTestResult> {
  requirePlatformRole(actor, 'admin')
  const eventId = captureOpsTestEvent()
  return {
    eventId,
    environment: env.APP_ENV,
    dsnConfigured: env.NEXT_PUBLIC_SENTRY_DSN.length > 0,
  }
}
