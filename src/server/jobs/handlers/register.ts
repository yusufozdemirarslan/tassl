// Handler registration: importing this module once registers every job handler that exists, so the
// drain route and the local worker never poll a queue whose handler simply was not imported
// (10-backend-spec.md §7). Later phases add one import line each: generate_package_step (authoring).
//
// `send_email` is the exception and is registered by a call, not by an import: only a process with
// an HTML renderer may claim it (D-431), and asking costs one `await`. Everything else registers on
// import, so `registerAllHandlers()` has to be awaited before a drain or a poll.
import '@/server/jobs/handlers/purge-deleted-accounts'
import '@/server/jobs/handlers/recompute-exports'
import '@/server/jobs/handlers/score-run'
import { registerSendEmailHandler } from '@/server/jobs/handlers/send-email'

/** Call it (or import the module and call it) before draining or polling. */
export async function registerAllHandlers(): Promise<void> {
  await registerSendEmailHandler()
}
