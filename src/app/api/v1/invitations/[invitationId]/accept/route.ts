// POST /api/v1/invitations/{invitationId}/accept (docs/tech/07-api-spec.md §4).
export { acceptInvitationRoute as POST } from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
