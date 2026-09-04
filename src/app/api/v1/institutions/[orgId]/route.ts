// GET /api/v1/institutions/{orgId} (docs/tech/07-api-spec.md §4).
export { getInstitutionRoute as GET } from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
