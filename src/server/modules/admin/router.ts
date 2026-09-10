// Route handlers of the `admin` module (docs/tech/07-api-spec.md §9, SYS-006). The files under
// `src/app/api/v1/admin/**` re-export these; nothing here decides anything — `defineRoute`
// authenticates, validates and rate-limits, and the service holds the one rule this module has:
// platform admin, checked as the first statement of every function it exports.
//
// The `Adm` column of 07 §9 is the service's `requirePlatformRole(actor, 'admin')`, so a route
// handler that forgot the check could not widen access: there is nothing here to forget.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import {
  adminFlagsSchema,
  adminUserIdSchema,
  adminUserPageSchema,
  adminUserSchema,
  auditEntryPageSchema,
  listAuditLogSchema,
  listUsersSchema,
  setAiModeSchema,
  sentryTestResultSchema,
  setPlatformRoleBodySchema,
} from './schema'
import {
  getFlags,
  listAuditLog,
  listUsers,
  setAiMode,
  setPlatformRole,
  sendSentryTestEvent,
} from './service'

const TAGS = ['admin']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/** `GET /admin/users` — every account, newest first, filtered by email prefix (07 §9). */
export const adminListUsers = defineRoute(
  {
    auth: 'session',
    input: { query: listUsersSchema },
    output: adminUserPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'adminListUsers', summary: 'Users', tags: TAGS },
  },
  async (ctx) => listUsers(actorOf(ctx), ctx.input.query),
)

/** `PUT /admin/users/{userId}/platform-role` — sets the seat, revokes the sessions, audits. */
export const adminSetPlatformRole = defineRoute(
  {
    auth: 'session',
    input: { params: adminUserIdSchema, body: setPlatformRoleBodySchema },
    output: adminUserSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'adminSetPlatformRole', summary: 'Set a platform role', tags: TAGS },
  },
  async (ctx) =>
    setPlatformRole(actorOf(ctx), {
      userId: ctx.input.params.userId,
      role: ctx.input.body.role,
    }),
)

/** `GET /admin/flags` — the three deployment flags and the effective LLM provider (07 §9). */
export const adminGetFlags = defineRoute(
  {
    auth: 'session',
    output: adminFlagsSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'adminGetFlags',
      summary: 'Feature flags and effective LLM provider',
      tags: TAGS,
    },
  },
  async (ctx) => getFlags(actorOf(ctx)),
)

/**
 * `PUT /admin/settings/ai-mode` — the runtime assistant switch (07 §9, 11 §6, D-691). Answers the
 * flags as they stand after the write, so the caller needs no second read to see the effect.
 */
export const adminSetAiMode = defineRoute(
  {
    auth: 'session',
    input: { body: setAiModeSchema },
    output: adminFlagsSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'adminSetAiMode', summary: 'Set the assistant mode', tags: TAGS },
  },
  async (ctx) => setAiMode(actorOf(ctx), ctx.input.body),
)

/** `GET /admin/audit-log` — the platform audit log, optionally one institution's (07 §9). */
export const adminListAuditLog = defineRoute(
  {
    auth: 'session',
    input: { query: listAuditLogSchema },
    output: auditEntryPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'adminListAuditLog', summary: 'Audit log', tags: TAGS },
  },
  async (ctx) => listAuditLog(actorOf(ctx), ctx.input.query),
)

/** `POST /admin/sentry-test` — one `ops.sentry_test` event from this deployment (D-708). */
export const adminSentryTest = defineRoute(
  {
    auth: 'session',
    output: sentryTestResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'adminSentryTest', summary: 'Send a Sentry test event', tags: TAGS },
  },
  async (ctx) => sendSentryTestEvent(actorOf(ctx)),
)
