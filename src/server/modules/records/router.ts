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
import { CourseTraceExportSchema, RecordTraceExportSchema } from '@/server/modules/trace'
import {
  exportRecord,
  getCourseExport,
  getRecord,
  listCourseExports,
  listRunExports,
} from './service'
import {
  AssignmentIdParamsSchema,
  ExportSummaryPageSchema,
  ExportSummarySchema,
  ExportVersionParamsSchema,
  PageQuerySchema,
  RecordViewSchema,
  RunIdParamsSchema,
} from './schema'
import { z } from 'zod'

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

/**
 * `GET /runs/{runId}/record` (07 §7, FR-170): the student's own Judgment Record.
 *
 * The owner alone. Its contents are gated a second time inside the service, by name containment on
 * `weight`, `mapping` and `points` at any depth (FR-172, D-421) — the record is the artifact that
 * leaves Tassl for the course, and the course's own arithmetic is not part of it.
 */
export const getRecordRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RecordViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getRecord', summary: 'Judgment Record', tags: TAGS },
  },
  async (ctx) => getRecord(actorOf(ctx), ctx.input.params.runId),
)

/** `GET /runs/{runId}/exports` (07 §8, FR-184): the export versions of one run, newest first. */
export const listRunExportsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: z.array(ExportSummarySchema),
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listRunExports',
      summary: 'Course export versions of a run',
      tags: ['review'],
    },
  },
  async (ctx) => listRunExports(actorOf(ctx), ctx.input.params.runId),
)

const getCourseExportJson = defineRoute(
  {
    auth: 'session',
    input: { params: ExportVersionParamsSchema },
    output: CourseTraceExportSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getRunExport',
      summary: 'Download one filed course export',
      tags: ['review'],
    },
  },
  async (ctx) => getCourseExport(actorOf(ctx), ctx.input.params.runId, ctx.input.params.version),
)

/**
 * `GET /runs/{runId}/exports/{version}` (07 §8, FR-204): the file as it was written.
 *
 * A download, like the record copy above and for the same reason (07 §1 "Content types"): what the
 * instructor does with it is open it in a gradebook workflow, not read it in a browser tab. The
 * version is in the file name, because two versions of one run are two different files and a
 * downloads folder is where that difference gets lost.
 */
export const getRunExportRoute: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    const response = await getCourseExportJson(request, routeCtx)
    if (response.status !== 200) return response
    const document = await response.text()
    const headers = new Headers(response.headers)
    const { runId, version } = await routeCtx.params
    const fileName = t('record.courseExportFileName', {
      runId: String(runId),
      version: String(version),
    })
    headers.set('content-disposition', `attachment; filename="${fileName}"`)
    return new Response(document, { status: response.status, headers })
  },
  { ...specOf(getCourseExportJson), description: 'File' },
)

/**
 * `GET /assignments/{assignmentId}/exports` (07 §8, FR-184, UI-035): the export history of an
 * assignment, newest first, for a reviewer of its section.
 *
 * Summaries, not files: the history answers what was written, when and why, and each file is its own
 * download. A voided run's files are not in it (FR-002, D-434).
 */
export const listAssignmentExportsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AssignmentIdParamsSchema, query: PageQuerySchema },
    output: ExportSummaryPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listAssignmentExports',
      summary: 'Export history of an assignment',
      tags: ['review'],
    },
  },
  async (ctx) => listCourseExports(actorOf(ctx), ctx.input.params.assignmentId, ctx.input.query),
)
