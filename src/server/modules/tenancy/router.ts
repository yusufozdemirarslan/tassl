// Route handlers of the `tenancy` module (docs/tech/07-api-spec.md §4). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what
// `pnpm openapi:generate` reads. No business logic lives here: the wrapper validates and the
// service decides.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import {
  acceptInvitation,
  createInstitution,
  getInstitutionSettings,
  inviteMember,
  listDataAgreements,
  listMyInstitutions,
  updateDataAgreement,
  updateInstitutionSettings,
  upsertDataAgreement,
} from './service'
import {
  AgreementIdParamsSchema,
  CreateInstitutionSchema,
  DataAgreementInputSchema,
  DataAgreementSchema,
  InstitutionSchema,
  InstitutionViewSchema,
  InvitationIdParamsSchema,
  InvitationSchema,
  InviteMemberSchema,
  MembershipSchema,
  MyInstitutionSchema,
  OrgIdParamsSchema,
  UpdateDataAgreementSchema,
  UpdateInstitutionSettingsSchema,
} from './schema'

const TAGS = ['tenancy']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

export const listInstitutionsRoute = defineRoute(
  {
    auth: 'session',
    output: z.array(MyInstitutionSchema),
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listInstitutions',
      summary: 'Institutions I belong to',
      tags: TAGS,
    },
  },
  async (ctx) => listMyInstitutions(actorOf(ctx)),
)

export const createInstitutionRoute = defineRoute(
  {
    auth: 'session',
    input: { body: CreateInstitutionSchema },
    output: InstitutionSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createInstitution',
      summary: 'Create an institution (admin)',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => createInstitution(actorOf(ctx), ctx.input.body),
)

export const getInstitutionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema },
    output: InstitutionViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getInstitution',
      summary: 'Institution with settings',
      tags: TAGS,
    },
  },
  async (ctx) => getInstitutionSettings(actorOf(ctx), ctx.input.params.orgId),
)

export const updateInstitutionSettingsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: UpdateInstitutionSettingsSchema },
    output: InstitutionViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'updateInstitutionSettings',
      summary: 'Plan label and default mapping',
      tags: TAGS,
    },
  },
  async (ctx) => updateInstitutionSettings(actorOf(ctx), ctx.input.params.orgId, ctx.input.body),
)

export const inviteMemberRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: InviteMemberSchema },
    output: InvitationSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'inviteMember',
      summary: 'Invite a member by email',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) =>
    inviteMember(actorOf(ctx), ctx.input.params.orgId, ctx.input.body, ctx.request.headers),
)

export const acceptInvitationRoute = defineRoute(
  {
    auth: 'session',
    input: { params: InvitationIdParamsSchema },
    output: MembershipSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'acceptInvitation',
      summary: 'Accept an invitation',
      tags: TAGS,
    },
  },
  async (ctx) => acceptInvitation(actorOf(ctx), ctx.input.params.invitationId, ctx.request.headers),
)

export const listAgreementsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema },
    output: z.array(DataAgreementSchema),
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listAgreements',
      summary: 'Data agreements',
      tags: TAGS,
    },
  },
  async (ctx) => listDataAgreements(actorOf(ctx), ctx.input.params.orgId),
)

export const createAgreementRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: DataAgreementInputSchema },
    output: DataAgreementSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createAgreement',
      summary: 'Create a data agreement',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => upsertDataAgreement(actorOf(ctx), ctx.input.params.orgId, ctx.input.body),
)

export const updateAgreementRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AgreementIdParamsSchema, body: UpdateDataAgreementSchema },
    output: DataAgreementSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'updateAgreement',
      summary: 'Update or end a data agreement',
      tags: TAGS,
    },
  },
  async (ctx) => updateDataAgreement(actorOf(ctx), ctx.input.params.agreementId, ctx.input.body),
)
