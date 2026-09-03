import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { ToasterClient } from '@/components/layout/toaster-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { INSTITUTIONS, RAIL, UNREAD_COUNT, USER } from './shell-data'

// UI-008. The shell inputs come from ./shell-data until Phase 3 derives them from the session.
// The toaster loads client-side after hydration (D-156).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppShell rail={RAIL} institutions={INSTITUTIONS} unreadCount={UNREAD_COUNT} user={USER}>
        {children}
      </AppShell>
      <ToasterClient />
    </TooltipProvider>
  )
}
