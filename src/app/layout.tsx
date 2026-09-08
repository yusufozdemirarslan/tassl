import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { plexMono, plexSans, plexSerif } from '@/app/fonts'
import { AnalyticsEnvironment } from '@/components/layout/analytics-environment'
import { cn } from '@/lib/cn'
import { FlagsProvider } from '@/lib/flags-context'
import { flagsFromEnv } from '@/lib/flags'
import { t } from '@/lib/i18n/t'
import { env } from '@/server/config'

// Every page sets its own title (WCAG 2.4.2); this template appends the product name.
export const metadata: Metadata = {
  title: { default: t('landing.title'), template: t('shell.titleTemplate') },
  description: t('landing.tagline'),
}

/**
 * Every route renders per request, because a nonce CSP and a prerendered page cannot both be true
 * (D-611, 12 §4.2).
 *
 * Next.js reads the nonce off the `Content-Security-Policy` *request* header `src/proxy.ts` sets
 * and stamps it onto every script it emits. A page generated at build time has no request to read
 * one from, so its script tags carry none — and under `script-src … 'strict-dynamic'` a browser
 * ignores `'self'`, so *all* of them are blocked, not just the inline ones. Measured before this
 * line existed: `/sign-in` and every other route were already dynamic for their own reasons and
 * carried the nonce on all 19 script tags, while the one page Next still prerendered,
 * `/_not-found`, served 14 script tags with no nonce at all.
 *
 * The line is here rather than on that page because the failure is silent and the next page added
 * without a dynamic API in it would reintroduce it.
 */
export const dynamic = 'force-dynamic'

// Root layout: fonts and the client-safe feature flags only. The toast and tooltip providers mount
// in the (app) and (public) layouts so `/`, not-found, and error pages stay within the public
// script budget (16 §3, D-156).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-US"
      className={cn(plexSans.variable, plexMono.variable, plexSerif.variable, 'font-sans')}
    >
      <body>
        <AnalyticsEnvironment appEnv={env.APP_ENV} />
        <FlagsProvider flags={flagsFromEnv(env)}>{children}</FlagsProvider>
      </body>
    </html>
  )
}
