import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { railFor } from '@/components/layout/rail-items'
import { ToasterClient } from '@/components/layout/toaster-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getUnreadCount, getViewer } from './viewer'

// UI-008: the shell reads the session once (./viewer), derives the rail from the roles the person
// holds, and hands the switcher, the bell, and the account menu their real data. The client feature
// flags are provided by the root layout, so nothing else is mounted here; the toaster loads
// client-side after hydration (D-156).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [{ me }, unreadCount] = await Promise.all([getViewer(), getUnreadCount()])

  const institutions = me.memberships.map(({ organizationId, name }) => ({
    id: organizationId,
    name,
  }))
  // A session that has never used the switcher still shows an institution: the first membership,
  // which is the same tenant the `/me` lists resolve to (10 §1 `resolveTenant`).
  const activeInstitutionId = me.activeOrganizationId ?? institutions[0]?.id

  return (
    <TooltipProvider>
      <AppShell
        rail={railFor({
          roles: me.memberships.map((membership) => membership.role),
          platformRole: me.platformRole,
        })}
        institutions={institutions}
        activeInstitutionId={activeInstitutionId}
        unreadCount={unreadCount}
        user={{ name: me.name, email: me.email }}
      >
        {children}
      </AppShell>
      <ToasterClient />
    </TooltipProvider>
  )
}
