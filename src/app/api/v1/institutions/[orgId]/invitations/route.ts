// POST /api/v1/institutions/{orgId}/invitations (docs/tech/07-api-spec.md §4, SYS-005).
export { inviteMemberRoute as POST } from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
