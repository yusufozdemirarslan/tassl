// Route handlers of the `scenarios` module (docs/tech/07-api-spec.md §6). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper authenticates, validates and rate-limits, and
// the service decides — including who may read what, because a package id does not name its
// institution and only the service can resolve one to the other.
//
// Two answers are not a plain validated JSON body, and each is wrapped once:
//
//   * The export is a download (07 §1 "Content types"), so its JSON answer carries a file name.
//   * Two bodies are passed through unvalidated on purpose. An imported document is parsed by
//     `importPackage`, so a malformed one answers the documented `IMPORT_INVALID` instead of the
//     generic `VALIDATION_ERROR`; an element patch has as many shapes as there are element types
//     and `updateElement` picks the right one from `ELEMENT_PATCH_SCHEMAS`. Both still arrive as
//     objects, and both still answer 400 when the shape is wrong — from the module's own schema.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import {
  confirmVersion,
  createPackageFromSeed,
  decideElement,
  exportPackage,
  getClaimObject,
  getPackage,
  getPackageVersion,
  importPackage,
  listPackages,
  regenerateVersion,
  updateElement,
} from './service'
import {
  ClaimObjectQuerySchema,
  ClaimObjectViewSchema,
  ClaimParamsSchema,
  ConfirmVersionSchema,
  CreatePackageFromSeedSchema,
  CreatedPackageViewSchema,
  ElementConfirmationViewSchema,
  ElementDecisionSchema,
  ElementParamsSchema,
  ElementTypeSchema,
  ImportedPackageViewSchema,
  OrgIdParamsSchema,
  PackageExportSchema,
  PackageIdParamsSchema,
  PackageSummaryViewSchema,
  PackageVersionViewSchema,
  PackageViewSchema,
  PageQuerySchema,
  RegenerateVersionSchema,
  VersionIdParamsSchema,
  type PageQuery,
} from './schema'

const TAGS = ['packages']

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

/** `{ items, nextCursor }` around an item schema (07 §1 "Pagination"). */
const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

/**
 * A body whose shape the service owns: an object, and nothing more said about it here. The two
 * routes that take one both hand the value straight to the service as `unknown`.
 */
const PassthroughBodySchema = z.looseObject({})

/**
 * The answer of `updateElement`. Its `values` are the element as its own input schema spells it,
 * which differs per element type, so the wire shape is stated where the route is rather than as a
 * fourteen-way union in `schema.ts`.
 */
const ElementViewSchema = z.object({
  elementType: ElementTypeSchema,
  elementId: z.uuid().nullable(),
  key: z.string(),
  values: z.record(z.string(), z.unknown()),
  confirmation: ElementConfirmationViewSchema.nullable(),
})

/**
 * The page query as the service's own type spells it. `exactOptionalPropertyTypes` makes
 * `{ cursor?: string | undefined }` and `{ cursor?: string }` different types, and the module
 * schema publishes the second; an absent parameter is therefore dropped rather than passed as
 * `undefined`.
 */
function pageQuery(query: { cursor?: string | undefined; limit?: number | undefined }): PageQuery {
  return {
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  }
}

// ---------------------------------------------------------------------------------------------
// Packages (FR-190, SYS-026, UI-040)
// ---------------------------------------------------------------------------------------------

export const listPackagesRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, query: PageQuerySchema },
    output: pageOf(PackageSummaryViewSchema),
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'listPackages', summary: 'Scenario packages', tags: TAGS },
  },
  async (ctx) => listPackages(actorOf(ctx), ctx.input.params.orgId, pageQuery(ctx.input.query)),
)

export const createPackageFromSeedRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: CreatePackageFromSeedSchema },
    output: CreatedPackageViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createPackageFromSeed',
      summary: 'Create a package (version 1 draft) from a seed case',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => createPackageFromSeed(actorOf(ctx), ctx.input.params.orgId, ctx.input.body),
)

export const importPackageRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: PassthroughBodySchema },
    output: ImportedPackageViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'importPackage',
      summary: 'Import a package JSON',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => importPackage(actorOf(ctx), ctx.input.params.orgId, ctx.input.body),
)

export const getPackageRoute = defineRoute(
  {
    auth: 'session',
    input: { params: PackageIdParamsSchema },
    output: PackageViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getPackage', summary: 'Package with versions', tags: TAGS },
  },
  async (ctx) => getPackage(actorOf(ctx), ctx.input.params.packageId),
)

// ---------------------------------------------------------------------------------------------
// Versions (FR-180, FR-195, FR-198, UI-044)
// ---------------------------------------------------------------------------------------------

export const getPackageVersionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema },
    output: PackageVersionViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getPackageVersion',
      summary: 'Package version view (confirmation record, authoring record, measures)',
      tags: TAGS,
    },
  },
  async (ctx) => getPackageVersion(actorOf(ctx), ctx.input.params.versionId),
)

const exportPackageVersionJson = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema },
    output: PackageExportSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'exportPackageVersion', summary: 'Package JSON', tags: TAGS },
  },
  async (ctx) => exportPackage(actorOf(ctx), ctx.input.params.versionId),
)

/** The family key of an export document; it names the downloaded file. */
function familyKeyOf(document: string): string {
  const parsed: unknown = JSON.parse(document)
  const familyKey = (parsed as { package?: { familyKey?: unknown } }).package?.familyKey
  return typeof familyKey === 'string' ? familyKey : 'export'
}

/** The export is a download (07 §1 "Content types"), so the JSON answer carries a file name. */
export const exportPackageVersionRoute: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    const response = await exportPackageVersionJson(request, routeCtx)
    if (response.status !== 200) return response
    const document = await response.text()
    const headers = new Headers(response.headers)
    const fileName = t('package.exportFileName', { familyKey: familyKeyOf(document) })
    headers.set('content-disposition', `attachment; filename="${fileName}"`)
    return new Response(document, { status: response.status, headers })
  },
  { ...specOf(exportPackageVersionJson), description: 'File' },
)

export const getClaimObjectRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ClaimParamsSchema, query: ClaimObjectQuerySchema },
    output: ClaimObjectViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getClaimObject', summary: 'Claim object view', tags: TAGS },
  },
  async (ctx) =>
    getClaimObject(
      actorOf(ctx),
      ctx.input.params.versionId,
      ctx.input.params.claimId,
      ctx.input.query.variantId,
    ),
)

// ---------------------------------------------------------------------------------------------
// Elements (FR-192, FR-198, UI-043)
// ---------------------------------------------------------------------------------------------

export const updateElementRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ElementParamsSchema, body: PassthroughBodySchema },
    output: ElementViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'updateElement', summary: 'Edit a draft element', tags: TAGS },
  },
  async (ctx) =>
    updateElement(
      actorOf(ctx),
      ctx.input.params.versionId,
      ctx.input.params.elementType,
      ctx.input.params.elementId,
      ctx.input.body,
    ),
)

export const decideElementRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ElementParamsSchema, body: ElementDecisionSchema },
    output: ElementConfirmationViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'decideElement',
      summary: 'Confirm or reject an element',
      tags: TAGS,
    },
  },
  async (ctx) =>
    decideElement(
      actorOf(ctx),
      ctx.input.params.versionId,
      ctx.input.params.elementType,
      ctx.input.params.elementId,
      ctx.input.body,
    ),
)

// ---------------------------------------------------------------------------------------------
// Confirming and superseding a version (FR-192, FR-195)
// ---------------------------------------------------------------------------------------------

export const confirmPackageVersionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema, body: ConfirmVersionSchema },
    output: PackageVersionViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'confirmPackageVersion',
      summary: 'Confirm and freeze the version',
      tags: TAGS,
    },
  },
  async (ctx) => confirmVersion(actorOf(ctx), ctx.input.params.versionId, ctx.input.body),
)

export const regeneratePackageVersionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema, body: RegenerateVersionSchema },
    output: CreatedPackageViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'regeneratePackageVersion',
      summary: 'Create the next draft version from this one',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => regenerateVersion(actorOf(ctx), ctx.input.params.versionId, ctx.input.body),
)
