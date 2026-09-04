'use server'
// Server Actions of the `tenancy` module: the mirror of every mutation in 07-api-spec.md §4
// (07 §11). Each one validates with the same Zod schema as its route and calls the same service
// function, so the UI and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`,
// maps errors to the envelope, and never throws to the client.
//
// Better Auth resolves the session from the request headers, so the actions that touch
// organizations, invitations, or the active organization read them from `next/headers` and thread
// them into the service — the same headers the route hands it from `ctx.request`.
import { headers } from 'next/headers'
import { defineAction } from '@/server/http/define-action'
import {
  acceptInvitation,
  createInstitution,
  inviteMember,
  setActiveInstitution,
  updateInstitutionSettings,
  upsertDataAgreement,
} from './service'
import {
  AcceptInvitationActionSchema,
  CreateInstitutionSchema,
  InviteMemberActionSchema,
  SetActiveInstitutionSchema,
  UpdateInstitutionSettingsActionSchema,
  UpsertDataAgreementActionSchema,
} from './schema'

/** The shell reads memberships and the active institution, so every tenancy write refreshes it. */
const SHELL = ['/home']

export const createInstitutionAction = defineAction(
  CreateInstitutionSchema,
  async (input, ctx) => ({
    data: await createInstitution(ctx.actor, input),
    revalidate: SHELL,
  }),
  { name: 'createInstitutionAction' },
)

export const setActiveInstitutionAction = defineAction(
  SetActiveInstitutionSchema,
  async (input, ctx) => ({
    data: await setActiveInstitution(ctx.actor, input.orgId, await headers()),
    revalidate: SHELL,
  }),
  { name: 'setActiveInstitutionAction' },
)

export const inviteMemberAction = defineAction(
  InviteMemberActionSchema,
  async ({ orgId, ...input }, ctx) => ({
    data: await inviteMember(ctx.actor, orgId, input, await headers()),
    revalidate: SHELL,
  }),
  { name: 'inviteMemberAction' },
)

export const acceptInvitationAction = defineAction(
  AcceptInvitationActionSchema,
  async (input, ctx) => ({
    data: await acceptInvitation(ctx.actor, input.invitationId, await headers()),
    revalidate: SHELL,
  }),
  { name: 'acceptInvitationAction' },
)

export const updateInstitutionSettingsAction = defineAction(
  UpdateInstitutionSettingsActionSchema,
  async ({ orgId, ...input }, ctx) => ({
    data: await updateInstitutionSettings(ctx.actor, orgId, input),
    revalidate: SHELL,
  }),
  { name: 'updateInstitutionSettingsAction' },
)

export const upsertDataAgreementAction = defineAction(
  UpsertDataAgreementActionSchema,
  async ({ orgId, ...input }, ctx) => ({
    data: await upsertDataAgreement(ctx.actor, orgId, input),
    revalidate: SHELL,
  }),
  { name: 'upsertDataAgreementAction' },
)
