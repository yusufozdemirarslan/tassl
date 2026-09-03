import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { plexMono, plexSans, plexSerif } from '@/app/fonts'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

export const metadata: Metadata = {
  title: t('landing.title'),
  description: t('landing.tagline'),
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-US"
      className={cn(plexSans.variable, plexMono.variable, plexSerif.variable, 'font-sans')}
    >
      <body>{children}</body>
    </html>
  )
}
