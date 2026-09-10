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

// Documented by pnpm openapi:generate (docs/tech/openapi.yaml §system). `assistantMode` (D-691) is
// which assistant answers the next call — `scripted` under `FEATURE_AI=false` or the `ai_mode`
// switch, `live` otherwise — and is absent only on the boot-error path, where nothing was read.
const assistantMode = z.enum(['live', 'scripted'])

attachRouteSpec(GET, {
  operationId: 'getReady',
  summary: 'Readiness (database, jobs schema, assistant mode)',
  tags: ['system'],
  status: 200,
  description: 'Ready',
  auth: 'public',
  output: z.object({
    status: z.literal('ready'),
    checks: z.record(z.string(), z.string()),
    assistantMode,
  }),
  responses: {
    '503': {
      description: 'Not ready',
      schema: z.object({
        status: z.literal('not_ready'),
        checks: z.record(z.string(), z.string()),
        assistantMode: assistantMode.optional(),
      }),
    },
  },
})
