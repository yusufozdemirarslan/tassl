// send_email handler: docs/tech/10-backend-spec.md §7 (`email.deliver`, no singleton key).
// Renders the template and hands the message to the transport; a throw is the retry signal
// (3 attempts, 30 s backoff, then the send_email_dead queue).
import { deliverEmail } from '@/server/email/send'
import { registerHandler, type JobHandler } from '@/server/jobs/handlers'

export const sendEmailHandler: JobHandler<'send_email'> = async (payload) => {
  await deliverEmail(payload)
}

registerHandler('send_email', sendEmailHandler)
