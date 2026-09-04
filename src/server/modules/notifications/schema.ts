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
])
export type NotificationType = z.infer<typeof notificationTypeSchema>

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

/** Cursor pagination (10-backend-spec.md §11, D-020); unknown parameters are rejected. */
export const listNotificationsSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unread: z.boolean().optional(),
})
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>

export const notificationIdSchema = z.object({ id: z.uuid() })
export type NotificationIdInput = z.infer<typeof notificationIdSchema>

/** "Mark all read" carries no input; the actor is the whole scope. */
export const markAllReadSchema = z.object({})
export type MarkAllReadInput = z.infer<typeof markAllReadSchema>

export const markAllReadResultSchema = z.object({ marked: z.number().int().nonnegative() })
export type MarkAllReadResult = z.infer<typeof markAllReadResultSchema>
