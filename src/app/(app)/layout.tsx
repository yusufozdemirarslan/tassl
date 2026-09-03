import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import type { RailItem } from '@/components/layout/rail'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n/t'

// UI-008. Phase 3 adds requireSession(), memberships, the unread count, and the permitted rail
// items; until then the shell renders the zero-membership state with Home only.
const RAIL: RailItem[] = [{ href: '/home', label: t('nav.home'), icon: 'home' }]

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppShell rail={RAIL} institutions={[]} unreadCount={0} user={null}>
        {children}
      </AppShell>
      <Toaster />
    </TooltipProvider>
  )
}
