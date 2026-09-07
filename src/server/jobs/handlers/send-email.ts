// send_email handler: docs/tech/10-backend-spec.md §7 (`email.deliver`, no singleton key).
// Renders the template and hands the message to the transport; a throw is the retry signal
// (3 attempts, 30 s backoff, then the send_email_dead queue).
//
// The handler is registered only in a process that can render an email (D-431). Rendering reaches
// `react-dom/server`, which React replaces with a module that throws for anyone resolving with the
// `react-server` export condition, and `--conditions` is process-wide in Node: `pnpm db:seed` runs
// as `tsx --conditions=react-server` (D-214) and can never deliver a `send_email` job. Claiming one
// there would only burn its three retries and drop it into `send_email_dead`, so the queue is left
// for a runtime that has a renderer — the Next.js server (the cron drain route and the `after()`
// drain after any enqueue) or `pnpm jobs:worker`.
import { deliverEmail, emailRenderingSupport } from '@/server/email/send'
import { getHandler, registerHandler, type JobHandler } from '@/server/jobs/handlers'
import { rootLogger } from '@/server/logging/logger'

export const sendEmailHandler: JobHandler<'send_email'> = async (payload) => {
  await deliverEmail(payload)
}

/** Warned once per process: the drain repeats `drain_queue_skipped` for the queue on every pass. */
let reported = false

/**
 * Registers `send_email` when this process can render, and says why in the log when it cannot.
 * Resolves with whether the handler is now registered.
 *
 * It registers once and never replaces what is already there, which is what a handler that
 * registers on import does. `enqueue()` calls this before every drain, and a caller that has put
 * its own handler on the queue — the suites in `tests/integration` — must still see that one run.
 */
export async function registerSendEmailHandler(): Promise<boolean> {
  if (getHandler('send_email') !== undefined) return true
  const support = await emailRenderingSupport()
  if (support.ok) {
    registerHandler('send_email', sendEmailHandler)
    return true
  }
  if (!reported) {
    reported = true
    rootLogger.warn(
      { event: 'handler_not_registered', queue: 'send_email', reason: support.reason },
      'no HTML renderer in this process; send_email is left queued for a runtime that has one',
    )
  }
  return false
}
