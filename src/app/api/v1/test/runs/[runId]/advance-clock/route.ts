// POST /api/v1/test/runs/{runId}/advance-clock — test-only (D-109, 07-api-spec.md §7).
//
// Timers are server timestamps materialized lazily on read (ADR-019), so shifting the timestamps is
// the only honest way for a test to reach an expiry without waiting eight minutes for one. The
// handler checks `APP_ENV=test` before it does anything else and answers 404 outside a test process,
// the service checks it again before it touches a row, and the route carries no OpenAPI spec, so
// `docs/tech/openapi.yaml` never documents a path that exists only in a test.
export { advanceClockRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
