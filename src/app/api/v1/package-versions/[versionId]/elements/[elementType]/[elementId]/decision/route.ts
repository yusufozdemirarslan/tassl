// POST .../package-versions/{versionId}/elements/{elementType}/{elementId}/decision (07 §6, FR-192).
export { decideElementRoute as POST } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
