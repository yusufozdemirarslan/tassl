// Readiness (SYS-009): docs/tech/13-observability-ops.md §4.
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
