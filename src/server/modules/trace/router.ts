// Route handlers of the `trace` module (docs/tech/07-api-spec.md §7). Mounted by the thin
// `src/app/api/v1/**/route.ts` that `pnpm openapi:generate` reads. No business logic: the wrapper
// authenticates, validates and rate-limits, and the service decides who may read the run — a run id
// does not name its section, and only the service can resolve one to the other.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { listEvents } from './service'
import { RunIdParamsSchema, TraceEventViewSchema } from './schema'

const TAGS = ['runs']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

export const listRunTraceRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: z.array(TraceEventViewSchema),
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listRunTrace',
      summary: 'Run trace events in order',
      tags: TAGS,
    },
  },
  async (ctx) => listEvents(actorOf(ctx), ctx.input.params.runId),
)
