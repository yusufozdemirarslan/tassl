// POST /api/v1/test/rate-limits/reset — test-only (D-109's pattern, D-707): empties the process's
// in-memory rate-limit windows so the guide-driven suite can run one seat through three engines in
// one server. The handler answers 404 outside `APP_ENV=test` before it reads a session, and the
// route carries no OpenAPI spec, so `docs/tech/openapi.yaml` never documents it.
export { resetRateLimitsRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
