// GET and POST /api/v1/institutions/{orgId}/packages (docs/tech/07-api-spec.md §6, FR-190, UI-040).
export {
  createPackageFromSeedRoute as POST,
  listPackagesRoute as GET,
} from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
