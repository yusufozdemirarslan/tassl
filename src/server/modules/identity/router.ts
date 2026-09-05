// Route handlers of the `identity` module (docs/tech/07-api-spec.md §3). The files under
// `src/app/api/v1/me/**` re-export these; nothing here decides anything — `defineRoute` validates
// and authenticates, the service holds the rules.
//
// Two of the six answers are not a plain JSON body, and `defineRoute` always serializes JSON with
// its registered status, so each is wrapped once: `Response.json` refuses a 204 body, and the export
// has to arrive as a file. The wrapper re-attaches the route spec so `pnpm openapi:generate` still
// finds the operation.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import {
  meViewSchema,
  myAssignmentsPageSchema,
  pageQuerySchema,
  updateProfileSchema,
  userExportSchema,
} from './schema'
import {
  exportUserData,
  getCurrentUser,
  listMyAssignments as listMyAssignmentsService,
  requestAccountDeletion,
  updateProfile,
} from './service'

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into the type. */
function actorOf(ctx: { actor: SessionUser | null }): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/** The spec `defineRoute` attached, so a wrapped handler stays visible to the generator. */
function specOf(handler: RouteHandler): RegisteredRoute {
  const spec = getRouteSpec(handler)
  if (!spec) throw new AppError('INTERNAL_ERROR', 'Route spec missing.')
  return spec
}

export const getMe = defineRoute(
  {
    auth: 'session',
    output: meViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getMe', summary: 'Current user', tags: ['me'] },
  },
  async (ctx) => getCurrentUser(actorOf(ctx)),
)

export const updateMe = defineRoute(
  {
    auth: 'session',
    input: { body: updateProfileSchema },
    output: meViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'updateMe', summary: 'Update profile', tags: ['me'] },
  },
  async (ctx) => updateProfile(actorOf(ctx), ctx.input.body),
)

export const listMyAssignments = defineRoute(
  {
    auth: 'session',
    input: { query: pageQuerySchema },
    output: myAssignmentsPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listMyAssignments',
      summary: 'My assignments with latest run',
      tags: ['me'],
    },
  },
  async (ctx) => listMyAssignmentsService(actorOf(ctx), ctx.input.query),
)

const deleteMeRoute = defineRoute(
  {
    auth: 'session',
    output: z.object({}),
    rateLimit: { bucket: 'auth' },
    openapi: {
      operationId: 'deleteMe',
      summary: 'Soft-delete the account (purged after 30 days)',
      tags: ['me'],
    },
  },
  async (ctx) => {
    await requestAccountDeletion(actorOf(ctx), { headers: ctx.request.headers })
    return {}
  },
)

const exportMeRoute = defineRoute(
  {
    auth: 'session',
    output: userExportSchema,
    rateLimit: { bucket: 'auth' },
    openapi: { operationId: 'exportMe', summary: 'Export my data as JSON', tags: ['me'] },
  },
  async (ctx) => exportUserData(actorOf(ctx)),
)

/** 204 with no body (07 §3); `Response.json` refuses a null-body status, so it is built here. */
export const deleteMe: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    const response = await deleteMeRoute(request, routeCtx)
    if (response.status !== 200) return response
    const headers = new Headers(response.headers)
    headers.delete('content-type')
    return new Response(null, { status: 204, headers })
  },
  { ...specOf(deleteMeRoute), status: 204, description: 'Deleted' },
)

/** The export is a download (07 §1 "Content types"), so the JSON answer carries a file name. */
export const exportMe: RouteHandler = attachRouteSpec(async (request, routeCtx) => {
  const response = await exportMeRoute(request, routeCtx)
  if (response.status !== 200) return response
  const headers = new Headers(response.headers)
  headers.set('content-disposition', `attachment; filename="${t('identity.exportFileName')}"`)
  return new Response(response.body, { status: response.status, headers })
}, specOf(exportMeRoute))
