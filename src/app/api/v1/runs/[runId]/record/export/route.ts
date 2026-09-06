// GET /api/v1/runs/{runId}/record/export (FR-243): the record-form trace, as a downloaded JSON file.
export { exportRunRecordRoute as GET } from '@/server/modules/records/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
