// Readiness (SYS-009): docs/tech/13-observability-ops.md §4.
import { z } from 'zod'
import { attachRouteSpec } from '@/server/http/openapi-registry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'cache-control': 'no-store' }

export async function GET() {
  try {
    const { checkReadiness } = await import('@/server/http/readiness')
    const report = await checkReadiness()
    return Response.json(report, {
      status: report.status === 'ready' ? 200 : 503,
      headers: NO_STORE,
    })
  } catch {
    // Module load failed: invalid environment (INVALID_SERVER_ENV) or driver failure.
    return Response.json(
      { status: 'not_ready', checks: { db: 'boot_error', jobs: 'skipped' } },
      { status: 503, headers: NO_STORE },
    )
  }
}

// Documented by pnpm openapi:generate (docs/tech/openapi.yaml §system).
attachRouteSpec(GET, {
  operationId: 'getReady',
  summary: 'Readiness (database and jobs schema)',
  tags: ['system'],
  status: 200,
  description: 'Ready',
  auth: 'public',
  output: z.object({ status: z.literal('ready'), checks: z.record(z.string(), z.string()) }),
  responses: {
    '503': {
      description: 'Not ready',
      schema: z.object({
        status: z.literal('not_ready'),
        checks: z.record(z.string(), z.string()),
      }),
    },
  },
})
