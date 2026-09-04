// PATCH /api/v1/institutions/{orgId}/settings (docs/tech/07-api-spec.md §4).
export { updateInstitutionSettingsRoute as PATCH } from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
