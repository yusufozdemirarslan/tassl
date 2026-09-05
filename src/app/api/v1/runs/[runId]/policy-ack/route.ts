// POST /api/v1/runs/{runId}/policy-ack (07-api-spec.md §7, FR-201): the student acknowledges what
// the run counts for, which records the display in the trace and opens the Readiness Check.
export { acknowledgePolicyRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
