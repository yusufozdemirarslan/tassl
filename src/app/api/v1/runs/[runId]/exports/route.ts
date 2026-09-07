// GET /api/v1/runs/{runId}/exports (07-api-spec.md §8, FR-184): the course export versions filed for
// one run, newest first, for a reviewer of its section. A voided run has none (FR-002, D-434).
export { listRunExportsRoute as GET } from '@/server/modules/records/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
