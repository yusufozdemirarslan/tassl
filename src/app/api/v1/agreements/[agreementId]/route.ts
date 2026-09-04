// PATCH /api/v1/agreements/{agreementId} (docs/tech/07-api-spec.md §4, DATA-052).
export { updateAgreementRoute as PATCH } from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
