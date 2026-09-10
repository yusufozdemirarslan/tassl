'use server'
// Server Actions of the `admin` module (UI-050; 07-api-spec.md §9 lists the same operation as an
// endpoint). `defineAction` runs `requireSession()`, validates with the module's schema, maps
// errors to the envelope, and never throws to the client.
//
// Four actions: the role change, the assistant-mode switch (D-691), and the two "show more" reads.
// The first page of each table is rendered on the server; the page after it is fetched by the
// table itself and appended, the way the notification centre does it (UI-011), so a long log does
// not turn into a full page render per press. The search box and the institution filter stay on
// the server as plain query parameters, because a filter that survives a reload and can be linked
// to is worth more than one that does not (D-575).
import { z } from 'zod'
import { defineAction } from '@/server/http/define-action'
import {
  listAuditLogSchema,
  listUsersSchema,
  setAiModeSchema,
  setPlatformRoleSchema,
  type AdminFlags,
  type AdminUser,
  type AdminUserPage,
  type AuditEntryPage,
  type ListAuditLogInput,
  type ListUsersInput,
  type SetAiModeInput,
  type SentryTestResult,
  type SetPlatformRoleInput,
} from './schema'
import { listAuditLog, listUsers, sendSentryTestEvent, setAiMode, setPlatformRole } from './service'

/** Every admin screen shows role state, and the change signs the person out of all three. */
const ADMIN = ['/admin/users', '/admin/audit']

export const setPlatformRoleAction = defineAction<SetPlatformRoleInput, AdminUser>(
  setPlatformRoleSchema,
  async (input, ctx) => ({ data: await setPlatformRole(ctx.actor, input), revalidate: ADMIN }),
  { name: 'admin.setPlatformRole' },
)

/** The runtime assistant switch (D-691); the flags screen redraws with the mode it now holds. */
export const setAiModeAction = defineAction<SetAiModeInput, AdminFlags>(
  setAiModeSchema,
  async (input, ctx) => ({
    data: await setAiMode(ctx.actor, input),
    revalidate: ['/admin/flags'],
  }),
  { name: 'admin.setAiMode' },
)

/** "Show more accounts": the page after the cursor the table's last page ended on. */
export const listUsersAction = defineAction<ListUsersInput, AdminUserPage>(
  listUsersSchema,
  async (input, ctx) => ({ data: await listUsers(ctx.actor, input) }),
  { name: 'admin.listUsers' },
)

/** "Show more rows": the same, for the audit log, carrying the institution filter with it. */
export const listAuditLogAction = defineAction<ListAuditLogInput, AuditEntryPage>(
  listAuditLogSchema,
  async (input, ctx) => ({ data: await listAuditLog(ctx.actor, input) }),
  { name: 'admin.listAuditLog' },
)

/** "Send a test event to Sentry" on the flags screen (D-708). */
export const sendSentryTestAction = defineAction<Record<string, never>, SentryTestResult>(
  z.object({}),
  async (_input, ctx) => ({ data: await sendSentryTestEvent(ctx.actor) }),
  { name: 'admin.sendSentryTest' },
)
