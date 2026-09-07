// Route handlers of the `notifications` module (docs/tech/07-api-spec.md §9, SYS-010). The files
// under `src/app/api/v1/notifications/**` re-export these; nothing here decides anything —
// `defineRoute` authenticates, validates and rate-limits, and the service holds the one rule this
// module has: owner only, with the actor's own id as the query key rather than as a check.
//
// Both mutations answer `204` (07 §9), and `defineRoute` always serializes JSON with its registered
// status, so each is wrapped once the way `identity.deleteMe` is: `Response.json` refuses a
// null-body status. The wrapper re-attaches the route spec so `pnpm openapi:generate` still finds
// the operation.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import {
  listNotificationsSchema,
  notificationIdSchema,
  notificationPageSchema,
  unreadCountSchema,
} from './schema'
import { countUnread, listNotifications, markAllRead, markRead } from './service'

const TAGS = ['notifications']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/** The spec `defineRoute` attached, so a wrapped handler stays visible to the generator. */
function specOf(handler: RouteHandler): RegisteredRoute {
  const spec = getRouteSpec(handler)
  if (!spec) throw new AppError('INTERNAL_ERROR', 'Route spec missing.')
  return spec
}

/** 204 with no body, built once for both mutations (07 §9). */
function noContent(inner: RouteHandler, description: string): RouteHandler {
  return attachRouteSpec(
    async (request, routeCtx) => {
      const response = await inner(request, routeCtx)
      if (response.status !== 200) return response
      const headers = new Headers(response.headers)
      headers.delete('content-type')
      return new Response(null, { status: 204, headers })
    },
    { ...specOf(inner), status: 204, description },
  )
}

/** `GET /notifications` — the actor's own, newest first, cursor-paginated (D-020). */
export const listNotificationsRoute = defineRoute(
  {
    auth: 'session',
    input: { query: listNotificationsSchema },
    output: notificationPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listNotifications',
      summary: 'My notifications',
      tags: TAGS,
    },
  },
  async (ctx) => listNotifications(actorOf(ctx), ctx.input.query),
)

/**
 * `GET /notifications/unread-count` — the shell bell's badge (UI-008, SYS-010, D-470).
 *
 * A route rather than a Server Action, and the difference is what it costs. Next.js answers a
 * Server Action with the re-rendered tree of whatever page the caller is on, so a badge polled from
 * one would re-render the run workspace — `getRunWorkspace` and everything under it — once a minute
 * for every open tab. This answers one integer and re-renders nothing.
 */
export const unreadCountRoute = defineRoute(
  {
    auth: 'session',
    output: unreadCountSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'unreadNotificationCount',
      summary: 'How many of my notifications are unread',
      tags: TAGS,
    },
  },
  async (ctx) => ({ count: await countUnread(actorOf(ctx)) }),
)

const markReadRoute = defineRoute(
  {
    auth: 'session',
    input: { params: notificationIdSchema },
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'markNotificationRead',
      summary: 'Mark a notification read',
      tags: TAGS,
    },
  },
  async (ctx) => {
    await markRead(actorOf(ctx), ctx.input.params.id)
    return {}
  },
)

const markAllReadRoute = defineRoute(
  {
    auth: 'session',
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'markAllNotificationsRead',
      summary: 'Mark every notification read',
      tags: TAGS,
    },
  },
  async (ctx) => {
    await markAllRead(actorOf(ctx))
    return {}
  },
)

/** `POST /notifications/{id}/read`; a notification that is not the actor's is NOT_FOUND. */
export const markNotificationReadRoute: RouteHandler = noContent(markReadRoute, 'Marked read')

/** `POST /notifications/read-all`. */
export const markAllNotificationsReadRoute: RouteHandler = noContent(
  markAllReadRoute,
  'Marked read',
)
