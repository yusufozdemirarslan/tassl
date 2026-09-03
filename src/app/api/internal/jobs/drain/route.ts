// Job drain endpoint: docs/tech/10-backend-spec.md §7, DECISIONS.md D-012, 07-api-spec.md (internal).
// GET is called by Vercel Cron (`0 4 * * *`), POST by an operator (13-observability-ops.md §8.6);
// both carry `Authorization: Bearer <CRON_SECRET>`. Schedules the daily maintenance job, then drains
// within the route's 300 s budget.
import { z } from 'zod'
import { defineRoute } from '@/server/http/define-route'
import { drainQueues, scheduleDailyMaintenance, type DrainResult } from '@/server/jobs/drain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DRAIN_BUDGET_MS = 270_000

const output = z.object({
  processed: z.number().int(),
  failed: z.number().int(),
  skippedQueues: z.array(z.string()),
  durationMs: z.number().int(),
})

async function drainAndMaintain(): Promise<DrainResult> {
  await scheduleDailyMaintenance()
  return drainQueues({ maxMs: DRAIN_BUDGET_MS })
}

export const GET = defineRoute(
  {
    auth: 'cron',
    output,
    openapi: {
      operationId: 'drainJobsCron',
      summary: 'Drain job queues and run daily maintenance (Vercel Cron)',
      tags: ['system'],
    },
  },
  drainAndMaintain,
)

export const POST = defineRoute(
  {
    auth: 'cron',
    output,
    openapi: {
      operationId: 'drainJobs',
      summary: 'Drain job queues and run daily maintenance (manual)',
      tags: ['system'],
    },
  },
  drainAndMaintain,
)
