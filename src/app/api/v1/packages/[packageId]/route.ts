// GET /api/v1/packages/{packageId} (docs/tech/07-api-spec.md §6): the family with its versions.
export { getPackageRoute as GET } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
