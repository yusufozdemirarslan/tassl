// GET /api/v1/runs/{runId}/exports/{version} (07-api-spec.md §8, FR-204): one filed course export,
// downloaded as the file it was written as — never a rebuild. `latest` is allowed as the version.
export { getRunExportRoute as GET } from '@/server/modules/records/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
