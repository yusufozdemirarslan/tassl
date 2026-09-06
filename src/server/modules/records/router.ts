// Route handlers of the `records` module (docs/tech/07-api-spec.md §7). Mounted by the thin
// `src/app/api/v1/**/route.ts` that `pnpm openapi:generate` reads. No business logic: the wrapper
// authenticates, validates and rate-limits, and the service decides who may read the run — a run id
// does not name its section, and only the service can resolve one to the other.
//
// The record export is a download (07 §1 "Content types"), so its JSON answer is wrapped once to
// carry a file name, exactly as the package export is.
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import { RecordTraceExportSchema } from '@/server/modules/trace'
import { exportRecord } from './service'
import { RunIdParamsSchema } from './schema'

const TAGS = ['runs']

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

const exportRecordJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RecordTraceExportSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'exportRecord',
      summary: 'Record-form trace file',
      tags: TAGS,
    },
  },
  async (ctx) => exportRecord(actorOf(ctx), ctx.input.params.runId),
)

/** The record copy is a download (07 §1), so the JSON answer carries a file name (FR-243). */
export const exportRunRecordRoute: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    const response = await exportRecordJson(request, routeCtx)
    if (response.status !== 200) return response
    const document = await response.text()
    const headers = new Headers(response.headers)
    const { runId } = await routeCtx.params
    const fileName = t('record.exportFileName', { runId: String(runId) })
    headers.set('content-disposition', `attachment; filename="${fileName}"`)
    return new Response(document, { status: response.status, headers })
  },
  { ...specOf(exportRecordJson), description: 'File' },
)
