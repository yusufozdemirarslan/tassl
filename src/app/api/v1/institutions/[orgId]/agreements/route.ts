// GET and POST /api/v1/institutions/{orgId}/agreements (docs/tech/07-api-spec.md §4, FR-234).
export {
  createAgreementRoute as POST,
  listAgreementsRoute as GET,
} from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
