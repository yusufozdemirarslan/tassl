// GET /api/v1/institutions, POST /api/v1/institutions (docs/tech/07-api-spec.md §4).
// The handlers are defined in the tenancy module's router; this file only mounts them.
export {
  createInstitutionRoute as POST,
  listInstitutionsRoute as GET,
} from '@/server/modules/tenancy/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
