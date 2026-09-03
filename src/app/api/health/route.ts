// Liveness (SYS-009): answers without touching configuration or the database, so it is 200
// whenever the process can run JavaScript (docs/tech/13-observability-ops.md §4).
import { z } from 'zod'
import { attachRouteSpec } from '@/server/http/openapi-registry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
  return Response.json(
    { status: 'ok', version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
    { headers: { 'cache-control': 'no-store' } },
  )
}

// Documented by pnpm openapi:generate (docs/tech/openapi.yaml §system).
attachRouteSpec(GET, {
  operationId: 'getHealth',
  summary: 'Liveness',
  tags: ['system'],
  status: 200,
  description: 'OK',
  auth: 'public',
  output: z.object({ status: z.literal('ok'), version: z.string() }),
})
