// Liveness (SYS-009): answers without touching configuration or the database, so it is 200
// whenever the process can run JavaScript (docs/tech/13-observability-ops.md §4).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
  return Response.json(
    { status: 'ok', version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
    { headers: { 'cache-control': 'no-store' } },
  )
}
