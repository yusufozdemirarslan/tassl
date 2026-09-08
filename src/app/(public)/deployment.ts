import 'server-only'
import type { LegalDeployment } from '@/lib/legal/document'
import { effectiveLlmProvider, env } from '@/server/config'

// What the legal pages are allowed to say about the installation they are being read on (UI-006,
// D-017). It is read from the parsed environment at render time, so the processor table on
// /privacy names the services this deployment actually passes data to and no others — a page that
// lists Sentry on an installation with no DSN is describing a product we did not build.
//
// `src/lib/legal/*` cannot import `src/server` (04 §2), so this is where the two meet: the pages
// are Server Components, they call this, and the document builders take the answer.

/** `Tassl <no-reply@tassl.local>` → `no-reply@tassl.local`; a bare address is returned as it is. */
function addressOf(from: string): string {
  const angled = /<([^>]+)>/.exec(from)
  return (angled?.[1] ?? from).trim()
}

export function legalDeployment(): LegalDeployment {
  const provider = effectiveLlmProvider()
  return {
    contactEmail: addressOf(env.EMAIL_FROM),
    // `local` and `test` run against Docker Postgres and a local server; `preview` and `production`
    // are the managed pair named in 01 §9.
    managedHosting: env.APP_ENV === 'preview' || env.APP_ENV === 'production',
    emailDelivery: env.EMAIL_TRANSPORT === 'resend',
    googleSignIn: env.GOOGLE_CLIENT_ID.length > 0,
    analytics: env.NEXT_PUBLIC_POSTHOG_KEY.length > 0,
    errorMonitoring: env.NEXT_PUBLIC_SENTRY_DSN.length > 0,
    llmProvider: provider,
    llmModel: provider === 'anthropic' ? env.LLM_FALLBACK_MODEL : env.LLM_MODEL,
  }
}
