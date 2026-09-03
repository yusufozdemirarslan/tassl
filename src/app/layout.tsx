import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { plexMono, plexSans, plexSerif } from '@/app/fonts'
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
        <FlagsProvider flags={flagsFromEnv(env)}>{children}</FlagsProvider>
      </body>
    </html>
  )
}
