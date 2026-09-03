'use client'

import dynamic from 'next/dynamic'
import { t } from '@/lib/i18n/t'

// The toaster is client-only and mounts after hydration so it stays out of the server render and
// the initial script budget (16 §3, D-156). `ssr: false` is only allowed from a client component
// in the App Router, so the (app) and /dev layouts mount this wrapper instead of the Toaster.
const Toaster = dynamic(() => import('@/components/ui/sonner').then((m) => m.Toaster), {
  ssr: false,
})

export function ToasterClient() {
  return <Toaster containerAriaLabel={t('toast.region')} />
}
