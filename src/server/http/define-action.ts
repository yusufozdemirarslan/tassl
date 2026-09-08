// defineAction(): docs/tech/10-backend-spec.md §2 and 08-auth-authz.md §3.
// Same context, session, validation, and error mapping as defineRoute; never throws to the client.
// Module files that export actions start with 'use server'.
import * as Sentry from '@sentry/nextjs'
import type { Logger } from 'pino'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z, type ZodType } from 'zod'
import { AppError, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import type { SessionUser } from '@/server/auth/types'
import { toErrorParts } from '@/server/http/errors'
import { runWithContext, type RequestContext } from '@/server/http/request-context'
import { routeGroup } from '@/server/http/route-group'
import { createRequestLogger, hashId } from '@/server/logging/logger'
import { getOrCreateRequestId } from '@/server/logging/request-id'

export type ActionContext = { requestId: string; actor: SessionUser; logger: Logger }

/** Handlers return the data plus the paths to revalidate after a successful write. */
export type ActionOutcome<O> = { data: O; revalidate?: string[] }

export type ActionHandler<I, O> = (input: I, ctx: ActionContext) => Promise<ActionOutcome<O>>

export type ServerAction<O> = (input: unknown) => Promise<ActionResult<O>>

/** next/headers is only available inside a request; scripts and unit tests get an empty set. */
async function requestHeaders(): Promise<Headers> {
  try {
    return await headers()
  } catch {
    return new Headers()
  }
}

export function defineAction<I, O>(
  schema: ZodType<I>,
  handler: ActionHandler<I, O>,
  opts: { name?: string } = {},
): ServerAction<O> {
  const name = opts.name ?? (handler.name || 'action')

  return async function action(rawInput: unknown): Promise<ActionResult<O>> {
    const startedAt = Date.now()
    const hdrs = await requestHeaders()
    const requestId = getOrCreateRequestId(hdrs)
    const logger = createRequestLogger({ requestId, route: name, method: 'ACTION' })
    const store: RequestContext = { requestId, actor: null, logger, startedAt }

    // The action's own name, never its input: an action argument is the student's free text
    // (13 §2.3). `route_group: action` is the tag the NFR-008 write-latency rule matches (13 §7).
    Sentry.setTag('request_id', requestId)
    Sentry.setTag('route_group', routeGroup(name, 'ACTION'))

    return runWithContext(store, async () => {
      try {
        const actor = await requireSession(hdrs)
        store.actor = actor
        store.logger = logger.child({
          userId: hashId(actor.id),
          ...(actor.activeOrganizationId ? { orgId: actor.activeOrganizationId } : {}),
        })
        Sentry.setUser({ id: hashId(actor.id) })
        if (actor.activeOrganizationId) Sentry.setTag('org_id', actor.activeOrganizationId)

        const parsed = schema.safeParse(rawInput)
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', undefined, {
            details: z.flattenError(parsed.error),
          })
        }

        const outcome = await Sentry.startSpan({ name, op: 'function.server_action' }, () =>
          handler(parsed.data, { requestId, actor, logger: store.logger }),
        )
        for (const path of outcome.revalidate ?? []) revalidatePath(path)

        store.logger.info(
          { event: 'http_request', status: 200, durationMs: Date.now() - startedAt },
          'action completed',
        )
        return { ok: true, data: outcome.data }
      } catch (error) {
        const parts = toErrorParts(error, requestId)
        const durationMs = Date.now() - startedAt
        if (parts.status >= 500) {
          Sentry.captureException(error, { tags: { error_code: parts.code } })
          store.logger.error(
            {
              event: 'http_request',
              status: parts.status,
              code: parts.code,
              err: error,
              durationMs,
            },
            'action failed',
          )
        } else {
          store.logger.info(
            { event: 'http_request', status: parts.status, code: parts.code, durationMs },
            'action rejected',
          )
        }
        return { ok: false, error: parts.body.error }
      }
    })
  }
}
