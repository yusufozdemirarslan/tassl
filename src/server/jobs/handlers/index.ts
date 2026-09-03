// Job handler registry: docs/tech/10-backend-spec.md §7 (handler column) and build-plan Step 2.7.
// Modules register their handler for a queue as they land (scoring.scoreRun, authoring.runGenerationStep,
// email.deliver, identity.purgeDeletedAccounts, courses.recomputeExports); the drain and the local
// worker skip queues without one and log the gap at warn. Nothing is registered here.
import type { Logger } from 'pino'
import type { Payload, QueueName } from '@/server/jobs/queues'

export type JobContext = { jobId: string; logger: Logger }

export type JobHandler<Q extends QueueName = QueueName> = (
  payload: Payload<Q>,
  ctx: JobContext,
) => Promise<void>

type UntypedHandler = (payload: unknown, ctx: JobContext) => Promise<void>

const handlers = new Map<QueueName, UntypedHandler>()

export function registerHandler<Q extends QueueName>(queue: Q, handler: JobHandler<Q>): void {
  handlers.set(queue, handler as UntypedHandler)
}

export function getHandler<Q extends QueueName>(queue: Q): JobHandler<Q> | undefined {
  return handlers.get(queue) as JobHandler<Q> | undefined
}

export const hasHandler = (queue: QueueName): boolean => handlers.has(queue)

/** Tests only: forget every registered handler. */
export function clearHandlers(): void {
  handlers.clear()
}
