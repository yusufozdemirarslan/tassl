// Wire contract of the `notifications` module (docs/tech/10-backend-spec-modules.md §15,
// 07-api-spec.md §3). One Zod schema per input and per view, shared by the Server Action and the
// screen that renders it (UI-011).
//
// Like every module schema this file is the client-safe surface — the notification list imports its
// types from here — so it holds no server imports and restates the notification vocabulary as a Zod
// enum rather than importing the Drizzle enum.
//
// Dates leave the service as ISO strings, not `Date`s: the same view travels in an RSC payload and
// (from Phase 11) in a JSON body, so it is already the shape the client reads.
import { z } from 'zod'

/** `notification_type` (06-data-model.md §3.6). */
export const notificationTypeSchema = z.enum([
  'generation_complete',
  'generation_failed',
  'run_scored',
  'run_held',
  'bands_confirmed',
  'invitation',
  'export_ready',
  'package_confirmed',
])
export type NotificationType = z.infer<typeof notificationTypeSchema>

/**
 * What `notify()` takes (10 §15). Not a wire schema: nothing outside the server calls it, and the
 * fields are already typed by the row it writes.
 */
export type NotifyInput = {
  userIds: readonly string[]
  type: NotificationType
  title: string
  body: string
  link?: string | null
  payload?: Record<string, unknown>
  orgId?: string | null
}

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  /** An in-app path (`/runs/…`); notifications never link off-site. */
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type NotificationView = z.infer<typeof notificationSchema>

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
})
export type NotificationPage = z.infer<typeof notificationPageSchema>

/**
 * A flag that arrives either as a boolean or as the string a URL can carry (D-484).
 *
 * One schema per input is shared by the form, the action and the route (04 §2), and the three do not
 * send the same JavaScript: a Server Action is called with a real `boolean`, and `defineRoute` hands
 * a query schema `Record<string, string>` built from `URLSearchParams` — a query string has no
 * booleans in it. `z.boolean()` alone therefore published a parameter no caller over HTTP could
 * satisfy: `?unread=true` was a 400. `z.coerce.boolean()` is not the fix and is the trap beside it,
 * because `Boolean('false')` is `true`. `z.stringbool()` is Zod 4's answer for exactly this — it
 * reads `true/1/yes/on` and `false/0/no/off`, case-insensitively, and refuses anything else — and
 * the union keeps the action's own `boolean` valid. The parsed type stays `boolean`, so nothing
 * downstream of validation knows the difference.
 */
const QUERY_BOOLEAN_DESCRIPTION =
  'A flag: `true` or `false`, spelled as text when it rides on a query string.'

const queryBoolean = z
  .union([z.boolean(), z.stringbool()])
  .meta({ description: QUERY_BOOLEAN_DESCRIPTION })

/** Cursor pagination (10-backend-spec.md §11, D-020); unknown parameters are rejected. */
export const listNotificationsSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unread: queryBoolean.optional(),
})
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>

export const notificationIdSchema = z.object({ id: z.uuid() })
export type NotificationIdInput = z.infer<typeof notificationIdSchema>

/** "Mark all read" carries no input; the actor is the whole scope. */
export const markAllReadSchema = z.object({})
export type MarkAllReadInput = z.infer<typeof markAllReadSchema>

export const markAllReadResultSchema = z.object({ marked: z.number().int().nonnegative() })
export type MarkAllReadResult = z.infer<typeof markAllReadResultSchema>

/**
 * `GET /notifications/unread-count` — the shell bell's badge, and nothing else (UI-008, D-470).
 *
 * One number rather than a page of rows, because that is what the badge is: a count read once a
 * minute on every route of the product, and a hundred notification bodies fetched to render "3" is
 * bandwidth spent on nothing. The actor is the whole scope; there is no input.
 */
export const unreadCountSchema = z.object({ count: z.number().int().nonnegative() })
export type UnreadCount = z.infer<typeof unreadCountSchema>
