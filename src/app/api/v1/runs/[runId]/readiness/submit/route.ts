// POST /api/v1/runs/{runId}/readiness/submit (07-api-spec.md §7, FR-012): closes the check and
// answers the concept map — named concepts, held, not held or unknown, and no total anywhere.
export { submitReadinessRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
