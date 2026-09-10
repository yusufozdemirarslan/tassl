// POST /api/v1/admin/sentry-test (07 §9, D-708): one test event to Sentry from this deployment.
export { adminSentryTest as POST } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
