import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { t } from '@/lib/i18n/t'

export const metadata: Metadata = {
  title: t('landing.title'),
  description: t('landing.tagline'),
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-US">
      <body>{children}</body>
    </html>
  )
}
