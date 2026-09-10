// Liveness (SYS-009): answers without touching configuration or the database, so it is 200
// whenever the process can run JavaScript (docs/tech/13-observability-ops.md §4).
import { z } from 'zod'
import { attachRouteSpec } from '@/server/http/openapi-registry'
import { getOrCreateRequestId } from '@/server/logging/request-id'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The probe mints its own request id rather than rejoining the proxy's matcher.
//
// `17-analytics-events.md` §5.7 keeps `/api/health` out of that matcher on purpose — a liveness
// probe should not do per-request nonce work, and it must answer whenever the process can run
// JavaScript, which is the one property the middleware could take away. But `12-security.md` §4
// wants every response traceable, and the probe is the response an operator reads first when
// something is wrong. So it does the one thing the proxy did for it, with the same helper, so an
// inbound id is echoed and a missing one is minted exactly as everywhere else.
// `SENTRY_RELEASE` is inlined at build time by next.config.ts (`env`), so it is the SHA the deploy
// was built from even though production.yml detaches `.git` before `vercel deploy`. Vercel then
// sets `VERCEL_GIT_COMMIT_SHA` to the empty string rather than leaving it unset, so the `??` this
// replaces never reached its fallback: production answered `"version":""`, which names no commit
// and is not even the honest "dev". Each rung is taken only when it holds a non-empty string.
const version = (): string =>
  process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || 'dev'

export function GET(request: Request) {
  return Response.json(
    { status: 'ok', version: version() },
    {
      headers: {
        'cache-control': 'no-store',
        'x-request-id': getOrCreateRequestId(request.headers),
      },
    },
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
