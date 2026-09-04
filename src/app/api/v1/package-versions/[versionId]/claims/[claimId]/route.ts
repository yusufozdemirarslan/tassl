// GET /api/v1/package-versions/{versionId}/claims/{claimId} (07 §6, FR-180): the claim object view.
export { getClaimObjectRoute as GET } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
